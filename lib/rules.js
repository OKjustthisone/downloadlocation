/**
 * LocationDL rule engine.
 *
 * This module is deliberately free of Chrome APIs so it can be unit-tested in
 * Node.js and reused by the service worker, options page and popup.
 */

export const STORAGE_VERSION = 1;

export const RULE_TYPES = Object.freeze(['domain', 'filename', 'extension']);
export const DOMAIN_MODES = Object.freeze(['host', 'contains', 'wildcard', 'regex']);
export const FILENAME_MODES = Object.freeze(['contains', 'startswith', 'endswith', 'wildcard', 'regex']);

export const TYPE_LABELS = Object.freeze({
  domain: '域名 / URL',
  filename: '文件名',
  extension: '扩展名',
});

export const MODE_LABELS = Object.freeze({
  host: '域名',
  contains: '包含',
  startswith: '开头是',
  endswith: '结尾是',
  wildcard: '通配符',
  regex: '正则表达式',
});

/** Rules shipped with the extension. They are examples and start disabled. */
export const EXAMPLE_RULES = Object.freeze([
  {
    id: 'example-domain-github',
    name: 'GitHub 下载',
    type: 'domain',
    enabled: false,
    patterns: ['github.com'],
    matchMode: 'host',
    subdomains: true,
    includeReferrer: true,
    target: 'Code/GitHub',
  },
  {
    id: 'example-filename-invoice',
    name: '发票与收据',
    type: 'filename',
    enabled: false,
    patterns: ['invoice', 'receipt', '发票', '收据'],
    matchMode: 'contains',
    caseSensitive: false,
    target: 'Finance/{year}',
  },
  {
    id: 'example-extension-ebooks',
    name: '文档与电子书',
    type: 'extension',
    enabled: false,
    patterns: ['pdf', 'epub', 'mobi', 'azw3'],
    target: 'Documents/Books',
  },
]);

const RESERVED_SEGMENT = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i;
const INVALID_PATH_CHARS = /[\u0000-\u001f\u007f<>:"/\\|?*]/g;

function cleanText(value, maxLength) {
  if (typeof value !== 'string') return '';
  return value.trim().slice(0, maxLength);
}

/** Generate a stable-enough unique id for a new rule. */
export function uid() {
  const cryptoApi = globalThis.crypto;
  if (cryptoApi && typeof cryptoApi.randomUUID === 'function') {
    return cryptoApi.randomUUID();
  }
  return `rule-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function createDefaultSettings() {
  return {
    version: STORAGE_VERSION,
    enabled: true,
    fallbackFolder: '',
    preserveSubdirs: true,
    rules: EXAMPLE_RULES.map((rule) => ({
      ...rule,
      patterns: [...rule.patterns],
    })),
  };
}

/** Split pasted patterns. Regexes may contain commas, so they only split on newlines. */
function splitPatternText(text, { allowComma }) {
  const separator = allowComma ? /[\r\n,，;；]+/ : /[\r\n]+/;
  return String(text ?? '').split(separator);
}

/**
 * Normalize a pattern list or a raw textarea value.
 *
 * @param {string|string[]|undefined|null} value
 * @param {{type?: string, mode?: string}} [options]
 * @returns {string[]}
 */
export function normalizePatterns(value, options = {}) {
  const type = options.type || 'filename';
  const mode = options.mode || 'contains';
  let parts;
  if (Array.isArray(value)) {
    parts = value;
  } else {
    parts = splitPatternText(value, {
      allowComma: type === 'extension' || mode !== 'regex',
    });
  }

  const result = [];
  const seen = new Set();
  for (const part of parts) {
    let pattern = String(part ?? '').trim();
    if (!pattern) continue;

    if (type === 'extension') {
      pattern = pattern
        .toLowerCase()
        .replace(/^[.*\s]+/, '')
        .replace(/[.\s]+$/, '');
      if (!pattern || /[\s\\/:*?"<>|]/.test(pattern)) continue;
    }

    if (!seen.has(pattern)) {
      seen.add(pattern);
      result.push(pattern);
    }
    if (result.length >= 100) break;
  }
  return result;
}

export function patternsToText(patterns) {
  return Array.isArray(patterns) ? patterns.join('\n') : '';
}

export function defaultRuleName(type, patterns = []) {
  const first = patterns[0] || '';
  if (type === 'domain') return first ? `来自 ${first}` : '域名规则';
  if (type === 'filename') return first ? `文件名含「${first}」` : '文件名规则';
  if (type === 'extension') return first ? `.${first} 文件` : '扩展名规则';
  return '未命名规则';
}

/**
 * Normalize one stored rule, filling defaults and coercing field types.
 * Invalid rule types are dropped by returning null.
 *
 * @param {any} raw
 * @returns {object|null}
 */
export function normalizeRule(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const type = RULE_TYPES.includes(raw.type) ? raw.type : null;
  if (!type) return null;

  let matchMode;
  if (type === 'domain') {
    matchMode = DOMAIN_MODES.includes(raw.matchMode) ? raw.matchMode : 'host';
  } else if (type === 'filename') {
    matchMode = FILENAME_MODES.includes(raw.matchMode) ? raw.matchMode : 'contains';
  } else {
    matchMode = '';
  }

  const patterns = normalizePatterns(raw.patterns, { type, mode: matchMode });
  const name = cleanText(raw.name, 80) || defaultRuleName(type, patterns);

  return {
    id: cleanText(raw.id, 80) || uid(),
    name,
    type,
    enabled: raw.enabled !== false,
    patterns,
    target: cleanText(raw.target, 240),
    matchMode,
    subdomains: type === 'domain' ? raw.subdomains !== false : false,
    includeReferrer: type === 'domain' ? raw.includeReferrer === true : false,
    caseSensitive: type === 'filename' ? raw.caseSensitive === true : false,
  };
}

/**
 * Normalize a complete settings object. Unknown fields are dropped and
 * missing fields receive safe defaults.
 *
 * @param {any} raw
 * @returns {{version:number, enabled:boolean, fallbackFolder:string, preserveSubdirs:boolean, rules:object[]}}
 */
export function normalizeSettings(raw) {
  if (!raw || typeof raw !== 'object') return createDefaultSettings();

  const fallback = createDefaultSettings();
  const rules = Array.isArray(raw.rules)
    ? raw.rules.map(normalizeRule).filter(Boolean)
    : fallback.rules;

  return {
    version: STORAGE_VERSION,
    enabled: raw.enabled !== false,
    fallbackFolder: cleanText(raw.fallbackFolder, 240),
    preserveSubdirs: raw.preserveSubdirs !== false,
    rules,
  };
}

function isAbsolutePath(path) {
  return /^[a-zA-Z]:[\\/]/.test(path) || path.startsWith('/') || path.startsWith('\\');
}

/** Sanitize one folder segment for Windows/macOS/Linux. */
export function sanitizeSegment(value) {
  let segment = String(value ?? '')
    .replace(INVALID_PATH_CHARS, '_')
    .replace(/^[\s.]+|[\s.]+$/g, '');

  if (!segment || segment === '.' || segment === '..') return '';
  if (RESERVED_SEGMENT.test(segment)) segment = `_${segment}`;
  if (segment.length > 120) {
    segment = segment.slice(0, 120).replace(/[\s.]+$/g, '');
  }
  return segment;
}

/**
 * Turn arbitrary user input into a safe path relative to the Downloads folder.
 * Absolute paths and paths containing ".." are rejected (returned as "").
 */
export function sanitizeFolderPath(value) {
  let path = String(value ?? '').trim().replace(/\\/g, '/');
  if (!path || isAbsolutePath(path) || /^[a-zA-Z]:/.test(path)) return '';

  const rawSegments = path.split('/');
  if (rawSegments.some((segment) => segment.trim() === '..')) return '';

  const segments = [];
  for (const rawSegment of rawSegments) {
    if (!rawSegment || rawSegment.trim() === '.') continue;
    const segment = sanitizeSegment(rawSegment);
    if (segment) segments.push(segment);
  }
  return segments.join('/');
}

/** Keep the file name intact as much as possible, only removing path separators
 * and characters that are invalid on the target file system. */
export function sanitizeFilename(value) {
  let filename = String(value ?? '')
    .replace(INVALID_PATH_CHARS, '_')
    .replace(/[. ]+$/g, '');

  if (!filename || filename === '.' || filename === '..') filename = 'download';
  if (RESERVED_SEGMENT.test(filename)) filename = `_${filename}`;
  return filename;
}

/**
 * Split a tentative download filename into a basename and a relative directory.
 * Absolute paths are reduced to their basename because Chrome only lets an
 * extension suggest paths relative to the Downloads folder.
 */
export function splitFilenamePath(value) {
  let path = String(value ?? '').trim().replace(/\\/g, '/');
  if (!path) return { base: 'download', relativeDir: '' };

  const absolute = isAbsolutePath(path);
  const segments = path.split('/').filter(Boolean);
  let base = segments.pop() || '';
  if (base === '.' || base === '..') base = '';

  const relativeDir = absolute
    ? ''
    : segments.filter((segment) => segment !== '.' && segment !== '..').join('/');

  return { base: base || 'download', relativeDir };
}

/** Return the lowercase extension without the dot (supports archive.tar.gz -> gz). */
export function extensionOf(filename) {
  const base = String(filename ?? '').split(/[\\/]/).pop() || '';
  const dot = base.lastIndexOf('.');
  if (dot <= 0 || dot === base.length - 1) return '';
  return base.slice(dot + 1).toLowerCase();
}

/** Extract a hostname from a URL, including the origin embedded in blob: URLs. */
export function hostnameFromUrl(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  try {
    const url = new URL(raw);
    if (url.protocol === 'blob:' || url.protocol === 'filesystem:') {
      try {
        const inner = new URL(url.pathname);
        return inner.hostname.toLowerCase().replace(/\.+$/g, '');
      } catch {
        return '';
      }
    }
    return url.hostname.toLowerCase().replace(/\.+$/g, '');
  } catch {
    return '';
  }
}

/** Extract the hostname part of a domain-rule pattern. */
export function hostnameFromPattern(value) {
  let raw = String(value ?? '').trim();
  if (!raw) return '';

  if (/^\*:\/\//.test(raw)) raw = `https://${raw.slice(4)}`;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) || raw.startsWith('//')) {
    try {
      const parsed = new URL(raw.startsWith('//') ? `https:${raw}` : raw);
      return parsed.hostname.toLowerCase().replace(/^[*.]+/, '').replace(/\.+$/g, '');
    } catch {
      return '';
    }
  }

  raw = raw.replace(/^[*.]+/, '');
  raw = raw.split('/')[0].split('?')[0].split('#')[0];
  if (raw.includes('@')) raw = raw.split('@').pop();
  if (raw.startsWith('[')) {
    const end = raw.indexOf(']');
    if (end !== -1) return raw.slice(0, end + 1).toLowerCase();
  }
  raw = raw.replace(/:\d+$/, '');
  return raw.toLowerCase().replace(/\.+$/g, '');
}

export function hostMatches(host, patternHost, subdomains = true) {
  const normalizedHost = String(host ?? '').toLowerCase().replace(/\.+$/g, '');
  const normalizedPattern = String(patternHost ?? '').toLowerCase().replace(/\.+$/g, '');
  if (!normalizedHost || !normalizedPattern) return false;
  return (
    normalizedHost === normalizedPattern ||
    (subdomains !== false && normalizedHost.endsWith(`.${normalizedPattern}`))
  );
}

/** Convert a glob-like wildcard to an anchored regular expression. */
export function wildcardToRegExp(pattern, { caseSensitive = false } = {}) {
  const source = String(pattern ?? '').replace(
    /[.+^${}()|[\]\\?*]/g,
    (char) => {
      if (char === '*') return '.*';
      if (char === '?') return '.';
      return `\\${char}`;
    },
  );
  try {
    return new RegExp(`^${source}$`, caseSensitive ? '' : 'i');
  } catch {
    return null;
  }
}

/**
 * Compile a regular expression. Supports both a bare pattern and /pattern/flags.
 * Invalid expressions return null.
 */
export function compileRegex(pattern, { caseSensitive = false } = {}) {
  let source = String(pattern ?? '');
  let flags = '';
  const literal = source.match(/^\/([\s\S]*)\/([a-z]*)$/i);
  if (literal) {
    source = literal[1];
    // Drop g/y because matching is boolean and stateful lastIndex is not useful.
    flags = literal[2].replace(/[^dimsu]/g, '');
  }
  if (!caseSensitive && !flags.includes('i')) flags += 'i';

  try {
    const regex = new RegExp(source, flags);
    regex.lastIndex = 0;
    return regex;
  } catch {
    return null;
  }
}

function dateInfo(now) {
  const date = now instanceof Date && !Number.isNaN(now.getTime()) ? now : new Date();
  const year = String(date.getFullYear());
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return { year, month, day, date: `${year}-${month}-${day}` };
}

/** Local-time YYYY-MM-DD key used for daily statistics. */
export function localDateKey(date = new Date()) {
  return dateInfo(date).date;
}

/**
 * Build the immutable description of one download that all matching functions
 * operate on.
 *
 * @param {{url?:string, referrer?:string, filename?:string, now?:Date}} input
 */
export function buildMatchInfo(input = {}) {
  const url = String(input.url ?? '');
  const referrer = String(input.referrer ?? '');
  const filename = String(input.filename ?? '');
  const { base, relativeDir } = splitFilenamePath(filename);
  const hostname = hostnameFromUrl(url);
  const referrerHostname = hostnameFromUrl(referrer);
  const ext = extensionOf(base);

  return {
    url,
    referrer,
    filename,
    base,
    relativeDir,
    ext,
    extWithDot: ext ? `.${ext}` : '',
    hostname,
    host: hostname,
    hostNoWww: hostname.replace(/^www\./i, ''),
    referrerHostname,
    referrerHost: referrerHostname,
    referrerHostNoWww: referrerHostname.replace(/^www\./i, ''),
    ...dateInfo(input.now),
  };
}

function matchDomain(rule, patterns, info) {
  const mode = DOMAIN_MODES.includes(rule.matchMode) ? rule.matchMode : 'host';
  const urls = [];
  if (info.url) urls.push(info.url);
  if (rule.includeReferrer && info.referrer) urls.push(info.referrer);

  const hosts = [];
  for (const url of urls) {
    const hostname = hostnameFromUrl(url);
    if (hostname && !hosts.includes(hostname)) hosts.push(hostname);
  }
  if (info.hostname && !hosts.includes(info.hostname)) hosts.push(info.hostname);

  if (mode === 'host') {
    return patterns.some((pattern) => {
      const patternHost = hostnameFromPattern(pattern);
      return patternHost && hosts.some((host) => hostMatches(host, patternHost, rule.subdomains));
    });
  }

  if (mode === 'contains') {
    const haystacks = [...urls, ...hosts].map((value) => value.toLowerCase());
    return patterns.some((pattern) => {
      const needle = pattern.toLowerCase();
      return haystacks.some((haystack) => haystack.includes(needle));
    });
  }

  if (mode === 'wildcard') {
    const haystacks = [...urls, ...hosts];
    return patterns.some((pattern) => {
      const regex = wildcardToRegExp(pattern);
      return regex ? haystacks.some((haystack) => regex.test(haystack)) : false;
    });
  }

  if (mode === 'regex') {
    const haystacks = [...urls, ...hosts];
    return patterns.some((pattern) => {
      const regex = compileRegex(pattern);
      return regex ? haystacks.some((haystack) => regex.test(haystack)) : false;
    });
  }

  return false;
}

function matchFilename(rule, patterns, info) {
  const filename = info.base || '';
  if (!filename) return false;

  const mode = FILENAME_MODES.includes(rule.matchMode) ? rule.matchMode : 'contains';
  const caseSensitive = rule.caseSensitive === true;
  const haystack = caseSensitive ? filename : filename.toLowerCase();

  return patterns.some((pattern) => {
    if (mode === 'wildcard') {
      const regex = wildcardToRegExp(pattern, { caseSensitive });
      return regex ? regex.test(filename) : false;
    }
    if (mode === 'regex') {
      const regex = compileRegex(pattern, { caseSensitive });
      return regex ? regex.test(filename) : false;
    }

    const needle = caseSensitive ? pattern : pattern.toLowerCase();
    if (mode === 'startswith') return haystack.startsWith(needle);
    if (mode === 'endswith') return haystack.endsWith(needle);
    return haystack.includes(needle);
  });
}

function matchExtension(rule, info) {
  const filename = (info.base || '').toLowerCase();
  if (!filename) return false;
  const patterns = normalizePatterns(rule.patterns, { type: 'extension' });
  return patterns.some((extension) => filename.endsWith(`.${extension}`));
}

/** Test one rule against a prepared match info object. */
export function matchRule(rule, info) {
  if (!rule || rule.enabled === false || !info) return false;
  const patterns = Array.isArray(rule.patterns) ? rule.patterns : [];
  if (!patterns.length) return false;

  if (rule.type === 'domain') return matchDomain(rule, patterns, info);
  if (rule.type === 'filename') return matchFilename(rule, patterns, info);
  if (rule.type === 'extension') return matchExtension(rule, info);
  return false;
}

/**
 * Replace folder template variables.
 * Supported: {domain} {host} {ext} {year} {month} {day} {date}
 */
export function renderTarget(template, info) {
  const raw = String(template ?? '').trim();
  if (!raw) return '';

  const values = {
    domain: info.hostNoWww || info.hostname || 'unknown',
    host: info.hostname || 'unknown',
    ext: info.ext || 'no-ext',
    year: info.year,
    month: info.month,
    day: info.day,
    date: info.date,
  };

  let rendered = raw;
  for (const [name, value] of Object.entries(values)) {
    rendered = rendered.replace(new RegExp(`\\{${name}\\}`, 'gi'), String(value ?? ''));
  }
  return sanitizeFolderPath(rendered);
}

/**
 * Decide which folder a download should use. First matching enabled rule wins.
 *
 * @returns {{source:'disabled'|'rule'|'fallback'|'default', rule:object|null, folder:string, ruleId:string|null, ruleName:string}}
 */
export function matchRules(settings, info) {
  if (!settings || settings.enabled === false) {
    return { source: 'disabled', rule: null, folder: '', ruleId: null, ruleName: '' };
  }

  for (const rule of settings.rules || []) {
    if (!rule || rule.enabled === false || !rule.target || !Array.isArray(rule.patterns) || !rule.patterns.length) {
      continue;
    }
    if (matchRule(rule, info)) {
      const folder = renderTarget(rule.target, info);
      if (!folder) continue;
      return {
        source: 'rule',
        rule,
        folder,
        ruleId: rule.id || null,
        ruleName: rule.name || '',
      };
    }
  }

  const fallback = renderTarget(settings.fallbackFolder, info);
  if (fallback) {
    return {
      source: 'fallback',
      rule: null,
      folder: fallback,
      ruleId: null,
      ruleName: '回退文件夹',
    };
  }

  return { source: 'default', rule: null, folder: '', ruleId: null, ruleName: '' };
}

/** Build the relative filename passed to chrome.downloads.suggest(). */
export function buildSuggestedFilename({ filename, folder = '', relativeDir = '', preserveSubdirs = true }) {
  const parts = [];
  const safeFolder = sanitizeFolderPath(folder);
  if (safeFolder) parts.push(safeFolder);

  if (preserveSubdirs) {
    const safeRelativeDir = sanitizeFolderPath(relativeDir);
    if (safeRelativeDir) parts.push(safeRelativeDir);
  }

  parts.push(sanitizeFilename(filename));
  return parts.join('/');
}

/** Human-readable rule summary used by the options page and popup. */
export function describeRule(rule) {
  if (!rule) return '';
  const patterns = Array.isArray(rule.patterns) ? rule.patterns : [];
  const list = patterns.join('、');
  const mode = rule.matchMode || '';

  if (rule.type === 'domain') {
    let text;
    if (mode === 'host') {
      text = `域名 ${list}${rule.subdomains !== false ? '（含子域名）' : ''}`;
    } else if (mode === 'contains') {
      text = `URL 包含 ${list}`;
    } else if (mode === 'wildcard') {
      text = `URL 通配符 ${list}`;
    } else {
      text = `URL 正则 ${list}`;
    }
    if (rule.includeReferrer) text += '，含来源页';
    return text;
  }

  if (rule.type === 'filename') {
    const label = {
      contains: '文件名包含',
      startswith: '文件名以…开头',
      endswith: '文件名以…结尾',
      wildcard: '文件名通配符',
      regex: '文件名正则',
    }[mode] || '文件名包含';
    return `${label} ${list}${rule.caseSensitive ? '（区分大小写）' : ''}`;
  }

  if (rule.type === 'extension') {
    return `扩展名 ${patterns.map((pattern) => `.${pattern}`).join('、')}`;
  }
  return '';
}

/**
 * Validate the editable fields of a rule.
 *
 * @returns {{type?:string, patterns?:string, target?:string}}
 */
export function validateRuleDraft(draft) {
  const errors = {};
  const type = draft?.type;
  if (!RULE_TYPES.includes(type)) {
    errors.type = '请选择规则类型';
    return errors;
  }

  const mode = draft.matchMode || (type === 'domain' ? 'host' : 'contains');
  const patterns = normalizePatterns(draft.patterns, { type, mode });
  if (!patterns.length) {
    errors.patterns = '请至少填写一个匹配内容';
  } else if (type === 'domain' && mode === 'host') {
    const invalid = patterns.filter((pattern) => {
      const withoutPrefixes = pattern
        .replace(/^[a-z][a-z0-9+.-]*:\/\//i, '')
        .replace(/^\*:\/\//, '')
        .replace(/^[*.]+/, '');
      return (
        !hostnameFromPattern(pattern) ||
        /\s/.test(pattern) ||
        withoutPrefixes.includes('*')
      );
    });
    if (invalid.length) {
      errors.patterns = `域名格式不正确：${invalid.join('、')}`;
    }
  } else if ((type === 'domain' || type === 'filename') && mode === 'regex') {
    const invalid = patterns.filter(
      (pattern) => !compileRegex(pattern, { caseSensitive: draft.caseSensitive === true }),
    );
    if (invalid.length) {
      errors.patterns = `正则表达式无效：${invalid.join('、')}`;
    }
  }

  const target = validateTargetFolder(draft.target);
  if (!target.ok) errors.target = target.error;

  return errors;
}

/**
 * Validate a target folder. Empty values are invalid here; the options page
 * treats an empty global fallback as "keep Chrome's default".
 *
 * @returns {{ok:boolean, normalized?:string, error?:string}}
 */
export function validateTargetFolder(value) {
  const text = String(value ?? '').trim();
  if (!text) {
    return { ok: false, error: '请填写目标文件夹（相对于系统“下载”目录）' };
  }
  if (
    /^[a-zA-Z]:/.test(text) ||
    text.startsWith('/') ||
    text.startsWith('\\') ||
    text.startsWith('~')
  ) {
    return {
      ok: false,
      error: '只能填写“下载”目录下的子文件夹，例如 Documents/PDF',
    };
  }
  if (text.split(/[\\/]+/).includes('..')) {
    return { ok: false, error: '路径不能包含 “..”' };
  }
  if (/[<>:"|?*\u0000-\u001f]/.test(text)) {
    return { ok: false, error: '文件夹名不能包含 < > : " | ? * 等字符' };
  }
  const normalized = sanitizeFolderPath(text);
  if (!normalized) {
    return { ok: false, error: '文件夹名称无效，请换一个名称' };
  }
  return { ok: true, normalized };
}

/** Build a short display path relative to Downloads. */
export function displayPath(path) {
  return `下载/${String(path ?? '').replace(/^\/+/, '')}`;
}
