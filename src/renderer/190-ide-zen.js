/**
 * @module renderer/190-ide-zen
 * @description IDE mode (sidebar file tree), zen mode (spans all monitors), enhanced tab bar with duration badges, and smart-name refresh scheduler.
 */

// ENHANCED TAB BAR WITH DURATION & SMART NAMES
// ============================================================
// Override updateTabBar to include durations and smarter names
const _origUpdateTabBar = updateTabBar;
updateTabBar = function() {
  const tabbar = document.getElementById("tabbar");
  const ids = [...panes.keys()];
  tabbar.innerHTML = "";
  ids.forEach((id, i) => {
    const p = panes.get(id);
    const tab = document.createElement("button");
    tab.className = "tab" + (id === activeId ? " active" : "");
    const name = p?.customName || p?.titleEl?.textContent || `Terminal ${id}`;
    const shortName = name.length > 24 ? "..." + name.slice(-21) : name;
    let dotClass = "";
    if (p?.color) dotClass = `color-${p.color}`;
    else if (id !== activeId && p?.activityDot?.classList.contains("visible")) dotClass = "activity";

    // Duration
    const dur = getCommandDuration(id);
    let durStr = "";
    if (dur) {
      durStr = formatDuration(dur);
    }
    const durClass = dur && dur > LONG_CMD_THRESHOLD ? "long" : "";

    tab.innerHTML = `<span class="tab-num">${i < 9 ? i + 1 : ""}</span><span class="tab-dot ${dotClass}"></span>${shortName}${durStr ? `<span class="tab-duration ${durClass}">${durStr}</span>` : ""}<button class="tab-close">&times;</button>`;
    tab.addEventListener("click", (e) => { if (!e.target.classList.contains("tab-close")) setActive(id); });
    tab.querySelector(".tab-close").addEventListener("click", (e) => { e.stopPropagation(); removeTerminal(id); });
    tab.addEventListener("dblclick", (e) => { e.preventDefault(); renamePaneUI(id); });
    tab.addEventListener("contextmenu", (e) => { e.preventDefault(); showContextMenu(e.clientX, e.clientY, id); });
    setupTabDrag(tab, id);
    tabbar.appendChild(tab);
  });
};

// Periodically refresh tab bar to update durations
setInterval(updateTabBar, 2000);

// Periodically update smart names
async function refreshSmartNames() {
  for (const [id] of panes) {
    const pane = panes.get(id);
    if (!pane) continue;
    const smart = await getSmartName(id);
    if (!smart) continue;
    // Re-check pane still exists after the async IPC call —
    // it may have been closed while we were awaiting.
    const paneNow = panes.get(id);
    if (!paneNow || paneNow._userRenamed) continue;
    paneNow.customName = smart;
    if (paneNow.titleEl) paneNow.titleEl.textContent = smart;
  }
}
// Scale interval with pane count: 4s base, +1s per pane above 5
let smartNameTimer = null;
function scheduleSmartNames() {
  if (smartNameTimer) clearInterval(smartNameTimer);
  const interval = Math.min(4000 + Math.max(0, panes.size - 5) * 1000, 15000);
  smartNameTimer = setInterval(refreshSmartNames, interval);
}
scheduleSmartNames();

// ============================================================
// IDE MODE
// ============================================================
const ideSidebar = document.getElementById("ide-sidebar");
const ideSidebarBody = document.getElementById("ide-sidebar-body");
const ideSidebarStat = document.getElementById("ide-sidebar-stat");
const ideModeBtn = document.getElementById("btn-ide-mode");

function getProcessIcon(processName) {
  if (!processName) return { cls: "icon-shell", svg: '<polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/>' };
  const p = processName.toLowerCase();
  if (p.includes("node") || p.includes("npm") || p.includes("npx") || p.includes("yarn") || p.includes("bun") || p.includes("deno")) return { cls: "icon-node", svg: '<polygon points="12 2 22 8.5 22 15.5 12 22 2 15.5 2 8.5 12 2"/>' };
  if (p.includes("python") || p.includes("pip") || p.includes("conda")) return { cls: "icon-python", svg: '<path d="M12 2C6.5 2 6 4.5 6 4.5V7h6v1H4.5S2 7.5 2 12s2 5 2 5h2v-3s0-2 2.5-2h5s2.5 0 2.5-2.5V5S16.5 2 12 2z"/>' };
  if (p.includes("git")) return { cls: "icon-git", svg: '<circle cx="12" cy="6" r="2"/><circle cx="12" cy="18" r="2"/><line x1="12" y1="8" x2="12" y2="16"/>' };
  if (p.includes("docker") || p.includes("podman")) return { cls: "icon-docker", svg: '<rect x="2" y="10" width="4" height="4"/><rect x="7" y="10" width="4" height="4"/><rect x="12" y="10" width="4" height="4"/><rect x="7" y="5" width="4" height="4"/><rect x="12" y="5" width="4" height="4"/><path d="M18 12c4 0 4 6-4 6H4c-2 0-4-2-4-4"/>' };
  if (p.includes("vim") || p.includes("nvim") || p.includes("nano") || p.includes("emacs")) return { cls: "icon-vim", svg: '<polygon points="16 3 21 8 8 21 3 21 3 16 16 3"/>' };
  if (p.includes("ssh") || p.includes("scp") || p.includes("sftp")) return { cls: "icon-ssh", svg: '<rect x="3" y="11" width="18" height="10" rx="2"/><circle cx="12" cy="16" r="1.5"/><path d="M7 11V7a5 5 0 0110 0v4"/>' };
  if (p.includes("cargo") || p.includes("rustc")) return { cls: "icon-rust", svg: '<circle cx="12" cy="12" r="9"/><path d="M8 15l4-6 4 6"/><line x1="8" y1="13" x2="16" y2="13"/>' };
  if (p.includes("go")) return { cls: "icon-go", svg: '<ellipse cx="12" cy="12" rx="9" ry="6"/><circle cx="8" cy="11" r="1" fill="currentColor"/>' };
  if (p.includes("ruby") || p.includes("irb") || p.includes("gem") || p.includes("rails")) return { cls: "icon-ruby", svg: '<polygon points="12 2 20 8 20 16 12 22 4 16 4 8"/>' };
  if (p !== "-" && p !== "zsh" && p !== "bash" && p !== "fish" && p !== "sh" && p !== "pwsh" && p !== "powershell") return { cls: "icon-running", svg: '<polygon points="5 3 19 12 5 21 5 3" fill="currentColor" stroke="none"/>' };
  return { cls: "icon-shell", svg: '<polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/>' };
}

function toggleIdeMode() {
  ideMode = !ideMode;
  document.body.classList.toggle("ide-mode", ideMode);
  ideModeBtn.classList.toggle("active-toggle", ideMode);
  if (ideMode) {
    // Enter IDE mode: show active terminal fullscreen
    ideVisiblePanes = activeId ? [activeId] : [...panes.keys()].slice(0, 1);
    updateIdeSidebar();
    renderLayout();
  } else {
    // Exit IDE mode: rebuild full grid layout
    ideVisiblePanes = [];
    rebuildLayout();
  }
  settings.ideMode = ideMode;
  window.shellfire.saveSettings(settings);
  showToast(ideMode ? "IDE Mode ON" : "IDE Mode OFF");
  setTimeout(() => fitAllTerminals(), 50);
}

// ============================================================
// ZEN MODE
// ============================================================
const zenModeBtn = document.getElementById("btn-zen-mode");
const zenExitHint = document.getElementById("zen-exit-hint");
let zenHintTimer = null;

async function toggleZenMode() {
  const active = await window.shellfire.toggleZenMode();
  zenMode = active;
  document.body.classList.toggle("zen-mode", zenMode);
  zenModeBtn.classList.toggle("active-toggle", zenMode);
  if (zenMode) {
    // Show exit hint briefly
    zenExitHint.classList.add("visible");
    clearTimeout(zenHintTimer);
    zenHintTimer = setTimeout(() => zenExitHint.classList.remove("visible"), 3000);
  } else {
    zenExitHint.classList.remove("visible");
    clearTimeout(zenHintTimer);
  }
  showToast(zenMode ? "Zen Mode — all monitors" : "Zen Mode OFF");
  setTimeout(() => fitAllTerminals(), 100);
}

zenModeBtn.addEventListener("click", () => toggleZenMode());

// Listen for zen mode changes from main process (e.g. if exited via OS)
window.shellfire.onZenModeChanged((active) => {
  zenMode = active;
  document.body.classList.toggle("zen-mode", zenMode);
  zenModeBtn.classList.toggle("active-toggle", zenMode);
  setTimeout(() => fitAllTerminals(), 100);
});

function updateIdeSidebar() {
  if (!ideMode) return;

  // Group terminals by project (based on cwd)
  const groups = new Map(); // projectName -> [paneInfo]
  const ungrouped = [];

  for (const [id, pane] of panes) {
    const name = pane.customName || pane.titleEl?.textContent || `Terminal ${id}`;
    const process = pane._lastProcess || null;
    const gitBranch = pane._lastGitBranch || null;
    const gitDirty = pane._lastGitDirty || false;
    const cwd = pane.titleEl?.textContent || "";
    const isActive = id === activeId;
    const hasActivity = pane.activityDot?.classList.contains("visible") || false;
    const color = pane.color || "";
    const icon = getProcessIcon(process);

    // Try to figure out the project from CWD
    const cwdParts = cwd.split("/");
    let project = null;
    for (const proj of launchProjects) {
      const projBase = proj.path.replace(/.*\//, "");
      if (cwd.includes(projBase)) { project = proj.name; break; }
    }

    const info = { id, name, process, gitBranch, gitDirty, cwd, isActive, hasActivity, color, icon, project };
    if (project) {
      if (!groups.has(project)) groups.set(project, []);
      groups.get(project).push(info);
    } else {
      ungrouped.push(info);
    }
  }

  // Render — use replaceChildren() instead of innerHTML="" to preserve
  // scroll position and avoid destroying detached listeners on the old nodes.
  ideSidebarBody.replaceChildren();

  // If we have project groups, render them
  for (const [projectName, items] of groups) {
    const section = document.createElement("div");
    section.className = "ide-section";
    section.innerHTML = `
      <div class="ide-section-header">
        <svg viewBox="0 0 24 24"><polyline points="6 9 12 15 18 9"/></svg>
        ${escapeHtml(projectName)}
        <span class="ide-section-count">${items.length}</span>
      </div>
      <div class="ide-section-items"></div>
    `;
    const itemsEl = section.querySelector(".ide-section-items");
    for (const item of items) {
      itemsEl.appendChild(createIdeItem(item));
    }
    section.querySelector(".ide-section-header").addEventListener("click", () => {
      section.classList.toggle("collapsed");
    });
    ideSidebarBody.appendChild(section);
  }

  // Ungrouped terminals
  if (ungrouped.length > 0) {
    const sectionLabel = groups.size > 0 ? "Other" : null;
    if (sectionLabel) {
      const section = document.createElement("div");
      section.className = "ide-section";
      section.innerHTML = `
        <div class="ide-section-header">
          <svg viewBox="0 0 24 24"><polyline points="6 9 12 15 18 9"/></svg>
          ${sectionLabel}
          <span class="ide-section-count">${ungrouped.length}</span>
        </div>
        <div class="ide-section-items"></div>
      `;
      const itemsEl = section.querySelector(".ide-section-items");
      for (const item of ungrouped) {
        itemsEl.appendChild(createIdeItem(item));
      }
      section.querySelector(".ide-section-header").addEventListener("click", () => {
        section.classList.toggle("collapsed");
      });
      ideSidebarBody.appendChild(section);
    } else {
      // No groups - just render items directly
      for (const item of ungrouped) {
        ideSidebarBody.appendChild(createIdeItem(item));
      }
    }
  }

  // Footer stat
  ideSidebarStat.textContent = `${panes.size} terminal${panes.size !== 1 ? "s" : ""}`;
}

function escapeHtml(str) {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function createIdeItem(info) {
  const el = document.createElement("div");
  el.className = "ide-item" + (info.isActive ? " active" : "");
  el.dataset.paneId = info.id;

  let badges = "";
  if (info.gitBranch) {
    const cls = info.gitDirty ? "git-badge" : "git-clean";
    badges += `<span class="ide-item-badge ${cls}">${escapeHtml(info.gitBranch)}</span>`;
  }

  let dot = "";
  if (info.color) {
    dot = `<span class="ide-item-dot color-${info.color}"></span>`;
  } else if (info.hasActivity && !info.isActive) {
    dot = `<span class="ide-item-dot activity"></span>`;
  }

  const detail = info.process && info.process !== "-" ? info.process : info.cwd;

  el.innerHTML = `
    <div class="ide-item-icon ${info.icon.cls}">
      <svg viewBox="0 0 24 24">${info.icon.svg}</svg>
    </div>
    <div class="ide-item-info">
      <span class="ide-item-name">${escapeHtml(info.name)}</span>
      <span class="ide-item-detail">${escapeHtml(detail || "")}</span>
    </div>
    ${badges}
    ${dot}
    <button class="ide-item-close" title="Close">&times;</button>
  `;

  el.addEventListener("click", (e) => {
    if (e.target.closest(".ide-item-close")) return;
    setActive(info.id);
    updateIdeSidebar();
  });

  el.querySelector(".ide-item-close").addEventListener("click", (e) => {
    e.stopPropagation();
    removeTerminal(info.id);
  });

  // Context menu on right-click
  el.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    showContextMenu(e.clientX, e.clientY, info.id);
  });

  // Double-click to rename
  el.addEventListener("dblclick", () => {
    renamePaneUI(info.id);
  });

  return el;
}

// Hook into pane changes to update sidebar
const origSetActive = setActive;
// We'll use a MutationObserver-like approach: periodic update
setInterval(() => {
  if (ideMode) updateIdeSidebar();
}, 2000);

// IDE sidebar buttons
document.getElementById("ide-new-terminal").addEventListener("click", () => addTerminal());
document.getElementById("ide-collapse-sidebar").addEventListener("click", () => toggleIdeMode());
ideModeBtn.addEventListener("click", () => toggleIdeMode());

// IDE sidebar resize
const ideSidebarResize = document.getElementById("ide-sidebar-resize");
if (ideSidebarResize) {
  let resizing = false, startX = 0, startW = 0;
  ideSidebarResize.addEventListener("mousedown", (e) => {
    resizing = true; startX = e.clientX; startW = ideSidebar.offsetWidth;
    ideSidebarResize.classList.add("dragging");
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    e.preventDefault();
  });
  document.addEventListener("mousemove", (e) => {
    if (!resizing) return;
    const newW = Math.max(140, Math.min(500, startW + (e.clientX - startX)));
    ideSidebar.style.width = newW + "px";
  });
  document.addEventListener("mouseup", () => {
    if (!resizing) return;
    resizing = false;
    ideSidebarResize.classList.remove("dragging");
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
    fitAllTerminals();
  });
}

// ============================================================
