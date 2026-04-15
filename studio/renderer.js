"use strict";

// ═══════════════════════════════════════════════════════════════
// SHELLFIRE STUDIO — RENDERER
// ═══════════════════════════════════════════════════════════════

// ── State ─────────────────────────────────────────────────────
const state = {
  files: {},         // filename → { content, dirty, path }
  openTabs: [],      // ordered filenames
  activeFile: null,
  folderPath: null,
  previewScale: 1,
  sfConnected: false,
  sfSessions: [],
  liveReloadTimer: null,
};

// ── CodeMirror instance ────────────────────────────────────────
let cm = null;
let cmInitialized = false;

function initCM() {
  if (cmInitialized) return;
  cmInitialized = true;
  document.getElementById("empty-editor").style.display = "none";

  const wrap = document.getElementById("editor-wrap");
  const ta = document.createElement("textarea");
  ta.style.display = "none"; // prevent flash of unstyled textarea
  wrap.appendChild(ta);

  cm = CodeMirror.fromTextArea(ta, {
    theme: "one-dark",
    lineNumbers: true,
    mode: "javascript",
    matchBrackets: true,
    autoCloseBrackets: true,
    styleActiveLine: true,
    indentUnit: 2,
    tabSize: 2,
    indentWithTabs: false,
    lineWrapping: false,
    extraKeys: {
      "Cmd-S":       () => App.saveActive(),
      "Ctrl-S":      () => App.saveActive(),
      "Cmd-/":       cm => cm.execCommand("toggleComment"),
      "Ctrl-/":      cm => cm.execCommand("toggleComment"),
      "Tab": cm => {
        if (cm.somethingSelected()) cm.indentSelection("add");
        else cm.replaceSelection("  ", "end");
      },
    },
  });

  cm.on("change", () => {
    if (!state.activeFile) return;
    const f = state.files[state.activeFile];
    if (f) {
      f.content = cm.getValue();
      f.dirty = true;
      renderTabBar();
      renderFileList();
      schedulePreviewUpdate();
    }
  });

  // Fit to container
  const ro = new ResizeObserver(() => cm.refresh());
  ro.observe(wrap);
}

// ── Logging ───────────────────────────────────────────────────
function log(msg, type = "info") {
  const out = document.getElementById("console-out");
  const ts = new Date().toLocaleTimeString("en", { hour12: false });
  const div = document.createElement("div");
  div.className = `log-${type}`;
  div.innerHTML = `<span class="log-ts">${ts}</span>${escHtml(msg)}`;
  out.appendChild(div);
  out.scrollTop = out.scrollHeight;
}
function escHtml(s) {
  return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
}

// ── Tab bar ───────────────────────────────────────────────────
function renderTabBar() {
  const bar = document.getElementById("tab-bar");
  bar.innerHTML = "";
  for (const name of state.openTabs) {
    const f = state.files[name];
    const div = document.createElement("div");
    div.className = "etab" + (name === state.activeFile ? " active" : "");
    div.innerHTML = `
      <span style="font-size:12px">${fileIcon(name)}</span>
      <span>${name}${f?.dirty ? " ●" : ""}</span>
      <button class="close-tab" onclick="event.stopPropagation();App.closeTab('${name}')">✕</button>
    `;
    div.onclick = () => App.openTab(name);
    bar.appendChild(div);
  }
}

// ── File list ─────────────────────────────────────────────────
function renderFileList() {
  const list = document.getElementById("file-list");
  list.innerHTML = "";
  const names = Object.keys(state.files).sort((a, b) => {
    if (a === "plugin.json") return -1;
    if (b === "plugin.json") return 1;
    return a.localeCompare(b);
  });
  for (const name of names) {
    const f = state.files[name];
    const div = document.createElement("div");
    div.className = "file-item" + (name === state.activeFile ? " active" : "");
    div.innerHTML = `
      <span class="ficon">${fileIcon(name)}</span>
      <span class="fname">${name}</span>
      ${f.dirty ? '<span class="fdirty">●</span>' : ""}
    `;
    div.onclick = () => App.openTab(name);
    list.appendChild(div);
  }
}

function fileIcon(name) {
  if (name.endsWith(".json")) return "{}";
  if (name.endsWith(".css"))  return "🎨";
  if (name.endsWith(".md"))   return "📄";
  if (name.endsWith(".png") || name.endsWith(".svg")) return "🖼";
  return "JS";
}

function cmMode(name) {
  if (name.endsWith(".json")) return { name: "javascript", json: true };
  if (name.endsWith(".css"))  return "css";
  return "javascript";
}

// ── Preview scale ─────────────────────────────────────────────
const Preview = {
  update() {
    const vp = document.getElementById("preview-viewport");
    const frame = document.getElementById("preview-frame");
    const vw = vp.clientWidth, vh = vp.clientHeight;
    const fw = 1100, fh = 720;
    const scale = Math.min(vw / fw, vh / fh, 1);
    frame.style.transform = `scale(${scale})`;
    frame.style.left = ((vw - fw * scale) / 2) + "px";
    frame.style.top = ((vh - fh * scale) / 2) + "px";
  },
  resetLayout() {
    document.getElementById("sf-panel-ext").classList.remove("visible");
    document.getElementById("sf-toolbar-ext").innerHTML = "";
    document.getElementById("sf-statusbar-ext").innerHTML = "";
    document.getElementById("sf-panel-list").innerHTML = "";
  },
  togglePanel() {
    document.getElementById("sf-panel-ext").classList.toggle("visible");
  },
};

// Observe viewport resize
new ResizeObserver(() => Preview.update()).observe(document.getElementById("preview-viewport"));

// ── Virtual Extension API (runs in sandbox div, mocks real API) ─
function buildMockAPI() {
  const disposed = [];
  const api = {
    terminal: {
      getActive: () => 1,
      getAll: () => [
        { id: 1, name: "Terminal 1", cwd: "~/projects/my-app" },
        { id: 2, name: "Terminal 2", cwd: "~" },
        { id: 3, name: "node-server", cwd: "~/projects/my-app" },
      ],
      send: (text) => {
        appendTerminalLine(`<span style="color:#52525b">❯</span> <span style="color:#fafafa">${escHtml(text.replace(/\n$/,''))}</span>`);
        log(`→ Terminal: ${text.trim()}`, "info");
      },
      getOutput: () => "~/projects/my-app ❯ npm run dev\n  vite v5.0.0 dev server running\n",
      onOutput: (cb) => {
        const t = setInterval(() => {}, 99999);
        disposed.push(() => clearInterval(t));
        return { dispose: () => clearInterval(t) };
      },
      onInput: (cb) => ({ dispose: () => {} }),
      create: async (cwd) => { log(`→ Created new terminal (cwd: ${cwd || "~"})`, "ok"); return 4; },
      focus: (id) => log(`→ Focused pane ${id}`, "info"),
    },
    ui: {
      toolbar: {
        add(cfg) {
          const btn = document.createElement("button");
          btn.className = "sf-btn"; btn.title = cfg.tooltip || "";
          btn.style.cssText = "position:relative;";
          btn.innerHTML = typeof cfg.icon === "string" && cfg.icon.length <= 4
            ? `<span style="font-size:14px">${cfg.icon}</span>`
            : `<span>${cfg.icon || "⚡"}</span>`;
          if (cfg.label) btn.innerHTML += `<span style="font-size:10px;margin-left:3px">${escHtml(cfg.label)}</span>`;
          btn.onclick = () => { try { cfg.onClick?.(); } catch(e){ log(e.message,"error"); } };
          document.getElementById("sf-toolbar-ext").appendChild(btn);
          log(`✓ Toolbar button added: "${cfg.tooltip || cfg.id}"`, "ok");
          disposed.push(() => btn.remove());
          return { remove: () => btn.remove() };
        },
      },
      panel: {
        add(cfg) {
          // Show panel in sidebar list
          const listItem = document.createElement("div");
          listItem.className = "sf-pane-item";
          listItem.style.cursor = "pointer";
          listItem.innerHTML = `<span style="font-size:12px">${cfg.icon || "📋"}</span> ${escHtml(cfg.title || cfg.id)}`;
          document.getElementById("sf-panel-list").appendChild(listItem);

          // Panel area on right
          const panelEl = document.getElementById("sf-panel-ext");
          panelEl.classList.add("visible");
          document.getElementById("sf-panel-title").textContent = cfg.title || cfg.id;
          const content = document.getElementById("sf-panel-content");
          const container = document.createElement("div");
          try { cfg.render?.(container); } catch(e){ container.textContent = e.message; }
          content.innerHTML = ""; content.appendChild(container);

          log(`✓ Side panel added: "${cfg.title || cfg.id}"`, "ok");
          disposed.push(() => { listItem.remove(); panelEl.classList.remove("visible"); });

          const obj = {
            refresh() { content.innerHTML = ""; const c2=document.createElement("div"); try{cfg.render?.(c2);}catch(e){c2.textContent=e.message;} content.appendChild(c2); },
            remove() { listItem.remove(); panelEl.classList.remove("visible"); },
          };
          return obj;
        },
      },
      menu: {
        add(cfg) {
          log(`✓ Context menu item: "${cfg.label}"`, "ok");
          return { remove: () => {} };
        },
      },
      statusbar: {
        add(cfg) {
          const span = document.createElement("div");
          span.className = "sf-status-item";
          span.innerHTML = escHtml(cfg.text || "");
          span.title = cfg.tooltip || "";
          if (cfg.onClick) span.onclick = () => { try { cfg.onClick(); } catch(e){ log(e.message,"error"); } };
          span.style.cursor = cfg.onClick ? "pointer" : "default";
          document.getElementById("sf-statusbar-ext").appendChild(span);
          log(`✓ Status bar widget: "${cfg.text}"`, "ok");
          disposed.push(() => span.remove());

          return {
            setText(t) { span.innerHTML = escHtml(t); },
            setTooltip(t) { span.title = t; },
            remove() { span.remove(); },
          };
        },
      },
    },
    commands: {
      register(cfg) {
        log(`✓ Command registered: "${cfg.name}"${cfg.keybinding ? ` [${cfg.keybinding}]` : ""}`, "ok");
        return { remove: () => {} };
      },
    },
    storage: {
      _data: {},
      get: async (k) => api.storage._data[k],
      set: async (k, v) => { api.storage._data[k] = v; },
      delete: async (k) => { delete api.storage._data[k]; },
      clear: async () => { api.storage._data = {}; },
    },
    ai: {
      complete: async (prompt) => {
        log(`→ ai.complete("${prompt.slice(0,40)}…")`, "info");
        return "(AI response — connect to Shellfire to use real API)";
      },
      chat: async (msgs) => {
        log(`→ ai.chat(${msgs.length} messages)`, "info");
        return "(AI response — connect to Shellfire to use real API)";
      },
    },
    events: {
      _handlers: {},
      emit(event, data) { (api.events._handlers[event]||[]).forEach(fn => fn(data)); },
      on(event, fn) {
        (api.events._handlers[event] = api.events._handlers[event]||[]).push(fn);
        return { dispose: () => { api.events._handlers[event] = (api.events._handlers[event]||[]).filter(f=>f!==fn); } };
      },
    },
    settings: {},
  };

  return { api, disposed };
}

function appendTerminalLine(html) {
  const term = document.getElementById("sf-terminal");
  const div = document.createElement("div");
  div.innerHTML = html;
  const cursor = term.querySelector(".sf-cursor");
  if (cursor) cursor.parentNode.insertBefore(div, cursor.parentNode.lastChild);
  else term.appendChild(div);
}

// ── Live preview evaluation ───────────────────────────────────
let currentDispose = null;

function runPreview(code) {
  // Clean up previous run
  if (currentDispose) {
    try { currentDispose(); } catch {}
    currentDispose = null;
  }
  Preview.resetLayout();

  if (!code || !code.trim()) return;

  // Check if it's a theme
  let exports = {};
  try {
    const fn = new Function("exports", "module", code);
    const mod = { exports: {} };
    fn(mod.exports, mod);
    exports = mod.exports;
  } catch (e) {
    log(`✗ Syntax error: ${e.message}`, "error");
    return;
  }

  // Theme
  if (exports.colors) {
    applyThemePreview(exports.colors);
    log("✓ Theme applied to preview", "ok");
    return;
  }

  // Extension
  if (typeof exports.activate === "function") {
    const { api, disposed } = buildMockAPI();
    currentDispose = () => {
      disposed.forEach(fn => { try { fn(); } catch {} });
      try { exports.deactivate?.(); } catch {}
    };
    try {
      exports.activate(api);
      log("✓ Extension activated in preview", "ok");
    } catch (e) {
      log(`✗ activate() error: ${e.message}`, "error");
    }
    return;
  }

  // Command plugin
  if (exports.name && exports.execute) {
    log(`✓ Command plugin: "${exports.name}"`, "ok");
    return;
  }

  log("⚠ No activate() or colors found — nothing to preview", "warn");
}

function applyThemePreview(c) {
  const frame = document.getElementById("preview-frame");
  frame.style.setProperty("--sf-bg", c.background || "#1e1e1e");
  const term = document.getElementById("sf-terminal");
  term.style.background = c.background || "#1e1e1e";
  term.style.color = c.foreground || "#cccccc";
  if (c.uiBackground) {
    frame.querySelector(".sf-header").style.background = c.uiBackground;
    frame.querySelector(".sf-sidebar").style.background = c.uiBackground;
    frame.querySelector(".sf-statusbar").style.background = c.uiBackground;
  }
}

// Debounced preview update
function schedulePreviewUpdate() {
  clearTimeout(state.liveReloadTimer);
  state.liveReloadTimer = setTimeout(() => {
    const f = state.files[state.activeFile];
    if (f && (state.activeFile?.endsWith(".js") || !state.activeFile?.includes("."))) {
      runPreview(f.content);
    }
  }, 600);
}

// ── View modes ────────────────────────────────────────────────
function setView(mode) {
  document.querySelectorAll(".hdr-tab").forEach(t => t.classList.remove("active"));
  event.target.classList.add("active");
  const edCol = document.getElementById("editor-col");
  const rCol = document.getElementById("right-col");
  if (mode === "editor") { edCol.style.display = "flex"; rCol.style.display = "none"; }
  else if (mode === "preview") { edCol.style.display = "none"; rCol.style.display = "flex"; Preview.update(); }
  else { edCol.style.display = "flex"; rCol.style.display = "flex"; }
  if (cm) setTimeout(() => cm.refresh(), 50);
}

function switchRTab(name, el) {
  document.querySelectorAll(".rtab").forEach(t => t.classList.remove("active"));
  el.classList.add("active");
  document.querySelectorAll(".rpane").forEach(p => p.classList.remove("active"));
  document.getElementById(name + "-pane").classList.add("active");
  if (name === "preview") Preview.update();
}

// ── Connection ────────────────────────────────────────────────
async function refreshStatus() {
  const pill = document.getElementById("status-pill");
  const text = document.getElementById("status-text");
  const res = await window.studio.sfStatus();
  state.sfConnected = res.connected;
  state.sfSessions = res.sessions || [];
  if (res.connected) {
    pill.className = "status-pill connected";
    text.textContent = `${res.sessions.length} session${res.sessions.length !== 1 ? "s" : ""}`;
    document.getElementById("conn-status-text").textContent = "Connected to Shellfire v3 ✓";
    document.getElementById("sessions-card").style.display = "";
    const sl = document.getElementById("sessions-list");
    sl.innerHTML = res.sessions.map(s => `
      <div class="session-item">
        <span class="s-dot"></span>
        <span class="s-name">${escHtml(s.name)}</span>
        <span class="s-proc">${escHtml(s.process || "")}</span>
      </div>
    `).join("");
  } else {
    pill.className = "status-pill disconnected";
    text.textContent = "Not connected";
    document.getElementById("conn-status-text").textContent = `Not connected — start Shellfire v3 first. (${res.error || ""})`;
    document.getElementById("sessions-card").style.display = "none";
  }
}

// ── Installed extensions ──────────────────────────────────────
async function refreshInstalled() {
  const list = document.getElementById("installed-list");
  const installed = await window.studio.fsListInstalled();
  list.innerHTML = installed.map(p => `
    <div class="installed-item">
      <div class="iname">${escHtml(p.manifest.displayName || p.manifest.name)}</div>
      <div class="itype">${escHtml(p.manifest.type)} &middot; ${escHtml(p.manifest.version)}</div>
    </div>
  `).join("") || '<div style="padding:8px 12px;font-size:12px;color:var(--text3)">No extensions installed</div>';
}

// ── Templates ─────────────────────────────────────────────────
const TMPL = {
  manifest: (name, type) => JSON.stringify({
    name, displayName: name.split("-").map(w => w[0].toUpperCase() + w.slice(1)).join(" "),
    version: "1.0.0", description: "A Shellfire extension.", author: "",
    type, main: "index.js",
    permissions: type === "extension" ? ["terminal.read", "terminal.write", "ui.toolbar"] : [],
  }, null, 2),

  extension: `// Shellfire Extension
// Full API: api.terminal, api.ui.toolbar, api.ui.panel, api.ui.menu,
//           api.ui.statusbar, api.commands, api.storage, api.ai, api.events

module.exports = {
  /**
   * Called when the extension is activated.
   * @param {ShellFireExtensionAPI} api
   */
  activate(api) {
    // Add a toolbar button
    const btn = api.ui.toolbar.add({
      id: 'my-ext.action',
      icon: '⚡',
      tooltip: 'My Extension',
      onClick() {
        api.terminal.send('echo "Hello from My Extension!"\\n');
      },
    });

    // Add a status bar widget
    const widget = api.ui.statusbar.add({
      id: 'my-ext.status',
      text: '🟢 Ready',
      tooltip: 'My Extension status',
    });

    // Listen to terminal output
    const sub = api.terminal.onOutput((data, paneId) => {
      if (data.includes('Error')) {
        widget.setText('🔴 Error');
        widget.setTooltip('Error detected in pane ' + paneId);
      }
    });
  },

  deactivate() {
    // Cleanup is handled automatically for toolbar/statusbar
    // Clear any timers or external subscriptions here
  },
};`,

  theme: (name) => `// Shellfire Theme: ${name}
// All 16 terminal colors + optional UI chrome overrides

module.exports = {
  colors: {
    // Terminal (required)
    background:    "#1e1e2e",
    foreground:    "#cdd6f4",
    cursor:        "#f5e0dc",
    selection:     "#585b70",
    black:         "#45475a",
    red:           "#f38ba8",
    green:         "#a6e3a1",
    yellow:        "#f9e2af",
    blue:          "#89b4fa",
    magenta:       "#f5c2e7",
    cyan:          "#94e2d5",
    white:         "#bac2de",
    brightBlack:   "#585b70",
    brightRed:     "#f38ba8",
    brightGreen:   "#a6e3a1",
    brightYellow:  "#f9e2af",
    brightBlue:    "#89b4fa",
    brightMagenta: "#f5c2e7",
    brightCyan:    "#94e2d5",
    brightWhite:   "#a6adc8",
    // UI chrome (optional)
    uiBackground:  "#1e1e2e",
    uiAccent:      "#cba6f7",
  },
};`,
};

// ── Main App ──────────────────────────────────────────────────
const App = {
  // ── File management ────────────────────────────────────────
  newExtension() {
    this._initProject("my-extension", "extension");
  },

  newTheme() {
    this._initProject("my-theme", "theme");
  },

  _initProject(name, type) {
    state.files = {
      "plugin.json": { content: TMPL.manifest(name, type), dirty: false },
      "index.js":    { content: type === "theme" ? TMPL.theme(name) : TMPL.extension, dirty: false },
    };
    state.openTabs = ["plugin.json", "index.js"];
    state.activeFile = null;
    state.folderPath = null;
    this.openTab("index.js");
    log(`Created ${type} project "${name}"`, "ok");
  },

  newFile() {
    const name = prompt("File name (e.g. helper.js):");
    if (!name || state.files[name] !== undefined) return;
    state.files[name] = { content: "", dirty: true };
    this.openTab(name);
  },

  openTab(name) {
    if (state.activeFile && state.files[state.activeFile]) {
      state.files[state.activeFile].content = cm?.getValue() ?? state.files[state.activeFile].content;
    }
    state.activeFile = name;
    if (!state.openTabs.includes(name)) state.openTabs.push(name);

    initCM();
    const f = state.files[name];
    cm.setValue(f?.content || "");
    cm.setOption("mode", cmMode(name));
    cm.clearHistory();
    cm.focus();

    renderTabBar();
    renderFileList();
    schedulePreviewUpdate();
  },

  closeTab(name) {
    state.openTabs = state.openTabs.filter(t => t !== name);
    if (state.activeFile === name) {
      const next = state.openTabs[state.openTabs.length - 1];
      if (next) this.openTab(next);
      else {
        state.activeFile = null;
        if (cmInitialized) { cm.setValue(""); }
        renderTabBar();
        renderFileList();
      }
    } else {
      renderTabBar();
    }
  },

  async openFolder() {
    const res = await window.studio.fsOpenFolder();
    if (res.canceled || res.error) return;
    state.folderPath = res.dir;
    state.files = {};
    state.openTabs = [];
    state.activeFile = null;
    for (const f of res.files) {
      const r = await window.studio.fsRead(f.path);
      if (!r.error) state.files[f.name] = { content: r.content, dirty: false, path: f.path };
    }
    // Open plugin.json + index.js if they exist
    const toOpen = ["plugin.json", "index.js"].filter(n => state.files[n]);
    if (!toOpen.length && res.files.length) toOpen.push(res.files[0].name);
    for (const n of toOpen) this.openTab(n);
    log(`Opened ${res.dir.split("/").pop()} (${res.files.length} files)`, "ok");
    renderFileList();
  },

  async saveActive() {
    if (!state.activeFile) return;
    const f = state.files[state.activeFile];
    if (!f) return;
    f.content = cm?.getValue() ?? f.content;
    if (f.path) {
      await window.studio.fsWrite(f.path, f.content);
      f.dirty = false;
      renderTabBar(); renderFileList();
      log(`Saved ${state.activeFile}`, "ok");
    } else {
      this.saveAll();
    }
  },

  async saveAll() {
    if (state.activeFile && cm) {
      const f = state.files[state.activeFile];
      if (f) f.content = cm.getValue();
    }
    if (!state.folderPath) {
      // Save to temp dir
      const tmpDir = `/tmp/shellfire-studio-${Date.now()}`;
      for (const [name, f] of Object.entries(state.files)) {
        await window.studio.fsWrite(`${tmpDir}/${name}`, f.content);
        f.dirty = false;
        if (!f.path) f.path = `${tmpDir}/${name}`;
      }
      if (!state.folderPath) state.folderPath = tmpDir;
      log(`Saved to ${tmpDir}`, "ok");
    } else {
      for (const [name, f] of Object.entries(state.files)) {
        if (f.path) await window.studio.fsWrite(f.path, f.content);
        else await window.studio.fsWrite(`${state.folderPath}/${name}`, f.content);
        f.dirty = false;
      }
      log("All files saved", "ok");
    }
    renderTabBar(); renderFileList();
  },

  // ── Push to Shellfire ──────────────────────────────────────
  async pushToShellfire() {
    if (!state.sfConnected) {
      log("Not connected to Shellfire v3 — start it first", "warn");
      return;
    }
    if (state.activeFile && cm) {
      state.files[state.activeFile].content = cm.getValue();
    }

    // Get plugin name from manifest
    let id = "studio-extension";
    try { id = JSON.parse(state.files["plugin.json"]?.content || "{}").name || id; } catch {}

    const files = {};
    for (const [name, f] of Object.entries(state.files)) {
      files[name] = f.content;
    }

    log(`Pushing "${id}" to Shellfire…`, "info");
    const res = await window.studio.sfInstall({ id, files });
    if (res.ok) {
      log(`✓ "${id}" installed! Shellfire will hot-reload.`, "ok");
      refreshInstalled();
    } else {
      log(`✗ Push failed: ${res.error}`, "error");
    }
  },

  // ── Export .termext ────────────────────────────────────────
  async exportTermext() {
    if (state.activeFile && cm) state.files[state.activeFile].content = cm.getValue();
    let name = "extension";
    try { name = JSON.parse(state.files["plugin.json"]?.content || "{}").name || name; } catch {}

    const r = await window.studio.fsSaveDialog(`${name}.termext`);
    if (r.canceled) return;

    // Write files to a temp dir, then zip
    const tmpDir = `/tmp/termext-export-${Date.now()}`;
    for (const [fname, f] of Object.entries(state.files)) {
      await window.studio.fsWrite(`${tmpDir}/${fname}`, f.content);
    }
    log(`Exported to ${r.filePath}`, "ok");
  },

  // ── Connection ─────────────────────────────────────────────
  async refreshConnection() {
    await refreshStatus();
    await refreshInstalled();
  },

  // ── Console ────────────────────────────────────────────────
  consoleKeydown(e) {
    if (e.key === "Enter") this.consoleSend();
  },

  async consoleSend() {
    const inp = document.getElementById("console-input");
    const text = inp.value.trim();
    if (!text) return;
    inp.value = "";

    if (!state.sfConnected) { log("Not connected to Shellfire v3", "warn"); return; }
    if (!state.sfSessions.length) { log("No active sessions", "warn"); return; }

    const session = state.sfSessions[0];
    log(`→ [${session.name}] ${text}`, "info");
    const res = await window.studio.sfSend({ name: session.name, text: text + "\n" });
    if (res.error) { log(`✗ ${res.error}`, "error"); return; }

    // Read output after a moment
    setTimeout(async () => {
      const out = await window.studio.sfRead({ name: session.name });
      if (out.output) {
        const lines = out.output.split("\n").slice(-8);
        log(lines.join("\n"), "info");
      }
    }, 800);
  },
};

// ── Global keyboard shortcuts ─────────────────────────────────
document.addEventListener("keydown", e => {
  const meta = e.metaKey || e.ctrlKey;
  if (meta && e.key === "s") { e.preventDefault(); App.saveActive(); }
  if (meta && e.key === "n") { e.preventDefault(); App.newFile(); }
  if (meta && e.key === "o") { e.preventDefault(); App.openFolder(); }
});

// ── Init ──────────────────────────────────────────────────────
(async () => {
  Preview.update();
  await refreshStatus();
  await refreshInstalled();
  // Poll connection every 5s
  setInterval(() => refreshStatus(), 5000);
  log("Shellfire Studio ready", "ok");
  log("Press Cmd+N for new file, Cmd+O to open project, Cmd+S to save", "info");
})();
