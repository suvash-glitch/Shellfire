"use strict";

// ============================================================
// SHELLFIRE v3 — MAIN PROCESS ENTRY POINT
//
// This file is intentionally thin. Feature logic lives in
// src/main/ modules. See CLAUDE.md for architecture overview.
// ============================================================

const { app } = require("electron");

// ── GPU stability flags (must be set before app ready) ────────
// Run the GPU process inside the main process so macOS cannot
// SIGTERM it independently under memory pressure. This eliminates
// the GPU crash → WebGL context loss → frozen UI cycle.
app.commandLine.appendSwitch("in-process-gpu");
// Disable the GPU sandbox (redundant with in-process-gpu but
// prevents sandbox-related crashes on some macOS versions).
app.commandLine.appendSwitch("no-sandbox");
// Prefer integrated GPU on dual-GPU Macs to reduce memory pressure.
app.commandLine.appendSwitch("force_low_power_gpu");
const { ptys } = require("./src/main/state");
const socketServer = require("./src/main/socket-server");
const windowManager = require("./src/main/window-manager");
const ptyManager = require("./src/main/pty-manager");
const storage = require("./src/main/storage");
const aiService = require("./src/main/ai-service");
const sshManager = require("./src/main/ssh-manager");
const systemHandlers = require("./src/main/system-handlers");
const pluginSystem = require("./src/main/plugin-system");

// ── Register all IPC handlers ─────────────────────────────────
ptyManager.registerHandlers();
storage.registerHandlers(ptys);
aiService.registerHandlers();
sshManager.registerHandlers();
systemHandlers.registerHandlers();
pluginSystem.registerHandlers();
windowManager.registerHandlers();

// ── App lifecycle ─────────────────────────────────────────────
app.whenReady().then(() => {
  windowManager.createWindow();
  windowManager.setupAutoUpdater();
  socketServer.start();

  // ── Dev helpers ───────────────────────────────────────────────
  const { getWindow } = require("./src/main/state");
  const { globalShortcut } = require("electron");
  // Cmd+Option+I opens DevTools in any mode for debugging
  globalShortcut.register("CommandOrControl+Alt+I", () => {
    const win = getWindow();
    if (win) win.webContents.toggleDevTools();
  });
});

app.on("activate", () => {
  const { getWindow } = require("./src/main/state");
  if (!getWindow()) windowManager.createWindow();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  for (const [, p] of ptys) { try { p.kill(); } catch {} }
  socketServer.cleanup();
  windowManager.cleanup();
});

// ── Crash recovery ────────────────────────────────────────────
const { log } = require("./src/main/utils");
app.on("gpu-process-crashed", (_, killed) => {
  log("warn", `GPU process ${killed ? "killed" : "crashed"} — reloading renderer`);
  const { getWindow } = require("./src/main/state");
  const win = getWindow();
  if (win && !win.isDestroyed()) {
    // Give the in-process GPU a moment to reset before reloading
    setTimeout(() => { if (!win.isDestroyed()) win.webContents.reload(); }, 1000);
  }
});
app.on("render-process-gone", (_, win, details) => {
  log("error", `Renderer gone: ${details.reason} (exitCode ${details.exitCode})`);
});
