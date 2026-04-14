"use strict";

// ============================================================
// EXTENSION BUILDER — MAIN PROCESS WINDOW CONTROLLER
// Opens a dedicated BrowserWindow for the visual builder.
// Accessible via Cmd+Shift+E or the Extensions menu.
// ============================================================

const path = require("path");
const { BrowserWindow, ipcMain } = require("electron");
const { log } = require("../main/utils");

let builderWindow = null;

function openExtensionBuilder() {
  if (builderWindow && !builderWindow.isDestroyed()) {
    builderWindow.focus();
    return;
  }

  builderWindow = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 900,
    minHeight: 600,
    title: "Shellfire Extension Builder",
    backgroundColor: "#0f0f0f",
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      preload: path.join(__dirname, "preload.js"),
    },
  });

  builderWindow.loadFile(path.join(__dirname, "index.html"));
  builderWindow.on("closed", () => { builderWindow = null; });
}

// IPC: main window can open the builder
function registerHandlers() {
  ipcMain.on("open-extension-builder", openExtensionBuilder);
}

module.exports = { openExtensionBuilder, registerHandlers };
