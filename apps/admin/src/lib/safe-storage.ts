import type { StateStorage } from 'zustand/middleware';

/**
 * localStorage wrapper that never throws (storage can be disabled, full, or blocked by privacy
 * settings). Only used for non-sensitive UI preferences — never for credentials or session data.
 */
export const safeLocalStorage: StateStorage = {
  getItem: (name) => {
    try {
      return window.localStorage.getItem(name);
    } catch {
      return null;
    }
  },
  setItem: (name, value) => {
    try {
      window.localStorage.setItem(name, value);
    } catch {
      // Preference simply won't persist.
    }
  },
  removeItem: (name) => {
    try {
      window.localStorage.removeItem(name);
    } catch {
      // Ignore.
    }
  },
};
