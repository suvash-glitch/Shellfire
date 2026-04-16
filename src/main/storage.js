"use strict";

/**
 * @module storage
 * @description Manages all persistent application data for Shellfire via IPC handlers.
 *   Covers session layout, user configuration, settings, snippets, profiles,
 *   recent directories, SSH bookmarks, directory bookmarks, notes, projects,
 *   pipelines, command bookmarks, startup tasks, encrypted secrets, terminal
 *   logging, and sandboxed file preview.
 *
 * Owns:
 *   - Every `ipcMain.on` / `ipcMain.handle` channel related to persistence
 *   - AES-256-CBC encryption/decryption of the secrets store
 *   - Atomic session writes (write-to-tmp then rename)
 *   - Terminal log directory creation and append
 *   - Sandboxed file-read for the renderer's file-preview panel
 *
 * Does NOT own:
 *   - PTY lifecycle (pty-manager.js)
 *   - AI inference calls (ai-service.js)
 *   - Window creation or auto-update (window-manager.js)
 *   - SSH session management (ssh-manager.js)
 */

const crypto = require("crypto");
const fs     = require("fs");
const os     = require("os");
const path   = require("path");

const { ipcMain, app }                       = require("electron");
const { readJSON, writeJSON, log, sanitizeFilePath } = require("./utils");

// ─── Path helpers ──────────────────────────────────────────────────────────────

/**
 * Resolves a filename relative to Electron's userData directory.
 *
 * @param {string} file - Bare filename (e.g. "session.json").
 * @returns {string} Absolute path inside userData.
 */
const DATA = (file) => path.join(app.getPath("userData"), file);

/** Absolute path to the terminal-log directory. */
const LOG_DIR = DATA("logs");

/**
 * Canonical paths for every persisted data file.
 * Add new stores here — keep this table as the single source of truth.
 */
const PATHS = {
  session:      DATA("session.json"),
  config:       DATA("config.json"),
  snippets:     DATA("snippets.json"),
  profiles:     DATA("profiles.json"),
  recents:      DATA("recents.json"),
  ssh:          DATA("ssh-bookmarks.json"),
  notes:        DATA("notes.json"),
  bookmarks:    DATA("bookmarks.json"),
  projects:     DATA("projects.json"),
  pipelines:    DATA("pipelines.json"),
  cmdBookmarks: DATA("cmd-bookmarks.json"),
  startupTasks: DATA("startup-tasks.json"),
  settings:     DATA("settings.json"),
  secrets:      DATA("secrets.json"),
};

// ─── Settings defaults ─────────────────────────────────────────────────────────

/** Default xterm.js scrollback buffer length (number of lines). */
const DEFAULT_SCROLLBACK_LINES = 10000;

/** Default font size in points applied to new terminals. */
const DEFAULT_FONT_SIZE = 13;

/**
 * Full default settings object returned when no settings file exists yet.
 * Mirror any new preference added to the renderer's settings panel here.
 */
const SETTINGS_DEFAULTS = {
  theme:           0,
  fontSize:        DEFAULT_FONT_SIZE,
  fontFamily:      '"SF Mono", "Menlo", "Monaco", "Courier New", monospace',
  cursorStyle:     "block",
  cursorBlink:     true,
  copyOnSelect:    true,
  scrollback:      DEFAULT_SCROLLBACK_LINES,
  shell:           "",
  defaultCwd:      "",
  confirmClose:    true,
  autoSaveSession: true,
  aiAutocomplete:  false,
  aiApiKey:        "",
  aiProvider:      "anthropic",
};

// ─── Secrets encryption (AES-256-CBC) ─────────────────────────────────────────

/**
 * Machine-specific seed used to derive the AES key.
 * Intentionally non-exportable — secrets are unreadable on another machine.
 */
const SECRETS_KEY_SEED = os.hostname() + os.userInfo().username + "shellfire-vault";

/** Algorithm used for the secrets store. */
const SECRETS_ALGORITHM = "aes-256-cbc";

/** IV byte length required by AES-CBC. */
const SECRETS_IV_BYTES = 16;

/** Maximum file size (bytes) that the file-preview handler reads in full. */
const FILE_PREVIEW_DEFAULT_LIMIT = 50_000;

/** Absolute maximum bytes the caller may request for file preview (10 MB). */
const FILE_PREVIEW_MAX_BYTES = 10 * 1024 * 1024;

/** Regex that matches safe shell environment-variable names. */
const SAFE_ENV_KEY = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * Derives a 32-byte AES key from the machine-specific seed via SHA-256.
 *
 * @returns {Buffer} 32-byte key buffer.
 */
function getSecretsKey() {
  return crypto.createHash("sha256").update(SECRETS_KEY_SEED).digest();
}

/**
 * Encrypts an arbitrary JS value to a JSON-safe envelope.
 *
 * @param {*} data - Any JSON-serialisable value.
 * @returns {{ iv: string, data: string }} Hex-encoded IV and ciphertext.
 */
function encryptSecrets(data) {
  const key    = getSecretsKey();
  const iv     = crypto.randomBytes(SECRETS_IV_BYTES);
  const cipher = crypto.createCipheriv(SECRETS_ALGORITHM, key, iv);
  let enc      = cipher.update(JSON.stringify(data), "utf8", "hex");
  enc         += cipher.final("hex");
  return { iv: iv.toString("hex"), data: enc };
}

/**
 * Decrypts an envelope previously produced by {@link encryptSecrets}.
 *
 * @param {{ iv: string, data: string }} encrypted - Hex-encoded IV and ciphertext.
 * @returns {*} The original value that was encrypted.
 */
function decryptSecrets(encrypted) {
  const key      = getSecretsKey();
  const iv       = Buffer.from(encrypted.iv, "hex");
  const decipher = crypto.createDecipheriv(SECRETS_ALGORITHM, key, iv);
  let dec        = decipher.update(encrypted.data, "hex", "utf8");
  dec           += decipher.final("utf8");
  return JSON.parse(dec);
}

// ─── IPC handler groups ────────────────────────────────────────────────────────

/**
 * Registers the session IPC pair.
 * Uses an async write-to-tmp-then-rename pattern to avoid corrupt session files
 * on crash mid-write.
 */
function registerSessionHandlers() {
  ipcMain.on("save-session", (_, data) => {
    try {
      const json = JSON.stringify(data);
      const tmp  = PATHS.session + ".tmp";
      fs.writeFile(tmp, json, (writeErr) => {
        if (writeErr) { log("error", "Session save error:", writeErr); return; }
        fs.rename(tmp, PATHS.session, (renameErr) => {
          if (renameErr) log("error", "Session rename error:", renameErr);
        });
      });
    } catch (e) {
      log("error", "Session serialize error:", e);
    }
  });

  ipcMain.handle("load-session", () => readJSON(PATHS.session, null));
}

/**
 * Registers IPC pairs for every simple JSON store (config, settings, snippets,
 * profiles, recents, SSH bookmarks, notes, directory bookmarks, projects,
 * command bookmarks, and startup tasks).
 */
function registerSimpleStoreHandlers() {
  ipcMain.on("save-config",         (_, d) => writeJSON(PATHS.config, d));
  ipcMain.handle("load-config",     ()     => readJSON(PATHS.config, { theme: 0, fontSize: 13 }));

  ipcMain.on("save-settings",       (_, d) => writeJSON(PATHS.settings, d));
  ipcMain.handle("load-settings",   ()     => readJSON(PATHS.settings, SETTINGS_DEFAULTS));

  ipcMain.on("save-snippets",       (_, d) => writeJSON(PATHS.snippets, d));
  ipcMain.handle("load-snippets",   ()     => readJSON(PATHS.snippets, []));

  ipcMain.on("save-profiles",       (_, d) => writeJSON(PATHS.profiles, d));
  ipcMain.handle("load-profiles",   ()     => readJSON(PATHS.profiles, []));

  ipcMain.on("save-recents",        (_, d) => writeJSON(PATHS.recents, d));
  ipcMain.handle("load-recents",    ()     => readJSON(PATHS.recents, []));

  ipcMain.on("save-ssh",            (_, d) => writeJSON(PATHS.ssh, d));
  ipcMain.handle("load-ssh",        ()     => readJSON(PATHS.ssh, []));

  ipcMain.on("save-notes",          (_, d) => writeJSON(PATHS.notes, d));
  ipcMain.handle("load-notes",      ()     => readJSON(PATHS.notes, { text: "" }));

  ipcMain.on("save-bookmarks",      (_, d) => writeJSON(PATHS.bookmarks, d));
  ipcMain.handle("load-bookmarks",  ()     => readJSON(PATHS.bookmarks, []));

  ipcMain.on("save-projects",       (_, d) => writeJSON(PATHS.projects, d));
  ipcMain.handle("load-projects",   ()     => readJSON(PATHS.projects, null));

  ipcMain.on("save-cmd-bookmarks",  (_, d) => writeJSON(PATHS.cmdBookmarks, d));
  ipcMain.handle("load-cmd-bookmarks", ()  => readJSON(PATHS.cmdBookmarks, []));

  ipcMain.on("save-startup-tasks",  (_, d) => writeJSON(PATHS.startupTasks, d));
  ipcMain.handle("load-startup-tasks", ()  => readJSON(PATHS.startupTasks, []));
}

/**
 * Registers the pipelines IPC pair.
 * Uses `ipcMain.handle` for both directions so the caller can await the save.
 */
function registerPipelineHandlers() {
  ipcMain.handle("save-pipelines", (_, data) => {
    writeJSON(PATHS.pipelines, data);
    return { ok: true };
  });
  ipcMain.handle("load-pipelines", () => readJSON(PATHS.pipelines, []));
}

/**
 * Reads the secrets file and decrypts it.
 * Returns an empty array on any error (missing file, wrong key, corrupt data).
 *
 * @returns {Array} Decrypted secrets array, or [] on failure.
 */
function loadSecretsSync() {
  try {
    const raw = fs.readFileSync(PATHS.secrets, "utf8");
    return decryptSecrets(JSON.parse(raw));
  } catch {
    return [];
  }
}

/**
 * Encrypts and writes the secrets array to disk synchronously.
 *
 * @param {Array} secrets - Array of secret objects to persist.
 */
function saveSecretsSync(secrets) {
  try {
    fs.writeFileSync(PATHS.secrets, JSON.stringify(encryptSecrets(secrets)), "utf8");
  } catch (e) {
    log("error", "Failed to save secrets:", e.message);
  }
}

/**
 * Injects a list of secrets as environment variables into a running PTY.
 * Validates each key against {@link SAFE_ENV_KEY} and single-quote-escapes
 * values to prevent shell injection.
 *
 * @param {Map<number, object>} ptys    - Map of pane ID → PTY instance.
 * @param {number}              id      - Pane ID of the target terminal.
 * @param {Array<{key:string, value:string}>} secrets - Secrets to inject.
 * @returns {{ ok: true, count: number }|{ error: string }} Result object.
 */
function injectSecrets(ptys, id, secrets) {
  const p = ptys.get(id);
  if (!p) return { error: "Terminal not found" };

  let count = 0;
  for (const s of secrets) {
    const validKey   = s.key && SAFE_ENV_KEY.test(s.key);
    const validValue = typeof s.value === "string";
    if (!validKey || !validValue) continue;

    // Single-quote escaping: prevent $(cmd) / `cmd` evaluation inside the shell.
    const safeVal = s.value.replace(/'/g, "'\\''");
    p.write(` export ${s.key}='${safeVal}'\n`);
    count++;
  }
  return { ok: true, count };
}

/**
 * Registers IPC handlers for loading, saving, and injecting secrets.
 *
 * @param {Map<number, object>} ptys - Live PTY map passed in from pty-manager.
 */
function registerSecretsHandlers(ptys) {
  ipcMain.handle("load-secrets",   ()                   => loadSecretsSync());
  ipcMain.on("save-secrets",       (_, secrets)         => saveSecretsSync(secrets));
  ipcMain.handle("inject-secrets", (_, { id, secrets }) => injectSecrets(ptys, id, secrets));
}

/**
 * Registers IPC handlers for terminal output logging to disk.
 * Log files live in {@link LOG_DIR} as `terminal-{paneId}.log`.
 */
function registerLoggingHandlers() {
  ipcMain.on("log-append", (_, paneId, data) => {
    const validId   = typeof paneId === "number" && Number.isInteger(paneId) && paneId >= 1;
    const validData = typeof data === "string";
    if (!validId || !validData) return;

    try {
      if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });
      fs.appendFileSync(path.join(LOG_DIR, `terminal-${paneId}.log`), data);
    } catch {
      // Silently ignore log-write failures — don't crash the terminal session.
    }
  });

  ipcMain.handle("get-log-path", (_, paneId) =>
    path.join(LOG_DIR, `terminal-${paneId}.log`)
  );
}

/**
 * Validates the `maxBytes` argument supplied by the renderer for file preview.
 *
 * @param {number|undefined} maxBytes - Caller-supplied byte limit.
 * @returns {string|null} An error message string, or null if the value is valid.
 */
function validateMaxBytes(maxBytes) {
  if (maxBytes === undefined) return null;
  if (typeof maxBytes !== "number" || maxBytes <= 0 || maxBytes > FILE_PREVIEW_MAX_BYTES) {
    return "Invalid maxBytes (must be 1–10 MB)";
  }
  return null;
}

/**
 * Reads up to `limit` bytes from a file, returning content and metadata.
 * Large files are read with a raw fd to avoid loading the entire file into memory.
 *
 * @param {string} resolved - Absolute, sanitised file path.
 * @param {number} limit    - Maximum bytes to return.
 * @param {number} fileSize - Known file size from a prior `stat` call.
 * @returns {{ content: string, truncated: boolean, size: number }} File result.
 */
function readFileCapped(resolved, limit, fileSize) {
  if (fileSize <= limit) {
    return { content: fs.readFileSync(resolved, "utf8"), truncated: false, size: fileSize };
  }

  const buf = Buffer.alloc(limit);
  let fd;
  try {
    fd = fs.openSync(resolved, "r");
    fs.readSync(fd, buf, 0, limit, 0);
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
  return { content: buf.toString("utf8"), truncated: true, size: fileSize };
}

/**
 * Registers the sandboxed file-read IPC handler used by the renderer's
 * file-preview panel.
 *
 * Security guarantees:
 *   - Path is validated through `sanitizeFilePath` (no traversal, no symlink escape).
 *   - `maxBytes` is capped at {@link FILE_PREVIEW_MAX_BYTES}.
 *   - Directories are rejected with a typed error.
 */
function registerFileReadHandler() {
  ipcMain.handle("read-file", async (_, filePath, maxBytes) => {
    try {
      if (typeof filePath !== "string") return { error: "Invalid file path" };

      const resolved = sanitizeFilePath(filePath);
      if (!resolved) return { error: "Invalid file path" };

      const bytesError = validateMaxBytes(maxBytes);
      if (bytesError) return { error: bytesError };

      const stat = fs.statSync(resolved);
      if (stat.isDirectory()) return { error: "Is a directory", isDir: true };

      const limit = maxBytes || FILE_PREVIEW_DEFAULT_LIMIT;
      return readFileCapped(resolved, limit, stat.size);
    } catch (e) {
      return { error: e.message };
    }
  });
}

// ─── Public API ────────────────────────────────────────────────────────────────

/**
 * Registers all storage-related IPC handlers with Electron's `ipcMain`.
 * Must be called once from `main.js` after the app is ready.
 *
 * @param {Map<number, object>} ptys - Live PTY map from pty-manager, required
 *   for the `inject-secrets` handler.
 */
function registerHandlers(ptys) {
  registerSessionHandlers();
  registerSimpleStoreHandlers();
  registerPipelineHandlers();
  registerSecretsHandlers(ptys);
  registerLoggingHandlers();
  registerFileReadHandler();
}

module.exports = { registerHandlers, PATHS };
