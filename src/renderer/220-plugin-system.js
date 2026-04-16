/**
 * @module renderer/220-plugin-system
 * @description Plugin runtime: activateSinglePlugin (loads JS via new Function, sandboxed), _applyPlugin (wires theme/command/statusbar/extension types), deactivatePlugin (removes all registered DOM + hooks + intervals), loadPlugins orchestrator.
 */

// PLUGIN SYSTEM
// ============================================================
const _loadedPlugins = new Set(); // track already-loaded plugin names
// Registry: pluginName -> { type, themeIdx, themeName, commands[], domIds[], hooks:{event:[fn]}, intervals[], settingsSections[], widgetEl }
const _pluginRegistry = new Map();

async function activateSinglePlugin(pluginName, type) {
  if (_loadedPlugins.has(pluginName)) return;
  try {
    const result = await window.shellfire.getPluginCode(pluginName);
    if (!result || result.error) {
      console.warn(`Plugin ${pluginName}: ${result?.error || "no code returned"}`);
      return;
    }

    const pluginExports = {};
    try {
      const pluginFn = new Function("exports", result.code);
      pluginFn(pluginExports);
    } catch (evalErr) {
      console.error(`Plugin eval error: ${pluginName}`, evalErr);
      showToast(`Plugin error: ${pluginName}`, "error");
      return;
    }
    _loadedPlugins.add(pluginName);
    await _applyPlugin(pluginExports, pluginName, type);
  } catch (err) {
    console.error(`Plugin load failed: ${pluginName}`, err);
  }
}

async function _applyPlugin(pluginExports, pluginName, type) {
  const reg = { type, commands: [], domIds: [], hooks: {}, intervals: [], settingsSections: [] };

  if (type === "theme" && pluginExports.theme) {
    const t = pluginExports.theme;
    const themeObj = {
      name: t.name || pluginName,
      body: t.background || "#1e1e1e",
      ui: t.ui || t.background || "#2d2d2d",
      border: t.border || t.background || "#1a1a1a",
      _plugin: pluginName,
      term: {
        background: t.background || "#1e1e1e",
        foreground: t.foreground || "#cccccc",
        cursor: t.cursor || t.foreground || "#cccccc",
        cursorAccent: t.background || "#1e1e1e",
        selectionBackground: t.selection || "rgba(255,255,255,0.2)",
        selectionForeground: t.selectionForeground || "#ffffff",
        black: t.black || "#000000", red: t.red || "#c91b00",
        green: t.green || "#00c200", yellow: t.yellow || "#c7c400",
        blue: t.blue || "#0225c7", magenta: t.magenta || "#c930c7",
        cyan: t.cyan || "#00c5c7", white: t.white || "#c7c7c7",
        brightBlack: t.brightBlack || "#686868", brightRed: t.brightRed || "#ff6e67",
        brightGreen: t.brightGreen || "#5ffa68", brightYellow: t.brightYellow || "#fffc67",
        brightBlue: t.brightBlue || "#6871ff", brightMagenta: t.brightMagenta || "#ff76ff",
        brightCyan: t.brightCyan || "#60fdff", brightWhite: t.brightWhite || "#ffffff",
      },
    };
    themes.push(themeObj);
    reg.themeIdx = themes.length - 1;
    reg.themeName = themeObj.name;
    const cmdLabel = `Theme: ${themeObj.name}`;
    const cmd = { label: cmdLabel, action: () => applyTheme(themes.indexOf(themeObj)), category: "Appearance" };
    commands.push(cmd);
    reg.commands.push(cmd);
  }

  if (type === "command" && pluginExports.name && pluginExports.execute) {
    const cmdCtx = {
      get activePane() { return activeId ? { id: activeId, ...panes.get(activeId) } : null; },
      get allPanes() { return [...panes.entries()].map(([id, p]) => ({ id, ...p })); },
      sendInput: (id, data) => window.shellfire.sendInput(id, data),
      createTerminal: (cwd) => addTerminal(cwd),
      notify: (msg) => showToast(msg),
    };
    const cmd = {
      label: pluginExports.name,
      shortcut: pluginExports.shortcut || undefined,
      action: () => pluginExports.execute(cmdCtx),
      category: "Plugins",
    };
    commands.push(cmd);
    reg.commands.push(cmd);
  }

  if (type === "statusbar" && pluginExports.name && pluginExports.render) {
    const sbCtx = {
      get activePane() { return activeId ? { id: activeId, ...panes.get(activeId) } : null; },
      get allPanes() { return [...panes.entries()].map(([id, p]) => ({ id, ...p })); },
    };
    const widget = document.createElement("span");
    widget.className = "plugin-statusbar-widget";
    widget.style.cssText = "margin-left:8px;font-family:'SF Mono',monospace;font-size:11px;opacity:0.8;";
    widget.title = pluginExports.name;
    try { widget.innerHTML = pluginExports.render(sbCtx); } catch {}
    const bottombar = document.querySelector(".bottombar");
    const paneCountEl2 = document.getElementById("pane-count");
    if (bottombar && paneCountEl2) bottombar.insertBefore(widget, paneCountEl2);
    let errorCount = 0;
    const intervalId = setInterval(() => {
      try {
        if (_appVisible) widget.innerHTML = pluginExports.render(sbCtx);
        errorCount = 0;
      } catch (err) {
        errorCount++;
        if (errorCount >= 3) {
          clearInterval(intervalId);
          console.warn(`Statusbar plugin "${pluginName}" disabled after repeated errors`);
        }
      }
    }, 5000);
    reg.widgetEl = widget;
    reg.intervals.push(intervalId);
  }

  if (type === "extension" && pluginExports.activate) {
    // Create a tracked ctx proxy so we can clean up on uninstall
    const pluginCtx = {
      get activeId() { return window._termExt.activeId; },
      getPane(id) { return window._termExt.getPane(id); },
      get allPaneIds() { return window._termExt.allPaneIds; },
      get fontSize() { return window._termExt.fontSize; },
      get broadcastMode() { return window._termExt.broadcastMode; },
      get skipPermissions() { return window._termExt.skipPermissions; },
      set skipPermissions(val) { window._termExt.skipPermissions = val; },
      toggleSkipPermissions() { window._termExt.toggleSkipPermissions(); },
      sendInput(id, data) { window._termExt.sendInput(id, data); },
      broadcast(ids, data) { window._termExt.broadcast(ids, data); },
      showToast(msg) { window._termExt.showToast(msg); },
      get settings() { return window._termExt.settings; },
      saveSettings() { window._termExt.saveSettings(); },
      get ipc() { return window._termExt.ipc; },
      on(event, fn) {
        window._termExt.on(event, fn);
        if (!reg.hooks[event]) reg.hooks[event] = [];
        reg.hooks[event].push(fn);
      },
      off(event, fn) { window._termExt.off(event, fn); },
      registerCommand(cmd) {
        window._termExt.registerCommand(cmd);
        reg.commands.push(cmd);
      },
      addToolbarButton(opts) {
        window._termExt.addToolbarButton(opts);
        if (opts.id) reg.domIds.push(opts.id);
      },
      addSidePanel(id, html) {
        const panel = window._termExt.addSidePanel(id, html);
        reg.domIds.push(id);
        return panel;
      },
      addSettingsSection(html, onMount) {
        const sec = { html, onMount };
        _extSettingsSections.push(sec);
        reg.settingsSections.push(sec);
      },
    };
    try {
      pluginExports.activate(pluginCtx);
    } catch (err) {
      console.error(`Extension ${pluginName} activation error:`, err);
    }
  }

  _pluginRegistry.set(pluginName, reg);
}

/** Remove all traces of a plugin without reloading */
function deactivatePlugin(pluginName) {
  const reg = _pluginRegistry.get(pluginName);
  if (!reg) return;

  // Remove commands from palette
  for (const cmd of reg.commands) {
    const idx = commands.indexOf(cmd);
    if (idx >= 0) commands.splice(idx, 1);
  }

  // Remove DOM elements (toolbar buttons, side panels)
  for (const domId of reg.domIds) {
    const el = document.getElementById(domId);
    if (el) el.remove();
  }

  // Unhook event listeners
  for (const [event, fns] of Object.entries(reg.hooks)) {
    for (const fn of fns) {
      if (_extHooks[event]) _extHooks[event] = _extHooks[event].filter(f => f !== fn);
    }
  }

  // Clear intervals (statusbar widgets)
  for (const id of reg.intervals) clearInterval(id);
  if (reg.widgetEl && reg.widgetEl.parentNode) reg.widgetEl.remove();

  // Remove settings sections (from array and from DOM if already mounted)
  for (const sec of reg.settingsSections) {
    const idx = _extSettingsSections.indexOf(sec);
    if (idx >= 0) _extSettingsSections.splice(idx, 1);
    if (sec._mounted && sec._container) {
      sec._container.remove();
    }
  }

  // Remove theme if this was a theme plugin
  if (reg.type === "theme" && reg.themeName) {
    const wasActive = themes[currentThemeIdx] && themes[currentThemeIdx].name === reg.themeName;
    const tIdx = themes.findIndex(t => t._plugin === pluginName);
    if (tIdx >= 0) {
      themes.splice(tIdx, 1);
      // Fix currentThemeIdx if the removed theme shifted indices
      if (wasActive) {
        applyTheme(0);
      } else if (tIdx < currentThemeIdx) {
        currentThemeIdx--;
      }
    }
  }

  // Remove injected <style> elements for this plugin
  document.querySelectorAll(`style[data-plugin="${pluginName}"]`).forEach(el => el.remove());

  _loadedPlugins.delete(pluginName);
  _pluginRegistry.delete(pluginName);
}

/** Refresh theme dropdowns & command palette after plugin changes */
function _refreshThemeUIs() {
  // Settings theme dropdown
  const themeSelect = document.getElementById("setting-theme");
  if (themeSelect) {
    themeSelect.innerHTML = "";
    themes.forEach((t, i) => {
      const opt = document.createElement("option");
      opt.value = i; opt.textContent = t.name;
      if (i === currentThemeIdx) opt.selected = true;
      themeSelect.appendChild(opt);
    });
  }
  // Welcome screen theme dropdown
  const welcomeThemeSelect = document.getElementById("welcome-theme-select");
  if (welcomeThemeSelect) {
    welcomeThemeSelect.innerHTML = "";
    themes.forEach((t, i) => {
      const opt = document.createElement("option");
      opt.value = i; opt.textContent = t.name;
      if (i === currentThemeIdx) opt.selected = true;
      welcomeThemeSelect.appendChild(opt);
    });
  }
}

async function loadPlugins() {
  try {
    const plugins = await window.shellfire.loadPlugins();
    if (!Array.isArray(plugins) || plugins.length === 0) return;
    for (const plugin of plugins) {
      try {
        await activateSinglePlugin(plugin.manifest.name, plugin.manifest.type);
      } catch (err) {
        console.error(`[plugins] Failed to load ${plugin.manifest.name}:`, err);
      }
    }
  } catch (err) {
    console.error("[plugins] Plugin system error:", err);
  }
}

// ============================================================
