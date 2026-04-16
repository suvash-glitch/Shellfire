"use strict";

// ============================================================
// SOCKET SERVER
// Unix socket multiplexer for CLI & MCP communication.
// Protocol: newline-delimited JSON request → JSON response.
// The "attach" action upgrades to bidirectional raw streaming.
// ============================================================

const fs = require("fs");
const net = require("net");
const os = require("os");
const path = require("path");
const { log } = require("./utils");
const { ptys, ptyBuffers, getWindow } = require("./state");
const { getCwdForPty, getProcessForPty } = require("./pty-manager");

const SOCKET_DIR = path.join(os.homedir(), ".shellfire");
const SOCKET_PATH = path.join(SOCKET_DIR, `shellfire-${process.pid}.sock`);
let socketServer = null;

// ── Session lookup via renderer __panes ──────────────────────

async function resolveSession(name) {
  const win = getWindow();
  if (!win || win.isDestroyed()) throw new Error("No active window");
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

// ── Command handlers ─────────────────────────────────────────

async function handleCommand(cmd, conn) {
  // Basic structural validation — malformed commands must not reach the switch
  if (!cmd || typeof cmd !== "object" || typeof cmd.action !== "string") {
    conn.end(JSON.stringify({ error: "Malformed command" }));
    return;
  }

  const win = getWindow();
  if (!win || win.isDestroyed()) {
    conn.end(JSON.stringify({ error: "No active window" }));
    return;
  }

  switch (cmd.action) {
    case "list": {
      const sessions = await win.webContents.executeJavaScript(`
        (function() {
          const r = [];
          for (const [id, pane] of window.__panes || new Map())
            r.push({ id, name: pane.customName || null, active: id === window.__activeId });
          return r;
        })()
      `);
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
      let resolved;
      try { resolved = await resolveSession(cmd.name); } catch (e) {
        conn.end(JSON.stringify({ error: e.message })); break;
      }
      if (!cmd.stream) { conn.end(JSON.stringify(resolved)); break; }

      const ptyProc = ptys.get(resolved.id);
      if (!ptyProc) { conn.end(JSON.stringify({ error: "PTY not found" })); break; }

      conn.write(JSON.stringify({ ok: true, id: resolved.id, name: resolved.name }) + "\n");
      // Replay buffered output so the attaching client sees history
      const buf = ptyBuffers.get(resolved.id) || "";
      if (buf) conn.write(buf);
      // Bidirectional pipe — dispose listener on both close AND error
      const dataHandler = ptyProc.onData(data => { if (!conn.destroyed) conn.write(data); });
      const cleanup = () => { try { dataHandler.dispose(); } catch {} };
      conn.on("data", chunk => { if (!conn.destroyed) ptyProc.write(chunk.toString()); });
      conn.on("close", cleanup);
      conn.on("error", cleanup);
      break;
    }

    case "new": {
      const safeName = cmd.name ? JSON.stringify(cmd.name) : null;
      const safeCwd = cmd.cwd ? JSON.stringify(cmd.cwd) : null;
      const result = await win.webContents.executeJavaScript(`
        (async function() {
          const id = await window.__createPane(${safeCwd || "null"});
          ${safeName ? `const pane = (window.__panes||new Map()).get(id);
          if (pane) { pane.customName=${safeName}; pane._userRenamed=true; if(pane.titleEl) pane.titleEl.textContent=${safeName}; }` : ""}
          return { id, name: ${safeName || '"Terminal " + id'} };
        })()
      `);
      win.show(); win.focus();
      conn.end(JSON.stringify(result));
      break;
    }

    case "send": {
      if (typeof cmd.text !== "string") { conn.end(JSON.stringify({ error: "text must be a string" })); break; }
      if (cmd.text.length > 1024 * 1024) { conn.end(JSON.stringify({ error: "text too large (max 1 MB)" })); break; }
      let resolved;
      try { resolved = await resolveSession(cmd.name); } catch (e) {
        conn.end(JSON.stringify({ error: e.message })); break;
      }
      const p = ptys.get(resolved.id);
      if (!p) { conn.end(JSON.stringify({ error: "PTY not found for session " + resolved.id })); break; }
      p.write(cmd.text);
      conn.end(JSON.stringify(resolved));
      break;
    }

    case "kill": {
      let resolved;
      try { resolved = await resolveSession(cmd.name); } catch (e) {
        conn.end(JSON.stringify({ error: e.message })); break;
      }
      await win.webContents.executeJavaScript(`
        (function() { window.__removeTerminal && window.__removeTerminal(${resolved.id}); })()
      `);
      conn.end(JSON.stringify(resolved));
      break;
    }

    case "rename": {
      if (typeof cmd.newName !== "string" || !cmd.newName.trim()) {
        conn.end(JSON.stringify({ error: "newName must be a non-empty string" })); break;
      }
      let resolved;
      try { resolved = await resolveSession(cmd.name); } catch (e) {
        conn.end(JSON.stringify({ error: e.message })); break;
      }
      const safeNew = JSON.stringify(cmd.newName.trim());
      const result = await win.webContents.executeJavaScript(`
        (function() {
          const pane = (window.__panes||new Map()).get(${resolved.id});
          if (!pane) return { error: "Pane not found" };
          pane.customName=${safeNew}; pane._userRenamed=true;
          if (pane.titleEl) pane.titleEl.textContent=${safeNew};
          return { id: ${resolved.id}, name: ${safeNew} };
        })()
      `);
      conn.end(JSON.stringify(result));
      break;
    }

    case "read": {
      let resolved;
      try { resolved = await resolveSession(cmd.name); } catch (e) {
        conn.end(JSON.stringify({ error: e.message })); break;
      }
      let buf = ptyBuffers.get(resolved.id) || "";
      const lineLimit = typeof cmd.lines === "number" && Number.isFinite(cmd.lines) && cmd.lines > 0
        ? Math.min(Math.floor(cmd.lines), 2000)
        : null;
      if (lineLimit !== null) {
        const all = buf.split("\n");
        buf = all.slice(-lineLimit).join("\n");
      }
      conn.end(JSON.stringify({ id: resolved.id, name: resolved.name, output: buf }));
      break;
    }

    default:
      conn.end(JSON.stringify({ error: `Unknown action: ${cmd.action}` }));
  }
}

// ── Server lifecycle ─────────────────────────────────────────

function start() {
  if (!fs.existsSync(SOCKET_DIR)) fs.mkdirSync(SOCKET_DIR, { recursive: true });
  try { fs.unlinkSync(SOCKET_PATH); } catch {}

  socketServer = net.createServer((conn) => {
    let buf = "";
    const MAX_BUF = 4 * 1024 * 1024; // 4 MB — prevents memory exhaustion from slow/malicious clients
    let streaming = false;
    conn.on("data", (chunk) => {
      if (streaming) return;
      buf += chunk.toString();
      if (buf.length > MAX_BUF) {
        conn.end(JSON.stringify({ error: "Request too large" }));
        return;
      }
      const idx = buf.indexOf("\n");
      if (idx === -1) return;
      streaming = true;
      const line = buf.slice(0, idx).trim();
      let cmd;
      try { cmd = JSON.parse(line); } catch {
        conn.end(JSON.stringify({ error: "Invalid JSON" }));
        return;
      }
      handleCommand(cmd, conn).catch(err => {
        try { conn.end(JSON.stringify({ error: err.message })); } catch {}
      });
    });
    conn.on("error", err => log("error", "Socket connection error:", err.message));
  });

  socketServer.listen(SOCKET_PATH, () => {
    log("info", `Socket server listening on ${SOCKET_PATH}`);
    try { fs.chmodSync(SOCKET_PATH, 0o600); } catch {}
  });
  socketServer.on("error", err => log("error", "Socket server error:", err));
}

function cleanup() {
  try { if (socketServer) socketServer.close(); } catch {}
  try { fs.unlinkSync(SOCKET_PATH); } catch {}
}

module.exports = { start, cleanup, SOCKET_PATH };
