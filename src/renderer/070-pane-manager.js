// ============================================================
// PANE MANAGEMENT
// ============================================================
function setActive(id) {
  if (activeId !== null && panes.has(activeId)) panes.get(activeId).el.classList.remove("active");
  activeId = id;
  if (panes.has(id)) {
    const pane = panes.get(id);
    pane.el.classList.add("active");
    pane.term.focus();
    // Clear activity indicator when pane gets focus
    if (pane.activityDot) pane.activityDot.classList.remove("visible");
    updatePaneTitle(id);
    // IDE mode: switch to this terminal fullscreen (unless it's already visible in a split)
    if (ideMode && !ideVisiblePanes.includes(id)) {
      ideVisiblePanes = [id];
      renderLayout();
    } else if (ideMode) {
      renderIdeEditorTabs(); // update active tab highlight
    }
  }
}

async function updatePaneTitle(id) {
  const pane = panes.get(id); if (!pane || !pane.titleEl) return;
  try {
    const cwd = await window.shellfire.getCwd(id);

    // Title: use customName if set, otherwise build from cwd/process
    if (pane.customName) {
      pane.titleEl.textContent = pane.customName;
    } else {
      const proc = await window.shellfire.getProcess(id);
      let title = `Terminal ${id}`;
      if (cwd) { let short = cwd.replace(/^\/Users\/[^/]+/, "~"); title = short; }
      if (proc && proc !== "zsh" && proc !== "bash") title += ` — ${proc}`;
      pane.titleEl.textContent = title;
    }

    // Env badge detection (always runs)
    if (pane.envBadgeEl) {
      pane.envBadgeEl.classList.remove("visible", "env-prod", "env-uat", "env-dev");
      if (cwd && cwd.includes("production")) { pane.envBadgeEl.textContent = "PROD"; pane.envBadgeEl.classList.add("visible", "env-prod"); }
      else if (cwd && cwd.includes("uat")) { pane.envBadgeEl.textContent = "UAT"; pane.envBadgeEl.classList.add("visible", "env-uat"); }
      else if (cwd && (cwd.includes("dev") || cwd.includes("local"))) { pane.envBadgeEl.textContent = "DEV"; pane.envBadgeEl.classList.add("visible", "env-dev"); }
    }

    // Git branch detection (always runs)
    if (pane.gitBadge && pane.gitBranchName && cwd) {
      try {
        const [branch, status] = await Promise.all([
          window.shellfire.getGitBranch(cwd),
          window.shellfire.getGitStatus(cwd),
        ]);
        if (branch) {
          pane.gitBranchName.textContent = branch;
          pane.gitBadge.classList.add("visible");
          pane.gitBadge.classList.toggle("dirty", status === "dirty");
        } else {
          pane.gitBadge.classList.remove("visible");
        }
      } catch { pane.gitBadge.classList.remove("visible"); }
    }
  } catch {}
}

// Update pane titles periodically with batching (max 5 concurrent to avoid IPC flood)
setInterval(async () => {
  const ids = [...panes.keys()];
  for (let i = 0; i < ids.length; i += 5) {
    await Promise.all(ids.slice(i, i + 5).map(id => updatePaneTitle(id)));
  }
}, 5000);

function renamePaneUI(id) {
  const pane = panes.get(id); if (!pane) return;

  // In IDE mode, rename inline in the IDE editor tab or sidebar tab instead of hidden pane header
  if (ideMode) {
    // Find the tab element for this pane (IDE editor tabs or sidebar tabs or bottom tabbar)
    const allTabs = document.querySelectorAll(".ide-tab, .tab, #ide-editor-tabs .ide-tab");
    let targetTab = null;
    for (const tab of allTabs) {
      if (tab._paneId === id) { targetTab = tab; break; }
    }
    // Fallback: find by matching text content
    if (!targetTab) {
      const editorTabs = document.getElementById("ide-editor-tabs");
      if (editorTabs) {
        for (const tab of editorTabs.children) {
          if (tab._paneId === id) { targetTab = tab; break; }
        }
      }
    }
    if (targetTab) {
      const input = document.createElement("input");
      input.className = "pane-rename-input";
      input.value = pane.customName || pane.titleEl?.textContent || `Terminal ${id}`;
      input.style.cssText = "width:120px;height:20px;font-size:12px;background:var(--t-ui);color:var(--t-fg);border:1px solid var(--t-accent);outline:none;padding:0 4px;border-radius:2px;";
      // Find the text node or span to replace inside the tab
      const nameSpan = targetTab.querySelector(".ide-tab-name");
      const replaceEl = nameSpan || targetTab;
      const origHTML = replaceEl.innerHTML;
      replaceEl.innerHTML = "";
      replaceEl.appendChild(input);
      input.focus(); input.select();
      let finished = false;
      const finish = () => {
        if (finished) return; finished = true;
        const val = input.value.trim();
        pane.customName = val || null;
        pane._userRenamed = !!val;
        if (val) pane.titleEl.textContent = val;
        else updatePaneTitle(id);
        // Refresh tabs to reflect new name
        renderIdeEditorTabs();
        updateIdeSidebar();
        updateTabBar();
      };
      input.addEventListener("blur", finish);
      input.addEventListener("keydown", (e) => { if (e.key === "Enter") input.blur(); if (e.key === "Escape") { input.value = ""; input.blur(); } });
      return;
    }
  }

  const titleEl = pane.titleEl;
  const input = document.createElement("input");
  input.className = "pane-rename-input";
  input.value = pane.customName || titleEl.textContent;
  titleEl.replaceWith(input);
  input.focus(); input.select();
  const finish = () => {
    const val = input.value.trim();
    pane.customName = val || null;
    pane._userRenamed = !!val; // lock name from auto-updates if user set one
    input.replaceWith(titleEl);
    if (val) titleEl.textContent = val;
    else updatePaneTitle(id);
  };
  input.addEventListener("blur", finish);
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") input.blur(); if (e.key === "Escape") { input.value = ""; input.blur(); } });
}

function togglePaneLock(id) {
  const pane = panes.get(id); if (!pane) return;
  pane.locked = !pane.locked;
  pane.el.classList.toggle("locked", pane.locked);
  pane.el.querySelector(".lock-badge")?.classList.toggle("locked", pane.locked);
  showToast(pane.locked ? "Pane locked" : "Pane unlocked");
}

function applyPaneColor(id, colorName, customBg, customFg) {
  const pane = panes.get(id); if (!pane) return;
  const t = themes[currentThemeIdx] || themes[0];

  // Update indicator
  const ind = pane.indicatorEl;
  paneColors.forEach(c => { if (c) ind.classList.remove(`color-${c}`); });
  // Also remove any extra preset names and custom
  Object.keys(paneColorPresets).forEach(c => { if (c) ind.classList.remove(`color-${c}`); });
  ind.classList.remove("color-custom");

  if (colorName && colorName !== "custom") {
    // Preset color
    const preset = paneColorPresets[colorName];
    pane.color = colorName;
    pane.termBg = preset?.bg || null;
    pane.termFg = preset?.fg || null;
    if (colorName) ind.classList.add(`color-${colorName}`);

    if (preset && preset.bg) {
      pane.term.options.theme = { ...t.term, background: preset.bg, foreground: preset.fg };
      pane.el.querySelector(".pane-body").style.background = preset.bg;
    } else {
      pane.term.options.theme = t.term;
      pane.el.querySelector(".pane-body").style.background = "";
    }
  } else if (colorName === "custom" && customBg && customFg) {
    // Custom color
    pane.color = "custom";
    pane.termBg = customBg;
    pane.termFg = customFg;
    pane.term.options.theme = { ...t.term, background: customBg, foreground: customFg };
    pane.el.querySelector(".pane-body").style.background = customBg;
    ind.classList.add("color-custom");
  } else {
    // Reset to default
    pane.color = "";
    pane.termBg = null;
    pane.termFg = null;
    pane.term.options.theme = t.term;
    pane.el.querySelector(".pane-body").style.background = "";
  }
}

function openPaneColorPicker(paneId, anchorX, anchorY) {
  const picker = document.getElementById("pane-color-picker");
  const pane = panes.get(paneId);
  if (!pane) return;

  const currentColor = pane.color || "";
  const presetNames = Object.keys(paneColorPresets);

  picker.innerHTML = `
    <div class="pane-color-picker-label">Terminal Color</div>
    <div class="pane-color-picker-grid">
      ${presetNames.map(name => {
        const p = paneColorPresets[name];
        const bg = p.bg || (themes[currentThemeIdx] || themes[0]).term.background;
        const fg = p.fg || (themes[currentThemeIdx] || themes[0]).term.foreground;
        const isActive = currentColor === name;
        return `<div class="pane-color-swatch${isActive ? " active" : ""}" data-color="${name}" style="background:${bg};color:${fg}" title="${p.label}">${p.label}</div>`;
      }).join("")}
    </div>
    <div class="pane-color-picker-sep"></div>
    <div class="pane-color-picker-label">Custom</div>
    <div class="pane-color-picker-custom">
      <label>BG</label>
      <input type="color" id="pane-custom-bg" value="${pane.termBg || (themes[currentThemeIdx] || themes[0]).term.background}">
      <label>Text</label>
      <input type="color" id="pane-custom-fg" value="${pane.termFg || (themes[currentThemeIdx] || themes[0]).term.foreground}">
    </div>
    <div class="pane-color-picker-actions">
      <button id="pane-color-apply-custom" class="primary">Apply Custom</button>
      <button id="pane-color-reset">Reset</button>
    </div>
  `;

  // Preset click handlers
  picker.querySelectorAll(".pane-color-swatch").forEach(swatch => {
    swatch.addEventListener("click", () => {
      applyPaneColor(paneId, swatch.dataset.color);
      picker.classList.remove("visible");
      showToast(swatch.dataset.color ? `Color: ${paneColorPresets[swatch.dataset.color]?.label}` : "Color reset");
    });
  });

  // Custom apply
  picker.querySelector("#pane-color-apply-custom").addEventListener("click", () => {
    const bg = picker.querySelector("#pane-custom-bg").value;
    const fg = picker.querySelector("#pane-custom-fg").value;
    applyPaneColor(paneId, "custom", bg, fg);
    picker.classList.remove("visible");
    showToast("Custom color applied");
  });

  // Reset
  picker.querySelector("#pane-color-reset").addEventListener("click", () => {
    applyPaneColor(paneId, "");
    picker.classList.remove("visible");
    showToast("Color reset");
  });

  picker.classList.add("visible");

  // Position with viewport bounds checking
  requestAnimationFrame(() => {
    const rect = picker.getBoundingClientRect();
    const viewW = window.innerWidth, viewH = window.innerHeight;
    const finalX = (anchorX + rect.width > viewW) ? Math.max(0, viewW - rect.width - 4) : anchorX;
    const finalY = (anchorY + rect.height > viewH) ? Math.max(0, viewH - rect.height - 4) : anchorY;
    picker.style.left = finalX + "px";
    picker.style.top = finalY + "px";
  });
}

// Close color picker on outside click
document.addEventListener("click", (e) => {
  const picker = document.getElementById("pane-color-picker");
  if (picker && picker.classList.contains("visible") && !picker.contains(e.target)) {
    picker.classList.remove("visible");
  }
});

// Sanitize a saved terminal buffer for replay. This is tricky because:
// 1. Alt-screen apps (Claude, vim, less) render to a separate buffer — replaying
//    their content on the main screen produces garbage. We must skip it entirely.
// 2. Mode-change sequences (focus reporting, bracketed paste, mouse tracking)
//    left enabled by previous apps cause phantom input events in the new PTY.
// 3. Query sequences (DA, DSR, OSC color) trigger xterm to respond, which leaks
//    response bytes back into the new PTY's input stream.
function sanitizeReplayBuffer(buf) {
  // Trim any partial escape sequence at the very start (buffer is a tail slice)
  const firstNl = buf.indexOf("\n");
  if (firstNl > 0 && firstNl < 200) buf = buf.slice(firstNl + 1);

  // Walk the buffer, tracking alt-screen state. Skip everything while in alt-screen.
  let out = "";
  let inAlt = false;
  let i = 0;
  const altEnter = /^\x1b\[\?(1049|1047|47)h/;
  const altExit = /^\x1b\[\?(1049|1047|47)l/;
  // Any DEC private mode set/reset — we always drop these (don't want old modes carrying over)
  const decMode = /^\x1b\[\?[\d;]+[hl]/;
  // DA/DSR queries
  const daQuery = /^\x1b\[(>|=|\?)?\d*[cn]/;
  // OSC queries (color etc.)
  const oscQuery = /^\x1b\][\d;]*\?[^\x07\x1b]*(\x07|\x1b\\)/;
  // Cursor save/restore
  const cursorSR = /^\x1b\[[su]/;
  // Application keypad/cursor
  const appMode = /^\x1b[=>]/;

  while (i < buf.length) {
    const rest = buf.slice(i, i + 32);
    let m;
    if ((m = rest.match(altEnter))) {
      inAlt = true;
      i += m[0].length;
      continue;
    }
    if ((m = rest.match(altExit))) {
      inAlt = false;
      i += m[0].length;
      continue;
    }
    if (inAlt) {
      // Skip everything while alt-screen was active
      i++;
      continue;
    }
    if ((m = rest.match(decMode))) { i += m[0].length; continue; }
    if ((m = rest.match(daQuery))) { i += m[0].length; continue; }
    if ((m = rest.match(oscQuery))) { i += m[0].length; continue; }
    if ((m = rest.match(cursorSR))) { i += m[0].length; continue; }
    if ((m = rest.match(appMode))) { i += m[0].length; continue; }
    out += buf[i++];
  }
  return out;
}

// Reset sequence to restore terminal to sane defaults after replay
const RESET_SEQ = "\x1b[?1004l\x1b[?2004l\x1b[?1000l\x1b[?1002l\x1b[?1003l\x1b[?1006l\x1b[?1049l\x1b[?25h\x1b[0m";

async function createPaneObj(cwd, restoreCmd, replayBuffer, existingId) {
  // If an existing PTY id is provided, reuse it (tmux-like reattach).
  // Otherwise spawn a new PTY via IPC.
  const id = existingId != null
    ? existingId
    : await window.shellfire.createTerminal(cwd, restoreCmd);
  const el = document.createElement("div"); el.className = "pane";

  const header = document.createElement("div"); header.className = "pane-header";
  header.innerHTML = `
    <button class="pane-close"></button>
    <span class="pane-number"></span>
    <span class="env-badge" id="env-${id}"></span>
    <span class="pane-title">Terminal ${id} — zsh</span>
    <span class="git-badge"><svg viewBox="0 0 24 24"><circle cx="12" cy="6" r="2"/><circle cx="12" cy="18" r="2"/><line x1="12" y1="8" x2="12" y2="16"/></svg><span class="git-branch-name"></span></span>
    <span class="watcher-badge"></span>
    <span class="activity-dot"></span>
    <div class="pane-badges">
      <span class="pane-badge lock-badge" title="Lock"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0110 0v4"/></svg></span>
      <span class="pane-badge zoom-badge" title="Zoom"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg></span>
      <span class="pane-badge save-badge" title="Save Output"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#30d158" stroke-width="2" stroke-linecap="round"><path d="M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg></span>
    </div>
    <div class="pane-indicator"></div>
  `;

  header.querySelector(".pane-close").addEventListener("click", (e) => { e.stopPropagation(); removeTerminal(id); });
  header.querySelector(".zoom-badge").addEventListener("click", (e) => { e.stopPropagation(); setActive(id); toggleZoom(); });
  header.querySelector(".lock-badge").addEventListener("click", (e) => { e.stopPropagation(); togglePaneLock(id); });
  header.querySelector(".save-badge").addEventListener("click", (e) => { e.stopPropagation(); captureOutput(id); });
  header.addEventListener("click", () => setActive(id));
  header.addEventListener("dblclick", (e) => { e.preventDefault(); renamePaneUI(id); });
  header.addEventListener("contextmenu", (e) => { e.preventDefault(); showContextMenu(e.clientX, e.clientY, id); });

  // Drag & drop — listeners on header only (not document), disposed with the pane
  header.setAttribute("draggable", "true");
  header.addEventListener("dragstart", (e) => {
    isDragging = true; el._dragId = id;
    e.dataTransfer.effectAllowed = "move";
    header.style.opacity = "0.5";
  });
  header.addEventListener("dragend", () => {
    header.style.opacity = ""; isDragging = false; fitAllTerminals();
  });
  header.addEventListener("dragover", (e) => {
    e.preventDefault(); e.dataTransfer.dropEffect = "move";
  });
  header.addEventListener("dragenter", () => {
    header.style.borderBottom = "2px solid var(--t-accent)";
  });
  header.addEventListener("dragleave", (e) => {
    // Only clear if actually leaving the header (not entering a child)
    if (!header.contains(e.relatedTarget)) header.style.borderBottom = "";
  });
  header.addEventListener("drop", (e) => {
    e.preventDefault(); header.style.borderBottom = "";
    const fromId = [...panes.entries()].find(([, p]) => p.el._dragId)?.[0];
    if (!fromId || fromId === id) return;
    const from = findPaneInLayout(fromId), to = findPaneInLayout(id);
    if (from && to) {
      const tmp = layout[from.ri].cols[from.ci].paneId;
      layout[from.ri].cols[from.ci].paneId = layout[to.ri].cols[to.ci].paneId;
      layout[to.ri].cols[to.ci].paneId = tmp;
      renderLayout();
      showToast("Panes swapped");
    }
    delete panes.get(fromId)?.el._dragId;
  });

  const body = document.createElement("div"); body.className = "pane-body";
  const scrollBtn = document.createElement("button"); scrollBtn.className = "scroll-to-bottom"; scrollBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="6 9 12 15 18 9"/></svg>'; scrollBtn.title = "Scroll to bottom";

  el.appendChild(header); el.appendChild(body); el.appendChild(scrollBtn);

  const t = themes[currentThemeIdx] || themes[0];
  const term = new Terminal({
    theme: t.term, fontSize: currentFontSize,
    fontFamily: '"SF Mono", "Menlo", "Monaco", "Courier New", monospace',
    cursorBlink: true, cursorStyle: "block", allowProposedApi: true, scrollback: 10000,
  });

  const fitAddon = new FitAddon.FitAddon();
  term.loadAddon(fitAddon);
  let searchAddon = null;
  try { searchAddon = new SearchAddon.SearchAddon(); term.loadAddon(searchAddon); } catch (e) { console.warn("SearchAddon failed:", e.message); }
  try { term.loadAddon(new WebLinksAddon.WebLinksAddon()); } catch (e) { console.warn("WebLinksAddon failed:", e.message); }
  term.open(body);
  // Try WebGL renderer, fall back to canvas if GPU unavailable
  try {
    if (typeof WebglAddon !== "undefined") {
      const webgl = new WebglAddon.WebglAddon();
      webgl.onContextLoss(() => { webgl.dispose(); console.warn("WebGL context lost for pane", id); });
      term.loadAddon(webgl);
    }
  } catch (e) { console.warn("WebGL addon failed, using canvas renderer:", e.message); }

  // Copy on select
  term.onSelectionChange(() => {
    if (copyOnSelect) { const sel = term.getSelection(); if (sel) navigator.clipboard.writeText(sel); }
  });

  term.onData((data) => {
    // Extension hooks (e.g. AI autocomplete)
    let consumed = false;
    for (const fn of _extHooks.terminalInput) {
      if (fn(id, data) === true) { consumed = true; break; }
    }
    if (consumed) return;

    // Track command history
    if (typeof trackCommandInput === "function") trackCommandInput(id, data);

    if (broadcastMode) { window.shellfire.broadcast([...panes.keys()], data); }
    else {
      window.shellfire.sendInput(id, data);
      // Forward to linked panes
      for (const group of linkedGroups) {
        if (group.includes(id)) {
          for (const gid of group) {
            if (gid !== id && panes.has(gid)) window.shellfire.sendInput(gid, data);
          }
        }
      }
    }
  });
  term.textarea.addEventListener("focus", () => setActive(id));

  // Bell notification
  term.onBell(() => {
    if (activeId !== id && !document.hasFocus()) {
      window.shellfire.notify("Terminal Bell", `Terminal ${id} triggered a bell`);
    }
  });

  // Scroll-to-bottom
  const viewport = body.querySelector(".xterm-viewport");
  if (viewport) { viewport.addEventListener("scroll", () => { scrollBtn.classList.toggle("visible", viewport.scrollTop < viewport.scrollHeight - viewport.clientHeight - 10); }); }
  term.onWriteParsed(() => { if (viewport) scrollBtn.classList.toggle("visible", viewport.scrollTop < viewport.scrollHeight - viewport.clientHeight - 10); });
  scrollBtn.addEventListener("click", (e) => { e.stopPropagation(); term.scrollToBottom(); scrollBtn.classList.remove("visible"); term.focus(); });

  body.addEventListener("contextmenu", (e) => { e.preventDefault(); showContextMenu(e.clientX, e.clientY, id); });

  // External file/folder drop: paste path into terminal
  body.addEventListener("dragover", (e) => {
    if (e.dataTransfer.types.includes("Files")) {
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
    }
  });
  body.addEventListener("drop", (e) => {
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      e.preventDefault();
      const paths = [...e.dataTransfer.files].map(f => {
        const p = f.path;
        if (!p) return null;
        if (/[\s'"\\$`!#&|;(){}[\]*?<>~]/.test(p)) return `'${p.replace(/'/g, "'\\''")}'`;
        return p;
      }).filter(Boolean);
      if (paths.length > 0) {
        window.shellfire.sendInput(id, paths.join(" "));
        term.focus();
      }
    }
  });

  const titleEl = header.querySelector(".pane-title");
  const indicatorEl = header.querySelector(".pane-indicator");
  const envBadgeEl = header.querySelector(".env-badge");
  const paneNumberEl = header.querySelector(".pane-number");
  const activityDot = header.querySelector(".activity-dot");
  const gitBadge = header.querySelector(".git-badge");
  const gitBranchName = header.querySelector(".git-branch-name");
  const paneObj = { el, term, fitAddon, searchAddon, titleEl, indicatorEl, envBadgeEl, paneNumberEl, activityDot, gitBadge, gitBranchName, customName: null, locked: false, color: "", termBg: null, termFg: null, createdAt: Date.now(), rawBuffer: "" };
  // If restoring a session, hold PTY data until rawBuffer is replayed
  if (replayBuffer) paneObj._replayPending = true;
  panes.set(id, paneObj);
  return id;
}

async function addTerminal(cwd) {
  const id = await createPaneObj(cwd);
  if (ideMode) {
    // In IDE mode, new terminals show fullscreen
    // Add to normal layout too (for when user exits IDE mode)
    layout.push({ flex: 1, cols: [{ flex: 1, paneId: id }] });
    ideVisiblePanes = [id];
    setActive(id);
    renderLayout();
  } else {
    setActive(id); rebuildLayout();
  }
  // Auto-name: give it a quick initial name based on cwd, then refine after shell starts
  if (cwd) {
    const pane = panes.get(id);
    if (pane) {
      const short = cwd.replace(/^\/Users\/[^/]+/, "~").replace(/^\/home\/[^/]+/, "~");
      pane.customName = short;
      if (pane.titleEl) pane.titleEl.textContent = short;
    }
  }
  // Refine name once the process is running
  setTimeout(async () => {
    const pane = panes.get(id);
    if (pane && !pane._userRenamed) {
      const smart = await getSmartName(id);
      if (smart) { pane.customName = smart; if (pane.titleEl) pane.titleEl.textContent = smart; }
    }
    updateIdeSidebar();
  }, 800);
  return id;
}

function removeTerminal(id) {
  const pane = panes.get(id); if (!pane) return;
  if (pane.locked) { showToast("Pane is locked"); return; }
  if (zoomedId === id) { zoomedId = null; for (const [, p] of panes) p.el.classList.remove("zoomed", "dimmed"); }
  if (watchTimers.has(id)) stopWatch(id);
  if (floatingPanes.has(id)) floatingPanes.delete(id);
  paneCommandStart.delete(id);
  loggingPanes.delete(id);
  paneStatsHistory.delete(id);
  paneLineBufs.delete(id);
  paneErrorDebounce.delete(id);
  window.shellfire.kill(id); pane.term.dispose(); panes.delete(id);
  if (activeId === id) { const r = [...panes.keys()]; activeId = r.length > 0 ? r[r.length - 1] : null; }
  for (let ri = layout.length - 1; ri >= 0; ri--) { layout[ri].cols = layout[ri].cols.filter(c => c.paneId !== id); if (layout[ri].cols.length === 0) layout.splice(ri, 1); }
  // IDE mode: remove from visible panes, show next terminal fullscreen
  if (ideMode) {
    ideVisiblePanes = ideVisiblePanes.filter(pid => pid !== id);
    if (ideVisiblePanes.length === 0 && activeId) ideVisiblePanes = [activeId];
  }
  renderLayout();
  if (activeId !== null) setActive(activeId);
  updateWelcomeScreen();
  if (typeof scheduleEnrichTabData === "function") scheduleEnrichTabData();
  if (typeof scheduleSmartNames === "function") scheduleSmartNames();
  setTimeout(() => updateIdeSidebar(), 100);
}

