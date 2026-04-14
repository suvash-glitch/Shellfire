// Navigation structure
const NAV = [
  {
    group: "Introduction",
    items: [
      { id: "overview",      label: "What is Shellfire?" },
      { id: "features",      label: "Features" },
      { id: "installation",  label: "Installation" },
      { id: "quickstart",    label: "Quick Start" },
    ]
  },
  {
    group: "User Guide",
    items: [
      { id: "panes",         label: "Panes & Splits" },
      { id: "themes",        label: "Themes" },
      { id: "keyboard",      label: "Keyboard Shortcuts" },
      { id: "ai",            label: "AI Features" },
      { id: "ssh",           label: "SSH Remote Sessions" },
      { id: "docker",        label: "Docker & Ports" },
      { id: "palette",       label: "Command Palette" },
      { id: "session",       label: "Session Persistence" },
      { id: "secrets",       label: "Secrets Vault" },
      { id: "pipeline",      label: "Pipeline Runner" },
      { id: "ide",           label: "IDE & Zen Mode" },
    ]
  },
  {
    group: "Extensions",
    items: [
      { id: "ext-overview",  label: "Overview" },
      { id: "ext-install",   label: "Installing Extensions" },
      { id: "ext-builder",   label: "Extension Builder" },
      { id: "ext-tutorial",  label: "First Extension Tutorial" },
      { id: "ext-theme",     label: "Theme Tutorial" },
    ]
  },
  {
    group: "Extension API",
    items: [
      { id: "api-manifest",  label: "plugin.json Manifest" },
      { id: "api-terminal",  label: "api.terminal" },
      { id: "api-ui",        label: "api.ui.*" },
      { id: "api-commands",  label: "api.commands" },
      { id: "api-storage",   label: "api.storage" },
      { id: "api-ai",        label: "api.ai" },
      { id: "api-events",    label: "api.events" },
      { id: "api-lifecycle", label: "Lifecycle & Packaging" },
    ]
  },
  {
    group: "CLI & MCP",
    items: [
      { id: "cli",           label: "CLI Reference" },
      { id: "mcp",           label: "MCP Server" },
      { id: "socket",        label: "Socket Protocol" },
    ]
  },
  {
    group: "Architecture",
    items: [
      { id: "arch-overview", label: "Overview" },
      { id: "arch-main",     label: "Main Process Modules" },
      { id: "arch-renderer", label: "Renderer" },
      { id: "arch-ipc",      label: "IPC & Preload" },
      { id: "arch-security", label: "Security Model" },
    ]
  },
  {
    group: "Contributing",
    items: [
      { id: "dev-setup",     label: "Dev Setup" },
      { id: "code-style",    label: "Code Style" },
      { id: "testing",       label: "Testing" },
    ]
  },
];
