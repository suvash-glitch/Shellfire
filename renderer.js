    // ============================================================
    // STATE
    // ============================================================
    const grid = document.getElementById("grid");
    const paneCountEl = document.getElementById("pane-count");
    const toastEl = document.getElementById("toast");

    const panes = new Map(); // id -> { el, term, fitAddon, searchAddon, titleEl, indicatorEl, envBadgeEl, customName, locked, color }
    let activeId = null;
    let layout = [];
    let broadcastMode = false;
    let skipPermissions = false;
    let zoomedId = null;
    let currentThemeIdx = 0;
    let currentFontSize = 13;
    let copyOnSelect = true;
    let snippets = []; // { name, command }
    let profiles = []; // { name, panes: [{ cwd, command }] }
    let settings = {}; // loaded from settings.json
    let autoSaveInterval = 60; // seconds
    let autoSaveTimer = null;
    let bufferLimit = 512 * 1024; // configurable buffer limit
    let confirmClose = true;
    let customKeybindings = {}; // action -> shortcut override

    // ============================================================
    // THEMES
    // ============================================================
    const themes = [
      { name: "Dark", body: "#1e1e1e", ui: "#2d2d2d", border: "#1a1a1a", term: {
        background: "#1e1e1e", foreground: "#cccccc", cursor: "#cccccc", cursorAccent: "#1e1e1e",
        selectionBackground: "rgba(255,255,255,0.2)", selectionForeground: "#ffffff",
        black: "#000000", red: "#c91b00", green: "#00c200", yellow: "#c7c400",
        blue: "#0225c7", magenta: "#c930c7", cyan: "#00c5c7", white: "#c7c7c7",
        brightBlack: "#686868", brightRed: "#ff6e67", brightGreen: "#5ffa68",
        brightYellow: "#fffc67", brightBlue: "#6871ff", brightMagenta: "#ff76ff",
        brightCyan: "#60fdff", brightWhite: "#ffffff",
      }},
      { name: "Solarized Dark", body: "#002b36", ui: "#073642", border: "#001e27", term: {
        background: "#002b36", foreground: "#839496", cursor: "#839496", cursorAccent: "#002b36",
        selectionBackground: "rgba(131,148,150,0.2)", selectionForeground: "#fdf6e3",
        black: "#073642", red: "#dc322f", green: "#859900", yellow: "#b58900",
        blue: "#268bd2", magenta: "#d33682", cyan: "#2aa198", white: "#eee8d5",
        brightBlack: "#586e75", brightRed: "#cb4b16", brightGreen: "#859900",
        brightYellow: "#b58900", brightBlue: "#268bd2", brightMagenta: "#6c71c4",
        brightCyan: "#2aa198", brightWhite: "#fdf6e3",
      }},
      { name: "Dracula", body: "#282a36", ui: "#343746", border: "#21222c", term: {
        background: "#282a36", foreground: "#f8f8f2", cursor: "#f8f8f2", cursorAccent: "#282a36",
        selectionBackground: "rgba(248,248,242,0.2)", selectionForeground: "#ffffff",
        black: "#21222c", red: "#ff5555", green: "#50fa7b", yellow: "#f1fa8c",
        blue: "#bd93f9", magenta: "#ff79c6", cyan: "#8be9fd", white: "#f8f8f2",
        brightBlack: "#6272a4", brightRed: "#ff6e6e", brightGreen: "#69ff94",
        brightYellow: "#ffffa5", brightBlue: "#d6acff", brightMagenta: "#ff92df",
        brightCyan: "#a4ffff", brightWhite: "#ffffff",
      }},
      { name: "Monokai", body: "#272822", ui: "#3e3d32", border: "#1e1f1c", term: {
        background: "#272822", foreground: "#f8f8f2", cursor: "#f8f8f2", cursorAccent: "#272822",
        selectionBackground: "rgba(248,248,242,0.2)", selectionForeground: "#ffffff",
        black: "#272822", red: "#f92672", green: "#a6e22e", yellow: "#f4bf75",
        blue: "#66d9ef", magenta: "#ae81ff", cyan: "#a1efe4", white: "#f8f8f2",
        brightBlack: "#75715e", brightRed: "#f92672", brightGreen: "#a6e22e",
        brightYellow: "#f4bf75", brightBlue: "#66d9ef", brightMagenta: "#ae81ff",
        brightCyan: "#a1efe4", brightWhite: "#f9f8f5",
      }},
      { name: "Nord", body: "#2e3440", ui: "#3b4252", border: "#262c38", term: {
        background: "#2e3440", foreground: "#d8dee9", cursor: "#d8dee9", cursorAccent: "#2e3440",
        selectionBackground: "rgba(216,222,233,0.2)", selectionForeground: "#eceff4",
        black: "#3b4252", red: "#bf616a", green: "#a3be8c", yellow: "#ebcb8b",
        blue: "#81a1c1", magenta: "#b48ead", cyan: "#88c0d0", white: "#e5e9f0",
        brightBlack: "#4c566a", brightRed: "#bf616a", brightGreen: "#a3be8c",
        brightYellow: "#ebcb8b", brightBlue: "#81a1c1", brightMagenta: "#b48ead",
        brightCyan: "#8fbcbb", brightWhite: "#eceff4",
      }},
      { name: "Light", body: "#f5f5f5", ui: "#e8e8e8", border: "#d0d0d0", term: {
        background: "#ffffff", foreground: "#333333", cursor: "#333333", cursorAccent: "#ffffff",
        selectionBackground: "rgba(0,0,0,0.15)", selectionForeground: "#000000",
        black: "#000000", red: "#c91b00", green: "#00a600", yellow: "#a68b00",
        blue: "#0225c7", magenta: "#c930c7", cyan: "#00a6b2", white: "#bfbfbf",
        brightBlack: "#686868", brightRed: "#ff6e67", brightGreen: "#5ffa68",
        brightYellow: "#fffc67", brightBlue: "#6871ff", brightMagenta: "#ff76ff",
        brightCyan: "#60fdff", brightWhite: "#ffffff",
      }},
    ];

    const paneColors = ["", "red", "green", "yellow", "blue", "purple", "orange"];

    // ============================================================
    // UTILS
    // ============================================================
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

    // ============================================================
    // THEME
    // ============================================================
    function applyTheme(idx) {
      if (idx < 0 || idx >= themes.length) idx = 0;
      currentThemeIdx = idx;
      const t = themes[idx];
      document.body.style.background = t.body;
      document.querySelectorAll(".titlebar, .bottombar, .pane-header").forEach(el => el.style.background = t.ui);
      document.querySelectorAll(".titlebar, .bottombar").forEach(el => el.style.borderColor = t.border);
      const tabbar = document.getElementById("tabbar");
      if (tabbar) { tabbar.style.background = t.ui; tabbar.style.borderColor = t.border; }
      for (const [, pane] of panes) pane.term.options.theme = t.term;
      showToast(`Theme: ${t.name}`);
      window.terminator.saveConfig({ theme: idx, fontSize: currentFontSize });
    }

    function cycleTheme() { applyTheme((currentThemeIdx + 1) % themes.length); }

    // ============================================================
    // FONT SIZE
    // ============================================================
    function setFontSize(size) {
      currentFontSize = Math.max(8, Math.min(24, size));
      for (const [, pane] of panes) pane.term.options.fontSize = currentFontSize;
      fitAllTerminals();
      showToast(`Font size: ${currentFontSize}px`);
      window.terminator.saveConfig({ theme: currentThemeIdx, fontSize: currentFontSize });
    }

    // ============================================================
    // LAYOUT
    // ============================================================
    let fitRAF = null;
    function fitAllTerminals() {
      if (fitRAF) cancelAnimationFrame(fitRAF);
      fitRAF = requestAnimationFrame(() => {
        fitRAF = null;
        for (const [id, pane] of panes) {
          try { pane.fitAddon.fit(); window.terminator.resize(id, pane.term.cols, pane.term.rows); } catch {}
        }
      });
    }

    function renderLayout() {
      grid.innerHTML = "";
      const n = panes.size;
      paneCountEl.textContent = n === 0 ? "No terminals" : `${n} terminal${n > 1 ? "s" : ""}`;
      for (let ri = 0; ri < layout.length; ri++) {
        const row = layout[ri];
        if (ri > 0) { const h = document.createElement("div"); h.className = "resize-handle-h"; setupHorizontalResize(h, ri); grid.appendChild(h); }
        const rowEl = document.createElement("div"); rowEl.className = "grid-row"; rowEl.style.flex = row.flex;
        for (let ci = 0; ci < row.cols.length; ci++) {
          const col = row.cols[ci];
          if (ci > 0) { const v = document.createElement("div"); v.className = "resize-handle-v"; setupVerticalResize(v, ri, ci); rowEl.appendChild(v); }
          const pane = panes.get(col.paneId);
          if (pane) { pane.el.style.flex = col.flex; rowEl.appendChild(pane.el); }
        }
        grid.appendChild(rowEl);
      }
      fitAllTerminals();
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

    // ============================================================
    // SPLIT
    // ============================================================
    async function splitPane(direction) {
      if (activeId === null) { await addTerminal(); return; }
      const pos = findPaneInLayout(activeId);
      if (!pos) { await addTerminal(); return; }
      // Get cwd of active pane for auto-run-on-split
      let cwd = null;
      try { cwd = await window.terminator.getCwd(activeId); } catch {}
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
      document.getElementById("btn-skip-perms").classList.toggle("active-toggle", skipPermissions);
      document.getElementById("skip-perms-indicator").classList.toggle("visible", skipPermissions);
      showToast(skipPermissions ? "Skip Permissions ON" : "Skip Permissions OFF");
    }

    // ============================================================
    // PANE MANAGEMENT
    // ============================================================
    function setActive(id) {
      if (activeId !== null && panes.has(activeId)) panes.get(activeId).el.classList.remove("active");
      activeId = id;
      if (panes.has(id)) { const pane = panes.get(id); pane.el.classList.add("active"); pane.term.focus(); updatePaneTitle(id); }
    }

    async function updatePaneTitle(id) {
      const pane = panes.get(id); if (!pane || !pane.titleEl) return;
      if (pane.customName) { pane.titleEl.textContent = pane.customName; return; }
      try {
        const [cwd, proc] = await Promise.all([window.terminator.getCwd(id), window.terminator.getProcess(id)]);
        let title = `Terminal ${id}`;
        if (cwd) { let short = cwd.replace(/^\/Users\/[^/]+/, "~"); title = short; }
        if (proc && proc !== "zsh" && proc !== "bash") title += ` — ${proc}`;
        pane.titleEl.textContent = title;

        // Env badge detection
        if (pane.envBadgeEl) {
          pane.envBadgeEl.classList.remove("visible", "env-prod", "env-uat", "env-dev");
          if (cwd && cwd.includes("production")) { pane.envBadgeEl.textContent = "PROD"; pane.envBadgeEl.classList.add("visible", "env-prod"); }
          else if (cwd && cwd.includes("uat")) { pane.envBadgeEl.textContent = "UAT"; pane.envBadgeEl.classList.add("visible", "env-uat"); }
          else if (cwd && (cwd.includes("dev") || cwd.includes("local"))) { pane.envBadgeEl.textContent = "DEV"; pane.envBadgeEl.classList.add("visible", "env-dev"); }
        }

        // Git branch detection
        if (pane.gitBadge && pane.gitBranchName && cwd) {
          try {
            const [branch, status] = await Promise.all([
              window.terminator.getGitBranch(cwd),
              window.terminator.getGitStatus(cwd),
            ]);
            if (branch) {
              pane.gitBranchName.textContent = branch;
              pane.gitBadge.classList.add("visible");
              pane.gitBadge.classList.toggle("dirty", status === "dirty");
            } else {
              pane.gitBadge.classList.remove("visible");
            }
          } catch { pane.gitBadge.classList.remove("visible"); }
        }
      } catch {}
    }

    // Update all pane titles periodically
    setInterval(() => { for (const [id] of panes) updatePaneTitle(id); }, 3000);

    function renamePaneUI(id) {
      const pane = panes.get(id); if (!pane) return;
      const titleEl = pane.titleEl;
      const input = document.createElement("input");
      input.className = "pane-rename-input";
      input.value = pane.customName || titleEl.textContent;
      titleEl.replaceWith(input);
      input.focus(); input.select();
      const finish = () => {
        const val = input.value.trim();
        pane.customName = val || null;
        input.replaceWith(titleEl);
        if (val) titleEl.textContent = val;
        else updatePaneTitle(id);
      };
      input.addEventListener("blur", finish);
      input.addEventListener("keydown", (e) => { if (e.key === "Enter") input.blur(); if (e.key === "Escape") { input.value = ""; input.blur(); } });
    }

    function togglePaneLock(id) {
      const pane = panes.get(id); if (!pane) return;
      pane.locked = !pane.locked;
      pane.el.classList.toggle("locked", pane.locked);
      pane.el.querySelector(".lock-badge")?.classList.toggle("locked", pane.locked);
      showToast(pane.locked ? "Pane locked" : "Pane unlocked");
    }

    function cyclePaneColor(id) {
      const pane = panes.get(id); if (!pane) return;
      const curIdx = paneColors.indexOf(pane.color || "");
      const nextIdx = (curIdx + 1) % paneColors.length;
      pane.color = paneColors[nextIdx];
      const ind = pane.indicatorEl;
      paneColors.forEach(c => { if (c) ind.classList.remove(`color-${c}`); });
      if (pane.color) ind.classList.add(`color-${pane.color}`);
    }

    async function createPaneObj(cwd) {
      const id = await window.terminator.createTerminal(cwd);
      const el = document.createElement("div"); el.className = "pane";

      const header = document.createElement("div"); header.className = "pane-header";
      header.innerHTML = `
        <button class="pane-close"></button>
        <span class="pane-number"></span>
        <span class="env-badge" id="env-${id}"></span>
        <span class="pane-title">Terminal ${id} — zsh</span>
        <span class="git-badge"><svg viewBox="0 0 24 24"><circle cx="12" cy="6" r="2"/><circle cx="12" cy="18" r="2"/><line x1="12" y1="8" x2="12" y2="16"/></svg><span class="git-branch-name"></span></span>
        <span class="watcher-badge"></span>
        <span class="activity-dot"></span>
        <div class="pane-badges">
          <span class="pane-badge lock-badge" title="Lock"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0110 0v4"/></svg></span>
          <span class="pane-badge zoom-badge" title="Zoom"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg></span>
          <span class="pane-badge save-badge" title="Save Output"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#30d158" stroke-width="2" stroke-linecap="round"><path d="M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg></span>
        </div>
        <div class="pane-indicator"></div>
      `;

      header.querySelector(".pane-close").addEventListener("click", (e) => { e.stopPropagation(); removeTerminal(id); });
      header.querySelector(".zoom-badge").addEventListener("click", (e) => { e.stopPropagation(); setActive(id); toggleZoom(); });
      header.querySelector(".lock-badge").addEventListener("click", (e) => { e.stopPropagation(); togglePaneLock(id); });
      header.querySelector(".save-badge").addEventListener("click", (e) => { e.stopPropagation(); captureOutput(id); });
      header.addEventListener("click", () => setActive(id));
      header.addEventListener("dblclick", (e) => { e.preventDefault(); renamePaneUI(id); });
      header.addEventListener("contextmenu", (e) => { e.preventDefault(); showContextMenu(e.clientX, e.clientY, id); });

      // Drag & drop
      header.setAttribute("draggable", "true");
      header.addEventListener("dragstart", (e) => { el._dragId = id; e.dataTransfer.effectAllowed = "move"; header.style.opacity = "0.5"; });
      header.addEventListener("dragend", () => { header.style.opacity = ""; });
      header.addEventListener("dragover", (e) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; });
      header.addEventListener("dragenter", () => { header.style.borderBottom = "2px solid #007aff"; });
      header.addEventListener("dragleave", () => { header.style.borderBottom = ""; });
      header.addEventListener("drop", (e) => {
        e.preventDefault(); header.style.borderBottom = "";
        const fromEl = document.querySelector(".pane[style*='opacity']");
        const fromId = [...panes.entries()].find(([, p]) => p.el._dragId)?.[0];
        if (!fromId || fromId === id) return;
        const from = findPaneInLayout(fromId), to = findPaneInLayout(id);
        if (from && to) { const tmp = layout[from.ri].cols[from.ci].paneId; layout[from.ri].cols[from.ci].paneId = layout[to.ri].cols[to.ci].paneId; layout[to.ri].cols[to.ci].paneId = tmp; renderLayout(); showToast("Panes swapped"); }
        delete panes.get(fromId)?.el._dragId;
      });

      const body = document.createElement("div"); body.className = "pane-body";
      const scrollBtn = document.createElement("button"); scrollBtn.className = "scroll-to-bottom"; scrollBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="6 9 12 15 18 9"/></svg>'; scrollBtn.title = "Scroll to bottom";

      el.appendChild(header); el.appendChild(body); el.appendChild(scrollBtn);

      const t = themes[currentThemeIdx] || themes[0];
      const term = new Terminal({
        theme: t.term, fontSize: currentFontSize,
        fontFamily: '"SF Mono", "Menlo", "Monaco", "Courier New", monospace',
        cursorBlink: true, cursorStyle: "block", allowProposedApi: true, scrollback: 10000,
      });

      const fitAddon = new FitAddon.FitAddon();
      term.loadAddon(fitAddon);
      let searchAddon = null;
      try { searchAddon = new SearchAddon.SearchAddon(); term.loadAddon(searchAddon); } catch {}
      try { term.loadAddon(new WebLinksAddon.WebLinksAddon()); } catch {}
      term.open(body);

      // Copy on select
      term.onSelectionChange(() => {
        if (copyOnSelect) { const sel = term.getSelection(); if (sel) navigator.clipboard.writeText(sel); }
      });

      term.onData((data) => {
        if (broadcastMode) { window.terminator.broadcast([...panes.keys()], data); }
        else {
          window.terminator.sendInput(id, data);
          // Forward to linked panes
          for (const group of linkedGroups) {
            if (group.includes(id)) {
              for (const gid of group) {
                if (gid !== id && panes.has(gid)) window.terminator.sendInput(gid, data);
              }
            }
          }
        }
      });
      term.textarea.addEventListener("focus", () => setActive(id));

      // Bell notification
      term.onBell(() => {
        if (activeId !== id && !document.hasFocus()) {
          window.terminator.notify("Terminal Bell", `Terminal ${id} triggered a bell`);
        }
      });

      // Scroll-to-bottom
      const viewport = body.querySelector(".xterm-viewport");
      if (viewport) { viewport.addEventListener("scroll", () => { scrollBtn.classList.toggle("visible", viewport.scrollTop < viewport.scrollHeight - viewport.clientHeight - 10); }); }
      term.onWriteParsed(() => { if (viewport) scrollBtn.classList.toggle("visible", viewport.scrollTop < viewport.scrollHeight - viewport.clientHeight - 10); });
      scrollBtn.addEventListener("click", (e) => { e.stopPropagation(); term.scrollToBottom(); scrollBtn.classList.remove("visible"); term.focus(); });

      body.addEventListener("contextmenu", (e) => { e.preventDefault(); showContextMenu(e.clientX, e.clientY, id); });

      const titleEl = header.querySelector(".pane-title");
      const indicatorEl = header.querySelector(".pane-indicator");
      const envBadgeEl = header.querySelector(".env-badge");
      const paneNumberEl = header.querySelector(".pane-number");
      const activityDot = header.querySelector(".activity-dot");
      const gitBadge = header.querySelector(".git-badge");
      const gitBranchName = header.querySelector(".git-branch-name");
      panes.set(id, { el, term, fitAddon, searchAddon, titleEl, indicatorEl, envBadgeEl, paneNumberEl, activityDot, gitBadge, gitBranchName, customName: null, locked: false, color: "", createdAt: Date.now(), rawBuffer: "" });
      return id;
    }

    async function addTerminal(cwd) {
      const id = await createPaneObj(cwd);
      setActive(id); rebuildLayout();
      return id;
    }

    function removeTerminal(id) {
      const pane = panes.get(id); if (!pane) return;
      if (pane.locked) { showToast("Pane is locked"); return; }
      if (zoomedId === id) { zoomedId = null; for (const [, p] of panes) p.el.classList.remove("zoomed", "dimmed"); }
      if (watchTimers.has(id)) stopWatch(id);
      if (floatingPanes.has(id)) floatingPanes.delete(id);
      paneCommandStart.delete(id);
      loggingPanes.delete(id);
      window.terminator.kill(id); pane.term.dispose(); panes.delete(id);
      if (activeId === id) { const r = [...panes.keys()]; activeId = r.length > 0 ? r[r.length - 1] : null; }
      for (let ri = layout.length - 1; ri >= 0; ri--) { layout[ri].cols = layout[ri].cols.filter(c => c.paneId !== id); if (layout[ri].cols.length === 0) layout.splice(ri, 1); }
      renderLayout();
      if (activeId !== null) setActive(activeId);
      updateWelcomeScreen();
    }

    // ============================================================
    // IPC
    // ============================================================
    const MAX_RAW_BUFFER = bufferLimit; // configurable per pane

    window.terminator.onData((id, data) => {
      const pane = panes.get(id);
      if (!pane) return;
      pane.term.write(data);
      // Accumulate raw output for session restore
      pane.rawBuffer += data;
      if (pane.rawBuffer.length > MAX_RAW_BUFFER) {
        pane.rawBuffer = pane.rawBuffer.slice(-MAX_RAW_BUFFER);
      }
      // Activity dot for inactive panes
      if (id !== activeId && pane.activityDot) pane.activityDot.classList.add("visible");
      // Keyword watcher
      checkKeywords(id, data);
      // Terminal logging
      if (loggingPanes.has(id)) {
        window.terminator.logAppend(id, data.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "")); // strip ANSI
      }
    });
    window.terminator.onExit((id, exitCode) => {
      const pane = panes.get(id); if (!pane) return;
      pane.term.write("\r\n\x1b[90m[Process exited]\x1b[0m\r\n");
      const name = pane.customName || `Terminal ${id}`;
      if (id !== activeId || !document.hasFocus()) {
        window.terminator.notify("Process Finished", `${name} exited (code ${exitCode || 0})`);
        showToast(`${name} exited`);
      }
      setTimeout(() => removeTerminal(id), 1500);
    });

    // ============================================================
    // SEARCH
    // ============================================================
    const searchBar = document.getElementById("search-bar"), searchInput = document.getElementById("search-input");
    function openSearch() { searchBar.classList.add("visible"); searchInput.focus(); searchInput.select(); }
    function closeSearch() { searchBar.classList.remove("visible"); if (activeId && panes.has(activeId)) { try { panes.get(activeId).searchAddon?.clearDecorations(); } catch {} panes.get(activeId).term.focus(); } }
    searchInput.addEventListener("input", () => { if (activeId && panes.has(activeId)) panes.get(activeId).searchAddon?.findNext(searchInput.value); });
    searchInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); if (activeId && panes.has(activeId)) { e.shiftKey ? panes.get(activeId).searchAddon?.findPrevious(searchInput.value) : panes.get(activeId).searchAddon?.findNext(searchInput.value); } }
      else if (e.key === "Escape") closeSearch();
    });
    document.getElementById("search-next").addEventListener("click", () => { if (activeId && panes.has(activeId)) panes.get(activeId).searchAddon?.findNext(searchInput.value); });
    document.getElementById("search-prev").addEventListener("click", () => { if (activeId && panes.has(activeId)) panes.get(activeId).searchAddon?.findPrevious(searchInput.value); });
    document.getElementById("search-close").addEventListener("click", closeSearch);

    // ============================================================
    // CONTEXT MENU
    // ============================================================
    const contextMenuEl = document.getElementById("context-menu");
    function showContextMenu(x, y, paneId) {
      const pane = panes.get(paneId);
      const items = [
        { label: "Copy", shortcut: "Cmd+C", action: () => { if (pane) { const s = pane.term.getSelection(); if (s) navigator.clipboard.writeText(s); } }},
        { label: "Paste", shortcut: "Cmd+V", action: async () => { const t = await navigator.clipboard.readText(); if (t) window.terminator.sendInput(paneId, t); }},
        { sep: true },
        { label: "Clear", shortcut: "Cmd+K", action: () => { if (pane) { pane.term.clear(); pane.term.focus(); } }},
        { label: "Rename Pane", action: () => renamePaneUI(paneId) },
        { label: "Color: " + (pane?.color || "none"), action: () => cyclePaneColor(paneId) },
        { label: pane?.locked ? "Unlock Pane" : "Lock Pane", action: () => togglePaneLock(paneId) },
        { label: "Save Output", action: () => captureOutput(paneId) },
        { label: "Float Pane", action: () => toggleFloating(paneId) },
        { label: loggingPanes.has(paneId) ? "Stop Logging" : "Start Logging", action: () => toggleLogging(paneId) },
        { sep: true },
        { label: "Split Right", shortcut: "Cmd+D", action: () => { setActive(paneId); splitPane("horizontal"); }},
        { label: "Split Down", shortcut: "Cmd+Shift+D", action: () => { setActive(paneId); splitPane("vertical"); }},
        { label: "Zoom Pane", shortcut: "Cmd+Shift+Enter", action: () => { setActive(paneId); toggleZoom(); }},
        { sep: true },
        { label: "Close Pane", shortcut: "Cmd+W", action: () => removeTerminal(paneId), danger: true },
      ];
      contextMenuEl.innerHTML = "";
      for (const item of items) {
        if (item.sep) { const s = document.createElement("div"); s.className = "context-menu-sep"; contextMenuEl.appendChild(s); continue; }
        const el = document.createElement("div"); el.className = "context-menu-item" + (item.danger ? " danger" : "");
        el.innerHTML = `<span>${item.label}</span>${item.shortcut ? `<span class="context-menu-shortcut">${item.shortcut}</span>` : ""}`;
        el.addEventListener("click", () => { contextMenuEl.classList.remove("visible"); item.action(); });
        contextMenuEl.appendChild(el);
      }
      contextMenuEl.style.left = x + "px"; contextMenuEl.style.top = y + "px"; contextMenuEl.classList.add("visible");
    }
    document.addEventListener("click", () => contextMenuEl.classList.remove("visible"));

    // ============================================================
    // SNIPPETS
    // ============================================================
    function openSnippetRunner() {
      const overlay = document.getElementById("palette-overlay");
      const input = document.getElementById("palette-input");
      const results = document.getElementById("palette-results");
      overlay.classList.add("visible");
      input.placeholder = "Search snippets... (type new:name:command to save)";
      input.value = ""; input.focus();
      let selected = 0;

      function render(q) {
        const qq = q.toLowerCase();
        const filtered = qq ? snippets.filter(s => s.name.toLowerCase().includes(qq) || s.command.toLowerCase().includes(qq)) : snippets;
        selected = Math.min(selected, Math.max(0, filtered.length - 1));
        results.innerHTML = "";
        if (filtered.length === 0) {
          results.innerHTML = `<div class="palette-item"><span class="palette-item-label" style="color:#888">${snippets.length === 0 ? "No snippets yet. Type new:name:command to add one" : "No matches"}</span></div>`;
          return;
        }
        filtered.forEach((s, i) => {
          const el = document.createElement("div"); el.className = "palette-item" + (i === selected ? " selected" : "");
          el.innerHTML = `<span class="palette-item-label">${s.name}<span class="palette-item-sub">${s.command}</span></span><span class="palette-item-shortcut" style="cursor:pointer" data-del="${i}">&#x2716;</span>`;
          el.addEventListener("click", () => { overlay.classList.remove("visible"); input.placeholder = "Type a command..."; if (activeId) window.terminator.sendInput(activeId, s.command + "\n"); });
          el.querySelector("[data-del]").addEventListener("click", (ev) => { ev.stopPropagation(); snippets.splice(snippets.indexOf(s), 1); window.terminator.saveSnippets(snippets); render(input.value); showToast("Snippet deleted"); });
          results.appendChild(el);
        });
      }
      render("");

      const handler = (e) => {
        if (e.key === "Escape") { overlay.classList.remove("visible"); input.placeholder = "Type a command..."; input.removeEventListener("keydown", handler); input.removeEventListener("input", inputHandler); return; }
        if (e.key === "Enter") {
          e.preventDefault();
          const val = input.value;
          if (val.startsWith("new:")) {
            const parts = val.slice(4).split(":"); if (parts.length >= 2) { snippets.push({ name: parts[0].trim(), command: parts.slice(1).join(":").trim() }); window.terminator.saveSnippets(snippets); showToast("Snippet saved"); }
          } else {
            const items = results.querySelectorAll(".palette-item"); items[selected]?.click();
          }
          overlay.classList.remove("visible"); input.placeholder = "Type a command..."; input.removeEventListener("keydown", handler); input.removeEventListener("input", inputHandler);
        }
        if (e.key === "ArrowDown") { e.preventDefault(); selected++; render(input.value); }
        if (e.key === "ArrowUp") { e.preventDefault(); selected = Math.max(0, selected - 1); render(input.value); }
      };
      const inputHandler = () => { selected = 0; render(input.value); };
      input.addEventListener("keydown", handler);
      input.addEventListener("input", inputHandler);
      _paletteCleanup = () => { input.removeEventListener("keydown", handler); input.removeEventListener("input", inputHandler); };
    }

    // ============================================================
    // PROFILES
    // ============================================================
    function openProfileManager() {
      const overlay = document.getElementById("palette-overlay");
      const input = document.getElementById("palette-input");
      const results = document.getElementById("palette-results");
      overlay.classList.add("visible");
      input.placeholder = "Search profiles... (type save:name to save current layout)";
      input.value = ""; input.focus();
      let selected = 0;

      function render(q) {
        const qq = q.toLowerCase();
        const filtered = qq ? profiles.filter(p => p.name.toLowerCase().includes(qq)) : profiles;
        selected = Math.min(selected, Math.max(0, filtered.length - 1));
        results.innerHTML = "";
        if (filtered.length === 0) {
          results.innerHTML = `<div class="palette-item"><span class="palette-item-label" style="color:#888">${profiles.length === 0 ? 'No profiles. Type save:name to save current layout' : 'No matches'}</span></div>`;
          return;
        }
        filtered.forEach((p, i) => {
          const el = document.createElement("div"); el.className = "palette-item" + (i === selected ? " selected" : "");
          el.innerHTML = `<span class="palette-item-label">${p.name}<span class="palette-item-sub">${p.panes.length} panes</span></span><span class="palette-item-shortcut" style="cursor:pointer" data-del="${i}">&#x2716;</span>`;
          el.addEventListener("click", () => { overlay.classList.remove("visible"); input.placeholder = "Type a command..."; loadProfile(p); });
          el.querySelector("[data-del]").addEventListener("click", (ev) => { ev.stopPropagation(); profiles.splice(profiles.indexOf(p), 1); window.terminator.saveProfiles(profiles); render(input.value); showToast("Profile deleted"); });
          results.appendChild(el);
        });
      }
      render("");

      const handler = (e) => {
        if (e.key === "Escape") { overlay.classList.remove("visible"); input.placeholder = "Type a command..."; input.removeEventListener("keydown", handler); input.removeEventListener("input", inputHandler); return; }
        if (e.key === "Enter") {
          e.preventDefault(); const val = input.value;
          if (val.startsWith("save:")) { saveCurrentProfile(val.slice(5).trim()); }
          else { const items = results.querySelectorAll(".palette-item"); items[selected]?.click(); }
          overlay.classList.remove("visible"); input.placeholder = "Type a command..."; input.removeEventListener("keydown", handler); input.removeEventListener("input", inputHandler);
        }
        if (e.key === "ArrowDown") { e.preventDefault(); selected++; render(input.value); }
        if (e.key === "ArrowUp") { e.preventDefault(); selected = Math.max(0, selected - 1); render(input.value); }
      };
      const inputHandler = () => { selected = 0; render(input.value); };
      input.addEventListener("keydown", handler);
      input.addEventListener("input", inputHandler);
      _paletteCleanup = () => { input.removeEventListener("keydown", handler); input.removeEventListener("input", inputHandler); };
    }

    async function saveCurrentProfile(name) {
      if (!name) return;
      const paneDefs = [];
      for (const [id] of panes) {
        const cwd = await window.terminator.getCwd(id);
        const proc = await window.terminator.getProcess(id);
        paneDefs.push({ cwd: cwd || null, command: proc && proc !== "zsh" && proc !== "bash" ? proc : null });
      }
      profiles.push({ name, panes: paneDefs });
      window.terminator.saveProfiles(profiles);
      showToast(`Profile "${name}" saved (${paneDefs.length} panes)`);
    }

    async function loadProfile(profile) {
      // Close all existing panes
      for (const [id] of [...panes]) removeTerminal(id);
      // Create panes from profile
      for (const p of profile.panes) {
        const id = await createPaneObj(p.cwd);
        if (p.command) setTimeout(() => window.terminator.sendInput(id, p.command + "\n"), 200);
      }
      const first = [...panes.keys()][0]; if (first) setActive(first);
      rebuildLayout();
      showToast(`Profile "${profile.name}" loaded`);
    }

    // ============================================================
    // COMMAND PALETTE
    // ============================================================
    const paletteOverlay = document.getElementById("palette-overlay");
    const paletteInput = document.getElementById("palette-input");
    const paletteResults = document.getElementById("palette-results");
    let paletteSelectedIdx = 0;

    // Quick launch project definitions (used by commands + button handlers)
    const defaultProjects = [];
    let launchProjects = [...defaultProjects];

    const commands = [
      // Terminals
      { label: "New Terminal", shortcut: "Cmd+T", action: () => addTerminal(), category: "Terminal" },
      { label: "New Terminal in Same Dir", shortcut: "Cmd+Shift+T", action: () => addTerminalSameDir(), category: "Terminal" },
      { label: "Split Right", shortcut: "Cmd+D", action: () => splitPane("horizontal"), category: "Terminal" },
      { label: "Split Down", shortcut: "Cmd+Shift+D", action: () => splitPane("vertical"), category: "Terminal" },
      { label: "Close Pane", shortcut: "Cmd+W", action: () => { if (activeId) removeTerminal(activeId); }, category: "Terminal" },
      { label: "Close All Other Panes", shortcut: "Cmd+Shift+X", action: () => closeAllOthers(), category: "Terminal" },
      { label: "Clear Terminal", shortcut: "Cmd+K", action: () => { if (activeId && panes.has(activeId)) panes.get(activeId).term.clear(); }, category: "Terminal" },
      { label: "Quick Command", shortcut: "Cmd+;", action: () => openQuickCmd(), category: "Terminal" },
      // Layout
      { label: "Zoom Pane", shortcut: "Cmd+Shift+Enter", action: () => toggleZoom(), category: "Layout" },
      { label: "Reset Layout", action: () => resetLayout(), category: "Layout" },
      { label: "Toggle Broadcast", shortcut: "Cmd+Shift+B", action: () => toggleBroadcast(), category: "Layout" },
      { label: "Toggle Fullscreen", action: () => window.terminator.toggleFullscreen(), category: "Layout" },
      // Pane
      { label: "Rename Pane", action: () => { if (activeId) renamePaneUI(activeId); }, category: "Pane" },
      { label: "Lock/Unlock Pane", action: () => { if (activeId) togglePaneLock(activeId); }, category: "Pane" },
      { label: "Cycle Pane Color", action: () => { if (activeId) cyclePaneColor(activeId); }, category: "Pane" },
      { label: "Save Pane Output", action: () => captureOutput(), category: "Pane" },
      // Search & Find
      { label: "Find in Terminal", shortcut: "Cmd+F", action: () => openSearch(), category: "Search" },
      { label: "Search All Panes", action: () => openCrossPaneSearch(), category: "Search" },
      { label: "File Finder", shortcut: "Cmd+Shift+F", action: () => openFileFinder(), category: "Search" },
      { label: "File Preview", action: () => openFilePreview(), category: "Search" },
      { label: "Recent Directories", action: () => openRecentDirs(), category: "Search" },
      { label: "Directory Bookmarks", action: () => openBookmarks(), category: "Search" },
      { label: "Bookmark Current Directory", action: () => toggleBookmark(), category: "Search" },
      // Tools
      { label: "Snippets", shortcut: "Cmd+Shift+R", action: () => openSnippetRunner(), category: "Tools" },
      { label: "Split & Run Command", action: () => openSplitAndRun(), category: "Tools" },
      { label: "Watch Mode (repeat command)", action: () => openWatchMode(), category: "Tools" },
      { label: "SSH Bookmarks", action: () => openSshManager(), category: "Tools" },
      { label: "Docker Containers", action: () => openDockerPanel(), category: "Tools" },
      { label: "Environment Variables", action: () => openEnvViewer(), category: "Tools" },
      { label: "Keyword Watcher", action: () => toggleWatcher(), category: "Tools" },
      { label: "Scratchpad / Notes", action: () => openNotes(), category: "Tools" },
      { label: "Link Panes", action: () => linkPanes(), category: "Tools" },
      { label: "Float Pane (PiP)", action: () => toggleFloating(), category: "Tools" },
      { label: "Toggle Terminal Logging", action: () => toggleLogging(), category: "Tools" },
      { label: "Startup Profiles", action: () => openProfileManager(), category: "Tools" },
      { label: "Cron Manager", action: () => openCronManager(), category: "Tools" },
      { label: "Toggle Skip Permissions", action: () => toggleSkipPermissions(), category: "Tools" },
      { label: "Toggle Copy on Select", action: () => { copyOnSelect = !copyOnSelect; showToast(copyOnSelect ? "Copy on select ON" : "Copy on select OFF"); }, category: "Tools" },
      // Session
      { label: "Save Session", shortcut: "Cmd+Shift+S", action: () => saveCurrentSession(), category: "Session" },
      { label: "Restore Session", action: () => restoreSession(), category: "Session" },
      // Appearance
      { label: "Increase Font Size", shortcut: "Cmd+Plus", action: () => setFontSize(currentFontSize + 1), category: "Appearance" },
      { label: "Decrease Font Size", shortcut: "Cmd+Minus", action: () => setFontSize(currentFontSize - 1), category: "Appearance" },
      { label: "Reset Font Size", action: () => setFontSize(13), category: "Appearance" },
      { label: "Cycle Theme", action: () => cycleTheme(), category: "Appearance" },
      { label: "Theme: Dark", action: () => applyTheme(0), category: "Appearance" },
      { label: "Theme: Solarized Dark", action: () => applyTheme(1), category: "Appearance" },
      { label: "Theme: Dracula", action: () => applyTheme(2), category: "Appearance" },
      { label: "Theme: Monokai", action: () => applyTheme(3), category: "Appearance" },
      { label: "Theme: Nord", action: () => applyTheme(4), category: "Appearance" },
      { label: "Theme: Light", action: () => applyTheme(5), category: "Appearance" },
      // Quick Launch
      ...launchProjects.map(p => ({
        label: `Launch: ${p.name} + Claude`, category: "Launch",
        action: async () => { const id = await addTerminal(p.path); if (id !== undefined) setTimeout(() => window.terminator.sendInput(id, getClaudeCommand() + "\n"), 150); }
      })),
      // System
      { label: "Quit", shortcut: "Cmd+Q", action: () => window.terminator.quit(), category: "System" },
    ];

    function openPalette() {
      paletteOverlay.classList.add("visible");
      paletteInput.placeholder = "Type a command...";
      paletteInput.value = ""; paletteSelectedIdx = 0;
      renderPaletteResults(""); paletteInput.focus();
    }
    let _paletteCleanup = null;
    function closePalette() {
      paletteOverlay.classList.remove("visible");
      if (_paletteCleanup) { _paletteCleanup(); _paletteCleanup = null; }
      if (activeId && panes.has(activeId)) panes.get(activeId).term.focus();
    }

    function renderPaletteResults(query) {
      const q = query.toLowerCase();
      const filtered = q ? commands.filter(c => c.label.toLowerCase().includes(q) || (c.category && c.category.toLowerCase().includes(q))) : commands;
      paletteSelectedIdx = Math.min(paletteSelectedIdx, Math.max(0, filtered.length - 1));
      paletteResults.innerHTML = "";
      let lastCategory = null;
      filtered.forEach((cmd, i) => {
        // Show category header when not searching
        if (!q && cmd.category && cmd.category !== lastCategory) {
          lastCategory = cmd.category;
          const header = document.createElement("div");
          header.style.cssText = "padding:6px 16px 2px;font-size:10px;color:#666;font-weight:600;letter-spacing:0.5px;text-transform:uppercase;";
          if (i > 0) header.style.borderTop = "1px solid #333";
          header.textContent = cmd.category;
          paletteResults.appendChild(header);
        }
        const el = document.createElement("div"); el.className = "palette-item" + (i === paletteSelectedIdx ? " selected" : "");
        el.innerHTML = `<span class="palette-item-label">${cmd.label}</span>${cmd.shortcut ? `<span class="palette-item-shortcut">${cmd.shortcut}</span>` : ""}`;
        el.addEventListener("click", () => { closePalette(); cmd.action(); });
        el.addEventListener("mouseenter", () => { paletteSelectedIdx = i; paletteResults.querySelectorAll(".palette-item").forEach((e, j) => e.classList.toggle("selected", j === i)); });
        paletteResults.appendChild(el);
      });
    }

    paletteInput.addEventListener("input", () => { paletteSelectedIdx = 0; renderPaletteResults(paletteInput.value); });
    paletteInput.addEventListener("keydown", (e) => {
      const items = paletteResults.querySelectorAll(".palette-item");
      if (e.key === "ArrowDown") { e.preventDefault(); paletteSelectedIdx = Math.min(paletteSelectedIdx + 1, items.length - 1); items.forEach((el, i) => el.classList.toggle("selected", i === paletteSelectedIdx)); items[paletteSelectedIdx]?.scrollIntoView({ block: "nearest" }); }
      else if (e.key === "ArrowUp") { e.preventDefault(); paletteSelectedIdx = Math.max(paletteSelectedIdx - 1, 0); items.forEach((el, i) => el.classList.toggle("selected", i === paletteSelectedIdx)); items[paletteSelectedIdx]?.scrollIntoView({ block: "nearest" }); }
      else if (e.key === "Enter") { e.preventDefault(); items[paletteSelectedIdx]?.click(); }
      else if (e.key === "Escape") closePalette();
    });
    paletteOverlay.addEventListener("click", (e) => { if (e.target === paletteOverlay) closePalette(); });

    // ============================================================
    // SESSION
    // ============================================================
    async function saveCurrentSession(silent) {
      const paneStates = [];
      for (const [id] of panes) {
        const pane = panes.get(id);
        const cwd = await window.terminator.getCwd(id);
        paneStates.push({
          cwd: cwd || null,
          customName: pane.customName || null,
          color: pane.color || "",
          locked: pane.locked || false,
          rawBuffer: pane.rawBuffer || "",
        });
      }
      window.terminator.saveSession({
        version: 2,
        layout: JSON.parse(JSON.stringify(layout)),
        paneStates,
        theme: currentThemeIdx,
        fontSize: currentFontSize,
        broadcastMode,
        skipPermissions,
      });
      if (!silent) showToast("Session saved");
    }

    async function restoreSession() {
      try {
        const session = await window.terminator.loadSession();
        if (!session) {
          showToast("No saved session found");
          if (panes.size === 0) await addTerminal();
          return;
        }

        // Close existing panes
        for (const [id] of [...panes]) removeTerminal(id);

        // V2 format: full pane states with scrollback
        if (session.version === 2 && session.paneStates && session.paneStates.length > 0) {
          for (const ps of session.paneStates) {
            const id = await createPaneObj(ps.cwd);
            const pane = panes.get(id);
            if (pane) {
              // Replay saved scrollback buffer (with ANSI codes for color)
              if (ps.rawBuffer) {
                pane.term.write(ps.rawBuffer);
                pane.rawBuffer = ps.rawBuffer;
              }
              // Restore pane metadata
              if (ps.customName) {
                pane.customName = ps.customName;
                pane.titleEl.textContent = ps.customName;
              }
              if (ps.color) {
                pane.color = ps.color;
                paneColors.forEach(c => { if (c) pane.indicatorEl.classList.remove(`color-${c}`); });
                pane.indicatorEl.classList.add(`color-${ps.color}`);
              }
              if (ps.locked) {
                pane.locked = true;
                pane.el.classList.add("locked");
                pane.el.querySelector(".lock-badge")?.classList.add("locked");
              }
            }
          }

          // Restore layout structure if it matches pane count
          if (session.layout && session.layout.length > 0) {
            const savedIds = [];
            for (const row of session.layout) {
              for (const col of row.cols) savedIds.push(col.paneId);
            }
            const currentIds = [...panes.keys()];
            if (savedIds.length === currentIds.length) {
              // Remap old pane IDs to new ones
              layout = JSON.parse(JSON.stringify(session.layout));
              for (let ri = 0; ri < layout.length; ri++) {
                for (let ci = 0; ci < layout[ri].cols.length; ci++) {
                  const oldIdx = savedIds.indexOf(layout[ri].cols[ci].paneId);
                  if (oldIdx >= 0 && oldIdx < currentIds.length) {
                    layout[ri].cols[ci].paneId = currentIds[oldIdx];
                  }
                }
              }
              renderLayout();
            } else {
              rebuildLayout();
            }
          } else {
            rebuildLayout();
          }

          // Restore global state
          if (session.broadcastMode) {
            broadcastMode = true;
            document.getElementById("broadcast-indicator").classList.add("visible");
            document.getElementById("btn-broadcast").classList.add("active-toggle");
          }
          if (session.skipPermissions) { skipPermissions = false; toggleSkipPermissions(); }

          const first = [...panes.keys()][0];
          if (first) setActive(first);
          showToast(`Session restored (${session.paneStates.length} panes with scrollback)`);

        // V1 fallback: just cwds
        } else if (session.cwds && session.cwds.length > 0) {
          for (const cwd of session.cwds) {
            await createPaneObj(cwd);
          }
          const first = [...panes.keys()][0];
          if (first) setActive(first);
          rebuildLayout();
          showToast(`Session restored (${session.cwds.length} panes)`);
        } else {
          showToast("No saved session found");
          if (panes.size === 0) await addTerminal();
        }
      } catch (err) {
        console.error("Restore error:", err);
        showToast("Failed to restore session", "error");
        if (panes.size === 0) await addTerminal();
      }
    }

    // New terminal in same directory
    async function addTerminalSameDir() {
      let cwd = null;
      if (activeId) { try { cwd = await window.terminator.getCwd(activeId); } catch {} }
      await addTerminal(cwd);
    }

    // Reset layout to equal sizes
    function resetLayout() {
      rebuildLayout();
      showToast("Layout reset");
    }

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

    function updateTabBar() {
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

        // Process info
        const proc = p?._lastProcess;
        const procHtml = proc && proc !== "zsh" && proc !== "bash" && proc !== "fish" ? `<span class="tab-process">${proc}</span>` : "";

        // Git info
        const branch = p?._lastGitBranch;
        const dirty = p?._lastGitDirty;
        const gitHtml = branch ? `<span class="tab-git${dirty ? " dirty" : ""}">${branch}</span>` : "";

        // Duration
        const startTime = p?._commandStart;
        let durationHtml = "";
        if (startTime && proc && proc !== "zsh" && proc !== "bash" && proc !== "fish") {
          const elapsed = Math.round((Date.now() - startTime) / 1000);
          if (elapsed >= 5) {
            const fmt = elapsed >= 3600 ? `${Math.floor(elapsed/3600)}h${Math.floor((elapsed%3600)/60)}m` : elapsed >= 60 ? `${Math.floor(elapsed/60)}m${elapsed%60}s` : `${elapsed}s`;
            durationHtml = `<span class="tab-duration${elapsed >= 60 ? " long" : ""}">${fmt}</span>`;
          }
        }

        tab.innerHTML = `<span class="tab-num">${i < 9 ? i + 1 : ""}</span><span class="tab-dot ${dotClass}"></span>${shortName}${procHtml}${gitHtml}${durationHtml}<button class="tab-close">&times;</button>`;
        tab.addEventListener("click", (e) => { if (!e.target.classList.contains("tab-close")) setActive(id); });
        tab.querySelector(".tab-close").addEventListener("click", (e) => { e.stopPropagation(); removeTerminal(id); });
        tab.addEventListener("dblclick", (e) => { e.preventDefault(); renamePaneUI(id); });
        tab.addEventListener("contextmenu", (e) => { e.preventDefault(); showContextMenu(e.clientX, e.clientY, id); });
        tabbar.appendChild(tab);
      });
    }

    // Enrich tab data periodically (process, git, duration)
    async function enrichTabData() {
      for (const [id, pane] of panes) {
        try {
          const [proc, cwd] = await Promise.all([
            window.terminator.getProcess(id),
            window.terminator.getCwd(id),
          ]);
          const oldProc = pane._lastProcess;
          pane._lastProcess = proc || null;

          // Track command start time
          if (proc && proc !== "zsh" && proc !== "bash" && proc !== "fish") {
            if (!pane._commandStart || oldProc !== proc) pane._commandStart = Date.now();
          } else {
            pane._commandStart = null;
          }

          // Git info
          if (cwd) {
            const [branch, status] = await Promise.all([
              window.terminator.getGitBranch(cwd),
              window.terminator.getGitStatus(cwd),
            ]);
            pane._lastGitBranch = branch || null;
            pane._lastGitDirty = status === "dirty";
          } else {
            pane._lastGitBranch = null;
            pane._lastGitDirty = false;
          }
        } catch {
          pane._lastProcess = null;
          pane._lastGitBranch = null;
        }
      }
      updateTabBar();
    }
    setInterval(enrichTabData, 3000);

    function updateWelcomeScreen() {
      const welcome = document.getElementById("welcome");
      const gridEl = document.getElementById("grid");
      if (panes.size === 0) {
        welcome.classList.add("visible");
        gridEl.style.display = "none";
      } else {
        welcome.classList.remove("visible");
        gridEl.style.display = "";
      }
    }

    // Hook tab bar/welcome into layout changes
    const _origRenderLayout = renderLayout;
    renderLayout = function() { _origRenderLayout(); updatePaneNumbers(); updateWelcomeScreen(); };
    const _origSetActive = setActive;
    setActive = function(id) {
      _origSetActive(id); updateTabBar(); trackRecentDir(id);
      // Clear activity dot and watcher badge
      const pane = panes.get(id);
      if (pane && pane.activityDot) pane.activityDot.classList.remove("visible");
      if (pane) { const wb = pane.el.querySelector(".watcher-badge"); if (wb) wb.classList.remove("visible"); }
    };

    // ============================================================
    // CRON MANAGER
    // ============================================================
    const cronOverlay = document.getElementById("cron-overlay");
    const cronBody = document.getElementById("cron-body");
    const cronInput = document.getElementById("cron-input");

    async function openCronManager() {
      cronOverlay.classList.add("visible");
      cronInput.value = "";
      await refreshCronList();
      cronInput.focus();
    }
    function closeCronManager() { cronOverlay.classList.remove("visible"); if (activeId && panes.has(activeId)) panes.get(activeId).term.focus(); }

    async function refreshCronList() {
      const jobs = await window.terminator.cronList();
      cronBody.innerHTML = "";
      if (!jobs || jobs.length === 0) {
        cronBody.innerHTML = '<div class="cron-empty">No cron jobs found</div>';
        return;
      }
      jobs.forEach((job, i) => {
        const el = document.createElement("div"); el.className = "cron-item";
        el.innerHTML = `<span class="cron-item-line" title="${job.line}">${job.line}</span><button class="cron-item-del" data-idx="${i}"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>`;
        el.querySelector(".cron-item-del").addEventListener("click", async () => {
          await window.terminator.cronRemove(i);
          showToast("Cron job removed");
          await refreshCronList();
        });
        cronBody.appendChild(el);
      });
    }

    document.getElementById("cron-close").addEventListener("click", closeCronManager);
    cronOverlay.addEventListener("click", (e) => { if (e.target === cronOverlay) closeCronManager(); });
    document.getElementById("cron-add-btn").addEventListener("click", async () => {
      const line = cronInput.value.trim();
      if (!line) return;
      const ok = await window.terminator.cronAdd(line);
      if (ok) { showToast("Cron job added"); cronInput.value = ""; await refreshCronList(); }
      else showToast("Failed to add cron job", "error");
    });
    cronInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") document.getElementById("cron-add-btn").click();
      if (e.key === "Escape") closeCronManager();
    });

    // ============================================================
    // RECENT DIRECTORIES
    // ============================================================
    let recentDirs = [];
    const MAX_RECENTS = 20;

    async function loadRecentDirs() {
      try { const saved = await window.terminator.loadRecents(); if (Array.isArray(saved)) recentDirs = saved; } catch {}
    }

    async function trackRecentDir(id) {
      try {
        const cwd = await window.terminator.getCwd(id);
        if (!cwd) return;
        recentDirs = recentDirs.filter(d => d !== cwd);
        recentDirs.unshift(cwd);
        if (recentDirs.length > MAX_RECENTS) recentDirs = recentDirs.slice(0, MAX_RECENTS);
        window.terminator.saveRecents(recentDirs);
      } catch {}
    }

    function openRecentDirs() {
      const overlay = document.getElementById("palette-overlay");
      const input = document.getElementById("palette-input");
      const results = document.getElementById("palette-results");
      overlay.classList.add("visible");
      input.placeholder = "Search recent directories...";
      input.value = ""; input.focus();
      let selected = 0;

      function render(q) {
        const qq = q.toLowerCase();
        const filtered = qq ? recentDirs.filter(d => d.toLowerCase().includes(qq)) : recentDirs;
        selected = Math.min(selected, Math.max(0, filtered.length - 1));
        results.innerHTML = "";
        if (filtered.length === 0) {
          results.innerHTML = `<div class="palette-item"><span class="palette-item-label" style="color:#888">${recentDirs.length === 0 ? "No recent directories yet" : "No matches"}</span></div>`;
          return;
        }
        filtered.forEach((dir, i) => {
          const el = document.createElement("div"); el.className = "palette-item" + (i === selected ? " selected" : "");
          const short = dir.replace(/^\/Users\/[^/]+/, "~");
          el.innerHTML = `<span class="palette-item-label">${short}</span>`;
          el.addEventListener("click", async () => { overlay.classList.remove("visible"); input.placeholder = "Type a command..."; await addTerminal(dir); });
          results.appendChild(el);
        });
      }
      render("");

      const handler = (e) => {
        if (e.key === "Escape") { overlay.classList.remove("visible"); input.placeholder = "Type a command..."; input.removeEventListener("keydown", handler); input.removeEventListener("input", inputHandler); return; }
        if (e.key === "Enter") { e.preventDefault(); const items = results.querySelectorAll(".palette-item"); items[selected]?.click(); overlay.classList.remove("visible"); input.placeholder = "Type a command..."; input.removeEventListener("keydown", handler); input.removeEventListener("input", inputHandler); }
        if (e.key === "ArrowDown") { e.preventDefault(); selected++; render(input.value); }
        if (e.key === "ArrowUp") { e.preventDefault(); selected = Math.max(0, selected - 1); render(input.value); }
      };
      const inputHandler = () => { selected = 0; render(input.value); };
      input.addEventListener("keydown", handler);
      input.addEventListener("input", inputHandler);
      _paletteCleanup = () => { input.removeEventListener("keydown", handler); input.removeEventListener("input", inputHandler); };
    }

    // ============================================================
    // FUZZY FILE FINDER
    // ============================================================
    function openFileFinder() {
      const overlay = document.getElementById("palette-overlay");
      const input = document.getElementById("palette-input");
      const results = document.getElementById("palette-results");
      overlay.classList.add("visible");
      input.placeholder = "Search files across projects... (type to search)";
      input.value = ""; input.focus();
      let selected = 0;
      let searchTimeout = null;

      const searchDirs = launchProjects.map(p => p.path).filter(Boolean);
      if (searchDirs.length === 0) {
        results.innerHTML = '<div class="palette-item"><span class="palette-item-label" style="color:#888">No projects configured. Add projects via the Projects dropdown first.</span></div>';
        return;
      }

      async function doSearch(q) {
        if (!q || q.length < 2) { results.innerHTML = '<div class="palette-item"><span class="palette-item-label" style="color:#888">Type at least 2 characters to search...</span></div>'; return; }
        results.innerHTML = '<div class="palette-item"><span class="palette-item-label" style="color:#888">Searching...</span></div>';
        try {
          const files = await window.terminator.findFiles(q, searchDirs);
          selected = 0;
          results.innerHTML = "";
          if (!files || files.length === 0) { results.innerHTML = '<div class="palette-item"><span class="palette-item-label" style="color:#888">No files found</span></div>'; return; }
          files.forEach((f, i) => {
            const el = document.createElement("div"); el.className = "palette-item" + (i === selected ? " selected" : "");
            el.innerHTML = `<span class="palette-item-label">${f.name}<span class="finder-result-path">${f.dir}</span></span>`;
            el.addEventListener("click", () => {
              overlay.classList.remove("visible"); input.placeholder = "Type a command...";
              // cd to the directory containing the file
              const dir = f.path.replace(/\/[^/]+$/, "");
              addTerminal(dir);
            });
            el.addEventListener("mouseenter", () => { selected = i; results.querySelectorAll(".palette-item").forEach((e, j) => e.classList.toggle("selected", j === i)); });
            results.appendChild(el);
          });
        } catch { results.innerHTML = '<div class="palette-item"><span class="palette-item-label" style="color:#888">Search failed</span></div>'; }
      }

      const handler = (e) => {
        if (e.key === "Escape") { overlay.classList.remove("visible"); input.placeholder = "Type a command..."; input.removeEventListener("keydown", handler); input.removeEventListener("input", inputHandler); return; }
        if (e.key === "Enter") {
          e.preventDefault();
          const items = results.querySelectorAll(".palette-item"); items[selected]?.click();
          overlay.classList.remove("visible"); input.placeholder = "Type a command...";
          input.removeEventListener("keydown", handler); input.removeEventListener("input", inputHandler);
        }
        if (e.key === "ArrowDown") { e.preventDefault(); selected++; const items = results.querySelectorAll(".palette-item"); if (selected >= items.length) selected = items.length - 1; items.forEach((e, j) => e.classList.toggle("selected", j === selected)); items[selected]?.scrollIntoView({ block: "nearest" }); }
        if (e.key === "ArrowUp") { e.preventDefault(); selected = Math.max(0, selected - 1); const items = results.querySelectorAll(".palette-item"); items.forEach((e, j) => e.classList.toggle("selected", j === selected)); items[selected]?.scrollIntoView({ block: "nearest" }); }
      };
      const inputHandler = () => {
        clearTimeout(searchTimeout);
        searchTimeout = setTimeout(() => doSearch(input.value.trim()), 300);
      };
      input.addEventListener("keydown", handler);
      input.addEventListener("input", inputHandler);
      _paletteCleanup = () => { input.removeEventListener("keydown", handler); input.removeEventListener("input", inputHandler); };
    }

    // ============================================================
    // PANE OUTPUT CAPTURE
    // ============================================================
    async function captureOutput(id) {
      const pane = panes.get(id || activeId); if (!pane) return;
      const buf = pane.term.buffer.active;
      let lines = [];
      for (let i = 0; i < buf.length; i++) {
        const line = buf.getLine(i);
        if (line) lines.push(line.translateToString(true));
      }
      // Trim trailing empty lines
      while (lines.length > 0 && lines[lines.length - 1].trim() === "") lines.pop();
      const content = lines.join("\n");
      if (!content) { showToast("No output to save"); return; }
      const name = `terminal-${id || activeId}-output.txt`;
      const savedPath = await window.terminator.saveOutput(content, name);
      if (savedPath) showToast(`Saved to ${savedPath.split("/").pop()}`);
      else showToast("Save cancelled");
    }

    // ============================================================
    // SMART PASTE CONFIRMATION
    // ============================================================
    const pasteConfirmEl = document.getElementById("paste-confirm");
    const pastePreviewEl = document.getElementById("paste-preview");
    const pasteLineCountEl = document.getElementById("paste-line-count");
    let pendingPaste = null;

    function showPasteConfirm(text, targetId) {
      const lines = text.split("\n");
      if (lines.length < 5) {
        // Small paste — just send it
        window.terminator.sendInput(targetId, text);
        return;
      }
      pendingPaste = { text, targetId };
      pasteLineCountEl.textContent = lines.length;
      pastePreviewEl.textContent = lines.slice(0, 20).join("\n") + (lines.length > 20 ? "\n..." : "");
      pasteConfirmEl.classList.add("visible");
    }

    document.getElementById("paste-ok").addEventListener("click", () => {
      if (pendingPaste) window.terminator.sendInput(pendingPaste.targetId, pendingPaste.text);
      pendingPaste = null;
      pasteConfirmEl.classList.remove("visible");
      if (activeId && panes.has(activeId)) panes.get(activeId).term.focus();
    });
    document.getElementById("paste-cancel").addEventListener("click", () => {
      pendingPaste = null;
      pasteConfirmEl.classList.remove("visible");
      if (activeId && panes.has(activeId)) panes.get(activeId).term.focus();
    });
    pasteConfirmEl.addEventListener("click", (e) => {
      if (e.target === pasteConfirmEl) { pendingPaste = null; pasteConfirmEl.classList.remove("visible"); }
    });

    // Intercept Cmd+V for smart paste
    document.addEventListener("keydown", (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "v" && activeId && panes.has(activeId)) {
        // Don't prevent default for small pastes — let xterm handle single-line
        // We intercept via the paste event instead
      }
    });
    document.addEventListener("paste", (e) => {
      if (!activeId || !panes.has(activeId)) return;
      const text = e.clipboardData?.getData("text");
      if (text && text.split("\n").length >= 5) {
        e.preventDefault();
        e.stopPropagation();
        showPasteConfirm(text, activeId);
      }
    }, true);

    // ============================================================
    // CLOSE ALL OTHERS
    // ============================================================
    function closeAllOthers() {
      if (!activeId) return;
      const toClose = [...panes.keys()].filter(id => id !== activeId);
      for (const id of toClose) removeTerminal(id);
      showToast("Closed all other panes");
    }

    // ============================================================
    // KEYBOARD PANE RESIZE
    // ============================================================
    function resizePaneKeyboard(direction, amount) {
      if (!activeId) return;
      const pos = findPaneInLayout(activeId);
      if (!pos) return;
      const { ri, ci } = pos;
      const step = amount || 0.1;

      if (direction === "right" || direction === "left") {
        const row = layout[ri];
        if (row.cols.length < 2) return;
        const targetCi = direction === "right" ? ci : ci - 1;
        if (targetCi < 0 || targetCi >= row.cols.length - 1) return;
        row.cols[targetCi].flex += step;
        row.cols[targetCi + 1].flex -= step;
        if (row.cols[targetCi + 1].flex < 0.2) row.cols[targetCi + 1].flex = 0.2;
      } else {
        const targetRi = direction === "down" ? ri : ri - 1;
        if (targetRi < 0 || targetRi >= layout.length - 1) return;
        layout[targetRi].flex += step;
        layout[targetRi + 1].flex -= step;
        if (layout[targetRi + 1].flex < 0.2) layout[targetRi + 1].flex = 0.2;
      }
      renderLayout();
    }

    // ============================================================
    // QUICK COMMAND BAR (Cmd+;)
    // ============================================================
    const quickCmdEl = document.getElementById("quick-cmd");
    const quickCmdInput = document.getElementById("quick-cmd-input");

    function openQuickCmd() {
      quickCmdEl.classList.add("visible");
      quickCmdInput.value = "";
      quickCmdInput.focus();
    }
    function closeQuickCmd() {
      quickCmdEl.classList.remove("visible");
      if (activeId && panes.has(activeId)) panes.get(activeId).term.focus();
    }

    quickCmdInput.addEventListener("keydown", (e) => {
      if (e.key === "Escape") { closeQuickCmd(); return; }
      if (e.key === "Enter") {
        e.preventDefault();
        const cmd = quickCmdInput.value.trim();
        if (!cmd) { closeQuickCmd(); return; }
        if (e.shiftKey) {
          // Run in new split
          doSplitAndRun(cmd);
        } else {
          // Run in active pane
          if (activeId && panes.has(activeId)) {
            window.terminator.sendInput(activeId, cmd + "\n");
          }
        }
        closeQuickCmd();
      }
    });

    // ============================================================
    // TAB DRAG REORDER
    // ============================================================
    let dragTabId = null;

    function setupTabDrag(tabEl, paneId) {
      tabEl.setAttribute("draggable", "true");
      tabEl.addEventListener("dragstart", (e) => {
        dragTabId = paneId;
        e.dataTransfer.effectAllowed = "move";
        tabEl.style.opacity = "0.4";
      });
      tabEl.addEventListener("dragend", () => {
        tabEl.style.opacity = "";
        dragTabId = null;
        document.querySelectorAll(".tab").forEach(t => t.classList.remove("drag-over"));
      });
      tabEl.addEventListener("dragover", (e) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; });
      tabEl.addEventListener("dragenter", () => { if (dragTabId !== paneId) tabEl.classList.add("drag-over"); });
      tabEl.addEventListener("dragleave", () => { tabEl.classList.remove("drag-over"); });
      tabEl.addEventListener("drop", (e) => {
        e.preventDefault();
        tabEl.classList.remove("drag-over");
        if (dragTabId === null || dragTabId === paneId) return;
        // Swap in layout
        const from = findPaneInLayout(dragTabId), to = findPaneInLayout(paneId);
        if (from && to) {
          const tmp = layout[from.ri].cols[from.ci].paneId;
          layout[from.ri].cols[from.ci].paneId = layout[to.ri].cols[to.ci].paneId;
          layout[to.ri].cols[to.ci].paneId = tmp;
          renderLayout();
          showToast("Tabs reordered");
        }
      });
    }

    // ============================================================
    // BUTTON HANDLERS
    // ============================================================
    document.getElementById("btn-add").addEventListener("click", () => addTerminal());
    document.getElementById("btn-split-h").addEventListener("click", () => splitPane("horizontal"));
    document.getElementById("btn-split-v").addEventListener("click", () => splitPane("vertical"));
    document.getElementById("btn-skip-perms").addEventListener("click", toggleSkipPermissions);
    document.getElementById("btn-broadcast").addEventListener("click", toggleBroadcast);
    document.getElementById("btn-search").addEventListener("click", openSearch);
    document.getElementById("btn-palette").addEventListener("click", openPalette);
    document.getElementById("btn-theme").addEventListener("click", cycleTheme);
    document.getElementById("btn-settings").addEventListener("click", openSettings);

    // Quick launch dropdown
    const launchDropdown = document.getElementById("launch-dropdown");

    function rebuildLaunchDropdown() {
      launchDropdown.innerHTML = "";
      launchProjects.forEach((proj, idx) => {
        const item = document.createElement("div");
        item.className = "launch-dropdown-item";
        item.innerHTML = `<span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${proj.name}<span class="launch-path" style="margin-left:8px">${proj.path.replace(/^\/Users\/[^/]+/, "~")}</span></span>
          <span class="launch-actions">
            <button class="launch-action-btn edit" title="Edit">&#9998;</button>
            <button class="launch-action-btn delete" title="Remove">&#10005;</button>
          </span>`;
        item.addEventListener("click", async (e) => {
          if (e.target.closest(".launch-action-btn")) return;
          launchDropdown.classList.remove("visible");
          const id = await addTerminal(proj.path);
          if (id !== undefined) setTimeout(() => window.terminator.sendInput(id, getClaudeCommand() + "\n"), 150);
        });
        item.querySelector(".edit").addEventListener("click", (e) => {
          e.stopPropagation();
          launchDropdown.classList.remove("visible");
          openProjectEditor(idx);
        });
        item.querySelector(".delete").addEventListener("click", (e) => {
          e.stopPropagation();
          launchProjects.splice(idx, 1);
          saveProjects();
          rebuildLaunchDropdown();
          rebuildLaunchCommands();
          showToast(`Removed: ${proj.name}`);
        });
        launchDropdown.appendChild(item);
      });
      // Add button
      const addBtn = document.createElement("button");
      addBtn.className = "launch-dropdown-add";
      addBtn.innerHTML = `<svg viewBox="0 0 24 24" style="width:12px;height:12px;stroke:currentColor;fill:none;stroke-width:2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg> Add Project`;
      addBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        launchDropdown.classList.remove("visible");
        openProjectEditor(-1);
      });
      launchDropdown.appendChild(addBtn);
    }

    function saveProjects() {
      window.terminator.saveProjects(launchProjects);
    }

    function rebuildLaunchCommands() {
      // Remove old launch commands
      const idx = commands.findIndex(c => c.category === "Launch");
      if (idx !== -1) {
        while (idx < commands.length && commands[idx].category === "Launch") commands.splice(idx, 1);
      }
      // Add updated ones
      const insertAt = commands.findIndex(c => c.category === "System");
      const newCmds = launchProjects.map(p => ({
        label: `Launch: ${p.name} + Claude`, category: "Launch",
        action: async () => { const id = await addTerminal(p.path); if (id !== undefined) setTimeout(() => window.terminator.sendInput(id, getClaudeCommand() + "\n"), 150); }
      }));
      commands.splice(insertAt >= 0 ? insertAt : commands.length, 0, ...newCmds);
    }

    // Project editor
    const projectEditorOverlay = document.getElementById("project-editor-overlay");
    const projectNameInput = document.getElementById("project-name-input");
    const projectPathInput = document.getElementById("project-path-input");

    function openProjectEditor(editIdx) {
      const isEdit = editIdx >= 0;
      document.getElementById("project-editor-title").textContent = isEdit ? "Edit Project" : "Add Project";
      projectNameInput.value = isEdit ? launchProjects[editIdx].name : "";
      projectPathInput.value = isEdit ? launchProjects[editIdx].path : "";
      projectEditorOverlay.classList.add("visible");
      projectNameInput.focus();

      function save() {
        const name = projectNameInput.value.trim();
        const projPath = projectPathInput.value.trim();
        if (!name || !projPath) { showToast("Name and path are required"); return; }
        if (isEdit) {
          launchProjects[editIdx] = { name, path: projPath };
        } else {
          launchProjects.push({ name, path: projPath });
        }
        saveProjects();
        rebuildLaunchDropdown();
        rebuildLaunchCommands();
        close();
        showToast(isEdit ? `Updated: ${name}` : `Added: ${name}`);
      }
      function close() {
        projectEditorOverlay.classList.remove("visible");
        document.getElementById("project-save").removeEventListener("click", save);
        document.getElementById("project-cancel").removeEventListener("click", close);
        projectEditorOverlay.removeEventListener("click", bgClick);
        projectNameInput.removeEventListener("keydown", keyHandler);
        projectPathInput.removeEventListener("keydown", keyHandler);
      }
      function bgClick(e) { if (e.target === projectEditorOverlay) close(); }
      function keyHandler(e) {
        if (e.key === "Enter") save();
        if (e.key === "Escape") close();
      }
      document.getElementById("project-save").addEventListener("click", save);
      document.getElementById("project-cancel").addEventListener("click", close);
      projectEditorOverlay.addEventListener("click", bgClick);
      projectNameInput.addEventListener("keydown", keyHandler);
      projectPathInput.addEventListener("keydown", keyHandler);
    }

    // Load saved projects
    (async () => {
      const saved = await window.terminator.loadProjects();
      if (saved && Array.isArray(saved) && saved.length > 0) {
        launchProjects = saved;
        rebuildLaunchCommands();
      }
      rebuildLaunchDropdown();
    })();

    document.getElementById("btn-launch-menu").addEventListener("click", (e) => {
      e.stopPropagation();
      launchDropdown.classList.toggle("visible");
    });
    document.addEventListener("click", () => launchDropdown.classList.remove("visible"));

    // Welcome screen buttons
    document.getElementById("welcome-new").addEventListener("click", () => addTerminal());
    document.getElementById("welcome-restore").addEventListener("click", () => restoreSession());
    document.getElementById("welcome-palette").addEventListener("click", () => openPalette());

    // ============================================================
    // KEYBOARD SHORTCUTS
    // ============================================================
    document.addEventListener("keydown", (e) => {
      const meta = e.metaKey || e.ctrlKey;
      if (meta && e.shiftKey && (e.key === "T" || e.key === "t") && !e.key.startsWith("Arrow")) { e.preventDefault(); addTerminalSameDir(); }
      else if (meta && e.key === "t") { e.preventDefault(); addTerminal(); }
      else if (meta && e.shiftKey && (e.key === "D" || e.key === "d")) { e.preventDefault(); splitPane("vertical"); }
      else if (meta && e.key === "d") { e.preventDefault(); splitPane("horizontal"); }
      else if (meta && e.key === "w") { e.preventDefault(); if (activeId !== null) removeTerminal(activeId); }
      else if (meta && e.key === "q") { e.preventDefault(); window.terminator.quit(); }
      else if (meta && e.shiftKey && (e.key === "F" || e.key === "f")) { e.preventDefault(); openFileFinder(); }
      else if (meta && e.key === "f") { e.preventDefault(); openSearch(); }
      else if (meta && e.key === "p") { e.preventDefault(); openPalette(); }
      else if (meta && e.key === "k") { e.preventDefault(); if (activeId && panes.has(activeId)) { panes.get(activeId).term.clear(); panes.get(activeId).term.focus(); } }
      else if (meta && e.shiftKey && e.key === "Enter") { e.preventDefault(); toggleZoom(); }
      else if (meta && e.shiftKey && (e.key === "B" || e.key === "b")) { e.preventDefault(); toggleBroadcast(); }
      else if (meta && e.shiftKey && (e.key === "R" || e.key === "r")) { e.preventDefault(); openSnippetRunner(); }
      else if (meta && (e.key === "=" || e.key === "+")) { e.preventDefault(); setFontSize(currentFontSize + 1); }
      else if (meta && e.key === "-") { e.preventDefault(); setFontSize(currentFontSize - 1); }
      else if (meta && e.key === "0") { e.preventDefault(); setFontSize(13); }
      else if (meta && e.key === "ArrowRight") { e.preventDefault(); navigatePane(1); }
      else if (meta && e.key === "ArrowLeft") { e.preventDefault(); navigatePane(-1); }
      else if (meta && e.key === "ArrowDown") { e.preventDefault(); navigatePaneVertical(1); }
      else if (meta && e.key === "ArrowUp") { e.preventDefault(); navigatePaneVertical(-1); }
      else if (meta && e.shiftKey && (e.key === "S" || e.key === "s")) { e.preventDefault(); saveCurrentSession(); }
      else if (meta && e.shiftKey && (e.key === "X" || e.key === "x")) { e.preventDefault(); closeAllOthers(); }
      else if (meta && e.ctrlKey && e.key === "ArrowRight") { e.preventDefault(); resizePaneKeyboard("right"); }
      else if (meta && e.ctrlKey && e.key === "ArrowLeft") { e.preventDefault(); resizePaneKeyboard("left"); }
      else if (meta && e.ctrlKey && e.key === "ArrowDown") { e.preventDefault(); resizePaneKeyboard("down"); }
      else if (meta && e.ctrlKey && e.key === "ArrowUp") { e.preventDefault(); resizePaneKeyboard("up"); }
      else if (meta && e.key === ";") { e.preventDefault(); openQuickCmd(); }
      else if (meta && e.key === ",") { e.preventDefault(); openSettings(); }
      else if (meta && e.key >= "1" && e.key <= "9") { e.preventDefault(); const idx = parseInt(e.key) - 1; const ids = [...panes.keys()]; if (idx < ids.length) setActive(ids[idx]); }
    });

    function navigatePane(dir) { const ids = [...panes.keys()]; if (!ids.length) return; const idx = ids.indexOf(activeId); setActive(ids[(idx + dir + ids.length) % ids.length]); }
    function navigatePaneVertical(dir) { const ids = [...panes.keys()]; const n = ids.length; if (!n) return; const cols = Math.ceil(Math.sqrt(n)); const idx = ids.indexOf(activeId); const next = idx + dir * cols; if (next >= 0 && next < n) setActive(ids[next]); }

    // ============================================================
    // KEYWORD WATCHER
    // ============================================================
    let watchKeywords = []; // { pattern: string, notify: bool }
    const defaultWatchKeywords = ["error", "fail", "exception", "ENOENT", "panic", "segfault"];

    function setupKeywordWatcher() {
      // Watch all incoming terminal data for keywords
      watchKeywords = defaultWatchKeywords.map(k => ({ pattern: k.toLowerCase(), notify: true }));
    }
    setupKeywordWatcher();

    // Patch onData to check for keywords
    const _origOnData = window.terminator.onData;
    let watcherEnabled = false;
    window.terminator.onData = undefined; // Remove so we can re-register below

    function checkKeywords(id, data) {
      if (!watcherEnabled || id === activeId) return;
      const lower = data.toLowerCase();
      for (const kw of watchKeywords) {
        if (lower.includes(kw.pattern)) {
          const pane = panes.get(id);
          if (pane) {
            // Show watcher badge
            const badge = pane.el.querySelector(".watcher-badge");
            if (badge) { badge.textContent = kw.pattern.toUpperCase(); badge.classList.add("visible"); }
            if (kw.notify) {
              const name = pane.customName || `Terminal ${id}`;
              window.terminator.notify("Keyword Alert", `"${kw.pattern}" detected in ${name}`);
            }
          }
          break;
        }
      }
    }

    function toggleWatcher() {
      watcherEnabled = !watcherEnabled;
      showToast(watcherEnabled ? `Keyword watcher ON (${watchKeywords.length} keywords)` : "Keyword watcher OFF");
    }

    // ============================================================
    // SSH BOOKMARKS
    // ============================================================
    let sshBookmarks = [];

    async function loadSshBookmarks() {
      try { const saved = await window.terminator.loadSsh(); if (Array.isArray(saved)) sshBookmarks = saved; } catch {}
    }

    function openSshManager() {
      const overlay = document.getElementById("palette-overlay");
      const input = document.getElementById("palette-input");
      const results = document.getElementById("palette-results");
      overlay.classList.add("visible");
      input.placeholder = "Search SSH bookmarks... (new:name:user@host to add)";
      input.value = ""; input.focus();
      let selected = 0;

      function render(q) {
        const qq = q.toLowerCase();
        const filtered = qq ? sshBookmarks.filter(s => s.name.toLowerCase().includes(qq) || s.host.toLowerCase().includes(qq)) : sshBookmarks;
        selected = Math.min(selected, Math.max(0, filtered.length - 1));
        results.innerHTML = "";
        if (filtered.length === 0) {
          results.innerHTML = `<div class="palette-item"><span class="palette-item-label" style="color:#888">${sshBookmarks.length === 0 ? "No SSH bookmarks. Type new:name:user@host to add" : "No matches"}</span></div>`;
          return;
        }
        filtered.forEach((s, i) => {
          const el = document.createElement("div"); el.className = "palette-item" + (i === selected ? " selected" : "");
          el.innerHTML = `<span class="palette-item-label">${s.name}<span class="palette-item-sub">${s.host}${s.port && s.port !== 22 ? ':' + s.port : ''}</span></span><span class="palette-item-shortcut" style="cursor:pointer" data-del="${i}">&#x2716;</span>`;
          el.addEventListener("click", () => {
            overlay.classList.remove("visible"); input.placeholder = "Type a command...";
            connectSsh(s);
          });
          el.querySelector("[data-del]").addEventListener("click", (ev) => {
            ev.stopPropagation();
            sshBookmarks.splice(sshBookmarks.indexOf(s), 1);
            window.terminator.saveSsh(sshBookmarks);
            render(input.value);
            showToast("SSH bookmark deleted");
          });
          results.appendChild(el);
        });
      }
      render("");

      const handler = (e) => {
        if (e.key === "Escape") { overlay.classList.remove("visible"); input.placeholder = "Type a command..."; input.removeEventListener("keydown", handler); input.removeEventListener("input", inputHandler); return; }
        if (e.key === "Enter") {
          e.preventDefault();
          const val = input.value;
          if (val.startsWith("new:")) {
            const parts = val.slice(4).split(":");
            if (parts.length >= 2) {
              const name = parts[0].trim();
              const hostPart = parts.slice(1).join(":").trim();
              const portMatch = hostPart.match(/:(\d+)$/);
              const port = portMatch ? parseInt(portMatch[1]) : 22;
              const host = portMatch ? hostPart.replace(/:(\d+)$/, "") : hostPart;
              sshBookmarks.push({ name, host, port });
              window.terminator.saveSsh(sshBookmarks);
              showToast("SSH bookmark saved");
            }
          } else {
            const items = results.querySelectorAll(".palette-item"); items[selected]?.click();
          }
          overlay.classList.remove("visible"); input.placeholder = "Type a command...";
          input.removeEventListener("keydown", handler); input.removeEventListener("input", inputHandler);
        }
        if (e.key === "ArrowDown") { e.preventDefault(); selected++; render(input.value); }
        if (e.key === "ArrowUp") { e.preventDefault(); selected = Math.max(0, selected - 1); render(input.value); }
      };
      const inputHandler = () => { selected = 0; render(input.value); };
      input.addEventListener("keydown", handler);
      input.addEventListener("input", inputHandler);
      _paletteCleanup = () => { input.removeEventListener("keydown", handler); input.removeEventListener("input", inputHandler); };
    }

    async function connectSsh(bookmark) {
      const id = await addTerminal();
      const cmd = bookmark.port && bookmark.port !== 22
        ? `ssh -p ${bookmark.port} ${bookmark.host}`
        : `ssh ${bookmark.host}`;
      setTimeout(() => window.terminator.sendInput(id, cmd + "\n"), 200);
      showToast(`Connecting to ${bookmark.name}...`);
    }

    // ============================================================
    // SPLIT & RUN
    // ============================================================
    function openSplitAndRun() {
      const overlay = document.getElementById("palette-overlay");
      const input = document.getElementById("palette-input");
      const results = document.getElementById("palette-results");
      overlay.classList.add("visible");
      input.placeholder = "Enter command to run in new split pane...";
      input.value = ""; input.focus();

      results.innerHTML = `<div class="palette-item"><span class="palette-item-label" style="color:#888">Type a command and press Enter to split & run</span></div>
        <div class="palette-item" data-cmd="npm run dev"><span class="palette-item-label">npm run dev</span></div>
        <div class="palette-item" data-cmd="npm test"><span class="palette-item-label">npm test</span></div>
        <div class="palette-item" data-cmd="npm run build"><span class="palette-item-label">npm run build</span></div>
        <div class="palette-item" data-cmd="git log --oneline -20"><span class="palette-item-label">git log --oneline -20</span></div>
        <div class="palette-item" data-cmd="htop"><span class="palette-item-label">htop</span></div>
        <div class="palette-item" data-cmd="docker-compose up"><span class="palette-item-label">docker-compose up</span></div>`;
      results.querySelectorAll("[data-cmd]").forEach(el => {
        el.addEventListener("click", () => {
          overlay.classList.remove("visible"); input.placeholder = "Type a command...";
          doSplitAndRun(el.dataset.cmd);
        });
      });

      const handler = (e) => {
        if (e.key === "Escape") { overlay.classList.remove("visible"); input.placeholder = "Type a command..."; input.removeEventListener("keydown", handler); return; }
        if (e.key === "Enter") {
          e.preventDefault();
          const cmd = input.value.trim();
          if (cmd) doSplitAndRun(cmd);
          overlay.classList.remove("visible"); input.placeholder = "Type a command...";
          input.removeEventListener("keydown", handler);
        }
      };
      input.addEventListener("keydown", handler);
      _paletteCleanup = () => { input.removeEventListener("keydown", handler); };
    }

    async function doSplitAndRun(command) {
      let cwd = null;
      if (activeId) { try { cwd = await window.terminator.getCwd(activeId); } catch {} }
      await splitPane("horizontal");
      // activeId is now the new pane
      if (activeId) setTimeout(() => window.terminator.sendInput(activeId, command + "\n"), 150);
      showToast(`Running: ${command}`);
    }

    // ============================================================
    // SYSTEM MONITOR
    // ============================================================
    async function updateSystemStats() {
      try {
        const stats = await window.terminator.systemStats();
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
    setInterval(updateSystemStats, 3000);
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
      let startX, startY, startLeft, startTop;
      handle.addEventListener("mousedown", (e) => {
        if (e.target.closest("button") || e.target.closest(".pane-badge")) return;
        if (!el.classList.contains("floating")) return;
        e.preventDefault();
        startX = e.clientX; startY = e.clientY;
        const rect = el.getBoundingClientRect();
        startLeft = rect.left; startTop = rect.top;
        const onMove = (ev) => {
          el.style.left = (startLeft + ev.clientX - startX) + "px";
          el.style.top = (startTop + ev.clientY - startY) + "px";
          el.style.right = "auto"; el.style.bottom = "auto";
        };
        const onUp = () => {
          document.removeEventListener("mousemove", onMove);
          document.removeEventListener("mouseup", onUp);
        };
        document.addEventListener("mousemove", onMove);
        document.addEventListener("mouseup", onUp);
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
      try { const saved = await window.terminator.loadNotes(); if (saved) { notesData = saved; notesText.value = saved.text || ""; } } catch {}
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
      notesSaveTimer = setTimeout(() => window.terminator.saveNotes(notesData), 500);
    });
    notesText.addEventListener("keydown", (e) => { if (e.key === "Escape") closeNotes(); });

    // ============================================================
    // LINK PANES
    // ============================================================
    let linkedGroups = []; // arrays of pane IDs

    function linkPanes() {
      if (panes.size < 2) { showToast("Need at least 2 panes to link"); return; }
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
        header.style.cssText = "padding:6px 16px;font-size:10px;color:#666;font-weight:600;border-top:1px solid #333";
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
      envBody.innerHTML = '<div style="padding:24px;text-align:center;color:#666;font-size:12px">Loading...</div>';
      envSearch.value = "";
      try {
        const envVars = await window.terminator.getTerminalEnv(activeId);
        renderEnvVars(envVars, "");
      } catch {
        envBody.innerHTML = '<div style="padding:24px;text-align:center;color:#666;font-size:12px">Failed to load</div>';
      }
    }

    function renderEnvVars(envVars, filter) {
      const q = filter.toLowerCase();
      const filtered = q ? envVars.filter(e => e.key.toLowerCase().includes(q) || e.value.toLowerCase().includes(q)) : envVars;
      envBody.innerHTML = "";
      if (filtered.length === 0) {
        envBody.innerHTML = '<div style="padding:24px;text-align:center;color:#666;font-size:12px">No matching variables</div>';
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
      envBody.innerHTML = '<div style="padding:24px;text-align:center;color:#666;font-size:12px">Loading...</div>';
      envSearch.value = ""; envSearch.focus();
      try {
        envVarsCache = await window.terminator.getTerminalEnv(activeId);
        renderEnvVars(envVarsCache, "");
      } catch {
        envBody.innerHTML = '<div style="padding:24px;text-align:center;color:#666;font-size:12px">Failed to load</div>';
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
      dockerBody.innerHTML = '<div style="padding:24px;text-align:center;color:#666;font-size:12px">Loading...</div>';
      try {
        const containers = await window.terminator.dockerPsAll();
        dockerBody.innerHTML = "";
        if (!containers || containers.length === 0) {
          dockerBody.innerHTML = '<div style="padding:24px;text-align:center;color:#666;font-size:12px">No containers found (is Docker running?)</div>';
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
            setTimeout(() => window.terminator.sendInput(id, cmd + "\n"), 200);
            showToast(`Attaching to ${c.name}...`);
          });
          dockerBody.appendChild(row);
        });
      } catch {
        dockerBody.innerHTML = '<div style="padding:24px;text-align:center;color:#666;font-size:12px">Docker not available</div>';
        showToast("Docker is not running or not installed", "error");
      }
    }

    document.getElementById("docker-close").addEventListener("click", () => { dockerPanel.classList.remove("visible"); if (activeId && panes.has(activeId)) panes.get(activeId).term.focus(); });
    document.getElementById("docker-refresh").addEventListener("click", refreshDocker);

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
          const proc = await window.terminator.getProcess(id);
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
                window.terminator.notify("Command Finished", `${name}: completed after ${formatDuration(duration)}`);
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

    // Update durations every 2 seconds
    setInterval(updateCommandDurations, 2000);

    // ============================================================
    // SMART TAB NAMES
    // ============================================================
    async function getSmartName(id) {
      const pane = panes.get(id);
      if (!pane) return `Terminal ${id}`;
      if (pane.customName) return pane.customName;

      try {
        const [tree, cwd] = await Promise.all([
          window.terminator.getProcessTree(id),
          window.terminator.getCwd(id),
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
      try { const saved = await window.terminator.loadBookmarks(); if (Array.isArray(saved)) dirBookmarks = saved; } catch {}
    }

    async function toggleBookmark() {
      if (!activeId) return;
      const cwd = await window.terminator.getCwd(activeId);
      if (!cwd) return;
      const idx = dirBookmarks.indexOf(cwd);
      if (idx >= 0) {
        dirBookmarks.splice(idx, 1);
        showToast("Bookmark removed");
      } else {
        dirBookmarks.push(cwd);
        showToast("Directory bookmarked");
      }
      window.terminator.saveBookmarks(dirBookmarks);
    }

    function openBookmarks() {
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
          results.innerHTML = `<div class="palette-item"><span class="palette-item-label" style="color:#888">${dirBookmarks.length === 0 ? "No bookmarks. Use 'Bookmark Directory' to add one." : "No matches"}</span></div>`;
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
            window.terminator.saveBookmarks(dirBookmarks);
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
        if (e.key === "ArrowDown") { e.preventDefault(); selected++; render(input.value); }
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
        header.style.cssText = "padding:6px 16px;font-size:10px;color:#666;font-weight:600;letter-spacing:0.5px;text-transform:uppercase;";
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
      sugHeader.style.cssText = "padding:6px 16px;font-size:10px;color:#666;font-weight:600;letter-spacing:0.5px;text-transform:uppercase;border-top:1px solid #333;";
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
      if (activeId) { try { cwd = await window.terminator.getCwd(activeId); } catch {} }
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
      window.terminator.sendInput(watchId, command + "\n");

      // Set up interval
      const timer = setInterval(() => {
        if (!panes.has(watchId)) { clearInterval(timer); watchTimers.delete(watchId); return; }
        window.terminator.sendInput(watchId, `clear && ${command}\n`);
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
      const overlay = document.getElementById("palette-overlay");
      const input = document.getElementById("palette-input");
      const results = document.getElementById("palette-results");
      overlay.classList.add("visible");
      input.placeholder = "Search across all terminal scrollbacks...";
      input.value = ""; input.focus();

      let searchTimeout = null;

      function doSearch(query) {
        if (!query || query.length < 2) {
          results.innerHTML = '<div class="palette-item"><span class="palette-item-label" style="color:#888">Type at least 2 characters...</span></div>';
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
          results.innerHTML = '<div class="palette-item"><span class="palette-item-label" style="color:#888">No matches found across terminals</span></div>';
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
      const overlay = document.getElementById("palette-overlay");
      const input = document.getElementById("palette-input");
      const results = document.getElementById("palette-results");
      overlay.classList.add("visible");
      input.placeholder = "Enter file path to preview (absolute or relative to cwd)...";
      input.value = ""; input.focus();

      results.innerHTML = `<div class="palette-item"><span class="palette-item-label" style="color:#888">Type a file path and press Enter</span></div>
        <div class="palette-item" data-hint="package.json"><span class="palette-item-label">package.json</span></div>
        <div class="palette-item" data-hint=".env"><span class="palette-item-label">.env</span></div>
        <div class="palette-item" data-hint="README.md"><span class="palette-item-label">README.md</span></div>
        <div class="palette-item" data-hint=".gitignore"><span class="palette-item-label">.gitignore</span></div>`;
      results.querySelectorAll("[data-hint]").forEach(el => {
        el.addEventListener("click", async () => {
          overlay.classList.remove("visible"); input.placeholder = "Type a command...";
          const cwd = activeId ? await window.terminator.getCwd(activeId) : null;
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
                const cwd = activeId ? await window.terminator.getCwd(activeId) : null;
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
        const result = await window.terminator.readFile(filePath);
        if (result.error) {
          filePreviewMeta.textContent = result.error;
          filePreviewContent.innerHTML = `<div style="padding:24px;text-align:center;color:#666">${result.error}</div>`;
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
        filePreviewContent.innerHTML = `<div style="padding:24px;text-align:center;color:#666">${err.message}</div>`;
      }
    }

    document.getElementById("file-preview-close").addEventListener("click", () => {
      filePreviewPanel.classList.remove("visible");
      if (activeId && panes.has(activeId)) panes.get(activeId).term.focus();
    });
    document.getElementById("file-preview-open").addEventListener("click", () => {
      if (currentPreviewPath) window.terminator.openInEditor(currentPreviewPath);
    });

    // ============================================================
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
        if (pane && !pane.customName) {
          const smart = await getSmartName(id);
          if (smart && pane.titleEl) pane.titleEl.textContent = smart;
        }
      }
    }
    setInterval(refreshSmartNames, 4000);

    // ============================================================
    // SETTINGS UI
    // ============================================================
    function openSettings() {
      const panel = document.getElementById("settings-panel");
      panel.classList.add("visible");

      // Populate theme dropdown
      const themeSelect = document.getElementById("setting-theme");
      themeSelect.innerHTML = "";
      themes.forEach((t, i) => {
        const opt = document.createElement("option");
        opt.value = i; opt.textContent = t.name;
        if (i === currentThemeIdx) opt.selected = true;
        themeSelect.appendChild(opt);
      });

      // Populate current values
      document.getElementById("setting-font-size").value = currentFontSize;
      document.getElementById("setting-font-family").value = settings.fontFamily || '"SF Mono", "Menlo", "Monaco", "Courier New", monospace';
      document.getElementById("setting-cursor-style").value = settings.cursorStyle || "block";
      document.getElementById("setting-cursor-blink").checked = settings.cursorBlink !== false;
      document.getElementById("setting-shell").value = settings.shell || "";
      document.getElementById("setting-cwd").value = settings.defaultCwd || "";
      document.getElementById("setting-scrollback").value = settings.scrollback || 10000;
      document.getElementById("setting-buffer-limit").value = Math.round(bufferLimit / 1024);
      document.getElementById("setting-copy-on-select").checked = copyOnSelect;
      document.getElementById("setting-confirm-close").checked = confirmClose;
      document.getElementById("setting-auto-save").checked = settings.autoSaveSession !== false;
      document.getElementById("setting-auto-save-interval").value = autoSaveInterval;

      // Version info
      window.terminator.getAppVersion().then(v => { document.getElementById("setting-version").textContent = v; }).catch(() => {});
      window.terminator.getDefaultShell().then(s => { document.getElementById("setting-detected-shell").textContent = s; }).catch(() => {});
    }

    function closeSettings() {
      document.getElementById("settings-panel").classList.remove("visible");
      if (activeId && panes.has(activeId)) panes.get(activeId).term.focus();
    }

    function applySettings() {
      const newTheme = parseInt(document.getElementById("setting-theme").value);
      const newFontSize = parseInt(document.getElementById("setting-font-size").value);
      const newFontFamily = document.getElementById("setting-font-family").value.trim();
      const newCursorStyle = document.getElementById("setting-cursor-style").value;
      const newCursorBlink = document.getElementById("setting-cursor-blink").checked;
      const newScrollback = parseInt(document.getElementById("setting-scrollback").value);
      const newBufferKB = parseInt(document.getElementById("setting-buffer-limit").value);

      copyOnSelect = document.getElementById("setting-copy-on-select").checked;
      confirmClose = document.getElementById("setting-confirm-close").checked;
      autoSaveInterval = parseInt(document.getElementById("setting-auto-save-interval").value) || 60;
      bufferLimit = (newBufferKB || 512) * 1024;

      // Apply to all terminals
      for (const [, pane] of panes) {
        pane.term.options.fontSize = newFontSize;
        pane.term.options.fontFamily = newFontFamily;
        pane.term.options.cursorStyle = newCursorStyle;
        pane.term.options.cursorBlink = newCursorBlink;
        pane.term.options.scrollback = newScrollback;
      }
      currentFontSize = newFontSize;
      if (newTheme !== currentThemeIdx) applyTheme(newTheme);
      fitAllTerminals();

      // Restart auto-save timer
      setupAutoSave();

      // Persist
      settings = {
        ...settings,
        theme: currentThemeIdx,
        fontSize: currentFontSize,
        fontFamily: newFontFamily,
        cursorStyle: newCursorStyle,
        cursorBlink: newCursorBlink,
        scrollback: newScrollback,
        bufferLimit: newBufferKB,
        copyOnSelect,
        confirmClose,
        autoSaveSession: document.getElementById("setting-auto-save").checked,
        autoSaveInterval,
        shell: document.getElementById("setting-shell").value.trim(),
        defaultCwd: document.getElementById("setting-cwd").value.trim(),
      };
      window.terminator.saveSettings(settings);
      showToast("Settings saved");
    }

    function setupAutoSave() {
      if (autoSaveTimer) clearInterval(autoSaveTimer);
      if (settings.autoSaveSession !== false) {
        autoSaveTimer = setInterval(() => { if (panes.size > 0) saveCurrentSession(true); }, autoSaveInterval * 1000);
      }
    }

    // Settings event listeners
    document.getElementById("settings-close").addEventListener("click", closeSettings);
    // Auto-apply on change
    ["setting-theme", "setting-font-size", "setting-cursor-style", "setting-scrollback", "setting-buffer-limit", "setting-auto-save-interval"].forEach(id => {
      document.getElementById(id).addEventListener("change", applySettings);
    });
    ["setting-cursor-blink", "setting-copy-on-select", "setting-confirm-close", "setting-auto-save"].forEach(id => {
      document.getElementById(id).addEventListener("change", applySettings);
    });
    document.getElementById("setting-font-family").addEventListener("blur", applySettings);
    document.getElementById("setting-shell").addEventListener("blur", applySettings);
    document.getElementById("setting-cwd").addEventListener("blur", applySettings);

    // ============================================================
    // KEYBINDING EDITOR
    // ============================================================
    const defaultKeybindings = {
      "New Terminal": "Cmd+T",
      "Split Right": "Cmd+D",
      "Split Down": "Cmd+Shift+D",
      "Close Pane": "Cmd+W",
      "Command Palette": "Cmd+P",
      "Find": "Cmd+F",
      "File Finder": "Cmd+Shift+F",
      "Clear": "Cmd+K",
      "Zoom": "Cmd+Shift+Enter",
      "Broadcast": "Cmd+Shift+B",
      "Snippets": "Cmd+Shift+R",
      "Save Session": "Cmd+Shift+S",
      "Quick Command": "Cmd+;",
      "Settings": "Cmd+,",
    };

    document.getElementById("setting-edit-keys").addEventListener("click", () => {
      const list = document.getElementById("keybinding-list");
      const isVisible = list.style.display !== "none";
      list.style.display = isVisible ? "none" : "block";
      if (isVisible) return;

      list.innerHTML = "";
      for (const [action, defaultKey] of Object.entries(defaultKeybindings)) {
        const current = customKeybindings[action] || defaultKey;
        const row = document.createElement("div");
        row.className = "keybinding-row";
        row.innerHTML = `<span class="kb-action">${action}</span><span class="kb-key" data-action="${action}">${current}</span>`;
        const keyEl = row.querySelector(".kb-key");
        keyEl.addEventListener("click", () => {
          if (keyEl.classList.contains("recording")) return;
          keyEl.classList.add("recording");
          keyEl.textContent = "Press keys...";
          const handler = (e) => {
            e.preventDefault(); e.stopPropagation();
            const parts = [];
            if (e.metaKey || e.ctrlKey) parts.push("Cmd");
            if (e.shiftKey) parts.push("Shift");
            if (e.altKey) parts.push("Alt");
            if (e.key && !["Meta", "Control", "Shift", "Alt"].includes(e.key)) {
              parts.push(e.key.length === 1 ? e.key.toUpperCase() : e.key);
            }
            if (parts.length > 1 || (parts.length === 1 && !["Cmd", "Shift", "Alt"].includes(parts[0]))) {
              const combo = parts.join("+");
              keyEl.textContent = combo;
              keyEl.classList.remove("recording");
              customKeybindings[action] = combo;
              settings.keybindings = customKeybindings;
              window.terminator.saveSettings(settings);
              document.removeEventListener("keydown", handler, true);
            }
          };
          document.addEventListener("keydown", handler, true);
          // Cancel on Escape
          const escHandler = (e) => {
            if (e.key === "Escape") {
              keyEl.textContent = customKeybindings[action] || defaultKey;
              keyEl.classList.remove("recording");
              document.removeEventListener("keydown", handler, true);
              document.removeEventListener("keydown", escHandler, true);
            }
          };
          document.addEventListener("keydown", escHandler, true);
        });
        list.appendChild(row);
      }
    });

    // Add Settings to command palette
    commands.push(
      { label: "Settings", shortcut: "Cmd+,", action: () => openSettings(), category: "System" },
      { label: "Check for Updates", action: async () => {
        try {
          const result = await window.terminator.checkForUpdates();
          if (result.available) showToast(`Update available: v${result.version}`);
          else showToast(result.reason === "not-packaged" ? "Updates available in packaged builds" : "You're up to date");
        } catch { showToast("Could not check for updates", "error"); }
      }, category: "System" }
    );

    // ============================================================
    // ONBOARDING (first run)
    // ============================================================
    async function checkOnboarding() {
      try {
        const s = await window.terminator.loadSettings();
        if (s && s._onboardingDone) return false;
        return true;
      } catch { return false; }
    }

    function showOnboarding() {
      const overlay = document.getElementById("onboarding-overlay");
      overlay.classList.add("visible");

      // Populate theme select
      const themeSelect = document.getElementById("onboard-theme");
      themeSelect.innerHTML = "";
      themes.forEach((t, i) => {
        const opt = document.createElement("option");
        opt.value = i; opt.textContent = t.name;
        themeSelect.appendChild(opt);
      });

      themeSelect.addEventListener("change", () => {
        applyTheme(parseInt(themeSelect.value));
      });

      document.getElementById("onboard-done").addEventListener("click", async () => {
        const themeIdx = parseInt(themeSelect.value);
        const fontSize = parseInt(document.getElementById("onboard-font-size").value) || 13;
        const projName = document.getElementById("onboard-project-name").value.trim();
        const projPath = document.getElementById("onboard-project-path").value.trim();

        applyTheme(themeIdx);
        setFontSize(fontSize);

        if (projName && projPath) {
          launchProjects.push({ name: projName, path: projPath });
          saveProjects();
          rebuildLaunchDropdown();
          rebuildLaunchCommands();
        }

        settings._onboardingDone = true;
        settings.theme = themeIdx;
        settings.fontSize = fontSize;
        window.terminator.saveSettings(settings);

        overlay.classList.remove("visible");
        showToast("Welcome to Terminator!");
      });
    }

    // ============================================================
    // KEYBOARD: Settings shortcut
    // ============================================================
    // Cmd+, to open settings (added to existing keydown handler below)

    // ============================================================
    // RESIZE & CLEANUP
    // ============================================================
    new ResizeObserver(() => fitAllTerminals()).observe(grid);
    window.addEventListener("beforeunload", () => {
      window.terminator.saveConfig({ theme: currentThemeIdx, fontSize: currentFontSize });
      // Auto-save session on close (fire and forget)
      saveCurrentSession(true);
    });
    // Auto-save session (configurable interval, set up after settings load)
    setupAutoSave();

    // ============================================================
    // INIT
    // ============================================================
    (async () => {
      try {
        const [config, savedSnippets, savedProfiles, savedSession, savedSettings] = await Promise.all([
          window.terminator.loadConfig(),
          window.terminator.loadSnippets(),
          window.terminator.loadProfiles(),
          window.terminator.loadSession(),
          window.terminator.loadSettings(),
        ]);
        await Promise.all([loadRecentDirs(), loadSshBookmarks(), loadNotes(), loadBookmarks()]);

        // Apply settings
        if (savedSettings) {
          settings = savedSettings;
          if (settings.copyOnSelect !== undefined) copyOnSelect = settings.copyOnSelect;
          if (settings.confirmClose !== undefined) confirmClose = settings.confirmClose;
          if (settings.autoSaveInterval) autoSaveInterval = settings.autoSaveInterval;
          if (settings.bufferLimit) bufferLimit = settings.bufferLimit * 1024;
          if (settings.keybindings) customKeybindings = settings.keybindings;
          setupAutoSave();
        }

        if (config) {
          if (config.theme >= 0 && config.theme < themes.length) currentThemeIdx = config.theme;
          if (config.fontSize) currentFontSize = config.fontSize;
        }
        // Settings override config
        if (settings.theme >= 0 && settings.theme < themes.length) currentThemeIdx = settings.theme;
        if (settings.fontSize) currentFontSize = settings.fontSize;
        if (Array.isArray(savedSnippets)) snippets = savedSnippets;
        if (Array.isArray(savedProfiles)) profiles = savedProfiles;

        // Try to restore previous session with full scrollback
        if (savedSession && ((savedSession.version === 2 && savedSession.paneStates?.length > 0) || (savedSession.cwds?.length > 0))) {
          // Apply theme first so restored content renders correctly
          applyTheme(currentThemeIdx);

          if (savedSession.version === 2 && savedSession.paneStates?.length > 0) {
            for (const ps of savedSession.paneStates) {
              const id = await createPaneObj(ps.cwd);
              const pane = panes.get(id);
              if (pane) {
                // Replay saved scrollback
                if (ps.rawBuffer) {
                  pane.term.write(ps.rawBuffer);
                  pane.rawBuffer = ps.rawBuffer;
                }
                if (ps.customName) { pane.customName = ps.customName; pane.titleEl.textContent = ps.customName; }
                if (ps.color) {
                  pane.color = ps.color;
                  paneColors.forEach(c => { if (c) pane.indicatorEl.classList.remove(`color-${c}`); });
                  pane.indicatorEl.classList.add(`color-${ps.color}`);
                }
                if (ps.locked) { pane.locked = true; pane.el.classList.add("locked"); pane.el.querySelector(".lock-badge")?.classList.add("locked"); }
              }
            }
            // Restore layout with flex ratios
            if (savedSession.layout?.length > 0) {
              const savedIds = [];
              for (const row of savedSession.layout) for (const col of row.cols) savedIds.push(col.paneId);
              const currentIds = [...panes.keys()];
              if (savedIds.length === currentIds.length) {
                layout = JSON.parse(JSON.stringify(savedSession.layout));
                for (let ri = 0; ri < layout.length; ri++)
                  for (let ci = 0; ci < layout[ri].cols.length; ci++) {
                    const oldIdx = savedIds.indexOf(layout[ri].cols[ci].paneId);
                    if (oldIdx >= 0 && oldIdx < currentIds.length) layout[ri].cols[ci].paneId = currentIds[oldIdx];
                  }
                renderLayout();
              } else rebuildLayout();
            } else rebuildLayout();

            if (savedSession.skipPermissions) { skipPermissions = false; toggleSkipPermissions(); }

            const count = savedSession.paneStates.length;
            showToast(`Restored ${count} terminal${count > 1 ? "s" : ""} with scrollback`);
          } else {
            // V1 fallback
            for (const cwd of savedSession.cwds) await createPaneObj(cwd);
            rebuildLayout();
            showToast(`Restored ${savedSession.cwds.length} terminal${savedSession.cwds.length > 1 ? "s" : ""}`);
          }
          const first = [...panes.keys()][0];
          if (first) setActive(first);
        } else {
          const id = await addTerminal();
          if (id !== undefined) setTimeout(() => window.terminator.sendInput(id, getClaudeCommand() + "\n"), 200);
        }
        applyTheme(currentThemeIdx);
        updateWelcomeScreen();

        // Check for first-run onboarding
        if (await checkOnboarding()) {
          showOnboarding();
        }
      } catch (err) {
        console.error("Init error:", err);
        try { await addTerminal(); updateWelcomeScreen(); } catch {}
      }
    })();
