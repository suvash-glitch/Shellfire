"use strict";

/**
 * @module system-handlers
 *
 * IPC handlers for OS-level integrations used by the Shellfire renderer.
 *
 * Owns:
 *   - Cron tab read / add / remove (via the `crontab` CLI)
 *   - Git branch and status queries
 *   - Docker container listing (running and all)
 *   - TCP port enumeration and process killing
 *   - System resource stats (CPU, RAM, disk, uptime)
 *   - Status-bar data feeds (k8s context, AWS profile, Node version)
 *   - Fuzzy file search (wraps `find`)
 *   - Pipeline step execution (user-authored shell commands via `sh -c`)
 *   - File save/open dialogs (shell scripts, text output, extensions)
 *   - Desktop notifications and "open in editor" integration
 *
 * Does NOT own:
 *   - PTY lifecycle (see pty-manager.js)
 *   - SSH session management (see ssh-manager.js)
 *   - Persistent settings / secrets storage (see storage.js)
 *   - Window creation or BrowserWindow options (see window-manager.js)
 */

const fs   = require("fs");
const os   = require("os");
const path = require("path");
const { ipcMain, app, Notification, shell } = require("electron");
const { spawn }                             = require("child_process");
const { execFileAsync, sanitizePath, log }  = require("./utils");
const { getWindow }                         = require("./state");

// ─── Constants ────────────────────────────────────────────────────────────────

/** Timeout (ms) for general short-lived CLI calls (docker, lsof, crontab). */
const CLI_TIMEOUT_MS = 5000;

/** Shorter timeout (ms) for commands that should be near-instantaneous. */
const FAST_TIMEOUT_MS = 3000;

/** Even shorter timeout (ms) for status-bar probes that must not stall the UI. */
const STATUS_TIMEOUT_MS = 2000;

/** Wall-clock limit (ms) for pipeline step execution before SIGTERM is sent. */
const PIPELINE_TIMEOUT_MS = 60000;

/**
 * Grace period (ms) between SIGTERM and SIGKILL when aborting a pipeline step.
 * Gives the child process a moment to flush output before being force-killed.
 */
const PIPELINE_KILL_GRACE_MS = 1000;

/** Maximum byte length accepted for a pipeline step command string. */
const PIPELINE_MAX_CMD_LENGTH = 8192;

/**
 * Maximum bytes retained from stdout / stderr of a pipeline step.
 * Older bytes are discarded to prevent unbounded memory growth for verbose commands.
 */
const PIPELINE_OUTPUT_TAIL_BYTES = 4000;

/** Maximum directory depth for the fuzzy file finder. */
const FIND_MAX_DEPTH = 5;

/** Maximum number of file results returned by the fuzzy file finder. */
const FIND_MAX_RESULTS = 50;

/** Maximum stdout buffer (bytes) allocated for the `find` subprocess. */
const FIND_MAX_BUFFER = 1024 * 1024;

/** Bytes in one gibibyte — used to format memory and disk figures. */
const BYTES_PER_GIB = 1073741824;

/**
 * Tab character used as a column separator in `docker ps --format` and
 * `lsof -nP` output.  Defined as a constant to avoid invisible characters
 * in regex literals.
 */
const TAB = "\t";

/** Regex that matches the port number at the end of an lsof name field (e.g. `*:8080`). */
const PORT_AT_END_RE = /:(\d+)$/;

/** Regex used to split whitespace-delimited lsof / df output lines. */
const WHITESPACE_RE = /\s+/;

/** Regex that validates a numeric PID (digits only, no sign). */
const DIGITS_ONLY_RE = /^\d+$/;

/** Regex that validates a cron entry line (rejects newlines and null bytes). */
const CRON_LINE_SAFE_RE = /[\n\0]/;

// ─── Cron helpers ─────────────────────────────────────────────────────────────

/**
 * Reads the current user's crontab.
 *
 * `crontab -l` exits non-zero when no crontab exists; the catch silently
 * returns an empty string because an absent crontab is a valid state, not
 * an error.
 *
 * @returns {Promise<string>} Raw crontab text, or `""` if none is installed.
 */
async function getCrontab() {
  try {
    return await execFileAsync("crontab", ["-l"]);
  } catch {
    // crontab -l exits 1 with "no crontab for <user>" when none is set — treat as empty.
    return "";
  }
}

/**
 * Writes `content` as the user's new crontab via a temporary file.
 *
 * `crontab` does not accept stdin directly on all platforms, so a temp file
 * is used.  The file is always deleted in the `finally` block — even when
 * `crontab` fails — to avoid leaving plaintext job listings in `/tmp`.
 *
 * @param {string} content - Full crontab text to install.
 * @returns {Promise<void>}
 */
async function setCrontab(content) {
  const tmp = path.join(app.getPath("temp"), "shellfire-crontab.tmp");
  fs.writeFileSync(tmp, content);
  try {
    await execFileAsync("crontab", [tmp], { timeout: CLI_TIMEOUT_MS });
  } finally {
    try { fs.unlinkSync(tmp); } catch { /* tmp may already be gone — ignore */ }
  }
}

// ─── IPC handler registration ──────────────────────────────────────────────────

/**
 * Registers all system-level IPC handlers on `ipcMain`.
 *
 * Called once from `main.js` during app startup.  Handlers are grouped by
 * subsystem and each handler is implemented by a focused private function
 * below.
 *
 * @returns {void}
 */
function registerHandlers() {
  _registerCronHandlers();
  _registerGitHandlers();
  _registerDockerHandlers();
  _registerPortHandlers();
  _registerSystemStatsHandler();
  _registerStatusBarHandlers();
  _registerFindFilesHandler();
  _registerPipelineHandler();
  _registerDialogHandlers();
  _registerNotificationHandlers();
}

// ─── Cron ─────────────────────────────────────────────────────────────────────

/**
 * Registers the three cron IPC handlers:
 *   - `"cron-list"`   — return active (non-comment) cron entries
 *   - `"cron-add"`    — append a validated line to the crontab
 *   - `"cron-remove"` — remove the entry at a given active-line index
 *
 * @returns {void}
 */
function _registerCronHandlers() {
  ipcMain.handle("cron-list", _handleCronList);
  ipcMain.handle("cron-add",  _handleCronAdd);
  ipcMain.handle("cron-remove", _handleCronRemove);
}

/**
 * Returns the list of enabled cron entries as structured objects.
 *
 * Comment lines and blank lines are skipped.  Each returned object carries
 * an `id` (zero-based active-entry index), the raw `line` text, and an
 * `enabled` flag (always `true` — disabled entries are not yet supported).
 *
 * @returns {Promise<Array<{ id: number, line: string, enabled: boolean }>>}
 *   Parsed cron entries, or `[]` on any error.
 */
async function _handleCronList() {
  try {
    const raw = await getCrontab();
    return raw.trim().split("\n")
      .filter((l) => l && !l.startsWith("#"))
      .map((line, i) => ({ id: i, line, enabled: true }));
  } catch {
    // Any unexpected failure (e.g. crontab binary missing) — return empty list.
    return [];
  }
}

/**
 * Appends a single validated cron line to the user's crontab.
 *
 * Rejects lines that are not strings, are blank, or contain newline / null
 * characters to prevent crontab corruption or injection.
 *
 * @param {Electron.IpcMainInvokeEvent} _event - Unused Electron event object.
 * @param {string} cronLine - The cron entry to add (e.g. `"0 * * * * /bin/foo"`).
 * @returns {Promise<boolean>} `true` on success, `false` on validation or write failure.
 */
async function _handleCronAdd(_event, cronLine) {
  if (
    typeof cronLine !== "string" ||
    !cronLine.trim() ||
    CRON_LINE_SAFE_RE.test(cronLine)
  ) return false;

  try {
    const existing = (await getCrontab()).trim();
    const next = existing ? `${existing}\n${cronLine.trim()}` : cronLine.trim();
    await setCrontab(next);
    return true;
  } catch {
    // Write failure (e.g. no crontab binary, permissions) — surface as false.
    return false;
  }
}

/**
 * Removes the active cron entry at position `index` (zero-based, ignoring
 * comments and blank lines).
 *
 * Comment and blank lines are preserved in place.  When no non-comment lines
 * remain the crontab is removed entirely via `crontab -r`.
 *
 * @param {Electron.IpcMainInvokeEvent} _event - Unused Electron event object.
 * @param {number} index - Zero-based index into the list of active entries.
 * @returns {Promise<boolean>} `true` on success, `false` on invalid input or failure.
 */
async function _handleCronRemove(_event, index) {
  if (typeof index !== "number" || !Number.isInteger(index) || index < 0) return false;

  try {
    const lines      = (await getCrontab()).trim().split("\n");
    const newLines   = _filterCronLine(lines, index);
    const newContent = newLines.join("\n");

    if (newContent.trim()) {
      await setCrontab(newContent);
    } else {
      // All active entries removed — delete the crontab entirely.
      try { await execFileAsync("crontab", ["-r"], { timeout: FAST_TIMEOUT_MS }); } catch {
        // If there is nothing to remove, crontab -r may exit non-zero — ignore.
      }
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Rebuilds a crontab line array with the active entry at `targetIdx` removed.
 *
 * Comment and blank lines pass through unchanged.  Active (non-comment,
 * non-blank) lines are counted; the one matching `targetIdx` is dropped.
 *
 * @param {string[]} lines     - All raw crontab lines (including comments / blanks).
 * @param {number}   targetIdx - Zero-based index of the active entry to remove.
 * @returns {string[]} New line array with the target entry omitted.
 */
function _filterCronLine(lines, targetIdx) {
  let activeIdx = 0;
  const result  = [];

  for (const line of lines) {
    if (!line || line.startsWith("#")) {
      result.push(line);
    } else {
      if (activeIdx !== targetIdx) result.push(line);
      activeIdx++;
    }
  }

  return result;
}

// ─── Git ──────────────────────────────────────────────────────────────────────

/**
 * Registers git IPC handlers:
 *   - `"get-git-branch"` — current branch name
 *   - `"get-git-status"` — `"dirty"` / `"clean"` / `null`
 *
 * @returns {void}
 */
function _registerGitHandlers() {
  ipcMain.handle("get-git-branch", _handleGetGitBranch);
  ipcMain.handle("get-git-status", _handleGetGitStatus);
}

/**
 * Returns the abbreviated HEAD ref name (branch name) for the given directory.
 *
 * @param {Electron.IpcMainInvokeEvent} _event   - Unused.
 * @param {string}                      dirPath  - Path to query; tilde-expanded and validated.
 * @returns {Promise<string|null>} Branch name, or `null` if not a git repo or path is invalid.
 */
async function _handleGetGitBranch(_event, dirPath) {
  const safe = _resolveSafeDir(dirPath);
  if (!safe) return null;
  try {
    return await execFileAsync("git", ["-C", safe, "rev-parse", "--abbrev-ref", "HEAD"]);
  } catch {
    // Not a git repo, git not installed, or other error — caller shows nothing.
    return null;
  }
}

/**
 * Returns `"dirty"` when the working tree has uncommitted changes, `"clean"`
 * when it is up-to-date, or `null` on any error.
 *
 * @param {Electron.IpcMainInvokeEvent} _event   - Unused.
 * @param {string}                      dirPath  - Path to query.
 * @returns {Promise<"dirty"|"clean"|null>}
 */
async function _handleGetGitStatus(_event, dirPath) {
  const safe = _resolveSafeDir(dirPath);
  if (!safe) return null;
  try {
    const output = await execFileAsync("git", ["-C", safe, "status", "--porcelain"]);
    return output ? "dirty" : "clean";
  } catch {
    // Not a git repo or git unavailable — status is indeterminate.
    return null;
  }
}

// ─── Docker ───────────────────────────────────────────────────────────────────

/**
 * Registers Docker IPC handlers:
 *   - `"docker-ps"`     — running containers
 *   - `"docker-ps-all"` — all containers (including stopped)
 *
 * @returns {void}
 */
function _registerDockerHandlers() {
  ipcMain.handle("docker-ps",     _handleDockerPs);
  ipcMain.handle("docker-ps-all", _handleDockerPsAll);
}

/**
 * Returns a list of running Docker containers.
 *
 * @returns {Promise<Array<{ id: string, name: string, image: string, status: string, ports: string }>>}
 *   Running containers, or `[]` when Docker is unavailable or no containers are running.
 */
async function _handleDockerPs() {
  const FORMAT = "{{.ID}}\t{{.Names}}\t{{.Image}}\t{{.Status}}\t{{.Ports}}";
  try {
    const raw = (await execFileAsync("docker", ["ps", "--format", FORMAT], { timeout: CLI_TIMEOUT_MS })).trim();
    if (!raw) return [];
    return raw.split("\n").map((line) => {
      const [id, name, image, status, ports] = line.split(TAB);
      return { id, name, image, status, ports: ports || "" };
    });
  } catch {
    // Docker not installed, daemon not running, or permissions error — hide the panel.
    return [];
  }
}

/**
 * Returns a list of all Docker containers (running and stopped).
 *
 * @returns {Promise<Array<{ id: string, name: string, image: string, status: string }>>}
 *   All containers, or `[]` when Docker is unavailable.
 */
async function _handleDockerPsAll() {
  const FORMAT = "{{.ID}}\t{{.Names}}\t{{.Image}}\t{{.Status}}";
  try {
    const raw = (await execFileAsync("docker", ["ps", "-a", "--format", FORMAT], { timeout: CLI_TIMEOUT_MS })).trim();
    if (!raw) return [];
    return raw.split("\n").map((line) => {
      const [id, name, image, status] = line.split(TAB);
      return { id, name, image, status };
    });
  } catch {
    // Docker unavailable — surface as empty list.
    return [];
  }
}

// ─── Ports ────────────────────────────────────────────────────────────────────

/**
 * Registers port-management IPC handlers:
 *   - `"list-ports"` — TCP ports currently in LISTEN state
 *   - `"kill-port"`  — send SIGKILL to a process by PID
 *
 * @returns {void}
 */
function _registerPortHandlers() {
  ipcMain.handle("list-ports", _handleListPorts);
  ipcMain.handle("kill-port",  _handleKillPort);
}

/**
 * Returns the set of TCP ports currently in LISTEN state on the local machine.
 *
 * Uses `lsof -iTCP -sTCP:LISTEN -nP` and deduplicates by `pid:port` pair so
 * that processes with multiple file descriptors on the same port appear once.
 *
 * @returns {Promise<Array<{ port: string, pid: string, process: string, protocol: string }>>}
 *   Listening ports, or `[]` on error.
 */
async function _handleListPorts() {
  try {
    const raw = (await execFileAsync("lsof", ["-iTCP", "-sTCP:LISTEN", "-nP"], { timeout: CLI_TIMEOUT_MS })).trim();
    if (!raw) return [];

    const seen = new Set();

    return raw.split("\n")
      .slice(1)          // skip the lsof header line
      .filter(Boolean)
      .map((line) => _parseLsofLine(line, seen))
      .filter(Boolean);  // _parseLsofLine returns null for duplicates / malformed lines
  } catch {
    // lsof unavailable or permission denied — surface as empty list.
    return [];
  }
}

/**
 * Parses one output line from `lsof -iTCP -sTCP:LISTEN -nP`.
 *
 * Returns `null` for lines where no port can be extracted or whose `pid:port`
 * key has already been seen (deduplication).
 *
 * @param {string}  line - One lsof output line (excluding the header).
 * @param {Set<string>} seen - Accumulator of already-seen `"pid:port"` keys.
 * @returns {{ port: string, pid: string, process: string, protocol: string }|null}
 */
function _parseLsofLine(line, seen) {
  const parts     = line.trim().split(WHITESPACE_RE);
  const proc      = parts[0] || "";
  const pid       = parts[1] || "";
  const protocol  = parts[7] || "TCP";
  const nameField = parts[8] || "";
  const portMatch = nameField.match(PORT_AT_END_RE);
  const port      = portMatch ? portMatch[1] : "";

  const key = `${pid}:${port}`;
  if (!port || seen.has(key)) return null;
  seen.add(key);

  return { port, pid, process: proc, protocol };
}

/**
 * Sends `SIGKILL` to the process with the given PID.
 *
 * @param {Electron.IpcMainInvokeEvent} _event - Unused.
 * @param {number|string} pid - The process ID to kill; must be digits only.
 * @returns {Promise<{ ok: true }|{ error: string }>}
 */
async function _handleKillPort(_event, pid) {
  const pidStr = String(pid ?? "");
  if (!pidStr || !DIGITS_ONLY_RE.test(pidStr)) return { error: "Invalid PID" };

  try {
    await execFileAsync("kill", ["-9", pidStr], { timeout: FAST_TIMEOUT_MS });
    return { ok: true };
  } catch (err) {
    return { error: err.message };
  }
}

// ─── System stats ──────────────────────────────────────────────────────────────

/**
 * Registers the `"system-stats"` IPC handler.
 *
 * @returns {void}
 */
function _registerSystemStatsHandler() {
  ipcMain.handle("system-stats", _handleSystemStats);
}

/**
 * Returns a snapshot of CPU, RAM, disk, and uptime data.
 *
 * CPU usage is derived from `os.cpus()` tick totals (all cores combined).
 * Disk usage is read from `df -h /` on POSIX or PowerShell on Windows.
 * Disk errors are caught internally and surfaced as `diskUsage: null` so that
 * the rest of the stats object is still returned.
 *
 * @returns {Promise<{
 *   cpuUsage:  number,
 *   memUsage:  number,
 *   memGB:     string,
 *   totalGB:   string,
 *   diskUsage: { used: string, total: string, percent: number }|null,
 *   uptime:    number
 * }|null>} Stats object, or `null` on a catastrophic OS error.
 */
async function _handleSystemStats() {
  try {
    const cpuUsage  = _computeCpuUsage();
    const memStats  = _computeMemStats();
    const diskUsage = await _computeDiskUsage();

    return {
      ...memStats,
      cpuUsage,
      diskUsage,
      uptime: Math.round(os.uptime() / 60),
    };
  } catch {
    // Should never happen (os.cpus / os.totalmem don't throw), but guard anyway.
    return null;
  }
}

/**
 * Computes overall CPU usage as a percentage (0–100) from `os.cpus()` tick counts.
 *
 * @returns {number} Rounded CPU usage percentage across all cores.
 */
function _computeCpuUsage() {
  const cpus      = os.cpus();
  const totalIdle = cpus.reduce((acc, c) => acc + c.times.idle, 0);
  const totalTick = cpus.reduce(
    (acc, c) => acc + c.times.user + c.times.nice + c.times.sys + c.times.idle + c.times.irq,
    0
  );
  return totalTick > 0 ? Math.round((1 - totalIdle / totalTick) * 100) : 0;
}

/**
 * Computes memory usage statistics from `os.totalmem()` / `os.freemem()`.
 *
 * @returns {{ memUsage: number, memGB: string, totalGB: string }}
 */
function _computeMemStats() {
  const totalMem = os.totalmem();
  const freeMem  = os.freemem();
  const usedMem  = totalMem - freeMem;
  return {
    memUsage: Math.round((usedMem / totalMem) * 100),
    memGB:    (usedMem  / BYTES_PER_GIB).toFixed(1),
    totalGB:  (totalMem / BYTES_PER_GIB).toFixed(1),
  };
}

/**
 * Reads disk usage for the primary volume.
 *
 * Uses `df -h /` on POSIX systems and PowerShell's `Get-PSDrive` on Windows.
 * Returns `null` when the command fails (e.g. no `df` on the PATH, or
 * PowerShell unavailable) so callers can show a placeholder.
 *
 * @returns {Promise<{ used: string, total: string, percent: number }|null>}
 */
async function _computeDiskUsage() {
  try {
    if (process.platform === "win32") {
      return await _readDiskUsageWindows();
    }
    return await _readDiskUsagePosix();
  } catch {
    // df / PowerShell unavailable or failed — disk stat is optional.
    return null;
  }
}

/**
 * Reads disk usage on Windows via PowerShell's `Get-PSDrive`.
 *
 * @returns {Promise<{ used: string, total: string, percent: number }>}
 */
async function _readDiskUsageWindows() {
  const raw  = await execFileAsync("powershell", [
    "-Command",
    "Get-PSDrive C | Select-Object Used,Free | ConvertTo-Json",
  ]);
  const info = JSON.parse(raw);
  const used = info.Used || 0;
  const free = info.Free || 1;
  const total = used + free;
  return {
    used:    `${(used  / BYTES_PER_GIB).toFixed(0)}G`,
    total:   `${(total / BYTES_PER_GIB).toFixed(0)}G`,
    percent: Math.round((used / total) * 100),
  };
}

/**
 * Reads disk usage on POSIX via `df -h /`.
 *
 * `df -h` output columns: Filesystem, Size, Used, Avail, Use%, Mounted.
 * The last line is used in case the filesystem name wraps (rare on macOS/Linux).
 *
 * @returns {Promise<{ used: string, total: string, percent: number }>}
 */
async function _readDiskUsagePosix() {
  const raw = await execFileAsync("df", ["-h", "/"]);
  const df  = raw.trim().split("\n").pop().split(WHITESPACE_RE);
  return {
    used:    df[2] || "?",
    total:   df[1] || "?",
    percent: parseInt(df[4], 10) || 0,
  };
}

// ─── Status-bar helpers ────────────────────────────────────────────────────────

/**
 * Registers status-bar data-feed handlers:
 *   - `"get-k8s-context"` — current kubectl context name
 *   - `"get-aws-profile"` — active AWS profile from environment
 *   - `"get-node-version"` — installed Node.js version string
 *
 * @returns {void}
 */
function _registerStatusBarHandlers() {
  ipcMain.handle("get-k8s-context",  _handleGetK8sContext);
  ipcMain.handle("get-aws-profile",  _handleGetAwsProfile);
  ipcMain.handle("get-node-version", _handleGetNodeVersion);
}

/**
 * Returns the current kubectl context name.
 *
 * @returns {Promise<string|null>} Context name, or `null` if kubectl is not installed
 *   or no context is configured.
 */
async function _handleGetK8sContext() {
  try {
    return await execFileAsync("kubectl", ["config", "current-context"], { timeout: FAST_TIMEOUT_MS });
  } catch {
    // kubectl not installed or no active context — status bar shows nothing.
    return null;
  }
}

/**
 * Returns the active AWS profile from the environment.
 *
 * Checks `AWS_PROFILE` first, then `AWS_DEFAULT_PROFILE`.  Returns `null`
 * when neither is set.
 *
 * @returns {Promise<string|null>}
 */
async function _handleGetAwsProfile() {
  return process.env.AWS_PROFILE || process.env.AWS_DEFAULT_PROFILE || null;
}

/**
 * Returns the version string of the `node` binary on the PATH.
 *
 * @returns {Promise<string|null>} e.g. `"v20.11.0"`, or `null` if not found.
 */
async function _handleGetNodeVersion() {
  try {
    return await execFileAsync("node", ["--version"], { timeout: STATUS_TIMEOUT_MS });
  } catch {
    // Node not on PATH (unlikely in Electron, but possible in sandboxed builds).
    return null;
  }
}

// ─── Fuzzy file finder ────────────────────────────────────────────────────────

/**
 * Registers the `"find-files"` IPC handler for fuzzy file search.
 *
 * @returns {void}
 */
function _registerFindFilesHandler() {
  ipcMain.handle("find-files", _handleFindFiles);
}

/**
 * Searches `dirs` for files whose paths contain `query` (case-insensitive).
 *
 * Uses the system `find` binary with common noise directories excluded
 * (`node_modules`, `.git`, `dist`, `.next`).  Results are limited to
 * {@link FIND_MAX_RESULTS} entries.
 *
 * @param {Electron.IpcMainInvokeEvent} _event - Unused.
 * @param {string}   query - Substring to match against file paths.
 * @param {string[]} dirs  - Directories to search; each is tilde-expanded and validated.
 * @returns {Promise<Array<{ path: string, name: string, dir: string }>>}
 *   Matched file descriptors, or `[]` on bad input or error.
 */
async function _handleFindFiles(_event, query, dirs) {
  if (typeof query !== "string" || !query.trim() || !Array.isArray(dirs)) return [];

  const safeDirs = dirs.map((d) => sanitizePath(d)).filter(Boolean);
  if (!safeDirs.length) return [];

  try {
    const args = [
      ...safeDirs,
      "-maxdepth", String(FIND_MAX_DEPTH),
      "-type",     "f",
      "-not", "-path", "*/node_modules/*",
      "-not", "-path", "*/.git/*",
      "-not", "-path", "*/dist/*",
      "-not", "-path", "*/.next/*",
    ];

    const result = await execFileAsync("find", args, {
      timeout:   CLI_TIMEOUT_MS,
      maxBuffer: FIND_MAX_BUFFER,
    });

    if (!result) return [];

    const q    = query.toLowerCase();
    const home = os.homedir();

    return result.split("\n")
      .filter((f) => f && f.toLowerCase().includes(q))
      .slice(0, FIND_MAX_RESULTS)
      .map((f) => ({
        path: f,
        name: f.split("/").pop(),
        dir:  f.replace(/\/[^/]+$/, "").replace(home, "~"),
      }));
  } catch {
    // find timed out, had a permission error, or returned nothing — safe to return empty.
    return [];
  }
}

// ─── Pipeline execution ────────────────────────────────────────────────────────

/**
 * Registers the `"exec-pipeline-step"` IPC handler.
 *
 * @returns {void}
 */
function _registerPipelineHandler() {
  ipcMain.handle("exec-pipeline-step", _handleExecPipelineStep);
}

/**
 * Executes a single pipeline step as a shell command and returns its output.
 *
 * `sh -c` is used intentionally: pipeline steps are user-authored shell
 * commands that may include pipes, redirections, and variable expansion.
 * The renderer validates step content before sending; this handler enforces
 * a length ceiling to prevent memory exhaustion from pathologically long inputs.
 *
 * stdout and stderr are both capped at {@link PIPELINE_OUTPUT_TAIL_BYTES} to
 * prevent runaway output from filling memory.
 *
 * @param {Electron.IpcMainInvokeEvent} _event  - Unused.
 * @param {{ command: string, cwd?: string }} params - Step parameters.
 * @returns {Promise<{ code: number, stdout: string, stderr: string }>}
 */
async function _handleExecPipelineStep(_event, { command, cwd }) {
  if (typeof command !== "string" || !command.trim()) {
    return { code: 1, stdout: "", stderr: "Invalid command" };
  }
  if (command.length > PIPELINE_MAX_CMD_LENGTH) {
    return { code: 1, stdout: "", stderr: `Command too long (max ${PIPELINE_MAX_CMD_LENGTH} chars)` };
  }

  const resolvedCwd = cwd ? sanitizePath(cwd) : os.homedir();
  if (!resolvedCwd) return { code: 1, stdout: "", stderr: "Invalid working directory" };

  return _spawnPipelineStep(command, resolvedCwd);
}

/**
 * Spawns `sh -c command` in `cwd` and resolves with the collected output.
 *
 * A hard timeout of {@link PIPELINE_TIMEOUT_MS} ms is enforced.  On timeout,
 * SIGTERM is sent first, followed by SIGKILL after {@link PIPELINE_KILL_GRACE_MS}.
 * The promise always resolves (never rejects) so the renderer always receives
 * a result object.
 *
 * @param {string} command - Shell command to run via `sh -c`.
 * @param {string} cwd     - Validated working directory path.
 * @returns {Promise<{ code: number, stdout: string, stderr: string }>}
 */
function _spawnPipelineStep(command, cwd) {
  return new Promise((resolve) => {
    let settled = false;

    /** @param {{ code: number, stdout: string, stderr: string }} result */
    function settle(result) {
      if (!settled) { settled = true; resolve(result); }
    }

    const proc = spawn("sh", ["-c", command], { cwd });
    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (d) => { stdout += d; });
    proc.stderr.on("data", (d) => { stderr += d; });

    proc.on("close", (code) => settle({
      code:   code ?? 1,
      stdout: stdout.slice(-PIPELINE_OUTPUT_TAIL_BYTES),
      stderr: stderr.slice(-PIPELINE_OUTPUT_TAIL_BYTES),
    }));

    proc.on("error", (err) => settle({ code: 1, stdout: "", stderr: err.message }));

    const timer = setTimeout(() => {
      try { proc.kill("SIGTERM"); } catch { /* process already exited */ }
      setTimeout(() => { try { proc.kill("SIGKILL"); } catch { /* already dead */ } }, PIPELINE_KILL_GRACE_MS);
      settle({
        code:   1,
        stdout: stdout.slice(-PIPELINE_OUTPUT_TAIL_BYTES),
        stderr: `${stderr}\nTimeout after ${PIPELINE_TIMEOUT_MS / 1000}s`.slice(-PIPELINE_OUTPUT_TAIL_BYTES),
      });
    }, PIPELINE_TIMEOUT_MS);

    // Clear the timeout once the process exits naturally to avoid a dangling reference.
    proc.on("close", () => clearTimeout(timer));
  });
}

// ─── File dialogs ──────────────────────────────────────────────────────────────

/**
 * Registers file dialog IPC handlers:
 *   - `"export-sh"`        — save a shell script to disk
 *   - `"save-output"`      — save terminal output to a text file
 *   - `"pick-sh-file"`     — open a shell script from disk
 *   - `"pick-termext-file"` — open an extension package (.termext / .zip)
 *
 * @returns {void}
 */
function _registerDialogHandlers() {
  ipcMain.handle("export-sh",         _handleExportSh);
  ipcMain.handle("save-output",       _handleSaveOutput);
  ipcMain.handle("pick-sh-file",      _handlePickShFile);
  ipcMain.handle("pick-termext-file", _handlePickTermextFile);
}

/**
 * Shows a save dialog and writes `content` as an executable shell script.
 *
 * The file is written with mode 0o755 (rwxr-xr-x) so it can be run directly.
 *
 * @param {Electron.IpcMainInvokeEvent} _event        - Unused.
 * @param {string}                      content       - Script text to write.
 * @param {string}                      [suggestedName] - Default filename in the dialog.
 * @returns {Promise<string|null>} Absolute path of the saved file, or `null` if canceled.
 */
async function _handleExportSh(_event, content, suggestedName) {
  if (typeof content !== "string") return null;

  const { dialog } = require("electron");
  const win    = getWindow();
  const result = await dialog.showSaveDialog(win, {
    defaultPath: path.join(os.homedir(), "Desktop", suggestedName || "pipeline.sh"),
    filters:     [{ name: "Shell Script", extensions: ["sh"] }],
  });

  if (!result.canceled && result.filePath) {
    fs.writeFileSync(result.filePath, content, { mode: 0o755 });
    return result.filePath;
  }
  return null;
}

/**
 * Shows a save dialog and writes `content` as a plain-text file.
 *
 * @param {Electron.IpcMainInvokeEvent} _event        - Unused.
 * @param {string}                      content       - Text to write.
 * @param {string}                      [suggestedName] - Default filename in the dialog.
 * @returns {Promise<string|null>} Absolute path of the saved file, or `null` if canceled.
 */
async function _handleSaveOutput(_event, content, suggestedName) {
  if (typeof content !== "string") return null;

  const { dialog } = require("electron");
  const win    = getWindow();
  const result = await dialog.showSaveDialog(win, {
    defaultPath: path.join(os.homedir(), "Desktop", suggestedName || "terminal-output.txt"),
    filters:     [{ name: "Text", extensions: ["txt", "log"] }],
  });

  if (!result.canceled && result.filePath) {
    fs.writeFileSync(result.filePath, content);
    return result.filePath;
  }
  return null;
}

/**
 * Shows an open dialog for shell script files and returns the file's content.
 *
 * @returns {Promise<{ content: string, name: string }|{ canceled: true }|{ error: string }>}
 *   The script content and base name (without extension), a canceled sentinel,
 *   or an error descriptor if the file cannot be read.
 */
async function _handlePickShFile() {
  const { dialog } = require("electron");
  const win    = getWindow();
  const result = await dialog.showOpenDialog(win, {
    title:      "Import Shell Script",
    filters:    [{ name: "Shell Scripts", extensions: ["sh", "bash", "zsh"] }],
    properties: ["openFile"],
  });

  if (result.canceled || !result.filePaths.length) return { canceled: true };

  const fp = result.filePaths[0];
  try {
    return {
      content: fs.readFileSync(fp, "utf-8"),
      name:    path.basename(fp, path.extname(fp)),
    };
  } catch (err) {
    return { error: err.message };
  }
}

/**
 * Shows an open dialog for Shellfire extension packages (.termext or .zip).
 *
 * @returns {Promise<{ filePath: string }|{ canceled: true }>}
 *   The selected file path, or a canceled sentinel.
 */
async function _handlePickTermextFile() {
  const { dialog } = require("electron");
  const win    = getWindow();
  const result = await dialog.showOpenDialog(win, {
    title:      "Install Extension Package",
    filters:    [{ name: "Shellfire Extension", extensions: ["termext", "zip"] }],
    properties: ["openFile"],
  });

  if (result.canceled || !result.filePaths.length) return { canceled: true };
  return { filePath: result.filePaths[0] };
}

// ─── Notifications / editor ────────────────────────────────────────────────────

/**
 * Registers notification and editor integration handlers:
 *   - `"show-notification"` — fire a native desktop notification
 *   - `"open-in-editor"`    — open a file in VS Code, falling back to system default
 *
 * @returns {void}
 */
function _registerNotificationHandlers() {
  ipcMain.on("show-notification", _handleShowNotification);
  ipcMain.on("open-in-editor",    _handleOpenInEditor);
}

/**
 * Displays a native OS notification.
 *
 * No-ops silently when the platform does not support notifications
 * (`Notification.isSupported()` returns false).
 *
 * @param {Electron.IpcMainEvent} _event - Unused.
 * @param {string} title - Notification title.
 * @param {string} body  - Notification body text.
 * @returns {void}
 */
function _handleShowNotification(_event, title, body) {
  if (typeof title !== "string" || typeof body !== "string") return;
  if (Notification.isSupported()) new Notification({ title, body }).show();
}

/**
 * Opens `filePath` in VS Code if available, falling back to the OS default
 * application for that file type.
 *
 * The `code` invocation is fire-and-forget; the `.catch` falls back to
 * `shell.openPath` rather than surfacing an error because VS Code simply
 * not being installed is not an error worth reporting to the renderer.
 *
 * @param {Electron.IpcMainEvent} _event    - Unused.
 * @param {string}                filePath  - Path to open; tilde-expanded and validated.
 * @returns {void}
 */
function _handleOpenInEditor(_event, filePath) {
  const safe = sanitizePath(filePath);
  if (!safe) return;

  // Try VS Code first (async, non-blocking); fall back to the OS default app.
  execFileAsync("code", [safe], { timeout: FAST_TIMEOUT_MS }).catch(() => {
    shell.openPath(safe);
  });
}

// ─── Private helpers ───────────────────────────────────────────────────────────

/**
 * Validates and resolves a user-supplied directory path.
 *
 * Returns `null` for falsy input or when `sanitizePath` rejects the path
 * (null bytes, outside allowed roots, or not a directory).
 *
 * @param {string|undefined} dirPath - Raw directory path, possibly with tilde.
 * @returns {string|null} Resolved absolute directory path, or `null`.
 */
function _resolveSafeDir(dirPath) {
  if (!dirPath) return null;
  return sanitizePath(dirPath);
}

// ─── Exports ──────────────────────────────────────────────────────────────────

module.exports = { registerHandlers };
