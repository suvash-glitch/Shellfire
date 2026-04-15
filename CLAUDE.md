# CLAUDE.md — Shellfire v3

Guidance for Claude Code when working in this repository.

## What This Is

Shellfire is an AI-powered terminal multiplexer built with Electron. It provides split panes, tabs, AI autocomplete (Claude / OpenAI / Gemini / Ollama), SSH remote sessions, Docker management, a plugin/extension system, and a CLI + MCP server for programmatic control.

---

## Commands

```bash
npm start                   # Build renderer + launch app in dev mode (electron .)
npm run build:renderer      # Regenerate renderer.js from src/renderer/ modules
npm run watch:renderer      # Rebuild renderer.js on every src/renderer/ change
npm run rebuild             # Rebuild native modules (node-pty) — required after npm install
npm test                    # Run all 133 tests (Node.js built-in test runner)
npm run lint                # ESLint check
npm run lint:fix            # ESLint auto-fix
npm run build               # Build macOS distributable (.dmg, .zip)
npm run build:win           # Build Windows distributable (.exe, .zip)
npm run build:linux         # Build Linux distributable (.AppImage, .deb)
```

**Editing renderer modules:**  
Edit files in `src/renderer/`, then `npm run build:renderer` to regenerate `renderer.js`. The `prestart` hook runs this automatically so `npm start` always uses fresh modules.

---

## Architecture

Shellfire follows Electron's two-process model with strict context isolation.

### Main Process (`main.js` + `src/main/`)

`main.js` is a thin entry point (~55 lines). All logic is in focused modules:

| Module | Responsibility |
|--------|---------------|
| `src/main/state.js` | Shared state: PTY maps, window reference, `sendToRenderer` |
| `src/main/utils.js` | `log`, `execFileAsync`, `sanitizePath`, `readJSON`, `writeJSON`, validators |
| `src/main/pty-manager.js` | PTY lifecycle: create, resize, input, kill, cwd/process query |
| `src/main/socket-server.js` | Unix socket server for CLI & MCP (`~/.shellfire/*.sock`) |
| `src/main/storage.js` | All persistent data IPC handlers (session, config, settings, secrets…) |
| `src/main/ai-service.js` | `ai-chat` and `ai-complete` IPC handlers (4 providers) |
| `src/main/ssh-manager.js` | SSH remote session listing and local pane creation |
| `src/main/system-handlers.js` | Cron, Docker, ports, git, system stats, file dialogs, pipeline runner |
| `src/main/plugin-system.js` | Plugin load/install/uninstall, marketplace registry, .termext packaging |
| `src/main/window-manager.js` | BrowserWindow creation, auto-updater, zen mode, zoom, window controls |

### Renderer (`src/renderer/` + generated `renderer.js`)

`renderer.js` is **generated** — edit the source modules in `src/renderer/`, then run `npm run build:renderer`. The `prestart` hook runs the build automatically before `npm start`.

| Module | Lines | What it does |
|--------|-------|--------------|
| `010-state.js` | 34 | All shared mutable state (panes, layout, settings…) |
| `020-extension-api.js` | 54 | `window._termExt` — legacy extension API surface |
| `030-themes.js` | 72 | Built-in theme data (6 themes + pane color presets) |
| `040-utils.js` | 40 | `escHtml`, `showToast`, `launchClaude` helpers |
| `050-theme-manager.js` | 196 | `applyTheme()`, `applyZoom()`, `setFontSize()` |
| `060-layout.js` | 74 | Grid layout, fit/resize panes |
| `070-pane-manager.js` | 554 | `createPaneObj()`, `addTerminal()`, `removeTerminal()`, `setActive()` |
| `080-ipc.js` | 47 | `terminal-data`, `terminal-exit` IPC handlers |
| `090-ui.js` | 236 | Search bar, context menu, snippets, profiles |
| `100-command-palette.js` | 139 | Command palette (Cmd+P) |
| `110-session.js` | 213 | Save/restore session |
| `120-tab-bar.js` | 167 | Pane numbers, tab bar, updateTabBar |
| `130-tools.js` | 360 | Cron, recent dirs, fuzzy find, smart paste, drag, quick bar |
| `140-handlers.js` | 279 | Button handlers, keyboard shortcuts, keyword watcher |
| `150-ssh.js` | 359 | SSH bookmarks + remote connection |
| `160-panels.js` | 551 | System monitor, logging, floating pane, notes, env vars, Docker, ports, AI error detection |
| `165-marketplace.js` | 292 | Extension marketplace UI |
| `170-pipeline.js` | 609 | Pipeline visual editor (node graph) |
| `180-bookmarks.js` | 147 | Command bookmarks |
| `185-url-command-tab.js` | 485 | URL preview, command duration, smart tab names, dir bookmarks, watch mode, cross-pane search, file preview |
| `190-ide-zen.js` | 337 | IDE mode, zen mode, enhanced tab bar |
| `200-settings.js` | 404 | Settings UI, keybinding editor, onboarding |
| `210-resize.js` | 24 | Resize/cleanup lifecycle |
| `220-plugin-system.js` | 270 | Plugin loading, activation, deactivation |
| `230-secrets.js` | 114 | Secrets vault UI |
| `240-status-bar.js` | 158 | Status bar widgets (clock, k8s, AWS, node) + enhanced PiP |
| `250-quick-actions.js` | 172 | Quick actions on terminal output |
| `260-startup-tasks.js` | 189 | Startup tasks UI |
| `270-init.js` | 247 | App init, PTY reattach, auto-save, session restore |
| `280-expose.js` | 101 | `window.__panes` etc. for socket server + auto-update UI |

### Preload (`preload.js`)

Context bridge. Exposes `window.shellfire.*` IPC methods. Does not change between v2 and v3.

### Extension System

Extensions live in `~/.shellfire/plugins/`, each as a folder with:
- `plugin.json` — manifest (name, type, main, permissions)
- `index.js` (or custom `main`) — code, exports `{ activate(api), deactivate() }`

**Extension API** is documented in `docs/extension-api.md`.

Types: `extension`, `theme`, `command`, `statusbar`.

### MCP Server (`mcp/shellfire-mcp.js`)

Exposes Shellfire sessions to Claude via MCP / JSON-RPC 2.0 over stdio.
Tools: `shellfire_list`, `shellfire_read`, `shellfire_send`, `shellfire_new`, `shellfire_kill`, `shellfire_rename`.

### CLI (`bin/shellfire-cli.js`)

Communicates with the running app over the Unix socket.
Commands: `list`, `new`, `attach`, `send`, `kill`, `rename`, `remote`.

---

## Code Style

- 2-space indentation, double quotes, always semicolons
- `const` by default, `let` when needed, never `var`
- `function` declarations in main process; arrow functions fine in renderer
- camelCase for variables/functions, PascalCase for classes
- Each `src/main/` module: `registerHandlers()` export wires up IPC, plus named exports for shared logic
- Commit message prefixes: `Add`, `Fix`, `Update`, `Remove`, `Refactor`, `Docs`, `Test`

---

## Key Data Paths

All user data lives in `app.getPath("userData")` (e.g. `~/Library/Application Support/shellfire/`):

| File | Contents |
|------|----------|
| `session.json` | Pane layout + restore commands |
| `settings.json` | All user preferences |
| `secrets.json` | AES-256-CBC encrypted secrets |
| `plugins/` (in `~/.shellfire/`) | Installed extensions |
| `~/.shellfire/*.sock` | Unix socket for CLI/MCP |

---

## Build Prerequisites

- Node.js 18+, npm 9+
- Python 3.x (for node-pty native compilation)
- Xcode Command Line Tools (macOS) or equivalent C++ build tools

---

## Extension Development

Extensions live in `~/.shellfire/plugins/{name}/`. Drop a folder with `plugin.json` + `index.js` there and restart Shellfire. See `docs/extension-api.md` for the API reference and `examples/plugins/` for working examples.
