"use strict";

// ============================================================
// SHARED MAIN-PROCESS STATE
//
// Single source of truth for PTY maps and the main window
// reference. All modules import from here instead of passing
// state through function arguments.
// ============================================================

/** Active PTY processes. Map<number, IPty> */
const ptys = new Map();

/**
 * Per-PTY output ring-buffer (raw bytes, including ANSI).
 * Used for tmux-like reattach: when the window closes, PTYs
 * stay alive and output accumulates here. On next open the
 * renderer replays it into a fresh xterm instance.
 * Map<number, string>
 */
const ptyBuffers = new Map();

/** Per-PTY metadata. Map<number, { cwd, cols, rows }> */
const ptyMeta = new Map();

const PTY_BUFFER_MAX = 1024 * 1024; // 1 MB tail per pty

/** Monotonically increasing PTY id */
let nextId = 1;

function getNextId() {
  return nextId++;
}

function appendPtyBuffer(id, data) {
  const cur = ptyBuffers.get(id) || "";
  const next = cur + data;
  ptyBuffers.set(id, next.length > PTY_BUFFER_MAX ? next.slice(-PTY_BUFFER_MAX) : next);
}

/** The Electron BrowserWindow — null when window is closed */
let mainWindow = null;

function getWindow() { return mainWindow; }
function setWindow(w) { mainWindow = w; }

function sendToRenderer(channel, ...args) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, ...args);
  }
}

module.exports = {
  ptys, ptyBuffers, ptyMeta,
  PTY_BUFFER_MAX,
  getNextId, appendPtyBuffer,
  getWindow, setWindow, sendToRenderer,
};
