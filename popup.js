/**
 * LocationDL popup: quick status, pause/resume, recent routes and shortcuts.
 */

import { displayPath, localDateKey } from './lib/rules.js';
import {
  ensureSettings,
  getHistory,
  getSettings,
  getStats,
  saveSettings,
} from './lib/store.js';

const SAVE_ECHO_WINDOW_MS = 2500;
const RECENT_LIMIT = 4;

const state = {
  settings: null,
  stats: { total: 0, byRule: {}, lastAt: 0, today: 0, todayDate: '' },
  history: [],
  lastLocalSaveAt: 0,
  reloadTimer: 0,
};

const els = {};

const ELEMENT_IDS = [
  'masterToggle',
  'pausedBanner',
  'resumeBtn',
  'statRules',
  'statToday',
  'statTotal',
  'refreshBtn',
  'recentList',
  'recentEmpty',
  'openOptionsBtn',
  'openHistoryBtn',
  'toastHost',
];

function cacheElements() {
  for (const id of ELEMENT_IDS) {
    els[id] = document.getElementById(id);
  }
}

function icon(name) {
  return `<svg class="icon" aria-hidden="true"><use href="#i-${name}"></use></svg>`;
}

const HTML_ESCAPES = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => HTML_ESCAPES[character]);
}

const numberFormatter = new Intl.NumberFormat('zh-CN');

function formatNumber(value) {
  return numberFormatter.format(Number(value) || 0);
}

function pad2(value) {
  return String(value).padStart(2, '0');
}

function formatTimeShort(timestamp) {
  const date = new Date(Number(timestamp));
  if (Number.isNaN(date.getTime())) return '—';

  const time = `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
  const key = localDateKey(date);
  if (key === localDateKey()) return time;

  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  if (key === localDateKey(yesterday)) return `昨天 ${time}`;

  return `${pad2(date.getMonth() + 1)}-${pad2(date.getDate())} ${time}`;
}

async function init() {
  cacheElements();
  bindEvents();

  try {
    await loadAll(true);
    render();
  } catch (error) {
    console.error('[LocationDL] Failed to initialize popup', error);
    showToast('无法读取设置，请重试', 'error');
  }

  if (globalThis.chrome?.storage?.onChanged) {
    chrome.storage.onChanged.addListener(handleStorageChanged);
  }
}

function bindEvents() {
  els.masterToggle.addEventListener('change', handleMasterToggle);
  els.resumeBtn.addEventListener('click', () => {
    els.masterToggle.checked = true;
    handleMasterToggle();
  });
  els.refreshBtn.addEventListener('click', handleRefresh);
  els.openOptionsBtn.addEventListener('click', openOptions);
  els.openHistoryBtn.addEventListener('click', openHistory);
}

async function loadAll(seed = false) {
  const [settings, stats, history] = await Promise.all([
    seed ? ensureSettings() : getSettings(),
    getStats(),
    getHistory(),
  ]);
  state.settings = settings;
  state.stats = stats;
  state.history = history;
}

function render() {
  if (!state.settings) return;
  updateMasterUI();
  renderStats();
  renderRecent();
}

function updateMasterUI() {
  const enabled = state.settings.enabled !== false;
  document.body.classList.toggle('is-paused', !enabled);
  els.masterToggle.checked = enabled;
  els.pausedBanner.hidden = enabled;
}

function renderStats() {
  const rules = Array.isArray(state.settings.rules) ? state.settings.rules : [];
  const enabledCount = rules.filter((rule) => rule.enabled !== false).length;
  const today = state.stats.todayDate === localDateKey() ? state.stats.today || 0 : 0;

  els.statRules.textContent = formatNumber(enabledCount);
  els.statToday.textContent = formatNumber(today);
  els.statTotal.textContent = formatNumber(state.stats.total || 0);
}

function renderRecent() {
  const rows = (Array.isArray(state.history) ? state.history : []).slice(0, RECENT_LIMIT);
  els.recentList.hidden = rows.length === 0;
  els.recentEmpty.hidden = rows.length > 0;

  els.recentList.innerHTML = rows
    .map((entry) => {
      const ruleName = entry.ruleName || (entry.source === 'fallback' ? '回退文件夹' : '规则');
      const fallbackClass = entry.source === 'fallback' ? ' fallback' : '';
      const file = entry.base || '下载文件';
      const path = displayPath(entry.path || '');

      return `
        <div class="recent-item" title="${escapeHtml(path)}">
          <span class="recent-icon">${icon('folder')}</span>
          <div class="recent-main">
            <div class="recent-file" title="${escapeHtml(file)}">${escapeHtml(file)}</div>
            <div class="recent-meta">
              <span class="recent-rule${fallbackClass}" title="${escapeHtml(ruleName)}">${escapeHtml(ruleName)}</span>
              <span class="recent-path">${escapeHtml(path)}</span>
            </div>
          </div>
          <span class="recent-time">${escapeHtml(formatTimeShort(entry.ts))}</span>
        </div>
      `;
    })
    .join('');
}

async function handleMasterToggle() {
  if (!state.settings) return;
  const enabled = els.masterToggle.checked;

  state.settings.enabled = enabled;
  updateMasterUI();

  try {
    state.lastLocalSaveAt = Date.now();
    state.settings = await saveSettings(state.settings);
    state.lastLocalSaveAt = Date.now();
    showToast(enabled ? '自动路由已开启' : '自动路由已暂停', enabled ? 'success' : 'info');
  } catch (error) {
    console.error('[LocationDL] Failed to save popup setting', error);
    state.settings.enabled = !enabled;
    updateMasterUI();
    showToast('保存失败，请重试', 'error');
  }
}

async function handleRefresh() {
  els.refreshBtn.disabled = true;
  els.refreshBtn.classList.add('is-spinning');
  try {
    await loadAll(false);
    render();
    showToast('已刷新', 'success');
  } catch (error) {
    console.error('[LocationDL] Failed to refresh popup', error);
    showToast('刷新失败，请重试', 'error');
  } finally {
    els.refreshBtn.disabled = false;
    els.refreshBtn.classList.remove('is-spinning');
  }
}

async function openOptions() {
  try {
    await chrome.runtime.openOptionsPage();
    window.close();
  } catch (error) {
    console.error('[LocationDL] Failed to open options page', error);
    showToast('无法打开设置页', 'error');
  }
}

async function openHistory() {
  const url = chrome.runtime.getURL('options.html#history');
  try {
    if (globalThis.chrome?.tabs?.create) {
      await chrome.tabs.create({ url });
    } else {
      await chrome.runtime.openOptionsPage();
    }
    window.close();
  } catch (error) {
    console.error('[LocationDL] Failed to open history', error);
    try {
      await chrome.runtime.openOptionsPage();
      window.close();
    } catch {
      showToast('无法打开设置页', 'error');
    }
  }
}

function handleStorageChanged(changes, areaName) {
  if (areaName !== 'local') return;

  const ownSettingsEcho =
    Boolean(changes.settings) && Date.now() - state.lastLocalSaveAt <= SAVE_ECHO_WINDOW_MS;
  if (ownSettingsEcho && !changes.stats && !changes.history) return;

  clearTimeout(state.reloadTimer);
  state.reloadTimer = setTimeout(() => {
    loadAll(false)
      .then(render)
      .catch((error) => {
        console.error('[LocationDL] Failed to reload popup data', error);
      });
  }, 150);
}

function showToast(message, type = 'info') {
  if (!els.toastHost) return;

  while (els.toastHost.children.length >= 2) {
    els.toastHost.firstElementChild.remove();
  }

  const toast = document.createElement('div');
  toast.className = `toast${type && type !== 'info' ? ` ${type}` : ''}`;
  toast.textContent = message;
  els.toastHost.append(toast);

  const dismiss = () => {
    if (toast.classList.contains('is-leaving')) return;
    toast.classList.add('is-leaving');
    setTimeout(() => toast.remove(), 160);
  };
  setTimeout(dismiss, 2800);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init, { once: true });
} else {
  init();
}
