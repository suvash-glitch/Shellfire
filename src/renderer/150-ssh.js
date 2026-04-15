// SSH BOOKMARKS
// ============================================================
let sshBookmarks = [];

async function loadSshBookmarks() {
  try { const saved = await window.shellfire.loadSsh(); if (Array.isArray(saved)) sshBookmarks = saved; } catch {}
}

function openSshManager() {
  if (_paletteCleanup) { _paletteCleanup(); _paletteCleanup = null; }
  const overlay = document.getElementById("palette-overlay");
  const input = document.getElementById("palette-input");
  const results = document.getElementById("palette-results");
  overlay.classList.add("visible");
  input.placeholder = "Search SSH bookmarks... (new name user@host[:port] to add)";
  input.value = ""; input.focus();
  let selected = 0;

  function render(q) {
    const qq = q.toLowerCase();
    const filtered = qq ? sshBookmarks.filter(s => s.name.toLowerCase().includes(qq) || s.host.toLowerCase().includes(qq)) : sshBookmarks;
    selected = Math.min(selected, Math.max(0, filtered.length - 1));
    results.innerHTML = "";
    if (filtered.length === 0) {
      results.innerHTML = `<div class="palette-item"><span class="palette-item-label" style="color:color-mix(in srgb, var(--t-fg) 50%, transparent)">${sshBookmarks.length === 0 ? "No SSH bookmarks. Type new:name:user@host to add" : "No matches"}</span></div>`;
      return;
    }
    filtered.forEach((s, i) => {
      const el = document.createElement("div"); el.className = "palette-item" + (i === selected ? " selected" : "");
      el.innerHTML = `<span class="palette-item-label">${s.name}<span class="palette-item-sub">${s.host}${s.port && s.port !== 22 ? ':' + s.port : ''}</span></span><span class="palette-item-shortcut" style="cursor:pointer" data-del="${i}">&#x2716;</span>`;
      el.addEventListener("click", () => {
        overlay.classList.remove("visible"); input.placeholder = "Type a command...";
        connectSsh(s);
      });
      el.querySelector("[data-del]").addEventListener("click", (ev) => {
        ev.stopPropagation();
        sshBookmarks.splice(sshBookmarks.indexOf(s), 1);
        window.shellfire.saveSsh(sshBookmarks);
        render(input.value);
        showToast("SSH bookmark deleted");
      });
      results.appendChild(el);
    });
  }
  render("");

  const handler = (e) => {
    if (e.key === "Escape") { overlay.classList.remove("visible"); input.placeholder = "Type a command..."; input.removeEventListener("keydown", handler); input.removeEventListener("input", inputHandler); return; }
    if (e.key === "Enter") {
      e.preventDefault();
      const val = input.value;
      if (val.startsWith("new ") || val.startsWith("new:")) {
        // Parse: "new name user@host[:port]" or legacy "new:name:user@host"
        const raw = val.startsWith("new ") ? val.slice(4) : val.slice(4);
        // Split on first space to get name and host part
        const spaceIdx = raw.indexOf(" ");
        if (spaceIdx > 0) {
          const name = raw.slice(0, spaceIdx).trim();
          const hostPart = raw.slice(spaceIdx + 1).trim();
          const portMatch = hostPart.match(/:(\d+)$/);
          const port = portMatch ? parseInt(portMatch[1]) : 22;
          const host = portMatch ? hostPart.replace(/:(\d+)$/, "") : hostPart;
          sshBookmarks.push({ name, host, port });
          window.shellfire.saveSsh(sshBookmarks);
          showToast("SSH bookmark saved");
        } else {
          // Legacy colon format: new:name:user@host
          const parts = raw.split(":");
          if (parts.length >= 2) {
            const name = parts[0].trim();
            const hostPart = parts.slice(1).join(":").trim();
            const portMatch = hostPart.match(/:(\d+)$/);
            const port = portMatch ? parseInt(portMatch[1]) : 22;
            const host = portMatch ? hostPart.replace(/:(\d+)$/, "") : hostPart;
            sshBookmarks.push({ name, host, port });
            window.shellfire.saveSsh(sshBookmarks);
            showToast("SSH bookmark saved");
          }
        }
      } else {
        const items = results.querySelectorAll(".palette-item"); items[selected]?.click();
      }
      overlay.classList.remove("visible"); input.placeholder = "Type a command...";
      input.removeEventListener("keydown", handler); input.removeEventListener("input", inputHandler);
    }
    if (e.key === "ArrowDown") { e.preventDefault(); selected = Math.min(selected + 1, Math.max(0, results.querySelectorAll(".palette-item").length - 1)); render(input.value); }
    if (e.key === "ArrowUp") { e.preventDefault(); selected = Math.max(0, selected - 1); render(input.value); }
  };
  const inputHandler = () => { selected = 0; render(input.value); };
  input.addEventListener("keydown", handler);
  input.addEventListener("input", inputHandler);
  _paletteCleanup = () => { input.removeEventListener("keydown", handler); input.removeEventListener("input", inputHandler); };
}

async function connectSsh(bookmark) {
  const id = await addTerminal();
  const cmd = bookmark.port && bookmark.port !== 22
    ? `ssh -p ${bookmark.port} ${bookmark.host}`
    : `ssh ${bookmark.host}`;
  setTimeout(() => window.shellfire.sendInput(id, cmd + "\n"), 200);
  showToast(`Connecting to ${bookmark.name}...`);
}

// ============================================================
// REMOTE CONNECTION
// ============================================================
function openRemoteConnect() {
  const overlay = document.getElementById("remote-overlay");
  const form = document.getElementById("remote-form");
  const sessionsView = document.getElementById("remote-sessions");
  const statusView = document.getElementById("remote-status");
  const statusText = document.getElementById("remote-status-text");

  // Reset to form view
  form.style.display = "block";
  sessionsView.style.display = "none";
  statusView.style.display = "none";
  overlay.classList.add("visible");

  // Pre-fill from last used values
  const hostInput = document.getElementById("remote-host");
  const userInput = document.getElementById("remote-user");
  const portInput = document.getElementById("remote-port");
  const passwordInput = document.getElementById("remote-password");
  const remotePathInput = document.getElementById("remote-shellfire-path");

  // Focus host input
  setTimeout(() => hostInput.focus(), 100);

  // Remove old error messages
  const oldErr = form.querySelector(".remote-error");
  if (oldErr) oldErr.remove();

  let _connInfo = null;

  function closeRemote() {
    overlay.classList.remove("visible");
    if (activeId && panes.has(activeId)) panes.get(activeId).term.focus();
  }

  // Wire up buttons (use one-shot listeners)
  const closeBtn = document.getElementById("remote-close");
  const cancelBtn = document.getElementById("remote-cancel");
  const connectBtn = document.getElementById("remote-connect");
  const backBtn = document.getElementById("remote-back");
  const sessionsCancelBtn = document.getElementById("remote-sessions-cancel");
  const openAllBtn = document.getElementById("remote-open-all");

  let _formKeydownHandler = null;
  const cleanup = () => {
    closeBtn.removeEventListener("click", onClose);
    cancelBtn.removeEventListener("click", onClose);
    connectBtn.removeEventListener("click", onConnect);
    backBtn.removeEventListener("click", onBack);
    sessionsCancelBtn.removeEventListener("click", onClose);
    openAllBtn.removeEventListener("click", onOpenAll);
    overlay.removeEventListener("click", onOverlayClick);
    // Clean up form input listeners
    if (_formKeydownHandler) {
      form.querySelectorAll("input").forEach(inp => inp.removeEventListener("keydown", _formKeydownHandler));
    }
  };

  function onClose() { cleanup(); closeRemote(); }
  function onOverlayClick(e) { if (e.target === overlay) onClose(); }

  async function onConnect() {
    const host = hostInput.value.trim();
    const user = userInput.value.trim();
    const port = parseInt(portInput.value) || 22;
    const password = passwordInput.value || "";
    const remotePath = remotePathInput.value.trim() || null;

    // Remove old errors
    const oldErr = form.querySelector(".remote-error");
    if (oldErr) oldErr.remove();

    if (!host) { hostInput.focus(); return; }
    if (!user) { userInput.focus(); return; }

    _connInfo = { host, user, port, password, remotePath };

    // Show loading
    form.style.display = "none";
    statusView.style.display = "flex";
    statusText.textContent = `Connecting to ${user}@${host}...`;

    try {
      const result = await window.shellfire.sshRemoteList({ host, user, port, password, remotePath });
      statusView.style.display = "none";

      if (result.error) {
        form.style.display = "block";
        const errDiv = document.createElement("div");
        errDiv.className = "remote-error";
        errDiv.textContent = result.error;
        form.querySelector(".remote-actions").before(errDiv);
        return;
      }

      // Show sessions
      const sessions = result.sessions || [];
      document.getElementById("remote-sessions-host").textContent = `${user}@${host}${port !== 22 ? ':' + port : ''}`;
      renderRemoteSessions(sessions);
      sessionsView.style.display = "block";
    } catch (err) {
      statusView.style.display = "none";
      form.style.display = "block";
      const errDiv = document.createElement("div");
      errDiv.className = "remote-error";
      errDiv.textContent = err.message || "Connection failed";
      form.querySelector(".remote-actions").before(errDiv);
    }
  }

  function onBack() {
    sessionsView.style.display = "none";
    form.style.display = "block";
  }

  function renderRemoteSessions(sessions) {
    const list = document.getElementById("remote-sessions-list");
    list.innerHTML = "";

    if (sessions.length === 0) {
      list.innerHTML = '<div class="remote-no-sessions">No active Shellfire sessions found on this host.</div>';
      openAllBtn.disabled = true;
      return;
    }

    openAllBtn.disabled = false;
    openAllBtn.textContent = `Open All (${sessions.length}) Locally`;

    sessions.forEach(s => {
      const item = document.createElement("div");
      item.className = "remote-session-item";

      const icon = getRemoteProcessIcon(s.process);
      const meta = [s.cwd, s.process].filter(Boolean).join(" \u00b7 ");

      item.innerHTML = `
        <div class="remote-session-icon">${icon}</div>
        <div class="remote-session-info">
          <div class="remote-session-name">${escHtml(s.name)}</div>
          ${meta ? `<div class="remote-session-meta">${escHtml(meta)}</div>` : ""}
        </div>
        ${s.active ? '<span class="remote-session-active">ACTIVE</span>' : ""}
      `;
      list.appendChild(item);
    });

    // Store sessions for open-all
    openAllBtn._sessions = sessions;
  }

  async function onOpenAll() {
    const sessions = openAllBtn._sessions;
    if (!sessions || !sessions.length || !_connInfo) return;

    cleanup();
    overlay.classList.remove("visible");
    showToast(`Opening ${sessions.length} remote session${sessions.length > 1 ? 's' : ''}...`);

    try {
      const result = await window.shellfire.sshRemoteOpenAll({
        host: _connInfo.host,
        user: _connInfo.user,
        port: _connInfo.port,
        password: _connInfo.password,
        sessions,
      });
      showToast(`Opened ${result.opened.length} remote terminal${result.opened.length > 1 ? 's' : ''}`);
    } catch (err) {
      showToast("Failed to open remote sessions: " + err.message, "error");
    }
  }

  closeBtn.addEventListener("click", onClose);
  cancelBtn.addEventListener("click", onClose);
  connectBtn.addEventListener("click", onConnect);
  backBtn.addEventListener("click", onBack);
  sessionsCancelBtn.addEventListener("click", onClose);
  openAllBtn.addEventListener("click", onOpenAll);
  overlay.addEventListener("click", onOverlayClick);

  // Enter key on form submits
  const formInputs = form.querySelectorAll("input");
  _formKeydownHandler = (e) => {
    if (e.key === "Enter") onConnect();
    if (e.key === "Escape") onClose();
  };
  formInputs.forEach(inp => inp.addEventListener("keydown", _formKeydownHandler));
}

function getRemoteProcessIcon(proc) {
  if (!proc) return "\u{1F4BB}";
  const p = proc.toLowerCase();
  if (p.includes("node")) return "\u{1F7E2}";
  if (p.includes("python")) return "\u{1F40D}";
  if (p.includes("vim") || p.includes("nvim")) return "\u{1F4DD}";
  if (p.includes("git")) return "\u{1F500}";
  if (p.includes("docker")) return "\u{1F40B}";
  if (p.includes("ssh")) return "\u{1F510}";
  if (p.includes("cargo") || p.includes("rustc")) return "\u{1F980}";
  if (p.includes("go")) return "\u{1F439}";
  if (p.includes("ruby")) return "\u{1F48E}";
  return "\u{1F4BB}";
}

// ============================================================
// SPLIT & RUN
// ============================================================
function openSplitAndRun() {
  if (_paletteCleanup) { _paletteCleanup(); _paletteCleanup = null; }
  const overlay = document.getElementById("palette-overlay");
  const input = document.getElementById("palette-input");
  const results = document.getElementById("palette-results");
  overlay.classList.add("visible");
  input.placeholder = "Enter command to run in new split pane...";
  input.value = ""; input.focus();

  results.innerHTML = `<div class="palette-item"><span class="palette-item-label" style="color:color-mix(in srgb, var(--t-fg) 50%, transparent)">Type a command and press Enter to split & run</span></div>
    <div class="palette-item" data-cmd="npm run dev"><span class="palette-item-label">npm run dev</span></div>
    <div class="palette-item" data-cmd="npm test"><span class="palette-item-label">npm test</span></div>
    <div class="palette-item" data-cmd="npm run build"><span class="palette-item-label">npm run build</span></div>
    <div class="palette-item" data-cmd="git log --oneline -20"><span class="palette-item-label">git log --oneline -20</span></div>
    <div class="palette-item" data-cmd="htop"><span class="palette-item-label">htop</span></div>
    <div class="palette-item" data-cmd="docker-compose up"><span class="palette-item-label">docker-compose up</span></div>`;
  results.querySelectorAll("[data-cmd]").forEach(el => {
    el.addEventListener("click", () => {
      overlay.classList.remove("visible"); input.placeholder = "Type a command...";
      doSplitAndRun(el.dataset.cmd);
    });
  });

  const handler = (e) => {
    if (e.key === "Escape") { overlay.classList.remove("visible"); input.placeholder = "Type a command..."; input.removeEventListener("keydown", handler); return; }
    if (e.key === "Enter") {
      e.preventDefault();
      const cmd = input.value.trim();
      if (cmd) doSplitAndRun(cmd);
      overlay.classList.remove("visible"); input.placeholder = "Type a command...";
      input.removeEventListener("keydown", handler);
    }
  };
  input.addEventListener("keydown", handler);
  _paletteCleanup = () => { input.removeEventListener("keydown", handler); };
}

async function doSplitAndRun(command) {
  let cwd = null;
  if (activeId) { try { cwd = await window.shellfire.getCwd(activeId); } catch {} }
  await splitPane("horizontal");
  // activeId is now the new pane
  if (activeId) setTimeout(() => window.shellfire.sendInput(activeId, command + "\n"), 150);
  showToast(`Running: ${command}`);
}

// ============================================================
