/**
 * @module renderer/270-init
 * @description Application initialisation: loads settings, restores or reattaches PTY sessions, starts auto-save timer, registers palette commands, and wires cleanup on unload.
 */

// REGISTER NEW COMMANDS IN PALETTE
// ============================================================
commands.push(
  { label: "Secrets Vault", action: () => openSecretsPanel(), category: "Tools" },
  { label: "Startup Tasks", action: () => openStartupTasks(), category: "Tools" },
  { label: "Float Pane (Enhanced PiP)", action: () => toggleFloating(), category: "Tools" },
);

// ============================================================
// INIT
// ============================================================

// Window controls for Windows/Linux (frameless window)
if (window.shellfire.platform !== "darwin") {
  document.body.classList.add("show-win-controls");
  document.getElementById("win-minimize").addEventListener("click", () => window.shellfire.winMinimize());
  document.getElementById("win-maximize").addEventListener("click", () => window.shellfire.winMaximize());
  document.getElementById("win-close").addEventListener("click", () => window.shellfire.winClose());
}

(async () => {
  let _savedThemeName = null; // preserve across applyTheme overwrites
  try {
    const [config, savedSnippets, savedProfiles, savedSession, savedSettings] = await Promise.all([
      window.shellfire.loadConfig(),
      window.shellfire.loadSnippets(),
      window.shellfire.loadProfiles(),
      window.shellfire.loadSession(),
      window.shellfire.loadSettings(),
    ]);
    await Promise.all([loadRecentDirs(), loadSshBookmarks(), loadNotes(), loadBookmarks(), loadPipelinesData(), loadCmdBookmarksData(), loadSecretsVault(), loadStartupTasks()]);

    // Apply settings
    if (savedSettings) {
      settings = savedSettings;
      if (settings.copyOnSelect !== undefined) copyOnSelect = settings.copyOnSelect;
      if (settings.confirmClose !== undefined) confirmClose = settings.confirmClose;
      if (settings.aiSuggestions !== undefined) aiSuggestions = settings.aiSuggestions;
      if (settings.autoSaveInterval) autoSaveInterval = settings.autoSaveInterval;
      if (settings.bufferLimit) bufferLimit = settings.bufferLimit * 1024;
      if (settings.keybindings) customKeybindings = settings.keybindings;
      if (settings.ideMode) {
        ideMode = true;
        document.body.classList.add("ide-mode");
        ideModeBtn.classList.add("active-toggle");
      }
      setupAutoSave();
    }

    if (config) {
      if (config.theme >= 0 && config.theme < themes.length) currentThemeIdx = config.theme;
      if (config.fontSize) currentFontSize = config.fontSize;
      if (config.themeName) _savedThemeName = config.themeName;
      if (typeof config.zoom === "number" && config.zoom >= 0.5 && config.zoom <= 3) currentZoom = config.zoom;
    }
    // Settings override config
    if (settings.theme >= 0 && settings.theme < themes.length) currentThemeIdx = settings.theme;
    if (settings.themeName) _savedThemeName = settings.themeName;
    if (settings.fontSize) currentFontSize = settings.fontSize;
    if (typeof settings.zoom === "number" && settings.zoom >= 0.5 && settings.zoom <= 3) currentZoom = settings.zoom;
    // Session override (most recent state)
    if (savedSession && savedSession.themeName) _savedThemeName = savedSession.themeName;
    if (savedSession && savedSession.theme >= 0 && savedSession.theme < themes.length) currentThemeIdx = savedSession.theme;

    // Apply persisted zoom IMMEDIATELY before any rendering so the UI opens at the right size
    if (currentZoom !== 1.0) {
      try { await window.shellfire.setZoom(currentZoom); } catch {}
    }
    if (Array.isArray(savedSnippets)) snippets = savedSnippets;
    if (Array.isArray(savedProfiles)) profiles = savedProfiles;

    // Set CSS custom properties early (no toast, no config save) so terminals render correctly
    {
      const t = themes[currentThemeIdx] || themes[0];
      const root = document.documentElement;
      root.style.setProperty("--t-bg", t.body);
      root.style.setProperty("--t-fg", t.term.foreground || "#cccccc");
      root.style.setProperty("--t-ui", t.ui);
      root.style.setProperty("--t-border", t.border);
      root.style.setProperty("--t-accent", t.term.cursor || "#00f0ff");
    }

    // === TMUX-LIKE REATTACH ===
    // Check for live PTYs from a previous window session. If any exist,
    // reattach to them (they kept running while the window was closed).
    let reattached = false;
    try {
      const livePtys = await window.shellfire.listPtys();
      if (Array.isArray(livePtys) && livePtys.length > 0) {
        for (const ep of livePtys) {
          // Create pane hooked to the EXISTING PTY id — no new shell spawned
          const id = await createPaneObj(ep.cwd, null, true, ep.id);
          const pane = panes.get(id);
          if (pane && ep.buffer) {
            // Write the live PTY's accumulated output directly to xterm.
            // These are the exact bytes the PTY emitted, so xterm will
            // reproduce the same visual state (including alt-screen apps).
            pane.term.write(ep.buffer);
            pane.rawBuffer = ep.buffer;
            pane._rawChunks = [ep.buffer];
            pane._rawSize = ep.buffer.length;
            pane._replayPending = false;
            if (pane._replayQueue) {
              for (const chunk of pane._replayQueue) pane.term.write(chunk);
              pane._replayQueue = null;
            }
          }
          // Apply session metadata if we can match by cwd or just by order
          if (savedSession?.paneStates) {
            const match = savedSession.paneStates.find(ps => ps.cwd === ep.cwd);
            if (match && pane) {
              if (match.customName) { pane.customName = match.customName; pane.titleEl.textContent = match.customName; }
              if (match.userRenamed) pane._userRenamed = true;
              if (match.color) applyPaneColor(id, match.color, match.termBg || null, match.termFg || null);
              if (match.locked) { pane.locked = true; pane.el.classList.add("locked"); pane.el.querySelector(".lock-badge")?.classList.add("locked"); }
            }
          }
        }
        // Restore layout if it matches the reattached pane count
        if (savedSession?.layout?.length > 0) {
          const savedIds = [];
          for (const row of savedSession.layout) for (const col of row.cols) savedIds.push(col.paneId);
          const currentIds = [...panes.keys()];
          if (savedIds.length === currentIds.length) {
            layout = JSON.parse(JSON.stringify(savedSession.layout));
            for (let ri = 0; ri < layout.length; ri++)
              for (let ci = 0; ci < layout[ri].cols.length; ci++) {
                const oldIdx = savedIds.indexOf(layout[ri].cols[ci].paneId);
                if (oldIdx >= 0 && oldIdx < currentIds.length) layout[ri].cols[ci].paneId = currentIds[oldIdx];
              }
            renderLayout();
          } else rebuildLayout();
        } else rebuildLayout();
        const first = [...panes.keys()][0];
        if (first) setActive(first);
        showToast(`Reattached to ${livePtys.length} terminal${livePtys.length > 1 ? "s" : ""}`);
        reattached = true;
      }
    } catch (err) {
      console.error("Reattach error:", err);
    }

    // If no live PTYs (fresh launch or after reboot), try session restore from disk
    if (!reattached && savedSession && ((savedSession.version === 2 && savedSession.paneStates?.length > 0) || (savedSession.cwds?.length > 0))) {
      if (savedSession.version === 2 && savedSession.paneStates?.length > 0) {
        for (const ps of savedSession.paneStates) {
          const hasBuffer = !!ps.rawBuffer;
          const id = await createPaneObj(ps.cwd, ps.restoreCmd || null, hasBuffer);
          const pane = panes.get(id);
          if (pane) {
            if (hasBuffer) {
              const sanitized = sanitizeReplayBuffer(ps.rawBuffer);
              pane.term.write(sanitized);
              pane.term.write(RESET_SEQ);
              pane.rawBuffer = ps.rawBuffer;
              pane._rawChunks = [ps.rawBuffer];
              pane._rawSize = ps.rawBuffer.length;
              pane._replayPending = false;
              if (pane._replayQueue) {
                for (const chunk of pane._replayQueue) pane.term.write(chunk);
                pane._replayQueue = null;
              }
            }
            if (ps.customName) { pane.customName = ps.customName; pane.titleEl.textContent = ps.customName; }
            if (ps.userRenamed) pane._userRenamed = true;
            if (ps.color) applyPaneColor(id, ps.color, ps.termBg || null, ps.termFg || null);
            if (ps.locked) { pane.locked = true; pane.el.classList.add("locked"); pane.el.querySelector(".lock-badge")?.classList.add("locked"); }
          }
        }
        if (savedSession.layout?.length > 0) {
          const savedIds = [];
          for (const row of savedSession.layout) for (const col of row.cols) savedIds.push(col.paneId);
          const currentIds = [...panes.keys()];
          if (savedIds.length === currentIds.length) {
            layout = JSON.parse(JSON.stringify(savedSession.layout));
            for (let ri = 0; ri < layout.length; ri++)
              for (let ci = 0; ci < layout[ri].cols.length; ci++) {
                const oldIdx = savedIds.indexOf(layout[ri].cols[ci].paneId);
                if (oldIdx >= 0 && oldIdx < currentIds.length) layout[ri].cols[ci].paneId = currentIds[oldIdx];
              }
            renderLayout();
          } else rebuildLayout();
        } else rebuildLayout();

        if (savedSession.skipPermissions) { skipPermissions = false; toggleSkipPermissions(); }
        const count = savedSession.paneStates.length;
        showToast(`Restored ${count} terminal${count > 1 ? "s" : ""}`);
      } else {
        for (const cwd of savedSession.cwds) await createPaneObj(cwd);
        rebuildLayout();
        showToast(`Restored ${savedSession.cwds.length} terminal${savedSession.cwds.length > 1 ? "s" : ""}`);
      }
      const first = [...panes.keys()][0];
      if (first) setActive(first);
    } else if (!reattached) {
      // Fresh start — no live PTYs, no saved session
      const didAutoStart = await runAutoStartupTasks();
      if (!didAutoStart) {
        await addTerminal();
      }
    }
    updateWelcomeScreen();

    // Check for first-run onboarding
    if (await checkOnboarding()) {
      showOnboarding();
    }

    // Load plugins (may add new themes)
    await loadPlugins();
    _refreshThemeUIs();

    // Single, final theme application — resolves saved name including plugin themes
    if (_savedThemeName) {
      const savedIdx = themes.findIndex(t => t.name === _savedThemeName);
      if (savedIdx >= 0) currentThemeIdx = savedIdx;
    }
    applyTheme(currentThemeIdx, true);

    // Initialize IDE sidebar if enabled
    if (ideMode) setTimeout(() => updateIdeSidebar(), 200);
    setTimeout(() => updateBottomBar(), 500);
    setTimeout(() => { updateK8sWidget(); updateAwsWidget(); }, 1000);
  } catch (err) {
    console.error("Init error:", err);
    try { await addTerminal(); updateWelcomeScreen(); } catch {}
  }
})();

// ============================================================
// CLEANUP ON UNLOAD (prevent interval leaks on renderer reload)
// ============================================================
window.addEventListener("beforeunload", () => {
  // Clear all watch timers
  for (const [, w] of watchTimers) clearInterval(w.timer);
  watchTimers.clear();
  // Clear auto-save timer
  if (autoSaveTimer) clearInterval(autoSaveTimer);
  // Clear all plugin intervals to prevent leaks on reload
  for (const [, reg] of _pluginRegistry) {
    for (const id of reg.intervals) clearInterval(id);
  }
  _pluginRegistry.clear();
  _loadedPlugins.clear();
});

// ============================================================
