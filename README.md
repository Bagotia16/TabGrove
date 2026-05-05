<div align="center">

# 🌿 TabGrove

**Organize tabs into categories. Save RAM. Stay focused.**

A Chromium extension (Manifest V3) that lets you group your browser tabs into named categories and swap between them instantly — freeing memory from tabs you aren't using right now.

[![Chrome](https://img.shields.io/badge/Platform-Chromium%2FChrome-4285F4?logo=googlechrome&logoColor=white)](#requirements)
[![Manifest V3](https://img.shields.io/badge/Manifest-V3-34A853)](#)
[![License](https://img.shields.io/badge/License-MIT-blue)](#license)

</div>

---

## 📌 The Problem

Modern browsing means dozens — sometimes hundreds — of open tabs. Each tab silently consumes RAM, CPU cycles, and your attention. Chrome's built-in tab groups help visually, but every tab still lives in memory.

## 💡 The Solution

**TabGrove** introduces *category switching*: you define named categories (e.g. "Work", "Research", "Shopping") and only the active category's tabs are actually open. When you switch categories, TabGrove:

1. **Snapshots** your current tabs and stores their URLs & metadata.
2. **Closes** them (reclaiming RAM).
3. **Restores** the target category's tabs from storage.

The result: you keep a clean, focused window with only the tabs you need, and your other tabs are safely parked — zero memory cost — until you switch back.

---

## ✨ Features

| Feature | Description |
|---|---|
| **Category Switching** | Instantly swap your entire window between tab workspaces. Only one category is "live" at a time. |
| **RAM Reclamation** | Closed-category tabs consume **zero browser memory**. Tabs are serialized to `chrome.storage.local` and restored on demand. |
| **Side Panel Dashboard** | A persistent side panel (Chrome 114+) displays the active category's tabs in real time, with favicon previews and a tab count badge. |
| **Quick Popup** | Click the toolbar icon for a lightweight popup to switch categories or launch the full side panel. |
| **Auto-Tracking** | New tabs you open are automatically registered under the active category. Closed tabs are removed from storage. Navigations are synced instantly. |
| **Bridge Tab Pattern** | During a category switch, a temporary "bridge" tab prevents Chrome from closing the window when all user tabs are removed. |
| **Heartbeat Keep-Alive** | A periodic alarm keeps the Manifest V3 service worker alive, preventing Chrome from terminating it during active use. |
| **Stateless Architecture** | The service worker is fully stateless across wake-ups. `chrome.storage.local` is the single source of truth; no global variables survive termination. |

---

## 🏗 Architecture

```
┌──────────────────────────────────────────────────────┐
│                    Chrome Browser                    │
│                                                      │
│  ┌──────────┐   messages   ┌──────────────────────┐  │
│  │ popup.js │ ──────────▸  │  bg.js               │  │
│  │ (toolbar │ ◂────────── │  (Service Worker)     │  │
│  │  popup)  │              │                      │  │
│  └──────────┘              │  • Tab event handlers │  │
│                            │  • Category CRUD      │  │
│  ┌──────────┐   messages   │  • Switch logic       │  │
│  │ panel.js │ ──────────▸  │  • Bridge tab pattern │  │
│  │ (side    │ ◂────────── │                      │  │
│  │  panel)  │              └─────────┬────────────┘  │
│  └──────────┘                        │               │
│                                      ▼               │
│                            ┌──────────────────────┐  │
│                            │  storage.js           │  │
│                            │  chrome.storage.local │  │
│                            └──────────────────────┘  │
└──────────────────────────────────────────────────────┘
```

| Layer | File | Role |
|---|---|---|
| **Background** | `bg.js` | Central orchestrator. Listens to tab events (`onCreated`, `onRemoved`, `onUpdated`), handles all UI messages, and executes the category-switch algorithm. |
| **Storage** | `storage.js` | Thin async wrapper around `chrome.storage.local`. Exposes `getCategories`, `saveCategories`, `getActiveCategory`, `setActiveCategory`, and `getFullState`. |
| **Side Panel UI** | `panel.html` / `panel.js` / `panel.css` | Persistent dashboard. Renders category pills, the active tab list with favicons, and a "New Category" button. Syncs in real time via `chrome.storage.onChanged`. |
| **Popup UI** | `popup.html` / `popup.js` / `popup.css` | Lightweight toolbar popup. Shows the active category, a dropdown to switch, and a button to open the full side panel. |
| **Utilities** | `lib/reset_storage.js` | Dev-only script to clear extension storage from the service worker console. |

---

## 📂 Project Structure

```
TabGrove/
├── extension/
│   ├── manifest.json          # Manifest V3 configuration
│   ├── bg.js                  # Service worker (background orchestrator)
│   ├── storage.js             # Shared data-access layer
│   ├── panel.html             # Side panel markup
│   ├── panel.js               # Side panel logic
│   ├── panel.css              # Side panel styles (dark theme)
│   ├── popup.html             # Toolbar popup markup
│   ├── popup.js               # Toolbar popup logic
│   ├── popup.css              # Toolbar popup styles
│   ├── icons/
│   │   ├── icon16.png
│   │   ├── icon48.png
│   │   └── icon128.png
│   └── lib/
│       └── reset_storage.js   # Dev utility — clear storage
├── README.md
├── README.txt                 # Technical implementation report
└── .gitignore
```

---

## 🔧 Requirements

- **Google Chrome 114+** (or any Chromium-based browser with Side Panel API support)
- No build step, no Node.js, no dependencies — pure vanilla JS.

---

## 🚀 Installation (Developer Mode)

1. **Clone the repo**
   ```bash
   git clone https://github.com/bagotia/TabGrove.git
   ```

2. **Open Chrome Extensions**
   Navigate to `chrome://extensions` and enable **Developer mode** (toggle in the top-right corner).

3. **Load the extension**
   Click **Load unpacked** and select the `extension/` folder inside the cloned repo.

4. **Pin it**
   Pin the TabGrove icon to your toolbar for quick access.

5. **Open the Side Panel**
   Click the toolbar icon → **Open Side Panel ↗** to launch the full dashboard.

---

## 📖 Usage

### Creating a Category
Click the **+ New Category** button in the side panel header. Enter a name (e.g. "Research"). A new category pill appears with a placeholder tab.

### Switching Categories
Click any category pill in the side panel — or use the toolbar popup's dropdown. TabGrove will:
1. Save your current tabs.
2. Close them.
3. Restore the target category's tabs.

> **Note:** A brief loading overlay ("Switching…") is shown while tabs are being swapped.

### Deleting a Category
Hover a non-active category pill and click the **×** button. A confirmation dialog prevents accidental deletion. The active category cannot be deleted.

### Navigating Tabs
Click any tab row in the side panel to focus that tab in the browser. Favicons and titles update in real time as you browse.

---

## 🧠 How Scoring / RAM Savings Work

TabGrove's value is measured by **how much memory you reclaim**:

| Metric | How It's Calculated |
|---|---|
| **Stored Tabs** | Tabs parked in inactive categories. Each entry is just a URL string + metadata (~200 bytes), consuming effectively **zero RAM**. |
| **RAM Freed** | A typical Chrome tab uses **50–300 MB** of RAM. If you park 20 tabs across inactive categories, you reclaim roughly **1–6 GB** of memory. |
| **Active Footprint** | Only the tabs in the current active category are loaded. The extension itself adds < 1 MB of overhead (service worker + storage). |

**In short:** The more categories you use and the fewer tabs in your active category, the more RAM you save. TabGrove turns O(all tabs) memory consumption into O(active tabs only).

---

## 🛠 Development & Debugging

### Live Reload Workflow
1. Make changes to any file in `extension/`.
2. Go to `chrome://extensions` and click the **reload** (↻) button on the TabGrove card.
3. Re-open the side panel to see your changes.

### Inspecting the Service Worker
- **Console:** `chrome://extensions` → TabGrove → click **"Service Worker"** link → opens DevTools.
- **Storage:** In DevTools → Application tab → Storage → Local Storage.
- **Status:** `chrome://serviceworker-internals` shows whether the worker is running or stopped.

### Resetting Storage
If storage gets into a bad state, run the reset script in the service worker console:
```js
chrome.storage.local.clear(() => console.log('Storage cleared. Now reload the extension.'));
```
Or paste the contents of `lib/reset_storage.js`.

### Common Errors

| Error | Cause | Fix |
|---|---|---|
| `"tabs is undefined"` | Missing `tabs` permission or incorrect `tabs.query()` usage | Verify `manifest.json` permissions |
| Tabs not tracked | Service worker was asleep during tab creation | The heartbeat alarm prevents this in normal use |
| Window closes on switch | Bridge tab failed to create | Check for errors in the service worker console |

---

## 🗺 Roadmap

- [ ] Drag-and-drop tab reordering within the side panel
- [ ] Move individual tabs between categories
- [ ] Import / export category sessions as JSON
- [ ] Tab search across all categories
- [ ] Keyboard shortcuts for category switching
- [ ] Chrome Web Store release

---

## 🤝 Contributing

1. Fork the repo
2. Create a feature branch (`git checkout -b feat/my-feature`)
3. Commit your changes (`git commit -m 'Add my feature'`)
4. Push to the branch (`git push origin feat/my-feature`)
5. Open a Pull Request

---

## 📜 License

This project is licensed under the [MIT License](LICENSE).

---

<div align="center">

**Built with vanilla JS • Zero dependencies • Pure Manifest V3**

</div>