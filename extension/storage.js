// storage.js — Shared Data Layer
// All persistent data flows through this module. bg.js and panel.js both import it.
// chrome.storage.local is the single source of truth.

export const Storage = {
  /** Retrieve all categories ({ categoryName: [tabObject, ...] }) */
  async getCategories() {
    const result = await chrome.storage.local.get('categories');
    return result.categories || {};
  },

  /** Persist all categories */
  async saveCategories(categories) {
    await chrome.storage.local.set({ categories });
  },

  /** Get the name of the currently active category */
  async getActiveCategory() {
    const result = await chrome.storage.local.get('activeCategory');
    return result.activeCategory || null;
  },

  /** Set the active category by name */
  async setActiveCategory(name) {
    await chrome.storage.local.set({ activeCategory: name });
  },

  /** Retrieve both categories and activeCategory in one round-trip */
  async getFullState() {
    return chrome.storage.local.get(['categories', 'activeCategory']);
  }
};
