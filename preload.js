"use strict";

/**
 * @file preload.js
 * @description Electron preload script. Runs in the renderer's isolated context
 * and constructs the `window.shellfire` API surface via Electron's contextBridge.
 *
 * Owns:
 *   - Defining and exporting every method on `window.shellfire`
 *   - Translating renderer calls into typed IPC messages (invoke / send)
 *   - Forwarding main-process push events to renderer callbacks (onData, onExit, etc.)
 *
 * Does NOT own:
 *   - Implementing any business logic (all logic lives in the main process)
 *   - Accessing the Node.js runtime directly from renderer code (context isolation
 *     prevents this; all Node access goes through IPC)
 */

const { contextBridge, ipcRenderer } = require("electron");

// ─────────────────────────────────────────────────────────────────────────────
// IPC channel name constants
// Centralising string literals here prevents typos and makes refactoring easy.
// ─────────────────────────────────────────────────────────────────────────────

const CH = {
  // Terminal lifecycle
  CREATE_TERMINAL:     "create-terminal",
  LIST_PTYS:           "list-ptys",
  TERMINAL_INPUT:      "terminal-input",
  TERMINAL_RESIZE:     "terminal-resize",
  TERMINAL_KILL:       "terminal-kill",
  TERMINAL_BROADCAST:  "terminal-broadcast",
  GET_CWD:             "get-terminal-cwd",
  GET_PROCESS:         "get-terminal-process",
  GET_ENV:             "get-terminal-env",
  GET_PANE_STATS:      "get-pane-stats",
  GET_PROCESS_TREE:    "get-process-tree",

  // Git
  GIT_BRANCH:          "get-git-branch",
  GIT_STATUS:          "get-git-status",

  // Window / app
  TOGGLE_FULLSCREEN:   "toggle-fullscreen",
  TOGGLE_ZEN_MODE:     "toggle-zen-mode",
  ZEN_MODE_CHANGED:    "zen-mode-changed",
  QUIT:                "quit-app",
  NOTIFY:              "show-notification",
  OPEN_IN_EDITOR:      "open-in-editor",
  APP_VERSION:         "get-app-version",
  DEFAULT_SHELL:       "get-default-shell",
  WIN_MINIMIZE:        "win-minimize",
  WIN_MAXIMIZE:        "win-maximize",
  WIN_CLOSE:           "win-close",
  SET_ZOOM:            "set-zoom",
  GET_ZOOM:            "get-zoom",

  // Persistence — session & config
  SAVE_SESSION:        "save-session",
  LOAD_SESSION:        "load-session",
  SAVE_CONFIG:         "save-config",
  LOAD_CONFIG:         "load-config",
  SAVE_SETTINGS:       "save-settings",
  LOAD_SETTINGS:       "load-settings",

  // Persistence — data collections
  SAVE_SNIPPETS:       "save-snippets",
  LOAD_SNIPPETS:       "load-snippets",
  SAVE_PROFILES:       "save-profiles",
  LOAD_PROFILES:       "load-profiles",
  SAVE_RECENTS:        "save-recents",
  LOAD_RECENTS:        "load-recents",
  SAVE_SSH:            "save-ssh",
  LOAD_SSH:            "load-ssh",
  SAVE_NOTES:          "save-notes",
  LOAD_NOTES:          "load-notes",
  SAVE_BOOKMARKS:      "save-bookmarks",
  LOAD_BOOKMARKS:      "load-bookmarks",
  SAVE_PROJECTS:       "save-projects",
  LOAD_PROJECTS:       "load-projects",
  SAVE_PIPELINES:      "save-pipelines",
  LOAD_PIPELINES:      "load-pipelines",
  SAVE_CMD_BOOKMARKS:  "save-cmd-bookmarks",
  LOAD_CMD_BOOKMARKS:  "load-cmd-bookmarks",

  // Cron
  CRON_LIST:           "cron-list",
  CRON_ADD:            "cron-add",
  CRON_REMOVE:         "cron-remove",

  // Files
  FIND_FILES:          "find-files",
  SAVE_OUTPUT:         "save-output",
  EXPORT_SH:           "export-sh",
  READ_FILE:           "read-file",
  PICK_SH_FILE:        "pick-sh-file",

  // Logging
  LOG_APPEND:          "log-append",
  GET_LOG_PATH:        "get-log-path",

  // System info
  SYSTEM_STATS:        "system-stats",
  LIST_PORTS:          "list-ports",
  KILL_PORT:           "kill-port",

  // Docker
  DOCKER_PS:           "docker-ps",
  DOCKER_PS_ALL:       "docker-ps-all",

  // SSH remote
  SSH_REMOTE_LIST:     "ssh-remote-list",
  SSH_REMOTE_OPEN_ALL: "ssh-remote-open-all",

  // AI
  AI_COMPLETE:         "ai-complete",
  AI_CHAT:             "ai-chat",

  // Pipeline
  EXEC_PIPELINE_STEP:  "exec-pipeline-step",

  // Auto-update
  CHECK_FOR_UPDATES:   "check-for-updates",
  DOWNLOAD_UPDATE:     "download-update",
  INSTALL_UPDATE:      "install-update",
  UPDATE_STATUS:       "update-status",

  // Plugins / marketplace
  LOAD_PLUGINS:        "load-plugins",
  GET_PLUGIN_CODE:     "get-plugin-code",
  LIST_AVAILABLE:      "list-available-plugins",
  INSTALL_PLUGIN:      "install-plugin",
  UNINSTALL_PLUGIN:    "uninstall-plugin",
  FETCH_REGISTRY:      "fetch-registry",
  INSTALL_FROM_REGISTRY: "install-from-registry",
  INSTALL_TERMEXT:     "install-termext",
  DOWNLOAD_INSTALL_TERMEXT: "download-and-install-termext",
  PICK_TERMEXT_FILE:   "pick-termext-file",

  // Secrets
  LOAD_SECRETS:        "load-secrets",
  SAVE_SECRETS:        "save-secrets",
  INJECT_SECRETS:      "inject-secrets",

  // Startup tasks
  SAVE_STARTUP_TASKS:  "save-startup-tasks",
  LOAD_STARTUP_TASKS:  "load-startup-tasks",

  // Status bar
  GET_K8S_CONTEXT:     "get-k8s-context",
  GET_AWS_PROFILE:     "get-aws-profile",
  GET_NODE_VERSION:    "get-node-version",

  // Push events from main → renderer
  TERMINAL_DATA:       "terminal-data",
  TERMINAL_EXIT:       "terminal-exit",
};

// ─────────────────────────────────────────────────────────────────────────────
// Context bridge — window.shellfire
// ─────────────────────────────────────────────────────────────────────────────

contextBridge.exposeInMainWorld("shellfire", {

  // ── Terminal lifecycle ──────────────────────────────────────────────────────

  /** Creates a new PTY session; resolves with the new terminal's id and metadata. */
  createTerminal: (cwd, restoreCmd) =>
    ipcRenderer.invoke(CH.CREATE_TERMINAL, cwd, restoreCmd),

  /** Resolves with an array of all active PTY descriptor objects. */
  listPtys: () =>
    ipcRenderer.invoke(CH.LIST_PTYS),

  /** Sends raw keyboard input to the PTY identified by `id`. */
  sendInput: (id, data) =>
    ipcRenderer.send(CH.TERMINAL_INPUT, id, data),

  /** Notifies the PTY of a terminal resize so line-wrapping stays correct. */
  resize: (id, cols, rows) =>
    ipcRenderer.send(CH.TERMINAL_RESIZE, id, cols, rows),

  /** Terminates the PTY process for the given terminal `id`. */
  kill: (id) =>
    ipcRenderer.send(CH.TERMINAL_KILL, id),

  /** Sends `data` simultaneously to every PTY whose id appears in `ids`. */
  broadcast: (ids, data) =>
    ipcRenderer.send(CH.TERMINAL_BROADCAST, ids, data),

  /** Resolves with the current working directory of the PTY process for `id`. */
  getCwd: (id) =>
    ipcRenderer.invoke(CH.GET_CWD, id),

  /** Resolves with the name of the foreground process running in the PTY for `id`. */
  getProcess: (id) =>
    ipcRenderer.invoke(CH.GET_PROCESS, id),

  /** Resolves with the environment variable map of the PTY process for `id`. */
  getTerminalEnv: (id) =>
    ipcRenderer.invoke(CH.GET_ENV, id),

  /** Resolves with CPU/memory stats for the PTY process and its children for `id`. */
  getPaneStats: (id) =>
    ipcRenderer.invoke(CH.GET_PANE_STATS, id),

  /** Resolves with the full process-tree (recursive children) for the PTY of `id`. */
  getProcessTree: (id) =>
    ipcRenderer.invoke(CH.GET_PROCESS_TREE, id),

  // ── Git ────────────────────────────────────────────────────────────────────

  /** Resolves with the current git branch name for the repo rooted at `dir`. */
  getGitBranch: (dir) =>
    ipcRenderer.invoke(CH.GIT_BRANCH, dir),

  /** Resolves with the git status summary (modified/staged/untracked counts) for `dir`. */
  getGitStatus: (dir) =>
    ipcRenderer.invoke(CH.GIT_STATUS, dir),

  // ── Window / app controls ──────────────────────────────────────────────────

  /** Toggles the Electron window between fullscreen and windowed mode. */
  toggleFullscreen: () =>
    ipcRenderer.send(CH.TOGGLE_FULLSCREEN),

  /** Toggles zen mode (minimal UI); resolves with the new `active` boolean. */
  toggleZenMode: () =>
    ipcRenderer.invoke(CH.TOGGLE_ZEN_MODE),

  /**
   * Registers a listener for zen-mode state changes pushed from the main process.
   * @param {function(boolean): void} callback - Receives `true` when zen mode activates.
   */
  onZenModeChanged: (callback) =>
    ipcRenderer.on(CH.ZEN_MODE_CHANGED, (_, active) => callback(active)),

  /** Quits the Electron application. */
  quit: () =>
    ipcRenderer.send(CH.QUIT),

  /** Triggers a native OS notification with the given `title` and `body`. */
  notify: (title, body) =>
    ipcRenderer.send(CH.NOTIFY, title, body),

  /** Opens `filePath` in the system's default text editor. */
  openInEditor: (filePath) =>
    ipcRenderer.send(CH.OPEN_IN_EDITOR, filePath),

  /** Resolves with the application version string from `package.json`. */
  getAppVersion: () =>
    ipcRenderer.invoke(CH.APP_VERSION),

  /** Resolves with the path to the user's default login shell (e.g. `/bin/zsh`). */
  getDefaultShell: () =>
    ipcRenderer.invoke(CH.DEFAULT_SHELL),

  // ── Window controls (Windows / Linux frameless window) ─────────────────────

  /** Minimises the application window (Windows/Linux only). */
  winMinimize: () =>
    ipcRenderer.send(CH.WIN_MINIMIZE),

  /** Maximises or restores the application window (Windows/Linux only). */
  winMaximize: () =>
    ipcRenderer.send(CH.WIN_MAXIMIZE),

  /** Closes the application window (Windows/Linux only). */
  winClose: () =>
    ipcRenderer.send(CH.WIN_CLOSE),

  /** Sets the renderer zoom level to `factor` (1.0 = 100 %). */
  setZoom: (factor) =>
    ipcRenderer.invoke(CH.SET_ZOOM, factor),

  /** Resolves with the current renderer zoom factor. */
  getZoom: () =>
    ipcRenderer.invoke(CH.GET_ZOOM),

  /** The OS platform string (e.g. `"darwin"`, `"win32"`, `"linux"`). */
  platform: process.platform,

  // ── Session & configuration ────────────────────────────────────────────────

  /** Persists the current pane layout and restore commands as a session snapshot. */
  saveSession: (data) =>
    ipcRenderer.send(CH.SAVE_SESSION, data),

  /** Resolves with the last-saved session snapshot, or `null` if none exists. */
  loadSession: () =>
    ipcRenderer.invoke(CH.LOAD_SESSION),

  /** Persists the application configuration object. */
  saveConfig: (config) =>
    ipcRenderer.send(CH.SAVE_CONFIG, config),

  /** Resolves with the persisted configuration object. */
  loadConfig: () =>
    ipcRenderer.invoke(CH.LOAD_CONFIG),

  /** Persists the full settings object (all user preferences). */
  saveSettings: (data) =>
    ipcRenderer.send(CH.SAVE_SETTINGS, data),

  /** Resolves with the persisted settings object. */
  loadSettings: () =>
    ipcRenderer.invoke(CH.LOAD_SETTINGS),

  // ── Data collections (snippets, profiles, recents, SSH, notes, etc.) ───────

  /** Persists the command-snippets collection. */
  saveSnippets: (data) =>
    ipcRenderer.send(CH.SAVE_SNIPPETS, data),

  /** Resolves with the persisted command-snippets array. */
  loadSnippets: () =>
    ipcRenderer.invoke(CH.LOAD_SNIPPETS),

  /** Persists the shell-profile definitions. */
  saveProfiles: (data) =>
    ipcRenderer.send(CH.SAVE_PROFILES, data),

  /** Resolves with the persisted shell-profile array. */
  loadProfiles: () =>
    ipcRenderer.invoke(CH.LOAD_PROFILES),

  /** Persists the recently-visited directories list. */
  saveRecents: (data) =>
    ipcRenderer.send(CH.SAVE_RECENTS, data),

  /** Resolves with the persisted recently-visited directories array. */
  loadRecents: () =>
    ipcRenderer.invoke(CH.LOAD_RECENTS),

  /** Persists the SSH connection bookmarks. */
  saveSsh: (data) =>
    ipcRenderer.send(CH.SAVE_SSH, data),

  /** Resolves with the persisted SSH connection bookmarks array. */
  loadSsh: () =>
    ipcRenderer.invoke(CH.LOAD_SSH),

  /** Persists the scratch-pad notes text. */
  saveNotes: (data) =>
    ipcRenderer.send(CH.SAVE_NOTES, data),

  /** Resolves with the persisted scratch-pad notes text. */
  loadNotes: () =>
    ipcRenderer.invoke(CH.LOAD_NOTES),

  /** Persists the directory bookmarks. */
  saveBookmarks: (data) =>
    ipcRenderer.send(CH.SAVE_BOOKMARKS, data),

  /** Resolves with the persisted directory bookmarks array. */
  loadBookmarks: () =>
    ipcRenderer.invoke(CH.LOAD_BOOKMARKS),

  /** Persists the projects list. */
  saveProjects: (data) =>
    ipcRenderer.send(CH.SAVE_PROJECTS, data),

  /** Resolves with the persisted projects array. */
  loadProjects: () =>
    ipcRenderer.invoke(CH.LOAD_PROJECTS),

  /** Persists the pipeline definitions (node-graph configs). */
  savePipelines: (data) =>
    ipcRenderer.invoke(CH.SAVE_PIPELINES, data),

  /** Resolves with the persisted pipeline definitions array. */
  loadPipelines: () =>
    ipcRenderer.invoke(CH.LOAD_PIPELINES),

  /** Persists the command-bookmark collection. */
  saveCmdBookmarks: (data) =>
    ipcRenderer.send(CH.SAVE_CMD_BOOKMARKS, data),

  /** Resolves with the persisted command-bookmarks array. */
  loadCmdBookmarks: () =>
    ipcRenderer.invoke(CH.LOAD_CMD_BOOKMARKS),

  // ── Cron ───────────────────────────────────────────────────────────────────

  /** Resolves with the list of crontab entries managed by Shellfire. */
  cronList: () =>
    ipcRenderer.invoke(CH.CRON_LIST),

  /** Adds a new crontab `line`; resolves with the updated entries array. */
  cronAdd: (line) =>
    ipcRenderer.invoke(CH.CRON_ADD, line),

  /** Removes the crontab entry at zero-based `index`; resolves with the updated array. */
  cronRemove: (index) =>
    ipcRenderer.invoke(CH.CRON_REMOVE, index),

  // ── File system ────────────────────────────────────────────────────────────

  /** Fuzzy-searches for files matching `query` within the given `dirs` array. */
  findFiles: (query, dirs) =>
    ipcRenderer.invoke(CH.FIND_FILES, query, dirs),

  /** Opens a save dialog and writes `content` to disk with the suggested `name`. */
  saveOutput: (content, name) =>
    ipcRenderer.invoke(CH.SAVE_OUTPUT, content, name),

  /** Opens a save dialog and exports `content` as a shell script with the suggested `name`. */
  exportSh: (content, name) =>
    ipcRenderer.invoke(CH.EXPORT_SH, content, name),

  /** Reads up to `maxBytes` bytes from `filePath`; resolves with the file contents string. */
  readFile: (filePath, maxBytes) =>
    ipcRenderer.invoke(CH.READ_FILE, filePath, maxBytes),

  /** Opens an open-file dialog filtered to `.sh` files; resolves with the chosen path. */
  pickShFile: () =>
    ipcRenderer.invoke(CH.PICK_SH_FILE),

  // ── Pane logging ───────────────────────────────────────────────────────────

  /** Appends `data` to the rolling log file for pane `paneId`. */
  logAppend: (paneId, data) =>
    ipcRenderer.send(CH.LOG_APPEND, paneId, data),

  /** Resolves with the absolute path to the log file for pane `paneId`. */
  getLogPath: (paneId) =>
    ipcRenderer.invoke(CH.GET_LOG_PATH, paneId),

  // ── System information ─────────────────────────────────────────────────────

  /** Resolves with CPU, memory, and load-average stats for the host machine. */
  systemStats: () =>
    ipcRenderer.invoke(CH.SYSTEM_STATS),

  /** Resolves with the list of processes listening on TCP/UDP ports. */
  listPorts: () =>
    ipcRenderer.invoke(CH.LIST_PORTS),

  /** Kills the process with `pid` that is holding a network port open. */
  killPort: (pid) =>
    ipcRenderer.invoke(CH.KILL_PORT, pid),

  // ── Docker ─────────────────────────────────────────────────────────────────

  /** Resolves with the list of currently running Docker containers. */
  dockerPs: () =>
    ipcRenderer.invoke(CH.DOCKER_PS),

  /** Resolves with the list of all Docker containers (including stopped). */
  dockerPsAll: () =>
    ipcRenderer.invoke(CH.DOCKER_PS_ALL),

  // ── SSH remote ─────────────────────────────────────────────────────────────

  /**
   * Lists files/directories on a remote host via SSH/SFTP.
   * @param {{ host: string, user: string, port: number, password: string, remotePath: string }} opts
   * @returns {Promise<Array>} Array of remote directory entries.
   */
  sshRemoteList: ({ host, user, port, password, remotePath }) =>
    ipcRenderer.invoke(CH.SSH_REMOTE_LIST, { host, user, port, password, remotePath }),

  /**
   * Opens multiple local PTY panes that forward to remote sessions via SSH.
   * @param {{ host: string, user: string, port: number, password: string, sessions: Array }} opts
   * @returns {Promise<void>}
   */
  sshRemoteOpenAll: ({ host, user, port, password, sessions }) =>
    ipcRenderer.invoke(CH.SSH_REMOTE_OPEN_ALL, { host, user, port, password, sessions }),

  // ── AI ─────────────────────────────────────────────────────────────────────

  /** Sends a completion request to the configured AI provider; resolves with the completion string. */
  aiComplete: (params) =>
    ipcRenderer.invoke(CH.AI_COMPLETE, params),

  /** Sends a chat-style message to the configured AI provider; resolves with the response message. */
  aiChat: (params) =>
    ipcRenderer.invoke(CH.AI_CHAT, params),

  // ── Pipeline ───────────────────────────────────────────────────────────────

  /** Executes a single pipeline step described by `params`; resolves with stdout/stderr output. */
  execPipelineStep: (params) =>
    ipcRenderer.invoke(CH.EXEC_PIPELINE_STEP, params),

  // ── Auto-update ────────────────────────────────────────────────────────────

  /** Checks GitHub releases for a newer version; resolves with update availability info. */
  checkForUpdates: () =>
    ipcRenderer.invoke(CH.CHECK_FOR_UPDATES),

  /** Begins downloading the latest release in the background; resolves when complete. */
  downloadUpdate: () =>
    ipcRenderer.invoke(CH.DOWNLOAD_UPDATE),

  /** Quits the app and installs the downloaded update immediately. */
  installUpdate: () =>
    ipcRenderer.invoke(CH.INSTALL_UPDATE),

  /**
   * Registers a listener for auto-update progress/status events.
   * @param {function(object): void} callback - Receives a status data object.
   */
  onUpdateStatus: (callback) =>
    ipcRenderer.on(CH.UPDATE_STATUS, (_, data) => callback(data)),

  // ── Plugin system ──────────────────────────────────────────────────────────

  /** Resolves with the manifests of all installed plugins. */
  loadPlugins: () =>
    ipcRenderer.invoke(CH.LOAD_PLUGINS),

  /** Resolves with the source code string of the plugin named `name`. */
  getPluginCode: (name) =>
    ipcRenderer.invoke(CH.GET_PLUGIN_CODE, name),

  /** Resolves with the list of plugins available in `~/.shellfire/plugins/`. */
  listAvailablePlugins: () =>
    ipcRenderer.invoke(CH.LIST_AVAILABLE),

  /** Installs the plugin found in directory `dir`; resolves when installation is complete. */
  installPlugin: (dir) =>
    ipcRenderer.invoke(CH.INSTALL_PLUGIN, dir),

  /** Uninstalls the plugin whose directory is `dir`; resolves when removal is complete. */
  uninstallPlugin: (dir) =>
    ipcRenderer.invoke(CH.UNINSTALL_PLUGIN, dir),

  // ── Marketplace ────────────────────────────────────────────────────────────

  /** Fetches the remote plugin registry JSON; resolves with the registry entries array. */
  fetchRegistry: () =>
    ipcRenderer.invoke(CH.FETCH_REGISTRY),

  /** Downloads and installs a plugin from the marketplace registry; resolves when done. */
  installFromRegistry: (params) =>
    ipcRenderer.invoke(CH.INSTALL_FROM_REGISTRY, params),

  // ── .termext package install ───────────────────────────────────────────────

  /** Installs a `.termext` package from a local `filePath`; resolves when done. */
  installTermext: (filePath) =>
    ipcRenderer.invoke(CH.INSTALL_TERMEXT, filePath),

  /** Downloads a `.termext` package from a URL and installs it; resolves when done. */
  downloadAndInstallTermext: (params) =>
    ipcRenderer.invoke(CH.DOWNLOAD_INSTALL_TERMEXT, params),

  /** Opens an open-file dialog filtered to `.termext` files; resolves with the chosen path. */
  pickTermextFile: () =>
    ipcRenderer.invoke(CH.PICK_TERMEXT_FILE),

  // ── Secrets manager ────────────────────────────────────────────────────────

  /** Resolves with the decrypted secrets vault object. */
  loadSecrets: () =>
    ipcRenderer.invoke(CH.LOAD_SECRETS),

  /** Encrypts and persists the secrets vault object. */
  saveSecrets: (data) =>
    ipcRenderer.send(CH.SAVE_SECRETS, data),

  /** Injects resolved secret values into the given `params` payload; resolves with the result. */
  injectSecrets: (params) =>
    ipcRenderer.invoke(CH.INJECT_SECRETS, params),

  // ── Startup tasks ──────────────────────────────────────────────────────────

  /** Persists the list of commands to run automatically when Shellfire starts. */
  saveStartupTasks: (data) =>
    ipcRenderer.send(CH.SAVE_STARTUP_TASKS, data),

  /** Resolves with the persisted startup-tasks array. */
  loadStartupTasks: () =>
    ipcRenderer.invoke(CH.LOAD_STARTUP_TASKS),

  // ── Status bar helpers ─────────────────────────────────────────────────────

  /** Resolves with the current Kubernetes context name. */
  getK8sContext: () =>
    ipcRenderer.invoke(CH.GET_K8S_CONTEXT),

  /** Resolves with the active AWS CLI profile name. */
  getAwsProfile: () =>
    ipcRenderer.invoke(CH.GET_AWS_PROFILE),

  /** Resolves with the Node.js version string of the active runtime. */
  getNodeVersion: () =>
    ipcRenderer.invoke(CH.GET_NODE_VERSION),

  // ── Push events from main process → renderer ───────────────────────────────

  /**
   * Registers a listener for terminal output chunks pushed by the main process.
   * Called once per chunk of PTY output.
   * @param {function(id: number, data: string): void} callback
   */
  onData: (callback) =>
    ipcRenderer.on(CH.TERMINAL_DATA, (_, id, data) => callback(id, data)),

  /**
   * Registers a listener for terminal exit events pushed by the main process.
   * @param {function(id: number, exitCode: number): void} callback
   */
  onExit: (callback) =>
    ipcRenderer.on(CH.TERMINAL_EXIT, (_, id, exitCode) => callback(id, exitCode)),
});
