// ============================================================
// THEMES
// Data lives in src/renderer/themes.js (loaded first in index.html).
// ============================================================
const themes = window.__SF_THEMES;
const paneColors = window.__SF_PANE_COLORS;
const paneColorPresets = window.__SF_PANE_COLOR_PRESETS;
// ============================================================
// UTILS
// ============================================================
const _escMap = { "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" };
function escHtml(str) { return String(str).replace(/[&<>"']/g, c => _escMap[c]); }

let toastTimer = null;
function showToast(msg, type) {
  toastEl.textContent = msg;
  toastEl.classList.remove("error");
  if (type === "error") toastEl.classList.add("error");
  toastEl.classList.add("visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toastEl.classList.remove("visible", "error"); }, type === "error" ? 4000 : 2000);
}

function getClaudeCommand() {
  return skipPermissions ? "claude --dangerously-skip-permissions" : "claude";
}

function launchClaude(id) {
  window.shellfire.sendInput(id, getClaudeCommand() + "\n");
  if (skipPermissions) {
    // Claude Code runs in raw mode — use \r (carriage return) for Enter
    setTimeout(() => window.shellfire.sendInput(id, "/effort max\r"), 3000);
  }
}

// ============================================================
// THEME
// ============================================================
function applyTheme(idx, silent) {
  if (typeof idx === "string") {
    const found = themes.findIndex(t => t.name === idx);
    idx = found >= 0 ? found : 0;
  }
  if (idx < 0 || idx >= themes.length) idx = 0;
  currentThemeIdx = idx;
  const t = themes[idx];
  // Set CSS custom properties — all styling flows from these, no inline overrides needed
  const root = document.documentElement;
  root.style.setProperty("--t-bg", t.body);
  root.style.setProperty("--t-fg", t.term.foreground || "#cccccc");
  root.style.setProperty("--t-ui", t.ui);
  root.style.setProperty("--t-border", t.border);
  root.style.setProperty("--t-accent", t.term.cursor || "#00f0ff");

  // Update xterm themes (preserve per-pane color overrides)
  for (const [, pane] of panes) {
    if (pane.termBg && pane.termFg) {
      pane.term.options.theme = { ...t.term, background: pane.termBg, foreground: pane.termFg };
      pane.el.querySelector(".pane-body").style.background = pane.termBg;
    } else {
      pane.term.options.theme = t.term;
      pane.el.querySelector(".pane-body").style.background = "";
    }
  }
  if (!silent) showToast(`Theme: ${t.name}`);
  window.shellfire.saveConfig({ theme: idx, fontSize: currentFontSize, themeName: t.name });
  settings.theme = idx;
  settings.themeName = t.name;
}

function cycleTheme() { applyTheme((currentThemeIdx + 1) % themes.length); }

