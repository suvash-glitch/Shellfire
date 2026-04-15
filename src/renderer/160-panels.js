// SYSTEM MONITOR
// ============================================================
async function updateSystemStats() {
  try {
    const stats = await window.shellfire.systemStats();
    if (!stats) return;
    document.getElementById("cpu-pct").textContent = stats.cpuUsage;
    document.getElementById("cpu-bar").style.width = stats.cpuUsage + "%";
    document.getElementById("mem-pct").textContent = stats.memUsage;
    document.getElementById("mem-bar").style.width = stats.memUsage + "%";
    // Color code high usage
    document.getElementById("cpu-bar").style.background = stats.cpuUsage > 80 ? "#ff453a" : "#5ac8fa";
    document.getElementById("mem-bar").style.background = stats.memUsage > 80 ? "#ff453a" : "#ff9f0a";
  } catch {}
}
// System stats at 10s (less frequent — CPU/mem don't need 3s polling)
setInterval(updateSystemStats, 10000);
updateSystemStats();

// ============================================================
// TERMINAL LOGGING
// ============================================================
const loggingPanes = new Set(); // pane IDs with logging enabled

function toggleLogging(id) {
  const targetId = id || activeId;
  if (!targetId) return;
  if (loggingPanes.has(targetId)) {
    loggingPanes.delete(targetId);
    showToast("Logging OFF for this pane");
  } else {
    loggingPanes.add(targetId);
    showToast("Logging ON — output saved to log file");
  }
}

// ============================================================
// FLOATING PANE (PiP)
// ============================================================
let floatingPanes = new Set();

function toggleFloating(id) {
  const targetId = id || activeId;
  if (!targetId) return;
  const pane = panes.get(targetId);
  if (!pane) return;

  if (floatingPanes.has(targetId)) {
    // Restore
    pane.el.classList.remove("floating");
    pane.el.style.width = "";
    pane.el.style.height = "";
    pane.el.style.left = "";
    pane.el.style.top = "";
    floatingPanes.delete(targetId);
    renderLayout();
    showToast("Pane restored");
  } else {
    // Float
    floatingPanes.add(targetId);
    pane.el.classList.add("floating");
    pane.el.style.width = "500px";
    pane.el.style.height = "350px";
    pane.el.style.right = "20px";
    pane.el.style.bottom = "50px";
    pane.el.style.left = "auto";
    pane.el.style.top = "auto";
    document.body.appendChild(pane.el);
    // Make header draggable
    makeDraggable(pane.el, pane.el.querySelector(".pane-header"));
    pane.fitAddon.fit();
    showToast("Pane floated — drag header to move");
  }
}

function makeDraggable(el, handle) {
  // Track active listeners to prevent accumulation
  if (handle._dragSetup) return;
  handle._dragSetup = true;
  let activeMoveHandler = null, activeUpHandler = null;
  handle.addEventListener("mousedown", (e) => {
    if (e.target.closest("button") || e.target.closest(".pane-badge")) return;
    if (!el.classList.contains("floating")) return;
    e.preventDefault();
    // Clean up any stale listeners from a prior drag (e.g., mouseup lost during blur)
    if (activeMoveHandler) { document.removeEventListener("mousemove", activeMoveHandler); activeMoveHandler = null; }
    if (activeUpHandler) { document.removeEventListener("mouseup", activeUpHandler); activeUpHandler = null; }
    const startX = e.clientX, startY = e.clientY;
    const rect = el.getBoundingClientRect();
    const startLeft = rect.left, startTop = rect.top;
    activeMoveHandler = (ev) => {
      el.style.left = (startLeft + ev.clientX - startX) + "px";
      el.style.top = (startTop + ev.clientY - startY) + "px";
      el.style.right = "auto"; el.style.bottom = "auto";
    };
    activeUpHandler = () => {
      document.removeEventListener("mousemove", activeMoveHandler);
      document.removeEventListener("mouseup", activeUpHandler);
      activeMoveHandler = null; activeUpHandler = null;
    };
    document.addEventListener("mousemove", activeMoveHandler);
    document.addEventListener("mouseup", activeUpHandler);
  });
}

// ============================================================
// NOTES / SCRATCHPAD
// ============================================================
let notesData = { text: "" };
const notesPanel = document.getElementById("notes-panel");
const notesText = document.getElementById("notes-text");
let notesSaveTimer = null;

async function loadNotes() {
  try { const saved = await window.shellfire.loadNotes(); if (saved) { notesData = saved; notesText.value = saved.text || ""; } } catch {}
}

function openNotes() {
  notesPanel.classList.add("visible");
  notesText.focus();
}
function closeNotes() {
  notesPanel.classList.remove("visible");
  if (activeId && panes.has(activeId)) panes.get(activeId).term.focus();
}

document.getElementById("notes-close").addEventListener("click", closeNotes);
notesText.addEventListener("input", () => {
  notesData.text = notesText.value;
  clearTimeout(notesSaveTimer);
  notesSaveTimer = setTimeout(() => window.shellfire.saveNotes(notesData), 500);
});
notesText.addEventListener("keydown", (e) => { if (e.key === "Escape") closeNotes(); });

// ============================================================
// LINK PANES
// ============================================================
let linkedGroups = []; // arrays of pane IDs

function linkPanes() {
  if (panes.size < 2) { showToast("Need at least 2 panes to link"); return; }
  if (_paletteCleanup) { _paletteCleanup(); _paletteCleanup = null; }
  const overlay = document.getElementById("palette-overlay");
  const input = document.getElementById("palette-input");
  const results = document.getElementById("palette-results");
  overlay.classList.add("visible");
  input.placeholder = "Select panes to link (type pane numbers, e.g. 1,3)";
  input.value = ""; input.focus();

  const ids = [...panes.keys()];
  results.innerHTML = "";
  ids.forEach((id, i) => {
    const p = panes.get(id);
    const el = document.createElement("div"); el.className = "palette-item";
    const name = p?.customName || p?.titleEl?.textContent || `Terminal ${id}`;
    const isLinked = linkedGroups.some(g => g.includes(id));
    el.innerHTML = `<span class="palette-item-label">${i + 1}. ${name}${isLinked ? ' (linked)' : ''}</span>`;
    results.appendChild(el);
  });
  // Show existing links
  if (linkedGroups.length > 0) {
    const header = document.createElement("div");
    header.style.cssText = "padding:6px 16px;font-size:10px;color:color-mix(in srgb, var(--t-fg) 40%, transparent);font-weight:600;border-top:1px solid var(--t-border)";
    header.textContent = "ACTIVE LINKS";
    results.appendChild(header);
    linkedGroups.forEach((group, gi) => {
      const el = document.createElement("div"); el.className = "palette-item";
      const names = group.map(gid => { const idx = ids.indexOf(gid); return idx >= 0 ? (idx + 1) : "?"; }).join(" ↔ ");
      el.innerHTML = `<span class="palette-item-label">Group: ${names}</span><span class="palette-item-shortcut" style="cursor:pointer;color:#ff453a">unlink</span>`;
      el.querySelector(".palette-item-shortcut").addEventListener("click", (ev) => {
        ev.stopPropagation();
        linkedGroups.splice(gi, 1);
        showToast("Panes unlinked");
        overlay.classList.remove("visible"); input.placeholder = "Type a command...";
      });
      results.appendChild(el);
    });
  }

  const handler = (e) => {
    if (e.key === "Escape") { overlay.classList.remove("visible"); input.placeholder = "Type a command..."; input.removeEventListener("keydown", handler); return; }
    if (e.key === "Enter") {
      e.preventDefault();
      const nums = input.value.split(",").map(s => parseInt(s.trim())).filter(n => !isNaN(n) && n >= 1 && n <= ids.length);
      if (nums.length >= 2) {
        const group = nums.map(n => ids[n - 1]);
        linkedGroups.push(group);
        showToast(`Linked panes: ${nums.join(", ")}`);
      } else {
        showToast("Enter at least 2 pane numbers separated by commas");
      }
      overlay.classList.remove("visible"); input.placeholder = "Type a command...";
      input.removeEventListener("keydown", handler);
    }
  };
  input.addEventListener("keydown", handler);
}

// ============================================================
// ENVIRONMENT VARIABLES VIEWER
// ============================================================
const envPanel = document.getElementById("env-panel");
const envBody = document.getElementById("env-body");
const envSearch = document.getElementById("env-search");

async function openEnvViewer() {
  envPanel.classList.add("visible");
  envBody.innerHTML = '<div style="padding:24px;text-align:center;color:color-mix(in srgb, var(--t-fg) 40%, transparent);font-size:12px">Loading...</div>';
  envSearch.value = "";
  try {
    const envVars = await window.shellfire.getTerminalEnv(activeId);
    renderEnvVars(envVars, "");
  } catch {
    envBody.innerHTML = '<div style="padding:24px;text-align:center;color:color-mix(in srgb, var(--t-fg) 40%, transparent);font-size:12px">Failed to load</div>';
  }
}

function renderEnvVars(envVars, filter) {
  const q = filter.toLowerCase();
  const filtered = q ? envVars.filter(e => e.key.toLowerCase().includes(q) || e.value.toLowerCase().includes(q)) : envVars;
  envBody.innerHTML = "";
  if (filtered.length === 0) {
    envBody.innerHTML = '<div style="padding:24px;text-align:center;color:color-mix(in srgb, var(--t-fg) 40%, transparent);font-size:12px">No matching variables</div>';
    return;
  }
  filtered.forEach(e => {
    const row = document.createElement("div"); row.className = "env-row";
    row.innerHTML = `<span class="env-key" title="${e.key}">${e.key}</span><span class="env-val" title="${e.value}">${e.value}</span>`;
    row.addEventListener("click", () => { navigator.clipboard.writeText(`${e.key}=${e.value}`); showToast(`Copied ${e.key}`); });
    envBody.appendChild(row);
  });
}

let envVarsCache = [];
envSearch.addEventListener("input", () => {
  // Re-render from cache
  renderEnvVars(envVarsCache, envSearch.value);
});

// Override openEnvViewer to cache
const _openEnvViewer = openEnvViewer;
openEnvViewer = async function() {
  envPanel.classList.add("visible");
  envBody.innerHTML = '<div style="padding:24px;text-align:center;color:color-mix(in srgb, var(--t-fg) 40%, transparent);font-size:12px">Loading...</div>';
  envSearch.value = ""; envSearch.focus();
  try {
    envVarsCache = await window.shellfire.getTerminalEnv(activeId);
    renderEnvVars(envVarsCache, "");
  } catch {
    envBody.innerHTML = '<div style="padding:24px;text-align:center;color:color-mix(in srgb, var(--t-fg) 40%, transparent);font-size:12px">Failed to load</div>';
  }
};

document.getElementById("env-close").addEventListener("click", () => { envPanel.classList.remove("visible"); if (activeId && panes.has(activeId)) panes.get(activeId).term.focus(); });

// ============================================================
// DOCKER PANEL
// ============================================================
const dockerPanel = document.getElementById("docker-panel");
const dockerBody = document.getElementById("docker-body");

async function openDockerPanel() {
  dockerPanel.classList.add("visible");
  await refreshDocker();
}

async function refreshDocker() {
  dockerBody.innerHTML = '<div style="padding:24px;text-align:center;color:color-mix(in srgb, var(--t-fg) 40%, transparent);font-size:12px">Loading...</div>';
  try {
    const containers = await window.shellfire.dockerPsAll();
    dockerBody.innerHTML = "";
    if (!containers || containers.length === 0) {
      dockerBody.innerHTML = '<div style="padding:24px;text-align:center;color:color-mix(in srgb, var(--t-fg) 40%, transparent);font-size:12px">No containers found (is Docker running?)</div>';
      return;
    }
    containers.forEach(c => {
      const row = document.createElement("div"); row.className = "docker-row";
      const isUp = c.status.toLowerCase().startsWith("up");
      row.innerHTML = `<div class="docker-name">${c.name}</div><div class="docker-image">${c.image}</div><div class="docker-status ${isUp ? 'up' : 'down'}">${c.status}</div>${c.ports ? `<div class="docker-ports">${c.ports}</div>` : ""}`;
      row.addEventListener("click", async () => {
        dockerPanel.classList.remove("visible");
        const id = await addTerminal();
        const cmd = isUp ? `docker exec -it ${c.name} sh` : `docker start -i ${c.name}`;
        setTimeout(() => window.shellfire.sendInput(id, cmd + "\n"), 200);
        showToast(`Attaching to ${c.name}...`);
      });
      dockerBody.appendChild(row);
    });
  } catch {
    dockerBody.innerHTML = '<div style="padding:24px;text-align:center;color:color-mix(in srgb, var(--t-fg) 40%, transparent);font-size:12px">Docker not available</div>';
    showToast("Docker is not running or not installed", "error");
  }
}

document.getElementById("docker-close").addEventListener("click", () => { dockerPanel.classList.remove("visible"); if (activeId && panes.has(activeId)) panes.get(activeId).term.focus(); });
document.getElementById("docker-refresh").addEventListener("click", refreshDocker);

// ============================================================
// PORT MANAGER PANEL
// ============================================================
const portPanel = document.getElementById("port-panel");
const portBody = document.getElementById("port-body");

async function openPortPanel() {
  portPanel.classList.add("visible");
  await refreshPorts();
}

async function refreshPorts() {
  portBody.innerHTML = '<div style="padding:24px;text-align:center;color:color-mix(in srgb, var(--t-fg) 40%, transparent);font-size:12px">Loading...</div>';
  try {
    const ports = await window.shellfire.listPorts();
    portBody.innerHTML = "";
    if (!ports || ports.length === 0) {
      portBody.innerHTML = '<div style="padding:24px;text-align:center;color:color-mix(in srgb, var(--t-fg) 40%, transparent);font-size:12px">No listening ports found</div>';
      return;
    }
    ports.sort((a, b) => parseInt(a.port) - parseInt(b.port));
    ports.forEach(p => {
      const row = document.createElement("div"); row.className = "port-row";
      row.innerHTML = `<div class="port-info"><div class="port-number">:${p.port}</div><div class="port-process">${p.process} <span class="port-pid">PID ${p.pid}</span></div></div><div class="port-actions"><button class="port-open" title="Open in browser">Open</button><button class="port-kill" title="Kill process">Kill</button></div>`;
      row.querySelector(".port-open").addEventListener("click", (e) => {
        e.stopPropagation();
        const url = `http://localhost:${p.port}`;
        window.open(url, "_blank");
      });
      row.querySelector(".port-kill").addEventListener("click", async (e) => {
        e.stopPropagation();
        const ok = await window.shellfire.killPort(p.pid);
        if (ok) { showToast(`Killed PID ${p.pid}`); await refreshPorts(); }
        else showToast("Failed to kill process");
      });
      portBody.appendChild(row);
    });
  } catch {
    portBody.innerHTML = '<div style="padding:24px;text-align:center;color:color-mix(in srgb, var(--t-fg) 40%, transparent);font-size:12px">Failed to list ports</div>';
  }
}

document.getElementById("port-close").addEventListener("click", () => { portPanel.classList.remove("visible"); if (activeId && panes.has(activeId)) panes.get(activeId).term.focus(); });
document.getElementById("port-refresh").addEventListener("click", refreshPorts);

// ============================================================
// CROSS-PANE COMMAND HISTORY SEARCH (Ctrl+R)
// ============================================================
const commandHistory = []; // { cmd, paneId, timestamp }
const historyOverlay = document.getElementById("history-overlay");
const historyInput = document.getElementById("history-input");
const historyResults = document.getElementById("history-results");
let historySelectedIdx = 0;
let historyFiltered = [];

function trackCommandInput(paneId, data) {
  if (!paneLineBufs.has(paneId)) paneLineBufs.set(paneId, "");
  for (const ch of data) {
    if (ch === "\r" || ch === "\n") {
      const cmd = paneLineBufs.get(paneId).trim();
      if (cmd && cmd.length > 1) {
        if (commandHistory.length === 0 || commandHistory[commandHistory.length - 1].cmd !== cmd) {
          commandHistory.push({ cmd, paneId, timestamp: Date.now() });
          if (commandHistory.length > 2000) commandHistory.shift();
        }
      }
      paneLineBufs.set(paneId, "");
    } else if (ch === "\x7f" || ch === "\b") {
      const buf = paneLineBufs.get(paneId);
      paneLineBufs.set(paneId, buf.slice(0, -1));
    } else if (ch.charCodeAt(0) >= 32) {
      paneLineBufs.set(paneId, paneLineBufs.get(paneId) + ch);
    }
  }
}

function openHistorySearch() {
  historyOverlay.style.display = "flex";
  historyInput.value = "";
  historySelectedIdx = 0;
  renderHistoryResults("");
  historyInput.focus();
}

function closeHistorySearch() {
  historyOverlay.style.display = "none";
  if (activeId && panes.has(activeId)) panes.get(activeId).term.focus();
}

function renderHistoryResults(query) {
  const q = query.toLowerCase();
  const reversed = [...commandHistory].reverse();
  if (q) {
    const seen = new Set();
    historyFiltered = reversed.filter(h => {
      if (seen.has(h.cmd)) return false;
      const match = h.cmd.toLowerCase().includes(q);
      if (match) seen.add(h.cmd);
      return match;
    }).slice(0, 50);
  } else {
    const seen = new Set();
    historyFiltered = reversed.filter(h => {
      if (seen.has(h.cmd)) return false;
      seen.add(h.cmd);
      return true;
    }).slice(0, 50);
  }
  historySelectedIdx = Math.max(0, Math.min(historySelectedIdx, historyFiltered.length - 1));
  historyResults.innerHTML = "";
  if (historyFiltered.length === 0) {
    historyResults.innerHTML = '<div style="padding:16px;text-align:center;color:color-mix(in srgb, var(--t-fg) 40%, transparent);font-size:12px">No matching commands</div>';
    return;
  }
  historyFiltered.forEach((h, i) => {
    const el = document.createElement("div");
    el.className = "history-item" + (i === historySelectedIdx ? " selected" : "");
    let display = escHtml(h.cmd);
    if (q) {
      const escaped = escHtml(h.cmd);
      const idx = h.cmd.toLowerCase().indexOf(q);
      if (idx >= 0) {
        const before = escHtml(h.cmd.slice(0, idx));
        const match = escHtml(h.cmd.slice(idx, idx + q.length));
        const after = escHtml(h.cmd.slice(idx + q.length));
        display = before + '<span class="history-match">' + match + '</span>' + after;
      }
    }
    el.innerHTML = display + `<span class="history-pane">T${h.paneId}</span>`;
    el.addEventListener("click", () => { selectHistoryItem(i); });
    historyResults.appendChild(el);
  });
  const selEl = historyResults.querySelector(".selected");
  if (selEl) selEl.scrollIntoView({ block: "nearest" });
}

function selectHistoryItem(idx) {
  if (historyFiltered[idx] && activeId && panes.has(activeId)) {
    window.shellfire.sendInput(activeId, historyFiltered[idx].cmd);
    closeHistorySearch();
  }
}

historyInput.addEventListener("input", () => {
  historySelectedIdx = 0;
  renderHistoryResults(historyInput.value);
});

historyInput.addEventListener("keydown", (e) => {
  if (e.key === "Escape") { e.preventDefault(); closeHistorySearch(); return; }
  if (e.key === "ArrowDown") { e.preventDefault(); historySelectedIdx = Math.min(historySelectedIdx + 1, historyFiltered.length - 1); renderHistoryResults(historyInput.value); return; }
  if (e.key === "ArrowUp") { e.preventDefault(); historySelectedIdx = Math.max(historySelectedIdx - 1, 0); renderHistoryResults(historyInput.value); return; }
  if (e.key === "Enter") { e.preventDefault(); selectHistoryItem(historySelectedIdx); return; }
});

historyOverlay.addEventListener("click", (e) => { if (e.target === historyOverlay) closeHistorySearch(); });

// ============================================================
// AI ERROR DETECTION
// ============================================================
const errorPatterns = /(?:error:|Error:|ERROR|FAILED|failed|command not found|No such file|Permission denied|ENOENT|EACCES|TypeError|SyntaxError|segfault|panic|traceback|exception)/i;
const ERROR_DEBOUNCE_MS = 5000;
let aiSuggestions = true;

function detectErrors(paneId, data) {
  if (!aiSuggestions) return;
  const clean = data.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "");
  if (!errorPatterns.test(clean)) return;

  const now = Date.now();
  const last = paneErrorDebounce.get(paneId) || 0;
  if (now - last < ERROR_DEBOUNCE_MS) return;
  paneErrorDebounce.set(paneId, now);

  const pane = panes.get(paneId);
  if (!pane) return;

  const lines = clean.split("\n").filter(l => errorPatterns.test(l));
  const errorSnippet = (lines[0] || clean.slice(0, 200)).trim().slice(0, 120);

  const tab = document.querySelector(`.tab[data-id="${paneId}"] .error-dot`);
  if (tab) tab.classList.add("visible");

  const existing = pane.el.querySelector(".error-toast");
  if (existing) existing.remove();

  const toast = document.createElement("div");
  toast.className = "error-toast";
  toast.innerHTML = `<span class="error-toast-msg">${escHtml(errorSnippet)}</span>${_extHooks.errorDetected.length ? '<button class="error-toast-btn">Ask AI</button>' : ''}<button class="error-toast-btn no-suggest-btn">No Suggestions</button><button class="error-toast-close">x</button>`;
  toast.querySelector(".error-toast-close").addEventListener("click", () => toast.remove());
  const askBtn = toast.querySelector(".error-toast-btn:not(.no-suggest-btn)");
  if (askBtn) askBtn.addEventListener("click", () => {
    toast.remove();
    for (const fn of _extHooks.errorDetected) fn(paneId, errorSnippet);
  });
  toast.querySelector(".no-suggest-btn").addEventListener("click", () => {
    aiSuggestions = false;
    settings.aiSuggestions = false;
    window.shellfire.saveSettings(settings);
    toast.remove();
    showToast("AI suggestions disabled");
  });

  const body = pane.el.querySelector(".pane-body");
  if (body) body.style.position = "relative";
  (body || pane.el).appendChild(toast);

  setTimeout(() => { if (toast.parentNode) toast.remove(); }, 10000);
}

// ============================================================
// PANE STATS SPARKLINES
// ============================================================

function buildSparklineSVG(history, latestCpu) {
  const w = 40, h = 16;
  if (!history || history.length < 2) return "";
  const max = Math.max(...history, 1);
  const points = history.map((v, i) => {
    const x = (i / (history.length - 1)) * w;
    const y = h - (v / max) * h;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");

  let color = "#30d158";
  if (latestCpu > 50) color = "#ff453a";
  else if (latestCpu > 20) color = "#ff9f0a";

  return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><polyline points="${points}" fill="none" stroke="${color}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}

async function refreshPaneStats() {
  for (const [id] of panes) {
    try {
      const stats = await window.shellfire.getPaneStats(id);
      if (stats && stats.cpu !== undefined) {
        if (!paneStatsHistory.has(id)) {
          paneStatsHistory.set(id, { cpuHistory: [], lastMemory: 0, lastCpu: 0 });
        }
        const h = paneStatsHistory.get(id);
        h.cpuHistory.push(stats.cpu);
        if (h.cpuHistory.length > 20) h.cpuHistory.shift();
        h.lastCpu = stats.cpu;
        h.lastMemory = stats.memory;
      }
    } catch {}
  }
}

// Stagger pane stats refresh to avoid thundering herd
setTimeout(() => setInterval(refreshPaneStats, 5000), 3500);


// ============================================================
