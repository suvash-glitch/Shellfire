/**
 * @module renderer/140-handlers
 * @description Button event handlers for every toolbar/titlebar control, global keyboard shortcut bindings, and keyword watcher (fires commands when terminal output matches a pattern).
 */

// BUTTON HANDLERS
// ============================================================
document.getElementById("btn-add").addEventListener("click", () => addTerminal());
document.getElementById("btn-split-h").addEventListener("click", () => splitPane("horizontal"));
document.getElementById("btn-split-v").addEventListener("click", () => splitPane("vertical"));
// btn-skip-perms now injected by claude-ai extension
const _btnSkipPerms = document.getElementById("btn-skip-perms");
if (_btnSkipPerms) _btnSkipPerms.addEventListener("click", toggleSkipPermissions);
document.getElementById("btn-broadcast").addEventListener("click", toggleBroadcast);
document.getElementById("btn-search").addEventListener("click", openSearch);
document.getElementById("btn-palette").addEventListener("click", openPalette);
document.getElementById("btn-theme").addEventListener("click", cycleTheme);
document.getElementById("btn-ports").addEventListener("click", () => openPortPanel());
document.getElementById("btn-pipeline").addEventListener("click", openPipelinePanel);
document.getElementById("btn-cmd-bookmarks").addEventListener("click", openCmdBookmarksPanel);
document.getElementById("btn-settings").addEventListener("click", openSettings);

// Quick launch dropdown
const launchDropdown = document.getElementById("launch-dropdown");

function rebuildLaunchDropdown() {
  launchDropdown.innerHTML = "";
  launchProjects.forEach((proj, idx) => {
    const item = document.createElement("div");
    item.className = "launch-dropdown-item";
    item.innerHTML = `<span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${proj.name}<span class="launch-path" style="margin-left:8px">${proj.path.replace(/^\/Users\/[^/]+/, "~")}</span></span>
      <span class="launch-actions">
        <button class="launch-action-btn edit" title="Edit">&#9998;</button>
        <button class="launch-action-btn delete" title="Remove">&#10005;</button>
      </span>`;
    item.addEventListener("click", async (e) => {
      if (e.target.closest(".launch-action-btn")) return;
      launchDropdown.classList.remove("visible");
      const id = await addTerminal(proj.path);
      if (id !== undefined) setTimeout(() => launchClaude(id), 150);
    });
    item.querySelector(".edit").addEventListener("click", (e) => {
      e.stopPropagation();
      launchDropdown.classList.remove("visible");
      openProjectEditor(idx);
    });
    item.querySelector(".delete").addEventListener("click", (e) => {
      e.stopPropagation();
      launchProjects.splice(idx, 1);
      saveProjects();
      rebuildLaunchDropdown();
      rebuildLaunchCommands();
      showToast(`Removed: ${proj.name}`);
    });
    launchDropdown.appendChild(item);
  });
  // Add button
  const addBtn = document.createElement("button");
  addBtn.className = "launch-dropdown-add";
  addBtn.innerHTML = `<svg viewBox="0 0 24 24" style="width:12px;height:12px;stroke:currentColor;fill:none;stroke-width:2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg> Add Project`;
  addBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    launchDropdown.classList.remove("visible");
    openProjectEditor(-1);
  });
  launchDropdown.appendChild(addBtn);
}

function saveProjects() {
  window.shellfire.saveProjects(launchProjects);
}

function rebuildLaunchCommands() {
  // Remove old launch commands
  const idx = commands.findIndex(c => c.category === "Launch");
  if (idx !== -1) {
    while (idx < commands.length && commands[idx].category === "Launch") commands.splice(idx, 1);
  }
  // Add updated ones
  const insertAt = commands.findIndex(c => c.category === "System");
  const newCmds = launchProjects.map(p => ({
    label: `Launch: ${p.name} + Claude`, category: "Launch",
    action: async () => { const id = await addTerminal(p.path); if (id !== undefined) setTimeout(() => launchClaude(id), 150); }
  }));
  commands.splice(insertAt >= 0 ? insertAt : commands.length, 0, ...newCmds);
}

// Project editor
const projectEditorOverlay = document.getElementById("project-editor-overlay");
const projectNameInput = document.getElementById("project-name-input");
const projectPathInput = document.getElementById("project-path-input");

function openProjectEditor(editIdx) {
  const isEdit = editIdx >= 0;
  document.getElementById("project-editor-title").textContent = isEdit ? "Edit Project" : "Add Project";
  projectNameInput.value = isEdit ? launchProjects[editIdx].name : "";
  projectPathInput.value = isEdit ? launchProjects[editIdx].path : "";
  projectEditorOverlay.classList.add("visible");
  projectNameInput.focus();

  function save() {
    const name = projectNameInput.value.trim();
    const projPath = projectPathInput.value.trim();
    if (!name || !projPath) { showToast("Name and path are required"); return; }
    if (isEdit) {
      launchProjects[editIdx] = { name, path: projPath };
    } else {
      launchProjects.push({ name, path: projPath });
    }
    saveProjects();
    rebuildLaunchDropdown();
    rebuildLaunchCommands();
    close();
    showToast(isEdit ? `Updated: ${name}` : `Added: ${name}`);
  }
  function close() {
    projectEditorOverlay.classList.remove("visible");
    document.getElementById("project-save").removeEventListener("click", save);
    document.getElementById("project-cancel").removeEventListener("click", close);
    projectEditorOverlay.removeEventListener("click", bgClick);
    projectNameInput.removeEventListener("keydown", keyHandler);
    projectPathInput.removeEventListener("keydown", keyHandler);
  }
  function bgClick(e) { if (e.target === projectEditorOverlay) close(); }
  function keyHandler(e) {
    if (e.key === "Enter") save();
    if (e.key === "Escape") close();
  }
  document.getElementById("project-save").addEventListener("click", save);
  document.getElementById("project-cancel").addEventListener("click", close);
  projectEditorOverlay.addEventListener("click", bgClick);
  projectNameInput.addEventListener("keydown", keyHandler);
  projectPathInput.addEventListener("keydown", keyHandler);
}

// Load saved projects
(async () => {
  const saved = await window.shellfire.loadProjects();
  if (saved && Array.isArray(saved) && saved.length > 0) {
    launchProjects = saved;
    rebuildLaunchCommands();
  }
  rebuildLaunchDropdown();
})();

document.getElementById("btn-launch-menu").addEventListener("click", (e) => {
  e.stopPropagation();
  launchDropdown.classList.toggle("visible");
});
document.addEventListener("click", () => launchDropdown.classList.remove("visible"));

// Welcome screen buttons
document.getElementById("welcome-new").addEventListener("click", () => addTerminal());
document.getElementById("welcome-restore").addEventListener("click", () => restoreSession());

// Welcome screen tab navigation
document.querySelectorAll(".welcome-nav-item").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".welcome-nav-item").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    const tab = btn.dataset.tab;
    document.querySelectorAll(".welcome-section").forEach(s => s.style.display = "none");
    const section = document.getElementById("welcome-section-" + tab);
    if (section) section.style.display = "";
  });
});

// Welcome remote connect button
const welcomeRemoteBtn = document.getElementById("welcome-remote-connect");
if (welcomeRemoteBtn) welcomeRemoteBtn.addEventListener("click", () => openRemoteConnect());

// Welcome customize controls
const welcomeThemeSelect = document.getElementById("welcome-theme-select");
if (welcomeThemeSelect) {
  themes.forEach((t, i) => {
    const opt = document.createElement("option");
    opt.value = i; opt.textContent = t.name;
    if (i === currentThemeIdx) opt.selected = true;
    welcomeThemeSelect.appendChild(opt);
  });
  welcomeThemeSelect.addEventListener("change", () => applyTheme(parseInt(welcomeThemeSelect.value)));
}
const welcomeFontSize = document.getElementById("welcome-font-size");
if (welcomeFontSize) {
  welcomeFontSize.value = currentFontSize;
  welcomeFontSize.addEventListener("change", () => setFontSize(parseInt(welcomeFontSize.value)));
}
const welcomeIdeToggle = document.getElementById("welcome-ide-toggle");
if (welcomeIdeToggle) {
  welcomeIdeToggle.checked = ideMode;
  welcomeIdeToggle.addEventListener("change", () => toggleIdeMode());
}

// Welcome version
window.shellfire.getAppVersion().then(v => {
  const el = document.getElementById("welcome-version");
  if (el) el.textContent = `v${v}`;
}).catch(() => {});

// ============================================================
// KEYBOARD SHORTCUTS
// ============================================================
document.addEventListener("keydown", (e) => {
  const meta = e.metaKey || e.ctrlKey;
  if (meta && e.shiftKey && (e.key === "T" || e.key === "t") && !e.key.startsWith("Arrow")) { e.preventDefault(); addTerminalSameDir(); }
  else if (meta && e.key === "t") { e.preventDefault(); addTerminal(); }
  else if (meta && e.shiftKey && (e.key === "D" || e.key === "d")) { e.preventDefault(); splitPane("vertical"); }
  else if (meta && e.key === "d") { e.preventDefault(); splitPane("horizontal"); }
  else if (meta && e.key === "w") { e.preventDefault(); if (activeId !== null) removeTerminal(activeId); }
  else if (meta && e.key === "q") { e.preventDefault(); window.shellfire.quit(); }
  else if (meta && e.shiftKey && (e.key === "P" || e.key === "p")) { e.preventDefault(); openPortPanel(); }
  else if (meta && e.shiftKey && (e.key === "F" || e.key === "f")) { e.preventDefault(); openFileFinder(); }
  else if (meta && e.key === "f") { e.preventDefault(); openSearch(); }
  else if (meta && e.key === "p") { e.preventDefault(); openPalette(); }
  else if (e.ctrlKey && e.key === "r") { e.preventDefault(); openHistorySearch(); }
  else if (meta && e.key === "k") { e.preventDefault(); if (activeId && panes.has(activeId)) { panes.get(activeId).term.clear(); panes.get(activeId).term.focus(); } }
  else if (meta && e.shiftKey && e.key === "Enter") { e.preventDefault(); toggleZoom(); }
  else if (meta && e.shiftKey && (e.key === "B" || e.key === "b")) { e.preventDefault(); toggleBroadcast(); }
  else if (meta && e.shiftKey && (e.key === "R" || e.key === "r")) { e.preventDefault(); openSnippetRunner(); }
  else if (meta && (e.key === "=" || e.key === "+")) { e.preventDefault(); zoomIn(); }
  else if (meta && e.key === "-") { e.preventDefault(); zoomOut(); }
  else if (meta && e.key === "0") { e.preventDefault(); zoomReset(); }
  else if (meta && e.key === "ArrowRight") { e.preventDefault(); navigatePane(1); }
  else if (meta && e.key === "ArrowLeft") { e.preventDefault(); navigatePane(-1); }
  else if (meta && e.key === "ArrowDown") { e.preventDefault(); navigatePaneVertical(1); }
  else if (meta && e.key === "ArrowUp") { e.preventDefault(); navigatePaneVertical(-1); }
  else if (meta && e.shiftKey && (e.key === "S" || e.key === "s")) { e.preventDefault(); saveCurrentSession(); }
  else if (meta && e.shiftKey && (e.key === "X" || e.key === "x")) { e.preventDefault(); closeAllOthers(); }
  else if (meta && e.shiftKey && (e.key === "I" || e.key === "i")) { e.preventDefault(); toggleIdeMode(); }
  else if (meta && e.shiftKey && (e.key === "Z" || e.key === "z")) { e.preventDefault(); toggleZenMode(); }
  else if (e.key === "Escape" && zenMode) { e.preventDefault(); toggleZenMode(); }
  else if (meta && e.ctrlKey && e.key === "ArrowRight") { e.preventDefault(); resizePaneKeyboard("right"); }
  else if (meta && e.ctrlKey && e.key === "ArrowLeft") { e.preventDefault(); resizePaneKeyboard("left"); }
  else if (meta && e.ctrlKey && e.key === "ArrowDown") { e.preventDefault(); resizePaneKeyboard("down"); }
  else if (meta && e.ctrlKey && e.key === "ArrowUp") { e.preventDefault(); resizePaneKeyboard("up"); }
  else if (meta && e.key === ";") { e.preventDefault(); openQuickCmd(); }
  else if (meta && e.key === ",") { e.preventDefault(); openSettings(); }
  else if (meta && e.key >= "1" && e.key <= "9") { e.preventDefault(); const idx = parseInt(e.key) - 1; const ids = [...panes.keys()]; if (idx < ids.length) setActive(ids[idx]); }
});

function navigatePane(dir) { const ids = [...panes.keys()]; if (!ids.length) return; const idx = ids.indexOf(activeId); setActive(ids[(idx + dir + ids.length) % ids.length]); }
function navigatePaneVertical(dir) { const ids = [...panes.keys()]; const n = ids.length; if (!n) return; const cols = Math.ceil(Math.sqrt(n)); const idx = ids.indexOf(activeId); const next = idx + dir * cols; if (next >= 0 && next < n) setActive(ids[next]); }

// ============================================================
// KEYWORD WATCHER
// ============================================================
let watchKeywords = []; // { pattern: string, notify: bool }
const defaultWatchKeywords = ["error", "fail", "exception", "ENOENT", "panic", "segfault"];

function setupKeywordWatcher() {
  // Watch all incoming terminal data for keywords
  watchKeywords = defaultWatchKeywords.map(k => ({ pattern: k.toLowerCase(), notify: true }));
}
setupKeywordWatcher();

// Keyword watcher state (checkKeywords is called from the onData handler above)
let watcherEnabled = false;

function checkKeywords(id, data) {
  if (!watcherEnabled || id === activeId) return;
  const lower = data.toLowerCase();
  for (const kw of watchKeywords) {
    if (lower.includes(kw.pattern)) {
      const pane = panes.get(id);
      if (pane) {
        // Show watcher badge
        const badge = pane.el.querySelector(".watcher-badge");
        if (badge) { badge.textContent = kw.pattern.toUpperCase(); badge.classList.add("visible"); }
        if (kw.notify) {
          const name = pane.customName || `Terminal ${id}`;
          window.shellfire.notify("Keyword Alert", `"${kw.pattern}" detected in ${name}`);
        }
      }
      break;
    }
  }
}

function toggleWatcher() {
  watcherEnabled = !watcherEnabled;
  showToast(watcherEnabled ? `Keyword watcher ON (${watchKeywords.length} keywords)` : "Keyword watcher OFF");
}

// ============================================================
