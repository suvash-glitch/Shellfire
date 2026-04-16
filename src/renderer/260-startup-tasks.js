/**
 * @module renderer/260-startup-tasks
 * @description Startup task manager: define sequences of commands to run automatically when Shellfire opens.
 */

// STARTUP TASKS
// ============================================================
let startupTasks = []; // { name, autoRun, steps: [{ cwd, command, delay }] }

async function loadStartupTasks() {
  try { const saved = await window.shellfire.loadStartupTasks(); if (Array.isArray(saved)) startupTasks = saved; } catch {}
}

function openStartupTasks() {
  document.getElementById("startup-tasks-overlay").classList.add("visible");
  renderStartupTasksList();
}

function closeStartupTasks() {
  document.getElementById("startup-tasks-overlay").classList.remove("visible");
  if (activeId && panes.has(activeId)) panes.get(activeId).term.focus();
}

function renderStartupTasksList() {
  const body = document.getElementById("startup-tasks-body");
  body.innerHTML = "";
  if (startupTasks.length === 0) {
    body.innerHTML = '<div class="startup-tasks-empty">No startup tasks defined.<br>Create one to auto-open panes and run commands on launch.</div>';
    return;
  }
  startupTasks.forEach((task, i) => {
    const stepDesc = task.steps.map(s => {
      const parts = [];
      if (s.cwd) parts.push(s.cwd.replace(/^\/Users\/[^/]+/, "~"));
      if (s.command) parts.push(s.command);
      return parts.join(": ") || "empty pane";
    }).join(" \u2192 ");

    const item = document.createElement("div");
    item.className = "startup-task-item";
    item.innerHTML = `
      <div class="startup-task-info">
        <div class="startup-task-name">${escapeHtml(task.name)}</div>
        <div class="startup-task-desc">${task.steps.length} pane${task.steps.length !== 1 ? "s" : ""}: ${escapeHtml(stepDesc)}</div>
      </div>
      ${task.autoRun ? '<span class="startup-task-auto">AUTO</span>' : ''}
      <div class="startup-task-actions">
        <button class="run" title="Run now">\u25B6</button>
        <button class="auto" title="Toggle auto-run">${task.autoRun ? "\u2713 Auto" : "Auto"}</button>
        <button class="edit" title="Edit">\u270E</button>
        <button class="danger" title="Delete">&times;</button>
      </div>
    `;
    item.querySelector(".run").addEventListener("click", (e) => { e.stopPropagation(); runStartupTask(task); });
    item.querySelector(".auto").addEventListener("click", (e) => {
      e.stopPropagation();
      task.autoRun = !task.autoRun;
      window.shellfire.saveStartupTasks(startupTasks);
      renderStartupTasksList();
      showToast(task.autoRun ? `"${task.name}" will auto-run on launch` : `"${task.name}" auto-run disabled`);
    });
    item.querySelector(".edit").addEventListener("click", (e) => { e.stopPropagation(); editStartupTask(i); });
    item.querySelector(".danger").addEventListener("click", (e) => {
      e.stopPropagation();
      startupTasks.splice(i, 1);
      window.shellfire.saveStartupTasks(startupTasks);
      renderStartupTasksList();
      showToast("Startup task deleted");
    });
    item.addEventListener("click", () => runStartupTask(task));
    body.appendChild(item);
  });
}

async function runStartupTask(task) {
  closeStartupTasks();
  showToast(`Running "${task.name}"...`);
  for (let si = 0; si < task.steps.length; si++) {
    const step = task.steps[si];
    const id = await addTerminal(step.cwd || null);
    if (step.command) {
      const delay = step.delay || 300;
      setTimeout(() => {
        if (panes.has(id)) window.shellfire.sendInput(id, step.command + "\n");
      }, delay);
    }
    // Small delay between panes to let them initialize
    if (si < task.steps.length - 1) await new Promise(r => setTimeout(r, 200));
  }
  showToast(`"${task.name}" started (${task.steps.length} panes)`);
}

function editStartupTask(index) {
  const isNew = index < 0;
  const task = isNew ? { name: "", autoRun: false, steps: [{ cwd: "", command: "", delay: 300 }] } : JSON.parse(JSON.stringify(startupTasks[index]));

  if (_paletteCleanup) { _paletteCleanup(); _paletteCleanup = null; }
  const overlay = document.getElementById("palette-overlay");
  const input = document.getElementById("palette-input");
  const results = document.getElementById("palette-results");
  overlay.classList.add("visible");
  input.placeholder = isNew ? "Task name (e.g., 'Dev Environment')..." : `Editing: ${task.name}`;
  input.value = task.name;
  input.focus();

  function renderEditor() {
    results.innerHTML = "";
    // Steps
    task.steps.forEach((step, si) => {
      const el = document.createElement("div");
      el.className = "palette-item";
      el.style.cssText = "flex-direction:column;align-items:stretch;padding:10px 18px;gap:6px";
      el.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center">
          <span style="font-size:10px;color:var(--t-fg);opacity:0.4;font-weight:600">PANE ${si + 1}</span>
          <button style="background:none;border:none;color:#ff453a;cursor:pointer;font-size:12px;padding:2px 6px" class="step-del">&times;</button>
        </div>
        <div style="display:flex;gap:6px">
          <input class="step-cwd" value="${escapeHtml(step.cwd || "")}" placeholder="Working directory (optional)" style="flex:1;background:var(--t-bg);border:1px solid var(--t-border);border-radius:4px;color:var(--t-fg);font-size:11px;padding:5px 8px;outline:none;font-family:'SF Mono',monospace" />
          <input class="step-cmd" value="${escapeHtml(step.command || "")}" placeholder="Command to run (optional)" style="flex:1;background:var(--t-bg);border:1px solid var(--t-border);border-radius:4px;color:var(--t-fg);font-size:11px;padding:5px 8px;outline:none;font-family:'SF Mono',monospace" />
        </div>
      `;
      el.querySelector(".step-cwd").addEventListener("change", (e) => { step.cwd = e.target.value.trim(); });
      el.querySelector(".step-cmd").addEventListener("change", (e) => { step.command = e.target.value.trim(); });
      el.querySelector(".step-del").addEventListener("click", () => {
        if (task.steps.length > 1) { task.steps.splice(si, 1); renderEditor(); }
      });
      results.appendChild(el);
    });

    // Add step button
    const addEl = document.createElement("div");
    addEl.className = "palette-item";
    addEl.style.cssText = "justify-content:center;color:var(--t-accent);font-size:12px";
    addEl.innerHTML = `<span>+ Add Pane</span>`;
    addEl.addEventListener("click", () => {
      task.steps.push({ cwd: "", command: "", delay: 300 });
      renderEditor();
    });
    results.appendChild(addEl);

    // Save button
    const saveEl = document.createElement("div");
    saveEl.className = "palette-item";
    saveEl.style.cssText = "justify-content:center;margin-top:8px;border-top:1px solid var(--t-border);padding-top:12px";
    saveEl.innerHTML = `<button style="background:var(--t-accent);border:none;color:#fff;padding:8px 24px;border-radius:6px;cursor:pointer;font-size:12px;font-weight:500">${isNew ? "Create Task" : "Save Changes"}</button>`;
    saveEl.querySelector("button").addEventListener("click", () => {
      // Read all step inputs
      const cwdInputs = results.querySelectorAll(".step-cwd");
      const cmdInputs = results.querySelectorAll(".step-cmd");
      cwdInputs.forEach((inp, i) => { if (task.steps[i]) task.steps[i].cwd = inp.value.trim(); });
      cmdInputs.forEach((inp, i) => { if (task.steps[i]) task.steps[i].command = inp.value.trim(); });

      task.name = input.value.trim() || `Task ${startupTasks.length + 1}`;
      if (isNew) startupTasks.push(task);
      else startupTasks[index] = task;
      window.shellfire.saveStartupTasks(startupTasks);
      overlay.classList.remove("visible");
      input.placeholder = "Type a command...";
      renderStartupTasksList();
      showToast(isNew ? `Created "${task.name}"` : `Updated "${task.name}"`);
    });
    results.appendChild(saveEl);
  }
  renderEditor();

  const handler = (e) => {
    if (e.key === "Escape") {
      overlay.classList.remove("visible");
      input.placeholder = "Type a command...";
      input.removeEventListener("keydown", handler);
    }
  };
  input.addEventListener("keydown", handler);
  _paletteCleanup = () => { input.removeEventListener("keydown", handler); };
}

document.getElementById("startup-add-btn").addEventListener("click", () => editStartupTask(-1));
document.getElementById("startup-close-btn").addEventListener("click", closeStartupTasks);
document.getElementById("startup-tasks-overlay").addEventListener("click", (e) => {
  if (e.target === document.getElementById("startup-tasks-overlay")) closeStartupTasks();
});

// Auto-run startup tasks on launch (called from INIT)
async function runAutoStartupTasks() {
  const autoTasks = startupTasks.filter(t => t.autoRun);
  if (autoTasks.length === 0) return false;
  for (const task of autoTasks) {
    await runStartupTask(task);
  }
  return true;
}

// ============================================================
