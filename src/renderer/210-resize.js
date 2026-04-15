// RESIZE & CLEANUP
// ============================================================
let resizeDebounce = null;
new ResizeObserver(() => {
  if (isDragging || layoutInProgress) return;
  clearTimeout(resizeDebounce);
  resizeDebounce = setTimeout(() => fitAllTerminals(), 100);
}).observe(grid);
window.addEventListener("beforeunload", () => {
  window.shellfire.saveConfig({
    theme: currentThemeIdx,
    themeName: (themes[currentThemeIdx] || themes[0]).name,
    fontSize: currentFontSize,
    zoom: currentZoom,
  });
  saveCurrentSessionSync();
});
setupAutoSave();

// Throttle background timers when window is hidden to save CPU/battery
let _appVisible = true;
document.addEventListener("visibilitychange", () => { _appVisible = !document.hidden; });

// ============================================================
