"use strict";
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("studio", {
  // Shellfire connection
  sfStatus:           ()          => ipcRenderer.invoke("sf:status"),
  sfInstall:          (opts)      => ipcRenderer.invoke("sf:install-extension", opts),
  sfSend:             (opts)      => ipcRenderer.invoke("sf:send", opts),
  sfRead:             (opts)      => ipcRenderer.invoke("sf:read", opts),

  // File system
  fsRead:             (p)         => ipcRenderer.invoke("fs:read", p),
  fsWrite:            (p, c)      => ipcRenderer.invoke("fs:write", p, c),
  fsOpenFolder:       ()          => ipcRenderer.invoke("fs:open-folder"),
  fsSaveDialog:       (name)      => ipcRenderer.invoke("fs:save-dialog", name),
  fsListInstalled:    ()          => ipcRenderer.invoke("fs:list-installed"),

  platform: process.platform,
});
