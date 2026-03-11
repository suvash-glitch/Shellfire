const { app, BrowserWindow, ipcMain, Notification, shell } = require("electron");
const pty = require("node-pty");
const path = require("path");
const os = require("os");
const fs = require("fs");
const { execFileSync, execSync } = require("child_process");

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
    autoUpdater.checkForUpdatesAndNotify().catch(() => {});
    // Check for updates every 4 hours
    setInterval(() => {
      autoUpdater.checkForUpdatesAndNotify().catch(() => {});
    }, 4 * 60 * 60 * 1000);
  }
});

app.on("window-all-closed", () => app.quit());

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
  const p = pty.spawn(shellPath, [], {
    name: "xterm-256color",
    cols: 80,
    rows: 24,
    cwd: cwd || os.homedir(),
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
  try {
    const branch = execFileSync("git", ["-C", dirPath, "rev-parse", "--abbrev-ref", "HEAD"], {
      encoding: "utf8", timeout: 2000, stdio: ["pipe", "pipe", "pipe"]
    }).trim();
    return branch || null;
  } catch { return null; }
});

// Get git status (dirty/clean) for a directory
ipcMain.handle("get-git-status", async (_, dirPath) => {
  if (!dirPath) return null;
  try {
    const status = execFileSync("git", ["-C", dirPath, "status", "--porcelain"], {
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
  try {
    execFileSync("code", [filePath], { timeout: 3000, stdio: ["pipe", "pipe", "pipe"] });
  } catch {
    shell.openPath(filePath);
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
    // Validate path doesn't contain directory traversal
    const resolved = path.resolve(filePath);
    if (!resolved.startsWith(os.homedir()) && !resolved.startsWith('/tmp') && !resolved.startsWith(os.tmpdir())) {
      return { error: "Access denied: path outside allowed directories" };
    }
    const stat = fs.statSync(filePath);
    if (stat.isDirectory()) return { error: "Is a directory", isDir: true };
    const limit = maxBytes || 50000;
    if (stat.size > limit) {
      const buf = Buffer.alloc(limit);
      let fd;
      try {
        fd = fs.openSync(filePath, "r");
        fs.readSync(fd, buf, 0, limit, 0);
      } finally {
        if (fd !== undefined) fs.closeSync(fd);
      }
      return { content: buf.toString("utf8"), truncated: true, size: stat.size };
    }
    return { content: fs.readFileSync(filePath, "utf8"), truncated: false, size: stat.size };
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
}));
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
