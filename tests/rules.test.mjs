import test from 'node:test';
import assert from 'node:assert/strict';

import {
  EXAMPLE_RULES,
  buildMatchInfo,
  buildSuggestedFilename,
  compileRegex,
  createDefaultSettings,
  describeRule,
  displayPath,
  extensionOf,
  hostMatches,
  hostnameFromPattern,
  hostnameFromUrl,
  localDateKey,
  matchRule,
  matchRules,
  normalizePatterns,
  normalizeRule,
  normalizeSettings,
  patternsToText,
  renderTarget,
  sanitizeFilename,
  sanitizeFolderPath,
  splitFilenamePath,
  uid,
  validateRuleDraft,
  validateTargetFolder,
  wildcardToRegExp,
} from '../lib/rules.js';

function makeRule(overrides = {}) {
  return normalizeRule({
    id: 'rule-1',
    name: 'Test rule',
    type: 'domain',
    enabled: true,
    patterns: ['example.com'],
    target: 'Sites/{domain}',
    matchMode: 'host',
    subdomains: true,
    ...overrides,
  });
}

function makeSettings(rules = [], overrides = {}) {
  return normalizeSettings({
    enabled: true,
    fallbackFolder: '',
    preserveSubdirs: true,
    rules,
    ...overrides,
  });
}

function match(url, filename, extra = {}) {
  return buildMatchInfo({
    url,
    filename,
    ...extra,
    now: new Date(2026, 0, 5, 12, 0, 0),
  });
}

test('extensionOf handles normal, multi-dot and dotfiles', () => {
  assert.equal(extensionOf('report.PDF'), 'pdf');
  assert.equal(extensionOf('archive.tar.gz'), 'gz');
  assert.equal(extensionOf('path/to/file.docx'), 'docx');
  assert.equal(extensionOf('README'), '');
  assert.equal(extensionOf('.gitignore'), '');
  assert.equal(extensionOf('trailing.'), '');
  assert.equal(extensionOf(''), '');
});

test('hostnameFromUrl supports normal and blob URLs', () => {
  assert.equal(hostnameFromUrl('https://www.Example.com/path'), 'www.example.com');
  assert.equal(hostnameFromUrl('https://example.com./x'), 'example.com');
  assert.equal(
    hostnameFromUrl('blob:https://cdn.example.com/6f1c3f5e-0000-4000-8000-000000000000'),
    'cdn.example.com',
  );
  assert.equal(hostnameFromUrl('not a url'), '');
  assert.equal(hostnameFromUrl(''), '');
});

test('hostnameFromPattern extracts hosts from several forms', () => {
  assert.equal(hostnameFromPattern('https://www.example.com/path'), 'www.example.com');
  assert.equal(hostnameFromPattern('*.example.com'), 'example.com');
  assert.equal(hostnameFromPattern('example.com:8080'), 'example.com');
  assert.equal(hostnameFromPattern('//cdn.example.com/file'), 'cdn.example.com');
  assert.equal(hostnameFromPattern('*.example.com/*'), 'example.com');
  assert.equal(hostnameFromPattern(''), '');
});

test('hostMatches respects the subdomain flag', () => {
  assert.equal(hostMatches('www.example.com', 'example.com', true), true);
  assert.equal(hostMatches('www.example.com', 'example.com', false), false);
  assert.equal(hostMatches('example.com', 'example.com', false), true);
  assert.equal(hostMatches('notexample.com', 'example.com', true), false);
  assert.equal(hostMatches('', 'example.com', true), false);
});

test('sanitizeFolderPath only allows safe paths relative to Downloads', () => {
  assert.equal(sanitizeFolderPath('Docs/PDF'), 'Docs/PDF');
  assert.equal(sanitizeFolderPath('Docs\\PDF'), 'Docs/PDF');
  assert.equal(sanitizeFolderPath('Docs//PDF/'), 'Docs/PDF');
  assert.equal(sanitizeFolderPath('C:\\Users\\me\\Downloads\\Docs'), '');
  assert.equal(sanitizeFolderPath('/tmp/docs'), '');
  assert.equal(sanitizeFolderPath('../secret'), '');
  assert.equal(sanitizeFolderPath('Docs/../PDF'), '');
  assert.equal(sanitizeFolderPath('Docs:2024'), 'Docs_2024');
  assert.equal(sanitizeFolderPath('CON/aux.txt'), '_CON/_aux.txt');
  assert.equal(sanitizeFolderPath('  '), '');
});

test('sanitizeFilename keeps names usable while removing path syntax', () => {
  assert.equal(sanitizeFilename('a/b:c?.pdf'), 'a_b_c_.pdf');
  assert.equal(sanitizeFilename('report.pdf...'), 'report.pdf');
  assert.equal(sanitizeFilename(''), 'download');
  assert.equal(sanitizeFilename('CON.txt'), '_CON.txt');
});

test('splitFilenamePath separates relative directories and absolute paths', () => {
  assert.deepEqual(splitFilenamePath('folder/report.pdf'), {
    base: 'report.pdf',
    relativeDir: 'folder',
  });
  assert.deepEqual(splitFilenamePath('a/b/report.pdf'), {
    base: 'report.pdf',
    relativeDir: 'a/b',
  });
  assert.deepEqual(splitFilenamePath('C:\\Users\\me\\report.pdf'), {
    base: 'report.pdf',
    relativeDir: '',
  });
  assert.deepEqual(splitFilenamePath(''), { base: 'download', relativeDir: '' });
});

test('buildMatchInfo exposes host, extension, date and relative directory', () => {
  const info = match(
    'https://www.Example.com/files/report.PDF',
    'folder/report.PDF',
  );

  assert.equal(info.hostname, 'www.example.com');
  assert.equal(info.hostNoWww, 'example.com');
  assert.equal(info.ext, 'pdf');
  assert.equal(info.extWithDot, '.pdf');
  assert.equal(info.base, 'report.PDF');
  assert.equal(info.relativeDir, 'folder');
  assert.equal(info.year, '2026');
  assert.equal(info.month, '01');
  assert.equal(info.day, '05');
  assert.equal(info.date, '2026-01-05');
});

test('renderTarget replaces all supported template variables', () => {
  const info = match('https://www.example.com/files/report.PDF', 'report.PDF');

  assert.equal(
    renderTarget('Sites/{domain}/{ext}/{year}-{month}-{day}', info),
    'Sites/example.com/pdf/2026-01-05',
  );
  assert.equal(renderTarget('Hosts/{host}', info), 'Hosts/www.example.com');
  assert.equal(renderTarget('Dated/{date}', info), 'Dated/2026-01-05');
  assert.equal(renderTarget('C:\\absolute', info), '');
  assert.equal(renderTarget('../escape', info), '');
});

test('renderTarget falls back to unknown and no-ext', () => {
  const info = match('', 'README');
  assert.equal(renderTarget('{domain}/{ext}', info), 'unknown/no-ext');
  assert.equal(renderTarget('{host}', info), 'unknown');
});

test('domain host rules match subdomains and first match wins', () => {
  const first = makeRule({
    id: 'first',
    patterns: ['example.com'],
    target: 'First/{domain}',
  });
  const second = makeRule({
    id: 'second',
    patterns: ['example.com'],
    target: 'Second',
  });

  const result = matchRules(
    makeSettings([first, second]),
    match('https://www.example.com/a.zip', 'a.zip'),
  );

  assert.equal(result.source, 'rule');
  assert.equal(result.ruleId, 'first');
  assert.equal(result.folder, 'First/example.com');
});

test('disabled rules are skipped', () => {
  const disabled = makeRule({ id: 'disabled', enabled: false, target: 'Disabled' });
  const enabled = makeRule({ id: 'enabled', target: 'Enabled' });

  const result = matchRules(
    makeSettings([disabled, enabled]),
    match('https://example.com/a.zip', 'a.zip'),
  );

  assert.equal(result.ruleId, 'enabled');
  assert.equal(result.folder, 'Enabled');
});

test('subdomains can be disabled for domain host rules', () => {
  const rule = makeRule({ id: 'apex-only', subdomains: false, target: 'Apex' });

  const withWww = matchRules(
    makeSettings([rule]),
    match('https://www.example.com/a.zip', 'a.zip'),
  );
  assert.equal(withWww.source, 'default');

  const apex = matchRules(
    makeSettings([rule]),
    match('https://example.com/a.zip', 'a.zip'),
  );
  assert.equal(apex.source, 'rule');
  assert.equal(apex.folder, 'Apex');
});

test('includeReferrer lets CDN downloads match a domain rule', () => {
  const rule = makeRule({
    id: 'cdn',
    patterns: ['cdn.example.com'],
    includeReferrer: true,
    target: 'CDN',
  });

  const withoutReferrer = matchRules(
    makeSettings([{ ...rule, includeReferrer: false }]),
    match('https://files.other.com/a.zip', 'a.zip'),
  );
  assert.equal(withoutReferrer.source, 'default');

  const withReferrer = matchRules(
    makeSettings([rule]),
    match('https://files.other.com/a.zip', 'a.zip', {
      referrer: 'https://cdn.example.com/page',
    }),
  );
  assert.equal(withReferrer.source, 'rule');
  assert.equal(withReferrer.folder, 'CDN');
});

test('domain contains, wildcard and regex modes match URLs', () => {
  const contains = makeRule({
    id: 'contains',
    matchMode: 'contains',
    patterns: ['example.com/files'],
    target: 'Contains',
  });
  assert.equal(
    matchRules(
      makeSettings([contains]),
      match('https://example.com/files/a.zip', 'a.zip'),
    ).source,
    'rule',
  );

  const wildcard = makeRule({
    id: 'wildcard',
    matchMode: 'wildcard',
    patterns: ['*.example.com/*'],
    target: 'Wildcard',
  });
  assert.equal(
    matchRules(
      makeSettings([wildcard]),
      match('https://cdn.example.com/a.zip', 'a.zip'),
    ).source,
    'rule',
  );

  const regex = makeRule({
    id: 'regex',
    matchMode: 'regex',
    patterns: ['cdn\\.example\\.com'],
    target: 'Regex',
  });
  assert.equal(
    matchRules(
      makeSettings([regex]),
      match('https://cdn.example.com/a.zip', 'a.zip'),
    ).source,
    'rule',
  );
});

test('filename rules support contains, startsWith, endsWith, wildcard and regex', () => {
  const cases = [
    [{ matchMode: 'contains', patterns: ['invoice'] }, 'INVOICE_2026.pdf', true],
    [{ matchMode: 'contains', patterns: ['invoice'], caseSensitive: true }, 'INVOICE_2026.pdf', false],
    [{ matchMode: 'startswith', patterns: ['2026-'] }, '2026-report.pdf', true],
    [{ matchMode: 'startswith', patterns: ['2026-'] }, 'old-2026-report.pdf', false],
    [{ matchMode: 'endswith', patterns: ['.pdf'] }, 'report.PDF', true],
    [{ matchMode: 'wildcard', patterns: ['report-*.xlsx'] }, 'report-q1.xlsx', true],
    [{ matchMode: 'wildcard', patterns: ['report-*.xlsx'] }, 'summary-q1.xlsx', false],
    [{ matchMode: 'regex', patterns: ['^\\d{4}-\\d{2}-\\d{2}'] }, '2026-01-05-report.pdf', true],
  ];

  for (const [overrides, filename, expected] of cases) {
    const rule = makeRule({
      id: 'filename-rule',
      type: 'filename',
      target: 'Files',
      ...overrides,
    });
    const result = matchRules(
      makeSettings([rule]),
      match('https://example.com/download', filename),
    );
    assert.equal(result.source === 'rule', expected, JSON.stringify({ overrides, filename }));
  }
});

test('filename rules inspect only the basename, not the path', () => {
  const rule = makeRule({
    id: 'folder-name',
    type: 'filename',
    patterns: ['folder'],
    target: 'Files',
  });

  const result = matchRules(
    makeSettings([rule]),
    match('https://example.com/download', 'folder/report.pdf'),
  );
  assert.equal(result.source, 'default');
});

test('extension rules normalize dots and match case-insensitively', () => {
  const rule = makeRule({
    id: 'ext',
    type: 'extension',
    matchMode: '',
    patterns: ['.PDF', 'EPUB'],
    target: 'Books',
  });

  assert.equal(
    matchRules(
      makeSettings([rule]),
      match('https://example.com/download', 'report.PDF'),
    ).folder,
    'Books',
  );
  assert.equal(
    matchRules(
      makeSettings([rule]),
      match('https://example.com/download', 'book.epub'),
    ).source,
    'rule',
  );
  assert.equal(
    matchRules(
      makeSettings([rule]),
      match('https://example.com/download', 'report.pdf.exe'),
    ).source,
    'default',
  );
});

test('fallback folder is used when no rule matches', () => {
  const result = matchRules(
    makeSettings([], { fallbackFolder: 'Inbox/{year}' }),
    match('https://example.com/a.zip', 'a.zip'),
  );

  assert.equal(result.source, 'fallback');
  assert.equal(result.folder, 'Inbox/2026');
  assert.equal(result.ruleName, '回退文件夹');
});

test('empty fallback keeps the Chrome default location', () => {
  const result = matchRules(
    makeSettings([], { fallbackFolder: '' }),
    match('https://example.com/a.zip', 'a.zip'),
  );

  assert.deepEqual(result, {
    source: 'default',
    rule: null,
    folder: '',
    ruleId: null,
    ruleName: '',
  });
});

test('disabled global switch skips rules and fallback', () => {
  const result = matchRules(
    makeSettings([makeRule()], { enabled: false, fallbackFolder: 'Inbox' }),
    match('https://example.com/a.zip', 'a.zip'),
  );

  assert.equal(result.source, 'disabled');
  assert.equal(result.folder, '');
});

test('a rule whose target renders empty is skipped', () => {
  const broken = makeRule({
    id: 'broken',
    patterns: ['example.com'],
    target: '../escape',
  });
  const good = makeRule({
    id: 'good',
    patterns: ['example.com'],
    target: 'Good',
  });

  const result = matchRules(
    makeSettings([broken, good]),
    match('https://example.com/a.zip', 'a.zip'),
  );

  assert.equal(result.ruleId, 'good');
  assert.equal(result.folder, 'Good');
});

test('matchRule respects enabled, patterns and type', () => {
  const info = match('https://example.com/a.zip', 'a.zip');
  assert.equal(matchRule(makeRule(), info), true);
  assert.equal(matchRule(makeRule({ enabled: false }), info), false);
  assert.equal(matchRule(makeRule({ patterns: [] }), info), false);
  assert.equal(matchRule(null, info), false);
});

test('buildSuggestedFilename combines folder, relative dir and basename', () => {
  assert.equal(
    buildSuggestedFilename({
      filename: 'report.pdf',
      folder: 'Docs',
      relativeDir: 'sub',
      preserveSubdirs: true,
    }),
    'Docs/sub/report.pdf',
  );
  assert.equal(
    buildSuggestedFilename({
      filename: 'report.pdf',
      folder: 'Docs',
      relativeDir: 'sub',
      preserveSubdirs: false,
    }),
    'Docs/report.pdf',
  );
  assert.equal(
    buildSuggestedFilename({
      filename: 'report.pdf',
      folder: '',
      relativeDir: 'sub',
      preserveSubdirs: true,
    }),
    'sub/report.pdf',
  );
  assert.equal(
    buildSuggestedFilename({
      filename: 'a/b:c.pdf',
      folder: 'Docs',
      relativeDir: '',
      preserveSubdirs: true,
    }),
    'Docs/a_b_c.pdf',
  );
});

test('validateTargetFolder rejects absolute, traversal and invalid paths', () => {
  assert.equal(validateTargetFolder('').ok, false);
  assert.equal(validateTargetFolder('C:\\Downloads\\Docs').ok, false);
  assert.equal(validateTargetFolder('/Docs').ok, false);
  assert.equal(validateTargetFolder('~/Docs').ok, false);
  assert.equal(validateTargetFolder('../Docs').ok, false);
  assert.equal(validateTargetFolder('Docs/../PDF').ok, false);
  assert.equal(validateTargetFolder('Docs:2024').ok, false);
  assert.equal(validateTargetFolder('Docs?x').ok, false);

  assert.deepEqual(validateTargetFolder('Docs/PDF/'), {
    ok: true,
    normalized: 'Docs/PDF',
  });
  assert.deepEqual(validateTargetFolder('Docs//PDF'), {
    ok: true,
    normalized: 'Docs/PDF',
  });
  assert.deepEqual(validateTargetFolder('Sites/{domain}'), {
    ok: true,
    normalized: 'Sites/{domain}',
  });
  assert.deepEqual(validateTargetFolder('发票/2026'), {
    ok: true,
    normalized: '发票/2026',
  });
});

test('validateRuleDraft checks patterns, regex and target', () => {
  assert.deepEqual(
    validateRuleDraft({
      type: 'domain',
      patterns: 'example.com\n*.example.org',
      target: 'Sites/{domain}',
      matchMode: 'host',
      subdomains: true,
    }),
    {},
  );

  const invalidDomain = validateRuleDraft({
    type: 'domain',
    patterns: 'foo*bar.com',
    target: 'Sites',
    matchMode: 'host',
  });
  assert.match(invalidDomain.patterns, /域名格式不正确/);

  const invalidRegex = validateRuleDraft({
    type: 'filename',
    patterns: '[',
    target: 'Files',
    matchMode: 'regex',
  });
  assert.match(invalidRegex.patterns, /正则表达式无效/);

  const missingTarget = validateRuleDraft({
    type: 'filename',
    patterns: 'invoice',
    target: '',
    matchMode: 'contains',
  });
  assert.match(missingTarget.target, /请填写目标文件夹/);

  const invalidType = validateRuleDraft({ type: 'other', patterns: 'x', target: 'Docs' });
  assert.match(invalidType.type, /请选择规则类型/);
});

test('normalizePatterns splits, trims and de-duplicates', () => {
  assert.deepEqual(
    normalizePatterns('.PDF, epub; mobi', { type: 'extension' }),
    ['pdf', 'epub', 'mobi'],
  );
  assert.deepEqual(
    normalizePatterns('a, b，c; d', { type: 'filename', mode: 'contains' }),
    ['a', 'b', 'c', 'd'],
  );
  assert.deepEqual(
    normalizePatterns('a,b\nc', { type: 'filename', mode: 'regex' }),
    ['a,b', 'c'],
  );
  assert.deepEqual(normalizePatterns(['x', 'x', ' y '], { type: 'filename' }), ['x', 'y']);
  assert.deepEqual(normalizePatterns('a/b, p df, ok', { type: 'extension' }), ['ok']);
  assert.equal(normalizePatterns(Array.from({ length: 105 }, (_, i) => `p${i}`)).length, 100);
});

test('patternsToText joins patterns with newlines', () => {
  assert.equal(patternsToText(['pdf', 'epub']), 'pdf\nepub');
  assert.equal(patternsToText(null), '');
});

test('normalizeRule fills defaults and preserves enabled state', () => {
  const rule = normalizeRule({
    id: 'r1',
    type: 'filename',
    enabled: false,
    patterns: ['invoice'],
    target: '  Finance/{year}  ',
    matchMode: 'contains',
  });

  assert.equal(rule.id, 'r1');
  assert.equal(rule.name, '文件名含「invoice」');
  assert.equal(rule.enabled, false);
  assert.equal(rule.target, 'Finance/{year}');
  assert.equal(rule.caseSensitive, false);
  assert.equal(rule.subdomains, false);
  assert.equal(rule.includeReferrer, false);

  const domain = normalizeRule({
    type: 'domain',
    patterns: ['example.com'],
    target: 'Sites',
  });
  assert.equal(domain.matchMode, 'host');
  assert.equal(domain.subdomains, true);
  assert.equal(domain.enabled, true);
  assert.ok(domain.id);

  assert.equal(normalizeRule({ type: 'nope' }), null);
  assert.equal(normalizeRule(null), null);
});

test('normalizeSettings keeps an empty rule list and drops invalid rules', () => {
  assert.deepEqual(normalizeSettings({ rules: [] }).rules, []);

  const normalized = normalizeSettings({
    enabled: false,
    fallbackFolder: '  Inbox  ',
    preserveSubdirs: false,
    rules: [
      { type: 'extension', patterns: ['.PDF'], target: 'Books' },
      { type: 'invalid', patterns: ['x'], target: 'Nope' },
    ],
  });

  assert.equal(normalized.enabled, false);
  assert.equal(normalized.fallbackFolder, 'Inbox');
  assert.equal(normalized.preserveSubdirs, false);
  assert.equal(normalized.rules.length, 1);
  assert.equal(normalized.rules[0].target, 'Books');

  assert.equal(normalizeSettings(null).rules.length, EXAMPLE_RULES.length);
});

test('createDefaultSettings ships disabled example rules', () => {
  const settings = createDefaultSettings();
  assert.equal(settings.enabled, true);
  assert.equal(settings.fallbackFolder, '');
  assert.equal(settings.rules.length, EXAMPLE_RULES.length);
  assert.ok(settings.rules.every((rule) => rule.enabled === false));
});

test('describeRule produces readable summaries', () => {
  assert.match(
    describeRule(
      makeRule({ type: 'domain', patterns: ['example.com'], matchMode: 'host', subdomains: true }),
    ),
    /域名 example\.com（含子域名）/,
  );
  assert.match(
    describeRule(
      makeRule({
        type: 'domain',
        patterns: ['cdn.example.com'],
        matchMode: 'host',
        includeReferrer: true,
      }),
    ),
    /含来源页/,
  );
  assert.match(
    describeRule(
      makeRule({
        type: 'filename',
        patterns: ['invoice'],
        matchMode: 'contains',
        caseSensitive: true,
      }),
    ),
    /区分大小写/,
  );
  assert.match(
    describeRule(
      makeRule({
        type: 'extension',
        patterns: ['pdf', 'epub'],
        matchMode: '',
      }),
    ),
    /\.pdf、\.epub/,
  );
});

test('compileRegex and wildcardToRegExp validate input', () => {
  assert.equal(compileRegex('['), null);
  assert.equal(compileRegex('example').test('EXAMPLE'), true);
  assert.equal(compileRegex('example', { caseSensitive: true }).test('EXAMPLE'), false);
  assert.equal(compileRegex('/foo/i').test('FOO'), true);
  assert.equal(wildcardToRegExp('*.pdf').test('report.pdf'), true);
  assert.equal(wildcardToRegExp('*.pdf').test('report.pdf.exe'), false);
  assert.equal(wildcardToRegExp('file?.txt').test('file1.txt'), true);
});

test('localDateKey and displayPath format output', () => {
  assert.equal(localDateKey(new Date(2026, 0, 5, 23, 59)), '2026-01-05');
  assert.equal(displayPath('Docs/PDF'), '下载/Docs/PDF');
  assert.equal(displayPath(''), '下载/');
});

test('uid returns unique values', () => {
  const ids = new Set(Array.from({ length: 50 }, () => uid()));
  assert.equal(ids.size, 50);
});
