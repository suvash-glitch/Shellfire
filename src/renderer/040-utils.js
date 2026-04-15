// ============================================================
// ZOOM (app-wide — scales entire UI chrome + terminal)
// ============================================================
function applyZoom(factor, silent) {
  currentZoom = Math.max(0.5, Math.min(3.0, Number(factor) || 1.0));
  // Round to nearest 0.05 for clean steps
  currentZoom = Math.round(currentZoom * 20) / 20;
  window.shellfire.setZoom(currentZoom);
  // Persist to both config and settings so it survives restart
  window.shellfire.saveConfig({
    theme: currentThemeIdx,
    themeName: (themes[currentThemeIdx] || themes[0]).name,
    fontSize: currentFontSize,
    zoom: currentZoom,
  });
  settings.zoom = currentZoom;
  if (!silent) showToast(`Zoom: ${Math.round(currentZoom * 100)}%`);
  // Terminals need to refit after the window scales
  setTimeout(() => fitAllTerminals(), 50);
}
function zoomIn() { applyZoom(currentZoom + 0.1); }
function zoomOut() { applyZoom(currentZoom - 0.1); }
function zoomReset() { applyZoom(1.0); }

// ============================================================
// FONT SIZE (terminal-only — independent of app zoom)
// ============================================================
function setFontSize(size) {
  currentFontSize = Math.max(8, Math.min(24, size));
  for (const [, pane] of panes) pane.term.options.fontSize = currentFontSize;
  fitAllTerminals();
  showToast(`Font size: ${currentFontSize}px`);
  window.shellfire.saveConfig({
    theme: currentThemeIdx,
    themeName: (themes[currentThemeIdx] || themes[0]).name,
    fontSize: currentFontSize,
    zoom: currentZoom,
  });
}

