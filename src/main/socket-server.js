"use strict";

/**
 * @module socket-server
 *
 * Unix domain socket server for CLI and MCP communication.
 *
 * Owns:
 *   - Creating and removing the per-process Unix socket file
 *   - Parsing newline-delimited JSON command frames from clients
 *   - Dispatching each `action` to its dedicated handler
 *   - The bidirectional streaming `attach` upgrade
 *   - Back-pressure / input-size limits on incoming connections
 *
 * Does NOT own:
 *   - PTY process lifecycle (see pty-manager.js)
 *   - Shared PTY state maps or ring-buffers (see state.js)
 *   - IPC handler registration for the renderer (see pty-manager.js)
 *
 * Protocol:
 *   Client sends a single newline-terminated JSON object (the "command frame").
 *   Server responds with a single JSON object then closes the connection,
 *   except for the `attach` action which upgrades to bidirectional raw streaming.
 */

const fs = require("fs");
const net = require("net");
const os = require("os");
const path = require("path");
const { log } = require("./utils");
const { ptys, ptyBuffers, getWindow } = require("./state");
const { getCwdForPty, getProcessForPty } = require("./pty-manager");

// ─── Constants ────────────────────────────────────────────────────────────────

/** Directory that holds all Shellfire runtime files, including sockets. */
const SOCKET_DIR = path.join(os.homedir(), ".shellfire");

/**
 * Unique socket path for this process instance.
 * Embedding `process.pid` ensures no two app instances collide.
 */
const SOCKET_PATH = path.join(SOCKET_DIR, `shellfire-${process.pid}.sock`);

/** Maximum incoming buffer size per connection (4 MiB). Prevents memory exhaustion. */
const MAX_BUFFER_BYTES = 4 * 1024 * 1024;

/** Maximum text payload accepted by the `send` action (1 MiB). */
const MAX_SEND_TEXT_BYTES = 1024 * 1024;

/** Maximum number of lines returnable by the `read` action. */
const MAX_READ_LINES = 2000;

/** Unix file permission bits applied to the socket: owner read/write only. */
const SOCKET_MODE = 0o600;

// ─── Module state ─────────────────────────────────────────────────────────────

/** The active `net.Server` instance, or `null` before `start()` is called. */
let socketServer = null;

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Sends a JSON-encoded response object and closes the connection.
 *
 * @param {net.Socket} conn     - The client socket to respond to.
 * @param {object}     payload  - JSON-serialisable response object.
 * @returns {void}
 */
function sendAndClose(conn, payload) {
  conn.end(JSON.stringify(payload));
}

/**
 * Sends a JSON error response and closes the connection.
 *
 * @param {net.Socket} conn    - The client socket to respond to.
 * @param {string}     message - Human-readable error message.
 * @returns {void}
 */
function sendError(conn, message) {
  sendAndClose(conn, { error: message });
}

/**
 * Resolves a session by name or numeric id string by executing a JavaScript
 * snippet in the renderer's window context.
 *
 * The renderer exposes `window.__panes` (a `Map<id, pane>`) that contains
 * the pane's `customName` and numeric id.
 *
 * @param {string|number} name - Pane name or numeric id (as a string or number).
 * @returns {Promise<{id: number, name: string}>} Resolved session descriptor.
 * @throws {Error} When no active window exists or the session is not found.
 */
async function resolveSession(name) {
  const win = getWindow();
  if (!win || win.isDestroyed()) throw new Error("No active window");

  // JSON.stringify produces a safe JS literal for injection into the script.
  const safeName = JSON.stringify(name);
  const result = await win.webContents.executeJavaScript(`
    (function() {
      const target = ${safeName};
      for (const [id, pane] of window.__panes || new Map()) {
        const n = pane.customName || "Terminal " + id;
        if (n === target || String(id) === target) return { id, name: n };
      }
      return { error: "Session not found: " + target };
    })()
  `);

  if (result.error) throw new Error(result.error);
  return result;
}

/**
 * Abbreviates a full path to use `~` in place of the home directory.
 *
 * @param {string} fullPath - Absolute filesystem path.
 * @returns {string} Path with the home directory prefix replaced by `~`.
 */
function tildePath(fullPath) {
  return fullPath.replace(os.homedir(), "~");
}

// ─── Action handlers ──────────────────────────────────────────────────────────

/**
 * Handles the `list` action.
 * Returns all open panes with their id, display name, active flag, CWD, and
 * foreground process.
 *
 * @param {object}     _cmd - Unused command object.
 * @param {net.Socket} conn - Client socket.
 * @param {import("electron").BrowserWindow} win - The active browser window.
 * @returns {Promise<void>}
 */
async function handleList(_cmd, conn, win) {
  const sessions = await win.webContents.executeJavaScript(`
    (function() {
      const r = [];
      for (const [id, pane] of window.__panes || new Map())
        r.push({ id, name: pane.customName || null, active: id === window.__activeId });
      return r;
    })()
  `);

  for (const s of sessions) {
    s.name = s.name || `Terminal ${s.id}`;
    try { s.cwd = tildePath(await getCwdForPty(s.id) || ""); } catch { s.cwd = null; }
    try { s.process = await getProcessForPty(s.id); } catch { s.process = null; }
  }

  sendAndClose(conn, { sessions });
}

/**
 * Handles the `attach` action.
 * Without `cmd.stream`, returns the resolved session descriptor and closes.
 * With `cmd.stream`, replays the PTY's output buffer then pipes the PTY's
 * data events to the socket and the socket's data events back to the PTY.
 *
 * @param {object}     cmd  - Command frame (expects `cmd.name`, optional `cmd.stream`).
 * @param {net.Socket} conn - Client socket.
 * @returns {Promise<void>}
 */
async function handleAttach(cmd, conn) {
  let resolved;
  try { resolved = await resolveSession(cmd.name); } catch (e) {
    sendError(conn, e.message); return;
  }

  if (!cmd.stream) { sendAndClose(conn, resolved); return; }

  const ptyProc = ptys.get(resolved.id);
  if (!ptyProc) { sendError(conn, "PTY not found"); return; }

  // Confirm attachment, then replay buffered output for tmux-like history.
  conn.write(JSON.stringify({ ok: true, id: resolved.id, name: resolved.name }) + "\n");
  const buf = ptyBuffers.get(resolved.id) || "";
  if (buf) conn.write(buf);

  // Bidirectional pipe — dispose the PTY listener on both close AND error.
  const dataHandler = ptyProc.onData((data) => { if (!conn.destroyed) conn.write(data); });
  const cleanup = () => { try { dataHandler.dispose(); } catch { /* already disposed */ } };
  conn.on("data", (chunk) => { if (!conn.destroyed) ptyProc.write(chunk.toString()); });
  conn.on("close", cleanup);
  conn.on("error", cleanup);
}

/**
 * Handles the `new` action.
 * Creates a new pane in the renderer with an optional working directory and
 * name, brings the window to the foreground, and returns the new pane's
 * id and display name.
 *
 * @param {object}     cmd - Command frame (optional `cmd.name`, `cmd.cwd`).
 * @param {net.Socket} conn - Client socket.
 * @param {import("electron").BrowserWindow} win - The active browser window.
 * @returns {Promise<void>}
 */
async function handleNew(cmd, conn, win) {
  const safeName = cmd.name ? JSON.stringify(cmd.name) : null;
  const safeCwd = cmd.cwd ? JSON.stringify(cmd.cwd) : null;

  const result = await win.webContents.executeJavaScript(`
    (async function() {
      const id = await window.__createPane(${safeCwd || "null"});
      ${safeName ? `
      const pane = (window.__panes || new Map()).get(id);
      if (pane) {
        pane.customName = ${safeName};
        pane._userRenamed = true;
        if (pane.titleEl) pane.titleEl.textContent = ${safeName};
      }` : ""}
      return { id, name: ${safeName || '"Terminal " + id'} };
    })()
  `);

  win.show();
  win.focus();
  sendAndClose(conn, result);
}

/**
 * Handles the `send` action.
 * Validates the text payload, resolves the target session, and writes the
 * text to the PTY.
 *
 * @param {object}     cmd  - Command frame (expects `cmd.text`, `cmd.name`).
 * @param {net.Socket} conn - Client socket.
 * @returns {Promise<void>}
 */
async function handleSend(cmd, conn) {
  if (typeof cmd.text !== "string") {
    sendError(conn, "text must be a string"); return;
  }
  if (cmd.text.length > MAX_SEND_TEXT_BYTES) {
    sendError(conn, `text too large (max ${MAX_SEND_TEXT_BYTES / 1024} KB)`); return;
  }

  let resolved;
  try { resolved = await resolveSession(cmd.name); } catch (e) {
    sendError(conn, e.message); return;
  }

  const p = ptys.get(resolved.id);
  if (!p) { sendError(conn, `PTY not found for session ${resolved.id}`); return; }

  p.write(cmd.text);
  sendAndClose(conn, resolved);
}

/**
 * Handles the `kill` action.
 * Resolves the target session and removes its terminal via the renderer.
 *
 * @param {object}     cmd  - Command frame (expects `cmd.name`).
 * @param {net.Socket} conn - Client socket.
 * @param {import("electron").BrowserWindow} win - The active browser window.
 * @returns {Promise<void>}
 */
async function handleKill(cmd, conn, win) {
  let resolved;
  try { resolved = await resolveSession(cmd.name); } catch (e) {
    sendError(conn, e.message); return;
  }

  await win.webContents.executeJavaScript(`
    (function() { window.__removeTerminal && window.__removeTerminal(${resolved.id}); })()
  `);
  sendAndClose(conn, resolved);
}

/**
 * Handles the `rename` action.
 * Validates the new name, resolves the session, and updates the pane's
 * display name in the renderer.
 *
 * @param {object}     cmd  - Command frame (expects `cmd.name`, `cmd.newName`).
 * @param {net.Socket} conn - Client socket.
 * @param {import("electron").BrowserWindow} win - The active browser window.
 * @returns {Promise<void>}
 */
async function handleRename(cmd, conn, win) {
  if (typeof cmd.newName !== "string" || !cmd.newName.trim()) {
    sendError(conn, "newName must be a non-empty string"); return;
  }

  let resolved;
  try { resolved = await resolveSession(cmd.name); } catch (e) {
    sendError(conn, e.message); return;
  }

  const safeNew = JSON.stringify(cmd.newName.trim());
  const result = await win.webContents.executeJavaScript(`
    (function() {
      const pane = (window.__panes || new Map()).get(${resolved.id});
      if (!pane) return { error: "Pane not found" };
      pane.customName = ${safeNew};
      pane._userRenamed = true;
      if (pane.titleEl) pane.titleEl.textContent = ${safeNew};
      return { id: ${resolved.id}, name: ${safeNew} };
    })()
  `);

  sendAndClose(conn, result);
}

/**
 * Handles the `read` action.
 * Returns the buffered output for a session, optionally limited to the last
 * `cmd.lines` lines (capped at {@link MAX_READ_LINES}).
 *
 * @param {object}     cmd  - Command frame (expects `cmd.name`, optional `cmd.lines`).
 * @param {net.Socket} conn - Client socket.
 * @returns {Promise<void>}
 */
async function handleRead(cmd, conn) {
  let resolved;
  try { resolved = await resolveSession(cmd.name); } catch (e) {
    sendError(conn, e.message); return;
  }

  let buf = ptyBuffers.get(resolved.id) || "";

  const lineLimit = resolveLineLimit(cmd.lines);
  if (lineLimit !== null) {
    buf = buf.split("\n").slice(-lineLimit).join("\n");
  }

  sendAndClose(conn, { id: resolved.id, name: resolved.name, output: buf });
}

/**
 * Parses and clamps the `lines` field from a `read` command.
 * Returns `null` when the value is absent or invalid (meaning "no limit").
 *
 * @param {unknown} lines - Raw value from the command frame.
 * @returns {number|null} Clamped integer line count, or `null`.
 */
function resolveLineLimit(lines) {
  if (typeof lines !== "number" || !Number.isFinite(lines) || lines <= 0) return null;
  return Math.min(Math.floor(lines), MAX_READ_LINES);
}

// ─── Command dispatcher ───────────────────────────────────────────────────────

/**
 * Validates and dispatches a parsed command frame to the appropriate action
 * handler. Sends an error response for malformed or unknown commands.
 *
 * @param {unknown}    cmd  - Parsed JSON value from the client.
 * @param {net.Socket} conn - Client socket.
 * @returns {Promise<void>}
 */
async function handleCommand(cmd, conn) {
  if (!cmd || typeof cmd !== "object" || typeof cmd.action !== "string") {
    sendError(conn, "Malformed command"); return;
  }

  const win = getWindow();
  if (!win || win.isDestroyed()) {
    sendError(conn, "No active window"); return;
  }

  switch (cmd.action) {
    case "list":   await handleList(cmd, conn, win);   break;
    case "attach": await handleAttach(cmd, conn);      break;
    case "new":    await handleNew(cmd, conn, win);    break;
    case "send":   await handleSend(cmd, conn);        break;
    case "kill":   await handleKill(cmd, conn, win);   break;
    case "rename": await handleRename(cmd, conn, win); break;
    case "read":   await handleRead(cmd, conn);        break;
    default:
      sendError(conn, `Unknown action: ${cmd.action}`);
  }
}

// ─── Connection handler ───────────────────────────────────────────────────────

/**
 * Handles a new incoming Unix socket connection.
 * Buffers incoming data until a newline delimiter is found, then parses the
 * first line as a JSON command and dispatches it. After the first command is
 * dispatched the `data` listener is removed (streaming is managed by
 * individual action handlers if needed).
 *
 * @param {net.Socket} conn - The newly accepted client socket.
 * @returns {void}
 */
function handleConnection(conn) {
  let buf = "";
  let dispatched = false;

  conn.on("data", (chunk) => {
    if (dispatched) return; // Attach action takes over the stream from here.

    buf += chunk.toString();

    if (buf.length > MAX_BUFFER_BYTES) {
      sendError(conn, "Request too large"); return;
    }

    const newlineIdx = buf.indexOf("\n");
    if (newlineIdx === -1) return; // Wait for more data.

    dispatched = true;
    const line = buf.slice(0, newlineIdx).trim();

    let cmd;
    try { cmd = JSON.parse(line); } catch {
      sendError(conn, "Invalid JSON"); return;
    }

    handleCommand(cmd, conn).catch((err) => {
      try { sendError(conn, err.message); } catch {
        // Socket may already be closed — ignore secondary error.
      }
    });
  });

  conn.on("error", (err) => log("error", "Socket connection error:", err.message));
}

// ─── Server lifecycle ─────────────────────────────────────────────────────────

/**
 * Ensures the socket directory exists, removes any stale socket file from a
 * previous run, starts the `net.Server`, and sets restrictive permissions on
 * the socket file once it is bound.
 *
 * @returns {void}
 */
function start() {
  if (!fs.existsSync(SOCKET_DIR)) {
    fs.mkdirSync(SOCKET_DIR, { recursive: true });
  }

  // Remove a leftover socket from a previous crash so `listen` succeeds.
  try { fs.unlinkSync(SOCKET_PATH); } catch {
    // File not present — this is the normal case on first start.
  }

  socketServer = net.createServer(handleConnection);

  socketServer.listen(SOCKET_PATH, () => {
    log("info", `Socket server listening on ${SOCKET_PATH}`);
    // Restrict access to the socket owner only (prevents other users on the system
    // from sending commands to this app instance).
    try { fs.chmodSync(SOCKET_PATH, SOCKET_MODE); } catch {
      log("warn", "Failed to set socket file permissions — socket may be world-readable");
    }
  });

  socketServer.on("error", (err) => log("error", "Socket server error:", err));
}

/**
 * Closes the server and removes the socket file.
 * Called during app shutdown to avoid stale socket files on disk.
 *
 * @returns {void}
 */
function cleanup() {
  try { if (socketServer) socketServer.close(); } catch {
    // Server may not be listening — ignore.
  }
  try { fs.unlinkSync(SOCKET_PATH); } catch {
    // File may have already been removed — ignore.
  }
}

// ─── Exports ──────────────────────────────────────────────────────────────────

module.exports = { start, cleanup, SOCKET_PATH };
