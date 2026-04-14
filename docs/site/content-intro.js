// Intro + User Guide sections
const CONTENT_INTRO = {

overview: `
<div class="hero">
  <h1><span class="tag">v3</span>Shellfire Documentation</h1>
  <p class="lead">Shellfire is an AI-powered terminal multiplexer for macOS, Windows, and Linux. Split panes, persistent sessions, AI autocomplete, SSH remote control, a rich extension system, and a CLI + MCP server — all in one app.</p>
  <div class="hero-badges">
    <span class="hero-badge">Electron <span>35+</span></span>
    <span class="hero-badge">node-pty <span>PTY backend</span></span>
    <span class="hero-badge">xterm.js <span>WebGL renderer</span></span>
    <span class="hero-badge">Claude / OpenAI / Gemini / Ollama</span>
    <span class="hero-badge">MCP + CLI</span>
  </div>
</div>

<h2>What makes Shellfire different?</h2>
<p>Most terminal apps are just shells with tabs. Shellfire treats the terminal as a platform:</p>
<div class="feature-grid">
  <div class="feature-card"><div class="icon">🔥</div><h3>Tmux-like persistence</h3><p>Close the window — your PTYs keep running. Reopen and everything replays exactly where you left off, including alt-screen apps like vim and Claude Code.</p></div>
  <div class="feature-card"><div class="icon">🤖</div><h3>AI-native</h3><p>Shell autocomplete powered by Claude, GPT-4o, Gemini or local Ollama. AI chat panel, AI-generated extensions, AI commit messages.</p></div>
  <div class="feature-card"><div class="icon">🔌</div><h3>Extension platform</h3><p>100+ official extensions. Build your own with a visual Extension Builder, full JS API, and AI assistance. Publish as .termext packages.</p></div>
  <div class="feature-card"><div class="icon">🌐</div><h3>Remote control</h3><p>CLI and MCP server let Claude Code (or any agent) list, read, and send to your terminal sessions programmatically.</p></div>
  <div class="feature-card"><div class="icon">🚀</div><h3>SSH multiplexer</h3><p>Connect to a remote host running Shellfire and mirror all its terminal sessions locally in one click.</p></div>
  <div class="feature-card"><div class="icon">🎨</div><h3>Themeable to the core</h3><p>6 built-in themes, 20+ extension themes, custom CSS variables. The Extension Builder lets you create themes with AI in seconds.</p></div>
</div>
`,

features: `
<h1>Features</h1>
<p class="lead">A complete reference of everything Shellfire can do.</p>

<h2>Terminal Core</h2>
<div class="table-wrap"><table>
<tr><th>Feature</th><th>Details</th></tr>
<tr><td>Split panes</td><td>Horizontal and vertical splits, unlimited depth. Drag-to-resize dividers.</td></tr>
<tr><td>Tabs</td><td>Named tabs, drag-to-reorder, color-coded with 8 preset colors.</td></tr>
<tr><td>Session persistence</td><td>PTYs survive window close on macOS. Full scrollback replayed on reopen.</td></tr>
<tr><td>Broadcast mode</td><td>Type once, output to all panes simultaneously. <kbd>Cmd+Shift+B</kbd></td></tr>
<tr><td>GPU rendering</td><td>xterm.js with WebGL addon — fast even with high-frequency output.</td></tr>
<tr><td>Zoom</td><td>App-wide zoom (<kbd>Cmd++</kbd>/<kbd>Cmd+-</kbd>) and pane zoom (<kbd>Cmd+Shift+Z</kbd>).</td></tr>
<tr><td>Find in terminal</td><td>Regex search with match highlighting. <kbd>Cmd+F</kbd></td></tr>
<tr><td>Clickable URLs</td><td>Automatically detected and opened in browser.</td></tr>
<tr><td>Smart paste guard</td><td>Warns before pasting multi-line commands.</td></tr>
</table></div>

<h2>AI Features</h2>
<div class="table-wrap"><table>
<tr><th>Feature</th><th>Provider support</th></tr>
<tr><td>Shell autocomplete</td><td>Claude (Haiku), GPT-4o-mini, Gemini Flash, Ollama</td></tr>
<tr><td>AI Chat panel</td><td>Claude, GPT-4o, Gemini Pro, Ollama — in-context terminal assistant</td></tr>
<tr><td>Extension generation</td><td>Claude Sonnet / any provider via Extension Builder</td></tr>
</table></div>

<h2>Remote & Integrations</h2>
<div class="table-wrap"><table>
<tr><th>Feature</th><th>Notes</th></tr>
<tr><td>SSH remote sessions</td><td>Mirror a remote Shellfire's panes locally. Password or key auth.</td></tr>
<tr><td>Docker manager</td><td>List running containers, exec into them in a new pane.</td></tr>
<tr><td>Port manager</td><td>View listening TCP ports, kill by PID.</td></tr>
<tr><td>Cron manager</td><td>View and edit crontab entries with a visual UI.</td></tr>
<tr><td>Git integration</td><td>Branch name and dirty status in the status bar per pane.</td></tr>
<tr><td>k8s / AWS / Node</td><td>Current context, profile, and version in the status bar.</td></tr>
</table></div>

<h2>Developer Tools</h2>
<div class="table-wrap"><table>
<tr><th>Tool</th><th>Description</th></tr>
<tr><td>CLI (<code>shellfire</code>)</td><td>List, create, attach, send, kill, rename sessions from any terminal.</td></tr>
<tr><td>MCP server</td><td>6 MCP tools for Claude Code integration.</td></tr>
<tr><td>Secrets vault</td><td>AES-256-CBC encrypted env vars, injected into panes without shell history.</td></tr>
<tr><td>Pipeline runner</td><td>Multi-step command pipelines with stdout/stderr capture and export.</td></tr>
<tr><td>Startup tasks</td><td>Auto-run commands when Shellfire opens.</td></tr>
<tr><td>Session recording</td><td>Log pane output to <code>~/.config/shellfire/logs/terminal-N.log</code>.</td></tr>
</table></div>
`,

installation: `
<h1>Installation</h1>
<p class="lead">Shellfire ships as a signed, notarized desktop app and an npm-installable CLI.</p>

<h2>macOS</h2>
<div class="code-block"><span class="lang-label">bash</span><button class="copy-btn">Copy</button><pre><span class="cm"># Download the latest .dmg from GitHub Releases</span>
open https://github.com/suvash-glitch/Shellfire/releases/latest

<span class="cm"># Or via Homebrew (tap)</span>
brew tap suvash-glitch/shellfire
brew install --cask shellfire</pre></div>

<h2>Windows</h2>
<div class="code-block"><span class="lang-label">bash</span><button class="copy-btn">Copy</button><pre><span class="cm"># Download Shellfire-Setup.exe from GitHub Releases</span>
<span class="cm"># Or via winget:</span>
winget install Shellfire</pre></div>

<h2>Linux</h2>
<div class="code-block"><span class="lang-label">bash</span><button class="copy-btn">Copy</button><pre><span class="cm"># AppImage (universal)</span>
chmod +x Shellfire.AppImage && ./Shellfire.AppImage

<span class="cm"># Debian/Ubuntu</span>
sudo dpkg -i shellfire.deb</pre></div>

<h2>Build from source</h2>
<div class="callout note"><strong>Prerequisites</strong>Node.js 18+, npm 9+, Python 3.x, Xcode CLT (macOS) or equivalent C++ build tools.</div>
<div class="code-block"><span class="lang-label">bash</span><button class="copy-btn">Copy</button><pre>git clone https://github.com/suvash-glitch/Shellfire.git
cd Shellfire
npm install
npm run rebuild   <span class="cm"># rebuild node-pty native module</span>
npm start         <span class="cm"># launch in dev mode</span></pre></div>

<h2>CLI only (npm)</h2>
<div class="code-block"><span class="lang-label">bash</span><button class="copy-btn">Copy</button><pre>npm install -g shellfire-cli
shellfire list   <span class="cm"># requires Shellfire app to be running</span></pre></div>

<h2>MCP Server (Claude Code)</h2>
<p>Add to your <code>~/.claude/settings.json</code>:</p>
<div class="code-block"><span class="lang-label">json</span><button class="copy-btn">Copy</button><pre>{
  <span class="prop">"mcpServers"</span>: {
    <span class="prop">"shellfire"</span>: {
      <span class="prop">"command"</span>: <span class="str">"node"</span>,
      <span class="prop">"args"</span>: [<span class="str">"/path/to/Shellfire/mcp/shellfire-mcp.js"</span>]
    }
  }
}</pre></div>
`,

quickstart: `
<h1>Quick Start</h1>
<p class="lead">Go from zero to productive in under 5 minutes.</p>

<ol class="steps">
  <li><div class="step-num">1</div><div class="step-body"><h3>Launch Shellfire</h3><p>Open the app. A single pane starts with your default shell. The title bar shows no window chrome on macOS — traffic lights are inset.</p></div></li>
  <li><div class="step-num">2</div><div class="step-body"><h3>Split your first pane</h3><p>Press <kbd>Cmd+D</kbd> for a vertical split or <kbd>Cmd+Shift+D</kbd> for horizontal. Drag the divider to resize. Click any pane to focus it.</p></div></li>
  <li><div class="step-num">3</div><div class="step-body"><h3>Open the Command Palette</h3><p>Press <kbd>Cmd+P</kbd> to open the command palette. Type anything — commands, settings, actions — and press Enter. This is the fastest way to navigate Shellfire.</p></div></li>
  <li><div class="step-num">4</div><div class="step-body"><h3>Enable AI autocomplete</h3><p>Go to <strong>Settings → AI</strong> (<kbd>Cmd+,</kbd>), enter your Anthropic or OpenAI API key, and toggle AI Autocomplete on. Now start typing a command and press <kbd>Tab</kbd> to accept suggestions.</p></div></li>
  <li><div class="step-num">5</div><div class="step-body"><h3>Install an extension</h3><p>Open <strong>Extensions → Marketplace</strong> from the toolbar. Browse the catalogue and click Install. The extension activates immediately — no restart needed.</p></div></li>
  <li><div class="step-num">6</div><div class="step-body"><h3>Close and reopen</h3><p>Quit Shellfire (<kbd>Cmd+Q</kbd>). Reopen it. Your panes, scrollback history, and running processes are all exactly where you left them.</p></div></li>
</ol>
`,

panes: `
<h1>Panes & Splits</h1>
<p class="lead">Shellfire's grid layout lets you arrange any number of terminal panes side by side.</p>

<h2>Creating panes</h2>
<div class="table-wrap"><table>
<tr><th>Action</th><th>Shortcut</th></tr>
<tr><td>New pane (vertical split)</td><td><kbd>Cmd+D</kbd></td></tr>
<tr><td>New pane (horizontal split)</td><td><kbd>Cmd+Shift+D</kbd></td></tr>
<tr><td>New pane (new tab)</td><td><kbd>Cmd+T</kbd></td></tr>
<tr><td>Close active pane</td><td><kbd>Cmd+W</kbd></td></tr>
</table></div>

<h2>Navigating panes</h2>
<div class="table-wrap"><table>
<tr><th>Action</th><th>Shortcut</th></tr>
<tr><td>Focus next pane</td><td><kbd>Cmd+]</kbd></td></tr>
<tr><td>Focus previous pane</td><td><kbd>Cmd+[</kbd></td></tr>
<tr><td>Zoom active pane (fullscreen)</td><td><kbd>Cmd+Shift+Z</kbd></td></tr>
</table></div>

<h2>Pane colors</h2>
<p>Right-click any pane header to assign a color label (red, green, yellow, blue, purple, orange, cyan). Colors tint the header and scrollbar for quick visual identification.</p>

<h2>Pane locking</h2>
<p>Right-click → <strong>Lock pane</strong> to prevent accidental input. Locked panes display a lock icon and ignore all keyboard input until unlocked.</p>

<h2>Broadcast mode</h2>
<p>Press <kbd>Cmd+Shift+B</kbd> to enter broadcast mode. Every keystroke is sent to <em>all visible panes simultaneously</em>. Useful for running the same command on multiple shells. A bright indicator shows broadcast is active.</p>

<h2>Session persistence</h2>
<p>When you close the Shellfire window (but not quit the app), all PTY processes continue running in the background. Reopening the window replays the full scrollback buffer to each pane — bit-for-bit identical, so even interactive apps like <code>vim</code> or <code>claude</code> restore correctly.</p>

<div class="callout tip"><strong>Tip</strong>On macOS, closing the window (Cmd+W on the app) keeps PTYs alive. To fully quit and kill all processes, use Cmd+Q.</div>
`,

themes: `
<h1>Themes</h1>
<p class="lead">Six built-in themes plus unlimited extension themes, all hot-swappable.</p>

<h2>Built-in themes</h2>
<div class="table-wrap"><table>
<tr><th>Name</th><th>Background</th><th>Character</th></tr>
<tr><td>Dark</td><td><code>#1e1e1e</code></td><td>Classic VS Code dark</td></tr>
<tr><td>Solarized Dark</td><td><code>#002b36</code></td><td>Warm earth tones</td></tr>
<tr><td>Dracula</td><td><code>#282a36</code></td><td>Purple-tinted classic</td></tr>
<tr><td>Monokai</td><td><code>#272822</code></td><td>High-contrast warm</td></tr>
<tr><td>Nord</td><td><code>#2e3440</code></td><td>Arctic blue-grey</td></tr>
<tr><td>Light</td><td><code>#f5f5f5</code></td><td>Clean white</td></tr>
</table></div>

<h2>Switching themes</h2>
<p>Three ways to switch:</p>
<ul>
<li><strong>Command Palette</strong> (<kbd>Cmd+P</kbd>) → type "Theme" → pick from list</li>
<li><strong>Settings</strong> (<kbd>Cmd+,</kbd>) → Appearance tab → Theme dropdown</li>
<li><strong>Toolbar</strong> → theme indicator badge</li>
</ul>

<h2>Installing theme extensions</h2>
<p>Open <strong>Extensions → Marketplace</strong> and filter by type "Theme". Theme extensions install and appear in the theme list immediately.</p>

<h2>Creating themes</h2>
<p>See the <a href="#" onclick="navigate('ext-theme')">Theme Tutorial</a> or use the <a href="#" onclick="navigate('ext-builder')">Extension Builder</a> with a prompt like "Create a Tokyo Night theme".</p>

<h2>Theme color reference</h2>
<p>A theme extension exports a <code>colors</code> object with these keys:</p>
<div class="code-block"><span class="lang-label">js</span><button class="copy-btn">Copy</button><pre>module.exports = {
  colors: {
    <span class="cm">// Terminal colors (required)</span>
    background, foreground, cursor, selection,
    black, red, green, yellow, blue, magenta, cyan, white,
    brightBlack, brightRed, brightGreen, brightYellow,
    brightBlue, brightMagenta, brightCyan, brightWhite,

    <span class="cm">// UI chrome (optional — defaults derived from background)</span>
    uiBackground, uiBorder, uiText, uiAccent,
    tabActive, tabInactive,
  }
};</pre></div>
`,

keyboard: `
<h1>Keyboard Shortcuts</h1>
<p class="lead">Every action in Shellfire has a keyboard shortcut. All shortcuts are remappable in Settings → Keybindings.</p>

<h2>Pane Management</h2>
<div class="shortcut-grid">
  <div class="shortcut-row"><span class="label">Vertical split</span><span class="keys"><kbd>Cmd+D</kbd></span></div>
  <div class="shortcut-row"><span class="label">Horizontal split</span><span class="keys"><kbd>Cmd+Shift+D</kbd></span></div>
  <div class="shortcut-row"><span class="label">New tab</span><span class="keys"><kbd>Cmd+T</kbd></span></div>
  <div class="shortcut-row"><span class="label">Close pane / tab</span><span class="keys"><kbd>Cmd+W</kbd></span></div>
  <div class="shortcut-row"><span class="label">Next pane</span><span class="keys"><kbd>Cmd+]</kbd></span></div>
  <div class="shortcut-row"><span class="label">Previous pane</span><span class="keys"><kbd>Cmd+[</kbd></span></div>
  <div class="shortcut-row"><span class="label">Zoom pane</span><span class="keys"><kbd>Cmd+Shift+Z</kbd></span></div>
  <div class="shortcut-row"><span class="label">Broadcast mode</span><span class="keys"><kbd>Cmd+Shift+B</kbd></span></div>
</div>

<h2>UI</h2>
<div class="shortcut-grid">
  <div class="shortcut-row"><span class="label">Command Palette</span><span class="keys"><kbd>Cmd+P</kbd></span></div>
  <div class="shortcut-row"><span class="label">Settings</span><span class="keys"><kbd>Cmd+,</kbd></span></div>
  <div class="shortcut-row"><span class="label">Find in terminal</span><span class="keys"><kbd>Cmd+F</kbd></span></div>
  <div class="shortcut-row"><span class="label">Zoom in (app-wide)</span><span class="keys"><kbd>Cmd+=</kbd></span></div>
  <div class="shortcut-row"><span class="label">Zoom out</span><span class="keys"><kbd>Cmd+-</kbd></span></div>
  <div class="shortcut-row"><span class="label">Reset zoom</span><span class="keys"><kbd>Cmd+0</kbd></span></div>
  <div class="shortcut-row"><span class="label">IDE mode</span><span class="keys"><kbd>Cmd+Shift+I</kbd></span></div>
  <div class="shortcut-row"><span class="label">Zen mode</span><span class="keys"><kbd>Cmd+Shift+F</kbd></span></div>
  <div class="shortcut-row"><span class="label">Extension Builder</span><span class="keys"><kbd>Cmd+Shift+E</kbd></span></div>
</div>

<h2>AI</h2>
<div class="shortcut-grid">
  <div class="shortcut-row"><span class="label">Accept autocomplete</span><span class="keys"><kbd>Tab</kbd></span></div>
  <div class="shortcut-row"><span class="label">Dismiss autocomplete</span><span class="keys"><kbd>Esc</kbd></span></div>
  <div class="shortcut-row"><span class="label">Open AI chat</span><span class="keys"><kbd>Cmd+Shift+A</kbd></span></div>
</div>

<h2>Remapping shortcuts</h2>
<p>Go to <strong>Settings → Keybindings</strong>. Each action shows its current binding; click to record a new one. Bindings are stored in <code>~/.shellfire/keybindings.json</code>.</p>
`,

ai: `
<h1>AI Features</h1>
<p class="lead">Shellfire integrates AI at every layer — autocomplete, chat, extension generation, and more.</p>

<h2>Setup: API keys</h2>
<p>Open <strong>Settings → AI</strong> and enter your API key. Shellfire supports:</p>
<div class="table-wrap"><table>
<tr><th>Provider</th><th>Models</th><th>Key type</th></tr>
<tr><td>Anthropic (default)</td><td>Claude Haiku, Sonnet, Opus</td><td><code>ANTHROPIC_API_KEY</code></td></tr>
<tr><td>OpenAI</td><td>gpt-4o, gpt-4o-mini</td><td><code>OPENAI_API_KEY</code></td></tr>
<tr><td>Google Gemini</td><td>gemini-2.0-flash, pro</td><td><code>GOOGLE_API_KEY</code></td></tr>
<tr><td>Ollama (local)</td><td>Any local model</td><td>None — runs on localhost</td></tr>
<tr><td>OpenAI-compatible</td><td>Any (set base URL)</td><td>API key if required</td></tr>
</table></div>

<h2>AI Autocomplete</h2>
<p>Enable in Settings → AI → "AI Autocomplete". As you type a command, Shellfire sends the partial command plus context (cwd, git branch, recent history) to the AI. A ghost suggestion appears after a short delay. Press <kbd>Tab</kbd> to accept.</p>
<div class="callout tip"><strong>Context sent to the AI</strong>Current working directory, git branch, last 5 commands, and partial input. Nothing else. No file contents are sent without your explicit action.</div>

<h2>AI Chat panel</h2>
<p>Open via <kbd>Cmd+Shift+A</kbd> or the toolbar button. The chat knows about your current pane's recent output. Ask questions about errors, request command explanations, or get code suggestions.</p>

<h2>AI in Extension Builder</h2>
<p>The Extension Builder (<kbd>Cmd+Shift+E</kbd>) has a dedicated AI chat panel with deep knowledge of the Shellfire Extension API. Describe what you want and the AI generates complete, working extension code.</p>
<p>Example prompts that work well:</p>
<ul>
<li><em>"Add a toolbar button that copies the last command from this pane"</em></li>
<li><em>"Create a Catppuccin Mocha theme"</em></li>
<li><em>"Monitor a URL and alert in the status bar if it goes down"</em></li>
</ul>
`,

ssh: `
<h1>SSH Remote Sessions</h1>
<p class="lead">Connect to a remote machine running Shellfire and mirror all its terminal sessions locally.</p>

<h2>How it works</h2>
<p>Shellfire runs a Unix socket server on every machine. The SSH remote feature SSHes into the remote, probes the socket, and returns a list of active sessions. You can then open each remote session as a local pane with an SSH tunnel — without installing anything extra on the remote beyond Shellfire itself.</p>

<h2>Connecting</h2>
<ol class="steps">
  <li><div class="step-num">1</div><div class="step-body"><h3>Open SSH Manager</h3><p>Click the SSH icon in the toolbar or type "SSH" in the Command Palette.</p></div></li>
  <li><div class="step-num">2</div><div class="step-body"><h3>Add a bookmark</h3><p>Enter host, username, port (default 22), and optionally a password. SSH keys work automatically if configured in <code>~/.ssh/</code>.</p></div></li>
  <li><div class="step-num">3</div><div class="step-body"><h3>Connect</h3><p>Click Connect. Shellfire probes the remote Shellfire socket and shows all running sessions.</p></div></li>
  <li><div class="step-num">4</div><div class="step-body"><h3>Open sessions</h3><p>Select which sessions to mirror and click Open. Each creates a new local pane running <code>ssh -t user@host</code> and navigated to the remote cwd.</p></div></li>
</ol>

<div class="callout note"><strong>Requirement</strong>Shellfire must be running on the remote machine. Node.js must be installed on the remote (used to probe the socket). SSH key authentication is recommended over passwords.</div>
`,

docker: `
<h1>Docker & Port Manager</h1>
<p class="lead">View and interact with Docker containers and listening ports without leaving your terminal.</p>

<h2>Docker Manager</h2>
<p>Open via the toolbar Docker icon or Command Palette → "Docker". Shows all running containers with name, image, status, and port mappings. Click any container to exec into it in a new pane.</p>

<div class="callout note"><strong>Requirement</strong><code>docker</code> CLI must be installed and accessible in <code>PATH</code>.</div>

<h2>Port Manager</h2>
<p>Open via Command Palette → "Port Manager". Lists all TCP ports in LISTEN state with the owning process and PID. Click Kill next to any port to send SIGKILL to the owning process.</p>
<div class="callout warn"><strong>Warning</strong>Killing a port process sends SIGKILL immediately. There is no undo. Be sure you know what's listening before killing it.</div>
`,

palette: `
<h1>Command Palette</h1>
<p class="lead">The command palette (<kbd>Cmd+P</kbd>) is the fastest way to do anything in Shellfire.</p>

<h2>What's in the palette</h2>
<ul>
<li>All built-in actions (split, zoom, theme, settings, etc.)</li>
<li>Installed snippets</li>
<li>Directory bookmarks (opens in new pane)</li>
<li>Commands registered by extensions</li>
<li>SSH bookmarks</li>
<li>Startup tasks</li>
</ul>

<h2>Adding custom commands</h2>
<p>Extensions can add commands via <code>api.commands.register()</code>. Built-in snippets automatically appear in the palette. Directory bookmarks appear as "Open: ~/path" entries.</p>

<h2>Snippets</h2>
<p>Open Settings → Snippets to manage named shell command snippets. Each snippet appears in the palette and can have a keyboard shortcut assigned.</p>
`,

session: `
<h1>Session Persistence</h1>
<p class="lead">Shellfire remembers everything — open panes, scrollback, running processes, layout — across window close and app restart.</p>

<h2>How persistence works</h2>
<p>There are two levels of persistence:</p>

<h3>Window close (PTY-alive mode)</h3>
<p>When you close the Shellfire window on macOS (<kbd>Cmd+W</kbd>), the app continues running in the background. All PTY processes stay alive. The main process keeps accumulating their output in memory (up to 1MB per pane). When you reopen the window, the renderer connects to the same PTYs and replays the accumulated buffer — producing a pixel-perfect recreation of every session including vim, top, and Claude Code.</p>

<h3>App restart (disk session)</h3>
<p>When you fully quit (<kbd>Cmd+Q</kbd>), Shellfire saves a <code>session.json</code> file with:</p>
<ul>
<li>Grid layout (splits, pane positions)</li>
<li>Per-pane: last cwd, running command, custom name, color, scrollback buffer</li>
</ul>
<p>On next launch, Shellfire recreates each pane in the same cwd and re-runs the last command (if it was something runnable like <code>claude</code> or <code>npm run dev</code>).</p>

<h2>Auto-save interval</h2>
<p>Configure in Settings → Session → "Auto-save interval" (default: 60 seconds). Set to 0 to disable auto-save.</p>
`,

secrets: `
<h1>Secrets Vault</h1>
<p class="lead">Store API keys and other secrets, then inject them into terminal sessions without exposing them in shell history.</p>

<h2>Storage</h2>
<p>Secrets are stored in <code>~/.config/shellfire/secrets.json</code>, encrypted with AES-256-CBC. The encryption key is derived from your hostname + username (machine-specific). Secrets are never sent to any server.</p>

<h2>Injecting secrets</h2>
<p>Click the Secrets icon in the toolbar or use the Command Palette. Select which secrets to inject and click Inject. Shellfire writes <code> export KEY=value</code> to the active pane (with a leading space to suppress shell history). The secret value appears in the process environment but never in <code>.zsh_history</code>.</p>

<div class="callout warn"><strong>Limitation</strong>Injection works by writing to the PTY. If the shell is busy (running a process), injection will fail silently. Always inject into an idle shell prompt.</div>
`,

pipeline: `
<h1>Pipeline Runner</h1>
<p class="lead">Build and run multi-step command pipelines with per-step output capture, success/fail branching, and export to shell script.</p>

<h2>Creating a pipeline</h2>
<p>Open via Command Palette → "Pipeline Runner". Add steps, each with a command and optional working directory. Steps run sequentially; a non-zero exit code stops the pipeline.</p>

<h2>Exporting</h2>
<p>Click Export → Shell Script to save the pipeline as a <code>.sh</code> file. The exported script preserves working directories and step ordering.</p>
`,

ide: `
<h1>IDE & Zen Mode</h1>
<p class="lead">Two focus modes for different workflows.</p>

<h2>IDE Mode <kbd>Cmd+Shift+I</kbd></h2>
<p>IDE mode opens a sidebar panel showing a file tree for the active pane's cwd. Click files to preview them. The sidebar uses Shellfire's file-read IPC — it never spawns extra processes. Extensions can add their own sidebar panels via <code>api.ui.panel.add()</code>.</p>

<h2>Zen Mode <kbd>Cmd+Shift+F</kbd></h2>
<p>Zen mode expands the app to cover all connected displays simultaneously — even monitors with different DPIs. Window chrome is hidden. Press the shortcut again to restore the previous window state (maximized, bounds, fullscreen) exactly.</p>

<div class="callout tip"><strong>Multi-monitor</strong>Zen mode calculates the union of all display bounds, so your terminal literally fills every screen at once.</div>
`,
};
