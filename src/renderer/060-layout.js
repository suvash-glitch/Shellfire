// ============================================================
// SPLIT
// ============================================================
async function splitPane(direction) {
  if (activeId === null) { await addTerminal(); return; }

  // IDE mode: split adds the new pane alongside the current one
  if (ideMode) {
    let cwd = null;
    try { cwd = await window.shellfire.getCwd(activeId); } catch {}
    const newId = await createPaneObj(cwd);
    // Also add to the normal layout for when IDE mode is turned off
    const pos = findPaneInLayout(activeId);
    if (pos) {
      if (direction === "horizontal") {
        layout[pos.ri].cols.splice(pos.ci + 1, 0, { flex: 1, paneId: newId });
      } else {
        layout.splice(pos.ri + 1, 0, { flex: layout[pos.ri].flex, cols: [{ flex: 1, paneId: newId }] });
      }
    }
    ideVisiblePanes = [...ideVisiblePanes, newId];
    setActive(newId);
    renderLayout();
    return;
  }

  const pos = findPaneInLayout(activeId);
  if (!pos) { await addTerminal(); return; }
  let cwd = null;
  try { cwd = await window.shellfire.getCwd(activeId); } catch {}
  const newId = await createPaneObj(cwd);
  if (direction === "horizontal") {
    layout[pos.ri].cols.splice(pos.ci + 1, 0, { flex: 1, paneId: newId });
  } else {
    layout.splice(pos.ri + 1, 0, { flex: layout[pos.ri].flex, cols: [{ flex: 1, paneId: newId }] });
  }
  setActive(newId);
  renderLayout();
}

// ============================================================
// ZOOM
// ============================================================
function toggleZoom() {
  if (activeId === null) return;
  if (zoomedId !== null) {
    for (const [, pane] of panes) pane.el.classList.remove("zoomed", "dimmed");
    zoomedId = null; renderLayout(); showToast("Unzoomed");
  } else {
    zoomedId = activeId; const pane = panes.get(activeId); if (!pane) return;
    for (const [id, p] of panes) { if (id === activeId) { p.el.classList.add("zoomed"); p.el.classList.remove("dimmed"); } else p.el.classList.add("dimmed"); }
    grid.appendChild(pane.el); fitAllTerminals(); showToast("Zoomed");
  }
}

// ============================================================
// TOGGLES
// ============================================================
function toggleBroadcast() {
  broadcastMode = !broadcastMode;
  document.getElementById("broadcast-indicator").classList.toggle("visible", broadcastMode);
  document.getElementById("btn-broadcast").classList.toggle("active-toggle", broadcastMode);
  showToast(broadcastMode ? "Broadcast ON" : "Broadcast OFF");
}

function toggleSkipPermissions() {
  skipPermissions = !skipPermissions;
  const btn = document.getElementById("btn-skip-perms");
  if (btn) btn.classList.toggle("active-toggle", skipPermissions);
  const indicator = document.getElementById("skip-perms-indicator");
  if (indicator) indicator.classList.toggle("visible", skipPermissions);
  showToast(skipPermissions ? "Skip Permissions ON" : "Skip Permissions OFF");
}

