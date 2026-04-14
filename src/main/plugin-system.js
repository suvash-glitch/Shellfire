"use strict";

// ============================================================
// PLUGIN SYSTEM
// Load, install, uninstall, and serve plugins + marketplace.
// Plugin format: a directory with plugin.json + a JS entry point.
// Package format: .termext (zip) containing plugin.json at root.
// ============================================================

const fs = require("fs");
const os = require("os");
const path = require("path");
const { ipcMain, app, net: electronNet } = require("electron");
const { execFileAsync, log } = require("./utils");

const PLUGINS_DIR = path.join(os.homedir(), ".shellfire", "plugins");
const REGISTRY_URL = "https://raw.githubusercontent.com/suvash-glitch/Shellfire/main/registry/plugins.json";
const REGISTRY_TTL = 5 * 60 * 1000; // 5 minutes

const VALID_TYPES = new Set(["theme", "command", "statusbar", "extension"]);
const SAFE_NAME = /^[a-zA-Z0-9._-]+$/;

let _registryCache = null;
let _registryCacheTime = 0;

// ── Internal helpers ─────────────────────────────────────────

function ensurePluginsDir() {
  try { fs.mkdirSync(PLUGINS_DIR, { recursive: true }); } catch {}
}

function validatePluginId(id) {
  return typeof id === "string" && id.length > 0 && !id.includes("..") && !id.includes("/") && !id.includes("\\");
}

function loadPlugins() {
  ensurePluginsDir();
  const plugins = [];
  try {
    for (const entry of fs.readdirSync(PLUGINS_DIR, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      try {
        const manifest = JSON.parse(fs.readFileSync(path.join(PLUGINS_DIR, entry.name, "plugin.json"), "utf8"));
        if (!manifest.name || !VALID_TYPES.has(manifest.type) || !manifest.main) continue;
        plugins.push({ dir: entry.name, manifest });
      } catch {}
    }
  } catch {}
  return plugins;
}

function loadLocalRegistry() {
  try {
    const localPath = path.join(__dirname, "..", "..", "registry", "plugins.json");
    if (fs.existsSync(localPath)) {
      const data = JSON.parse(fs.readFileSync(localPath, "utf8"));
      _registryCache = data;
      _registryCacheTime = Date.now();
      return data;
    }
  } catch {}
  return { version: 1, plugins: [] };
}

async function installFromZip(zipPath, destId) {
  const tmpDir = path.join(app.getPath("temp"), `termext-${Date.now()}`);
  fs.mkdirSync(tmpDir, { recursive: true });
  try {
    await execFileAsync("unzip", ["-o", "-q", zipPath, "-d", tmpDir], { timeout: 10000 });
    const manifestPath = path.join(tmpDir, "plugin.json");
    if (!fs.existsSync(manifestPath)) throw new Error("Package missing plugin.json");
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    if (!manifest.name || !VALID_TYPES.has(manifest.type) || !manifest.main) throw new Error("Invalid plugin manifest");
    const id = destId || manifest.name.replace(/[^a-zA-Z0-9_-]/g, "-").toLowerCase();
    const dest = path.join(PLUGINS_DIR, id);
    if (fs.existsSync(dest)) fs.rmSync(dest, { recursive: true, force: true });
    fs.cpSync(tmpDir, dest, { recursive: true });
    return { ok: true, id, manifest };
  } finally {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  }
}

// ── IPC handlers ─────────────────────────────────────────────

function registerHandlers() {
  ensurePluginsDir();

  ipcMain.handle("load-plugins", () => loadPlugins());

  ipcMain.handle("get-plugin-code", (_, pluginName) => {
    if (typeof pluginName !== "string" || !SAFE_NAME.test(pluginName)) return { error: "Invalid plugin name" };
    const plugin = loadPlugins().find(p => p.manifest.name === pluginName);
    if (!plugin) return { error: "Plugin not found" };
    try {
      const code = fs.readFileSync(path.join(PLUGINS_DIR, plugin.dir, plugin.manifest.main), "utf8");
      return { code };
    } catch { return { error: "Could not read plugin code" }; }
  });

  // Marketplace: fetch remote registry with local fallback and TTL cache
  ipcMain.handle("fetch-registry", async () => {
    if (_registryCache && (Date.now() - _registryCacheTime < REGISTRY_TTL)) return _registryCache;
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
    } catch { return loadLocalRegistry(); }
  });

  // Install from marketplace: download individual files or copy from local registry
  ipcMain.handle("install-from-registry", async (_, { id, files, downloadUrl }) => {
    if (!validatePluginId(id)) return { error: "Invalid plugin id" };
    const dest = path.join(PLUGINS_DIR, id);
    try {
      fs.mkdirSync(dest, { recursive: true });
      let downloaded = false;
      if (downloadUrl && files) {
        try {
          for (const filename of Object.keys(files)) {
            const res = await electronNet.fetch(downloadUrl + filename, { method: "GET" });
            if (!res.ok) throw new Error(`Failed to fetch ${filename}: ${res.status}`);
            fs.writeFileSync(path.join(dest, filename), await res.text());
          }
          downloaded = true;
        } catch (e) { log("info", `Remote download failed for ${id}, trying local: ${e.message}`); }
      }
      if (!downloaded) {
        const localSrc = path.join(__dirname, "..", "..", "registry", "plugins", id);
        if (!fs.existsSync(localSrc)) {
          fs.rmSync(dest, { recursive: true, force: true });
          return { error: "Plugin not available" };
        }
        fs.cpSync(localSrc, dest, { recursive: true });
      }
      return { ok: true };
    } catch (e) {
      try { fs.rmSync(dest, { recursive: true, force: true }); } catch {}
      return { error: e.message };
    }
  });

  // Install from bundled examples / registry dir
  ipcMain.handle("install-plugin", (_, pluginDir) => {
    if (!validatePluginId(pluginDir)) return { error: "Invalid plugin name" };
    const bases = [
      path.join(__dirname, "..", "..", "registry", "plugins"),
      path.join(__dirname, "..", "..", "examples", "plugins"),
    ];
    for (const base of bases) {
      const src = path.join(base, pluginDir);
      if (!fs.existsSync(src)) continue;
      try {
        fs.cpSync(src, path.join(PLUGINS_DIR, pluginDir), { recursive: true });
        return { ok: true };
      } catch (e) { return { error: e.message }; }
    }
    return { error: "Plugin not found" };
  });

  ipcMain.handle("uninstall-plugin", (_, pluginDir) => {
    if (!validatePluginId(pluginDir)) return { error: "Invalid plugin name" };
    const dest = path.join(PLUGINS_DIR, pluginDir);
    if (!fs.existsSync(dest)) return { error: "Plugin not found" };
    try { fs.rmSync(dest, { recursive: true, force: true }); return { ok: true }; }
    catch (e) { return { error: e.message }; }
  });

  // Install from local .termext/.zip file
  ipcMain.handle("install-termext", async (_, filePath) => {
    if (typeof filePath !== "string") return { error: "Invalid file path" };
    if (!filePath.endsWith(".termext") && !filePath.endsWith(".zip")) return { error: "Not a .termext package" };
    if (!fs.existsSync(filePath)) return { error: "File not found" };
    try { return await installFromZip(filePath, null); }
    catch (e) { return { error: e.message }; }
  });

  // Download .termext from URL and install
  ipcMain.handle("download-and-install-termext", async (_, { url, id }) => {
    if (typeof url !== "string" || !validatePluginId(id)) return { error: "Invalid parameters" };
    const tmpFile = path.join(app.getPath("temp"), `${id}-${Date.now()}.termext`);
    try {
      const res = await electronNet.fetch(url, { method: "GET" });
      if (!res.ok) throw new Error(`Download failed: ${res.status}`);
      fs.writeFileSync(tmpFile, Buffer.from(await res.arrayBuffer()));
      return await installFromZip(tmpFile, id);
    } catch (e) {
      try { fs.unlinkSync(tmpFile); } catch {}
      return { error: e.message };
    }
  });

  // List available from bundled sources (backward compat)
  ipcMain.handle("list-available-plugins", () => {
    const bases = [
      path.join(__dirname, "..", "..", "registry", "plugins"),
      path.join(__dirname, "..", "..", "examples", "plugins"),
    ];
    for (const base of bases) {
      try {
        const available = [];
        for (const entry of fs.readdirSync(base, { withFileTypes: true })) {
          if (!entry.isDirectory()) continue;
          try {
            const manifest = JSON.parse(fs.readFileSync(path.join(base, entry.name, "plugin.json"), "utf8"));
            if (!manifest.name || !VALID_TYPES.has(manifest.type) || !manifest.main) continue;
            const installed = fs.existsSync(path.join(PLUGINS_DIR, entry.name, "plugin.json"));
            available.push({ dir: entry.name, manifest, installed });
          } catch {}
        }
        if (available.length) return available;
      } catch {}
    }
    return [];
  });
}

module.exports = { registerHandlers, PLUGINS_DIR, loadPlugins };
