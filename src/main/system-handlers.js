"use strict";

// ============================================================
// SYSTEM HANDLERS
// Cron, Docker, ports, git, system stats, status bar helpers,
// pipeline execution, file dialogs.
//
// All external process calls use execFileAsync to avoid blocking
// the main process event loop.
// ============================================================

const fs = require("fs");
const os = require("os");
const path = require("path");
const { ipcMain, app, Notification, shell } = require("electron");
const { spawn } = require("child_process");
const { execFileAsync, sanitizePath, log } = require("./utils");
const { getWindow } = require("./state");

// ── Cron ─────────────────────────────────────────────────────

async function getCrontab() {
  try { return await execFileAsync("crontab", ["-l"]); } catch { return ""; }
}

async function setCrontab(content) {
  const tmp = path.join(app.getPath("temp"), "shellfire-crontab.tmp");
  fs.writeFileSync(tmp, content);
  try {
    await execFileAsync("crontab", [tmp], { timeout: 5000 });
  } finally {
    try { fs.unlinkSync(tmp); } catch {}
  }
}

// ── IPC handlers ─────────────────────────────────────────────

function registerHandlers() {
  // ── Cron ────────────────────────────────────────────────────
  ipcMain.handle("cron-list", async () => {
    try {
      const raw = await getCrontab();
      return raw.trim().split("\n")
        .filter(l => l && !l.startsWith("#"))
        .map((line, i) => ({ id: i, line, enabled: true }));
    } catch { return []; }
  });

  ipcMain.handle("cron-add", async (_, cronLine) => {
    if (typeof cronLine !== "string" || !cronLine.trim() ||
        cronLine.includes("\n") || cronLine.includes("\0")) {
      return false;
    }
    try {
      const existing = (await getCrontab()).trim();
      await setCrontab(existing ? existing + "\n" + cronLine.trim() : cronLine.trim());
      return true;
    } catch { return false; }
  });

  ipcMain.handle("cron-remove", async (_, index) => {
    if (typeof index !== "number" || !Number.isInteger(index) || index < 0) return false;
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
        await setCrontab(newCron);
      } else {
        try { await execFileAsync("crontab", ["-r"], { timeout: 3000 }); } catch {}
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
    try {
      const s = await execFileAsync("git", ["-C", safe, "status", "--porcelain"]);
      return s ? "dirty" : "clean";
    } catch { return null; }
  });

  // ── Docker ───────────────────────────────────────────────────
  ipcMain.handle("docker-ps", async () => {
    try {
      const r = (await execFileAsync("docker",
        ["ps", "--format", "{{.ID}}\t{{.Names}}\t{{.Image}}\t{{.Status}}\t{{.Ports}}"],
        { timeout: 5000 })).trim();
      if (!r) return [];
      return r.split("\n").map(l => {
        const [id, name, image, status, ports] = l.split("\t");
        return { id, name, image, status, ports: ports || "" };
      });
    } catch { return []; }
  });

  ipcMain.handle("docker-ps-all", async () => {
    try {
      const r = (await execFileAsync("docker",
        ["ps", "-a", "--format", "{{.ID}}\t{{.Names}}\t{{.Image}}\t{{.Status}}"],
        { timeout: 5000 })).trim();
      if (!r) return [];
      return r.split("\n").map(l => {
        const [id, name, image, status] = l.split("\t");
        return { id, name, image, status };
      });
    } catch { return []; }
  });

  // ── Ports ────────────────────────────────────────────────────
  ipcMain.handle("list-ports", async () => {
    try {
      const r = (await execFileAsync("lsof", ["-iTCP", "-sTCP:LISTEN", "-nP"],
        { timeout: 5000 })).trim();
      if (!r) return [];
      const seen = new Set();
      return r.split("\n").slice(1).filter(Boolean).map(line => {
        const parts = line.trim().split(/\s+/);
        const proc = parts[0] || "";
        const pid = parts[1] || "";
        const protocol = parts[7] || "TCP";
        const nameField = parts[8] || "";
        const portMatch = nameField.match(/:(\d+)$/);
        const port = portMatch ? portMatch[1] : "";
        const key = `${pid}:${port}`;
        if (seen.has(key) || !port) return null;
        seen.add(key);
        return { port, pid, process: proc, protocol };
      }).filter(Boolean);
    } catch { return []; }
  });

  ipcMain.handle("kill-port", async (_, pid) => {
    const pidStr = String(pid ?? "");
    if (!pidStr || !/^\d+$/.test(pidStr)) return { error: "Invalid PID" };
    try {
      await execFileAsync("kill", ["-9", pidStr], { timeout: 3000 });
      return { ok: true };
    } catch (e) { return { error: e.message }; }
  });

  // ── System stats ─────────────────────────────────────────────
  ipcMain.handle("system-stats", async () => {
    try {
      const cpus = os.cpus();
      const totalIdle = cpus.reduce((a, c) => a + c.times.idle, 0);
      const totalTick = cpus.reduce((a, c) =>
        a + c.times.user + c.times.nice + c.times.sys + c.times.idle + c.times.irq, 0);
      const cpuUsage = totalTick > 0 ? Math.round((1 - totalIdle / totalTick) * 100) : 0;
      const totalMem = os.totalmem(), freeMem = os.freemem();
      const memUsage = Math.round(((totalMem - freeMem) / totalMem) * 100);
      const memGB = ((totalMem - freeMem) / 1073741824).toFixed(1);
      const totalGB = (totalMem / 1073741824).toFixed(1);
      let diskUsage = null;
      try {
        if (process.platform === "win32") {
          const r = await execFileAsync("powershell",
            ["-Command", "Get-PSDrive C | Select-Object Used,Free | ConvertTo-Json"]);
          const info = JSON.parse(r);
          const used = info.Used || 0, free = info.Free || 1;
          diskUsage = {
            used: (used / 1073741824).toFixed(0) + "G",
            total: ((used + free) / 1073741824).toFixed(0) + "G",
            percent: Math.round(used / (used + free) * 100),
          };
        } else {
          const dfOut = await execFileAsync("df", ["-h", "/"]);
          const df = dfOut.trim().split("\n").pop().split(/\s+/);
          diskUsage = {
            used: df[2] || "?",
            total: df[1] || "?",
            percent: parseInt(df[4]) || 0,
          };
        }
      } catch {}
      return { cpuUsage, memUsage, memGB, totalGB, diskUsage, uptime: Math.round(os.uptime() / 60) };
    } catch { return null; }
  });

  // ── Status bar helpers ───────────────────────────────────────
  ipcMain.handle("get-k8s-context", async () => {
    try {
      return await execFileAsync("kubectl", ["config", "current-context"], { timeout: 3000 });
    } catch { return null; }
  });

  ipcMain.handle("get-aws-profile", async () =>
    process.env.AWS_PROFILE || process.env.AWS_DEFAULT_PROFILE || null);

  ipcMain.handle("get-node-version", async () => {
    try {
      return await execFileAsync("node", ["--version"], { timeout: 2000 });
    } catch { return null; }
  });

  // ── Fuzzy file finder ────────────────────────────────────────
  ipcMain.handle("find-files", async (_, query, dirs) => {
    if (typeof query !== "string" || !query.trim() || !Array.isArray(dirs)) return [];
    const safeDirs = dirs.map(d => sanitizePath(d)).filter(Boolean);
    if (!safeDirs.length) return [];
    try {
      const args = [
        ...safeDirs,
        "-maxdepth", "5", "-type", "f",
        "-not", "-path", "*/node_modules/*",
        "-not", "-path", "*/.git/*",
        "-not", "-path", "*/dist/*",
        "-not", "-path", "*/.next/*",
      ];
      const result = await execFileAsync("find", args, { timeout: 5000, maxBuffer: 1024 * 1024 });
      if (!result) return [];
      const q = query.toLowerCase(), home = os.homedir();
      return result.split("\n")
        .filter(f => f && f.toLowerCase().includes(q))
        .slice(0, 50)
        .map(f => ({ path: f, name: f.split("/").pop(), dir: f.replace(/\/[^/]+$/, "").replace(home, "~") }));
    } catch { return []; }
  });

  // ── Pipeline execution ───────────────────────────────────────
  ipcMain.handle("exec-pipeline-step", async (_, { command, cwd }) => {
    if (typeof command !== "string" || !command.trim()) {
      return { code: 1, stdout: "", stderr: "Invalid command" };
    }
    // Enforce a max command length to prevent memory exhaustion
    if (command.length > 8192) {
      return { code: 1, stdout: "", stderr: "Command too long (max 8192 chars)" };
    }
    const resolvedCwd = cwd ? sanitizePath(cwd) : os.homedir();
    if (!resolvedCwd) return { code: 1, stdout: "", stderr: "Invalid working directory" };

    return new Promise((resolve) => {
      let settled = false;
      function settle(result) {
        if (!settled) { settled = true; resolve(result); }
      }

      // sh -c is intentional: pipeline steps are user-authored shell commands.
      // The renderer validates steps before sending; main process limits length above.
      const proc = spawn("sh", ["-c", command], { cwd: resolvedCwd });
      let stdout = "", stderr = "";

      proc.stdout.on("data", d => { stdout += d; });
      proc.stderr.on("data", d => { stderr += d; });
      proc.on("close", code => settle({ code: code ?? 1, stdout: stdout.slice(-4000), stderr: stderr.slice(-4000) }));
      proc.on("error", err => settle({ code: 1, stdout: "", stderr: err.message }));

      const timer = setTimeout(() => {
        try { proc.kill("SIGTERM"); setTimeout(() => { try { proc.kill("SIGKILL"); } catch {} }, 1000); } catch {}
        settle({ code: 1, stdout: stdout.slice(-4000), stderr: (stderr + "\nTimeout after 60s").slice(-4000) });
      }, 60000);

      proc.on("close", () => clearTimeout(timer));
    });
  });

  // ── File dialogs ─────────────────────────────────────────────
  ipcMain.handle("export-sh", async (_, content, suggestedName) => {
    if (typeof content !== "string") return null;
    const { dialog } = require("electron");
    const win = getWindow();
    const result = await dialog.showSaveDialog(win, {
      defaultPath: path.join(os.homedir(), "Desktop", suggestedName || "pipeline.sh"),
      filters: [{ name: "Shell Script", extensions: ["sh"] }],
    });
    if (!result.canceled && result.filePath) {
      fs.writeFileSync(result.filePath, content, { mode: 0o755 });
      return result.filePath;
    }
    return null;
  });

  ipcMain.handle("save-output", async (_, content, suggestedName) => {
    if (typeof content !== "string") return null;
    const { dialog } = require("electron");
    const win = getWindow();
    const result = await dialog.showSaveDialog(win, {
      defaultPath: path.join(os.homedir(), "Desktop", suggestedName || "terminal-output.txt"),
      filters: [{ name: "Text", extensions: ["txt", "log"] }],
    });
    if (!result.canceled && result.filePath) {
      fs.writeFileSync(result.filePath, content);
      return result.filePath;
    }
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
    try {
      const content = fs.readFileSync(fp, "utf-8");
      return { content, name: path.basename(fp, path.extname(fp)) };
    } catch (e) { return { error: e.message }; }
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
    if (typeof title !== "string" || typeof body !== "string") return;
    if (Notification.isSupported()) new Notification({ title, body }).show();
  });

  ipcMain.on("open-in-editor", (_, filePath) => {
    const safe = sanitizePath(filePath);
    if (!safe) return;
    // Try VS Code first (async, non-blocking), fall back to system default
    execFileAsync("code", [safe], { timeout: 3000 }).catch(() => { shell.openPath(safe); });
  });
}

module.exports = { registerHandlers };
