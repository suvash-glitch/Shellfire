// ============================================================
// SEARCH
// ============================================================
const searchBar = document.getElementById("search-bar"), searchInput = document.getElementById("search-input");
const searchAllToggle = document.getElementById("search-all-toggle");
const searchMatchInfo = document.getElementById("search-match-info");
let searchAllMode = false;
let searchAllMatches = [];
let searchAllIdx = 0;

searchAllToggle.addEventListener("click", () => {
  searchAllMode = !searchAllMode;
  searchAllToggle.classList.toggle("active", searchAllMode);
  searchInput.placeholder = searchAllMode ? "Search all panes..." : "Search in terminal...";
  if (searchAllMode && searchInput.value) searchAllPanes(searchInput.value);
  else { searchMatchInfo.textContent = ""; for (const [, p] of panes) { try { p.searchAddon?.clearDecorations(); } catch {} } }
});

function searchAllPanes(query) {
  searchAllMatches = []; searchAllIdx = 0;
  if (!query) { searchMatchInfo.textContent = ""; for (const [, p] of panes) { try { p.searchAddon?.clearDecorations(); } catch {} } return; }
  for (const [id, pane] of panes) {
    try { if (pane.searchAddon?.findNext(query)) searchAllMatches.push(id); } catch {}
  }
  if (searchAllMatches.length > 0) {
    searchMatchInfo.textContent = `${searchAllMatches.length} pane${searchAllMatches.length > 1 ? "s" : ""}`;
    setActive(searchAllMatches[0]);
  } else {
    searchMatchInfo.textContent = "No matches";
  }
}

function searchAllNav(dir) {
  if (searchAllMatches.length === 0) return;
  const cur = panes.get(activeId);
  if (cur) { const found = dir > 0 ? cur.searchAddon?.findNext(searchInput.value) : cur.searchAddon?.findPrevious(searchInput.value); if (found) return; }
  const ci = searchAllMatches.indexOf(activeId);
  searchAllIdx = (ci + dir + searchAllMatches.length) % searchAllMatches.length;
  setActive(searchAllMatches[searchAllIdx]);
  const p = panes.get(searchAllMatches[searchAllIdx]);
  if (p) dir > 0 ? p.searchAddon?.findNext(searchInput.value) : p.searchAddon?.findPrevious(searchInput.value);
}

function openSearch() { searchBar.classList.add("visible"); searchInput.focus(); searchInput.select(); }
function closeSearch() {
  searchBar.classList.remove("visible"); searchMatchInfo.textContent = "";
  for (const [, p] of panes) { try { p.searchAddon?.clearDecorations(); } catch {} }
  if (activeId && panes.has(activeId)) panes.get(activeId).term.focus();
}
searchInput.addEventListener("input", () => {
  if (searchAllMode) searchAllPanes(searchInput.value);
  else if (activeId && panes.has(activeId)) panes.get(activeId).searchAddon?.findNext(searchInput.value);
});
searchInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    if (searchAllMode) { searchAllNav(e.shiftKey ? -1 : 1); }
    else if (activeId && panes.has(activeId)) { e.shiftKey ? panes.get(activeId).searchAddon?.findPrevious(searchInput.value) : panes.get(activeId).searchAddon?.findNext(searchInput.value); }
  } else if (e.key === "Escape") closeSearch();
});
document.getElementById("search-next").addEventListener("click", () => { searchAllMode ? searchAllNav(1) : (activeId && panes.has(activeId) && panes.get(activeId).searchAddon?.findNext(searchInput.value)); });
document.getElementById("search-prev").addEventListener("click", () => { searchAllMode ? searchAllNav(-1) : (activeId && panes.has(activeId) && panes.get(activeId).searchAddon?.findPrevious(searchInput.value)); });
document.getElementById("search-close").addEventListener("click", closeSearch);

// ============================================================
// CONTEXT MENU
// ============================================================
const contextMenuEl = document.getElementById("context-menu");
function showContextMenu(x, y, paneId) {
  const pane = panes.get(paneId);
  const items = [
    { label: "Copy", shortcut: "Cmd+C", action: () => { if (pane) { const s = pane.term.getSelection(); if (s) navigator.clipboard.writeText(s); } }},
    { label: "Paste", shortcut: "Cmd+V", action: async () => { const t = await navigator.clipboard.readText(); if (t) window.shellfire.sendInput(paneId, t); }},
    { sep: true },
    { label: "Clear", shortcut: "Cmd+K", action: () => { if (pane) { pane.term.clear(); pane.term.focus(); } }},
    { label: "Rename Pane", action: () => renamePaneUI(paneId) },
    { label: "Color: " + (pane?.color || "none"), action: () => openPaneColorPicker(paneId, x, y) },
    { label: pane?.locked ? "Unlock Pane" : "Lock Pane", action: () => togglePaneLock(paneId) },
    { label: "Save Output", action: () => captureOutput(paneId) },
    { label: floatingPanes.has(paneId) ? "Restore from PiP" : "Float Pane (PiP)", action: () => toggleFloating(paneId) },
    { label: loggingPanes.has(paneId) ? "Stop Logging" : "Start Logging", action: () => toggleLogging(paneId) },
    { sep: true },
    { label: "Split Right", shortcut: "Cmd+D", action: () => { setActive(paneId); splitPane("horizontal"); }},
    { label: "Split Down", shortcut: "Cmd+Shift+D", action: () => { setActive(paneId); splitPane("vertical"); }},
    { label: "Zoom Pane", shortcut: "Cmd+Shift+Enter", action: () => { setActive(paneId); toggleZoom(); }},
    { sep: true },
    ..._extHooks.contextMenu.flatMap(fn => fn(paneId) || []),
    { sep: true },
    { label: "Close Pane", shortcut: "Cmd+W", action: () => removeTerminal(paneId), danger: true },
  ];
  contextMenuEl.innerHTML = "";
  for (const item of items) {
    if (item.sep) { const s = document.createElement("div"); s.className = "context-menu-sep"; contextMenuEl.appendChild(s); continue; }
    const el = document.createElement("div"); el.className = "context-menu-item" + (item.danger ? " danger" : "");
    el.innerHTML = `<span>${item.label}</span>${item.shortcut ? `<span class="context-menu-shortcut">${item.shortcut}</span>` : ""}`;
    el.addEventListener("click", () => { contextMenuEl.classList.remove("visible"); item.action(); });
    contextMenuEl.appendChild(el);
  }
  contextMenuEl.classList.add("visible");
  // Position with viewport bounds checking
  const menuRect = contextMenuEl.getBoundingClientRect();
  const viewW = window.innerWidth, viewH = window.innerHeight;
  const finalX = (x + menuRect.width > viewW) ? Math.max(0, viewW - menuRect.width - 4) : x;
  const finalY = (y + menuRect.height > viewH) ? Math.max(0, viewH - menuRect.height - 4) : y;
  contextMenuEl.style.left = finalX + "px"; contextMenuEl.style.top = finalY + "px";
}
document.addEventListener("click", () => contextMenuEl.classList.remove("visible"));

// ============================================================
// SNIPPETS
// ============================================================
function openSnippetRunner() {
  if (_paletteCleanup) { _paletteCleanup(); _paletteCleanup = null; }
  const overlay = document.getElementById("palette-overlay");
  const input = document.getElementById("palette-input");
  const results = document.getElementById("palette-results");
  overlay.classList.add("visible");
  input.placeholder = "Search snippets... (type new:name:command to save)";
  input.value = ""; input.focus();
  let selected = 0;

  function render(q) {
    const qq = q.toLowerCase();
    const filtered = qq ? snippets.filter(s => s.name.toLowerCase().includes(qq) || s.command.toLowerCase().includes(qq)) : snippets;
    selected = Math.min(selected, Math.max(0, filtered.length - 1));
    results.innerHTML = "";
    if (filtered.length === 0) {
      results.innerHTML = `<div class="palette-item"><span class="palette-item-label" style="color:color-mix(in srgb, var(--t-fg) 50%, transparent)">${snippets.length === 0 ? "No snippets yet. Type new:name:command to add one" : "No matches"}</span></div>`;
      return;
    }
    filtered.forEach((s, i) => {
      const el = document.createElement("div"); el.className = "palette-item" + (i === selected ? " selected" : "");
      el.innerHTML = `<span class="palette-item-label">${s.name}<span class="palette-item-sub">${s.command}</span></span><span class="palette-item-shortcut" style="cursor:pointer" data-del="${i}">&#x2716;</span>`;
      el.addEventListener("click", () => { overlay.classList.remove("visible"); input.placeholder = "Type a command..."; if (activeId) window.shellfire.sendInput(activeId, s.command + "\n"); });
      el.querySelector("[data-del]").addEventListener("click", (ev) => { ev.stopPropagation(); snippets.splice(snippets.indexOf(s), 1); window.shellfire.saveSnippets(snippets); render(input.value); showToast("Snippet deleted"); });
      results.appendChild(el);
    });
  }
  render("");

  const handler = (e) => {
    if (e.key === "Escape") { overlay.classList.remove("visible"); input.placeholder = "Type a command..."; input.removeEventListener("keydown", handler); input.removeEventListener("input", inputHandler); return; }
    if (e.key === "Enter") {
      e.preventDefault();
      const val = input.value;
      if (val.startsWith("new:")) {
        const parts = val.slice(4).split(":"); if (parts.length >= 2) { snippets.push({ name: parts[0].trim(), command: parts.slice(1).join(":").trim() }); window.shellfire.saveSnippets(snippets); showToast("Snippet saved"); }
      } else {
        const items = results.querySelectorAll(".palette-item"); items[selected]?.click();
      }
      overlay.classList.remove("visible"); input.placeholder = "Type a command..."; input.removeEventListener("keydown", handler); input.removeEventListener("input", inputHandler);
    }
    if (e.key === "ArrowDown") { e.preventDefault(); selected = Math.min(selected + 1, Math.max(0, results.querySelectorAll(".palette-item").length - 1)); render(input.value); }
    if (e.key === "ArrowUp") { e.preventDefault(); selected = Math.max(0, selected - 1); render(input.value); }
  };
  const inputHandler = () => { selected = 0; render(input.value); };
  input.addEventListener("keydown", handler);
  input.addEventListener("input", inputHandler);
  _paletteCleanup = () => { input.removeEventListener("keydown", handler); input.removeEventListener("input", inputHandler); };
}

// ============================================================
// PROFILES
// ============================================================
function openProfileManager() {
  if (_paletteCleanup) { _paletteCleanup(); _paletteCleanup = null; }
  const overlay = document.getElementById("palette-overlay");
  const input = document.getElementById("palette-input");
  const results = document.getElementById("palette-results");
  overlay.classList.add("visible");
  input.placeholder = "Search profiles... (type save:name to save current layout)";
  input.value = ""; input.focus();
  let selected = 0;

  function render(q) {
    const qq = q.toLowerCase();
    const filtered = qq ? profiles.filter(p => p.name.toLowerCase().includes(qq)) : profiles;
    selected = Math.min(selected, Math.max(0, filtered.length - 1));
    results.innerHTML = "";
    if (filtered.length === 0) {
      results.innerHTML = `<div class="palette-item"><span class="palette-item-label" style="color:color-mix(in srgb, var(--t-fg) 50%, transparent)">${profiles.length === 0 ? 'No profiles. Type save:name to save current layout' : 'No matches'}</span></div>`;
      return;
    }
    filtered.forEach((p, i) => {
      const el = document.createElement("div"); el.className = "palette-item" + (i === selected ? " selected" : "");
      el.innerHTML = `<span class="palette-item-label">${p.name}<span class="palette-item-sub">${p.panes.length} panes</span></span><span class="palette-item-shortcut" style="cursor:pointer" data-del="${i}">&#x2716;</span>`;
      el.addEventListener("click", () => { overlay.classList.remove("visible"); input.placeholder = "Type a command..."; loadProfile(p); });
      el.querySelector("[data-del]").addEventListener("click", (ev) => { ev.stopPropagation(); profiles.splice(profiles.indexOf(p), 1); window.shellfire.saveProfiles(profiles); render(input.value); showToast("Profile deleted"); });
      results.appendChild(el);
    });
  }
  render("");

  const handler = (e) => {
    if (e.key === "Escape") { overlay.classList.remove("visible"); input.placeholder = "Type a command..."; input.removeEventListener("keydown", handler); input.removeEventListener("input", inputHandler); return; }
    if (e.key === "Enter") {
      e.preventDefault(); const val = input.value;
      if (val.startsWith("save:")) { saveCurrentProfile(val.slice(5).trim()); }
      else { const items = results.querySelectorAll(".palette-item"); items[selected]?.click(); }
      overlay.classList.remove("visible"); input.placeholder = "Type a command..."; input.removeEventListener("keydown", handler); input.removeEventListener("input", inputHandler);
    }
    if (e.key === "ArrowDown") { e.preventDefault(); selected = Math.min(selected + 1, Math.max(0, results.querySelectorAll(".palette-item").length - 1)); render(input.value); }
    if (e.key === "ArrowUp") { e.preventDefault(); selected = Math.max(0, selected - 1); render(input.value); }
  };
  const inputHandler = () => { selected = 0; render(input.value); };
  input.addEventListener("keydown", handler);
  input.addEventListener("input", inputHandler);
  _paletteCleanup = () => { input.removeEventListener("keydown", handler); input.removeEventListener("input", inputHandler); };
}

async function saveCurrentProfile(name) {
  if (!name) return;
  const paneDefs = [];
  for (const [id] of panes) {
    const cwd = await window.shellfire.getCwd(id);
    const proc = await window.shellfire.getProcess(id);
    paneDefs.push({ cwd: cwd || null, command: proc && proc !== "zsh" && proc !== "bash" ? proc : null });
  }
  profiles.push({ name, panes: paneDefs });
  window.shellfire.saveProfiles(profiles);
  showToast(`Profile "${name}" saved (${paneDefs.length} panes)`);
}

async function loadProfile(profile) {
  // Close all existing panes
  for (const [id] of [...panes]) removeTerminal(id);
  // Create panes from profile
  for (const p of profile.panes) {
    const id = await createPaneObj(p.cwd);
    if (p.command) setTimeout(() => window.shellfire.sendInput(id, p.command + "\n"), 200);
  }
  const first = [...panes.keys()][0]; if (first) setActive(first);
  rebuildLayout();
  showToast(`Profile "${profile.name}" loaded`);
}

