"use strict";

// ============================================================
// PTY MANAGER
// Owns PTY lifecycle: create, resize, input, kill, query.
// ============================================================

const fs = require("fs");
const os = require("os");
const { ipcMain } = require("electron");
const pty = require("node-pty");
const { execFileAsync, sanitizePath, log } = require("./utils");
const { ptys, ptyBuffers, ptyMeta, getNextId, appendPtyBuffer, getWindow, sendToRenderer } = require("./state");

// ── Internal helpers ─────────────────────────────────────────

async function getCwdForPty(id) {
  const p = ptys.get(id);
  if (!p) return null;
  const pid = String(p.pid);
  try {
    if (process.platform === "win32") {
      return await execFileAsync("powershell", ["-Command",
        `(Get-CimInstance Win32_Process -Filter "ProcessId=${parseInt(pid, 10)}").ExecutablePath; ` +
        `$o=(Get-CimInstance Win32_Process -Filter "ProcessId=${parseInt(pid, 10)}"); ` +
        `Invoke-CimMethod -InputObject $o -MethodName GetOwner|Out-Null; ` +
        `[System.IO.Directory]::GetCurrentDirectory()`
      ], { timeout: 3000 });
    }
    const out = await execFileAsync("lsof", ["-p", pid, "-Fn"], { timeout: 2000 });
    const lines = out.split("\n");
    for (let i = 0; i < lines.length; i++) {
      if (lines[i] === "fcwd" && lines[i + 1]?.startsWith("n")) return lines[i + 1].slice(1);
    }
    return null;
  } catch { return null; }
}

async function getProcessForPty(id) {
  const p = ptys.get(id);
  if (!p) return null;
  const pid = String(p.pid);
  try {
    if (process.platform === "win32") {
      const r = await execFileAsync("powershell", ["-Command",
        `(Get-CimInstance Win32_Process -Filter "ParentProcessId=${parseInt(pid, 10)}" | Select-Object -First 1).Name`
      ], { timeout: 3000 });
      return r || null;
    }
    let childPid;
    try { childPid = (await execFileAsync("pgrep", ["-P", pid])).split("\n")[0]; } catch {}
    const target = childPid || pid;
    const comm = await execFileAsync("ps", ["-o", "comm=", "-p", target]);
    return comm.split("/").pop() || null;
  } catch { return null; }
}

// ── IPC handlers ─────────────────────────────────────────────

function registerHandlers() {
  ipcMain.handle("create-terminal", (_, cwd, restoreCmd) => {
    const shellPath = process.platform === "win32"
      ? process.env.COMSPEC || "powershell.exe"
      : process.env.SHELL || "/bin/zsh";

    const id = getNextId();
    const safeCwd = cwd ? sanitizePath(cwd) : null;

    const p = pty.spawn(shellPath, [], {
      name: "xterm-256color",
      cols: 80, rows: 24,
      cwd: safeCwd || os.homedir(),
      env: { ...process.env, TERM: "xterm-256color", CLAUDECODE: "" },
    });

    ptys.set(id, p);
    ptyBuffers.set(id, "");
    ptyMeta.set(id, { cwd: safeCwd || os.homedir(), cols: 80, rows: 24 });

    p.onData((data) => {
      appendPtyBuffer(id, data);
      sendToRenderer("terminal-data", id, data);
    });

    p.onExit(({ exitCode }) => {
      ptys.delete(id);
      ptyBuffers.delete(id);
      ptyMeta.delete(id);
      sendToRenderer("terminal-exit", id, exitCode);
    });

    // Re-run saved command after shell init (session restore)
    if (restoreCmd && typeof restoreCmd === "string") {
      setTimeout(() => { ptys.get(id)?.write(restoreCmd + "\n"); }, 1500);
    }

    return id;
  });

  ipcMain.on("terminal-input", (_, id, data) => {
    if (typeof id !== "number" || typeof data !== "string") return;
    ptys.get(id)?.write(data);
  });

  ipcMain.on("terminal-resize", (_, id, cols, rows) => {
    if (typeof id !== "number") return;
    const c = Number(cols), r = Number(rows);
    if (!Number.isInteger(c) || !Number.isInteger(r) || c < 1 || r < 1 || c > 500 || r > 500) return;
    const p = ptys.get(id);
    if (!p) return;
    p.resize(c, r);
    const meta = ptyMeta.get(id);
    if (meta) { meta.cols = c; meta.rows = r; }
  });

  ipcMain.on("terminal-kill", (_, id) => {
    if (typeof id !== "number") return;
    const p = ptys.get(id);
    if (!p) return;
    // Clean up maps immediately — onExit will also attempt deletes (no-op at that point)
    ptys.delete(id);
    ptyBuffers.delete(id);
    ptyMeta.delete(id);
    try { p.kill(); } catch {}
  });

  ipcMain.on("terminal-broadcast", (_, ids, data) => {
    if (!Array.isArray(ids) || typeof data !== "string") return;
    for (const id of ids) {
      if (typeof id === "number") ptys.get(id)?.write(data);
    }
  });

  // List PTYs for tmux-like reattach on renderer init
  ipcMain.handle("list-ptys", async () => {
    const result = [];
    for (const [id, p] of ptys) {
      let cwd = ptyMeta.get(id)?.cwd || null;
      try { const fresh = await getCwdForPty(id); if (fresh) cwd = fresh; } catch {}
      result.push({
        id, pid: p.pid,
        buffer: ptyBuffers.get(id) || "",
        cwd,
        cols: ptyMeta.get(id)?.cols || 80,
        rows: ptyMeta.get(id)?.rows || 24,
      });
    }
    return result;
  });

  ipcMain.handle("get-terminal-cwd", async (_, id) => getCwdForPty(id));
  ipcMain.handle("get-terminal-process", async (_, id) => getProcessForPty(id));

  ipcMain.handle("get-terminal-env", async (_, id) => {
    const p = ptys.get(id);
    const fallback = () => Object.entries(process.env)
      .map(([key, value]) => ({ key, value }))
      .sort((a, b) => a.key.localeCompare(b.key));

    if (!p || process.platform === "win32") return fallback();
    try {
      const pid = String(p.pid);
      let childPid;
      try { childPid = (await execFileAsync("pgrep", ["-P", pid])).split("\n")[0]; } catch {}
      const target = childPid || pid;
      // Validate target is a numeric PID before using in filesystem path
      if (!/^\d+$/.test(target)) return fallback();
      if (process.platform === "linux") {
        try {
          const envStr = fs.readFileSync(`/proc/${target}/environ`, "utf8");
          const pairs = envStr.split("\0").filter(Boolean).map(entry => {
            const eq = entry.indexOf("=");
            return eq > 0 ? { key: entry.slice(0, eq), value: entry.slice(eq + 1) } : null;
          }).filter(Boolean);
          if (pairs.length) return pairs.sort((a, b) => a.key.localeCompare(b.key));
        } catch {}
      }
    } catch {}
    return fallback();
  });

  ipcMain.handle("get-process-tree", async (_, id) => {
    const p = ptys.get(id);
    if (!p) return null;
    const pid = String(p.pid);
    try {
      if (process.platform === "win32") {
        const result = await execFileAsync("powershell", ["-Command",
          `Get-CimInstance Win32_Process -Filter "ParentProcessId=${parseInt(pid, 10)}" | Select-Object ProcessId,Name,CommandLine | ConvertTo-Json`
        ], { timeout: 3000 });
        const procs = JSON.parse(result);
        const proc = Array.isArray(procs) ? procs[procs.length - 1] : procs;
        if (proc) return { pid: String(proc.ProcessId), comm: proc.Name, args: proc.CommandLine || "" };
        return null;
      }
      const childPidsStr = await execFileAsync("pgrep", ["-P", pid]);
      const childPids = childPidsStr.split("\n").filter(Boolean);
      if (!childPids.length) return null;
      const result = await execFileAsync("ps", ["-o", "pid=,comm=", "-p", childPids.join(",")]);
      const argsResult = await execFileAsync("ps", ["-o", "args=", "-p", childPids[childPids.length - 1]]);
      const lines = result.split("\n").map(l => l.trim()).filter(Boolean);
      if (!lines.length) return null;
      const parts = lines[lines.length - 1].split(/\s+/);
      const fullArgs = (argsResult || "").trim();
      const comm = (parts[1] || "").split("/").pop();
      let cleanCmd = fullArgs;
      if (comm === "node" || comm === "node.exe") {
        const m = fullArgs.match(/\/([^/\s]+?)(?:\.js)?\s*(.*)/);
        if (m) cleanCmd = m[1] + (m[2] ? " " + m[2] : "");
      }
      return { pid: parts[0], comm: parts[1], args: cleanCmd };
    } catch { return null; }
  });

  ipcMain.handle("get-pane-stats", async (_, id) => {
    const p = ptys.get(id);
    if (!p) return null;
    const pid = String(p.pid);
    try {
      if (process.platform === "darwin") {
        const result = await execFileAsync("ps", ["-o", "pid=,%cpu=,%mem=,vsz=,rss=", "-p", pid]);
        if (!result) return null;
        const parts = result.trim().split(/\s+/);
        return { pid: parts[0], cpu: parseFloat(parts[1]) || 0, mem: parseFloat(parts[2]) || 0, vsz: parseInt(parts[3]) || 0, rss: parseInt(parts[4]) || 0 };
      }
    } catch {}
    return null;
  });
}

module.exports = { registerHandlers, getCwdForPty, getProcessForPty };
