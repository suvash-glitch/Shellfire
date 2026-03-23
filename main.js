const { app, BrowserWindow, ipcMain, Notification, shell, net: electronNet, screen } = require("electron");
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
  // Block traversal outside home directory or /tmp
  const home = os.homedir();
  const tmp = os.tmpdir();
  if (!resolved.startsWith(home) && !resolved.startsWith(tmp) && !resolved.startsWith("/tmp")) return null;
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
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch (err) {
    if (err.code !== 'ENOENT') log('error', `Failed to read ${path.basename(p)}:`, err.message);
    return fallback;
  }
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

  // Set CSP BEFORE loading any content
  mainWindow.webContents.session.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': ["default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; font-src 'self'; connect-src *"]
      }
    });
  });

  mainWindow.loadFile("index.html");
  mainWindow.maximize();

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
    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = true;

    autoUpdater.on("checking-for-update", () => {
      log("info", "Checking for update...");
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send("update-status", { status: "checking" });
      }
    });

    autoUpdater.on("update-available", (info) => {
      log("info", `Update available: v${info.version}`);
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send("update-status", { status: "available", version: info.version });
      }
    });

    autoUpdater.on("download-progress", (progress) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send("update-status", {
          status: "downloading",
          percent: Math.round(progress.percent),
        });
      }
    });

    autoUpdater.on("update-downloaded", (info) => {
      log("info", `Update downloaded: v${info.version}`);
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send("update-status", { status: "downloaded", version: info.version });
      }
    });

    autoUpdater.on("update-not-available", () => {
      log("info", "No update available");
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send("update-status", { status: "up-to-date" });
      }
    });

    autoUpdater.on("error", (err) => {
      log("error", "Auto-update error:", err.message);
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send("update-status", { status: "error", message: err.message });
      }
    });

    autoUpdater.checkForUpdates().catch(() => {});
    // Check for updates every 4 hours
    setInterval(() => {
      autoUpdater.checkForUpdates().catch(() => {});
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

async function getCwdForPty(id) {
  const p = ptys.get(id);
  if (!p) return null;
  try {
    const pid = String(p.pid);
    if (process.platform === "win32") return null;
    const result = await execFileAsync("lsof", ["-p", pid, "-Fn"]);
    const lines = result.split("\n");
    for (let i = 0; i < lines.length; i++) {
      if (lines[i] === "fcwd" && i + 1 < lines.length && lines[i + 1].startsWith("n")) {
        return lines[i + 1].slice(1);
      }
    }
    return null;
  } catch { return null; }
}

async function getProcessForPty(id) {
  const p = ptys.get(id);
  if (!p) return null;
  try {
    const pid = String(p.pid);
    if (process.platform === "win32") return null;
    let childPid;
    try {
      childPid = (await execFileAsync("pgrep", ["-P", pid])).split("\n")[0];
    } catch {}
    const targetPid = childPid || pid;
    const result = await execFileAsync("ps", ["-o", "comm=", "-p", targetPid]);
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

ipcMain.handle("download-update", async () => {
  if (!autoUpdater || !app.isPackaged) return { ok: false };
  try {
    await autoUpdater.downloadUpdate();
    return { ok: true };
  } catch (err) { return { ok: false, error: err.message }; }
});

ipcMain.handle("install-update", () => {
  if (!autoUpdater || !app.isPackaged) return;
  autoUpdater.quitAndInstall();
});

// Create terminal with optional cwd
ipcMain.handle("create-terminal", (_, cwd, restoreCmd) => {
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

  // Re-launch a saved command after shell initializes (session restore)
  if (restoreCmd && typeof restoreCmd === "string") {
    setTimeout(() => {
      const p2 = ptys.get(id);
      if (p2) p2.write(restoreCmd + "\n");
    }, 500);
  }

  return id;
});

ipcMain.on("terminal-input", (_, id, data) => {
  if (typeof id !== "number" || typeof data !== "string") return;
  const p = ptys.get(id);
  if (p) p.write(data);
});

ipcMain.on("terminal-resize", (_, id, cols, rows) => {
  if (typeof id !== "number") return;
  const c = Number(cols), r = Number(rows);
  if (!Number.isInteger(c) || !Number.isInteger(r) || c < 1 || r < 1 || c > 500 || r > 500) return;
  const p = ptys.get(id);
  if (p) p.resize(c, r);
});

ipcMain.on("terminal-kill", (_, id) => {
  if (typeof id !== "number") return;
  const p = ptys.get(id);
  if (p) { p.kill(); ptys.delete(id); }
});

ipcMain.on("terminal-broadcast", (_, ids, data) => {
  if (!Array.isArray(ids) || typeof data !== "string") return;
  for (const id of ids) {
    if (typeof id !== "number") continue;
    const p = ptys.get(id);
    if (p) p.write(data);
  }
});

// Get cwd for a terminal (async to avoid blocking event loop)
ipcMain.handle("get-terminal-cwd", async (_, id) => {
  const p = ptys.get(id);
  if (!p) return null;
  try {
    const pid = String(p.pid);
    if (process.platform === "win32") {
      try {
        const { execFile: execFileCb } = require("child_process");
        const result = await new Promise((resolve, reject) => {
          execFileCb("powershell", ["-Command",
            `(Get-CimInstance Win32_Process -Filter "ProcessId=${parseInt(pid, 10)}").ExecutablePath; ` +
            `$wmiObj = (Get-CimInstance Win32_Process -Filter "ProcessId=${parseInt(pid, 10)}"); ` +
            `Invoke-CimMethod -InputObject $wmiObj -MethodName GetOwner | Out-Null; ` +
            `[System.IO.Directory]::GetCurrentDirectory()`
          ], { encoding: "utf8", timeout: 2000 }, (err, stdout) => {
            if (err) reject(err); else resolve(stdout.trim());
          });
        });
        return result || null;
      } catch { return null; }
    }
    const { execFile: execFileCb } = require("child_process");
    const result = await new Promise((resolve, reject) => {
      execFileCb("lsof", ["-p", pid, "-Fn"], {
        encoding: "utf8", timeout: 2000
      }, (err, stdout) => {
        if (err) reject(err); else resolve(stdout.trim());
      });
    });
    const lines = result.split("\n");
    for (let i = 0; i < lines.length; i++) {
      if (lines[i] === "fcwd" && i + 1 < lines.length && lines[i + 1].startsWith("n")) {
        return lines[i + 1].slice(1);
      }
    }
    return null;
  } catch { return null; }
});

// Get process name for a terminal (async to avoid blocking event loop)
ipcMain.handle("get-terminal-process", async (_, id) => {
  const p = ptys.get(id);
  if (!p) return null;
  const { execFile: execFileCb } = require("child_process");
  const execFileAsync = (cmd, args, opts) => new Promise((resolve, reject) => {
    execFileCb(cmd, args, { encoding: "utf8", timeout: 2000, ...opts }, (err, stdout) => {
      if (err) reject(err); else resolve(stdout.trim());
    });
  });
  try {
    const pid = String(p.pid);
    if (process.platform === "win32") {
      try {
        const result = await execFileAsync("powershell", ["-Command",
          `(Get-CimInstance Win32_Process -Filter "ParentProcessId=${parseInt(pid, 10)}" | Select-Object -First 1).Name`
        ]);
        return result || null;
      } catch { return null; }
    }
    let childPid;
    try {
      childPid = (await execFileAsync("pgrep", ["-P", pid])).split("\n")[0];
    } catch {}
    const targetPid = childPid || pid;
    const result = await execFileAsync("ps", ["-o", "comm=", "-p", targetPid]);
    return result.split("/").pop() || null;
  } catch { return null; }
});

// Async exec helper (avoids blocking event loop)
const execFileAsync = (cmd, args, opts) => {
  const { execFile: execFileCb } = require("child_process");
  return new Promise((resolve, reject) => {
    execFileCb(cmd, args, { encoding: "utf8", timeout: 2000, ...opts }, (err, stdout) => {
      if (err) reject(err); else resolve(stdout.trim());
    });
  });
};

// Get git branch for a directory
ipcMain.handle("get-git-branch", async (_, dirPath) => {
  if (!dirPath) return null;
  const safePath = sanitizePath(dirPath);
  if (!safePath) return null;
  try {
    const branch = await execFileAsync("git", ["-C", safePath, "rev-parse", "--abbrev-ref", "HEAD"]);
    return branch || null;
  } catch { return null; }
});

// Get git status (dirty/clean) for a directory
ipcMain.handle("get-git-status", async (_, dirPath) => {
  if (!dirPath) return null;
  const safePath = sanitizePath(dirPath);
  if (!safePath) return null;
  try {
    const status = await execFileAsync("git", ["-C", safePath, "status", "--porcelain"]);
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
async function getCrontab() {
  try {
    return await execFileAsync("crontab", ["-l"]);
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
    const raw = await getCrontab();
    return raw.trim().split("\n").filter(l => l && !l.startsWith("#")).map((line, i) => ({ id: i, line, enabled: true }));
  } catch { return []; }
});

ipcMain.handle("cron-add", async (_, cronLine) => {
  try {
    const existing = (await getCrontab()).trim();
    const newCron = existing ? existing + "\n" + cronLine : cronLine;
    setCrontab(newCron);
    return true;
  } catch { return false; }
});

ipcMain.handle("cron-remove", async (_, index) => {
  try {
    const lines = (await getCrontab()).trim().split("\n");
    // Build a list tracking original line positions for active (non-comment) lines
    let activeIdx = 0;
    const newLines = [];
    for (const line of lines) {
      if (!line || line.startsWith("#")) {
        newLines.push(line);
      } else {
        if (activeIdx !== index) newLines.push(line);
        activeIdx++;
      }
    }
    const newCron = newLines.join("\n");
    if (newCron.trim()) {
      setCrontab(newCron);
    } else {
      try { execFileSync("crontab", ["-r"], { timeout: 3000, stdio: ["pipe", "pipe", "pipe"] }); } catch {}
    }
    return true;
  } catch { return false; }
});

// Fuzzy file finder (async)
ipcMain.handle("find-files", async (_, query, dirs) => {
  if (!query || typeof query !== "string" || !Array.isArray(dirs)) return [];
  // Validate directories
  const safeDirs = dirs.map(d => sanitizePath(d)).filter(Boolean);
  if (safeDirs.length === 0) return [];
  try {
    const args = [...safeDirs,
      "-maxdepth", "5", "-type", "f",
      "-not", "-path", "*/node_modules/*",
      "-not", "-path", "*/.git/*",
      "-not", "-path", "*/dist/*",
      "-not", "-path", "*/.next/*"];
    const result = await execFileAsync("find", args, {
      timeout: 5000, maxBuffer: 1024 * 1024
    });
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

// Export pipeline as shell script
ipcMain.handle("export-sh", async (_, content, suggestedName) => {
  const { dialog } = require("electron");
  const result = await dialog.showSaveDialog(mainWindow, {
    defaultPath: path.join(os.homedir(), "Desktop", suggestedName || "pipeline.sh"),
    filters: [{ name: "Shell Script", extensions: ["sh"] }],
  });
  if (!result.canceled && result.filePath) {
    fs.writeFileSync(result.filePath, content, { mode: 0o755 });
    return result.filePath;
  }
  return null;
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
    // Disk usage (async)
    let diskUsage = null;
    try {
      if (process.platform === "win32") {
        const result = await execFileAsync("powershell", ["-Command",
          "Get-PSDrive C | Select-Object Used,Free | ConvertTo-Json"
        ]);
        const info = JSON.parse(result);
        const usedGB = (info.Used / 1073741824).toFixed(0) + "G";
        const totalGB = ((info.Used + info.Free) / 1073741824).toFixed(0) + "G";
        const pct = Math.round(info.Used / (info.Used + info.Free) * 100);
        diskUsage = { used: usedGB, total: totalGB, percent: pct };
      } else {
        const dfResult = await execFileAsync("df", ["-h", "/"]);
        const df = dfResult.split("\n").pop().split(/\s+/);
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
  const p = ptys.get(id);
  if (!p) {
    // Fallback to parent env if PTY not found
    return Object.entries(process.env).map(([key, value]) => ({ key, value })).sort((a, b) => a.key.localeCompare(b.key));
  }
  // Try to read the child process's environment on macOS/Linux
  if (process.platform !== "win32") {
    try {
      const pid = String(p.pid);
      let childPid;
      try { childPid = (await execFileAsync("pgrep", ["-P", pid])).split("\n")[0]; } catch {}
      const targetPid = childPid || pid;
      const envData = await execFileAsync("ps", ["-p", targetPid, "-o", "command=", "-E"], { timeout: 3000 });
      // ps -E output is limited; fall back to /proc on Linux or parent env on macOS
      if (process.platform === "linux") {
        try {
          const envStr = fs.readFileSync(`/proc/${targetPid}/environ`, "utf8");
          const pairs = envStr.split("\0").filter(Boolean).map(entry => {
            const eq = entry.indexOf("=");
            return eq > 0 ? { key: entry.slice(0, eq), value: entry.slice(eq + 1) } : null;
          }).filter(Boolean);
          if (pairs.length > 0) return pairs.sort((a, b) => a.key.localeCompare(b.key));
        } catch {}
      }
    } catch {}
  }
  // Fallback: return inherited env (what the PTY started with)
  return Object.entries(process.env).map(([key, value]) => ({ key, value })).sort((a, b) => a.key.localeCompare(b.key));
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

// Get child process tree for smart naming (async)
ipcMain.handle("get-process-tree", async (_, id) => {
  const p = ptys.get(id);
  if (!p) return null;
  try {
    const pid = String(p.pid);
    if (process.platform === "win32") {
      try {
        const result = await execFileAsync("powershell", ["-Command",
          `Get-CimInstance Win32_Process -Filter "ParentProcessId=${parseInt(pid, 10)}" | Select-Object ProcessId,Name,CommandLine | ConvertTo-Json`
        ]);
        const procs = JSON.parse(result);
        const proc = Array.isArray(procs) ? procs[procs.length - 1] : procs;
        if (proc) return { pid: String(proc.ProcessId), comm: proc.Name, args: proc.CommandLine || "" };
        return null;
      } catch { return null; }
    }
    const childPidsStr = await execFileAsync("pgrep", ["-P", pid]);
    const childPids = childPidsStr.split("\n").filter(Boolean);
    if (childPids.length === 0) return null;
    const result = await execFileAsync("ps", ["-o", "pid=,comm=,args=", "-p", childPids.join(",")]);
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
// Uses a file descriptor approach to avoid password on disk longer than necessary
function createAskpassScript(password) {
  const tmpDir = app.getPath("temp");
  const scriptPath = path.join(tmpDir, `terminator-askpass-${process.pid}-${Date.now()}.sh`);
  // Escape single quotes in password for the shell script
  const escaped = password.replace(/'/g, "'\\''");
  fs.writeFileSync(scriptPath, `#!/bin/sh\necho '${escaped}'\n`, { mode: 0o700 });
  // Schedule cleanup even if process crashes
  process.once('exit', () => { try { fs.unlinkSync(scriptPath); } catch {} });
  return scriptPath;
}

function cleanupAskpass(scriptPath) {
  if (!scriptPath) return;
  try { fs.unlinkSync(scriptPath); } catch (err) {
    if (err.code !== 'ENOENT') log('error', 'Failed to cleanup askpass script:', err.message);
  }
}

function buildSshEnv(password) {
  if (!password) return { env: { ...process.env }, askpassScript: null };
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
              // Briefly suppress output while sending password to avoid it appearing in scrollback
              setTimeout(() => {
                p.write(password + "\r");
              }, 100);
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
  const { messages, apiKey, provider, model } = params;
  if (!apiKey && provider !== "ollama") return { error: "No API key configured" };
  const systemMsg = "You are a helpful terminal assistant in Terminator. Help with commands, errors, debugging. Be concise. Use code blocks for commands.";
  try {
    if (provider === "openai" || provider === "openai-compatible") {
      const baseUrl = params.baseUrl || "https://api.openai.com/v1";
      const res = await electronNet.fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
        body: JSON.stringify({
          model: model || "gpt-4o-mini",
          max_tokens: 2048,
          messages: [{ role: "system", content: systemMsg }, ...messages],
        }),
      });
      if (!res.ok) { const t = await res.text(); return { error: `API error (${res.status}): ${t.slice(0, 300)}` }; }
      const data = await res.json();
      return { text: data.choices?.[0]?.message?.content || "" };
    }
    if (provider === "google") {
      const m = model || "gemini-2.0-flash";
      const res = await electronNet.fetch(`https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent?key=${apiKey}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          system_instruction: { parts: [{ text: systemMsg }] },
          contents: messages.map(msg => ({ role: msg.role === "assistant" ? "model" : "user", parts: [{ text: msg.content }] })),
        }),
      });
      if (!res.ok) { const t = await res.text(); return { error: `API error (${res.status}): ${t.slice(0, 300)}` }; }
      const data = await res.json();
      return { text: data.candidates?.[0]?.content?.parts?.[0]?.text || "" };
    }
    if (provider === "ollama") {
      const baseUrl = params.baseUrl || "http://localhost:11434";
      const res = await electronNet.fetch(`${baseUrl}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: model || "llama3.2",
          stream: false,
          messages: [{ role: "system", content: systemMsg }, ...messages],
        }),
      });
      if (!res.ok) { const t = await res.text(); return { error: `Ollama error (${res.status}): ${t.slice(0, 300)}` }; }
      const data = await res.json();
      return { text: data.message?.content || "" };
    }
    // Default: Anthropic
    const response = await electronNet.fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: model || "claude-haiku-4-5-20251001",
        max_tokens: 2048,
        system: systemMsg,
        messages,
      }),
    });
    if (!response.ok) { const errText = await response.text(); return { error: `API error (${response.status}): ${errText.slice(0, 300)}` }; }
    const data = await response.json();
    return { text: data.content?.[0]?.text || "" };
  } catch (e) { return { error: e.message }; }
});

// Port Manager
ipcMain.handle("list-ports", async () => {
  try {
    const result = execFileSync("lsof", ["-iTCP", "-sTCP:LISTEN", "-nP"], {
      encoding: "utf8", timeout: 5000, stdio: ["pipe", "pipe", "pipe"]
    }).trim();
    if (!result) return [];
    const lines = result.split("\n");
    // Skip header line
    const dataLines = lines.slice(1);
    const seen = new Set();
    return dataLines.filter(Boolean).map(line => {
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
  try { execFileSync("kill", ["-9", String(n)], { timeout: 3000, stdio: ["pipe", "pipe", "pipe"] }); return true; } catch { return false; }
});

// Per-pane process stats
ipcMain.handle("get-pane-stats", async (_, id) => {
  const p = ptys.get(id);
  if (!p) return null;
  try {
    let targetPid;
    try {
      const children = execFileSync("pgrep", ["-P", String(p.pid)], {
        encoding: "utf8", timeout: 2000, stdio: ["pipe", "pipe", "pipe"]
      }).trim().split("\n").filter(Boolean);
      targetPid = children[0] || String(p.pid);
    } catch { targetPid = String(p.pid); }
    const result = execFileSync("ps", ["-p", String(targetPid), "-o", "%cpu,%mem"], {
      encoding: "utf8", timeout: 2000, stdio: ["pipe", "pipe", "pipe"]
    }).trim();
    const lines = result.split("\n");
    const dataLine = lines.length > 1 ? lines[lines.length - 1].trim() : "";
    const parts = dataLine.split(/\s+/).map(s => parseFloat(s));
    if (parts.length >= 2 && !isNaN(parts[0])) return { cpu: parts[0], memory: parts[1], pid: targetPid };
    return null;
  } catch { return null; }
});

// Pipeline Runner
const PIPELINES_PATH = path.join(app.getPath("userData"), "pipelines.json");
const CMD_BOOKMARKS_PATH = path.join(app.getPath("userData"), "cmd-bookmarks.json");
ipcMain.handle("save-pipelines", (_, data) => { writeJSON(PIPELINES_PATH, data); return { ok: true }; });
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

// ============================================================
// SECRETS MANAGER
// ============================================================
const crypto = require("crypto");
const SECRETS_PATH = path.join(app.getPath("userData"), "secrets.json");
const SECRETS_KEY_SEED = os.hostname() + os.userInfo().username + "terminator-vault";
function getSecretsKey() {
  return crypto.createHash("sha256").update(SECRETS_KEY_SEED).digest();
}
function encryptSecrets(data) {
  const key = getSecretsKey();
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv("aes-256-cbc", key, iv);
  let encrypted = cipher.update(JSON.stringify(data), "utf8", "hex");
  encrypted += cipher.final("hex");
  return { iv: iv.toString("hex"), data: encrypted };
}
function decryptSecrets(encrypted) {
  const key = getSecretsKey();
  const iv = Buffer.from(encrypted.iv, "hex");
  const decipher = crypto.createDecipheriv("aes-256-cbc", key, iv);
  let decrypted = decipher.update(encrypted.data, "hex", "utf8");
  decrypted += decipher.final("utf8");
  return JSON.parse(decrypted);
}
ipcMain.handle("load-secrets", () => {
  try {
    const raw = fs.readFileSync(SECRETS_PATH, "utf8");
    const encrypted = JSON.parse(raw);
    return decryptSecrets(encrypted);
  } catch { return []; }
});
ipcMain.on("save-secrets", (_, secrets) => {
  try {
    const encrypted = encryptSecrets(secrets);
    fs.writeFileSync(SECRETS_PATH, JSON.stringify(encrypted), "utf8");
  } catch (e) { log("error", "Failed to save secrets:", e.message); }
});
ipcMain.handle("inject-secrets", (_, { id, secrets }) => {
  const p = ptys.get(id);
  if (!p) return { error: "Terminal not found" };
  // Inject env vars by writing export commands (hidden from history with leading space)
  for (const s of secrets) {
    if (s.key && s.value) {
      // Use leading space to avoid shell history, and printf to avoid echo issues
      p.write(` export ${s.key}=${JSON.stringify(s.value)}\n`);
    }
  }
  return { ok: true, count: secrets.length };
});

// ============================================================
// STARTUP TASKS
// ============================================================
const STARTUP_TASKS_PATH = path.join(app.getPath("userData"), "startup-tasks.json");
ipcMain.on("save-startup-tasks", (_, data) => writeJSON(STARTUP_TASKS_PATH, data));
ipcMain.handle("load-startup-tasks", () => readJSON(STARTUP_TASKS_PATH, []));

// ============================================================
// STATUS BAR HELPERS
// ============================================================
ipcMain.handle("get-k8s-context", async () => {
  try {
    return execFileSync("kubectl", ["config", "current-context"], {
      encoding: "utf8", timeout: 3000, stdio: ["pipe", "pipe", "pipe"]
    }).trim();
  } catch { return null; }
});
ipcMain.handle("get-aws-profile", async () => {
  return process.env.AWS_PROFILE || process.env.AWS_DEFAULT_PROFILE || null;
});
ipcMain.handle("get-node-version", async () => {
  try {
    return execFileSync("node", ["--version"], {
      encoding: "utf8", timeout: 2000, stdio: ["pipe", "pipe", "pipe"]
    }).trim();
  } catch { return null; }
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
const AI_AUTOCOMPLETE_SYSTEM = `You are a terminal autocomplete engine like GitHub Copilot for the shell. Given a partial command with context, predict the FULL complete command the user most likely wants to run.

OUTPUT FORMAT: Output ONLY the full command. No explanation. No markdown. No backticks. No "$ " prefix. Just the raw command.

IMPORTANT:
- Always include the full command with ALL arguments, flags, paths, and values.
- Be specific and contextual. Use the working directory, git state, recent commands, and terminal output to predict what the user wants.
- Suggest complete, ready-to-run commands, not just one word.

If you truly cannot suggest anything useful, repeat the input exactly as-is.`;

function sanitizeCompletion(raw) {
  let text = (raw || "").trimStart().split("\n")[0].trim();
  text = text.replace(/^```\w*\s*/, "").replace(/```$/, "").trim();
  text = text.replace(/^[`'"]+|[`'"]+$/g, "");
  text = text.replace(/^\$\s+/, "");
  if (/^(I |You |To |This |That |Note|Sorry|Here|If you|The command)/i.test(text)) return "";
  if (text.length > 120) return "";
  return text;
}

ipcMain.handle("ai-complete", async (_, params) => {
  const { prompt, apiKey, provider, model } = params;
  if (!apiKey && provider !== "ollama") return { error: "No API key configured" };
  try {
    if (provider === "openai" || provider === "openai-compatible") {
      const baseUrl = params.baseUrl || "https://api.openai.com/v1";
      const res = await electronNet.fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
        body: JSON.stringify({
          model: model || "gpt-4o-mini",
          max_tokens: 200, temperature: 0,
          messages: [{ role: "system", content: AI_AUTOCOMPLETE_SYSTEM }, { role: "user", content: prompt }],
        }),
      });
      if (!res.ok) { const t = await res.text(); return { error: `API ${res.status}: ${t.slice(0, 200)}` }; }
      const json = await res.json();
      return { completion: sanitizeCompletion(json.choices?.[0]?.message?.content) };
    }
    if (provider === "google") {
      const m = model || "gemini-2.0-flash";
      const res = await electronNet.fetch(`https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent?key=${apiKey}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          system_instruction: { parts: [{ text: AI_AUTOCOMPLETE_SYSTEM }] },
          contents: [{ role: "user", parts: [{ text: prompt }] }],
        }),
      });
      if (!res.ok) { const t = await res.text(); return { error: `API ${res.status}: ${t.slice(0, 200)}` }; }
      const json = await res.json();
      return { completion: sanitizeCompletion(json.candidates?.[0]?.content?.parts?.[0]?.text) };
    }
    if (provider === "ollama") {
      const baseUrl = params.baseUrl || "http://localhost:11434";
      const res = await electronNet.fetch(`${baseUrl}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: model || "llama3.2",
          stream: false,
          messages: [{ role: "system", content: AI_AUTOCOMPLETE_SYSTEM }, { role: "user", content: prompt }],
        }),
      });
      if (!res.ok) { const t = await res.text(); return { error: `Ollama ${res.status}: ${t.slice(0, 200)}` }; }
      const json = await res.json();
      return { completion: sanitizeCompletion(json.message?.content) };
    }
    // Default: Anthropic
    const res = await electronNet.fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: model || "claude-haiku-4-5-20251001",
        max_tokens: 200, temperature: 0,
        system: AI_AUTOCOMPLETE_SYSTEM,
        messages: [{ role: "user", content: prompt }],
      }),
    });
    if (!res.ok) { const t = await res.text(); return { error: `API ${res.status}: ${t.slice(0, 200)}` }; }
    const json = await res.json();
    return { completion: sanitizeCompletion(json.content?.[0]?.text) };
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

// Zen Mode: fullscreen across all monitors with no chrome
let zenModeActive = false;
let zenPreBounds = null;
let zenWasMaximized = false;
let zenWasFullScreen = false;

ipcMain.handle("toggle-zen-mode", async () => {
  if (!mainWindow) return false;
  zenModeActive = !zenModeActive;
  if (zenModeActive) {
    // Save current state for restore
    zenWasFullScreen = mainWindow.isFullScreen();
    zenWasMaximized = mainWindow.isMaximized();
    zenPreBounds = mainWindow.getBounds();
    // Exit native fullscreen first (it locks to one display)
    if (zenWasFullScreen) {
      mainWindow.setFullScreen(false);
      // Wait for macOS fullscreen animation to finish
      await new Promise(r => setTimeout(r, 500));
    }
    // Calculate combined bounds across ALL displays
    const displays = screen.getAllDisplays();
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const d of displays) {
      minX = Math.min(minX, d.bounds.x);
      minY = Math.min(minY, d.bounds.y);
      maxX = Math.max(maxX, d.bounds.x + d.bounds.width);
      maxY = Math.max(maxY, d.bounds.y + d.bounds.height);
    }
    // Hide window chrome and span all displays
    if (process.platform === "darwin") {
      mainWindow.setWindowButtonVisibility(false);
    }
    mainWindow.setAlwaysOnTop(true, "screen-saver");
    mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    mainWindow.setBounds({ x: minX, y: minY, width: maxX - minX, height: maxY - minY });
    mainWindow.setMenuBarVisibility(false);
  } else {
    // Restore previous state
    mainWindow.setAlwaysOnTop(false);
    mainWindow.setVisibleOnAllWorkspaces(false);
    if (process.platform === "darwin") {
      mainWindow.setWindowButtonVisibility(true);
    }
    mainWindow.setMenuBarVisibility(true);
    if (zenPreBounds) mainWindow.setBounds(zenPreBounds);
    if (zenWasMaximized) mainWindow.maximize();
    if (zenWasFullScreen) mainWindow.setFullScreen(true);
  }
  mainWindow.webContents.send("zen-mode-changed", zenModeActive);
  return zenModeActive;
});

ipcMain.on("quit-app", () => {
  for (const [, p] of ptys) p.kill();
  app.quit();
});

// Window controls (for Windows/Linux frameless windows)
ipcMain.on("win-minimize", () => { if (mainWindow) mainWindow.minimize(); });
ipcMain.on("win-maximize", () => { if (mainWindow) { mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize(); } });
ipcMain.on("win-close", () => { if (mainWindow) mainWindow.close(); });

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

// ============================================================
// MARKETPLACE / PLUGIN REGISTRY
// ============================================================
const REGISTRY_URL = "https://raw.githubusercontent.com/suvash-glitch/Terminator/main/registry/plugins.json";
let _registryCache = null;
let _registryCacheTime = 0;
const REGISTRY_TTL = 5 * 60 * 1000; // 5 minutes

ipcMain.handle("fetch-registry", async () => {
  // Return cache if fresh
  if (_registryCache && (Date.now() - _registryCacheTime < REGISTRY_TTL)) {
    return _registryCache;
  }
  try {
    const res = await electronNet.fetch(REGISTRY_URL, { method: "GET" });
    if (!res.ok) {
      // Fallback: try loading from local bundled registry
      return loadLocalRegistry();
    }
    const data = await res.json();
    if (data && Array.isArray(data.plugins)) {
      _registryCache = data;
      _registryCacheTime = Date.now();
      return data;
    }
    return loadLocalRegistry();
  } catch {
    return loadLocalRegistry();
  }
});

function loadLocalRegistry() {
  try {
    const localPath = path.join(__dirname, "registry", "plugins.json");
    if (fs.existsSync(localPath)) {
      const data = JSON.parse(fs.readFileSync(localPath, "utf8"));
      _registryCache = data;
      _registryCacheTime = Date.now();
      return data;
    }
  } catch {}
  return { version: 1, plugins: [] };
}

// Install from marketplace: download files from registry
ipcMain.handle("install-from-registry", async (_, { id, files, downloadUrl }) => {
  if (typeof id !== "string" || id.includes("..") || id.includes("/") || id.includes("\\")) {
    return { error: "Invalid plugin id" };
  }
  const dest = path.join(PLUGINS_DIR, id);
  try {
    fs.mkdirSync(dest, { recursive: true });
    // Try remote download first
    let downloaded = false;
    if (downloadUrl && files) {
      try {
        for (const [filename, remotePath] of Object.entries(files)) {
          const url = downloadUrl + filename;
          const res = await electronNet.fetch(url, { method: "GET" });
          if (!res.ok) throw new Error(`Failed to fetch ${filename}: ${res.status}`);
          const text = await res.text();
          fs.writeFileSync(path.join(dest, filename), text);
        }
        downloaded = true;
      } catch (fetchErr) {
        log("info", `Remote download failed for ${id}, trying local: ${fetchErr.message}`);
      }
    }
    // Fallback: copy from local registry dir
    if (!downloaded) {
      const localSrc = path.join(__dirname, "registry", "plugins", id);
      if (fs.existsSync(localSrc)) {
        fs.cpSync(localSrc, dest, { recursive: true });
      } else {
        fs.rmSync(dest, { recursive: true, force: true });
        return { error: "Plugin not available" };
      }
    }
    return { ok: true };
  } catch (e) {
    try { fs.rmSync(dest, { recursive: true, force: true }); } catch {}
    return { error: e.message };
  }
});

// Legacy: list available from bundled examples (kept for backward compat)
ipcMain.handle("list-available-plugins", () => {
  // Try registry dir first, then examples
  for (const base of [path.join(__dirname, "registry", "plugins"), path.join(__dirname, "examples", "plugins")]) {
    try {
      const entries = fs.readdirSync(base, { withFileTypes: true });
      const available = [];
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const manifestPath = path.join(base, entry.name, "plugin.json");
        try {
          const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
          if (!manifest.name || !manifest.type || !manifest.main) continue;
          const installed = fs.existsSync(path.join(PLUGINS_DIR, entry.name, "plugin.json"));
          available.push({ dir: entry.name, manifest, installed });
        } catch {}
      }
      if (available.length > 0) return available;
    } catch {}
  }
  return [];
});

// Legacy: install from bundled
ipcMain.handle("install-plugin", (_, pluginDir) => {
  if (typeof pluginDir !== "string" || pluginDir.includes("..") || pluginDir.includes("/") || pluginDir.includes("\\")) {
    return { error: "Invalid plugin name" };
  }
  // Try registry dir first, then examples
  for (const base of [path.join(__dirname, "registry", "plugins"), path.join(__dirname, "examples", "plugins")]) {
    const src = path.join(base, pluginDir);
    if (fs.existsSync(src)) {
      const dest = path.join(PLUGINS_DIR, pluginDir);
      try {
        fs.cpSync(src, dest, { recursive: true });
        return { ok: true };
      } catch (e) {
        return { error: e.message };
      }
    }
  }
  return { error: "Plugin not found" };
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

// Install from .termext package file (zip)
ipcMain.handle("install-termext", async (_, filePath) => {
  const safePath = sanitizePath(filePath);
  if (!safePath) return { error: "Invalid file path" };
  if (!safePath.endsWith(".termext") && !safePath.endsWith(".zip")) return { error: "Not a .termext package" };
  if (!fs.existsSync(safePath)) return { error: "File not found" };
  try {
    // Extract to a temp dir first to read the manifest
    const tmpDir = path.join(app.getPath("temp"), `termext-${Date.now()}`);
    fs.mkdirSync(tmpDir, { recursive: true });
    await execFileAsync("unzip", ["-o", "-q", safePath, "-d", tmpDir], { timeout: 10000 });
    // Read manifest to get plugin id
    const manifestPath = path.join(tmpDir, "plugin.json");
    if (!fs.existsSync(manifestPath)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
      return { error: "Package missing plugin.json" };
    }
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    if (!manifest.name || !manifest.type || !manifest.main) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
      return { error: "Invalid plugin manifest" };
    }
    // Copy to plugins dir
    const pluginId = manifest.name.replace(/[^a-zA-Z0-9_-]/g, "-").toLowerCase();
    const dest = path.join(PLUGINS_DIR, pluginId);
    if (fs.existsSync(dest)) fs.rmSync(dest, { recursive: true, force: true });
    fs.cpSync(tmpDir, dest, { recursive: true });
    fs.rmSync(tmpDir, { recursive: true, force: true });
    return { ok: true, id: pluginId, manifest };
  } catch (e) {
    return { error: e.message };
  }
});

// Download .termext package from URL and install
ipcMain.handle("download-and-install-termext", async (_, { url, id }) => {
  if (typeof url !== "string" || typeof id !== "string") return { error: "Invalid parameters" };
  if (id.includes("..") || id.includes("/") || id.includes("\\")) return { error: "Invalid plugin id" };
  const tmpFile = path.join(app.getPath("temp"), `${id}-${Date.now()}.termext`);
  try {
    const res = await electronNet.fetch(url, { method: "GET" });
    if (!res.ok) throw new Error(`Download failed: ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    fs.writeFileSync(tmpFile, buf);
    // Extract
    const dest = path.join(PLUGINS_DIR, id);
    fs.mkdirSync(dest, { recursive: true });
    await execFileAsync("unzip", ["-o", "-q", tmpFile, "-d", dest], { timeout: 10000 });
    // Validate
    const manifestPath = path.join(dest, "plugin.json");
    if (!fs.existsSync(manifestPath)) {
      fs.rmSync(dest, { recursive: true, force: true });
      throw new Error("Package missing plugin.json");
    }
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    fs.unlinkSync(tmpFile);
    return { ok: true, id, manifest };
  } catch (e) {
    try { fs.unlinkSync(tmpFile); } catch {}
    return { error: e.message };
  }
});

// Open file dialog to pick a shell script
ipcMain.handle("pick-sh-file", async () => {
  const { dialog } = require("electron");
  const result = await dialog.showOpenDialog(mainWindow, {
    title: "Import Shell Script",
    filters: [{ name: "Shell Scripts", extensions: ["sh", "bash", "zsh"] }],
    properties: ["openFile"],
  });
  if (result.canceled || !result.filePaths.length) return { canceled: true };
  const content = fs.readFileSync(result.filePaths[0], "utf-8");
  const name = path.basename(result.filePaths[0], path.extname(result.filePaths[0]));
  return { content, name };
});

// Open file dialog to pick a .termext package
ipcMain.handle("pick-termext-file", async () => {
  const { dialog } = require("electron");
  const result = await dialog.showOpenDialog(mainWindow, {
    title: "Install Extension Package",
    filters: [{ name: "Terminator Extension", extensions: ["termext", "zip"] }],
    properties: ["openFile"],
  });
  if (result.canceled || !result.filePaths.length) return { canceled: true };
  return { filePath: result.filePaths[0] };
});

