/**
 * @module renderer/250-quick-actions
 * @description Quick-action overlay that appears on terminal output: contextual buttons for common actions (open URL, copy path, explain error).
 */

// QUICK ACTIONS ON TERMINAL OUTPUT
// ============================================================
const quickActionMenuEl = document.createElement("div");
quickActionMenuEl.className = "quick-action-menu";
quickActionMenuEl.id = "quick-action-menu";
document.body.appendChild(quickActionMenuEl);

// Patterns for detection
const QA_PATTERNS = {
  ipv4: /\b(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})\b/,
  port: /(?:localhost|127\.0\.0\.1|0\.0\.0\.0):(\d{2,5})\b/,
  filepath: /(?:^|\s)((?:\/[\w.\-]+)+(?:\.[\w]+)?)/,
  dockerId: /\b([0-9a-f]{12,64})\b/,
  url: /https?:\/\/[^\s'">\]]+/,
  pid: /\bPID[:\s]+(\d{2,7})\b/i,
};

function detectQuickActions(text) {
  const actions = [];
  const trimmed = text.trim();
  if (!trimmed) return actions;

  // URL detection
  const urlMatch = trimmed.match(QA_PATTERNS.url);
  if (urlMatch) {
    actions.push({ type: "url", value: urlMatch[0], label: "Open URL", icon: "\uD83C\uDF10",
      action: () => window.open(urlMatch[0], "_blank") });
    actions.push({ type: "url", value: urlMatch[0], label: "Copy URL", icon: "\uD83D\uDCCB",
      action: () => { navigator.clipboard.writeText(urlMatch[0]); showToast("Copied URL"); } });
  }

  // IP address
  const ipMatch = trimmed.match(QA_PATTERNS.ipv4);
  if (ipMatch && !urlMatch) {
    const ip = ipMatch[1];
    actions.push({ type: "ip", value: ip, label: `Ping ${ip}`, icon: "\uD83C\uDFD3",
      action: async () => { const id = await addTerminal(); setTimeout(() => window.shellfire.sendInput(id, `ping -c 4 ${ip}\n`), 200); } });
    actions.push({ type: "ip", value: ip, label: `SSH to ${ip}`, icon: "\uD83D\uDD12",
      action: async () => { const id = await addTerminal(); setTimeout(() => window.shellfire.sendInput(id, `ssh ${ip}\n`), 200); } });
    actions.push({ type: "ip", value: ip, label: "Copy IP", icon: "\uD83D\uDCCB",
      action: () => { navigator.clipboard.writeText(ip); showToast("Copied IP"); } });
  }

  // Port (localhost:PORT pattern)
  const portMatch = trimmed.match(QA_PATTERNS.port);
  if (portMatch) {
    const port = portMatch[1];
    actions.push({ type: "port", value: `:${port}`, label: `Open localhost:${port}`, icon: "\uD83C\uDF10",
      action: () => window.open(`http://localhost:${port}`, "_blank") });
    actions.push({ type: "port", value: `:${port}`, label: `Kill process on :${port}`, icon: "\u274C",
      action: async () => {
        const ports = await window.shellfire.listPorts();
        const match = ports.find(p => p.port === port);
        if (match) { await window.shellfire.killPort(match.pid); showToast(`Killed PID ${match.pid}`); }
        else showToast("Process not found on this port");
      }});
  }

  // File path
  const pathMatch = trimmed.match(QA_PATTERNS.filepath);
  if (pathMatch && pathMatch[1].length > 3) {
    const fp = pathMatch[1];
    actions.push({ type: "path", value: fp, label: "Open in editor", icon: "\uD83D\uDCDD",
      action: () => window.shellfire.openInEditor(fp) });
    actions.push({ type: "path", value: fp, label: "Preview file", icon: "\uD83D\uDC41",
      action: () => showFilePreview(fp) });
    actions.push({ type: "path", value: fp, label: "cd to directory", icon: "\uD83D\uDCC2",
      action: () => {
        const dir = fp.replace(/\/[^/]+$/, "") || fp;
        if (activeId) window.shellfire.sendInput(activeId, `cd ${dir}\n`);
      }});
    actions.push({ type: "path", value: fp, label: "Copy path", icon: "\uD83D\uDCCB",
      action: () => { navigator.clipboard.writeText(fp); showToast("Copied path"); } });
  }

  // Docker container ID (12+ hex chars)
  const dockerMatch = trimmed.match(QA_PATTERNS.dockerId);
  if (dockerMatch && dockerMatch[1].length >= 12 && /^[0-9a-f]+$/.test(dockerMatch[1])) {
    const cid = dockerMatch[1].slice(0, 12);
    actions.push({ type: "container", value: cid, label: `Exec into ${cid}`, icon: "\uD83D\uDC33",
      action: async () => { const id = await addTerminal(); setTimeout(() => window.shellfire.sendInput(id, `docker exec -it ${cid} sh\n`), 200); } });
    actions.push({ type: "container", value: cid, label: `Logs ${cid}`, icon: "\uD83D\uDCDC",
      action: async () => { const id = await addTerminal(); setTimeout(() => window.shellfire.sendInput(id, `docker logs -f ${cid}\n`), 200); } });
    actions.push({ type: "container", value: cid, label: `Stop ${cid}`, icon: "\u23F9",
      action: async () => { const id = await addTerminal(); setTimeout(() => window.shellfire.sendInput(id, `docker stop ${cid}\n`), 200); } });
  }

  // PID
  const pidMatch = trimmed.match(QA_PATTERNS.pid);
  if (pidMatch) {
    const pid = pidMatch[1];
    actions.push({ type: "pid", value: `PID ${pid}`, label: `Kill PID ${pid}`, icon: "\u274C",
      action: async () => { await window.shellfire.killPort(pid); showToast(`Killed PID ${pid}`); } });
  }

  return actions;
}

function showQuickActionMenu(x, y, paneId) {
  const pane = panes.get(paneId);
  if (!pane) return;

  // Get selected text or try to get the line under cursor
  const selection = pane.term.getSelection();
  const text = selection || "";

  if (!text) return null; // No text selected, fall through to normal context menu

  const actions = detectQuickActions(text);
  if (actions.length === 0) return null; // No patterns detected

  quickActionMenuEl.innerHTML = "";

  // Header with detected type
  const typeLabel = actions[0].type.toUpperCase();
  const header = document.createElement("div");
  header.className = "quick-action-header";
  header.textContent = `DETECTED: ${typeLabel}`;
  quickActionMenuEl.appendChild(header);

  // Show the value
  const valueEl = document.createElement("div");
  valueEl.className = "quick-action-value";
  valueEl.textContent = actions[0].value;
  quickActionMenuEl.appendChild(valueEl);

  // Action items
  for (const act of actions) {
    const item = document.createElement("div");
    item.className = "quick-action-item";
    item.innerHTML = `<span class="qa-icon">${act.icon}</span><span>${act.label}</span>`;
    item.addEventListener("click", () => {
      quickActionMenuEl.classList.remove("visible");
      act.action();
    });
    quickActionMenuEl.appendChild(item);
  }

  quickActionMenuEl.classList.add("visible");
  // Position
  const menuRect = quickActionMenuEl.getBoundingClientRect();
  const viewW = window.innerWidth, viewH = window.innerHeight;
  const finalX = (x + menuRect.width > viewW) ? Math.max(0, viewW - menuRect.width - 4) : x;
  const finalY = (y + menuRect.height > viewH) ? Math.max(0, viewH - menuRect.height - 4) : y;
  quickActionMenuEl.style.left = finalX + "px";
  quickActionMenuEl.style.top = finalY + "px";
  return true; // Signal that we showed the quick action menu
}

// Close quick action menu on click
document.addEventListener("click", () => quickActionMenuEl.classList.remove("visible"));

// Hook into the existing context menu to add quick actions
const _origShowContextMenu = showContextMenu;
showContextMenu = function(x, y, paneId) {
  // Try quick actions first if there's a selection
  const pane = panes.get(paneId);
  if (pane) {
    const selection = pane.term.getSelection();
    if (selection && selection.trim().length > 2) {
      const actions = detectQuickActions(selection);
      if (actions.length > 0) {
        // Show combined menu: quick actions + regular items
        if (showQuickActionMenu(x, y, paneId)) return;
      }
    }
  }
  // Fall back to normal context menu
  _origShowContextMenu(x, y, paneId);
};

// ============================================================
