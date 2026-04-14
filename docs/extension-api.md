# Shellfire Extension API Reference

Shellfire v3 exposes a stable extension API via the `window.shellfire.ext` object, available in every extension's `index.js` at runtime.

---

## Extension Manifest (`plugin.json`)

Every extension must have a `plugin.json` at its root.

```jsonc
{
  "name": "my-extension",       // unique id, lowercase, hyphens ok
  "displayName": "My Extension",
  "version": "1.0.0",
  "description": "What this extension does.",
  "author": "Your Name",
  "type": "extension",          // "extension" | "theme" | "command" | "statusbar"
  "main": "index.js",           // entry point, relative to plugin root
  "icon": "icon.png",           // optional, shown in marketplace
  "keywords": ["git", "productivity"],
  "permissions": [              // declare what you need (shown to user on install)
    "terminal.read",            // read terminal output
    "terminal.write",           // send keystrokes to terminal
    "ui.toolbar",               // add toolbar buttons
    "ui.panel",                 // add side panels
    "ui.menu",                  // add context menu items
    "ui.statusbar",             // add status bar widgets
    "storage.read",             // read extension storage
    "storage.write"             // write extension storage
  ]
}
```

### Extension Types

| Type | Description |
|------|-------------|
| `extension` | General-purpose extension. Full API access. |
| `theme` | CSS theme. Exports `colors` object only. |
| `command` | Adds commands to the command palette. |
| `statusbar` | Adds a widget to the status bar. |

---

## Extension Entry Point

Your `index.js` is evaluated in the renderer context with `window.shellfire.ext` injected. It must export an `activate` function (and optionally `deactivate`).

```js
// index.js — minimal extension
module.exports = {
  activate(api) {
    // api is the full ShellFireExtensionAPI
    api.ui.toolbar.add({
      id: "my-btn",
      icon: "⚡",
      tooltip: "Do something",
      onClick: () => api.terminal.send("echo hello\n"),
    });
  },

  deactivate() {
    // called when extension is disabled or uninstalled
    // clean up timers, event listeners, DOM nodes here
  },
};
```

---

## API Reference

### `api.terminal`

Interact with terminal panes.

#### `api.terminal.getActive()`
Returns the currently focused pane ID, or `null`.
```js
const id = api.terminal.getActive(); // number | null
```

#### `api.terminal.getAll()`
Returns an array of all open pane descriptors.
```js
const panes = api.terminal.getAll();
// [{ id: 1, name: "Terminal 1", cwd: "/Users/..." }, ...]
```

#### `api.terminal.send(text, paneId?)`
Writes text to a terminal as keyboard input. Omit `paneId` to target the active pane.
```js
api.terminal.send("ls -la\n");
api.terminal.send("git status\n", 2);
```

#### `api.terminal.getOutput(paneId?, lines?)`
Returns the scrollback buffer of a pane (last N lines). Omit `paneId` for active pane.
```js
const output = api.terminal.getOutput(undefined, 50);
```

#### `api.terminal.onOutput(callback, paneId?)`
Called every time a pane emits output. Returns a disposable.
```js
const sub = api.terminal.onOutput((data, id) => {
  if (data.includes("Error")) console.warn("Error detected in pane", id);
});
// later: sub.dispose();
```

#### `api.terminal.onInput(callback, paneId?)`
Intercept keyboard input before it reaches the PTY. Return `false` to suppress.
```js
const sub = api.terminal.onInput((text, id) => {
  if (text === "\x01") return false; // suppress Ctrl+A
});
```

#### `api.terminal.create(cwd?)`
Opens a new terminal pane.
```js
const id = await api.terminal.create("~/projects/my-app");
```

#### `api.terminal.focus(paneId)`
Focuses a specific pane.
```js
api.terminal.focus(2);
```

---

### `api.ui.toolbar`

Add buttons to the top toolbar.

#### `api.ui.toolbar.add(config)`
```js
const btn = api.ui.toolbar.add({
  id: "my-action",           // unique id
  icon: "🔥",                // emoji or URL to 16×16 image
  tooltip: "Run my action",
  label: "Run",              // optional text label
  onClick: () => { /* ... */ },
});
btn.remove();                // remove the button later
```

---

### `api.ui.panel`

Add a side panel (shows in the IDE sidebar).

#### `api.ui.panel.add(config)`
```js
const panel = api.ui.panel.add({
  id: "my-panel",
  title: "My Panel",
  icon: "📋",
  render(container) {
    // container is a <div> you own — add DOM nodes here
    container.innerHTML = "<p>Hello from my panel!</p>";
  },
  onShow() { /* panel became visible */ },
  onHide() { /* panel was hidden */ },
});
panel.refresh();             // call render() again
panel.remove();              // remove the panel
```

---

### `api.ui.menu`

Add items to the terminal context menu.

#### `api.ui.menu.add(config)`
```js
api.ui.menu.add({
  id: "copy-path",
  label: "Copy File Path",
  when: (ctx) => ctx.selection?.includes("/"), // show conditionally
  onClick: (ctx) => navigator.clipboard.writeText(ctx.selection),
});
```

**Context object:**
```ts
{
  paneId: number,
  selection: string,   // selected text (empty string if none)
  x: number, y: number // click position
}
```

---

### `api.ui.statusbar`

Add a widget to the right-side status bar.

#### `api.ui.statusbar.add(config)`
```js
const widget = api.ui.statusbar.add({
  id: "my-widget",
  text: "🟢 OK",
  tooltip: "All systems nominal",
  onClick: () => { /* ... */ },
});

// Update later:
widget.setText("🔴 Error");
widget.setTooltip("Something went wrong");
widget.remove();
```

---

### `api.commands`

Register commands that appear in the command palette (`Cmd+P`).

#### `api.commands.register(config)`
```js
api.commands.register({
  id: "my-ext.run-tests",
  name: "My Extension: Run Tests",
  keybinding: "Cmd+Shift+T",       // optional
  when: () => true,                // optional: show conditionally
  run: () => api.terminal.send("npm test\n"),
});
```

---

### `api.storage`

Key-value store, scoped to your extension. Data persists across restarts.

```js
await api.storage.set("lastRun", Date.now());
const ts = await api.storage.get("lastRun");    // number | undefined
await api.storage.delete("lastRun");
await api.storage.clear();                       // wipe all extension storage
```

---

### `api.ai`

Call the user's configured AI provider from within an extension.

#### `api.ai.complete(prompt)`
Single-turn completion. Returns the response text.
```js
const suggestion = await api.ai.complete("Suggest a git commit message for: " + diff);
```

#### `api.ai.chat(messages)`
Multi-turn chat. `messages` is an array of `{ role, content }` objects.
```js
const reply = await api.ai.chat([
  { role: "user", content: "Explain this error: " + errorText }
]);
```

---

### `api.events`

Emit and subscribe to custom events between extensions.

```js
// Publish
api.events.emit("my-ext.done", { file: "main.js" });

// Subscribe
const sub = api.events.on("other-ext.ready", (data) => {
  console.log("other extension ready:", data);
});
sub.dispose();
```

---

## Theme Extensions

A `theme` type extension exports a `colors` object. No `activate` needed.

```js
// index.js for a theme
module.exports = {
  colors: {
    background:   "#0d1117",
    foreground:   "#c9d1d9",
    cursor:       "#58a6ff",
    selection:    "#388bfd33",
    black:        "#484f58",
    red:          "#ff7b72",
    green:        "#3fb950",
    yellow:       "#d29922",
    blue:         "#58a6ff",
    magenta:      "#bc8cff",
    cyan:         "#39c5cf",
    white:        "#b1bac4",
    brightBlack:  "#6e7681",
    brightRed:    "#ffa198",
    brightGreen:  "#56d364",
    brightYellow: "#e3b341",
    brightBlue:   "#79c0ff",
    brightMagenta:"#d2a8ff",
    brightCyan:   "#56d4dd",
    brightWhite:  "#f0f6fc",
    // UI chrome (optional — falls back to defaults)
    uiBackground: "#0d1117",
    uiBorder:     "#30363d",
    uiText:       "#c9d1d9",
    uiAccent:     "#58a6ff",
    tabActive:    "#161b22",
    tabInactive:  "#0d1117",
  },
};
```

---

## Lifecycle

Extensions are loaded after the renderer initializes. The call order is:

1. Main process registers IPC handlers
2. Renderer loads and calls `window.shellfire.ext.load()` for each installed plugin
3. Each plugin's `activate(api)` is called in order
4. When the user disables or uninstalls an extension, `deactivate()` is called

**Avoid:**
- Mutating global DOM outside your container elements
- Holding strong references to pane objects (use IDs)
- Blocking the event loop in `activate` — use `async` freely

---

## Packaging

Bundle your extension as a `.termext` file (a zip archive with `plugin.json` at root):

```bash
cd my-extension/
zip -r my-extension.termext plugin.json index.js icon.png
```

Install via **Extensions → Install from file** or drop the file onto the Shellfire window.

---

## Examples

See `examples/plugins/` in the Shellfire repo for working examples:

| Example | Type | What it shows |
|---------|------|---------------|
| `git-status` | extension | Status bar git integration |
| `error-highlighter` | extension | `onOutput` hook, context menus |
| `nord-theme` | theme | Full color theme |
| `docker-run` | command | Command palette + terminal.send |
| `cpu-monitor` | statusbar | Polling statusbar widget |

---

## AI-Assisted Development

Open the **Extension Builder** (`Cmd+Shift+E`) to use AI to scaffold, write, or modify extensions using natural language. The builder understands the full API and can generate complete working extensions from a description.
