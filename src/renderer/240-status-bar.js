/**
 * @module renderer/240-status-bar
 * @description Status bar widgets: clock, Kubernetes context, AWS profile, Node.js version. Enhanced Picture-in-Picture floating terminal.
 */

// STATUS BAR WIDGETS (clock, k8s, AWS, node)
// ============================================================
const widgetClock = document.getElementById("widget-clock");
const widgetK8s = document.getElementById("widget-k8s");
const widgetAws = document.getElementById("widget-aws");
const widgetNode = document.getElementById("widget-node");

function updateClockWidget() {
  const now = new Date();
  const h = String(now.getHours()).padStart(2, "0");
  const m = String(now.getMinutes()).padStart(2, "0");
  const s = String(now.getSeconds()).padStart(2, "0");
  widgetClock.innerHTML = `<span class="widget-icon">\u23F0</span> ${h}:${m}:${s}`;
  widgetClock.classList.add("visible");
}
// Clock at 5 s — users rarely need sub-second precision in the status bar.
// Change to 1000 for a live clock if preferred.
setInterval(updateClockWidget, 5000);
updateClockWidget();

async function updateK8sWidget() {
  try {
    const ctx = await window.shellfire.getK8sContext();
    if (ctx) {
      widgetK8s.innerHTML = `<span class="widget-icon">\u2638</span> <span class="widget-label">${escapeHtml(ctx)}</span>`;
      widgetK8s.classList.add("visible");
    } else {
      widgetK8s.classList.remove("visible");
    }
  } catch { widgetK8s.classList.remove("visible"); }
}

async function updateAwsWidget() {
  try {
    const profile = await window.shellfire.getAwsProfile();
    if (profile) {
      widgetAws.innerHTML = `<span class="widget-icon">\u2601</span> <span class="widget-label">${escapeHtml(profile)}</span>`;
      widgetAws.classList.add("visible");
    } else {
      widgetAws.classList.remove("visible");
    }
  } catch { widgetAws.classList.remove("visible"); }
}

async function updateNodeWidget() {
  try {
    const ver = await window.shellfire.getNodeVersion();
    if (ver) {
      widgetNode.innerHTML = `<span class="widget-icon">\u25CF</span> ${escapeHtml(ver)}`;
      widgetNode.classList.add("visible");
    } else {
      widgetNode.classList.remove("visible");
    }
  } catch { widgetNode.classList.remove("visible"); }
}

// Refresh context-sensitive widgets periodically
setInterval(() => { updateK8sWidget(); updateAwsWidget(); }, 30000);
updateNodeWidget(); // once on startup

// ============================================================
// ENHANCED PIP (Picture-in-Picture)
// ============================================================
const _origToggleFloating = toggleFloating;
toggleFloating = function(id) {
  const targetId = id || activeId;
  if (!targetId) return;
  const pane = panes.get(targetId);
  if (!pane) return;

  if (floatingPanes.has(targetId)) {
    // Restore — remove PiP controls
    const controls = pane.el.querySelector(".pip-controls");
    if (controls) controls.remove();
    const slider = pane.el.querySelector(".pip-opacity-slider");
    if (slider) slider.remove();
    pane.el.style.opacity = "";
    pane.el.classList.remove("pip-compact");
    pane.el.classList.remove("floating");
    pane.el.style.width = "";
    pane.el.style.height = "";
    pane.el.style.left = "";
    pane.el.style.top = "";
    pane.el.style.right = "";
    pane.el.style.bottom = "";
    floatingPanes.delete(targetId);
    renderLayout();
    showToast("Pane restored");
  } else {
    // Float with enhanced PiP
    floatingPanes.add(targetId);
    pane.el.classList.add("floating");
    pane.el.style.width = "480px";
    pane.el.style.height = "320px";
    pane.el.style.right = "20px";
    pane.el.style.bottom = "50px";
    pane.el.style.left = "auto";
    pane.el.style.top = "auto";
    document.body.appendChild(pane.el);

    // Add PiP control bar
    const controls = document.createElement("div");
    controls.className = "pip-controls";
    controls.innerHTML = `
      <button class="pip-compact-btn" title="Compact mode">\u25A1</button>
      <button class="pip-snap-tl" title="Snap top-left">\u2196</button>
      <button class="pip-snap-tr" title="Snap top-right">\u2197</button>
      <button class="pip-snap-bl" title="Snap bottom-left">\u2199</button>
      <button class="pip-snap-br" title="Snap bottom-right">\u2198</button>
      <button class="pip-restore" title="Restore">\u21A9</button>
    `;
    controls.querySelector(".pip-compact-btn").addEventListener("click", (e) => {
      e.stopPropagation();
      pane.el.classList.toggle("pip-compact");
      if (pane.el.classList.contains("pip-compact")) {
        pane.el.style.width = "320px";
        pane.el.style.height = "200px";
      } else {
        pane.el.style.width = "480px";
        pane.el.style.height = "320px";
      }
      pane.fitAddon.fit();
    });
    const snapPositions = {
      "pip-snap-tl": { top: "50px", left: "20px", right: "auto", bottom: "auto" },
      "pip-snap-tr": { top: "50px", right: "20px", left: "auto", bottom: "auto" },
      "pip-snap-bl": { bottom: "50px", left: "20px", right: "auto", top: "auto" },
      "pip-snap-br": { bottom: "50px", right: "20px", left: "auto", top: "auto" },
    };
    for (const [cls, pos] of Object.entries(snapPositions)) {
      controls.querySelector(`.${cls}`).addEventListener("click", (e) => {
        e.stopPropagation();
        Object.assign(pane.el.style, pos);
      });
    }
    controls.querySelector(".pip-restore").addEventListener("click", (e) => {
      e.stopPropagation();
      toggleFloating(targetId);
    });
    pane.el.querySelector(".pane-header").after(controls);

    // Opacity slider
    const slider = document.createElement("input");
    slider.type = "range";
    slider.className = "pip-opacity-slider";
    slider.min = "30";
    slider.max = "100";
    slider.value = "100";
    slider.addEventListener("input", () => {
      pane.el.style.opacity = parseInt(slider.value) / 100;
    });
    pane.el.appendChild(slider);

    makeDraggable(pane.el, pane.el.querySelector(".pane-header"));
    pane.fitAddon.fit();
    showToast("PiP mode — drag to move, use controls to snap");
  }
};

// ============================================================
