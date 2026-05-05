// Run this ONCE in the TabGrove Service Worker DevTools console
// (chrome://extensions → TabGrove → "Service Worker" link → Console tab)
// Then reload the extension to re-seed storage with your open tabs.

chrome.storage.local.clear(() => console.log('Storage cleared. Now reload the extension.'));
