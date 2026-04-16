/**
 * @module renderer/170-pipeline
 * @description Pipeline visual editor: node graph with pan/zoom, edge drag, topological sort, inline step prompts, and pipeline execution.
 */

// ============================================================
// PIPELINE VISUAL EDITOR (Mindmap)
// ============================================================
const plPanel = document.getElementById("pipeline-panel");
const plCanvas = document.getElementById("pipeline-canvas");
const plSvg = document.getElementById("pipeline-svg");
const plWrap = document.getElementById("pipeline-canvas-wrap");
let pipelines = [];
let plNodes = []; // {id, command, status, output, x, y}
let plEdges = []; // {from, to}
let plName = "Untitled";
let plRunning = false;
let plSelectedId = null;
let plNextId = 1;
// Pan & zoom state
let plPanX = 0, plPanY = 0, plZoom = 1;
let plIsPanning = false, plPanStartX = 0, plPanStartY = 0;
let plDragNode = null, plDragOffX = 0, plDragOffY = 0;

function openPipelinePanel() {
  plPanel.classList.add("visible");
  plRender();
  if (plNodes.length === 0) plCenterView();
}

function plCenterView() { plPanX = (plWrap.clientWidth / 2) - 120; plPanY = 60; plZoom = 1; plApplyTransform(); }

function plApplyTransform() {
  plCanvas.style.transform = `translate(${plPanX}px, ${plPanY}px) scale(${plZoom})`;
  plCanvas.style.transformOrigin = "0 0";
  plSvg.style.transform = `translate(${plPanX}px, ${plPanY}px) scale(${plZoom})`;
  plSvg.style.transformOrigin = "0 0";
  const label = document.getElementById("pipeline-zoom-label");
  if (label) label.textContent = Math.round(plZoom * 100) + "%";
}

// --- Pan ---
plWrap.addEventListener("pointerdown", (e) => {
  if (e.target === plWrap || e.target === plCanvas) {
    plIsPanning = true; plPanStartX = e.clientX - plPanX; plPanStartY = e.clientY - plPanY;
    plWrap.classList.add("grabbing"); plWrap.setPointerCapture(e.pointerId);
  }
});
plWrap.addEventListener("pointermove", (e) => {
  if (plIsPanning) { plPanX = e.clientX - plPanStartX; plPanY = e.clientY - plPanStartY; plApplyTransform(); }
  if (plDragNode) {
    const rect = plWrap.getBoundingClientRect();
    const x = (e.clientX - rect.left - plPanX) / plZoom - plDragOffX;
    const y = (e.clientY - rect.top - plPanY) / plZoom - plDragOffY;
    plDragNode.x = x; plDragNode.y = y;
    // Fast path: update only the dragged node position and connected edges
    const el = document.getElementById("pl-node-" + plDragNode.id);
    if (el) { el.style.left = x + "px"; el.style.top = y + "px"; }
    plUpdateEdgesFor(plDragNode.id);
  }
});
plWrap.addEventListener("pointerup", () => {
  if (plDragNode) {
    const el = document.getElementById("pl-node-" + plDragNode.id);
    if (el) el.classList.remove("dragging");
  }
  plIsPanning = false; plDragNode = null; plWrap.classList.remove("grabbing");
});

// --- Zoom ---
plWrap.addEventListener("wheel", (e) => {
  e.preventDefault();
  const rect = plWrap.getBoundingClientRect();
  const mx = e.clientX - rect.left, my = e.clientY - rect.top;
  const oldZoom = plZoom;
  plZoom = Math.min(3, Math.max(0.2, plZoom * (e.deltaY < 0 ? 1.08 : 0.92)));
  plPanX = mx - (mx - plPanX) * (plZoom / oldZoom);
  plPanY = my - (my - plPanY) * (plZoom / oldZoom);
  plApplyTransform();
}, { passive: false });

// --- Edge geometry helper ---
function plEdgePath(fromN, toN) {
  const fromEl = document.getElementById("pl-node-" + fromN.id);
  const toEl = document.getElementById("pl-node-" + toN.id);
  const fw = fromEl ? fromEl.offsetWidth : 200, fh = fromEl ? fromEl.offsetHeight : 60;
  const tw = toEl ? toEl.offsetWidth : 200;
  const x1 = fromN.x + fw / 2, y1 = fromN.y + fh;
  const x2 = toN.x + tw / 2, y2 = toN.y;
  const dy = Math.abs(y2 - y1);
  const cy1 = y1 + Math.max(dy * 0.4, 30), cy2 = y2 - Math.max(dy * 0.4, 30);
  return `M${x1},${y1} C${x1},${cy1} ${x2},${cy2} ${x2},${y2}`;
}

// Fast update: only recompute SVG paths touching a given node
function plUpdateEdgesFor(nodeId) {
  for (const edge of plEdges) {
    if (edge.from !== nodeId && edge.to !== nodeId) continue;
    const fromN = plNodes.find(n => n.id === edge.from);
    const toN = plNodes.find(n => n.id === edge.to);
    if (!fromN || !toN) continue;
    const pathEl = plSvg.querySelector(`path[data-from="${edge.from}"][data-to="${edge.to}"]`);
    if (pathEl) pathEl.setAttribute("d", plEdgePath(fromN, toN));
  }
}

// --- Render ---
function plRender() {
  // Ensure SVG defs exist
  if (!plSvg.querySelector("defs")) {
    const defs = document.createElementNS("http://www.w3.org/2000/svg", "defs");
    defs.innerHTML = '<marker id="pl-arrow" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto"><polygon points="0 0, 8 3, 0 6" class="pl-edge-arrow"/></marker>'
      + '<marker id="pl-arrow-pass" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto"><polygon points="0 0, 8 3, 0 6" class="pl-edge-arrow passed"/></marker>'
      + '<marker id="pl-arrow-run" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto"><polygon points="0 0, 8 3, 0 6" class="pl-edge-arrow running"/></marker>'
      + '<marker id="pl-arrow-fail" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto"><polygon points="0 0, 8 3, 0 6" class="pl-edge-arrow failed"/></marker>';
    plSvg.appendChild(defs);
  }

  // Sync edge paths (add/remove/update)
  const edgeSet = new Set(plEdges.map(e => e.from + "-" + e.to));
  plSvg.querySelectorAll("path.pl-edge").forEach(p => {
    const key = p.dataset.from + "-" + p.dataset.to;
    if (!edgeSet.has(key)) p.remove();
  });
  for (const edge of plEdges) {
    const fromN = plNodes.find(n => n.id === edge.from);
    const toN = plNodes.find(n => n.id === edge.to);
    if (!fromN || !toN) continue;
    let pathEl = plSvg.querySelector(`path[data-from="${edge.from}"][data-to="${edge.to}"]`);
    if (!pathEl) {
      pathEl = document.createElementNS("http://www.w3.org/2000/svg", "path");
      pathEl.dataset.from = edge.from; pathEl.dataset.to = edge.to;
      plSvg.appendChild(pathEl);
    }
    pathEl.setAttribute("d", plEdgePath(fromN, toN));
    const cls = toN.status === "passed" ? "passed" : toN.status === "running" ? "running" : toN.status === "failed" ? "failed" : "";
    const marker = cls === "passed" ? "pl-arrow-pass" : cls === "running" ? "pl-arrow-run" : cls === "failed" ? "pl-arrow-fail" : "pl-arrow";
    pathEl.setAttribute("class", "pl-edge " + cls);
    pathEl.setAttribute("marker-end", "url(#" + marker + ")");
  }

  // Render nodes
  const existingIds = new Set(plNodes.map(n => n.id));
  // Remove stale nodes
  plCanvas.querySelectorAll(".pl-node").forEach(el => {
    const id = parseInt(el.dataset.nid);
    if (!existingIds.has(id)) el.remove();
  });

  for (const node of plNodes) {
    let el = document.getElementById("pl-node-" + node.id);
    if (!el) {
      el = document.createElement("div");
      el.className = "pl-node";
      el.id = "pl-node-" + node.id;
      el.dataset.nid = node.id;
      el.innerHTML = `
        <div class="pl-node-port-in" title="Drop connection here"></div>
        <div class="pl-node-actions">
          <button class="pl-node-del" title="Delete">&times;</button>
        </div>
        <div class="pl-node-header">
          <div class="pl-node-dot"></div>
          <span class="pl-node-idx"></span>
          <span class="pl-node-status"></span>
        </div>
        <div class="pl-node-body"></div>
        <div class="pl-node-output"></div>
        <div class="pl-node-port" title="Drag to connect"></div>
      `;
      // Drag node
      el.addEventListener("pointerdown", (e) => {
        if (e.target.closest(".pl-node-del") || e.target.closest(".pl-node-port") || e.target.closest(".pl-node-port-in") || e.target.closest(".pl-node-body[contenteditable=true]")) return;
        e.stopPropagation();
        plDragNode = node;
        el.classList.add("dragging");
        const rect = plWrap.getBoundingClientRect();
        plDragOffX = (e.clientX - rect.left - plPanX) / plZoom - node.x;
        plDragOffY = (e.clientY - rect.top - plPanY) / plZoom - node.y;
        plSelectNode(node.id);
      });
      // Delete
      el.querySelector(".pl-node-del").addEventListener("click", (e) => {
        e.stopPropagation();
        plNodes = plNodes.filter(n => n.id !== node.id);
        plEdges = plEdges.filter(edge => edge.from !== node.id && edge.to !== node.id);
        if (plSelectedId === node.id) plSelectedId = null;
        plRender();
      });
      // Double-click to edit command
      el.querySelector(".pl-node-body").addEventListener("dblclick", (e) => {
        if (plRunning) return;
        const body = e.currentTarget;
        body.contentEditable = "true";
        body.focus();
        // Select all text
        const range = document.createRange(); range.selectNodeContents(body);
        const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(range);
      });
      el.querySelector(".pl-node-body").addEventListener("blur", (e) => {
        e.currentTarget.contentEditable = "false";
        node.command = e.currentTarget.textContent.trim();
      });
      el.querySelector(".pl-node-body").addEventListener("keydown", (e) => {
        if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); e.currentTarget.blur(); }
        if (e.key === "Escape") { e.currentTarget.textContent = node.command; e.currentTarget.blur(); }
      });
      // Click output to toggle
      el.querySelector(".pl-node-header").addEventListener("click", () => {
        const out = el.querySelector(".pl-node-output");
        if (node.output) out.classList.toggle("visible");
      });
      // Port drag for connections
      const port = el.querySelector(".pl-node-port");
      port.addEventListener("pointerdown", (e) => {
        e.stopPropagation();
        plStartEdgeDrag(node.id, e);
      });
      plCanvas.appendChild(el);
    }
    // Update position & content
    el.style.left = node.x + "px"; el.style.top = node.y + "px";
    el.className = "pl-node" + (node.status !== "pending" ? " " + node.status : "") + (plSelectedId === node.id ? " selected" : "");
    const execOrder = plGetExecutionOrder();
    const idx = execOrder ? execOrder.indexOf(node.id) : -1;
    el.querySelector(".pl-node-idx").textContent = idx >= 0 ? "#" + (idx + 1) : "";
    el.querySelector(".pl-node-status").textContent = node.status === "pending" ? "" : node.status;
    const body = el.querySelector(".pl-node-body");
    if (body.contentEditable !== "true") body.textContent = node.command;
    const output = el.querySelector(".pl-node-output");
    output.textContent = node.output || "";
    if (node.output && (node.status === "failed" || node.status === "passed")) output.classList.add("visible");
  }
  // Update title
  document.getElementById("pipeline-title").textContent = plName || "Untitled Pipeline";
}

// --- Edge drag ---
let plEdgeDragFrom = null, plEdgeTempPath = null, plDropTarget = null;
const PL_DROP_PADDING = 40; // generous hit zone around nodes

function plFindDropTarget(mx, my, fromId) {
  let best = null, bestDist = Infinity;
  for (const n of plNodes) {
    if (n.id === fromId) continue;
    const nel = document.getElementById("pl-node-" + n.id);
    const nw = nel ? nel.offsetWidth : 200, nh = nel ? nel.offsetHeight : 60;
    // Check within padded bounds
    if (mx >= n.x - PL_DROP_PADDING && mx <= n.x + nw + PL_DROP_PADDING &&
        my >= n.y - PL_DROP_PADDING && my <= n.y + nh + PL_DROP_PADDING) {
      // Distance to center of input port (top center)
      const cx = n.x + nw / 2, cy = n.y;
      const dist = Math.hypot(mx - cx, my - cy);
      if (dist < bestDist) { bestDist = dist; best = n; }
    }
  }
  return best;
}

function plStartEdgeDrag(fromId, e) {
  plEdgeDragFrom = fromId;
  plEdgeTempPath = document.createElementNS("http://www.w3.org/2000/svg", "path");
  plEdgeTempPath.setAttribute("class", "pl-edge-temp");
  plSvg.appendChild(plEdgeTempPath);
  const fromN = plNodes.find(n => n.id === fromId);
  const fromEl = document.getElementById("pl-node-" + fromId);
  const fw = fromEl ? fromEl.offsetWidth : 200, fh = fromEl ? fromEl.offsetHeight : 60;
  const startX = fromN.x + fw / 2, startY = fromN.y + fh;

  const onMove = (ev) => {
    const rect = plWrap.getBoundingClientRect();
    const mx = (ev.clientX - rect.left - plPanX) / plZoom;
    const my = (ev.clientY - rect.top - plPanY) / plZoom;
    // Snap to target input port if hovering near a node
    let endX = mx, endY = my;
    const target = plFindDropTarget(mx, my, fromId);
    // Update drop target highlight
    if (plDropTarget !== target) {
      if (plDropTarget) {
        const oldEl = document.getElementById("pl-node-" + plDropTarget.id);
        if (oldEl) oldEl.classList.remove("drop-target");
      }
      plDropTarget = target;
      if (target) {
        const tEl = document.getElementById("pl-node-" + target.id);
        if (tEl) tEl.classList.add("drop-target");
        const tw = tEl ? tEl.offsetWidth : 200;
        endX = target.x + tw / 2; endY = target.y;
      }
    } else if (target) {
      const tEl = document.getElementById("pl-node-" + target.id);
      const tw = tEl ? tEl.offsetWidth : 200;
      endX = target.x + tw / 2; endY = target.y;
    }
    // Draw curved temp path
    const dy = Math.abs(endY - startY);
    const cy1 = startY + Math.max(dy * 0.4, 30), cy2 = endY - Math.max(dy * 0.4, 30);
    plEdgeTempPath.setAttribute("d", `M${startX},${startY} C${startX},${cy1} ${endX},${cy2} ${endX},${endY}`);
  };

  const onUp = (ev) => {
    document.removeEventListener("pointermove", onMove);
    document.removeEventListener("pointerup", onUp);
    if (plEdgeTempPath) { plEdgeTempPath.remove(); plEdgeTempPath = null; }
    // Clear drop target highlight
    if (plDropTarget) {
      const oldEl = document.getElementById("pl-node-" + plDropTarget.id);
      if (oldEl) oldEl.classList.remove("drop-target");
    }
    const rect = plWrap.getBoundingClientRect();
    const mx = (ev.clientX - rect.left - plPanX) / plZoom;
    const my = (ev.clientY - rect.top - plPanY) / plZoom;
    const target = plFindDropTarget(mx, my, fromId);
    if (target && !plEdges.find(e => e.from === fromId && e.to === target.id)) {
      plEdges.push({ from: fromId, to: target.id });
      plRender();
    }
    plDropTarget = null;
    plEdgeDragFrom = null;
  };
  document.addEventListener("pointermove", onMove);
  document.addEventListener("pointerup", onUp);
}

function plSelectNode(id) { plSelectedId = id; plRender(); }

// --- Get execution order (topological sort with cycle detection) ---
function plGetExecutionOrder() {
  const inDeg = {}; const adj = {};
  for (const n of plNodes) { inDeg[n.id] = 0; adj[n.id] = []; }
  for (const e of plEdges) {
    if (adj[e.from]) adj[e.from].push(e.to);
    if (inDeg[e.to] !== undefined) inDeg[e.to]++;
  }
  const queue = plNodes.filter(n => inDeg[n.id] === 0).map(n => n.id);
  const order = [];
  while (queue.length) {
    const curr = queue.shift(); order.push(curr);
    for (const next of (adj[curr] || [])) {
      inDeg[next]--;
      if (inDeg[next] === 0) queue.push(next);
    }
  }
  // Cycle detection: if not all nodes are in order, there's a cycle
  if (order.length < plNodes.length) {
    showToast("Pipeline has a cycle — cannot execute", "error");
    return null;
  }
  return order;
}

// --- Inline prompt for pipeline ---
function plPrompt(label, defaultVal) {
  return new Promise((resolve) => {
    let existing = plWrap.querySelector(".pl-load-modal");
    if (existing) existing.remove();
    const modal = document.createElement("div");
    modal.className = "pl-load-modal";
    modal.innerHTML = `<h4>${escapeHtml(label)}</h4>
      <input type="text" id="pl-prompt-input" value="${escapeHtml(defaultVal || "")}" style="width:100%;padding:8px 10px;border-radius:6px;border:1px solid var(--t-border);background:var(--t-bg);color:var(--t-fg);font-size:13px;font-family:'SF Mono',monospace;outline:none;margin-bottom:10px" />
      <div style="display:flex;gap:6px;justify-content:flex-end">
        <button class="pl-tb-btn" id="pl-prompt-cancel">Cancel</button>
        <button class="pl-tb-btn pl-tb-run" id="pl-prompt-ok" style="background:color-mix(in srgb, var(--t-accent) 15%, transparent);border-color:color-mix(in srgb, var(--t-accent) 30%, transparent);color:var(--t-accent)">OK</button>
      </div>`;
    plWrap.appendChild(modal);
    const input = document.getElementById("pl-prompt-input");
    input.focus();
    input.select();
    const cleanup = (val) => { modal.remove(); resolve(val); };
    document.getElementById("pl-prompt-ok").addEventListener("click", () => cleanup(input.value.trim()));
    document.getElementById("pl-prompt-cancel").addEventListener("click", () => cleanup(null));
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") cleanup(input.value.trim());
      if (e.key === "Escape") cleanup(null);
    });
  });
}

// --- Add step ---
document.getElementById("pipeline-add-btn").addEventListener("click", async () => {
  const cmd = await plPrompt("Command:", "");
  if (!cmd) return;
  const lastNode = plNodes.length > 0 ? plNodes[plNodes.length - 1] : null;
  const x = lastNode ? lastNode.x : 0;
  const y = lastNode ? lastNode.y + 100 : 0;
  const newNode = { id: plNextId++, command: cmd, status: "pending", output: "", x, y };
  plNodes.push(newNode);
  if (lastNode) plEdges.push({ from: lastNode.id, to: newNode.id });
  plRender();
});

// --- Run pipeline ---
document.getElementById("pipeline-run").addEventListener("click", async () => {
  if (plRunning) return;
  plRunning = true;
  document.getElementById("pipeline-run").style.display = "none";
  document.getElementById("pipeline-stop").style.display = "";

  // Reset statuses
  plNodes.forEach(n => { n.status = "pending"; n.output = ""; });
  plRender();

  const order = plGetExecutionOrder();
  if (!order) return; // Cycle detected
  let failed = false;
  for (const nid of order) {
    const node = plNodes.find(n => n.id === nid);
    if (!node) continue;
    if (failed) { node.status = "skipped"; plRender(); continue; }
    node.status = "running"; plRender();
    try {
      const result = await window.shellfire.execPipelineStep({ command: node.command });
      node.output = (result.stdout || "") + (result.stderr ? "\n--- stderr ---\n" + result.stderr : "");
      node.status = result.code === 0 ? "passed" : "failed";
      if (result.code !== 0) failed = true;
    } catch (err) {
      node.output = err.message || "Unknown error";
      node.status = "failed"; failed = true;
    }
    plRender();
    if (!plRunning) break; // stopped
  }

  plRunning = false;
  document.getElementById("pipeline-run").style.display = "";
  document.getElementById("pipeline-stop").style.display = "none";
  showToast(failed ? "Pipeline failed" : "Pipeline completed successfully");
});

document.getElementById("pipeline-stop").addEventListener("click", () => { plRunning = false; });

// --- Save ---
document.getElementById("pipeline-save").addEventListener("click", async () => {
  const name = await plPrompt("Pipeline name:", plName || "Untitled");
  if (!name) return;
  plName = name;
  const toSave = {
    name,
    nodes: plNodes.map(n => ({ id: n.id, command: n.command, x: n.x, y: n.y })),
    edges: plEdges.slice(),
    // Keep legacy steps format for compatibility
    steps: plNodes.map(n => ({ command: n.command, status: "pending", output: "" })),
  };
  const existing = pipelines.findIndex(p => p.name === name);
  if (existing >= 0) pipelines[existing] = toSave;
  else pipelines.push(toSave);
  await window.shellfire.savePipelines(pipelines);
  plRender();
  showToast(`Pipeline "${name}" saved`);
});

// --- Load ---
document.getElementById("pipeline-load").addEventListener("click", async () => {
  pipelines = await window.shellfire.loadPipelines() || [];
  if (pipelines.length === 0) { showToast("No saved pipelines"); return; }
  // Show load modal
  let existing = plWrap.querySelector(".pl-load-modal");
  if (existing) existing.remove();
  const modal = document.createElement("div");
  modal.className = "pl-load-modal";
  let html = '<h4>Load Pipeline</h4>';
  pipelines.forEach((p, i) => {
    const stepCount = p.nodes ? p.nodes.length : (p.steps ? p.steps.length : 0);
    html += `<div class="pl-load-item" data-idx="${i}">
      <div><div class="pl-load-item-name">${escapeHtml(p.name)}</div>
      <div class="pl-load-item-steps">${stepCount} step${stepCount !== 1 ? "s" : ""}</div></div>
      <button class="pl-load-item-del" data-delidx="${i}" title="Delete">&times;</button>
    </div>`;
  });
  html += '<div style="text-align:right;margin-top:8px"><button class="pl-tb-btn" id="pl-load-cancel">Cancel</button></div>';
  modal.innerHTML = html;
  plWrap.appendChild(modal);

  modal.addEventListener("click", async (e) => {
    // Delete pipeline
    const delBtn = e.target.closest("[data-delidx]");
    if (delBtn) {
      e.stopPropagation();
      const di = parseInt(delBtn.dataset.delidx);
      pipelines.splice(di, 1);
      await window.shellfire.savePipelines(pipelines);
      modal.remove();
      document.getElementById("pipeline-load").click(); // re-open
      return;
    }
    // Load pipeline
    const item = e.target.closest(".pl-load-item");
    if (item) {
      const idx = parseInt(item.dataset.idx);
      const p = pipelines[idx];
      plName = p.name;
      if (p.nodes) {
        // New format with positions
        plNodes = p.nodes.map(n => ({ id: n.id, command: n.command, x: n.x, y: n.y, status: "pending", output: "" }));
        plEdges = (p.edges || []).slice();
        plNextId = Math.max(...plNodes.map(n => n.id), 0) + 1;
      } else if (p.steps) {
        // Legacy format — lay out vertically
        plNodes = p.steps.map((s, i) => ({ id: i + 1, command: s.command, x: 0, y: i * 100, status: "pending", output: "" }));
        plEdges = plNodes.slice(1).map((n, i) => ({ from: plNodes[i].id, to: n.id }));
        plNextId = plNodes.length + 1;
      }
      modal.remove();
      plCenterView();
      plRender();
      showToast(`Loaded "${plName}"`);
      return;
    }
    // Cancel
    if (e.target.id === "pl-load-cancel") modal.remove();
  });
});

// --- Import .sh ---
document.getElementById("pipeline-import-sh").addEventListener("click", async () => {
  const result = await window.shellfire.pickShFile();
  if (!result || result.canceled) return;

  // Parse shell script into commands
  const lines = result.content.split("\n");
  const commands = [];
  let multiLine = "";
  for (const raw of lines) {
    const trimmed = raw.trim();
    // Skip empty lines, comments, and shebang
    if (!trimmed || trimmed.startsWith("#")) continue;
    // Handle line continuations (trailing backslash)
    if (trimmed.endsWith("\\")) {
      multiLine += trimmed.slice(0, -1).trim() + " ";
      continue;
    }
    if (multiLine) {
      commands.push(multiLine + trimmed);
      multiLine = "";
    } else {
      commands.push(trimmed);
    }
  }
  if (multiLine) commands.push(multiLine.trim());
  if (commands.length === 0) { showToast("No commands found in script"); return; }

  // Create pipeline nodes laid out vertically
  plNodes = []; plEdges = []; plSelectedId = null;
  plNextId = 1;
  plName = result.name || "Imported Script";
  for (let i = 0; i < commands.length; i++) {
    plNodes.push({ id: plNextId++, command: commands[i], status: "pending", output: "", x: 0, y: i * 120 });
  }
  // Chain nodes sequentially
  for (let i = 1; i < plNodes.length; i++) {
    plEdges.push({ from: plNodes[i - 1].id, to: plNodes[i].id });
  }
  plCenterView();
  plRender();
  showToast(`Imported ${commands.length} steps from "${result.name}.sh"`);
});

// --- Export .sh ---
document.getElementById("pipeline-export-sh").addEventListener("click", async () => {
  const order = plGetExecutionOrder();
  if (!order || order.length === 0) { showToast("No steps to export"); return; }
  const lines = ["#!/bin/bash", `# Pipeline: ${plName}`, "set -e", ""];
  for (const id of order) {
    const node = plNodes.find(n => n.id === id);
    if (node) lines.push(node.command);
  }
  lines.push("");
  const content = lines.join("\n");
  const fileName = (plName || "pipeline").replace(/[^a-zA-Z0-9_-]/g, "_") + ".sh";
  const saved = await window.shellfire.exportSh(content, fileName);
  if (saved) showToast(`Exported to ${saved}`);
});

// --- Clear ---
document.getElementById("pipeline-clear").addEventListener("click", () => {
  plNodes = []; plEdges = []; plSelectedId = null; plNextId = 1; plName = "Untitled";
  plRender();
  showToast("Pipeline cleared");
});

// --- Close ---
document.getElementById("pipeline-close").addEventListener("click", () => {
  plPanel.classList.remove("visible");
  if (activeId && panes.has(activeId)) panes.get(activeId).term.focus();
});

// --- Title rename ---
document.getElementById("pipeline-title").addEventListener("click", async () => {
  const name = await plPrompt("Pipeline name:", plName);
  if (name) { plName = name; plRender(); }
});

// --- Keyboard shortcuts inside pipeline editor ---
plPanel.addEventListener("keydown", (e) => {
  if (e.target.contentEditable === "true" || e.target.tagName === "INPUT") return;
  if ((e.key === "Delete" || e.key === "Backspace") && plSelectedId) {
    plNodes = plNodes.filter(n => n.id !== plSelectedId);
    plEdges = plEdges.filter(edge => edge.from !== plSelectedId && edge.to !== plSelectedId);
    plSelectedId = null; plRender();
  }
  if (e.key === "Escape") plPanel.classList.remove("visible");
});

// Deselect when clicking canvas background
plCanvas.addEventListener("click", (e) => {
  if (e.target === plCanvas) { plSelectedId = null; plRender(); }
});

async function loadPipelinesData() {
  pipelines = await window.shellfire.loadPipelines() || [];
}

// ============================================================
// COMMAND BOOKMARKS
