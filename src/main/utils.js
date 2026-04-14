"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFile } = require("child_process");

// ============================================================
// LOGGING
// ============================================================

function log(level, msg, ...args) {
  const ts = new Date().toISOString();
  const line = `[${ts}] [${level}] ${msg}`;
  const method = level === "error" ? "error" : "log";
  if (args.length) console[method](line, ...args);
  else console[method](line);
}

// ============================================================
// ASYNC EXEC HELPER
// ============================================================

function execFileAsync(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { encoding: "utf8", timeout: 2000, ...opts }, (err, stdout) => {
      if (err) reject(err);
      else resolve(stdout.trim());
    });
  });
}

// ============================================================
// INPUT VALIDATION
// ============================================================

function sanitizePath(p) {
  if (typeof p !== "string") return null;
  if (p.includes("\0")) return null;
  const home = os.homedir();
  let expanded = p;
  if (expanded === "~") expanded = home;
  else if (expanded.startsWith("~/")) expanded = path.join(home, expanded.slice(2));
  const resolved = path.resolve(expanded);
  const tmp = os.tmpdir();
  if (!resolved.startsWith(home) && !resolved.startsWith(tmp) && !resolved.startsWith("/tmp")) return null;
  try { if (!fs.statSync(resolved).isDirectory()) return null; } catch { return null; }
  return resolved;
}

function isValidHost(h) {
  return typeof h === "string" && h.length > 0 && h.length <= 255 && /^[a-zA-Z0-9._-]+$/.test(h);
}

function isValidUser(u) {
  return typeof u === "string" && u.length > 0 && u.length <= 64 && /^[a-zA-Z0-9._-]+$/.test(u);
}

function isValidPort(p) {
  const n = Number(p);
  return Number.isInteger(n) && n >= 1 && n <= 65535;
}

// ============================================================
// ATOMIC JSON STORAGE
// ============================================================

/**
 * Like sanitizePath but for files (not directories).
 * Validates path is within home or /tmp, and that null bytes/traversal
 * are absent. Does NOT check isDirectory — callers handle that themselves.
 */
function sanitizeFilePath(p) {
  if (typeof p !== "string") return null;
  if (p.includes("\0")) return null;
  const home = os.homedir();
  let expanded = p;
  if (expanded === "~") expanded = home;
  else if (expanded.startsWith("~/")) expanded = path.join(home, expanded.slice(2));
  const resolved = path.resolve(expanded);
  const tmp = os.tmpdir();
  if (!resolved.startsWith(home) && !resolved.startsWith(tmp) && !resolved.startsWith("/tmp")) return null;
  return resolved;
}

function readJSON(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (err) {
    if (err.code !== "ENOENT") log("error", `Failed to read ${path.basename(filePath)}:`, err.message);
    return fallback;
  }
}

function writeJSON(filePath, data) {
  const tmp = filePath + ".tmp";
  try {
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
    fs.renameSync(tmp, filePath);
  } catch (err) {
    log("error", `Failed to write ${path.basename(filePath)}:`, err.message);
    try { fs.unlinkSync(tmp); } catch {}
  }
}

module.exports = { log, execFileAsync, sanitizePath, sanitizeFilePath, isValidHost, isValidUser, isValidPort, readJSON, writeJSON };
