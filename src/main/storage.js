"use strict";

// ============================================================
// STORAGE
// All persistent data: sessions, config, snippets, profiles,
// recents, bookmarks, projects, SSH, notes, pipelines, secrets,
// startup tasks, settings, command bookmarks, logging.
// ============================================================

const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { ipcMain, app } = require("electron");
const { readJSON, writeJSON, log, sanitizePath } = require("./utils");

// ── Storage paths ─────────────────────────────────────────────

const DATA = (file) => path.join(app.getPath("userData"), file);
const LOG_DIR = DATA("logs");

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

const SETTINGS_DEFAULTS = {
  theme: 0,
  fontSize: 13,
  fontFamily: '"SF Mono", "Menlo", "Monaco", "Courier New", monospace',
  cursorStyle: "block",
  cursorBlink: true,
  copyOnSelect: true,
  scrollback: 10000,
  shell: "",
  defaultCwd: "",
  confirmClose: true,
  autoSaveSession: true,
  aiAutocomplete: false,
  aiApiKey: "",
  aiProvider: "anthropic",
};

// ── Secrets (AES-256-CBC) ────────────────────────────────────

const SECRETS_KEY_SEED = os.hostname() + os.userInfo().username + "shellfire-vault";

function getSecretsKey() {
  return crypto.createHash("sha256").update(SECRETS_KEY_SEED).digest();
}

function encryptSecrets(data) {
  const key = getSecretsKey();
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv("aes-256-cbc", key, iv);
  let enc = cipher.update(JSON.stringify(data), "utf8", "hex");
  enc += cipher.final("hex");
  return { iv: iv.toString("hex"), data: enc };
}

function decryptSecrets(encrypted) {
  const key = getSecretsKey();
  const iv = Buffer.from(encrypted.iv, "hex");
  const decipher = crypto.createDecipheriv("aes-256-cbc", key, iv);
  let dec = decipher.update(encrypted.data, "hex", "utf8");
  dec += decipher.final("utf8");
  return JSON.parse(dec);
}

// ── Register all IPC handlers ─────────────────────────────────

function registerHandlers(ptys) {
  // Session (async write — buffers can be large)
  ipcMain.on("save-session", (_, data) => {
    try {
      const json = JSON.stringify(data);
      const tmp = PATHS.session + ".tmp";
      fs.writeFile(tmp, json, (err) => {
        if (err) { log("error", "Session save error:", err); return; }
        fs.rename(tmp, PATHS.session, (e) => { if (e) log("error", "Session rename error:", e); });
      });
    } catch (e) { log("error", "Session serialize error:", e); }
  });
  ipcMain.handle("load-session", () => readJSON(PATHS.session, null));

  // Config
  ipcMain.on("save-config", (_, data) => writeJSON(PATHS.config, data));
  ipcMain.handle("load-config", () => readJSON(PATHS.config, { theme: 0, fontSize: 13 }));

  // Settings (superset of config)
  ipcMain.on("save-settings", (_, data) => writeJSON(PATHS.settings, data));
  ipcMain.handle("load-settings", () => readJSON(PATHS.settings, SETTINGS_DEFAULTS));

  // Snippets
  ipcMain.on("save-snippets", (_, data) => writeJSON(PATHS.snippets, data));
  ipcMain.handle("load-snippets", () => readJSON(PATHS.snippets, []));

  // Profiles / layouts
  ipcMain.on("save-profiles", (_, data) => writeJSON(PATHS.profiles, data));
  ipcMain.handle("load-profiles", () => readJSON(PATHS.profiles, []));

  // Recent directories
  ipcMain.on("save-recents", (_, data) => writeJSON(PATHS.recents, data));
  ipcMain.handle("load-recents", () => readJSON(PATHS.recents, []));

  // SSH bookmarks
  ipcMain.on("save-ssh", (_, data) => writeJSON(PATHS.ssh, data));
  ipcMain.handle("load-ssh", () => readJSON(PATHS.ssh, []));

  // Notes / scratchpad
  ipcMain.on("save-notes", (_, data) => writeJSON(PATHS.notes, data));
  ipcMain.handle("load-notes", () => readJSON(PATHS.notes, { text: "" }));

  // Directory bookmarks
  ipcMain.on("save-bookmarks", (_, data) => writeJSON(PATHS.bookmarks, data));
  ipcMain.handle("load-bookmarks", () => readJSON(PATHS.bookmarks, []));

  // Projects
  ipcMain.on("save-projects", (_, data) => writeJSON(PATHS.projects, data));
  ipcMain.handle("load-projects", () => readJSON(PATHS.projects, null));

  // Pipelines
  ipcMain.handle("save-pipelines", (_, data) => { writeJSON(PATHS.pipelines, data); return { ok: true }; });
  ipcMain.handle("load-pipelines", () => readJSON(PATHS.pipelines, []));

  // Command bookmarks
  ipcMain.on("save-cmd-bookmarks", (_, data) => writeJSON(PATHS.cmdBookmarks, data));
  ipcMain.handle("load-cmd-bookmarks", () => readJSON(PATHS.cmdBookmarks, []));

  // Startup tasks
  ipcMain.on("save-startup-tasks", (_, data) => writeJSON(PATHS.startupTasks, data));
  ipcMain.handle("load-startup-tasks", () => readJSON(PATHS.startupTasks, []));

  // Secrets
  ipcMain.handle("load-secrets", () => {
    try {
      const raw = fs.readFileSync(PATHS.secrets, "utf8");
      return decryptSecrets(JSON.parse(raw));
    } catch { return []; }
  });
  ipcMain.on("save-secrets", (_, secrets) => {
    try {
      fs.writeFileSync(PATHS.secrets, JSON.stringify(encryptSecrets(secrets)), "utf8");
    } catch (e) { log("error", "Failed to save secrets:", e.message); }
  });
  ipcMain.handle("inject-secrets", (_, { id, secrets }) => {
    const p = ptys.get(id);
    if (!p) return { error: "Terminal not found" };
    for (const s of secrets) {
      if (s.key && s.value) p.write(` export ${s.key}=${JSON.stringify(s.value)}\n`);
    }
    return { ok: true, count: secrets.length };
  });

  // Terminal logging
  ipcMain.on("log-append", (_, paneId, data) => {
    try {
      if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });
      fs.appendFileSync(path.join(LOG_DIR, `terminal-${paneId}.log`), data);
    } catch {}
  });
  ipcMain.handle("get-log-path", (_, paneId) => path.join(LOG_DIR, `terminal-${paneId}.log`));

  // File preview
  ipcMain.handle("read-file", async (_, filePath, maxBytes) => {
    try {
      if (typeof filePath !== "string") return { error: "Invalid file path" };
      const resolved = sanitizePath(filePath);
      if (!resolved) return { error: "Invalid file path" };
      if (maxBytes !== undefined && (typeof maxBytes !== "number" || maxBytes <= 0 || maxBytes > 10 * 1024 * 1024)) {
        return { error: "Invalid maxBytes (must be 1–10 MB)" };
      }
      const stat = fs.statSync(resolved);
      if (stat.isDirectory()) return { error: "Is a directory", isDir: true };
      const limit = maxBytes || 50000;
      if (stat.size > limit) {
        const buf = Buffer.alloc(limit);
        let fd;
        try {
          fd = fs.openSync(resolved, "r");
          fs.readSync(fd, buf, 0, limit, 0);
        } finally { if (fd !== undefined) fs.closeSync(fd); }
        return { content: buf.toString("utf8"), truncated: true, size: stat.size };
      }
      return { content: fs.readFileSync(resolved, "utf8"), truncated: false, size: stat.size };
    } catch (e) { return { error: e.message }; }
  });
}

module.exports = { registerHandlers, PATHS };
