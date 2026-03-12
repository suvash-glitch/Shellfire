const { app, BrowserWindow, ipcMain, Notification, shell, net: electronNet } = require("electron");
const pty = require("node-pty");
const net = require("net");
const path = require("path");
const os = require("os");
const fs = require("fs");
const { execFileSync, execSync, spawn } = require("child_process");

// Auto-updater (gracefully skip if not packaged)
let autoUpdater = null;
try {
  const { autoUpdater: updater } = require("electron-updater");
  autoUpdater = updater;
} catch {}

function log(level, msg, ...args) {
  const timestamp = new Date().toISOString();
  const logLine = `[${timestamp}] [${level}] ${msg}`;
  if (args.length) console[level === 'error' ? 'error' : 'log'](logLine, ...args);
  else console[level === 'error' ? 'error' : 'log'](logLine);
}

let mainWindow;
const ptys = new Map();
let nextId = 1;

// ============================================================
// INPUT VALIDATION HELPERS
// ============================================================
function sanitizePath(p) {
  if (typeof p !== "string") return null;
  if (p.includes("\0")) return null;
  const resolved = path.resolve(p);
  // Block path traversal patterns in the original input
  if (p.includes("../") || p.includes("..\\")) return null;
  return resolved;
}

function isValidHost(h) {
  return typeof h === "string" && h.length > 0 && h.length <= 255 && /^[a-zA-Z0-9._\-]+$/.test(h);
}

function isValidUser(u) {
  return typeof u === "string" && u.length > 0 && u.length <= 64 && /^[a-zA-Z0-9._\-]+$/.test(u);
}

function isValidPort(p) {
  const n = Number(p);
  return Number.isInteger(n) && n >= 1 && n <= 65535;
}

const SESSION_PATH = path.join(app.getPath("userData"), "session.json");
const CONFIG_PATH = path.join(app.getPath("userData"), "config.json");
const SNIPPETS_PATH = path.join(app.getPath("userData"), "snippets.json");
const PROFILES_PATH = path.join(app.getPath("userData"), "profiles.json");
const RECENTS_PATH = path.join(app.getPath("userData"), "recents.json");

function readJSON(p, fallback) {
  try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return fallback; }
}
function writeJSON(p, data) {
  fs.writeFileSync(p, JSON.stringify(data, null, 2));
}

// ============================================================
// SINGLE INSTANCE LOCK
// ============================================================
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

function createWindow() {
  const windowOpts = {
    width: 1200,
    height: 800,
    backgroundColor: "#1e1e1e",
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      preload: path.join(__dirname, "preload.js"),
    },
  };
  if (process.platform === "darwin") {
    windowOpts.titleBarStyle = "hiddenInset";
    windowOpts.trafficLightPosition = { x: 13, y: 13 };
    windowOpts.vibrancy = "titlebar";
  } else {
    windowOpts.frame = false;
  }
  mainWindow = new BrowserWindow(windowOpts);

  mainWindow.loadFile("index.html");

  mainWindow.webContents.session.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': ["default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; font-src 'self'"]
      }
    });
  });
  mainWindow.setFullScreen(true);

  mainWindow.on("closed", () => {
    for (const [, p] of ptys) p.kill();
    ptys.clear();
    mainWindow = null;
  });
}

app.whenReady().then(createWindow);

// Auto-update check (only when packaged)
app.whenReady().then(() => {
  if (autoUpdater && app.isPackaged) {
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;

    autoUpdater.on("update-available", (info) => {
      log("info", `Update available: v${info.version}`);
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send("update-status", { status: "available", version: info.version });
      }
    });

    autoUpdater.on("update-downloaded", (info) => {
      log("info", `Update downloaded: v${info.version}`);
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send("update-status", { status: "downloaded", version: info.version });
        const { dialog } = require("electron");
        dialog.showMessageBox(mainWindow, {
          type: "info",
          title: "Update Ready",
          message: `Terminator v${info.version} has been downloaded.`,
          detail: "Restart the app to apply the update.",
          buttons: ["Restart Now", "Later"],
          defaultId: 0,
        }).then(({ response }) => {
          if (response === 0) autoUpdater.quitAndInstall();
        });
      }
    });

    autoUpdater.on("error", (err) => {
      log("error", "Auto-update error:", err.message);
    });

    autoUpdater.checkForUpdatesAndNotify().catch(() => {});
    // Check for updates every 4 hours
    setInterval(() => {
      autoUpdater.checkForUpdatesAndNotify().catch(() => {});
    }, 4 * 60 * 60 * 1000);
  }
});

// ============================================================
// MULTIPLEXER SOCKET SERVER
// ============================================================
const SOCKET_DIR = path.join(os.homedir(), ".terminator");
const SOCKET_PATH = path.join(SOCKET_DIR, "terminator.sock");
let socketServer = null;

function startSocketServer() {
  if (!fs.existsSync(SOCKET_DIR)) fs.mkdirSync(SOCKET_DIR, { recursive: true });
  // Clean up stale socket
  try { fs.unlinkSync(SOCKET_PATH); } catch {}

  socketServer = net.createServer((conn) => {
    let buf = "";
    let streaming = false;
    conn.on("data", (chunk) => {
      // Once in streaming mode, the attach handler owns this connection
      if (streaming) return;
      buf += chunk.toString();
      const idx = buf.indexOf("\n");
      if (idx !== -1) {
        streaming = true; // prevent re-entry; attach handler may replace this
        const line = buf.slice(0, idx).trim();
        handleSocketCommand(line, conn);
      }
    });
    conn.on("error", (err) => {
      log("error", "Socket connection error:", err.message);
    });
  });

  socketServer.listen(SOCKET_PATH, () => {
    log("info", `Socket server listening on ${SOCKET_PATH}`);
    // Make socket accessible
    try { fs.chmodSync(SOCKET_PATH, 0o600); } catch {}
  });
  socketServer.on("error", (err) => {
    log("error", "Socket server error:", err);
  });
}

async function handleSocketCommand(raw, conn) {
  let cmd;
  try {
    cmd = JSON.parse(raw);
  } catch {
    conn.end(JSON.stringify({ error: "Invalid JSON" }));
    return;
  }

  if (!mainWindow || mainWindow.isDestroyed()) {
    conn.end(JSON.stringify({ error: "No active window" }));
    return;
  }

  try {
    switch (cmd.action) {
      case "list": {
        const sessions = await mainWindow.webContents.executeJavaScript(`
          (function() {
            const result = [];
            for (const [id, pane] of window.__panes || new Map()) {
              result.push({
                id,
                name: pane.customName || null,
                active: id === window.__activeId,
              });
            }
            return result;
          })()
        `);
        // Enrich with cwd and process info from main process
        for (const s of sessions) {
          try { s.cwd = await getCwdForPty(s.id); } catch { s.cwd = null; }
          try { s.process = await getProcessForPty(s.id); } catch { s.process = null; }
          if (!s.name) s.name = `Terminal ${s.id}`;
          if (s.cwd) s.cwd = s.cwd.replace(os.homedir(), "~");
        }
        conn.end(JSON.stringify({ sessions }));
        break;
      }
      case "attach": {
        const safeName = JSON.stringify(cmd.name);
        const result = await mainWindow.webContents.executeJavaScript(`
          (function() {
            const target = ${safeName};
            for (const [id, pane] of window.__panes || new Map()) {
              const name = pane.customName || "Terminal " + id;
              if (name === target || String(id) === target) {
                window.__setActive(id);
                return { id, name };
              }
            }
            return { error: "Session not found: " + target };
          })()
        `);
        if (result.error) {
          conn.end(JSON.stringify(result));
          break;
        }
        // Streaming attach: keep connection open, pipe pty I/O
        if (cmd.stream) {
          const ptyProc = ptys.get(result.id);
          if (!ptyProc) {
            log("error", `Attach stream: PTY not found for id=${result.id}, ptys keys: [${[...ptys.keys()]}]`);
            conn.end(JSON.stringify({ error: "PTY not found" }));
            break;
          }
          log("info", `Attach stream: handshake OK for session ${result.id} "${result.name}"`);

          // Send handshake, then switch to raw streaming
          conn.write(JSON.stringify({ ok: true, id: result.id, name: result.name }) + "\n");

          // Replace the initial data handler with streaming handler
          conn.removeAllListeners("data");
          conn.removeAllListeners("error");

          // Stream pty output to the socket client
          const disposable = ptyProc.onData((data) => {
            if (!conn.destroyed) {
              try { conn.write(data); } catch (e) {
                log("error", `Attach stream: write to client failed: ${e.message}`);
              }
            }
          });

          // Stream client input to the pty, with resize control support
          conn.on("data", (chunk) => {
            // Resize control messages are prefixed with null byte (\x00)
            if (chunk[0] === 0x00) {
              try {
                const resizeMsg = JSON.parse(chunk.slice(1).toString().trim());
                if (resizeMsg.cols && resizeMsg.rows) {
                  ptyProc.resize(resizeMsg.cols, resizeMsg.rows);
                }
              } catch {}
              return;
            }
            ptyProc.write(chunk);
          });

          // Cleanup on disconnect — dispose the pty listener, pty stays alive
          let cleaned = false;
          const cleanup = () => {
            if (cleaned) return;
            cleaned = true;
            disposable.dispose();
            conn.removeAllListeners("data");
            log("info", `Client detached from session ${result.id}`);
          };
          conn.on("end", cleanup);
          conn.on("close", cleanup);
          conn.on("error", (err) => {
            log("error", `Attach stream error: ${err.message}`);
            cleanup();
          });

          // Also clean up if the pty exits while attached
          ptyProc.onExit(() => {
            if (!conn.destroyed) {
              try { conn.end(); } catch {}
            }
          });

          mainWindow.show();
          mainWindow.focus();
          // Don't end the connection — keep it open for streaming
          break;
        }
        // Non-streaming attach: just focus and respond
        mainWindow.show();
        mainWindow.focus();
        conn.end(JSON.stringify(result));
        break;
      }
      case "new": {
        const safeCwd = cmd.cwd ? JSON.stringify(cmd.cwd) : "null";
        const safeName = cmd.name ? JSON.stringify(cmd.name) : "null";
        const result = await mainWindow.webContents.executeJavaScript(`
          (async function() {
            const cwd = ${safeCwd};
            const name = ${safeName};
            const id = await window.__createPane(cwd);
            const pane = (window.__panes || new Map()).get(id);
            if (pane && name) {
              pane.customName = name;
              pane._userRenamed = true;
              if (pane.titleEl) pane.titleEl.textContent = name;
            }
            return { id, name: name || "Terminal " + id };
          })()
        `);
        mainWindow.show();
        mainWindow.focus();
        conn.end(JSON.stringify(result));
        break;
      }
      case "send": {
        // Resolve session ID from the renderer
        const safeName = JSON.stringify(cmd.name);
        const resolved = await mainWindow.webContents.executeJavaScript(`
          (function() {
            const target = ${safeName};
            for (const [id, pane] of window.__panes || new Map()) {
              const name = pane.customName || "Terminal " + id;
              if (name === target || String(id) === target) {
                return { id, name };
              }
            }
            return { error: "Session not found: " + target };
          })()
        `);
        if (resolved.error) {
          conn.end(JSON.stringify(resolved));
        } else {
          // Write directly to the pty in main process
          const p = ptys.get(resolved.id);
          if (p) {
            p.write(cmd.text + "\r");
            conn.end(JSON.stringify(resolved));
          } else {
            conn.end(JSON.stringify({ error: "PTY not found for session " + resolved.id }));
          }
        }
        break;
      }
      case "kill": {
        const safeName = JSON.stringify(cmd.name);
        const result = await mainWindow.webContents.executeJavaScript(`
          (function() {
            const target = ${safeName};
            for (const [id, pane] of window.__panes || new Map()) {
              const name = pane.customName || "Terminal " + id;
              if (name === target || String(id) === target) {
                window.__removeTerminal(id);
                return { id, name };
              }
            }
            return { error: "Session not found: " + target };
          })()
        `);
        conn.end(JSON.stringify(result));
        break;
      }
      case "rename": {
        const safeName = JSON.stringify(cmd.name);
        const safeNewName = JSON.stringify(cmd.newName);
        const result = await mainWindow.webContents.executeJavaScript(`
          (function() {
            const target = ${safeName};
            const newName = ${safeNewName};
            for (const [id, pane] of window.__panes || new Map()) {
              const name = pane.customName || "Terminal " + id;
              if (name === target || String(id) === target) {
                pane.customName = newName;
                pane._userRenamed = true;
                if (pane.titleEl) pane.titleEl.textContent = newName;
                return { id, name: newName };
              }
            }
            return { error: "Session not found: " + target };
          })()
        `);
        conn.end(JSON.stringify(result));
        break;
      }
      default:
        conn.end(JSON.stringify({ error: `Unknown action: ${cmd.action}` }));
    }
  } catch (err) {
    conn.end(JSON.stringify({ error: err.message }));
  }
}

function getCwdForPty(id) {
  const p = ptys.get(id);
  if (!p) return null;
  try {
    const pid = String(p.pid);
    if (process.platform === "win32") return null;
    const result = execFileSync("lsof", ["-p", pid, "-Fn"], {
      encoding: "utf8", timeout: 2000, stdio: ["pipe", "pipe", "pipe"]
    }).trim();
    const lines = result.split("\n");
    for (let i = 0; i < lines.length; i++) {
      if (lines[i] === "fcwd" && i + 1 < lines.length && lines[i + 1].startsWith("n")) {
        return lines[i + 1].slice(1);
      }
    }
    return null;
  } catch { return null; }
}

function getProcessForPty(id) {
  const p = ptys.get(id);
  if (!p) return null;
  try {
    const pid = String(p.pid);
    if (process.platform === "win32") return null;
    let childPid;
    try {
      childPid = execFileSync("pgrep", ["-P", pid], {
        encoding: "utf8", timeout: 2000, stdio: ["pipe", "pipe", "pipe"]
      }).trim().split("\n")[0];
    } catch {}
    const targetPid = childPid || pid;
    const result = execFileSync("ps", ["-o", "comm=", "-p", targetPid], {
      encoding: "utf8", timeout: 2000, stdio: ["pipe", "pipe", "pipe"]
    }).trim();
    return result.split("/").pop() || null;
  } catch { return null; }
}

app.whenReady().then(startSocketServer);

function cleanupSocket() {
  if (socketServer) {
    socketServer.close();
    socketServer = null;
  }
  try { fs.unlinkSync(SOCKET_PATH); } catch {}
}

app.on("will-quit", cleanupSocket);
app.on("window-all-closed", () => {
  cleanupSocket();
  app.quit();
});

// Update status IPC
ipcMain.handle("check-for-updates", async () => {
  if (!autoUpdater || !app.isPackaged) return { available: false, reason: "not-packaged" };
  try {
    const result = await autoUpdater.checkForUpdates();
    return { available: !!result?.updateInfo, version: result?.updateInfo?.version };
  } catch { return { available: false, reason: "check-failed" }; }
});

// Create terminal with optional cwd
ipcMain.handle("create-terminal", (_, cwd) => {
  const shellPath = process.platform === "win32"
    ? process.env.COMSPEC || "powershell.exe"
    : process.env.SHELL || "/bin/zsh";
  const id = nextId++;
  const safeCwd = cwd ? sanitizePath(cwd) : null;
  const p = pty.spawn(shellPath, [], {
    name: "xterm-256color",
    cols: 80,
    rows: 24,
    cwd: safeCwd || os.homedir(),
    env: { ...process.env, TERM: "xterm-256color", CLAUDECODE: "" },
  });

  ptys.set(id, p);

  p.onData((data) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("terminal-data", id, data);
    }
  });

  p.onExit(({ exitCode }) => {
    ptys.delete(id);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("terminal-exit", id, exitCode);
    }
  });

  return id;
});

ipcMain.on("terminal-input", (_, id, data) => {
  if (!ptys.has(id)) return;
  const p = ptys.get(id);
  if (p) p.write(data);
});

ipcMain.on("terminal-resize", (_, id, cols, rows) => {
  const p = ptys.get(id);
  if (p) p.resize(cols, rows);
});

ipcMain.on("terminal-kill", (_, id) => {
  const p = ptys.get(id);
  if (p) { p.kill(); ptys.delete(id); }
});

ipcMain.on("terminal-broadcast", (_, ids, data) => {
  for (const id of ids) {
    const p = ptys.get(id);
    if (p) p.write(data);
  }
});

// Get cwd for a terminal
ipcMain.handle("get-terminal-cwd", async (_, id) => {
  const p = ptys.get(id);
  if (!p) return null;
  try {
    const pid = String(p.pid);
    if (process.platform === "win32") {
      // Windows: use wmic or PowerShell
      try {
        const result = execFileSync("powershell", ["-Command", `(Get-Process -Id ${pid}).Path`], {
          encoding: "utf8", timeout: 2000, stdio: ["pipe", "pipe", "pipe"]
        }).trim();
        return result || null;
      } catch { return null; }
    }
    const result = execFileSync("lsof", ["-p", pid, "-Fn"], {
      encoding: "utf8", timeout: 2000, stdio: ["pipe", "pipe", "pipe"]
    }).trim();
    const lines = result.split("\n");
    for (let i = 0; i < lines.length; i++) {
      if (lines[i] === "fcwd" && i + 1 < lines.length && lines[i + 1].startsWith("n")) {
        return lines[i + 1].slice(1);
      }
    }
    return null;
  } catch { return null; }
});

// Get process name for a terminal
ipcMain.handle("get-terminal-process", async (_, id) => {
  const p = ptys.get(id);
  if (!p) return null;
  try {
    const pid = String(p.pid);
    if (process.platform === "win32") {
      try {
        const result = execFileSync("powershell", ["-Command",
          `(Get-CimInstance Win32_Process -Filter "ParentProcessId=${pid}" | Select-Object -First 1).Name`
        ], { encoding: "utf8", timeout: 2000, stdio: ["pipe", "pipe", "pipe"] }).trim();
        return result || null;
      } catch { return null; }
    }
    let childPid;
    try {
      childPid = execFileSync("pgrep", ["-P", pid], {
        encoding: "utf8", timeout: 2000, stdio: ["pipe", "pipe", "pipe"]
      }).trim().split("\n")[0];
    } catch {}
    const targetPid = childPid || pid;
    const result = execFileSync("ps", ["-o", "comm=", "-p", targetPid], {
      encoding: "utf8", timeout: 2000, stdio: ["pipe", "pipe", "pipe"]
    }).trim();
    return result.split("/").pop() || null;
  } catch { return null; }
});

// Get git branch for a directory
ipcMain.handle("get-git-branch", async (_, dirPath) => {
  if (!dirPath) return null;
  const safePath = sanitizePath(dirPath);
  if (!safePath) return null;
  try {
    const branch = execFileSync("git", ["-C", safePath, "rev-parse", "--abbrev-ref", "HEAD"], {
      encoding: "utf8", timeout: 2000, stdio: ["pipe", "pipe", "pipe"]
    }).trim();
    return branch || null;
  } catch { return null; }
});

// Get git status (dirty/clean) for a directory
ipcMain.handle("get-git-status", async (_, dirPath) => {
  if (!dirPath) return null;
  const safePath = sanitizePath(dirPath);
  if (!safePath) return null;
  try {
    const status = execFileSync("git", ["-C", safePath, "status", "--porcelain"], {
      encoding: "utf8", timeout: 2000, stdio: ["pipe", "pipe", "pipe"]
    }).trim();
    return status ? "dirty" : "clean";
  } catch { return null; }
});

// Notifications
ipcMain.on("show-notification", (_, title, body) => {
  if (Notification.isSupported()) {
    new Notification({ title, body }).show();
  }
});

// Open file in default editor
ipcMain.on("open-in-editor", (_, filePath) => {
  const safePath = sanitizePath(filePath);
  if (!safePath) return;
  try {
    execFileSync("code", [safePath], { timeout: 3000, stdio: ["pipe", "pipe", "pipe"] });
  } catch {
    shell.openPath(safePath);
  }
});

// Session (async write for large scrollback buffers)
ipcMain.on("save-session", (_, data) => {
  try {
    const json = JSON.stringify(data);
    fs.writeFile(SESSION_PATH, json, (err) => {
      if (err) log('error', "Session save error:", err);
    });
  } catch (e) { log('error', "Session serialize error:", e); }
});
ipcMain.handle("load-session", () => readJSON(SESSION_PATH, null));

// Config
ipcMain.on("save-config", (_, config) => writeJSON(CONFIG_PATH, config));
ipcMain.handle("load-config", () => readJSON(CONFIG_PATH, { theme: 0, fontSize: 13 }));

// Snippets
ipcMain.on("save-snippets", (_, data) => writeJSON(SNIPPETS_PATH, data));
ipcMain.handle("load-snippets", () => readJSON(SNIPPETS_PATH, []));

// Profiles
ipcMain.on("save-profiles", (_, data) => writeJSON(PROFILES_PATH, data));
ipcMain.handle("load-profiles", () => readJSON(PROFILES_PATH, []));

// Recent directories
ipcMain.on("save-recents", (_, data) => writeJSON(RECENTS_PATH, data));
ipcMain.handle("load-recents", () => readJSON(RECENTS_PATH, []));

// Cron management
function getCrontab() {
  try {
    return execFileSync("crontab", ["-l"], {
      encoding: "utf8", stdio: ["pipe", "pipe", "pipe"]
    });
  } catch { return ""; }
}

function setCrontab(content) {
  const tmpFile = path.join(app.getPath("temp"), "terminator-crontab.tmp");
  fs.writeFileSync(tmpFile, content);
  try {
    execFileSync("crontab", [tmpFile], { timeout: 3000, stdio: ["pipe", "pipe", "pipe"] });
  } finally {
    try { fs.unlinkSync(tmpFile); } catch {}
  }
}

ipcMain.handle("cron-list", async () => {
  try {
    const raw = getCrontab();
    return raw.trim().split("\n").filter(l => l && !l.startsWith("#")).map((line, i) => ({ id: i, line, enabled: true }));
  } catch { return []; }
});

ipcMain.handle("cron-add", async (_, cronLine) => {
  try {
    const existing = getCrontab().trim();
    const newCron = existing ? existing + "\n" + cronLine : cronLine;
    setCrontab(newCron);
    return true;
  } catch { return false; }
});

ipcMain.handle("cron-remove", async (_, index) => {
  try {
    const lines = getCrontab().trim().split("\n");
    const active = lines.filter(l => l && !l.startsWith("#"));
    active.splice(index, 1);
    const comments = lines.filter(l => l.startsWith("#"));
    const newCron = [...comments, ...active].join("\n");
    if (newCron.trim()) {
      setCrontab(newCron);
    } else {
      try { execFileSync("crontab", ["-r"], { timeout: 3000, stdio: ["pipe", "pipe", "pipe"] }); } catch {}
    }
    return true;
  } catch { return false; }
});

// Fuzzy file finder
ipcMain.handle("find-files", async (_, query, dirs) => {
  try {
    const args = [];
    for (const d of dirs) args.push(d);
    args.push("-maxdepth", "5", "-type", "f",
      "-not", "-path", "*/node_modules/*",
      "-not", "-path", "*/.git/*",
      "-not", "-path", "*/dist/*",
      "-not", "-path", "*/.next/*");
    const result = execFileSync("find", args, {
      encoding: "utf8", timeout: 5000, stdio: ["pipe", "pipe", "pipe"],
      maxBuffer: 1024 * 1024
    }).trim();
    if (!result) return [];
    const files = result.split("\n").slice(0, 5000);
    const q = query.toLowerCase();
    const homeDir = os.homedir();
    return files
      .filter(f => f.toLowerCase().includes(q))
      .slice(0, 50)
      .map(f => ({ path: f, name: f.split("/").pop(), dir: f.replace(/\/[^/]+$/, "").replace(homeDir, "~") }));
  } catch { return []; }
});

// Save pane output to file
ipcMain.handle("save-output", async (_, content, suggestedName) => {
  const { dialog } = require("electron");
  const result = await dialog.showSaveDialog(mainWindow, {
    defaultPath: path.join(os.homedir(), "Desktop", suggestedName || "terminal-output.txt"),
    filters: [{ name: "Text", extensions: ["txt", "log"] }],
  });
  if (!result.canceled && result.filePath) {
    fs.writeFileSync(result.filePath, content);
    return result.filePath;
  }
  return null;
});

// System monitor
ipcMain.handle("system-stats", async () => {
  try {
    const cpus = os.cpus();
    const totalIdle = cpus.reduce((a, c) => a + c.times.idle, 0);
    const totalTick = cpus.reduce((a, c) => a + c.times.user + c.times.nice + c.times.sys + c.times.idle + c.times.irq, 0);
    const cpuUsage = Math.round((1 - totalIdle / totalTick) * 100);
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const memUsage = Math.round(((totalMem - freeMem) / totalMem) * 100);
    const memGB = ((totalMem - freeMem) / 1073741824).toFixed(1);
    const totalGB = (totalMem / 1073741824).toFixed(1);
    // Disk usage
    let diskUsage = null;
    try {
      if (process.platform === "win32") {
        const result = execFileSync("powershell", ["-Command",
          "Get-PSDrive C | Select-Object Used,Free | ConvertTo-Json"
        ], { encoding: "utf8", timeout: 2000, stdio: ["pipe", "pipe", "pipe"] }).trim();
        const info = JSON.parse(result);
        const usedGB = (info.Used / 1073741824).toFixed(0) + "G";
        const totalGB = ((info.Used + info.Free) / 1073741824).toFixed(0) + "G";
        const pct = Math.round(info.Used / (info.Used + info.Free) * 100);
        diskUsage = { used: usedGB, total: totalGB, percent: pct };
      } else {
        const df = execFileSync("df", ["-h", "/"], {
          encoding: "utf8", timeout: 2000, stdio: ["pipe", "pipe", "pipe"]
        }).trim().split("\n").pop().split(/\s+/);
        diskUsage = { used: df[2], total: df[1], percent: parseInt(df[4]) };
      }
    } catch {}
    return { cpuUsage, memUsage, memGB, totalGB, diskUsage, uptime: Math.round(os.uptime() / 60) };
  } catch { return null; }
});

// SSH bookmarks
const SSH_PATH = path.join(app.getPath("userData"), "ssh-bookmarks.json");
ipcMain.on("save-ssh", (_, data) => writeJSON(SSH_PATH, data));
ipcMain.handle("load-ssh", () => readJSON(SSH_PATH, []));

// Notes / scratchpad
const NOTES_PATH = path.join(app.getPath("userData"), "notes.json");
ipcMain.on("save-notes", (_, data) => writeJSON(NOTES_PATH, data));
ipcMain.handle("load-notes", () => readJSON(NOTES_PATH, { text: "" }));

// Terminal logging
const LOG_DIR = path.join(app.getPath("userData"), "logs");
ipcMain.on("log-append", (_, paneId, data) => {
  try {
    if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });
    const logFile = path.join(LOG_DIR, `terminal-${paneId}.log`);
    fs.appendFileSync(logFile, data);
  } catch {}
});
ipcMain.handle("get-log-path", (_, paneId) => {
  return path.join(LOG_DIR, `terminal-${paneId}.log`);
});

// Docker containers
ipcMain.handle("docker-ps", async () => {
  try {
    const result = execFileSync("docker", ["ps", "--format", "{{.ID}}\t{{.Names}}\t{{.Image}}\t{{.Status}}\t{{.Ports}}"], {
      encoding: "utf8", timeout: 5000, stdio: ["pipe", "pipe", "pipe"]
    }).trim();
    if (!result) return [];
    return result.split("\n").map(line => {
      const [id, name, image, status, ports] = line.split("\t");
      return { id, name, image, status, ports: ports || "" };
    });
  } catch { return []; }
});

ipcMain.handle("docker-ps-all", async () => {
  try {
    const result = execFileSync("docker", ["ps", "-a", "--format", "{{.ID}}\t{{.Names}}\t{{.Image}}\t{{.Status}}"], {
      encoding: "utf8", timeout: 5000, stdio: ["pipe", "pipe", "pipe"]
    }).trim();
    if (!result) return [];
    return result.split("\n").map(line => {
      const [id, name, image, status] = line.split("\t");
      return { id, name, image, status };
    });
  } catch { return []; }
});

// Environment variables for a terminal
ipcMain.handle("get-terminal-env", async (_, id) => {
  // Return process.env (the pty inherits it)
  const envPairs = [];
  for (const [k, v] of Object.entries(process.env)) {
    envPairs.push({ key: k, value: v });
  }
  return envPairs.sort((a, b) => a.key.localeCompare(b.key));
});

// File preview
ipcMain.handle("read-file", async (_, filePath, maxBytes) => {
  try {
    if (typeof filePath !== "string") return { error: "Invalid file path" };
    const resolved = sanitizePath(filePath);
    if (!resolved) return { error: "Invalid file path" };
    if (!resolved.startsWith(os.homedir()) && !resolved.startsWith('/tmp') && !resolved.startsWith(os.tmpdir())) {
      return { error: "Access denied: path outside allowed directories" };
    }
    if (maxBytes !== undefined && (typeof maxBytes !== "number" || maxBytes <= 0 || maxBytes > 10 * 1024 * 1024)) {
      return { error: "Invalid maxBytes (must be 1 to 10MB)" };
    }
    const stat = fs.statSync(resolved);
    if (stat.isDirectory()) return { error: "Is a directory", isDir: true };
    const limit = maxBytes || 50000;
    if (stat.size > limit) {
      const buf = Buffer.alloc(limit);
      let fd;
      try {
        fd = fs.openSync(resolved, "r");
        fs.readSync(fd, buf, 0, limit, 0);
      } finally {
        if (fd !== undefined) fs.closeSync(fd);
      }
      return { content: buf.toString("utf8"), truncated: true, size: stat.size };
    }
    return { content: fs.readFileSync(resolved, "utf8"), truncated: false, size: stat.size };
  } catch (e) { return { error: e.message }; }
});

// Directory bookmarks
const BOOKMARKS_PATH = path.join(app.getPath("userData"), "bookmarks.json");
ipcMain.on("save-bookmarks", (_, data) => writeJSON(BOOKMARKS_PATH, data));
ipcMain.handle("load-bookmarks", () => readJSON(BOOKMARKS_PATH, []));

// Projects
const PROJECTS_DATA_PATH = path.join(app.getPath("userData"), "projects.json");
ipcMain.on("save-projects", (_, data) => writeJSON(PROJECTS_DATA_PATH, data));
ipcMain.handle("load-projects", () => readJSON(PROJECTS_DATA_PATH, null));

// Get child process tree for smart naming
ipcMain.handle("get-process-tree", async (_, id) => {
  const p = ptys.get(id);
  if (!p) return null;
  try {
    const pid = String(p.pid);
    if (process.platform === "win32") {
      try {
        const result = execFileSync("powershell", ["-Command",
          `Get-CimInstance Win32_Process -Filter "ParentProcessId=${pid}" | Select-Object ProcessId,Name,CommandLine | ConvertTo-Json`
        ], { encoding: "utf8", timeout: 2000, stdio: ["pipe", "pipe", "pipe"] }).trim();
        const procs = JSON.parse(result);
        const proc = Array.isArray(procs) ? procs[procs.length - 1] : procs;
        if (proc) return { pid: String(proc.ProcessId), comm: proc.Name, args: proc.CommandLine || "" };
        return null;
      } catch { return null; }
    }
    const childPids = execFileSync("pgrep", ["-P", pid], {
      encoding: "utf8", timeout: 2000, stdio: ["pipe", "pipe", "pipe"]
    }).trim().split("\n").filter(Boolean);
    if (childPids.length === 0) return null;
    const result = execFileSync("ps", ["-o", "pid=,comm=,args=", "-p", childPids.join(",")], {
      encoding: "utf8", timeout: 2000, stdio: ["pipe", "pipe", "pipe"]
    }).trim();
    if (!result) return null;
    const lines = result.split("\n").map(l => l.trim()).filter(Boolean);
    if (lines.length === 0) return null;
    const last = lines[lines.length - 1];
    const parts = last.trim().split(/\s+/);
    return { pid: parts[0], comm: parts[1], args: parts.slice(2).join(" ") };
  } catch { return null; }
});

// ============================================================
// SSH REMOTE CONNECTION (password-based via SSH_ASKPASS)
// ============================================================

// Helper: create a temporary SSH_ASKPASS script that echoes the password
function createAskpassScript(password) {
  const tmpDir = app.getPath("temp");
  const scriptPath = path.join(tmpDir, `terminator-askpass-${Date.now()}.sh`);
  // Escape single quotes in password for the shell script
  const escaped = password.replace(/'/g, "'\\''");
  fs.writeFileSync(scriptPath, `#!/bin/sh\necho '${escaped}'\n`, { mode: 0o700 });
  return scriptPath;
}

function cleanupAskpass(scriptPath) {
  try { fs.unlinkSync(scriptPath); } catch {}
}

function buildSshEnv(password) {
  const askpassScript = createAskpassScript(password);
  const env = {
    ...process.env,
    SSH_ASKPASS: askpassScript,
    SSH_ASKPASS_REQUIRE: "force",
    DISPLAY: "terminator:0",
  };
  return { env, askpassScript };
}

ipcMain.handle("ssh-remote-list", async (_, { host, user, port, password, remotePath }) => {
  if (!isValidHost(host)) return { error: "Invalid hostname" };
  if (!isValidUser(user)) return { error: "Invalid username" };
  if (port && !isValidPort(port)) return { error: "Invalid port" };
  const sshArgs = [
    "-o", "ConnectTimeout=10",
    "-o", "StrictHostKeyChecking=accept-new",
  ];
  // Only restrict to password auth if a password was explicitly provided
  if (password) {
    sshArgs.push("-o", "PreferredAuthentications=password,keyboard-interactive");
    sshArgs.push("-o", "PubkeyAuthentication=no");
  }
  if (port && port !== 22) sshArgs.push("-p", String(port));
  sshArgs.push(`${user}@${host}`);

  // Node one-liner that queries the remote Terminator socket
  // Exits immediately after receiving data to avoid timeout
  const probe = `node -e '
    const net=require("net"),path=require("path"),os=require("os"),fs=require("fs");
    const SOCK=path.join(os.homedir(),".terminator","terminator.sock");
    if(!fs.existsSync(SOCK)){console.log(JSON.stringify({error:"Terminator is not running on this host"}));process.exit(0)}
    const c=net.createConnection(SOCK,()=>{c.write(JSON.stringify({action:"list"})+"\\n")});
    let d="";
    c.on("data",ch=>{d+=ch.toString();try{JSON.parse(d);console.log(d);process.exit(0)}catch{}});
    c.on("end",()=>{console.log(d||JSON.stringify({error:"empty response"}));process.exit(0)});
    c.on("error",e=>{console.log(JSON.stringify({error:e.message}));process.exit(0)});
    setTimeout(()=>{if(d){console.log(d);process.exit(0)}console.log(JSON.stringify({error:"timeout"}));process.exit(1)},8000);
  '`;
  sshArgs.push(probe);

  const { env, askpassScript } = buildSshEnv(password);

  try {
    const { execFile } = require("child_process");
    const result = await new Promise((resolve, reject) => {
      execFile("ssh", sshArgs, { encoding: "utf8", timeout: 20000, env }, (err, stdout, stderr) => {
        cleanupAskpass(askpassScript);
        // Try to parse stdout even on error (probe may have printed data before exit)
        if (stdout && stdout.trim()) {
          try { const parsed = JSON.parse(stdout.trim()); resolve(JSON.stringify(parsed)); } catch {}
        }
        if (err) {
          const msg = stderr || err.message;
          if (msg.includes("Permission denied")) reject(new Error("Authentication failed. Check your username and password."));
          else if (msg.includes("Connection refused")) reject(new Error("Connection refused. Is SSH running on the remote?"));
          else if (msg.includes("Connection timed out") || msg.includes("timed out")) reject(new Error("Connection timed out. Check the host and port."));
          else if (msg.includes("Could not resolve")) reject(new Error("Could not resolve hostname: " + host));
          else if (msg.includes("node: command not found") || msg.includes("node: not found")) reject(new Error("Node.js is not installed on the remote host."));
          else reject(new Error(msg.trim() || "SSH connection failed"));
          return;
        }
        resolve(stdout.trim());
      });
    });
    return JSON.parse(result);
  } catch (err) {
    cleanupAskpass(askpassScript);
    return { error: err.message };
  }
});

ipcMain.handle("ssh-remote-open-all", async (_, { host, user, port, password, sessions }) => {
  if (!isValidHost(host)) return { error: "Invalid hostname" };
  if (!isValidUser(user)) return { error: "Invalid username" };
  if (port && !isValidPort(port)) return { error: "Invalid port" };
  if (!Array.isArray(sessions)) return { error: "Invalid sessions" };
  const opened = [];
  for (const session of sessions) {
    // Build SSH command for the local terminal to run
    // The user will type the password in each terminal, or we use sshpass if available
    let sshCmd = "ssh -t";
    if (port && port !== 22) sshCmd += ` -p ${port}`;
    sshCmd += ` ${user}@${host}`;

    // If the remote session has a cwd, cd into it
    const cwd = session.cwd ? session.cwd.replace(/^~/, "$HOME") : "";
    if (cwd) {
      sshCmd += ` "cd ${cwd.replace(/"/g, '\\"')} && exec \\$SHELL -l"`;
    }

    // Create local terminal
    const safeName = JSON.stringify(`${user}@${host}: ${session.name}`);
    const id = await mainWindow.webContents.executeJavaScript(`
      (async function() {
        const id = await window.__createPane();
        const pane = (window.__panes || new Map()).get(id);
        if (pane) {
          pane.customName = ${safeName};
          pane._userRenamed = true;
          if (pane.titleEl) pane.titleEl.textContent = ${safeName};
        }
        return id;
      })()
    `);

    const p = ptys.get(id);
    if (p) {
      // Write the SSH command
      setTimeout(() => {
        p.write(sshCmd + "\r");
        // If password provided, wait for the password prompt and send it
        if (password) {
          let sent = false;
          const onData = p.onData((data) => {
            if (sent) return;
            if (data.toLowerCase().includes("password")) {
              sent = true;
              setTimeout(() => p.write(password + "\r"), 100);
              onData.dispose();
            }
          });
          // Timeout: stop listening after 10s
          setTimeout(() => { if (!sent) onData.dispose(); }, 10000);
        }
      }, 300);
      opened.push({ id, localId: id, remoteName: session.name, remoteId: session.id });
    }
  }
  return { opened };
});

// AI Chat
ipcMain.handle("ai-chat", async (_, params) => {
  const { messages, apiKey } = params;
  if (!apiKey) return { error: "No API key configured" };
  try {
    const response = await electronNet.fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 2048,
        system: "You are a helpful terminal assistant in Terminator. Help with commands, errors, debugging. Be concise. Use code blocks for commands.",
        messages,
      }),
    });
    if (!response.ok) { const errText = await response.text(); return { error: `API error (${response.status}): ${errText}` }; }
    const data = await response.json();
    return { text: data.content?.[0]?.text || "" };
  } catch (e) { return { error: e.message }; }
});

// Port Manager
ipcMain.handle("list-ports", async () => {
  try {
    const result = execSync("lsof -iTCP -sTCP:LISTEN -nP 2>/dev/null | tail -n +2", { encoding: "utf8", timeout: 5000 }).trim();
    if (!result) return [];
    const seen = new Set();
    return result.split("\n").filter(Boolean).map(line => {
      const parts = line.trim().split(/\s+/);
      const process = parts[0] || "", pid = parts[1] || "", protocol = parts[7] || "TCP", nameField = parts[8] || "";
      const portMatch = nameField.match(/:(\d+)$/);
      const port = portMatch ? portMatch[1] : "";
      const key = `${pid}:${port}`;
      if (seen.has(key)) return null;
      seen.add(key);
      return { port, pid, process, protocol };
    }).filter(Boolean);
  } catch { return []; }
});
ipcMain.handle("kill-port", async (_, pid) => {
  const n = parseInt(pid, 10);
  if (!Number.isInteger(n) || n <= 0) return false;
  try { execSync(`kill -9 ${n}`, { timeout: 3000 }); return true; } catch { return false; }
});

// Per-pane process stats
ipcMain.handle("get-pane-stats", async (_, id) => {
  const p = ptys.get(id);
  if (!p) return null;
  try {
    let targetPid;
    try { targetPid = execSync(`pgrep -P ${p.pid} 2>/dev/null | head -1`, { encoding: "utf8", timeout: 2000 }).trim() || p.pid; } catch { targetPid = p.pid; }
    const result = execSync(`ps -p ${targetPid} -o %cpu,%mem 2>/dev/null | tail -1`, { encoding: "utf8", timeout: 2000 }).trim();
    const parts = result.split(/\s+/).map(s => parseFloat(s));
    if (parts.length >= 2 && !isNaN(parts[0])) return { cpu: parts[0], memory: parts[1], pid: targetPid };
    return null;
  } catch { return null; }
});

// Pipeline Runner
const PIPELINES_PATH = path.join(app.getPath("userData"), "pipelines.json");
const CMD_BOOKMARKS_PATH = path.join(app.getPath("userData"), "cmd-bookmarks.json");
ipcMain.on("save-pipelines", (_, data) => writeJSON(PIPELINES_PATH, data));
ipcMain.handle("load-pipelines", () => readJSON(PIPELINES_PATH, []));
ipcMain.handle("exec-pipeline-step", async (_, { command, cwd }) => {
  if (typeof command !== "string" || command.trim().length === 0) {
    return { code: 1, stdout: "", stderr: "Invalid command" };
  }
  const resolvedCwd = cwd ? sanitizePath(cwd) : os.homedir();
  if (!resolvedCwd) return { code: 1, stdout: "", stderr: "Invalid working directory" };
  return new Promise((resolve) => {
    const proc = spawn("sh", ["-c", command], { cwd: resolvedCwd });
    let stdout = "", stderr = "";
    proc.stdout.on("data", d => stdout += d);
    proc.stderr.on("data", d => stderr += d);
    proc.on("close", code => resolve({ code, stdout: stdout.slice(-2000), stderr: stderr.slice(-2000) }));
    proc.on("error", err => resolve({ code: 1, stdout: "", stderr: err.message }));
    setTimeout(() => { proc.kill(); resolve({ code: 1, stdout, stderr: stderr + "\nTimeout after 60s" }); }, 60000);
  });
});
ipcMain.on("save-cmd-bookmarks", (_, data) => writeJSON(CMD_BOOKMARKS_PATH, data));
ipcMain.handle("load-cmd-bookmarks", () => readJSON(CMD_BOOKMARKS_PATH, []));

// Tailscale Device Dashboard
ipcMain.handle("tailscale-status", async () => {
  try {
    const raw = execSync("tailscale status --json 2>/dev/null", { encoding: "utf8", timeout: 10000 });
    const status = JSON.parse(raw);
    const devices = [];
    if (status.Self) {
      const s = status.Self;
      devices.push({ name: s.HostName || s.DNSName || "self", ip: s.TailscaleIPs?.[0] || "", online: s.Online !== false, os: s.OS || "", hostname: s.DNSName || s.HostName || "", isSelf: true });
    }
    for (const [, peer] of Object.entries(status.Peer || {})) {
      devices.push({ name: peer.HostName || peer.DNSName || "unknown", ip: peer.TailscaleIPs?.[0] || "", online: peer.Online === true, os: peer.OS || "", hostname: peer.DNSName || peer.HostName || "", isSelf: false });
    }
    return { ok: true, devices };
  } catch (e) {
    const msg = e.message || "";
    if (msg.includes("ENOENT") || msg.includes("not found")) return { ok: false, error: "Tailscale not installed" };
    if (msg.includes("NeedsLogin")) return { ok: false, error: "Tailscale not logged in. Run: tailscale login" };
    return { ok: false, error: "Tailscale error: " + msg };
  }
});
ipcMain.handle("tailscale-ssh", async (_, { ip, user }) => ({ ip, user }));

// Cross-Device Sync
const SYNC_PORT = 7685;
let syncServer = null;
ipcMain.handle("sync-export", async () => {
  try {
    return { ok: true, data: { settings: readJSON(CONFIG_PATH, {}), snippets: readJSON(SNIPPETS_PATH, []), profiles: readJSON(PROFILES_PATH, []), bookmarks: readJSON(path.join(app.getPath("userData"), "bookmarks.json"), []), projects: readJSON(path.join(app.getPath("userData"), "projects.json"), []), recents: readJSON(RECENTS_PATH, []), sshBookmarks: readJSON(path.join(app.getPath("userData"), "ssh-bookmarks.json"), []), exportedAt: new Date().toISOString(), hostname: os.hostname() } };
  } catch (e) { return { ok: false, error: e.message }; }
});
ipcMain.handle("sync-import", async (_, data) => {
  try {
    if (!data || typeof data !== "object") return { ok: false, error: "Invalid sync data" };
    if (data.settings) { const current = readJSON(CONFIG_PATH, {}); for (const [k, v] of Object.entries(data.settings)) { if (!(k in current)) current[k] = v; } writeJSON(CONFIG_PATH, current); }
    function mergeArr(fp, incoming, fb) { if (!Array.isArray(incoming) || !incoming.length) return; const cur = readJSON(fp, fb); const names = new Set(cur.map(i => i.name || i.label || i.host || JSON.stringify(i))); for (const item of incoming) { const key = item.name || item.label || item.host || JSON.stringify(item); if (!names.has(key)) { cur.push(item); names.add(key); } } writeJSON(fp, cur); }
    mergeArr(SNIPPETS_PATH, data.snippets, []); mergeArr(PROFILES_PATH, data.profiles, []); mergeArr(path.join(app.getPath("userData"), "bookmarks.json"), data.bookmarks, []); mergeArr(path.join(app.getPath("userData"), "ssh-bookmarks.json"), data.sshBookmarks, []);
    if (Array.isArray(data.recents)) { const cur = readJSON(RECENTS_PATH, []); const paths = new Set(cur.map(r => r.path || r)); for (const r of data.recents) { const p = r.path || r; if (!paths.has(p)) { cur.push(r); paths.add(p); } } writeJSON(RECENTS_PATH, cur); }
    return { ok: true, message: "Imported successfully" };
  } catch (e) { return { ok: false, error: e.message }; }
});
ipcMain.handle("sync-push", async (_, { targetIp }) => {
  try {
    const exportData = { settings: readJSON(CONFIG_PATH, {}), snippets: readJSON(SNIPPETS_PATH, []), profiles: readJSON(PROFILES_PATH, []), bookmarks: readJSON(path.join(app.getPath("userData"), "bookmarks.json"), []), recents: readJSON(RECENTS_PATH, []), sshBookmarks: readJSON(path.join(app.getPath("userData"), "ssh-bookmarks.json"), []), hostname: os.hostname() };
    return new Promise((resolve) => {
      const client = new net.Socket(); let responded = false;
      client.setTimeout(10000);
      client.connect(SYNC_PORT, targetIp, () => { client.write(JSON.stringify(exportData)); client.end(); });
      client.on("data", d => { if (!responded) { responded = true; try { resolve(JSON.parse(d.toString())); } catch { resolve({ ok: true }); } } });
      client.on("end", () => { if (!responded) { responded = true; resolve({ ok: true }); } });
      client.on("error", err => { if (!responded) { responded = true; resolve({ ok: false, error: err.message }); } });
      client.on("timeout", () => { client.destroy(); if (!responded) { responded = true; resolve({ ok: false, error: "Timeout" }); } });
    });
  } catch (e) { return { ok: false, error: e.message }; }
});
ipcMain.handle("sync-server-start", async () => {
  if (syncServer) return { ok: true };
  try {
    syncServer = net.createServer((socket) => {
      let chunks = [];
      socket.on("data", c => chunks.push(c));
      socket.on("end", () => {
        try {
          const data = JSON.parse(Buffer.concat(chunks).toString());
          // Auto-import
          if (data.settings) { const cur = readJSON(CONFIG_PATH, {}); for (const [k, v] of Object.entries(data.settings)) { if (!(k in cur)) cur[k] = v; } writeJSON(CONFIG_PATH, cur); }
          function mergeArr(fp, incoming) { if (!Array.isArray(incoming) || !incoming.length) return; const cur = readJSON(fp, []); const names = new Set(cur.map(i => i.name || i.label || i.host || JSON.stringify(i))); for (const item of incoming) { const key = item.name || item.label || item.host || JSON.stringify(item); if (!names.has(key)) { cur.push(item); names.add(key); } } writeJSON(fp, cur); }
          mergeArr(SNIPPETS_PATH, data.snippets); mergeArr(PROFILES_PATH, data.profiles); mergeArr(path.join(app.getPath("userData"), "bookmarks.json"), data.bookmarks);
          socket.write(JSON.stringify({ ok: true }));
          if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send("sync-received", data.hostname || "unknown");
        } catch { try { socket.write(JSON.stringify({ ok: false })); } catch {} }
      });
      socket.on("error", () => {});
    });
    syncServer.on("error", () => { syncServer = null; });
    syncServer.listen(SYNC_PORT, "0.0.0.0");
    return { ok: true };
  } catch (e) { return { ok: false, error: e.message }; }
});

// Settings
const SETTINGS_PATH = path.join(app.getPath("userData"), "settings.json");
ipcMain.on("save-settings", (_, data) => writeJSON(SETTINGS_PATH, data));
ipcMain.handle("load-settings", () => readJSON(SETTINGS_PATH, {
  theme: 0,
  fontSize: 13,
  fontFamily: '"SF Mono", "Menlo", "Monaco", "Courier New", monospace',
  cursorStyle: "block",
  cursorBlink: true,
  copyOnSelect: true,
  scrollback: 10000,
  shell: "",
  defaultCwd: "",
  confirmClose: true,
  autoSaveSession: true,
  aiAutocomplete: false,
  aiApiKey: "",
  aiProvider: "anthropic",
}));

// AI Autocomplete
ipcMain.handle("ai-complete", async (_, { prompt, apiKey, provider }) => {
  if (!apiKey) return { error: "No API key configured" };
  try {
    if (provider === "anthropic" || !provider) {
      const res = await electronNet.fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: "claude-haiku-4-5-20251001",
          max_tokens: 200,
          temperature: 0,
          system: `You are a terminal autocomplete engine like GitHub Copilot for the shell. Given a partial command with context, predict the FULL complete command the user most likely wants to run.

OUTPUT FORMAT: Output ONLY the full command. No explanation. No markdown. No backticks. No "$ " prefix. Just the raw command.

IMPORTANT:
- Always include the full command with ALL arguments, flags, paths, and values.
- Be specific and contextual. Use the working directory, git state, recent commands, and terminal output to predict what the user wants.
- Suggest complete, ready-to-run commands, not just one word.

Examples of GOOD completions:
- "git c" → "git commit -m \\"feat: add new feature\\""
- "docker" → "docker compose up -d"
- "npm r" → "npm run dev"
- "ssh " → "ssh user@192.168.1.100"
- "curl" → "curl -X GET http://localhost:3000/api/health"
- "find" → "find . -name \\"*.js\\" -type f"
- "grep" → "grep -rn \\"TODO\\" src/"
- "git p" with dirty state → "git push origin main"
- "cd " → "cd src/components"

If you truly cannot suggest anything useful, repeat the input exactly as-is.`,
          messages: [{ role: "user", content: prompt }],
        }),
      });
      if (!res.ok) {
        const body = await res.text();
        return { error: `API ${res.status}: ${body.slice(0, 200)}` };
      }
      const json = await res.json();
      let text = json.content?.[0]?.text || "";
      // Take first line, strip wrapping
      text = text.trimStart().split("\n")[0].trim();
      text = text.replace(/^```\w*\s*/, "").replace(/```$/, "").trim();
      text = text.replace(/^[`'"]+|[`'"]+$/g, "");
      text = text.replace(/^\$\s+/, ""); // strip leading "$ "
      // Reject if it's clearly prose (multiple sentences, contains "I ", "you ", etc.)
      if (/^(I |You |To |This |That |Note|Sorry|Here|If you|The command)/i.test(text)) return { completion: "" };
      if (text.length > 120) return { completion: "" };
      return { completion: text };
    }
    return { error: "Unknown provider" };
  } catch (err) {
    return { error: err.message };
  }
});
ipcMain.handle("get-app-version", () => app.getVersion());
ipcMain.handle("get-default-shell", () => {
  if (process.platform === "win32") return process.env.COMSPEC || "powershell.exe";
  return process.env.SHELL || "/bin/zsh";
});

ipcMain.on("toggle-fullscreen", () => {
  if (mainWindow) mainWindow.setFullScreen(!mainWindow.isFullScreen());
});

ipcMain.on("quit-app", () => {
  for (const [, p] of ptys) p.kill();
  app.quit();
});

// ============================================================
// PLUGIN SYSTEM
// ============================================================
const PLUGINS_DIR = path.join(os.homedir(), ".terminator", "plugins");

// Ensure plugins directory exists on startup
try {
  fs.mkdirSync(PLUGINS_DIR, { recursive: true });
} catch {}

function loadPlugins() {
  const plugins = [];
  try {
    const entries = fs.readdirSync(PLUGINS_DIR, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const manifestPath = path.join(PLUGINS_DIR, entry.name, "plugin.json");
      try {
        const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
        if (!manifest.name || !manifest.type || !manifest.main) continue;
        if (!["theme", "command", "statusbar", "extension"].includes(manifest.type)) continue;
        plugins.push({ dir: entry.name, manifest });
      } catch {
        // Skip plugins with invalid or missing manifests
      }
    }
  } catch {
    // Plugins directory unreadable
  }
  return plugins;
}

ipcMain.handle("load-plugins", () => {
  return loadPlugins();
});

ipcMain.handle("get-plugin-code", (_, pluginName) => {
  if (typeof pluginName !== "string" || pluginName.includes("..") || pluginName.includes("/") || pluginName.includes("\\")) {
    return { error: "Invalid plugin name" };
  }
  const plugins = loadPlugins();
  const plugin = plugins.find(p => p.manifest.name === pluginName);
  if (!plugin) return { error: "Plugin not found" };
  const codePath = path.join(PLUGINS_DIR, plugin.dir, plugin.manifest.main);
  try {
    const code = fs.readFileSync(codePath, "utf8");
    return { code };
  } catch {
    return { error: "Could not read plugin code" };
  }
});

// Plugin store: list available (bundled) plugins
ipcMain.handle("list-available-plugins", () => {
  const bundledDir = path.join(__dirname, "examples", "plugins");
  const available = [];
  try {
    const entries = fs.readdirSync(bundledDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const manifestPath = path.join(bundledDir, entry.name, "plugin.json");
      try {
        const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
        if (!manifest.name || !manifest.type || !manifest.main) continue;
        const installed = fs.existsSync(path.join(PLUGINS_DIR, entry.name, "plugin.json"));
        available.push({ dir: entry.name, manifest, installed });
      } catch {}
    }
  } catch {}
  return available;
});

// Install plugin: copy from bundled examples to user plugins dir
ipcMain.handle("install-plugin", (_, pluginDir) => {
  if (typeof pluginDir !== "string" || pluginDir.includes("..") || pluginDir.includes("/") || pluginDir.includes("\\")) {
    return { error: "Invalid plugin name" };
  }
  const src = path.join(__dirname, "examples", "plugins", pluginDir);
  const dest = path.join(PLUGINS_DIR, pluginDir);
  try {
    if (!fs.existsSync(src)) return { error: "Plugin not found" };
    fs.cpSync(src, dest, { recursive: true });
    return { ok: true };
  } catch (e) {
    return { error: e.message };
  }
});

// Uninstall plugin: remove from user plugins dir
ipcMain.handle("uninstall-plugin", (_, pluginDir) => {
  if (typeof pluginDir !== "string" || pluginDir.includes("..") || pluginDir.includes("/") || pluginDir.includes("\\")) {
    return { error: "Invalid plugin name" };
  }
  const dest = path.join(PLUGINS_DIR, pluginDir);
  try {
    if (!fs.existsSync(dest)) return { error: "Plugin not found" };
    fs.rmSync(dest, { recursive: true, force: true });
    return { ok: true };
  } catch (e) {
    return { error: e.message };
  }
});

