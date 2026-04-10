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
    let currentZoom = 1.0; // app-wide zoom factor (0.5 – 3.0)
    let copyOnSelect = true;
    let snippets = []; // { name, command }
    let profiles = []; // { name, panes: [{ cwd, command }] }
    let settings = {}; // loaded from settings.json
    let autoSaveInterval = 60; // seconds
    let autoSaveTimer = null;
    let bufferLimit = 512 * 1024; // configurable buffer limit
    let confirmClose = true;
    let customKeybindings = {}; // action -> shortcut override
    let ideMode = false; // IDE sidebar mode
    let zenMode = false; // Zen mode: distraction-free fullscreen across all monitors
    let ideVisiblePanes = []; // pane IDs visible in IDE mode (single = fullscreen, multiple = split)

    // Feature state (used by multiple sections)
    const paneStatsHistory = new Map(); // paneId -> { cpuHistory, lastMemory, lastCpu }
    const paneLineBufs = new Map(); // paneId -> current line buffer for command history
    const paneErrorDebounce = new Map(); // paneId -> last error timestamp

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
    const paneColorPresets = {
      "": { label: "Default", bg: null, fg: null, indicator: null },
      red: { label: "Red", bg: "#2a1215", fg: "#f8c4c4", indicator: "#ff453a" },
      green: { label: "Green", bg: "#122a15", fg: "#c4f8c8", indicator: "#30d158" },
      yellow: { label: "Yellow", bg: "#2a2512", fg: "#f8f0c4", indicator: "#ffd60a" },
      blue: { label: "Blue", bg: "#121a2a", fg: "#c4d4f8", indicator: "#5a9df8" },
      purple: { label: "Purple", bg: "#1f122a", fg: "#dcc4f8", indicator: "#bf5af2" },
      orange: { label: "Orange", bg: "#2a1e12", fg: "#f8dcc4", indicator: "#ff9f0a" },
      cyan: { label: "Cyan", bg: "#122a28", fg: "#c4f8f0", indicator: "#00b8d4" },
    };

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

    // ============================================================
    // LAYOUT
    // ============================================================
    let fitRAF = null;
    let pendingSavedScroll = null;
    let isDragging = false;
    let layoutInProgress = false;

    function captureScrollState() {
      const state = new Map();
      for (const [id, pane] of panes) {
        const buf = pane.term.buffer.active;
        const viewport = pane.el.querySelector(".xterm-viewport");
        const atBottom = viewport
          ? viewport.scrollTop >= viewport.scrollHeight - viewport.clientHeight - 10
          : true;
        state.set(id, { viewportY: buf.viewportY, atBottom });
      }
      return state;
    }

    function fitAllTerminals(savedScrollPositions) {
      if (savedScrollPositions) {
        pendingSavedScroll = savedScrollPositions;
      }
      if (fitRAF) cancelAnimationFrame(fitRAF);
      fitRAF = requestAnimationFrame(() => {
        fitRAF = null;
        // Always capture scroll state — use pre-saved from renderLayout if available,
        // otherwise capture fresh (this is what the ResizeObserver path uses)
        const scrollState = pendingSavedScroll || captureScrollState();
        pendingSavedScroll = null;

        for (const [id, pane] of panes) {
          try {
            pane.fitAddon.fit();
            window.shellfire.resize(id, pane.term.cols, pane.term.rows);
          } catch {}
        }

        // Restore scroll positions after fit using line offsets
        for (const [id, pos] of scrollState) {
          const pane = panes.get(id);
          if (!pane) continue;
          if (pos.atBottom) {
            pane.term.scrollToBottom();
          } else {
            pane.term.scrollToLine(pos.viewportY);
          }
        }
      });
    }

    function renderLayout() {
      layoutInProgress = true;
      // Capture scroll state before any DOM manipulation
      const scrollPositions = captureScrollState();
      // Detach pane elements before clearing to preserve xterm state
      for (const [, pane] of panes) {
        if (pane.el.parentNode) pane.el.parentNode.removeChild(pane.el);
      }
      grid.innerHTML = "";
      const n = panes.size;
      paneCountEl.textContent = n === 0 ? "No terminals" : `${n} terminal${n > 1 ? "s" : ""}`;

      // IDE mode: render only visible panes (fullscreen by default)
      if (ideMode) {
        renderIdeEditorTabs();
        if (ideVisiblePanes.length === 0 && activeId && panes.has(activeId)) {
          ideVisiblePanes = [activeId];
        }
        if (ideVisiblePanes.length === 0 && n > 0) {
          ideVisiblePanes = [[...panes.keys()][0]];
        }
        ideVisiblePanes = ideVisiblePanes.filter(id => panes.has(id));
        if (ideVisiblePanes.length === 0) { layoutInProgress = false; fitAllTerminals(scrollPositions); return; }

        const rowEl = document.createElement("div");
        rowEl.className = "grid-row"; rowEl.style.flex = "1";
        ideVisiblePanes.forEach((id, i) => {
          if (i > 0) {
            const v = document.createElement("div"); v.className = "resize-handle-v";
            rowEl.appendChild(v);
          }
          const pane = panes.get(id);
          if (pane) { pane.el.style.flex = "1"; rowEl.appendChild(pane.el); }
        });
        grid.appendChild(rowEl);
        layoutInProgress = false;
        fitAllTerminals(scrollPositions);
        return;
      }

      // Normal mode: standard grid layout (use fragment to batch DOM writes)
      const frag = document.createDocumentFragment();
      for (let ri = 0; ri < layout.length; ri++) {
        const row = layout[ri];
        if (ri > 0) { const h = document.createElement("div"); h.className = "resize-handle-h"; setupHorizontalResize(h, ri); frag.appendChild(h); }
        const rowEl = document.createElement("div"); rowEl.className = "grid-row"; rowEl.style.flex = row.flex;
        for (let ci = 0; ci < row.cols.length; ci++) {
          const col = row.cols[ci];
          if (ci > 0) { const v = document.createElement("div"); v.className = "resize-handle-v"; setupVerticalResize(v, ri, ci); rowEl.appendChild(v); }
          const pane = panes.get(col.paneId);
          if (pane) { pane.el.style.flex = col.flex; rowEl.appendChild(pane.el); }
        }
        frag.appendChild(rowEl);
      }
      grid.appendChild(frag);
      layoutInProgress = false;
      fitAllTerminals(scrollPositions);
    }

    function renderIdeEditorTabs() {
      const tabsEl = document.getElementById("ide-editor-tabs");
      if (!tabsEl) return;
      tabsEl.innerHTML = "";
      for (const [id, pane] of panes) {
        const tab = document.createElement("button");
        tab.className = "ide-tab" + (id === activeId ? " active" : "");
        tab._paneId = id;

        const proc = pane._lastProcess || "";
        const icon = getIdeTabIcon(proc);
        const name = pane.customName || `Terminal ${id}`;

        tab.innerHTML = `
          <span class="ide-tab-icon">${escHtml(icon)}</span>
          <span class="ide-tab-name">${escHtml(name)}</span>
          ${proc && proc !== "zsh" && proc !== "bash" ? '<span class="ide-tab-modified"></span>' : ""}
          <button class="ide-tab-close">&times;</button>
        `;
        tab.addEventListener("click", (e) => {
          if (e.target.classList.contains("ide-tab-close")) {
            removeTerminal(id);
            return;
          }
          // Switch to this terminal fullscreen (reset IDE split)
          ideVisiblePanes = [id];
          setActive(id);
          renderLayout();
        });
        tab.addEventListener("dblclick", (e) => { e.stopPropagation(); renamePaneUI(id); });
        tabsEl.appendChild(tab);
      }
    }

    function getIdeTabIcon(proc) {
      if (!proc) return "\u25B8"; // small triangle
      const p = proc.toLowerCase();
      if (p.includes("node")) return "\u25CF"; // filled circle
      if (p.includes("python")) return "\u25CF";
      if (p.includes("vim") || p.includes("nvim")) return "\u25CF";
      if (p.includes("git")) return "\u25CF";
      if (p.includes("ssh")) return "\u25CF";
      return "\u25B8";
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

    // ============================================================
    // PANE MANAGEMENT
    // ============================================================
    function setActive(id) {
      if (activeId !== null && panes.has(activeId)) panes.get(activeId).el.classList.remove("active");
      activeId = id;
      if (panes.has(id)) {
        const pane = panes.get(id);
        pane.el.classList.add("active");
        pane.term.focus();
        // Clear activity indicator when pane gets focus
        if (pane.activityDot) pane.activityDot.classList.remove("visible");
        updatePaneTitle(id);
        // IDE mode: switch to this terminal fullscreen (unless it's already visible in a split)
        if (ideMode && !ideVisiblePanes.includes(id)) {
          ideVisiblePanes = [id];
          renderLayout();
        } else if (ideMode) {
          renderIdeEditorTabs(); // update active tab highlight
        }
      }
    }

    async function updatePaneTitle(id) {
      const pane = panes.get(id); if (!pane || !pane.titleEl) return;
      try {
        const cwd = await window.shellfire.getCwd(id);

        // Title: use customName if set, otherwise build from cwd/process
        if (pane.customName) {
          pane.titleEl.textContent = pane.customName;
        } else {
          const proc = await window.shellfire.getProcess(id);
          let title = `Terminal ${id}`;
          if (cwd) { let short = cwd.replace(/^\/Users\/[^/]+/, "~"); title = short; }
          if (proc && proc !== "zsh" && proc !== "bash") title += ` — ${proc}`;
          pane.titleEl.textContent = title;
        }

        // Env badge detection (always runs)
        if (pane.envBadgeEl) {
          pane.envBadgeEl.classList.remove("visible", "env-prod", "env-uat", "env-dev");
          if (cwd && cwd.includes("production")) { pane.envBadgeEl.textContent = "PROD"; pane.envBadgeEl.classList.add("visible", "env-prod"); }
          else if (cwd && cwd.includes("uat")) { pane.envBadgeEl.textContent = "UAT"; pane.envBadgeEl.classList.add("visible", "env-uat"); }
          else if (cwd && (cwd.includes("dev") || cwd.includes("local"))) { pane.envBadgeEl.textContent = "DEV"; pane.envBadgeEl.classList.add("visible", "env-dev"); }
        }

        // Git branch detection (always runs)
        if (pane.gitBadge && pane.gitBranchName && cwd) {
          try {
            const [branch, status] = await Promise.all([
              window.shellfire.getGitBranch(cwd),
              window.shellfire.getGitStatus(cwd),
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

    // Update pane titles periodically with batching (max 5 concurrent to avoid IPC flood)
    setInterval(async () => {
      const ids = [...panes.keys()];
      for (let i = 0; i < ids.length; i += 5) {
        await Promise.all(ids.slice(i, i + 5).map(id => updatePaneTitle(id)));
      }
    }, 5000);

    function renamePaneUI(id) {
      const pane = panes.get(id); if (!pane) return;

      // In IDE mode, rename inline in the IDE editor tab or sidebar tab instead of hidden pane header
      if (ideMode) {
        // Find the tab element for this pane (IDE editor tabs or sidebar tabs or bottom tabbar)
        const allTabs = document.querySelectorAll(".ide-tab, .tab, #ide-editor-tabs .ide-tab");
        let targetTab = null;
        for (const tab of allTabs) {
          if (tab._paneId === id) { targetTab = tab; break; }
        }
        // Fallback: find by matching text content
        if (!targetTab) {
          const editorTabs = document.getElementById("ide-editor-tabs");
          if (editorTabs) {
            for (const tab of editorTabs.children) {
              if (tab._paneId === id) { targetTab = tab; break; }
            }
          }
        }
        if (targetTab) {
          const input = document.createElement("input");
          input.className = "pane-rename-input";
          input.value = pane.customName || pane.titleEl?.textContent || `Terminal ${id}`;
          input.style.cssText = "width:120px;height:20px;font-size:12px;background:var(--t-ui);color:var(--t-fg);border:1px solid var(--t-accent);outline:none;padding:0 4px;border-radius:2px;";
          // Find the text node or span to replace inside the tab
          const nameSpan = targetTab.querySelector(".ide-tab-name");
          const replaceEl = nameSpan || targetTab;
          const origHTML = replaceEl.innerHTML;
          replaceEl.innerHTML = "";
          replaceEl.appendChild(input);
          input.focus(); input.select();
          let finished = false;
          const finish = () => {
            if (finished) return; finished = true;
            const val = input.value.trim();
            pane.customName = val || null;
            pane._userRenamed = !!val;
            if (val) pane.titleEl.textContent = val;
            else updatePaneTitle(id);
            // Refresh tabs to reflect new name
            renderIdeEditorTabs();
            updateIdeSidebar();
            updateTabBar();
          };
          input.addEventListener("blur", finish);
          input.addEventListener("keydown", (e) => { if (e.key === "Enter") input.blur(); if (e.key === "Escape") { input.value = ""; input.blur(); } });
          return;
        }
      }

      const titleEl = pane.titleEl;
      const input = document.createElement("input");
      input.className = "pane-rename-input";
      input.value = pane.customName || titleEl.textContent;
      titleEl.replaceWith(input);
      input.focus(); input.select();
      const finish = () => {
        const val = input.value.trim();
        pane.customName = val || null;
        pane._userRenamed = !!val; // lock name from auto-updates if user set one
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

    function applyPaneColor(id, colorName, customBg, customFg) {
      const pane = panes.get(id); if (!pane) return;
      const t = themes[currentThemeIdx] || themes[0];

      // Update indicator
      const ind = pane.indicatorEl;
      paneColors.forEach(c => { if (c) ind.classList.remove(`color-${c}`); });
      // Also remove any extra preset names and custom
      Object.keys(paneColorPresets).forEach(c => { if (c) ind.classList.remove(`color-${c}`); });
      ind.classList.remove("color-custom");

      if (colorName && colorName !== "custom") {
        // Preset color
        const preset = paneColorPresets[colorName];
        pane.color = colorName;
        pane.termBg = preset?.bg || null;
        pane.termFg = preset?.fg || null;
        if (colorName) ind.classList.add(`color-${colorName}`);

        if (preset && preset.bg) {
          pane.term.options.theme = { ...t.term, background: preset.bg, foreground: preset.fg };
          pane.el.querySelector(".pane-body").style.background = preset.bg;
        } else {
          pane.term.options.theme = t.term;
          pane.el.querySelector(".pane-body").style.background = "";
        }
      } else if (colorName === "custom" && customBg && customFg) {
        // Custom color
        pane.color = "custom";
        pane.termBg = customBg;
        pane.termFg = customFg;
        pane.term.options.theme = { ...t.term, background: customBg, foreground: customFg };
        pane.el.querySelector(".pane-body").style.background = customBg;
        ind.classList.add("color-custom");
      } else {
        // Reset to default
        pane.color = "";
        pane.termBg = null;
        pane.termFg = null;
        pane.term.options.theme = t.term;
        pane.el.querySelector(".pane-body").style.background = "";
      }
    }

    function openPaneColorPicker(paneId, anchorX, anchorY) {
      const picker = document.getElementById("pane-color-picker");
      const pane = panes.get(paneId);
      if (!pane) return;

      const currentColor = pane.color || "";
      const presetNames = Object.keys(paneColorPresets);

      picker.innerHTML = `
        <div class="pane-color-picker-label">Terminal Color</div>
        <div class="pane-color-picker-grid">
          ${presetNames.map(name => {
            const p = paneColorPresets[name];
            const bg = p.bg || (themes[currentThemeIdx] || themes[0]).term.background;
            const fg = p.fg || (themes[currentThemeIdx] || themes[0]).term.foreground;
            const isActive = currentColor === name;
            return `<div class="pane-color-swatch${isActive ? " active" : ""}" data-color="${name}" style="background:${bg};color:${fg}" title="${p.label}">${p.label}</div>`;
          }).join("")}
        </div>
        <div class="pane-color-picker-sep"></div>
        <div class="pane-color-picker-label">Custom</div>
        <div class="pane-color-picker-custom">
          <label>BG</label>
          <input type="color" id="pane-custom-bg" value="${pane.termBg || (themes[currentThemeIdx] || themes[0]).term.background}">
          <label>Text</label>
          <input type="color" id="pane-custom-fg" value="${pane.termFg || (themes[currentThemeIdx] || themes[0]).term.foreground}">
        </div>
        <div class="pane-color-picker-actions">
          <button id="pane-color-apply-custom" class="primary">Apply Custom</button>
          <button id="pane-color-reset">Reset</button>
        </div>
      `;

      // Preset click handlers
      picker.querySelectorAll(".pane-color-swatch").forEach(swatch => {
        swatch.addEventListener("click", () => {
          applyPaneColor(paneId, swatch.dataset.color);
          picker.classList.remove("visible");
          showToast(swatch.dataset.color ? `Color: ${paneColorPresets[swatch.dataset.color]?.label}` : "Color reset");
        });
      });

      // Custom apply
      picker.querySelector("#pane-color-apply-custom").addEventListener("click", () => {
        const bg = picker.querySelector("#pane-custom-bg").value;
        const fg = picker.querySelector("#pane-custom-fg").value;
        applyPaneColor(paneId, "custom", bg, fg);
        picker.classList.remove("visible");
        showToast("Custom color applied");
      });

      // Reset
      picker.querySelector("#pane-color-reset").addEventListener("click", () => {
        applyPaneColor(paneId, "");
        picker.classList.remove("visible");
        showToast("Color reset");
      });

      picker.classList.add("visible");

      // Position with viewport bounds checking
      requestAnimationFrame(() => {
        const rect = picker.getBoundingClientRect();
        const viewW = window.innerWidth, viewH = window.innerHeight;
        const finalX = (anchorX + rect.width > viewW) ? Math.max(0, viewW - rect.width - 4) : anchorX;
        const finalY = (anchorY + rect.height > viewH) ? Math.max(0, viewH - rect.height - 4) : anchorY;
        picker.style.left = finalX + "px";
        picker.style.top = finalY + "px";
      });
    }

    // Close color picker on outside click
    document.addEventListener("click", (e) => {
      const picker = document.getElementById("pane-color-picker");
      if (picker && picker.classList.contains("visible") && !picker.contains(e.target)) {
        picker.classList.remove("visible");
      }
    });

    // Sanitize a saved terminal buffer for replay. This is tricky because:
    // 1. Alt-screen apps (Claude, vim, less) render to a separate buffer — replaying
    //    their content on the main screen produces garbage. We must skip it entirely.
    // 2. Mode-change sequences (focus reporting, bracketed paste, mouse tracking)
    //    left enabled by previous apps cause phantom input events in the new PTY.
    // 3. Query sequences (DA, DSR, OSC color) trigger xterm to respond, which leaks
    //    response bytes back into the new PTY's input stream.
    function sanitizeReplayBuffer(buf) {
      // Trim any partial escape sequence at the very start (buffer is a tail slice)
      const firstNl = buf.indexOf("\n");
      if (firstNl > 0 && firstNl < 200) buf = buf.slice(firstNl + 1);

      // Walk the buffer, tracking alt-screen state. Skip everything while in alt-screen.
      let out = "";
      let inAlt = false;
      let i = 0;
      const altEnter = /^\x1b\[\?(1049|1047|47)h/;
      const altExit = /^\x1b\[\?(1049|1047|47)l/;
      // Any DEC private mode set/reset — we always drop these (don't want old modes carrying over)
      const decMode = /^\x1b\[\?[\d;]+[hl]/;
      // DA/DSR queries
      const daQuery = /^\x1b\[(>|=|\?)?\d*[cn]/;
      // OSC queries (color etc.)
      const oscQuery = /^\x1b\][\d;]*\?[^\x07\x1b]*(\x07|\x1b\\)/;
      // Cursor save/restore
      const cursorSR = /^\x1b\[[su]/;
      // Application keypad/cursor
      const appMode = /^\x1b[=>]/;

      while (i < buf.length) {
        const rest = buf.slice(i, i + 32);
        let m;
        if ((m = rest.match(altEnter))) {
          inAlt = true;
          i += m[0].length;
          continue;
        }
        if ((m = rest.match(altExit))) {
          inAlt = false;
          i += m[0].length;
          continue;
        }
        if (inAlt) {
          // Skip everything while alt-screen was active
          i++;
          continue;
        }
        if ((m = rest.match(decMode))) { i += m[0].length; continue; }
        if ((m = rest.match(daQuery))) { i += m[0].length; continue; }
        if ((m = rest.match(oscQuery))) { i += m[0].length; continue; }
        if ((m = rest.match(cursorSR))) { i += m[0].length; continue; }
        if ((m = rest.match(appMode))) { i += m[0].length; continue; }
        out += buf[i++];
      }
      return out;
    }

    // Reset sequence to restore terminal to sane defaults after replay
    const RESET_SEQ = "\x1b[?1004l\x1b[?2004l\x1b[?1000l\x1b[?1002l\x1b[?1003l\x1b[?1006l\x1b[?1049l\x1b[?25h\x1b[0m";

    async function createPaneObj(cwd, restoreCmd, replayBuffer, existingId) {
      // If an existing PTY id is provided, reuse it (tmux-like reattach).
      // Otherwise spawn a new PTY via IPC.
      const id = existingId != null
        ? existingId
        : await window.shellfire.createTerminal(cwd, restoreCmd);
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
      header.addEventListener("dragstart", (e) => { isDragging = true; el._dragId = id; e.dataTransfer.effectAllowed = "move"; header.style.opacity = "0.5"; });
      header.addEventListener("dragend", () => { header.style.opacity = ""; isDragging = false; fitAllTerminals(); });
      header.addEventListener("dragover", (e) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; });
      header.addEventListener("dragenter", () => { header.style.borderBottom = "2px solid var(--t-accent)"; });
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
      try { searchAddon = new SearchAddon.SearchAddon(); term.loadAddon(searchAddon); } catch (e) { console.warn("SearchAddon failed:", e.message); }
      try { term.loadAddon(new WebLinksAddon.WebLinksAddon()); } catch (e) { console.warn("WebLinksAddon failed:", e.message); }
      term.open(body);
      // Try WebGL renderer, fall back to canvas if GPU unavailable
      try {
        if (typeof WebglAddon !== "undefined") {
          const webgl = new WebglAddon.WebglAddon();
          webgl.onContextLoss(() => { webgl.dispose(); console.warn("WebGL context lost for pane", id); });
          term.loadAddon(webgl);
        }
      } catch (e) { console.warn("WebGL addon failed, using canvas renderer:", e.message); }

      // Copy on select
      term.onSelectionChange(() => {
        if (copyOnSelect) { const sel = term.getSelection(); if (sel) navigator.clipboard.writeText(sel); }
      });

      term.onData((data) => {
        // Extension hooks (e.g. AI autocomplete)
        let consumed = false;
        for (const fn of _extHooks.terminalInput) {
          if (fn(id, data) === true) { consumed = true; break; }
        }
        if (consumed) return;

        // Track command history
        if (typeof trackCommandInput === "function") trackCommandInput(id, data);

        if (broadcastMode) { window.shellfire.broadcast([...panes.keys()], data); }
        else {
          window.shellfire.sendInput(id, data);
          // Forward to linked panes
          for (const group of linkedGroups) {
            if (group.includes(id)) {
              for (const gid of group) {
                if (gid !== id && panes.has(gid)) window.shellfire.sendInput(gid, data);
              }
            }
          }
        }
      });
      term.textarea.addEventListener("focus", () => setActive(id));

      // Bell notification
      term.onBell(() => {
        if (activeId !== id && !document.hasFocus()) {
          window.shellfire.notify("Terminal Bell", `Terminal ${id} triggered a bell`);
        }
      });

      // Scroll-to-bottom
      const viewport = body.querySelector(".xterm-viewport");
      if (viewport) { viewport.addEventListener("scroll", () => { scrollBtn.classList.toggle("visible", viewport.scrollTop < viewport.scrollHeight - viewport.clientHeight - 10); }); }
      term.onWriteParsed(() => { if (viewport) scrollBtn.classList.toggle("visible", viewport.scrollTop < viewport.scrollHeight - viewport.clientHeight - 10); });
      scrollBtn.addEventListener("click", (e) => { e.stopPropagation(); term.scrollToBottom(); scrollBtn.classList.remove("visible"); term.focus(); });

      body.addEventListener("contextmenu", (e) => { e.preventDefault(); showContextMenu(e.clientX, e.clientY, id); });

      // External file/folder drop: paste path into terminal
      body.addEventListener("dragover", (e) => {
        if (e.dataTransfer.types.includes("Files")) {
          e.preventDefault();
          e.dataTransfer.dropEffect = "copy";
        }
      });
      body.addEventListener("drop", (e) => {
        if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
          e.preventDefault();
          const paths = [...e.dataTransfer.files].map(f => {
            const p = f.path;
            if (!p) return null;
            if (/[\s'"\\$`!#&|;(){}[\]*?<>~]/.test(p)) return `'${p.replace(/'/g, "'\\''")}'`;
            return p;
          }).filter(Boolean);
          if (paths.length > 0) {
            window.shellfire.sendInput(id, paths.join(" "));
            term.focus();
          }
        }
      });

      const titleEl = header.querySelector(".pane-title");
      const indicatorEl = header.querySelector(".pane-indicator");
      const envBadgeEl = header.querySelector(".env-badge");
      const paneNumberEl = header.querySelector(".pane-number");
      const activityDot = header.querySelector(".activity-dot");
      const gitBadge = header.querySelector(".git-badge");
      const gitBranchName = header.querySelector(".git-branch-name");
      const paneObj = { el, term, fitAddon, searchAddon, titleEl, indicatorEl, envBadgeEl, paneNumberEl, activityDot, gitBadge, gitBranchName, customName: null, locked: false, color: "", termBg: null, termFg: null, createdAt: Date.now(), rawBuffer: "" };
      // If restoring a session, hold PTY data until rawBuffer is replayed
      if (replayBuffer) paneObj._replayPending = true;
      panes.set(id, paneObj);
      return id;
    }

    async function addTerminal(cwd) {
      const id = await createPaneObj(cwd);
      if (ideMode) {
        // In IDE mode, new terminals show fullscreen
        // Add to normal layout too (for when user exits IDE mode)
        layout.push({ flex: 1, cols: [{ flex: 1, paneId: id }] });
        ideVisiblePanes = [id];
        setActive(id);
        renderLayout();
      } else {
        setActive(id); rebuildLayout();
      }
      // Auto-name: give it a quick initial name based on cwd, then refine after shell starts
      if (cwd) {
        const pane = panes.get(id);
        if (pane) {
          const short = cwd.replace(/^\/Users\/[^/]+/, "~").replace(/^\/home\/[^/]+/, "~");
          pane.customName = short;
          if (pane.titleEl) pane.titleEl.textContent = short;
        }
      }
      // Refine name once the process is running
      setTimeout(async () => {
        const pane = panes.get(id);
        if (pane && !pane._userRenamed) {
          const smart = await getSmartName(id);
          if (smart) { pane.customName = smart; if (pane.titleEl) pane.titleEl.textContent = smart; }
        }
        updateIdeSidebar();
      }, 800);
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
      paneStatsHistory.delete(id);
      paneLineBufs.delete(id);
      paneErrorDebounce.delete(id);
      window.shellfire.kill(id); pane.term.dispose(); panes.delete(id);
      if (activeId === id) { const r = [...panes.keys()]; activeId = r.length > 0 ? r[r.length - 1] : null; }
      for (let ri = layout.length - 1; ri >= 0; ri--) { layout[ri].cols = layout[ri].cols.filter(c => c.paneId !== id); if (layout[ri].cols.length === 0) layout.splice(ri, 1); }
      // IDE mode: remove from visible panes, show next terminal fullscreen
      if (ideMode) {
        ideVisiblePanes = ideVisiblePanes.filter(pid => pid !== id);
        if (ideVisiblePanes.length === 0 && activeId) ideVisiblePanes = [activeId];
      }
      renderLayout();
      if (activeId !== null) setActive(activeId);
      updateWelcomeScreen();
      if (typeof scheduleEnrichTabData === "function") scheduleEnrichTabData();
      if (typeof scheduleSmartNames === "function") scheduleSmartNames();
      setTimeout(() => updateIdeSidebar(), 100);
    }

    // ============================================================
    // IPC
    // ============================================================

    window.shellfire.onData((id, data) => {
      const pane = panes.get(id);
      if (!pane) return;
      // While replaying saved buffer, queue incoming PTY data to prevent interleaving
      if (pane._replayPending) {
        if (!pane._replayQueue) pane._replayQueue = [];
        pane._replayQueue.push(data);
        return;
      }
      pane.term.write(data);
      // Accumulate raw output for session restore using chunked array
      if (!pane._rawChunks) pane._rawChunks = [];
      pane._rawChunks.push(data);
      pane._rawSize = (pane._rawSize || 0) + data.length;
      // Compact when over limit or too many chunks (prevent unbounded array growth)
      if (pane._rawSize > bufferLimit || pane._rawChunks.length > 500) {
        const joined = pane._rawChunks.join("");
        pane.rawBuffer = joined.slice(-bufferLimit);
        pane._rawChunks = [pane.rawBuffer];
        pane._rawSize = pane.rawBuffer.length;
      }
      // Activity dot for inactive panes
      if (id !== activeId && pane.activityDot) pane.activityDot.classList.add("visible");
      // Keyword watcher
      checkKeywords(id, data);
      // AI Error detection
      if (typeof detectErrors === "function") detectErrors(id, data);
      // Terminal logging
      if (loggingPanes.has(id)) {
        window.shellfire.logAppend(id, data.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "")); // strip ANSI
      }
    });
    window.shellfire.onExit((id, exitCode) => {
      const pane = panes.get(id); if (!pane) return;
      pane.term.write("\r\n\x1b[90m[Process exited]\x1b[0m\r\n");
      const name = pane.customName || `Terminal ${id}`;
      if (id !== activeId || !document.hasFocus()) {
        window.shellfire.notify("Process Finished", `${name} exited (code ${exitCode || 0})`);
        showToast(`${name} exited`);
      }
      setTimeout(() => removeTerminal(id), 1500);
    });

    // ============================================================
    // SEARCH
    // ============================================================
    const searchBar = document.getElementById("search-bar"), searchInput = document.getElementById("search-input");
    const searchAllToggle = document.getElementById("search-all-toggle");
    const searchMatchInfo = document.getElementById("search-match-info");
    let searchAllMode = false;
    let searchAllMatches = [];
    let searchAllIdx = 0;

    searchAllToggle.addEventListener("click", () => {
      searchAllMode = !searchAllMode;
      searchAllToggle.classList.toggle("active", searchAllMode);
      searchInput.placeholder = searchAllMode ? "Search all panes..." : "Search in terminal...";
      if (searchAllMode && searchInput.value) searchAllPanes(searchInput.value);
      else { searchMatchInfo.textContent = ""; for (const [, p] of panes) { try { p.searchAddon?.clearDecorations(); } catch {} } }
    });

    function searchAllPanes(query) {
      searchAllMatches = []; searchAllIdx = 0;
      if (!query) { searchMatchInfo.textContent = ""; for (const [, p] of panes) { try { p.searchAddon?.clearDecorations(); } catch {} } return; }
      for (const [id, pane] of panes) {
        try { if (pane.searchAddon?.findNext(query)) searchAllMatches.push(id); } catch {}
      }
      if (searchAllMatches.length > 0) {
        searchMatchInfo.textContent = `${searchAllMatches.length} pane${searchAllMatches.length > 1 ? "s" : ""}`;
        setActive(searchAllMatches[0]);
      } else {
        searchMatchInfo.textContent = "No matches";
      }
    }

    function searchAllNav(dir) {
      if (searchAllMatches.length === 0) return;
      const cur = panes.get(activeId);
      if (cur) { const found = dir > 0 ? cur.searchAddon?.findNext(searchInput.value) : cur.searchAddon?.findPrevious(searchInput.value); if (found) return; }
      const ci = searchAllMatches.indexOf(activeId);
      searchAllIdx = (ci + dir + searchAllMatches.length) % searchAllMatches.length;
      setActive(searchAllMatches[searchAllIdx]);
      const p = panes.get(searchAllMatches[searchAllIdx]);
      if (p) dir > 0 ? p.searchAddon?.findNext(searchInput.value) : p.searchAddon?.findPrevious(searchInput.value);
    }

    function openSearch() { searchBar.classList.add("visible"); searchInput.focus(); searchInput.select(); }
    function closeSearch() {
      searchBar.classList.remove("visible"); searchMatchInfo.textContent = "";
      for (const [, p] of panes) { try { p.searchAddon?.clearDecorations(); } catch {} }
      if (activeId && panes.has(activeId)) panes.get(activeId).term.focus();
    }
    searchInput.addEventListener("input", () => {
      if (searchAllMode) searchAllPanes(searchInput.value);
      else if (activeId && panes.has(activeId)) panes.get(activeId).searchAddon?.findNext(searchInput.value);
    });
    searchInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        if (searchAllMode) { searchAllNav(e.shiftKey ? -1 : 1); }
        else if (activeId && panes.has(activeId)) { e.shiftKey ? panes.get(activeId).searchAddon?.findPrevious(searchInput.value) : panes.get(activeId).searchAddon?.findNext(searchInput.value); }
      } else if (e.key === "Escape") closeSearch();
    });
    document.getElementById("search-next").addEventListener("click", () => { searchAllMode ? searchAllNav(1) : (activeId && panes.has(activeId) && panes.get(activeId).searchAddon?.findNext(searchInput.value)); });
    document.getElementById("search-prev").addEventListener("click", () => { searchAllMode ? searchAllNav(-1) : (activeId && panes.has(activeId) && panes.get(activeId).searchAddon?.findPrevious(searchInput.value)); });
    document.getElementById("search-close").addEventListener("click", closeSearch);

    // ============================================================
    // CONTEXT MENU
    // ============================================================
    const contextMenuEl = document.getElementById("context-menu");
    function showContextMenu(x, y, paneId) {
      const pane = panes.get(paneId);
      const items = [
        { label: "Copy", shortcut: "Cmd+C", action: () => { if (pane) { const s = pane.term.getSelection(); if (s) navigator.clipboard.writeText(s); } }},
        { label: "Paste", shortcut: "Cmd+V", action: async () => { const t = await navigator.clipboard.readText(); if (t) window.shellfire.sendInput(paneId, t); }},
        { sep: true },
        { label: "Clear", shortcut: "Cmd+K", action: () => { if (pane) { pane.term.clear(); pane.term.focus(); } }},
        { label: "Rename Pane", action: () => renamePaneUI(paneId) },
        { label: "Color: " + (pane?.color || "none"), action: () => openPaneColorPicker(paneId, x, y) },
        { label: pane?.locked ? "Unlock Pane" : "Lock Pane", action: () => togglePaneLock(paneId) },
        { label: "Save Output", action: () => captureOutput(paneId) },
        { label: floatingPanes.has(paneId) ? "Restore from PiP" : "Float Pane (PiP)", action: () => toggleFloating(paneId) },
        { label: loggingPanes.has(paneId) ? "Stop Logging" : "Start Logging", action: () => toggleLogging(paneId) },
        { sep: true },
        { label: "Split Right", shortcut: "Cmd+D", action: () => { setActive(paneId); splitPane("horizontal"); }},
        { label: "Split Down", shortcut: "Cmd+Shift+D", action: () => { setActive(paneId); splitPane("vertical"); }},
        { label: "Zoom Pane", shortcut: "Cmd+Shift+Enter", action: () => { setActive(paneId); toggleZoom(); }},
        { sep: true },
        ..._extHooks.contextMenu.flatMap(fn => fn(paneId) || []),
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
      contextMenuEl.classList.add("visible");
      // Position with viewport bounds checking
      const menuRect = contextMenuEl.getBoundingClientRect();
      const viewW = window.innerWidth, viewH = window.innerHeight;
      const finalX = (x + menuRect.width > viewW) ? Math.max(0, viewW - menuRect.width - 4) : x;
      const finalY = (y + menuRect.height > viewH) ? Math.max(0, viewH - menuRect.height - 4) : y;
      contextMenuEl.style.left = finalX + "px"; contextMenuEl.style.top = finalY + "px";
    }
    document.addEventListener("click", () => contextMenuEl.classList.remove("visible"));

    // ============================================================
    // SNIPPETS
    // ============================================================
    function openSnippetRunner() {
      if (_paletteCleanup) { _paletteCleanup(); _paletteCleanup = null; }
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
          results.innerHTML = `<div class="palette-item"><span class="palette-item-label" style="color:color-mix(in srgb, var(--t-fg) 50%, transparent)">${snippets.length === 0 ? "No snippets yet. Type new:name:command to add one" : "No matches"}</span></div>`;
          return;
        }
        filtered.forEach((s, i) => {
          const el = document.createElement("div"); el.className = "palette-item" + (i === selected ? " selected" : "");
          el.innerHTML = `<span class="palette-item-label">${s.name}<span class="palette-item-sub">${s.command}</span></span><span class="palette-item-shortcut" style="cursor:pointer" data-del="${i}">&#x2716;</span>`;
          el.addEventListener("click", () => { overlay.classList.remove("visible"); input.placeholder = "Type a command..."; if (activeId) window.shellfire.sendInput(activeId, s.command + "\n"); });
          el.querySelector("[data-del]").addEventListener("click", (ev) => { ev.stopPropagation(); snippets.splice(snippets.indexOf(s), 1); window.shellfire.saveSnippets(snippets); render(input.value); showToast("Snippet deleted"); });
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
            const parts = val.slice(4).split(":"); if (parts.length >= 2) { snippets.push({ name: parts[0].trim(), command: parts.slice(1).join(":").trim() }); window.shellfire.saveSnippets(snippets); showToast("Snippet saved"); }
          } else {
            const items = results.querySelectorAll(".palette-item"); items[selected]?.click();
          }
          overlay.classList.remove("visible"); input.placeholder = "Type a command..."; input.removeEventListener("keydown", handler); input.removeEventListener("input", inputHandler);
        }
        if (e.key === "ArrowDown") { e.preventDefault(); selected = Math.min(selected + 1, Math.max(0, results.querySelectorAll(".palette-item").length - 1)); render(input.value); }
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
      if (_paletteCleanup) { _paletteCleanup(); _paletteCleanup = null; }
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
          results.innerHTML = `<div class="palette-item"><span class="palette-item-label" style="color:color-mix(in srgb, var(--t-fg) 50%, transparent)">${profiles.length === 0 ? 'No profiles. Type save:name to save current layout' : 'No matches'}</span></div>`;
          return;
        }
        filtered.forEach((p, i) => {
          const el = document.createElement("div"); el.className = "palette-item" + (i === selected ? " selected" : "");
          el.innerHTML = `<span class="palette-item-label">${p.name}<span class="palette-item-sub">${p.panes.length} panes</span></span><span class="palette-item-shortcut" style="cursor:pointer" data-del="${i}">&#x2716;</span>`;
          el.addEventListener("click", () => { overlay.classList.remove("visible"); input.placeholder = "Type a command..."; loadProfile(p); });
          el.querySelector("[data-del]").addEventListener("click", (ev) => { ev.stopPropagation(); profiles.splice(profiles.indexOf(p), 1); window.shellfire.saveProfiles(profiles); render(input.value); showToast("Profile deleted"); });
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
        if (e.key === "ArrowDown") { e.preventDefault(); selected = Math.min(selected + 1, Math.max(0, results.querySelectorAll(".palette-item").length - 1)); render(input.value); }
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
        const cwd = await window.shellfire.getCwd(id);
        const proc = await window.shellfire.getProcess(id);
        paneDefs.push({ cwd: cwd || null, command: proc && proc !== "zsh" && proc !== "bash" ? proc : null });
      }
      profiles.push({ name, panes: paneDefs });
      window.shellfire.saveProfiles(profiles);
      showToast(`Profile "${name}" saved (${paneDefs.length} panes)`);
    }

    async function loadProfile(profile) {
      // Close all existing panes
      for (const [id] of [...panes]) removeTerminal(id);
      // Create panes from profile
      for (const p of profile.panes) {
        const id = await createPaneObj(p.cwd);
        if (p.command) setTimeout(() => window.shellfire.sendInput(id, p.command + "\n"), 200);
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
      { label: "Toggle Fullscreen", action: () => window.shellfire.toggleFullscreen(), category: "Layout" },
      { label: "Zen Mode (All Monitors)", shortcut: "Cmd+Shift+Z", action: () => toggleZenMode(), category: "View" },
      // Pane
      { label: "Rename Pane", action: () => { if (activeId) renamePaneUI(activeId); }, category: "Pane" },
      { label: "Lock/Unlock Pane", action: () => { if (activeId) togglePaneLock(activeId); }, category: "Pane" },
      { label: "Cycle Pane Color", action: () => { if (activeId) cyclePaneColor(activeId); }, category: "Pane" },
      { label: "Save Pane Output", action: () => captureOutput(), category: "Pane" },
      // Search & Find
      { label: "Find in Terminal", shortcut: "Cmd+F", action: () => openSearch(), category: "Search" },
      { label: "Find in All Panes", shortcut: "Cmd+Shift+G", action: () => { searchAllMode = true; searchAllToggle.classList.add("active"); searchInput.placeholder = "Search all panes..."; openSearch(); }, category: "Search" },
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
      { label: "Connect to Remote", action: () => openRemoteConnect(), category: "Tools" },
      { label: "Docker Containers", action: () => openDockerPanel(), category: "Tools" },
      { label: "Port Manager", shortcut: "Cmd+Shift+P", action: () => openPortPanel(), category: "Tools" },
      { label: "Command History Search", shortcut: "Ctrl+R", action: () => openHistorySearch(), category: "Search" },
      { label: "Pipeline Runner", action: () => openPipelinePanel(), category: "Tools" },
      { label: "Command Bookmarks", action: () => openCmdBookmarksPanel(), category: "Tools" },
      { label: "Bookmark Current Command", action: () => bookmarkLastCommand(), category: "Tools" },
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
      { label: "Toggle AI Suggestions", action: () => { aiSuggestions = !aiSuggestions; settings.aiSuggestions = aiSuggestions; window.shellfire.saveSettings(settings); showToast(aiSuggestions ? "AI suggestions ON" : "AI suggestions OFF"); }, category: "Tools" },
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
        action: async () => { const id = await addTerminal(p.path); if (id !== undefined) setTimeout(() => launchClaude(id), 150); }
      })),
      // View
      { label: "Toggle IDE Mode", shortcut: "Cmd+Shift+I", action: () => toggleIdeMode(), category: "View" },
      // System
      { label: "Quit", shortcut: "Cmd+Q", action: () => window.shellfire.quit(), category: "System" },
    ];

    function openPalette() {
      // Clean up any existing palette handlers before opening a new one
      if (_paletteCleanup) { _paletteCleanup(); _paletteCleanup = null; }
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
          header.style.cssText = "padding:6px 16px 2px;font-size:10px;color:color-mix(in srgb, var(--t-fg) 40%, transparent);font-weight:600;letter-spacing:0.5px;text-transform:uppercase;";
          if (i > 0) header.style.borderTop = "1px solid var(--t-border)";
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
        // Fetch fresh CWD and process info (async IPC)
        try {
          pane._lastCwd = await window.shellfire.getCwd(id) || pane._lastCwd || null;
        } catch {}
        try {
          const proc = await window.shellfire.getProcessTree(id);
          if (proc && proc.args) {
            const comm = (proc.comm || "").split("/").pop();
            if (comm && comm !== "zsh" && comm !== "bash" && comm !== "fish" && comm !== "sh") {
              pane._lastRestoreCmd = proc.args;
            } else {
              pane._lastRestoreCmd = null;
            }
          }
        } catch {}
        // Compact raw chunks into rawBuffer
        if (pane._rawChunks && pane._rawChunks.length > 0) {
          pane.rawBuffer = pane._rawChunks.join("").slice(-bufferLimit);
        }
        paneStates.push({
          cwd: pane._lastCwd || null,
          customName: pane.customName || null,
          userRenamed: pane._userRenamed || false,
          color: pane.color || "",
          termBg: pane.termBg || null,
          termFg: pane.termFg || null,
          locked: pane.locked || false,
          rawBuffer: pane.rawBuffer || "",
          restoreCmd: pane._lastRestoreCmd || null,
        });
      }
      window.shellfire.saveSession({
        version: 2,
        layout: JSON.parse(JSON.stringify(layout)),
        paneStates,
        theme: currentThemeIdx,
        themeName: (themes[currentThemeIdx] || themes[0]).name,
        fontSize: currentFontSize,
        broadcastMode,
        skipPermissions,
      });
      if (!silent) showToast("Session saved");
    }

    // Fast synchronous save for beforeunload — uses cached CWD/process, no async IPC
    function saveCurrentSessionSync() {
      const paneStates = [];
      for (const [id] of panes) {
        const pane = panes.get(id);
        if (pane._rawChunks && pane._rawChunks.length > 0) {
          pane.rawBuffer = pane._rawChunks.join("").slice(-bufferLimit);
        }
        paneStates.push({
          cwd: pane._lastCwd || null,
          customName: pane.customName || null,
          userRenamed: pane._userRenamed || false,
          color: pane.color || "",
          termBg: pane.termBg || null,
          termFg: pane.termFg || null,
          locked: pane.locked || false,
          rawBuffer: pane.rawBuffer || "",
          restoreCmd: pane._lastRestoreCmd || null,
        });
      }
      window.shellfire.saveSession({
        version: 2,
        layout: JSON.parse(JSON.stringify(layout)),
        paneStates,
        theme: currentThemeIdx,
        themeName: (themes[currentThemeIdx] || themes[0]).name,
        fontSize: currentFontSize,
        broadcastMode,
        skipPermissions,
      });
    }

    async function restoreSession() {
      try {
        const session = await window.shellfire.loadSession();
        if (!session) {
          showToast("No saved session found");
          if (panes.size === 0) await addTerminal();
          return;
        }

        // Close existing panes
        for (const [id] of [...panes]) removeTerminal(id);

        // V2 format: full pane states with scrollback
        if (session.version === 2 && session.paneStates && session.paneStates.length > 0) {
          let failedCount = 0;
          for (const ps of session.paneStates) {
            let id;
            const hasBuffer = !!ps.rawBuffer;
            try { id = await createPaneObj(ps.cwd, ps.restoreCmd || null, hasBuffer); } catch (e) {
              console.error("Failed to restore pane:", e);
              failedCount++;
              continue;
            }
            const pane = panes.get(id);
            if (pane) {
              if (hasBuffer) {
                const sanitized = sanitizeReplayBuffer(ps.rawBuffer);
                pane.term.write(sanitized);
                pane.term.write(RESET_SEQ);
                pane.rawBuffer = ps.rawBuffer;
                pane._rawChunks = [ps.rawBuffer];
                pane._rawSize = ps.rawBuffer.length;
                pane._replayPending = false;
                if (pane._replayQueue) {
                  for (const chunk of pane._replayQueue) pane.term.write(chunk);
                  pane._replayQueue = null;
                }
              }
              // Restore pane metadata
              if (ps.customName) {
                pane.customName = ps.customName;
                pane.titleEl.textContent = ps.customName;
              }
              if (ps.color) {
                applyPaneColor(id, ps.color, ps.termBg || null, ps.termFg || null);
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
          const restoredCount = session.paneStates.length - failedCount;
          if (failedCount > 0) {
            showToast(`Session restored (${restoredCount}/${session.paneStates.length} panes — ${failedCount} failed)`, "error");
          } else {
            showToast(`Session restored (${restoredCount} panes with scrollback)`);
          }

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
      if (activeId) { try { cwd = await window.shellfire.getCwd(activeId); } catch {} }
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

        // Process info (escape for safe innerHTML insertion)
        const proc = p?._lastProcess;
        const procHtml = proc && proc !== "zsh" && proc !== "bash" && proc !== "fish" ? `<span class="tab-process">${escHtml(proc)}</span>` : "";

        // Git info
        const branch = p?._lastGitBranch;
        const dirty = p?._lastGitDirty;
        const gitHtml = branch ? `<span class="tab-git${dirty ? " dirty" : ""}">${escHtml(branch)}</span>` : "";

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

        tab.innerHTML = `<span class="tab-num">${i < 9 ? i + 1 : ""}</span><span class="tab-dot ${dotClass}"></span>${escHtml(shortName)}${procHtml}${gitHtml}${durationHtml}<button class="tab-close">&times;</button>`;
        tab.addEventListener("click", (e) => { if (!e.target.classList.contains("tab-close")) setActive(id); });
        tab.querySelector(".tab-close").addEventListener("click", (e) => { e.stopPropagation(); removeTerminal(id); });
        tab.addEventListener("dblclick", (e) => { e.preventDefault(); renamePaneUI(id); });
        tab.addEventListener("contextmenu", (e) => { e.preventDefault(); showContextMenu(e.clientX, e.clientY, id); });
        tabbar.appendChild(tab);
      });
    }

    // Enrich tab data periodically (process, git, duration)
    // Batches concurrent IPC calls (max 5 at a time) and scales interval with pane count
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
                window.shellfire.getGitBranch(cwd),
                window.shellfire.getGitStatus(cwd),
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
        }));
      }
      updateTabBar();
    }
    // Scale interval with pane count: 5s base, +1s per pane above 5
    let enrichTimer = null;
    function scheduleEnrichTabData() {
      if (enrichTimer) clearInterval(enrichTimer);
      const interval = Math.min(5000 + Math.max(0, panes.size - 5) * 1000, 15000);
      enrichTimer = setInterval(enrichTabData, interval);
    }
    setTimeout(() => { scheduleEnrichTabData(); enrichTabData(); }, 2000);

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
      const jobs = await window.shellfire.cronList();
      cronBody.innerHTML = "";
      if (!jobs || jobs.length === 0) {
        cronBody.innerHTML = '<div class="cron-empty">No cron jobs found</div>';
        return;
      }
      jobs.forEach((job, i) => {
        const el = document.createElement("div"); el.className = "cron-item";
        el.innerHTML = `<span class="cron-item-line" title="${job.line}">${job.line}</span><button class="cron-item-del" data-idx="${i}"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>`;
        el.querySelector(".cron-item-del").addEventListener("click", async () => {
          await window.shellfire.cronRemove(i);
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
      const ok = await window.shellfire.cronAdd(line);
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
      try { const saved = await window.shellfire.loadRecents(); if (Array.isArray(saved)) recentDirs = saved; } catch {}
    }

    async function trackRecentDir(id) {
      try {
        const cwd = await window.shellfire.getCwd(id);
        if (!cwd) return;
        recentDirs = recentDirs.filter(d => d !== cwd);
        recentDirs.unshift(cwd);
        if (recentDirs.length > MAX_RECENTS) recentDirs = recentDirs.slice(0, MAX_RECENTS);
        window.shellfire.saveRecents(recentDirs);
      } catch {}
    }

    function openRecentDirs() {
      if (_paletteCleanup) { _paletteCleanup(); _paletteCleanup = null; }
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
          results.innerHTML = `<div class="palette-item"><span class="palette-item-label" style="color:color-mix(in srgb, var(--t-fg) 50%, transparent)">${recentDirs.length === 0 ? "No recent directories yet" : "No matches"}</span></div>`;
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
        if (e.key === "ArrowDown") { e.preventDefault(); selected = Math.min(selected + 1, Math.max(0, results.querySelectorAll(".palette-item").length - 1)); render(input.value); }
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
      if (_paletteCleanup) { _paletteCleanup(); _paletteCleanup = null; }
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
        results.innerHTML = '<div class="palette-item"><span class="palette-item-label" style="color:color-mix(in srgb, var(--t-fg) 50%, transparent)">No projects configured. Add projects via the Projects dropdown first.</span></div>';
        return;
      }

      async function doSearch(q) {
        if (!q || q.length < 2) { results.innerHTML = '<div class="palette-item"><span class="palette-item-label" style="color:color-mix(in srgb, var(--t-fg) 50%, transparent)">Type at least 2 characters to search...</span></div>'; return; }
        results.innerHTML = '<div class="palette-item"><span class="palette-item-label" style="color:color-mix(in srgb, var(--t-fg) 50%, transparent)">Searching...</span></div>';
        try {
          const files = await window.shellfire.findFiles(q, searchDirs);
          selected = 0;
          results.innerHTML = "";
          if (!files || files.length === 0) { results.innerHTML = '<div class="palette-item"><span class="palette-item-label" style="color:color-mix(in srgb, var(--t-fg) 50%, transparent)">No files found</span></div>'; return; }
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
        } catch { results.innerHTML = '<div class="palette-item"><span class="palette-item-label" style="color:color-mix(in srgb, var(--t-fg) 50%, transparent)">Search failed</span></div>'; }
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
      const savedPath = await window.shellfire.saveOutput(content, name);
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
        window.shellfire.sendInput(targetId, text);
        return;
      }
      pendingPaste = { text, targetId };
      pasteLineCountEl.textContent = lines.length;
      pastePreviewEl.textContent = lines.slice(0, 20).join("\n") + (lines.length > 20 ? "\n..." : "");
      pasteConfirmEl.classList.add("visible");
    }

    document.getElementById("paste-ok").addEventListener("click", () => {
      if (pendingPaste) window.shellfire.sendInput(pendingPaste.targetId, pendingPaste.text);
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
            window.shellfire.sendInput(activeId, cmd + "\n");
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
        isDragging = true;
        dragTabId = paneId;
        e.dataTransfer.effectAllowed = "move";
        tabEl.style.opacity = "0.4";
      });
      tabEl.addEventListener("dragend", () => {
        tabEl.style.opacity = "";
        dragTabId = null;
        isDragging = false;
        document.querySelectorAll(".tab").forEach(t => t.classList.remove("drag-over"));
        fitAllTerminals();
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
    // btn-skip-perms now injected by claude-ai extension
    const _btnSkipPerms = document.getElementById("btn-skip-perms");
    if (_btnSkipPerms) _btnSkipPerms.addEventListener("click", toggleSkipPermissions);
    document.getElementById("btn-broadcast").addEventListener("click", toggleBroadcast);
    document.getElementById("btn-search").addEventListener("click", openSearch);
    document.getElementById("btn-palette").addEventListener("click", openPalette);
    document.getElementById("btn-theme").addEventListener("click", cycleTheme);
    document.getElementById("btn-ports").addEventListener("click", () => openPortPanel());
    document.getElementById("btn-pipeline").addEventListener("click", openPipelinePanel);
    document.getElementById("btn-cmd-bookmarks").addEventListener("click", openCmdBookmarksPanel);
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
          if (id !== undefined) setTimeout(() => launchClaude(id), 150);
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
      window.shellfire.saveProjects(launchProjects);
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
        action: async () => { const id = await addTerminal(p.path); if (id !== undefined) setTimeout(() => launchClaude(id), 150); }
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
      const saved = await window.shellfire.loadProjects();
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

    // Welcome screen tab navigation
    document.querySelectorAll(".welcome-nav-item").forEach(btn => {
      btn.addEventListener("click", () => {
        document.querySelectorAll(".welcome-nav-item").forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
        const tab = btn.dataset.tab;
        document.querySelectorAll(".welcome-section").forEach(s => s.style.display = "none");
        const section = document.getElementById("welcome-section-" + tab);
        if (section) section.style.display = "";
      });
    });

    // Welcome remote connect button
    const welcomeRemoteBtn = document.getElementById("welcome-remote-connect");
    if (welcomeRemoteBtn) welcomeRemoteBtn.addEventListener("click", () => openRemoteConnect());

    // Welcome customize controls
    const welcomeThemeSelect = document.getElementById("welcome-theme-select");
    if (welcomeThemeSelect) {
      themes.forEach((t, i) => {
        const opt = document.createElement("option");
        opt.value = i; opt.textContent = t.name;
        if (i === currentThemeIdx) opt.selected = true;
        welcomeThemeSelect.appendChild(opt);
      });
      welcomeThemeSelect.addEventListener("change", () => applyTheme(parseInt(welcomeThemeSelect.value)));
    }
    const welcomeFontSize = document.getElementById("welcome-font-size");
    if (welcomeFontSize) {
      welcomeFontSize.value = currentFontSize;
      welcomeFontSize.addEventListener("change", () => setFontSize(parseInt(welcomeFontSize.value)));
    }
    const welcomeIdeToggle = document.getElementById("welcome-ide-toggle");
    if (welcomeIdeToggle) {
      welcomeIdeToggle.checked = ideMode;
      welcomeIdeToggle.addEventListener("change", () => toggleIdeMode());
    }

    // Welcome version
    window.shellfire.getAppVersion().then(v => {
      const el = document.getElementById("welcome-version");
      if (el) el.textContent = `v${v}`;
    }).catch(() => {});

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
      else if (meta && e.key === "q") { e.preventDefault(); window.shellfire.quit(); }
      else if (meta && e.shiftKey && (e.key === "P" || e.key === "p")) { e.preventDefault(); openPortPanel(); }
      else if (meta && e.shiftKey && (e.key === "F" || e.key === "f")) { e.preventDefault(); openFileFinder(); }
      else if (meta && e.key === "f") { e.preventDefault(); openSearch(); }
      else if (meta && e.key === "p") { e.preventDefault(); openPalette(); }
      else if (e.ctrlKey && e.key === "r") { e.preventDefault(); openHistorySearch(); }
      else if (meta && e.key === "k") { e.preventDefault(); if (activeId && panes.has(activeId)) { panes.get(activeId).term.clear(); panes.get(activeId).term.focus(); } }
      else if (meta && e.shiftKey && e.key === "Enter") { e.preventDefault(); toggleZoom(); }
      else if (meta && e.shiftKey && (e.key === "B" || e.key === "b")) { e.preventDefault(); toggleBroadcast(); }
      else if (meta && e.shiftKey && (e.key === "R" || e.key === "r")) { e.preventDefault(); openSnippetRunner(); }
      else if (meta && (e.key === "=" || e.key === "+")) { e.preventDefault(); zoomIn(); }
      else if (meta && e.key === "-") { e.preventDefault(); zoomOut(); }
      else if (meta && e.key === "0") { e.preventDefault(); zoomReset(); }
      else if (meta && e.key === "ArrowRight") { e.preventDefault(); navigatePane(1); }
      else if (meta && e.key === "ArrowLeft") { e.preventDefault(); navigatePane(-1); }
      else if (meta && e.key === "ArrowDown") { e.preventDefault(); navigatePaneVertical(1); }
      else if (meta && e.key === "ArrowUp") { e.preventDefault(); navigatePaneVertical(-1); }
      else if (meta && e.shiftKey && (e.key === "S" || e.key === "s")) { e.preventDefault(); saveCurrentSession(); }
      else if (meta && e.shiftKey && (e.key === "X" || e.key === "x")) { e.preventDefault(); closeAllOthers(); }
      else if (meta && e.shiftKey && (e.key === "I" || e.key === "i")) { e.preventDefault(); toggleIdeMode(); }
      else if (meta && e.shiftKey && (e.key === "Z" || e.key === "z")) { e.preventDefault(); toggleZenMode(); }
      else if (e.key === "Escape" && zenMode) { e.preventDefault(); toggleZenMode(); }
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

    // Keyword watcher state (checkKeywords is called from the onData handler above)
    let watcherEnabled = false;

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
              window.shellfire.notify("Keyword Alert", `"${kw.pattern}" detected in ${name}`);
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
      try { const saved = await window.shellfire.loadSsh(); if (Array.isArray(saved)) sshBookmarks = saved; } catch {}
    }

    function openSshManager() {
      if (_paletteCleanup) { _paletteCleanup(); _paletteCleanup = null; }
      const overlay = document.getElementById("palette-overlay");
      const input = document.getElementById("palette-input");
      const results = document.getElementById("palette-results");
      overlay.classList.add("visible");
      input.placeholder = "Search SSH bookmarks... (new name user@host[:port] to add)";
      input.value = ""; input.focus();
      let selected = 0;

      function render(q) {
        const qq = q.toLowerCase();
        const filtered = qq ? sshBookmarks.filter(s => s.name.toLowerCase().includes(qq) || s.host.toLowerCase().includes(qq)) : sshBookmarks;
        selected = Math.min(selected, Math.max(0, filtered.length - 1));
        results.innerHTML = "";
        if (filtered.length === 0) {
          results.innerHTML = `<div class="palette-item"><span class="palette-item-label" style="color:color-mix(in srgb, var(--t-fg) 50%, transparent)">${sshBookmarks.length === 0 ? "No SSH bookmarks. Type new:name:user@host to add" : "No matches"}</span></div>`;
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
            window.shellfire.saveSsh(sshBookmarks);
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
          if (val.startsWith("new ") || val.startsWith("new:")) {
            // Parse: "new name user@host[:port]" or legacy "new:name:user@host"
            const raw = val.startsWith("new ") ? val.slice(4) : val.slice(4);
            // Split on first space to get name and host part
            const spaceIdx = raw.indexOf(" ");
            if (spaceIdx > 0) {
              const name = raw.slice(0, spaceIdx).trim();
              const hostPart = raw.slice(spaceIdx + 1).trim();
              const portMatch = hostPart.match(/:(\d+)$/);
              const port = portMatch ? parseInt(portMatch[1]) : 22;
              const host = portMatch ? hostPart.replace(/:(\d+)$/, "") : hostPart;
              sshBookmarks.push({ name, host, port });
              window.shellfire.saveSsh(sshBookmarks);
              showToast("SSH bookmark saved");
            } else {
              // Legacy colon format: new:name:user@host
              const parts = raw.split(":");
              if (parts.length >= 2) {
                const name = parts[0].trim();
                const hostPart = parts.slice(1).join(":").trim();
                const portMatch = hostPart.match(/:(\d+)$/);
                const port = portMatch ? parseInt(portMatch[1]) : 22;
                const host = portMatch ? hostPart.replace(/:(\d+)$/, "") : hostPart;
                sshBookmarks.push({ name, host, port });
                window.shellfire.saveSsh(sshBookmarks);
                showToast("SSH bookmark saved");
              }
            }
          } else {
            const items = results.querySelectorAll(".palette-item"); items[selected]?.click();
          }
          overlay.classList.remove("visible"); input.placeholder = "Type a command...";
          input.removeEventListener("keydown", handler); input.removeEventListener("input", inputHandler);
        }
        if (e.key === "ArrowDown") { e.preventDefault(); selected = Math.min(selected + 1, Math.max(0, results.querySelectorAll(".palette-item").length - 1)); render(input.value); }
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
      setTimeout(() => window.shellfire.sendInput(id, cmd + "\n"), 200);
      showToast(`Connecting to ${bookmark.name}...`);
    }

    // ============================================================
    // REMOTE CONNECTION
    // ============================================================
    function openRemoteConnect() {
      const overlay = document.getElementById("remote-overlay");
      const form = document.getElementById("remote-form");
      const sessionsView = document.getElementById("remote-sessions");
      const statusView = document.getElementById("remote-status");
      const statusText = document.getElementById("remote-status-text");

      // Reset to form view
      form.style.display = "block";
      sessionsView.style.display = "none";
      statusView.style.display = "none";
      overlay.classList.add("visible");

      // Pre-fill from last used values
      const hostInput = document.getElementById("remote-host");
      const userInput = document.getElementById("remote-user");
      const portInput = document.getElementById("remote-port");
      const passwordInput = document.getElementById("remote-password");
      const remotePathInput = document.getElementById("remote-shellfire-path");

      // Focus host input
      setTimeout(() => hostInput.focus(), 100);

      // Remove old error messages
      const oldErr = form.querySelector(".remote-error");
      if (oldErr) oldErr.remove();

      let _connInfo = null;

      function closeRemote() {
        overlay.classList.remove("visible");
        if (activeId && panes.has(activeId)) panes.get(activeId).term.focus();
      }

      // Wire up buttons (use one-shot listeners)
      const closeBtn = document.getElementById("remote-close");
      const cancelBtn = document.getElementById("remote-cancel");
      const connectBtn = document.getElementById("remote-connect");
      const backBtn = document.getElementById("remote-back");
      const sessionsCancelBtn = document.getElementById("remote-sessions-cancel");
      const openAllBtn = document.getElementById("remote-open-all");

      let _formKeydownHandler = null;
      const cleanup = () => {
        closeBtn.removeEventListener("click", onClose);
        cancelBtn.removeEventListener("click", onClose);
        connectBtn.removeEventListener("click", onConnect);
        backBtn.removeEventListener("click", onBack);
        sessionsCancelBtn.removeEventListener("click", onClose);
        openAllBtn.removeEventListener("click", onOpenAll);
        overlay.removeEventListener("click", onOverlayClick);
        // Clean up form input listeners
        if (_formKeydownHandler) {
          form.querySelectorAll("input").forEach(inp => inp.removeEventListener("keydown", _formKeydownHandler));
        }
      };

      function onClose() { cleanup(); closeRemote(); }
      function onOverlayClick(e) { if (e.target === overlay) onClose(); }

      async function onConnect() {
        const host = hostInput.value.trim();
        const user = userInput.value.trim();
        const port = parseInt(portInput.value) || 22;
        const password = passwordInput.value || "";
        const remotePath = remotePathInput.value.trim() || null;

        // Remove old errors
        const oldErr = form.querySelector(".remote-error");
        if (oldErr) oldErr.remove();

        if (!host) { hostInput.focus(); return; }
        if (!user) { userInput.focus(); return; }

        _connInfo = { host, user, port, password, remotePath };

        // Show loading
        form.style.display = "none";
        statusView.style.display = "flex";
        statusText.textContent = `Connecting to ${user}@${host}...`;

        try {
          const result = await window.shellfire.sshRemoteList({ host, user, port, password, remotePath });
          statusView.style.display = "none";

          if (result.error) {
            form.style.display = "block";
            const errDiv = document.createElement("div");
            errDiv.className = "remote-error";
            errDiv.textContent = result.error;
            form.querySelector(".remote-actions").before(errDiv);
            return;
          }

          // Show sessions
          const sessions = result.sessions || [];
          document.getElementById("remote-sessions-host").textContent = `${user}@${host}${port !== 22 ? ':' + port : ''}`;
          renderRemoteSessions(sessions);
          sessionsView.style.display = "block";
        } catch (err) {
          statusView.style.display = "none";
          form.style.display = "block";
          const errDiv = document.createElement("div");
          errDiv.className = "remote-error";
          errDiv.textContent = err.message || "Connection failed";
          form.querySelector(".remote-actions").before(errDiv);
        }
      }

      function onBack() {
        sessionsView.style.display = "none";
        form.style.display = "block";
      }

      function renderRemoteSessions(sessions) {
        const list = document.getElementById("remote-sessions-list");
        list.innerHTML = "";

        if (sessions.length === 0) {
          list.innerHTML = '<div class="remote-no-sessions">No active Shellfire sessions found on this host.</div>';
          openAllBtn.disabled = true;
          return;
        }

        openAllBtn.disabled = false;
        openAllBtn.textContent = `Open All (${sessions.length}) Locally`;

        sessions.forEach(s => {
          const item = document.createElement("div");
          item.className = "remote-session-item";

          const icon = getRemoteProcessIcon(s.process);
          const meta = [s.cwd, s.process].filter(Boolean).join(" \u00b7 ");

          item.innerHTML = `
            <div class="remote-session-icon">${icon}</div>
            <div class="remote-session-info">
              <div class="remote-session-name">${escHtml(s.name)}</div>
              ${meta ? `<div class="remote-session-meta">${escHtml(meta)}</div>` : ""}
            </div>
            ${s.active ? '<span class="remote-session-active">ACTIVE</span>' : ""}
          `;
          list.appendChild(item);
        });

        // Store sessions for open-all
        openAllBtn._sessions = sessions;
      }

      async function onOpenAll() {
        const sessions = openAllBtn._sessions;
        if (!sessions || !sessions.length || !_connInfo) return;

        cleanup();
        overlay.classList.remove("visible");
        showToast(`Opening ${sessions.length} remote session${sessions.length > 1 ? 's' : ''}...`);

        try {
          const result = await window.shellfire.sshRemoteOpenAll({
            host: _connInfo.host,
            user: _connInfo.user,
            port: _connInfo.port,
            password: _connInfo.password,
            sessions,
          });
          showToast(`Opened ${result.opened.length} remote terminal${result.opened.length > 1 ? 's' : ''}`);
        } catch (err) {
          showToast("Failed to open remote sessions: " + err.message, "error");
        }
      }

      closeBtn.addEventListener("click", onClose);
      cancelBtn.addEventListener("click", onClose);
      connectBtn.addEventListener("click", onConnect);
      backBtn.addEventListener("click", onBack);
      sessionsCancelBtn.addEventListener("click", onClose);
      openAllBtn.addEventListener("click", onOpenAll);
      overlay.addEventListener("click", onOverlayClick);

      // Enter key on form submits
      const formInputs = form.querySelectorAll("input");
      _formKeydownHandler = (e) => {
        if (e.key === "Enter") onConnect();
        if (e.key === "Escape") onClose();
      };
      formInputs.forEach(inp => inp.addEventListener("keydown", _formKeydownHandler));
    }

    function getRemoteProcessIcon(proc) {
      if (!proc) return "\u{1F4BB}";
      const p = proc.toLowerCase();
      if (p.includes("node")) return "\u{1F7E2}";
      if (p.includes("python")) return "\u{1F40D}";
      if (p.includes("vim") || p.includes("nvim")) return "\u{1F4DD}";
      if (p.includes("git")) return "\u{1F500}";
      if (p.includes("docker")) return "\u{1F40B}";
      if (p.includes("ssh")) return "\u{1F510}";
      if (p.includes("cargo") || p.includes("rustc")) return "\u{1F980}";
      if (p.includes("go")) return "\u{1F439}";
      if (p.includes("ruby")) return "\u{1F48E}";
      return "\u{1F4BB}";
    }

    // ============================================================
    // SPLIT & RUN
    // ============================================================
    function openSplitAndRun() {
      if (_paletteCleanup) { _paletteCleanup(); _paletteCleanup = null; }
      const overlay = document.getElementById("palette-overlay");
      const input = document.getElementById("palette-input");
      const results = document.getElementById("palette-results");
      overlay.classList.add("visible");
      input.placeholder = "Enter command to run in new split pane...";
      input.value = ""; input.focus();

      results.innerHTML = `<div class="palette-item"><span class="palette-item-label" style="color:color-mix(in srgb, var(--t-fg) 50%, transparent)">Type a command and press Enter to split & run</span></div>
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
      if (activeId) { try { cwd = await window.shellfire.getCwd(activeId); } catch {} }
      await splitPane("horizontal");
      // activeId is now the new pane
      if (activeId) setTimeout(() => window.shellfire.sendInput(activeId, command + "\n"), 150);
      showToast(`Running: ${command}`);
    }

    // ============================================================
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
    // PORT MANAGER PANEL (agent-a4ac31bd)
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
    // CROSS-PANE COMMAND HISTORY SEARCH (Ctrl+R) (agent-a4ac31bd)
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
    // AI ERROR DETECTION (agent-a4ac31bd)
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
    // PANE STATS SPARKLINES (agent-a219a98e)
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
    // EXTENSIONS / PLUGINS
    // ============================================================
    // ============================================================
    // MARKETPLACE
    // ============================================================
    let _mpRegistry = null;
    let _mpInstalledNames = new Set();

    const TYPE_ICONS = {
      theme: "\uD83C\uDFA8", command: "\u26A1", statusbar: "\uD83D\uDCCA", extension: "\uD83E\uDDE9",
    };
    const TYPE_LABELS = {
      theme: "Theme", command: "Command", statusbar: "Status Bar", extension: "Extension",
    };

    function createMarketplaceCard(entry, isInstalled) {
      const card = document.createElement("div");
      card.className = "mp-card" + (isInstalled ? " installed" : "");
      card.dataset.type = entry.type || "";
      card.dataset.name = (entry.name || "").toLowerCase();
      card.dataset.desc = (entry.description || "").toLowerCase();
      card.dataset.tags = (entry.tags || []).join(" ").toLowerCase();
      card.dataset.id = entry.id || "";
      card.dataset.installed = isInstalled ? "1" : "0";
      card.dataset.featured = entry.featured ? "1" : "0";

      if (isInstalled) {
        const dot = document.createElement("div");
        dot.className = "mp-card-installed-dot";
        dot.title = "Installed";
        card.appendChild(dot);
      }

      const top = document.createElement("div");
      top.className = "mp-card-top";

      const icon = document.createElement("div");
      icon.className = "mp-card-icon";
      icon.textContent = entry.icon || TYPE_ICONS[entry.type] || "\uD83D\uDCE6";
      top.appendChild(icon);

      const info = document.createElement("div");
      info.className = "mp-card-info";
      const nameEl = document.createElement("div");
      nameEl.className = "mp-card-name";
      nameEl.textContent = entry.name || entry.id;
      info.appendChild(nameEl);
      const authorEl = document.createElement("div");
      authorEl.className = "mp-card-author";
      authorEl.textContent = (entry.author || "Shellfire") + (entry.version ? " \u00B7 v" + entry.version : "");
      info.appendChild(authorEl);
      top.appendChild(info);

      const desc = document.createElement("div");
      desc.className = "mp-card-desc";
      desc.textContent = entry.description || "";

      const footer = document.createElement("div");
      footer.className = "mp-card-footer";

      const tagsWrap = document.createElement("div");
      tagsWrap.className = "mp-card-tags";
      const typeBadge = document.createElement("span");
      typeBadge.className = "mp-tag plugin-type-badge " + (entry.type || "");
      typeBadge.textContent = TYPE_LABELS[entry.type] || entry.type || "";
      tagsWrap.appendChild(typeBadge);
      if (entry.tags) {
        for (const tag of entry.tags.slice(0, 2)) {
          const t = document.createElement("span");
          t.className = "mp-tag";
          t.textContent = tag;
          tagsWrap.appendChild(t);
        }
      }
      footer.appendChild(tagsWrap);

      const btn = document.createElement("button");
      btn.className = "mp-card-btn " + (isInstalled ? "uninstall" : "install");
      btn.textContent = isInstalled ? "Uninstall" : "Install";
      btn.addEventListener("click", async (e) => {
        e.stopPropagation();
        btn.disabled = true;
        const wasInstalled = btn.classList.contains("uninstall");
        btn.textContent = wasInstalled ? "Removing..." : "Installing...";
        try {
          if (wasInstalled) {
            deactivatePlugin(entry.id);
            const result = await window.shellfire.uninstallPlugin(entry.id);
            if (result.error) throw new Error(result.error);
            _mpInstalledNames.delete(entry.id);
          } else {
            // Try .termext package download first, then file-based fallback
            let installed = false;
            if (entry.packageUrl) {
              const pkgResult = await window.shellfire.downloadAndInstallTermext({ url: entry.packageUrl, id: entry.id });
              if (pkgResult.ok) installed = true;
            }
            if (!installed) {
              const result = await window.shellfire.installFromRegistry({
                id: entry.id,
                files: entry.files || { "plugin.json": "", "index.js": "" },
                downloadUrl: entry.downloadUrl || "",
              });
              if (result.error) throw new Error(result.error);
            }
            await activateSinglePlugin(entry.id, entry.type);
            _mpInstalledNames.add(entry.id);
          }
          if (entry.type === "theme") _refreshThemeUIs();
          // Update card visually
          btn.disabled = false;
          if (wasInstalled) {
            btn.className = "mp-card-btn install";
            btn.textContent = "Install";
            card.classList.remove("installed");
            card.dataset.installed = "0";
            const dot = card.querySelector(".mp-card-installed-dot");
            if (dot) dot.remove();
          } else {
            btn.className = "mp-card-btn uninstall";
            btn.textContent = "Uninstall";
            card.classList.add("installed");
            card.dataset.installed = "1";
            const dot = document.createElement("div");
            dot.className = "mp-card-installed-dot";
            dot.title = "Installed";
            card.insertBefore(dot, card.firstChild);
          }
          showToast(wasInstalled ? `${entry.name} removed` : `${entry.name} installed`);
        } catch (err) {
          showToast("Error: " + err.message, "error");
          btn.disabled = false;
          btn.textContent = wasInstalled ? "Uninstall" : "Install";
        }
      });
      footer.appendChild(btn);

      // Theme preview swatches
      if (entry.type === "theme" && entry.preview) {
        const preview = document.createElement("div");
        preview.className = "mp-theme-preview";
        for (const color of entry.preview) {
          const swatch = document.createElement("div");
          swatch.className = "mp-theme-swatch";
          swatch.style.background = color;
          preview.appendChild(swatch);
        }
        desc.appendChild(preview);
      }

      card.appendChild(top);
      card.appendChild(desc);
      card.appendChild(footer);
      return card;
    }

    async function fetchAndRenderMarketplace() {
      const grid = document.getElementById("marketplace-grid");
      const loading = document.getElementById("marketplace-loading");
      const empty = document.getElementById("marketplace-empty");
      const countEl = document.getElementById("marketplace-count");
      if (!grid) return;

      grid.style.display = "none";
      empty.style.display = "none";
      loading.style.display = "flex";

      try {
        const [registry, installed] = await Promise.all([
          window.shellfire.fetchRegistry(),
          window.shellfire.loadPlugins(),
        ]);
        _mpRegistry = registry;
        _mpInstalledNames = new Set(installed.map(p => p.manifest.name));

        const plugins = registry.plugins || [];
        grid.innerHTML = "";

        // Sort: featured first, then installed, then alphabetical
        const sorted = [...plugins].sort((a, b) => {
          if (a.featured && !b.featured) return -1;
          if (!a.featured && b.featured) return 1;
          const aInst = _mpInstalledNames.has(a.id);
          const bInst = _mpInstalledNames.has(b.id);
          if (aInst && !bInst) return -1;
          if (!aInst && bInst) return 1;
          return (a.name || a.id).localeCompare(b.name || b.id);
        });

        for (const entry of sorted) {
          const card = createMarketplaceCard(entry, _mpInstalledNames.has(entry.id));
          grid.appendChild(card);
        }

        // Also add locally-installed custom plugins not in registry
        const registryIds = new Set(plugins.map(p => p.id));
        for (const p of installed) {
          if (!registryIds.has(p.manifest.name)) {
            const entry = {
              id: p.manifest.name, name: p.manifest.name, description: p.manifest.description || "Custom plugin",
              type: p.manifest.type, version: p.manifest.version, author: p.manifest.author || "Custom",
              tags: ["custom"], icon: "\uD83D\uDD27",
            };
            grid.appendChild(createMarketplaceCard(entry, true));
          }
        }

        if (countEl) countEl.textContent = `${sorted.length} extensions`;
        loading.style.display = "none";
        grid.style.display = "";
        if (grid.children.length === 0) empty.style.display = "flex";
      } catch (err) {
        console.error("Marketplace fetch error:", err);
        loading.style.display = "none";
        empty.style.display = "flex";
      }
    }

    function filterMarketplace(filter, query) {
      const grid = document.getElementById("marketplace-grid");
      const empty = document.getElementById("marketplace-empty");
      if (!grid) return;
      const q = (query || "").toLowerCase().trim();
      let visible = 0;
      for (const card of grid.children) {
        let show = true;
        if (filter && filter !== "all") {
          if (filter === "installed") {
            show = card.dataset.installed === "1";
          } else if (filter === "featured") {
            show = card.dataset.featured === "1";
          } else {
            show = card.dataset.type === filter;
          }
        }
        if (show && q) {
          show = card.dataset.name.includes(q) || card.dataset.desc.includes(q) || card.dataset.tags.includes(q) || card.dataset.id.includes(q);
        }
        card.style.display = show ? "" : "none";
        if (show) visible++;
      }
      if (empty) empty.style.display = visible === 0 ? "flex" : "none";
    }

    // Wire up marketplace filter buttons + search
    (function setupMarketplace() {
      const filters = document.getElementById("marketplace-filters");
      const search = document.getElementById("marketplace-search");
      const installFileBtn = document.getElementById("mp-install-file-btn");
      let activeFilter = "all";

      if (filters) {
        filters.addEventListener("click", (e) => {
          const btn = e.target.closest(".mp-filter");
          if (!btn) return;
          filters.querySelectorAll(".mp-filter").forEach(b => b.classList.remove("active"));
          btn.classList.add("active");
          activeFilter = btn.dataset.filter;
          filterMarketplace(activeFilter, search ? search.value : "");
        });
      }
      if (search) {
        let debounce = null;
        search.addEventListener("input", () => {
          clearTimeout(debounce);
          debounce = setTimeout(() => filterMarketplace(activeFilter, search.value), 150);
        });
      }
      // Install from .termext file
      if (installFileBtn) {
        installFileBtn.addEventListener("click", async () => {
          const pick = await window.shellfire.pickTermextFile();
          if (pick.canceled) return;
          installFileBtn.textContent = "Installing...";
          installFileBtn.disabled = true;
          try {
            const result = await window.shellfire.installTermext(pick.filePath);
            if (result.error) throw new Error(result.error);
            await activateSinglePlugin(result.id, result.manifest.type);
            if (result.manifest.type === "theme") _refreshThemeUIs();
            showToast(`${result.manifest.name || result.id} installed from package`);
            await fetchAndRenderMarketplace();
          } catch (err) {
            showToast("Install failed: " + err.message, "error");
          }
          installFileBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg> Install .termext';
          installFileBtn.disabled = false;
        });
      }
    })();


    // ============================================================
    // PIPELINE VISUAL EDITOR (Mindmap)
    // ============================================================
    const plPanel = document.getElementById("pipeline-panel");
    const plCanvas = document.getElementById("pipeline-canvas");
    const plSvg = document.getElementById("pipeline-svg");
    const plWrap = document.getElementById("pipeline-canvas-wrap");
    let pipelines = [];
    let plNodes = []; // {id, command, status, output, x, y}
    let plEdges = []; // {from, to}
    let plName = "Untitled";
    let plRunning = false;
    let plSelectedId = null;
    let plNextId = 1;
    // Pan & zoom state
    let plPanX = 0, plPanY = 0, plZoom = 1;
    let plIsPanning = false, plPanStartX = 0, plPanStartY = 0;
    let plDragNode = null, plDragOffX = 0, plDragOffY = 0;

    function openPipelinePanel() {
      plPanel.classList.add("visible");
      plRender();
      if (plNodes.length === 0) plCenterView();
    }

    function plCenterView() { plPanX = (plWrap.clientWidth / 2) - 120; plPanY = 60; plZoom = 1; plApplyTransform(); }

    function plApplyTransform() {
      plCanvas.style.transform = `translate(${plPanX}px, ${plPanY}px) scale(${plZoom})`;
      plCanvas.style.transformOrigin = "0 0";
      plSvg.style.transform = `translate(${plPanX}px, ${plPanY}px) scale(${plZoom})`;
      plSvg.style.transformOrigin = "0 0";
      const label = document.getElementById("pipeline-zoom-label");
      if (label) label.textContent = Math.round(plZoom * 100) + "%";
    }

    // --- Pan ---
    plWrap.addEventListener("pointerdown", (e) => {
      if (e.target === plWrap || e.target === plCanvas) {
        plIsPanning = true; plPanStartX = e.clientX - plPanX; plPanStartY = e.clientY - plPanY;
        plWrap.classList.add("grabbing"); plWrap.setPointerCapture(e.pointerId);
      }
    });
    plWrap.addEventListener("pointermove", (e) => {
      if (plIsPanning) { plPanX = e.clientX - plPanStartX; plPanY = e.clientY - plPanStartY; plApplyTransform(); }
      if (plDragNode) {
        const rect = plWrap.getBoundingClientRect();
        const x = (e.clientX - rect.left - plPanX) / plZoom - plDragOffX;
        const y = (e.clientY - rect.top - plPanY) / plZoom - plDragOffY;
        plDragNode.x = x; plDragNode.y = y;
        // Fast path: update only the dragged node position and connected edges
        const el = document.getElementById("pl-node-" + plDragNode.id);
        if (el) { el.style.left = x + "px"; el.style.top = y + "px"; }
        plUpdateEdgesFor(plDragNode.id);
      }
    });
    plWrap.addEventListener("pointerup", () => {
      if (plDragNode) {
        const el = document.getElementById("pl-node-" + plDragNode.id);
        if (el) el.classList.remove("dragging");
      }
      plIsPanning = false; plDragNode = null; plWrap.classList.remove("grabbing");
    });

    // --- Zoom ---
    plWrap.addEventListener("wheel", (e) => {
      e.preventDefault();
      const rect = plWrap.getBoundingClientRect();
      const mx = e.clientX - rect.left, my = e.clientY - rect.top;
      const oldZoom = plZoom;
      plZoom = Math.min(3, Math.max(0.2, plZoom * (e.deltaY < 0 ? 1.08 : 0.92)));
      plPanX = mx - (mx - plPanX) * (plZoom / oldZoom);
      plPanY = my - (my - plPanY) * (plZoom / oldZoom);
      plApplyTransform();
    }, { passive: false });

    // --- Edge geometry helper ---
    function plEdgePath(fromN, toN) {
      const fromEl = document.getElementById("pl-node-" + fromN.id);
      const toEl = document.getElementById("pl-node-" + toN.id);
      const fw = fromEl ? fromEl.offsetWidth : 200, fh = fromEl ? fromEl.offsetHeight : 60;
      const tw = toEl ? toEl.offsetWidth : 200;
      const x1 = fromN.x + fw / 2, y1 = fromN.y + fh;
      const x2 = toN.x + tw / 2, y2 = toN.y;
      const dy = Math.abs(y2 - y1);
      const cy1 = y1 + Math.max(dy * 0.4, 30), cy2 = y2 - Math.max(dy * 0.4, 30);
      return `M${x1},${y1} C${x1},${cy1} ${x2},${cy2} ${x2},${y2}`;
    }

    // Fast update: only recompute SVG paths touching a given node
    function plUpdateEdgesFor(nodeId) {
      for (const edge of plEdges) {
        if (edge.from !== nodeId && edge.to !== nodeId) continue;
        const fromN = plNodes.find(n => n.id === edge.from);
        const toN = plNodes.find(n => n.id === edge.to);
        if (!fromN || !toN) continue;
        const pathEl = plSvg.querySelector(`path[data-from="${edge.from}"][data-to="${edge.to}"]`);
        if (pathEl) pathEl.setAttribute("d", plEdgePath(fromN, toN));
      }
    }

    // --- Render ---
    function plRender() {
      // Ensure SVG defs exist
      if (!plSvg.querySelector("defs")) {
        const defs = document.createElementNS("http://www.w3.org/2000/svg", "defs");
        defs.innerHTML = '<marker id="pl-arrow" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto"><polygon points="0 0, 8 3, 0 6" class="pl-edge-arrow"/></marker>'
          + '<marker id="pl-arrow-pass" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto"><polygon points="0 0, 8 3, 0 6" class="pl-edge-arrow passed"/></marker>'
          + '<marker id="pl-arrow-run" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto"><polygon points="0 0, 8 3, 0 6" class="pl-edge-arrow running"/></marker>'
          + '<marker id="pl-arrow-fail" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto"><polygon points="0 0, 8 3, 0 6" class="pl-edge-arrow failed"/></marker>';
        plSvg.appendChild(defs);
      }

      // Sync edge paths (add/remove/update)
      const edgeSet = new Set(plEdges.map(e => e.from + "-" + e.to));
      plSvg.querySelectorAll("path.pl-edge").forEach(p => {
        const key = p.dataset.from + "-" + p.dataset.to;
        if (!edgeSet.has(key)) p.remove();
      });
      for (const edge of plEdges) {
        const fromN = plNodes.find(n => n.id === edge.from);
        const toN = plNodes.find(n => n.id === edge.to);
        if (!fromN || !toN) continue;
        let pathEl = plSvg.querySelector(`path[data-from="${edge.from}"][data-to="${edge.to}"]`);
        if (!pathEl) {
          pathEl = document.createElementNS("http://www.w3.org/2000/svg", "path");
          pathEl.dataset.from = edge.from; pathEl.dataset.to = edge.to;
          plSvg.appendChild(pathEl);
        }
        pathEl.setAttribute("d", plEdgePath(fromN, toN));
        const cls = toN.status === "passed" ? "passed" : toN.status === "running" ? "running" : toN.status === "failed" ? "failed" : "";
        const marker = cls === "passed" ? "pl-arrow-pass" : cls === "running" ? "pl-arrow-run" : cls === "failed" ? "pl-arrow-fail" : "pl-arrow";
        pathEl.setAttribute("class", "pl-edge " + cls);
        pathEl.setAttribute("marker-end", "url(#" + marker + ")");
      }

      // Render nodes
      const existingIds = new Set(plNodes.map(n => n.id));
      // Remove stale nodes
      plCanvas.querySelectorAll(".pl-node").forEach(el => {
        const id = parseInt(el.dataset.nid);
        if (!existingIds.has(id)) el.remove();
      });

      for (const node of plNodes) {
        let el = document.getElementById("pl-node-" + node.id);
        if (!el) {
          el = document.createElement("div");
          el.className = "pl-node";
          el.id = "pl-node-" + node.id;
          el.dataset.nid = node.id;
          el.innerHTML = `
            <div class="pl-node-port-in" title="Drop connection here"></div>
            <div class="pl-node-actions">
              <button class="pl-node-del" title="Delete">&times;</button>
            </div>
            <div class="pl-node-header">
              <div class="pl-node-dot"></div>
              <span class="pl-node-idx"></span>
              <span class="pl-node-status"></span>
            </div>
            <div class="pl-node-body"></div>
            <div class="pl-node-output"></div>
            <div class="pl-node-port" title="Drag to connect"></div>
          `;
          // Drag node
          el.addEventListener("pointerdown", (e) => {
            if (e.target.closest(".pl-node-del") || e.target.closest(".pl-node-port") || e.target.closest(".pl-node-port-in") || e.target.closest(".pl-node-body[contenteditable=true]")) return;
            e.stopPropagation();
            plDragNode = node;
            el.classList.add("dragging");
            const rect = plWrap.getBoundingClientRect();
            plDragOffX = (e.clientX - rect.left - plPanX) / plZoom - node.x;
            plDragOffY = (e.clientY - rect.top - plPanY) / plZoom - node.y;
            plSelectNode(node.id);
          });
          // Delete
          el.querySelector(".pl-node-del").addEventListener("click", (e) => {
            e.stopPropagation();
            plNodes = plNodes.filter(n => n.id !== node.id);
            plEdges = plEdges.filter(edge => edge.from !== node.id && edge.to !== node.id);
            if (plSelectedId === node.id) plSelectedId = null;
            plRender();
          });
          // Double-click to edit command
          el.querySelector(".pl-node-body").addEventListener("dblclick", (e) => {
            if (plRunning) return;
            const body = e.currentTarget;
            body.contentEditable = "true";
            body.focus();
            // Select all text
            const range = document.createRange(); range.selectNodeContents(body);
            const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(range);
          });
          el.querySelector(".pl-node-body").addEventListener("blur", (e) => {
            e.currentTarget.contentEditable = "false";
            node.command = e.currentTarget.textContent.trim();
          });
          el.querySelector(".pl-node-body").addEventListener("keydown", (e) => {
            if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); e.currentTarget.blur(); }
            if (e.key === "Escape") { e.currentTarget.textContent = node.command; e.currentTarget.blur(); }
          });
          // Click output to toggle
          el.querySelector(".pl-node-header").addEventListener("click", () => {
            const out = el.querySelector(".pl-node-output");
            if (node.output) out.classList.toggle("visible");
          });
          // Port drag for connections
          const port = el.querySelector(".pl-node-port");
          port.addEventListener("pointerdown", (e) => {
            e.stopPropagation();
            plStartEdgeDrag(node.id, e);
          });
          plCanvas.appendChild(el);
        }
        // Update position & content
        el.style.left = node.x + "px"; el.style.top = node.y + "px";
        el.className = "pl-node" + (node.status !== "pending" ? " " + node.status : "") + (plSelectedId === node.id ? " selected" : "");
        const execOrder = plGetExecutionOrder();
        const idx = execOrder ? execOrder.indexOf(node.id) : -1;
        el.querySelector(".pl-node-idx").textContent = idx >= 0 ? "#" + (idx + 1) : "";
        el.querySelector(".pl-node-status").textContent = node.status === "pending" ? "" : node.status;
        const body = el.querySelector(".pl-node-body");
        if (body.contentEditable !== "true") body.textContent = node.command;
        const output = el.querySelector(".pl-node-output");
        output.textContent = node.output || "";
        if (node.output && (node.status === "failed" || node.status === "passed")) output.classList.add("visible");
      }
      // Update title
      document.getElementById("pipeline-title").textContent = plName || "Untitled Pipeline";
    }

    // --- Edge drag ---
    let plEdgeDragFrom = null, plEdgeTempPath = null, plDropTarget = null;
    const PL_DROP_PADDING = 40; // generous hit zone around nodes

    function plFindDropTarget(mx, my, fromId) {
      let best = null, bestDist = Infinity;
      for (const n of plNodes) {
        if (n.id === fromId) continue;
        const nel = document.getElementById("pl-node-" + n.id);
        const nw = nel ? nel.offsetWidth : 200, nh = nel ? nel.offsetHeight : 60;
        // Check within padded bounds
        if (mx >= n.x - PL_DROP_PADDING && mx <= n.x + nw + PL_DROP_PADDING &&
            my >= n.y - PL_DROP_PADDING && my <= n.y + nh + PL_DROP_PADDING) {
          // Distance to center of input port (top center)
          const cx = n.x + nw / 2, cy = n.y;
          const dist = Math.hypot(mx - cx, my - cy);
          if (dist < bestDist) { bestDist = dist; best = n; }
        }
      }
      return best;
    }

    function plStartEdgeDrag(fromId, e) {
      plEdgeDragFrom = fromId;
      plEdgeTempPath = document.createElementNS("http://www.w3.org/2000/svg", "path");
      plEdgeTempPath.setAttribute("class", "pl-edge-temp");
      plSvg.appendChild(plEdgeTempPath);
      const fromN = plNodes.find(n => n.id === fromId);
      const fromEl = document.getElementById("pl-node-" + fromId);
      const fw = fromEl ? fromEl.offsetWidth : 200, fh = fromEl ? fromEl.offsetHeight : 60;
      const startX = fromN.x + fw / 2, startY = fromN.y + fh;

      const onMove = (ev) => {
        const rect = plWrap.getBoundingClientRect();
        const mx = (ev.clientX - rect.left - plPanX) / plZoom;
        const my = (ev.clientY - rect.top - plPanY) / plZoom;
        // Snap to target input port if hovering near a node
        let endX = mx, endY = my;
        const target = plFindDropTarget(mx, my, fromId);
        // Update drop target highlight
        if (plDropTarget !== target) {
          if (plDropTarget) {
            const oldEl = document.getElementById("pl-node-" + plDropTarget.id);
            if (oldEl) oldEl.classList.remove("drop-target");
          }
          plDropTarget = target;
          if (target) {
            const tEl = document.getElementById("pl-node-" + target.id);
            if (tEl) tEl.classList.add("drop-target");
            const tw = tEl ? tEl.offsetWidth : 200;
            endX = target.x + tw / 2; endY = target.y;
          }
        } else if (target) {
          const tEl = document.getElementById("pl-node-" + target.id);
          const tw = tEl ? tEl.offsetWidth : 200;
          endX = target.x + tw / 2; endY = target.y;
        }
        // Draw curved temp path
        const dy = Math.abs(endY - startY);
        const cy1 = startY + Math.max(dy * 0.4, 30), cy2 = endY - Math.max(dy * 0.4, 30);
        plEdgeTempPath.setAttribute("d", `M${startX},${startY} C${startX},${cy1} ${endX},${cy2} ${endX},${endY}`);
      };

      const onUp = (ev) => {
        document.removeEventListener("pointermove", onMove);
        document.removeEventListener("pointerup", onUp);
        if (plEdgeTempPath) { plEdgeTempPath.remove(); plEdgeTempPath = null; }
        // Clear drop target highlight
        if (plDropTarget) {
          const oldEl = document.getElementById("pl-node-" + plDropTarget.id);
          if (oldEl) oldEl.classList.remove("drop-target");
        }
        const rect = plWrap.getBoundingClientRect();
        const mx = (ev.clientX - rect.left - plPanX) / plZoom;
        const my = (ev.clientY - rect.top - plPanY) / plZoom;
        const target = plFindDropTarget(mx, my, fromId);
        if (target && !plEdges.find(e => e.from === fromId && e.to === target.id)) {
          plEdges.push({ from: fromId, to: target.id });
          plRender();
        }
        plDropTarget = null;
        plEdgeDragFrom = null;
      };
      document.addEventListener("pointermove", onMove);
      document.addEventListener("pointerup", onUp);
    }

    function plSelectNode(id) { plSelectedId = id; plRender(); }

    // --- Get execution order (topological sort with cycle detection) ---
    function plGetExecutionOrder() {
      const inDeg = {}; const adj = {};
      for (const n of plNodes) { inDeg[n.id] = 0; adj[n.id] = []; }
      for (const e of plEdges) {
        if (adj[e.from]) adj[e.from].push(e.to);
        if (inDeg[e.to] !== undefined) inDeg[e.to]++;
      }
      const queue = plNodes.filter(n => inDeg[n.id] === 0).map(n => n.id);
      const order = [];
      while (queue.length) {
        const curr = queue.shift(); order.push(curr);
        for (const next of (adj[curr] || [])) {
          inDeg[next]--;
          if (inDeg[next] === 0) queue.push(next);
        }
      }
      // Cycle detection: if not all nodes are in order, there's a cycle
      if (order.length < plNodes.length) {
        showToast("Pipeline has a cycle — cannot execute", "error");
        return null;
      }
      return order;
    }

    // --- Inline prompt for pipeline ---
    function plPrompt(label, defaultVal) {
      return new Promise((resolve) => {
        let existing = plWrap.querySelector(".pl-load-modal");
        if (existing) existing.remove();
        const modal = document.createElement("div");
        modal.className = "pl-load-modal";
        modal.innerHTML = `<h4>${escapeHtml(label)}</h4>
          <input type="text" id="pl-prompt-input" value="${escapeHtml(defaultVal || "")}" style="width:100%;padding:8px 10px;border-radius:6px;border:1px solid var(--t-border);background:var(--t-bg);color:var(--t-fg);font-size:13px;font-family:'SF Mono',monospace;outline:none;margin-bottom:10px" />
          <div style="display:flex;gap:6px;justify-content:flex-end">
            <button class="pl-tb-btn" id="pl-prompt-cancel">Cancel</button>
            <button class="pl-tb-btn pl-tb-run" id="pl-prompt-ok" style="background:color-mix(in srgb, var(--t-accent) 15%, transparent);border-color:color-mix(in srgb, var(--t-accent) 30%, transparent);color:var(--t-accent)">OK</button>
          </div>`;
        plWrap.appendChild(modal);
        const input = document.getElementById("pl-prompt-input");
        input.focus();
        input.select();
        const cleanup = (val) => { modal.remove(); resolve(val); };
        document.getElementById("pl-prompt-ok").addEventListener("click", () => cleanup(input.value.trim()));
        document.getElementById("pl-prompt-cancel").addEventListener("click", () => cleanup(null));
        input.addEventListener("keydown", (e) => {
          if (e.key === "Enter") cleanup(input.value.trim());
          if (e.key === "Escape") cleanup(null);
        });
      });
    }

    // --- Add step ---
    document.getElementById("pipeline-add-btn").addEventListener("click", async () => {
      const cmd = await plPrompt("Command:", "");
      if (!cmd) return;
      const lastNode = plNodes.length > 0 ? plNodes[plNodes.length - 1] : null;
      const x = lastNode ? lastNode.x : 0;
      const y = lastNode ? lastNode.y + 100 : 0;
      const newNode = { id: plNextId++, command: cmd, status: "pending", output: "", x, y };
      plNodes.push(newNode);
      if (lastNode) plEdges.push({ from: lastNode.id, to: newNode.id });
      plRender();
    });

    // --- Run pipeline ---
    document.getElementById("pipeline-run").addEventListener("click", async () => {
      if (plRunning) return;
      plRunning = true;
      document.getElementById("pipeline-run").style.display = "none";
      document.getElementById("pipeline-stop").style.display = "";

      // Reset statuses
      plNodes.forEach(n => { n.status = "pending"; n.output = ""; });
      plRender();

      const order = plGetExecutionOrder();
      if (!order) return; // Cycle detected
      let failed = false;
      for (const nid of order) {
        const node = plNodes.find(n => n.id === nid);
        if (!node) continue;
        if (failed) { node.status = "skipped"; plRender(); continue; }
        node.status = "running"; plRender();
        try {
          const result = await window.shellfire.execPipelineStep({ command: node.command });
          node.output = (result.stdout || "") + (result.stderr ? "\n--- stderr ---\n" + result.stderr : "");
          node.status = result.code === 0 ? "passed" : "failed";
          if (result.code !== 0) failed = true;
        } catch (err) {
          node.output = err.message || "Unknown error";
          node.status = "failed"; failed = true;
        }
        plRender();
        if (!plRunning) break; // stopped
      }

      plRunning = false;
      document.getElementById("pipeline-run").style.display = "";
      document.getElementById("pipeline-stop").style.display = "none";
      showToast(failed ? "Pipeline failed" : "Pipeline completed successfully");
    });

    document.getElementById("pipeline-stop").addEventListener("click", () => { plRunning = false; });

    // --- Save ---
    document.getElementById("pipeline-save").addEventListener("click", async () => {
      const name = await plPrompt("Pipeline name:", plName || "Untitled");
      if (!name) return;
      plName = name;
      const toSave = {
        name,
        nodes: plNodes.map(n => ({ id: n.id, command: n.command, x: n.x, y: n.y })),
        edges: plEdges.slice(),
        // Keep legacy steps format for compatibility
        steps: plNodes.map(n => ({ command: n.command, status: "pending", output: "" })),
      };
      const existing = pipelines.findIndex(p => p.name === name);
      if (existing >= 0) pipelines[existing] = toSave;
      else pipelines.push(toSave);
      await window.shellfire.savePipelines(pipelines);
      plRender();
      showToast(`Pipeline "${name}" saved`);
    });

    // --- Load ---
    document.getElementById("pipeline-load").addEventListener("click", async () => {
      pipelines = await window.shellfire.loadPipelines() || [];
      if (pipelines.length === 0) { showToast("No saved pipelines"); return; }
      // Show load modal
      let existing = plWrap.querySelector(".pl-load-modal");
      if (existing) existing.remove();
      const modal = document.createElement("div");
      modal.className = "pl-load-modal";
      let html = '<h4>Load Pipeline</h4>';
      pipelines.forEach((p, i) => {
        const stepCount = p.nodes ? p.nodes.length : (p.steps ? p.steps.length : 0);
        html += `<div class="pl-load-item" data-idx="${i}">
          <div><div class="pl-load-item-name">${escapeHtml(p.name)}</div>
          <div class="pl-load-item-steps">${stepCount} step${stepCount !== 1 ? "s" : ""}</div></div>
          <button class="pl-load-item-del" data-delidx="${i}" title="Delete">&times;</button>
        </div>`;
      });
      html += '<div style="text-align:right;margin-top:8px"><button class="pl-tb-btn" id="pl-load-cancel">Cancel</button></div>';
      modal.innerHTML = html;
      plWrap.appendChild(modal);

      modal.addEventListener("click", async (e) => {
        // Delete pipeline
        const delBtn = e.target.closest("[data-delidx]");
        if (delBtn) {
          e.stopPropagation();
          const di = parseInt(delBtn.dataset.delidx);
          pipelines.splice(di, 1);
          await window.shellfire.savePipelines(pipelines);
          modal.remove();
          document.getElementById("pipeline-load").click(); // re-open
          return;
        }
        // Load pipeline
        const item = e.target.closest(".pl-load-item");
        if (item) {
          const idx = parseInt(item.dataset.idx);
          const p = pipelines[idx];
          plName = p.name;
          if (p.nodes) {
            // New format with positions
            plNodes = p.nodes.map(n => ({ id: n.id, command: n.command, x: n.x, y: n.y, status: "pending", output: "" }));
            plEdges = (p.edges || []).slice();
            plNextId = Math.max(...plNodes.map(n => n.id), 0) + 1;
          } else if (p.steps) {
            // Legacy format — lay out vertically
            plNodes = p.steps.map((s, i) => ({ id: i + 1, command: s.command, x: 0, y: i * 100, status: "pending", output: "" }));
            plEdges = plNodes.slice(1).map((n, i) => ({ from: plNodes[i].id, to: n.id }));
            plNextId = plNodes.length + 1;
          }
          modal.remove();
          plCenterView();
          plRender();
          showToast(`Loaded "${plName}"`);
          return;
        }
        // Cancel
        if (e.target.id === "pl-load-cancel") modal.remove();
      });
    });

    // --- Import .sh ---
    document.getElementById("pipeline-import-sh").addEventListener("click", async () => {
      const result = await window.shellfire.pickShFile();
      if (!result || result.canceled) return;

      // Parse shell script into commands
      const lines = result.content.split("\n");
      const commands = [];
      let multiLine = "";
      for (const raw of lines) {
        const trimmed = raw.trim();
        // Skip empty lines, comments, and shebang
        if (!trimmed || trimmed.startsWith("#")) continue;
        // Handle line continuations (trailing backslash)
        if (trimmed.endsWith("\\")) {
          multiLine += trimmed.slice(0, -1).trim() + " ";
          continue;
        }
        if (multiLine) {
          commands.push(multiLine + trimmed);
          multiLine = "";
        } else {
          commands.push(trimmed);
        }
      }
      if (multiLine) commands.push(multiLine.trim());
      if (commands.length === 0) { showToast("No commands found in script"); return; }

      // Create pipeline nodes laid out vertically
      plNodes = []; plEdges = []; plSelectedId = null;
      plNextId = 1;
      plName = result.name || "Imported Script";
      for (let i = 0; i < commands.length; i++) {
        plNodes.push({ id: plNextId++, command: commands[i], status: "pending", output: "", x: 0, y: i * 120 });
      }
      // Chain nodes sequentially
      for (let i = 1; i < plNodes.length; i++) {
        plEdges.push({ from: plNodes[i - 1].id, to: plNodes[i].id });
      }
      plCenterView();
      plRender();
      showToast(`Imported ${commands.length} steps from "${result.name}.sh"`);
    });

    // --- Export .sh ---
    document.getElementById("pipeline-export-sh").addEventListener("click", async () => {
      const order = plGetExecutionOrder();
      if (!order || order.length === 0) { showToast("No steps to export"); return; }
      const lines = ["#!/bin/bash", `# Pipeline: ${plName}`, "set -e", ""];
      for (const id of order) {
        const node = plNodes.find(n => n.id === id);
        if (node) lines.push(node.command);
      }
      lines.push("");
      const content = lines.join("\n");
      const fileName = (plName || "pipeline").replace(/[^a-zA-Z0-9_-]/g, "_") + ".sh";
      const saved = await window.shellfire.exportSh(content, fileName);
      if (saved) showToast(`Exported to ${saved}`);
    });

    // --- Clear ---
    document.getElementById("pipeline-clear").addEventListener("click", () => {
      plNodes = []; plEdges = []; plSelectedId = null; plNextId = 1; plName = "Untitled";
      plRender();
      showToast("Pipeline cleared");
    });

    // --- Close ---
    document.getElementById("pipeline-close").addEventListener("click", () => {
      plPanel.classList.remove("visible");
      if (activeId && panes.has(activeId)) panes.get(activeId).term.focus();
    });

    // --- Title rename ---
    document.getElementById("pipeline-title").addEventListener("click", async () => {
      const name = await plPrompt("Pipeline name:", plName);
      if (name) { plName = name; plRender(); }
    });

    // --- Keyboard shortcuts inside pipeline editor ---
    plPanel.addEventListener("keydown", (e) => {
      if (e.target.contentEditable === "true" || e.target.tagName === "INPUT") return;
      if ((e.key === "Delete" || e.key === "Backspace") && plSelectedId) {
        plNodes = plNodes.filter(n => n.id !== plSelectedId);
        plEdges = plEdges.filter(edge => edge.from !== plSelectedId && edge.to !== plSelectedId);
        plSelectedId = null; plRender();
      }
      if (e.key === "Escape") plPanel.classList.remove("visible");
    });

    // Deselect when clicking canvas background
    plCanvas.addEventListener("click", (e) => {
      if (e.target === plCanvas) { plSelectedId = null; plRender(); }
    });

    async function loadPipelinesData() {
      pipelines = await window.shellfire.loadPipelines() || [];
    }

    // ============================================================
    // COMMAND BOOKMARKS (agent-ad954acf)
    // ============================================================
    const cmdBookmarksPanel = document.getElementById("cmd-bookmarks-panel");
    const bookmarkListEl = document.getElementById("bookmark-list");
    const bookmarkCategoriesEl = document.getElementById("bookmark-categories");
    let cmdBookmarks = [];
    let bookmarkActiveTag = "All";

    function openCmdBookmarksPanel() {
      cmdBookmarksPanel.classList.add("visible");
      renderBookmarkCategories();
      renderBookmarkList();
    }

    document.getElementById("cmd-bookmarks-close").addEventListener("click", () => {
      cmdBookmarksPanel.classList.remove("visible");
      if (activeId && panes.has(activeId)) panes.get(activeId).term.focus();
    });

    function getBookmarkTags() {
      const tags = new Set();
      cmdBookmarks.forEach(b => (b.tags || []).forEach(t => tags.add(t)));
      return ["All", ...Array.from(tags).sort()];
    }

    function renderBookmarkCategories() {
      const tags = getBookmarkTags();
      bookmarkCategoriesEl.innerHTML = "";
      tags.forEach(tag => {
        const tab = document.createElement("button");
        tab.className = "bookmark-cat-tab" + (tag === bookmarkActiveTag ? " active" : "");
        tab.textContent = tag;
        tab.addEventListener("click", () => {
          bookmarkActiveTag = tag;
          renderBookmarkCategories();
          renderBookmarkList();
        });
        bookmarkCategoriesEl.appendChild(tab);
      });
    }

    function renderBookmarkList() {
      const search = (document.getElementById("bookmark-search").value || "").toLowerCase();
      let filtered = cmdBookmarks;
      if (bookmarkActiveTag !== "All") {
        filtered = filtered.filter(b => (b.tags || []).includes(bookmarkActiveTag));
      }
      if (search) {
        filtered = filtered.filter(b =>
          b.command.toLowerCase().includes(search) ||
          (b.description || "").toLowerCase().includes(search) ||
          (b.tags || []).some(t => t.toLowerCase().includes(search))
        );
      }
      bookmarkListEl.innerHTML = "";
      if (filtered.length === 0) {
        bookmarkListEl.innerHTML = '<div class="bookmark-empty">No bookmarks found</div>';
        return;
      }
      filtered.forEach((bm) => {
        const realIdx = cmdBookmarks.indexOf(bm);
        const item = document.createElement("div");
        item.className = "bookmark-item";
        item.innerHTML = `
          <div class="bookmark-item-actions">
            <button data-edit="${realIdx}" title="Edit">e</button>
            <button data-del="${realIdx}" title="Delete">x</button>
          </div>
          <div class="bookmark-item-cmd">${escapeHtml(bm.command)}</div>
          ${bm.description ? `<div class="bookmark-item-desc">${escapeHtml(bm.description)}</div>` : ""}
          <div class="bookmark-item-tags">${(bm.tags || []).map(t => `<span class="bookmark-tag-pill">${escapeHtml(t)}</span>`).join("")}</div>
        `;
        item.addEventListener("click", (e) => {
          if (e.target.closest("[data-edit]") || e.target.closest("[data-del]")) return;
          if (activeId && panes.has(activeId)) {
            window.shellfire.sendInput(activeId, bm.command);
            cmdBookmarksPanel.classList.remove("visible");
            panes.get(activeId).term.focus();
            showToast("Pasted bookmark");
          }
        });

        const editBtn = item.querySelector("[data-edit]");
        if (editBtn) editBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          const newCmd = prompt("Command:", bm.command);
          if (newCmd === null) return;
          const newDesc = prompt("Description:", bm.description || "");
          const newTags = prompt("Tags (comma-separated):", (bm.tags || []).join(", "));
          bm.command = newCmd;
          bm.description = newDesc || "";
          bm.tags = (newTags || "").split(",").map(t => t.trim()).filter(Boolean);
          saveCmdBookmarks();
          renderBookmarkCategories();
          renderBookmarkList();
        });

        const delBtn = item.querySelector("[data-del]");
        if (delBtn) delBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          cmdBookmarks.splice(realIdx, 1);
          saveCmdBookmarks();
          renderBookmarkCategories();
          renderBookmarkList();
        });

        bookmarkListEl.appendChild(item);
      });
    }

    document.getElementById("bookmark-search").addEventListener("input", renderBookmarkList);

    document.getElementById("bookmark-add-btn").addEventListener("click", () => {
      const cmdInput = document.getElementById("bookmark-cmd");
      const tagInput = document.getElementById("bookmark-tag");
      const cmd = cmdInput.value.trim();
      if (!cmd) return;
      const tags = tagInput.value.split(",").map(t => t.trim()).filter(Boolean);
      cmdBookmarks.push({ command: cmd, description: "", tags, createdAt: Date.now() });
      cmdInput.value = "";
      tagInput.value = "";
      saveCmdBookmarks();
      renderBookmarkCategories();
      renderBookmarkList();
    });

    document.getElementById("bookmark-cmd").addEventListener("keydown", (e) => {
      if (e.key === "Enter") document.getElementById("bookmark-add-btn").click();
    });

    function saveCmdBookmarks() {
      window.shellfire.saveCmdBookmarks(cmdBookmarks);
    }

    async function loadCmdBookmarksData() {
      cmdBookmarks = await window.shellfire.loadCmdBookmarks() || [];
    }

    function bookmarkLastCommand() {
      const cmd = prompt("Bookmark command:");
      if (!cmd) return;
      const tag = prompt("Tag (optional):", "");
      const tags = tag ? tag.split(",").map(t => t.trim()).filter(Boolean) : [];
      cmdBookmarks.push({ command: cmd, description: "", tags, createdAt: Date.now() });
      saveCmdBookmarks();
      showToast("Command bookmarked");
    }

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
        // Auto-name: set as the pane's name so it sticks in tabs, sidebar, CLI
        // Don't overwrite user-set custom names (set via rename UI)
        if (!pane._userRenamed) {
          pane.customName = smart;
          if (pane.titleEl) pane.titleEl.textContent = smart;
        }
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

      // Render
      ideSidebarBody.innerHTML = "";

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
    // ENHANCED BOTTOM BAR
    // ============================================================
    const bottombarBranch = document.getElementById("bottombar-branch");
    const bottombarCwd = document.getElementById("bottombar-cwd");
    const bottombarShell = document.getElementById("bottombar-shell");

    async function updateBottomBar() {
      if (!activeId || !panes.has(activeId)) {
        bottombarBranch.classList.remove("visible");
        bottombarCwd.classList.remove("visible");
        return;
      }
      const pane = panes.get(activeId);
      // CWD
      try {
        const cwd = await window.shellfire.getCwd(activeId);
        if (cwd) {
          const home = cwd.replace(/^\/Users\/[^/]+/, "~").replace(/^\/home\/[^/]+/, "~");
          bottombarCwd.textContent = home;
          bottombarCwd.classList.add("visible");
        } else {
          bottombarCwd.classList.remove("visible");
        }

        // Git
        if (cwd) {
          const [branch, status] = await Promise.all([
            window.shellfire.getGitBranch(cwd),
            window.shellfire.getGitStatus(cwd),
          ]);
          if (branch) {
            bottombarBranch.innerHTML = `<svg viewBox="0 0 24 24"><circle cx="12" cy="6" r="2"/><circle cx="12" cy="18" r="2"/><line x1="12" y1="8" x2="12" y2="16"/></svg> ${escapeHtml(branch)}`;
            bottombarBranch.className = "bottombar-branch visible " + (status === "dirty" ? "dirty" : "clean");
          } else {
            bottombarBranch.classList.remove("visible");
          }
        }
      } catch {
        bottombarCwd.classList.remove("visible");
        bottombarBranch.classList.remove("visible");
      }
    }
    setInterval(updateBottomBar, 3000);

    // Show shell name in bottombar
    (async () => {
      try {
        const shell = await window.shellfire.getDefaultShell();
        if (shell) bottombarShell.textContent = shell.split("/").pop();
      } catch {}
    })();

    // ============================================================
    // SETTINGS UI
    // ============================================================
    function openSettings(tabName) {
      const overlay = document.getElementById("settings-overlay");
      overlay.classList.add("visible");

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
      document.getElementById("setting-zoom-value").textContent = Math.round(currentZoom * 100) + "%";
      document.getElementById("setting-font-size").value = currentFontSize;
      document.getElementById("setting-font-family").value = settings.fontFamily || '"SF Mono", "Menlo", "Monaco", "Courier New", monospace';
      document.getElementById("setting-cursor-style").value = settings.cursorStyle || "block";
      document.getElementById("setting-cursor-blink").checked = settings.cursorBlink !== false;
      document.getElementById("setting-shell").value = settings.shell || "";
      document.getElementById("setting-cwd").value = settings.defaultCwd || "";
      document.getElementById("setting-scrollback").value = settings.scrollback || 10000;
      document.getElementById("setting-buffer-limit").value = Math.round(bufferLimit / 1024);
      document.getElementById("setting-copy-on-select").checked = copyOnSelect;
      document.getElementById("setting-ai-suggestions").checked = aiSuggestions;
      document.getElementById("setting-confirm-close").checked = confirmClose;
      document.getElementById("setting-auto-save").checked = settings.autoSaveSession !== false;
      document.getElementById("setting-auto-save-interval").value = autoSaveInterval;
      document.getElementById("setting-ide-mode").checked = ideMode;

      // Version info
      window.shellfire.getAppVersion().then(v => { document.getElementById("setting-version").textContent = v; }).catch(() => {});
      window.shellfire.getDefaultShell().then(s => { document.getElementById("setting-detected-shell").textContent = s; }).catch(() => {});

      // Keybindings — auto-populate
      populateKeybindingList();

      // Mount extension settings sections (once)
      for (const sec of _extSettingsSections) {
        if (!sec._mounted) {
          const extTab = document.querySelector('.settings-tab[data-tab="extensions"] .settings-group');
          if (extTab) {
            const container = document.createElement("div");
            container.innerHTML = sec.html;
            extTab.appendChild(container);
            sec._mounted = true;
            sec._container = container; // track for cleanup on uninstall
          }
        }
        if (sec.onMount) sec.onMount();
      }

      // Load extensions list into settings
      refreshSettingsExtensions();

      // Clear search and switch to requested tab (default to appearance)
      document.getElementById("settings-search").value = "";
      clearSettingsSearch();
      switchSettingsTab(tabName || "appearance");
    }

    function closeSettings() {
      document.getElementById("settings-overlay").classList.remove("visible");
      if (activeId && panes.has(activeId)) panes.get(activeId).term.focus();
    }

    function switchSettingsTab(tabName) {
      document.querySelectorAll(".settings-nav-item").forEach(item => {
        item.classList.toggle("active", item.dataset.tab === tabName);
      });
      document.querySelectorAll(".settings-tab").forEach(tab => {
        tab.classList.toggle("active", tab.dataset.tab === tabName);
      });
    }

    function clearSettingsSearch() {
      document.querySelectorAll(".settings-row[data-search]").forEach(row => {
        row.classList.remove("search-hidden");
      });
      document.querySelectorAll(".settings-tab").forEach(tab => {
        tab.classList.remove("search-active", "active");
      });
    }

    function searchSettings(query) {
      const q = query.toLowerCase().trim();
      if (!q) { clearSettingsSearch(); return; }

      // Show all tabs during search
      document.querySelectorAll(".settings-tab").forEach(tab => {
        tab.classList.add("active", "search-active");
      });
      document.querySelectorAll(".settings-nav-item").forEach(item => {
        item.classList.remove("active");
      });

      // Filter rows
      document.querySelectorAll(".settings-row[data-search]").forEach(row => {
        const text = (row.dataset.search + " " + row.textContent).toLowerCase();
        row.classList.toggle("search-hidden", !text.includes(q));
      });
    }

    function populateKeybindingList() {
      const list = document.getElementById("keybinding-list");
      list.innerHTML = "";
      const defaultKeybindings = {
        "New Terminal": "Cmd+T", "Split Right": "Cmd+D", "Split Down": "Cmd+Shift+D",
        "Close Pane": "Cmd+W", "Command Palette": "Cmd+P", "Find": "Cmd+F",
        "Clear": "Cmd+K", "Zoom": "Cmd+Shift+Enter", "Broadcast": "Cmd+Shift+B",
        "Snippets": "Cmd+Shift+R", "Save Session": "Cmd+Shift+S",
        "Quick Command": "Cmd+;", "Settings": "Cmd+,", "IDE Mode": "Cmd+Shift+I",
      };
      for (const [action, defaultKey] of Object.entries(defaultKeybindings)) {
        const current = customKeybindings[action] || defaultKey;
        const row = document.createElement("div");
        row.className = "keybinding-row";
        row.innerHTML = `<span class="kb-action">${action}</span><span class="kb-key" data-action="${action}">${current}</span>`;
        const keyEl = row.querySelector(".kb-key");
        keyEl.addEventListener("click", () => {
          if (keyEl.classList.contains("recording")) { keyEl.classList.remove("recording"); keyEl.textContent = current; return; }
          keyEl.classList.add("recording");
          keyEl.textContent = "Press keys...";
          const handler = (e) => {
            e.preventDefault(); e.stopPropagation();
            if (e.key === "Escape") { keyEl.classList.remove("recording"); keyEl.textContent = current; document.removeEventListener("keydown", handler, true); return; }
            const parts = [];
            if (e.metaKey || e.ctrlKey) parts.push("Cmd");
            if (e.shiftKey) parts.push("Shift");
            if (e.altKey) parts.push("Alt");
            if (!["Meta", "Control", "Shift", "Alt"].includes(e.key)) parts.push(e.key.length === 1 ? e.key.toUpperCase() : e.key);
            if (parts.length > 0 && !["Cmd", "Shift", "Alt"].includes(parts[parts.length - 1])) {
              const combo = parts.join("+");
              customKeybindings[action] = combo;
              keyEl.textContent = combo;
              keyEl.classList.remove("recording");
              document.removeEventListener("keydown", handler, true);
              settings.keybindings = customKeybindings;
              window.shellfire.saveSettings(settings);
            }
          };
          document.addEventListener("keydown", handler, true);
        });
        list.appendChild(row);
      }
    }

    async function refreshSettingsExtensions() {
      // Use the new marketplace UI instead
      await fetchAndRenderMarketplace();
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
      aiSuggestions = document.getElementById("setting-ai-suggestions").checked;
      confirmClose = document.getElementById("setting-confirm-close").checked;
      autoSaveInterval = parseInt(document.getElementById("setting-auto-save-interval").value) || 60;
      bufferLimit = (newBufferKB || 512) * 1024;
      const newIdeMode = document.getElementById("setting-ide-mode").checked;
      if (newIdeMode !== ideMode) toggleIdeMode();

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
        aiSuggestions,
        confirmClose,
        autoSaveSession: document.getElementById("setting-auto-save").checked,
        autoSaveInterval,
        shell: document.getElementById("setting-shell").value.trim(),
        defaultCwd: document.getElementById("setting-cwd").value.trim(),
      };
      window.shellfire.saveSettings(settings);
      showToast("Settings saved");
    }

    function setupAutoSave() {
      if (autoSaveTimer) clearInterval(autoSaveTimer);
      if (settings.autoSaveSession !== false) {
        // First save after 5s so cached CWD/process data is available for beforeunload
        setTimeout(() => { if (panes.size > 0) saveCurrentSession(true); }, 5000);
        autoSaveTimer = setInterval(() => { if (panes.size > 0) saveCurrentSession(true); }, autoSaveInterval * 1000);
      }
    }

    // Settings event listeners
    document.getElementById("settings-close").addEventListener("click", closeSettings);
    document.getElementById("settings-overlay").addEventListener("click", (e) => {
      if (e.target === e.currentTarget) closeSettings();
    });
    // Tab switching
    document.querySelectorAll(".settings-nav-item").forEach(item => {
      item.addEventListener("click", () => {
        document.getElementById("settings-search").value = "";
        clearSettingsSearch();
        switchSettingsTab(item.dataset.tab);
      });
    });
    // Search
    document.getElementById("settings-search").addEventListener("input", (e) => {
      searchSettings(e.target.value);
    });
    // Auto-apply on change
    ["setting-theme", "setting-font-size", "setting-cursor-style", "setting-scrollback", "setting-buffer-limit", "setting-auto-save-interval"].forEach(id => {
      document.getElementById(id).addEventListener("change", applySettings);
    });
    ["setting-cursor-blink", "setting-copy-on-select", "setting-ai-suggestions", "setting-confirm-close", "setting-auto-save", "setting-ide-mode"].forEach(id => {
      document.getElementById(id).addEventListener("change", applySettings);
    });
    document.getElementById("setting-font-family").addEventListener("blur", applySettings);
    document.getElementById("setting-shell").addEventListener("blur", applySettings);
    document.getElementById("setting-cwd").addEventListener("blur", applySettings);

    // Zoom stepper
    function updateZoomValueDisplay() {
      const el = document.getElementById("setting-zoom-value");
      if (el) el.textContent = Math.round(currentZoom * 100) + "%";
    }
    document.getElementById("setting-zoom-in").addEventListener("click", () => { zoomIn(); updateZoomValueDisplay(); });
    document.getElementById("setting-zoom-out").addEventListener("click", () => { zoomOut(); updateZoomValueDisplay(); });
    document.getElementById("setting-zoom-reset").addEventListener("click", () => { zoomReset(); updateZoomValueDisplay(); });

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
      "IDE Mode": "Cmd+Shift+I",
    };

    // Keybinding editor is now populated in openSettings -> populateKeybindingList()

    // Add Settings to command palette
    commands.push(
      { label: "Settings", shortcut: "Cmd+,", action: () => openSettings(), category: "System" },
      { label: "Extensions", action: () => openSettings("extensions"), category: "System" },
      { label: "Check for Updates", action: async () => {
        try {
          const result = await window.shellfire.checkForUpdates();
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
        const s = await window.shellfire.loadSettings();
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
        window.shellfire.saveSettings(settings);

        overlay.classList.remove("visible");
        showToast("Welcome to Shellfire!");
      });
    }

    // ============================================================
    // KEYBOARD: Settings shortcut
    // ============================================================
    // Cmd+, to open settings (added to existing keydown handler below)

    // ============================================================
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
    // PLUGIN SYSTEM
    // ============================================================
    const _loadedPlugins = new Set(); // track already-loaded plugin names
    // Registry: pluginName -> { type, themeIdx, themeName, commands[], domIds[], hooks:{event:[fn]}, intervals[], settingsSections[], widgetEl }
    const _pluginRegistry = new Map();

    async function activateSinglePlugin(pluginName, type) {
      if (_loadedPlugins.has(pluginName)) return;
      try {
        const result = await window.shellfire.getPluginCode(pluginName);
        if (!result || result.error) {
          console.warn(`Plugin ${pluginName}: ${result?.error || "no code returned"}`);
          return;
        }

        const pluginExports = {};
        try {
          const pluginFn = new Function("exports", result.code);
          pluginFn(pluginExports);
        } catch (evalErr) {
          console.error(`Plugin eval error: ${pluginName}`, evalErr);
          showToast(`Plugin error: ${pluginName}`, "error");
          return;
        }
        _loadedPlugins.add(pluginName);
        await _applyPlugin(pluginExports, pluginName, type);
      } catch (err) {
        console.error(`Plugin load failed: ${pluginName}`, err);
      }
    }

    async function _applyPlugin(pluginExports, pluginName, type) {
      const reg = { type, commands: [], domIds: [], hooks: {}, intervals: [], settingsSections: [] };

      if (type === "theme" && pluginExports.theme) {
        const t = pluginExports.theme;
        const themeObj = {
          name: t.name || pluginName,
          body: t.background || "#1e1e1e",
          ui: t.ui || t.background || "#2d2d2d",
          border: t.border || t.background || "#1a1a1a",
          _plugin: pluginName,
          term: {
            background: t.background || "#1e1e1e",
            foreground: t.foreground || "#cccccc",
            cursor: t.cursor || t.foreground || "#cccccc",
            cursorAccent: t.background || "#1e1e1e",
            selectionBackground: t.selection || "rgba(255,255,255,0.2)",
            selectionForeground: t.selectionForeground || "#ffffff",
            black: t.black || "#000000", red: t.red || "#c91b00",
            green: t.green || "#00c200", yellow: t.yellow || "#c7c400",
            blue: t.blue || "#0225c7", magenta: t.magenta || "#c930c7",
            cyan: t.cyan || "#00c5c7", white: t.white || "#c7c7c7",
            brightBlack: t.brightBlack || "#686868", brightRed: t.brightRed || "#ff6e67",
            brightGreen: t.brightGreen || "#5ffa68", brightYellow: t.brightYellow || "#fffc67",
            brightBlue: t.brightBlue || "#6871ff", brightMagenta: t.brightMagenta || "#ff76ff",
            brightCyan: t.brightCyan || "#60fdff", brightWhite: t.brightWhite || "#ffffff",
          },
        };
        themes.push(themeObj);
        reg.themeIdx = themes.length - 1;
        reg.themeName = themeObj.name;
        const cmdLabel = `Theme: ${themeObj.name}`;
        const cmd = { label: cmdLabel, action: () => applyTheme(themes.indexOf(themeObj)), category: "Appearance" };
        commands.push(cmd);
        reg.commands.push(cmd);
      }

      if (type === "command" && pluginExports.name && pluginExports.execute) {
        const cmdCtx = {
          get activePane() { return activeId ? { id: activeId, ...panes.get(activeId) } : null; },
          get allPanes() { return [...panes.entries()].map(([id, p]) => ({ id, ...p })); },
          sendInput: (id, data) => window.shellfire.sendInput(id, data),
          createTerminal: (cwd) => addTerminal(cwd),
          notify: (msg) => showToast(msg),
        };
        const cmd = {
          label: pluginExports.name,
          shortcut: pluginExports.shortcut || undefined,
          action: () => pluginExports.execute(cmdCtx),
          category: "Plugins",
        };
        commands.push(cmd);
        reg.commands.push(cmd);
      }

      if (type === "statusbar" && pluginExports.name && pluginExports.render) {
        const sbCtx = {
          get activePane() { return activeId ? { id: activeId, ...panes.get(activeId) } : null; },
          get allPanes() { return [...panes.entries()].map(([id, p]) => ({ id, ...p })); },
        };
        const widget = document.createElement("span");
        widget.className = "plugin-statusbar-widget";
        widget.style.cssText = "margin-left:8px;font-family:'SF Mono',monospace;font-size:11px;opacity:0.8;";
        widget.title = pluginExports.name;
        try { widget.innerHTML = pluginExports.render(sbCtx); } catch {}
        const bottombar = document.querySelector(".bottombar");
        const paneCountEl2 = document.getElementById("pane-count");
        if (bottombar && paneCountEl2) bottombar.insertBefore(widget, paneCountEl2);
        let errorCount = 0;
        const intervalId = setInterval(() => {
          try {
            if (_appVisible) widget.innerHTML = pluginExports.render(sbCtx);
            errorCount = 0;
          } catch (err) {
            errorCount++;
            if (errorCount >= 3) {
              clearInterval(intervalId);
              console.warn(`Statusbar plugin "${pluginName}" disabled after repeated errors`);
            }
          }
        }, 5000);
        reg.widgetEl = widget;
        reg.intervals.push(intervalId);
      }

      if (type === "extension" && pluginExports.activate) {
        // Create a tracked ctx proxy so we can clean up on uninstall
        const pluginCtx = {
          get activeId() { return window._termExt.activeId; },
          getPane(id) { return window._termExt.getPane(id); },
          get allPaneIds() { return window._termExt.allPaneIds; },
          get fontSize() { return window._termExt.fontSize; },
          get broadcastMode() { return window._termExt.broadcastMode; },
          get skipPermissions() { return window._termExt.skipPermissions; },
          set skipPermissions(val) { window._termExt.skipPermissions = val; },
          toggleSkipPermissions() { window._termExt.toggleSkipPermissions(); },
          sendInput(id, data) { window._termExt.sendInput(id, data); },
          broadcast(ids, data) { window._termExt.broadcast(ids, data); },
          showToast(msg) { window._termExt.showToast(msg); },
          get settings() { return window._termExt.settings; },
          saveSettings() { window._termExt.saveSettings(); },
          get ipc() { return window._termExt.ipc; },
          on(event, fn) {
            window._termExt.on(event, fn);
            if (!reg.hooks[event]) reg.hooks[event] = [];
            reg.hooks[event].push(fn);
          },
          off(event, fn) { window._termExt.off(event, fn); },
          registerCommand(cmd) {
            window._termExt.registerCommand(cmd);
            reg.commands.push(cmd);
          },
          addToolbarButton(opts) {
            window._termExt.addToolbarButton(opts);
            if (opts.id) reg.domIds.push(opts.id);
          },
          addSidePanel(id, html) {
            const panel = window._termExt.addSidePanel(id, html);
            reg.domIds.push(id);
            return panel;
          },
          addSettingsSection(html, onMount) {
            const sec = { html, onMount };
            _extSettingsSections.push(sec);
            reg.settingsSections.push(sec);
          },
        };
        try {
          pluginExports.activate(pluginCtx);
        } catch (err) {
          console.error(`Extension ${pluginName} activation error:`, err);
        }
      }

      _pluginRegistry.set(pluginName, reg);
    }

    /** Remove all traces of a plugin without reloading */
    function deactivatePlugin(pluginName) {
      const reg = _pluginRegistry.get(pluginName);
      if (!reg) return;

      // Remove commands from palette
      for (const cmd of reg.commands) {
        const idx = commands.indexOf(cmd);
        if (idx >= 0) commands.splice(idx, 1);
      }

      // Remove DOM elements (toolbar buttons, side panels)
      for (const domId of reg.domIds) {
        const el = document.getElementById(domId);
        if (el) el.remove();
      }

      // Unhook event listeners
      for (const [event, fns] of Object.entries(reg.hooks)) {
        for (const fn of fns) {
          if (_extHooks[event]) _extHooks[event] = _extHooks[event].filter(f => f !== fn);
        }
      }

      // Clear intervals (statusbar widgets)
      for (const id of reg.intervals) clearInterval(id);
      if (reg.widgetEl && reg.widgetEl.parentNode) reg.widgetEl.remove();

      // Remove settings sections (from array and from DOM if already mounted)
      for (const sec of reg.settingsSections) {
        const idx = _extSettingsSections.indexOf(sec);
        if (idx >= 0) _extSettingsSections.splice(idx, 1);
        if (sec._mounted && sec._container) {
          sec._container.remove();
        }
      }

      // Remove theme if this was a theme plugin
      if (reg.type === "theme" && reg.themeName) {
        const wasActive = themes[currentThemeIdx] && themes[currentThemeIdx].name === reg.themeName;
        const tIdx = themes.findIndex(t => t._plugin === pluginName);
        if (tIdx >= 0) {
          themes.splice(tIdx, 1);
          // Fix currentThemeIdx if the removed theme shifted indices
          if (wasActive) {
            applyTheme(0);
          } else if (tIdx < currentThemeIdx) {
            currentThemeIdx--;
          }
        }
      }

      // Remove injected <style> elements for this plugin
      document.querySelectorAll(`style[data-plugin="${pluginName}"]`).forEach(el => el.remove());

      _loadedPlugins.delete(pluginName);
      _pluginRegistry.delete(pluginName);
    }

    /** Refresh theme dropdowns & command palette after plugin changes */
    function _refreshThemeUIs() {
      // Settings theme dropdown
      const themeSelect = document.getElementById("setting-theme");
      if (themeSelect) {
        themeSelect.innerHTML = "";
        themes.forEach((t, i) => {
          const opt = document.createElement("option");
          opt.value = i; opt.textContent = t.name;
          if (i === currentThemeIdx) opt.selected = true;
          themeSelect.appendChild(opt);
        });
      }
      // Welcome screen theme dropdown
      const welcomeThemeSelect = document.getElementById("welcome-theme-select");
      if (welcomeThemeSelect) {
        welcomeThemeSelect.innerHTML = "";
        themes.forEach((t, i) => {
          const opt = document.createElement("option");
          opt.value = i; opt.textContent = t.name;
          if (i === currentThemeIdx) opt.selected = true;
          welcomeThemeSelect.appendChild(opt);
        });
      }
    }

    async function loadPlugins() {
      try {
        const plugins = await window.shellfire.loadPlugins();
        if (!Array.isArray(plugins) || plugins.length === 0) return;
        for (const plugin of plugins) {
          try {
            await activateSinglePlugin(plugin.manifest.name, plugin.manifest.type);
          } catch (err) {
            console.error(`[plugins] Failed to load ${plugin.manifest.name}:`, err);
          }
        }
      } catch (err) {
        console.error("[plugins] Plugin system error:", err);
      }
    }

    // ============================================================
    // SECRETS MANAGER
    // ============================================================
    let secretsVault = []; // { key, value, injected? }

    async function loadSecretsVault() {
      try { const saved = await window.shellfire.loadSecrets(); if (Array.isArray(saved)) secretsVault = saved; } catch {}
    }

    function openSecretsPanel() {
      document.getElementById("secrets-panel").classList.add("visible");
      renderSecretsList();
    }

    function renderSecretsList() {
      const body = document.getElementById("secrets-body");
      body.innerHTML = "";
      if (secretsVault.length === 0) {
        body.innerHTML = '<div class="secrets-empty">No secrets stored.<br>Add env vars above to get started.</div>';
        return;
      }
      secretsVault.forEach((s, i) => {
        const row = document.createElement("div");
        row.className = "secret-row";
        const masked = "\u2022".repeat(Math.min(s.value.length, 20));
        row.innerHTML = `
          <input type="checkbox" class="secret-check" data-idx="${i}" checked />
          <span class="secret-key">${escapeHtml(s.key)}</span>
          <span class="secret-value" title="Click to reveal">${masked}</span>
          <div class="secret-actions">
            <button class="reveal" title="Toggle reveal">eye</button>
            <button class="copy" title="Copy value">copy</button>
            <button class="danger" title="Delete">&times;</button>
          </div>
        `;
        // Toggle reveal
        let revealed = false;
        row.querySelector(".reveal").addEventListener("click", (e) => {
          e.stopPropagation();
          revealed = !revealed;
          row.querySelector(".secret-value").textContent = revealed ? s.value : masked;
        });
        // Copy
        row.querySelector(".copy").addEventListener("click", (e) => {
          e.stopPropagation();
          navigator.clipboard.writeText(s.value);
          showToast(`Copied ${s.key}`);
        });
        // Delete
        row.querySelector(".danger").addEventListener("click", (e) => {
          e.stopPropagation();
          secretsVault.splice(i, 1);
          window.shellfire.saveSecrets(secretsVault);
          renderSecretsList();
          showToast("Secret deleted");
        });
        body.appendChild(row);
      });
    }

    document.getElementById("secrets-close").addEventListener("click", () => {
      document.getElementById("secrets-panel").classList.remove("visible");
      if (activeId && panes.has(activeId)) panes.get(activeId).term.focus();
    });

    document.getElementById("secret-add-btn").addEventListener("click", () => {
      const keyInput = document.getElementById("secret-key-input");
      const valInput = document.getElementById("secret-value-input");
      const key = keyInput.value.trim().toUpperCase();
      const value = valInput.value;
      if (!key) { keyInput.focus(); return; }
      if (!value) { valInput.focus(); return; }
      // Update existing or add new
      const existing = secretsVault.findIndex(s => s.key === key);
      if (existing >= 0) secretsVault[existing].value = value;
      else secretsVault.push({ key, value });
      window.shellfire.saveSecrets(secretsVault);
      keyInput.value = "";
      valInput.value = "";
      renderSecretsList();
      showToast(existing >= 0 ? `Updated ${key}` : `Added ${key}`);
    });

    document.getElementById("secret-key-input").addEventListener("keydown", (e) => {
      if (e.key === "Enter") document.getElementById("secret-value-input").focus();
    });
    document.getElementById("secret-value-input").addEventListener("keydown", (e) => {
      if (e.key === "Enter") document.getElementById("secret-add-btn").click();
    });

    // Inject all secrets into active pane
    document.getElementById("secrets-inject-btn").addEventListener("click", async () => {
      if (!activeId) { showToast("No active terminal"); return; }
      if (secretsVault.length === 0) { showToast("No secrets to inject"); return; }
      const result = await window.shellfire.injectSecrets({ id: activeId, secrets: secretsVault });
      if (result.ok) showToast(`Injected ${result.count} secret${result.count > 1 ? "s" : ""} into terminal`);
      else showToast("Failed to inject secrets", "error");
    });

    // Inject selected secrets
    document.getElementById("secrets-inject-select-btn").addEventListener("click", async () => {
      if (!activeId) { showToast("No active terminal"); return; }
      const checks = document.querySelectorAll("#secrets-body .secret-check:checked");
      const selected = [];
      checks.forEach(cb => {
        const idx = parseInt(cb.dataset.idx);
        if (secretsVault[idx]) selected.push(secretsVault[idx]);
      });
      if (selected.length === 0) { showToast("No secrets selected"); return; }
      const result = await window.shellfire.injectSecrets({ id: activeId, secrets: selected });
      if (result.ok) showToast(`Injected ${result.count} selected secret${result.count > 1 ? "s" : ""}`);
      else showToast("Failed to inject secrets", "error");
    });

    // ============================================================
    // STATUS BAR WIDGETS (clock, k8s, AWS, node)
    // ============================================================
    const widgetClock = document.getElementById("widget-clock");
    const widgetK8s = document.getElementById("widget-k8s");
    const widgetAws = document.getElementById("widget-aws");
    const widgetNode = document.getElementById("widget-node");

    function updateClockWidget() {
      const now = new Date();
      const h = String(now.getHours()).padStart(2, "0");
      const m = String(now.getMinutes()).padStart(2, "0");
      const s = String(now.getSeconds()).padStart(2, "0");
      widgetClock.innerHTML = `<span class="widget-icon">\u23F0</span> ${h}:${m}:${s}`;
      widgetClock.classList.add("visible");
    }
    setInterval(updateClockWidget, 1000);
    updateClockWidget();

    async function updateK8sWidget() {
      try {
        const ctx = await window.shellfire.getK8sContext();
        if (ctx) {
          widgetK8s.innerHTML = `<span class="widget-icon">\u2638</span> <span class="widget-label">${escapeHtml(ctx)}</span>`;
          widgetK8s.classList.add("visible");
        } else {
          widgetK8s.classList.remove("visible");
        }
      } catch { widgetK8s.classList.remove("visible"); }
    }

    async function updateAwsWidget() {
      try {
        const profile = await window.shellfire.getAwsProfile();
        if (profile) {
          widgetAws.innerHTML = `<span class="widget-icon">\u2601</span> <span class="widget-label">${escapeHtml(profile)}</span>`;
          widgetAws.classList.add("visible");
        } else {
          widgetAws.classList.remove("visible");
        }
      } catch { widgetAws.classList.remove("visible"); }
    }

    async function updateNodeWidget() {
      try {
        const ver = await window.shellfire.getNodeVersion();
        if (ver) {
          widgetNode.innerHTML = `<span class="widget-icon">\u25CF</span> ${escapeHtml(ver)}`;
          widgetNode.classList.add("visible");
        } else {
          widgetNode.classList.remove("visible");
        }
      } catch { widgetNode.classList.remove("visible"); }
    }

    // Refresh context-sensitive widgets periodically
    setInterval(() => { updateK8sWidget(); updateAwsWidget(); }, 30000);
    updateNodeWidget(); // once on startup

    // ============================================================
    // ENHANCED PIP (Picture-in-Picture)
    // ============================================================
    const _origToggleFloating = toggleFloating;
    toggleFloating = function(id) {
      const targetId = id || activeId;
      if (!targetId) return;
      const pane = panes.get(targetId);
      if (!pane) return;

      if (floatingPanes.has(targetId)) {
        // Restore — remove PiP controls
        const controls = pane.el.querySelector(".pip-controls");
        if (controls) controls.remove();
        const slider = pane.el.querySelector(".pip-opacity-slider");
        if (slider) slider.remove();
        pane.el.style.opacity = "";
        pane.el.classList.remove("pip-compact");
        pane.el.classList.remove("floating");
        pane.el.style.width = "";
        pane.el.style.height = "";
        pane.el.style.left = "";
        pane.el.style.top = "";
        pane.el.style.right = "";
        pane.el.style.bottom = "";
        floatingPanes.delete(targetId);
        renderLayout();
        showToast("Pane restored");
      } else {
        // Float with enhanced PiP
        floatingPanes.add(targetId);
        pane.el.classList.add("floating");
        pane.el.style.width = "480px";
        pane.el.style.height = "320px";
        pane.el.style.right = "20px";
        pane.el.style.bottom = "50px";
        pane.el.style.left = "auto";
        pane.el.style.top = "auto";
        document.body.appendChild(pane.el);

        // Add PiP control bar
        const controls = document.createElement("div");
        controls.className = "pip-controls";
        controls.innerHTML = `
          <button class="pip-compact-btn" title="Compact mode">\u25A1</button>
          <button class="pip-snap-tl" title="Snap top-left">\u2196</button>
          <button class="pip-snap-tr" title="Snap top-right">\u2197</button>
          <button class="pip-snap-bl" title="Snap bottom-left">\u2199</button>
          <button class="pip-snap-br" title="Snap bottom-right">\u2198</button>
          <button class="pip-restore" title="Restore">\u21A9</button>
        `;
        controls.querySelector(".pip-compact-btn").addEventListener("click", (e) => {
          e.stopPropagation();
          pane.el.classList.toggle("pip-compact");
          if (pane.el.classList.contains("pip-compact")) {
            pane.el.style.width = "320px";
            pane.el.style.height = "200px";
          } else {
            pane.el.style.width = "480px";
            pane.el.style.height = "320px";
          }
          pane.fitAddon.fit();
        });
        const snapPositions = {
          "pip-snap-tl": { top: "50px", left: "20px", right: "auto", bottom: "auto" },
          "pip-snap-tr": { top: "50px", right: "20px", left: "auto", bottom: "auto" },
          "pip-snap-bl": { bottom: "50px", left: "20px", right: "auto", top: "auto" },
          "pip-snap-br": { bottom: "50px", right: "20px", left: "auto", top: "auto" },
        };
        for (const [cls, pos] of Object.entries(snapPositions)) {
          controls.querySelector(`.${cls}`).addEventListener("click", (e) => {
            e.stopPropagation();
            Object.assign(pane.el.style, pos);
          });
        }
        controls.querySelector(".pip-restore").addEventListener("click", (e) => {
          e.stopPropagation();
          toggleFloating(targetId);
        });
        pane.el.querySelector(".pane-header").after(controls);

        // Opacity slider
        const slider = document.createElement("input");
        slider.type = "range";
        slider.className = "pip-opacity-slider";
        slider.min = "30";
        slider.max = "100";
        slider.value = "100";
        slider.addEventListener("input", () => {
          pane.el.style.opacity = parseInt(slider.value) / 100;
        });
        pane.el.appendChild(slider);

        makeDraggable(pane.el, pane.el.querySelector(".pane-header"));
        pane.fitAddon.fit();
        showToast("PiP mode — drag to move, use controls to snap");
      }
    };

    // ============================================================
    // QUICK ACTIONS ON TERMINAL OUTPUT
    // ============================================================
    const quickActionMenuEl = document.createElement("div");
    quickActionMenuEl.className = "quick-action-menu";
    quickActionMenuEl.id = "quick-action-menu";
    document.body.appendChild(quickActionMenuEl);

    // Patterns for detection
    const QA_PATTERNS = {
      ipv4: /\b(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})\b/,
      port: /(?:localhost|127\.0\.0\.1|0\.0\.0\.0):(\d{2,5})\b/,
      filepath: /(?:^|\s)((?:\/[\w.\-]+)+(?:\.[\w]+)?)/,
      dockerId: /\b([0-9a-f]{12,64})\b/,
      url: /https?:\/\/[^\s'">\]]+/,
      pid: /\bPID[:\s]+(\d{2,7})\b/i,
    };

    function detectQuickActions(text) {
      const actions = [];
      const trimmed = text.trim();
      if (!trimmed) return actions;

      // URL detection
      const urlMatch = trimmed.match(QA_PATTERNS.url);
      if (urlMatch) {
        actions.push({ type: "url", value: urlMatch[0], label: "Open URL", icon: "\uD83C\uDF10",
          action: () => window.open(urlMatch[0], "_blank") });
        actions.push({ type: "url", value: urlMatch[0], label: "Copy URL", icon: "\uD83D\uDCCB",
          action: () => { navigator.clipboard.writeText(urlMatch[0]); showToast("Copied URL"); } });
      }

      // IP address
      const ipMatch = trimmed.match(QA_PATTERNS.ipv4);
      if (ipMatch && !urlMatch) {
        const ip = ipMatch[1];
        actions.push({ type: "ip", value: ip, label: `Ping ${ip}`, icon: "\uD83C\uDFD3",
          action: async () => { const id = await addTerminal(); setTimeout(() => window.shellfire.sendInput(id, `ping -c 4 ${ip}\n`), 200); } });
        actions.push({ type: "ip", value: ip, label: `SSH to ${ip}`, icon: "\uD83D\uDD12",
          action: async () => { const id = await addTerminal(); setTimeout(() => window.shellfire.sendInput(id, `ssh ${ip}\n`), 200); } });
        actions.push({ type: "ip", value: ip, label: "Copy IP", icon: "\uD83D\uDCCB",
          action: () => { navigator.clipboard.writeText(ip); showToast("Copied IP"); } });
      }

      // Port (localhost:PORT pattern)
      const portMatch = trimmed.match(QA_PATTERNS.port);
      if (portMatch) {
        const port = portMatch[1];
        actions.push({ type: "port", value: `:${port}`, label: `Open localhost:${port}`, icon: "\uD83C\uDF10",
          action: () => window.open(`http://localhost:${port}`, "_blank") });
        actions.push({ type: "port", value: `:${port}`, label: `Kill process on :${port}`, icon: "\u274C",
          action: async () => {
            const ports = await window.shellfire.listPorts();
            const match = ports.find(p => p.port === port);
            if (match) { await window.shellfire.killPort(match.pid); showToast(`Killed PID ${match.pid}`); }
            else showToast("Process not found on this port");
          }});
      }

      // File path
      const pathMatch = trimmed.match(QA_PATTERNS.filepath);
      if (pathMatch && pathMatch[1].length > 3) {
        const fp = pathMatch[1];
        actions.push({ type: "path", value: fp, label: "Open in editor", icon: "\uD83D\uDCDD",
          action: () => window.shellfire.openInEditor(fp) });
        actions.push({ type: "path", value: fp, label: "Preview file", icon: "\uD83D\uDC41",
          action: () => showFilePreview(fp) });
        actions.push({ type: "path", value: fp, label: "cd to directory", icon: "\uD83D\uDCC2",
          action: () => {
            const dir = fp.replace(/\/[^/]+$/, "") || fp;
            if (activeId) window.shellfire.sendInput(activeId, `cd ${dir}\n`);
          }});
        actions.push({ type: "path", value: fp, label: "Copy path", icon: "\uD83D\uDCCB",
          action: () => { navigator.clipboard.writeText(fp); showToast("Copied path"); } });
      }

      // Docker container ID (12+ hex chars)
      const dockerMatch = trimmed.match(QA_PATTERNS.dockerId);
      if (dockerMatch && dockerMatch[1].length >= 12 && /^[0-9a-f]+$/.test(dockerMatch[1])) {
        const cid = dockerMatch[1].slice(0, 12);
        actions.push({ type: "container", value: cid, label: `Exec into ${cid}`, icon: "\uD83D\uDC33",
          action: async () => { const id = await addTerminal(); setTimeout(() => window.shellfire.sendInput(id, `docker exec -it ${cid} sh\n`), 200); } });
        actions.push({ type: "container", value: cid, label: `Logs ${cid}`, icon: "\uD83D\uDCDC",
          action: async () => { const id = await addTerminal(); setTimeout(() => window.shellfire.sendInput(id, `docker logs -f ${cid}\n`), 200); } });
        actions.push({ type: "container", value: cid, label: `Stop ${cid}`, icon: "\u23F9",
          action: async () => { const id = await addTerminal(); setTimeout(() => window.shellfire.sendInput(id, `docker stop ${cid}\n`), 200); } });
      }

      // PID
      const pidMatch = trimmed.match(QA_PATTERNS.pid);
      if (pidMatch) {
        const pid = pidMatch[1];
        actions.push({ type: "pid", value: `PID ${pid}`, label: `Kill PID ${pid}`, icon: "\u274C",
          action: async () => { await window.shellfire.killPort(pid); showToast(`Killed PID ${pid}`); } });
      }

      return actions;
    }

    function showQuickActionMenu(x, y, paneId) {
      const pane = panes.get(paneId);
      if (!pane) return;

      // Get selected text or try to get the line under cursor
      const selection = pane.term.getSelection();
      const text = selection || "";

      if (!text) return null; // No text selected, fall through to normal context menu

      const actions = detectQuickActions(text);
      if (actions.length === 0) return null; // No patterns detected

      quickActionMenuEl.innerHTML = "";

      // Header with detected type
      const typeLabel = actions[0].type.toUpperCase();
      const header = document.createElement("div");
      header.className = "quick-action-header";
      header.textContent = `DETECTED: ${typeLabel}`;
      quickActionMenuEl.appendChild(header);

      // Show the value
      const valueEl = document.createElement("div");
      valueEl.className = "quick-action-value";
      valueEl.textContent = actions[0].value;
      quickActionMenuEl.appendChild(valueEl);

      // Action items
      for (const act of actions) {
        const item = document.createElement("div");
        item.className = "quick-action-item";
        item.innerHTML = `<span class="qa-icon">${act.icon}</span><span>${act.label}</span>`;
        item.addEventListener("click", () => {
          quickActionMenuEl.classList.remove("visible");
          act.action();
        });
        quickActionMenuEl.appendChild(item);
      }

      quickActionMenuEl.classList.add("visible");
      // Position
      const menuRect = quickActionMenuEl.getBoundingClientRect();
      const viewW = window.innerWidth, viewH = window.innerHeight;
      const finalX = (x + menuRect.width > viewW) ? Math.max(0, viewW - menuRect.width - 4) : x;
      const finalY = (y + menuRect.height > viewH) ? Math.max(0, viewH - menuRect.height - 4) : y;
      quickActionMenuEl.style.left = finalX + "px";
      quickActionMenuEl.style.top = finalY + "px";
      return true; // Signal that we showed the quick action menu
    }

    // Close quick action menu on click
    document.addEventListener("click", () => quickActionMenuEl.classList.remove("visible"));

    // Hook into the existing context menu to add quick actions
    const _origShowContextMenu = showContextMenu;
    showContextMenu = function(x, y, paneId) {
      // Try quick actions first if there's a selection
      const pane = panes.get(paneId);
      if (pane) {
        const selection = pane.term.getSelection();
        if (selection && selection.trim().length > 2) {
          const actions = detectQuickActions(selection);
          if (actions.length > 0) {
            // Show combined menu: quick actions + regular items
            if (showQuickActionMenu(x, y, paneId)) return;
          }
        }
      }
      // Fall back to normal context menu
      _origShowContextMenu(x, y, paneId);
    };

    // ============================================================
    // STARTUP TASKS
    // ============================================================
    let startupTasks = []; // { name, autoRun, steps: [{ cwd, command, delay }] }

    async function loadStartupTasks() {
      try { const saved = await window.shellfire.loadStartupTasks(); if (Array.isArray(saved)) startupTasks = saved; } catch {}
    }

    function openStartupTasks() {
      document.getElementById("startup-tasks-overlay").classList.add("visible");
      renderStartupTasksList();
    }

    function closeStartupTasks() {
      document.getElementById("startup-tasks-overlay").classList.remove("visible");
      if (activeId && panes.has(activeId)) panes.get(activeId).term.focus();
    }

    function renderStartupTasksList() {
      const body = document.getElementById("startup-tasks-body");
      body.innerHTML = "";
      if (startupTasks.length === 0) {
        body.innerHTML = '<div class="startup-tasks-empty">No startup tasks defined.<br>Create one to auto-open panes and run commands on launch.</div>';
        return;
      }
      startupTasks.forEach((task, i) => {
        const stepDesc = task.steps.map(s => {
          const parts = [];
          if (s.cwd) parts.push(s.cwd.replace(/^\/Users\/[^/]+/, "~"));
          if (s.command) parts.push(s.command);
          return parts.join(": ") || "empty pane";
        }).join(" \u2192 ");

        const item = document.createElement("div");
        item.className = "startup-task-item";
        item.innerHTML = `
          <div class="startup-task-info">
            <div class="startup-task-name">${escapeHtml(task.name)}</div>
            <div class="startup-task-desc">${task.steps.length} pane${task.steps.length !== 1 ? "s" : ""}: ${escapeHtml(stepDesc)}</div>
          </div>
          ${task.autoRun ? '<span class="startup-task-auto">AUTO</span>' : ''}
          <div class="startup-task-actions">
            <button class="run" title="Run now">\u25B6</button>
            <button class="auto" title="Toggle auto-run">${task.autoRun ? "\u2713 Auto" : "Auto"}</button>
            <button class="edit" title="Edit">\u270E</button>
            <button class="danger" title="Delete">&times;</button>
          </div>
        `;
        item.querySelector(".run").addEventListener("click", (e) => { e.stopPropagation(); runStartupTask(task); });
        item.querySelector(".auto").addEventListener("click", (e) => {
          e.stopPropagation();
          task.autoRun = !task.autoRun;
          window.shellfire.saveStartupTasks(startupTasks);
          renderStartupTasksList();
          showToast(task.autoRun ? `"${task.name}" will auto-run on launch` : `"${task.name}" auto-run disabled`);
        });
        item.querySelector(".edit").addEventListener("click", (e) => { e.stopPropagation(); editStartupTask(i); });
        item.querySelector(".danger").addEventListener("click", (e) => {
          e.stopPropagation();
          startupTasks.splice(i, 1);
          window.shellfire.saveStartupTasks(startupTasks);
          renderStartupTasksList();
          showToast("Startup task deleted");
        });
        item.addEventListener("click", () => runStartupTask(task));
        body.appendChild(item);
      });
    }

    async function runStartupTask(task) {
      closeStartupTasks();
      showToast(`Running "${task.name}"...`);
      for (let si = 0; si < task.steps.length; si++) {
        const step = task.steps[si];
        const id = await addTerminal(step.cwd || null);
        if (step.command) {
          const delay = step.delay || 300;
          setTimeout(() => {
            if (panes.has(id)) window.shellfire.sendInput(id, step.command + "\n");
          }, delay);
        }
        // Small delay between panes to let them initialize
        if (si < task.steps.length - 1) await new Promise(r => setTimeout(r, 200));
      }
      showToast(`"${task.name}" started (${task.steps.length} panes)`);
    }

    function editStartupTask(index) {
      const isNew = index < 0;
      const task = isNew ? { name: "", autoRun: false, steps: [{ cwd: "", command: "", delay: 300 }] } : JSON.parse(JSON.stringify(startupTasks[index]));

      if (_paletteCleanup) { _paletteCleanup(); _paletteCleanup = null; }
      const overlay = document.getElementById("palette-overlay");
      const input = document.getElementById("palette-input");
      const results = document.getElementById("palette-results");
      overlay.classList.add("visible");
      input.placeholder = isNew ? "Task name (e.g., 'Dev Environment')..." : `Editing: ${task.name}`;
      input.value = task.name;
      input.focus();

      function renderEditor() {
        results.innerHTML = "";
        // Steps
        task.steps.forEach((step, si) => {
          const el = document.createElement("div");
          el.className = "palette-item";
          el.style.cssText = "flex-direction:column;align-items:stretch;padding:10px 18px;gap:6px";
          el.innerHTML = `
            <div style="display:flex;justify-content:space-between;align-items:center">
              <span style="font-size:10px;color:var(--t-fg);opacity:0.4;font-weight:600">PANE ${si + 1}</span>
              <button style="background:none;border:none;color:#ff453a;cursor:pointer;font-size:12px;padding:2px 6px" class="step-del">&times;</button>
            </div>
            <div style="display:flex;gap:6px">
              <input class="step-cwd" value="${escapeHtml(step.cwd || "")}" placeholder="Working directory (optional)" style="flex:1;background:var(--t-bg);border:1px solid var(--t-border);border-radius:4px;color:var(--t-fg);font-size:11px;padding:5px 8px;outline:none;font-family:'SF Mono',monospace" />
              <input class="step-cmd" value="${escapeHtml(step.command || "")}" placeholder="Command to run (optional)" style="flex:1;background:var(--t-bg);border:1px solid var(--t-border);border-radius:4px;color:var(--t-fg);font-size:11px;padding:5px 8px;outline:none;font-family:'SF Mono',monospace" />
            </div>
          `;
          el.querySelector(".step-cwd").addEventListener("change", (e) => { step.cwd = e.target.value.trim(); });
          el.querySelector(".step-cmd").addEventListener("change", (e) => { step.command = e.target.value.trim(); });
          el.querySelector(".step-del").addEventListener("click", () => {
            if (task.steps.length > 1) { task.steps.splice(si, 1); renderEditor(); }
          });
          results.appendChild(el);
        });

        // Add step button
        const addEl = document.createElement("div");
        addEl.className = "palette-item";
        addEl.style.cssText = "justify-content:center;color:var(--t-accent);font-size:12px";
        addEl.innerHTML = `<span>+ Add Pane</span>`;
        addEl.addEventListener("click", () => {
          task.steps.push({ cwd: "", command: "", delay: 300 });
          renderEditor();
        });
        results.appendChild(addEl);

        // Save button
        const saveEl = document.createElement("div");
        saveEl.className = "palette-item";
        saveEl.style.cssText = "justify-content:center;margin-top:8px;border-top:1px solid var(--t-border);padding-top:12px";
        saveEl.innerHTML = `<button style="background:var(--t-accent);border:none;color:#fff;padding:8px 24px;border-radius:6px;cursor:pointer;font-size:12px;font-weight:500">${isNew ? "Create Task" : "Save Changes"}</button>`;
        saveEl.querySelector("button").addEventListener("click", () => {
          // Read all step inputs
          const cwdInputs = results.querySelectorAll(".step-cwd");
          const cmdInputs = results.querySelectorAll(".step-cmd");
          cwdInputs.forEach((inp, i) => { if (task.steps[i]) task.steps[i].cwd = inp.value.trim(); });
          cmdInputs.forEach((inp, i) => { if (task.steps[i]) task.steps[i].command = inp.value.trim(); });

          task.name = input.value.trim() || `Task ${startupTasks.length + 1}`;
          if (isNew) startupTasks.push(task);
          else startupTasks[index] = task;
          window.shellfire.saveStartupTasks(startupTasks);
          overlay.classList.remove("visible");
          input.placeholder = "Type a command...";
          renderStartupTasksList();
          showToast(isNew ? `Created "${task.name}"` : `Updated "${task.name}"`);
        });
        results.appendChild(saveEl);
      }
      renderEditor();

      const handler = (e) => {
        if (e.key === "Escape") {
          overlay.classList.remove("visible");
          input.placeholder = "Type a command...";
          input.removeEventListener("keydown", handler);
        }
      };
      input.addEventListener("keydown", handler);
      _paletteCleanup = () => { input.removeEventListener("keydown", handler); };
    }

    document.getElementById("startup-add-btn").addEventListener("click", () => editStartupTask(-1));
    document.getElementById("startup-close-btn").addEventListener("click", closeStartupTasks);
    document.getElementById("startup-tasks-overlay").addEventListener("click", (e) => {
      if (e.target === document.getElementById("startup-tasks-overlay")) closeStartupTasks();
    });

    // Auto-run startup tasks on launch (called from INIT)
    async function runAutoStartupTasks() {
      const autoTasks = startupTasks.filter(t => t.autoRun);
      if (autoTasks.length === 0) return false;
      for (const task of autoTasks) {
        await runStartupTask(task);
      }
      return true;
    }

    // ============================================================
    // REGISTER NEW COMMANDS IN PALETTE
    // ============================================================
    commands.push(
      { label: "Secrets Vault", action: () => openSecretsPanel(), category: "Tools" },
      { label: "Startup Tasks", action: () => openStartupTasks(), category: "Tools" },
      { label: "Float Pane (Enhanced PiP)", action: () => toggleFloating(), category: "Tools" },
    );

    // ============================================================
    // INIT
    // ============================================================

    // Window controls for Windows/Linux (frameless window)
    if (window.shellfire.platform !== "darwin") {
      document.body.classList.add("show-win-controls");
      document.getElementById("win-minimize").addEventListener("click", () => window.shellfire.winMinimize());
      document.getElementById("win-maximize").addEventListener("click", () => window.shellfire.winMaximize());
      document.getElementById("win-close").addEventListener("click", () => window.shellfire.winClose());
    }

    (async () => {
      let _savedThemeName = null; // preserve across applyTheme overwrites
      try {
        const [config, savedSnippets, savedProfiles, savedSession, savedSettings] = await Promise.all([
          window.shellfire.loadConfig(),
          window.shellfire.loadSnippets(),
          window.shellfire.loadProfiles(),
          window.shellfire.loadSession(),
          window.shellfire.loadSettings(),
        ]);
        await Promise.all([loadRecentDirs(), loadSshBookmarks(), loadNotes(), loadBookmarks(), loadPipelinesData(), loadCmdBookmarksData(), loadSecretsVault(), loadStartupTasks()]);

        // Apply settings
        if (savedSettings) {
          settings = savedSettings;
          if (settings.copyOnSelect !== undefined) copyOnSelect = settings.copyOnSelect;
          if (settings.confirmClose !== undefined) confirmClose = settings.confirmClose;
          if (settings.aiSuggestions !== undefined) aiSuggestions = settings.aiSuggestions;
          if (settings.autoSaveInterval) autoSaveInterval = settings.autoSaveInterval;
          if (settings.bufferLimit) bufferLimit = settings.bufferLimit * 1024;
          if (settings.keybindings) customKeybindings = settings.keybindings;
          if (settings.ideMode) {
            ideMode = true;
            document.body.classList.add("ide-mode");
            ideModeBtn.classList.add("active-toggle");
          }
          setupAutoSave();
        }

        if (config) {
          if (config.theme >= 0 && config.theme < themes.length) currentThemeIdx = config.theme;
          if (config.fontSize) currentFontSize = config.fontSize;
          if (config.themeName) _savedThemeName = config.themeName;
          if (typeof config.zoom === "number" && config.zoom >= 0.5 && config.zoom <= 3) currentZoom = config.zoom;
        }
        // Settings override config
        if (settings.theme >= 0 && settings.theme < themes.length) currentThemeIdx = settings.theme;
        if (settings.themeName) _savedThemeName = settings.themeName;
        if (settings.fontSize) currentFontSize = settings.fontSize;
        if (typeof settings.zoom === "number" && settings.zoom >= 0.5 && settings.zoom <= 3) currentZoom = settings.zoom;
        // Session override (most recent state)
        if (savedSession && savedSession.themeName) _savedThemeName = savedSession.themeName;
        if (savedSession && savedSession.theme >= 0 && savedSession.theme < themes.length) currentThemeIdx = savedSession.theme;

        // Apply persisted zoom IMMEDIATELY before any rendering so the UI opens at the right size
        if (currentZoom !== 1.0) {
          try { await window.shellfire.setZoom(currentZoom); } catch {}
        }
        if (Array.isArray(savedSnippets)) snippets = savedSnippets;
        if (Array.isArray(savedProfiles)) profiles = savedProfiles;

        // Set CSS custom properties early (no toast, no config save) so terminals render correctly
        {
          const t = themes[currentThemeIdx] || themes[0];
          const root = document.documentElement;
          root.style.setProperty("--t-bg", t.body);
          root.style.setProperty("--t-fg", t.term.foreground || "#cccccc");
          root.style.setProperty("--t-ui", t.ui);
          root.style.setProperty("--t-border", t.border);
          root.style.setProperty("--t-accent", t.term.cursor || "#00f0ff");
        }

        // === TMUX-LIKE REATTACH ===
        // Check for live PTYs from a previous window session. If any exist,
        // reattach to them (they kept running while the window was closed).
        let reattached = false;
        try {
          const livePtys = await window.shellfire.listPtys();
          if (Array.isArray(livePtys) && livePtys.length > 0) {
            for (const ep of livePtys) {
              // Create pane hooked to the EXISTING PTY id — no new shell spawned
              const id = await createPaneObj(ep.cwd, null, true, ep.id);
              const pane = panes.get(id);
              if (pane && ep.buffer) {
                // Write the live PTY's accumulated output directly to xterm.
                // These are the exact bytes the PTY emitted, so xterm will
                // reproduce the same visual state (including alt-screen apps).
                pane.term.write(ep.buffer);
                pane.rawBuffer = ep.buffer;
                pane._rawChunks = [ep.buffer];
                pane._rawSize = ep.buffer.length;
                pane._replayPending = false;
                if (pane._replayQueue) {
                  for (const chunk of pane._replayQueue) pane.term.write(chunk);
                  pane._replayQueue = null;
                }
              }
              // Apply session metadata if we can match by cwd or just by order
              if (savedSession?.paneStates) {
                const match = savedSession.paneStates.find(ps => ps.cwd === ep.cwd);
                if (match && pane) {
                  if (match.customName) { pane.customName = match.customName; pane.titleEl.textContent = match.customName; }
                  if (match.userRenamed) pane._userRenamed = true;
                  if (match.color) applyPaneColor(id, match.color, match.termBg || null, match.termFg || null);
                  if (match.locked) { pane.locked = true; pane.el.classList.add("locked"); pane.el.querySelector(".lock-badge")?.classList.add("locked"); }
                }
              }
            }
            // Restore layout if it matches the reattached pane count
            if (savedSession?.layout?.length > 0) {
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
            const first = [...panes.keys()][0];
            if (first) setActive(first);
            showToast(`Reattached to ${livePtys.length} terminal${livePtys.length > 1 ? "s" : ""}`);
            reattached = true;
          }
        } catch (err) {
          console.error("Reattach error:", err);
        }

        // If no live PTYs (fresh launch or after reboot), try session restore from disk
        if (!reattached && savedSession && ((savedSession.version === 2 && savedSession.paneStates?.length > 0) || (savedSession.cwds?.length > 0))) {
          if (savedSession.version === 2 && savedSession.paneStates?.length > 0) {
            for (const ps of savedSession.paneStates) {
              const hasBuffer = !!ps.rawBuffer;
              const id = await createPaneObj(ps.cwd, ps.restoreCmd || null, hasBuffer);
              const pane = panes.get(id);
              if (pane) {
                if (hasBuffer) {
                  const sanitized = sanitizeReplayBuffer(ps.rawBuffer);
                  pane.term.write(sanitized);
                  pane.term.write(RESET_SEQ);
                  pane.rawBuffer = ps.rawBuffer;
                  pane._rawChunks = [ps.rawBuffer];
                  pane._rawSize = ps.rawBuffer.length;
                  pane._replayPending = false;
                  if (pane._replayQueue) {
                    for (const chunk of pane._replayQueue) pane.term.write(chunk);
                    pane._replayQueue = null;
                  }
                }
                if (ps.customName) { pane.customName = ps.customName; pane.titleEl.textContent = ps.customName; }
                if (ps.userRenamed) pane._userRenamed = true;
                if (ps.color) applyPaneColor(id, ps.color, ps.termBg || null, ps.termFg || null);
                if (ps.locked) { pane.locked = true; pane.el.classList.add("locked"); pane.el.querySelector(".lock-badge")?.classList.add("locked"); }
              }
            }
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
            showToast(`Restored ${count} terminal${count > 1 ? "s" : ""}`);
          } else {
            for (const cwd of savedSession.cwds) await createPaneObj(cwd);
            rebuildLayout();
            showToast(`Restored ${savedSession.cwds.length} terminal${savedSession.cwds.length > 1 ? "s" : ""}`);
          }
          const first = [...panes.keys()][0];
          if (first) setActive(first);
        } else if (!reattached) {
          // Fresh start — no live PTYs, no saved session
          const didAutoStart = await runAutoStartupTasks();
          if (!didAutoStart) {
            await addTerminal();
          }
        }
        updateWelcomeScreen();

        // Check for first-run onboarding
        if (await checkOnboarding()) {
          showOnboarding();
        }

        // Load plugins (may add new themes)
        await loadPlugins();
        _refreshThemeUIs();

        // Single, final theme application — resolves saved name including plugin themes
        if (_savedThemeName) {
          const savedIdx = themes.findIndex(t => t.name === _savedThemeName);
          if (savedIdx >= 0) currentThemeIdx = savedIdx;
        }
        applyTheme(currentThemeIdx, true);

        // Initialize IDE sidebar if enabled
        if (ideMode) setTimeout(() => updateIdeSidebar(), 200);
        setTimeout(() => updateBottomBar(), 500);
        setTimeout(() => { updateK8sWidget(); updateAwsWidget(); }, 1000);
      } catch (err) {
        console.error("Init error:", err);
        try { await addTerminal(); updateWelcomeScreen(); } catch {}
      }
    })();

    // ============================================================
    // CLEANUP ON UNLOAD (prevent interval leaks on renderer reload)
    // ============================================================
    window.addEventListener("beforeunload", () => {
      // Clear all watch timers
      for (const [, w] of watchTimers) clearInterval(w.timer);
      watchTimers.clear();
      // Clear auto-save timer
      if (autoSaveTimer) clearInterval(autoSaveTimer);
      // Clear all plugin intervals to prevent leaks on reload
      for (const [, reg] of _pluginRegistry) {
        for (const id of reg.intervals) clearInterval(id);
      }
      _pluginRegistry.clear();
      _loadedPlugins.clear();
    });

    // ============================================================
    // EXPOSE INTERNALS FOR CLI MULTIPLEXER SOCKET
    // ============================================================
    window.__panes = panes;
    Object.defineProperty(window, "__activeId", {
      get() { return activeId; },
      configurable: true,
    });
    window.__setActive = (id) => { setActive(id); };
    window.__createPane = async (cwd) => { return await addTerminal(cwd); };
    window.__removeTerminal = (id) => { removeTerminal(id); };

    // ============================================================
    // AUTO-UPDATE NOTIFICATION UI
    // ============================================================
    const updateIndicator = document.getElementById("update-indicator");
    const updateBanner = document.getElementById("update-banner");
    const updateBannerText = document.getElementById("update-banner-text");
    const updateBannerBtn = document.getElementById("update-banner-btn");
    const updateBannerDismiss = document.getElementById("update-banner-dismiss");
    let _updateVersion = null;
    let _updateState = null; // "available" | "downloading" | "downloaded"

    function showUpdateBanner(text, btnLabel, btnAction) {
      updateBannerText.textContent = text;
      updateBannerBtn.textContent = btnLabel;
      updateBannerBtn.onclick = btnAction;
      updateBanner.classList.add("visible");
    }

    function hideUpdateBanner() {
      updateBanner.classList.remove("visible");
    }

    function updateIndicatorState(state, label) {
      updateIndicator.className = "update-indicator visible " + state;
      updateIndicator.textContent = label;
    }

    updateBannerDismiss.addEventListener("click", hideUpdateBanner);

    updateIndicator.addEventListener("click", () => {
      if (_updateState === "available") {
        showUpdateBanner(
          `v${_updateVersion} available`,
          "Download",
          () => { window.shellfire.downloadUpdate(); }
        );
      } else if (_updateState === "downloaded") {
        showUpdateBanner(
          `v${_updateVersion} ready`,
          "Restart to Update",
          () => { window.shellfire.installUpdate(); }
        );
      } else if (_updateState === "downloading") {
        showToast("Downloading update...");
      }
    });

    window.shellfire.onUpdateStatus((data) => {
      switch (data.status) {
        case "available":
          _updateVersion = data.version;
          _updateState = "available";
          updateIndicatorState("available", "\u2B06 v" + data.version);
          showUpdateBanner(
            `Update v${data.version} is available`,
            "Download",
            () => { window.shellfire.downloadUpdate(); }
          );
          showToast(`Update available: v${data.version}`);
          break;
        case "downloading":
          _updateState = "downloading";
          updateIndicatorState("downloading", "\u2B07 " + (data.percent || 0) + "%");
          updateBannerText.textContent = "Downloading... " + (data.percent || 0) + "%";
          updateBannerBtn.textContent = "Downloading...";
          updateBannerBtn.disabled = true;
          break;
        case "downloaded":
          _updateVersion = data.version || _updateVersion;
          _updateState = "downloaded";
          updateIndicatorState("downloaded", "\u2714 v" + (_updateVersion || "new"));
          showUpdateBanner(
            `v${_updateVersion || "new"} downloaded`,
            "Restart to Update",
            () => { window.shellfire.installUpdate(); }
          );
          updateBannerBtn.disabled = false;
          showToast("Update downloaded — restart to apply");
          break;
        case "error":
          hideUpdateBanner();
          updateIndicator.className = "update-indicator";
          _updateState = null;
          break;
        case "up-to-date":
          // No UI needed — silently dismiss
          break;
      }
    });
