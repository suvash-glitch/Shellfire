"use strict";
const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("previewBridge", {
  onCode: (cb) => ipcRenderer.on("preview:code", (_, code, manifest) => cb(code, manifest)),
  onReset: (cb) => ipcRenderer.on("preview:reset", () => cb()),
  platform: process.platform,
});
