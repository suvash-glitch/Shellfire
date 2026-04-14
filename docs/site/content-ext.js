// Extension, API, CLI, Architecture, Contributing sections
const CONTENT_EXT = {

'ext-overview': `
<h1>Extensions</h1>
<p class="lead">Shellfire's extension system lets you add toolbar buttons, side panels, status bar widgets, commands, and full themes — all in plain JavaScript, with a clean API and no build step required.</p>

<h2>Extension types</h2>
<div class="table-wrap"><table>
<tr><th>Type</th><th>What it does</th><th>Entry point exports</th></tr>
<tr><td><code>extension</code></td><td>General purpose — full API access</td><td><code>{ activate(api), deactivate() }</code></td></tr>
<tr><td><code>theme</code></td><td>Color theme for terminal + UI chrome</td><td><code>{ colors: {...} }</code></td></tr>
<tr><td><code>command</code></td><td>Adds command palette entries</td><td><code>{ name, execute(ctx) }</code></td></tr>
<tr><td><code>statusbar</code></td><td>Status bar widget with auto-refresh</td><td><code>{ name, render(ctx) }</code></td></tr>
</table></div>

<h2>Extension location</h2>
<p>Installed extensions live in <code>~/.shellfire/plugins/</code>. Each is a directory:</p>
<div class="code-block"><span class="lang-label">bash</span><button class="copy-btn">Copy</button><pre>~/.shellfire/plugins/
  my-extension/
    plugin.json   <span class="cm"># manifest</span>
    index.js      <span class="cm"># entry point</span>
    icon.png      <span class="cm"># optional marketplace icon</span></pre></div>

<h2>Extension packages</h2>
<p>Extensions are distributed as <code>.termext</code> files — a zip archive with <code>plugin.json</code> at the root. Install by dragging onto Shellfire or via the Marketplace.</p>
`,

'ext-install': `
<h1>Installing Extensions</h1>
<p class="lead">Four ways to install extensions.</p>

<h2>1. Marketplace (recommended)</h2>
<p>Open <strong>Extensions → Marketplace</strong> from the toolbar. Browse, filter by type, and click Install. Extensions activate immediately — no restart.</p>

<h2>2. Install from file (.termext)</h2>
<p>Drag a <code>.termext</code> file onto the Shellfire window, or use <strong>Extensions → Install from file</strong>.</p>

<h2>3. CLI</h2>
<div class="code-block"><span class="lang-label">bash</span><button class="copy-btn">Copy</button><pre><span class="cm"># Copy an extension directory manually</span>
cp -r my-extension ~/.shellfire/plugins/
<span class="cm"># Then reload extensions in Shellfire:</span>
shellfire send "Terminal 1" "echo extensions reloaded"</pre></div>

<h2>4. Extension Builder → Install</h2>
<p>If you're building an extension in the Extension Builder, click <strong>Install</strong> in the toolbar to install directly into Shellfire without exporting first.</p>

<h2>Uninstalling</h2>
<p>Open <strong>Extensions → Installed</strong> and click Uninstall next to any extension. All traces (toolbar buttons, DOM nodes, intervals, hooks) are cleaned up immediately.</p>
`,

'ext-builder': `
<h1>Extension Builder</h1>
<p class="lead">A dedicated visual environment for writing, testing, and exporting Shellfire extensions — with an AI assistant that understands the full Extension API.</p>

<h2>Opening the builder</h2>
<p>Press <kbd>Cmd+Shift+E</kbd> or open <strong>Extensions → Extension Builder</strong>. It opens as a separate window so you can build and test side by side with your terminal.</p>

<h2>Interface overview</h2>
<div class="arch-box">
  <div class="arch-row">
    <div class="arch-cell blue"><h4>File Tree</h4><ul><li>plugin.json</li><li>index.js</li><li>icon.png</li></ul></div>
    <div class="arch-cell accent"><h4>Code Editor</h4><ul><li>Tab-aware editing</li><li>Dirty tracking</li><li>Multi-file tabs</li></ul></div>
    <div class="arch-cell green"><h4>Right Panel</h4><ul><li>AI Assistant</li><li>Manifest Editor</li><li>API Docs</li></ul></div>
  </div>
</div>

<h2>AI Assistant</h2>
<p>The AI Assistant tab knows the complete Shellfire Extension API. Describe what you want to build and it generates working code. Click <strong>"Use this code"</strong> under any code block to apply it to the active file.</p>
<p><strong>Example prompts:</strong></p>
<ul>
<li><em>"Add a status bar widget showing the current git branch with a colored indicator"</em></li>
<li><em>"Create a right-click menu item that opens the selected file path in VS Code"</em></li>
<li><em>"Generate a Catppuccin Latte theme with all 16 terminal colors"</em></li>
<li><em>"Add a keyboard shortcut Cmd+Shift+G that runs git status in the active pane"</em></li>
</ul>

<h2>Manifest Editor</h2>
<p>The Manifest tab provides a form UI for editing <code>plugin.json</code> fields. Click <strong>Apply to plugin.json</strong> to sync changes back to the file.</p>

<h2>API Docs panel</h2>
<p>The Docs tab renders the full Extension API reference inline — no need to leave the builder.</p>

<h2>Exporting</h2>
<p>Click <strong>Export .termext</strong> to save a distributable package. Click <strong>Install</strong> to test directly in your running Shellfire instance.</p>
`,

'ext-tutorial': `
<h1>First Extension Tutorial</h1>
<p class="lead">Build a complete, working Shellfire extension from scratch in 10 minutes.</p>

<h2>What we're building</h2>
<p>A status bar widget that shows the active pane's working directory, updating in real-time when you <code>cd</code>.</p>

<h2>Step 1: Create the manifest</h2>
<p>Create a directory <code>~/.shellfire/plugins/cwd-widget/</code> and add <code>plugin.json</code>:</p>
<div class="code-block"><span class="lang-label">json</span><button class="copy-btn">Copy</button><pre>{
  <span class="prop">"name"</span>: <span class="str">"cwd-widget"</span>,
  <span class="prop">"displayName"</span>: <span class="str">"CWD Widget"</span>,
  <span class="prop">"version"</span>: <span class="str">"1.0.0"</span>,
  <span class="prop">"description"</span>: <span class="str">"Shows active pane cwd in status bar"</span>,
  <span class="prop">"type"</span>: <span class="str">"extension"</span>,
  <span class="prop">"main"</span>: <span class="str">"index.js"</span>,
  <span class="prop">"permissions"</span>: [<span class="str">"terminal.read"</span>, <span class="str">"ui.statusbar"</span>]
}</pre></div>

<h2>Step 2: Write the extension</h2>
<p>Create <code>index.js</code>:</p>
<div class="code-block"><span class="lang-label">js</span><button class="copy-btn">Copy</button><pre><span class="cm">// cwd-widget/index.js</span>
<span class="kw">let</span> widget;
<span class="kw">let</span> pollInterval;

module.exports = {
  <span class="fn">activate</span>(api) {
    <span class="cm">// Add a status bar widget</span>
    widget = api.ui.statusbar.<span class="fn">add</span>({
      id: <span class="str">'cwd-widget'</span>,
      text: <span class="str">'📂 ...'</span>,
      tooltip: <span class="str">'Active pane working directory'</span>,
    });

    <span class="cm">// Poll the active pane's cwd every 2 seconds</span>
    pollInterval = <span class="fn">setInterval</span>(<span class="kw">async</span> () => {
      <span class="kw">const</span> id = api.terminal.<span class="fn">getActive</span>();
      <span class="kw">if</span> (id === <span class="kw">null</span>) <span class="kw">return</span>;
      <span class="kw">const</span> panes = api.terminal.<span class="fn">getAll</span>();
      <span class="kw">const</span> pane = panes.<span class="fn">find</span>(p => p.id === id);
      <span class="kw">if</span> (pane?.cwd) {
        <span class="kw">const</span> short = pane.cwd.<span class="fn">replace</span>(<span class="str">/^\/Users\/[^/]+/</span>, <span class="str">'~'</span>);
        widget.<span class="fn">setText</span>(<span class="str">\`📂 \${short}\`</span>);
      }
    }, <span class="num">2000</span>);
  },

  <span class="fn">deactivate</span>() {
    <span class="fn">clearInterval</span>(pollInterval);
    widget?.<span class="fn">remove</span>();
  },
};</pre></div>

<h2>Step 3: Install and test</h2>
<div class="code-block"><span class="lang-label">bash</span><button class="copy-btn">Copy</button><pre><span class="cm"># The plugin directory is already in place.</span>
<span class="cm"># Open Shellfire → Extensions → Installed → Reload</span>
<span class="cm"># Or restart Shellfire.</span></pre></div>
<p>You should see "📂 ~" in the status bar, updating as you navigate directories.</p>

<h2>Step 4: Package it</h2>
<div class="code-block"><span class="lang-label">bash</span><button class="copy-btn">Copy</button><pre><span class="kw">cd</span> ~/.shellfire/plugins/cwd-widget
zip -j cwd-widget.termext plugin.json index.js</pre></div>
<p>Share the <code>.termext</code> file or submit it to the Shellfire marketplace.</p>
`,

'ext-theme': `
<h1>Theme Tutorial</h1>
<p class="lead">Create a complete terminal theme extension in under 5 minutes.</p>

<h2>Minimal theme</h2>
<p>Create <code>~/.shellfire/plugins/my-theme/plugin.json</code>:</p>
<div class="code-block"><span class="lang-label">json</span><button class="copy-btn">Copy</button><pre>{
  <span class="prop">"name"</span>: <span class="str">"my-theme"</span>,
  <span class="prop">"displayName"</span>: <span class="str">"My Theme"</span>,
  <span class="prop">"version"</span>: <span class="str">"1.0.0"</span>,
  <span class="prop">"type"</span>: <span class="str">"theme"</span>,
  <span class="prop">"main"</span>: <span class="str">"index.js"</span>
}</pre></div>

<p>And <code>index.js</code>:</p>
<div class="code-block"><span class="lang-label">js</span><button class="copy-btn">Copy</button><pre>module.exports = {
  colors: {
    background:    <span class="str">"#1a1b26"</span>,  <span class="cm">// Tokyo Night</span>
    foreground:    <span class="str">"#c0caf5"</span>,
    cursor:        <span class="str">"#c0caf5"</span>,
    selection:     <span class="str">"#283457"</span>,
    black:         <span class="str">"#15161e"</span>,
    red:           <span class="str">"#f7768e"</span>,
    green:         <span class="str">"#9ece6a"</span>,
    yellow:        <span class="str">"#e0af68"</span>,
    blue:          <span class="str">"#7aa2f7"</span>,
    magenta:       <span class="str">"#bb9af7"</span>,
    cyan:          <span class="str">"#7dcfff"</span>,
    white:         <span class="str">"#a9b1d6"</span>,
    brightBlack:   <span class="str">"#414868"</span>,
    brightRed:     <span class="str">"#f7768e"</span>,
    brightGreen:   <span class="str">"#9ece6a"</span>,
    brightYellow:  <span class="str">"#e0af68"</span>,
    brightBlue:    <span class="str">"#7aa2f7"</span>,
    brightMagenta: <span class="str">"#bb9af7"</span>,
    brightCyan:    <span class="str">"#7dcfff"</span>,
    brightWhite:   <span class="str">"#c0caf5"</span>,
  },
};</pre></div>

<div class="callout tip"><strong>AI shortcut</strong>Open the Extension Builder, select "New → Theme", and prompt the AI: "Create a Tokyo Night Storm theme". It will generate all 16 colors plus UI chrome variants.</div>
`,

'api-manifest': `
<h1>plugin.json Manifest</h1>
<p class="lead">Every extension starts with a <code>plugin.json</code> that declares its identity, type, and required permissions.</p>

<div class="code-block"><span class="lang-label">jsonc</span><button class="copy-btn">Copy</button><pre>{
  <span class="prop">"name"</span>:        <span class="str">"my-extension"</span>,   <span class="cm">// unique id, used as install dir name</span>
  <span class="prop">"displayName"</span>: <span class="str">"My Extension"</span>,   <span class="cm">// shown in UI and Marketplace</span>
  <span class="prop">"version"</span>:     <span class="str">"1.0.0"</span>,           <span class="cm">// semver</span>
  <span class="prop">"description"</span>: <span class="str">"..."</span>,
  <span class="prop">"author"</span>:      <span class="str">"Your Name"</span>,
  <span class="prop">"type"</span>:        <span class="str">"extension"</span>,       <span class="cm">// extension | theme | command | statusbar</span>
  <span class="prop">"main"</span>:        <span class="str">"index.js"</span>,        <span class="cm">// entry point relative to plugin dir</span>
  <span class="prop">"icon"</span>:        <span class="str">"icon.png"</span>,        <span class="cm">// optional, 64×64 PNG</span>
  <span class="prop">"keywords"</span>:   [<span class="str">"git"</span>, <span class="str">"productivity"</span>],
  <span class="prop">"permissions"</span>: [
    <span class="str">"terminal.read"</span>,    <span class="cm">// read terminal output</span>
    <span class="str">"terminal.write"</span>,   <span class="cm">// send input to terminal</span>
    <span class="str">"ui.toolbar"</span>,       <span class="cm">// add toolbar buttons</span>
    <span class="str">"ui.panel"</span>,         <span class="cm">// add side panels</span>
    <span class="str">"ui.menu"</span>,          <span class="cm">// add context menu items</span>
    <span class="str">"ui.statusbar"</span>,     <span class="cm">// add status bar widgets</span>
    <span class="str">"storage.read"</span>,     <span class="cm">// read extension storage</span>
    <span class="str">"storage.write"</span>     <span class="cm">// write extension storage</span>
  ]
}</pre></div>

<h2>Name rules</h2>
<p>The <code>name</code> field is used as the install directory name and must match <code>/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/</code>. Keep it lowercase with hyphens for readability.</p>

<h2>Permissions</h2>
<p>Permissions are shown to the user at install time. Currently informational (not enforced at runtime), but future versions will sandbox extensions based on declared permissions.</p>
`,

'api-terminal': `
<h1>api.terminal</h1>
<p class="lead">Read pane state, send input, and listen to output events.</p>

<div class="api-method"><div class="sig"><span class="fn">api.terminal.getActive</span>() → <span class="type">number | null</span></div><div class="desc">Returns the currently focused pane ID, or <code>null</code> if no pane is focused.</div></div>

<div class="api-method"><div class="sig"><span class="fn">api.terminal.getAll</span>() → <span class="type">Array&lt;{ id, name, cwd }&gt;</span></div><div class="desc">Returns all open panes. <code>cwd</code> may be <code>null</code> if unavailable.</div></div>

<div class="api-method"><div class="sig"><span class="fn">api.terminal.send</span>(<span class="param">text</span>: <span class="type">string</span>, <span class="param">paneId</span>?: <span class="type">number</span>)</div><div class="desc">Writes text to a terminal as keyboard input. Omit <code>paneId</code> to target the active pane. Include <code>\\n</code> to submit a command.</div></div>

<div class="api-method"><div class="sig"><span class="fn">api.terminal.getOutput</span>(<span class="param">paneId</span>?: <span class="type">number</span>, <span class="param">lines</span>?: <span class="type">number</span>) → <span class="type">string</span></div><div class="desc">Returns the scrollback buffer. Defaults to active pane, last 200 lines.</div></div>

<div class="api-method"><div class="sig"><span class="fn">api.terminal.onOutput</span>(<span class="param">callback</span>: <span class="type">(data: string, id: number) => void</span>, <span class="param">paneId</span>?: <span class="type">number</span>) → <span class="ret">Disposable</span></div><div class="desc">Called every time a pane emits output. Omit <code>paneId</code> to listen to all panes. Call <code>.dispose()</code> to unsubscribe.</div></div>

<div class="api-method"><div class="sig"><span class="fn">api.terminal.onInput</span>(<span class="param">callback</span>: <span class="type">(text: string, id: number) => boolean | void</span>, <span class="param">paneId</span>?: <span class="type">number</span>) → <span class="ret">Disposable</span></div><div class="desc">Intercept keyboard input before it reaches the PTY. Return <code>false</code> to suppress the keystroke.</div></div>

<div class="api-method"><div class="sig"><span class="fn">api.terminal.create</span>(<span class="param">cwd</span>?: <span class="type">string</span>) → <span class="ret">Promise&lt;number&gt;</span></div><div class="desc">Opens a new terminal pane. Returns the new pane ID.</div></div>

<div class="api-method"><div class="sig"><span class="fn">api.terminal.focus</span>(<span class="param">paneId</span>: <span class="type">number</span>)</div><div class="desc">Focuses a specific pane.</div></div>
`,

'api-ui': `
<h1>api.ui.*</h1>
<p class="lead">Add toolbar buttons, side panels, context menu items, and status bar widgets.</p>

<h2>api.ui.toolbar</h2>
<div class="api-method"><div class="sig"><span class="fn">api.ui.toolbar.add</span>(<span class="param">config</span>: <span class="type">ToolbarConfig</span>) → <span class="ret">{ remove() }</span></div><div class="desc">Adds a button to the main toolbar.</div></div>
<div class="code-block"><span class="lang-label">js</span><button class="copy-btn">Copy</button><pre><span class="kw">const</span> btn = api.ui.toolbar.<span class="fn">add</span>({
  id:      <span class="str">'my-btn'</span>,       <span class="cm">// unique DOM id</span>
  icon:    <span class="str">'⚡'</span>,           <span class="cm">// emoji or image URL</span>
  tooltip: <span class="str">'Run action'</span>,
  label:   <span class="str">'Run'</span>,         <span class="cm">// optional text label</span>
  <span class="fn">onClick</span>() { api.terminal.<span class="fn">send</span>(<span class="str">'make\n'</span>); },
});
btn.<span class="fn">remove</span>(); <span class="cm">// clean up in deactivate()</span></pre></div>

<h2>api.ui.panel</h2>
<div class="api-method"><div class="sig"><span class="fn">api.ui.panel.add</span>(<span class="param">config</span>: <span class="type">PanelConfig</span>) → <span class="ret">{ refresh(), remove() }</span></div><div class="desc">Adds a side panel in IDE mode.</div></div>
<div class="code-block"><span class="lang-label">js</span><button class="copy-btn">Copy</button><pre><span class="kw">const</span> panel = api.ui.panel.<span class="fn">add</span>({
  id:    <span class="str">'my-panel'</span>,
  title: <span class="str">'My Panel'</span>,
  icon:  <span class="str">'📋'</span>,
  <span class="fn">render</span>(container) {
    container.innerHTML = <span class="str">'&lt;p&gt;Hello!&lt;/p&gt;'</span>;
  },
  <span class="fn">onShow</span>() {},  <span class="fn">onHide</span>() {},
});
panel.<span class="fn">refresh</span>(); <span class="cm">// re-calls render()</span></pre></div>

<h2>api.ui.menu</h2>
<div class="api-method"><div class="sig"><span class="fn">api.ui.menu.add</span>(<span class="param">config</span>: <span class="type">MenuConfig</span>)</div><div class="desc">Adds an item to the right-click context menu.</div></div>
<div class="code-block"><span class="lang-label">js</span><button class="copy-btn">Copy</button><pre>api.ui.menu.<span class="fn">add</span>({
  id:    <span class="str">'copy-path'</span>,
  label: <span class="str">'Copy file path'</span>,
  <span class="cm">// ctx: { paneId, selection, x, y }</span>
  <span class="fn">when</span>: ctx => ctx.selection.<span class="fn">includes</span>(<span class="str">'/'</span>),
  <span class="fn">onClick</span>: ctx => navigator.clipboard.<span class="fn">writeText</span>(ctx.selection),
});</pre></div>

<h2>api.ui.statusbar</h2>
<div class="api-method"><div class="sig"><span class="fn">api.ui.statusbar.add</span>(<span class="param">config</span>: <span class="type">StatusbarConfig</span>) → <span class="ret">{ setText(s), setTooltip(s), remove() }</span></div><div class="desc">Adds a widget to the right-side status bar.</div></div>
<div class="code-block"><span class="lang-label">js</span><button class="copy-btn">Copy</button><pre><span class="kw">const</span> w = api.ui.statusbar.<span class="fn">add</span>({
  id:      <span class="str">'my-widget'</span>,
  text:    <span class="str">'🟢 OK'</span>,
  tooltip: <span class="str">'Status nominal'</span>,
  <span class="fn">onClick</span>() {},
});
w.<span class="fn">setText</span>(<span class="str">'🔴 Error'</span>);
w.<span class="fn">remove</span>();</pre></div>
`,

'api-commands': `
<h1>api.commands</h1>
<p class="lead">Register commands that appear in the Command Palette (<kbd>Cmd+P</kbd>).</p>

<div class="api-method"><div class="sig"><span class="fn">api.commands.register</span>(<span class="param">config</span>: <span class="type">CommandConfig</span>)</div><div class="desc">Adds a command to the palette. Appears immediately and persists until the extension is deactivated.</div></div>

<div class="code-block"><span class="lang-label">js</span><button class="copy-btn">Copy</button><pre>api.commands.<span class="fn">register</span>({
  id:         <span class="str">'my-ext.run-tests'</span>,
  name:       <span class="str">'My Extension: Run Tests'</span>,
  keybinding: <span class="str">'Cmd+Shift+T'</span>,         <span class="cm">// optional</span>
  category:   <span class="str">'Testing'</span>,             <span class="cm">// shown as group in palette</span>
  <span class="fn">when</span>: () => <span class="kw">true</span>,                  <span class="cm">// optional: show conditionally</span>
  <span class="fn">run</span>() {
    api.terminal.<span class="fn">send</span>(<span class="str">'npm test\n'</span>);
  },
});</pre></div>
`,

'api-storage': `
<h1>api.storage</h1>
<p class="lead">Persistent key-value store scoped to your extension. Data survives app restarts.</p>

<div class="code-block"><span class="lang-label">js</span><button class="copy-btn">Copy</button><pre><span class="cm">// Write</span>
<span class="kw">await</span> api.storage.<span class="fn">set</span>(<span class="str">'lastRun'</span>, Date.<span class="fn">now</span>());
<span class="kw">await</span> api.storage.<span class="fn">set</span>(<span class="str">'config'</span>, { theme: <span class="str">'dark'</span>, interval: <span class="num">5000</span> });

<span class="cm">// Read</span>
<span class="kw">const</span> ts  = <span class="kw">await</span> api.storage.<span class="fn">get</span>(<span class="str">'lastRun'</span>);   <span class="cm">// number | undefined</span>
<span class="kw">const</span> cfg = <span class="kw">await</span> api.storage.<span class="fn">get</span>(<span class="str">'config'</span>);    <span class="cm">// object | undefined</span>

<span class="cm">// Delete</span>
<span class="kw">await</span> api.storage.<span class="fn">delete</span>(<span class="str">'lastRun'</span>);
<span class="kw">await</span> api.storage.<span class="fn">clear</span>();  <span class="cm">// wipe all extension storage</span></pre></div>

<div class="callout note"><strong>Storage location</strong>Data is stored in <code>~/.shellfire/plugins/{name}/storage.json</code>. It is not encrypted. Do not store secrets here — use the Secrets Vault instead.</div>
`,

'api-ai': `
<h1>api.ai</h1>
<p class="lead">Call the user's configured AI provider from within your extension — using their own API key and provider settings.</p>

<div class="api-method"><div class="sig"><span class="fn">api.ai.complete</span>(<span class="param">prompt</span>: <span class="type">string</span>) → <span class="ret">Promise&lt;string&gt;</span></div><div class="desc">Single-turn completion. Returns the response text or throws on error.</div></div>

<div class="api-method"><div class="sig"><span class="fn">api.ai.chat</span>(<span class="param">messages</span>: <span class="type">Array&lt;{role,content}&gt;</span>) → <span class="ret">Promise&lt;string&gt;</span></div><div class="desc">Multi-turn chat. <code>role</code> is <code>"user"</code> or <code>"assistant"</code>.</div></div>

<div class="code-block"><span class="lang-label">js</span><button class="copy-btn">Copy</button><pre><span class="cm">// Explain an error from the terminal</span>
<span class="kw">const</span> output = api.terminal.<span class="fn">getOutput</span>(<span class="kw">undefined</span>, <span class="num">20</span>);
<span class="kw">const</span> explanation = <span class="kw">await</span> api.ai.<span class="fn">complete</span>(
  <span class="str">\`Explain this error briefly:\n\${output}\`</span>
);
api.ui.statusbar.<span class="fn">add</span>({ id: <span class="str">'err'</span>, text: explanation.<span class="fn">slice</span>(<span class="num">0</span>,<span class="num">40</span>) });</pre></div>

<div class="callout note"><strong>Uses user's key</strong>Calls are made with the user's API key and go to their configured provider. Your extension code never sees the API key.</div>
`,

'api-events': `
<h1>api.events</h1>
<p class="lead">Pub/sub event bus for communication between extensions.</p>

<div class="code-block"><span class="lang-label">js</span><button class="copy-btn">Copy</button><pre><span class="cm">// Extension A — publish</span>
api.events.<span class="fn">emit</span>(<span class="str">'my-ext.task-done'</span>, { file: <span class="str">'main.js'</span>, duration: <span class="num">1234</span> });

<span class="cm">// Extension B — subscribe</span>
<span class="kw">const</span> sub = api.events.<span class="fn">on</span>(<span class="str">'my-ext.task-done'</span>, (data) => {
  api.ui.statusbar.<span class="fn">add</span>({ id: <span class="str">'done'</span>, text: <span class="str">\`✅ \${data.file}\`</span> });
});

<span class="cm">// Clean up in deactivate()</span>
sub.<span class="fn">dispose</span>();</pre></div>

<div class="callout tip"><strong>Naming convention</strong>Prefix event names with your extension name to avoid collisions: <code>my-extension.event-name</code>.</div>
`,

'api-lifecycle': `
<h1>Lifecycle & Packaging</h1>
<p class="lead">How extensions load, unload, and get packaged for distribution.</p>

<h2>Lifecycle</h2>
<ol class="steps">
  <li><div class="step-num">1</div><div class="step-body"><h3>Discovery</h3><p>On launch, Shellfire scans <code>~/.shellfire/plugins/</code> for directories containing a valid <code>plugin.json</code>.</p></div></li>
  <li><div class="step-num">2</div><div class="step-body"><h3>Code load</h3><p>The main process reads <code>index.js</code> and sends it to the renderer. The renderer evaluates it using <code>new Function('exports', code)</code> — sandboxed, no direct Node.js access.</p></div></li>
  <li><div class="step-num">3</div><div class="step-body"><h3>activate(api)</h3><p>The exported <code>activate</code> function is called with the full API. This is where you register buttons, hooks, and commands.</p></div></li>
  <li><div class="step-num">4</div><div class="step-body"><h3>deactivate()</h3><p>Called when the user disables or uninstalls the extension. All registered buttons, hooks, intervals, and DOM nodes are automatically cleaned up by the runtime — but you must clear your own timers and external subscriptions.</p></div></li>
</ol>

<h2>Packaging (.termext)</h2>
<p>A <code>.termext</code> file is a zip archive with <code>plugin.json</code> at the root:</p>
<div class="code-block"><span class="lang-label">bash</span><button class="copy-btn">Copy</button><pre><span class="kw">cd</span> ~/.shellfire/plugins/my-extension/
zip -j my-extension.termext plugin.json index.js icon.png</pre></div>
<p>Or use the Extension Builder → <strong>Export .termext</strong> button.</p>

<h2>Best practices</h2>
<ul>
<li>Always implement <code>deactivate()</code> and clean up every resource.</li>
<li>Use <code>api.storage</code> instead of <code>localStorage</code> — localStorage is shared with the app.</li>
<li>Don't poll faster than your use case requires — status bar widgets update every 5 seconds by default.</li>
<li>Keep extensions small. No bundlers, no external npm packages in the loaded code.</li>
</ul>
`,

cli: `
<h1>CLI Reference</h1>
<p class="lead">The <code>shellfire</code> CLI communicates with a running Shellfire app over a Unix socket.</p>

<div class="code-block"><span class="lang-label">bash</span><button class="copy-btn">Copy</button><pre>shellfire &lt;command&gt; [options]

Commands:
  list                      List all active terminal sessions
  new [--name &lt;n&gt;] [--cwd &lt;dir&gt;]  Create a new session
  attach &lt;name&gt;             Attach stdin/stdout to a session
  send &lt;name&gt; &lt;text&gt;        Send text to a session
  kill &lt;name&gt;               Kill a session
  rename &lt;name&gt; &lt;new-name&gt;  Rename a session
  remote &lt;host&gt; [options]   List sessions on a remote host</pre></div>

<h2>Examples</h2>
<div class="code-block"><span class="lang-label">bash</span><button class="copy-btn">Copy</button><pre><span class="cm"># List all panes</span>
shellfire list

<span class="cm"># Send a command to "Terminal 1"</span>
shellfire send "Terminal 1" $'git status\n'

<span class="cm"># Create a pane in a specific directory</span>
shellfire new --name "API server" --cwd ~/projects/api

<span class="cm"># Attach interactively (bidirectional stdin/stdout)</span>
shellfire attach "Terminal 1"

<span class="cm"># List remote sessions via SSH</span>
shellfire remote myserver.example.com --user ubuntu --port 22</pre></div>

<h2>Socket location</h2>
<p>The CLI connects to <code>~/.shellfire/shellfire-{pid}.sock</code> (most recently modified socket wins). Multiple Shellfire instances each create their own socket.</p>
`,

mcp: `
<h1>MCP Server</h1>
<p class="lead">The Shellfire MCP server exposes your terminal sessions to Claude Code and any other MCP-compatible agent.</p>

<h2>Setup</h2>
<div class="code-block"><span class="lang-label">json</span><button class="copy-btn">Copy</button><pre><span class="cm">// ~/.claude/settings.json</span>
{
  <span class="prop">"mcpServers"</span>: {
    <span class="prop">"shellfire"</span>: {
      <span class="prop">"command"</span>: <span class="str">"node"</span>,
      <span class="prop">"args"</span>: [<span class="str">"/path/to/Shellfire/mcp/shellfire-mcp.js"</span>]
    }
  }
}</pre></div>

<h2>Available tools</h2>
<div class="table-wrap"><table>
<tr><th>Tool</th><th>Description</th><th>Parameters</th></tr>
<tr><td><code>shellfire_list</code></td><td>List all active sessions with cwd and process</td><td>none</td></tr>
<tr><td><code>shellfire_read</code></td><td>Read scrollback buffer of a session</td><td><code>name</code>, <code>lines?</code></td></tr>
<tr><td><code>shellfire_send</code></td><td>Send text/command to a session</td><td><code>name</code>, <code>text</code></td></tr>
<tr><td><code>shellfire_new</code></td><td>Create a new session</td><td><code>name?</code>, <code>dir?</code></td></tr>
<tr><td><code>shellfire_kill</code></td><td>Kill a session</td><td><code>name</code></td></tr>
<tr><td><code>shellfire_rename</code></td><td>Rename a session</td><td><code>name</code>, <code>newName</code></td></tr>
</table></div>

<h2>Example: Claude Code using Shellfire</h2>
<div class="code-block"><span class="lang-label">text</span><button class="copy-btn">Copy</button><pre>User: run the tests in Terminal 2 and tell me if they pass

Claude uses shellfire_send("Terminal 2", "npm test\n")
Claude waits a moment
Claude uses shellfire_read("Terminal 2", 30)
Claude: All 133 tests passed in 87ms.</pre></div>
`,

socket: `
<h1>Socket Protocol</h1>
<p class="lead">The Unix socket protocol used by the CLI and MCP server. Useful if you're building your own integration.</p>

<h2>Connection</h2>
<p>Connect to <code>~/.shellfire/shellfire-{pid}.sock</code>. The socket is chmod 0600 (owner-only). Multiple instances each have their own socket; the most recently modified one is used.</p>

<h2>Request format</h2>
<p>Send a single newline-terminated JSON object:</p>
<div class="code-block"><span class="lang-label">json</span><button class="copy-btn">Copy</button><pre>{ "action": "send", "name": "Terminal 1", "text": "ls -la\n" }\n</pre></div>

<h2>Actions</h2>
<div class="table-wrap"><table>
<tr><th>Action</th><th>Fields</th><th>Response</th></tr>
<tr><td><code>list</code></td><td>none</td><td><code>{ sessions: [{id,name,cwd,process,active}] }</code></td></tr>
<tr><td><code>read</code></td><td><code>name</code>, <code>lines?</code> (max 2000)</td><td><code>{ id, name, output }</code></td></tr>
<tr><td><code>send</code></td><td><code>name</code>, <code>text</code> (string)</td><td><code>{ id, name }</code></td></tr>
<tr><td><code>new</code></td><td><code>name?</code>, <code>cwd?</code></td><td><code>{ id, name }</code></td></tr>
<tr><td><code>kill</code></td><td><code>name</code></td><td><code>{ id, name }</code></td></tr>
<tr><td><code>rename</code></td><td><code>name</code>, <code>newName</code></td><td><code>{ id, name }</code></td></tr>
<tr><td><code>attach</code></td><td><code>name</code>, <code>stream: true</code></td><td>Handshake JSON + raw PTY stream</td></tr>
</table></div>

<h2>Error responses</h2>
<div class="code-block"><span class="lang-label">json</span><button class="copy-btn">Copy</button><pre>{ "error": "Session not found: Terminal 99" }</pre></div>
`,

'arch-overview': `
<h1>Architecture Overview</h1>
<p class="lead">Shellfire follows Electron's two-process model with strict context isolation. v3 splits the monolithic main process into focused modules.</p>

<div class="arch-box">
  <div class="arch-row">
    <div class="arch-cell accent"><h4>Main Process</h4><ul><li>PTY management (node-pty)</li><li>Unix socket server</li><li>File I/O, storage</li><li>AI API calls</li><li>SSH, Docker, ports</li><li>Plugin install/uninstall</li></ul></div>
    <div class="arch-cell blue"><h4>Renderer Process</h4><ul><li>DOM + xterm.js (WebGL)</li><li>Pane layout, tabs, splits</li><li>Theme application</li><li>Extension runtime</li><li>Command palette, settings</li></ul></div>
  </div>
  <div class="arch-arrow">↕ contextBridge (preload.js) — 100+ safe IPC methods</div>
  <div class="arch-row">
    <div class="arch-cell green"><h4>Unix Socket</h4><ul><li>~/.shellfire/*.sock</li><li>CLI + MCP connect here</li><li>JSON request → response</li><li>Attach: raw PTY streaming</li></ul></div>
    <div class="arch-cell purple"><h4>Extension Builder</h4><ul><li>Separate BrowserWindow</li><li>Own preload + IPC</li><li>AI code generation</li><li>File I/O, .termext export</li></ul></div>
  </div>
</div>

<h2>Key design decisions</h2>
<ul>
<li><strong>Sandbox: true</strong> — renderer runs in strict sandbox, no Node.js access. All OS operations go through preload IPC.</li>
<li><strong>PTY in main process</strong> — node-pty spawns and owns all shell processes. Renderer only receives data via IPC events.</li>
<li><strong>Session state in main process</strong> — <code>ptys</code>, <code>ptyBuffers</code>, <code>ptyMeta</code> Maps live in the main process, so they survive renderer reload and window close.</li>
<li><strong>Extension code runs in renderer</strong> — extensions are evaluated with <code>new Function()</code> in the renderer context, giving them DOM access but no Node.js access.</li>
</ul>
`,

'arch-main': `
<h1>Main Process Modules</h1>
<p class="lead"><code>main.js</code> is a 57-line entry point. All logic is in <code>src/main/</code> modules.</p>

<h2>Module map</h2>
<div class="table-wrap"><table>
<tr><th>Module</th><th>Responsibility</th></tr>
<tr><td><code>state.js</code></td><td>Shared state: <code>ptys</code>, <code>ptyBuffers</code>, <code>ptyMeta</code> Maps; window ref; <code>sendToRenderer()</code></td></tr>
<tr><td><code>utils.js</code></td><td><code>log()</code>, <code>execFileAsync()</code>, <code>sanitizePath()</code>, <code>sanitizeFilePath()</code>, validators, atomic JSON I/O</td></tr>
<tr><td><code>pty-manager.js</code></td><td>create-terminal, terminal-input/resize/kill/broadcast, list-ptys, get-terminal-cwd/process/env, get-process-tree</td></tr>
<tr><td><code>socket-server.js</code></td><td>Unix socket lifecycle, JSON command dispatch, PTY attach streaming</td></tr>
<tr><td><code>storage.js</code></td><td>16 data stores: session, config, settings, secrets (AES-256), logs, snippets, profiles, SSH, bookmarks…</td></tr>
<tr><td><code>ai-service.js</code></td><td>ai-chat + ai-complete IPC handlers; Anthropic, OpenAI, Google, Ollama dispatch</td></tr>
<tr><td><code>ssh-manager.js</code></td><td>ssh-remote-list (probes remote socket), ssh-remote-open-all (creates local SSH panes)</td></tr>
<tr><td><code>system-handlers.js</code></td><td>Cron, Docker, ports, git, system-stats, file finder, pipeline runner, dialogs — all async</td></tr>
<tr><td><code>plugin-system.js</code></td><td>Plugin discovery, load, install-from-registry, install-termext, uninstall, marketplace cache</td></tr>
<tr><td><code>window-manager.js</code></td><td>BrowserWindow creation, CSP, auto-updater, zen mode, zoom, window controls</td></tr>
</table></div>

<h2>State sharing pattern</h2>
<p>All modules import shared mutable state from <code>state.js</code>:</p>
<div class="code-block"><span class="lang-label">js</span><button class="copy-btn">Copy</button><pre><span class="cm">// state.js exports Maps as references — mutations are shared</span>
<span class="kw">const</span> { ptys, ptyBuffers, ptyMeta, getWindow, sendToRenderer } = <span class="fn">require</span>(<span class="str">'./state'</span>);</pre></div>

<h2>IPC registration pattern</h2>
<p>Each module exports a <code>registerHandlers()</code> function called once from <code>main.js</code>:</p>
<div class="code-block"><span class="lang-label">js</span><button class="copy-btn">Copy</button><pre><span class="cm">// main.js — thin entry point</span>
ptyManager.<span class="fn">registerHandlers</span>();
storage.<span class="fn">registerHandlers</span>(ptys);
aiService.<span class="fn">registerHandlers</span>();
<span class="cm">// ... etc</span></pre></div>
`,

'arch-renderer': `
<h1>Renderer</h1>
<p class="lead"><code>renderer.js</code> owns all DOM logic. It is a plain script (not a module) loaded at the bottom of <code>index.html</code>.</p>

<h2>Script load order</h2>
<div class="code-block"><span class="lang-label">html</span><button class="copy-btn">Copy</button><pre><span class="cm">&lt;!-- xterm.js addons --&gt;</span>
&lt;script src="node_modules/@xterm/xterm/lib/xterm.js"&gt;&lt;/script&gt;
&lt;script src="node_modules/@xterm/addon-fit/lib/addon-fit.js"&gt;&lt;/script&gt;
&lt;script src="node_modules/@xterm/addon-search/lib/addon-search.js"&gt;&lt;/script&gt;

<span class="cm">&lt;!-- Shellfire renderer modules (order matters) --&gt;</span>
&lt;script src="src/renderer/themes.js"&gt;&lt;/script&gt;  <span class="cm">&lt;!-- defines window.__SF_THEMES --&gt;</span>
&lt;script src="renderer.js"&gt;&lt;/script&gt;             <span class="cm">&lt;!-- main renderer --&gt;</span></pre></div>

<h2>src/renderer/themes.js</h2>
<p>Pure data file (no deps). Defines <code>window.__SF_THEMES</code>, <code>window.__SF_PANE_COLORS</code>, <code>window.__SF_PANE_COLOR_PRESETS</code>. Loaded before <code>renderer.js</code> so theme data is available when the renderer initialises.</p>

<h2>renderer.js sections</h2>
<div class="table-wrap"><table>
<tr><th>Section</th><th>Lines (approx)</th><th>What it does</th></tr>
<tr><td>STATE</td><td>1–35</td><td>Shared mutable variables (panes Map, activeId, layout, settings…)</td></tr>
<tr><td>EXTENSION PLUGIN API</td><td>36–90</td><td><code>window._termExt</code> — the v2 extension API surface exposed to plugins</td></tr>
<tr><td>UTILS</td><td>91–200</td><td>escHtml, showToast, launchClaude helpers</td></tr>
<tr><td>THEME / ZOOM / FONT</td><td>200–270</td><td>applyTheme(), applyZoom(), setFontSize()</td></tr>
<tr><td>LAYOUT</td><td>270–540</td><td>Grid layout, fit/resize, split pane logic</td></tr>
<tr><td>PANE MANAGEMENT</td><td>540–1100</td><td>createPaneObj(), addTerminal(), removeTerminal(), setActive()</td></tr>
<tr><td>IPC EVENTS</td><td>1100–1140</td><td>terminal-data, terminal-exit, update-status handlers</td></tr>
<tr><td>SEARCH / CONTEXT MENU</td><td>1140–1250</td><td>Find bar, right-click menu</td></tr>
<tr><td>COMMAND PALETTE</td><td>1380–1520</td><td>Palette overlay, fuzzy filter, command registration</td></tr>
<tr><td>SESSION</td><td>1520–1730</td><td>saveCurrentSession(), restoreSession()</td></tr>
<tr><td>PLUGIN SYSTEM</td><td>5740–6010</td><td>activateSinglePlugin(), _applyPlugin(), deactivatePlugin()</td></tr>
<tr><td>EXPOSE INTERNALS</td><td>6888–6900</td><td>window.__panes, window.__createPane etc. for socket server</td></tr>
</table></div>

<h2>v3 roadmap: ES module split</h2>
<p>The full renderer split into ES modules (<code>src/renderer/pane-manager.js</code>, <code>layout-manager.js</code>, etc.) requires switching to <code>type="module"</code> scripts. This is planned for a future release and tracked in the contributing guide.</p>
`,

'arch-ipc': `
<h1>IPC & Preload (Context Bridge)</h1>
<p class="lead">All communication between renderer and main process flows through <code>preload.js</code> — the only file that can touch both Node.js APIs and the renderer DOM.</p>

<h2>preload.js</h2>
<p>Uses Electron's <code>contextBridge.exposeInMainWorld</code> to expose a <code>window.shellfire</code> object with 100+ safe IPC methods:</p>
<div class="code-block"><span class="lang-label">js</span><button class="copy-btn">Copy</button><pre><span class="cm">// renderer uses:</span>
<span class="kw">const</span> id = <span class="kw">await</span> window.shellfire.<span class="fn">createTerminal</span>(cwd);
window.shellfire.<span class="fn">sendInput</span>(id, <span class="str">'ls\n'</span>);

<span class="cm">// preload.js wires these to IPC:</span>
contextBridge.<span class="fn">exposeInMainWorld</span>(<span class="str">'shellfire'</span>, {
  <span class="fn">createTerminal</span>: (cwd) => ipcRenderer.<span class="fn">invoke</span>(<span class="str">'create-terminal'</span>, cwd),
  <span class="fn">sendInput</span>: (id, data) => ipcRenderer.<span class="fn">send</span>(<span class="str">'terminal-input'</span>, id, data),
  <span class="cm">// ...</span>
});</pre></div>

<h2>Security model summary</h2>
<ul>
<li><code>nodeIntegration: false</code> — renderer cannot call <code>require()</code></li>
<li><code>contextIsolation: true</code> — renderer JS and preload run in separate V8 contexts</li>
<li><code>sandbox: true</code> — renderer process is OS-sandboxed</li>
<li>All file paths sanitized in main process before use</li>
<li>Plugin code evaluated with <code>new Function('exports', code)</code> — inherits renderer sandbox</li>
</ul>
`,

'arch-security': `
<h1>Security Model</h1>
<p class="lead">Shellfire applies defense-in-depth across the IPC boundary, file system, and extension runtime.</p>

<h2>Path validation</h2>
<p>Every path from the renderer is validated before use:</p>
<ul>
<li>Null byte check (<code>\\0</code>)</li>
<li>Resolved to absolute path via <code>path.resolve()</code> (handles <code>..</code> traversal)</li>
<li>Boundary check: must be within <code>homedir</code> or <code>tmpdir</code>, using separator-anchored prefix match (<code>resolved === dir || resolved.startsWith(dir + sep)</code>)</li>
</ul>

<h2>Input validation</h2>
<ul>
<li>SSH hostnames: <code>/^[a-zA-Z0-9._-]+$/</code>, max 255 chars</li>
<li>Usernames: <code>/^[a-zA-Z0-9._-]+$/</code>, max 64 chars</li>
<li>Plugin IDs: <code>/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/</code></li>
<li>Secret key names: <code>/^[A-Za-z_][A-Za-z0-9_]*$/</code> before writing <code>export</code></li>
<li>Cron lines: no newlines or null bytes</li>
<li>Socket commands: <code>action</code> must be a string before switch dispatch</li>
</ul>

<h2>Secrets</h2>
<ul>
<li>AES-256-CBC with random IV per save</li>
<li>Key derived from <code>hostname + username + "shellfire-vault"</code> via SHA-256</li>
<li>Injection uses leading space to suppress shell history</li>
<li>SSH passwords written to temp script with mode 0700, deleted immediately after use</li>
</ul>

<h2>Extension sandboxing</h2>
<ul>
<li>Plugin code runs in renderer sandbox — no <code>require()</code>, no Node.js APIs</li>
<li>Evaluated with <code>new Function('exports', code)</code> — cannot escape the renderer context</li>
<li>All OS operations must go through <code>window.shellfire</code> IPC (which validates in main)</li>
<li>Extensions cannot access other extensions' storage keys</li>
</ul>

<h2>Content Security Policy</h2>
<div class="code-block"><span class="lang-label">text</span><button class="copy-btn">Copy</button><pre>default-src 'self';
script-src 'self' 'unsafe-inline' 'unsafe-eval';
style-src 'self' 'unsafe-inline';
font-src 'self';
connect-src *</pre></div>
<p><code>unsafe-eval</code> is required for the extension runtime (<code>new Function()</code>). <code>connect-src *</code> allows AI provider API calls from the renderer's fetch.</p>
`,

'dev-setup': `
<h1>Dev Setup</h1>
<div class="code-block"><span class="lang-label">bash</span><button class="copy-btn">Copy</button><pre>git clone https://github.com/suvash-glitch/Shellfire.git
cd Shellfire
npm install
npm run rebuild     <span class="cm"># build node-pty native module</span>
npm start           <span class="cm"># launch in dev mode (electron .)</span></pre></div>

<h2>Branch strategy</h2>
<ul>
<li><code>main</code> — stable, shipped in releases</li>
<li><code>v3</code> — current active development branch</li>
<li>Feature branches off <code>v3</code>, PRs back to <code>v3</code></li>
</ul>

<h2>Building a release</h2>
<div class="code-block"><span class="lang-label">bash</span><button class="copy-btn">Copy</button><pre>npm run build        <span class="cm"># macOS .dmg + .zip</span>
npm run build:win    <span class="cm"># Windows .exe + .zip</span>
npm run build:linux  <span class="cm"># AppImage + .deb</span></pre></div>
`,

'code-style': `
<h1>Code Style</h1>
<p class="lead">Shellfire uses a consistent style across all JS files. ESLint enforces it.</p>

<div class="table-wrap"><table>
<tr><th>Rule</th><th>Value</th></tr>
<tr><td>Indentation</td><td>2 spaces</td></tr>
<tr><td>Quotes</td><td>Double (<code>"</code>)</td></tr>
<tr><td>Semicolons</td><td>Always</td></tr>
<tr><td>Variable declarations</td><td><code>const</code> by default, <code>let</code> when reassigned, never <code>var</code></td></tr>
<tr><td>Functions</td><td><code>function</code> declarations in main process; arrow functions fine in renderer</td></tr>
<tr><td>Class names</td><td>PascalCase</td></tr>
<tr><td>Variable/function names</td><td>camelCase</td></tr>
<tr><td>Section dividers</td><td><code>// ====</code> dividers in large files</td></tr>
</table></div>

<h2>Commit message format</h2>
<div class="code-block"><span class="lang-label">text</span><button class="copy-btn">Copy</button><pre>Add|Fix|Update|Remove|Refactor|Docs|Test: short summary

Optional longer body explaining why, not what.

Co-Authored-By: Claude Sonnet 4.6 (1M context) &lt;noreply@anthropic.com&gt;</pre></div>

<h2>Module pattern</h2>
<p>Each <code>src/main/</code> module exports a <code>registerHandlers()</code> function and named exports for shared logic. No circular dependencies.</p>
`,

testing: `
<h1>Testing</h1>
<div class="code-block"><span class="lang-label">bash</span><button class="copy-btn">Copy</button><pre>npm test                        <span class="cm"># run all 133 unit tests</span>
node --test test/main.test.js   <span class="cm"># run a single test file</span></pre></div>

<h2>Test files</h2>
<div class="table-wrap"><table>
<tr><th>File</th><th>What it tests</th></tr>
<tr><td><code>test/main.test.js</code></td><td>Core logic: sanitizePath, JSON storage, PTY helpers</td></tr>
<tr><td><code>test/security.test.js</code></td><td>Path traversal, null bytes, boundary checks</td></tr>
<tr><td><code>test/cli.test.js</code></td><td>CLI argument parsing and formatting</td></tr>
<tr><td><code>test/plugins.test.js</code></td><td>Plugin manifest validation, type checks</td></tr>
<tr><td><code>test/ipc.test.js</code></td><td>IPC handler input validation</td></tr>
<tr><td><code>test/renderer.test.js</code></td><td>Layout calculations, theme data, session format</td></tr>
</table></div>

<h2>What's not tested (yet)</h2>
<ul>
<li>End-to-end Electron renderer (requires headless Electron harness)</li>
<li>Socket protocol integration (live PTY)</li>
<li>MCP JSON-RPC compliance</li>
<li>Extension lifecycle (activate/deactivate)</li>
</ul>
<p>Contributions for integration tests welcome — see the GitHub issue tracker.</p>
`,
};
