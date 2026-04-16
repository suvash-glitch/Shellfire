/**
 * @module renderer/050-layout
 * @description Grid layout engine: renders the pane grid from the layout array, fits all terminals to their containers, handles divider drag-resize, and manages the active-pane indicator.
 */

// ============================================================
// LAYOUT
// ============================================================
let fitRAF = null;
let pendingSavedScroll = null;
let isDragging = false;
let layoutInProgress = false;

function captureScrollState() {
  const state = new Map();
  for (const [id, pane] of panes) {
    const buf = pane.term.buffer.active;
    const viewport = pane.el.querySelector(".xterm-viewport");
    const atBottom = viewport
      ? viewport.scrollTop >= viewport.scrollHeight - viewport.clientHeight - 10
      : true;
    state.set(id, { viewportY: buf.viewportY, atBottom });
  }
  return state;
}

function fitAllTerminals(savedScrollPositions) {
  if (savedScrollPositions) {
    pendingSavedScroll = savedScrollPositions;
  }
  if (fitRAF) cancelAnimationFrame(fitRAF);
  fitRAF = requestAnimationFrame(() => {
    fitRAF = null;
    // Always capture scroll state — use pre-saved from renderLayout if available,
    // otherwise capture fresh (this is what the ResizeObserver path uses)
    const scrollState = pendingSavedScroll || captureScrollState();
    pendingSavedScroll = null;

    for (const [id, pane] of panes) {
      try {
        pane.fitAddon.fit();
        window.shellfire.resize(id, pane.term.cols, pane.term.rows);
      } catch {}
    }

    // Restore scroll positions after fit using line offsets
    for (const [id, pos] of scrollState) {
      const pane = panes.get(id);
      if (!pane) continue;
      if (pos.atBottom) {
        pane.term.scrollToBottom();
      } else {
        pane.term.scrollToLine(pos.viewportY);
      }
    }
  });
}

function renderLayout() {
  layoutInProgress = true;
  // Capture scroll state before any DOM manipulation
  const scrollPositions = captureScrollState();
  // Detach pane elements before clearing to preserve xterm state
  for (const [, pane] of panes) {
    if (pane.el.parentNode) pane.el.parentNode.removeChild(pane.el);
  }
  grid.innerHTML = "";
  const n = panes.size;
  paneCountEl.textContent = n === 0 ? "No terminals" : `${n} terminal${n > 1 ? "s" : ""}`;

  // IDE mode: render only visible panes (fullscreen by default)
  if (ideMode) {
    renderIdeEditorTabs();
    if (ideVisiblePanes.length === 0 && activeId && panes.has(activeId)) {
      ideVisiblePanes = [activeId];
    }
    if (ideVisiblePanes.length === 0 && n > 0) {
      ideVisiblePanes = [[...panes.keys()][0]];
    }
    ideVisiblePanes = ideVisiblePanes.filter(id => panes.has(id));
    if (ideVisiblePanes.length === 0) { layoutInProgress = false; fitAllTerminals(scrollPositions); return; }

    const rowEl = document.createElement("div");
    rowEl.className = "grid-row"; rowEl.style.flex = "1";
    ideVisiblePanes.forEach((id, i) => {
      if (i > 0) {
        const v = document.createElement("div"); v.className = "resize-handle-v";
        rowEl.appendChild(v);
      }
      const pane = panes.get(id);
      if (pane) { pane.el.style.flex = "1"; rowEl.appendChild(pane.el); }
    });
    grid.appendChild(rowEl);
    layoutInProgress = false;
    fitAllTerminals(scrollPositions);
    return;
  }

  // Normal mode: standard grid layout (use fragment to batch DOM writes)
  const frag = document.createDocumentFragment();
  for (let ri = 0; ri < layout.length; ri++) {
    const row = layout[ri];
    if (ri > 0) { const h = document.createElement("div"); h.className = "resize-handle-h"; setupHorizontalResize(h, ri); frag.appendChild(h); }
    const rowEl = document.createElement("div"); rowEl.className = "grid-row"; rowEl.style.flex = row.flex;
    for (let ci = 0; ci < row.cols.length; ci++) {
      const col = row.cols[ci];
      if (ci > 0) { const v = document.createElement("div"); v.className = "resize-handle-v"; setupVerticalResize(v, ri, ci); rowEl.appendChild(v); }
      const pane = panes.get(col.paneId);
      if (pane) { pane.el.style.flex = col.flex; rowEl.appendChild(pane.el); }
    }
    frag.appendChild(rowEl);
  }
  grid.appendChild(frag);
  layoutInProgress = false;
  fitAllTerminals(scrollPositions);
}

function renderIdeEditorTabs() {
  const tabsEl = document.getElementById("ide-editor-tabs");
  if (!tabsEl) return;
  tabsEl.innerHTML = "";
  for (const [id, pane] of panes) {
    const tab = document.createElement("button");
    tab.className = "ide-tab" + (id === activeId ? " active" : "");
    tab._paneId = id;

    const proc = pane._lastProcess || "";
    const icon = getIdeTabIcon(proc);
    const name = pane.customName || `Terminal ${id}`;

    tab.innerHTML = `
      <span class="ide-tab-icon">${escHtml(icon)}</span>
      <span class="ide-tab-name">${escHtml(name)}</span>
      ${proc && proc !== "zsh" && proc !== "bash" ? '<span class="ide-tab-modified"></span>' : ""}
      <button class="ide-tab-close">&times;</button>
    `;
    tab.addEventListener("click", (e) => {
      if (e.target.classList.contains("ide-tab-close")) {
        removeTerminal(id);
        return;
      }
      // Switch to this terminal fullscreen (reset IDE split)
      ideVisiblePanes = [id];
      setActive(id);
      renderLayout();
    });
    tab.addEventListener("dblclick", (e) => { e.stopPropagation(); renamePaneUI(id); });
    tabsEl.appendChild(tab);
  }
}

function getIdeTabIcon(proc) {
  if (!proc) return "\u25B8"; // small triangle
  const p = proc.toLowerCase();
  if (p.includes("node")) return "\u25CF"; // filled circle
  if (p.includes("python")) return "\u25CF";
  if (p.includes("vim") || p.includes("nvim")) return "\u25CF";
  if (p.includes("git")) return "\u25CF";
  if (p.includes("ssh")) return "\u25CF";
  return "\u25B8";
}

function setupHorizontalResize(handle, rowIndex) {
  handle.addEventListener("mousedown", (e) => {
    e.preventDefault(); handle.classList.add("dragging"); document.body.style.cursor = "row-resize"; document.body.style.userSelect = "none";
    const startY = e.clientY, rows = grid.querySelectorAll(".grid-row"), aboveRow = rows[rowIndex - 1], belowRow = rows[rowIndex];
    const initAboveH = aboveRow.offsetHeight, initBelowH = belowRow.offsetHeight, totalFlex = layout[rowIndex - 1].flex + layout[rowIndex].flex, totalH = initAboveH + initBelowH;
    const onMove = (ev) => { const dy = ev.clientY - startY, ah = initAboveH + dy, bh = initBelowH - dy; if (ah < 60 || bh < 60) return; layout[rowIndex-1].flex = totalFlex*(ah/totalH); layout[rowIndex].flex = totalFlex*(bh/totalH); aboveRow.style.flex = layout[rowIndex-1].flex; belowRow.style.flex = layout[rowIndex].flex; fitAllTerminals(); };
    const onUp = () => { handle.classList.remove("dragging"); document.body.style.cursor = ""; document.body.style.userSelect = ""; document.removeEventListener("mousemove", onMove); document.removeEventListener("mouseup", onUp); fitAllTerminals(); };
    document.addEventListener("mousemove", onMove); document.addEventListener("mouseup", onUp);
  });
}

function setupVerticalResize(handle, rowIndex, colIndex) {
  handle.addEventListener("mousedown", (e) => {
    e.preventDefault(); handle.classList.add("dragging"); document.body.style.cursor = "col-resize"; document.body.style.userSelect = "none";
    const startX = e.clientX, row = layout[rowIndex], rowEl = handle.parentElement, children = [...rowEl.children], hIdx = children.indexOf(handle);
    let leftEl = null, rightEl = null;
    for (let i = hIdx - 1; i >= 0; i--) { if (children[i].classList.contains("pane")) { leftEl = children[i]; break; } }
    for (let i = hIdx + 1; i < children.length; i++) { if (children[i].classList.contains("pane")) { rightEl = children[i]; break; } }
    const initLW = leftEl ? leftEl.offsetWidth : 100, initRW = rightEl ? rightEl.offsetWidth : 100, totalFlex = row.cols[colIndex-1].flex + row.cols[colIndex].flex, totalW = initLW + initRW;
    const onMove = (ev) => { const dx = ev.clientX - startX, lw = initLW + dx, rw = initRW - dx; if (lw < 80 || rw < 80) return; row.cols[colIndex-1].flex = totalFlex*(lw/totalW); row.cols[colIndex].flex = totalFlex*(rw/totalW); if (leftEl) leftEl.style.flex = row.cols[colIndex-1].flex; if (rightEl) rightEl.style.flex = row.cols[colIndex].flex; fitAllTerminals(); };
    const onUp = () => { handle.classList.remove("dragging"); document.body.style.cursor = ""; document.body.style.userSelect = ""; document.removeEventListener("mousemove", onMove); document.removeEventListener("mouseup", onUp); fitAllTerminals(); };
    document.addEventListener("mousemove", onMove); document.addEventListener("mouseup", onUp);
  });
}

function rebuildLayout() {
  const ids = [...panes.keys()]; const n = ids.length;
  if (n === 0) { layout = []; renderLayout(); return; }
  const gridCols = Math.ceil(Math.sqrt(n)), gridRows = Math.ceil(n / gridCols);
  layout = []; let idx = 0;
  for (let r = 0; r < gridRows; r++) { const row = { flex: 1, cols: [] }; const c = Math.min(gridCols, n - idx); for (let i = 0; i < c; i++) row.cols.push({ flex: 1, paneId: ids[idx++] }); layout.push(row); }
  renderLayout();
}

function findPaneInLayout(id) {
  for (let ri = 0; ri < layout.length; ri++) for (let ci = 0; ci < layout[ri].cols.length; ci++) if (layout[ri].cols[ci].paneId === id) return { ri, ci };
  return null;
}

