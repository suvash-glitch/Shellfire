"use strict";

// ============================================================
// EXTENSION BUILDER — RENDERER
// ============================================================

const App = (() => {
  // ── State ────────────────────────────────────────────────────
  let files = {};        // filename → content
  let activeFile = null;
  let dirty = new Set(); // files with unsaved changes
  let folderPath = null;
  let openTabs = [];     // ordered list of open filenames

  // ── DOM refs ─────────────────────────────────────────────────
  const $ = (id) => document.getElementById(id);
  const editor = $("editor");
  const fileList = $("file-list");
  const tabBar = $("tab-bar");
  const statusLabel = $("status-label");
  const toast = $("toast");

  // ── Utilities ─────────────────────────────────────────────────
  let toastTimer;
  function showToast(msg, type = "") {
    toast.textContent = msg;
    toast.className = "show" + (type ? " " + type : "");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toast.className = ""; }, 3000);
  }

  function setStatus(msg) { statusLabel.textContent = msg; }

  function markdownToHtml(md) {
    // Minimal markdown renderer: code blocks, inline code, headings, lists, tables, bold
    return md
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) => `<pre><code class="lang-${lang}">${code.trim()}</code></pre>`)
      .replace(/`([^`]+)`/g, "<code>$1</code>")
      .replace(/^######\s(.+)/gm, "<h6>$1</h6>")
      .replace(/^#####\s(.+)/gm, "<h5>$1</h5>")
      .replace(/^####\s(.+)/gm, "<h4>$1</h4>")
      .replace(/^###\s(.+)/gm, "<h3>$1</h3>")
      .replace(/^##\s(.+)/gm, "<h2>$1</h2>")
      .replace(/^#\s(.+)/gm, "<h1>$1</h1>")
      .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
      .replace(/\*(.+?)\*/g, "<em>$1</em>")
      .replace(/^\|\s*(.*?)\s*\|$/gm, (_, row) => {
        const cells = row.split("|").map(c => c.trim());
        return "<tr>" + cells.map(c => `<td>${c}</td>`).join("") + "</tr>";
      })
      .replace(/(<tr>.*<\/tr>\n?)+/g, m => `<table>${m}</table>`)
      .replace(/^---+$/gm, "<hr>")
      .replace(/^-\s(.+)/gm, "<li>$1</li>")
      .replace(/(<li>[\s\S]*?<\/li>)/g, "<ul>$1</ul>")
      .replace(/\n\n/g, "<br><br>");
  }

  // ── File management ───────────────────────────────────────────
  function renderFileList() {
    fileList.innerHTML = "";
    const sorted = Object.keys(files).sort((a, b) => {
      if (a === "plugin.json") return -1;
      if (b === "plugin.json") return 1;
      return a.localeCompare(b);
    });
    for (const name of sorted) {
      const item = document.createElement("div");
      item.className = "file-item" + (name === activeFile ? " active" : "");
      item.textContent = name;
      if (dirty.has(name)) {
        const badge = document.createElement("span");
        badge.className = "badge"; badge.textContent = "●";
        item.appendChild(badge);
      }
      item.onclick = () => openTab(name);
      fileList.appendChild(item);
    }
  }

  function renderTabBar() {
    tabBar.innerHTML = "";
    for (const name of openTabs) {
      const tab = document.createElement("div");
      tab.className = "tab" + (name === activeFile ? " active" : "");
      tab.innerHTML = `${dirty.has(name) ? "● " : ""}${name}<span class="close" onclick="event.stopPropagation();App.closeTab('${name}')">✕</span>`;
      tab.onclick = () => openTab(name);
      tabBar.appendChild(tab);
    }
  }

  function openTab(name) {
    if (activeFile) files[activeFile] = editor.value; // save current
    activeFile = name;
    if (!openTabs.includes(name)) openTabs.push(name);
    editor.value = files[name] || "";
    renderFileList();
    renderTabBar();
    // Sync manifest form if plugin.json opened
    if (name === "plugin.json") syncManifestForm();
  }

  function closeTab(name) {
    openTabs = openTabs.filter(t => t !== name);
    if (activeFile === name) {
      activeFile = openTabs[openTabs.length - 1] || null;
      editor.value = activeFile ? (files[activeFile] || "") : "";
    }
    renderTabBar();
    renderFileList();
  }

  function addFile() {
    const name = prompt("File name (e.g. helper.js):");
    if (!name || files[name] !== undefined) return;
    files[name] = "";
    openTab(name);
  }

  // ── Default project template ──────────────────────────────────
  function newProject(type = "extension") {
    const manifest = {
      name: "my-extension",
      displayName: "My Extension",
      version: "1.0.0",
      description: "A Shellfire extension.",
      author: "",
      type,
      main: "index.js",
      permissions: ["terminal.read", "terminal.write"],
    };
    let mainCode = "";
    if (type === "theme") {
      mainCode = `// Shellfire Theme Extension
// See docs/extension-api.md for the full color reference.
module.exports = {
  colors: {
    background:    "#1e1e1e",
    foreground:    "#d4d4d4",
    cursor:        "#d4d4d4",
    selection:     "#264f78",
    black:         "#1e1e1e",
    red:           "#f44747",
    green:         "#6a9955",
    yellow:        "#dcdcaa",
    blue:          "#569cd6",
    magenta:       "#c678dd",
    cyan:          "#4ec9b0",
    white:         "#d4d4d4",
    brightBlack:   "#808080",
    brightRed:     "#f44747",
    brightGreen:   "#6a9955",
    brightYellow:  "#dcdcaa",
    brightBlue:    "#569cd6",
    brightMagenta: "#c678dd",
    brightCyan:    "#4ec9b0",
    brightWhite:   "#d4d4d4",
  },
};
`;
    } else {
      mainCode = `// Shellfire Extension
// Full API reference: Extensions → API Docs or docs/extension-api.md

module.exports = {
  /**
   * Called when the extension is loaded.
   * @param {ShellFireExtensionAPI} api
   */
  activate(api) {
    // Example: add a toolbar button
    api.ui.toolbar.add({
      id: "my-extension.action",
      icon: "⚡",
      tooltip: "My Extension Action",
      onClick() {
        api.terminal.send("echo 'Hello from My Extension!'\\n");
      },
    });
  },

  /**
   * Called when the extension is disabled or uninstalled.
   * Clean up any timers, event listeners, or DOM nodes here.
   */
  deactivate() {},
};
`;
    }

    files = {
      "plugin.json": JSON.stringify(manifest, null, 2),
      "index.js": mainCode,
    };
    dirty.clear();
    openTabs = [];
    folderPath = null;
    activeFile = null;
    openTab("index.js");
    openTab("plugin.json");
    openTab("index.js");
    syncManifestForm();
    setStatus("New project");
  }

  // ── Open existing folder ──────────────────────────────────────
  // Platform-aware path join for renderer (no node `path` module available)
  function joinPath(...parts) {
    const sep = window.builder.platform === "win32" ? "\\" : "/";
    return parts.join(sep).replace(/[/\\]+/g, sep);
  }

  async function openFolder() {
    const result = await window.builder.openFolder();
    if (result.canceled) return;
    folderPath = result.folderPath;
    setStatus("Loading…");
    const { files: entries, error } = await window.builder.listDir(folderPath);
    if (error) { showToast(error, "err"); return; }
    files = {};
    dirty.clear();
    openTabs = [];
    activeFile = null;
    for (const e of (entries || [])) {
      if (e.isDir) continue;
      const r = await window.builder.readFile(joinPath(folderPath, e.name));
      if (!r.error) files[e.name] = r.content;
    }
    // Open important files first; fall back gracefully
    const toOpen = ["plugin.json", "index.js"].filter(n => files[n] !== undefined);
    const first = Object.keys(files)[0];
    for (const name of (toOpen.length ? toOpen : [first]).filter(Boolean)) openTab(name);
    syncManifestForm();
    setStatus(`Opened ${folderPath.split(/[/\\]/).pop()}`);
  }

  // ── Save ──────────────────────────────────────────────────────
  async function saveAll() {
    if (activeFile) files[activeFile] = editor.value;
    if (!folderPath) {
      showToast("Choose a folder first (use Export to save as .termext)", "err");
      return;
    }
    setStatus("Saving…");
    for (const [name, content] of Object.entries(files)) {
      await window.builder.writeFile(joinPath(folderPath, name), content);
      dirty.delete(name);
    }
    renderFileList(); renderTabBar();
    setStatus("Saved"); showToast("Saved", "ok");
  }

  // ── Export as .termext ────────────────────────────────────────
  async function exportPackage() {
    if (activeFile) files[activeFile] = editor.value;
    let pluginName = "extension";
    try { pluginName = JSON.parse(files["plugin.json"] || "{}").name || "extension"; } catch {}
    setStatus("Exporting…");
    const result = await window.builder.exportTermext(files, pluginName);
    if (result.canceled) { setStatus("Cancelled"); return; }
    if (result.error) { showToast(result.error, "err"); return; }
    setStatus("Exported"); showToast("Exported to " + result.filePath.split("/").pop(), "ok");
  }

  // ── Install directly into Shellfire ──────────────────────────
  async function installToShellfire() {
    if (activeFile) files[activeFile] = editor.value;
    let pluginName = "my-extension";
    try { pluginName = JSON.parse(files["plugin.json"] || "{}").name || pluginName; } catch {}
    setStatus("Installing…");
    const result = await window.builder.installBuilt(files, pluginName);
    if (result.error) { showToast(result.error, "err"); return; }
    setStatus("Installed"); showToast(`Installed "${pluginName}" — restart Shellfire to load`, "ok");
  }

  // ── Manifest form ─────────────────────────────────────────────
  function syncManifestForm() {
    try {
      const m = JSON.parse(files["plugin.json"] || "{}");
      $("m-name").value = m.name || "";
      $("m-displayName").value = m.displayName || "";
      $("m-version").value = m.version || "1.0.0";
      $("m-description").value = m.description || "";
      $("m-author").value = m.author || "";
      $("m-type").value = m.type || "extension";
      $("m-main").value = m.main || "index.js";
    } catch {}
  }

  function applyManifest() {
    try {
      const existing = JSON.parse(files["plugin.json"] || "{}");
      const updated = {
        ...existing,
        name:        $("m-name").value.trim() || existing.name,
        displayName: $("m-displayName").value.trim(),
        version:     $("m-version").value.trim() || "1.0.0",
        description: $("m-description").value.trim(),
        author:      $("m-author").value.trim(),
        type:        $("m-type").value,
        main:        $("m-main").value.trim() || "index.js",
      };
      files["plugin.json"] = JSON.stringify(updated, null, 2);
      dirty.add("plugin.json");
      if (activeFile === "plugin.json") editor.value = files["plugin.json"];
      renderFileList(); renderTabBar();
      showToast("Manifest updated", "ok");
    } catch (e) { showToast("Invalid manifest: " + e.message, "err"); }
  }

  // ── Panel switching ───────────────────────────────────────────
  function switchPanel(name, el) {
    document.querySelectorAll(".panel-tab").forEach(t => t.classList.remove("active"));
    document.querySelectorAll(".panel-pane").forEach(p => p.classList.remove("active"));
    el.classList.add("active");
    $(`${name}-pane`).classList.add("active");
    if (name === "docs" && $("docs-content").textContent === "Loading docs…") loadDocs();
  }

  async function loadDocs() {
    const result = await window.builder.getApiDocs();
    $("docs-content").innerHTML = markdownToHtml(result.content || "");
  }

  // ── AI assistant ──────────────────────────────────────────────
  let aiThinking = false;

  function appendAiMessage(role, text) {
    const msgs = $("ai-messages");
    const div = document.createElement("div");
    div.className = `ai-msg ${role}`;
    if (role === "assistant") {
      div.innerHTML = markdownToHtml(text);
      // Add "Use this code" button if code block present
      const codeBlocks = div.querySelectorAll("pre code");
      codeBlocks.forEach(block => {
        const btn = document.createElement("button");
        btn.textContent = "Use this code";
        btn.style.cssText = "margin-top:6px;padding:4px 10px;font-size:11px;border-radius:4px;border:1px solid var(--accent);background:transparent;color:var(--accent);cursor:pointer;";
        btn.onclick = () => insertCode(block.textContent);
        block.parentNode.after(btn);
      });
    } else {
      div.textContent = text;
    }
    msgs.appendChild(div);
    msgs.scrollTop = msgs.scrollHeight;
  }

  function insertCode(code) {
    // If the active file is index.js or similar, replace its content
    if (activeFile) {
      files[activeFile] = code;
      editor.value = code;
      dirty.add(activeFile);
      renderFileList(); renderTabBar();
      showToast("Code applied to " + activeFile, "ok");
    }
  }

  async function sendAI() {
    if (aiThinking) return;
    const input = $("ai-input");
    const prompt = input.value.trim();
    if (!prompt) return;

    input.value = "";
    aiThinking = true;
    $("ai-send").disabled = true;
    appendAiMessage("user", prompt);

    // Pass current code as context
    const currentCode = activeFile ? (files[activeFile] || "") : "";
    const ctx = `Current file: ${activeFile || "none"}\nExtension type: ${(() => { try { return JSON.parse(files["plugin.json"] || "{}").type || "extension"; } catch { return "extension"; } })()}`;

    setStatus("AI thinking…");
    const result = await window.builder.aiGenerate({ prompt, context: ctx, currentCode });
    aiThinking = false;
    $("ai-send").disabled = false;
    setStatus("Ready");

    if (result.error) {
      appendAiMessage("assistant", `⚠️ ${result.error}`);
    } else {
      appendAiMessage("assistant", result.text);
    }
  }

  function aiKeydown(e) {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      sendAI();
    }
  }

  // ── Editor change tracking ────────────────────────────────────
  editor.addEventListener("input", () => {
    if (activeFile) {
      files[activeFile] = editor.value;
      dirty.add(activeFile);
      renderTabBar();
      renderFileList();
    }
  });

  // Tab key in editor
  editor.addEventListener("keydown", (e) => {
    if (e.key === "Tab") {
      e.preventDefault();
      const start = editor.selectionStart, end = editor.selectionEnd;
      editor.value = editor.value.slice(0, start) + "  " + editor.value.slice(end);
      editor.selectionStart = editor.selectionEnd = start + 2;
    }
  });

  // ── Init ──────────────────────────────────────────────────────
  function init() {
    newProject("extension");
    // Load docs in background
    window.builder.getApiDocs().then(result => {
      $("docs-content").innerHTML = markdownToHtml(result.content || "");
    });
  }

  init();

  // Public API
  return {
    newProject, openFolder, saveAll, exportPackage,
    installToShellfire, addFile, closeTab,
    switchPanel, applyManifest,
    sendAI, aiKeydown,
  };
})();
