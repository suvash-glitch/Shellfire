"use strict";

// ============================================================
// WINDOW MANAGER
// BrowserWindow creation, auto-updater, window controls,
// fullscreen / zen-mode, zoom.
// ============================================================

const path = require("path");
const { app, BrowserWindow, ipcMain, screen } = require("electron");
const { log } = require("./utils");
const { ptys, getWindow, setWindow, sendToRenderer } = require("./state");

let autoUpdater = null;
try { ({ autoUpdater } = require("electron-updater")); } catch {}

// Zen mode state
let zenActive = false;
let zenTransitioning = false; // debounce rapid toggles
let zenPreBounds = null;
let zenWasMaximized = false;
let zenWasFullScreen = false;

// Auto-update interval (stored so it can be cleared on quit)
let _updateCheckInterval = null;

// ── Window creation ───────────────────────────────────────────

function createWindow() {
  const opts = {
    width: 1200,
    height: 800,
    backgroundColor: "#1e1e1e",
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      preload: path.join(__dirname, "..", "..", "preload.js"),
    },
  };

  if (process.platform === "darwin") {
    opts.titleBarStyle = "hiddenInset";
    opts.trafficLightPosition = { x: 13, y: 13 };
    opts.vibrancy = "titlebar";
  } else {
    opts.frame = false;
  }

  const win = new BrowserWindow(opts);
  setWindow(win);

  // Content Security Policy
  win.webContents.session.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        "Content-Security-Policy": [
          "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; font-src 'self'; connect-src *"
        ],
      },
    });
  });

  win.loadFile("index.html");
  win.maximize();

  win.on("closed", () => {
    // Keep PTYs alive across window close on macOS (tmux-like reattach)
    setWindow(null);
  });
}

// ── Auto-updater ──────────────────────────────────────────────

function setupAutoUpdater() {
  if (!autoUpdater || !app.isPackaged) return;

  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;

  const send = (payload) => sendToRenderer("update-status", payload);

  autoUpdater.on("checking-for-update", () => { log("info", "Checking for update..."); send({ status: "checking" }); });
  autoUpdater.on("update-available", ({ version }) => { log("info", `Update available: v${version}`); send({ status: "available", version }); });
  autoUpdater.on("download-progress", ({ percent }) => send({ status: "downloading", percent: Math.round(percent) }));
  autoUpdater.on("update-downloaded", ({ version }) => { log("info", `Update downloaded: v${version}`); send({ status: "downloaded", version }); });
  autoUpdater.on("update-not-available", () => { log("info", "No update available"); send({ status: "up-to-date" }); });
  autoUpdater.on("error", (err) => { log("error", "Auto-update error:", err.message); send({ status: "error", message: err.message }); });

  autoUpdater.checkForUpdates().catch(() => {});
  _updateCheckInterval = setInterval(() => autoUpdater.checkForUpdates().catch(() => {}), 4 * 60 * 60 * 1000);
}

// ── IPC handlers ─────────────────────────────────────────────

function registerHandlers() {
  ipcMain.handle("check-for-updates", async () => { try { await autoUpdater?.checkForUpdates(); } catch {} });
  ipcMain.handle("download-update", async () => { try { await autoUpdater?.downloadUpdate(); } catch {} });
  ipcMain.handle("install-update", () => { autoUpdater?.quitAndInstall(); });

  ipcMain.handle("get-app-version", () => app.getVersion());
  ipcMain.handle("get-default-shell", () => process.platform === "win32" ? process.env.COMSPEC || "powershell.exe" : process.env.SHELL || "/bin/zsh");

  ipcMain.on("toggle-fullscreen", () => {
    const win = getWindow();
    if (win) win.setFullScreen(!win.isFullScreen());
  });

  ipcMain.handle("toggle-zen-mode", async () => {
    const win = getWindow();
    if (!win || zenTransitioning) return zenActive;
    zenTransitioning = true;
    zenActive = !zenActive;

    if (zenActive) {
      zenWasFullScreen = win.isFullScreen();
      zenWasMaximized = win.isMaximized();
      zenPreBounds = win.getBounds();
      if (zenWasFullScreen) {
        win.setFullScreen(false);
        await new Promise(r => setTimeout(r, 500));
      }
      const displays = screen.getAllDisplays();
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const d of displays) {
        minX = Math.min(minX, d.bounds.x);
        minY = Math.min(minY, d.bounds.y);
        maxX = Math.max(maxX, d.bounds.x + d.bounds.width);
        maxY = Math.max(maxY, d.bounds.y + d.bounds.height);
      }
      if (process.platform === "darwin") win.setWindowButtonVisibility(false);
      win.setAlwaysOnTop(true, "screen-saver");
      win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
      win.setBounds({ x: minX, y: minY, width: maxX - minX, height: maxY - minY });
      win.setMenuBarVisibility(false);
    } else {
      win.setAlwaysOnTop(false);
      win.setVisibleOnAllWorkspaces(false);
      if (process.platform === "darwin") win.setWindowButtonVisibility(true);
      win.setMenuBarVisibility(true);
      if (zenPreBounds) win.setBounds(zenPreBounds);
      if (zenWasMaximized) win.maximize();
      if (zenWasFullScreen) win.setFullScreen(true);
    }

    sendToRenderer("zen-mode-changed", zenActive);
    zenTransitioning = false;
    return zenActive;
  });

  // Window controls (frameless Windows / Linux)
  ipcMain.on("win-minimize", () => getWindow()?.minimize());
  ipcMain.on("win-maximize", () => {
    const win = getWindow();
    if (win) win.isMaximized() ? win.unmaximize() : win.maximize();
  });
  ipcMain.on("win-close", () => getWindow()?.close());

  // App-wide zoom
  ipcMain.handle("set-zoom", (_, factor) => {
    const win = getWindow();
    if (!win || win.isDestroyed()) return;
    const f = Number(factor);
    if (!isFinite(f) || f < 0.5 || f > 3) return;
    win.webContents.setZoomFactor(f);
  });
  ipcMain.handle("get-zoom", () => {
    const win = getWindow();
    return (!win || win.isDestroyed()) ? 1 : win.webContents.getZoomFactor();
  });

  // Quit: kill all PTYs and clear intervals before exit
  ipcMain.on("quit-app", () => {
    if (_updateCheckInterval) { clearInterval(_updateCheckInterval); _updateCheckInterval = null; }
    for (const [, p] of ptys) { try { p.kill(); } catch {} }
    app.quit();
  });
}

function cleanup() {
  if (_updateCheckInterval) { clearInterval(_updateCheckInterval); _updateCheckInterval = null; }
}

module.exports = { createWindow, setupAutoUpdater, registerHandlers, cleanup };
