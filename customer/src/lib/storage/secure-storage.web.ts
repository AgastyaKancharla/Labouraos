import { createMemoryStore, type KeyValueStore } from './types';

/**
 * Installed web app (iPhone "Add to Home Screen", or a browser): the
 * browser's localStorage for this site, so closing the tab or the home-screen
 * app does not sign the agent out before the session limit. When storage is
 * blocked (private browsing) values live in memory for this tab only.
 *
 * localStorage is per site and per app: on iPhone, Safari and the
 * home-screen app keep separate storage, so the agent signs in from the
 * home-screen icon (see field/README.md).
 */
const memory = createMemoryStore();

function local(): Storage | null {
  try {
    return typeof window !== 'undefined' && window.localStorage ? window.localStorage : null;
  } catch {
    return null;
  }
}

export const secureStorage: KeyValueStore = {
  async getItem(key) {
    try {
      const store = local();
      if (store) return store.getItem(key);
    } catch {
      /* fall through */
    }
    return memory.getItem(key);
  },
  async setItem(key, value) {
    try {
      const store = local();
      if (store) {
        store.setItem(key, value);
        return;
      }
    } catch {
      /* quota or blocked — fall through */
    }
    await memory.setItem(key, value);
  },
  async removeItem(key) {
    try {
      local()?.removeItem(key);
    } catch {
      /* ignore */
    }
    await memory.removeItem(key);
  },
};
