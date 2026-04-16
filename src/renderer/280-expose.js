/**
 * @module renderer/280-expose
 * @description Exposes renderer internals to the CLI/MCP socket layer (window.__panes, window.__activeId, window.__setActive, window.__createPane, window.__removeTerminal) and handles the auto-update notification banner.
 */

// EXPOSE INTERNALS FOR CLI MULTIPLEXER SOCKET
// ============================================================
window.__panes = panes;
Object.defineProperty(window, "__activeId", {
  get() { return activeId; },
  configurable: true,
});
window.__setActive = (id) => { setActive(id); };
window.__createPane = async (cwd) => { return await addTerminal(cwd); };
window.__removeTerminal = (id) => { removeTerminal(id); };

// ============================================================
// AUTO-UPDATE NOTIFICATION UI
// ============================================================
const updateIndicator = document.getElementById("update-indicator");
const updateBanner = document.getElementById("update-banner");
const updateBannerText = document.getElementById("update-banner-text");
const updateBannerBtn = document.getElementById("update-banner-btn");
const updateBannerDismiss = document.getElementById("update-banner-dismiss");
let _updateVersion = null;
let _updateState = null; // "available" | "downloading" | "downloaded"

function showUpdateBanner(text, btnLabel, btnAction) {
  updateBannerText.textContent = text;
  updateBannerBtn.textContent = btnLabel;
  updateBannerBtn.onclick = btnAction;
  updateBanner.classList.add("visible");
}

function hideUpdateBanner() {
  updateBanner.classList.remove("visible");
}

function updateIndicatorState(state, label) {
  updateIndicator.className = "update-indicator visible " + state;
  updateIndicator.textContent = label;
}

updateBannerDismiss.addEventListener("click", hideUpdateBanner);

updateIndicator.addEventListener("click", () => {
  if (_updateState === "available") {
    showUpdateBanner(
      `v${_updateVersion} available`,
      "Download",
      () => { window.shellfire.downloadUpdate(); }
    );
  } else if (_updateState === "downloaded") {
    showUpdateBanner(
      `v${_updateVersion} ready`,
      "Restart to Update",
      () => { window.shellfire.installUpdate(); }
    );
  } else if (_updateState === "downloading") {
    showToast("Downloading update...");
  }
});

window.shellfire.onUpdateStatus((data) => {
  switch (data.status) {
    case "available":
      _updateVersion = data.version;
      _updateState = "available";
      updateIndicatorState("available", "\u2B06 v" + data.version);
      showUpdateBanner(
        `Update v${data.version} is available`,
        "Download",
        () => { window.shellfire.downloadUpdate(); }
      );
      showToast(`Update available: v${data.version}`);
      break;
    case "downloading":
      _updateState = "downloading";
      updateIndicatorState("downloading", "\u2B07 " + (data.percent || 0) + "%");
      updateBannerText.textContent = "Downloading... " + (data.percent || 0) + "%";
      updateBannerBtn.textContent = "Downloading...";
      updateBannerBtn.disabled = true;
      break;
    case "downloaded":
      _updateVersion = data.version || _updateVersion;
      _updateState = "downloaded";
      updateIndicatorState("downloaded", "\u2714 v" + (_updateVersion || "new"));
      showUpdateBanner(
        `v${_updateVersion || "new"} downloaded`,
        "Restart to Update",
        () => { window.shellfire.installUpdate(); }
      );
      updateBannerBtn.disabled = false;
      showToast("Update downloaded — restart to apply");
      break;
    case "error":
      hideUpdateBanner();
      updateIndicator.className = "update-indicator";
      _updateState = null;
      break;
    case "up-to-date":
      // No UI needed — silently dismiss
      break;
  }
});

