// panel.js — Side Panel Logic
// Connects DOM → bg.js via chrome.runtime.sendMessage

// ─── State ───────────────────────────────────────────────────────────────────
let isLoading = false;

// ─── Boot ─────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  loadAndRender();
  bindUIEvents();
  listenForStorageChanges();
});

// ─── Data Fetching ────────────────────────────────────────────────────────────
async function loadAndRender() {
  try {
    const state = await chrome.runtime.sendMessage({ action: 'GET_STATE' });
    renderCategories(state.categories, state.activeCategory);
    renderTabList(state.categories?.[state.activeCategory] || []);
    updateActiveTitle(state.activeCategory);
  } catch (err) {
    console.error('[TabGrove panel] Failed to load state:', err);
  }
}

// ─── Category Rendering ───────────────────────────────────────────────────────
function renderCategories(categories, activeCategory) {
  const nav = document.getElementById('category-list');
  nav.innerHTML = '';

  for (const name of Object.keys(categories)) {
    const btn = document.createElement('button');
    btn.className = 'category-pill';
    btn.textContent = name;
    btn.dataset.category = name;
    btn.setAttribute('aria-pressed', name === activeCategory);
    btn.classList.toggle('active', name === activeCategory);

    btn.addEventListener('click', () => switchCategory(name));

    // Delete button (not shown for active category)
    if (name !== activeCategory) {
      const del = document.createElement('button');
      del.className = 'category-delete';
      del.textContent = '×';
      del.setAttribute('aria-label', `Delete ${name}`);
      del.addEventListener('click', (e) => {
        e.stopPropagation();
        deleteCategory(name);
      });
      btn.appendChild(del);
    }

    nav.appendChild(btn);
  }
}

// ─── Tab List Rendering ───────────────────────────────────────────────────────
function renderTabList(tabs) {
  const list = document.getElementById('tab-list');
  const empty = document.getElementById('empty-state');
  const badge = document.getElementById('tab-count-badge');

  list.innerHTML = '';
  badge.textContent = `${tabs.length} tab${tabs.length !== 1 ? 's' : ''}`;

  if (tabs.length === 0) {
    empty.hidden = false;
    return;
  }
  empty.hidden = true;

  for (const tab of tabs) {
    const li = document.createElement('li');
    li.className = 'tab-item';
    li.dataset.tabId = tab.tabId;

    const favicon = document.createElement('img');
    favicon.className = 'tab-favicon';
    favicon.src = tab.favIconUrl || 'icons/icon16.png';
    favicon.alt = '';
    favicon.onerror = () => { favicon.src = 'icons/icon16.png'; };

    const title = document.createElement('span');
    title.className = 'tab-title';
    title.textContent = tab.title || tab.url || 'Untitled';

    li.appendChild(favicon);
    li.appendChild(title);

    // Click tab item → focus the tab in browser
    li.addEventListener('click', () => {
      if (tab.tabId) chrome.tabs.update(tab.tabId, { active: true });
    });

    list.appendChild(li);
  }
}

function updateActiveTitle(name) {
  document.getElementById('active-category-title').textContent = name || '—';
}

// ─── Actions ──────────────────────────────────────────────────────────────────
async function switchCategory(name) {
  if (isLoading) return;
  setLoading(true);
  try {
    await chrome.runtime.sendMessage({ action: 'SWITCH_CATEGORY', name });
    await loadAndRender();
  } finally {
    setLoading(false);
  }
}

async function deleteCategory(name) {
  if (!confirm(`Delete category "${name}"? Its saved tabs will be lost.`)) return;
  const res = await chrome.runtime.sendMessage({ action: 'DELETE_CATEGORY', name });
  if (res?.error) {
    alert(res.error);
    return;
  }
  await loadAndRender();
}

async function closeTab(tabId) {
  if (!tabId) return;
  await chrome.tabs.remove(tabId);
  // Storage update is handled by bg.js onRemoved listener → triggers re-render via storage change
}

// ─── UI Event Bindings ────────────────────────────────────────────────────────
function bindUIEvents() {
  document.getElementById('btn-new-category').addEventListener('click', async () => {
    const name = prompt('Enter category name:')?.trim();
    if (!name) return;
    const res = await chrome.runtime.sendMessage({ action: 'CREATE_CATEGORY', name });
    if (res?.error) {
      alert(res.error);
      return;
    }
    await loadAndRender();
  });
}

// ─── Real-Time Sync ───────────────────────────────────────────────────────────
function listenForStorageChanges() {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && (changes.categories || changes.activeCategory)) {
      loadAndRender();
    }
  });
}

// ─── Loading State ────────────────────────────────────────────────────────────
function setLoading(state) {
  isLoading = state;
  const overlay = document.getElementById('loading-overlay');
  overlay.hidden = !state;
}
