"use strict";
// ═══════════════════════════════════════════════════════════════
// SHELLFIRE STUDIO — RENDERER
// ═══════════════════════════════════════════════════════════════

// ── State ─────────────────────────────────────────────────────
const S = {
  files: {},          // name → { content, dirty, path }
  openTabs: [],
  activeFile: null,
  folderPath: null,
  sfConnected: false,
  sfSessions: [],
  autoPush: false,
  previewPopped: false,
  liveTimer: null,
};

// ── CodeMirror ────────────────────────────────────────────────
let cm = null;

function initEditor() {
  if (cm) return;
  document.getElementById("empty-state").style.display = "none";
  const wrap = document.getElementById("editor-wrap");
  const ta = document.createElement("textarea");
  ta.style.display = "none";
  wrap.appendChild(ta);

  cm = CodeMirror.fromTextArea(ta, {
    theme: "one-dark",
    lineNumbers: true,
    mode: "javascript",
    matchBrackets: true,
    autoCloseBrackets: true,
    styleActiveLine: true,
    indentUnit: 2, tabSize: 2, indentWithTabs: false,
    lineWrapping: false,
    extraKeys: {
      "Cmd-S":  () => App.saveActive(),
      "Ctrl-S": () => App.saveActive(),
      "Cmd-/":  (c) => c.execCommand("toggleComment"),
      "Ctrl-/": (c) => c.execCommand("toggleComment"),
      "Tab": (c) => c.somethingSelected() ? c.indentSelection("add") : c.replaceSelection("  ","end"),
    },
  });

  cm.on("change", () => {
    if (!S.activeFile) return;
    const f = S.files[S.activeFile];
    if (!f) return;
    f.content = cm.getValue();
    f.dirty = true;
    renderTabs();
    renderFiles();
    scheduleLiveUpdate();
  });

  new ResizeObserver(() => cm?.refresh()).observe(wrap);
}

// ── Logging ───────────────────────────────────────────────────
const E = s => String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");

function log(msg, type = "info") {
  const out = document.getElementById("console-out");
  const ts = new Date().toLocaleTimeString("en",{hour12:false});
  const d = document.createElement("div");
  d.className = "log-" + type;
  d.innerHTML = `<span class="log-ts">${ts}</span><span>${E(msg)}</span>`;
  out.appendChild(d);
  out.scrollTop = out.scrollHeight;
  // Also update status strip
  document.getElementById("status-msg").textContent = msg;
  document.getElementById("status-msg").className = "status-msg " + type;
}

// ── Render helpers ────────────────────────────────────────────
function fileIcon(name) {
  if (name === "plugin.json" || name.endsWith(".json")) return `<span style="color:#e5c07b">{}</span>`;
  if (name.endsWith(".css"))  return `<span style="color:#56b6c2">css</span>`;
  if (name.endsWith(".md"))   return `<span style="color:#98c379">md</span>`;
  return `<span style="color:#61afef">js</span>`;
}
function cmMode(name) {
  if (name.endsWith(".json")) return { name:"javascript", json:true };
  if (name.endsWith(".css"))  return "css";
  return "javascript";
}

function renderTabs() {
  const bar = document.getElementById("tab-bar");
  bar.innerHTML = "";
  for (const name of S.openTabs) {
    const f = S.files[name];
    const active = name === S.activeFile;
    const div = document.createElement("div");
    div.className = "etab" + (active ? " active" : "");
    div.innerHTML = `
      <span class="tico">${fileIcon(name)}</span>
      <span class="tname">${E(name)}${f?.dirty ? '<span class="tdirty">●</span>' : ""}</span>
      <button class="tclose" onclick="event.stopPropagation();App.closeTab('${name}')">✕</button>
    `;
    div.onclick = () => App.openTab(name);
    bar.appendChild(div);
  }
}

function renderFiles() {
  const list = document.getElementById("file-list");
  list.innerHTML = "";
  const sorted = Object.keys(S.files).sort((a,b) => {
    if (a==="plugin.json") return -1;
    if (b==="plugin.json") return 1;
    return a.localeCompare(b);
  });
  for (const name of sorted) {
    const div = document.createElement("div");
    div.className = "file-item" + (name === S.activeFile ? " active" : "");
    div.innerHTML = `
      <span class="fic">${fileIcon(name)}</span>
      <span class="fn">${E(name)}</span>
      ${S.files[name]?.dirty ? '<span class="fd">●</span>' : ""}
    `;
    div.onclick = () => App.openTab(name);
    list.appendChild(div);
  }
}

// ── Live preview update ───────────────────────────────────────
function scheduleLiveUpdate() {
  clearTimeout(S.liveTimer);
  S.liveTimer = setTimeout(() => {
    const f = S.files[S.activeFile];
    if (!f) return;
    const isJs = !S.activeFile?.endsWith(".json") && !S.activeFile?.endsWith(".css") && !S.activeFile?.endsWith(".md");
    if (!isJs) return;
    const manifest = getManifest();
    // Send to embedded preview
    EmbeddedPreview.run(f.content, manifest);
    // Send to popped-out preview window
    if (S.previewPopped) window.studio.previewSendCode(f.content, manifest);
    // Auto-push to Shellfire if enabled
    if (S.autoPush && S.sfConnected) {
      App.pushToShellfire(true); // silent=true
    }
  }, 500);
}

function getManifest() {
  try { return JSON.parse(S.files["plugin.json"]?.content || "{}"); }
  catch { return {}; }
}

function getPluginId() {
  return getManifest().name || "studio-extension";
}

// ── Embedded preview (in-app) ─────────────────────────────────
const EmbeddedPreview = (() => {
  let disposed = null;

  function reset() {
    if (disposed) { try { disposed(); } catch {} disposed = null; }
    document.getElementById("sf-tb-ext").innerHTML = "";
    document.getElementById("sf-status-ext").innerHTML = "";
    document.getElementById("sf-panel-list").innerHTML = "";
    document.getElementById("sf-right-panel").classList.remove("show");
    document.getElementById("sf-right-body").innerHTML = "";
    const term = document.getElementById("sf-term");
    term.style.background = ""; term.style.color = "";
  }

  function buildAPI() {
    const dis = [];
    const toast = (msg, dur=2200) => {
      const t = document.getElementById("preview-toast");
      if (!t) return;
      t.textContent = msg; t.classList.add("show");
      setTimeout(() => t.classList.remove("show"), dur);
    };
    const api = {
      terminal: {
        getActive: () => 1,
        getAll: () => [
          {id:1,name:"Terminal 1",cwd:"~/projects/my-app"},
          {id:2,name:"api-server",cwd:"~/projects/my-app"},
        ],
        send(text) {
          const term = document.getElementById("sf-term");
          const cursor = term?.querySelector(".sf-cursor");
          const div = document.createElement("div");
          div.innerHTML = `<span class="prompt">❯</span> <span class="cmd">${E(text.replace(/\n$/,""))}</span>`;
          if (cursor) cursor.parentElement.insertBefore(div, cursor.parentElement.lastChild);
          else term?.appendChild(div);
          toast(`→ ${text.trim().slice(0,50)}`);
        },
        getOutput: () => "❯ npm run dev\n  vite running\n",
        onOutput: (cb) => { const t=setInterval(()=>{},999999); dis.push(()=>clearInterval(t)); return {dispose:()=>clearInterval(t)}; },
        onInput: () => ({dispose:()=>{}}),
        create: async (cwd) => { toast(`New pane${cwd?" in "+cwd:""}`); return 3; },
        focus: (id) => toast(`Focused pane ${id}`),
      },
      ui: {
        toolbar: {
          add(cfg) {
            const btn = document.createElement("button");
            btn.className = "sf-btn"; btn.title = cfg.tooltip || "";
            btn.innerHTML = cfg.icon?.length <= 4 ? cfg.icon : (cfg.label ? E(cfg.label) : "⚡");
            if (cfg.label && cfg.icon) btn.innerHTML = `${cfg.icon}&nbsp;<span style="font-size:10px">${E(cfg.label)}</span>`;
            btn.onclick = () => { try { cfg.onClick?.(); } catch(e){ log("toolbar onClick: "+e.message,"error"); } };
            document.getElementById("sf-tb-ext").appendChild(btn);
            dis.push(() => btn.remove());
            return { remove:()=>btn.remove() };
          },
        },
        panel: {
          add(cfg) {
            const li = document.createElement("div");
            li.className = "sfp-item"; li.style.cssText="padding:5px 14px;font-size:12px;color:#71717a;cursor:pointer;display:flex;gap:7px;align-items:center;";
            li.innerHTML = `<span>${cfg.icon||"📋"}</span> ${E(cfg.title||cfg.id)}`;
            li.onclick = () => showPanel(cfg);
            document.getElementById("sf-panel-list").appendChild(li);
            showPanel(cfg);
            dis.push(() => { li.remove(); document.getElementById("sf-right-panel").classList.remove("show"); });
            return { refresh(){ showPanel(cfg); }, remove(){ li.remove(); document.getElementById("sf-right-panel").classList.remove("show"); } };
          },
        },
        menu: { add(cfg){ toast(`Context menu: "${cfg.label}"`); return {remove:()=>{}}; } },
        statusbar: {
          add(cfg) {
            const span = document.createElement("div");
            span.className = "sf-s-item";
            span.innerHTML = E(cfg.text||""); span.title = cfg.tooltip||"";
            span.style.cursor = cfg.onClick?"pointer":"default";
            if (cfg.onClick) span.onclick = ()=>{ try{cfg.onClick();}catch(e){log(e.message,"error");} };
            document.getElementById("sf-status-ext").appendChild(span);
            dis.push(() => span.remove());
            return { setText(t){span.innerHTML=E(t);}, setTooltip(t){span.title=t;}, remove(){span.remove();} };
          },
        },
      },
      commands: {
        register(cfg){ toast(`Command: "${cfg.name}"`); return {remove:()=>{}}; },
      },
      storage: {
        _d:{}, get:async k=>api.storage._d[k],
        set:async(k,v)=>{api.storage._d[k]=v;},
        delete:async k=>{delete api.storage._d[k];},
        clear:async()=>{api.storage._d={};},
      },
      ai: {
        complete:async()=>"(AI — connect to Shellfire)",
        chat:async()=>"(AI — connect to Shellfire)",
      },
      events: {
        _h:{},
        emit(e,d){(api.events._h[e]||[]).forEach(f=>f(d));},
        on(e,f){ (api.events._h[e]=api.events._h[e]||[]).push(f); return {dispose:()=>{api.events._h[e]=(api.events._h[e]||[]).filter(g=>g!==f);}}; },
      },
      settings: {},
    };
    return { api, dis };
  }

  function showPanel(cfg) {
    document.getElementById("sf-right-title").textContent = cfg.title || cfg.id;
    const body = document.getElementById("sf-right-body");
    body.innerHTML = "";
    const c = document.createElement("div");
    try { cfg.render?.(c); } catch(e){ c.style.color="#ef4444"; c.textContent=e.message; }
    body.appendChild(c);
    document.getElementById("sf-right-panel").classList.add("show");
  }

  function run(code, manifest) {
    reset();
    if (!code?.trim()) return;

    let exports = {};
    try {
      const fn = new Function("exports","module",code);
      const mod = {exports:{}};
      fn(mod.exports, mod);
      exports = mod.exports;
    } catch(e) {
      log("Syntax error: " + e.message, "error");
      setPreviewBadge("error");
      return;
    }

    // Theme
    if (exports.colors) {
      const c = exports.colors;
      const term = document.getElementById("sf-term");
      if (term) { term.style.background = c.background||""; term.style.color = c.foreground||""; }
      log("Theme applied to preview", "ok");
      setPreviewBadge("live");
      return;
    }

    if (typeof exports.activate === "function") {
      const { api, dis } = buildAPI();
      disposed = () => { dis.forEach(f=>{try{f();}catch{}}); try{exports.deactivate?.();}catch{} };
      try {
        exports.activate(api);
        log("Extension activated in preview", "ok");
        setPreviewBadge("live");
      } catch(e) {
        log("activate() error: " + e.message, "error");
        setPreviewBadge("error");
      }
      return;
    }
    if (exports.name && exports.execute) {
      log(`Command plugin: "${exports.name}"`, "ok");
      setPreviewBadge("live");
      return;
    }
    log("No activate() or colors found", "warn");
    setPreviewBadge("idle");
  }

  return { run, reset };
})();

function setPreviewBadge(state) {
  const b = document.getElementById("preview-badge");
  if (!b) return;
  b.className = "preview-badge " + state;
  b.textContent = { live:"● Live", error:"● Error", idle:"○ Idle" }[state] || "○";
}

// ── Connection polling ────────────────────────────────────────
async function pollConnection() {
  const res = await window.studio.sfStatus();
  S.sfConnected = res.connected;
  S.sfSessions = res.sessions || [];

  const pill = document.getElementById("conn-pill");
  const txt  = document.getElementById("conn-text");
  if (res.connected) {
    pill.className = "conn-pill on";
    txt.textContent = `${res.sessions.length} session${res.sessions.length!==1?"s":""}`;
    renderSessions(res.sessions);
  } else {
    pill.className = "conn-pill off";
    txt.textContent = "Disconnected";
    renderSessions([]);
  }
  updateAutoPushUI();
}

function renderSessions(sessions) {
  const sl = document.getElementById("sessions-list");
  if (!sl) return;
  if (!sessions.length) {
    sl.innerHTML = '<div style="padding:8px 0;color:var(--text3);font-size:12px">No active sessions</div>';
    return;
  }
  sl.innerHTML = sessions.map(s => `
    <div class="sess-item">
      <span class="sess-dot"></span>
      <span class="sess-name">${E(s.name)}</span>
      <span class="sess-proc">${E(s.process||"")}</span>
      <span class="sess-cwd">${E((s.cwd||"").replace(/^\/Users\/[^/]+/,"~"))}</span>
    </div>
  `).join("");
}

function updateAutoPushUI() {
  const btn = document.getElementById("auto-push-btn");
  if (!btn) return;
  if (S.autoPush && S.sfConnected) {
    btn.textContent = "⚡ Auto: ON";
    btn.className = "hdr-btn ap-on";
  } else if (!S.sfConnected) {
    btn.textContent = "⚡ Auto";
    btn.className = "hdr-btn ap-off";
  } else {
    btn.textContent = "⚡ Auto";
    btn.className = "hdr-btn";
  }
}

// ── Installed extensions ──────────────────────────────────────
async function refreshInstalled() {
  const installed = await window.studio.fsListInstalled();
  const list = document.getElementById("installed-list");
  list.innerHTML = installed.length
    ? installed.map(p => `
      <div class="inst-item">
        <div class="inst-name">${E(p.manifest.displayName||p.manifest.name)}</div>
        <div class="inst-meta">${E(p.manifest.type)} · v${E(p.manifest.version)}
          <button class="inst-del" onclick="App.uninstall('${E(p.id)}')" title="Uninstall">✕</button>
        </div>
      </div>
    `).join("")
    : '<div class="empty-installed">No extensions installed</div>';
}

// ── Templates ─────────────────────────────────────────────────
const TMPL = {
  manifest: (name, type) => JSON.stringify({
    name, version:"1.0.0", type, main:"index.js",
    displayName: name.split("-").map(w=>w[0].toUpperCase()+w.slice(1)).join(" "),
    description: "A Shellfire " + type + ".",
    author: "", keywords: [],
    permissions: type==="extension" ? ["terminal.read","terminal.write","ui.toolbar","ui.statusbar"] : [],
  }, null, 2),

  extension: `// Shellfire Extension — full API at https://shellfire.dev/docs#api-terminal
module.exports = {
  activate(api) {
    // ── Toolbar button ───────────────────────────────────────────
    api.ui.toolbar.add({
      id: 'my-ext.btn',
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
    const sub = api.terminal.onOutput((data, id) => {
      if (data.includes('error') || data.includes('Error')) {
        widget.setText('🔴 Error');
      } else if (data.includes('✓') || data.includes('success')) {
        widget.setText('🟢 OK');
      }
    });
  },

  deactivate() {
    // Automatic cleanup: toolbar buttons and status widgets
    // Clear any manual timers or subscriptions here
  },
};`,

  theme: `// Shellfire Theme Extension
module.exports = {
  colors: {
    // Terminal palette (all 16 required)
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

// ── App ───────────────────────────────────────────────────────
const App = {
  // ── File ops ──────────────────────────────────────────────
  newProject(type = "extension") {
    const name = "my-" + type;
    S.files = {
      "plugin.json": { content: TMPL.manifest(name, type), dirty: false },
      "index.js":    { content: TMPL[type] || TMPL.extension, dirty: false },
    };
    S.openTabs = []; S.activeFile = null; S.folderPath = null;
    this.openTab("index.js");
    log(`New ${type} project created`, "ok");
  },

  newFile() {
    const name = prompt("Filename (e.g. helper.js):");
    if (!name || S.files[name] !== undefined) return;
    S.files[name] = { content: "", dirty: true };
    this.openTab(name);
  },

  async openFolder() {
    const res = await window.studio.fsOpenFolder();
    if (res.canceled || res.error) { if(res.error) log(res.error,"error"); return; }
    S.folderPath = res.dir;
    S.files = {};
    for (const [name, f] of Object.entries(res.files || {})) {
      S.files[name] = { content: f.content, dirty: false, path: f.path };
    }
    S.openTabs = []; S.activeFile = null;
    const toOpen = ["plugin.json","index.js"].filter(n=>S.files[n]);
    for (const n of (toOpen.length ? toOpen : Object.keys(S.files).slice(0,2))) this.openTab(n);
    log(`Opened ${res.dir.split("/").pop()} (${Object.keys(S.files).length} files)`, "ok");
    renderFiles();
  },

  openTab(name) {
    if (S.activeFile && S.files[S.activeFile] && cm) {
      S.files[S.activeFile].content = cm.getValue();
    }
    S.activeFile = name;
    if (!S.openTabs.includes(name)) S.openTabs.push(name);

    initEditor();
    const f = S.files[name];
    cm.setValue(f?.content || "");
    cm.setOption("mode", cmMode(name));
    cm.clearHistory();
    cm.focus();

    renderTabs();
    renderFiles();
    scheduleLiveUpdate();
  },

  closeTab(name) {
    if (S.activeFile && cm) S.files[S.activeFile].content = cm.getValue();
    S.openTabs = S.openTabs.filter(t => t !== name);
    if (S.activeFile === name) {
      const next = S.openTabs.at(-1);
      if (next) this.openTab(next);
      else { S.activeFile = null; cm?.setValue(""); renderTabs(); renderFiles(); }
    } else { renderTabs(); }
  },

  async saveActive() {
    if (!S.activeFile || !cm) return;
    const f = S.files[S.activeFile];
    if (!f) return;
    f.content = cm.getValue();
    const savePath = f.path || (S.folderPath ? `${S.folderPath}/${S.activeFile}` : null);
    if (savePath) {
      const r = await window.studio.fsWrite(savePath, f.content);
      if (r.ok) { f.path = savePath; f.dirty = false; renderTabs(); renderFiles(); log(`Saved ${S.activeFile}`, "ok"); }
      else log(`Save failed: ${r.error}`, "error");
    } else {
      await this.saveAll();
    }
  },

  async saveAll() {
    if (S.activeFile && cm) S.files[S.activeFile].content = cm.getValue();
    const baseDir = S.folderPath || `/tmp/sf-studio-${Date.now()}`;
    let count = 0;
    for (const [name, f] of Object.entries(S.files)) {
      const p = f.path || `${baseDir}/${name}`;
      const r = await window.studio.fsWrite(p, f.content);
      if (r.ok) { f.path = p; f.dirty = false; count++; }
    }
    S.folderPath = S.folderPath || baseDir;
    renderTabs(); renderFiles();
    log(`Saved ${count} files`, "ok");
  },

  // ── Push to Shellfire ──────────────────────────────────────
  async pushToShellfire(silent = false) {
    if (S.activeFile && cm) S.files[S.activeFile].content = cm.getValue();
    const id = getPluginId();
    const mf = getManifest();
    const files = {};
    for (const [n,f] of Object.entries(S.files)) files[n] = f.content;

    if (!silent) log(`Pushing "${id}" to Shellfire…`, "info");
    const res = await window.studio.sfInstall({ id, files, type: mf.type || "extension" });

    if (res.error) { log(`✗ Push failed: ${res.error}`, "error"); return; }
    if (res.reloaded) {
      if (!silent) log(`✓ "${id}" hot-reloaded in Shellfire`, "ok");
    } else {
      log(`✓ "${id}" installed (${res.msg})`, "ok");
    }
    refreshInstalled();
  },

  toggleAutoPush() {
    if (!S.sfConnected) { log("Not connected to Shellfire v3", "warn"); return; }
    S.autoPush = !S.autoPush;
    updateAutoPushUI();
    log(S.autoPush ? "Auto-push ON — changes deploy on every save" : "Auto-push OFF", S.autoPush?"ok":"info");
  },

  // ── Export ─────────────────────────────────────────────────
  async exportTermext() {
    if (S.activeFile && cm) S.files[S.activeFile].content = cm.getValue();
    const name = getPluginId();
    const r = await window.studio.fsSaveDialog(`${name}.termext`);
    if (r.canceled) return;
    const files = {};
    for (const [n,f] of Object.entries(S.files)) files[n] = f.content;
    const res = await window.studio.fsExportTermext({ files, name, outPath: r.filePath });
    if (res.ok) log(`Exported ${name}.termext`, "ok");
    else log(`Export failed: ${res.error}`, "error");
  },

  // ── Preview pop-out ────────────────────────────────────────
  async popOutPreview() {
    const res = await window.studio.previewOpen();
    if (res.ok) {
      S.previewPopped = true;
      document.getElementById("popout-btn").textContent = "⤢ Preview ✓";
      // Send current code immediately
      const f = S.files[S.activeFile];
      if (f) window.studio.previewSendCode(f.content, getManifest());
      log("Preview opened in separate window", "ok");
    }
  },

  // ── Uninstall ──────────────────────────────────────────────
  async uninstall(id) {
    if (!confirm(`Uninstall "${id}"?`)) return;
    const res = await window.studio.sfUninstall(id);
    if (res.ok) { log(`Uninstalled "${id}"`, "ok"); refreshInstalled(); }
    else log(`Uninstall failed: ${res.error}`, "error");
  },

  // ── Console ────────────────────────────────────────────────
  consoleKeydown(e) { if (e.key==="Enter") this.consoleSend(); },
  async consoleSend() {
    const inp = document.getElementById("console-input");
    const text = inp.value.trim(); if (!text) return;
    inp.value = "";
    if (!S.sfConnected) { log("Not connected","warn"); return; }
    if (!S.sfSessions.length) { log("No sessions","warn"); return; }
    const session = S.sfSessions[0];
    log(`[${session.name}] → ${text}`, "info");
    const send = await window.studio.sfSend({ name: session.name, text: text+"\n" });
    if (send.error) { log(send.error,"error"); return; }
    setTimeout(async () => {
      const out = await window.studio.sfRead({ name: session.name, lines: 10 });
      if (out.output) log(out.output.split("\n").slice(-6).join("\n"), "info");
    }, 900);
  },
};

// ── Resizable panels ──────────────────────────────────────────
function initResize() {
  const divider = document.getElementById("h-divider");
  const left = document.getElementById("filesidebar");
  const right = document.getElementById("right-col");
  let dragging = false, startX = 0, startW = 0, startR = 0;

  divider?.addEventListener("mousedown", e => {
    dragging = true; startX = e.clientX;
    startW = left.offsetWidth; startR = right.offsetWidth;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  });

  document.addEventListener("mousemove", e => {
    if (!dragging) return;
    const dx = e.clientX - startX;
    const nw = Math.max(160, Math.min(360, startW + dx));
    left.style.width = nw + "px";
  });
  document.addEventListener("mouseup", () => {
    dragging = false;
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
    cm?.refresh();
  });

  // Right col resize
  const rdivider = document.getElementById("r-divider");
  let rDrag = false, rStartX = 0, rStartW = 0;
  rdivider?.addEventListener("mousedown", e => {
    rDrag = true; rStartX = e.clientX; rStartW = right.offsetWidth;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  });
  document.addEventListener("mousemove", e => {
    if (!rDrag) return;
    const dx = rStartX - e.clientX;
    const nw = Math.max(280, Math.min(700, rStartW + dx));
    right.style.width = nw + "px";
    cm?.refresh();
  });
  document.addEventListener("mouseup", () => {
    if (!rDrag) return;
    rDrag = false;
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
    cm?.refresh();
  });
}

// ── Keyboard shortcuts ────────────────────────────────────────
document.addEventListener("keydown", e => {
  const m = e.metaKey || e.ctrlKey;
  if (m && e.key==="s") { e.preventDefault(); App.saveActive(); }
  if (m && e.key==="n") { e.preventDefault(); App.newFile(); }
  if (m && e.key==="o") { e.preventDefault(); App.openFolder(); }
  if (m && e.shiftKey && e.key==="P") { e.preventDefault(); App.popOutPreview(); }
  if (m && e.shiftKey && e.key==="R") { e.preventDefault(); App.pushToShellfire(); }
});

// ── Init ──────────────────────────────────────────────────────
(async () => {
  initResize();
  await pollConnection();
  await refreshInstalled();
  setInterval(pollConnection, 5000);
  log("Shellfire Studio ready ⌘S save · ⌘O open · ⌘⇧R push · ⌘⇧P preview", "ok");

  // Check if preview window was open
  const isOpen = await window.studio.previewIsOpen();
  S.previewPopped = !!isOpen;
  if (isOpen) document.getElementById("popout-btn").textContent = "⤢ Preview ✓";
})();
