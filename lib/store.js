/**
 * Thin persistence helpers around chrome.storage.local.
 * Rule data lives locally: no network access, no host permissions required.
 */

import { createDefaultSettings, localDateKey, normalizeSettings } from './rules.js';

export const STORAGE_KEYS = Object.freeze({
  settings: 'settings',
  history: 'history',
  stats: 'stats',
});

export async function getSettings() {
  const data = await chrome.storage.local.get(STORAGE_KEYS.settings);
  return normalizeSettings(data[STORAGE_KEYS.settings]);
}

/** Read settings, seeding the example rules on first use. */
export async function ensureSettings() {
  const data = await chrome.storage.local.get(STORAGE_KEYS.settings);
  if (data[STORAGE_KEYS.settings]) {
    return normalizeSettings(data[STORAGE_KEYS.settings]);
  }
  const defaults = createDefaultSettings();
  await chrome.storage.local.set({ [STORAGE_KEYS.settings]: defaults });
  return defaults;
}

export async function saveSettings(settings) {
  const normalized = normalizeSettings(settings);
  await chrome.storage.local.set({ [STORAGE_KEYS.settings]: normalized });
  return normalized;
}

export async function getHistory() {
  const data = await chrome.storage.local.get(STORAGE_KEYS.history);
  return Array.isArray(data[STORAGE_KEYS.history]) ? data[STORAGE_KEYS.history] : [];
}

export async function getStats() {
  const data = await chrome.storage.local.get(STORAGE_KEYS.stats);
  const stats = data[STORAGE_KEYS.stats];
  if (!stats || typeof stats !== 'object') {
    return { total: 0, byRule: {}, lastAt: 0, today: 0, todayDate: '' };
  }
  return {
    total: Number.isFinite(stats.total) ? stats.total : 0,
    byRule: stats.byRule && typeof stats.byRule === 'object' ? stats.byRule : {},
    lastAt: Number.isFinite(stats.lastAt) ? stats.lastAt : 0,
    today: Number.isFinite(stats.today) ? stats.today : 0,
    todayDate: typeof stats.todayDate === 'string' ? stats.todayDate : '',
  };
}

export async function clearHistory() {
  await chrome.storage.local.set({ [STORAGE_KEYS.history]: [] });
}

export async function resetStats() {
  await chrome.storage.local.set({
    [STORAGE_KEYS.stats]: {
      total: 0,
      byRule: {},
      lastAt: 0,
      today: 0,
      todayDate: localDateKey(),
    },
  });
}

/** Seed all storage keys on first install without overwriting existing data. */
export async function seedStorage() {
  const data = await chrome.storage.local.get(Object.values(STORAGE_KEYS));
  const patch = {};
  if (!data[STORAGE_KEYS.settings]) {
    patch[STORAGE_KEYS.settings] = createDefaultSettings();
  } else {
    patch[STORAGE_KEYS.settings] = normalizeSettings(data[STORAGE_KEYS.settings]);
  }
  if (!Array.isArray(data[STORAGE_KEYS.history])) {
    patch[STORAGE_KEYS.history] = [];
  }
  if (!data[STORAGE_KEYS.stats] || typeof data[STORAGE_KEYS.stats] !== 'object') {
    patch[STORAGE_KEYS.stats] = {
      total: 0,
      byRule: {},
      lastAt: 0,
      today: 0,
      todayDate: localDateKey(),
    };
  }
  await chrome.storage.local.set(patch);
}
