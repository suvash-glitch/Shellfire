"use strict";

/**
 * @module window-manager
 *
 * Electron BrowserWindow lifecycle, auto-updater, zen mode, zoom, and
 * window control IPC for Shellfire.
 *
 * Owns:
 *   - BrowserWindow creation with platform-appropriate chrome and CSP
 *   - Auto-updater setup, event forwarding to the renderer, and periodic checks
 *   - Zen mode state machine (spanning all displays, debounced toggle)
 *   - App-wide zoom factor get/set
 *   - Window control IPC for frameless Windows / Linux builds
 *   - Graceful quit (kills all PTYs, clears intervals)
 *   - Cleanup on app exit via the exported `cleanup()` function
 *
 * Does NOT own:
 *   - PTY creation or I/O (see pty-manager.js)
 *   - Shared state storage (see state.js)
 *   - Plugin loading or marketplace (see plugin-system.js)
 */

const path = require("path");
const { app, BrowserWindow, ipcMain, screen } = require("electron");
const { log } = require("./utils");
const { ptys, getWindow, setWindow, sendToRenderer } = require("./state");

// ─── Optional auto-updater (absent in dev / unsupported environments) ─────────

/**
 * `electron-updater` `autoUpdater` singleton, or `null` when the package is
 * not installed (development builds) or loading fails.
 *
 * @type {import("electron-updater").AppUpdater|null}
 */
let autoUpdater = null;
try {
  ({ autoUpdater } = require("electron-updater"));
} catch {
  // electron-updater is an optional dev dependency not present in all builds.
}

// ─── Window creation constants ────────────────────────────────────────────────

/** Default window width in logical pixels. */
const DEFAULT_WIN_WIDTH = 1200;

/** Default window height in logical pixels. */
const DEFAULT_WIN_HEIGHT = 800;

/** Window background colour — matches the default dark theme to avoid flash-of-white. */
const WIN_BACKGROUND_COLOR = "#1e1e1e";

/** Horizontal position (px) of the macOS traffic-light buttons. */
const MACOS_TRAFFIC_LIGHT_X = 13;

/** Vertical position (px) of the macOS traffic-light buttons. */
const MACOS_TRAFFIC_LIGHT_Y = 13;

/**
 * Content Security Policy header value applied to all responses.
 * `unsafe-inline` and `unsafe-eval` are required by xterm.js and the inline
 * plugin sandbox; tighten this once those dependencies allow nonce-based CSP.
 *
 * @type {string}
 */
const CSP_HEADER =
  "default-src 'self'; " +
  "script-src 'self' 'unsafe-inline' 'unsafe-eval'; " +
  "style-src 'self' 'unsafe-inline'; " +
  "font-src 'self'; " +
  "connect-src *";

// ─── Auto-updater constants ───────────────────────────────────────────────────

/** Interval (ms) between automatic background update checks. */
const UPDATE_CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000; // 4 hours

// ─── Zen mode constants ───────────────────────────────────────────────────────

/**
 * Delay (ms) to wait after exiting full-screen before repositioning to
 * the zen-mode bounds.  macOS needs this to finish its full-screen animation.
 *
 * @type {number}
 */
const ZEN_FULLSCREEN_EXIT_DELAY_MS = 500;

/** Electron always-on-top level used while zen mode is active. */
const ZEN_ALWAYS_ON_TOP_LEVEL = "screen-saver";

// ─── Zoom constants ───────────────────────────────────────────────────────────

/** Minimum allowed zoom factor (50 %). */
const ZOOM_MIN = 0.5;

/** Maximum allowed zoom factor (300 %). */
const ZOOM_MAX = 3;

/** Zoom factor returned when no window is available. */
const ZOOM_DEFAULT = 1;

// ─── Zen mode state ───────────────────────────────────────────────────────────

/** Whether zen mode is currently active. */
let zenActive = false;

/**
 * Guards against concurrent zen-mode toggles triggered before the previous
 * animation completes (e.g. from rapid keyboard presses).
 */
let zenTransitioning = false;

/** Window bounds captured just before entering zen mode, restored on exit. */
let zenPreBounds = null;

/** Whether the window was maximized before zen mode was activated. */
let zenWasMaximized = false;

/** Whether the window was in full-screen before zen mode was activated. */
let zenWasFullScreen = false;

// ─── Update interval handle ───────────────────────────────────────────────────

/** `setInterval` handle for the periodic update check; `null` when not running. */
let _updateCheckInterval = null;

// ─── Window creation ───────────────────────────────────────────────────────────

/**
 * Creates and configures the main Electron `BrowserWindow`, applies the
 * Content Security Policy, loads `index.html`, and maximises the window.
 *
 * On macOS the native titlebar is hidden-inset (traffic lights stay visible);
 * on other platforms a frameless window is used and custom window controls are
 * provided via IPC (see `registerHandlers`).
 *
 * @returns {void}
 */
function createWindow() {
  const opts = buildWindowOptions();
  const win = new BrowserWindow(opts);
  setWindow(win);

  applyContentSecurityPolicy(win);
  win.loadFile("index.html");
  win.maximize();

  win.on("closed", _onWindowClosed);
}

/**
 * Builds the `BrowserWindow` options object for the current platform.
 *
 * @returns {Electron.BrowserWindowConstructorOptions}
 */
function buildWindowOptions() {
  /** @type {Electron.BrowserWindowConstructorOptions} */
  const opts = {
    width: DEFAULT_WIN_WIDTH,
    height: DEFAULT_WIN_HEIGHT,
    backgroundColor: WIN_BACKGROUND_COLOR,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      preload: path.join(__dirname, "..", "..", "preload.js"),
    },
  };

  if (process.platform === "darwin") {
    opts.titleBarStyle = "hiddenInset";
    opts.trafficLightPosition = { x: MACOS_TRAFFIC_LIGHT_X, y: MACOS_TRAFFIC_LIGHT_Y };
    opts.vibrancy = "titlebar";
  } else {
    opts.frame = false;
  }

  return opts;
}

/**
 * Installs a `webRequest` listener that injects the {@link CSP_HEADER} into
 * every response received by the window's session.
 *
 * @param {Electron.BrowserWindow} win - The window whose session to patch.
 * @returns {void}
 */
function applyContentSecurityPolicy(win) {
  win.webContents.session.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        "Content-Security-Policy": [CSP_HEADER],
      },
    });
  });
}

/**
 * Handler invoked when the BrowserWindow emits `"closed"`.
 * Clears the shared window reference so other modules see `null` immediately.
 * PTYs are intentionally kept alive to support tmux-like reattach on macOS.
 *
 * @returns {void}
 */
function _onWindowClosed() {
  setWindow(null);
}

// ─── Auto-updater ─────────────────────────────────────────────────────────────

/**
 * Configures `electron-updater` and starts the periodic update check.
 * Silently no-ops when running in development (`!app.isPackaged`) or when
 * `electron-updater` is not installed.
 *
 * Update status events are forwarded to the renderer on the `"update-status"`
 * IPC channel with a `{ status, ...payload }` shape so the UI can display
 * progress without coupling to updater internals.
 *
 * @returns {void}
 */
function setupAutoUpdater() {
  if (!autoUpdater || !app.isPackaged) return;

  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;

  _attachUpdaterEvents();

  autoUpdater.checkForUpdates().catch(() => {
    // First check on startup — failure is non-fatal; the interval will retry.
  });

  _updateCheckInterval = setInterval(() => {
    autoUpdater.checkForUpdates().catch(() => {
      // Periodic background check — network may be temporarily unavailable.
    });
  }, UPDATE_CHECK_INTERVAL_MS);
}

/**
 * Attaches all `autoUpdater` event listeners and forwards each as an
 * `"update-status"` IPC message to the renderer.
 *
 * @returns {void}
 */
function _attachUpdaterEvents() {
  const send = (payload) => sendToRenderer("update-status", payload);

  autoUpdater.on("checking-for-update", () => {
    log("info", "Checking for update...");
    send({ status: "checking" });
  });

  autoUpdater.on("update-available", ({ version }) => {
    log("info", `Update available: v${version}`);
    send({ status: "available", version });
  });

  autoUpdater.on("download-progress", ({ percent }) => {
    send({ status: "downloading", percent: Math.round(percent) });
  });

  autoUpdater.on("update-downloaded", ({ version }) => {
    log("info", `Update downloaded: v${version}`);
    send({ status: "downloaded", version });
  });

  autoUpdater.on("update-not-available", () => {
    log("info", "No update available");
    send({ status: "up-to-date" });
  });

  autoUpdater.on("error", (err) => {
    log("error", "Auto-update error:", err.message);
    send({ status: "error", message: err.message });
  });
}

// ─── IPC handlers ─────────────────────────────────────────────────────────────

/**
 * Registers all window-related `ipcMain` handlers.
 * Must be called once during app initialisation (typically from `main.js`).
 *
 * Channels registered:
 *   - `check-for-updates`          (handle) — Trigger an immediate update check
 *   - `download-update`            (handle) — Start downloading the queued update
 *   - `install-update`             (handle) — Quit and install the downloaded update
 *   - `get-app-version`            (handle) — Return the running app version string
 *   - `get-default-shell`          (handle) — Return the user's default shell path
 *   - `toggle-fullscreen`          (on)     — Toggle the window's full-screen state
 *   - `toggle-zen-mode`            (handle) — Enter or exit zen mode
 *   - `win-minimize`               (on)     — Minimize (frameless builds)
 *   - `win-maximize`               (on)     — Maximize / unmaximize (frameless builds)
 *   - `win-close`                  (on)     — Close window (frameless builds)
 *   - `set-zoom`                   (handle) — Set the WebContents zoom factor
 *   - `get-zoom`                   (handle) — Get the current zoom factor
 *   - `quit-app`                   (on)     — Kill all PTYs and exit the app
 *
 * @returns {void}
 */
function registerHandlers() {
  ipcMain.handle("check-for-updates", _handleCheckForUpdates);
  ipcMain.handle("download-update", _handleDownloadUpdate);
  ipcMain.handle("install-update", _handleInstallUpdate);

  ipcMain.handle("get-app-version", _handleGetAppVersion);
  ipcMain.handle("get-default-shell", _handleGetDefaultShell);

  ipcMain.on("toggle-fullscreen", _handleToggleFullscreen);
  ipcMain.handle("toggle-zen-mode", _handleToggleZenMode);

  ipcMain.on("win-minimize", _handleWinMinimize);
  ipcMain.on("win-maximize", _handleWinMaximize);
  ipcMain.on("win-close", _handleWinClose);

  ipcMain.handle("set-zoom", _handleSetZoom);
  ipcMain.handle("get-zoom", _handleGetZoom);

  ipcMain.on("quit-app", _handleQuitApp);
}

// ─── Handler implementations ──────────────────────────────────────────────────

/**
 * IPC handler: `check-for-updates`
 * Triggers an immediate update check.  Errors are swallowed because the
 * renderer does not await a meaningful return value from this call.
 *
 * @returns {Promise<void>}
 */
async function _handleCheckForUpdates() {
  try {
    await autoUpdater?.checkForUpdates();
  } catch {
    // Update check failed (offline, server error) — renderer will see no event.
  }
}

/**
 * IPC handler: `download-update`
 * Begins downloading the update that was previously signalled as available.
 *
 * @returns {Promise<void>}
 */
async function _handleDownloadUpdate() {
  try {
    await autoUpdater?.downloadUpdate();
  } catch {
    // Download failure is reported via the "error" updater event; no need to throw.
  }
}

/**
 * IPC handler: `install-update`
 * Quits the app and installs the downloaded update.
 *
 * @returns {void}
 */
function _handleInstallUpdate() {
  autoUpdater?.quitAndInstall();
}

/**
 * IPC handler: `get-app-version`
 * Returns the application version string from `package.json`.
 *
 * @returns {string} Version string (e.g. `"3.1.0"`).
 */
function _handleGetAppVersion() {
  return app.getVersion();
}

/**
 * IPC handler: `get-default-shell`
 * Returns the user's login shell path.
 *
 * @returns {string} Shell executable path (e.g. `"/bin/zsh"`).
 */
function _handleGetDefaultShell() {
  return process.platform === "win32"
    ? process.env.COMSPEC || "powershell.exe"
    : process.env.SHELL || "/bin/zsh";
}

/**
 * IPC listener: `toggle-fullscreen`
 * Toggles the main window between full-screen and normal mode.
 *
 * @returns {void}
 */
function _handleToggleFullscreen() {
  const win = getWindow();
  if (win) win.setFullScreen(!win.isFullScreen());
}

/**
 * IPC handler: `toggle-zen-mode`
 * Enters or exits a distraction-free mode where the window spans all connected
 * displays, is always on top, and hides the menu bar and traffic-light buttons.
 *
 * A `zenTransitioning` guard prevents re-entry while animations are in progress.
 * Pre-toggle state (bounds, maximized, full-screen) is saved and fully restored
 * on exit.
 *
 * @returns {Promise<boolean>} `true` if zen mode is now active, `false` if exited.
 */
async function _handleToggleZenMode() {
  const win = getWindow();
  if (!win || zenTransitioning) return zenActive;

  zenTransitioning = true;
  zenActive = !zenActive;

  if (zenActive) {
    await _enterZenMode(win);
  } else {
    _exitZenMode(win);
  }

  sendToRenderer("zen-mode-changed", zenActive);
  zenTransitioning = false;
  return zenActive;
}

/**
 * Applies zen-mode window properties: saves current state, exits full-screen
 * if needed, spans all displays, hides chrome, and pins to top.
 *
 * @param {Electron.BrowserWindow} win - The main application window.
 * @returns {Promise<void>}
 */
async function _enterZenMode(win) {
  zenWasFullScreen = win.isFullScreen();
  zenWasMaximized = win.isMaximized();
  zenPreBounds = win.getBounds();

  if (zenWasFullScreen) {
    win.setFullScreen(false);
    // macOS needs time to complete the full-screen exit animation before
    // we can reliably reposition the window across displays.
    await new Promise((r) => setTimeout(r, ZEN_FULLSCREEN_EXIT_DELAY_MS));
  }

  const spanBounds = _computeAllDisplaysBounds();
  if (process.platform === "darwin") win.setWindowButtonVisibility(false);
  win.setAlwaysOnTop(true, ZEN_ALWAYS_ON_TOP_LEVEL);
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  win.setBounds(spanBounds);
  win.setMenuBarVisibility(false);
}

/**
 * Restores all window properties that were changed when zen mode was activated.
 *
 * @param {Electron.BrowserWindow} win - The main application window.
 * @returns {void}
 */
function _exitZenMode(win) {
  win.setAlwaysOnTop(false);
  win.setVisibleOnAllWorkspaces(false);
  if (process.platform === "darwin") win.setWindowButtonVisibility(true);
  win.setMenuBarVisibility(true);
  if (zenPreBounds) win.setBounds(zenPreBounds);
  if (zenWasMaximized) win.maximize();
  if (zenWasFullScreen) win.setFullScreen(true);
}

/**
 * Calculates a bounding rectangle that covers all connected displays.
 * The returned bounds can be passed directly to `BrowserWindow.setBounds()`.
 *
 * @returns {{ x: number, y: number, width: number, height: number }}
 */
function _computeAllDisplaysBounds() {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const d of screen.getAllDisplays()) {
    minX = Math.min(minX, d.bounds.x);
    minY = Math.min(minY, d.bounds.y);
    maxX = Math.max(maxX, d.bounds.x + d.bounds.width);
    maxY = Math.max(maxY, d.bounds.y + d.bounds.height);
  }

  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/**
 * IPC listener: `win-minimize`
 * Minimizes the window (used by the custom title bar on frameless builds).
 *
 * @returns {void}
 */
function _handleWinMinimize() {
  getWindow()?.minimize();
}

/**
 * IPC listener: `win-maximize`
 * Toggles between maximized and restored states (frameless builds).
 *
 * @returns {void}
 */
function _handleWinMaximize() {
  const win = getWindow();
  if (!win) return;
  win.isMaximized() ? win.unmaximize() : win.maximize();
}

/**
 * IPC listener: `win-close`
 * Closes the main window (frameless builds).
 *
 * @returns {void}
 */
function _handleWinClose() {
  getWindow()?.close();
}

/**
 * IPC handler: `set-zoom`
 * Sets the WebContents zoom factor, clamped to [{@link ZOOM_MIN}, {@link ZOOM_MAX}].
 * Silently no-ops for invalid or out-of-range values so the renderer cannot
 * accidentally make the UI unusable.
 *
 * @param {Electron.IpcMainInvokeEvent} _event  - IPC event (unused).
 * @param {number}                       factor  - Desired zoom factor.
 * @returns {void}
 */
function _handleSetZoom(_event, factor) {
  const win = getWindow();
  if (!win || win.isDestroyed()) return;
  const f = Number(factor);
  if (!isFinite(f) || f < ZOOM_MIN || f > ZOOM_MAX) return;
  win.webContents.setZoomFactor(f);
}

/**
 * IPC handler: `get-zoom`
 * Returns the current WebContents zoom factor, or {@link ZOOM_DEFAULT} when
 * no window is available.
 *
 * @returns {number} Current zoom factor.
 */
function _handleGetZoom() {
  const win = getWindow();
  return !win || win.isDestroyed() ? ZOOM_DEFAULT : win.webContents.getZoomFactor();
}

/**
 * IPC listener: `quit-app`
 * Tears down all active PTYs, clears the update check interval, and exits.
 * PTY kill errors are silently ignored because the process is exiting anyway.
 *
 * @returns {void}
 */
function _handleQuitApp() {
  cleanup();
  for (const [, pty] of ptys) {
    try {
      pty.kill();
    } catch {
      // PTY may already be dead by the time we call kill — safe to ignore.
    }
  }
  app.quit();
}

// ─── Cleanup ──────────────────────────────────────────────────────────────────

/**
 * Clears the periodic update check interval.
 * Should be called from the `"before-quit"` app event or from `_handleQuitApp`
 * to prevent the interval from firing after the app has started shutting down.
 *
 * @returns {void}
 */
function cleanup() {
  if (_updateCheckInterval) {
    clearInterval(_updateCheckInterval);
    _updateCheckInterval = null;
  }
}

// ─── Exports ──────────────────────────────────────────────────────────────────

module.exports = { createWindow, setupAutoUpdater, registerHandlers, cleanup };
