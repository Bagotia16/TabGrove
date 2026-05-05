// popup.js — Action Popup Logic

document.addEventListener('DOMContentLoaded', async () => {
  await loadState();
  bindEvents();
});

async function loadState() {
  try {
    const state = await chrome.runtime.sendMessage({ action: 'GET_STATE' });
    document.getElementById('popup-active-category').textContent =
      state.activeCategory || '—';

    const select = document.getElementById('switch-select');
    select.innerHTML = '';
    for (const name of Object.keys(state.categories || {})) {
      const opt = document.createElement('option');
      opt.value = name;
      opt.textContent = name;
      opt.selected = name === state.activeCategory;
      select.appendChild(opt);
    }
  } catch (err) {
    console.error('[TabGrove popup] Failed to load state:', err);
  }
}

function bindEvents() {
  // Switch category
  document.getElementById('btn-switch').addEventListener('click', async () => {
    const name = document.getElementById('switch-select').value;
    if (!name) return;
    await chrome.runtime.sendMessage({ action: 'SWITCH_CATEGORY', name });
    window.close();
  });

  // Open side panel
  document.getElementById('btn-open-panel').addEventListener('click', async () => {
    const win = await chrome.windows.getCurrent();
    await chrome.sidePanel.open({ windowId: win.id });
    window.close();
  });
}
