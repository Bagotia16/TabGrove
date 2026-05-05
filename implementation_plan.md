# TabGrove — Technical Implementation Guide

> **Purpose:** This document is the authoritative build reference. Follow each phase sequentially. Each step includes the exact technical action required, file names, API calls, and gotchas to avoid.

---

## Phase 0 — Repository & Dev Environment Setup

### 0.1 — Scaffold the Project Directory

Create the following folder structure inside `/extension/`:

```
extension/
├── manifest.json
├── bg.js                  # Service Worker (background orchestrator)
├── panel.html             # Side Panel UI
├── panel.js               # Side Panel logic
├── panel.css              # Side Panel styles
├── popup.html             # Action popup (quick actions only)
├── popup.js
├── popup.css
├── storage.js             # Shared data-layer module
├── icons/
│   ├── icon16.png
│   ├── icon48.png
│   └── icon128.png
└── lib/                   # Any vendored JS (no CDN — MV3 requires local assets)
```

### 0.2 — Configure VS Code for MV3 Validation

1. Install the **"Chrome Extension Manifest V3" JSON schema** via VS Code settings.
2. Add to `.vscode/settings.json`:
   ```json
   {
     "json.schemas": [{
       "fileMatch": ["manifest.json"],
       "url": "https://json.schemastore.org/chrome-manifest"
     }]
   }
   ```
3. This gives real-time inline validation — prevents typos like `"versions"` (wrong) vs `"version"` (correct) that silently break extension loading.

### 0.3 — Browser Requirements

- Chrome **114+** for Side Panel API (`chrome.sidePanel`).
- Chrome **129+** for IndexedDB Snappy compression (performance bonus — not blocking).
- Load extension via `chrome://extensions` → **Developer mode ON** → **Load unpacked**.

---

## Phase 1 — manifest.json (The Contract)

### 1.1 — Write the Full Manifest

Create `manifest.json` with exactly this structure:

```json
{
  "manifest_version": 3,
  "name": "TabGrove",
  "version": "1.0.0",
  "description": "Organize tabs into categories. Save RAM. Stay focused.",
  "permissions": [
    "tabs",
    "storage",
    "sessions",
    "tabGroups",
    "sidePanel",
    "alarms"
  ],
  "host_permissions": ["<all_urls>"],
  "background": {
    "service_worker": "bg.js",
    "type": "module"
  },
  "side_panel": {
    "default_path": "panel.html"
  },
  "action": {
    "default_popup": "popup.html",
    "default_icon": {
      "16": "icons/icon16.png",
      "48": "icons/icon48.png",
      "128": "icons/icon128.png"
    }
  },
  "icons": {
    "16": "icons/icon16.png",
    "48": "icons/icon48.png",
    "128": "icons/icon128.png"
  }
}
```

### 1.2 — Permission Rationale (Required for Web Store Review)

| Permission | Why It's Needed |
|---|---|
| `tabs` | Read tab URLs, titles, favicons, and IDs |
| `storage` | Persist category data across sessions |
| `sessions` | Restore closed tabs and retrieve session history |
| `tabGroups` | Create, color, and label native Chrome tab groups |
| `sidePanel` | Render the persistent side panel UI |
| `alarms` | Keep service worker alive for periodic state sync |
| `host_permissions: <all_urls>` | Access URLs across all tabs (required for category assignment) |

> **CAUTION:** `host_permissions: <all_urls>` triggers a security warning during installation. Prepare a clear privacy justification: *"URLs are stored locally only to restore category sessions. No data is sent to external servers."*

---

## Phase 2 — Service Worker / bg.js (The Orchestrator)

### 2.1 — The Stateless Design Principle

The service worker **terminates after ~30 seconds of inactivity**. This means:

- **Never store state in JS variables** (they vanish when the worker sleeps).
- Every handler must: **read from storage → do logic → write back to storage**.
- Treat every event handler as a fresh, atomic operation.

### 2.2 — Initialization on Install

```js
// bg.js
import { Storage } from './storage.js';

chrome.runtime.onInstalled.addListener(async () => {
  // Initialize default data structure if not present
  const existing = await Storage.getCategories();
  if (!existing || Object.keys(existing).length === 0) {
    await Storage.saveCategories({ "Default": [] });
    await Storage.setActiveCategory("Default");
  }
  // Open Side Panel on install
  chrome.sidePanel.open({ windowId: (await chrome.windows.getCurrent()).id });
});
```

### 2.3 — Register the Alarm (Keep Worker Alive for Periodic Tasks)

```js
chrome.alarms.create('heartbeat', { periodInMinutes: 0.4 });

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === 'heartbeat') {
    await syncStateFromStorage(); // re-hydrate + validate
  }
});
```

### 2.4 — Tab Event Listeners

Register these 4 critical tab events:

```js
// Tab created — add to active category
chrome.tabs.onCreated.addListener(async (tab) => {
  // Race condition guard: wait briefly then re-check tab exists
  await new Promise(r => setTimeout(r, 300));
  const exists = await chrome.tabs.get(tab.id).catch(() => null);
  if (!exists) return;
  await addTabToActiveCategory(tab);
});

// Tab removed — clean up from all categories
chrome.tabs.onRemoved.addListener(async (tabId) => {
  await removeTabFromAllCategories(tabId);
});

// Tab updated (URL change, title load) — refresh stored metadata
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete') {
    await updateTabMetadata(tabId, { url: tab.url, title: tab.title, favIconUrl: tab.favIconUrl });
  }
});

// Message passing from UI
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleUIMessage(message).then(sendResponse);
  return true; // keep channel open for async response
});
```

### 2.5 — Message Handler Routing

```js
async function handleUIMessage(message) {
  switch (message.action) {
    case 'CREATE_CATEGORY':    return await createCategory(message.name);
    case 'DELETE_CATEGORY':    return await deleteCategory(message.name);
    case 'SWITCH_CATEGORY':    return await switchToCategory(message.name);
    case 'MOVE_TAB':           return await moveTabToCategory(message.tabId, message.category);
    case 'CLOSE_CATEGORY_TABS': return await closeCategoryTabs(message.name);
    case 'RESTORE_CATEGORY':   return await restoreCategoryTabs(message.name);
    case 'GET_STATE':          return await getFullState();
  }
}
```

---

## Phase 3 — storage.js (The Data Layer)

### 3.1 — Data Schema Design

All category data is stored in `chrome.storage.local` under the key `"categories"`.

```js
// Schema
{
  "categories": {
    "Work": [
      { "tabId": 123, "url": "https://github.com", "title": "GitHub", "favIconUrl": "..." },
      { "tabId": 124, "url": "https://jira.com", "title": "Jira", "favIconUrl": "..." }
    ],
    "Research": [
      { "tabId": null, "url": "https://arxiv.org", "title": "ArXiv", "favIconUrl": "..." }
    ]
  },
  "activeCategory": "Work"
}
```

> **NOTE:** `tabId: null` means the tab is **stored but not currently open** (the RAM-saving state). When a category is "active", its tabs are open with real IDs. Inactive categories have `null` IDs.

### 3.2 — storage.js Module

```js
// storage.js
export const Storage = {
  async getCategories() {
    const result = await chrome.storage.local.get('categories');
    return result.categories || {};
  },
  async saveCategories(categories) {
    await chrome.storage.local.set({ categories });
  },
  async getActiveCategory() {
    const result = await chrome.storage.local.get('activeCategory');
    return result.activeCategory || null;
  },
  async setActiveCategory(name) {
    await chrome.storage.local.set({ activeCategory: name });
  },
  async getFullState() {
    return chrome.storage.local.get(['categories', 'activeCategory']);
  }
};
```

### 3.3 — Storage Strategy Decision

| Store | Use Case |
|---|---|
| `chrome.storage.local` | All persistent category/tab data (survives browser restart) |
| `chrome.storage.session` | Temporary UI state (e.g., last scroll position) — survives worker sleep, cleared on browser restart |
| IndexedDB | Only needed if supporting 1000+ tabs; skip for v1 |

---

## Phase 4 — Core Tab Management Logic (bg.js functions)

### 4.1 — Switch Active Category (Core Feature)

This is the heart of the extension — switching categories:

```js
async function switchToCategory(targetCategory) {
  const { categories, activeCategory } = await Storage.getFullState();

  // STEP 1: Save current open tabs to the current active category
  const openTabs = await chrome.tabs.query({ currentWindow: true });
  const tabData = openTabs
    .filter(t => !t.url.startsWith('chrome://')) // exclude system tabs
    .map(t => ({ tabId: t.id, url: t.url, title: t.title, favIconUrl: t.favIconUrl }));
  categories[activeCategory] = tabData;

  // STEP 2: Close all current tabs
  const tabIds = openTabs.filter(t => !t.url.startsWith('chrome://')).map(t => t.id);
  if (tabIds.length > 0) await chrome.tabs.remove(tabIds);

  // STEP 3: Open the target category's saved URLs
  const targetTabs = categories[targetCategory] || [];
  if (targetTabs.length === 0) {
    await chrome.tabs.create({ url: 'chrome://newtab' });
  } else {
    for (const tab of targetTabs) {
      await chrome.tabs.create({ url: tab.url, active: false });
    }
  }

  // STEP 4: Update storage
  await Storage.saveCategories(categories);
  await Storage.setActiveCategory(targetCategory);

  return { success: true };
}
```

### 4.2 — Create a New Category

```js
async function createCategory(name) {
  const categories = await Storage.getCategories();
  if (categories[name]) return { error: 'Category already exists' };
  categories[name] = [];
  await Storage.saveCategories(categories);
  return { success: true, categories };
}
```

### 4.3 — Delete a Category

```js
async function deleteCategory(name) {
  const { categories, activeCategory } = await Storage.getFullState();
  if (name === activeCategory) return { error: 'Cannot delete the active category' };
  delete categories[name];
  await Storage.saveCategories(categories);
  return { success: true };
}
```

### 4.4 — Discard Inactive Tabs (RAM Optimization — Optional Enhancement)

Instead of fully closing tabs, you can "discard" them (unloads from RAM, keeps tab visible):

```js
async function discardInactiveCategoryTabs() {
  const { categories, activeCategory } = await Storage.getFullState();
  for (const [categoryName, tabs] of Object.entries(categories)) {
    if (categoryName === activeCategory) continue;
    for (const tab of tabs) {
      if (tab.tabId) {
        chrome.tabs.discard(tab.tabId).catch(() => {}); // tab may already be closed
      }
    }
  }
}
```

---

## Phase 5 — Side Panel UI (panel.html + panel.js)

### 5.1 — panel.html Structure

```html
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>TabGrove</title>
  <link rel="stylesheet" href="panel.css">
</head>
<body>
  <div id="app">
    <header id="header">
      <h1>TabGrove</h1>
      <button id="btn-new-category">+ New Category</button>
    </header>

    <!-- Category List -->
    <nav id="category-list"></nav>

    <!-- Tab List for Active Category -->
    <section id="tab-list-section">
      <h2 id="active-category-title"></h2>
      <ul id="tab-list"></ul>
    </section>
  </div>
  <script src="panel.js" type="module"></script>
</body>
</html>
```

### 5.2 — panel.js — Load and Render State

```js
// panel.js
async function loadAndRender() {
  const state = await chrome.runtime.sendMessage({ action: 'GET_STATE' });
  renderCategories(state.categories, state.activeCategory);
  renderTabList(state.categories[state.activeCategory] || []);
}

function renderCategories(categories, activeCategory) {
  const nav = document.getElementById('category-list');
  nav.innerHTML = '';
  for (const name of Object.keys(categories)) {
    const btn = document.createElement('button');
    btn.textContent = name;
    btn.classList.toggle('active', name === activeCategory);
    btn.addEventListener('click', () => switchCategory(name));
    nav.appendChild(btn);
  }
}

async function switchCategory(name) {
  await chrome.runtime.sendMessage({ action: 'SWITCH_CATEGORY', name });
  await loadAndRender();
}

// On panel open, load state
document.addEventListener('DOMContentLoaded', loadAndRender);

// New category button
document.getElementById('btn-new-category').addEventListener('click', async () => {
  const name = prompt('Enter category name:');
  if (!name) return;
  await chrome.runtime.sendMessage({ action: 'CREATE_CATEGORY', name });
  await loadAndRender();
});
```

### 5.3 — Real-Time Sync via Storage Events

To auto-update the panel when tabs change:

```js
// In panel.js
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && (changes.categories || changes.activeCategory)) {
    loadAndRender();
  }
});
```

---

## Phase 6 — Popup UI (popup.html + popup.js)

The popup is for **quick actions only** — it must not be used for complex workflows since it closes on focus loss.

### Quick Actions to Include:
- "Save current tabs to category" button
- "Switch category" dropdown
- "Open Side Panel" button

```js
// popup.js
document.getElementById('btn-open-panel').addEventListener('click', async () => {
  const win = await chrome.windows.getCurrent();
  await chrome.sidePanel.open({ windowId: win.id });
  window.close(); // close popup after opening panel
});
```

---

## Phase 7 — UI Design (panel.css)

### Design Tokens to Implement:

```css
:root {
  --bg: #0f0f13;
  --surface: #1a1a24;
  --surface-2: #22222e;
  --accent: #7c6af7;
  --accent-glow: rgba(124, 106, 247, 0.25);
  --text: #e8e6f0;
  --text-muted: #8a87a0;
  --radius: 10px;
  --transition: 0.2s ease;
}
```

### Key UI Behaviors to Implement:
1. **Active category pill** — highlighted with `--accent` color + subtle glow.
2. **Tab list items** — show favicon, title, and a close (×) button.
3. **Hover micro-animations** — `transform: translateX(4px)` on tab items.
4. **Category switch animation** — fade-out/fade-in on tab list change.
5. **Scrollable tab list** — `overflow-y: auto` with custom scrollbar styling.
6. **"Working" state indicator** — spinner during category switch (tabs open/close takes ~1–2s).

---

## Phase 8 — Quality Assurance & Debugging

### 8.1 — Loading the Extension for Testing

1. Go to `chrome://extensions`
2. Enable **Developer Mode**
3. Click **Load unpacked** → select the `/extension/` folder
4. Every code change requires clicking the **↺ Reload** button on the extension card

### 8.2 — Debugging the Service Worker

- Open service worker DevTools: `chrome://extensions` → find the extension → click **"Service Worker"** link
- This opens a dedicated DevTools. Use `console.log` freely in `bg.js`.
- **Important:** Having DevTools open keeps the worker alive — this masks statelessness bugs. To test true cold starts: close DevTools, wait 30s, trigger an event, verify state is restored from storage.

### 8.3 — Inspecting Storage

In the Service Worker DevTools:
```js
// Run in console to inspect all stored data
chrome.storage.local.get(null, console.log);
```

Or: DevTools → **Application tab** → **Storage → Chrome Extension Storage**.

### 8.4 — Common Errors & Fixes

| Error | Cause | Fix |
|---|---|---|
| `tabs is undefined` | Missing `"tabs"` in permissions | Add to manifest permissions array |
| `Cannot read properties of undefined (reading 'id')` | Race condition — tab closed before handler ran | Add `await chrome.tabs.get(tabId).catch(() => null)` guard |
| `Tabs cannot be edited right now` | User dragging tab while API call runs | Wrap in try/catch with retry after 500ms delay |
| `chrome.sidePanel is not a function` | Chrome < 114 | Upgrade Chrome; add version check |
| Extension not loading | manifest.json syntax error | Validate JSON; check for trailing commas |
| State lost after browser restart | Using `storage.session` for permanent data | Switch to `storage.local` |

### 8.5 — Performance Checklist

- [ ] Service worker does NOT have long-running timers (use `chrome.alarms` instead)
- [ ] All async operations use `async/await` with proper error handling
- [ ] `chrome.tabs.query()` is used with filters, not querying all tabs unnecessarily
- [ ] Tab icons use `<img>` with a fallback for missing favicons
- [ ] Category switch operation is debounced (prevent double-clicks from triggering twice)

---

## Phase 9 — Build Sequence (Recommended Order)

Execute development in this strict order to avoid blocked work:

```
1. manifest.json          → loads extension skeleton
2. icons/                 → prevents manifest icon errors
3. bg.js (skeleton)       → register events, no logic yet
4. storage.js             → data layer (everything depends on this)
5. bg.js (full logic)     → implement all handlers
6. panel.html + panel.css → UI shell with styles
7. panel.js               → connect UI to bg.js via messages
8. popup.html + popup.js  → quick actions
9. End-to-end testing     → test all flows manually
10. Polish CSS             → animations, transitions, responsive
```

---

## Phase 10 — Chrome Web Store Deployment

### 10.1 — Package the Extension

```bash
# From inside /extension/ directory
zip -r tabgrove.zip . --exclude "*.git*" --exclude ".vscode/*" --exclude "*.DS_Store"
```

> **IMPORTANT:** The ZIP must contain `manifest.json` at its root level — not inside a subfolder.

### 10.2 — Web Store Submission Requirements

1. **Developer Account:** One-time $5 registration fee at [chrome.google.com/webstore/devconsole](https://chrome.google.com/webstore/devconsole)
2. **Screenshots:** 1280×800 or 640×400 px — minimum 1, maximum 5
3. **Privacy Policy URL:** Required because `host_permissions: <all_urls>` is declared
4. **Single Purpose Justification:** State clearly — *"This extension organizes browser tabs into named categories to reduce RAM usage. No data leaves the device."*
5. **Permission Justifications** (written descriptions for each sensitive permission):
   - `tabs`: *"Required to read tab URLs and titles for category assignment."*
   - `host_permissions`: *"Required to access tab URLs across all websites for category management."*

### 10.3 — Review Timeline

- Initial review: **1–3 business days**
- If rejected for permission justification: revise and resubmit (adds another cycle)
- Keep `host_permissions` justification thorough — this is the most common rejection reason for tab managers

---

## ✅ Finalized Design Decisions

| Decision | Choice | Implication |
|---|---|---|
| **Category switch behavior** | **Close tabs, save URLs** | When switching, all current tabs are closed and their URLs saved to `storage.local`. Switching back re-opens them. Zero RAM used by inactive categories. |
| **Multi-window scope** | **Global per Chrome profile** | One active category shared across all windows of the same profile. Switching affects all windows. Cross-profile support is out of scope. |
| **Max URLs per category** | **No limit** | `chrome.storage.local` 10MB cap applies (~tens of thousands of URLs before hitting it). No artificial limit imposed. |
| **Extension name** | **TabGrove** | Confirmed. Used in manifest `name` field and all UI headings. |
