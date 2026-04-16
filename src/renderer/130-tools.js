/**
 * @module renderer/130-tools
 * @description Cron manager UI, recent-directory picker, fuzzy file finder, pane output capture, smart-paste confirmation, close-all-others action, keyboard pane-resize, and quick command bar (Cmd+;).
 */

// ============================================================
// CRON MANAGER
// ============================================================
const cronOverlay = document.getElementById("cron-overlay");
const cronBody = document.getElementById("cron-body");
const cronInput = document.getElementById("cron-input");

async function openCronManager() {
  cronOverlay.classList.add("visible");
  cronInput.value = "";
  await refreshCronList();
  cronInput.focus();
}
function closeCronManager() { cronOverlay.classList.remove("visible"); if (activeId && panes.has(activeId)) panes.get(activeId).term.focus(); }

async function refreshCronList() {
  const jobs = await window.shellfire.cronList();
  cronBody.innerHTML = "";
  if (!jobs || jobs.length === 0) {
    cronBody.innerHTML = '<div class="cron-empty">No cron jobs found</div>';
    return;
  }
  jobs.forEach((job, i) => {
    const el = document.createElement("div"); el.className = "cron-item";
    el.innerHTML = `<span class="cron-item-line" title="${job.line}">${job.line}</span><button class="cron-item-del" data-idx="${i}"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>`;
    el.querySelector(".cron-item-del").addEventListener("click", async () => {
      await window.shellfire.cronRemove(i);
      showToast("Cron job removed");
      await refreshCronList();
    });
    cronBody.appendChild(el);
  });
}

document.getElementById("cron-close").addEventListener("click", closeCronManager);
cronOverlay.addEventListener("click", (e) => { if (e.target === cronOverlay) closeCronManager(); });
document.getElementById("cron-add-btn").addEventListener("click", async () => {
  const line = cronInput.value.trim();
  if (!line) return;
  const ok = await window.shellfire.cronAdd(line);
  if (ok) { showToast("Cron job added"); cronInput.value = ""; await refreshCronList(); }
  else showToast("Failed to add cron job", "error");
});
cronInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") document.getElementById("cron-add-btn").click();
  if (e.key === "Escape") closeCronManager();
});

// ============================================================
// RECENT DIRECTORIES
// ============================================================
let recentDirs = [];
const MAX_RECENTS = 20;

async function loadRecentDirs() {
  try { const saved = await window.shellfire.loadRecents(); if (Array.isArray(saved)) recentDirs = saved; } catch {}
}

async function trackRecentDir(id) {
  try {
    const cwd = await window.shellfire.getCwd(id);
    if (!cwd) return;
    recentDirs = recentDirs.filter(d => d !== cwd);
    recentDirs.unshift(cwd);
    if (recentDirs.length > MAX_RECENTS) recentDirs = recentDirs.slice(0, MAX_RECENTS);
    window.shellfire.saveRecents(recentDirs);
  } catch {}
}

function openRecentDirs() {
  if (_paletteCleanup) { _paletteCleanup(); _paletteCleanup = null; }
  const overlay = document.getElementById("palette-overlay");
  const input = document.getElementById("palette-input");
  const results = document.getElementById("palette-results");
  overlay.classList.add("visible");
  input.placeholder = "Search recent directories...";
  input.value = ""; input.focus();
  let selected = 0;

  function render(q) {
    const qq = q.toLowerCase();
    const filtered = qq ? recentDirs.filter(d => d.toLowerCase().includes(qq)) : recentDirs;
    selected = Math.min(selected, Math.max(0, filtered.length - 1));
    results.innerHTML = "";
    if (filtered.length === 0) {
      results.innerHTML = `<div class="palette-item"><span class="palette-item-label" style="color:color-mix(in srgb, var(--t-fg) 50%, transparent)">${recentDirs.length === 0 ? "No recent directories yet" : "No matches"}</span></div>`;
      return;
    }
    filtered.forEach((dir, i) => {
      const el = document.createElement("div"); el.className = "palette-item" + (i === selected ? " selected" : "");
      const short = dir.replace(/^\/Users\/[^/]+/, "~");
      el.innerHTML = `<span class="palette-item-label">${short}</span>`;
      el.addEventListener("click", async () => { overlay.classList.remove("visible"); input.placeholder = "Type a command..."; await addTerminal(dir); });
      results.appendChild(el);
    });
  }
  render("");

  const handler = (e) => {
    if (e.key === "Escape") { overlay.classList.remove("visible"); input.placeholder = "Type a command..."; input.removeEventListener("keydown", handler); input.removeEventListener("input", inputHandler); return; }
    if (e.key === "Enter") { e.preventDefault(); const items = results.querySelectorAll(".palette-item"); items[selected]?.click(); overlay.classList.remove("visible"); input.placeholder = "Type a command..."; input.removeEventListener("keydown", handler); input.removeEventListener("input", inputHandler); }
    if (e.key === "ArrowDown") { e.preventDefault(); selected = Math.min(selected + 1, Math.max(0, results.querySelectorAll(".palette-item").length - 1)); render(input.value); }
    if (e.key === "ArrowUp") { e.preventDefault(); selected = Math.max(0, selected - 1); render(input.value); }
  };
  const inputHandler = () => { selected = 0; render(input.value); };
  input.addEventListener("keydown", handler);
  input.addEventListener("input", inputHandler);
  _paletteCleanup = () => { input.removeEventListener("keydown", handler); input.removeEventListener("input", inputHandler); };
}

// ============================================================
// FUZZY FILE FINDER
// ============================================================
function openFileFinder() {
  if (_paletteCleanup) { _paletteCleanup(); _paletteCleanup = null; }
  const overlay = document.getElementById("palette-overlay");
  const input = document.getElementById("palette-input");
  const results = document.getElementById("palette-results");
  overlay.classList.add("visible");
  input.placeholder = "Search files across projects... (type to search)";
  input.value = ""; input.focus();
  let selected = 0;
  let searchTimeout = null;

  const searchDirs = launchProjects.map(p => p.path).filter(Boolean);
  if (searchDirs.length === 0) {
    results.innerHTML = '<div class="palette-item"><span class="palette-item-label" style="color:color-mix(in srgb, var(--t-fg) 50%, transparent)">No projects configured. Add projects via the Projects dropdown first.</span></div>';
    return;
  }

  async function doSearch(q) {
    if (!q || q.length < 2) { results.innerHTML = '<div class="palette-item"><span class="palette-item-label" style="color:color-mix(in srgb, var(--t-fg) 50%, transparent)">Type at least 2 characters to search...</span></div>'; return; }
    results.innerHTML = '<div class="palette-item"><span class="palette-item-label" style="color:color-mix(in srgb, var(--t-fg) 50%, transparent)">Searching...</span></div>';
    try {
      const files = await window.shellfire.findFiles(q, searchDirs);
      selected = 0;
      results.innerHTML = "";
      if (!files || files.length === 0) { results.innerHTML = '<div class="palette-item"><span class="palette-item-label" style="color:color-mix(in srgb, var(--t-fg) 50%, transparent)">No files found</span></div>'; return; }
      files.forEach((f, i) => {
        const el = document.createElement("div"); el.className = "palette-item" + (i === selected ? " selected" : "");
        el.innerHTML = `<span class="palette-item-label">${f.name}<span class="finder-result-path">${f.dir}</span></span>`;
        el.addEventListener("click", () => {
          overlay.classList.remove("visible"); input.placeholder = "Type a command...";
          // cd to the directory containing the file
          const dir = f.path.replace(/\/[^/]+$/, "");
          addTerminal(dir);
        });
        el.addEventListener("mouseenter", () => { selected = i; results.querySelectorAll(".palette-item").forEach((e, j) => e.classList.toggle("selected", j === i)); });
        results.appendChild(el);
      });
    } catch { results.innerHTML = '<div class="palette-item"><span class="palette-item-label" style="color:color-mix(in srgb, var(--t-fg) 50%, transparent)">Search failed</span></div>'; }
  }

  const handler = (e) => {
    if (e.key === "Escape") { overlay.classList.remove("visible"); input.placeholder = "Type a command..."; input.removeEventListener("keydown", handler); input.removeEventListener("input", inputHandler); return; }
    if (e.key === "Enter") {
      e.preventDefault();
      const items = results.querySelectorAll(".palette-item"); items[selected]?.click();
      overlay.classList.remove("visible"); input.placeholder = "Type a command...";
      input.removeEventListener("keydown", handler); input.removeEventListener("input", inputHandler);
    }
    if (e.key === "ArrowDown") { e.preventDefault(); selected++; const items = results.querySelectorAll(".palette-item"); if (selected >= items.length) selected = items.length - 1; items.forEach((e, j) => e.classList.toggle("selected", j === selected)); items[selected]?.scrollIntoView({ block: "nearest" }); }
    if (e.key === "ArrowUp") { e.preventDefault(); selected = Math.max(0, selected - 1); const items = results.querySelectorAll(".palette-item"); items.forEach((e, j) => e.classList.toggle("selected", j === selected)); items[selected]?.scrollIntoView({ block: "nearest" }); }
  };
  const inputHandler = () => {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => doSearch(input.value.trim()), 300);
  };
  input.addEventListener("keydown", handler);
  input.addEventListener("input", inputHandler);
  _paletteCleanup = () => { input.removeEventListener("keydown", handler); input.removeEventListener("input", inputHandler); };
}

// ============================================================
// PANE OUTPUT CAPTURE
// ============================================================
async function captureOutput(id) {
  const pane = panes.get(id || activeId); if (!pane) return;
  const buf = pane.term.buffer.active;
  let lines = [];
  for (let i = 0; i < buf.length; i++) {
    const line = buf.getLine(i);
    if (line) lines.push(line.translateToString(true));
  }
  // Trim trailing empty lines
  while (lines.length > 0 && lines[lines.length - 1].trim() === "") lines.pop();
  const content = lines.join("\n");
  if (!content) { showToast("No output to save"); return; }
  const name = `terminal-${id || activeId}-output.txt`;
  const savedPath = await window.shellfire.saveOutput(content, name);
  if (savedPath) showToast(`Saved to ${savedPath.split("/").pop()}`);
  else showToast("Save cancelled");
}

// ============================================================
// SMART PASTE CONFIRMATION
// ============================================================
const pasteConfirmEl = document.getElementById("paste-confirm");
const pastePreviewEl = document.getElementById("paste-preview");
const pasteLineCountEl = document.getElementById("paste-line-count");
let pendingPaste = null;

function showPasteConfirm(text, targetId) {
  const lines = text.split("\n");
  if (lines.length < 5) {
    // Small paste — just send it
    window.shellfire.sendInput(targetId, text);
    return;
  }
  pendingPaste = { text, targetId };
  pasteLineCountEl.textContent = lines.length;
  pastePreviewEl.textContent = lines.slice(0, 20).join("\n") + (lines.length > 20 ? "\n..." : "");
  pasteConfirmEl.classList.add("visible");
}

document.getElementById("paste-ok").addEventListener("click", () => {
  if (pendingPaste) window.shellfire.sendInput(pendingPaste.targetId, pendingPaste.text);
  pendingPaste = null;
  pasteConfirmEl.classList.remove("visible");
  if (activeId && panes.has(activeId)) panes.get(activeId).term.focus();
});
document.getElementById("paste-cancel").addEventListener("click", () => {
  pendingPaste = null;
  pasteConfirmEl.classList.remove("visible");
  if (activeId && panes.has(activeId)) panes.get(activeId).term.focus();
});
pasteConfirmEl.addEventListener("click", (e) => {
  if (e.target === pasteConfirmEl) { pendingPaste = null; pasteConfirmEl.classList.remove("visible"); }
});

// Intercept Cmd+V for smart paste
document.addEventListener("keydown", (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key === "v" && activeId && panes.has(activeId)) {
    // Don't prevent default for small pastes — let xterm handle single-line
    // We intercept via the paste event instead
  }
});
document.addEventListener("paste", (e) => {
  if (!activeId || !panes.has(activeId)) return;
  const text = e.clipboardData?.getData("text");
  if (text && text.split("\n").length >= 5) {
    e.preventDefault();
    e.stopPropagation();
    showPasteConfirm(text, activeId);
  }
}, true);

// ============================================================
// CLOSE ALL OTHERS
// ============================================================
function closeAllOthers() {
  if (!activeId) return;
  const toClose = [...panes.keys()].filter(id => id !== activeId);
  for (const id of toClose) removeTerminal(id);
  showToast("Closed all other panes");
}

// ============================================================
// KEYBOARD PANE RESIZE
// ============================================================
function resizePaneKeyboard(direction, amount) {
  if (!activeId) return;
  const pos = findPaneInLayout(activeId);
  if (!pos) return;
  const { ri, ci } = pos;
  const step = amount || 0.1;

  if (direction === "right" || direction === "left") {
    const row = layout[ri];
    if (row.cols.length < 2) return;
    const targetCi = direction === "right" ? ci : ci - 1;
    if (targetCi < 0 || targetCi >= row.cols.length - 1) return;
    row.cols[targetCi].flex += step;
    row.cols[targetCi + 1].flex -= step;
    if (row.cols[targetCi + 1].flex < 0.2) row.cols[targetCi + 1].flex = 0.2;
  } else {
    const targetRi = direction === "down" ? ri : ri - 1;
    if (targetRi < 0 || targetRi >= layout.length - 1) return;
    layout[targetRi].flex += step;
    layout[targetRi + 1].flex -= step;
    if (layout[targetRi + 1].flex < 0.2) layout[targetRi + 1].flex = 0.2;
  }
  renderLayout();
}

// ============================================================
// QUICK COMMAND BAR (Cmd+;)
// ============================================================
const quickCmdEl = document.getElementById("quick-cmd");
const quickCmdInput = document.getElementById("quick-cmd-input");

function openQuickCmd() {
  quickCmdEl.classList.add("visible");
  quickCmdInput.value = "";
  quickCmdInput.focus();
}
function closeQuickCmd() {
  quickCmdEl.classList.remove("visible");
  if (activeId && panes.has(activeId)) panes.get(activeId).term.focus();
}

quickCmdInput.addEventListener("keydown", (e) => {
  if (e.key === "Escape") { closeQuickCmd(); return; }
  if (e.key === "Enter") {
    e.preventDefault();
    const cmd = quickCmdInput.value.trim();
    if (!cmd) { closeQuickCmd(); return; }
    if (e.shiftKey) {
      // Run in new split
      doSplitAndRun(cmd);
    } else {
      // Run in active pane
      if (activeId && panes.has(activeId)) {
        window.shellfire.sendInput(activeId, cmd + "\n");
      }
    }
    closeQuickCmd();
  }
});

// ============================================================
// TAB DRAG REORDER
// ============================================================
let dragTabId = null;

function setupTabDrag(tabEl, paneId) {
  tabEl.setAttribute("draggable", "true");
  tabEl.addEventListener("dragstart", (e) => {
    isDragging = true;
    dragTabId = paneId;
    e.dataTransfer.effectAllowed = "move";
    tabEl.style.opacity = "0.4";
  });
  tabEl.addEventListener("dragend", () => {
    tabEl.style.opacity = "";
    dragTabId = null;
    isDragging = false;
    document.querySelectorAll(".tab").forEach(t => t.classList.remove("drag-over"));
    fitAllTerminals();
  });
  tabEl.addEventListener("dragover", (e) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; });
  tabEl.addEventListener("dragenter", () => { if (dragTabId !== paneId) tabEl.classList.add("drag-over"); });
  tabEl.addEventListener("dragleave", () => { tabEl.classList.remove("drag-over"); });
  tabEl.addEventListener("drop", (e) => {
    e.preventDefault();
    tabEl.classList.remove("drag-over");
    if (dragTabId === null || dragTabId === paneId) return;
    // Swap in layout
    const from = findPaneInLayout(dragTabId), to = findPaneInLayout(paneId);
    if (from && to) {
      const tmp = layout[from.ri].cols[from.ci].paneId;
      layout[from.ri].cols[from.ci].paneId = layout[to.ri].cols[to.ci].paneId;
      layout[to.ri].cols[to.ci].paneId = tmp;
      renderLayout();
      showToast("Tabs reordered");
    }
  });
}

// ============================================================
