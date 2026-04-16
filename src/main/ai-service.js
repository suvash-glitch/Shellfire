"use strict";

/**
 * @module ai-service
 * @description Handles all AI inference IPC channels for Shellfire.
 *   Supports two modes — interactive chat (`ai-chat`) and inline autocomplete
 *   (`ai-complete`) — across four backend providers: Anthropic, OpenAI (and
 *   OpenAI-compatible endpoints), Google Gemini, and Ollama.
 *
 * Owns:
 *   - `ipcMain.handle("ai-chat")` and `ipcMain.handle("ai-complete")`
 *   - Per-provider HTTP request construction and response parsing
 *   - Autocomplete response sanitisation (strip markdown, prose guards, length cap)
 *   - The shared `electronNet.fetch` wrapper with unified error handling
 *
 * Does NOT own:
 *   - API key storage or user settings (storage.js)
 *   - PTY or terminal output (pty-manager.js)
 *   - Any UI rendering (renderer modules)
 */

const { ipcMain, net: electronNet } = require("electron");

// ─── System prompts ────────────────────────────────────────────────────────────

/** System prompt injected for every interactive chat request. */
const CHAT_SYSTEM =
  "You are a helpful terminal assistant in Shellfire. Help with commands, errors, and debugging. " +
  "Be concise. Use code blocks for commands.";

/** System prompt injected for every autocomplete request. */
const AUTOCOMPLETE_SYSTEM =
  "You are a terminal autocomplete engine. Given a partial command with context, " +
  "predict the FULL command the user wants to run.\n\n" +
  "OUTPUT FORMAT: Output ONLY the full command — no explanation, no markdown, no backticks, no \"$ \" prefix.\n\n" +
  "- Include all arguments, flags, paths, and values.\n" +
  "- Be specific and contextual using the working directory, git state, and recent commands.\n" +
  "- If you cannot suggest anything useful, repeat the input exactly.";

// ─── Provider defaults ─────────────────────────────────────────────────────────

/** Default model used when the caller does not specify one for Anthropic. */
const DEFAULT_MODEL_ANTHROPIC = "claude-haiku-4-5-20251001";

/** Default model used when the caller does not specify one for OpenAI. */
const DEFAULT_MODEL_OPENAI = "gpt-4o-mini";

/** Default model used when the caller does not specify one for Google Gemini. */
const DEFAULT_MODEL_GOOGLE = "gemini-2.0-flash";

/** Default model used when the caller does not specify one for Ollama. */
const DEFAULT_MODEL_OLLAMA = "llama3.2";

/** Default Ollama base URL when the caller does not supply one. */
const DEFAULT_OLLAMA_BASE_URL = "http://localhost:11434";

/** Maximum character length of an accepted autocomplete suggestion. */
const AUTOCOMPLETE_MAX_LENGTH = 120;

/** Max tokens allocated for interactive chat responses. */
const CHAT_MAX_TOKENS = 2048;

/** Max tokens allocated for autocomplete — kept tiny to enforce brevity. */
const AUTOCOMPLETE_MAX_TOKENS = 200;

/** Maximum characters of an API error body shown in the error message. */
const API_ERROR_PREVIEW_CHARS = 300;

/** Temperature used for autocomplete — 0 means fully deterministic output. */
const AUTOCOMPLETE_TEMPERATURE = 0;

/**
 * Regex that detects prose-style openings that indicate the model ignored the
 * autocomplete format instruction.  Completions matching this are discarded.
 */
const PROSE_PREFIX_PATTERN = /^(I |You |To |This |That |Note|Sorry|Here|If you|The command)/i;

// ─── Shared fetch wrapper ──────────────────────────────────────────────────────

/**
 * Sends an HTTP request via Electron's `net.fetch` and normalises errors into
 * a consistent `{ error }` shape so callers never need to `try/catch`.
 *
 * @param {string} url     - Fully-qualified endpoint URL.
 * @param {object} options - Standard `fetch` init options (method, headers, body).
 * @returns {Promise<{ ok: true, res: Response }|{ error: string }>} Result object.
 */
async function fetchAI(url, options) {
  try {
    const res = await electronNet.fetch(url, options);
    if (!res.ok) {
      const text = await res.text();
      return { error: `API error (${res.status}): ${text.slice(0, API_ERROR_PREVIEW_CHARS)}` };
    }
    return { ok: true, res };
  } catch (e) {
    return { error: e.message };
  }
}

// ─── Autocomplete sanitisation ─────────────────────────────────────────────────

/**
 * Strips formatting artefacts from a raw model completion and enforces the
 * one-line, no-prose, no-markdown contract.
 *
 * Rules applied in order:
 *   1. Take only the first non-empty line.
 *   2. Remove surrounding code-fence markers (``` ... ```).
 *   3. Remove surrounding quote characters.
 *   4. Strip a leading shell prompt (`$ `).
 *   5. Reject if the text looks like prose (starts with a sentence opener).
 *   6. Reject if the result exceeds {@link AUTOCOMPLETE_MAX_LENGTH} characters.
 *
 * @param {string} raw - Raw text returned by the model.
 * @returns {string} Sanitised single-line command, or "" if the text is unusable.
 */
function sanitizeCompletion(raw) {
  let text = (raw || "").trimStart().split("\n")[0].trim();
  text = text.replace(/^```\w*\s*/, "").replace(/```$/, "").trim();
  text = text.replace(/^[`'"]+|[`'"]+$/g, "");
  text = text.replace(/^\$\s+/, "");

  if (PROSE_PREFIX_PATTERN.test(text)) return "";
  if (text.length > AUTOCOMPLETE_MAX_LENGTH) return "";

  return text;
}

// ─── Provider implementations ──────────────────────────────────────────────────

/**
 * Calls the Anthropic Messages API.
 *
 * @param {string}             apiKey      - Anthropic API key.
 * @param {string|undefined}   model       - Model ID (falls back to {@link DEFAULT_MODEL_ANTHROPIC}).
 * @param {Array<object>}      messages    - Conversation history (role + content).
 * @param {string}             system      - System prompt text.
 * @param {number}             maxTokens   - Maximum tokens to generate.
 * @param {number|undefined}   temperature - Sampling temperature (omitted from body if undefined).
 * @returns {Promise<{ text: string }|{ error: string }>} Inference result.
 */
async function callAnthropic(apiKey, model, messages, system, maxTokens, temperature) {
  const body = {
    model:      model || DEFAULT_MODEL_ANTHROPIC,
    max_tokens: maxTokens,
    system,
    messages,
  };
  if (temperature !== undefined) body.temperature = temperature;

  const r = await fetchAI("https://api.anthropic.com/v1/messages", {
    method:  "POST",
    headers: {
      "content-type":      "application/json",
      "x-api-key":         apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify(body),
  });
  if (r.error) return r;

  const data = await r.res.json();
  return { text: data.content?.[0]?.text || "" };
}

/**
 * Calls an OpenAI-compatible chat completions endpoint.
 * Works with the official OpenAI API and any compatible third-party host
 * by overriding `baseUrl`.
 *
 * @param {string}           apiKey      - Bearer token for the target API.
 * @param {string|undefined} model       - Model ID (falls back to {@link DEFAULT_MODEL_OPENAI}).
 * @param {Array<object>}    messages    - Conversation history (role + content).
 * @param {string}           system      - System prompt text (prepended as a system message).
 * @param {number}           maxTokens   - Maximum tokens to generate.
 * @param {number|undefined} temperature - Sampling temperature.
 * @param {string|undefined} baseUrl     - API base URL (defaults to OpenAI's production URL).
 * @returns {Promise<{ text: string }|{ error: string }>} Inference result.
 */
async function callOpenAI(apiKey, model, messages, system, maxTokens, temperature, baseUrl) {
  const url = (baseUrl || "https://api.openai.com/v1") + "/chat/completions";

  const r = await fetchAI(url, {
    method:  "POST",
    headers: {
      "Content-Type":  "application/json",
      "Authorization": `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model:      model || DEFAULT_MODEL_OPENAI,
      max_tokens: maxTokens,
      temperature,
      messages:   [{ role: "system", content: system }, ...messages],
    }),
  });
  if (r.error) return r;

  const data = await r.res.json();
  return { text: data.choices?.[0]?.message?.content || "" };
}

/**
 * Calls the Google Gemini generateContent API.
 * The API key is passed as a request header to prevent it from appearing in
 * server access logs (which would capture the query string).
 *
 * @param {string}           apiKey    - Google AI Studio API key.
 * @param {string|undefined} model     - Gemini model ID (falls back to {@link DEFAULT_MODEL_GOOGLE}).
 * @param {Array<object>}    messages  - Conversation history (role + content).
 * @param {string}           system    - System instruction text.
 * @param {number}           maxTokens - Maximum tokens to generate (not forwarded — Gemini ignores it).
 * @returns {Promise<{ text: string }|{ error: string }>} Inference result.
 */
async function callGoogle(apiKey, model, messages, system, maxTokens) {  // eslint-disable-line no-unused-vars
  const resolvedModel = model || DEFAULT_MODEL_GOOGLE;
  const endpoint      = `https://generativelanguage.googleapis.com/v1beta/models/${resolvedModel}:generateContent`;

  const r = await fetchAI(endpoint, {
    method:  "POST",
    headers: {
      "Content-Type":    "application/json",
      "x-goog-api-key":  apiKey,
    },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: system }] },
      contents: messages.map((msg) => ({
        role:  msg.role === "assistant" ? "model" : "user",
        parts: [{ text: msg.content }],
      })),
    }),
  });
  if (r.error) return r;

  const data = await r.res.json();
  return { text: data.candidates?.[0]?.content?.parts?.[0]?.text || "" };
}

/**
 * Calls a locally-running Ollama instance.
 * No API key is required — authentication is handled by Ollama's own ACL.
 *
 * @param {string|undefined} model    - Ollama model tag (falls back to {@link DEFAULT_MODEL_OLLAMA}).
 * @param {Array<object>}    messages - Conversation history (role + content).
 * @param {string}           system   - System prompt text (prepended as a system message).
 * @param {string|undefined} baseUrl  - Ollama base URL (defaults to {@link DEFAULT_OLLAMA_BASE_URL}).
 * @returns {Promise<{ text: string }|{ error: string }>} Inference result.
 */
async function callOllama(model, messages, system, baseUrl) {
  const url = (baseUrl || DEFAULT_OLLAMA_BASE_URL) + "/api/chat";

  const r = await fetchAI(url, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model:    model || DEFAULT_MODEL_OLLAMA,
      stream:   false,
      messages: [{ role: "system", content: system }, ...messages],
    }),
  });
  if (r.error) return r;

  const data = await r.res.json();
  return { text: data.message?.content || "" };
}

// ─── Message validation ────────────────────────────────────────────────────────

/**
 * Validates and normalises the raw `params` object received from the renderer
 * into a clean message array ready for a provider call.
 *
 * Accepts either a `messages` array (multi-turn) or a bare `prompt` string
 * (single-turn shorthand).
 *
 * @param {object} params - Raw IPC params from the renderer.
 * @returns {{ msgs: Array<object> }|{ error: string }} Validated messages, or error.
 */
function buildMessages(params) {
  if (!params || typeof params !== "object") return { error: "Invalid params" };

  const { messages, prompt } = params;

  const msgs =
    Array.isArray(messages) && messages.length > 0
      ? messages
      : typeof prompt === "string" && prompt.trim()
        ? [{ role: "user", content: prompt }]
        : [];

  if (msgs.length === 0) return { error: "No messages provided" };

  for (const m of msgs) {
    if (!m || typeof m.role !== "string" || typeof m.content !== "string") {
      return { error: "Invalid message format" };
    }
  }

  return { msgs };
}

// ─── Provider dispatcher ───────────────────────────────────────────────────────

/**
 * Routes a validated request to the appropriate provider function based on
 * `params.provider`.  Falls back to Anthropic for any unrecognised provider string.
 *
 * @param {object}           params      - Raw IPC params (apiKey, provider, model, baseUrl, …).
 * @param {string}           system      - System prompt to use for this call.
 * @param {number}           maxTokens   - Token budget for the response.
 * @param {number|undefined} temperature - Sampling temperature (undefined = provider default).
 * @returns {Promise<{ text: string }|{ error: string }>} Inference result.
 */
async function dispatch(params, system, maxTokens, temperature) {
  const built = buildMessages(params);
  if (built.error) return built;

  const { msgs } = built;
  const { apiKey, provider, model, baseUrl } = params;

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

// ─── IPC handlers ──────────────────────────────────────────────────────────────

/**
 * Registers the two AI IPC handlers with Electron's `ipcMain`.
 * Must be called once from `main.js` after the app is ready.
 *
 * Channels registered:
 *   - `ai-chat`     → full assistant reply as `{ text }` or `{ error }`.
 *   - `ai-complete` → sanitised single-line completion as `{ completion }` or `{ error }`.
 */
function registerHandlers() {
  ipcMain.handle("ai-chat", async (_, params) => {
    return dispatch(params, CHAT_SYSTEM, CHAT_MAX_TOKENS, undefined);
  });

  ipcMain.handle("ai-complete", async (_, params) => {
    const result = await dispatch(params, AUTOCOMPLETE_SYSTEM, AUTOCOMPLETE_MAX_TOKENS, AUTOCOMPLETE_TEMPERATURE);
    if (result.error) return result;
    return { completion: sanitizeCompletion(result.text) };
  });
}

module.exports = { registerHandlers };
