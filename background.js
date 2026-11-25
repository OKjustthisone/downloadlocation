/**
 * LocationDL service worker.
 *
 * Chrome only allows an extension to suggest a path relative to the user's
 * default Downloads folder. The rule engine therefore produces subfolders,
 * never absolute paths.
 */

import {
  buildMatchInfo,
  buildSuggestedFilename,
  localDateKey,
  matchRules,
} from './lib/rules.js';
import {
  getSettings,
  seedStorage,
  STORAGE_KEYS,
} from './lib/store.js';

const HISTORY_LIMIT = 200;
const SUGGEST_TIMEOUT_MS = 3000;

let settingsPromise = null;
let writeQueue = Promise.resolve();

function getCachedSettings() {
  if (!settingsPromise) {
    settingsPromise = getSettings().catch((error) => {
      settingsPromise = null;
      throw error;
    });
  }
  return settingsPromise;
}

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === 'local' && changes[STORAGE_KEYS.settings]) {
    settingsPromise = null;
  }
});

chrome.runtime.onInstalled.addListener((details) => {
  seedStorage()
    .then(async () => {
      if (details.reason === 'install') {
        try {
          await chrome.runtime.openOptionsPage();
        } catch (error) {
          console.warn('[LocationDL] Could not open options page', error);
        }
      }
    })
    .catch((error) => console.error('[LocationDL] Failed to initialize storage', error));
});

chrome.runtime.onStartup.addListener(() => {
  settingsPromise = null;
});

/**
 * Decide where a download should go and build the history entry.
 * Returns { suggestion: null, entry: null } when Chrome's default is kept.
 */
async function routeDownload(item) {
  const settings = await getCachedSettings();
  const info = buildMatchInfo({
    url: item.finalUrl || item.url || '',
    referrer: item.referrer || '',
    filename: item.filename || '',
  });

  const result = matchRules(settings, info);
  if (result.source === 'disabled' || !result.folder) {
    return { suggestion: null, entry: null };
  }

  const suggestedPath = buildSuggestedFilename({
    filename: info.base,
    folder: result.folder,
    relativeDir: info.relativeDir,
    preserveSubdirs: settings.preserveSubdirs,
  });

  if (!suggestedPath || suggestedPath === info.base) {
    return { suggestion: null, entry: null };
  }

  return {
    suggestion: {
      filename: suggestedPath,
      conflictAction: 'uniquify',
    },
    entry: {
      id: item.id,
      ts: Date.now(),
      base: info.base,
      path: suggestedPath,
      url: info.url,
      host: info.hostname,
      ruleId: result.ruleId,
      ruleName: result.ruleName,
      folder: result.folder,
      source: result.source,
    },
  };
}

async function recordEntry(entry) {
  const data = await chrome.storage.local.get([
    STORAGE_KEYS.history,
    STORAGE_KEYS.stats,
  ]);

  const history = Array.isArray(data[STORAGE_KEYS.history])
    ? data[STORAGE_KEYS.history]
    : [];
  if (history.some((existing) => existing && existing.id === entry.id)) {
    return;
  }

  history.unshift(entry);
  const stats = data[STORAGE_KEYS.stats] && typeof data[STORAGE_KEYS.stats] === 'object'
    ? data[STORAGE_KEYS.stats]
    : {};
  const byRule = stats.byRule && typeof stats.byRule === 'object'
    ? { ...stats.byRule }
    : {};
  const statKey = entry.ruleId || '__fallback';
  byRule[statKey] = (Number(byRule[statKey]) || 0) + 1;
  const todayKey = localDateKey();
  const sameDay = stats.todayDate === todayKey;

  await chrome.storage.local.set({
    [STORAGE_KEYS.history]: history.slice(0, HISTORY_LIMIT),
    [STORAGE_KEYS.stats]: {
      total: (Number(stats.total) || 0) + 1,
      byRule,
      lastAt: entry.ts,
      today: sameDay ? (Number(stats.today) || 0) + 1 : 1,
      todayDate: todayKey,
    },
  });
}

function queueRecord(entry) {
  writeQueue = writeQueue
    .then(() => recordEntry(entry))
    .catch((error) => console.error('[LocationDL] Failed to record download', error));
}

chrome.downloads.onDeterminingFilename.addListener((item, suggest) => {
  let settled = false;
  let timedOut = false;

  const finish = (suggestion) => {
    if (settled) return;
    settled = true;
    try {
      if (suggestion && suggestion.filename) {
        suggest(suggestion);
      } else {
        suggest();
      }
    } catch (error) {
      console.warn('[LocationDL] suggest() failed', error);
    }
  };

  const timer = setTimeout(() => {
    timedOut = true;
    finish();
  }, SUGGEST_TIMEOUT_MS);

  routeDownload(item)
    .then(({ suggestion, entry }) => {
      clearTimeout(timer);
      if (timedOut) return;
      finish(suggestion);
      if (entry) queueRecord(entry);
    })
    .catch((error) => {
      clearTimeout(timer);
      console.error('[LocationDL] Routing failed', error);
      finish();
    });

  // Required because suggest() is called asynchronously.
  return true;
});
