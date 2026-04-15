"use strict";

const { app, BrowserWindow, ipcMain, dialog } = require("electron");
const path = require("path");
const fs = require("fs");
const os = require("os");
const net = require("net");

// ── Window ────────────────────────────────────────────────────
let win;

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
});

app.on("window-all-closed", () => app.quit());

// ── Socket client (talks to running Shellfire v3) ─────────────

function findSocket() {
  const dir = path.join(os.homedir(), ".shellfire");
  if (!fs.existsSync(dir)) return null;
  const socks = fs.readdirSync(dir)
    .filter(f => f.startsWith("shellfire-") && f.endsWith(".sock"))
    .map(f => ({ p: path.join(dir, f), m: fs.statSync(path.join(dir, f)).mtimeMs }))
    .sort((a, b) => b.m - a.m);
  return socks[0]?.p || null;
}

function socketCommand(cmd) {
  return new Promise((resolve, reject) => {
    const sock = findSocket();
    if (!sock) return reject(new Error("Shellfire v3 is not running"));
    const c = net.createConnection(sock, () => {
      c.write(JSON.stringify(cmd) + "\n");
    });
    let buf = "";
    c.on("data", d => {
      buf += d;
      try { resolve(JSON.parse(buf)); c.destroy(); } catch {}
    });
    c.on("error", reject);
    setTimeout(() => { c.destroy(); reject(new Error("Socket timeout")); }, 5000);
  });
}

// ── IPC: Shellfire connection ─────────────────────────────────

ipcMain.handle("sf:status", async () => {
  try {
    const res = await socketCommand({ action: "list" });
    return { connected: true, sessions: res.sessions || [] };
  } catch (e) {
    return { connected: false, error: e.message };
  }
});

ipcMain.handle("sf:install-extension", async (_, { id, files }) => {
  try {
    const pluginsDir = path.join(os.homedir(), ".shellfire", "plugins", id);
    fs.mkdirSync(pluginsDir, { recursive: true });
    for (const [name, content] of Object.entries(files)) {
      fs.writeFileSync(path.join(pluginsDir, name), content, "utf8");
    }
    // Tell Shellfire to reload via socket
    await socketCommand({ action: "reload-extension", id });
    return { ok: true };
  } catch (e) {
    // Even if socket fails, files are written — manual restart will pick them up
    return { ok: true, note: e.message };
  }
});

ipcMain.handle("sf:send", async (_, { name, text }) => {
  try {
    await socketCommand({ action: "send", name, text });
    return { ok: true };
  } catch (e) { return { error: e.message }; }
});

ipcMain.handle("sf:read", async (_, { name }) => {
  try {
    const res = await socketCommand({ action: "read", name, lines: 50 });
    return { output: res.output || "" };
  } catch (e) { return { output: "" }; }
});

// ── IPC: File system ──────────────────────────────────────────

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
      .filter(e => !e.isDirectory())
      .map(e => ({ name: e.name, path: path.join(dir, e.name) }));
    return { dir, files: entries };
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

ipcMain.handle("platform", () => process.platform);
