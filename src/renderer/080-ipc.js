// ============================================================
// IPC
// ============================================================

window.shellfire.onData((id, data) => {
  const pane = panes.get(id);
  if (!pane) return;
  // While replaying saved buffer, queue incoming PTY data to prevent interleaving
  if (pane._replayPending) {
    if (!pane._replayQueue) pane._replayQueue = [];
    pane._replayQueue.push(data);
    return;
  }
  pane.term.write(data);
  // Accumulate raw output for session restore using chunked array
  if (!pane._rawChunks) pane._rawChunks = [];
  pane._rawChunks.push(data);
  pane._rawSize = (pane._rawSize || 0) + data.length;
  // Compact when over limit or too many chunks (prevent unbounded array growth)
  if (pane._rawSize > bufferLimit || pane._rawChunks.length > 500) {
    const joined = pane._rawChunks.join("");
    pane.rawBuffer = joined.slice(-bufferLimit);
    pane._rawChunks = [pane.rawBuffer];
    pane._rawSize = pane.rawBuffer.length;
  }
  // Activity dot for inactive panes
  if (id !== activeId && pane.activityDot) pane.activityDot.classList.add("visible");
  // Keyword watcher
  checkKeywords(id, data);
  // AI Error detection
  if (typeof detectErrors === "function") detectErrors(id, data);
  // Terminal logging
  if (loggingPanes.has(id)) {
    window.shellfire.logAppend(id, data.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "")); // strip ANSI
  }
});
window.shellfire.onExit((id, exitCode) => {
  const pane = panes.get(id); if (!pane) return;
  pane.term.write("\r\n\x1b[90m[Process exited]\x1b[0m\r\n");
  const name = pane.customName || `Terminal ${id}`;
  if (id !== activeId || !document.hasFocus()) {
    window.shellfire.notify("Process Finished", `${name} exited (code ${exitCode || 0})`);
    showToast(`${name} exited`);
  }
  setTimeout(() => removeTerminal(id), 1500);
});

