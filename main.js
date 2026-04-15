"use strict";

// ============================================================
// SHELLFIRE v3 — MAIN PROCESS ENTRY POINT
//
// This file is intentionally thin. Feature logic lives in
// src/main/ modules. See CLAUDE.md for architecture overview.
// ============================================================

const { app } = require("electron");
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
