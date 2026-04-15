// ============================================================
const cmdBookmarksPanel = document.getElementById("cmd-bookmarks-panel");
const bookmarkListEl = document.getElementById("bookmark-list");
const bookmarkCategoriesEl = document.getElementById("bookmark-categories");
let cmdBookmarks = [];
let bookmarkActiveTag = "All";

function openCmdBookmarksPanel() {
  cmdBookmarksPanel.classList.add("visible");
  renderBookmarkCategories();
  renderBookmarkList();
}

document.getElementById("cmd-bookmarks-close").addEventListener("click", () => {
  cmdBookmarksPanel.classList.remove("visible");
  if (activeId && panes.has(activeId)) panes.get(activeId).term.focus();
});

function getBookmarkTags() {
  const tags = new Set();
  cmdBookmarks.forEach(b => (b.tags || []).forEach(t => tags.add(t)));
  return ["All", ...Array.from(tags).sort()];
}

function renderBookmarkCategories() {
  const tags = getBookmarkTags();
  bookmarkCategoriesEl.innerHTML = "";
  tags.forEach(tag => {
    const tab = document.createElement("button");
    tab.className = "bookmark-cat-tab" + (tag === bookmarkActiveTag ? " active" : "");
    tab.textContent = tag;
    tab.addEventListener("click", () => {
      bookmarkActiveTag = tag;
      renderBookmarkCategories();
      renderBookmarkList();
    });
    bookmarkCategoriesEl.appendChild(tab);
  });
}

function renderBookmarkList() {
  const search = (document.getElementById("bookmark-search").value || "").toLowerCase();
  let filtered = cmdBookmarks;
  if (bookmarkActiveTag !== "All") {
    filtered = filtered.filter(b => (b.tags || []).includes(bookmarkActiveTag));
  }
  if (search) {
    filtered = filtered.filter(b =>
      b.command.toLowerCase().includes(search) ||
      (b.description || "").toLowerCase().includes(search) ||
      (b.tags || []).some(t => t.toLowerCase().includes(search))
    );
  }
  bookmarkListEl.innerHTML = "";
  if (filtered.length === 0) {
    bookmarkListEl.innerHTML = '<div class="bookmark-empty">No bookmarks found</div>';
    return;
  }
  filtered.forEach((bm) => {
    const realIdx = cmdBookmarks.indexOf(bm);
    const item = document.createElement("div");
    item.className = "bookmark-item";
    item.innerHTML = `
      <div class="bookmark-item-actions">
        <button data-edit="${realIdx}" title="Edit">e</button>
        <button data-del="${realIdx}" title="Delete">x</button>
      </div>
      <div class="bookmark-item-cmd">${escapeHtml(bm.command)}</div>
      ${bm.description ? `<div class="bookmark-item-desc">${escapeHtml(bm.description)}</div>` : ""}
      <div class="bookmark-item-tags">${(bm.tags || []).map(t => `<span class="bookmark-tag-pill">${escapeHtml(t)}</span>`).join("")}</div>
    `;
    item.addEventListener("click", (e) => {
      if (e.target.closest("[data-edit]") || e.target.closest("[data-del]")) return;
      if (activeId && panes.has(activeId)) {
        window.shellfire.sendInput(activeId, bm.command);
        cmdBookmarksPanel.classList.remove("visible");
        panes.get(activeId).term.focus();
        showToast("Pasted bookmark");
      }
    });

    const editBtn = item.querySelector("[data-edit]");
    if (editBtn) editBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      const newCmd = prompt("Command:", bm.command);
      if (newCmd === null) return;
      const newDesc = prompt("Description:", bm.description || "");
      const newTags = prompt("Tags (comma-separated):", (bm.tags || []).join(", "));
      bm.command = newCmd;
      bm.description = newDesc || "";
      bm.tags = (newTags || "").split(",").map(t => t.trim()).filter(Boolean);
      saveCmdBookmarks();
      renderBookmarkCategories();
      renderBookmarkList();
    });

    const delBtn = item.querySelector("[data-del]");
    if (delBtn) delBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      cmdBookmarks.splice(realIdx, 1);
      saveCmdBookmarks();
      renderBookmarkCategories();
      renderBookmarkList();
    });

    bookmarkListEl.appendChild(item);
  });
}

document.getElementById("bookmark-search").addEventListener("input", renderBookmarkList);

document.getElementById("bookmark-add-btn").addEventListener("click", () => {
  const cmdInput = document.getElementById("bookmark-cmd");
  const tagInput = document.getElementById("bookmark-tag");
  const cmd = cmdInput.value.trim();
  if (!cmd) return;
  const tags = tagInput.value.split(",").map(t => t.trim()).filter(Boolean);
  cmdBookmarks.push({ command: cmd, description: "", tags, createdAt: Date.now() });
  cmdInput.value = "";
  tagInput.value = "";
  saveCmdBookmarks();
  renderBookmarkCategories();
  renderBookmarkList();
});

document.getElementById("bookmark-cmd").addEventListener("keydown", (e) => {
  if (e.key === "Enter") document.getElementById("bookmark-add-btn").click();
});

function saveCmdBookmarks() {
  window.shellfire.saveCmdBookmarks(cmdBookmarks);
}

async function loadCmdBookmarksData() {
  cmdBookmarks = await window.shellfire.loadCmdBookmarks() || [];
}

function bookmarkLastCommand() {
  const cmd = prompt("Bookmark command:");
  if (!cmd) return;
  const tag = prompt("Tag (optional):", "");
  const tags = tag ? tag.split(",").map(t => t.trim()).filter(Boolean) : [];
  cmdBookmarks.push({ command: cmd, description: "", tags, createdAt: Date.now() });
  saveCmdBookmarks();
  showToast("Command bookmarked");
}

