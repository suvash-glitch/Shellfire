"use strict";

/**
 * @module utils
 *
 * Shared utilities for the Shellfire main process.
 *
 * Owns:
 *   - Structured console logging (`log`)
 *   - Promisified child-process execution (`execFileAsync`)
 *   - Path sanitisation and allowed-root enforcement
 *   - Input validators for host, user, and port values
 *   - Atomic JSON read/write helpers
 *
 * Does NOT own:
 *   - PTY state or window references (see state.js)
 *   - IPC handler registration (see individual *-manager / *-handlers modules)
 *   - Persistent storage paths (see storage.js)
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFile } = require("child_process");

// ─── Constants ───────────────────────────────────────────────────────────────

/** Default timeout (ms) for child-process executions via {@link execFileAsync}. */
const EXEC_TIMEOUT_MS = 2000;

/** Maximum allowed hostname length (RFC 1123). */
const MAX_HOST_LENGTH = 255;

/** Maximum allowed POSIX username length. */
const MAX_USER_LENGTH = 64;

/** Lowest valid TCP/UDP port number. */
const MIN_PORT = 1;

/** Highest valid TCP/UDP port number. */
const MAX_PORT = 65535;

// ─── Allowed path roots ───────────────────────────────────────────────────────

const _home = os.homedir();
const _tmp = os.tmpdir();

/**
 * Canonical allowed root directories (without trailing separator).
 * Both `_tmp` and the literal `/tmp` are included because on macOS
 * `os.tmpdir()` often resolves to `/private/tmp` while callers may
 * supply `/tmp`.
 *
 * @type {string[]}
 */
const ALLOWED_ROOTS = [_home, _tmp, "/tmp"];

// ─── Logging ─────────────────────────────────────────────────────────────────

/**
 * Writes a timestamped, levelled log line to stdout or stderr.
 *
 * @param {string}    level - Severity label, e.g. `"info"`, `"warn"`, `"error"`.
 * @param {string}    msg   - Primary message text.
 * @param {...unknown} args  - Optional extra values forwarded to `console.*`.
 * @returns {void}
 */
function log(level, msg, ...args) {
  const ts = new Date().toISOString();
  const line = `[${ts}] [${level}] ${msg}`;
  const method = level === "error" ? "error" : "log";
  if (args.length) console[method](line, ...args);
  else console[method](line);
}

// ─── Async exec helper ────────────────────────────────────────────────────────

/**
 * Promisified wrapper around `child_process.execFile`.
 *
 * Resolves with the trimmed stdout string on success.
 * Rejects with the native `Error` on non-zero exit or timeout.
 *
 * @param {string}   cmd        - Executable to run (no shell expansion).
 * @param {string[]} args       - Argument list passed directly to the process.
 * @param {object}   [opts={}]  - Options forwarded to `execFile`; `encoding`
 *                                defaults to `"utf8"` and `timeout` defaults
 *                                to {@link EXEC_TIMEOUT_MS}.
 * @returns {Promise<string>} Trimmed stdout of the child process.
 */
function execFileAsync(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    execFile(
      cmd,
      args,
      { encoding: "utf8", timeout: EXEC_TIMEOUT_MS, ...opts },
      (err, stdout) => {
        if (err) reject(err);
        else resolve(stdout.trim());
      }
    );
  });
}

// ─── Path sanitisation ────────────────────────────────────────────────────────

/**
 * Returns `true` if `resolved` equals an allowed root or is a direct
 * descendant of one. The trailing-separator check prevents a path like
 * `/Users/foohack` from being accepted when `/Users/foo` is a root.
 *
 * @param {string} resolved - Absolute, normalised file-system path.
 * @returns {boolean}
 */
function _inAllowedRoot(resolved) {
  return ALLOWED_ROOTS.some(
    (root) => resolved === root || resolved.startsWith(root + path.sep)
  );
}

/**
 * Expands a tilde prefix, resolves the path, and verifies that it:
 *   1. Contains no null bytes.
 *   2. Falls within an allowed root directory.
 *   3. Exists and is a **directory** on disk.
 *
 * Returns `null` for any invalid or unsafe input.
 *
 * @param {string} p - Raw path string, which may start with `~`.
 * @returns {string|null} Absolute resolved path, or `null` if invalid.
 */
function sanitizePath(p) {
  const resolved = _resolveSafePath(p);
  if (!resolved) return null;
  try {
    if (!fs.statSync(resolved).isDirectory()) return null;
  } catch {
    return null;
  }
  return resolved;
}

/**
 * Variant of {@link sanitizePath} for **files** rather than directories.
 *
 * Expands tilde, resolves the path, and checks for null bytes and allowed
 * roots — but does **not** require the path to exist or be a directory.
 * Callers are responsible for existence checks appropriate to their context.
 *
 * @param {string} p - Raw path string, which may start with `~`.
 * @returns {string|null} Absolute resolved path, or `null` if invalid.
 */
function sanitizeFilePath(p) {
  return _resolveSafePath(p);
}

/**
 * Shared path expansion and allowed-root check used by both
 * {@link sanitizePath} and {@link sanitizeFilePath}.
 *
 * @param {string} p - Raw path string.
 * @returns {string|null} Resolved path if safe, otherwise `null`.
 */
function _resolveSafePath(p) {
  if (typeof p !== "string") return null;
  if (p.includes("\0")) return null;

  let expanded = p;
  if (expanded === "~") expanded = _home;
  else if (expanded.startsWith("~/")) expanded = path.join(_home, expanded.slice(2));

  const resolved = path.resolve(expanded);
  if (!_inAllowedRoot(resolved)) return null;
  return resolved;
}

// ─── Input validators ─────────────────────────────────────────────────────────

/**
 * Returns `true` if `h` is a syntactically valid hostname or IP address.
 * Accepts letters, digits, hyphens, underscores, and dots up to
 * {@link MAX_HOST_LENGTH} characters.
 *
 * @param {unknown} h - Value to test.
 * @returns {boolean}
 */
function isValidHost(h) {
  return (
    typeof h === "string" &&
    h.length > 0 &&
    h.length <= MAX_HOST_LENGTH &&
    /^[a-zA-Z0-9._-]+$/.test(h)
  );
}

/**
 * Returns `true` if `u` is a syntactically valid POSIX username.
 * Accepts letters, digits, hyphens, underscores, and dots up to
 * {@link MAX_USER_LENGTH} characters.
 *
 * @param {unknown} u - Value to test.
 * @returns {boolean}
 */
function isValidUser(u) {
  return (
    typeof u === "string" &&
    u.length > 0 &&
    u.length <= MAX_USER_LENGTH &&
    /^[a-zA-Z0-9._-]+$/.test(u)
  );
}

/**
 * Returns `true` if `p` is a valid TCP/UDP port number
 * (integer in [{@link MIN_PORT}, {@link MAX_PORT}]).
 *
 * @param {unknown} p - Value to test; strings are coerced via `Number()`.
 * @returns {boolean}
 */
function isValidPort(p) {
  const n = Number(p);
  return Number.isInteger(n) && n >= MIN_PORT && n <= MAX_PORT;
}

// ─── Atomic JSON storage ──────────────────────────────────────────────────────

/**
 * Reads and parses a JSON file synchronously.
 *
 * Returns `fallback` when the file does not exist (`ENOENT`).
 * Logs an error and returns `fallback` for any other read or parse failure.
 *
 * @param {string}  filePath - Absolute path to the JSON file.
 * @param {unknown} fallback - Value returned when the file is absent or unreadable.
 * @returns {unknown} Parsed JSON value, or `fallback` on failure.
 */
function readJSON(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (err) {
    if (err.code !== "ENOENT") {
      log("error", `Failed to read ${path.basename(filePath)}:`, err.message);
    }
    return fallback;
  }
}

/**
 * Serialises `data` to JSON and writes it atomically via a `.tmp` swap file.
 *
 * The write-then-rename pattern ensures readers never observe a partial file.
 * On failure the temporary file is cleaned up and an error is logged; no
 * exception is thrown.
 *
 * @param {string}  filePath - Absolute path of the target JSON file.
 * @param {unknown} data     - JSON-serialisable value to persist.
 * @returns {void}
 */
function writeJSON(filePath, data) {
  const tmp = filePath + ".tmp";
  try {
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
    fs.renameSync(tmp, filePath);
  } catch (err) {
    log("error", `Failed to write ${path.basename(filePath)}:`, err.message);
    try { fs.unlinkSync(tmp); } catch { /* tmp may not exist — ignore */ }
  }
}

// ─── Exports ──────────────────────────────────────────────────────────────────

module.exports = {
  log,
  execFileAsync,
  sanitizePath,
  sanitizeFilePath,
  isValidHost,
  isValidUser,
  isValidPort,
  readJSON,
  writeJSON,
};
