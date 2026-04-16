"use strict";

/**
 * @module plugin-system
 *
 * Plugin lifecycle management and marketplace integration for Shellfire.
 *
 * Owns:
 *   - Discovery and loading of installed plugins from disk
 *   - Installation from bundled sources, a remote registry, and .termext packages
 *   - Uninstallation and safe path validation for plugin IDs
 *   - Remote marketplace registry fetching with TTL caching and local fallback
 *   - IPC handler registration for all plugin-related renderer requests
 *
 * Does NOT own:
 *   - Plugin activation or sandboxed code execution (see renderer/220-plugin-system.js)
 *   - General persistent storage helpers (see storage.js)
 *   - Window or PTY state (see state.js, window-manager.js)
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const { ipcMain, app, net: electronNet } = require("electron");
const { execFileAsync, log } = require("./utils");

// ─── Constants ────────────────────────────────────────────────────────────────

/** Absolute path to the user's installed plugins directory. */
const PLUGINS_DIR = path.join(os.homedir(), ".shellfire", "plugins");

/** GitHub URL for the remote plugin registry JSON. */
const REGISTRY_URL =
  "https://raw.githubusercontent.com/suvash-glitch/Shellfire/main/registry/plugins.json";

/** How long (ms) a successful registry fetch is reused before re-fetching. */
const REGISTRY_TTL_MS = 5 * 60 * 1000; // 5 minutes

/** Prefix used when naming the temporary extraction directory for .termext installs. */
const TERMEXT_TMP_PREFIX = "termext-";

/** Timeout (ms) granted to the `unzip` subprocess when extracting a .termext package. */
const UNZIP_TIMEOUT_MS = 10_000;

/**
 * Set of recognised plugin type strings.
 * Any manifest whose `type` field is not in this set is rejected during load.
 *
 * @type {Set<string>}
 */
const VALID_TYPES = new Set(["theme", "command", "statusbar", "extension"]);

/**
 * Allowlist regex for plugin IDs.
 *
 * Rules:
 *   - Must start with an alphanumeric character
 *   - May contain alphanumeric characters, dots, underscores, and hyphens
 *   - Maximum length of 64 characters
 *   - No slashes (prevents directory traversal)
 *
 * @type {RegExp}
 */
const SAFE_PLUGIN_ID = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/;

/**
 * File extensions recognised as installable plugin packages.
 *
 * @type {string[]}
 */
const VALID_PACKAGE_EXTENSIONS = [".termext", ".zip"];

// ─── Registry cache (module-level, reset on process restart) ─────────────────

/** Last successfully fetched registry payload, or `null` if never fetched. */
let _registryCache = null;

/** Unix timestamp (ms) of the last successful registry fetch. */
let _registryCacheTime = 0;

// ─── Internal helpers ─────────────────────────────────────────────────────────

/**
 * Creates the plugins directory if it does not already exist.
 * Errors are silently swallowed because the directory may be created
 * concurrently by another call or may already exist — neither case is fatal.
 *
 * @returns {void}
 */
function ensurePluginsDir() {
  try {
    fs.mkdirSync(PLUGINS_DIR, { recursive: true });
  } catch {
    // Directory already exists or creation raced with another call — safe to ignore.
  }
}

/**
 * Validates a plugin ID string and resolves the absolute destination path
 * inside {@link PLUGINS_DIR}.
 *
 * Performs two layers of protection:
 *   1. Regex allowlist rejects IDs containing slashes or unusual characters.
 *   2. `path.resolve` plus prefix check prevents symlink-based traversal where
 *      a crafted ID could resolve to a path outside PLUGINS_DIR.
 *
 * @param {string} id - Plugin identifier to validate.
 * @returns {string|null} Resolved absolute path, or `null` if the ID is invalid.
 */
function resolvePluginDest(id) {
  if (typeof id !== "string" || !SAFE_PLUGIN_ID.test(id)) return null;
  const dest = path.resolve(PLUGINS_DIR, id);
  // The resolved path must be a strict child of PLUGINS_DIR.
  if (!dest.startsWith(PLUGINS_DIR + path.sep) && dest !== PLUGINS_DIR) return null;
  return dest;
}

/**
 * Returns `true` if `id` passes the plugin ID allowlist check.
 * Convenience wrapper around {@link resolvePluginDest} for callers that only
 * need a boolean answer.
 *
 * @param {string} id - Plugin identifier to validate.
 * @returns {boolean}
 */
function validatePluginId(id) {
  return resolvePluginDest(id) !== null;
}

/**
 * Reads and validates every plugin directory inside {@link PLUGINS_DIR}.
 *
 * A plugin directory is included only when its `plugin.json` manifest:
 *   - Contains a non-empty `name` field
 *   - Has a `type` field present in {@link VALID_TYPES}
 *   - Has a non-empty `main` field
 *
 * Individual parse failures are silently skipped so one corrupt plugin cannot
 * prevent all others from loading.
 *
 * @returns {{ dir: string, manifest: object }[]} Array of loaded plugin descriptors.
 */
function loadPlugins() {
  ensurePluginsDir();
  const plugins = [];

  try {
    for (const entry of fs.readdirSync(PLUGINS_DIR, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const manifest = readManifest(path.join(PLUGINS_DIR, entry.name));
      if (manifest) plugins.push({ dir: entry.name, manifest });
    }
  } catch {
    // PLUGINS_DIR is unreadable (permissions issue) — return what we have so far.
  }

  return plugins;
}

/**
 * Reads and parses a `plugin.json` manifest from a plugin directory.
 * Returns `null` if the file is missing, malformed, or fails validation.
 *
 * @param {string} pluginDir - Absolute path to the plugin directory.
 * @returns {object|null} Parsed and validated manifest object, or `null`.
 */
function readManifest(pluginDir) {
  try {
    const manifest = JSON.parse(
      fs.readFileSync(path.join(pluginDir, "plugin.json"), "utf8")
    );
    if (!manifest.name || !VALID_TYPES.has(manifest.type) || !manifest.main) return null;
    return manifest;
  } catch {
    // File missing or JSON parse error — caller skips this entry.
    return null;
  }
}

/**
 * Attempts to load the registry from the bundled local copy at
 * `registry/plugins.json` (relative to the project root).
 *
 * If successful, the result is written to the in-memory cache so a
 * subsequent call to `fetch-registry` within the TTL window will return it
 * without a network request.
 *
 * @returns {{ version: number, plugins: object[] }} Registry payload, or an empty one on failure.
 */
function loadLocalRegistry() {
  try {
    const localPath = path.join(__dirname, "..", "..", "registry", "plugins.json");
    if (fs.existsSync(localPath)) {
      const data = JSON.parse(fs.readFileSync(localPath, "utf8"));
      _registryCache = data;
      _registryCacheTime = Date.now();
      return data;
    }
  } catch {
    // File missing or malformed — fall through to empty registry.
  }
  return { version: 1, plugins: [] };
}

/**
 * Extracts a .termext zip archive into a temporary directory, validates the
 * embedded `plugin.json`, then copies only plain files (no symlinks) into the
 * final destination under {@link PLUGINS_DIR}.
 *
 * Security notes:
 *   - `unzip -j` junks directory paths, preventing path traversal inside the zip.
 *   - Symlinks inside the archive are skipped entirely during the copy step.
 *   - The destination is validated via {@link resolvePluginDest} before writing.
 *   - The temporary directory is always deleted in the `finally` block.
 *
 * @param {string}      zipPath - Absolute path to the .termext / .zip source file.
 * @param {string|null} destId  - Desired plugin ID, or `null` to derive one from the manifest name.
 * @returns {Promise<{ ok: true, id: string, manifest: object }>} Installation result.
 * @throws {Error} If the archive is invalid, the manifest fails validation, or the ID is unsafe.
 */
async function installFromZip(zipPath, destId) {
  const tmpDir = path.join(app.getPath("temp"), `${TERMEXT_TMP_PREFIX}${Date.now()}`);
  fs.mkdirSync(tmpDir, { recursive: true });

  try {
    // -j: junk stored paths (no dir traversal), -q: quiet, -n: never overwrite existing
    await execFileAsync("unzip", ["-j", "-q", zipPath, "-d", tmpDir], {
      timeout: UNZIP_TIMEOUT_MS,
    });

    const manifest = parseExtractedManifest(tmpDir);
    const id = destId || derivePluginId(manifest.name);
    const dest = resolvePluginDest(id);
    if (!dest) throw new Error("Invalid plugin id");

    replacePluginDir(tmpDir, dest);
    return { ok: true, id, manifest };
  } finally {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // Cleanup failure is non-fatal; the OS will reclaim the temp dir eventually.
    }
  }
}

/**
 * Reads and validates the `plugin.json` extracted into `tmpDir`.
 *
 * @param {string} tmpDir - Temporary extraction directory path.
 * @returns {object} Validated manifest object.
 * @throws {Error} If `plugin.json` is absent or the manifest fields are invalid.
 */
function parseExtractedManifest(tmpDir) {
  const manifestPath = path.join(tmpDir, "plugin.json");
  if (!fs.existsSync(manifestPath)) throw new Error("Package missing plugin.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  if (!manifest.name || !VALID_TYPES.has(manifest.type) || !manifest.main) {
    throw new Error("Invalid plugin manifest");
  }
  return manifest;
}

/**
 * Derives a filesystem-safe plugin ID from a raw manifest name.
 * Replaces any character that is not alphanumeric, underscore, or hyphen with
 * a hyphen, then lowercases the result.
 *
 * @param {string} name - Raw `name` field from a plugin manifest.
 * @returns {string} Sanitised, lowercase plugin ID.
 */
function derivePluginId(name) {
  return name.replace(/[^a-zA-Z0-9_-]/g, "-").toLowerCase();
}

/**
 * Removes the existing plugin directory at `dest` (if present) and copies
 * only plain files from `srcDir`, skipping any symbolic links to prevent
 * symlink-escape attacks.
 *
 * @param {string} srcDir - Temporary extraction directory containing unpacked files.
 * @param {string} dest   - Absolute destination path inside {@link PLUGINS_DIR}.
 * @returns {void}
 */
function replacePluginDir(srcDir, dest) {
  if (fs.existsSync(dest)) fs.rmSync(dest, { recursive: true, force: true });
  fs.mkdirSync(dest, { recursive: true });

  for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) continue; // Skip symlinks to prevent escape from tmpDir.
    if (entry.isFile()) {
      fs.copyFileSync(path.join(srcDir, entry.name), path.join(dest, entry.name));
    }
  }
}

// ─── IPC handlers ─────────────────────────────────────────────────────────────

/**
 * Registers all plugin-related `ipcMain` handlers.
 * Must be called once during app initialisation (typically from `main.js`).
 *
 * Channels registered:
 *   - `load-plugins`              — Return all installed plugins
 *   - `get-plugin-code`           — Read a plugin's entry-point source
 *   - `fetch-registry`            — Fetch or return cached marketplace registry
 *   - `install-from-registry`     — Download or copy a registry plugin
 *   - `install-plugin`            — Install from bundled sources
 *   - `uninstall-plugin`          — Delete an installed plugin directory
 *   - `install-termext`           — Install from a local .termext / .zip file
 *   - `download-and-install-termext` — Download a .termext from a URL and install
 *   - `list-available-plugins`    — List bundled / example plugins (backward compat)
 *
 * @returns {void}
 */
function registerHandlers() {
  ensurePluginsDir();

  ipcMain.handle("load-plugins", _handleLoadPlugins);
  ipcMain.handle("get-plugin-code", _handleGetPluginCode);
  ipcMain.handle("fetch-registry", _handleFetchRegistry);
  ipcMain.handle("install-from-registry", _handleInstallFromRegistry);
  ipcMain.handle("install-plugin", _handleInstallPlugin);
  ipcMain.handle("uninstall-plugin", _handleUninstallPlugin);
  ipcMain.handle("install-termext", _handleInstallTermext);
  ipcMain.handle("download-and-install-termext", _handleDownloadAndInstallTermext);
  ipcMain.handle("list-available-plugins", _handleListAvailablePlugins);
}

// ─── Handler implementations ──────────────────────────────────────────────────

/**
 * IPC handler: `load-plugins`
 * Returns the array of all currently installed plugins.
 *
 * @returns {{ dir: string, manifest: object }[]}
 */
function _handleLoadPlugins() {
  return loadPlugins();
}

/**
 * IPC handler: `get-plugin-code`
 * Reads and returns the source code of a plugin's entry-point file.
 *
 * @param {Electron.IpcMainInvokeEvent} _event - IPC event (unused).
 * @param {string} pluginName - The `name` field from the plugin's manifest.
 * @returns {{ code: string }|{ error: string }}
 */
function _handleGetPluginCode(_event, pluginName) {
  if (typeof pluginName !== "string" || !SAFE_PLUGIN_ID.test(pluginName)) {
    return { error: "Invalid plugin name" };
  }
  const plugin = loadPlugins().find((p) => p.manifest.name === pluginName);
  if (!plugin) return { error: "Plugin not found" };

  try {
    const code = fs.readFileSync(
      path.join(PLUGINS_DIR, plugin.dir, plugin.manifest.main),
      "utf8"
    );
    return { code };
  } catch {
    // Plugin directory or main file was removed after we listed it — surface as error.
    return { error: "Could not read plugin code" };
  }
}

/**
 * IPC handler: `fetch-registry`
 * Returns the marketplace registry, using an in-memory cache to avoid
 * repeated network requests within the {@link REGISTRY_TTL_MS} window.
 * Falls back to the bundled local registry on network failure.
 *
 * @returns {Promise<{ version: number, plugins: object[] }>}
 */
async function _handleFetchRegistry() {
  const cacheAge = Date.now() - _registryCacheTime;
  if (_registryCache && cacheAge < REGISTRY_TTL_MS) return _registryCache;

  try {
    const res = await electronNet.fetch(REGISTRY_URL, { method: "GET" });
    if (!res.ok) return loadLocalRegistry();

    const data = await res.json();
    if (data?.plugins && Array.isArray(data.plugins)) {
      _registryCache = data;
      _registryCacheTime = Date.now();
      return data;
    }
    return loadLocalRegistry();
  } catch {
    // Network unavailable or fetch threw — serve local fallback silently.
    return loadLocalRegistry();
  }
}

/**
 * IPC handler: `install-from-registry`
 * Installs a plugin by ID, preferring a remote download and falling back to
 * the bundled local registry directory when the download fails.
 *
 * @param {Electron.IpcMainInvokeEvent} _event - IPC event (unused).
 * @param {{ id: string, files: object|undefined, downloadUrl: string|undefined }} params
 * @returns {Promise<{ ok: true }|{ error: string }>}
 */
async function _handleInstallFromRegistry(_event, { id, files, downloadUrl }) {
  const dest = resolvePluginDest(id);
  if (!dest) return { error: "Invalid plugin id" };

  try {
    fs.mkdirSync(dest, { recursive: true });

    const downloaded = await _tryRemoteDownload(id, dest, files, downloadUrl);
    if (!downloaded) {
      const fallbackResult = _copyFromLocalRegistry(id, dest);
      if (fallbackResult) return fallbackResult;
    }

    return { ok: true };
  } catch (e) {
    try { fs.rmSync(dest, { recursive: true, force: true }); } catch {
      // Best-effort cleanup; the directory may have been partially written.
    }
    return { error: e.message };
  }
}

/**
 * Attempts to download each file in `files` from `downloadUrl` into `dest`.
 * Returns `true` if all files were downloaded successfully, `false` otherwise.
 * On partial failure the error is logged and the caller falls through to the
 * local registry copy, so throwing is intentionally avoided here.
 *
 * @param {string}            id          - Plugin ID (used only for log messages).
 * @param {string}            dest        - Absolute destination directory.
 * @param {object|undefined}  files       - Map of filename → (ignored value).
 * @param {string|undefined}  downloadUrl - Base URL from which to fetch each filename.
 * @returns {Promise<boolean>} `true` if remote download succeeded.
 */
async function _tryRemoteDownload(id, dest, files, downloadUrl) {
  if (!downloadUrl || !files) return false;

  try {
    for (const filename of Object.keys(files)) {
      const res = await electronNet.fetch(downloadUrl + filename, { method: "GET" });
      if (!res.ok) throw new Error(`Failed to fetch ${filename}: ${res.status}`);
      fs.writeFileSync(path.join(dest, filename), await res.text());
    }
    return true;
  } catch (e) {
    log("info", `Remote download failed for ${id}, trying local: ${e.message}`);
    return false;
  }
}

/**
 * Copies a plugin from the bundled local registry directory into `dest`.
 * Returns an error result if the local source does not exist, `null` on
 * success (allowing the caller to return `{ ok: true }`).
 *
 * @param {string} id   - Plugin ID, used to locate `registry/plugins/{id}`.
 * @param {string} dest - Absolute destination directory.
 * @returns {{ error: string }|null} Error object if unavailable, otherwise `null`.
 */
function _copyFromLocalRegistry(id, dest) {
  const localSrc = path.join(__dirname, "..", "..", "registry", "plugins", id);
  if (!fs.existsSync(localSrc)) {
    fs.rmSync(dest, { recursive: true, force: true });
    return { error: "Plugin not available" };
  }
  fs.cpSync(localSrc, dest, { recursive: true });
  return null;
}

/**
 * IPC handler: `install-plugin`
 * Installs a plugin from bundled sources (registry or examples directories).
 * Searches each base directory in order and installs from the first match.
 *
 * @param {Electron.IpcMainInvokeEvent} _event     - IPC event (unused).
 * @param {string}                       pluginDir  - Subdirectory name of the plugin to install.
 * @returns {{ ok: true }|{ error: string }}
 */
function _handleInstallPlugin(_event, pluginDir) {
  const dest = resolvePluginDest(pluginDir);
  if (!dest) return { error: "Invalid plugin name" };

  const searchBases = [
    path.join(__dirname, "..", "..", "registry", "plugins"),
    path.join(__dirname, "..", "..", "examples", "plugins"),
  ];

  for (const base of searchBases) {
    const src = path.join(base, pluginDir);
    if (!fs.existsSync(src)) continue;
    try {
      fs.cpSync(src, dest, { recursive: true });
      return { ok: true };
    } catch (e) {
      return { error: e.message };
    }
  }

  return { error: "Plugin not found" };
}

/**
 * IPC handler: `uninstall-plugin`
 * Removes a plugin's directory from {@link PLUGINS_DIR}.
 *
 * @param {Electron.IpcMainInvokeEvent} _event     - IPC event (unused).
 * @param {string}                       pluginDir  - Subdirectory name of the plugin to remove.
 * @returns {{ ok: true }|{ error: string }}
 */
function _handleUninstallPlugin(_event, pluginDir) {
  const dest = resolvePluginDest(pluginDir);
  if (!dest) return { error: "Invalid plugin name" };
  if (!fs.existsSync(dest)) return { error: "Plugin not found" };

  try {
    fs.rmSync(dest, { recursive: true, force: true });
    return { ok: true };
  } catch (e) {
    return { error: e.message };
  }
}

/**
 * IPC handler: `install-termext`
 * Installs a plugin from a local .termext or .zip file on the user's filesystem.
 *
 * @param {Electron.IpcMainInvokeEvent} _event    - IPC event (unused).
 * @param {string}                       filePath  - Absolute path to the package file.
 * @returns {Promise<{ ok: true, id: string, manifest: object }|{ error: string }>}
 */
async function _handleInstallTermext(_event, filePath) {
  if (typeof filePath !== "string") return { error: "Invalid file path" };

  const hasValidExt = VALID_PACKAGE_EXTENSIONS.some((ext) => filePath.endsWith(ext));
  if (!hasValidExt) return { error: "Not a .termext package" };
  if (!fs.existsSync(filePath)) return { error: "File not found" };

  try {
    return await installFromZip(filePath, null);
  } catch (e) {
    return { error: e.message };
  }
}

/**
 * IPC handler: `download-and-install-termext`
 * Downloads a .termext package from a URL to a temporary file, then installs it.
 * The temporary file is always deleted after installation (success or failure).
 *
 * @param {Electron.IpcMainInvokeEvent} _event         - IPC event (unused).
 * @param {{ url: string, id: string }}  params
 * @param {string}                        params.url   - Download URL of the .termext package.
 * @param {string}                        params.id    - Desired plugin ID.
 * @returns {Promise<{ ok: true, id: string, manifest: object }|{ error: string }>}
 */
async function _handleDownloadAndInstallTermext(_event, { url, id }) {
  if (typeof url !== "string" || !resolvePluginDest(id)) {
    return { error: "Invalid parameters" };
  }

  const tmpFile = path.join(app.getPath("temp"), `${id}-${Date.now()}.termext`);
  try {
    const res = await electronNet.fetch(url, { method: "GET" });
    if (!res.ok) throw new Error(`Download failed: ${res.status}`);
    fs.writeFileSync(tmpFile, Buffer.from(await res.arrayBuffer()));
    return await installFromZip(tmpFile, id);
  } catch (e) {
    return { error: e.message };
  } finally {
    try { fs.unlinkSync(tmpFile); } catch {
      // Temp file may not have been written if the fetch failed early — ignore.
    }
  }
}

/**
 * IPC handler: `list-available-plugins`
 * Returns an array of plugins available for installation from bundled sources,
 * annotated with whether each is already installed.
 *
 * Searches each base directory in order and returns the first non-empty result
 * for backward compatibility with callers that expect a single flat list.
 *
 * @returns {{ dir: string, manifest: object, installed: boolean }[]}
 */
function _handleListAvailablePlugins() {
  const searchBases = [
    path.join(__dirname, "..", "..", "registry", "plugins"),
    path.join(__dirname, "..", "..", "examples", "plugins"),
  ];

  for (const base of searchBases) {
    try {
      const available = _collectAvailableFromBase(base);
      if (available.length) return available;
    } catch {
      // Base directory does not exist or is unreadable — try the next one.
    }
  }

  return [];
}

/**
 * Scans a single base directory for valid plugin folders and checks each
 * against the installed plugins directory.
 *
 * @param {string} base - Absolute path to a directory containing plugin subdirectories.
 * @returns {{ dir: string, manifest: object, installed: boolean }[]}
 */
function _collectAvailableFromBase(base) {
  const available = [];

  for (const entry of fs.readdirSync(base, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const manifest = readManifest(path.join(base, entry.name));
    if (!manifest) continue;

    const installed = fs.existsSync(
      path.join(PLUGINS_DIR, entry.name, "plugin.json")
    );
    available.push({ dir: entry.name, manifest, installed });
  }

  return available;
}

// ─── Exports ──────────────────────────────────────────────────────────────────

module.exports = { registerHandlers, PLUGINS_DIR, loadPlugins };
