"use strict";

// ============================================================
// AI SERVICE
// Handles ai-chat (assistant) and ai-complete (autocomplete).
// Supports Anthropic, OpenAI, Google Gemini, Ollama.
// ============================================================

const { ipcMain, net: electronNet } = require("electron");

const CHAT_SYSTEM = "You are a helpful terminal assistant in Shellfire. Help with commands, errors, and debugging. Be concise. Use code blocks for commands.";

const AUTOCOMPLETE_SYSTEM = `You are a terminal autocomplete engine. Given a partial command with context, predict the FULL command the user wants to run.

OUTPUT FORMAT: Output ONLY the full command — no explanation, no markdown, no backticks, no "$ " prefix.

- Include all arguments, flags, paths, and values.
- Be specific and contextual using the working directory, git state, and recent commands.
- If you cannot suggest anything useful, repeat the input exactly.`;

// Shared fetch wrapper — returns { text } or { error }
async function fetchAI(url, options) {
  try {
    const res = await electronNet.fetch(url, options);
    if (!res.ok) {
      const t = await res.text();
      return { error: `API error (${res.status}): ${t.slice(0, 300)}` };
    }
    return { ok: true, res };
  } catch (e) {
    return { error: e.message };
  }
}

function sanitizeCompletion(raw) {
  let text = (raw || "").trimStart().split("\n")[0].trim();
  text = text.replace(/^```\w*\s*/, "").replace(/```$/, "").trim();
  text = text.replace(/^[`'"]+|[`'"]+$/g, "");
  text = text.replace(/^\$\s+/, "");
  if (/^(I |You |To |This |That |Note|Sorry|Here|If you|The command)/i.test(text)) return "";
  if (text.length > 120) return "";
  return text;
}

// ── Provider implementations ─────────────────────────────────

async function callAnthropic(apiKey, model, messages, system, maxTokens, temperature) {
  const r = await fetchAI("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model: model || "claude-haiku-4-5-20251001", max_tokens: maxTokens, temperature, system, messages }),
  });
  if (r.error) return r;
  const data = await r.res.json();
  return { text: data.content?.[0]?.text || "" };
}

async function callOpenAI(apiKey, model, messages, system, maxTokens, temperature, baseUrl) {
  const url = (baseUrl || "https://api.openai.com/v1") + "/chat/completions";
  const r = await fetchAI(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
    body: JSON.stringify({ model: model || "gpt-4o-mini", max_tokens: maxTokens, temperature, messages: [{ role: "system", content: system }, ...messages] }),
  });
  if (r.error) return r;
  const data = await r.res.json();
  return { text: data.choices?.[0]?.message?.content || "" };
}

async function callGoogle(apiKey, model, messages, system, maxTokens) {
  const m = model || "gemini-2.0-flash";
  const r = await fetchAI(`https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent?key=${apiKey}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: system }] },
      contents: messages.map(msg => ({ role: msg.role === "assistant" ? "model" : "user", parts: [{ text: msg.content }] })),
    }),
  });
  if (r.error) return r;
  const data = await r.res.json();
  return { text: data.candidates?.[0]?.content?.parts?.[0]?.text || "" };
}

async function callOllama(model, messages, system, baseUrl) {
  const url = (baseUrl || "http://localhost:11434") + "/api/chat";
  const r = await fetchAI(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: model || "llama3.2", stream: false, messages: [{ role: "system", content: system }, ...messages] }),
  });
  if (r.error) return r;
  const data = await r.res.json();
  return { text: data.message?.content || "" };
}

async function dispatch(params, system, maxTokens, temperature) {
  const { apiKey, provider, model, messages, prompt, baseUrl } = params;
  const msgs = messages || (prompt ? [{ role: "user", content: prompt }] : []);

  if (!apiKey && provider !== "ollama") return { error: "No API key configured" };

  switch (provider) {
    case "openai":
    case "openai-compatible":
      return callOpenAI(apiKey, model, msgs, system, maxTokens, temperature, baseUrl);
    case "google":
      return callGoogle(apiKey, model, msgs, system, maxTokens);
    case "ollama":
      return callOllama(model, msgs, system, baseUrl);
    default:
      return callAnthropic(apiKey, model, msgs, system, maxTokens, temperature);
  }
}

// ── IPC handlers ─────────────────────────────────────────────

function registerHandlers() {
  ipcMain.handle("ai-chat", async (_, params) => {
    return dispatch(params, CHAT_SYSTEM, 2048, undefined);
  });

  ipcMain.handle("ai-complete", async (_, params) => {
    const result = await dispatch(params, AUTOCOMPLETE_SYSTEM, 200, 0);
    if (result.error) return result;
    return { completion: sanitizeCompletion(result.text) };
  });
}

module.exports = { registerHandlers };
