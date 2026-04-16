/**
 * @module renderer/020-extension-api
 * @description Exposes window._termExt — the legacy extension API surface available to installed plugins. Provides hooks (terminalInput, errorDetected, contextMenu), toolbar injection, side-panel injection, and command registration.
 */

// ============================================================
// EXTENSION PLUGIN API
// ============================================================
const _extHooks = {
  terminalInput: [],  // (id, data) => true to consume
  errorDetected: [],  // (paneId, snippet) => void
  contextMenu: [],    // (paneId) => [{label, action}]
};
const _extSettingsSections = []; // [{html, onMount}]
window._termExt = {
  on(event, fn) { if (_extHooks[event]) _extHooks[event].push(fn); },
  off(event, fn) { if (_extHooks[event]) _extHooks[event] = _extHooks[event].filter(f => f !== fn); },
  get activeId() { return activeId; },
  getPane(id) { return panes.get(id); },
  get allPaneIds() { return [...panes.keys()]; },
  get fontSize() { return currentFontSize; },
  get broadcastMode() { return broadcastMode; },
  get skipPermissions() { return skipPermissions; },
  set skipPermissions(val) { skipPermissions = !!val; },
  toggleSkipPermissions() { toggleSkipPermissions(); },
  sendInput(id, data) { window.shellfire.sendInput(id, data); },
  broadcast(ids, data) { window.shellfire.broadcast(ids, data); },
  showToast(msg) { showToast(msg); },
  registerCommand(cmd) { commands.push(cmd); },
  get settings() { return settings; },
  saveSettings() { window.shellfire.saveSettings(settings); },
  ipc: window.shellfire,
  addSettingsSection(html, onMount) { _extSettingsSections.push({ html, onMount }); },
  addToolbarButton({ id, title, icon, onClick, style }) {
    const btn = document.createElement("button");
    btn.className = "btn-icon";
    btn.id = id;
    btn.title = title || "";
    if (style) btn.style.cssText = style;
    btn.innerHTML = icon;
    btn.addEventListener("click", onClick);
    const anchor = document.getElementById("btn-skip-perms-anchor") || document.getElementById("btn-ide-mode");
    if (anchor && anchor.parentNode) {
      anchor.parentNode.insertBefore(btn, anchor);
    } else {
      const group = document.querySelector(".titlebar-group:last-child");
      if (group) group.appendChild(btn);
    }
  },
  addSidePanel(id, html) {
    const panel = document.createElement("div");
    panel.className = "side-panel";
    panel.id = id;
    panel.innerHTML = html;
    document.body.appendChild(panel);
    return panel;
  },
};

