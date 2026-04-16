"use strict";

/**
 * @module ssh-manager
 *
 * Password-based SSH integration for Shellfire.
 *
 * Owns:
 *   - Temporary SSH_ASKPASS helper script creation and cleanup
 *   - SSH environment construction for password-based auth
 *   - IPC handler "ssh-remote-list": probes a remote Shellfire instance for
 *     its active sessions via a one-shot SSH command
 *   - IPC handler "ssh-remote-open-all": opens local PTY panes whose shells
 *     connect back to the remote via SSH
 *
 * Does NOT own:
 *   - PTY lifecycle (create/resize/kill — see pty-manager.js)
 *   - SSH bookmark persistence (see storage.js)
 *   - Renderer-side SSH UI (see src/renderer/150-ssh.js)
 */

const fs   = require("fs");
const path = require("path");
const { ipcMain, app } = require("electron");
const { execFile }     = require("child_process");
const { isValidHost, isValidUser, isValidPort, log } = require("./utils");
const { ptys, getWindow } = require("./state");

// ─── Constants ────────────────────────────────────────────────────────────────

/** SSH connection timeout passed to the `-o ConnectTimeout` option (seconds). */
const SSH_CONNECT_TIMEOUT_S = 10;

/**
 * Total wall-clock timeout (ms) given to the execFile call for the remote
 * probe.  Includes SSH handshake + Node.js startup + socket round-trip.
 */
const SSH_EXEC_TIMEOUT_MS = 20000;

/**
 * Timeout (ms) the remote probe script waits for the Shellfire socket to
 * respond before giving up.
 */
const REMOTE_PROBE_TIMEOUT_MS = 8000;

/** Standard TCP port for SSH; omitted from CLI args when connecting on this port. */
const SSH_DEFAULT_PORT = 22;

/**
 * Delay (ms) before writing the SSH command into a freshly created pane.
 * Allows the PTY shell to finish its startup prompt before receiving input.
 */
const PANE_WRITE_DELAY_MS = 300;

/**
 * Delay (ms) after the password prompt is detected before sending the password.
 * A short pause prevents race conditions with some SSH implementations.
 */
const PASSWORD_SEND_DELAY_MS = 100;

/**
 * Maximum time (ms) to wait for a password prompt after sending the SSH
 * command.  If the prompt never arrives the listener is silently disposed.
 */
const PASSWORD_PROMPT_TIMEOUT_MS = 10000;

/**
 * Fake X11 DISPLAY value required by some SSH implementations when
 * SSH_ASKPASS is set. The value itself is not used — SSH only checks that
 * the variable is present.
 */
const ASKPASS_DISPLAY_VALUE = "shellfire:0";

// ─── SSH_ASKPASS helper ───────────────────────────────────────────────────────

/**
 * Writes a minimal shell script that echoes `password` to stdout.
 *
 * SSH calls this script instead of prompting the user when
 * `SSH_ASKPASS_REQUIRE=force` is set.  The script is created in the system
 * temp directory with mode 0o700 (owner-execute only) so no other user can
 * read the password.
 *
 * A process `"exit"` listener is registered as a safety net to remove the
 * script even if {@link cleanupAskpass} is never called (e.g. on crash).
 *
 * @param {string} password - The SSH password to embed in the script.
 * @returns {string} Absolute path of the created script file.
 */
function createAskpassScript(password) {
  const scriptPath = path.join(
    app.getPath("temp"),
    `shellfire-askpass-${process.pid}-${Date.now()}.sh`
  );

  // Single-quote the password and escape any embedded single-quotes so
  // the `echo '...'` statement in the script is safe for arbitrary passwords.
  const escaped = password.replace(/'/g, "'\\''");
  fs.writeFileSync(scriptPath, `#!/bin/sh\necho '${escaped}'\n`, { mode: 0o700 });

  // Safety-net cleanup: fires if the process exits before doCleanup() runs.
  process.once("exit", () => {
    try { fs.unlinkSync(scriptPath); } catch { /* file already removed — ignore */ }
  });

  return scriptPath;
}

/**
 * Removes the temporary askpass script from disk.
 *
 * Ignores `ENOENT` (already deleted) but logs any other filesystem error.
 *
 * @param {string|null} scriptPath - Path returned by {@link createAskpassScript},
 *                                   or `null` when no script was created.
 * @returns {void}
 */
function cleanupAskpass(scriptPath) {
  if (!scriptPath) return;
  try {
    fs.unlinkSync(scriptPath);
  } catch (err) {
    if (err.code !== "ENOENT") {
      log("error", "Failed to cleanup askpass script:", err.message);
    }
    // ENOENT means the safety-net exit listener already removed it — ignore.
  }
}

/**
 * Builds the environment object needed to authenticate SSH with a password.
 *
 * When `password` is provided, creates an askpass script and sets the three
 * environment variables that make SSH call it instead of prompting:
 *   - `SSH_ASKPASS`         — path to the script
 *   - `SSH_ASKPASS_REQUIRE` — `"force"` (skip interactive fallback)
 *   - `DISPLAY`             — a non-empty dummy value (required by OpenSSH)
 *
 * When `password` is falsy the current environment is returned unchanged and
 * no script is created.
 *
 * @param {string|null|undefined} password - The SSH password, or falsy for key auth.
 * @returns {{ env: NodeJS.ProcessEnv, askpassScript: string|null }}
 *   The augmented environment and the path of the temp script (or `null`).
 */
function buildSshEnv(password) {
  if (!password) return { env: { ...process.env }, askpassScript: null };

  const askpassScript = createAskpassScript(password);
  const env = {
    ...process.env,
    SSH_ASKPASS: askpassScript,
    SSH_ASKPASS_REQUIRE: "force",
    DISPLAY: ASKPASS_DISPLAY_VALUE,
  };
  return { env, askpassScript };
}

// ─── Remote probe script ──────────────────────────────────────────────────────

/**
 * Minified Node.js one-liner executed on the remote host via `ssh … node -e`.
 *
 * The script:
 *   1. Locates the most-recently-modified Shellfire Unix socket in
 *      `~/.shellfire/`, falling back to the legacy `shellfire.sock` path.
 *   2. Connects to the socket, sends `{"action":"list"}`, and prints the
 *      JSON response.
 *   3. Times out after {@link REMOTE_PROBE_TIMEOUT_MS} ms if the socket does
 *      not respond.
 *
 * All output is a single JSON line so the calling code can `JSON.parse` the
 * trimmed stdout without post-processing.
 *
 * @type {string}
 */
const REMOTE_PROBE = `node -e '
  const net=require("net"),path=require("path"),os=require("os"),fs=require("fs");
  const DIR=path.join(os.homedir(),".shellfire");
  let SOCK=null;
  try{
    const ss=fs.readdirSync(DIR)
      .filter(f=>f.startsWith("shellfire-")&&f.endsWith(".sock"))
      .map(f=>({p:path.join(DIR,f),m:fs.statSync(path.join(DIR,f)).mtimeMs}))
      .sort((a,b)=>b.m-a.m);
    if(ss.length)SOCK=ss[0].p;
  }catch{}
  if(!SOCK){const leg=path.join(DIR,"shellfire.sock");if(fs.existsSync(leg))SOCK=leg;}
  if(!SOCK){console.log(JSON.stringify({error:"Shellfire is not running on this host"}));process.exit(0)}
  const c=net.createConnection(SOCK,()=>{c.write(JSON.stringify({action:"list"})+"\\n")});
  let d="";
  c.on("data",ch=>{d+=ch.toString();try{JSON.parse(d);console.log(d);process.exit(0)}catch{}});
  c.on("end",()=>{console.log(d||JSON.stringify({error:"empty response"}));process.exit(0)});
  c.on("error",e=>{console.log(JSON.stringify({error:e.message}));process.exit(0)});
  setTimeout(()=>{
    if(d){console.log(d);process.exit(0)}
    console.log(JSON.stringify({error:"timeout"}));process.exit(1);
  },${REMOTE_PROBE_TIMEOUT_MS});
'`;

// ─── SSH argument builders ────────────────────────────────────────────────────

/**
 * Builds the `ssh` argument list for connecting to `user@host`.
 *
 * Common options such as `ConnectTimeout` and `StrictHostKeyChecking` are
 * always included.  When a password is provided, public-key auth is disabled
 * so that SSH falls through to the askpass helper immediately.
 *
 * @param {string}      host     - Remote hostname or IP address.
 * @param {string}      user     - Remote username.
 * @param {number|null} port     - Remote port, or falsy to use the SSH default.
 * @param {boolean}     hasPassword - Whether password auth is being used.
 * @returns {string[]} Argument array suitable for passing to `execFile("ssh", …)`.
 */
function buildSshArgs(host, user, port, hasPassword) {
  const args = [
    "-o", `ConnectTimeout=${SSH_CONNECT_TIMEOUT_S}`,
    "-o", "StrictHostKeyChecking=accept-new",
  ];

  if (hasPassword) {
    args.push("-o", "PreferredAuthentications=password,keyboard-interactive");
    args.push("-o", "PubkeyAuthentication=no");
  }

  if (port && port !== SSH_DEFAULT_PORT) {
    args.push("-p", String(port));
  }

  args.push(`${user}@${host}`);
  return args;
}

/**
 * Translates a raw SSH stderr/error message into a user-readable string.
 *
 * @param {string} raw  - The raw stderr text or error message.
 * @param {string} host - The target hostname (used in the "could not resolve" message).
 * @returns {string} A human-friendly error message.
 */
function humaniseSshError(raw, host) {
  if (raw.includes("Permission denied"))    return "Authentication failed. Check your username and password.";
  if (raw.includes("Connection refused"))   return "Connection refused. Is SSH running on the remote?";
  if (raw.includes("timed out"))            return "Connection timed out.";
  if (raw.includes("Could not resolve"))    return `Could not resolve hostname: ${host}`;
  if (raw.includes("node: command not found") ||
      raw.includes("node: not found"))      return "Node.js is not installed on the remote host.";
  return raw || "SSH connection failed";
}

// ─── IPC handlers ─────────────────────────────────────────────────────────────

/**
 * Registers all SSH-related IPC handlers on `ipcMain`.
 *
 * Handlers registered:
 *   - `"ssh-remote-list"`    — probe a remote Shellfire instance for sessions
 *   - `"ssh-remote-open-all"` — open local panes wired to remote sessions via SSH
 *
 * @returns {void}
 */
function registerHandlers() {
  _registerRemoteList();
  _registerRemoteOpenAll();
}

// ─── ssh-remote-list ──────────────────────────────────────────────────────────

/**
 * Registers the `"ssh-remote-list"` IPC handler.
 *
 * Connects to `user@host` over SSH, runs {@link REMOTE_PROBE} on the remote,
 * and resolves with the parsed JSON session list (or an `{ error }` object
 * when something goes wrong).
 *
 * @returns {void}
 */
function _registerRemoteList() {
  ipcMain.handle("ssh-remote-list", async (_, { host, user, port, password }) => {
    if (!isValidHost(host)) return { error: "Invalid hostname" };
    if (!isValidUser(user)) return { error: "Invalid username" };
    if (port && !isValidPort(port)) return { error: "Invalid port" };

    const args = [...buildSshArgs(host, user, port, Boolean(password)), REMOTE_PROBE];
    const { env, askpassScript } = buildSshEnv(password);

    // Guard against double-cleanup if both the execFile callback and the
    // outer catch block fire (possible on very early process errors).
    let cleaned = false;
    function doCleanup() {
      if (!cleaned) { cleaned = true; cleanupAskpass(askpassScript); }
    }

    try {
      const result = await _runSshProbe(args, env, host, doCleanup);
      return result;
    } catch (err) {
      doCleanup();
      return { error: err.message };
    }
  });
}

/**
 * Spawns the SSH probe command and resolves with the parsed JSON result.
 *
 * Calls `doCleanup` exactly once (from inside the execFile callback) when
 * the process exits, whether successfully or not.
 *
 * @param {string[]}          args      - Full argument list for `ssh`.
 * @param {NodeJS.ProcessEnv} env       - Environment to pass to the child process.
 * @param {string}            host      - Hostname (for error messages).
 * @param {Function}          doCleanup - Zero-arg cleanup callback; called once.
 * @returns {Promise<object>} Parsed session list, or throws with a user-readable message.
 */
function _runSshProbe(args, env, host, doCleanup) {
  return new Promise((resolve, reject) => {
    execFile(
      "ssh", args,
      { encoding: "utf8", timeout: SSH_EXEC_TIMEOUT_MS, env },
      (err, stdout, stderr) => {
        doCleanup();

        // If stdout contains parseable JSON, trust it — the probe always
        // writes exactly one JSON line regardless of the exit code.
        if (stdout?.trim()) {
          try { return resolve(JSON.parse(stdout.trim())); } catch { /* fall through to error handling */ }
        }

        if (err) {
          const raw = (stderr || err.message || "").trim();
          return reject(new Error(humaniseSshError(raw, host)));
        }

        resolve({});
      }
    );
  });
}

// ─── ssh-remote-open-all ──────────────────────────────────────────────────────

/**
 * Registers the `"ssh-remote-open-all"` IPC handler.
 *
 * For each entry in `sessions`, creates a new renderer pane and sends an SSH
 * command into it.  If a password is supplied, listens for the password prompt
 * and types the password automatically.
 *
 * Returns `{ opened: Array<{ id, localId, remoteName, remoteId }> }` listing
 * every pane that was successfully wired up.  Returns `{ error }` on bad input.
 *
 * @returns {void}
 */
function _registerRemoteOpenAll() {
  ipcMain.handle("ssh-remote-open-all", async (_, { host, user, port, password, sessions }) => {
    if (!isValidHost(host))          return { error: "Invalid hostname" };
    if (!isValidUser(user))          return { error: "Invalid username" };
    if (port && !isValidPort(port))  return { error: "Invalid port" };
    if (!Array.isArray(sessions))    return { error: "Invalid sessions" };

    const win    = getWindow();
    const opened = [];

    for (const session of sessions) {
      const sshCmd = _buildSshOpenCommand(host, user, port, session);
      const paneId = await _createNamedPane(win, user, host, session.name);
      const pty    = ptys.get(paneId);

      if (pty) {
        _writeCommandToPty(pty, sshCmd, password);
        opened.push({ id: paneId, localId: paneId, remoteName: session.name, remoteId: session.id });
      }
    }

    return { opened };
  });
}

/**
 * Constructs the SSH command string that will be typed into the local PTY to
 * connect to a specific remote session's working directory.
 *
 * When the session has a `cwd`, the remote shell is asked to `cd` there and
 * then exec a login shell.  Tilde prefixes are converted to `$HOME` so they
 * expand on the remote, not locally.
 *
 * @param {string}      host    - Remote hostname or IP.
 * @param {string}      user    - Remote username.
 * @param {number|null} port    - Remote port, or falsy for the SSH default.
 * @param {{ cwd?: string }} session - The remote session descriptor.
 * @returns {string} A complete `ssh …` command ready to type into a PTY.
 */
function _buildSshOpenCommand(host, user, port, session) {
  let cmd = "ssh -t";
  if (port && port !== SSH_DEFAULT_PORT) cmd += ` -p ${port}`;
  cmd += ` ${user}@${host}`;

  const cwd = session.cwd ? session.cwd.replace(/^~/, "$HOME") : "";
  if (cwd) {
    // Escape double-quotes in the path so the remote shell command is safe.
    cmd += ` "cd ${cwd.replace(/"/g, '\\"')} && exec \\$SHELL -l"`;
  }

  return cmd;
}

/**
 * Creates a new pane in the renderer and sets its display name.
 *
 * Executes JavaScript in the renderer context via `executeJavaScript`, which
 * is the only cross-process channel available for synchronous pane creation.
 * The returned promise resolves with the new pane's numeric id.
 *
 * @param {import("electron").BrowserWindow} win         - The main window.
 * @param {string}                           user        - Remote username (for the tab label).
 * @param {string}                           host        - Remote hostname (for the tab label).
 * @param {string}                           sessionName - Remote session name (for the tab label).
 * @returns {Promise<number>} The numeric id of the newly created pane.
 */
async function _createNamedPane(win, user, host, sessionName) {
  const safeName = JSON.stringify(`${user}@${host}: ${sessionName}`);
  return win.webContents.executeJavaScript(`
    (async function() {
      const id = await window.__createPane();
      const pane = (window.__panes || new Map()).get(id);
      if (pane) {
        pane.customName = ${safeName};
        pane._userRenamed = true;
        if (pane.titleEl) pane.titleEl.textContent = ${safeName};
      }
      return id;
    })()
  `);
}

/**
 * Writes the SSH command to `pty` after a short startup delay, then
 * optionally installs a one-time password auto-type listener.
 *
 * @param {import("node-pty").IPty} pty      - The target PTY process.
 * @param {string}                  sshCmd   - The SSH command string to type.
 * @param {string|null|undefined}   password - The SSH password, or falsy to skip.
 * @returns {void}
 */
function _writeCommandToPty(pty, sshCmd, password) {
  setTimeout(() => {
    pty.write(sshCmd + "\r");
    if (password) {
      _installPasswordListener(pty, password);
    }
  }, PANE_WRITE_DELAY_MS);
}

/**
 * Listens for a password prompt on `pty.onData` and types `password` once.
 *
 * The listener disposes itself after sending the password.  A safety-net
 * timeout disposes it after {@link PASSWORD_PROMPT_TIMEOUT_MS} if no prompt
 * ever arrives (e.g. key-based auth succeeded before the handler was removed).
 *
 * @param {import("node-pty").IPty} pty      - The PTY whose output is monitored.
 * @param {string}                  password - The password to type.
 * @returns {void}
 */
function _installPasswordListener(pty, password) {
  let sent = false;

  const unsub = pty.onData((data) => {
    if (sent) return;
    if (data.toLowerCase().includes("password")) {
      sent = true;
      setTimeout(() => { pty.write(password + "\r"); }, PASSWORD_SEND_DELAY_MS);
      unsub.dispose();
    }
  });

  // Safety net: stop listening if the prompt never arrives (key auth,
  // timeout, or the remote rejected us before prompting).
  setTimeout(() => { if (!sent) unsub.dispose(); }, PASSWORD_PROMPT_TIMEOUT_MS);
}

// ─── Exports ──────────────────────────────────────────────────────────────────

module.exports = { registerHandlers };
