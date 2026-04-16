/**
 * @module renderer/185-url-command-tab
 * @description URL hover tooltips, command duration timer, smart tab name heuristics (maps process + CWD to a readable label), directory bookmarks, watch mode (re-runs a command when files change), cross-pane search, and file preview sidebar.
 */

// ============================================================
// URL PREVIEW (hover tooltip for URLs in terminal)
// ============================================================
// The web-links addon already makes URLs clickable. We enhance it with a tooltip.
// This is handled per-pane in createPaneObj via xterm's onRender.

// ============================================================
// COMMAND DURATION TIMER
// ============================================================
// Track when a command starts running in each pane
const paneCommandStart = new Map(); // id -> timestamp when non-shell process started
const LONG_CMD_THRESHOLD = 15000; // 15 seconds

async function updateCommandDurations() {
  for (const [id] of panes) {
    try {
      const proc = await window.shellfire.getProcess(id);
      const isShell = !proc || proc === "zsh" || proc === "bash" || proc === "fish";
      if (!isShell) {
        if (!paneCommandStart.has(id)) paneCommandStart.set(id, Date.now());
      } else {
        // Command finished — check if it was long-running
        if (paneCommandStart.has(id)) {
          const duration = Date.now() - paneCommandStart.get(id);
          if (duration > LONG_CMD_THRESHOLD && id !== activeId) {
            const pane = panes.get(id);
            const name = pane?.customName || `Terminal ${id}`;
            window.shellfire.notify("Command Finished", `${name}: completed after ${formatDuration(duration)}`);
            showToast(`${name} finished (${formatDuration(duration)})`);
          }
          paneCommandStart.delete(id);
        }
      }
    } catch {}
  }
}

function formatDuration(ms) {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  if (m < 60) return `${m}m${rem}s`;
  return `${Math.floor(m / 60)}h${m % 60}m`;
}

function getCommandDuration(id) {
  if (!paneCommandStart.has(id)) return null;
  return Date.now() - paneCommandStart.get(id);
}

// Update durations every 5 seconds (aligned with other polling)
setInterval(updateCommandDurations, 5000);

// ============================================================
// SMART TAB NAMES
// ============================================================
async function getSmartName(id) {
  const pane = panes.get(id);
  if (!pane) return `Terminal ${id}`;
  if (pane.customName) return pane.customName;

  try {
    const [tree, cwd] = await Promise.all([
      window.shellfire.getProcessTree(id),
      window.shellfire.getCwd(id),
    ]);

    let name = "";
    const shortCwd = cwd ? cwd.replace(/^\/Users\/[^/]+/, "~") : "";

    if (tree && tree.comm) {
      const proc = tree.comm.split("/").pop();
      if (proc === "claude" || proc === "claude-code") {
        name = `claude ${shortCwd.split("/").pop() || shortCwd}`;
      } else if (proc === "node") {
        // Try to extract script name from args
        const scriptMatch = tree.args?.match(/node\s+(?:.*\/)?([^\s/]+\.js)/);
        name = scriptMatch ? `node:${scriptMatch[1]}` : `node ${shortCwd.split("/").pop()}`;
      } else if (proc === "npm" || proc === "npx") {
        const cmdMatch = tree.args?.match(/npm\s+(?:run\s+)?(\S+)/);
        name = cmdMatch ? `npm:${cmdMatch[1]}` : proc;
      } else if (proc === "python3" || proc === "python") {
        const scriptMatch = tree.args?.match(/python3?\s+(?:.*\/)?([^\s/]+\.py)/);
        name = scriptMatch ? `py:${scriptMatch[1]}` : `python ${shortCwd.split("/").pop()}`;
      } else if (proc === "ssh") {
        const hostMatch = tree.args?.match(/ssh\s+(?:-\S+\s+)*(\S+)/);
        name = hostMatch ? `ssh:${hostMatch[1]}` : "ssh";
      } else if (proc === "docker") {
        name = `docker ${tree.args?.split(" ").slice(1, 3).join(" ") || ""}`.trim();
      } else if (proc === "git") {
        name = `git ${tree.args?.split(" ")[1] || ""}`.trim();
      } else if (proc === "vim" || proc === "nvim" || proc === "nano") {
        const file = tree.args?.split(" ").pop()?.split("/").pop();
        name = `${proc}:${file || ""}`;
      } else if (proc !== "zsh" && proc !== "bash" && proc !== "fish") {
        name = proc;
      }
    }

    if (!name && shortCwd) {
      name = shortCwd;
    }

    return name || `Terminal ${id}`;
  } catch {
    return `Terminal ${id}`;
  }
}

// ============================================================
// DIRECTORY BOOKMARKS
// ============================================================
let dirBookmarks = []; // string paths

async function loadBookmarks() {
  try { const saved = await window.shellfire.loadBookmarks(); if (Array.isArray(saved)) dirBookmarks = saved; } catch {}
}

async function toggleBookmark() {
  if (!activeId) return;
  const cwd = await window.shellfire.getCwd(activeId);
  if (!cwd) return;
  const idx = dirBookmarks.indexOf(cwd);
  if (idx >= 0) {
    dirBookmarks.splice(idx, 1);
    showToast("Bookmark removed");
  } else {
    dirBookmarks.push(cwd);
    showToast("Directory bookmarked");
  }
  window.shellfire.saveBookmarks(dirBookmarks);
}

function openBookmarks() {
  if (_paletteCleanup) { _paletteCleanup(); _paletteCleanup = null; }
  const overlay = document.getElementById("palette-overlay");
  const input = document.getElementById("palette-input");
  const results = document.getElementById("palette-results");
  overlay.classList.add("visible");
  input.placeholder = "Select a bookmarked directory...";
  input.value = ""; input.focus();
  let selected = 0;

  function render(q) {
    const qq = q.toLowerCase();
    const filtered = qq ? dirBookmarks.filter(d => d.toLowerCase().includes(qq)) : dirBookmarks;
    selected = Math.min(selected, Math.max(0, filtered.length - 1));
    results.innerHTML = "";
    if (filtered.length === 0) {
      results.innerHTML = `<div class="palette-item"><span class="palette-item-label" style="color:color-mix(in srgb, var(--t-fg) 50%, transparent)">${dirBookmarks.length === 0 ? "No bookmarks. Use 'Bookmark Directory' to add one." : "No matches"}</span></div>`;
      return;
    }
    filtered.forEach((dir, i) => {
      const el = document.createElement("div"); el.className = "palette-item" + (i === selected ? " selected" : "");
      const short = dir.replace(/^\/Users\/[^/]+/, "~");
      el.innerHTML = `<span class="palette-item-label">${short}</span><span class="palette-item-shortcut" style="cursor:pointer;color:#ff453a" data-del="${i}">&#x2716;</span>`;
      el.addEventListener("click", async () => {
        overlay.classList.remove("visible"); input.placeholder = "Type a command...";
        await addTerminal(dir);
      });
      el.querySelector("[data-del]").addEventListener("click", (ev) => {
        ev.stopPropagation();
        dirBookmarks.splice(dirBookmarks.indexOf(dir), 1);
        window.shellfire.saveBookmarks(dirBookmarks);
        render(input.value);
        showToast("Bookmark removed");
      });
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
// WATCH MODE
// ============================================================
const watchTimers = new Map(); // paneId -> { interval, command, timer }

function openWatchMode() {
  if (_paletteCleanup) { _paletteCleanup(); _paletteCleanup = null; }
  const overlay = document.getElementById("palette-overlay");
  const input = document.getElementById("palette-input");
  const results = document.getElementById("palette-results");
  overlay.classList.add("visible");
  input.placeholder = "Enter: interval(s) command (e.g. '5 git status')";
  input.value = ""; input.focus();

  // Show current watches and suggestions
  results.innerHTML = "";
  if (watchTimers.size > 0) {
    const header = document.createElement("div");
    header.style.cssText = "padding:6px 16px;font-size:10px;color:color-mix(in srgb, var(--t-fg) 40%, transparent);font-weight:600;letter-spacing:0.5px;text-transform:uppercase;";
    header.textContent = "ACTIVE WATCHES";
    results.appendChild(header);
    for (const [wid, w] of watchTimers) {
      const el = document.createElement("div"); el.className = "palette-item";
      const pName = panes.get(wid)?.customName || `Pane ${[...panes.keys()].indexOf(wid) + 1}`;
      el.innerHTML = `<span class="palette-item-label">${pName}: ${w.command} (every ${w.interval}s)</span><span class="palette-item-shortcut" style="cursor:pointer;color:#ff453a">stop</span>`;
      el.querySelector(".palette-item-shortcut").addEventListener("click", (ev) => {
        ev.stopPropagation();
        stopWatch(wid);
        el.remove();
      });
      results.appendChild(el);
    }
  }
  const suggestions = [
    { label: "5 git status", desc: "Git status every 5s" },
    { label: "10 docker ps", desc: "Docker containers every 10s" },
    { label: "3 date", desc: "Current time every 3s" },
    { label: "30 df -h", desc: "Disk usage every 30s" },
  ];
  const sugHeader = document.createElement("div");
  sugHeader.style.cssText = "padding:6px 16px;font-size:10px;color:color-mix(in srgb, var(--t-fg) 40%, transparent);font-weight:600;letter-spacing:0.5px;text-transform:uppercase;border-top:1px solid var(--t-border);";
  sugHeader.textContent = "SUGGESTIONS";
  results.appendChild(sugHeader);
  suggestions.forEach(s => {
    const el = document.createElement("div"); el.className = "palette-item";
    el.innerHTML = `<span class="palette-item-label">${s.desc}<span class="palette-item-sub">${s.label}</span></span>`;
    el.addEventListener("click", () => {
      overlay.classList.remove("visible"); input.placeholder = "Type a command...";
      startWatch(s.label);
    });
    results.appendChild(el);
  });

  const handler = (e) => {
    if (e.key === "Escape") { overlay.classList.remove("visible"); input.placeholder = "Type a command..."; input.removeEventListener("keydown", handler); return; }
    if (e.key === "Enter") {
      e.preventDefault();
      const val = input.value.trim();
      if (val) startWatch(val);
      overlay.classList.remove("visible"); input.placeholder = "Type a command...";
      input.removeEventListener("keydown", handler);
    }
  };
  input.addEventListener("keydown", handler);
  _paletteCleanup = () => { input.removeEventListener("keydown", handler); };
}

async function startWatch(spec) {
  const match = spec.match(/^(\d+)\s+(.+)$/);
  if (!match) { showToast("Format: interval(seconds) command"); return; }
  const interval = parseInt(match[1]);
  const command = match[2];
  if (interval < 1) { showToast("Interval must be >= 1 second"); return; }

  // Create a new split pane for the watch
  let cwd = null;
  if (activeId) { try { cwd = await window.shellfire.getCwd(activeId); } catch {} }
  await splitPane("horizontal");
  const watchId = activeId;
  const pane = panes.get(watchId);
  if (pane) {
    pane.customName = `watch: ${command}`;
    pane.titleEl.textContent = pane.customName;
    // Add watch indicator
    const indicator = pane.el.querySelector(".watch-indicator") || (() => {
      const el = document.createElement("span");
      el.className = "watch-indicator visible";
      el.textContent = `${interval}s`;
      pane.el.querySelector(".pane-header").appendChild(el);
      return el;
    })();
    indicator.classList.add("visible");
  }

  // Send initial command
  window.shellfire.sendInput(watchId, command + "\n");

  // Set up interval
  const timer = setInterval(() => {
    if (!panes.has(watchId)) { clearInterval(timer); watchTimers.delete(watchId); return; }
    window.shellfire.sendInput(watchId, `clear && ${command}\n`);
  }, interval * 1000);

  watchTimers.set(watchId, { interval, command, timer });
  showToast(`Watching: ${command} every ${interval}s`);
}

function stopWatch(id) {
  const w = watchTimers.get(id);
  if (w) {
    clearInterval(w.timer);
    watchTimers.delete(id);
    const pane = panes.get(id);
    if (pane) {
      const indicator = pane.el.querySelector(".watch-indicator");
      if (indicator) indicator.classList.remove("visible");
      if (pane.customName?.startsWith("watch:")) {
        pane.customName = null;
        updatePaneTitle(id);
      }
    }
    showToast("Watch stopped");
  }
}

// ============================================================
// CROSS-PANE SEARCH
// ============================================================
function openCrossPaneSearch() {
  if (_paletteCleanup) { _paletteCleanup(); _paletteCleanup = null; }
  const overlay = document.getElementById("palette-overlay");
  const input = document.getElementById("palette-input");
  const results = document.getElementById("palette-results");
  overlay.classList.add("visible");
  input.placeholder = "Search across all terminal scrollbacks...";
  input.value = ""; input.focus();

  let searchTimeout = null;

  function doSearch(query) {
    if (!query || query.length < 2) {
      results.innerHTML = '<div class="palette-item"><span class="palette-item-label" style="color:color-mix(in srgb, var(--t-fg) 50%, transparent)">Type at least 2 characters...</span></div>';
      return;
    }
    results.innerHTML = "";
    const q = query.toLowerCase();
    const qRegex = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
    let totalMatches = 0;
    const ids = [...panes.keys()];

    ids.forEach((id, paneIdx) => {
      const pane = panes.get(id);
      if (!pane) return;
      const buf = pane.term.buffer.active;
      const matches = [];

      for (let i = Math.max(0, buf.length - 2000); i < buf.length; i++) {
        const line = buf.getLine(i);
        if (!line) continue;
        const text = line.translateToString(true);
        if (text.toLowerCase().includes(q)) {
          matches.push({ lineNum: i, text: text.trim() });
          if (matches.length >= 5) break; // Max 5 matches per pane
        }
      }

      if (matches.length > 0) {
        const name = pane.customName || pane.titleEl?.textContent || `Terminal ${id}`;
        matches.forEach(m => {
          const el = document.createElement("div"); el.className = "xsearch-result";
          const highlighted = m.text.replace(qRegex, match => `<span class="xsearch-match">${match}</span>`);
          el.innerHTML = `<div class="xsearch-pane">Pane ${paneIdx + 1}: ${name}</div><div class="xsearch-line">${highlighted}</div>`;
          el.addEventListener("click", () => {
            overlay.classList.remove("visible"); input.placeholder = "Type a command...";
            setActive(id);
            // Try to scroll to the match
            pane.term.scrollToLine(m.lineNum);
          });
          results.appendChild(el);
          totalMatches++;
        });
      }
    });

    if (totalMatches === 0) {
      results.innerHTML = '<div class="palette-item"><span class="palette-item-label" style="color:color-mix(in srgb, var(--t-fg) 50%, transparent)">No matches found across terminals</span></div>';
    }
  }

  const handler = (e) => {
    if (e.key === "Escape") { overlay.classList.remove("visible"); input.placeholder = "Type a command..."; input.removeEventListener("keydown", handler); input.removeEventListener("input", inputHandler); return; }
  };
  const inputHandler = () => {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => doSearch(input.value.trim()), 200);
  };
  input.addEventListener("keydown", handler);
  input.addEventListener("input", inputHandler);
  _paletteCleanup = () => { input.removeEventListener("keydown", handler); input.removeEventListener("input", inputHandler); };
}

// ============================================================
// FILE PREVIEW
// ============================================================
const filePreviewPanel = document.getElementById("file-preview-panel");
const filePreviewName = document.getElementById("file-preview-name");
const filePreviewMeta = document.getElementById("file-preview-meta");
const filePreviewContent = document.getElementById("file-preview-content");
let currentPreviewPath = null;

function openFilePreview() {
  if (_paletteCleanup) { _paletteCleanup(); _paletteCleanup = null; }
  const overlay = document.getElementById("palette-overlay");
  const input = document.getElementById("palette-input");
  const results = document.getElementById("palette-results");
  overlay.classList.add("visible");
  input.placeholder = "Enter file path to preview (absolute or relative to cwd)...";
  input.value = ""; input.focus();

  results.innerHTML = `<div class="palette-item"><span class="palette-item-label" style="color:color-mix(in srgb, var(--t-fg) 50%, transparent)">Type a file path and press Enter</span></div>
    <div class="palette-item" data-hint="package.json"><span class="palette-item-label">package.json</span></div>
    <div class="palette-item" data-hint=".env"><span class="palette-item-label">.env</span></div>
    <div class="palette-item" data-hint="README.md"><span class="palette-item-label">README.md</span></div>
    <div class="palette-item" data-hint=".gitignore"><span class="palette-item-label">.gitignore</span></div>`;
  results.querySelectorAll("[data-hint]").forEach(el => {
    el.addEventListener("click", async () => {
      overlay.classList.remove("visible"); input.placeholder = "Type a command...";
      const cwd = activeId ? await window.shellfire.getCwd(activeId) : null;
      const full = cwd ? cwd + "/" + el.dataset.hint : el.dataset.hint;
      showFilePreview(full);
    });
  });

  const handler = (e) => {
    if (e.key === "Escape") { overlay.classList.remove("visible"); input.placeholder = "Type a command..."; input.removeEventListener("keydown", handler); return; }
    if (e.key === "Enter") {
      e.preventDefault();
      const val = input.value.trim();
      if (val) {
        (async () => {
          let fullPath = val;
          if (!val.startsWith("/")) {
            const cwd = activeId ? await window.shellfire.getCwd(activeId) : null;
            fullPath = cwd ? cwd + "/" + val : val;
          }
          showFilePreview(fullPath);
        })();
      }
      overlay.classList.remove("visible"); input.placeholder = "Type a command...";
      input.removeEventListener("keydown", handler);
    }
  };
  input.addEventListener("keydown", handler);
}

async function showFilePreview(filePath) {
  currentPreviewPath = filePath;
  filePreviewPanel.classList.add("visible");
  filePreviewName.textContent = filePath.split("/").pop();
  filePreviewName.title = filePath;
  filePreviewMeta.textContent = "Loading...";
  filePreviewContent.innerHTML = "";

  try {
    const result = await window.shellfire.readFile(filePath);
    if (result.error) {
      filePreviewMeta.textContent = result.error;
      filePreviewContent.innerHTML = `<div style="padding:24px;text-align:center;color:color-mix(in srgb, var(--t-fg) 40%, transparent)">${result.error}</div>`;
      return;
    }

    const sizeStr = result.size < 1024 ? `${result.size} B` : result.size < 1048576 ? `${(result.size / 1024).toFixed(1)} KB` : `${(result.size / 1048576).toFixed(1)} MB`;
    const lines = result.content.split("\n");
    filePreviewMeta.textContent = `${sizeStr} — ${lines.length} lines${result.truncated ? " (truncated)" : ""}`;

    // Render with line numbers
    const frag = document.createDocumentFragment();
    lines.forEach((line, i) => {
      const row = document.createElement("div"); row.className = "file-preview-line";
      const num = document.createElement("span"); num.className = "file-preview-linenum"; num.textContent = i + 1;
      const text = document.createElement("span"); text.className = "file-preview-text"; text.textContent = line;
      row.appendChild(num); row.appendChild(text);
      frag.appendChild(row);
    });
    filePreviewContent.appendChild(frag);
  } catch (err) {
    filePreviewMeta.textContent = "Error";
    filePreviewContent.innerHTML = `<div style="padding:24px;text-align:center;color:color-mix(in srgb, var(--t-fg) 40%, transparent)">${err.message}</div>`;
  }
}

document.getElementById("file-preview-close").addEventListener("click", () => {
  filePreviewPanel.classList.remove("visible");
  if (activeId && panes.has(activeId)) panes.get(activeId).term.focus();
});
document.getElementById("file-preview-open").addEventListener("click", () => {
  if (currentPreviewPath) window.shellfire.openInEditor(currentPreviewPath);
});

// ============================================================
