// panel.js — Side Panel Logic
// Connects DOM → bg.js via chrome.runtime.sendMessage

// ─── State ───────────────────────────────────────────────────────────────────
let isLoading = false;

// "viewedCategory" is the category whose tabs are currently displayed in the panel.
// It may differ from the "activeCategory" (the one whose tabs are actually open
// in the browser). Clicking a pill changes viewedCategory; the Switch button
// changes activeCategory.
let viewedCategory = null;

// Cached full state for quick re-renders without messaging bg.js
let cachedState = null;

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
    cachedState = state;

    // Default viewedCategory to activeCategory on first load
    if (!viewedCategory || !state.categories[viewedCategory]) {
      viewedCategory = state.activeCategory;
    }

    renderCategories(state.categories, state.activeCategory);
    renderTabList(state.categories?.[viewedCategory] || [], viewedCategory === state.activeCategory);
    updateHeader(viewedCategory, state.activeCategory);
    updateSwitchBar(viewedCategory, state.activeCategory);
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

    // "active" class = the category whose tabs are open in the browser
    btn.classList.toggle('active', name === activeCategory);
    // "viewing" class = the category currently displayed in the panel
    btn.classList.toggle('viewing', name === viewedCategory);
    btn.setAttribute('aria-pressed', name === viewedCategory);

    // Clicking a pill only changes which tabs are SHOWN — no switch
    btn.addEventListener('click', () => viewCategory(name));

    // Double-click to rename
    btn.addEventListener('dblclick', (e) => {
      e.stopPropagation();
      startInlineRename(btn, name);
    });

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

    // Tab count indicator on the pill
    const count = document.createElement('span');
    count.className = 'pill-tab-count';
    count.textContent = (categories[name] || []).length;
    btn.appendChild(count);

    nav.appendChild(btn);
  }
}

// ─── Tab List Rendering ───────────────────────────────────────────────────────
function renderTabList(tabs, isActive) {
  const list = document.getElementById('tab-list');
  const empty = document.getElementById('empty-state');
  const badge = document.getElementById('tab-count-badge');

  list.innerHTML = '';
  badge.textContent = `${tabs.length} tab${tabs.length !== 1 ? 's' : ''}`;

  if (tabs.length === 0) {
    empty.hidden = false;
    empty.textContent = isActive
      ? 'No tabs in this category yet.'
      : 'No saved tabs in this category.';
    return;
  }
  empty.hidden = true;

  for (const tab of tabs) {
    const li = document.createElement('li');
    li.className = 'tab-item';
    li.dataset.tabId = tab.tabId;

    // Inactive category tabs get dimmed styling
    if (!isActive) {
      li.classList.add('inactive');
    }

    const favicon = document.createElement('img');
    favicon.className = 'tab-favicon';
    favicon.src = tab.favIconUrl || 'icons/icon16.png';
    favicon.alt = '';
    favicon.onerror = () => { favicon.src = 'icons/icon16.png'; };

    const title = document.createElement('span');
    title.className = 'tab-title';
    title.textContent = tab.title || tab.url || 'Untitled';

    // URL hint for inactive tabs (shows domain)
    const urlHint = document.createElement('span');
    urlHint.className = 'tab-url-hint';
    try {
      urlHint.textContent = new URL(tab.url).hostname;
    } catch {
      urlHint.textContent = '';
    }

    li.appendChild(favicon);
    const textWrap = document.createElement('div');
    textWrap.className = 'tab-text-wrap';
    textWrap.appendChild(title);
    if (!isActive && urlHint.textContent) {
      textWrap.appendChild(urlHint);
    }
    li.appendChild(textWrap);

    // Click tab → focus it in browser (only for active category)
    if (isActive && tab.tabId) {
      li.addEventListener('click', () => {
        chrome.tabs.update(tab.tabId, { active: true });
      });
    }

    list.appendChild(li);
  }
}

// ─── Header & Switch Bar ─────────────────────────────────────────────────────
function updateHeader(viewed, active) {
  document.getElementById('active-category-title').textContent = viewed || '—';
  const activeBadge = document.getElementById('active-badge');
  activeBadge.hidden = viewed !== active;
}

function updateSwitchBar(viewed, active) {
  const bar = document.getElementById('switch-bar');
  if (viewed === active) {
    bar.hidden = true;
    return;
  }
  bar.hidden = false;
  document.getElementById('switch-bar-name').textContent = viewed;
}

// ─── View a Category (preview only — no switch) ──────────────────────────────
function viewCategory(name) {
  viewedCategory = name;
  if (cachedState) {
    // Fast re-render from cache — no bg.js round trip
    renderCategories(cachedState.categories, cachedState.activeCategory);
    renderTabList(cachedState.categories?.[name] || [], name === cachedState.activeCategory);
    updateHeader(name, cachedState.activeCategory);
    updateSwitchBar(name, cachedState.activeCategory);
  }
}

// ─── Inline Rename ───────────────────────────────────────────────────────────
function startInlineRename(pill, oldName) {
  if (pill.querySelector('.rename-input')) return;

  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'rename-input';
  input.value = oldName;

  const deleteBtn = pill.querySelector('.category-delete');
  const countBadge = pill.querySelector('.pill-tab-count');
  pill.textContent = '';
  pill.appendChild(input);
  if (deleteBtn) pill.appendChild(deleteBtn);
  if (countBadge) pill.appendChild(countBadge);

  input.focus();
  input.select();

  const commit = () => commitRename(input, oldName);
  const cancel = () => loadAndRender();

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); commit(); }
    if (e.key === 'Escape') { e.preventDefault(); cancel(); }
  });
  input.addEventListener('blur', commit);
  input.addEventListener('click', (e) => e.stopPropagation());
}

async function commitRename(input, oldName) {
  if (input.dataset.committed) return;
  input.dataset.committed = 'true';

  const newName = input.value.trim();
  if (!newName || newName === oldName) {
    loadAndRender();
    return;
  }
  const res = await chrome.runtime.sendMessage({ action: 'RENAME_CATEGORY', oldName, newName });
  if (res?.error) {
    alert(res.error);
    input.dataset.committed = '';
    input.focus();
    input.select();
    return;
  }
  if (viewedCategory === oldName) viewedCategory = newName;
  await loadAndRender();
}

// ─── Actions ──────────────────────────────────────────────────────────────────
async function switchCategory(name) {
  if (isLoading) return;
  setLoading(true);
  try {
    await chrome.runtime.sendMessage({ action: 'SWITCH_CATEGORY', name });
    viewedCategory = name; // After switch, view the newly active category
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
  // If we were viewing the deleted category, snap back to active
  if (viewedCategory === name) {
    viewedCategory = cachedState?.activeCategory || null;
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
  // New category button
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

  // Switch button — the explicit "switch to these tabs" action
  document.getElementById('btn-switch-category').addEventListener('click', () => {
    if (viewedCategory) {
      switchCategory(viewedCategory);
    }
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
