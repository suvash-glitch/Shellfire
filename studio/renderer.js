"use strict";
// ═══════════════════════════════════════════════════════════════
// SHELLFIRE STUDIO — RENDERER v3
// ═══════════════════════════════════════════════════════════════

// ── State ─────────────────────────────────────────────────────
const S = {
  files: {},        // name → { content, dirty, path? }
  tabs: [],         // ordered open filenames
  active: null,     // current file name
  folder: null,
  connected: false,
  sessions: [],
  autoPush: false,
  popoutOpen: false,
  liveTimer: null,
  bpHeight: 200,
};

let editor = null; // Monaco editor instance

// ── UI helpers ────────────────────────────────────────────────
const $ = id => document.getElementById(id);
const E = s => String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

function log(msg, type = "info") {
  const out = $("console-out");
  if (!out) return;
  const ts = new Date().toLocaleTimeString("en", { hour12: false });
  const row = document.createElement("div");
  row.className = "log-row";
  row.innerHTML = `<span class="log-ts">${ts}</span><span class="log-msg log-${type}">${E(msg)}</span>`;
  out.appendChild(row);
  out.scrollTop = out.scrollHeight;
  // Also update status bar if not a disconnection message
  updateStatusBar();
}

function toast(msg, dur = 2000) {
  const t = $("pv-toast");
  if (!t) return;
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(t._t);
  t._t = setTimeout(() => t.classList.remove("show"), dur);
}

// ── Activity bar ──────────────────────────────────────────────
function switchActivity(btn) {
  document.querySelectorAll(".ab-btn[data-panel]").forEach(b => b.classList.remove("active"));
  btn.classList.add("active");
  document.querySelectorAll(".sb-panel").forEach(p => p.classList.remove("active"));
  $("panel-" + btn.dataset.panel)?.classList.add("active");
}

// ── Tab / bottom panel switching ──────────────────────────────
function switchBP(name, el) {
  document.querySelectorAll(".bp-tab").forEach(t => t.classList.remove("active"));
  el.classList.add("active");
  document.querySelectorAll(".bp-pane").forEach(p => p.classList.remove("active"));
  $("bp-" + name)?.classList.add("active");
}

function switchRP(name, el) {
  document.querySelectorAll(".rp-tab").forEach(t => t.classList.remove("active"));
  el.classList.add("active");
  document.querySelectorAll(".rp-pane").forEach(p => p.classList.remove("active"));
  $("rp-" + name)?.classList.add("active");
  if (name === "preview") scalePreview();
}

let bpVisible = true;
function toggleBottomPanel() {
  bpVisible = !bpVisible;
  const bp = $("bottom-panel");
  const vr = $("bp-resize");
  if (bp) bp.style.display = bpVisible ? "" : "none";
  if (vr) vr.style.display = bpVisible ? "" : "none";
  editor?.layout();
}

// ── Scale virtual Shellfire preview to fit viewport ───────────
function scalePreview() {
  const vp = $("preview-viewport");
  const fr = $("sf-preview");
  if (!vp || !fr) return;
  const vw = vp.clientWidth, vh = vp.clientHeight;
  const scale = Math.min(vw / 1200, vh / 780, 1);
  fr.style.transform = `scale(${scale})`;
  fr.style.left = ((vw - 1200 * scale) / 2) + "px";
  fr.style.top  = ((vh - 780  * scale) / 2) + "px";
}
new ResizeObserver(scalePreview).observe(document.getElementById("preview-viewport") || document.body);

// ── Monaco setup ──────────────────────────────────────────────
const SHELLFIRE_API_TYPES = `
declare const api: {
  terminal: {
    /** Returns the focused pane ID, or null */
    getActive(): number | null;
    /** All open pane descriptors */
    getAll(): Array<{ id: number; name: string; cwd: string | null }>;
    /** Write text/command to a terminal pane */
    send(text: string, paneId?: number): void;
    /** Read scrollback buffer */
    getOutput(paneId?: number, lines?: number): string;
    /** Called every time a pane emits output */
    onOutput(callback: (data: string, id: number) => void, paneId?: number): { dispose(): void };
    /** Intercept keyboard input — return false to suppress */
    onInput(callback: (text: string, id: number) => boolean | void, paneId?: number): { dispose(): void };
    /** Open a new terminal pane */
    create(cwd?: string): Promise<number>;
    /** Focus a pane */
    focus(paneId: number): void;
  };
  ui: {
    toolbar: {
      /** Add a button to the toolbar */
      add(config: {
        id: string;
        icon?: string;
        tooltip?: string;
        label?: string;
        onClick?(): void;
      }): { remove(): void };
    };
    panel: {
      /** Add a side panel */
      add(config: {
        id: string;
        title?: string;
        icon?: string;
        render?(container: HTMLElement): void;
        onShow?(): void;
        onHide?(): void;
      }): { refresh(): void; remove(): void };
    };
    menu: {
      /** Add a context menu item */
      add(config: {
        id: string;
        label: string;
        when?(ctx: { paneId: number; selection: string; x: number; y: number }): boolean;
        onClick?(ctx: { paneId: number; selection: string; x: number; y: number }): void;
      }): { remove(): void };
    };
    statusbar: {
      /** Add a status bar widget */
      add(config: {
        id: string;
        text?: string;
        tooltip?: string;
        onClick?(): void;
      }): { setText(t: string): void; setTooltip(t: string): void; remove(): void };
    };
  };
  commands: {
    /** Register a command palette entry */
    register(config: {
      id: string;
      name: string;
      keybinding?: string;
      category?: string;
      when?(): boolean;
      run(): void;
    }): { remove(): void };
  };
  storage: {
    get(key: string): Promise<any>;
    set(key: string, value: any): Promise<void>;
    delete(key: string): Promise<void>;
    clear(): Promise<void>;
  };
  ai: {
    /** Single-turn AI completion */
    complete(prompt: string): Promise<string>;
    /** Multi-turn AI chat */
    chat(messages: Array<{ role: 'user' | 'assistant'; content: string }>): Promise<string>;
  };
  events: {
    emit(event: string, data?: any): void;
    on(event: string, callback: (data: any) => void): { dispose(): void };
  };
  settings: Record<string, any>;
};

declare const exports: any;
declare const module: { exports: any };
`;

function initMonaco(cb) {
  require(["vs/editor/editor.main"], function () {
    // Custom Shellfire dark theme
    monaco.editor.defineTheme("shellfire-dark", {
      base: "vs-dark",
      inherit: true,
      rules: [
        { token: "", foreground: "a8a8b3", background: "0c0c0f" },
        { token: "comment", foreground: "4a4a58", fontStyle: "italic" },
        { token: "keyword", foreground: "c678dd" },
        { token: "string", foreground: "98c379" },
        { token: "number", foreground: "d19a66" },
        { token: "regexp", foreground: "56b6c2" },
        { token: "type", foreground: "e5c07b" },
        { token: "class", foreground: "e5c07b" },
        { token: "function", foreground: "61afef" },
        { token: "variable", foreground: "e06c75" },
        { token: "variable.predefined", foreground: "56b6c2" },
        { token: "constant", foreground: "d19a66" },
        { token: "tag", foreground: "e06c75" },
        { token: "attribute.name", foreground: "d19a66" },
        { token: "attribute.value", foreground: "98c379" },
        { token: "delimiter", foreground: "a8a8b3" },
        { token: "bracket", foreground: "ffd700" },
      ],
      colors: {
        "editor.background": "#0c0c0f",
        "editor.foreground": "#a8a8b3",
        "editor.lineHighlightBackground": "#14141a",
        "editor.selectionBackground": "#f9731630",
        "editor.inactiveSelectionBackground": "#f9731618",
        "editorCursor.foreground": "#f97316",
        "editorLineNumber.foreground": "#3a3a44",
        "editorLineNumber.activeForeground": "#6a6a75",
        "editorGutter.background": "#0c0c0f",
        "editorIndentGuide.background": "#1e1e26",
        "editorIndentGuide.activeBackground": "#2a2a34",
        "editorRuler.foreground": "#1e1e26",
        "editorBracketMatch.background": "#f9731625",
        "editorBracketMatch.border": "#f97316",
        "editor.findMatchBackground": "#f9731640",
        "editor.findMatchHighlightBackground": "#f9731620",
        "editorWidget.background": "#1a1a20",
        "editorWidget.border": "#28282e",
        "editorSuggestWidget.background": "#1a1a20",
        "editorSuggestWidget.border": "#28282e",
        "editorSuggestWidget.selectedBackground": "#28282e",
        "editorSuggestWidget.highlightForeground": "#f97316",
        "editorHoverWidget.background": "#1a1a20",
        "editorHoverWidget.border": "#28282e",
        "input.background": "#1c1c22",
        "input.border": "#28282e",
        "inputOption.activeBorder": "#f97316",
        "list.hoverBackground": "#1e1e26",
        "list.activeSelectionBackground": "#28282e",
        "list.focusBackground": "#28282e",
        "scrollbarSlider.background": "#28282e80",
        "scrollbarSlider.hoverBackground": "#3a3a4480",
        "minimap.background": "#0a0a0d",
        "minimapSlider.background": "#28282e50",
      },
    });

    // Register Shellfire API types for JS/TS autocomplete
    monaco.languages.typescript.javascriptDefaults.addExtraLib(
      SHELLFIRE_API_TYPES,
      "ts:shellfire-api.d.ts"
    );
    monaco.languages.typescript.javascriptDefaults.setDiagnosticsOptions({
      noSemanticValidation: false,
      noSyntaxValidation: false,
    });
    monaco.languages.typescript.javascriptDefaults.setCompilerOptions({
      allowJs: true,
      checkJs: false,
      target: monaco.languages.typescript.ScriptTarget.ES2020,
    });

    // Create editor
    editor = monaco.editor.create($("monaco-container"), {
      theme: "shellfire-dark",
      language: "javascript",
      fontSize: 14,
      fontFamily: '"SF Mono", ui-monospace, "Menlo", "Cascadia Code", monospace',
      fontLigatures: true,
      lineHeight: 22,
      letterSpacing: 0,
      minimap: { enabled: true, scale: 1, renderCharacters: false },
      scrollBeyondLastLine: true,
      wordWrap: "off",
      renderLineHighlight: "all",
      cursorBlinking: "smooth",
      cursorSmoothCaretAnimation: "on",
      smoothScrolling: true,
      formatOnPaste: true,
      tabSize: 2,
      insertSpaces: true,
      detectIndentation: false,
      bracketPairColorization: { enabled: true },
      padding: { top: 16, bottom: 120 },
      overviewRulerBorder: false,
      hideCursorInOverviewRuler: false,
      renderWhitespace: "selection",
      guides: { bracketPairs: "active", indentation: true },
      occurrencesHighlight: "singleFile",
      selectionHighlight: true,
      suggest: { preview: true, localityBonus: true, showKeywords: true, showSnippets: true },
      quickSuggestions: { strings: true, comments: false, other: true },
      parameterHints: { enabled: true },
      codeLens: false,
      folding: true,
      foldingHighlight: true,
      showFoldingControls: "mouseover",
      links: true,
      colorDecorators: true,
      scrollbar: { verticalScrollbarSize: 6, horizontalScrollbarSize: 6 },
      glyphMargin: false,
      fixedOverflowWidgets: true,
    });

    // Key bindings
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => App.save());
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyR, () => App.push());
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyP, () => App.popout());
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyF, () => {
      editor.getAction("editor.action.formatDocument")?.run();
    });

    // Cursor position → status bar
    editor.onDidChangeCursorPosition(e => {
      const p = e.position;
      const lb = $("sb-lc");
      if (lb) lb.textContent = `Ln ${p.lineNumber}, Col ${p.column}`;
    });

    // Content change → update state + live preview
    editor.onDidChangeModelContent(() => {
      if (!S.active) return;
      const f = S.files[S.active];
      if (!f) return;
      const val = editor.getValue();
      if (f.content === val) return;
      f.content = val;
      f.dirty = true;
      renderTabs();
      renderTree();
      scheduleLive();
    });

    if (cb) cb();
  });
}

// ── Render tabs ───────────────────────────────────────────────
function renderTabs() {
  const strip = $("tab-strip");
  if (!strip) return;
  strip.innerHTML = "";
  for (const name of S.tabs) {
    const f = S.files[name];
    const active = name === S.active;
    const div = document.createElement("div");
    div.className = "tab" + (active ? " active" : "");
    div.innerHTML = `
      <span class="tab-icon">${tabIcon(name)}</span>
      <span class="tab-name">${E(name)}${f?.dirty ? '<span class="tab-dirty">●</span>' : ""}</span>
      <span class="tab-close" onclick="event.stopPropagation();App.closeTab('${name}')">✕</span>
    `;
    div.onclick = () => App.openTab(name);
    strip.appendChild(div);
  }
}

function tabIcon(name) {
  if (name === "plugin.json" || name.endsWith(".json")) return "{}";
  if (name.endsWith(".css"))  return "css";
  if (name.endsWith(".md"))   return "md";
  return "js";
}
function langFor(name) {
  if (name.endsWith(".json")) return "json";
  if (name.endsWith(".css"))  return "css";
  if (name.endsWith(".md"))   return "markdown";
  return "javascript";
}

// ── Render file tree ──────────────────────────────────────────
function renderTree() {
  const tree = $("file-tree");
  if (!tree) return;
  const names = Object.keys(S.files).sort((a,b) => {
    if (a === "plugin.json") return -1;
    if (b === "plugin.json") return 1;
    return a.localeCompare(b);
  });
  if (!names.length) {
    tree.innerHTML = '<div class="empty-msg">Open a project or create a new extension.</div>';
    return;
  }
  tree.innerHTML = "";
  for (const name of names) {
    const f = S.files[name];
    const row = document.createElement("div");
    row.className = "file-row" + (name === S.active ? " active" : "");
    row.innerHTML = `
      <span class="fr-icon">${tabIcon(name)}</span>
      <span class="fr-name">${E(name)}</span>
      ${f?.dirty ? '<span class="fr-dirty">●</span>' : ""}
    `;
    row.onclick = () => App.openTab(name);
    tree.appendChild(row);
  }
}

// ── Open tab in Monaco ────────────────────────────────────────
function openInEditor(name) {
  const f = S.files[name];
  if (!f) return;

  S.active = name;
  if (!S.tabs.includes(name)) S.tabs.push(name);

  // Show Monaco, hide empty state
  $("empty-state").classList.add("hidden");
  $("monaco-container").classList.remove("hidden");

  if (!editor) {
    initMonaco(() => setEditorContent(name, f));
  } else {
    setEditorContent(name, f);
  }
  renderTabs();
  renderTree();
  updateStatusBar();
  scheduleLive();
}

function setEditorContent(name, f) {
  const lang = langFor(name);
  const uri = monaco.Uri.parse(`file:///${name}`);
  let model = monaco.editor.getModel(uri);
  if (!model) {
    model = monaco.editor.createModel(f.content, lang, uri);
  } else {
    if (model.getValue() !== f.content) model.setValue(f.content);
  }
  editor.setModel(model);
  editor.focus();
  $("bc-file").textContent = name;
  const lb = $("sb-lang");
  if (lb) lb.textContent = lang.charAt(0).toUpperCase() + lang.slice(1);
}

// ── Status bar ────────────────────────────────────────────────
function updateStatusBar() {
  const sb = $("status-bar");
  if (!sb) return;
  if (S.connected) {
    sb.className = "";
    $("sb-conn").textContent = `⬡ ${S.sessions.length} session${S.sessions.length !== 1 ? "s" : ""}`;
  } else {
    sb.className = "disconnected";
    $("sb-conn").textContent = "⬡ Disconnected";
  }
  $("sb-file").textContent = S.active || "No file";
}

function setPreviewStatus(state, msg) {
  const el = $("preview-status");
  if (!el) return;
  el.className = state === "error" ? "ps-error" : state === "idle" ? "ps-idle" : "";
  const dot = el.querySelector(".ps-dot");
  el.textContent = " " + msg;
  if (dot) el.prepend(dot);
}

// ── Refresh installed extensions ──────────────────────────────
async function refreshInstalled() {
  const list = $("inst-list");
  if (!list) return;
  const installed = await window.studio.fsListInstalled();
  list.innerHTML = installed.length
    ? installed.map(p => `
        <div class="inst-row">
          <div class="inst-info">
            <div class="inst-name">${E(p.manifest.displayName || p.manifest.name)}</div>
            <div class="inst-meta">${E(p.manifest.type)} · v${E(p.manifest.version)}</div>
          </div>
          <button class="inst-del" onclick="App.uninstall('${E(p.id)}')" title="Uninstall">✕</button>
        </div>
      `).join("")
    : '<div class="empty-msg">No extensions installed yet.</div>';
}

// ── Connection polling ────────────────────────────────────────
async function pollConn() {
  const res = await window.studio.sfStatus();
  S.connected = res.connected;
  S.sessions = res.sessions || [];

  const badge = $("conn-badge");
  const ct    = $("conn-text");
  const sbConn = $("sb-conn");

  if (res.connected) {
    badge?.classList.replace("off", "on");
    if (ct) ct.textContent = `${S.sessions.length} session${S.sessions.length !== 1 ? "s" : ""}`;
    if (sbConn) sbConn.textContent = `⬡ ${S.sessions.length} sessions`;
    $("status-bar")?.classList.remove("disconnected");
    $("conn-detail") && ($("conn-detail").textContent = "Connected to Shellfire v3 ✓");
    renderSessions(S.sessions);
  } else {
    badge?.classList.replace("on", "off");
    if (ct) ct.textContent = "Disconnected";
    $("status-bar")?.classList.add("disconnected");
    $("conn-detail") && ($("conn-detail").textContent = res.error || "Not connected — start Shellfire v3 first.");
    renderSessions([]);
  }
  updateAutoPushBtn();
}

function renderSessions(sessions) {
  const html = sessions.length
    ? sessions.map(s => `
        <div class="sess-row">
          <span class="sess-dot"></span>
          <span class="sess-name">${E(s.name)}</span>
          <span class="sess-proc">${E(s.process||"")}</span>
          <span class="sess-cwd">${E((s.cwd||"").replace(/^\/Users\/[^/]+/,"~"))}</span>
        </div>
      `).join("")
    : '<p style="color:var(--c-text3);font-size:12px;padding:4px 0">No active sessions</p>';
  // Update both sidebar and right panel session lists
  $("sess-list") && ($("sess-list").innerHTML = html);
  $("rp-sess-list") && ($("rp-sess-list").innerHTML = html);
}

function updateAutoPushBtn() {
  const btn = $("auto-btn");
  if (!btn) return;
  if (S.autoPush && S.connected) {
    btn.textContent = "⚡ Auto ON";
    btn.className = "h-auto active";
  } else {
    btn.textContent = "⚡ Auto";
    btn.className = S.connected ? "h-auto" : "h-auto";
    if (!S.connected) btn.style.opacity = ".45";
    else btn.style.opacity = "";
  }
}

// ── Manifest helpers ──────────────────────────────────────────
function getManifest() {
  try { return JSON.parse(S.files["plugin.json"]?.content || "{}"); }
  catch { return {}; }
}
function getPluginId() {
  return getManifest().name || "studio-extension";
}

// ── Live preview ──────────────────────────────────────────────
function scheduleLive() {
  clearTimeout(S.liveTimer);
  S.liveTimer = setTimeout(() => {
    if (!S.active) return;
    const f = S.files[S.active];
    if (!f || S.active.endsWith(".json") || S.active.endsWith(".md")) return;
    const code = f.content;
    const mf = getManifest();
    EmbPreview.run(code, mf);
    if (S.popoutOpen) window.studio.previewSendCode(code, mf);
    if (S.autoPush && S.connected) App.push(true);
  }, 500);
}

// ── Embedded virtual Shellfire preview ────────────────────────
const EmbPreview = (() => {
  let cleanup = null;

  function reset() {
    if (cleanup) { try { cleanup(); } catch {} cleanup = null; }
    $("sf-tb-inject").innerHTML = "";
    $("sf-status-inject").innerHTML = "";
    $("sf-sb-ext").innerHTML = "";
    $("sf-rp").classList.remove("vis");
    $("sf-rp-content").innerHTML = "";
    // Reset terminal styles
    const term = $("sf-terminal");
    if (term) { term.style.background = ""; term.style.color = ""; }
    // Reset header/sidebar/statusbar
    document.querySelector(".sf-hdr") && (document.querySelector(".sf-hdr").style.background = "");
    document.querySelector(".sf-sb") && (document.querySelector(".sf-sb").style.background = "");
    document.querySelector(".sf-statusbar") && (document.querySelector(".sf-statusbar").style.background = "");
  }

  function buildAPI() {
    const dis = [];
    const notify = (msg, dur) => toast(msg, dur);

    function addTermLine(html) {
      const term = $("sf-terminal");
      if (!term) return;
      const cursor = term.querySelector(".sf-cursor");
      const div = document.createElement("div");
      div.innerHTML = html;
      if (cursor) cursor.parentElement.insertBefore(div, cursor.parentElement.lastElementChild);
      else term.appendChild(div);
      term.scrollTop = term.scrollHeight;
    }

    const api = {
      terminal: {
        getActive: () => 1,
        getAll: () => [
          { id:1, name:"Terminal 1", cwd:"~/projects/my-app" },
          { id:2, name:"api-server", cwd:"~/projects/my-app" },
          { id:3, name:"git-watch", cwd:"~" },
        ],
        send(text) {
          addTermLine(`<span class="pt">❯</span> <span class="pc">${E(text.replace(/\n$/,""))}</span>`);
          notify(`→ ${text.trim().slice(0,50)}`);
        },
        getOutput: () => "❯ npm run dev\n  vite v5.4.0 running\n",
        onOutput: (cb) => {
          const t = setInterval(() => {}, 999999);
          dis.push(() => clearInterval(t));
          return { dispose: () => clearInterval(t) };
        },
        onInput: () => ({ dispose: () => {} }),
        create: async (cwd) => {
          addTermLine(`<span style="color:#22c55e">✓ New pane${cwd ? " in " + E(cwd) : ""}</span>`);
          return 4;
        },
        focus: (id) => notify(`Focused pane ${id}`),
      },
      ui: {
        toolbar: {
          add(cfg) {
            const btn = document.createElement("div");
            btn.className = "sf-hdr-btn";
            btn.style.cursor = "pointer";
            btn.title = cfg.tooltip || "";
            if (cfg.icon && cfg.icon.length <= 4) btn.innerHTML = cfg.icon;
            else if (cfg.label) btn.innerHTML = `<span style="font-size:11px;padding:0 2px">${E(cfg.label)}</span>`;
            else btn.innerHTML = "⚡";
            btn.onclick = () => { try { cfg.onClick?.(); } catch(e) { log(e.message,"error"); } };
            $("sf-tb-inject").appendChild(btn);
            dis.push(() => btn.remove());
            return { remove: () => btn.remove() };
          },
        },
        panel: {
          add(cfg) {
            const li = document.createElement("div");
            li.className = "sf-sb-item";
            li.style.cursor = "pointer";
            li.innerHTML = `<span style="font-size:12px">${cfg.icon||"📋"}</span> ${E(cfg.title||cfg.id)}`;
            li.onclick = () => showPanel(cfg);
            $("sf-sb-ext").appendChild(li);
            showPanel(cfg);
            dis.push(() => { li.remove(); $("sf-rp").classList.remove("vis"); });
            return {
              refresh() { showPanel(cfg); },
              remove() { li.remove(); $("sf-rp").classList.remove("vis"); }
            };
          },
        },
        menu: {
          add(cfg) { notify(`Context menu: "${cfg.label}"`); return { remove: () => {} }; },
        },
        statusbar: {
          add(cfg) {
            const seg = document.createElement("div");
            seg.className = "sf-sb-seg";
            seg.innerHTML = E(cfg.text || "");
            seg.title = cfg.tooltip || "";
            seg.style.cursor = cfg.onClick ? "pointer" : "default";
            if (cfg.onClick) seg.onclick = () => { try { cfg.onClick(); } catch(e){ log(e.message,"error"); } };
            $("sf-status-inject").appendChild(seg);
            dis.push(() => seg.remove());
            return {
              setText: (t) => { seg.innerHTML = E(t); },
              setTooltip: (t) => { seg.title = t; },
              remove: () => seg.remove(),
            };
          },
        },
      },
      commands: {
        register(cfg) {
          notify(`Command: "${cfg.name}"${cfg.keybinding ? " ["+cfg.keybinding+"]" : ""}`);
          return { remove: () => {} };
        },
      },
      storage: {
        _d: {}, get: async k => api.storage._d[k],
        set: async (k,v) => { api.storage._d[k] = v; },
        delete: async k => { delete api.storage._d[k]; },
        clear: async () => { api.storage._d = {}; },
      },
      ai: {
        complete: async (p) => { notify("ai.complete() — connect to Shellfire for live calls"); return "(AI preview)"; },
        chat: async (m) => { notify("ai.chat() — connect to Shellfire for live calls"); return "(AI preview)"; },
      },
      events: {
        _h: {},
        emit(e, d) { (api.events._h[e] || []).forEach(f => f(d)); },
        on(e, f) {
          (api.events._h[e] = api.events._h[e] || []).push(f);
          return { dispose: () => { api.events._h[e] = (api.events._h[e] || []).filter(g => g !== f); } };
        },
      },
      settings: {},
    };
    return { api, dis };
  }

  function showPanel(cfg) {
    $("sf-rp-title").textContent = cfg.title || cfg.id;
    const body = $("sf-rp-content");
    body.innerHTML = "";
    const c = document.createElement("div");
    try { cfg.render?.(c); } catch(e) { c.style.color="#ef4444"; c.textContent = e.message; }
    body.appendChild(c);
    $("sf-rp").classList.add("vis");
  }

  function run(code, manifest) {
    reset();
    if (!code?.trim()) { setPreviewStatus("idle", "Preview idle"); return; }

    let exports = {};
    try {
      const fn = new Function("exports", "module", code);
      const mod = { exports: {} };
      fn(mod.exports, mod);
      exports = mod.exports;
    } catch(e) {
      setPreviewStatus("error", "Syntax error");
      setProblem(e.message);
      log("Syntax error: " + e.message, "error");
      return;
    }

    clearProblems();

    // Theme
    if (exports.colors) {
      const c = exports.colors;
      const term = $("sf-terminal");
      if (term) { term.style.background = c.background || ""; term.style.color = c.foreground || ""; }
      if (c.uiBackground) {
        document.querySelector(".sf-hdr").style.background = c.uiBackground;
        document.querySelector(".sf-sb").style.background = c.uiBackground;
        document.querySelector(".sf-statusbar").style.background = c.uiBackground;
      }
      setPreviewStatus("live", "Theme applied");
      log("Theme applied to preview", "ok");
      return;
    }

    // Extension
    if (typeof exports.activate === "function") {
      const { api, dis } = buildAPI();
      cleanup = () => {
        dis.forEach(f => { try { f(); } catch {} });
        try { exports.deactivate?.(); } catch {}
      };
      try {
        exports.activate(api);
        setPreviewStatus("live", "Extension live");
        log("Extension activated in preview", "ok");
      } catch(e) {
        setPreviewStatus("error", "activate() error");
        setProblem(e.message);
        log("activate() error: " + e.message, "error");
      }
      return;
    }

    if (exports.name && exports.execute) {
      setPreviewStatus("live", `Command: "${exports.name}"`);
      log(`Command plugin: "${exports.name}"`, "ok");
      return;
    }

    setPreviewStatus("idle", "No activate() or colors");
    log("No activate() or colors — nothing to preview", "warn");
  }

  return { run, reset };
})();

// Problems panel
function setProblem(msg) {
  const po = $("problems-out");
  if (po) po.innerHTML = `<div style="color:var(--c-red);padding:2px 0">✕ ${E(msg)}</div>`;
}
function clearProblems() {
  const po = $("problems-out");
  if (po) po.innerHTML = '<div style="color:var(--c-text3)">No problems detected.</div>';
}

// ── Resize handles ────────────────────────────────────────────
function initResizers() {
  // Sidebar width
  setupHResize("sb-resize", "sidebar", 150, 400);
  // Right panel width (dragging moves right boundary)
  setupHResizeRight("rp-resize", "right-panel", 260, 700);
  // Bottom panel height
  setupVResize("bp-resize", "bottom-panel", 80, 500, true);
}

function setupHResize(handleId, targetId, min, max) {
  const handle = $(handleId);
  const target = $(targetId);
  if (!handle || !target) return;
  let dragging = false, startX = 0, startW = 0;
  handle.addEventListener("mousedown", e => {
    dragging = true; startX = e.clientX; startW = target.offsetWidth;
    handle.classList.add("dragging");
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  });
  document.addEventListener("mousemove", e => {
    if (!dragging) return;
    target.style.width = clamp(startW + (e.clientX - startX), min, max) + "px";
    editor?.layout();
  });
  document.addEventListener("mouseup", () => {
    if (!dragging) return;
    dragging = false;
    handle.classList.remove("dragging");
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
    editor?.layout();
  });
}

function setupHResizeRight(handleId, targetId, min, max) {
  const handle = $(handleId);
  const target = $(targetId);
  if (!handle || !target) return;
  let dragging = false, startX = 0, startW = 0;
  handle.addEventListener("mousedown", e => {
    dragging = true; startX = e.clientX; startW = target.offsetWidth;
    handle.classList.add("dragging");
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  });
  document.addEventListener("mousemove", e => {
    if (!dragging) return;
    // Dragging left increases panel, right decreases
    target.style.width = clamp(startW + (startX - e.clientX), min, max) + "px";
    editor?.layout();
  });
  document.addEventListener("mouseup", () => {
    if (!dragging) return;
    dragging = false;
    handle.classList.remove("dragging");
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
    editor?.layout();
  });
}

function setupVResize(handleId, targetId, min, max, fromBottom) {
  const handle = $(handleId);
  const target = $(targetId);
  if (!handle || !target) return;
  let dragging = false, startY = 0, startH = 0;
  handle.addEventListener("mousedown", e => {
    dragging = true; startY = e.clientY; startH = target.offsetHeight;
    handle.classList.add("dragging");
    document.body.style.cursor = "row-resize";
    document.body.style.userSelect = "none";
  });
  document.addEventListener("mousemove", e => {
    if (!dragging) return;
    const dy = fromBottom ? (startY - e.clientY) : (e.clientY - startY);
    target.style.height = clamp(startH + dy, min, max) + "px";
    editor?.layout();
  });
  document.addEventListener("mouseup", () => {
    if (!dragging) return;
    dragging = false;
    handle.classList.remove("dragging");
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
    editor?.layout();
  });
}

// ── Console ───────────────────────────────────────────────────
function handleConsoleKey(e) {
  if (e.key === "Enter") App.consoleSend();
}
window.handleConsoleKey = handleConsoleKey;

// ── Templates ─────────────────────────────────────────────────
const TMPL = {
  manifest: (name, type) => JSON.stringify({
    name, version: "1.0.0", type, main: "index.js",
    displayName: name.split("-").map(w => w[0].toUpperCase() + w.slice(1)).join(" "),
    description: "A Shellfire " + type + ".",
    author: "", keywords: [],
    permissions: type === "extension"
      ? ["terminal.read", "terminal.write", "ui.toolbar", "ui.statusbar"]
      : [],
  }, null, 2),

  extension: `// Shellfire Extension
// Full API docs: https://shellfire.dev/docs#api-terminal
//
// Type "api." to see full autocomplete — all methods are typed.

module.exports = {
  /**
   * Called when the extension is activated.
   * @param {typeof api} api
   */
  activate(api) {
    // ── Add a toolbar button ─────────────────────────────────────
    const btn = api.ui.toolbar.add({
      id: 'my-ext.action',
      icon: '⚡',
      tooltip: 'Run My Action',
      onClick() {
        api.terminal.send('echo "Hello from My Extension!"\\n');
      },
    });

    // ── Add a status bar widget ──────────────────────────────────
    const widget = api.ui.statusbar.add({
      id: 'my-ext.status',
      text: '🟢 Ready',
      tooltip: 'Extension status',
      onClick() { api.terminal.send('git status\\n'); },
    });

    // ── Watch terminal output ────────────────────────────────────
    const sub = api.terminal.onOutput((data) => {
      if (data.includes('error') || data.includes('Error')) {
        widget.setText('🔴 Error detected');
      }
    });

    // ── Register a command palette entry ─────────────────────────
    api.commands.register({
      id: 'my-ext.run',
      name: 'My Extension: Run Action',
      keybinding: 'Cmd+Shift+Y',
      run() { api.terminal.send('echo "Run from palette"\\n'); },
    });
  },

  deactivate() {
    // Toolbar buttons and status widgets clean up automatically.
    // Clear any manual timers or subscriptions here.
  },
};`,

  theme: `// Shellfire Theme Extension
// Provide all 16 terminal colors + optional UI chrome overrides.
// The preview updates live as you edit the colors.

module.exports = {
  colors: {
    // ── Required: 16 terminal colors ────────────────────────────
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

    // ── Optional: UI chrome ──────────────────────────────────────
    uiBackground:  "#1e1e2e",
    uiAccent:      "#cba6f7",
  },
};`,
};

// ── App ───────────────────────────────────────────────────────
const App = {
  // ── New projects ──────────────────────────────────────────
  newExt() {
    this._initProject("my-extension", "extension");
  },
  newTheme() {
    this._initProject("my-theme", "theme");
  },
  _initProject(name, type) {
    S.files = {
      "plugin.json": { content: TMPL.manifest(name, type), dirty: false },
      "index.js":    { content: TMPL[type] || TMPL.extension, dirty: false },
    };
    S.tabs = []; S.active = null; S.folder = null;
    setCrumb(`New ${type}`);
    this.openTab("index.js");
    log(`New ${type} project — start coding!`, "ok");
  },

  newFile() {
    const name = prompt("Filename (e.g. utils.js):");
    if (!name || S.files[name] !== undefined) return;
    S.files[name] = { content: "// " + name + "\n", dirty: true };
    this.openTab(name);
  },

  async openFolder() {
    const res = await window.studio.fsOpenFolder();
    if (res.canceled || res.error) { if (res.error) log(res.error, "error"); return; }
    S.folder = res.dir;
    S.files = {};
    for (const [name, f] of Object.entries(res.files || {})) {
      S.files[name] = { content: f.content, dirty: false, path: f.path };
    }
    S.tabs = []; S.active = null;
    const toOpen = ["plugin.json", "index.js"].filter(n => S.files[n]);
    for (const n of (toOpen.length ? toOpen : Object.keys(S.files).slice(0,2))) this.openTab(n);
    setCrumb(res.dir);
    log(`Opened ${res.dir.split("/").pop()} (${Object.keys(S.files).length} files)`, "ok");
  },

  openTab(name) {
    // Sync editor content back to state before switching
    if (S.active && editor && S.files[S.active]) {
      S.files[S.active].content = editor.getValue();
    }
    openInEditor(name);
  },

  closeTab(name) {
    if (S.active && editor && S.files[S.active]) {
      S.files[S.active].content = editor.getValue();
    }
    // Dispose Monaco model
    const uri = monaco?.Uri?.parse?.(`file:///${name}`);
    if (uri) {
      const m = monaco?.editor?.getModel?.(uri);
      m?.dispose();
    }
    S.tabs = S.tabs.filter(t => t !== name);
    if (S.active === name) {
      const next = S.tabs.at(-1);
      if (next) openInEditor(next);
      else {
        S.active = null;
        editor?.setModel(null);
        $("empty-state")?.classList.remove("hidden");
        $("monaco-container")?.classList.add("hidden");
        renderTabs(); renderTree();
        $("bc-file").textContent = "—";
        setPreviewStatus("idle", "Preview idle");
      }
    } else {
      renderTabs();
    }
  },

  async save() {
    if (!S.active || !editor) return;
    const f = S.files[S.active];
    if (!f) return;
    f.content = editor.getValue();
    const savePath = f.path || (S.folder ? `${S.folder}/${S.active}` : null);
    if (savePath) {
      const r = await window.studio.fsWrite(savePath, f.content);
      if (r.ok) { f.path = savePath; f.dirty = false; renderTabs(); renderTree(); log(`Saved ${S.active}`, "ok"); }
      else log(`Save failed: ${r.error}`, "error");
    } else {
      // Save all to temp dir
      await this.saveAll();
    }
    if (S.autoPush && S.connected) this.push(true);
  },

  async saveAll() {
    if (S.active && editor && S.files[S.active]) {
      S.files[S.active].content = editor.getValue();
    }
    const base = S.folder || `/tmp/sf-studio-${Date.now()}`;
    let n = 0;
    for (const [name, f] of Object.entries(S.files)) {
      const p = f.path || `${base}/${name}`;
      const r = await window.studio.fsWrite(p, f.content);
      if (r.ok) { f.path = p; f.dirty = false; n++; }
    }
    S.folder = S.folder || base;
    renderTabs(); renderTree();
    log(`Saved ${n} files`, "ok");
  },

  async push(silent = false) {
    if (S.active && editor && S.files[S.active]) {
      S.files[S.active].content = editor.getValue();
    }
    const id = getPluginId();
    const mf = getManifest();
    const files = {};
    for (const [n, f] of Object.entries(S.files)) files[n] = f.content;

    if (!silent) log(`Pushing "${id}" to Shellfire…`, "info");
    const res = await window.studio.sfInstall({ id, files, type: mf.type || "extension" });
    if (res.error) { log(`✗ Push failed: ${res.error}`, "error"); return; }
    if (res.reloaded) {
      if (!silent) log(`✓ "${id}" hot-reloaded in Shellfire`, "ok");
    } else {
      log(`✓ "${id}" files written (${res.msg})`, "ok");
    }
    refreshInstalled();
  },

  toggleAuto() {
    if (!S.connected) { log("Not connected to Shellfire v3", "warn"); return; }
    S.autoPush = !S.autoPush;
    updateAutoPushBtn();
    log(`Auto-push ${S.autoPush ? "ON — changes deploy on save" : "OFF"}`, S.autoPush ? "ok" : "info");
  },

  async popout() {
    const res = await window.studio.previewOpen();
    if (res.ok) {
      S.popoutOpen = true;
      $("popout-btn").textContent = "⤢ Preview ✓";
      $("popout-btn").classList.add("open");
      const f = S.files[S.active];
      if (f) window.studio.previewSendCode(f.content, getManifest());
      log("Preview opened in separate window", "ok");
    }
  },

  async export() {
    if (S.active && editor) S.files[S.active].content = editor.getValue();
    const name = getPluginId();
    const r = await window.studio.fsSaveDialog(`${name}.termext`);
    if (r.canceled) return;
    const files = {};
    for (const [n, f] of Object.entries(S.files)) files[n] = f.content;
    const res = await window.studio.fsExportTermext({ files, name, outPath: r.filePath });
    if (res.ok) log(`Exported ${name}.termext`, "ok");
    else log(`Export failed: ${res.error || "unknown error"}`, "error");
  },

  async uninstall(id) {
    if (!confirm(`Uninstall "${id}"?`)) return;
    const res = await window.studio.sfUninstall(id);
    if (res.ok) { log(`Uninstalled "${id}"`, "ok"); refreshInstalled(); }
    else log(`Failed: ${res.error}`, "error");
  },

  async consoleSend() {
    const inp = $("console-input");
    const text = inp?.value?.trim();
    if (!text) return;
    inp.value = "";
    if (!S.connected) { log("Not connected to Shellfire v3", "warn"); return; }
    if (!S.sessions.length) { log("No active sessions", "warn"); return; }
    const session = S.sessions[0];
    log(`[${session.name}] → ${text}`, "info");
    const r = await window.studio.sfSend({ name: session.name, text: text + "\n" });
    if (r.error) { log(r.error, "error"); return; }
    setTimeout(async () => {
      const out = await window.studio.sfRead({ name: session.name, lines: 10 });
      if (out.output?.trim()) log(out.output.trim().split("\n").slice(-5).join("\n"), "info");
    }, 900);
  },
};

// ── Helpers ───────────────────────────────────────────────────
function setCrumb(path) {
  const el = $("crumb-text");
  if (el) el.textContent = path ? path.replace(/^\/Users\/[^/]+/, "~") : "No project open";
}

// ── Global keyboard ───────────────────────────────────────────
document.addEventListener("keydown", e => {
  const m = e.metaKey || e.ctrlKey;
  if (m && !e.shiftKey && e.key === "s") { e.preventDefault(); App.save(); }
  if (m && !e.shiftKey && e.key === "o") { e.preventDefault(); App.openFolder(); }
  if (m && e.shiftKey && e.key === "R")  { e.preventDefault(); App.push(); }
  if (m && e.shiftKey && e.key === "P")  { e.preventDefault(); App.popout(); }
  if (e.key === "Escape") $("console-input")?.blur();
});

// Expose for HTML onclick
window.App = App;
window.EmbPreview = EmbPreview;
window.refreshInstalled = refreshInstalled;
window.switchActivity = switchActivity;
window.switchBP = switchBP;
window.switchRP = switchRP;
window.toggleBottomPanel = toggleBottomPanel;

// ── Init ──────────────────────────────────────────────────────
(async () => {
  initResizers();
  scalePreview();
  new ResizeObserver(() => { editor?.layout(); scalePreview(); }).observe(document.body);

  await pollConn();
  await refreshInstalled();
  setInterval(pollConn, 5000);

  log("Shellfire Studio ready", "ok");
  log("New Extension / Theme → type 'api.' for full autocomplete", "info");
  log("⌘S Save  ·  ⌘⇧R Push Live  ·  ⌘⇧P Pop Preview", "info");

  const isOpen = await window.studio.previewIsOpen();
  S.popoutOpen = !!isOpen;
  if (isOpen) {
    $("popout-btn").textContent = "⤢ Preview ✓";
    $("popout-btn").classList.add("open");
  }
})();
