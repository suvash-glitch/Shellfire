#!/usr/bin/env node
"use strict";

/**
 * Shellfire MCP Server
 *
 * Exposes Shellfire terminal sessions to any Claude instance via the
 * Model Context Protocol (stdio/JSON-RPC 2.0).
 *
 * Tools:
 *   shellfire_list    — list all active terminal sessions
 *   shellfire_read    — read scrollback output from a session
 *   shellfire_send    — send text/commands to a session
 *   shellfire_new     — create a new terminal session
 *   shellfire_kill    — kill a terminal session
 *   shellfire_rename  — rename a terminal session
 *
 * Setup (add to Claude Code settings.json):
 *   {
 *     "mcpServers": {
 *       "shellfire": {
 *         "command": "node",
 *         "args": ["/path/to/Shellfire/mcp/shellfire-mcp.js"]
 *       }
 *     }
 *   }
 */

const net = require("net");
const path = require("path");
const os = require("os");
const fs = require("fs");
const readline = require("readline");

// ============================================================
// Socket communication with the running Shellfire app
// ============================================================

const SOCKET_DIR = path.join(os.homedir(), ".shellfire");

function findSocketPath() {
  if (!fs.existsSync(SOCKET_DIR)) return null;
  const socks = fs.readdirSync(SOCKET_DIR)
    .filter(f => f.startsWith("shellfire-") && f.endsWith(".sock"))
    .map(f => ({
      path: path.join(SOCKET_DIR, f),
      mtime: fs.statSync(path.join(SOCKET_DIR, f)).mtimeMs,
    }))
    .sort((a, b) => b.mtime - a.mtime);
  const legacy = path.join(SOCKET_DIR, "shellfire.sock");
  if (fs.existsSync(legacy)) socks.push({ path: legacy, mtime: 0 });
  return socks.length > 0 ? socks[0].path : null;
}

function sendCommand(cmd) {
  return new Promise((resolve, reject) => {
    const socketPath = findSocketPath();
    if (!socketPath || !fs.existsSync(socketPath)) {
      reject(new Error("Shellfire is not running. Open the Shellfire app first."));
      return;
    }

    const client = net.createConnection(socketPath, () => {
      client.write(JSON.stringify(cmd) + "\n");
    });

    let data = "";
    client.on("data", chunk => { data += chunk.toString(); });
    client.on("end", () => {
      try { resolve(JSON.parse(data)); }
      catch { reject(new Error("Invalid JSON response from Shellfire")); }
    });
    client.on("error", err => {
      if (err.code === "ECONNREFUSED" || err.code === "ENOENT") {
        reject(new Error("Shellfire is not running. Open the Shellfire app first."));
      } else {
        reject(err);
      }
    });
    setTimeout(() => { client.destroy(); reject(new Error("Connection timed out after 5s")); }, 5000);
  });
}

// ============================================================
// ANSI escape code stripper
// ============================================================

// eslint-disable-next-line no-control-regex
const ANSI_RE = /\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~]|\][^\x07\x1B]*(?:\x07|\x1B\\))/g;

function stripAnsi(str) {
  return str.replace(ANSI_RE, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

// ============================================================
// Tool definitions
// ============================================================

const TOOLS = [
  {
    name: "shellfire_list",
    description: "List all active Shellfire terminal sessions. Returns each session's ID, name, working directory, current process, and whether it is the focused pane.",
    inputSchema: {
      type: "object",
      properties: {},
      required: [],
    },
  },
  {
    name: "shellfire_read",
    description: "Read the scrollback output buffer of a Shellfire terminal session. Returns plain text (ANSI escape codes stripped). Useful for inspecting what is running or recently ran in a terminal. Use the 'lines' parameter to limit how many trailing lines are returned (default: 200).",
    inputSchema: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description: "Session name or numeric ID (from shellfire_list)",
        },
        lines: {
          type: "number",
          description: "How many lines from the end of the scrollback to return (default: 200, max: 2000)",
        },
      },
      required: ["name"],
    },
  },
  {
    name: "shellfire_send",
    description: "Send text or a command to a Shellfire terminal session as keyboard input. The text is written directly to the session's PTY. To execute a command, include a trailing newline (\\n) — otherwise the text is typed but not submitted.",
    inputSchema: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description: "Session name or numeric ID (from shellfire_list)",
        },
        text: {
          type: "string",
          description: "Text to send. To run a command, end with \\n (e.g. \"ls -la\\n\").",
        },
      },
      required: ["name", "text"],
    },
  },
  {
    name: "shellfire_new",
    description: "Create a new Shellfire terminal session. Returns the new session's name and ID.",
    inputSchema: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description: "Optional name for the new session",
        },
        dir: {
          type: "string",
          description: "Optional working directory for the new session (e.g. ~/projects/api)",
        },
      },
      required: [],
    },
  },
  {
    name: "shellfire_kill",
    description: "Kill (close) a Shellfire terminal session by name or ID. The PTY process will be terminated.",
    inputSchema: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description: "Session name or numeric ID to kill",
        },
      },
      required: ["name"],
    },
  },
  {
    name: "shellfire_rename",
    description: "Rename a Shellfire terminal session.",
    inputSchema: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description: "Current session name or numeric ID",
        },
        newName: {
          type: "string",
          description: "New name for the session",
        },
      },
      required: ["name", "newName"],
    },
  },
];

// ============================================================
// Tool handler
// ============================================================

async function handleToolCall(toolName, args) {
  switch (toolName) {

    case "shellfire_list": {
      const result = await sendCommand({ action: "list" });
      if (result.error) throw new Error(result.error);
      const sessions = result.sessions || [];
      if (sessions.length === 0) return "No active Shellfire sessions.";
      const rows = sessions.map(s => {
        const focus = s.active ? "* " : "  ";
        const cwd = s.cwd ? `  cwd:${s.cwd}` : "";
        const proc = s.process ? `  [${s.process}]` : "";
        return `${focus}[${s.id}] ${s.name}${cwd}${proc}`;
      });
      return `Active Shellfire sessions (* = focused):\n${rows.join("\n")}`;
    }

    case "shellfire_read": {
      const lines = Math.min(Number(args.lines) || 200, 2000);
      const result = await sendCommand({ action: "read", name: String(args.name), lines });
      if (result.error) throw new Error(result.error);
      const clean = stripAnsi(result.output || "");
      if (!clean.trim()) return `Session "${result.name}" scrollback buffer is empty.`;
      return `=== "${result.name}" — last ${lines} lines ===\n${clean}`;
    }

    case "shellfire_send": {
      const text = String(args.text);
      const result = await sendCommand({ action: "send", name: String(args.name), text });
      if (result.error) throw new Error(result.error);
      return `Sent ${JSON.stringify(text)} to session "${result.name}".`;
    }

    case "shellfire_new": {
      const cmd = { action: "new" };
      if (args.name) cmd.name = String(args.name);
      if (args.dir) cmd.cwd = String(args.dir);
      const result = await sendCommand(cmd);
      if (result.error) throw new Error(result.error);
      return `Created session "${result.name}" (id: ${result.id}).`;
    }

    case "shellfire_kill": {
      const result = await sendCommand({ action: "kill", name: String(args.name) });
      if (result.error) throw new Error(result.error);
      return `Killed session "${result.name}" (id: ${result.id}).`;
    }

    case "shellfire_rename": {
      const result = await sendCommand({
        action: "rename",
        name: String(args.name),
        newName: String(args.newName),
      });
      if (result.error) throw new Error(result.error);
      return `Renamed session to "${result.name}".`;
    }

    default:
      throw new Error(`Unknown tool: ${toolName}`);
  }
}

// ============================================================
// MCP JSON-RPC 2.0 stdio loop
// ============================================================

function respond(id, result) {
  process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, result }) + "\n");
}

function respondError(id, code, message) {
  process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, error: { code, message } }) + "\n");
}

async function handleRequest(request) {
  const { id, method, params } = request;

  // Notifications have no id — handle silently
  if (id === undefined || id === null) return;

  try {
    switch (method) {

      case "initialize":
        respond(id, {
          protocolVersion: "2024-11-05",
          capabilities: { tools: {} },
          serverInfo: { name: "shellfire", version: "2.0.0" },
        });
        break;

      case "tools/list":
        respond(id, { tools: TOOLS });
        break;

      case "tools/call": {
        const toolName = params && params.name;
        const toolArgs = (params && params.arguments) || {};
        if (!toolName) {
          respondError(id, -32602, "Missing tool name");
          break;
        }
        const text = await handleToolCall(toolName, toolArgs);
        respond(id, { content: [{ type: "text", text }] });
        break;
      }

      case "ping":
        respond(id, {});
        break;

      default:
        respondError(id, -32601, `Method not found: ${method}`);
    }
  } catch (err) {
    // Tool errors go back as content with isError so Claude sees the message
    respond(id, {
      content: [{ type: "text", text: `Error: ${err.message}` }],
      isError: true,
    });
  }
}

// Track in-flight async requests so we don't exit while they're pending.
let pendingCount = 0;
let stdinEnded = false;

function maybeExit() {
  if (stdinEnded && pendingCount === 0) process.exit(0);
}

const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });

rl.on("line", (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;

  let request;
  try {
    request = JSON.parse(trimmed);
  } catch {
    process.stdout.write(JSON.stringify({
      jsonrpc: "2.0", id: null,
      error: { code: -32700, message: "Parse error" },
    }) + "\n");
    return;
  }

  pendingCount++;
  handleRequest(request).finally(() => {
    pendingCount--;
    maybeExit();
  });
});

rl.on("close", () => {
  stdinEnded = true;
  maybeExit();
});

process.stderr.write("[shellfire-mcp] Server started. Waiting for Shellfire app...\n");
