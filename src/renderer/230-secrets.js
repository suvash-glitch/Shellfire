// SECRETS MANAGER
// ============================================================
let secretsVault = []; // { key, value, injected? }

async function loadSecretsVault() {
  try { const saved = await window.shellfire.loadSecrets(); if (Array.isArray(saved)) secretsVault = saved; } catch {}
}

function openSecretsPanel() {
  document.getElementById("secrets-panel").classList.add("visible");
  renderSecretsList();
}

function renderSecretsList() {
  const body = document.getElementById("secrets-body");
  body.innerHTML = "";
  if (secretsVault.length === 0) {
    body.innerHTML = '<div class="secrets-empty">No secrets stored.<br>Add env vars above to get started.</div>';
    return;
  }
  secretsVault.forEach((s, i) => {
    const row = document.createElement("div");
    row.className = "secret-row";
    const masked = "\u2022".repeat(Math.min(s.value.length, 20));
    row.innerHTML = `
      <input type="checkbox" class="secret-check" data-idx="${i}" checked />
      <span class="secret-key">${escapeHtml(s.key)}</span>
      <span class="secret-value" title="Click to reveal">${masked}</span>
      <div class="secret-actions">
        <button class="reveal" title="Toggle reveal">eye</button>
        <button class="copy" title="Copy value">copy</button>
        <button class="danger" title="Delete">&times;</button>
      </div>
    `;
    // Toggle reveal
    let revealed = false;
    row.querySelector(".reveal").addEventListener("click", (e) => {
      e.stopPropagation();
      revealed = !revealed;
      row.querySelector(".secret-value").textContent = revealed ? s.value : masked;
    });
    // Copy
    row.querySelector(".copy").addEventListener("click", (e) => {
      e.stopPropagation();
      navigator.clipboard.writeText(s.value);
      showToast(`Copied ${s.key}`);
    });
    // Delete
    row.querySelector(".danger").addEventListener("click", (e) => {
      e.stopPropagation();
      secretsVault.splice(i, 1);
      window.shellfire.saveSecrets(secretsVault);
      renderSecretsList();
      showToast("Secret deleted");
    });
    body.appendChild(row);
  });
}

document.getElementById("secrets-close").addEventListener("click", () => {
  document.getElementById("secrets-panel").classList.remove("visible");
  if (activeId && panes.has(activeId)) panes.get(activeId).term.focus();
});

document.getElementById("secret-add-btn").addEventListener("click", () => {
  const keyInput = document.getElementById("secret-key-input");
  const valInput = document.getElementById("secret-value-input");
  const key = keyInput.value.trim().toUpperCase();
  const value = valInput.value;
  if (!key) { keyInput.focus(); return; }
  if (!value) { valInput.focus(); return; }
  // Update existing or add new
  const existing = secretsVault.findIndex(s => s.key === key);
  if (existing >= 0) secretsVault[existing].value = value;
  else secretsVault.push({ key, value });
  window.shellfire.saveSecrets(secretsVault);
  keyInput.value = "";
  valInput.value = "";
  renderSecretsList();
  showToast(existing >= 0 ? `Updated ${key}` : `Added ${key}`);
});

document.getElementById("secret-key-input").addEventListener("keydown", (e) => {
  if (e.key === "Enter") document.getElementById("secret-value-input").focus();
});
document.getElementById("secret-value-input").addEventListener("keydown", (e) => {
  if (e.key === "Enter") document.getElementById("secret-add-btn").click();
});

// Inject all secrets into active pane
document.getElementById("secrets-inject-btn").addEventListener("click", async () => {
  if (!activeId) { showToast("No active terminal"); return; }
  if (secretsVault.length === 0) { showToast("No secrets to inject"); return; }
  const result = await window.shellfire.injectSecrets({ id: activeId, secrets: secretsVault });
  if (result.ok) showToast(`Injected ${result.count} secret${result.count > 1 ? "s" : ""} into terminal`);
  else showToast("Failed to inject secrets", "error");
});

// Inject selected secrets
document.getElementById("secrets-inject-select-btn").addEventListener("click", async () => {
  if (!activeId) { showToast("No active terminal"); return; }
  const checks = document.querySelectorAll("#secrets-body .secret-check:checked");
  const selected = [];
  checks.forEach(cb => {
    const idx = parseInt(cb.dataset.idx);
    if (secretsVault[idx]) selected.push(secretsVault[idx]);
  });
  if (selected.length === 0) { showToast("No secrets selected"); return; }
  const result = await window.shellfire.injectSecrets({ id: activeId, secrets: selected });
  if (result.ok) showToast(`Injected ${result.count} selected secret${result.count > 1 ? "s" : ""}`);
  else showToast("Failed to inject secrets", "error");
});

// ============================================================
