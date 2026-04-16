/**
 * @module renderer/110-session
 * @description Session persistence: saveCurrentSession (serialises pane layout + scrollback to JSON) and restoreSession (reconstructs panes from saved state on startup).
 */

// ============================================================
// SESSION
// ============================================================
async function saveCurrentSession(silent) {
  const paneStates = [];
  for (const [id] of panes) {
    const pane = panes.get(id);
    if (!pane) continue; // may have been removed during iteration
    // Fetch fresh CWD and process info (async IPC)
    try {
      pane._lastCwd = await window.shellfire.getCwd(id) || pane._lastCwd || null;
    } catch {}
    // Re-check pane still exists after each await
    if (!panes.get(id)) continue;
    try {
      const proc = await window.shellfire.getProcessTree(id);
      if (proc && proc.args) {
        const comm = (proc.comm || "").split("/").pop();
        if (comm && comm !== "zsh" && comm !== "bash" && comm !== "fish" && comm !== "sh") {
          pane._lastRestoreCmd = proc.args;
        } else {
          pane._lastRestoreCmd = null;
        }
      }
    } catch {}
    if (!panes.get(id)) continue;
    // Compact raw chunks into rawBuffer
    if (pane._rawChunks && pane._rawChunks.length > 0) {
      pane.rawBuffer = pane._rawChunks.join("").slice(-bufferLimit);
    }
    paneStates.push({
      cwd: pane._lastCwd || null,
      customName: pane.customName || null,
      userRenamed: pane._userRenamed || false,
      color: pane.color || "",
      termBg: pane.termBg || null,
      termFg: pane.termFg || null,
      locked: pane.locked || false,
      rawBuffer: pane.rawBuffer || "",
      restoreCmd: pane._lastRestoreCmd || null,
    });
  }
  window.shellfire.saveSession({
    version: 2,
    layout: JSON.parse(JSON.stringify(layout)),
    paneStates,
    theme: currentThemeIdx,
    themeName: (themes[currentThemeIdx] || themes[0]).name,
    fontSize: currentFontSize,
    broadcastMode,
    skipPermissions,
  });
  if (!silent) showToast("Session saved");
}

// Fast synchronous save for beforeunload — uses cached CWD/process, no async IPC
function saveCurrentSessionSync() {
  const paneStates = [];
  for (const [id] of panes) {
    const pane = panes.get(id);
    if (pane._rawChunks && pane._rawChunks.length > 0) {
      pane.rawBuffer = pane._rawChunks.join("").slice(-bufferLimit);
    }
    paneStates.push({
      cwd: pane._lastCwd || null,
      customName: pane.customName || null,
      userRenamed: pane._userRenamed || false,
      color: pane.color || "",
      termBg: pane.termBg || null,
      termFg: pane.termFg || null,
      locked: pane.locked || false,
      rawBuffer: pane.rawBuffer || "",
      restoreCmd: pane._lastRestoreCmd || null,
    });
  }
  window.shellfire.saveSession({
    version: 2,
    layout: JSON.parse(JSON.stringify(layout)),
    paneStates,
    theme: currentThemeIdx,
    themeName: (themes[currentThemeIdx] || themes[0]).name,
    fontSize: currentFontSize,
    broadcastMode,
    skipPermissions,
  });
}

async function restoreSession() {
  try {
    const session = await window.shellfire.loadSession();
    if (!session) {
      showToast("No saved session found");
      if (panes.size === 0) await addTerminal();
      return;
    }

    // Close existing panes
    for (const [id] of [...panes]) removeTerminal(id);

    // V2 format: full pane states with scrollback
    if (session.version === 2 && session.paneStates && session.paneStates.length > 0) {
      let failedCount = 0;
      for (const ps of session.paneStates) {
        let id;
        const hasBuffer = !!ps.rawBuffer;
        try { id = await createPaneObj(ps.cwd, ps.restoreCmd || null, hasBuffer); } catch (e) {
          console.error("Failed to restore pane:", e);
          failedCount++;
          continue;
        }
        const pane = panes.get(id);
        if (pane) {
          if (hasBuffer) {
            const sanitized = sanitizeReplayBuffer(ps.rawBuffer);
            pane.term.write(sanitized);
            pane.term.write(RESET_SEQ);
            pane.rawBuffer = ps.rawBuffer;
            pane._rawChunks = [ps.rawBuffer];
            pane._rawSize = ps.rawBuffer.length;
            pane._replayPending = false;
            if (pane._replayQueue) {
              for (const chunk of pane._replayQueue) pane.term.write(chunk);
              pane._replayQueue = null;
            }
          }
          // Restore pane metadata
          if (ps.customName) {
            pane.customName = ps.customName;
            pane.titleEl.textContent = ps.customName;
          }
          if (ps.color) {
            applyPaneColor(id, ps.color, ps.termBg || null, ps.termFg || null);
          }
          if (ps.locked) {
            pane.locked = true;
            pane.el.classList.add("locked");
            pane.el.querySelector(".lock-badge")?.classList.add("locked");
          }
        }
      }

      // Restore layout structure if it matches pane count
      if (session.layout && session.layout.length > 0) {
        const savedIds = [];
        for (const row of session.layout) {
          for (const col of row.cols) savedIds.push(col.paneId);
        }
        const currentIds = [...panes.keys()];
        if (savedIds.length === currentIds.length) {
          // Remap old pane IDs to new ones
          layout = JSON.parse(JSON.stringify(session.layout));
          for (let ri = 0; ri < layout.length; ri++) {
            for (let ci = 0; ci < layout[ri].cols.length; ci++) {
              const oldIdx = savedIds.indexOf(layout[ri].cols[ci].paneId);
              if (oldIdx >= 0 && oldIdx < currentIds.length) {
                layout[ri].cols[ci].paneId = currentIds[oldIdx];
              }
            }
          }
          renderLayout();
        } else {
          rebuildLayout();
        }
      } else {
        rebuildLayout();
      }

      // Restore global state
      if (session.broadcastMode) {
        broadcastMode = true;
        document.getElementById("broadcast-indicator").classList.add("visible");
        document.getElementById("btn-broadcast").classList.add("active-toggle");
      }
      if (session.skipPermissions) { skipPermissions = false; toggleSkipPermissions(); }

      const first = [...panes.keys()][0];
      if (first) setActive(first);
      const restoredCount = session.paneStates.length - failedCount;
      if (failedCount > 0) {
        showToast(`Session restored (${restoredCount}/${session.paneStates.length} panes — ${failedCount} failed)`, "error");
      } else {
        showToast(`Session restored (${restoredCount} panes with scrollback)`);
      }

    // V1 fallback: just cwds
    } else if (session.cwds && session.cwds.length > 0) {
      for (const cwd of session.cwds) {
        await createPaneObj(cwd);
      }
      const first = [...panes.keys()][0];
      if (first) setActive(first);
      rebuildLayout();
      showToast(`Session restored (${session.cwds.length} panes)`);
    } else {
      showToast("No saved session found");
      if (panes.size === 0) await addTerminal();
    }
  } catch (err) {
    console.error("Restore error:", err);
    showToast("Failed to restore session", "error");
    if (panes.size === 0) await addTerminal();
  }
}

// New terminal in same directory
async function addTerminalSameDir() {
  let cwd = null;
  if (activeId) { try { cwd = await window.shellfire.getCwd(activeId); } catch {} }
  await addTerminal(cwd);
}

// Reset layout to equal sizes
function resetLayout() {
  rebuildLayout();
  showToast("Layout reset");
}

