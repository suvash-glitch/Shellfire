// ENHANCED BOTTOM BAR
// ============================================================
const bottombarBranch = document.getElementById("bottombar-branch");
const bottombarCwd = document.getElementById("bottombar-cwd");
const bottombarShell = document.getElementById("bottombar-shell");

async function updateBottomBar() {
  if (!activeId || !panes.has(activeId)) {
    bottombarBranch.classList.remove("visible");
    bottombarCwd.classList.remove("visible");
    return;
  }
  const pane = panes.get(activeId);
  // CWD
  try {
    const cwd = await window.shellfire.getCwd(activeId);
    if (cwd) {
      const home = cwd.replace(/^\/Users\/[^/]+/, "~").replace(/^\/home\/[^/]+/, "~");
      bottombarCwd.textContent = home;
      bottombarCwd.classList.add("visible");
    } else {
      bottombarCwd.classList.remove("visible");
    }

    // Git
    if (cwd) {
      const [branch, status] = await Promise.all([
        window.shellfire.getGitBranch(cwd),
        window.shellfire.getGitStatus(cwd),
      ]);
      if (branch) {
        bottombarBranch.innerHTML = `<svg viewBox="0 0 24 24"><circle cx="12" cy="6" r="2"/><circle cx="12" cy="18" r="2"/><line x1="12" y1="8" x2="12" y2="16"/></svg> ${escapeHtml(branch)}`;
        bottombarBranch.className = "bottombar-branch visible " + (status === "dirty" ? "dirty" : "clean");
      } else {
        bottombarBranch.classList.remove("visible");
      }
    }
  } catch {
    bottombarCwd.classList.remove("visible");
    bottombarBranch.classList.remove("visible");
  }
}
setInterval(updateBottomBar, 3000);

// Show shell name in bottombar
(async () => {
  try {
    const shell = await window.shellfire.getDefaultShell();
    if (shell) bottombarShell.textContent = shell.split("/").pop();
  } catch {}
})();

// ============================================================
// SETTINGS UI
// ============================================================
function openSettings(tabName) {
  const overlay = document.getElementById("settings-overlay");
  overlay.classList.add("visible");

  // Populate theme dropdown
  const themeSelect = document.getElementById("setting-theme");
  themeSelect.innerHTML = "";
  themes.forEach((t, i) => {
    const opt = document.createElement("option");
    opt.value = i; opt.textContent = t.name;
    if (i === currentThemeIdx) opt.selected = true;
    themeSelect.appendChild(opt);
  });

  // Populate current values
  document.getElementById("setting-zoom-value").textContent = Math.round(currentZoom * 100) + "%";
  document.getElementById("setting-font-size").value = currentFontSize;
  document.getElementById("setting-font-family").value = settings.fontFamily || '"SF Mono", "Menlo", "Monaco", "Courier New", monospace';
  document.getElementById("setting-cursor-style").value = settings.cursorStyle || "block";
  document.getElementById("setting-cursor-blink").checked = settings.cursorBlink !== false;
  document.getElementById("setting-shell").value = settings.shell || "";
  document.getElementById("setting-cwd").value = settings.defaultCwd || "";
  document.getElementById("setting-scrollback").value = settings.scrollback || 10000;
  document.getElementById("setting-buffer-limit").value = Math.round(bufferLimit / 1024);
  document.getElementById("setting-copy-on-select").checked = copyOnSelect;
  document.getElementById("setting-ai-suggestions").checked = aiSuggestions;
  document.getElementById("setting-confirm-close").checked = confirmClose;
  document.getElementById("setting-auto-save").checked = settings.autoSaveSession !== false;
  document.getElementById("setting-auto-save-interval").value = autoSaveInterval;
  document.getElementById("setting-ide-mode").checked = ideMode;

  // Version info
  window.shellfire.getAppVersion().then(v => { document.getElementById("setting-version").textContent = v; }).catch(() => {});
  window.shellfire.getDefaultShell().then(s => { document.getElementById("setting-detected-shell").textContent = s; }).catch(() => {});

  // Keybindings — auto-populate
  populateKeybindingList();

  // Mount extension settings sections (once)
  for (const sec of _extSettingsSections) {
    if (!sec._mounted) {
      const extTab = document.querySelector('.settings-tab[data-tab="extensions"] .settings-group');
      if (extTab) {
        const container = document.createElement("div");
        container.innerHTML = sec.html;
        extTab.appendChild(container);
        sec._mounted = true;
        sec._container = container; // track for cleanup on uninstall
      }
    }
    if (sec.onMount) sec.onMount();
  }

  // Load extensions list into settings
  refreshSettingsExtensions();

  // Clear search and switch to requested tab (default to appearance)
  document.getElementById("settings-search").value = "";
  clearSettingsSearch();
  switchSettingsTab(tabName || "appearance");
}

function closeSettings() {
  document.getElementById("settings-overlay").classList.remove("visible");
  if (activeId && panes.has(activeId)) panes.get(activeId).term.focus();
}

function switchSettingsTab(tabName) {
  document.querySelectorAll(".settings-nav-item").forEach(item => {
    item.classList.toggle("active", item.dataset.tab === tabName);
  });
  document.querySelectorAll(".settings-tab").forEach(tab => {
    tab.classList.toggle("active", tab.dataset.tab === tabName);
  });
}

function clearSettingsSearch() {
  document.querySelectorAll(".settings-row[data-search]").forEach(row => {
    row.classList.remove("search-hidden");
  });
  document.querySelectorAll(".settings-tab").forEach(tab => {
    tab.classList.remove("search-active", "active");
  });
}

function searchSettings(query) {
  const q = query.toLowerCase().trim();
  if (!q) { clearSettingsSearch(); return; }

  // Show all tabs during search
  document.querySelectorAll(".settings-tab").forEach(tab => {
    tab.classList.add("active", "search-active");
  });
  document.querySelectorAll(".settings-nav-item").forEach(item => {
    item.classList.remove("active");
  });

  // Filter rows
  document.querySelectorAll(".settings-row[data-search]").forEach(row => {
    const text = (row.dataset.search + " " + row.textContent).toLowerCase();
    row.classList.toggle("search-hidden", !text.includes(q));
  });
}

function populateKeybindingList() {
  const list = document.getElementById("keybinding-list");
  list.innerHTML = "";
  const defaultKeybindings = {
    "New Terminal": "Cmd+T", "Split Right": "Cmd+D", "Split Down": "Cmd+Shift+D",
    "Close Pane": "Cmd+W", "Command Palette": "Cmd+P", "Find": "Cmd+F",
    "Clear": "Cmd+K", "Zoom": "Cmd+Shift+Enter", "Broadcast": "Cmd+Shift+B",
    "Snippets": "Cmd+Shift+R", "Save Session": "Cmd+Shift+S",
    "Quick Command": "Cmd+;", "Settings": "Cmd+,", "IDE Mode": "Cmd+Shift+I",
  };
  for (const [action, defaultKey] of Object.entries(defaultKeybindings)) {
    const current = customKeybindings[action] || defaultKey;
    const row = document.createElement("div");
    row.className = "keybinding-row";
    row.innerHTML = `<span class="kb-action">${action}</span><span class="kb-key" data-action="${action}">${current}</span>`;
    const keyEl = row.querySelector(".kb-key");
    keyEl.addEventListener("click", () => {
      if (keyEl.classList.contains("recording")) { keyEl.classList.remove("recording"); keyEl.textContent = current; return; }
      keyEl.classList.add("recording");
      keyEl.textContent = "Press keys...";
      const handler = (e) => {
        e.preventDefault(); e.stopPropagation();
        if (e.key === "Escape") { keyEl.classList.remove("recording"); keyEl.textContent = current; document.removeEventListener("keydown", handler, true); return; }
        const parts = [];
        if (e.metaKey || e.ctrlKey) parts.push("Cmd");
        if (e.shiftKey) parts.push("Shift");
        if (e.altKey) parts.push("Alt");
        if (!["Meta", "Control", "Shift", "Alt"].includes(e.key)) parts.push(e.key.length === 1 ? e.key.toUpperCase() : e.key);
        if (parts.length > 0 && !["Cmd", "Shift", "Alt"].includes(parts[parts.length - 1])) {
          const combo = parts.join("+");
          customKeybindings[action] = combo;
          keyEl.textContent = combo;
          keyEl.classList.remove("recording");
          document.removeEventListener("keydown", handler, true);
          settings.keybindings = customKeybindings;
          window.shellfire.saveSettings(settings);
        }
      };
      document.addEventListener("keydown", handler, true);
    });
    list.appendChild(row);
  }
}

async function refreshSettingsExtensions() {
  // Use the new marketplace UI instead
  await fetchAndRenderMarketplace();
}

function applySettings() {
  const newTheme = parseInt(document.getElementById("setting-theme").value);
  const newFontSize = parseInt(document.getElementById("setting-font-size").value);
  const newFontFamily = document.getElementById("setting-font-family").value.trim();
  const newCursorStyle = document.getElementById("setting-cursor-style").value;
  const newCursorBlink = document.getElementById("setting-cursor-blink").checked;
  const newScrollback = parseInt(document.getElementById("setting-scrollback").value);
  const newBufferKB = parseInt(document.getElementById("setting-buffer-limit").value);

  copyOnSelect = document.getElementById("setting-copy-on-select").checked;
  aiSuggestions = document.getElementById("setting-ai-suggestions").checked;
  confirmClose = document.getElementById("setting-confirm-close").checked;
  autoSaveInterval = parseInt(document.getElementById("setting-auto-save-interval").value) || 60;
  bufferLimit = (newBufferKB || 512) * 1024;
  const newIdeMode = document.getElementById("setting-ide-mode").checked;
  if (newIdeMode !== ideMode) toggleIdeMode();

  // Apply to all terminals
  for (const [, pane] of panes) {
    pane.term.options.fontSize = newFontSize;
    pane.term.options.fontFamily = newFontFamily;
    pane.term.options.cursorStyle = newCursorStyle;
    pane.term.options.cursorBlink = newCursorBlink;
    pane.term.options.scrollback = newScrollback;
  }
  currentFontSize = newFontSize;
  if (newTheme !== currentThemeIdx) applyTheme(newTheme);
  fitAllTerminals();

  // Restart auto-save timer
  setupAutoSave();

  // Persist
  settings = {
    ...settings,
    theme: currentThemeIdx,
    fontSize: currentFontSize,
    fontFamily: newFontFamily,
    cursorStyle: newCursorStyle,
    cursorBlink: newCursorBlink,
    scrollback: newScrollback,
    bufferLimit: newBufferKB,
    copyOnSelect,
    aiSuggestions,
    confirmClose,
    autoSaveSession: document.getElementById("setting-auto-save").checked,
    autoSaveInterval,
    shell: document.getElementById("setting-shell").value.trim(),
    defaultCwd: document.getElementById("setting-cwd").value.trim(),
  };
  window.shellfire.saveSettings(settings);
  showToast("Settings saved");
}

function setupAutoSave() {
  if (autoSaveTimer) clearInterval(autoSaveTimer);
  if (settings.autoSaveSession !== false) {
    // First save after 5s so cached CWD/process data is available for beforeunload
    setTimeout(() => { if (panes.size > 0) saveCurrentSession(true); }, 5000);
    autoSaveTimer = setInterval(() => { if (panes.size > 0) saveCurrentSession(true); }, autoSaveInterval * 1000);
  }
}

// Settings event listeners
document.getElementById("settings-close").addEventListener("click", closeSettings);
document.getElementById("settings-overlay").addEventListener("click", (e) => {
  if (e.target === e.currentTarget) closeSettings();
});
// Tab switching
document.querySelectorAll(".settings-nav-item").forEach(item => {
  item.addEventListener("click", () => {
    document.getElementById("settings-search").value = "";
    clearSettingsSearch();
    switchSettingsTab(item.dataset.tab);
  });
});
// Search
document.getElementById("settings-search").addEventListener("input", (e) => {
  searchSettings(e.target.value);
});
// Auto-apply on change
["setting-theme", "setting-font-size", "setting-cursor-style", "setting-scrollback", "setting-buffer-limit", "setting-auto-save-interval"].forEach(id => {
  document.getElementById(id).addEventListener("change", applySettings);
});
["setting-cursor-blink", "setting-copy-on-select", "setting-ai-suggestions", "setting-confirm-close", "setting-auto-save", "setting-ide-mode"].forEach(id => {
  document.getElementById(id).addEventListener("change", applySettings);
});
document.getElementById("setting-font-family").addEventListener("blur", applySettings);
document.getElementById("setting-shell").addEventListener("blur", applySettings);
document.getElementById("setting-cwd").addEventListener("blur", applySettings);

// Zoom stepper
function updateZoomValueDisplay() {
  const el = document.getElementById("setting-zoom-value");
  if (el) el.textContent = Math.round(currentZoom * 100) + "%";
}
document.getElementById("setting-zoom-in").addEventListener("click", () => { zoomIn(); updateZoomValueDisplay(); });
document.getElementById("setting-zoom-out").addEventListener("click", () => { zoomOut(); updateZoomValueDisplay(); });
document.getElementById("setting-zoom-reset").addEventListener("click", () => { zoomReset(); updateZoomValueDisplay(); });

// ============================================================
// KEYBINDING EDITOR
// ============================================================
const defaultKeybindings = {
  "New Terminal": "Cmd+T",
  "Split Right": "Cmd+D",
  "Split Down": "Cmd+Shift+D",
  "Close Pane": "Cmd+W",
  "Command Palette": "Cmd+P",
  "Find": "Cmd+F",
  "File Finder": "Cmd+Shift+F",
  "Clear": "Cmd+K",
  "Zoom": "Cmd+Shift+Enter",
  "Broadcast": "Cmd+Shift+B",
  "Snippets": "Cmd+Shift+R",
  "Save Session": "Cmd+Shift+S",
  "Quick Command": "Cmd+;",
  "Settings": "Cmd+,",
  "IDE Mode": "Cmd+Shift+I",
};

// Keybinding editor is now populated in openSettings -> populateKeybindingList()

// Add Settings to command palette
commands.push(
  { label: "Settings", shortcut: "Cmd+,", action: () => openSettings(), category: "System" },
  { label: "Extensions", action: () => openSettings("extensions"), category: "System" },
  { label: "Check for Updates", action: async () => {
    try {
      const result = await window.shellfire.checkForUpdates();
      if (result.available) showToast(`Update available: v${result.version}`);
      else showToast(result.reason === "not-packaged" ? "Updates available in packaged builds" : "You're up to date");
    } catch { showToast("Could not check for updates", "error"); }
  }, category: "System" }
);

// ============================================================
// ONBOARDING (first run)
// ============================================================
async function checkOnboarding() {
  try {
    const s = await window.shellfire.loadSettings();
    if (s && s._onboardingDone) return false;
    return true;
  } catch { return false; }
}

function showOnboarding() {
  const overlay = document.getElementById("onboarding-overlay");
  overlay.classList.add("visible");

  // Populate theme select
  const themeSelect = document.getElementById("onboard-theme");
  themeSelect.innerHTML = "";
  themes.forEach((t, i) => {
    const opt = document.createElement("option");
    opt.value = i; opt.textContent = t.name;
    themeSelect.appendChild(opt);
  });

  themeSelect.addEventListener("change", () => {
    applyTheme(parseInt(themeSelect.value));
  });

  document.getElementById("onboard-done").addEventListener("click", async () => {
    const themeIdx = parseInt(themeSelect.value);
    const fontSize = parseInt(document.getElementById("onboard-font-size").value) || 13;
    const projName = document.getElementById("onboard-project-name").value.trim();
    const projPath = document.getElementById("onboard-project-path").value.trim();

    applyTheme(themeIdx);
    setFontSize(fontSize);

    if (projName && projPath) {
      launchProjects.push({ name: projName, path: projPath });
      saveProjects();
      rebuildLaunchDropdown();
      rebuildLaunchCommands();
    }

    settings._onboardingDone = true;
    settings.theme = themeIdx;
    settings.fontSize = fontSize;
    window.shellfire.saveSettings(settings);

    overlay.classList.remove("visible");
    showToast("Welcome to Shellfire!");
  });
}

// ============================================================
// KEYBOARD: Settings shortcut
// ============================================================
// Cmd+, to open settings (added to existing keydown handler below)

// ============================================================
