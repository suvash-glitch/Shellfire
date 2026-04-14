"use strict";

// ============================================================
// SYSTEM HANDLERS
// Cron, Docker, ports, git, system stats, status bar helpers,
// pipeline execution, file dialogs.
// ============================================================

const fs = require("fs");
const os = require("os");
const path = require("path");
const { ipcMain, app, Notification, shell } = require("electron");
const { execFileSync, spawn } = require("child_process");
const { execFileAsync, sanitizePath, log } = require("./utils");
const { getWindow } = require("./state");

// ── Cron ─────────────────────────────────────────────────────

async function getCrontab() {
  try { return await execFileAsync("crontab", ["-l"]); } catch { return ""; }
}

function setCrontab(content) {
  const tmp = path.join(app.getPath("temp"), "shellfire-crontab.tmp");
  fs.writeFileSync(tmp, content);
  try {
    execFileSync("crontab", [tmp], { timeout: 3000, stdio: ["pipe", "pipe", "pipe"] });
  } finally { try { fs.unlinkSync(tmp); } catch {} }
}

// ── IPC handlers ─────────────────────────────────────────────

function registerHandlers() {
  // ── Cron ────────────────────────────────────────────────────
  ipcMain.handle("cron-list", async () => {
    try {
      const raw = await getCrontab();
      return raw.trim().split("\n").filter(l => l && !l.startsWith("#")).map((line, i) => ({ id: i, line, enabled: true }));
    } catch { return []; }
  });

  ipcMain.handle("cron-add", async (_, cronLine) => {
    try {
      const existing = (await getCrontab()).trim();
      setCrontab(existing ? existing + "\n" + cronLine : cronLine);
      return true;
    } catch { return false; }
  });

  ipcMain.handle("cron-remove", async (_, index) => {
    try {
      const lines = (await getCrontab()).trim().split("\n");
      let activeIdx = 0;
      const newLines = [];
      for (const line of lines) {
        if (!line || line.startsWith("#")) { newLines.push(line); }
        else { if (activeIdx !== index) newLines.push(line); activeIdx++; }
      }
      const newCron = newLines.join("\n");
      if (newCron.trim()) {
        setCrontab(newCron);
      } else {
        try { execFileSync("crontab", ["-r"], { timeout: 3000, stdio: ["pipe", "pipe", "pipe"] }); } catch {}
      }
      return true;
    } catch { return false; }
  });

  // ── Git ──────────────────────────────────────────────────────
  ipcMain.handle("get-git-branch", async (_, dirPath) => {
    if (!dirPath) return null;
    const safe = sanitizePath(dirPath);
    if (!safe) return null;
    try { return await execFileAsync("git", ["-C", safe, "rev-parse", "--abbrev-ref", "HEAD"]); }
    catch { return null; }
  });

  ipcMain.handle("get-git-status", async (_, dirPath) => {
    if (!dirPath) return null;
    const safe = sanitizePath(dirPath);
    if (!safe) return null;
    try { const s = await execFileAsync("git", ["-C", safe, "status", "--porcelain"]); return s ? "dirty" : "clean"; }
    catch { return null; }
  });

  // ── Docker ───────────────────────────────────────────────────
  ipcMain.handle("docker-ps", async () => {
    try {
      const r = execFileSync("docker", ["ps", "--format", "{{.ID}}\t{{.Names}}\t{{.Image}}\t{{.Status}}\t{{.Ports}}"], {
        encoding: "utf8", timeout: 5000, stdio: ["pipe", "pipe", "pipe"]
      }).trim();
      if (!r) return [];
      return r.split("\n").map(l => { const [id, name, image, status, ports] = l.split("\t"); return { id, name, image, status, ports: ports || "" }; });
    } catch { return []; }
  });

  ipcMain.handle("docker-ps-all", async () => {
    try {
      const r = execFileSync("docker", ["ps", "-a", "--format", "{{.ID}}\t{{.Names}}\t{{.Image}}\t{{.Status}}"], {
        encoding: "utf8", timeout: 5000, stdio: ["pipe", "pipe", "pipe"]
      }).trim();
      if (!r) return [];
      return r.split("\n").map(l => { const [id, name, image, status] = l.split("\t"); return { id, name, image, status }; });
    } catch { return []; }
  });

  // ── Ports ────────────────────────────────────────────────────
  ipcMain.handle("list-ports", async () => {
    try {
      const r = execFileSync("lsof", ["-iTCP", "-sTCP:LISTEN", "-nP"], {
        encoding: "utf8", timeout: 5000, stdio: ["pipe", "pipe", "pipe"]
      }).trim();
      if (!r) return [];
      const seen = new Set();
      return r.split("\n").slice(1).filter(Boolean).map(line => {
        const parts = line.trim().split(/\s+/);
        const proc = parts[0] || "", pid = parts[1] || "", protocol = parts[7] || "TCP", nameField = parts[8] || "";
        const portMatch = nameField.match(/:(\d+)$/);
        const port = portMatch ? portMatch[1] : "";
        const key = `${pid}:${port}`;
        if (seen.has(key)) return null;
        seen.add(key);
        return { port, pid, process: proc, protocol };
      }).filter(Boolean);
    } catch { return []; }
  });

  ipcMain.handle("kill-port", async (_, pid) => {
    if (!pid || !/^\d+$/.test(String(pid))) return { error: "Invalid PID" };
    try {
      execFileSync("kill", ["-9", String(pid)], { timeout: 3000, stdio: ["pipe", "pipe", "pipe"] });
      return { ok: true };
    } catch (e) { return { error: e.message }; }
  });

  // ── System stats ─────────────────────────────────────────────
  ipcMain.handle("system-stats", async () => {
    try {
      const cpus = os.cpus();
      const totalIdle = cpus.reduce((a, c) => a + c.times.idle, 0);
      const totalTick = cpus.reduce((a, c) => a + c.times.user + c.times.nice + c.times.sys + c.times.idle + c.times.irq, 0);
      const cpuUsage = Math.round((1 - totalIdle / totalTick) * 100);
      const totalMem = os.totalmem(), freeMem = os.freemem();
      const memUsage = Math.round(((totalMem - freeMem) / totalMem) * 100);
      const memGB = ((totalMem - freeMem) / 1073741824).toFixed(1);
      const totalGB = (totalMem / 1073741824).toFixed(1);
      let diskUsage = null;
      try {
        if (process.platform === "win32") {
          const r = await execFileAsync("powershell", ["-Command", "Get-PSDrive C | Select-Object Used,Free | ConvertTo-Json"]);
          const info = JSON.parse(r);
          diskUsage = { used: (info.Used / 1073741824).toFixed(0) + "G", total: ((info.Used + info.Free) / 1073741824).toFixed(0) + "G", percent: Math.round(info.Used / (info.Used + info.Free) * 100) };
        } else {
          const df = (await execFileAsync("df", ["-h", "/"])).split("\n").pop().split(/\s+/);
          diskUsage = { used: df[2], total: df[1], percent: parseInt(df[4]) };
        }
      } catch {}
      return { cpuUsage, memUsage, memGB, totalGB, diskUsage, uptime: Math.round(os.uptime() / 60) };
    } catch { return null; }
  });

  // ── Status bar helpers ───────────────────────────────────────
  ipcMain.handle("get-k8s-context", async () => {
    try { return execFileSync("kubectl", ["config", "current-context"], { encoding: "utf8", timeout: 3000, stdio: ["pipe", "pipe", "pipe"] }).trim(); }
    catch { return null; }
  });
  ipcMain.handle("get-aws-profile", async () => process.env.AWS_PROFILE || process.env.AWS_DEFAULT_PROFILE || null);
  ipcMain.handle("get-node-version", async () => {
    try { return execFileSync("node", ["--version"], { encoding: "utf8", timeout: 2000, stdio: ["pipe", "pipe", "pipe"] }).trim(); }
    catch { return null; }
  });

  // ── Fuzzy file finder ────────────────────────────────────────
  ipcMain.handle("find-files", async (_, query, dirs) => {
    if (!query || typeof query !== "string" || !Array.isArray(dirs)) return [];
    const safeDirs = dirs.map(d => sanitizePath(d)).filter(Boolean);
    if (!safeDirs.length) return [];
    try {
      const args = [...safeDirs, "-maxdepth", "5", "-type", "f",
        "-not", "-path", "*/node_modules/*", "-not", "-path", "*/.git/*",
        "-not", "-path", "*/dist/*", "-not", "-path", "*/.next/*"];
      const result = await execFileAsync("find", args, { timeout: 5000, maxBuffer: 1024 * 1024 });
      if (!result) return [];
      const q = query.toLowerCase(), home = os.homedir();
      return result.split("\n").slice(0, 5000)
        .filter(f => f.toLowerCase().includes(q))
        .slice(0, 50)
        .map(f => ({ path: f, name: f.split("/").pop(), dir: f.replace(/\/[^/]+$/, "").replace(home, "~") }));
    } catch { return []; }
  });

  // ── Pipeline execution ───────────────────────────────────────
  ipcMain.handle("exec-pipeline-step", async (_, { command, cwd }) => {
    if (typeof command !== "string" || !command.trim()) return { code: 1, stdout: "", stderr: "Invalid command" };
    const resolvedCwd = cwd ? sanitizePath(cwd) : os.homedir();
    if (!resolvedCwd) return { code: 1, stdout: "", stderr: "Invalid working directory" };
    return new Promise((resolve) => {
      const proc = spawn("sh", ["-c", command], { cwd: resolvedCwd });
      let stdout = "", stderr = "";
      proc.stdout.on("data", d => { stdout += d; });
      proc.stderr.on("data", d => { stderr += d; });
      proc.on("close", code => resolve({ code, stdout: stdout.slice(-2000), stderr: stderr.slice(-2000) }));
      proc.on("error", err => resolve({ code: 1, stdout: "", stderr: err.message }));
      setTimeout(() => { proc.kill(); resolve({ code: 1, stdout, stderr: stderr + "\nTimeout after 60s" }); }, 60000);
    });
  });

  // ── File dialogs (export / open) ─────────────────────────────
  ipcMain.handle("export-sh", async (_, content, suggestedName) => {
    const { dialog } = require("electron");
    const win = getWindow();
    const result = await dialog.showSaveDialog(win, {
      defaultPath: path.join(os.homedir(), "Desktop", suggestedName || "pipeline.sh"),
      filters: [{ name: "Shell Script", extensions: ["sh"] }],
    });
    if (!result.canceled && result.filePath) { fs.writeFileSync(result.filePath, content, { mode: 0o755 }); return result.filePath; }
    return null;
  });

  ipcMain.handle("save-output", async (_, content, suggestedName) => {
    const { dialog } = require("electron");
    const win = getWindow();
    const result = await dialog.showSaveDialog(win, {
      defaultPath: path.join(os.homedir(), "Desktop", suggestedName || "terminal-output.txt"),
      filters: [{ name: "Text", extensions: ["txt", "log"] }],
    });
    if (!result.canceled && result.filePath) { fs.writeFileSync(result.filePath, content); return result.filePath; }
    return null;
  });

  ipcMain.handle("pick-sh-file", async () => {
    const { dialog } = require("electron");
    const win = getWindow();
    const result = await dialog.showOpenDialog(win, {
      title: "Import Shell Script",
      filters: [{ name: "Shell Scripts", extensions: ["sh", "bash", "zsh"] }],
      properties: ["openFile"],
    });
    if (result.canceled || !result.filePaths.length) return { canceled: true };
    const fp = result.filePaths[0];
    return { content: fs.readFileSync(fp, "utf-8"), name: path.basename(fp, path.extname(fp)) };
  });

  ipcMain.handle("pick-termext-file", async () => {
    const { dialog } = require("electron");
    const win = getWindow();
    const result = await dialog.showOpenDialog(win, {
      title: "Install Extension Package",
      filters: [{ name: "Shellfire Extension", extensions: ["termext", "zip"] }],
      properties: ["openFile"],
    });
    if (result.canceled || !result.filePaths.length) return { canceled: true };
    return { filePath: result.filePaths[0] };
  });

  // ── Notifications / editor ───────────────────────────────────
  ipcMain.on("show-notification", (_, title, body) => {
    if (Notification.isSupported()) new Notification({ title, body }).show();
  });

  ipcMain.on("open-in-editor", (_, filePath) => {
    const safe = sanitizePath(filePath);
    if (!safe) return;
    try { execFileSync("code", [safe], { timeout: 3000, stdio: ["pipe", "pipe", "pipe"] }); }
    catch { shell.openPath(safe); }
  });
}

module.exports = { registerHandlers };
