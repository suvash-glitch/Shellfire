// ============================================================
// SHELLFIRE v3 — BUILT-IN THEMES
// Loaded before renderer.js. Exposes window.__SF_THEMES,
// window.__SF_PANE_COLORS, window.__SF_PANE_COLOR_PRESETS.
// renderer.js reads these and assigns them to local const vars.
// Plugin themes are appended at runtime via _applyPlugin().
// ============================================================

window.__SF_THEMES = [
  { name: "Dark", body: "#1e1e1e", ui: "#2d2d2d", border: "#1a1a1a", term: {
    background: "#1e1e1e", foreground: "#cccccc", cursor: "#cccccc", cursorAccent: "#1e1e1e",
    selectionBackground: "rgba(255,255,255,0.2)", selectionForeground: "#ffffff",
    black: "#000000", red: "#c91b00", green: "#00c200", yellow: "#c7c400",
    blue: "#0225c7", magenta: "#c930c7", cyan: "#00c5c7", white: "#c7c7c7",
    brightBlack: "#686868", brightRed: "#ff6e67", brightGreen: "#5ffa68",
    brightYellow: "#fffc67", brightBlue: "#6871ff", brightMagenta: "#ff76ff",
    brightCyan: "#60fdff", brightWhite: "#ffffff",
  }},
  { name: "Solarized Dark", body: "#002b36", ui: "#073642", border: "#001e27", term: {
    background: "#002b36", foreground: "#839496", cursor: "#839496", cursorAccent: "#002b36",
    selectionBackground: "rgba(131,148,150,0.2)", selectionForeground: "#fdf6e3",
    black: "#073642", red: "#dc322f", green: "#859900", yellow: "#b58900",
    blue: "#268bd2", magenta: "#d33682", cyan: "#2aa198", white: "#eee8d5",
    brightBlack: "#586e75", brightRed: "#cb4b16", brightGreen: "#859900",
    brightYellow: "#b58900", brightBlue: "#268bd2", brightMagenta: "#6c71c4",
    brightCyan: "#2aa198", brightWhite: "#fdf6e3",
  }},
  { name: "Dracula", body: "#282a36", ui: "#343746", border: "#21222c", term: {
    background: "#282a36", foreground: "#f8f8f2", cursor: "#f8f8f2", cursorAccent: "#282a36",
    selectionBackground: "rgba(248,248,242,0.2)", selectionForeground: "#ffffff",
    black: "#21222c", red: "#ff5555", green: "#50fa7b", yellow: "#f1fa8c",
    blue: "#bd93f9", magenta: "#ff79c6", cyan: "#8be9fd", white: "#f8f8f2",
    brightBlack: "#6272a4", brightRed: "#ff6e6e", brightGreen: "#69ff94",
    brightYellow: "#ffffa5", brightBlue: "#d6acff", brightMagenta: "#ff92df",
    brightCyan: "#a4ffff", brightWhite: "#ffffff",
  }},
  { name: "Monokai", body: "#272822", ui: "#3e3d32", border: "#1e1f1c", term: {
    background: "#272822", foreground: "#f8f8f2", cursor: "#f8f8f2", cursorAccent: "#272822",
    selectionBackground: "rgba(248,248,242,0.2)", selectionForeground: "#ffffff",
    black: "#272822", red: "#f92672", green: "#a6e22e", yellow: "#f4bf75",
    blue: "#66d9ef", magenta: "#ae81ff", cyan: "#a1efe4", white: "#f8f8f2",
    brightBlack: "#75715e", brightRed: "#f92672", brightGreen: "#a6e22e",
    brightYellow: "#f4bf75", brightBlue: "#66d9ef", brightMagenta: "#ae81ff",
    brightCyan: "#a1efe4", brightWhite: "#f9f8f5",
  }},
  { name: "Nord", body: "#2e3440", ui: "#3b4252", border: "#262c38", term: {
    background: "#2e3440", foreground: "#d8dee9", cursor: "#d8dee9", cursorAccent: "#2e3440",
    selectionBackground: "rgba(216,222,233,0.2)", selectionForeground: "#eceff4",
    black: "#3b4252", red: "#bf616a", green: "#a3be8c", yellow: "#ebcb8b",
    blue: "#81a1c1", magenta: "#b48ead", cyan: "#88c0d0", white: "#e5e9f0",
    brightBlack: "#4c566a", brightRed: "#bf616a", brightGreen: "#a3be8c",
    brightYellow: "#ebcb8b", brightBlue: "#81a1c1", brightMagenta: "#b48ead",
    brightCyan: "#8fbcbb", brightWhite: "#eceff4",
  }},
  { name: "Light", body: "#f5f5f5", ui: "#e8e8e8", border: "#d0d0d0", term: {
    background: "#ffffff", foreground: "#333333", cursor: "#333333", cursorAccent: "#ffffff",
    selectionBackground: "rgba(0,0,0,0.15)", selectionForeground: "#000000",
    black: "#000000", red: "#c91b00", green: "#00a600", yellow: "#a68b00",
    blue: "#0225c7", magenta: "#c930c7", cyan: "#00a6b2", white: "#bfbfbf",
    brightBlack: "#686868", brightRed: "#ff6e67", brightGreen: "#5ffa68",
    brightYellow: "#fffc67", brightBlue: "#6871ff", brightMagenta: "#ff76ff",
    brightCyan: "#60fdff", brightWhite: "#ffffff",
  }},
];

window.__SF_PANE_COLORS = ["", "red", "green", "yellow", "blue", "purple", "orange"];

window.__SF_PANE_COLOR_PRESETS = {
  "":      { label: "Default", bg: null,      fg: null,      indicator: null      },
  red:     { label: "Red",     bg: "#2a1215", fg: "#f8c4c4", indicator: "#ff453a" },
  green:   { label: "Green",   bg: "#122a15", fg: "#c4f8c8", indicator: "#30d158" },
  yellow:  { label: "Yellow",  bg: "#2a2512", fg: "#f8f0c4", indicator: "#ffd60a" },
  blue:    { label: "Blue",    bg: "#121a2a", fg: "#c4d4f8", indicator: "#5a9df8" },
  purple:  { label: "Purple",  bg: "#1f122a", fg: "#dcc4f8", indicator: "#bf5af2" },
  orange:  { label: "Orange",  bg: "#2a1e12", fg: "#f8dcc4", indicator: "#ff9f0a" },
  cyan:    { label: "Cyan",    bg: "#122a28", fg: "#c4f8f0", indicator: "#00b8d4" },
};
