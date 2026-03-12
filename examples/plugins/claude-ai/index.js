/**
 * Claude AI Extension Plugin for Terminator
 *
 * Extracts all AI/Claude features from the core app into an installable
 * extension. Provides ghost-text autocomplete, AI chat sidebar, error
 * analysis, and context-menu integration — all powered by the Anthropic API.
 *
 * Activated via exports.activate(ctx) where ctx is the rich extension API.
 */

exports.activate = function (ctx) {
  // ─────────────────────────────────────────────────────────────────────────
  // J. Settings Initialization
  // ─────────────────────────────────────────────────────────────────────────
  var aiAutocomplete = ctx.settings.aiAutocomplete || false;
  var aiApiKey = ctx.settings.aiApiKey || "";
  var aiProvider = ctx.settings.aiProvider || "anthropic";

  // ─────────────────────────────────────────────────────────────────────────
  // D. Autocomplete State
  // ─────────────────────────────────────────────────────────────────────────
  var AI_DEBOUNCE_MS = 400;
  var aiTimers = {};

  // ─────────────────────────────────────────────────────────────────────────
  // A. CSS Injection
  // ─────────────────────────────────────────────────────────────────────────
  var css = [
    /* Ghost text overlay */
    ".ai-ghost-overlay {",
    "  position: absolute;",
    "  pointer-events: none;",
    "  color: rgba(150,180,255,0.5);",
    "  font-family: 'SF Mono', Menlo, Monaco, 'Courier New', monospace;",
    "  white-space: pre;",
    "  z-index: 100;",
    "  line-height: normal;",
    "}",

    /* AI Chat Panel */
    "#ai-chat-panel {",
    "  position: fixed;",
    "  top: 0;",
    "  right: 0;",
    "  width: 350px;",
    "  height: 100%;",
    "  background: #1a1a2e;",
    "  border-left: 1px solid #333;",
    "  display: flex;",
    "  flex-direction: column;",
    "  z-index: 1000;",
    "  transform: translateX(100%);",
    "  transition: transform 0.2s ease;",
    "  box-shadow: -4px 0 20px rgba(0,0,0,0.4);",
    "}",
    "#ai-chat-panel.visible {",
    "  transform: translateX(0);",
    "}",

    /* Chat header */
    ".ai-chat-header {",
    "  display: flex;",
    "  align-items: center;",
    "  justify-content: space-between;",
    "  padding: 12px 16px;",
    "  border-bottom: 1px solid #333;",
    "  background: #16162a;",
    "  flex-shrink: 0;",
    "}",
    ".ai-chat-header-title {",
    "  font-weight: 600;",
    "  font-size: 14px;",
    "  color: #eee;",
    "}",
    ".ai-chat-header-actions {",
    "  display: flex;",
    "  gap: 8px;",
    "}",
    ".ai-chat-header-actions button {",
    "  background: none;",
    "  border: none;",
    "  cursor: pointer;",
    "  padding: 4px;",
    "  font-size: 16px;",
    "  line-height: 1;",
    "}",

    /* Messages area */
    ".ai-chat-messages {",
    "  flex: 1;",
    "  overflow-y: auto;",
    "  padding: 16px;",
    "  display: flex;",
    "  flex-direction: column;",
    "  gap: 12px;",
    "}",

    /* Message bubbles */
    ".ai-chat-msg {",
    "  padding: 10px 14px;",
    "  border-radius: 10px;",
    "  font-size: 13px;",
    "  line-height: 1.5;",
    "  max-width: 90%;",
    "  word-wrap: break-word;",
    "}",
    ".ai-chat-msg.user {",
    "  background: #2a2a5a;",
    "  color: #ddd;",
    "  align-self: flex-end;",
    "  border-bottom-right-radius: 4px;",
    "}",
    ".ai-chat-msg.assistant {",
    "  background: #1e3a4a;",
    "  color: #cde;",
    "  align-self: flex-start;",
    "  border-bottom-left-radius: 4px;",
    "}",
    ".ai-chat-msg.error {",
    "  background: #3a1a1a;",
    "  color: #f88;",
    "  align-self: center;",
    "  font-size: 12px;",
    "}",

    /* Welcome message */
    ".ai-chat-welcome {",
    "  text-align: center;",
    "  color: #888;",
    "  font-size: 13px;",
    "  padding: 40px 20px;",
    "  line-height: 1.6;",
    "}",
    ".ai-chat-welcome strong {",
    "  color: #00f0ff;",
    "}",

    /* API key setup form */
    ".ai-chat-api-key-setup {",
    "  padding: 20px;",
    "  text-align: center;",
    "}",
    ".ai-chat-api-key-setup input {",
    "  width: 100%;",
    "  padding: 8px 12px;",
    "  margin: 10px 0;",
    "  border: 1px solid #444;",
    "  border-radius: 6px;",
    "  background: #222;",
    "  color: #eee;",
    "  font-family: monospace;",
    "  font-size: 12px;",
    "}",
    ".ai-chat-api-key-setup button {",
    "  padding: 8px 20px;",
    "  border: none;",
    "  border-radius: 6px;",
    "  background: #00f0ff;",
    "  color: #000;",
    "  font-weight: 600;",
    "  cursor: pointer;",
    "}",

    /* Input area */
    ".ai-chat-input-area {",
    "  padding: 12px;",
    "  border-top: 1px solid #333;",
    "  background: #16162a;",
    "  flex-shrink: 0;",
    "}",
    ".ai-chat-context-row {",
    "  display: flex;",
    "  align-items: center;",
    "  gap: 6px;",
    "  margin-bottom: 8px;",
    "  font-size: 11px;",
    "  color: #888;",
    "}",
    ".ai-chat-context-row input[type=checkbox] {",
    "  accent-color: #00f0ff;",
    "}",
    ".ai-chat-input-row {",
    "  display: flex;",
    "  gap: 8px;",
    "  align-items: flex-end;",
    "}",
    ".ai-chat-input-row textarea {",
    "  flex: 1;",
    "  resize: none;",
    "  height: 36px;",
    "  max-height: 100px;",
    "  padding: 8px 12px;",
    "  border: 1px solid #444;",
    "  border-radius: 8px;",
    "  background: #222;",
    "  color: #eee;",
    "  font-size: 13px;",
    "  font-family: inherit;",
    "  line-height: 1.4;",
    "  outline: none;",
    "}",
    ".ai-chat-input-row textarea:focus {",
    "  border-color: #00f0ff;",
    "}",
    ".ai-chat-input-row button {",
    "  padding: 8px 14px;",
    "  border: none;",
    "  border-radius: 8px;",
    "  background: #00f0ff;",
    "  color: #000;",
    "  font-weight: 600;",
    "  cursor: pointer;",
    "  white-space: nowrap;",
    "  height: 36px;",
    "}",
    ".ai-chat-input-row button:disabled {",
    "  opacity: 0.4;",
    "  cursor: default;",
    "}",

    /* Typing indicator */
    ".ai-typing-indicator {",
    "  display: flex;",
    "  gap: 4px;",
    "  padding: 10px 14px;",
    "  align-self: flex-start;",
    "}",
    ".ai-typing-indicator .dot {",
    "  width: 6px;",
    "  height: 6px;",
    "  border-radius: 50%;",
    "  background: #00f0ff;",
    "  animation: ai-bounce 1.4s infinite ease-in-out both;",
    "}",
    ".ai-typing-indicator .dot:nth-child(1) { animation-delay: -0.32s; }",
    ".ai-typing-indicator .dot:nth-child(2) { animation-delay: -0.16s; }",
    ".ai-typing-indicator .dot:nth-child(3) { animation-delay: 0s; }",
    "@keyframes ai-bounce {",
    "  0%, 80%, 100% { transform: scale(0); opacity: 0.4; }",
    "  40% { transform: scale(1); opacity: 1; }",
    "}",

    /* Code formatting in messages */
    ".ai-chat-msg pre {",
    "  background: #111;",
    "  padding: 8px 10px;",
    "  border-radius: 6px;",
    "  overflow-x: auto;",
    "  font-size: 12px;",
    "  margin: 6px 0;",
    "}",
    ".ai-chat-msg code {",
    "  background: rgba(255,255,255,0.08);",
    "  padding: 1px 5px;",
    "  border-radius: 3px;",
    "  font-size: 12px;",
    "}",

    /* Suggestions dropdown (future use) */
    ".ai-suggestions-dropdown {",
    "  position: absolute;",
    "  background: #1e1e3a;",
    "  border: 1px solid #444;",
    "  border-radius: 8px;",
    "  box-shadow: 0 4px 16px rgba(0,0,0,0.4);",
    "  z-index: 200;",
    "  min-width: 250px;",
    "  max-height: 200px;",
    "  overflow-y: auto;",
    "  padding: 4px 0;",
    "}",
    ".ai-suggestions-dropdown .suggestion-item {",
    "  padding: 8px 14px;",
    "  cursor: pointer;",
    "  font-size: 13px;",
    "  color: #ccc;",
    "}",
    ".ai-suggestions-dropdown .suggestion-item:hover {",
    "  background: rgba(0,240,255,0.1);",
    "  color: #fff;",
    "}"
  ].join("\n");

  var style = document.createElement("style");
  style.textContent = css;
  document.head.appendChild(style);

  // ─────────────────────────────────────────────────────────────────────────
  // B. AI Chat Panel HTML
  // ─────────────────────────────────────────────────────────────────────────
  var chatPanelHTML = [
    '<div class="ai-chat-header">',
    '  <span class="ai-chat-header-title">AI Chat</span>',
    '  <div class="ai-chat-header-actions">',
    '    <button id="ai-chat-clear" title="Clear chat" style="color:#00f0ff">',
    '      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">',
    '        <polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/>',
    '      </svg>',
    '    </button>',
    '    <button id="ai-chat-close" title="Close" style="color:#888">',
    '      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">',
    '        <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>',
    '      </svg>',
    '    </button>',
    '  </div>',
    '</div>',
    '<div class="ai-chat-messages" id="ai-chat-messages">',
    '  <div class="ai-chat-welcome">',
    '    <strong>Claude AI Chat</strong><br/>',
    '    Ask questions about your terminal, debug errors, or get help with commands.<br/><br/>',
    '    <span style="font-size:11px;color:#666">Powered by Anthropic\'s Claude API</span>',
    '  </div>',
    '</div>',
    '<div class="ai-chat-input-area">',
    '  <div class="ai-chat-context-row">',
    '    <input type="checkbox" id="ai-chat-context" checked />',
    '    <label for="ai-chat-context">Include terminal context</label>',
    '  </div>',
    '  <div class="ai-chat-input-row">',
    '    <textarea id="ai-chat-input" placeholder="Ask Claude..." rows="1"></textarea>',
    '    <button id="ai-chat-send">Send</button>',
    '  </div>',
    '</div>'
  ].join("\n");

  // Inject the side panel via ctx API or direct DOM creation
  if (typeof ctx.addSidePanel === "function") {
    ctx.addSidePanel("ai-chat-panel", chatPanelHTML);
  } else {
    var panel = document.createElement("div");
    panel.id = "ai-chat-panel";
    panel.className = "side-panel";
    panel.innerHTML = chatPanelHTML;
    document.body.appendChild(panel);
  }

  // Grab references to chat DOM elements
  var aiChatPanel = document.getElementById("ai-chat-panel");
  var aiChatMessages = document.getElementById("ai-chat-messages");
  var aiChatInput = document.getElementById("ai-chat-input");
  var aiChatSend = document.getElementById("ai-chat-send");
  var aiChatContextCheck = document.getElementById("ai-chat-context");
  var aiChatHistory = [];
  var aiChatBusy = false;

  // ─────────────────────────────────────────────────────────────────────────
  // C. Toolbar Button
  // ─────────────────────────────────────────────────────────────────────────
  ctx.addToolbarButton({
    id: "ai-chat-toggle-btn",
    title: "AI Chat Cmd+Shift+A",
    icon: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#00f0ff" stroke-width="2">' +
          '<path d="M12 2a9 9 0 019 9c0 3.9-2.5 7.2-6 8.5V21a1 1 0 01-1 1h-4a1 1 0 01-1-1v-1.5C5.5 18.2 3 14.9 3 11a9 9 0 019-9z"/>' +
          '<line x1="9" y1="22" x2="15" y2="22"/>' +
          '<path d="M8 14s1.5 2 4 2 4-2 4-2"/>' +
          '</svg>',
    onClick: toggleAIChat
  });

  // Skip Permissions toolbar button
  ctx.addToolbarButton({
    id: "btn-skip-perms",
    title: "Toggle --dangerously-skip-permissions",
    icon: '<svg viewBox="0 0 24 24" style="width:12px;height:12px;stroke:currentColor;fill:none;stroke-width:2"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg> Skip Perms',
    onClick: function () { ctx.toggleSkipPermissions(); },
    style: "color:#ff453a;font-size:11px;"
  });

  // ─────────────────────────────────────────────────────────────────────────
  // E. AI Chat Logic
  // ─────────────────────────────────────────────────────────────────────────

  /** Toggle AI chat panel visibility */
  function toggleAIChat() {
    if (!aiChatPanel) return;
    if (aiChatPanel.classList.contains("visible")) {
      closeAIChat();
    } else {
      openAIChat();
    }
  }

  /** Open the AI chat panel */
  function openAIChat() {
    if (!aiChatPanel) return;
    if (!aiApiKey) {
      showAIApiKeySetup();
    }
    aiChatPanel.classList.add("visible");
    setTimeout(function () {
      if (aiChatInput) aiChatInput.focus();
    }, 100);
  }

  /** Close the AI chat panel */
  function closeAIChat() {
    if (!aiChatPanel) return;
    aiChatPanel.classList.remove("visible");
  }

  /** Show API key setup form when no key is configured */
  function showAIApiKeySetup() {
    if (!aiChatMessages) return;
    var existing = aiChatMessages.querySelector(".ai-chat-api-key-setup");
    if (existing) return;

    var setup = document.createElement("div");
    setup.className = "ai-chat-api-key-setup";
    setup.innerHTML = [
      '<p style="color:#ccc;font-size:13px;margin-bottom:12px">Enter your Anthropic API key to get started:</p>',
      '<input type="password" id="ai-chat-apikey-input" placeholder="sk-ant-..." />',
      '<button id="ai-chat-apikey-save">Save Key</button>',
      '<p style="font-size:10px;color:#666;margin-top:8px">Stored locally in plaintext</p>'
    ].join("");

    aiChatMessages.innerHTML = "";
    aiChatMessages.appendChild(setup);

    var saveBtn = document.getElementById("ai-chat-apikey-save");
    var keyInput = document.getElementById("ai-chat-apikey-input");
    if (saveBtn && keyInput) {
      saveBtn.addEventListener("click", function () {
        var key = keyInput.value.trim();
        if (key) {
          aiApiKey = key;
          ctx.settings.aiApiKey = key;
          ctx.saveSettings();
          aiChatMessages.innerHTML = "";
          showAIChatWelcome();
          aiChatInput.focus();
        }
      });
    }
  }

  /** Show the default welcome message in the chat area */
  function showAIChatWelcome() {
    if (!aiChatMessages) return;
    aiChatMessages.innerHTML = [
      '<div class="ai-chat-welcome">',
      '  <strong>Claude AI Chat</strong><br/>',
      '  Ask questions about your terminal, debug errors, or get help with commands.<br/><br/>',
      '  <span style="font-size:11px;color:#666">Powered by Anthropic\'s Claude API</span>',
      '</div>'
    ].join("");
  }

  /**
   * Extract the last N lines from a terminal pane's buffer.
   * @param {string} paneId
   * @param {number} lineCount
   * @returns {string}
   */
  function getTerminalContext(paneId, lineCount) {
    var pane = ctx.getPane(paneId);
    if (!pane || !pane.term) return "";
    var term = pane.term;
    var buf = term.buffer && term.buffer.active ? term.buffer.active : null;
    if (!buf) return "";
    var lines = [];
    var start = Math.max(0, buf.baseY + buf.cursorY - lineCount);
    var end = buf.baseY + buf.cursorY;
    for (var i = start; i <= end; i++) {
      var line = buf.getLine(i);
      if (line) {
        lines.push(line.translateToString(true));
      }
    }
    return lines.join("\n");
  }

  /**
   * Format a text string with basic markdown-to-HTML conversion.
   * Supports code blocks, inline code, and bold text.
   * @param {string} text
   * @returns {string}
   */
  function formatAIMessage(text) {
    // Escape HTML
    var escaped = text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");

    // Code blocks: ```...```
    escaped = escaped.replace(/```(\w*)\n?([\s\S]*?)```/g, function (_, lang, code) {
      return '<pre><code>' + code.trim() + '</code></pre>';
    });

    // Inline code: `...`
    escaped = escaped.replace(/`([^`]+)`/g, '<code>$1</code>');

    // Bold: **...**
    escaped = escaped.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');

    // Newlines to <br> outside of <pre> blocks
    escaped = escaped.replace(/\n/g, "<br/>");

    return escaped;
  }

  /**
   * Append a message to the chat UI.
   * @param {"user"|"assistant"|"error"} role
   * @param {string} content
   */
  function appendAIChatMessage(role, content) {
    if (!aiChatMessages) return;
    // Remove welcome message and API key setup if present
    var welcome = aiChatMessages.querySelector(".ai-chat-welcome");
    if (welcome) welcome.remove();
    var apiSetup = aiChatMessages.querySelector(".ai-chat-api-key-setup");
    if (apiSetup) apiSetup.remove();

    var msg = document.createElement("div");
    msg.className = "ai-chat-msg " + role;
    msg.innerHTML = role === "user" ? content.replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\n/g, "<br/>") : formatAIMessage(content);
    aiChatMessages.appendChild(msg);
    aiChatMessages.scrollTop = aiChatMessages.scrollHeight;
  }

  /** Show a 3-dot typing indicator */
  function showAITypingIndicator() {
    if (!aiChatMessages) return;
    var typing = document.createElement("div");
    typing.className = "ai-typing-indicator";
    typing.innerHTML = '<div class="dot"></div><div class="dot"></div><div class="dot"></div>';
    aiChatMessages.appendChild(typing);
    aiChatMessages.scrollTop = aiChatMessages.scrollHeight;
  }

  /** Remove the typing indicator */
  function removeAITypingIndicator() {
    if (!aiChatMessages) return;
    var indicator = aiChatMessages.querySelector(".ai-typing-indicator");
    if (indicator) indicator.remove();
  }

  /**
   * Send the current chat message to Claude via the IPC bridge.
   * Optionally includes terminal context if the checkbox is checked.
   */
  function sendAIChatMessage() {
    if (aiChatBusy) return;
    if (!aiChatInput) return;
    var text = aiChatInput.value.trim();
    if (!text) return;

    if (!aiApiKey) {
      showAIApiKeySetup();
      return;
    }

    aiChatInput.value = "";
    aiChatInput.style.height = "36px";

    var userContent = text;
    if (aiChatContextCheck && aiChatContextCheck.checked && ctx.activeId) {
      var context = getTerminalContext(ctx.activeId, 30);
      if (context) {
        userContent = "Terminal context:\n```\n" + context + "\n```\n\n" + text;
      }
    }

    appendAIChatMessage("user", text);
    aiChatHistory.push({ role: "user", content: userContent });

    aiChatBusy = true;
    if (aiChatSend) aiChatSend.disabled = true;
    showAITypingIndicator();

    ctx.ipc.aiChat({
      messages: aiChatHistory,
      apiKey: aiApiKey,
      provider: aiProvider
    }).then(function (result) {
      removeAITypingIndicator();
      if (result && result.text) {
        appendAIChatMessage("assistant", result.text);
        aiChatHistory.push({ role: "assistant", content: result.text });
      } else {
        appendAIChatMessage("error", "No response from Claude.");
      }
    }).catch(function (err) {
      removeAITypingIndicator();
      appendAIChatMessage("error", "Error: " + (err.message || String(err)));
    }).finally(function () {
      aiChatBusy = false;
      if (aiChatSend) aiChatSend.disabled = false;
      if (aiChatInput) aiChatInput.focus();
    });
  }

  /**
   * Open AI chat pre-filled with a question about the given pane's output.
   * @param {string} paneId
   */
  function askAIAboutPane(paneId) {
    openAIChat();
    var context = getTerminalContext(paneId, 30);
    var question = "What's happening in this terminal output? Are there any errors?";
    var userContent = context
      ? "Terminal context:\n```\n" + context + "\n```\n\n" + question
      : question;

    appendAIChatMessage("user", question);
    aiChatHistory.push({ role: "user", content: userContent });

    aiChatBusy = true;
    if (aiChatSend) aiChatSend.disabled = true;
    showAITypingIndicator();

    ctx.ipc.aiChat({
      messages: aiChatHistory,
      apiKey: aiApiKey,
      provider: aiProvider
    }).then(function (result) {
      removeAITypingIndicator();
      if (result && result.text) {
        appendAIChatMessage("assistant", result.text);
        aiChatHistory.push({ role: "assistant", content: result.text });
      } else {
        appendAIChatMessage("error", "No response from Claude.");
      }
    }).catch(function (err) {
      removeAITypingIndicator();
      appendAIChatMessage("error", "Error: " + (err.message || String(err)));
    }).finally(function () {
      aiChatBusy = false;
      if (aiChatSend) aiChatSend.disabled = false;
      if (aiChatInput) aiChatInput.focus();
    });
  }

  // ── Chat event listeners ──────────────────────────────────────────────

  if (aiChatSend) {
    aiChatSend.addEventListener("click", sendAIChatMessage);
  }

  if (aiChatInput) {
    // Enter to send (Shift+Enter for newline)
    aiChatInput.addEventListener("keydown", function (e) {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        sendAIChatMessage();
      }
      if (e.key === "Escape") {
        closeAIChat();
      }
    });

    // Auto-expand textarea
    aiChatInput.addEventListener("input", function () {
      aiChatInput.style.height = "36px";
      aiChatInput.style.height = Math.min(aiChatInput.scrollHeight, 100) + "px";
    });
  }

  // Close button
  var closeBtn = document.getElementById("ai-chat-close");
  if (closeBtn) {
    closeBtn.addEventListener("click", closeAIChat);
  }

  // Clear chat button
  var clearBtn = document.getElementById("ai-chat-clear");
  if (clearBtn) {
    clearBtn.addEventListener("click", function () {
      aiChatHistory = [];
      if (aiChatMessages) aiChatMessages.innerHTML = "";
      showAIChatWelcome();
      if (aiChatInput) aiChatInput.focus();
    });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // D. AI Autocomplete Logic
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Track per-pane input into a line buffer for autocomplete.
   * Resets on Enter, Ctrl+C, Ctrl+D. Handles backspace.
   * Ignores raw control sequences.
   * @param {string} id - pane id
   * @param {string} data - input string
   */
  function aiTrackInput(id, data) {
    var pane = ctx.getPane(id);
    if (!pane) return;
    if (typeof pane._aiLineBuf === "undefined") {
      pane._aiLineBuf = "";
    }

    for (var i = 0; i < data.length; i++) {
      var ch = data[i];
      var code = data.charCodeAt(i);

      // Enter / Ctrl+C / Ctrl+D → reset buffer
      if (ch === "\r" || ch === "\n" || code === 3 || code === 4) {
        pane._aiLineBuf = "";
        continue;
      }

      // Backspace / DEL
      if (code === 127 || code === 8) {
        pane._aiLineBuf = pane._aiLineBuf.slice(0, -1);
        continue;
      }

      // Skip escape sequences (starting with \x1b)
      if (code === 27) {
        // Skip until we pass the whole sequence (simple heuristic)
        if (i + 1 < data.length && data[i + 1] === "[") {
          i += 2; // skip ESC and [
          while (i < data.length && !/[A-Za-z~]/.test(data[i])) {
            i++;
          }
          // i now points at the final letter; the for-loop will advance past it
        }
        continue;
      }

      // Skip other control chars
      if (code < 32) continue;

      pane._aiLineBuf += ch;
    }
  }

  /**
   * Dismiss the ghost text overlay for a pane and cancel any in-flight request.
   * @param {string} id - pane id
   */
  function aiDismissGhost(id) {
    var pane = ctx.getPane(id);
    if (!pane) return;

    // Cancel pending completion request
    if (pane._aiAbort) {
      try { pane._aiAbort.abort(); } catch (e) { /* ignore */ }
      pane._aiAbort = null;
    }

    // Remove ghost overlay
    if (pane._aiGhost && pane._aiGhost.parentNode) {
      pane._aiGhost.parentNode.removeChild(pane._aiGhost);
    }
    pane._aiGhost = null;
    pane._aiGhostText = null;
  }

  /**
   * Schedule a debounced autocomplete request for a pane.
   * Requires at least 3 characters in the line buffer.
   * Skips if a process other than a shell appears to be running.
   * @param {string} id - pane id
   */
  function aiScheduleCompletion(id) {
    if (!aiAutocomplete || !aiApiKey) return;

    // Clear any existing timer
    if (aiTimers[id]) {
      clearTimeout(aiTimers[id]);
      aiTimers[id] = null;
    }

    var pane = ctx.getPane(id);
    if (!pane) return;
    var buf = (pane._aiLineBuf || "").trim();
    if (buf.length < 3) return;

    // Skip if a non-shell process is running (heuristic: check pane title or process)
    if (pane.process) {
      var proc = pane.process.toLowerCase();
      if (!/^(zsh|bash|fish|sh|powershell|pwsh|cmd)$/.test(proc)) {
        return;
      }
    }

    aiTimers[id] = setTimeout(function () {
      aiTimers[id] = null;
      aiRequestCompletion(id);
    }, AI_DEBOUNCE_MS);
  }

  /**
   * Build a rich prompt and request a completion from the AI backend.
   * Shows the result as ghost text if successful.
   * @param {string} id - pane id
   */
  function aiRequestCompletion(id) {
    var pane = ctx.getPane(id);
    if (!pane || !pane.term) return;

    var currentInput = (pane._aiLineBuf || "").trim();
    if (currentInput.length < 3) return;

    // Cancel any previous in-flight request
    if (pane._aiAbort) {
      try { pane._aiAbort.abort(); } catch (e) { /* ignore */ }
    }

    // Build context: cwd, git branch, recent terminal output
    var termContext = getTerminalContext(id, 15);
    var cwd = pane.cwd || "";
    var gitBranch = pane.gitBranch || "";

    var promptParts = ["Complete this terminal command. Reply with ONLY the completion (the rest of the command, not the full command)."];
    if (cwd) promptParts.push("CWD: " + cwd);
    if (gitBranch) promptParts.push("Git branch: " + gitBranch);
    if (termContext) promptParts.push("Recent terminal output:\n" + termContext);
    promptParts.push("Current input: " + currentInput);

    var prompt = promptParts.join("\n");

    // Create an AbortController so we can cancel if the user keeps typing
    var controller = new AbortController();
    pane._aiAbort = controller;

    ctx.ipc.aiComplete({
      prompt: prompt,
      apiKey: aiApiKey,
      provider: aiProvider,
      signal: controller.signal
    }).then(function (result) {
      pane._aiAbort = null;

      // Verify pane still has the same input (user may have typed more)
      if ((pane._aiLineBuf || "").trim() !== currentInput) return;

      if (result && result.text) {
        var completion = result.text;
        // Strip any wrapping backticks, prose preamble, or the user's own input echo
        completion = completion.replace(/^```[\s\S]*?\n?/, "").replace(/```$/, "");
        completion = completion.replace(/^(Here'?s?|The|This|Your)\s+[\s\S]*?:\s*/i, "");
        completion = completion.trim();

        // If the completion starts with the current input, strip it
        if (completion.toLowerCase().indexOf(currentInput.toLowerCase()) === 0) {
          completion = completion.slice(currentInput.length);
        }

        if (completion) {
          aiShowGhost(id, completion);
        }
      }
    }).catch(function (err) {
      pane._aiAbort = null;
      // Silently ignore — autocomplete errors should not disturb the user
    });
  }

  /**
   * Render ghost text positioned over the terminal cursor.
   * Uses xterm internal rendering dimensions to calculate placement.
   * @param {string} id - pane id
   * @param {string} text - the suggested completion text
   */
  function aiShowGhost(id, text) {
    var pane = ctx.getPane(id);
    if (!pane || !pane.term) return;

    // Dismiss any existing ghost first
    aiDismissGhost(id);

    var term = pane.term;
    var dims = null;

    // Access xterm internal rendering dimensions
    try {
      dims = term._core._renderService.dimensions;
    } catch (e) {
      return; // Cannot position ghost without dimensions
    }

    if (!dims || !dims.css || !dims.css.cell) return;

    var cellWidth = dims.css.cell.width;
    var cellHeight = dims.css.cell.height;
    var cursorCol = term.buffer.active.cursorX;
    var cursorRow = term.buffer.active.cursorY;

    // Find the xterm container within the pane element
    var xtermContainer = pane.el ? pane.el.querySelector(".xterm-screen") : null;
    if (!xtermContainer) return;

    // Calculate offset relative to the xterm container
    var containerRect = xtermContainer.getBoundingClientRect();
    var left = cursorCol * cellWidth;
    var top = cursorRow * cellHeight;

    // Create the ghost overlay element
    var ghost = document.createElement("div");
    ghost.className = "ai-ghost-overlay";
    ghost.textContent = text;
    ghost.style.left = left + "px";
    ghost.style.top = top + "px";
    ghost.style.fontSize = (ctx.fontSize || 13) + "px";
    ghost.style.lineHeight = cellHeight + "px";

    xtermContainer.style.position = "relative";
    xtermContainer.appendChild(ghost);

    pane._aiGhost = ghost;
    pane._aiGhostText = text;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Terminal Input Handler (autocomplete interception)
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Intercept terminal input for ghost text acceptance and tracking.
   * Returns true to consume the input (Tab acceptance).
   */
  function onTerminalInput(id, data) {
    var pane = ctx.getPane(id);

    // Tab key: accept ghost text if visible
    if (data === "\t" && pane && pane._aiGhostText) {
      var ghostText = pane._aiGhostText;
      aiDismissGhost(id);

      // Send the ghost text as input
      if (ctx.broadcastMode) {
        ctx.broadcast(ctx.allPaneIds, ghostText);
      } else {
        ctx.sendInput(id, ghostText);
      }

      // Update the line buffer with the accepted text
      pane._aiLineBuf = (pane._aiLineBuf || "") + ghostText;

      return true; // Consume the Tab
    }

    // Any other input dismisses ghost text
    if (pane && pane._aiGhostText) {
      aiDismissGhost(id);
    }

    // Track the input for autocomplete
    aiTrackInput(id, data);

    // Schedule a new completion
    aiScheduleCompletion(id);

    return false; // Do not consume the input
  }

  ctx.on("terminalInput", onTerminalInput);

  // ─────────────────────────────────────────────────────────────────────────
  // H. Context Menu Hook
  // ─────────────────────────────────────────────────────────────────────────
  ctx.on("contextMenu", function (paneId) {
    return [
      {
        label: "Ask AI about this",
        action: function () { askAIAboutPane(paneId); }
      }
    ];
  });

  // ─────────────────────────────────────────────────────────────────────────
  // I. Error Detection Hook
  // ─────────────────────────────────────────────────────────────────────────
  ctx.on("errorDetected", function (paneId, snippet) {
    openAIChat();

    var question = "I got this error in my terminal:\n```\n" + snippet + "\n```\nWhat does it mean and how do I fix it?";
    appendAIChatMessage("user", question);
    aiChatHistory.push({ role: "user", content: question });

    aiChatBusy = true;
    if (aiChatSend) aiChatSend.disabled = true;
    showAITypingIndicator();

    ctx.ipc.aiChat({
      messages: aiChatHistory,
      apiKey: aiApiKey,
      provider: aiProvider
    }).then(function (result) {
      removeAITypingIndicator();
      if (result && result.text) {
        appendAIChatMessage("assistant", result.text);
        aiChatHistory.push({ role: "assistant", content: result.text });
      } else {
        appendAIChatMessage("error", "No response from Claude.");
      }
    }).catch(function (err) {
      removeAITypingIndicator();
      appendAIChatMessage("error", "Error: " + (err.message || String(err)));
    }).finally(function () {
      aiChatBusy = false;
      if (aiChatSend) aiChatSend.disabled = false;
      if (aiChatInput) aiChatInput.focus();
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // F. Settings Section
  // ─────────────────────────────────────────────────────────────────────────
  var settingsHTML = [
    '<div class="settings-section">',
    '  <div class="settings-section-title">AI Autocomplete</div>',
    '  <div class="settings-row">',
    '    <label>Enable AI suggestions</label>',
    '    <input type="checkbox" id="setting-ai-autocomplete" />',
    '  </div>',
    '  <div class="settings-row">',
    '    <label>API Key</label>',
    '    <input type="password" id="setting-ai-api-key" class="settings-input-wide" placeholder="sk-ant-..." />',
    '    <span style="font-size:10px;color:#888;margin-left:4px">Stored locally in plaintext</span>',
    '  </div>',
    '  <div class="settings-row">',
    '    <label>Provider</label>',
    '    <select id="setting-ai-provider" class="settings-select">',
    '      <option value="anthropic">Anthropic (Claude)</option>',
    '    </select>',
    '  </div>',
    '  <div class="settings-row" style="opacity:0.6">',
    '    <label style="font-size:11px">Ghost text appears as you type. Press Tab to accept.</label>',
    '  </div>',
    '  <div class="settings-row" style="opacity:0.6">',
    '    <label style="font-size:10px;color:#f5a623">When AI is enabled, commands and terminal context are sent to Anthropic\'s API.</label>',
    '  </div>',
    '</div>'
  ].join("\n");

  ctx.addSettingsSection(settingsHTML);

  // Populate settings values and bind change handlers.
  // Use a short delay to ensure the DOM is ready after injection.
  setTimeout(function () {
    var checkEl = document.getElementById("setting-ai-autocomplete");
    var keyEl = document.getElementById("setting-ai-api-key");
    var providerEl = document.getElementById("setting-ai-provider");

    if (checkEl) {
      checkEl.checked = aiAutocomplete;
      checkEl.addEventListener("change", function () {
        aiAutocomplete = checkEl.checked;
        ctx.settings.aiAutocomplete = aiAutocomplete;
        ctx.saveSettings();
      });
    }

    if (keyEl) {
      keyEl.value = aiApiKey;
      keyEl.addEventListener("change", function () {
        aiApiKey = keyEl.value.trim();
        ctx.settings.aiApiKey = aiApiKey;
        ctx.saveSettings();
      });
    }

    if (providerEl) {
      providerEl.value = aiProvider;
      providerEl.addEventListener("change", function () {
        aiProvider = providerEl.value;
        ctx.settings.aiProvider = aiProvider;
        ctx.saveSettings();
      });
    }
  }, 50);

  // ─────────────────────────────────────────────────────────────────────────
  // G. Command Palette + K. Keyboard Shortcut
  // ─────────────────────────────────────────────────────────────────────────
  ctx.registerCommand({
    label: "AI Chat",
    shortcut: "Cmd+Shift+A",
    action: toggleAIChat,
    category: "Tools"
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Done — log activation
  // ─────────────────────────────────────────────────────────────────────────
  ctx.showToast("Claude AI plugin activated");
};
