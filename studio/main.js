"use strict";

const { app, BrowserWindow, ipcMain, dialog } = require("electron");
const path = require("path");
const fs = require("fs");
const os = require("os");
const net = require("net");

// ── Windows ───────────────────────────────────────────────────
let win = null;
let previewWin = null;

app.whenReady().then(() => {
  win = new BrowserWindow({
    width: 1600, height: 960,
    minWidth: 1100, minHeight: 700,
    backgroundColor: "#0a0a0b",
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
    trafficLightPosition: { x: 14, y: 14 },
    title: "Shellfire Studio",
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
      preload: path.join(__dirname, "preload.js"),
    },
  });
  win.loadFile("index.html");
  win.maximize();

  win.on("closed", () => {
    win = null;
    previewWin?.close();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

// ── Pop-out preview window ────────────────────────────────────
ipcMain.handle("preview:open", () => {
  if (previewWin && !previewWin.isDestroyed()) {
    previewWin.focus();
    return { ok: true, already: true };
  }
  previewWin = new BrowserWindow({
    width: 1300, height: 840,
    minWidth: 800, minHeight: 560,
    backgroundColor: "#060608",
    title: "Shellfire Preview",
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
      preload: path.join(__dirname, "preview-preload.js"),
    },
  });
  previewWin.loadFile("preview-window.html");
  previewWin.on("closed", () => { previewWin = null; });
  return { ok: true };
});

ipcMain.on("preview:code", (_, code, manifest) => {
  if (previewWin && !previewWin.isDestroyed()) {
    previewWin.webContents.send("preview:code", code, manifest);
  }
});

ipcMain.on("preview:reset", () => {
  if (previewWin && !previewWin.isDestroyed()) {
    previewWin.webContents.send("preview:reset");
  }
});

ipcMain.handle("preview:is-open", () =>
  !!(previewWin && !previewWin.isDestroyed()));

// ── Socket client ─────────────────────────────────────────────
function findSocket() {
  const dir = path.join(os.homedir(), ".shellfire");
  if (!fs.existsSync(dir)) return null;
  try {
    const socks = fs.readdirSync(dir)
      .filter(f => f.startsWith("shellfire-") && f.endsWith(".sock"))
      .map(f => ({ p: path.join(dir, f), m: fs.statSync(path.join(dir, f)).mtimeMs }))
      .sort((a, b) => b.m - a.m);
    return socks[0]?.p || null;
  } catch { return null; }
}

function socketCommand(cmd, timeout = 5000) {
  return new Promise((resolve, reject) => {
    const sock = findSocket();
    if (!sock) return reject(new Error("Shellfire v3 is not running"));
    const c = net.createConnection(sock, () => c.write(JSON.stringify(cmd) + "\n"));
    let buf = "";
    c.on("data", d => {
      buf += d;
      try { resolve(JSON.parse(buf)); c.destroy(); } catch {}
    });
    c.on("error", reject);
    const t = setTimeout(() => { c.destroy(); reject(new Error("Socket timeout")); }, timeout);
    c.on("close", () => clearTimeout(t));
  });
}

// ── Shellfire IPC ─────────────────────────────────────────────
ipcMain.handle("sf:status", async () => {
  try {
    const res = await socketCommand({ action: "list" }, 3000);
    return { connected: true, sessions: res.sessions || [] };
  } catch (e) {
    return { connected: false, error: e.message };
  }
});

ipcMain.handle("sf:install-extension", async (_, { id, files, type }) => {
  if (!id || typeof id !== "string") return { error: "Invalid plugin id" };

  // 1. Write files to disk
  const pluginDir = path.join(os.homedir(), ".shellfire", "plugins", id);
  try {
    fs.mkdirSync(pluginDir, { recursive: true });
    for (const [name, content] of Object.entries(files)) {
      fs.writeFileSync(path.join(pluginDir, name), content, "utf8");
    }
  } catch (e) {
    return { error: `Write failed: ${e.message}` };
  }

  // 2. Hot-reload via socket (deactivate + reactivate in renderer)
  try {
    const res = await socketCommand({ action: "reload-extension", id, type: type || "extension" }, 6000);
    return { ok: true, reloaded: true, msg: res.error || "Extension hot-reloaded" };
  } catch (e) {
    // Files written but no live reload (Shellfire not running or old version)
    return { ok: true, reloaded: false, msg: "Files written — restart Shellfire to load" };
  }
});

ipcMain.handle("sf:uninstall-extension", async (_, id) => {
  try {
    const pluginDir = path.join(os.homedir(), ".shellfire", "plugins", id);
    if (fs.existsSync(pluginDir)) fs.rmSync(pluginDir, { recursive: true, force: true });
    await socketCommand({ action: "reload-extension", id, type: "none" }, 3000).catch(() => {});
    return { ok: true };
  } catch (e) { return { error: e.message }; }
});

ipcMain.handle("sf:send", async (_, { name, text }) => {
  try {
    await socketCommand({ action: "send", name, text }, 3000);
    return { ok: true };
  } catch (e) { return { error: e.message }; }
});

ipcMain.handle("sf:read", async (_, { name, lines }) => {
  try {
    const res = await socketCommand({ action: "read", name, lines: lines || 50 }, 4000);
    return { output: res.output || "" };
  } catch (e) { return { output: "" }; }
});

// ── File system IPC ───────────────────────────────────────────
ipcMain.handle("fs:read", (_, p) => {
  try { return { content: fs.readFileSync(p, "utf8") }; }
  catch (e) { return { error: e.message }; }
});

ipcMain.handle("fs:write", (_, p, content) => {
  try {
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, content, "utf8");
    return { ok: true };
  } catch (e) { return { error: e.message }; }
});

ipcMain.handle("fs:open-folder", async () => {
  const r = await dialog.showOpenDialog(win, { properties: ["openDirectory"] });
  if (r.canceled || !r.filePaths.length) return { canceled: true };
  const dir = r.filePaths[0];
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true })
      .filter(e => !e.isDirectory() && !e.name.startsWith("."))
      .map(e => ({ name: e.name, path: path.join(dir, e.name) }));
    // Read all file contents
    const files = {};
    for (const e of entries) {
      try { files[e.name] = { content: fs.readFileSync(e.path, "utf8"), path: e.path }; }
      catch {}
    }
    return { dir, files };
  } catch (e) { return { error: e.message }; }
});

ipcMain.handle("fs:save-dialog", async (_, name) => {
  const r = await dialog.showSaveDialog(win, {
    defaultPath: path.join(os.homedir(), "Desktop", name || "extension.termext"),
    filters: [{ name: "Shellfire Extension", extensions: ["termext"] }],
  });
  return r.canceled ? { canceled: true } : { filePath: r.filePath };
});

ipcMain.handle("fs:list-installed", () => {
  const dir = path.join(os.homedir(), ".shellfire", "plugins");
  try {
    return fs.readdirSync(dir, { withFileTypes: true })
      .filter(e => e.isDirectory())
      .map(e => {
        try {
          const m = JSON.parse(fs.readFileSync(path.join(dir, e.name, "plugin.json"), "utf8"));
          return { id: e.name, manifest: m };
        } catch { return null; }
      }).filter(Boolean);
  } catch { return []; }
});

ipcMain.handle("fs:export-termext", async (_, { files, name, outPath }) => {
  const { execFile } = require("child_process");
  const tmpDir = path.join(os.tmpdir(), `sf-export-${Date.now()}`);
  try {
    fs.mkdirSync(tmpDir, { recursive: true });
    for (const [fname, content] of Object.entries(files)) {
      fs.writeFileSync(path.join(tmpDir, fname), content, "utf8");
    }
    await new Promise((resolve, reject) => {
      execFile("zip", ["-j", "-r", outPath, tmpDir], { timeout: 15000 }, (err) => {
        err ? reject(err) : resolve();
      });
    });
    return { ok: true, path: outPath };
  } catch (e) {
    return { error: e.message };
  } finally {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  }
});

ipcMain.handle("platform", () => process.platform);
