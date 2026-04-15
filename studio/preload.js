"use strict";
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("studio", {
  // Preview window
  previewOpen:        ()           => ipcRenderer.invoke("preview:open"),
  previewIsOpen:      ()           => ipcRenderer.invoke("preview:is-open"),
  previewSendCode:    (code, mf)   => ipcRenderer.send("preview:code", code, mf),
  previewReset:       ()           => ipcRenderer.send("preview:reset"),

  // Shellfire connection
  sfStatus:           ()           => ipcRenderer.invoke("sf:status"),
  sfInstall:          (opts)       => ipcRenderer.invoke("sf:install-extension", opts),
  sfUninstall:        (id)         => ipcRenderer.invoke("sf:uninstall-extension", id),
  sfSend:             (opts)       => ipcRenderer.invoke("sf:send", opts),
  sfRead:             (opts)       => ipcRenderer.invoke("sf:read", opts),

  // File system
  fsRead:             (p)          => ipcRenderer.invoke("fs:read", p),
  fsWrite:            (p, c)       => ipcRenderer.invoke("fs:write", p, c),
  fsOpenFolder:       ()           => ipcRenderer.invoke("fs:open-folder"),
  fsSaveDialog:       (name)       => ipcRenderer.invoke("fs:save-dialog", name),
  fsListInstalled:    ()           => ipcRenderer.invoke("fs:list-installed"),
  fsExportTermext:    (opts)       => ipcRenderer.invoke("fs:export-termext", opts),

  platform: process.platform,
});
