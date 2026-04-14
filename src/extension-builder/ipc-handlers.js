"use strict";

// ============================================================
// EXTENSION BUILDER — IPC HANDLERS
// ============================================================

const fs = require("fs");
const os = require("os");
const path = require("path");
const { ipcMain, net: electronNet, app } = require("electron");
const { execFileAsync, log } = require("../main/utils");
const { loadPlugins, PLUGINS_DIR } = require("../main/plugin-system");

// ── Read the API docs markdown ───────────────────────────────

const API_DOCS_PATH = path.join(__dirname, "..", "..", "docs", "extension-api.md");

// ── AI system prompt for extension generation ─────────────────

const AI_SYSTEM = `You are an expert Shellfire extension developer. Shellfire is an Electron terminal multiplexer with a plugin API.

The extension API is available as \`api\` inside \`activate(api)\`. Key namespaces:
- api.terminal — read/write terminal output, listen to events
- api.ui.toolbar — add toolbar buttons
- api.ui.panel — add side panels
- api.ui.menu — add context menu items
- api.ui.statusbar — add status bar widgets
- api.commands — register command palette entries
- api.storage — persistent key-value store
- api.ai — call the user's AI provider
- api.events — pub/sub between extensions

Extensions export { activate(api), deactivate() }.
Themes export { colors: { background, foreground, cursor, ... } }.

Always produce complete, working code. Use modern JS (no TypeScript). No external dependencies unless unavoidable. Include JSDoc comments on public functions.`;

async function callAI(settings, userPrompt, context = "") {
  const { aiApiKey: apiKey, aiProvider: provider, aiModel: model } = settings || {};
  if (!apiKey && provider !== "ollama") return { error: "No API key configured. Set one in Settings → AI." };

  const messages = [{ role: "user", content: context ? `${context}\n\n${userPrompt}` : userPrompt }];

  try {
    if (provider === "openai" || provider === "openai-compatible") {
      const baseUrl = settings.aiBaseUrl || "https://api.openai.com/v1";
      const res = await electronNet.fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
        body: JSON.stringify({ model: model || "gpt-4o", max_tokens: 4096, messages: [{ role: "system", content: AI_SYSTEM }, ...messages] }),
      });
      if (!res.ok) return { error: `API error (${res.status}): ${(await res.text()).slice(0, 300)}` };
      const data = await res.json();
      return { text: data.choices?.[0]?.message?.content || "" };
    }

    if (provider === "google") {
      const m = model || "gemini-2.0-flash";
      const res = await electronNet.fetch(`https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent?key=${apiKey}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          system_instruction: { parts: [{ text: AI_SYSTEM }] },
          contents: messages.map(msg => ({ role: "user", parts: [{ text: msg.content }] })),
        }),
      });
      if (!res.ok) return { error: `API error (${res.status}): ${(await res.text()).slice(0, 300)}` };
      const data = await res.json();
      return { text: data.candidates?.[0]?.content?.parts?.[0]?.text || "" };
    }

    if (provider === "ollama") {
      const baseUrl = settings.aiBaseUrl || "http://localhost:11434";
      const res = await electronNet.fetch(`${baseUrl}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: model || "llama3.2", stream: false, messages: [{ role: "system", content: AI_SYSTEM }, ...messages] }),
      });
      if (!res.ok) return { error: `Ollama error (${res.status}): ${(await res.text()).slice(0, 300)}` };
      const data = await res.json();
      return { text: data.message?.content || "" };
    }

    // Default: Anthropic
    const res = await electronNet.fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: model || "claude-sonnet-4-6", max_tokens: 4096, system: AI_SYSTEM, messages }),
    });
    if (!res.ok) return { error: `API error (${res.status}): ${(await res.text()).slice(0, 300)}` };
    const data = await res.json();
    return { text: data.content?.[0]?.text || "" };
  } catch (e) { return { error: e.message }; }
}

// ── Read settings to pass AI config to callAI ────────────────

function getSettings() {
  try {
    const p = path.join(app.getPath("userData"), "settings.json");
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch { return {}; }
}

// ── Register handlers ─────────────────────────────────────────

function registerHandlers() {
  // File I/O
  ipcMain.handle("builder:read-file", (_, filePath) => {
    try { return { content: fs.readFileSync(filePath, "utf8") }; }
    catch (e) { return { error: e.message }; }
  });

  ipcMain.handle("builder:write-file", (_, filePath, content) => {
    // Only allow writes inside home dir or /tmp
    if (typeof filePath !== "string" || filePath.includes("\0")) return { error: "Invalid path" };
    const resolved = path.resolve(filePath);
    const home = os.homedir();
    const tmp = os.tmpdir();
    const inAllowed = [home, tmp, "/tmp"].some(d => resolved === d || resolved.startsWith(d + path.sep));
    if (!inAllowed) {
      return { error: "Access denied: path outside allowed directories" };
    }
    try {
      fs.mkdirSync(path.dirname(resolved), { recursive: true });
      fs.writeFileSync(resolved, content, "utf8");
      return { ok: true };
    } catch (e) { return { error: e.message }; }
  });

  ipcMain.handle("builder:list-dir", (_, dirPath) => {
    try {
      return { files: fs.readdirSync(dirPath, { withFileTypes: true }).map(e => ({ name: e.name, isDir: e.isDirectory() })) };
    } catch (e) { return { error: e.message }; }
  });

  ipcMain.handle("builder:open-folder", async () => {
    const { dialog } = require("electron");
    const result = await dialog.showOpenDialog({ title: "Open Extension Folder", properties: ["openDirectory"] });
    if (result.canceled || !result.filePaths.length) return { canceled: true };
    return { folderPath: result.filePaths[0] };
  });

  ipcMain.handle("builder:save-as", async (_, suggestedName) => {
    const { dialog } = require("electron");
    const result = await dialog.showSaveDialog({
      title: "Save Extension File",
      defaultPath: path.join(os.homedir(), "Desktop", suggestedName || "index.js"),
    });
    if (result.canceled) return { canceled: true };
    return { filePath: result.filePath };
  });

  // Export: bundle files into a .termext zip
  ipcMain.handle("builder:export-termext", async (_, files, pluginName) => {
    const { dialog } = require("electron");
    const result = await dialog.showSaveDialog({
      title: "Export Extension Package",
      defaultPath: path.join(os.homedir(), "Desktop", `${pluginName || "extension"}.termext`),
      filters: [{ name: "Shellfire Extension", extensions: ["termext"] }],
    });
    if (result.canceled) return { canceled: true };

    const tmpDir = path.join(app.getPath("temp"), `builder-export-${Date.now()}`);
    try {
      fs.mkdirSync(tmpDir, { recursive: true });
      for (const [filename, content] of Object.entries(files)) {
        fs.writeFileSync(path.join(tmpDir, filename), content, "utf8");
      }
      await execFileAsync("zip", ["-j", "-r", result.filePath, tmpDir], { timeout: 15000 });
      return { ok: true, filePath: result.filePath };
    } catch (e) {
      return { error: e.message };
    } finally {
      try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
    }
  });

  // Load an existing plugin from the user's plugins directory
  ipcMain.handle("builder:load-existing-plugin", async () => {
    const { dialog } = require("electron");
    const result = await dialog.showOpenDialog({
      title: "Open Existing Extension",
      defaultPath: PLUGINS_DIR,
      properties: ["openDirectory"],
    });
    if (result.canceled || !result.filePaths.length) return { canceled: true };
    const dir = result.filePaths[0];
    try {
      const manifest = JSON.parse(fs.readFileSync(path.join(dir, "plugin.json"), "utf8"));
      const mainCode = fs.readFileSync(path.join(dir, manifest.main || "index.js"), "utf8");
      return { dir, manifest, files: { "plugin.json": JSON.stringify(manifest, null, 2), [manifest.main || "index.js"]: mainCode } };
    } catch (e) { return { error: e.message }; }
  });

  // AI generation
  ipcMain.handle("builder:ai-generate", async (_, { prompt, context, currentCode }) => {
    const settings = getSettings();
    const ctx = [
      currentCode ? `Current extension code:\n\`\`\`js\n${currentCode}\n\`\`\`` : "",
      context || "",
    ].filter(Boolean).join("\n\n");
    return callAI(settings, prompt, ctx);
  });

  // Installed plugins list
  ipcMain.handle("builder:get-installed-plugins", () => loadPlugins());

  // Install the built extension directly into Shellfire
  ipcMain.handle("builder:install-built", async (_, files, pluginName) => {
    if (!pluginName || typeof pluginName !== "string") return { error: "Invalid plugin name" };
    const id = pluginName.replace(/[^a-zA-Z0-9_-]/g, "-").toLowerCase();
    const dest = path.join(PLUGINS_DIR, id);
    try {
      fs.mkdirSync(dest, { recursive: true });
      for (const [filename, content] of Object.entries(files)) {
        fs.writeFileSync(path.join(dest, filename), content, "utf8");
      }
      return { ok: true, id };
    } catch (e) { return { error: e.message }; }
  });

  // Serve API docs markdown
  ipcMain.handle("builder:get-api-docs", () => {
    try { return { content: fs.readFileSync(API_DOCS_PATH, "utf8") }; }
    catch { return { content: "API docs not found." }; }
  });
}

module.exports = { registerHandlers };
