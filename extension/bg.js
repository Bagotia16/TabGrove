// bg.js — Service Worker (Background Orchestrator)
import { Storage } from './storage.js';

// Guard flag: prevents tab event listeners from firing during a category switch.
// Must live here (module scope) — the service worker is stateless between events
// but IS stateful within a single async execution chain.
let _isSwitching = false;

// ─── Helpers ─────────────────────────────────────────────────────────────────
/**
 * Returns true for Chrome internal pages that should NEVER be saved or restored
 * (settings, extensions, devtools, etc.).
 * chrome://newtab is intentionally allowed — it's a real user tab.
 */
function isSystemTab(url) {
  if (!url || url === 'about:blank' || url === 'about:newtab') return false;
  if (url.startsWith('chrome://newtab') || url.startsWith('chrome://new-tab-page')) return false;
  if (url.startsWith('chrome://') || url.startsWith('chrome-extension://')) return true;
  if (url.startsWith('devtools://')) return true;
  return false;
}

/**
 * Sanitize a URL for storage/restore. Guarantees we never store empty strings,
 * undefined, or chrome-extension:// URLs that would cause ERR_FILE_NOT_FOUND.
 */
function safeUrl(url) {
  if (!url || url === '' || url === 'about:blank') return 'chrome://newtab';
  if (url.startsWith('chrome-extension://')) return 'chrome://newtab';
  return url;
}

/** Snapshot all currently open non-system tabs into storage. */
async function snapshotOpenTabs() {
  const { categories, activeCategory } = await Storage.getFullState();
  if (!activeCategory || !categories) return;
  const openTabs = await chrome.tabs.query({});
  const tabData = openTabs
    .filter(t => !isSystemTab(t.url))
    .map(t => ({ tabId: t.id, url: t.url || 'chrome://newtab', title: t.title || 'New Tab', favIconUrl: t.favIconUrl || '' }));
  // Merge: keep stored entries not currently open (tabId: null), add/update open ones
  const existingByUrl = new Map((categories[activeCategory] || []).map(t => [t.url, t]));
  for (const tab of tabData) { existingByUrl.set(tab.url, tab); }
  categories[activeCategory] = [...existingByUrl.values()];
  await Storage.saveCategories(categories);
}

// ─── Install / Update ───────────────────────────────────────────────────────
chrome.runtime.onInstalled.addListener(async () => {
  const existing = await Storage.getCategories();
  if (!existing || Object.keys(existing).length === 0) {
    // Seed Default with whatever tabs are already open
    const openTabs = await chrome.tabs.query({});
    const tabData = openTabs
      .filter(t => !isSystemTab(t.url))
      .map(t => ({ tabId: t.id, url: t.url || 'chrome://newtab', title: t.title || 'New Tab', favIconUrl: t.favIconUrl || '' }));
    // Always guarantee at least one tab entry
    if (tabData.length === 0) {
      tabData.push({ tabId: null, url: 'chrome://newtab', title: 'New Tab', favIconUrl: '' });
    }
    await Storage.saveCategories({ "Default": tabData });
    await Storage.setActiveCategory("Default");
  }
  // NOTE: sidePanel.open() requires a user gesture — cannot call it here.
  // Users open the panel via the toolbar popup → "Open Side Panel ↗" button.
});

// ─── Keep-Alive Alarm ────────────────────────────────────────────────────────
// Service workers terminate after ~30s of inactivity; the alarm re-wakes them.
chrome.alarms.create('heartbeat', { periodInMinutes: 0.4 });

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === 'heartbeat') {
    await syncStateFromStorage();
  }
});

// ─── Tab Events ──────────────────────────────────────────────────────────────
chrome.tabs.onCreated.addListener(async (tab) => {
  // Skip registration entirely during a category switch — new tabs being
  // opened by switchToCategory should NOT be added to the active category here;
  // switchToCategory saves them correctly itself.
  if (_isSwitching) return;
  // Race-condition guard: wait briefly then re-query for fresh metadata
  // (at creation time, url/title are often empty)
  await new Promise(r => setTimeout(r, 500));
  const fresh = await chrome.tabs.get(tab.id).catch(() => null);
  if (!fresh) return;
  await addTabToActiveCategory(fresh);
});

chrome.tabs.onRemoved.addListener(async (tabId) => {
  if (_isSwitching) return;
  await removeTabFromAllCategories(tabId);
});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (_isSwitching) return;
  // Update on URL change OR page load completion — whichever comes first.
  // This ensures the side panel reflects navigations immediately.
  if (changeInfo.url || changeInfo.title || changeInfo.status === 'complete') {
    await updateTabMetadata(tabId, {
      url: safeUrl(tab.url),
      title: tab.title || 'New Tab',
      favIconUrl: tab.favIconUrl || ''
    });
  }
});

// ─── Message Routing ─────────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleUIMessage(message).then(sendResponse);
  return true; // Keep channel open for async response
});

// ─── Message Handler ──────────────────────────────────────────────────────────
async function handleUIMessage(message) {
  switch (message.action) {
    case 'CREATE_CATEGORY':     return await createCategory(message.name);
    case 'DELETE_CATEGORY':     return await deleteCategory(message.name);
    case 'SWITCH_CATEGORY':     return await switchToCategory(message.name);
    case 'MOVE_TAB':            return await moveTabToCategory(message.tabId, message.category);
    case 'CLOSE_CATEGORY_TABS': return await closeCategoryTabs(message.name);
    case 'RESTORE_CATEGORY':    return await restoreCategoryTabs(message.name);
    case 'GET_STATE':           return await getFullState();
    default:                    return { error: 'Unknown action' };
  }
}

// ─── State Helpers ────────────────────────────────────────────────────────────
async function getFullState() {
  return Storage.getFullState();
}

async function syncStateFromStorage() {
  // Re-hydrate internal state references from storage after worker sleep.
  // Intentionally lightweight — storage is the single source of truth.
  await Storage.getFullState();
}

// ─── Tab CRUD Stubs (implemented fully in Phase 4) ───────────────────────────
async function addTabToActiveCategory(tab) {
  const { categories, activeCategory } = await Storage.getFullState();
  if (!categories[activeCategory]) return;
  // Skip system tabs entirely
  if (isSystemTab(tab.url)) return;
  const already = categories[activeCategory].find(t => t.tabId === tab.id);
  if (already) return;
  categories[activeCategory].push({
    tabId: tab.id,
    url: safeUrl(tab.url),
    title: tab.title || 'New Tab',
    favIconUrl: tab.favIconUrl || ''
  });
  await Storage.saveCategories(categories);
}

async function removeTabFromAllCategories(tabId) {
  const categories = await Storage.getCategories();
  for (const name of Object.keys(categories)) {
    categories[name] = categories[name].filter(t => t.tabId !== tabId);
  }
  await Storage.saveCategories(categories);
}

async function updateTabMetadata(tabId, meta) {
  const categories = await Storage.getCategories();
  for (const name of Object.keys(categories)) {
    const tab = categories[name].find(t => t.tabId === tabId);
    if (tab) {
      Object.assign(tab, meta);
    }
  }
  await Storage.saveCategories(categories);
}

async function createCategory(name) {
  const categories = await Storage.getCategories();
  if (categories[name]) return { error: 'Category already exists' };
  // Seed every new category with one "New Tab" placeholder so the panel
  // immediately shows 1 tab entry instead of the empty-state message.
  categories[name] = [{ tabId: null, url: 'chrome://newtab', title: 'New Tab', favIconUrl: '' }];
  await Storage.saveCategories(categories);
  return { success: true, categories };
}

async function deleteCategory(name) {
  const { categories, activeCategory } = await Storage.getFullState();
  if (name === activeCategory) return { error: 'Cannot delete the active category' };
  delete categories[name];
  await Storage.saveCategories(categories);
  return { success: true };
}

async function switchToCategory(targetCategory) {
  if (_isSwitching) return { error: 'Switch already in progress' };
  _isSwitching = true;

  try {
    const { categories, activeCategory } = await Storage.getFullState();
    if (targetCategory === activeCategory) return { success: true };
    if (!categories[targetCategory]) return { error: 'Category not found' };

    // STEP 1: Snapshot the current window's user tabs.
    // Uses isSystemTab() so chrome://newtab IS included; chrome://settings etc. are excluded.
    const openTabs = await chrome.tabs.query({ currentWindow: true });
    const userTabs = openTabs.filter(t => !isSystemTab(t.url));
    const savedTabs = userTabs.map(t => ({
      tabId: null,          // null = stored but not open (the RAM-saving state)
      url: t.url || 'chrome://newtab',
      title: t.title || 'New Tab',
      favIconUrl: t.favIconUrl || ''
    }));
    // Always keep at least 1 entry so the category never appears empty after switching away
    categories[activeCategory] = savedTabs.length > 0
      ? savedTabs
      : [{ tabId: null, url: 'chrome://newtab', title: 'New Tab', favIconUrl: '' }];

    // STEP 2: Create a bridge tab FIRST so Chrome never hits zero open tabs.
    // Without this, removing all tabs closes the window.
    const bridge = await chrome.tabs.create({ url: 'chrome://newtab', active: true });

    // STEP 3: Close all user tabs (bridge is excluded — it's chrome://)
    const userTabIds = userTabs.map(t => t.id);
    if (userTabIds.length > 0) await chrome.tabs.remove(userTabIds);

    // STEP 4: Open the target category's saved URLs
    const targetTabs = categories[targetCategory] || [];
    // Filter out any entries with broken/empty URLs before trying to create tabs
    const validTabs = targetTabs.filter(t => t.url && !t.url.startsWith('chrome-extension://'));
    if (validTabs.length > 0) {
      const created = [];
      for (const tab of validTabs) {
        const url = safeUrl(tab.url);
        const newTab = await chrome.tabs.create({ url, active: false });
        created.push(newTab);
      }
      // Activate the first restored tab and remove the bridge
      if (created.length > 0) {
        await chrome.tabs.update(created[0].id, { active: true });
      }
      await chrome.tabs.remove(bridge.id);
    }
    // If targetCategory is empty, the bridge stays as the single new tab — that's fine.

    // STEP 5: Persist
    await Storage.saveCategories(categories);
    await Storage.setActiveCategory(targetCategory);
    return { success: true };

  } finally {
    // Always release the guard, even if something throws
    _isSwitching = false;
  }
}

async function moveTabToCategory(tabId, targetCategory) {
  const { categories, activeCategory } = await Storage.getFullState();
  // Remove from all categories
  let movedTab = null;
  for (const name of Object.keys(categories)) {
    const idx = categories[name].findIndex(t => t.tabId === tabId);
    if (idx !== -1) {
      movedTab = categories[name].splice(idx, 1)[0];
    }
  }
  if (!movedTab) return { error: 'Tab not found' };
  if (!categories[targetCategory]) return { error: 'Target category not found' };
  categories[targetCategory].push(movedTab);
  await Storage.saveCategories(categories);
  return { success: true };
}

async function closeCategoryTabs(name) {
  const categories = await Storage.getCategories();
  const tabs = categories[name] || [];
  const ids = tabs.map(t => t.tabId).filter(Boolean);
  if (ids.length > 0) await chrome.tabs.remove(ids);
  categories[name] = tabs.map(t => ({ ...t, tabId: null }));
  await Storage.saveCategories(categories);
  return { success: true };
}

async function restoreCategoryTabs(name) {
  const categories = await Storage.getCategories();
  const tabs = categories[name] || [];
  for (const tab of tabs) {
    if (!tab.tabId && tab.url) {
      const newTab = await chrome.tabs.create({ url: tab.url, active: false });
      tab.tabId = newTab.id;
    }
  }
  await Storage.saveCategories(categories);
  return { success: true };
}
