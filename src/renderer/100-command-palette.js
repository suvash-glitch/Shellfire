// ============================================================
// COMMAND PALETTE
// ============================================================
const paletteOverlay = document.getElementById("palette-overlay");
const paletteInput = document.getElementById("palette-input");
const paletteResults = document.getElementById("palette-results");
let paletteSelectedIdx = 0;

// Quick launch project definitions (used by commands + button handlers)
const defaultProjects = [];
let launchProjects = [...defaultProjects];

const commands = [
  // Terminals
  { label: "New Terminal", shortcut: "Cmd+T", action: () => addTerminal(), category: "Terminal" },
  { label: "New Terminal in Same Dir", shortcut: "Cmd+Shift+T", action: () => addTerminalSameDir(), category: "Terminal" },
  { label: "Split Right", shortcut: "Cmd+D", action: () => splitPane("horizontal"), category: "Terminal" },
  { label: "Split Down", shortcut: "Cmd+Shift+D", action: () => splitPane("vertical"), category: "Terminal" },
  { label: "Close Pane", shortcut: "Cmd+W", action: () => { if (activeId) removeTerminal(activeId); }, category: "Terminal" },
  { label: "Close All Other Panes", shortcut: "Cmd+Shift+X", action: () => closeAllOthers(), category: "Terminal" },
  { label: "Clear Terminal", shortcut: "Cmd+K", action: () => { if (activeId && panes.has(activeId)) panes.get(activeId).term.clear(); }, category: "Terminal" },
  { label: "Quick Command", shortcut: "Cmd+;", action: () => openQuickCmd(), category: "Terminal" },
  // Layout
  { label: "Zoom Pane", shortcut: "Cmd+Shift+Enter", action: () => toggleZoom(), category: "Layout" },
  { label: "Reset Layout", action: () => resetLayout(), category: "Layout" },
  { label: "Toggle Broadcast", shortcut: "Cmd+Shift+B", action: () => toggleBroadcast(), category: "Layout" },
  { label: "Toggle Fullscreen", action: () => window.shellfire.toggleFullscreen(), category: "Layout" },
  { label: "Zen Mode (All Monitors)", shortcut: "Cmd+Shift+Z", action: () => toggleZenMode(), category: "View" },
  // Pane
  { label: "Rename Pane", action: () => { if (activeId) renamePaneUI(activeId); }, category: "Pane" },
  { label: "Lock/Unlock Pane", action: () => { if (activeId) togglePaneLock(activeId); }, category: "Pane" },
  { label: "Cycle Pane Color", action: () => { if (activeId) cyclePaneColor(activeId); }, category: "Pane" },
  { label: "Save Pane Output", action: () => captureOutput(), category: "Pane" },
  // Search & Find
  { label: "Find in Terminal", shortcut: "Cmd+F", action: () => openSearch(), category: "Search" },
  { label: "Find in All Panes", shortcut: "Cmd+Shift+G", action: () => { searchAllMode = true; searchAllToggle.classList.add("active"); searchInput.placeholder = "Search all panes..."; openSearch(); }, category: "Search" },
  { label: "Search All Panes", action: () => openCrossPaneSearch(), category: "Search" },
  { label: "File Finder", shortcut: "Cmd+Shift+F", action: () => openFileFinder(), category: "Search" },
  { label: "File Preview", action: () => openFilePreview(), category: "Search" },
  { label: "Recent Directories", action: () => openRecentDirs(), category: "Search" },
  { label: "Directory Bookmarks", action: () => openBookmarks(), category: "Search" },
  { label: "Bookmark Current Directory", action: () => toggleBookmark(), category: "Search" },
  // Tools
  { label: "Snippets", shortcut: "Cmd+Shift+R", action: () => openSnippetRunner(), category: "Tools" },
  { label: "Split & Run Command", action: () => openSplitAndRun(), category: "Tools" },
  { label: "Watch Mode (repeat command)", action: () => openWatchMode(), category: "Tools" },
  { label: "SSH Bookmarks", action: () => openSshManager(), category: "Tools" },
  { label: "Connect to Remote", action: () => openRemoteConnect(), category: "Tools" },
  { label: "Docker Containers", action: () => openDockerPanel(), category: "Tools" },
  { label: "Port Manager", shortcut: "Cmd+Shift+P", action: () => openPortPanel(), category: "Tools" },
  { label: "Command History Search", shortcut: "Ctrl+R", action: () => openHistorySearch(), category: "Search" },
  { label: "Pipeline Runner", action: () => openPipelinePanel(), category: "Tools" },
  { label: "Command Bookmarks", action: () => openCmdBookmarksPanel(), category: "Tools" },
  { label: "Bookmark Current Command", action: () => bookmarkLastCommand(), category: "Tools" },
  { label: "Environment Variables", action: () => openEnvViewer(), category: "Tools" },
  { label: "Keyword Watcher", action: () => toggleWatcher(), category: "Tools" },
  { label: "Scratchpad / Notes", action: () => openNotes(), category: "Tools" },
  { label: "Link Panes", action: () => linkPanes(), category: "Tools" },
  { label: "Float Pane (PiP)", action: () => toggleFloating(), category: "Tools" },
  { label: "Toggle Terminal Logging", action: () => toggleLogging(), category: "Tools" },
  { label: "Startup Profiles", action: () => openProfileManager(), category: "Tools" },
  { label: "Cron Manager", action: () => openCronManager(), category: "Tools" },
  { label: "Toggle Skip Permissions", action: () => toggleSkipPermissions(), category: "Tools" },
  { label: "Toggle Copy on Select", action: () => { copyOnSelect = !copyOnSelect; showToast(copyOnSelect ? "Copy on select ON" : "Copy on select OFF"); }, category: "Tools" },
  { label: "Toggle AI Suggestions", action: () => { aiSuggestions = !aiSuggestions; settings.aiSuggestions = aiSuggestions; window.shellfire.saveSettings(settings); showToast(aiSuggestions ? "AI suggestions ON" : "AI suggestions OFF"); }, category: "Tools" },
  // Session
  { label: "Save Session", shortcut: "Cmd+Shift+S", action: () => saveCurrentSession(), category: "Session" },
  { label: "Restore Session", action: () => restoreSession(), category: "Session" },
  // Appearance
  { label: "Increase Font Size", shortcut: "Cmd+Plus", action: () => setFontSize(currentFontSize + 1), category: "Appearance" },
  { label: "Decrease Font Size", shortcut: "Cmd+Minus", action: () => setFontSize(currentFontSize - 1), category: "Appearance" },
  { label: "Reset Font Size", action: () => setFontSize(13), category: "Appearance" },
  { label: "Cycle Theme", action: () => cycleTheme(), category: "Appearance" },
  { label: "Theme: Dark", action: () => applyTheme(0), category: "Appearance" },
  { label: "Theme: Solarized Dark", action: () => applyTheme(1), category: "Appearance" },
  { label: "Theme: Dracula", action: () => applyTheme(2), category: "Appearance" },
  { label: "Theme: Monokai", action: () => applyTheme(3), category: "Appearance" },
  { label: "Theme: Nord", action: () => applyTheme(4), category: "Appearance" },
  { label: "Theme: Light", action: () => applyTheme(5), category: "Appearance" },
  // Quick Launch
  ...launchProjects.map(p => ({
    label: `Launch: ${p.name} + Claude`, category: "Launch",
    action: async () => { const id = await addTerminal(p.path); if (id !== undefined) setTimeout(() => launchClaude(id), 150); }
  })),
  // View
  { label: "Toggle IDE Mode", shortcut: "Cmd+Shift+I", action: () => toggleIdeMode(), category: "View" },
  // System
  { label: "Quit", shortcut: "Cmd+Q", action: () => window.shellfire.quit(), category: "System" },
];

function openPalette() {
  // Clean up any existing palette handlers before opening a new one
  if (_paletteCleanup) { _paletteCleanup(); _paletteCleanup = null; }
  paletteOverlay.classList.add("visible");
  paletteInput.placeholder = "Type a command...";
  paletteInput.value = ""; paletteSelectedIdx = 0;
  renderPaletteResults(""); paletteInput.focus();
}
let _paletteCleanup = null;
function closePalette() {
  paletteOverlay.classList.remove("visible");
  if (_paletteCleanup) { _paletteCleanup(); _paletteCleanup = null; }
  if (activeId && panes.has(activeId)) panes.get(activeId).term.focus();
}

function renderPaletteResults(query) {
  const q = query.toLowerCase();
  const filtered = q ? commands.filter(c => c.label.toLowerCase().includes(q) || (c.category && c.category.toLowerCase().includes(q))) : commands;
  paletteSelectedIdx = Math.min(paletteSelectedIdx, Math.max(0, filtered.length - 1));
  paletteResults.innerHTML = "";
  let lastCategory = null;
  filtered.forEach((cmd, i) => {
    // Show category header when not searching
    if (!q && cmd.category && cmd.category !== lastCategory) {
      lastCategory = cmd.category;
      const header = document.createElement("div");
      header.style.cssText = "padding:6px 16px 2px;font-size:10px;color:color-mix(in srgb, var(--t-fg) 40%, transparent);font-weight:600;letter-spacing:0.5px;text-transform:uppercase;";
      if (i > 0) header.style.borderTop = "1px solid var(--t-border)";
      header.textContent = cmd.category;
      paletteResults.appendChild(header);
    }
    const el = document.createElement("div"); el.className = "palette-item" + (i === paletteSelectedIdx ? " selected" : "");
    el.innerHTML = `<span class="palette-item-label">${cmd.label}</span>${cmd.shortcut ? `<span class="palette-item-shortcut">${cmd.shortcut}</span>` : ""}`;
    el.addEventListener("click", () => { closePalette(); cmd.action(); });
    el.addEventListener("mouseenter", () => { paletteSelectedIdx = i; paletteResults.querySelectorAll(".palette-item").forEach((e, j) => e.classList.toggle("selected", j === i)); });
    paletteResults.appendChild(el);
  });
}

paletteInput.addEventListener("input", () => { paletteSelectedIdx = 0; renderPaletteResults(paletteInput.value); });
paletteInput.addEventListener("keydown", (e) => {
  const items = paletteResults.querySelectorAll(".palette-item");
  if (e.key === "ArrowDown") { e.preventDefault(); paletteSelectedIdx = Math.min(paletteSelectedIdx + 1, items.length - 1); items.forEach((el, i) => el.classList.toggle("selected", i === paletteSelectedIdx)); items[paletteSelectedIdx]?.scrollIntoView({ block: "nearest" }); }
  else if (e.key === "ArrowUp") { e.preventDefault(); paletteSelectedIdx = Math.max(paletteSelectedIdx - 1, 0); items.forEach((el, i) => el.classList.toggle("selected", i === paletteSelectedIdx)); items[paletteSelectedIdx]?.scrollIntoView({ block: "nearest" }); }
  else if (e.key === "Enter") { e.preventDefault(); items[paletteSelectedIdx]?.click(); }
  else if (e.key === "Escape") closePalette();
});
paletteOverlay.addEventListener("click", (e) => { if (e.target === paletteOverlay) closePalette(); });

