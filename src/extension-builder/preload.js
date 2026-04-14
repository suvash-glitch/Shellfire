"use strict";

// ============================================================
// EXTENSION BUILDER — PRELOAD / CONTEXT BRIDGE
// Exposes only what the builder UI needs:
//   - File I/O (read/write extension files)
//   - AI generation (via user's configured API key)
//   - Extension packaging (.termext export)
//   - Plugin directory listing (for "open existing")
// ============================================================

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("builder", {
  // ── File operations ─────────────────────────────────────────
  readFile: (p) => ipcRenderer.invoke("builder:read-file", p),
  writeFile: (p, content) => ipcRenderer.invoke("builder:write-file", p, content),
  listDir: (p) => ipcRenderer.invoke("builder:list-dir", p),
  openFolder: () => ipcRenderer.invoke("builder:open-folder"),
  saveAs: (suggestedName) => ipcRenderer.invoke("builder:save-as", suggestedName),
  exportTermext: (files, pluginName) => ipcRenderer.invoke("builder:export-termext", files, pluginName),
  loadExistingPlugin: () => ipcRenderer.invoke("builder:load-existing-plugin"),

  // ── AI assistance ────────────────────────────────────────────
  aiGenerate: (params) => ipcRenderer.invoke("builder:ai-generate", params),

  // ── Extension metadata ───────────────────────────────────────
  getInstalledPlugins: () => ipcRenderer.invoke("builder:get-installed-plugins"),
  installBuilt: (files, pluginName) => ipcRenderer.invoke("builder:install-built", files, pluginName),

  // ── Docs ────────────────────────────────────────────────────
  getApiDocs: () => ipcRenderer.invoke("builder:get-api-docs"),

  // ── Platform ────────────────────────────────────────────────
  platform: process.platform,
});
