"use strict";
// ════════════════════════════════════════════════════════════════
// SHELLFIRE STUDIO — RENDERER
// ════════════════════════════════════════════════════════════════

// ── State ──────────────────────────────────────────────────────
const S = {
  files: {},      // name → { content, dirty, path? }
  tabs: [],       // open filenames in order
  active: null,   // active filename
  folder: null,   // open folder path
  connected: false,
  sessions: [],
  autoPush: false,
  popoutOpen: false,
  liveTimer: null,
  editorReady: false,
};

let editor = null;   // Monaco instance
let editorModel = {}; // name → monaco.editor.ITextModel

// ── Helpers ────────────────────────────────────────────────────
const $ = id => document.getElementById(id);
const E = s => String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
const clamp = (v,lo,hi) => Math.max(lo,Math.min(hi,v));

// ── Toast system ───────────────────────────────────────────────
function toast(title, msg = "", type = "info", dur = 3500) {
  const icons = { ok:"✓", err:"✕", warn:"⚠", info:"ℹ" };
  const container = $("toast-container");

  const el = document.createElement("div");
  el.className = `toast ${type}`;
  el.innerHTML = `
    <span class="toast-icon">${icons[type]||"ℹ"}</span>
    <div class="toast-body">
      <div class="toast-title">${E(title)}</div>
      ${msg ? `<div class="toast-msg">${E(msg)}</div>` : ""}
    </div>
    <span class="toast-close" onclick="dismissToast(this.parentElement)">×</span>
  `;
  container.appendChild(el);

  const tid = setTimeout(() => dismissToast(el), dur);
  el._tid = tid;
  return el;
}
function dismissToast(el) {
  if (!el || el.classList.contains("closing")) return;
  clearTimeout(el._tid);
  el.classList.add("closing");
  setTimeout(() => el.remove(), 200);
}

// ── Log (console pane) ─────────────────────────────────────────
function log(msg, type = "info") {
  const out = $("console-out");
  if (!out) return;
  const ts = new Date().toLocaleTimeString("en",{hour12:false});
  const row = document.createElement("div");
  row.className = "log-r";
  row.innerHTML = `<span class="log-ts">${ts}</span><span class="log-m log-${type}">${E(msg)}</span>`;
  out.appendChild(row);
  out.scrollTop = out.scrollHeight;
}
function clearConsole() { const o=$("console-out"); if(o) o.innerHTML=""; }

// ── Preview toast ──────────────────────────────────────────────
let pvToastT;
function pvToast(msg, dur=2000) {
  const t = $("pv-toast"); if(!t) return;
  t.textContent = msg; t.classList.add("on");
  clearTimeout(pvToastT);
  pvToastT = setTimeout(() => t.classList.remove("on"), dur);
}

// ── Preview status (info bar + status bar) ─────────────────────
function setPVStatus(state, msg) {
  // Info bar
  const pv = $("pv-status");
  if (pv) {
    pv.className = `pv-status ${state}`;
    pv.innerHTML = `<span class="ps-dot"></span> ${E(msg)}`;
  }
  // Status bar segment
  const sb = $("sb-preview");
  if (sb) {
    sb.className = `sb-seg`;
    sb.innerHTML = `<span class="spd"></span> ${E(msg)}`;
  }
  // Status bar classes for color
  const sbar = $("statusbar");
  if (state === "err" && sbar) sbar.className = "err";
  else if (sbar && !S.connected) sbar.className = "off";
  else if (sbar) sbar.className = "";
}

// Preview info bar — extension name and type
function setPVInfo(name, type) {
  const n = $("pv-name"); const t = $("pv-type");
  if (n) n.textContent = name || "No extension";
  if (t) { t.textContent = type || ""; t.style.display = type ? "" : "none"; }
}

// ── Status bar ─────────────────────────────────────────────────
function updateStatus() {
  const sbar = $("statusbar");
  const connSeg = $("sb-conn");
  if (!sbar) return;
  if (S.connected) {
    sbar.className = "";
    if(connSeg) connSeg.textContent = `⬡ ${S.sessions.length} session${S.sessions.length!==1?"s":""}`;
  } else {
    sbar.className = "off";
    if(connSeg) connSeg.textContent = "⬡ Not connected";
  }
  const fileSeg = $("sb-file");
  if (fileSeg) fileSeg.textContent = S.active || "No file open";
}

// ── Activity bar / sidebar panel switching ─────────────────────
function switchAB(btn) {
  document.querySelectorAll(".ab[data-p]").forEach(b => b.classList.remove("on"));
  btn.classList.add("on");
  document.querySelectorAll(".sb-pane").forEach(p => p.classList.remove("on"));
  $("pane-" + btn.dataset.p)?.classList.add("on");
}
window.switchAB = switchAB;

function switchBP(name, el) {
  document.querySelectorAll(".bp-tab").forEach(t=>t.classList.remove("on"));
  el.classList.add("on");
  document.querySelectorAll(".bp-pane").forEach(p=>p.classList.remove("on"));
  $("bp-"+name)?.classList.add("on");
}
window.switchBP = switchBP;

function switchRP(name, el) {
  document.querySelectorAll(".rp-tab").forEach(t=>t.classList.remove("on"));
  el?.classList.add("on");
  document.querySelectorAll(".rp-pane").forEach(p=>p.classList.remove("on"));
  $("rp-"+name)?.classList.add("on");
  if(name==="preview") scalePreview();
}
window.switchRP = switchRP;

let bpOpen = true;
function toggleBP() {
  bpOpen = !bpOpen;
  const bp = $("bottom-panel"), rh = $("bp-rh");
  if(bp) bp.style.display = bpOpen?"":"none";
  if(rh) rh.style.display = bpOpen?"":"none";
  editor?.layout();
}
window.toggleBP = toggleBP;

// ── Scale virtual Shellfire preview ───────────────────────────
function scalePreview() {
  const vp = $("pv-vp"), fr = $("sf");
  if (!vp||!fr) return;
  const vw=vp.clientWidth, vh=vp.clientHeight;
  const scale = Math.min(vw/1200, vh/780, 1);
  fr.style.transform = `scale(${scale})`;
  fr.style.left = ((vw-1200*scale)/2)+"px";
  fr.style.top  = ((vh-780*scale)/2)+"px";
}
new ResizeObserver(scalePreview).observe(document.getElementById("pv-vp")||document.body);

// ── Connection ─────────────────────────────────────────────────
async function pollConn() {
  const chip = $("conn-chip"), txt = $("conn-txt"), det = $("conn-detail");
  if(txt) txt.textContent = "Checking…";
  const res = await window.studio.sfStatus();
  S.connected = res.connected;
  S.sessions = res.sessions||[];
  if(chip) chip.className = `h-chip ${S.connected?"connected":"disconnected"}`;
  if(txt) txt.textContent = S.connected ? `${S.sessions.length} session${S.sessions.length!==1?"s":""}` : "Not connected";
  if(det) det.textContent = S.connected ? `Connected to Shellfire v3 — ${S.sessions.length} active session${S.sessions.length!==1?"s":""}` : (res.error||"Start Shellfire v3 to connect.");
  const autoBtn = $("auto-btn");
  if(autoBtn) autoBtn.className = `h-auto${S.autoPush&&S.connected?" on":""}${S.connected?"":" disabled"}`;
  renderSessions();
  updateStatus();
}
window.pollConn = pollConn;

function onConnClick() { pollConn(); }
window.onConnClick = onConnClick;

function renderSessions() {
  const html = S.sessions.length
    ? S.sessions.map(s=>`<div class="sess-item"><span class="sess-dot"></span><span class="sess-name">${E(s.name)}</span><span class="sess-proc">${E(s.process||"")}</span></div>`).join("")
    : '<div class="empty-hint" style="padding:4px 0">No sessions</div>';
  $("sess-list") && ($("sess-list").innerHTML = html);
  $("rp-sess-list") && ($("rp-sess-list").innerHTML = html);
}

// ── Installed extensions ───────────────────────────────────────
async function loadInstalled() {
  const list = $("inst-list"); if(!list) return;
  const items = await window.studio.fsListInstalled();
  list.innerHTML = items.length
    ? items.map(p=>`<div class="i-row"><div class="i-info"><div class="i-name">${E(p.manifest.displayName||p.manifest.name)}</div><div class="i-meta">${E(p.manifest.type)} · v${E(p.manifest.version)}</div></div><button class="i-del" onclick="App.uninstall('${E(p.id)}')" title="Uninstall">✕</button></div>`).join("")
    : '<div class="empty-hint">No extensions installed.</div>';
}
window.loadInstalled = loadInstalled;

// ── Problems panel (wired to Monaco markers) ───────────────────
let problemCount = 0;
function updateProblems(markers) {
  const out = $("problems-out"), tab = $("prob-tab");
  problemCount = markers.length;
  if(tab) {
    tab.innerHTML = "Problems" + (problemCount ? `<span class="bp-badge">${problemCount}</span>` : "");
  }
  if (!out) return;
  if (!markers.length) {
    out.innerHTML = '<div class="empty-hint">No problems detected.</div>';
    return;
  }
  out.innerHTML = markers.map(m => {
    const sev = m.severity >= 8 ? ["✕","log-err"] : m.severity >= 4 ? ["⚠","log-warn"] : ["ℹ","log-info"];
    return `<div class="problem-row"><span class="p-sev ${sev[1]}">${sev[0]}</span><div><div class="p-msg">${E(m.message)}</div><div class="p-loc">Ln ${m.startLineNumber}, Col ${m.startColumn}</div></div></div>`;
  }).join("");
}

// ── Command palette ────────────────────────────────────────────
const COMMANDS = [
  { icon:"⚡", label:"New Extension",      cat:"Create", kb:"",         run:()=>App.newExt() },
  { icon:"🎨", label:"New Theme",           cat:"Create", kb:"",         run:()=>App.newTheme() },
  { icon:"📂", label:"Open Folder",         cat:"File",   kb:"⌘O",       run:()=>App.openFolder() },
  { icon:"💾", label:"Save",                cat:"File",   kb:"⌘S",       run:()=>App.save() },
  { icon:"▶",  label:"Push Live",           cat:"Deploy", kb:"⌘⇧R",      run:()=>App.push() },
  { icon:"⚡", label:"Toggle Auto-push",    cat:"Deploy", kb:"",         run:()=>App.toggleAuto() },
  { icon:"⤢",  label:"Pop out Preview",     cat:"View",   kb:"⌘⇧P",      run:()=>App.popout() },
  { icon:"📦", label:"Export .termext",     cat:"File",   kb:"",         run:()=>App.export() },
  { icon:"🔌", label:"Refresh Connection",  cat:"Shellfire", kb:"",      run:()=>pollConn() },
  { icon:"⌫",  label:"Clear Console",       cat:"View",   kb:"",         run:()=>clearConsole() },
  { icon:"↻",  label:"Reset Preview",       cat:"View",   kb:"",         run:()=>{ EmbedPreview.reset(); setPVStatus("idle","Preview reset"); }},
  { icon:"🗑",  label:"Delete File",         cat:"File",   kb:"",         run:()=>App.deleteActiveFile() },
];
let cmdFocusIdx = 0;
let filteredCmds = COMMANDS;

function openCMD() {
  $("cmd-overlay").classList.add("open");
  const inp = $("cmd-input");
  inp.value = "";
  renderCMD(COMMANDS);
  setTimeout(()=>inp.focus(), 30);
}
function closeCMD() { $("cmd-overlay").classList.remove("open"); }
function filterCMD(q) {
  const t = q.toLowerCase().trim();
  filteredCmds = t ? COMMANDS.filter(c=>c.label.toLowerCase().includes(t)||c.cat.toLowerCase().includes(t)) : COMMANDS;
  cmdFocusIdx = 0;
  renderCMD(filteredCmds);
}
function renderCMD(cmds) {
  const list = $("cmd-list");
  if(!cmds.length){ list.innerHTML='<div class="cmd-empty">No matching commands</div>'; return; }
  list.innerHTML = cmds.map((c,i)=>`
    <div class="cmd-item${i===cmdFocusIdx?" focused":""}" onclick="runCMD(${i})">
      <span class="ci-icon">${c.icon}</span>
      <span class="ci-label">${E(c.label)}</span>
      ${c.kb?`<span class="ci-kb">${c.kb}</span>`:`<span class="ci-cat">${E(c.cat)}</span>`}
    </div>
  `).join("");
}
function runCMD(i) {
  closeCMD();
  filteredCmds[i]?.run();
}
function cmdKey(e) {
  if (e.key==="Escape") { closeCMD(); return; }
  if (e.key==="Enter") { runCMD(cmdFocusIdx); return; }
  if (e.key==="ArrowDown") { cmdFocusIdx=Math.min(cmdFocusIdx+1,filteredCmds.length-1); renderCMD(filteredCmds); }
  if (e.key==="ArrowUp")   { cmdFocusIdx=Math.max(cmdFocusIdx-1,0); renderCMD(filteredCmds); }
}
window.openCMD = openCMD; window.closeCMD = closeCMD;
window.filterCMD = filterCMD; window.cmdKey = cmdKey;

// ── Render tabs ────────────────────────────────────────────────
function renderTabs() {
  const bar = $("tabbar"); if(!bar) return;
  bar.innerHTML = "";
  const icons = {js:"js",json:"{}",css:"css",md:"md"};
  for (const name of S.tabs) {
    const f = S.files[name];
    const ext = name.split(".").pop();
    const ic = icons[ext]||"js";
    const active = name===S.active;
    const div = document.createElement("div");
    div.className = "tab"+(active?" active":"");
    div.innerHTML = `
      <span class="ti">${ic}</span>
      <span class="tn">${E(name)}${f?.dirty?'<span class="td">●</span>':""}</span>
      <span class="tc" onclick="event.stopPropagation();App.closeTab('${name}')">✕</span>
    `;
    div.onclick = ()=>App.openTab(name);
    bar.appendChild(div);
  }
}

// ── Render file tree ───────────────────────────────────────────
function renderTree() {
  const list = $("file-list"); if(!list) return;
  const names = Object.keys(S.files).sort((a,b)=>{
    if(a==="plugin.json") return -1;
    if(b==="plugin.json") return 1;
    return a.localeCompare(b);
  });
  if(!names.length){ list.innerHTML='<div class="empty-hint">No files. Add one above.</div>'; return; }
  list.innerHTML="";
  const extIcon = {js:"<span style='color:#61afef'>js</span>",json:"<span style='color:#e5c07b'>{}</span>",css:"<span style='color:#56b6c2'>cs</span>",md:"<span style='color:#98c379'>md</span>"};
  for (const name of names) {
    const f = S.files[name];
    const ext = name.split(".").pop();
    const row = document.createElement("div");
    row.className = "f-row"+(name===S.active?" active":"");
    row.innerHTML = `
      <span class="fi">${extIcon[ext]||"<span style='color:#61afef'>js</span>"}</span>
      <span class="fn">${E(name)}</span>
      ${f?.dirty?'<span class="fd">●</span>':""}
      <span class="f-del" onclick="event.stopPropagation();App.deleteFile('${name}')" title="Remove file">✕</span>
    `;
    row.onclick = ()=>App.openTab(name);
    list.appendChild(row);
  }
}

// ── Monaco setup ───────────────────────────────────────────────
const API_TYPES = `
declare const api: {
  terminal: {
    getActive(): number | null;
    getAll(): Array<{ id: number; name: string; cwd: string | null }>;
    send(text: string, paneId?: number): void;
    getOutput(paneId?: number, lines?: number): string;
    onOutput(cb: (data: string, id: number) => void, paneId?: number): { dispose(): void };
    onInput(cb: (text: string, id: number) => boolean | void, paneId?: number): { dispose(): void };
    create(cwd?: string): Promise<number>;
    focus(paneId: number): void;
  };
  ui: {
    toolbar: {
      add(cfg: { id: string; icon?: string; tooltip?: string; label?: string; onClick?(): void }): { remove(): void };
    };
    panel: {
      add(cfg: { id: string; title?: string; icon?: string; render?(el: HTMLElement): void; onShow?(): void; onHide?(): void }): { refresh(): void; remove(): void };
    };
    menu: {
      add(cfg: { id: string; label: string; when?(ctx: any): boolean; onClick?(ctx: any): void }): { remove(): void };
    };
    statusbar: {
      add(cfg: { id: string; text?: string; tooltip?: string; onClick?(): void }): { setText(t: string): void; setTooltip(t: string): void; remove(): void };
    };
  };
  commands: {
    register(cfg: { id: string; name: string; keybinding?: string; category?: string; when?(): boolean; run(): void }): { remove(): void };
  };
  storage: {
    get(key: string): Promise<any>;
    set(key: string, value: any): Promise<void>;
    delete(key: string): Promise<void>;
    clear(): Promise<void>;
  };
  ai: {
    complete(prompt: string): Promise<string>;
    chat(messages: Array<{ role: "user"|"assistant"; content: string }>): Promise<string>;
  };
  events: {
    emit(event: string, data?: any): void;
    on(event: string, cb: (data: any) => void): { dispose(): void };
  };
  settings: Record<string, any>;
};
declare const exports: any;
declare const module: { exports: any };
`;

function initMonaco(cb) {
  require(["vs/editor/editor.main"], () => {
    // Theme
    monaco.editor.defineTheme("sf-dark", {
      base: "vs-dark", inherit: true,
      rules: [
        { token:"",                   foreground:"a4a4b0", background:"0c0c0f" },
        { token:"comment",            foreground:"4c4c58", fontStyle:"italic" },
        { token:"keyword",            foreground:"c678dd" },
        { token:"string",             foreground:"98c379" },
        { token:"string.escape",      foreground:"56b6c2" },
        { token:"number",             foreground:"d19a66" },
        { token:"regexp",             foreground:"56b6c2" },
        { token:"type",               foreground:"e5c07b" },
        { token:"class",              foreground:"e5c07b" },
        { token:"function",           foreground:"61afef" },
        { token:"variable",           foreground:"e06c75" },
        { token:"variable.predefined",foreground:"56b6c2" },
        { token:"constant",           foreground:"d19a66" },
        { token:"delimiter.bracket",  foreground:"ffd700" },
        { token:"delimiter",          foreground:"a4a4b0" },
        { token:"tag",                foreground:"e06c75" },
        { token:"attribute.name",     foreground:"d19a66" },
        { token:"attribute.value",    foreground:"98c379" },
      ],
      colors: {
        "editor.background":                "#0c0c0f",
        "editor.foreground":                "#a4a4b0",
        "editor.lineHighlightBackground":   "#13131a",
        "editor.lineHighlightBorder":       "#00000000",
        "editor.selectionBackground":       "#f9731628",
        "editor.inactiveSelectionBackground":"#f9731614",
        "editor.findMatchBackground":       "#f9731645",
        "editor.findMatchHighlightBackground":"#f9731620",
        "editorCursor.foreground":          "#f97316",
        "editorCursor.background":          "#0c0c0f",
        "editorLineNumber.foreground":      "#38384a",
        "editorLineNumber.activeForeground":"#64647a",
        "editorGutter.background":          "#0c0c0f",
        "editorIndentGuide.background":     "#1e1e26",
        "editorIndentGuide.activeBackground":"#2c2c3c",
        "editorBracketMatch.background":    "#f9731622",
        "editorBracketMatch.border":        "#f97316",
        "editorRuler.foreground":           "#1e1e26",
        "editorWidget.background":          "#18181f",
        "editorWidget.border":              "#28282e",
        "editorSuggestWidget.background":   "#18181f",
        "editorSuggestWidget.border":       "#28282e",
        "editorSuggestWidget.selectedBackground": "#26262e",
        "editorSuggestWidget.selectedForeground": "#e8e8ea",
        "editorSuggestWidget.highlightForeground":"#f97316",
        "editorHoverWidget.background":     "#18181f",
        "editorHoverWidget.border":         "#28282e",
        "editorOverviewRuler.border":       "#1c1c22",
        "input.background":                 "#1c1c22",
        "input.border":                     "#28282e",
        "inputOption.activeBorder":         "#f97316",
        "inputOption.activeBackground":     "#f9731620",
        "list.hoverBackground":             "#1e1e26",
        "list.activeSelectionBackground":   "#26262e",
        "list.focusBackground":             "#26262e",
        "list.highlightForeground":         "#f97316",
        "scrollbarSlider.background":       "#28282e70",
        "scrollbarSlider.hoverBackground":  "#3c3c4870",
        "minimap.background":               "#09090c",
        "minimapSlider.background":         "#28282e50",
        "breadcrumb.foreground":            "#4c4c58",
        "breadcrumb.focusForeground":       "#a4a4b0",
        "breadcrumb.activeSelectionForeground":"#e8e8ea",
      },
    });

    // JS types
    monaco.languages.typescript.javascriptDefaults.addExtraLib(API_TYPES, "ts:sf-api.d.ts");
    monaco.languages.typescript.javascriptDefaults.setDiagnosticsOptions({ noSemanticValidation: false, noSyntaxValidation: false });
    monaco.languages.typescript.javascriptDefaults.setCompilerOptions({ allowJs:true, checkJs:false, target:monaco.languages.typescript.ScriptTarget.ES2020 });

    editor = monaco.editor.create($("monaco-container"), {
      theme: "sf-dark",
      fontSize: 14,
      fontFamily: '"SF Mono", ui-monospace, "Menlo", "Cascadia Code", monospace',
      fontLigatures: true,
      lineHeight: 22,
      letterSpacing: 0.2,
      minimap: { enabled: true, scale: 1, renderCharacters: false },
      scrollBeyondLastLine: true,
      wordWrap: "off",
      renderLineHighlight: "all",
      cursorBlinking: "smooth",
      cursorSmoothCaretAnimation: "on",
      smoothScrolling: true,
      formatOnPaste: true,
      tabSize: 2, insertSpaces: true, detectIndentation: false,
      bracketPairColorization: { enabled: true },
      padding: { top: 16, bottom: 120 },
      overviewRulerBorder: false,
      renderWhitespace: "selection",
      guides: { bracketPairs: "active", indentation: true },
      occurrencesHighlight: "singleFile",
      selectionHighlight: true,
      suggest: { preview: true, localityBonus: true, showSnippets: true },
      quickSuggestions: { strings: true, comments: false, other: true },
      parameterHints: { enabled: true },
      folding: true, foldingHighlight: true, showFoldingControls: "mouseover",
      links: true, colorDecorators: true,
      scrollbar: { verticalScrollbarSize: 5, horizontalScrollbarSize: 5 },
      glyphMargin: false, fixedOverflowWidgets: true,
      accessibilitySupport: "off",
    });

    // Keybindings
    editor.addCommand(monaco.KeyMod.CtrlCmd|monaco.KeyCode.KeyS, ()=>App.save());
    editor.addCommand(monaco.KeyMod.CtrlCmd|monaco.KeyCode.KeyW, ()=>App.closeTab(S.active));
    editor.addCommand(monaco.KeyMod.CtrlCmd|monaco.KeyMod.Shift|monaco.KeyCode.KeyR, ()=>App.push());
    editor.addCommand(monaco.KeyMod.CtrlCmd|monaco.KeyMod.Shift|monaco.KeyCode.KeyP, ()=>App.popout());
    editor.addCommand(monaco.KeyMod.CtrlCmd|monaco.KeyMod.Shift|monaco.KeyCode.KeyF, ()=>editor.getAction("editor.action.formatDocument")?.run());
    editor.addCommand(monaco.KeyMod.CtrlCmd|monaco.KeyCode.KeyK, ()=>openCMD());

    // Cursor position → status bar
    editor.onDidChangeCursorPosition(e=>{
      const lc=$("sb-lc"); if(lc) lc.textContent=`Ln ${e.position.lineNumber}, Col ${e.position.column}`;
    });

    // Monaco markers → Problems panel
    monaco.editor.onDidChangeMarkers(([resource])=>{
      if (!S.active) return;
      const uri = monaco.Uri.parse(`file:///${S.active}`);
      if (resource.toString() === uri.toString()) {
        updateProblems(monaco.editor.getModelMarkers({ resource: uri }));
      }
    });

    // Content changes
    editor.onDidChangeModelContent(()=>{
      if (!S.active) return;
      const f = S.files[S.active];
      if (!f) return;
      const val = editor.getValue();
      if (f.content === val) return;
      f.content = val;
      f.dirty = true;
      renderTabs(); renderTree();
      scheduleLive();
    });

    S.editorReady = true;
    $("monaco-loading").classList.add("hidden");
    if (cb) cb();
  });
}

function openInEditor(name) {
  const f = S.files[name]; if(!f) return;
  S.active = name;
  if (!S.tabs.includes(name)) S.tabs.push(name);

  $("empty-state").classList.add("hidden");
  $("monaco-loading").classList.add("hidden");
  $("monaco-container").classList.remove("hidden");

  if (!editor) {
    $("monaco-loading").classList.remove("hidden");
    $("monaco-container").classList.add("hidden");
    initMonaco(()=>activateModel(name, f));
  } else {
    activateModel(name, f);
  }
  renderTabs(); renderTree();
  updateStatus();
  scheduleLive();
}

function activateModel(name, f) {
  const lang = name.endsWith(".json")?"json":name.endsWith(".css")?"css":name.endsWith(".md")?"markdown":"javascript";
  const uri = monaco.Uri.parse(`file:///${name}`);
  if (!editorModel[name]) {
    editorModel[name] = monaco.editor.createModel(f.content, lang, uri);
  } else if (editorModel[name].getValue() !== f.content) {
    editorModel[name].setValue(f.content);
  }
  editor.setModel(editorModel[name]);
  editor.focus();
  // Breadcrumb + status bar lang
  $("bc").textContent = name;
  const lb=$("sb-lang"); if(lb) lb.textContent = lang.charAt(0).toUpperCase()+lang.slice(1);
  // Update problems for this file
  const markers = monaco.editor.getModelMarkers({ resource: uri });
  updateProblems(markers);
}

// ── Live preview schedule ──────────────────────────────────────
function scheduleLive() {
  clearTimeout(S.liveTimer);
  S.liveTimer = setTimeout(()=>{
    if (!S.active) return;
    const f = S.files[S.active];
    if (!f||S.active.endsWith(".json")||S.active.endsWith(".md")) return;
    const code = f.content;
    const mf = getManifest();
    EmbedPreview.run(code, mf);
    if (S.popoutOpen) window.studio.previewSendCode(code, mf);
    if (S.autoPush && S.connected) App.push(true);
  }, 500);
}

// ── Manifest / plugin ID ───────────────────────────────────────
function getManifest() { try { return JSON.parse(S.files["plugin.json"]?.content||"{}"); } catch { return {}; } }
function getPluginId() { return getManifest().name||"studio-extension"; }

// ── Push Live button state ─────────────────────────────────────
function setPushing(on) {
  const btn=$("push-btn"); if(!btn) return;
  btn.disabled = on;
  btn.classList.toggle("loading", on);
}

// ── Embedded preview ───────────────────────────────────────────
const EmbedPreview = (()=>{
  let cleanup = null;

  function reset() {
    if (cleanup) { try{cleanup();}catch{} cleanup=null; }
    $("sf-tb-ext").innerHTML = "";
    $("sf-seg-ext").innerHTML = "";
    $("sf-sb-ext").innerHTML = "";
    $("sf-rp").classList.remove("on");
    $("sf-rp-body").innerHTML = "";
    const t=$("sf-term");
    if(t){t.style.background="";t.style.color="";}
    document.querySelector(".sf-h") && (document.querySelector(".sf-h").style.background="");
    document.querySelector(".sf-sidebar") && (document.querySelector(".sf-sidebar").style.background="");
    document.querySelector(".sf-status") && (document.querySelector(".sf-status").style.background="");
  }

  function appendTerm(html) {
    const t=$("sf-term"); if(!t) return;
    const cursor=t.querySelector(".sf-cursor");
    const d=document.createElement("div"); d.innerHTML=html;
    if(cursor) cursor.parentElement.insertBefore(d, cursor.parentElement.lastElementChild);
    else t.appendChild(d);
    t.scrollTop=t.scrollHeight;
  }

  function showPanel(cfg) {
    $("sf-rp-title").textContent = cfg.title||cfg.id;
    const body=$("sf-rp-body"); body.innerHTML="";
    const c=document.createElement("div");
    try{cfg.render?.(c);}catch(e){c.style.color="#ef4444";c.textContent=e.message;}
    body.appendChild(c);
    $("sf-rp").classList.add("on");
  }

  function buildAPI() {
    const dis=[];
    const api = {
      terminal: {
        getActive: ()=>1,
        getAll: ()=>[{id:1,name:"Terminal 1",cwd:"~/projects/my-app"},{id:2,name:"api-server",cwd:"~/projects/my-app"},{id:3,name:"git-watch",cwd:"~"}],
        send(text) { appendTerm(`<span class="p">❯</span> <span class="c">${E(text.replace(/\n$/,""))}</span>`); pvToast(`→ ${text.trim().slice(0,50)}`); },
        getOutput: ()=>"❯ npm run dev\n  vite running\n",
        onOutput: (cb)=>{ const t=setInterval(()=>{},999999); dis.push(()=>clearInterval(t)); return{dispose:()=>clearInterval(t)}; },
        onInput: ()=>({dispose:()=>{}}),
        create: async (cwd)=>{ appendTerm(`<span style="color:#22c55e">✓ New pane${cwd?" in "+E(cwd):""}</span>`); return 4; },
        focus: (id)=>pvToast(`Focused pane ${id}`),
      },
      ui: {
        toolbar: {
          add(cfg) {
            const btn=document.createElement("div");
            btn.className="sf-tb"; btn.style.cursor="pointer"; btn.title=cfg.tooltip||"";
            btn.innerHTML = cfg.icon?.length<=4 ? cfg.icon : (cfg.label?`<span style="font-size:11px">${E(cfg.label)}</span>`:"⚡");
            btn.onclick = ()=>{ try{cfg.onClick?.();}catch(e){log(e.message,"err");} };
            $("sf-tb-ext").appendChild(btn);
            dis.push(()=>btn.remove());
            return{remove:()=>btn.remove()};
          },
        },
        panel: {
          add(cfg) {
            const li=document.createElement("div");
            li.className="sf-sb-item"; li.style.cursor="pointer";
            li.innerHTML=`<span style="font-size:12px">${cfg.icon||"📋"}</span> ${E(cfg.title||cfg.id)}`;
            li.onclick=()=>showPanel(cfg);
            $("sf-sb-ext").appendChild(li);
            showPanel(cfg);
            dis.push(()=>{li.remove();$("sf-rp").classList.remove("on");});
            return{refresh(){showPanel(cfg);},remove(){li.remove();$("sf-rp").classList.remove("on");}};
          },
        },
        menu:{add(cfg){pvToast(`Context menu: "${cfg.label}"`);return{remove:()=>{}};}},
        statusbar: {
          add(cfg) {
            const seg=document.createElement("div");
            seg.className="sf-seg"; seg.innerHTML=E(cfg.text||""); seg.title=cfg.tooltip||"";
            seg.style.cursor=cfg.onClick?"pointer":"default";
            if(cfg.onClick) seg.onclick=()=>{try{cfg.onClick();}catch(e){log(e.message,"err");}};
            $("sf-seg-ext").appendChild(seg);
            dis.push(()=>seg.remove());
            return{setText:t=>{seg.innerHTML=E(t);},setTooltip:t=>{seg.title=t;},remove:()=>seg.remove()};
          },
        },
      },
      commands:{register(cfg){pvToast(`Command: "${cfg.name}"`);return{remove:()=>{}};},},
      storage:{_d:{},get:async k=>api.storage._d[k],set:async(k,v)=>{api.storage._d[k]=v;},delete:async k=>{delete api.storage._d[k];},clear:async()=>{api.storage._d={};}},
      ai:{complete:async()=>"(Connect to Shellfire for live AI calls)",chat:async()=>"(Connect to Shellfire for live AI calls)"},
      events:{_h:{},emit(e,d){(api.events._h[e]||[]).forEach(f=>f(d));},on(e,f){(api.events._h[e]=api.events._h[e]||[]).push(f);return{dispose:()=>{api.events._h[e]=(api.events._h[e]||[]).filter(g=>g!==f);}};},},
      settings:{},
    };
    return{api,dis};
  }

  function run(code, manifest) {
    reset();
    setPVInfo(manifest?.displayName||manifest?.name||"Untitled", manifest?.type);
    if(!code?.trim()){setPVStatus("idle","Preview idle");return;}

    let exports={};
    try{
      const fn=new Function("exports","module",code);
      const mod={exports:{}};
      fn(mod.exports,mod);
      exports=mod.exports;
    }catch(e){
      setPVStatus("err","Syntax error: "+e.message.slice(0,40));
      log("Syntax error: "+e.message,"err");
      return;
    }

    // Theme
    if(exports.colors){
      const c=exports.colors;
      const t=$("sf-term");
      if(t){t.style.background=c.background||"";t.style.color=c.foreground||"";}
      if(c.uiBackground){
        document.querySelector(".sf-h")&&(document.querySelector(".sf-h").style.background=c.uiBackground);
        document.querySelector(".sf-sidebar")&&(document.querySelector(".sf-sidebar").style.background=c.uiBackground);
        document.querySelector(".sf-status")&&(document.querySelector(".sf-status").style.background=c.uiBackground);
      }
      setPVStatus("live","Theme applied");
      log("Theme applied to preview","ok");
      return;
    }

    // Extension
    if(typeof exports.activate==="function"){
      const{api,dis}=buildAPI();
      cleanup=()=>{dis.forEach(f=>{try{f();}catch{}});try{exports.deactivate?.();}catch{}};
      try{
        exports.activate(api);
        setPVStatus("live","Extension live");
        log("Extension activated in preview","ok");
      }catch(e){
        setPVStatus("err","activate() error: "+e.message.slice(0,50));
        log("activate() error: "+e.message,"err");
      }
      return;
    }

    if(exports.name&&exports.execute){
      setPVStatus("live",`Command: "${exports.name}"`);
      log(`Command plugin: "${exports.name}"`,"ok");
      return;
    }

    setPVStatus("idle","No activate() or colors");
    log("Nothing to preview — add activate(api) or colors","warn");
  }

  return{run,reset};
})();
window.EmbedPreview = EmbedPreview;

// ── Resize handles ─────────────────────────────────────────────
function setupResize(id, targetId, dir, min, max, invert=false) {
  const handle=$(id), target=$(targetId); if(!handle||!target) return;
  let drag=false, startXY=0, startSize=0;
  handle.addEventListener("mousedown",e=>{
    drag=true;
    startXY = dir==="h"?e.clientX:e.clientY;
    startSize = dir==="h"?target.offsetWidth:target.offsetHeight;
    handle.classList.add("active");
    document.body.style.cursor = dir==="h"?"col-resize":"row-resize";
    document.body.style.userSelect="none";
  });
  document.addEventListener("mousemove",e=>{
    if(!drag) return;
    const delta = (dir==="h"?e.clientX:e.clientY) - startXY;
    const d = invert ? -delta : delta;
    const size = clamp(startSize+d, min, max);
    if(dir==="h") target.style.width=size+"px"; else target.style.height=size+"px";
    editor?.layout(); scalePreview();
  });
  document.addEventListener("mouseup",()=>{
    if(!drag) return; drag=false;
    handle.classList.remove("active");
    document.body.style.cursor=""; document.body.style.userSelect="";
    editor?.layout(); scalePreview();
  });
}

// ── Templates ──────────────────────────────────────────────────
const T = {
  manifest: (name,type) => JSON.stringify({
    name, version:"1.0.0", type, main:"index.js",
    displayName: name.split("-").map(w=>w[0].toUpperCase()+w.slice(1)).join(" "),
    description: "A Shellfire "+type+".", author:"", keywords:[],
    permissions: type==="extension"?["terminal.read","terminal.write","ui.toolbar","ui.statusbar"]:[],
  }, null, 2),

  extension: `// Shellfire Extension
// Type api. below for full autocomplete — all methods are documented.
// Full API reference: ⌘K → Open Docs

module.exports = {
  /**
   * Called when the extension is loaded.
   * @param {typeof api} api - Full Extension API
   */
  activate(api) {
    // ── Toolbar button ───────────────────────────────────────────
    api.ui.toolbar.add({
      id: 'my-ext.action',
      icon: '⚡',
      tooltip: 'Run action',
      onClick() {
        api.terminal.send('echo "Hello from My Extension!"\\n');
      },
    });

    // ── Status bar widget ────────────────────────────────────────
    const widget = api.ui.statusbar.add({
      id: 'my-ext.status',
      text: '🟢 Ready',
      tooltip: 'Extension status',
    });

    // ── Watch terminal output ────────────────────────────────────
    api.terminal.onOutput((data) => {
      if (data.includes('Error') || data.includes('error')) {
        widget.setText('🔴 Error');
      }
    });
  },

  deactivate() {
    // Toolbar and status bar clean up automatically.
    // Cancel any timers or manual subscriptions here.
  },
};`,

  theme: `// Shellfire Theme Extension
// Edit colors and see the preview update live on the right →

module.exports = {
  colors: {
    // ── Terminal (all 16 required) ───────────────────────────────
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

    // ── UI chrome (optional) ─────────────────────────────────────
    uiBackground:  "#1e1e2e",
    uiAccent:      "#cba6f7",
  },
};`,
};

// ── App ────────────────────────────────────────────────────────
const App = {
  newExt() { this._init("my-extension","extension"); },
  newTheme() { this._init("my-theme","theme"); },

  _init(name, type) {
    S.files = {
      "plugin.json": {content:T.manifest(name,type), dirty:false},
      "index.js":    {content:T[type]||T.extension, dirty:false},
    };
    S.tabs=[]; S.active=null; S.folder=null;
    $("crumb").textContent=`New ${type}`; $("crumb").className="";
    this.openTab("index.js");
    log(`New ${type} project created ✓`,"ok");
    toast("Project created","Start coding — preview updates as you type","ok");
  },

  newFile() {
    const name=prompt("Filename (e.g. utils.js):"); if(!name||S.files[name]!==undefined) return;
    S.files[name]={content:"",dirty:true};
    this.openTab(name);
  },

  deleteFile(name) {
    if(!confirm(`Remove "${name}" from project?`)) return;
    delete S.files[name];
    if(editorModel[name]){editorModel[name].dispose();delete editorModel[name];}
    S.tabs=S.tabs.filter(t=>t!==name);
    if(S.active===name){
      const next=S.tabs.at(-1);
      if(next) this.openTab(next);
      else { S.active=null; editor?.setModel(null); $("empty-state").classList.remove("hidden"); $("monaco-container").classList.add("hidden"); renderTabs(); renderTree(); }
    } else { renderTabs(); renderTree(); }
    log(`Removed ${name}`,"info");
  },

  deleteActiveFile() { if(S.active) this.deleteFile(S.active); },

  async openFolder() {
    const res=await window.studio.fsOpenFolder();
    if(res.canceled||res.error){if(res.error)toast("Open failed",res.error,"err");return;}
    S.folder=res.dir; S.files={}; S.tabs=[]; S.active=null;
    for(const[name,f] of Object.entries(res.files||{})) S.files[name]={content:f.content,dirty:false,path:f.path};
    const toOpen=["plugin.json","index.js"].filter(n=>S.files[n]);
    for(const n of (toOpen.length?toOpen:Object.keys(S.files).slice(0,2))) this.openTab(n);
    const short=res.dir.split("/").pop();
    $("crumb").textContent=`~/${short}`; $("crumb").className="has-file";
    log(`Opened ${short} (${Object.keys(S.files).length} files)`,"ok");
    toast("Project opened",`${Object.keys(S.files).length} files loaded`,"ok");
  },

  openTab(name) {
    if(S.active&&editor&&S.files[S.active]) S.files[S.active].content=editor.getValue();
    openInEditor(name);
  },

  closeTab(name) {
    if(!name) return;
    if(S.active&&editor&&S.files[S.active]) S.files[S.active].content=editor.getValue();
    S.tabs=S.tabs.filter(t=>t!==name);
    // Don't dispose the model (keep for future re-open)
    if(S.active===name){
      const next=S.tabs.at(-1);
      if(next) openInEditor(next);
      else{
        S.active=null; editor?.setModel(null);
        $("empty-state").classList.remove("hidden"); $("monaco-container").classList.add("hidden");
        renderTabs(); renderTree();
        $("bc").textContent="—"; updateStatus();
      }
    } else renderTabs();
  },

  async save() {
    if(!S.active||!editor) return;
    const f=S.files[S.active]; if(!f) return;
    f.content=editor.getValue();
    const p=f.path||(S.folder?`${S.folder}/${S.active}`:null);
    if(p){
      const r=await window.studio.fsWrite(p,f.content);
      if(r.ok){f.path=p;f.dirty=false;renderTabs();renderTree();log(`Saved ${S.active}`,"ok");}
      else{toast("Save failed",r.error,"err");}
    } else {
      await this.saveAll();
    }
    if(S.autoPush&&S.connected) this.push(true);
  },

  async saveAll() {
    if(S.active&&editor&&S.files[S.active]) S.files[S.active].content=editor.getValue();
    const base=S.folder||`/tmp/sf-studio-${Date.now()}`;
    let n=0;
    for(const[name,f] of Object.entries(S.files)){
      const p=f.path||`${base}/${name}`;
      const r=await window.studio.fsWrite(p,f.content);
      if(r.ok){f.path=p;f.dirty=false;n++;}
    }
    S.folder=S.folder||base;
    renderTabs(); renderTree();
    log(`Saved ${n} files`,"ok");
  },

  async push(silent=false) {
    if(S.active&&editor&&S.files[S.active]) S.files[S.active].content=editor.getValue();
    const id=getPluginId(), mf=getManifest();
    const files={};
    for(const[n,f] of Object.entries(S.files)) files[n]=f.content;
    setPushing(true);
    if(!silent) log(`Pushing "${id}" to Shellfire…`,"info");
    const res=await window.studio.sfInstall({id,files,type:mf.type||"extension"});
    setPushing(false);
    if(res.error){toast("Push failed",res.error,"err");log("Push failed: "+res.error,"err");return;}
    if(res.reloaded){
      if(!silent){toast("Pushed!",`"${id}" hot-reloaded in Shellfire`,"ok");log(`✓ "${id}" hot-reloaded`,"ok");}
    } else {
      toast("Files written",res.msg||"Restart Shellfire to load","info");
      log(`Files written — ${res.msg||"restart to load"}`,"info");
    }
    loadInstalled();
  },

  toggleAuto() {
    if(!S.connected){toast("Not connected","Start Shellfire v3 first","warn");return;}
    S.autoPush=!S.autoPush;
    const btn=$("auto-btn");
    if(btn) btn.className=`h-auto${S.autoPush?" on":""}`;
    toast(S.autoPush?"Auto-push ON":"Auto-push OFF", S.autoPush?"Changes deploy on every keystroke":"Manual push only","info");
    log(`Auto-push ${S.autoPush?"ON":"OFF"}`,"info");
  },

  async popout() {
    const res=await window.studio.previewOpen();
    if(res.ok){
      S.popoutOpen=true;
      $("popout-btn").classList.add("open");
      const f=S.files[S.active];
      if(f) window.studio.previewSendCode(f.content,getManifest());
      toast("Preview opened","Drag the preview window to any monitor","ok");
    }
  },

  async export() {
    if(S.active&&editor) S.files[S.active].content=editor.getValue();
    const name=getPluginId();
    const r=await window.studio.fsSaveDialog(`${name}.termext`); if(r.canceled) return;
    const files={};
    for(const[n,f] of Object.entries(S.files)) files[n]=f.content;
    const res=await window.studio.fsExportTermext({files,name,outPath:r.filePath});
    if(res.ok){toast("Exported",`${name}.termext saved to Desktop`,"ok");log(`Exported ${name}.termext`,"ok");}
    else{toast("Export failed",res.error||"Unknown error","err");}
  },

  async uninstall(id) {
    if(!confirm(`Uninstall "${id}"?`)) return;
    const res=await window.studio.sfUninstall(id);
    if(res.ok){toast("Uninstalled",`"${id}" removed`,"ok");log(`Uninstalled "${id}"`,"ok");loadInstalled();}
    else toast("Uninstall failed",res.error,"err");
  },

  async consoleSend() {
    const inp=$("console-in"); const text=inp?.value?.trim(); if(!text) return;
    inp.value="";
    if(!S.connected){toast("Not connected","Start Shellfire v3","warn");return;}
    if(!S.sessions.length){toast("No sessions","No active Shellfire sessions","warn");return;}
    const sess=S.sessions[0];
    log(`[${sess.name}] → ${text}`,"info");
    const r=await window.studio.sfSend({name:sess.name,text:text+"\n"});
    if(r.error){log(r.error,"err");return;}
    setTimeout(async()=>{
      const out=await window.studio.sfRead({name:sess.name,lines:10});
      if(out.output?.trim()) log(out.output.trim().split("\n").slice(-5).join("\n"),"info");
    },900);
  },
};
window.App = App;

// ── Global keys ────────────────────────────────────────────────
document.addEventListener("keydown",e=>{
  const m=e.metaKey||e.ctrlKey;
  if(m&&e.key==="k"&&!e.shiftKey){e.preventDefault();openCMD();}
  if(m&&e.key==="o"&&!e.shiftKey){e.preventDefault();App.openFolder();}
  if(m&&e.key==="Escape"){closeCMD();}
  if(e.key==="Escape"&&$("cmd-overlay").classList.contains("open")){closeCMD();}
});

// ── Init ───────────────────────────────────────────────────────
(async()=>{
  // Resize handles
  setupResize("sb-rh","sidebar","h",140,380);
  setupResize("rp-rh","right-panel","h",240,680,true);
  setupResize("bp-rh","bottom-panel","v",60,500,true);

  // Scale preview on load
  setTimeout(scalePreview,100);
  new ResizeObserver(()=>{editor?.layout();scalePreview();}).observe(document.body);

  // Connection
  await pollConn();
  await loadInstalled();
  setInterval(pollConn,6000);

  // Check if preview window was already open
  const open=await window.studio.previewIsOpen();
  S.popoutOpen=!!open;
  if(open){$("popout-btn").classList.add("open");}

  // Monaco pre-loads in background after 800ms so first interaction is instant
  setTimeout(()=>{
    if(!S.editorReady){
      $("monaco-loading").classList.remove("hidden");
      $("monaco-container").classList.add("hidden");
      $("empty-state").classList.add("hidden");
      initMonaco(()=>{
        $("monaco-loading").classList.add("hidden");
        $("empty-state").classList.remove("hidden");
      });
    }
  },800);

  log("Shellfire Studio ready — ⌘K for commands","ok");
})();
