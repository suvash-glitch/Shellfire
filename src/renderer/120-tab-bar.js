/**
 * @module renderer/120-tab-bar
 * @description Pane number badges and the draggable tab bar (updatePaneNumbers, updateTabBar). Tracks tab drag state for reorder.
 */

// ============================================================
// PANE NUMBERS & TAB BAR
// ============================================================
function updatePaneNumbers() {
  const ids = [...panes.keys()];
  ids.forEach((id, i) => {
    const pane = panes.get(id);
    if (pane && pane.paneNumberEl) pane.paneNumberEl.textContent = i < 9 ? `${i + 1}` : "";
  });
  updateTabBar();
}

/**
 * Builds tab bar HTML for one pane and returns the new content string.
 * Extracted so updateTabBar can diff and only patch changed tabs.
 */
function buildTabContent(p, id, index) {
  const name = p?.customName || p?.titleEl?.textContent || `Terminal ${id}`;
  const shortName = name.length > 24 ? "..." + name.slice(-21) : name;
  let dotClass = "";
  if (p?.color) dotClass = `color-${p.color}`;
  else if (id !== activeId && p?.activityDot?.classList.contains("visible")) dotClass = "activity";

  const proc = p?._lastProcess;
  const procHtml = proc && proc !== "zsh" && proc !== "bash" && proc !== "fish"
    ? `<span class="tab-process">${escHtml(proc)}</span>` : "";

  const branch = p?._lastGitBranch;
  const gitHtml = branch
    ? `<span class="tab-git${p._lastGitDirty ? " dirty" : ""}">${escHtml(branch)}</span>` : "";

  let durationHtml = "";
  if (p?._commandStart && proc && proc !== "zsh" && proc !== "bash" && proc !== "fish") {
    const elapsed = Math.round((Date.now() - p._commandStart) / 1000);
    if (elapsed >= 5) {
      const fmt = elapsed >= 3600
        ? `${Math.floor(elapsed/3600)}h${Math.floor((elapsed%3600)/60)}m`
        : elapsed >= 60 ? `${Math.floor(elapsed/60)}m${elapsed%60}s` : `${elapsed}s`;
      durationHtml = `<span class="tab-duration${elapsed >= 60 ? " long" : ""}">${fmt}</span>`;
    }
  }

  return `<span class="tab-num">${index < 9 ? index + 1 : ""}</span>` +
    `<span class="tab-dot ${dotClass}"></span>` +
    escHtml(shortName) + procHtml + gitHtml + durationHtml +
    `<button class="tab-close">&times;</button>`;
}

/** Creates a fully wired tab element for the given pane. */
function createTabEl(p, id, index) {
  const tab = document.createElement("button");
  tab.className = "tab" + (id === activeId ? " active" : "");
  tab.dataset.paneId = id;
  tab.innerHTML = buildTabContent(p, id, index);
  tab.addEventListener("click", (e) => { if (!e.target.classList.contains("tab-close")) setActive(id); });
  tab.querySelector(".tab-close").addEventListener("click", (e) => { e.stopPropagation(); removeTerminal(id); });
  tab.addEventListener("dblclick", (e) => { e.preventDefault(); renamePaneUI(id); });
  tab.addEventListener("contextmenu", (e) => { e.preventDefault(); showContextMenu(e.clientX, e.clientY, id); });
  return tab;
}

/**
 * Updates the tab bar incrementally:
 *   - Adds tabs for panes that have no tab yet
 *   - Removes tabs for panes that no longer exist
 *   - Updates inner HTML for tabs whose content has changed
 *   - Leaves unchanged tabs untouched (no listener re-attachment)
 */
function updateTabBar() {
  const tabbar = document.getElementById("tabbar");
  const ids = [...panes.keys()];

  // Remove tabs for closed panes
  tabbar.querySelectorAll(".tab[data-pane-id]").forEach(tab => {
    if (!panes.has(Number(tab.dataset.paneId))) tab.remove();
  });

  // Rebuild the ordered list of tabs matching current pane order
  ids.forEach((id, i) => {
    const p = panes.get(id);
    let tab = tabbar.querySelector(`.tab[data-pane-id="${id}"]`);
    if (!tab) {
      tab = createTabEl(p, id, i);
      tabbar.appendChild(tab);
    } else {
      // Update class (active state may have changed)
      tab.className = "tab" + (id === activeId ? " active" : "");
      // Patch inner content only when it differs to avoid unnecessary reflow
      const newHtml = buildTabContent(p, id, i);
      if (tab.innerHTML !== newHtml) tab.innerHTML = newHtml;
    }
    // Ensure correct DOM order by appending (moves if already present)
    tabbar.appendChild(tab);
  });
}

// Enrich tab data periodically (process, git, duration).
// Strategy:
//   - Process + cwd: fetched every cycle (cheap lsof/ps calls)
//   - Git branch/status: only re-fetched when cwd actually changed
//   - Panes batched in groups of 5 to cap concurrent IPC calls
//   - Base interval 10 s, scaled up by +1 s per pane beyond 5, max 20 s
async function enrichTabData() {
  const ids = [...panes.keys()];
  for (let i = 0; i < ids.length; i += 5) {
    await Promise.all(ids.slice(i, i + 5).map(async (id) => {
      const pane = panes.get(id);
      if (!pane) return;
      try {
        const [proc, cwd] = await Promise.all([
          window.shellfire.getProcess(id),
          window.shellfire.getCwd(id),
        ]);

        // Re-check pane after async IPC — it may have been closed
        if (!panes.get(id)) return;

        const oldProc = pane._lastProcess;
        pane._lastProcess = proc || null;

        // Track command start time for duration badges
        if (proc && proc !== "zsh" && proc !== "bash" && proc !== "fish") {
          if (!pane._commandStart || oldProc !== proc) pane._commandStart = Date.now();
        } else {
          pane._commandStart = null;
        }

        // Git info — only re-fetch when cwd changed (git spawns a subprocess each call)
        const cwdChanged = cwd !== pane._lastCwd;
        pane._lastCwd = cwd || null;
        if (cwd && cwdChanged) {
          const [branch, status] = await Promise.all([
            window.shellfire.getGitBranch(cwd),
            window.shellfire.getGitStatus(cwd),
          ]);
          if (!panes.get(id)) return;
          pane._lastGitBranch = branch || null;
          pane._lastGitDirty = status === "dirty";
        } else if (!cwd) {
          pane._lastGitBranch = null;
          pane._lastGitDirty = false;
        }
        // If cwd is unchanged, keep existing git info — no re-fetch needed
      } catch {
        // IPC failure (pane closing, process exiting) — clear stale data silently
        pane._lastProcess = null;
        pane._lastGitBranch = null;
      }
    }));
  }
  updateTabBar();
}

// Adaptive interval: 10 s base + 1 s per pane beyond 5, capped at 20 s
let enrichTimer = null;
function scheduleEnrichTabData() {
  if (enrichTimer) clearInterval(enrichTimer);
  const interval = Math.min(10000 + Math.max(0, panes.size - 5) * 1000, 20000);
  enrichTimer = setInterval(enrichTabData, interval);
}
// Initial enrich after 3 s so startup IPC calls complete first
setTimeout(() => { scheduleEnrichTabData(); enrichTabData(); }, 3000);

function updateWelcomeScreen() {
  const welcome = document.getElementById("welcome");
  const editorArea = document.getElementById("ide-editor-area");
  if (panes.size === 0) {
    welcome.classList.add("visible");
    if (editorArea) editorArea.style.display = "none";
    populateWelcomeProjects();
  } else {
    welcome.classList.remove("visible");
    if (editorArea) editorArea.style.display = "";
  }
}

function populateWelcomeProjects() {
  const container = document.getElementById("welcome-projects");
  const emptyEl = document.getElementById("welcome-empty");
  if (!container) return;
  container.innerHTML = "";

  // Get projects from launchProjects
  const projects = (typeof launchProjects !== "undefined" ? launchProjects : []) || [];
  if (projects.length === 0) {
    if (emptyEl) emptyEl.style.display = "";
    return;
  }
  if (emptyEl) emptyEl.style.display = "none";

  projects.forEach(proj => {
    const card = document.createElement("div");
    card.className = "welcome-project-card";
    const shortPath = (proj.path || "").replace(/^\/Users\/[^/]+/, "~").replace(/^\/home\/[^/]+/, "~");
    card.innerHTML = `
      <div class="welcome-project-icon">
        <svg viewBox="0 0 24 24"><path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/></svg>
      </div>
      <div class="welcome-project-info">
        <div class="welcome-project-name">${proj.name || shortPath}</div>
        <div class="welcome-project-path">${shortPath}</div>
      </div>
    `;
    card.addEventListener("click", () => addTerminal(proj.path));
    container.appendChild(card);
  });
}

// Post-hooks for layout and active changes (avoids fragile monkey-patching chain)
const _layoutHooks = [updatePaneNumbers, updateWelcomeScreen];
const _setActiveHooks = [
  (id) => { updateTabBar(); trackRecentDir(id); },
  (id) => {
    const pane = panes.get(id);
    if (pane && pane.activityDot) pane.activityDot.classList.remove("visible");
    if (pane) { const wb = pane.el.querySelector(".watcher-badge"); if (wb) wb.classList.remove("visible"); }
  },
];
const _baseRenderLayout = renderLayout;
renderLayout = function() { _baseRenderLayout(); for (const fn of _layoutHooks) fn(); };
const _baseSetActive = setActive;
setActive = function(id) { _baseSetActive(id); for (const fn of _setActiveHooks) fn(id); };

