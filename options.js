/**
 * LocationDL options page controller.
 *
 * The page owns the editable settings and writes them back to
 * chrome.storage.local. The service worker watches storage changes and uses
 * the same pure rule engine from lib/rules.js.
 */

import {
  DOMAIN_MODES,
  EXAMPLE_RULES,
  FILENAME_MODES,
  MODE_LABELS,
  RULE_TYPES,
  STORAGE_VERSION,
  TYPE_LABELS,
  buildMatchInfo,
  buildSuggestedFilename,
  createDefaultSettings,
  describeRule,
  displayPath,
  localDateKey,
  matchRules,
  normalizePatterns,
  normalizeRule,
  normalizeSettings,
  patternsToText,
  renderTarget,
  uid,
  validateRuleDraft,
  validateTargetFolder,
} from './lib/rules.js';
import {
  clearHistory,
  ensureSettings,
  getHistory,
  getSettings,
  getStats,
  resetStats,
  saveSettings,
} from './lib/store.js';

const TYPE_ICONS = Object.freeze({
  domain: 'domain',
  filename: 'filename',
  extension: 'extension',
});

const HISTORY_DISPLAY_LIMIT = 50;
const SAVE_ECHO_WINDOW_MS = 2500;

const state = {
  settings: createDefaultSettings(),
  stats: { total: 0, byRule: {}, lastAt: 0, today: 0, todayDate: '' },
  history: [],
  editingId: null,
  fallbackTimer: 0,
  saveRevision: 0,
  saveQueue: Promise.resolve(),
  lastLocalSaveAt: 0,
  dataRefreshTimer: 0,
  saveNoteTimer: 0,
  confirmResolve: null,
};

const els = {};

const ELEMENT_IDS = [
  'masterState',
  'masterToggle',
  'pausedBanner',
  'resumeBtn',
  'statRules',
  'statRulesMeta',
  'statTotal',
  'statToday',
  'ruleCount',
  'rulesList',
  'rulesEmpty',
  'addRuleBtn',
  'emptyAddBtn',
  'emptyExamplesBtn',
  'loadExamplesBtn',
  'testUrl',
  'testFilename',
  'sampleBtn',
  'testResult',
  'fallbackFolder',
  'fallbackError',
  'preserveSubdirs',
  'saveNote',
  'exportBtn',
  'importBtn',
  'resetSettingsBtn',
  'resetStatsBtn',
  'importFile',
  'refreshBtn',
  'clearHistoryBtn',
  'historyTableWrap',
  'historyBody',
  'historyEmpty',
  'ruleDialog',
  'ruleForm',
  'ruleDialogTitle',
  'ruleDialogSubtitle',
  'ruleName',
  'rulePatterns',
  'patternsLabel',
  'patternsHint',
  'patternsError',
  'modeField',
  'ruleMode',
  'caseField',
  'ruleCase',
  'domainOptions',
  'subdomainRow',
  'ruleSubdomains',
  'referrerRow',
  'ruleReferrer',
  'extensionChips',
  'ruleTarget',
  'targetError',
  'targetPreview',
  'confirmDialog',
  'confirmTitle',
  'confirmMessage',
  'confirmOk',
  'confirmCancel',
  'confirmClose',
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

function formatTime(timestamp) {
  const date = new Date(Number(timestamp));
  if (Number.isNaN(date.getTime())) return '—';

  const time = `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
  const key = localDateKey(date);
  if (key === localDateKey()) return `今天 ${time}`;

  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  if (key === localDateKey(yesterday)) return `昨天 ${time}`;

  if (date.getFullYear() === new Date().getFullYear()) {
    return `${date.getMonth() + 1}月${date.getDate()}日 ${time}`;
  }
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())} ${time}`;
}

async function init() {
  cacheElements();
  bindEvents();

  try {
    const [settings, stats, history] = await Promise.all([
      ensureSettings(),
      getStats(),
      getHistory(),
    ]);
    state.settings = settings;
    state.stats = stats;
    state.history = history;
    syncSettingsInputs();
    renderAll();

    if (location.hash === '#history') {
      requestAnimationFrame(() => {
        document
          .getElementById('historyHeading')
          ?.closest('.history-panel')
          ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    }
  } catch (error) {
    console.error('[LocationDL] Failed to initialize options page', error);
    showToast(`初始化失败：${error?.message || '无法读取本地设置'}`, 'error');
  }
}

function bindEvents() {
  els.masterToggle.addEventListener('change', handleMasterToggle);
  els.resumeBtn.addEventListener('click', () => {
    setEnabled(true);
    showToast('已恢复自动路由', 'success');
  });

  els.addRuleBtn.addEventListener('click', () => openRuleDialog());
  els.emptyAddBtn.addEventListener('click', () => openRuleDialog());
  els.emptyExamplesBtn.addEventListener('click', addExamples);
  els.loadExamplesBtn.addEventListener('click', addExamples);

  els.testUrl.addEventListener('input', renderTest);
  els.testFilename.addEventListener('input', renderTest);
  els.sampleBtn.addEventListener('click', fillSample);

  els.fallbackFolder.addEventListener('input', handleFallbackInput);
  els.fallbackFolder.addEventListener('blur', flushFallback);
  els.fallbackFolder.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      flushFallback();
      els.fallbackFolder.blur();
    }
  });
  els.preserveSubdirs.addEventListener('change', handlePreserveChange);

  els.exportBtn.addEventListener('click', exportSettings);
  els.importBtn.addEventListener('click', () => els.importFile.click());
  els.importFile.addEventListener('change', handleImportFile);
  els.resetSettingsBtn.addEventListener('click', handleResetSettings);
  els.resetStatsBtn.addEventListener('click', handleResetStats);

  els.refreshBtn.addEventListener('click', handleRefresh);
  els.clearHistoryBtn.addEventListener('click', handleClearHistory);
  els.rulesList.addEventListener('click', handleRuleListClick);
  els.rulesList.addEventListener('change', handleRuleListChange);
  els.historyBody.addEventListener('click', handleHistoryClick);

  els.ruleForm.addEventListener('submit', handleRuleSubmit);
  els.ruleForm.addEventListener('change', handleRuleFormChange);
  els.rulePatterns.addEventListener('input', () => {
    clearFieldError(els.rulePatterns, els.patternsError);
  });
  els.ruleTarget.addEventListener('input', () => {
    clearFieldError(els.ruleTarget, els.targetError);
    updateDialogPreview();
  });
  els.extensionChips.addEventListener('click', handleExtensionChip);
  els.ruleDialog.querySelectorAll('[data-close-dialog]').forEach((button) => {
    button.addEventListener('click', () => els.ruleDialog.close());
  });
  els.ruleDialog.addEventListener('click', (event) => {
    if (event.target === els.ruleDialog) els.ruleDialog.close();
  });
  els.ruleDialog.addEventListener('close', resetRuleDialogState);

  els.confirmOk.addEventListener('click', () => settleConfirm(true));
  els.confirmCancel.addEventListener('click', () => settleConfirm(false));
  els.confirmClose.addEventListener('click', () => settleConfirm(false));
  els.confirmDialog.addEventListener('cancel', (event) => {
    event.preventDefault();
    settleConfirm(false);
  });
  els.confirmDialog.addEventListener('click', (event) => {
    if (event.target === els.confirmDialog) settleConfirm(false);
  });
  els.confirmDialog.addEventListener('close', () => {
    if (!state.confirmResolve) return;
    const resolve = state.confirmResolve;
    state.confirmResolve = null;
    resolve(false);
  });

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) flushFallback();
  });
  window.addEventListener('pagehide', flushFallback);

  if (globalThis.chrome?.storage?.onChanged) {
    chrome.storage.onChanged.addListener(handleStorageChanged);
  }
}

function renderAll() {
  updateMasterUI();
  renderStats();
  renderRules();
  renderHistory();
  renderTest();
}

function updateMasterUI() {
  const enabled = state.settings.enabled !== false;
  document.body.classList.toggle('is-paused', !enabled);
  els.masterToggle.checked = enabled;
  els.masterState.textContent = enabled ? '运行中' : '已暂停';
  els.pausedBanner.hidden = enabled;
}

function syncSettingsInputs() {
  if (document.activeElement !== els.fallbackFolder) {
    els.fallbackFolder.value = state.settings.fallbackFolder || '';
  }
  els.preserveSubdirs.checked = state.settings.preserveSubdirs !== false;
  els.masterToggle.checked = state.settings.enabled !== false;
  clearFieldError(els.fallbackFolder, els.fallbackError);
}

function renderStats() {
  const rules = Array.isArray(state.settings.rules) ? state.settings.rules : [];
  const enabledCount = rules.filter((rule) => rule.enabled !== false).length;

  els.statRules.textContent = formatNumber(enabledCount);
  els.statRulesMeta.textContent = rules.length
    ? `共 ${formatNumber(rules.length)} 条规则`
    : '还没有规则';
  els.statTotal.textContent = formatNumber(state.stats.total || 0);

  const today = state.stats.todayDate === localDateKey() ? state.stats.today || 0 : 0;
  els.statToday.textContent = formatNumber(today);
}

function renderRules() {
  const rules = Array.isArray(state.settings.rules) ? state.settings.rules : [];
  els.ruleCount.textContent = String(rules.length);
  els.rulesList.hidden = rules.length === 0;
  els.rulesEmpty.hidden = rules.length > 0;

  if (!rules.length) {
    els.rulesList.innerHTML = '';
    return;
  }

  els.rulesList.innerHTML = rules
    .map((rule, index) => ruleCardMarkup(rule, index, rules.length))
    .join('');
}

function ruleCardMarkup(rule, index, total) {
  const type = RULE_TYPES.includes(rule.type) ? rule.type : 'filename';
  const typeLabel = TYPE_LABELS[type] || '规则';
  const typeIcon = TYPE_ICONS[type] || 'filename';
  const disabled = rule.enabled === false;
  const hits = Number(state.stats?.byRule?.[rule.id]) || 0;
  const target = String(rule.target || '');
  const summary = describeRule(rule);
  const name = rule.name || '未命名规则';
  const indexLabel = String(index + 1).padStart(2, '0');

  return `
    <article class="rule${disabled ? ' is-off' : ''}" data-id="${escapeHtml(rule.id)}">
      <div class="rule-index" aria-hidden="true">${indexLabel}</div>
      <div class="rule-main">
        <div class="rule-title">
          <h3 title="${escapeHtml(name)}">${escapeHtml(name)}</h3>
          <span class="badge ${type}">${icon(typeIcon)}${escapeHtml(typeLabel)}</span>
          ${hits ? `<span class="hits" title="累计命中次数">命中 ${formatNumber(hits)} 次</span>` : ''}
        </div>
        <p class="rule-summary" title="${escapeHtml(summary)}">${escapeHtml(summary)}</p>
        <div class="rule-target">
          ${icon('folder')}
          <span class="path" title="${escapeHtml(displayPath(target))}">${escapeHtml(displayPath(target))}</span>
        </div>
      </div>
      <div class="rule-side">
        <label class="switch" title="${disabled ? '启用此规则' : '暂停此规则'}">
          <input
            type="checkbox"
            data-action="toggle"
            aria-label="${disabled ? '启用' : '暂停'}规则 ${escapeHtml(name)}"
            ${disabled ? '' : 'checked'}
          >
          <span class="switch-track"></span>
        </label>
        <div class="rule-actions">
          <button type="button" class="icon-btn" data-action="up" title="上移" aria-label="上移规则 ${escapeHtml(name)}" ${index === 0 ? 'disabled' : ''}>
            ${icon('up')}
          </button>
          <button type="button" class="icon-btn" data-action="down" title="下移" aria-label="下移规则 ${escapeHtml(name)}" ${index === total - 1 ? 'disabled' : ''}>
            ${icon('down')}
          </button>
          <button type="button" class="icon-btn" data-action="edit" title="编辑" aria-label="编辑规则 ${escapeHtml(name)}">
            ${icon('edit')}
          </button>
          <button type="button" class="icon-btn danger" data-action="delete" title="删除" aria-label="删除规则 ${escapeHtml(name)}">
            ${icon('trash')}
          </button>
        </div>
      </div>
    </article>
  `;
}

function renderHistory() {
  const rows = (Array.isArray(state.history) ? state.history : []).slice(
    0,
    HISTORY_DISPLAY_LIMIT,
  );

  els.historyTableWrap.hidden = rows.length === 0;
  els.historyEmpty.hidden = rows.length > 0;

  els.historyBody.innerHTML = rows
    .map((entry) => {
      const ruleName = entry.ruleName || (entry.source === 'fallback' ? '回退文件夹' : '规则');
      const fallbackClass = entry.source === 'fallback' ? ' fallback' : '';
      const file = entry.base || '下载文件';
      const host = entry.host || entry.url || '';
      const path = displayPath(entry.path || '');
      const canShow = entry.id !== null && entry.id !== undefined;

      return `
        <tr>
          <td class="history-time">${escapeHtml(formatTime(entry.ts))}</td>
          <td>
            <div class="history-file" title="${escapeHtml(file)}">${escapeHtml(file)}</div>
            <div class="history-sub" title="${escapeHtml(host)}">${escapeHtml(host)}</div>
          </td>
          <td>
            <span class="history-rule${fallbackClass}" title="${escapeHtml(ruleName)}">${escapeHtml(ruleName)}</span>
          </td>
          <td>
            <span class="history-path" title="${escapeHtml(path)}">${escapeHtml(path)}</span>
          </td>
          <td class="history-action">
            ${
              canShow
                ? `<button type="button" class="icon-btn" data-show-download="${escapeHtml(String(entry.id))}" title="在文件夹中显示" aria-label="在文件夹中显示 ${escapeHtml(file)}">${icon('folder')}</button>`
                : ''
            }
          </td>
        </tr>
      `;
    })
    .join('');
}

function renderTest() {
  const url = els.testUrl.value.trim();
  const typedFilename = els.testFilename.value.trim();
  const guessedFilename = typedFilename ? '' : filenameFromUrl(url);
  const filename = typedFilename || guessedFilename;

  if (!url && !filename) {
    setTestResult(
      'neutral',
      '等待输入',
      '输入 URL 或文件名后，会自动显示命中的规则和目标位置。',
    );
    return;
  }

  const previewSettings = {
    ...state.settings,
    fallbackFolder: els.fallbackFolder.value.trim(),
  };

  if (previewSettings.enabled === false) {
    setTestResult(
      'disabled',
      '自动路由已暂停',
      '顶部总开关当前为关闭状态，规则不会生效。',
      '',
      '开启总开关后，规则会立即恢复。',
    );
    return;
  }

  const info = buildMatchInfo({ url, filename });
  const result = matchRules(previewSettings, info);

  if (result.source === 'rule') {
    const path = buildSuggestedFilename({
      filename: info.base,
      folder: result.folder,
      relativeDir: info.relativeDir,
      preserveSubdirs: previewSettings.preserveSubdirs,
    });
    setTestResult(
      'hit',
      `命中规则：${result.ruleName}`,
      describeRule(result.rule),
      path,
      '规则按顺序匹配，第一条命中的规则生效。',
    );
    return;
  }

  if (result.source === 'fallback') {
    const path = buildSuggestedFilename({
      filename: info.base,
      folder: result.folder,
      relativeDir: info.relativeDir,
      preserveSubdirs: previewSettings.preserveSubdirs,
    });
    setTestResult(
      'fallback',
      '未命中规则，使用回退文件夹',
      '没有规则匹配这次下载，将使用全局回退文件夹。',
      path,
      '可以在“全局设置”中修改回退位置。',
    );
    return;
  }

  setTestResult(
    'neutral',
    '未命中规则',
    '文件将保存到 Chrome 默认下载位置。',
    '',
    '在全局设置中填写回退文件夹，可自动归类未命中的下载。',
  );
}

function setTestResult(variant, title, message, path = '', hint = '') {
  const resultIcon =
    variant === 'hit'
      ? 'check'
      : variant === 'fallback'
        ? 'folder'
        : variant === 'disabled'
          ? 'pause'
          : 'info';

  els.testResult.className = `test-result ${variant}`;
  els.testResult.innerHTML = `
    <div class="result-title">${icon(resultIcon)}${escapeHtml(title)}</div>
    <p>${escapeHtml(message)}</p>
    ${path ? `<span class="result-path">${escapeHtml(displayPath(path))}</span>` : ''}
    ${hint ? `<p class="result-hint">${escapeHtml(hint)}</p>` : ''}
  `;
}

function filenameFromUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  try {
    const url = new URL(raw);
    const last = url.pathname.split('/').filter(Boolean).pop() || '';
    const decoded = decodeURIComponent(last);
    return decoded && decoded !== '.' && decoded !== '..' ? decoded : '';
  } catch {
    return '';
  }
}

function fillSample() {
  els.testUrl.value =
    'https://github.com/cli/cli/releases/download/v2.40.0/gh_2.40.0_windows_amd64.zip';
  els.testFilename.value = 'gh_2.40.0_windows_amd64.zip';
  renderTest();
}

function setSaveNote(kind) {
  clearTimeout(state.saveNoteTimer);
  const labels = {
    idle: '设置会自动保存',
    saving: '正在保存…',
    saved: '设置已保存',
    error: '保存失败，请重试',
  };

  els.saveNote.textContent = labels[kind] || labels.idle;
  els.saveNote.classList.toggle('saved', kind === 'saved');
  els.saveNote.classList.toggle('danger-text', kind === 'error');

  if (kind === 'saved' || kind === 'error') {
    state.saveNoteTimer = setTimeout(() => setSaveNote('idle'), 2600);
  }
}

function persistSettings() {
  const revision = ++state.saveRevision;
  const snapshot = normalizeSettings(state.settings);
  state.settings = snapshot;
  setSaveNote('saving');

  state.saveQueue = state.saveQueue.then(async () => {
    // A newer edit superseded this snapshot before it reached the disk.
    if (revision !== state.saveRevision) return;

    state.lastLocalSaveAt = Date.now();
    try {
      await saveSettings(snapshot);
      if (revision === state.saveRevision) {
        state.lastLocalSaveAt = Date.now();
        setSaveNote('saved');
      }
    } catch (error) {
      console.error('[LocationDL] Failed to save settings', error);
      if (revision === state.saveRevision) setSaveNote('error');
      showToast(`保存失败：${error?.message || '未知错误'}`, 'error');
    }
  });

  return state.saveQueue;
}

function handleMasterToggle() {
  const enabled = els.masterToggle.checked;
  setEnabled(enabled);
  showToast(
    enabled ? '自动路由已开启' : '自动路由已暂停',
    enabled ? 'success' : 'info',
  );
}

function setEnabled(enabled) {
  state.settings.enabled = Boolean(enabled);
  updateMasterUI();
  renderTest();
  persistSettings();
}

function handlePreserveChange() {
  state.settings.preserveSubdirs = els.preserveSubdirs.checked;
  persistSettings();
  renderTest();
}

function handleFallbackInput() {
  clearTimeout(state.fallbackTimer);
  clearFieldError(els.fallbackFolder, els.fallbackError);
  state.fallbackTimer = setTimeout(flushFallback, 500);
  renderTest();
}

function flushFallback() {
  clearTimeout(state.fallbackTimer);
  const raw = els.fallbackFolder.value.trim();

  if (!raw) {
    clearFieldError(els.fallbackFolder, els.fallbackError);
    if (state.settings.fallbackFolder) {
      state.settings.fallbackFolder = '';
      persistSettings();
    }
    renderTest();
    return;
  }

  const result = validateTargetFolder(raw);
  if (!result.ok) {
    showFieldError(els.fallbackFolder, els.fallbackError, result.error);
    renderTest();
    return;
  }

  clearFieldError(els.fallbackFolder, els.fallbackError);
  const normalized = result.normalized;

  if (document.activeElement !== els.fallbackFolder && els.fallbackFolder.value !== normalized) {
    els.fallbackFolder.value = normalized;
  }

  if (state.settings.fallbackFolder !== normalized) {
    state.settings.fallbackFolder = normalized;
    persistSettings();
  }
  renderTest();
}

async function refreshData() {
  const [stats, history] = await Promise.all([getStats(), getHistory()]);
  state.stats = stats;
  state.history = history;
  renderStats();
  renderRules();
  renderHistory();
  renderTest();
}

async function refreshAll() {
  const [settings, stats, history] = await Promise.all([
    getSettings(),
    getStats(),
    getHistory(),
  ]);
  state.settings = settings;
  state.stats = stats;
  state.history = history;
  syncSettingsInputs();
  renderAll();
}

async function handleRefresh() {
  els.refreshBtn.disabled = true;
  try {
    await refreshAll();
    showToast('已刷新', 'success');
  } catch (error) {
    console.error('[LocationDL] Refresh failed', error);
    showToast(`刷新失败：${error?.message || '未知错误'}`, 'error');
  } finally {
    els.refreshBtn.disabled = false;
  }
}

function handleStorageChanged(changes, areaName) {
  if (areaName !== 'local') return;

  if (changes.settings && Date.now() - state.lastLocalSaveAt > SAVE_ECHO_WINDOW_MS) {
    getSettings()
      .then((settings) => {
        state.settings = settings;
        syncSettingsInputs();
        renderAll();
      })
      .catch((error) => {
        console.error('[LocationDL] Failed to reload settings', error);
      });
  }

  if (changes.stats || changes.history) {
    clearTimeout(state.dataRefreshTimer);
    state.dataRefreshTimer = setTimeout(() => {
      refreshData().catch((error) => {
        console.error('[LocationDL] Failed to refresh download data', error);
      });
    }, 160);
  }
}

function handleRuleListClick(event) {
  const button = event.target.closest('button[data-action]');
  if (!button) return;
  const card = button.closest('.rule');
  if (!card) return;

  const id = card.dataset.id;
  const action = button.dataset.action;
  if (action === 'up') moveRule(id, -1);
  else if (action === 'down') moveRule(id, 1);
  else if (action === 'edit') {
    const rule = state.settings.rules.find((item) => item.id === id);
    if (rule) openRuleDialog(rule);
  } else if (action === 'delete') deleteRule(id);
}

function handleRuleListChange(event) {
  const input = event.target.closest('input[data-action="toggle"]');
  if (!input) return;
  const card = input.closest('.rule');
  if (!card) return;
  toggleRule(card.dataset.id, input.checked);
}

function toggleRule(id, enabled) {
  const rule = state.settings.rules.find((item) => item.id === id);
  if (!rule) return;
  rule.enabled = Boolean(enabled);
  persistSettings();
  renderRules();
  renderStats();
  renderTest();
}

function moveRule(id, direction) {
  const rules = state.settings.rules;
  const index = rules.findIndex((item) => item.id === id);
  if (index < 0) return;

  const nextIndex = index + direction;
  if (nextIndex < 0 || nextIndex >= rules.length) return;

  const [rule] = rules.splice(index, 1);
  rules.splice(nextIndex, 0, rule);
  persistSettings();
  renderRules();
  renderTest();
}

function deleteRule(id) {
  const rules = state.settings.rules;
  const index = rules.findIndex((item) => item.id === id);
  if (index < 0) return;

  const [removed] = rules.splice(index, 1);
  persistSettings();
  renderAll();

  showToast(`已删除规则「${removed.name || '未命名规则'}」`, 'info', {
    label: '撤销',
    onClick: () => {
      const currentRules = state.settings.rules;
      if (currentRules.some((item) => item.id === removed.id)) return;
      currentRules.splice(Math.min(index, currentRules.length), 0, removed);
      persistSettings();
      renderAll();
      showToast('已恢复规则', 'success');
    },
  });
}

function addExamples() {
  const rules = state.settings.rules;
  const existingIds = new Set(rules.map((rule) => rule.id));
  const additions = EXAMPLE_RULES.map((rule) =>
    normalizeRule({ ...rule, patterns: [...rule.patterns] }),
  ).filter((rule) => rule && !existingIds.has(rule.id));

  if (!additions.length) {
    showToast('示例规则已经在列表中', 'info');
    return;
  }

  rules.push(...additions);
  persistSettings();
  renderAll();
  showToast(`已载入 ${additions.length} 条示例规则（默认关闭）`, 'success');
}

function openRuleDialog(rule = null) {
  state.editingId = rule?.id || null;

  els.ruleDialogTitle.textContent = rule ? '编辑规则' : '添加规则';
  els.ruleDialogSubtitle.textContent = rule
    ? '修改后立即生效；规则顺序不变。'
    : '新规则会添加到列表顶部，可用 ↑ ↓ 调整优先级。';

  els.ruleForm.reset();

  const type = RULE_TYPES.includes(rule?.type) ? rule.type : 'domain';
  const radio = els.ruleForm.querySelector(`input[name="ruleType"][value="${type}"]`);
  if (radio) radio.checked = true;

  els.ruleName.value = rule?.name || '';
  els.rulePatterns.value = rule ? patternsToText(rule.patterns) : '';
  els.ruleTarget.value = rule?.target || '';
  els.ruleSubdomains.checked = rule ? rule.subdomains !== false : true;
  els.ruleReferrer.checked = rule ? rule.includeReferrer === true : false;
  els.ruleCase.checked = rule ? rule.caseSensitive === true : false;

  updateDialogType(type, rule?.matchMode || null);
  clearRuleErrors();
  updateDialogPreview();

  if (!els.ruleDialog.open) els.ruleDialog.showModal();
  requestAnimationFrame(() => {
    (rule ? els.ruleName : els.rulePatterns).focus();
  });
}

function resetRuleDialogState() {
  state.editingId = null;
  clearRuleErrors();
}

function getSelectedType() {
  const checked = els.ruleForm.querySelector('input[name="ruleType"]:checked');
  return checked ? checked.value : 'domain';
}

function updateDialogType(type, selectedMode = null) {
  const safeType = RULE_TYPES.includes(type) ? type : 'domain';
  const isDomain = safeType === 'domain';
  const isFilename = safeType === 'filename';
  const isExtension = safeType === 'extension';

  els.domainOptions.hidden = !isDomain;
  els.extensionChips.hidden = !isExtension;
  els.caseField.hidden = !isFilename;
  els.modeField.hidden = isExtension;

  if (isExtension) {
    els.ruleMode.innerHTML = '';
  } else {
    populateModes(safeType, selectedMode);
  }

  updatePatternGuidance(safeType, els.ruleMode.value);
  clearRuleErrors();
  updateDialogPreview();
}

function populateModes(type, selectedMode) {
  const modes =
    type === 'domain' ? DOMAIN_MODES : type === 'filename' ? FILENAME_MODES : [];
  els.ruleMode.innerHTML = modes
    .map((mode) => `<option value="${mode}">${escapeHtml(MODE_LABELS[mode] || mode)}</option>`)
    .join('');

  if (selectedMode && modes.includes(selectedMode)) {
    els.ruleMode.value = selectedMode;
  }
}

function updatePatternGuidance(type, mode) {
  const guidance = {
    'domain:host': {
      label: '匹配的域名',
      hint: '每行一个域名，例如 example.com；也可以直接粘贴完整 URL。',
      placeholder: 'example.com\ngithub.com',
    },
    'domain:contains': {
      label: 'URL 包含',
      hint: '每行一个片段，匹配完整 URL 或主机名；不区分大小写。',
      placeholder: 'github.com\ncdn.example.com/files',
    },
    'domain:wildcard': {
      label: 'URL 通配符',
      hint: '支持 * 和 ?，匹配完整 URL 或主机名。例如 *.example.com/*',
      placeholder: '*.example.com/*\ncdn.*.com/*.zip',
    },
    'domain:regex': {
      label: 'URL 正则',
      hint: '每行一个正则表达式，可用 /pattern/i 形式；匹配完整 URL 或主机名。',
      placeholder: '^https://cdn\\.example\\.com/',
    },
    'filename:contains': {
      label: '文件名关键词',
      hint: '每行一个关键词，文件名包含任意一个即命中。',
      placeholder: 'invoice\nreport\n发票',
    },
    'filename:startswith': {
      label: '文件名开头',
      hint: '每行一个前缀，文件名以任意一个开头即命中。',
      placeholder: '2024-\nIMG_',
    },
    'filename:endswith': {
      label: '文件名结尾',
      hint: '每行一个后缀，文件名以任意一个结尾即命中。',
      placeholder: '.pdf\n_final.docx',
    },
    'filename:wildcard': {
      label: '文件名通配符',
      hint: '支持 * 和 ?，例如 *.pdf、report-*.xlsx。',
      placeholder: '*.pdf\nreport-*.xlsx',
    },
    'filename:regex': {
      label: '文件名正则',
      hint: '每行一个正则表达式，可用 /pattern/i 形式。',
      placeholder: '^\\d{4}-\\d{2}-\\d{2}.*\\.pdf$',
    },
    extension: {
      label: '扩展名',
      hint: '每行一个扩展名，也可用逗号分隔；不需要输入点。',
      placeholder: 'pdf, epub, mobi',
    },
  };

  const key = type === 'extension' ? 'extension' : `${type}:${mode}`;
  const item = guidance[key] || guidance['filename:contains'];

  els.patternsLabel.textContent = item.label;
  els.patternsHint.textContent = item.hint;
  els.rulePatterns.placeholder = item.placeholder;
}

function updateDialogPreview() {
  const raw = els.ruleTarget.value.trim();
  if (!raw) {
    els.targetPreview.textContent = '填写文件夹后显示预览';
    return;
  }

  const url = els.testUrl.value.trim() || 'https://example.com/files/sample.pdf';
  const filename = els.testFilename.value.trim() || 'sample.pdf';
  const info = buildMatchInfo({ url, filename });
  const folder = renderTarget(raw, info);

  if (!folder) {
    els.targetPreview.textContent = '路径无效：只能填写“下载”目录下的子文件夹';
    return;
  }

  els.targetPreview.innerHTML = `<span class="preview-label">预览：</span>${escapeHtml(displayPath(folder))}`;
}

function handleRuleFormChange(event) {
  const target = event.target;

  if (target.name === 'ruleType') {
    updateDialogType(target.value);
    return;
  }

  if (target.id === 'ruleMode') {
    updatePatternGuidance(getSelectedType(), target.value);
    clearFieldError(els.rulePatterns, els.patternsError);
  }
}

function handleExtensionChip(event) {
  const button = event.target.closest('button[data-ext]');
  if (!button) return;

  const extension = button.dataset.ext;
  const current = normalizePatterns(els.rulePatterns.value, { type: 'extension' });
  if (!current.includes(extension)) {
    current.push(extension);
    els.rulePatterns.value = current.join('\n');
  }

  clearFieldError(els.rulePatterns, els.patternsError);
  els.rulePatterns.focus();
}

function handleRuleSubmit(event) {
  event.preventDefault();

  const type = getSelectedType();
  const draft = {
    type,
    name: els.ruleName.value,
    patterns: els.rulePatterns.value,
    target: els.ruleTarget.value,
    matchMode: type === 'extension' ? '' : els.ruleMode.value,
    subdomains: els.ruleSubdomains.checked,
    includeReferrer: els.ruleReferrer.checked,
    caseSensitive: els.ruleCase.checked,
  };

  const errors = validateRuleDraft(draft);
  clearRuleErrors();

  if (errors.patterns) showFieldError(els.rulePatterns, els.patternsError, errors.patterns);
  if (errors.target) showFieldError(els.ruleTarget, els.targetError, errors.target);
  if (errors.type) showToast(errors.type, 'error');

  if (Object.keys(errors).length) {
    if (errors.patterns) els.rulePatterns.focus();
    else if (errors.target) els.ruleTarget.focus();
    return;
  }

  const targetCheck = validateTargetFolder(draft.target);
  const existingIndex = state.settings.rules.findIndex(
    (rule) => rule.id === state.editingId,
  );
  const existing = existingIndex >= 0 ? state.settings.rules[existingIndex] : null;

  const normalized = normalizeRule({
    ...draft,
    target: targetCheck.ok ? targetCheck.normalized : draft.target,
    id: existing?.id || uid(),
    enabled: existing ? existing.enabled : true,
  });

  if (!normalized) {
    showToast('规则保存失败，请检查填写内容', 'error');
    return;
  }

  if (existing) {
    state.settings.rules.splice(existingIndex, 1, normalized);
  } else {
    state.settings.rules.unshift(normalized);
  }

  persistSettings();
  renderAll();
  els.ruleDialog.close();
  showToast(existing ? '规则已更新' : '规则已添加', 'success');
}

function clearRuleErrors() {
  clearFieldError(els.rulePatterns, els.patternsError);
  clearFieldError(els.ruleTarget, els.targetError);
}

function showFieldError(input, errorElement, message) {
  errorElement.textContent = message;
  errorElement.hidden = false;
  input.setAttribute('aria-invalid', 'true');
}

function clearFieldError(input, errorElement) {
  errorElement.textContent = '';
  errorElement.hidden = true;
  input.removeAttribute('aria-invalid');
}

async function exportSettings() {
  const payload = {
    app: 'LocationDL',
    version: STORAGE_VERSION,
    exportedAt: new Date().toISOString(),
    settings: state.settings,
  };
  const json = JSON.stringify(payload, null, 2);
  const filename = `locationdl-settings-${localDateKey()}.json`;

  if (typeof globalThis.showSaveFilePicker === 'function') {
    try {
      const handle = await globalThis.showSaveFilePicker({
        suggestedName: filename,
        types: [
          {
            description: 'LocationDL JSON 配置',
            accept: { 'application/json': ['.json'] },
          },
        ],
      });
      const writable = await handle.createWritable();
      await writable.write(json);
      await writable.close();
      showToast('配置已导出', 'success');
      return;
    } catch (error) {
      if (error?.name === 'AbortError') return;
      console.warn('[LocationDL] Save picker failed, using download fallback', error);
    }
  }

  const blob = new Blob([json], { type: 'application/json' });
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = objectUrl;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(objectUrl), 2000);
  showToast('配置已导出', 'success');
}

async function handleImportFile(event) {
  const file = event.target.files?.[0] || null;
  event.target.value = '';
  if (!file) return;

  try {
    if (file.size > 2 * 1024 * 1024) {
      throw new Error('文件过大（最大 2 MB）');
    }

    const text = await file.text();
    const parsed = JSON.parse(text);
    const raw =
      parsed && typeof parsed === 'object' && parsed.settings ? parsed.settings : parsed;

    if (!raw || typeof raw !== 'object' || !Array.isArray(raw.rules)) {
      throw new Error('不是有效的 LocationDL 配置文件');
    }

    const imported = normalizeSettings(raw);
    const ok = await confirmAction({
      title: '导入配置',
      message: `将用导入的 ${imported.rules.length} 条规则覆盖当前所有设置。此操作无法撤销。`,
      okLabel: '导入并覆盖',
    });
    if (!ok) return;

    state.settings = imported;
    await persistSettings();
    syncSettingsInputs();
    renderAll();
    showToast('配置已导入', 'success');
  } catch (error) {
    const message =
      error instanceof SyntaxError ? '文件不是有效的 JSON' : error?.message || '文件格式不正确';
    showToast(`导入失败：${message}`, 'error');
  }
}

async function handleResetSettings() {
  const ok = await confirmAction({
    title: '恢复默认设置',
    message:
      '将恢复示例规则（默认关闭）、清空回退文件夹并重新开启自动路由。统计和历史记录不会受影响。',
    okLabel: '恢复默认',
  });
  if (!ok) return;

  state.settings = createDefaultSettings();
  await persistSettings();
  syncSettingsInputs();
  renderAll();
  showToast('已恢复默认设置', 'success');
}

async function handleResetStats() {
  const ok = await confirmAction({
    title: '重置统计',
    message:
      '累计路由次数、今日次数和每条规则的命中次数将归零。历史记录不会受影响。',
    okLabel: '重置统计',
  });
  if (!ok) return;

  try {
    await resetStats();
    await refreshData();
    showToast('统计已重置', 'success');
  } catch (error) {
    console.error('[LocationDL] Failed to reset stats', error);
    showToast(`重置失败：${error?.message || '未知错误'}`, 'error');
  }
}

async function handleClearHistory() {
  const ok = await confirmAction({
    title: '清空历史',
    message: '最近路由记录将被清空，统计数字不会改变。',
    okLabel: '清空历史',
  });
  if (!ok) return;

  try {
    await clearHistory();
    await refreshData();
    showToast('历史记录已清空', 'success');
  } catch (error) {
    console.error('[LocationDL] Failed to clear history', error);
    showToast(`清空失败：${error?.message || '未知错误'}`, 'error');
  }
}

function handleHistoryClick(event) {
  const button = event.target.closest('button[data-show-download]');
  if (!button) return;
  showDownload(button.dataset.showDownload);
}

async function showDownload(id) {
  const downloadId = Number(id);
  if (!Number.isFinite(downloadId)) return;

  try {
    await new Promise((resolve, reject) => {
      const downloads = globalThis.chrome?.downloads;
      if (!downloads) {
        reject(new Error('Downloads API unavailable'));
        return;
      }

      const done = () => {
        const error = globalThis.chrome?.runtime?.lastError;
        if (error) reject(new Error(error.message));
        else resolve();
      };

      try {
        if (typeof downloads.show === 'function') {
          downloads.show(downloadId, done);
        } else if (typeof downloads.showDefaultFolder === 'function') {
          downloads.showDefaultFolder(done);
        } else {
          reject(new Error('Downloads API unavailable'));
        }
      } catch (error) {
        reject(error);
      }
    });
  } catch (error) {
    console.warn('[LocationDL] Could not reveal download', error);
    showToast('无法定位文件，可能已被移动或删除', 'error');
  }
}

function confirmAction({ title = '确认操作', message = '', okLabel = '确定' } = {}) {
  if (state.confirmResolve) {
    const previous = state.confirmResolve;
    state.confirmResolve = null;
    previous(false);
  }

  els.confirmTitle.textContent = title;
  els.confirmMessage.textContent = message;
  els.confirmOk.textContent = okLabel;

  if (!els.confirmDialog.open) els.confirmDialog.showModal();

  return new Promise((resolve) => {
    state.confirmResolve = resolve;
  });
}

function settleConfirm(value) {
  const resolve = state.confirmResolve;
  state.confirmResolve = null;
  if (els.confirmDialog.open) els.confirmDialog.close();
  if (resolve) resolve(value);
}

function showToast(message, type = 'info', action = null) {
  if (!els.toastHost) return;

  while (els.toastHost.children.length >= 4) {
    els.toastHost.firstElementChild.remove();
  }

  const toast = document.createElement('div');
  toast.className = `toast${type && type !== 'info' ? ` ${type}` : ''}`;

  const text = document.createElement('span');
  text.className = 'toast-message';
  text.textContent = message;
  toast.append(text);

  let timer = 0;
  const dismiss = () => {
    clearTimeout(timer);
    if (toast.classList.contains('is-leaving')) return;
    toast.classList.add('is-leaving');
    setTimeout(() => toast.remove(), 180);
  };

  if (action && action.label) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'toast-action';
    button.textContent = action.label;
    button.addEventListener('click', () => {
      dismiss();
      try {
        const result = action.onClick?.();
        if (result && typeof result.catch === 'function') {
          result.catch((error) => console.error('[LocationDL] Toast action failed', error));
        }
      } catch (error) {
        console.error('[LocationDL] Toast action failed', error);
      }
    });
    toast.append(button);
  }

  els.toastHost.append(toast);
  timer = setTimeout(dismiss, action ? 8000 : 4200);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init, { once: true });
} else {
  init();
}
