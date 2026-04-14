"use strict";

// ============================================================
// SSH MANAGER
// Password-based remote session listing and local terminal
// creation for SSH connections.
// ============================================================

const fs = require("fs");
const os = require("os");
const path = require("path");
const { ipcMain, app } = require("electron");
const { execFile } = require("child_process");
const { isValidHost, isValidUser, isValidPort, log } = require("./utils");
const { ptys, getWindow } = require("./state");

// ── SSH_ASKPASS helper ────────────────────────────────────────
// Writes a temp script that echoes the password.
// Cleaned up immediately after the SSH handshake completes.

function createAskpassScript(password) {
  const scriptPath = path.join(app.getPath("temp"), `shellfire-askpass-${process.pid}-${Date.now()}.sh`);
  const escaped = password.replace(/'/g, "'\\''");
  fs.writeFileSync(scriptPath, `#!/bin/sh\necho '${escaped}'\n`, { mode: 0o700 });
  process.once("exit", () => { try { fs.unlinkSync(scriptPath); } catch {} });
  return scriptPath;
}

function cleanupAskpass(scriptPath) {
  if (!scriptPath) return;
  try { fs.unlinkSync(scriptPath); }
  catch (err) { if (err.code !== "ENOENT") log("error", "Failed to cleanup askpass script:", err.message); }
}

function buildSshEnv(password) {
  if (!password) return { env: { ...process.env }, askpassScript: null };
  const askpassScript = createAskpassScript(password);
  return {
    askpassScript,
    env: { ...process.env, SSH_ASKPASS: askpassScript, SSH_ASKPASS_REQUIRE: "force", DISPLAY: "shellfire:0" },
  };
}

// ── Remote probe (minified Node one-liner) ───────────────────
// Runs on the remote host via SSH, queries the remote Shellfire
// socket, and prints a JSON list of sessions then exits.
const REMOTE_PROBE = `node -e '
  const net=require("net"),path=require("path"),os=require("os"),fs=require("fs");
  const DIR=path.join(os.homedir(),".shellfire");
  let SOCK=null;
  try{const ss=fs.readdirSync(DIR).filter(f=>f.startsWith("shellfire-")&&f.endsWith(".sock")).map(f=>({p:path.join(DIR,f),m:fs.statSync(path.join(DIR,f)).mtimeMs})).sort((a,b)=>b.m-a.m);if(ss.length)SOCK=ss[0].p;}catch{}
  if(!SOCK){const leg=path.join(DIR,"shellfire.sock");if(fs.existsSync(leg))SOCK=leg;}
  if(!SOCK){console.log(JSON.stringify({error:"Shellfire is not running on this host"}));process.exit(0)}
  const c=net.createConnection(SOCK,()=>{c.write(JSON.stringify({action:"list"})+"\\n")});
  let d="";
  c.on("data",ch=>{d+=ch.toString();try{JSON.parse(d);console.log(d);process.exit(0)}catch{}});
  c.on("end",()=>{console.log(d||JSON.stringify({error:"empty response"}));process.exit(0)});
  c.on("error",e=>{console.log(JSON.stringify({error:e.message}));process.exit(0)});
  setTimeout(()=>{if(d){console.log(d);process.exit(0)}console.log(JSON.stringify({error:"timeout"}));process.exit(1)},8000);
'`;

// ── IPC handlers ─────────────────────────────────────────────

function registerHandlers() {
  // List sessions running on a remote Shellfire instance
  ipcMain.handle("ssh-remote-list", async (_, { host, user, port, password, remotePath }) => {
    if (!isValidHost(host)) return { error: "Invalid hostname" };
    if (!isValidUser(user)) return { error: "Invalid username" };
    if (port && !isValidPort(port)) return { error: "Invalid port" };

    const sshArgs = ["-o", "ConnectTimeout=10", "-o", "StrictHostKeyChecking=accept-new"];
    if (password) {
      sshArgs.push("-o", "PreferredAuthentications=password,keyboard-interactive");
      sshArgs.push("-o", "PubkeyAuthentication=no");
    }
    if (port && port !== 22) sshArgs.push("-p", String(port));
    sshArgs.push(`${user}@${host}`, REMOTE_PROBE);

    const { env, askpassScript } = buildSshEnv(password);

    try {
      const result = await new Promise((resolve, reject) => {
        execFile("ssh", sshArgs, { encoding: "utf8", timeout: 20000, env }, (err, stdout, stderr) => {
          cleanupAskpass(askpassScript);
          if (stdout?.trim()) {
            try { return resolve(JSON.parse(stdout.trim())); } catch {}
          }
          if (err) {
            const msg = stderr || err.message;
            if (msg.includes("Permission denied")) return reject(new Error("Authentication failed. Check your username and password."));
            if (msg.includes("Connection refused")) return reject(new Error("Connection refused. Is SSH running on the remote?"));
            if (msg.includes("timed out")) return reject(new Error("Connection timed out."));
            if (msg.includes("Could not resolve")) return reject(new Error("Could not resolve hostname: " + host));
            if (msg.includes("node: command not found") || msg.includes("node: not found")) return reject(new Error("Node.js is not installed on the remote host."));
            return reject(new Error(msg.trim() || "SSH connection failed"));
          }
          resolve({});
        });
      });
      return result;
    } catch (err) {
      cleanupAskpass(askpassScript);
      return { error: err.message };
    }
  });

  // Open local terminals connected to remote sessions via SSH
  ipcMain.handle("ssh-remote-open-all", async (_, { host, user, port, password, sessions }) => {
    if (!isValidHost(host)) return { error: "Invalid hostname" };
    if (!isValidUser(user)) return { error: "Invalid username" };
    if (port && !isValidPort(port)) return { error: "Invalid port" };
    if (!Array.isArray(sessions)) return { error: "Invalid sessions" };

    const win = getWindow();
    const opened = [];

    for (const session of sessions) {
      let sshCmd = "ssh -t";
      if (port && port !== 22) sshCmd += ` -p ${port}`;
      sshCmd += ` ${user}@${host}`;
      const cwd = session.cwd ? session.cwd.replace(/^~/, "$HOME") : "";
      if (cwd) sshCmd += ` "cd ${cwd.replace(/"/g, '\\"')} && exec \\$SHELL -l"`;

      const safeName = JSON.stringify(`${user}@${host}: ${session.name}`);
      const id = await win.webContents.executeJavaScript(`
        (async function() {
          const id = await window.__createPane();
          const pane = (window.__panes||new Map()).get(id);
          if (pane) { pane.customName=${safeName}; pane._userRenamed=true; if(pane.titleEl) pane.titleEl.textContent=${safeName}; }
          return id;
        })()
      `);

      const p = ptys.get(id);
      if (p) {
        setTimeout(() => {
          p.write(sshCmd + "\r");
          if (password) {
            let sent = false;
            const unsub = p.onData((data) => {
              if (sent) return;
              if (data.toLowerCase().includes("password")) {
                sent = true;
                setTimeout(() => { p.write(password + "\r"); }, 100);
                unsub.dispose();
              }
            });
            setTimeout(() => { if (!sent) unsub.dispose(); }, 10000);
          }
        }, 300);
        opened.push({ id, localId: id, remoteName: session.name, remoteId: session.id });
      }
    }
    return { opened };
  });
}

module.exports = { registerHandlers };
