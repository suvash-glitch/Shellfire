"use strict";

/**
 * @module pty-manager
 *
 * PTY lifecycle management for the Shellfire main process.
 *
 * Owns:
 *   - Creating, resizing, writing to, and killing PTY processes
 *   - Querying the live working directory and foreground process of a PTY
 *   - Querying the process tree, pane stats, and environment for a PTY
 *   - Registering all `ipcMain` handlers related to PTY operations
 *
 * Does NOT own:
 *   - Shared PTY state maps or the output ring-buffer (see state.js)
 *   - Window creation or IPC messaging helpers (see state.js / window-manager.js)
 *   - The Unix socket server used by the CLI/MCP layer (see socket-server.js)
 */

const fs = require("fs");
const os = require("os");
const { ipcMain } = require("electron");
const pty = require("node-pty");
const { execFileAsync, sanitizePath, log } = require("./utils");
const {
  ptys,
  ptyBuffers,
  ptyMeta,
  getNextId,
  appendPtyBuffer,
  sendToRenderer,
} = require("./state");

// ─── Constants ────────────────────────────────────────────────────────────────

/** Default PTY column width in characters. */
const DEFAULT_COLS = 80;

/** Default PTY row height in characters. */
const DEFAULT_ROWS = 24;

/** Minimum valid PTY dimension (cols or rows). */
const MIN_DIMENSION = 1;

/** Maximum valid PTY dimension (cols or rows), prevents unreasonable allocations. */
const MAX_DIMENSION = 500;

/** Milliseconds to wait after shell init before replaying a restore command. */
const RESTORE_CMD_DELAY_MS = 1500;

/** Timeout (ms) for PowerShell-based CWD/process queries on Windows. */
const WIN32_EXEC_TIMEOUT_MS = 3000;

/** Timeout (ms) for `lsof`-based CWD queries on Unix. */
const LSOF_EXEC_TIMEOUT_MS = 2000;

/** xterm terminal-type string advertised to spawned shells. */
const TERM_TYPE = "xterm-256color";

/** Maximum safe text payload for a single `terminal-input` write (1 MiB). */
const MAX_INPUT_BYTES = 1024 * 1024;

// ─── Internal helpers ─────────────────────────────────────────────────────────

/**
 * Returns the first child PID of `pid` on Unix using `pgrep`, or `null` if
 * none exists or the command fails.
 *
 * @param {string} pid - String representation of the parent PID.
 * @returns {Promise<string|null>} Child PID string, or `null`.
 */
async function getFirstChildPid(pid) {
  try {
    const out = await execFileAsync("pgrep", ["-P", pid]);
    return out.split("\n")[0] || null;
  } catch {
    // No child process exists, or pgrep is unavailable — caller uses parent pid.
    return null;
  }
}

/**
 * Resolves the current working directory of a PTY by reading `lsof` output
 * on Unix. The `fcwd` record line is immediately followed by the path line.
 *
 * @param {string} pid - String representation of the PTY's PID.
 * @returns {Promise<string|null>} Absolute CWD path, or `null` on failure.
 */
async function getCwdViaLsof(pid) {
  const out = await execFileAsync("lsof", ["-p", pid, "-Fn"], { timeout: LSOF_EXEC_TIMEOUT_MS });
  const lines = out.split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (lines[i] === "fcwd" && lines[i + 1]?.startsWith("n")) {
      return lines[i + 1].slice(1);
    }
  }
  return null;
}

/**
 * Resolves the current working directory of a PTY on Windows using PowerShell
 * and the WMI `Win32_Process` class.
 *
 * @param {string} pid - String representation of the PTY's PID.
 * @returns {Promise<string|null>} Absolute CWD path, or `null` on failure.
 */
async function getCwdViaWin32(pid) {
  const safePid = parseInt(pid, 10);
  return execFileAsync("powershell", [
    "-Command",
    `(Get-CimInstance Win32_Process -Filter "ProcessId=${safePid}").ExecutablePath; ` +
    `$o=(Get-CimInstance Win32_Process -Filter "ProcessId=${safePid}"); ` +
    `Invoke-CimMethod -InputObject $o -MethodName GetOwner|Out-Null; ` +
    `[System.IO.Directory]::GetCurrentDirectory()`,
  ], { timeout: WIN32_EXEC_TIMEOUT_MS });
}

/**
 * Returns the current working directory for the PTY identified by `id`.
 * Falls back to the stored metadata value if the live query fails.
 *
 * @param {number} id - PTY identifier.
 * @returns {Promise<string|null>} Absolute CWD path, or `null` if unavailable.
 */
async function getCwdForPty(id) {
  const p = ptys.get(id);
  if (!p) return null;
  const pid = String(p.pid);
  try {
    if (process.platform === "win32") return await getCwdViaWin32(pid);
    return await getCwdViaLsof(pid);
  } catch {
    // Live query failed — caller may use stored metadata as fallback.
    return null;
  }
}

/**
 * Returns the name of the foreground process running inside a PTY on Windows
 * by querying `Win32_Process` for the first child of the shell PID.
 *
 * @param {string} pid - String representation of the shell PID.
 * @returns {Promise<string|null>} Process name, or `null` on failure.
 */
async function getProcessViaWin32(pid) {
  const safePid = parseInt(pid, 10);
  const r = await execFileAsync("powershell", [
    "-Command",
    `(Get-CimInstance Win32_Process -Filter "ParentProcessId=${safePid}" | Select-Object -First 1).Name`,
  ], { timeout: WIN32_EXEC_TIMEOUT_MS });
  return r || null;
}

/**
 * Returns the name of the foreground process running inside a PTY on Unix
 * by resolving the deepest child PID and reading its `comm` value via `ps`.
 *
 * @param {string} pid - String representation of the shell PID.
 * @returns {Promise<string|null>} Short process name (basename), or `null`.
 */
async function getProcessViaUnix(pid) {
  const childPid = await getFirstChildPid(pid);
  const target = childPid || pid;
  const comm = await execFileAsync("ps", ["-o", "comm=", "-p", target]);
  return comm.split("/").pop() || null;
}

/**
 * Returns the name of the foreground process running inside the PTY identified
 * by `id`. Platform-specific: uses PowerShell on Windows, `ps`/`pgrep` on Unix.
 *
 * @param {number} id - PTY identifier.
 * @returns {Promise<string|null>} Process name, or `null` if unavailable.
 */
async function getProcessForPty(id) {
  const p = ptys.get(id);
  if (!p) return null;
  const pid = String(p.pid);
  try {
    if (process.platform === "win32") return await getProcessViaWin32(pid);
    return await getProcessViaUnix(pid);
  } catch {
    // Process query failed (PTY may be exiting) — safe to ignore.
    return null;
  }
}

// ─── PTY creation helpers ─────────────────────────────────────────────────────

/**
 * Returns the path to the user's default shell executable.
 * Uses `COMSPEC` or `powershell.exe` on Windows; `SHELL` or `/bin/zsh` on Unix.
 *
 * @returns {string} Absolute path to the shell executable.
 */
function resolveShellPath() {
  return process.platform === "win32"
    ? process.env.COMSPEC || "powershell.exe"
    : process.env.SHELL || "/bin/zsh";
}

/**
 * Spawns a new PTY process using the resolved shell, registers `onData` and
 * `onExit` handlers, and stores all three state map entries (ptys, ptyBuffers,
 * ptyMeta).
 *
 * @param {number}      id       - Pre-allocated PTY identifier.
 * @param {string|null} safeCwd  - Sanitised working directory, or `null` to use `$HOME`.
 * @returns {import("node-pty").IPty} The spawned PTY process instance.
 */
function spawnPty(id, safeCwd) {
  const shellPath = resolveShellPath();
  const cwd = safeCwd || os.homedir();

  const p = pty.spawn(shellPath, [], {
    name: TERM_TYPE,
    cols: DEFAULT_COLS,
    rows: DEFAULT_ROWS,
    cwd,
    env: { ...process.env, TERM: TERM_TYPE, CLAUDECODE: "" },
  });

  ptys.set(id, p);
  ptyBuffers.set(id, "");
  ptyMeta.set(id, { cwd, cols: DEFAULT_COLS, rows: DEFAULT_ROWS });

  p.onData((data) => {
    appendPtyBuffer(id, data);
    sendToRenderer("terminal-data", id, data);
  });

  p.onExit(({ exitCode }) => {
    ptys.delete(id);
    ptyBuffers.delete(id);
    ptyMeta.delete(id);
    sendToRenderer("terminal-exit", id, exitCode);
  });

  return p;
}

/**
 * Schedules a restore command to be written to a PTY after the shell has
 * finished initialising. The delay allows `.zshrc`/`.bashrc` to complete
 * before the command is injected.
 *
 * @param {number} id         - PTY identifier.
 * @param {string} restoreCmd - Shell command string to replay (without trailing newline).
 * @returns {void}
 */
function scheduleRestoreCommand(id, restoreCmd) {
  setTimeout(() => {
    ptys.get(id)?.write(restoreCmd + "\n");
  }, RESTORE_CMD_DELAY_MS);
}

// ─── IPC handler implementations ──────────────────────────────────────────────

/**
 * Handles the `create-terminal` IPC invocation.
 * Spawns a new PTY, optionally replays a session-restore command, and returns
 * the new PTY's numeric id.
 *
 * @param {Electron.IpcMainInvokeEvent} _evt        - Unused IPC event object.
 * @param {string|null}                 cwd         - Requested working directory (may be `null`).
 * @param {string|null}                 restoreCmd  - Shell command to replay after init (may be `null`).
 * @returns {number} Newly allocated PTY identifier.
 */
function handleCreateTerminal(_evt, cwd, restoreCmd) {
  const id = getNextId();
  const safeCwd = cwd ? sanitizePath(cwd) : null;
  spawnPty(id, safeCwd);
  if (restoreCmd && typeof restoreCmd === "string") {
    scheduleRestoreCommand(id, restoreCmd);
  }
  return id;
}

/**
 * Handles the `terminal-input` IPC event.
 * Writes `data` directly to the PTY process identified by `id`.
 *
 * @param {Electron.IpcMainEvent} _evt  - Unused IPC event object.
 * @param {number}                id   - PTY identifier.
 * @param {string}                data - Raw input data to send to the PTY.
 * @returns {void}
 */
function handleTerminalInput(_evt, id, data) {
  if (typeof id !== "number" || typeof data !== "string") return;
  if (data.length > MAX_INPUT_BYTES) return; // Silently drop oversized writes.
  ptys.get(id)?.write(data);
}

/**
 * Handles the `terminal-resize` IPC event.
 * Validates `cols` and `rows` then resizes the PTY and updates its metadata.
 *
 * @param {Electron.IpcMainEvent} _evt  - Unused IPC event object.
 * @param {number}                id   - PTY identifier.
 * @param {number}                cols - New column count.
 * @param {number}                rows - New row count.
 * @returns {void}
 */
function handleTerminalResize(_evt, id, cols, rows) {
  if (typeof id !== "number") return;
  const c = Number(cols);
  const r = Number(rows);
  const validDim = (n) => Number.isInteger(n) && n >= MIN_DIMENSION && n <= MAX_DIMENSION;
  if (!validDim(c) || !validDim(r)) return;
  const p = ptys.get(id);
  if (!p) return;
  p.resize(c, r);
  const meta = ptyMeta.get(id);
  if (meta) { meta.cols = c; meta.rows = r; }
}

/**
 * Handles the `terminal-kill` IPC event.
 * Removes the PTY from all state maps immediately, then calls `pty.kill()`.
 * The `onExit` callback will attempt the same deletes (idempotent no-ops).
 *
 * @param {Electron.IpcMainEvent} _evt - Unused IPC event object.
 * @param {number}                id  - PTY identifier.
 * @returns {void}
 */
function handleTerminalKill(_evt, id) {
  if (typeof id !== "number") return;
  const p = ptys.get(id);
  if (!p) return;
  // Remove from maps first so no further data events reach the renderer.
  ptys.delete(id);
  ptyBuffers.delete(id);
  ptyMeta.delete(id);
  try { p.kill(); } catch {
    // PTY may have already exited; kill() failure is harmless.
  }
}

/**
 * Handles the `terminal-broadcast` IPC event.
 * Writes `data` to every PTY whose id appears in `ids`.
 *
 * @param {Electron.IpcMainEvent} _evt - Unused IPC event object.
 * @param {number[]}              ids  - Array of PTY identifiers to write to.
 * @param {string}                data - Raw input data to broadcast.
 * @returns {void}
 */
function handleTerminalBroadcast(_evt, ids, data) {
  if (!Array.isArray(ids) || typeof data !== "string") return;
  for (const id of ids) {
    if (typeof id === "number") ptys.get(id)?.write(data);
  }
}

/**
 * Handles the `list-ptys` IPC invocation.
 * Returns a snapshot of all live PTYs including their buffered output, live CWD,
 * and current dimensions. Used by the renderer for tmux-like reattach on init.
 *
 * @returns {Promise<Array<{id: number, pid: number, buffer: string, cwd: string|null, cols: number, rows: number}>>}
 *   Array of PTY descriptor objects.
 */
async function handleListPtys() {
  const result = [];
  for (const [id, p] of ptys) {
    const meta = ptyMeta.get(id);
    let cwd = meta?.cwd || null;
    try {
      const fresh = await getCwdForPty(id);
      if (fresh) cwd = fresh;
    } catch {
      // Live CWD query failed — use stored metadata value.
    }
    result.push({
      id,
      pid: p.pid,
      buffer: ptyBuffers.get(id) || "",
      cwd,
      cols: meta?.cols || DEFAULT_COLS,
      rows: meta?.rows || DEFAULT_ROWS,
    });
  }
  return result;
}

/**
 * Handles the `get-terminal-env` IPC invocation.
 * Returns the environment variables for the foreground process of a PTY as
 * a sorted key-value array. Falls back to the main-process environment when
 * the per-process env cannot be read (always the case on Windows or if
 * `/proc/{pid}/environ` is unreadable).
 *
 * @param {Electron.IpcMainInvokeEvent} _evt - Unused IPC event object.
 * @param {number}                      id   - PTY identifier.
 * @returns {Promise<Array<{key: string, value: string}>>} Sorted env pairs.
 */
async function handleGetTerminalEnv(_evt, id) {
  const fallback = () =>
    Object.entries(process.env)
      .map(([key, value]) => ({ key, value }))
      .sort((a, b) => a.key.localeCompare(b.key));

  const p = ptys.get(id);
  if (!p || process.platform === "win32") return fallback();

  try {
    const pid = String(p.pid);
    const childPid = await getFirstChildPid(pid);
    const target = childPid || pid;

    // Validate that target is a plain numeric PID before using it in a path.
    if (!/^\d+$/.test(target)) return fallback();

    if (process.platform === "linux") {
      try {
        const envStr = fs.readFileSync(`/proc/${target}/environ`, "utf8");
        const pairs = envStr.split("\0").filter(Boolean).map((entry) => {
          const eq = entry.indexOf("=");
          return eq > 0 ? { key: entry.slice(0, eq), value: entry.slice(eq + 1) } : null;
        }).filter(Boolean);
        if (pairs.length) return pairs.sort((a, b) => a.key.localeCompare(b.key));
      } catch {
        // /proc read failed (permissions, process exited) — fall through to fallback.
      }
    }
  } catch {
    // Outer failure (pgrep unavailable, etc.) — fall through to fallback.
  }

  return fallback();
}

/**
 * Handles the `get-process-tree` IPC invocation.
 * Returns a descriptor for the deepest child process of a PTY, suitable for
 * the status bar. On Windows uses WMI; on Unix uses `pgrep` + `ps`.
 *
 * @param {Electron.IpcMainInvokeEvent} _evt - Unused IPC event object.
 * @param {number}                      id   - PTY identifier.
 * @returns {Promise<{pid: string, comm: string, args: string}|null>} Process descriptor, or `null`.
 */
async function handleGetProcessTree(_evt, id) {
  const p = ptys.get(id);
  if (!p) return null;
  const pid = String(p.pid);

  try {
    if (process.platform === "win32") return await getProcessTreeWin32(pid);
    return await getProcessTreeUnix(pid);
  } catch {
    return null;
  }
}

/**
 * Queries the deepest child process of `pid` on Windows using PowerShell/WMI.
 *
 * @param {string} pid - String representation of the shell PID.
 * @returns {Promise<{pid: string, comm: string, args: string}|null>} Process descriptor, or `null`.
 */
async function getProcessTreeWin32(pid) {
  const safePid = parseInt(pid, 10);
  const result = await execFileAsync("powershell", [
    "-Command",
    `Get-CimInstance Win32_Process -Filter "ParentProcessId=${safePid}" | ` +
    `Select-Object ProcessId,Name,CommandLine | ConvertTo-Json`,
  ], { timeout: WIN32_EXEC_TIMEOUT_MS });

  const procs = JSON.parse(result);
  const proc = Array.isArray(procs) ? procs[procs.length - 1] : procs;
  if (!proc) return null;
  return { pid: String(proc.ProcessId), comm: proc.Name, args: proc.CommandLine || "" };
}

/**
 * Queries the deepest child process of `pid` on Unix using `pgrep` and `ps`.
 * For Node.js processes the raw args are simplified to a short display form.
 *
 * @param {string} pid - String representation of the shell PID.
 * @returns {Promise<{pid: string, comm: string, args: string}|null>} Process descriptor, or `null`.
 */
async function getProcessTreeUnix(pid) {
  const childPidsStr = await execFileAsync("pgrep", ["-P", pid]);
  const childPids = childPidsStr.split("\n").filter(Boolean);
  if (!childPids.length) return null;

  const psOutput = await execFileAsync("ps", ["-o", "pid=,comm=", "-p", childPids.join(",")]);
  const argsOutput = await execFileAsync("ps", ["-o", "args=", "-p", childPids[childPids.length - 1]]);

  const lines = psOutput.split("\n").map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return null;

  const parts = lines[lines.length - 1].split(/\s+/);
  const fullArgs = (argsOutput || "").trim();
  const comm = (parts[1] || "").split("/").pop();

  const cleanArgs = simplifyNodeArgs(comm, fullArgs);
  return { pid: parts[0], comm: parts[1], args: cleanArgs };
}

/**
 * Shortens the raw `args` string for Node.js processes to a human-readable
 * form (script basename + trailing arguments). Returns `args` unchanged for
 * all other process types.
 *
 * @param {string} comm     - Short process name (e.g. `"node"`, `"python"`).
 * @param {string} fullArgs - Full command-line string from `ps -o args=`.
 * @returns {string} Simplified command string.
 */
function simplifyNodeArgs(comm, fullArgs) {
  if (comm !== "node" && comm !== "node.exe") return fullArgs;
  const m = fullArgs.match(/\/([^/\s]+?)(?:\.js)?\s*(.*)/);
  if (m) return m[1] + (m[2] ? " " + m[2] : "");
  return fullArgs;
}

/**
 * Handles the `get-pane-stats` IPC invocation.
 * Returns CPU, memory, and VSZ/RSS stats for a PTY's shell process on macOS.
 * Returns `null` on unsupported platforms or on failure.
 *
 * @param {Electron.IpcMainInvokeEvent} _evt - Unused IPC event object.
 * @param {number}                      id   - PTY identifier.
 * @returns {Promise<{pid: string, cpu: number, mem: number, vsz: number, rss: number}|null>}
 */
async function handleGetPaneStats(_evt, id) {
  const p = ptys.get(id);
  if (!p) return null;
  if (process.platform !== "darwin") return null;

  const pid = String(p.pid);
  try {
    const result = await execFileAsync("ps", ["-o", "pid=,%cpu=,%mem=,vsz=,rss=", "-p", pid]);
    if (!result) return null;
    const parts = result.trim().split(/\s+/);
    return {
      pid: parts[0],
      cpu: parseFloat(parts[1]) || 0,
      mem: parseFloat(parts[2]) || 0,
      vsz: parseInt(parts[3]) || 0,
      rss: parseInt(parts[4]) || 0,
    };
  } catch {
    return null;
  }
}

// ─── Handler registration ─────────────────────────────────────────────────────

/**
 * Registers all `ipcMain` handlers for PTY operations.
 * Must be called once during app startup, after the main window has been created.
 *
 * @returns {void}
 */
function registerHandlers() {
  ipcMain.handle("create-terminal", handleCreateTerminal);
  ipcMain.on("terminal-input", handleTerminalInput);
  ipcMain.on("terminal-resize", handleTerminalResize);
  ipcMain.on("terminal-kill", handleTerminalKill);
  ipcMain.on("terminal-broadcast", handleTerminalBroadcast);
  ipcMain.handle("list-ptys", handleListPtys);
  ipcMain.handle("get-terminal-cwd", (_evt, id) => getCwdForPty(id));
  ipcMain.handle("get-terminal-process", (_evt, id) => getProcessForPty(id));
  ipcMain.handle("get-terminal-env", handleGetTerminalEnv);
  ipcMain.handle("get-process-tree", handleGetProcessTree);
  ipcMain.handle("get-pane-stats", handleGetPaneStats);
}

// ─── Exports ──────────────────────────────────────────────────────────────────

module.exports = { registerHandlers, getCwdForPty, getProcessForPty };
