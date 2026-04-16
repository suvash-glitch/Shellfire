#!/usr/bin/env node
"use strict";

/**
 * @file shellfire-mcp.js
 * @description MCP (Model Context Protocol) server for Shellfire.
 *
 * Exposes Shellfire terminal sessions to any Claude instance via JSON-RPC 2.0
 * over stdio so Claude Code can list, read, write to, create, kill, and rename
 * terminal panes without leaving the conversation.
 *
 * Owns:
 *   - JSON-RPC 2.0 framing (parse, dispatch, respond, error)
 *   - Unix-socket client that forwards commands to the running Shellfire app
 *   - ANSI escape code stripping for clean text output
 *   - MCP tool definitions and their handlers
 *
 * Does NOT own:
 *   - PTY management (belongs to Shellfire's main-process pty-manager.js)
 *   - Session persistence (belongs to Shellfire's main-process storage.js)
 *
 * Setup — add to Claude Code settings.json:
 * @example
 * {
 *   "mcpServers": {
 *     "shellfire": {
 *       "command": "node",
 *       "args": ["/path/to/shellfire/mcp/shellfire-mcp.js"]
 *     }
 *   }
 * }
 *
 * Tools exposed:
 *   shellfire_list    — list all active terminal sessions
 *   shellfire_read    — read scrollback output from a session
 *   shellfire_send    — send text/commands to a session
 *   shellfire_new     — create a new terminal session
 *   shellfire_kill    — kill a terminal session
 *   shellfire_rename  — rename a terminal session
 */

const net      = require("net");
const path     = require("path");
const os       = require("os");
const fs       = require("fs");
const readline = require("readline");

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

/** Directory that holds all Shellfire runtime files, including Unix sockets. */
const SOCKET_DIR = path.join(os.homedir(), ".shellfire");

/** Prefix used by timestamped socket files created by the Shellfire main process. */
const SOCKET_PREFIX = "shellfire-";

/** Extension used by timestamped socket files created by the Shellfire main process. */
const SOCKET_SUFFIX = ".sock";

/** Fallback socket path used by older Shellfire builds. */
const LEGACY_SOCKET = path.join(SOCKET_DIR, "shellfire.sock");

/** Milliseconds before an unresponsive socket connection is abandoned. */
const SOCKET_TIMEOUT_MS = 5000;

/** Default number of trailing scrollback lines returned by shellfire_read. */
const DEFAULT_READ_LINES = 200;

/** Maximum number of trailing scrollback lines the caller may request. */
const MAX_READ_LINES = 2000;

/** MCP protocol version advertised during the `initialize` handshake. */
const MCP_PROTOCOL_VERSION = "2024-11-05";

/** Name and version reported in the `initialize` response `serverInfo` field. */
const SERVER_NAME    = "shellfire";
const SERVER_VERSION = "2.0.0";

// JSON-RPC 2.0 error codes
const RPC_PARSE_ERROR    = -32700;
const RPC_METHOD_NOT_FOUND = -32601;
const RPC_INVALID_PARAMS = -32602;

// ─────────────────────────────────────────────────────────────────────────────
// Socket communication — finds the running Shellfire app and sends a command
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Finds the most-recently-modified Shellfire Unix socket in `~/.shellfire/`.
 * Falls back to the legacy `shellfire.sock` path if no timestamped sockets exist.
 *
 * @returns {string|null} Absolute path to the socket file, or `null` if none found.
 */
function findSocketPath() {
  if (!fs.existsSync(SOCKET_DIR)) return null;

  const timestamped = fs.readdirSync(SOCKET_DIR)
    .filter((f) => f.startsWith(SOCKET_PREFIX) && f.endsWith(SOCKET_SUFFIX))
    .map((f) => {
      const abs = path.join(SOCKET_DIR, f);
      return { path: abs, mtime: fs.statSync(abs).mtimeMs };
    })
    .sort((a, b) => b.mtime - a.mtime); // newest first

  if (fs.existsSync(LEGACY_SOCKET)) {
    timestamped.push({ path: LEGACY_SOCKET, mtime: 0 });
  }

  return timestamped.length > 0 ? timestamped[0].path : null;
}

/**
 * Connects to the running Shellfire app over its Unix domain socket,
 * sends a JSON command object, waits for the full JSON response, then resolves.
 *
 * @param {object} cmd - Command object to serialise and send (e.g. `{ action: "list" }`).
 * @returns {Promise<object>} Parsed JSON response from the Shellfire main process.
 * @throws {Error} If Shellfire is not running, the connection times out, or the
 *                 response is not valid JSON.
 */
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

    let raw = "";
    client.on("data", (chunk) => { raw += chunk.toString(); });

    client.on("end", () => {
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error("Invalid JSON response from Shellfire"));
      }
    });

    client.on("error", (err) => {
      if (err.code === "ECONNREFUSED" || err.code === "ENOENT") {
        reject(new Error("Shellfire is not running. Open the Shellfire app first."));
      } else {
        reject(err);
      }
    });

    setTimeout(() => {
      client.destroy();
      reject(new Error(`Connection timed out after ${SOCKET_TIMEOUT_MS / 1000}s`));
    }, SOCKET_TIMEOUT_MS);
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// ANSI escape code stripper
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Regex that matches all standard ANSI / VT100 escape sequences, including:
 *   - C1 control codes (ESC + single char)
 *   - CSI sequences (ESC [ ... final)
 *   - OSC sequences (ESC ] ... BEL or ST)
 */
// eslint-disable-next-line no-control-regex
const ANSI_RE = /\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~]|\][^\x07\x1B]*(?:\x07|\x1B\\))/g;

/**
 * Removes all ANSI escape codes from `str` and normalises line endings to `\n`.
 *
 * @param {string} str - Raw terminal output that may contain escape sequences.
 * @returns {string} Clean plain text with all ANSI codes removed.
 */
function stripAnsi(str) {
  return str
    .replace(ANSI_RE, "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n");
}

// ─────────────────────────────────────────────────────────────────────────────
// MCP tool definitions
// Each entry is sent verbatim in the `tools/list` response.
// ─────────────────────────────────────────────────────────────────────────────

/** @type {Array<object>} Complete MCP tool manifest. */
const TOOLS = [
  {
    name: "shellfire_list",
    description:
      "List all active Shellfire terminal sessions. Returns each session's ID, " +
      "name, working directory, current process, and whether it is the focused pane.",
    inputSchema: {
      type: "object",
      properties: {},
      required: [],
    },
  },
  {
    name: "shellfire_read",
    description:
      "Read the scrollback output buffer of a Shellfire terminal session. " +
      "Returns plain text (ANSI escape codes stripped). Useful for inspecting " +
      "what is running or recently ran in a terminal. " +
      "Use the 'lines' parameter to limit how many trailing lines are returned " +
      `(default: ${DEFAULT_READ_LINES}).`,
    inputSchema: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description: "Session name or numeric ID (from shellfire_list)",
        },
        lines: {
          type: "number",
          description:
            `How many lines from the end of the scrollback to return ` +
            `(default: ${DEFAULT_READ_LINES}, max: ${MAX_READ_LINES})`,
        },
      },
      required: ["name"],
    },
  },
  {
    name: "shellfire_send",
    description:
      "Send text or a command to a Shellfire terminal session as keyboard input. " +
      "The text is written directly to the session's PTY. " +
      "To execute a command, include a trailing newline (\\n) — " +
      "otherwise the text is typed but not submitted.",
    inputSchema: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description: "Session name or numeric ID (from shellfire_list)",
        },
        text: {
          type: "string",
          description:
            'Text to send. To run a command, end with \\n (e.g. "ls -la\\n").',
        },
      },
      required: ["name", "text"],
    },
  },
  {
    name: "shellfire_new",
    description:
      "Create a new Shellfire terminal session. Returns the new session's name and ID.",
    inputSchema: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description: "Optional name for the new session",
        },
        dir: {
          type: "string",
          description:
            "Optional working directory for the new session (e.g. ~/projects/api)",
        },
      },
      required: [],
    },
  },
  {
    name: "shellfire_kill",
    description:
      "Kill (close) a Shellfire terminal session by name or ID. " +
      "The PTY process will be terminated.",
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

// ─────────────────────────────────────────────────────────────────────────────
// Tool handlers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Dispatches a validated tool call to the appropriate handler and returns the
 * plain-text result string that will be wrapped in an MCP content block.
 *
 * @param {string} toolName - One of the tool names defined in `TOOLS`.
 * @param {object} args     - Arguments object from the MCP `tools/call` request.
 * @returns {Promise<string>} Human-readable result text for the caller.
 * @throws {Error} On Shellfire IPC errors, unknown tool names, or app-not-running.
 */
async function handleToolCall(toolName, args) {
  switch (toolName) {

    // ── shellfire_list ───────────────────────────────────────────────────────
    case "shellfire_list": {
      const result = await sendCommand({ action: "list" });
      if (result.error) throw new Error(result.error);

      const sessions = result.sessions || [];
      if (sessions.length === 0) return "No active Shellfire sessions.";

      const rows = sessions.map((s) => {
        const focus = s.active ? "* " : "  ";
        const cwd   = s.cwd     ? `  cwd:${s.cwd}`       : "";
        const proc  = s.process ? `  [${s.process}]`      : "";
        return `${focus}[${s.id}] ${s.name}${cwd}${proc}`;
      });

      return `Active Shellfire sessions (* = focused):\n${rows.join("\n")}`;
    }

    // ── shellfire_read ───────────────────────────────────────────────────────
    case "shellfire_read": {
      const lines  = Math.min(Number(args.lines) || DEFAULT_READ_LINES, MAX_READ_LINES);
      const result = await sendCommand({ action: "read", name: String(args.name), lines });
      if (result.error) throw new Error(result.error);

      const clean = stripAnsi(result.output || "");
      if (!clean.trim()) return `Session "${result.name}" scrollback buffer is empty.`;
      return `=== "${result.name}" — last ${lines} lines ===\n${clean}`;
    }

    // ── shellfire_send ───────────────────────────────────────────────────────
    case "shellfire_send": {
      const text   = String(args.text);
      const result = await sendCommand({ action: "send", name: String(args.name), text });
      if (result.error) throw new Error(result.error);
      return `Sent ${JSON.stringify(text)} to session "${result.name}".`;
    }

    // ── shellfire_new ────────────────────────────────────────────────────────
    case "shellfire_new": {
      const cmd = { action: "new" };
      if (args.name) cmd.name = String(args.name);
      if (args.dir)  cmd.cwd  = String(args.dir);

      const result = await sendCommand(cmd);
      if (result.error) throw new Error(result.error);
      return `Created session "${result.name}" (id: ${result.id}).`;
    }

    // ── shellfire_kill ───────────────────────────────────────────────────────
    case "shellfire_kill": {
      const result = await sendCommand({ action: "kill", name: String(args.name) });
      if (result.error) throw new Error(result.error);
      return `Killed session "${result.name}" (id: ${result.id}).`;
    }

    // ── shellfire_rename ─────────────────────────────────────────────────────
    case "shellfire_rename": {
      const result = await sendCommand({
        action:  "rename",
        name:    String(args.name),
        newName: String(args.newName),
      });
      if (result.error) throw new Error(result.error);
      return `Renamed session to "${result.name}".`;
    }

    default:
      throw new Error(`Unknown tool: ${toolName}`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// JSON-RPC 2.0 response helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Writes a successful JSON-RPC 2.0 response to stdout.
 *
 * @param {string|number|null} id     - The request `id` to echo back.
 * @param {object|Array}       result - The result payload.
 * @returns {void}
 */
function respond(id, result) {
  process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, result }) + "\n");
}

/**
 * Writes a JSON-RPC 2.0 error response to stdout.
 *
 * @param {string|number|null} id      - The request `id` to echo back.
 * @param {number}             code    - JSON-RPC error code (e.g. -32601).
 * @param {string}             message - Human-readable error description.
 * @returns {void}
 */
function respondError(id, code, message) {
  process.stdout.write(
    JSON.stringify({ jsonrpc: "2.0", id, error: { code, message } }) + "\n"
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Request dispatcher
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Handles a single parsed JSON-RPC 2.0 request object.
 * Notifications (requests with no `id`) are silently ignored per the spec.
 *
 * @param {object}           request          - Parsed JSON-RPC request.
 * @param {string|number|null} request.id     - Request identifier (absent for notifications).
 * @param {string}           request.method   - RPC method name.
 * @param {object|undefined} request.params   - Method parameters.
 * @returns {Promise<void>}
 */
async function handleRequest(request) {
  const { id, method, params } = request;

  // Per JSON-RPC 2.0 spec: notifications have no id and require no response.
  if (id === undefined || id === null) return;

  try {
    switch (method) {

      // ── MCP handshake ───────────────────────────────────────────────────────
      case "initialize":
        respond(id, {
          protocolVersion: MCP_PROTOCOL_VERSION,
          capabilities:    { tools: {} },
          serverInfo:      { name: SERVER_NAME, version: SERVER_VERSION },
        });
        break;

      // ── Tool listing ────────────────────────────────────────────────────────
      case "tools/list":
        respond(id, { tools: TOOLS });
        break;

      // ── Tool invocation ─────────────────────────────────────────────────────
      case "tools/call": {
        const toolName = params && params.name;
        const toolArgs = (params && params.arguments) || {};

        if (!toolName) {
          respondError(id, RPC_INVALID_PARAMS, "Missing tool name");
          break;
        }

        const text = await handleToolCall(toolName, toolArgs);
        respond(id, { content: [{ type: "text", text }] });
        break;
      }

      // ── Keep-alive ──────────────────────────────────────────────────────────
      case "ping":
        respond(id, {});
        break;

      default:
        respondError(id, RPC_METHOD_NOT_FOUND, `Method not found: ${method}`);
    }
  } catch (err) {
    // Tool errors are returned as content with `isError: true` so Claude
    // receives the message text rather than an opaque JSON-RPC error object.
    respond(id, {
      content: [{ type: "text", text: `Error: ${err.message}` }],
      isError: true,
    });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Stdio loop — reads newline-delimited JSON from stdin, processes each request
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Counter of in-flight async requests. The process waits for all pending
 * requests to settle before exiting after stdin closes.
 * @type {number}
 */
let pendingCount = 0;

/** Set to `true` once stdin reaches EOF. @type {boolean} */
let stdinEnded = false;

/**
 * Exits the process cleanly once stdin has closed and all pending requests
 * have resolved.  Called after every request completes and on stdin close.
 *
 * @returns {void}
 */
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
    process.stdout.write(
      JSON.stringify({
        jsonrpc: "2.0",
        id:      null,
        error:   { code: RPC_PARSE_ERROR, message: "Parse error" },
      }) + "\n"
    );
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
