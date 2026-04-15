// EXTENSIONS / PLUGINS
// ============================================================
// ============================================================
// MARKETPLACE
// ============================================================
let _mpRegistry = null;
let _mpInstalledNames = new Set();

const TYPE_ICONS = {
  theme: "\uD83C\uDFA8", command: "\u26A1", statusbar: "\uD83D\uDCCA", extension: "\uD83E\uDDE9",
};
const TYPE_LABELS = {
  theme: "Theme", command: "Command", statusbar: "Status Bar", extension: "Extension",
};

function createMarketplaceCard(entry, isInstalled) {
  const card = document.createElement("div");
  card.className = "mp-card" + (isInstalled ? " installed" : "");
  card.dataset.type = entry.type || "";
  card.dataset.name = (entry.name || "").toLowerCase();
  card.dataset.desc = (entry.description || "").toLowerCase();
  card.dataset.tags = (entry.tags || []).join(" ").toLowerCase();
  card.dataset.id = entry.id || "";
  card.dataset.installed = isInstalled ? "1" : "0";
  card.dataset.featured = entry.featured ? "1" : "0";

  if (isInstalled) {
    const dot = document.createElement("div");
    dot.className = "mp-card-installed-dot";
    dot.title = "Installed";
    card.appendChild(dot);
  }

  const top = document.createElement("div");
  top.className = "mp-card-top";

  const icon = document.createElement("div");
  icon.className = "mp-card-icon";
  icon.textContent = entry.icon || TYPE_ICONS[entry.type] || "\uD83D\uDCE6";
  top.appendChild(icon);

  const info = document.createElement("div");
  info.className = "mp-card-info";
  const nameEl = document.createElement("div");
  nameEl.className = "mp-card-name";
  nameEl.textContent = entry.name || entry.id;
  info.appendChild(nameEl);
  const authorEl = document.createElement("div");
  authorEl.className = "mp-card-author";
  authorEl.textContent = (entry.author || "Shellfire") + (entry.version ? " \u00B7 v" + entry.version : "");
  info.appendChild(authorEl);
  top.appendChild(info);

  const desc = document.createElement("div");
  desc.className = "mp-card-desc";
  desc.textContent = entry.description || "";

  const footer = document.createElement("div");
  footer.className = "mp-card-footer";

  const tagsWrap = document.createElement("div");
  tagsWrap.className = "mp-card-tags";
  const typeBadge = document.createElement("span");
  typeBadge.className = "mp-tag plugin-type-badge " + (entry.type || "");
  typeBadge.textContent = TYPE_LABELS[entry.type] || entry.type || "";
  tagsWrap.appendChild(typeBadge);
  if (entry.tags) {
    for (const tag of entry.tags.slice(0, 2)) {
      const t = document.createElement("span");
      t.className = "mp-tag";
      t.textContent = tag;
      tagsWrap.appendChild(t);
    }
  }
  footer.appendChild(tagsWrap);

  const btn = document.createElement("button");
  btn.className = "mp-card-btn " + (isInstalled ? "uninstall" : "install");
  btn.textContent = isInstalled ? "Uninstall" : "Install";
  btn.addEventListener("click", async (e) => {
    e.stopPropagation();
    btn.disabled = true;
    const wasInstalled = btn.classList.contains("uninstall");
    btn.textContent = wasInstalled ? "Removing..." : "Installing...";
    try {
      if (wasInstalled) {
        deactivatePlugin(entry.id);
        const result = await window.shellfire.uninstallPlugin(entry.id);
        if (result.error) throw new Error(result.error);
        _mpInstalledNames.delete(entry.id);
      } else {
        // Try .termext package download first, then file-based fallback
        let installed = false;
        if (entry.packageUrl) {
          const pkgResult = await window.shellfire.downloadAndInstallTermext({ url: entry.packageUrl, id: entry.id });
          if (pkgResult.ok) installed = true;
        }
        if (!installed) {
          const result = await window.shellfire.installFromRegistry({
            id: entry.id,
            files: entry.files || { "plugin.json": "", "index.js": "" },
            downloadUrl: entry.downloadUrl || "",
          });
          if (result.error) throw new Error(result.error);
        }
        await activateSinglePlugin(entry.id, entry.type);
        _mpInstalledNames.add(entry.id);
      }
      if (entry.type === "theme") _refreshThemeUIs();
      // Update card visually
      btn.disabled = false;
      if (wasInstalled) {
        btn.className = "mp-card-btn install";
        btn.textContent = "Install";
        card.classList.remove("installed");
        card.dataset.installed = "0";
        const dot = card.querySelector(".mp-card-installed-dot");
        if (dot) dot.remove();
      } else {
        btn.className = "mp-card-btn uninstall";
        btn.textContent = "Uninstall";
        card.classList.add("installed");
        card.dataset.installed = "1";
        const dot = document.createElement("div");
        dot.className = "mp-card-installed-dot";
        dot.title = "Installed";
        card.insertBefore(dot, card.firstChild);
      }
      showToast(wasInstalled ? `${entry.name} removed` : `${entry.name} installed`);
    } catch (err) {
      showToast("Error: " + err.message, "error");
      btn.disabled = false;
      btn.textContent = wasInstalled ? "Uninstall" : "Install";
    }
  });
  footer.appendChild(btn);

  // Theme preview swatches
  if (entry.type === "theme" && entry.preview) {
    const preview = document.createElement("div");
    preview.className = "mp-theme-preview";
    for (const color of entry.preview) {
      const swatch = document.createElement("div");
      swatch.className = "mp-theme-swatch";
      swatch.style.background = color;
      preview.appendChild(swatch);
    }
    desc.appendChild(preview);
  }

  card.appendChild(top);
  card.appendChild(desc);
  card.appendChild(footer);
  return card;
}

async function fetchAndRenderMarketplace() {
  const grid = document.getElementById("marketplace-grid");
  const loading = document.getElementById("marketplace-loading");
  const empty = document.getElementById("marketplace-empty");
  const countEl = document.getElementById("marketplace-count");
  if (!grid) return;

  grid.style.display = "none";
  empty.style.display = "none";
  loading.style.display = "flex";

  try {
    const [registry, installed] = await Promise.all([
      window.shellfire.fetchRegistry(),
      window.shellfire.loadPlugins(),
    ]);
    _mpRegistry = registry;
    _mpInstalledNames = new Set(installed.map(p => p.manifest.name));

    const plugins = registry.plugins || [];
    grid.innerHTML = "";

    // Sort: featured first, then installed, then alphabetical
    const sorted = [...plugins].sort((a, b) => {
      if (a.featured && !b.featured) return -1;
      if (!a.featured && b.featured) return 1;
      const aInst = _mpInstalledNames.has(a.id);
      const bInst = _mpInstalledNames.has(b.id);
      if (aInst && !bInst) return -1;
      if (!aInst && bInst) return 1;
      return (a.name || a.id).localeCompare(b.name || b.id);
    });

    for (const entry of sorted) {
      const card = createMarketplaceCard(entry, _mpInstalledNames.has(entry.id));
      grid.appendChild(card);
    }

    // Also add locally-installed custom plugins not in registry
    const registryIds = new Set(plugins.map(p => p.id));
    for (const p of installed) {
      if (!registryIds.has(p.manifest.name)) {
        const entry = {
          id: p.manifest.name, name: p.manifest.name, description: p.manifest.description || "Custom plugin",
          type: p.manifest.type, version: p.manifest.version, author: p.manifest.author || "Custom",
          tags: ["custom"], icon: "\uD83D\uDD27",
        };
        grid.appendChild(createMarketplaceCard(entry, true));
      }
    }

    if (countEl) countEl.textContent = `${sorted.length} extensions`;
    loading.style.display = "none";
    grid.style.display = "";
    if (grid.children.length === 0) empty.style.display = "flex";
  } catch (err) {
    console.error("Marketplace fetch error:", err);
    loading.style.display = "none";
    empty.style.display = "flex";
  }
}

function filterMarketplace(filter, query) {
  const grid = document.getElementById("marketplace-grid");
  const empty = document.getElementById("marketplace-empty");
  if (!grid) return;
  const q = (query || "").toLowerCase().trim();
  let visible = 0;
  for (const card of grid.children) {
    let show = true;
    if (filter && filter !== "all") {
      if (filter === "installed") {
        show = card.dataset.installed === "1";
      } else if (filter === "featured") {
        show = card.dataset.featured === "1";
      } else {
        show = card.dataset.type === filter;
      }
    }
    if (show && q) {
      show = card.dataset.name.includes(q) || card.dataset.desc.includes(q) || card.dataset.tags.includes(q) || card.dataset.id.includes(q);
    }
    card.style.display = show ? "" : "none";
    if (show) visible++;
  }
  if (empty) empty.style.display = visible === 0 ? "flex" : "none";
}

// Wire up marketplace filter buttons + search
(function setupMarketplace() {
  const filters = document.getElementById("marketplace-filters");
  const search = document.getElementById("marketplace-search");
  const installFileBtn = document.getElementById("mp-install-file-btn");
  let activeFilter = "all";

  if (filters) {
    filters.addEventListener("click", (e) => {
      const btn = e.target.closest(".mp-filter");
      if (!btn) return;
      filters.querySelectorAll(".mp-filter").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      activeFilter = btn.dataset.filter;
      filterMarketplace(activeFilter, search ? search.value : "");
    });
  }
  if (search) {
    let debounce = null;
    search.addEventListener("input", () => {
      clearTimeout(debounce);
      debounce = setTimeout(() => filterMarketplace(activeFilter, search.value), 150);
    });
  }
  // Install from .termext file
  if (installFileBtn) {
    installFileBtn.addEventListener("click", async () => {
      const pick = await window.shellfire.pickTermextFile();
      if (pick.canceled) return;
      installFileBtn.textContent = "Installing...";
      installFileBtn.disabled = true;
      try {
        const result = await window.shellfire.installTermext(pick.filePath);
        if (result.error) throw new Error(result.error);
        await activateSinglePlugin(result.id, result.manifest.type);
        if (result.manifest.type === "theme") _refreshThemeUIs();
        showToast(`${result.manifest.name || result.id} installed from package`);
        await fetchAndRenderMarketplace();
      } catch (err) {
        showToast("Install failed: " + err.message, "error");
      }
      installFileBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg> Install .termext';
      installFileBtn.disabled = false;
    });
  }
})();


