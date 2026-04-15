// ============================================================
// STATE
// ============================================================
const grid = document.getElementById("grid");
const paneCountEl = document.getElementById("pane-count");
const toastEl = document.getElementById("toast");

const panes = new Map(); // id -> { el, term, fitAddon, searchAddon, titleEl, indicatorEl, envBadgeEl, customName, locked, color }
let activeId = null;
let layout = [];
let broadcastMode = false;
let skipPermissions = false;
let zoomedId = null;
let currentThemeIdx = 0;
let currentFontSize = 13;
let currentZoom = 1.0; // app-wide zoom factor (0.5 – 3.0)
let copyOnSelect = true;
let snippets = []; // { name, command }
let profiles = []; // { name, panes: [{ cwd, command }] }
let settings = {}; // loaded from settings.json
let autoSaveInterval = 60; // seconds
let autoSaveTimer = null;
let bufferLimit = 512 * 1024; // configurable buffer limit
let confirmClose = true;
let customKeybindings = {}; // action -> shortcut override
let ideMode = false; // IDE sidebar mode
let zenMode = false; // Zen mode: distraction-free fullscreen across all monitors
let ideVisiblePanes = []; // pane IDs visible in IDE mode (single = fullscreen, multiple = split)

// Feature state (used by multiple sections)
const paneStatsHistory = new Map(); // paneId -> { cpuHistory, lastMemory, lastCpu }
const paneLineBufs = new Map(); // paneId -> current line buffer for command history
const paneErrorDebounce = new Map(); // paneId -> last error timestamp

