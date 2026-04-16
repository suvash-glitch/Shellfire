"use strict";

/**
 * @module state
 *
 * Shared main-process state for Shellfire.
 *
 * Owns:
 *   - The active PTY process map (`ptys`)
 *   - Per-PTY raw output ring-buffers (`ptyBuffers`)
 *   - Per-PTY metadata (`ptyMeta`)
 *   - The monotonically increasing PTY id counter
 *   - The Electron BrowserWindow reference (`mainWindow`)
 *   - The `sendToRenderer` convenience helper
 *
 * Does NOT own:
 *   - PTY lifecycle logic (create, resize, kill — see pty-manager.js)
 *   - IPC handler registration (see individual *-manager / *-handlers modules)
 *   - Persistent storage or file I/O (see storage.js and utils.js)
 *   - Window creation or BrowserWindow options (see window-manager.js)
 */

// ─── Constants ────────────────────────────────────────────────────────────────

/** Number of bytes in one mebibyte, used to express buffer limits clearly. */
const BYTES_PER_MIB = 1024 * 1024;

/**
 * Maximum number of bytes retained in each PTY's output ring-buffer.
 * When a buffer exceeds this size its oldest bytes are discarded so that
 * only the most recent {@link PTY_BUFFER_MAX} bytes are kept.
 * This bounds memory usage while still providing enough history for a
 * tmux-like reattach replay.
 *
 * @type {number}
 */
const PTY_BUFFER_MAX = 1 * BYTES_PER_MIB; // 1 MiB tail per PTY

// ─── PTY maps ─────────────────────────────────────────────────────────────────

/**
 * Active PTY processes, keyed by their numeric id.
 *
 * @type {Map<number, import("node-pty").IPty>}
 */
const ptys = new Map();

/**
 * Per-PTY output ring-buffer containing raw bytes (including ANSI sequences).
 *
 * PTYs remain alive when the BrowserWindow is closed; output accumulates here
 * so that a fresh xterm instance can replay it on the next window open,
 * providing tmux-like reattach behaviour.
 *
 * @type {Map<number, string>}
 */
const ptyBuffers = new Map();

/**
 * Per-PTY metadata snapshot.
 *
 * @type {Map<number, { cwd: string, cols: number, rows: number }>}
 */
const ptyMeta = new Map();

// ─── PTY id counter ───────────────────────────────────────────────────────────

/** Internal counter. Incremented by {@link getNextId} — never reset. */
let _nextId = 1;

/**
 * Returns the next available PTY id and advances the internal counter.
 * Ids are monotonically increasing positive integers; they are never reused
 * within a single app lifetime.
 *
 * @returns {number} A unique PTY identifier.
 */
function getNextId() {
  return _nextId++;
}

// ─── Ring-buffer management ───────────────────────────────────────────────────

/**
 * Appends `data` to the output ring-buffer for PTY `id`.
 *
 * If the resulting buffer exceeds {@link PTY_BUFFER_MAX} bytes, only the
 * trailing {@link PTY_BUFFER_MAX} bytes are retained, discarding the oldest
 * output.
 *
 * @param {number} id   - PTY identifier.
 * @param {string} data - Raw output chunk (may contain ANSI escape sequences).
 * @returns {void}
 */
function appendPtyBuffer(id, data) {
  const current = ptyBuffers.get(id) || "";
  const next = current + data;
  ptyBuffers.set(
    id,
    next.length > PTY_BUFFER_MAX ? next.slice(-PTY_BUFFER_MAX) : next
  );
}

// ─── BrowserWindow reference ──────────────────────────────────────────────────

/**
 * The single Electron BrowserWindow instance, or `null` when the window is
 * closed or has not yet been created.
 *
 * @type {import("electron").BrowserWindow|null}
 */
let mainWindow = null;

/**
 * Returns the current BrowserWindow reference.
 *
 * @returns {import("electron").BrowserWindow|null} The window, or `null` if closed.
 */
function getWindow() {
  return mainWindow;
}

/**
 * Stores a new BrowserWindow reference, replacing any previous value.
 * Pass `null` to clear the reference when the window is destroyed.
 *
 * @param {import("electron").BrowserWindow|null} w - The new window instance.
 * @returns {void}
 */
function setWindow(w) {
  mainWindow = w;
}

// ─── Renderer messaging ───────────────────────────────────────────────────────

/**
 * Sends an IPC message to the renderer process on `channel`.
 *
 * Silently no-ops if the window is absent, destroyed, or if the renderer
 * frame has been disposed (e.g. during a reload), so callers do not need
 * defensive checks before every send.
 *
 * @param {string}    channel - IPC channel name.
 * @param {...unknown} args    - Arguments forwarded to `webContents.send`.
 * @returns {void}
 */
function sendToRenderer(channel, ...args) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  try {
    mainWindow.webContents.send(channel, ...args);
  } catch {
    // Renderer frame disposed during window init or reload — safe to ignore.
  }
}

// ─── Exports ──────────────────────────────────────────────────────────────────

module.exports = {
  ptys,
  ptyBuffers,
  ptyMeta,
  PTY_BUFFER_MAX,
  getNextId,
  appendPtyBuffer,
  getWindow,
  setWindow,
  sendToRenderer,
};
