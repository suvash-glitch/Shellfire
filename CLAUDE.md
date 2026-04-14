# CLAUDE.md — Shellfire v3

Guidance for Claude Code when working in this repository.

## What This Is

Shellfire is an AI-powered terminal multiplexer built with Electron. It provides split panes, tabs, AI autocomplete (Claude / OpenAI / Gemini / Ollama), SSH remote sessions, Docker management, a plugin/extension system, a visual Extension Builder with AI assistance, and a CLI + MCP server for programmatic control.

---

## Commands

```bash
npm start             # Launch app in dev mode (electron .)
npm run rebuild       # Rebuild native modules (node-pty) — required after npm install
npm test              # Run all tests (Node.js built-in test runner)
npm run lint          # ESLint check
npm run lint:fix      # ESLint auto-fix
npm run build         # Build macOS distributable (.dmg, .zip)
npm run build:win     # Build Windows distributable (.exe, .zip)
npm run build:linux   # Build Linux distributable (.AppImage, .deb)
```

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

### Extension Builder (`src/extension-builder/`)

A dedicated Electron BrowserWindow for authoring extensions:

| File | Role |
|------|------|
| `window.js` | Opens/focuses the builder window; registers `open-extension-builder` IPC |
| `preload.js` | Context bridge — exposes `window.builder.*` to the UI |
| `ipc-handlers.js` | File I/O, AI generation, install, export handlers |
| `index.html` | Builder UI shell |
| `renderer.js` | Editor, file tree, AI chat, manifest form, tab management |

Open via `Cmd+Shift+E` or **Extensions → Extension Builder**.

### Renderer (`renderer.js`)

> **v3 refactor in progress** — currently a single file (~7k lines). Planned split into `src/renderer/` modules: `pane-manager`, `layout-manager`, `theme-manager`, `command-palette`, `terminal-manager`, `extension-runtime`.

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

See `docs/extension-api.md` for the full Extension API reference.

Use the visual Extension Builder (`Cmd+Shift+E`) for AI-assisted development.
Example extensions: `examples/plugins/`.
