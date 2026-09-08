import { lstatSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const EXPECTED_PATHS = ['/', '/tours', '/charter'];
const REPORT_NAME = /^lhr-\d+\.json$/;
const CATEGORIES = ['performance', 'accessibility', 'best-practices', 'seo'];
const MAX_SAFE_ASSERTION_FAILURES = 20;
const MAX_SAFE_ASSERTION_COUNT = 99;
const MAX_SAFE_ASSERTION_SCAN = 256;
const MAX_SAFE_AUDIT_LENGTH = 1_000_000;
const MAX_SAFE_ASSERTION_RESULTS_BYTES = 2 * 1024 * 1024;

// Fixed against treosh/lighthouse-ci-action 3e7e23f (bundled LHCI 0.15.1),
// lighthouse:recommended, then this repository's reviewed .lighthouserc.json
// overrides. Do not derive this from the run artifact: its IDs are untrusted.
const RECOMMENDED_MIN_SCORE_ERROR_AUDITS = new Set([
  'aria-allowed-attr', 'aria-allowed-role', 'aria-command-name', 'aria-conditional-attr',
  'aria-deprecated-role', 'aria-dialog-name', 'aria-hidden-body', 'aria-hidden-focus',
  'aria-input-field-name', 'aria-meter-name', 'aria-progressbar-name', 'aria-prohibited-attr',
  'aria-required-attr', 'aria-required-children', 'aria-required-parent', 'aria-roles', 'aria-text',
  'aria-toggle-field-name', 'aria-tooltip-name', 'aria-treeitem-name', 'aria-valid-attr-value',
  'aria-valid-attr', 'button-name', 'clickjacking-mitigation', 'cls-culprits-insight',
  'color-contrast', 'crawlable-anchors', 'definition-list', 'document-latency-insight',
  'document-title', 'duplicate-id-aria', 'duplicated-javascript-insight', 'empty-heading',
  'errors-in-console', 'font-display-insight', 'font-display', 'font-size', 'forced-reflow-insight',
  'form-field-multiple-labels', 'frame-title', 'geolocation-on-start', 'has-hsts', 'heading-order',
  'html-has-lang', 'html-lang-valid', 'html-xml-lang-mismatch', 'http-status-code',
  'identical-links-same-purpose', 'image-alt', 'image-aspect-ratio', 'image-delivery-insight',
  'image-redundant-alt', 'image-size-responsive', 'input-button-name', 'input-image-alt',
  'inspector-issues', 'interaction-to-next-paint-insight', 'label-content-name-mismatch',
  'landmark-one-main', 'lcp-discovery-insight', 'lcp-lazy-loaded', 'lcp-phases-insight',
  'legacy-javascript-insight', 'link-in-text-block', 'link-name', 'link-text', 'meta-description',
  'meta-refresh', 'meta-viewport', 'modern-http-insight', 'network-dependency-tree-insight',
  'no-document-write', 'non-composited-animations', 'notification-on-start', 'object-alt',
  'origin-isolation', 'paste-preventing-inputs', 'prioritize-lcp-image', 'redirects-http', 'robots-txt',
  'select-name', 'skip-link', 'table-duplicate-name', 'table-fake-caption', 'target-size',
  'td-has-header', 'td-headers-attr', 'th-has-data-cells', 'third-parties-insight',
  'third-party-facades', 'total-byte-weight', 'unsized-images', 'uses-passive-event-listeners',
  'valid-lang', 'valid-source-maps', 'video-caption', 'viewport-insight', 'accesskeys', 'bypass',
  'canonical', 'charset', 'deprecations', 'dlitem', 'doctype', 'hreflang', 'label', 'list', 'listitem',
  'redirects', 'tabindex', 'viewport',
]);
const RECOMMENDED_MAX_LENGTH_ERROR_AUDITS = new Set([
  'efficient-animated-content', 'offscreen-images', 'unminified-css', 'unminified-javascript',
  'unused-css-rules', 'unused-javascript', 'uses-optimized-images', 'uses-responsive-images',
]);
const SAFE_CATEGORY_RULES = new Map([
  ['performance', { level: 'warn', expected: 0.5 }],
  ['accessibility', { level: 'error', expected: 0.85 }],
  ['best-practices', { level: 'warn', expected: 0.8 }],
  ['seo', { level: 'warn', expected: 0.85 }],
]);
const SAFE_MAX_NUMERIC_WARN_RULES = new Map([
  ['first-contentful-paint', 3000],
  ['largest-contentful-paint', 4000],
  ['cumulative-layout-shift', 0.15],
  ['total-blocking-time', 600],
]);

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function cleanUrl(value) {
  if (typeof value !== 'string' || value.trim() !== value || /[\\\s]/.test(value)) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) return null;
    return url;
  } catch {
    return null;
  }
}

function previewOrigin(value) {
  const url = cleanUrl(value);
  if (!url || url.pathname !== '/' || url.port || !/^[a-z0-9-]+\.vercel\.app$/.test(url.hostname)) return null;
  return url.origin;
}

function result(codes, reportCount = 0, assertionCount = 0, warningCount = 0) {
  return { ok: codes.length === 0, codes: [...new Set(codes)], reportCount, assertionCount, warningCount };
}

function boundedCount(value) {
  return Math.min(Math.max(0, value), MAX_SAFE_ASSERTION_COUNT);
}

function categoryRule(assertion) {
  if (assertion.auditId !== 'categories' || typeof assertion.auditProperty !== 'string') return null;
  const category = SAFE_CATEGORY_RULES.get(assertion.auditProperty);
  if (!category) return null;
  return { auditId: `categories:${assertion.auditProperty}`, ...category, name: 'minScore', min: 0, max: 1 };
}

function recommendedRule(assertion) {
  if (typeof assertion.auditId !== 'string' || assertion.auditProperty !== undefined) return null;
  const { auditId } = assertion;
  if (RECOMMENDED_MIN_SCORE_ERROR_AUDITS.has(auditId)) {
    return { auditId, level: 'error', expected: 0.9, name: 'minScore', min: 0, max: 1 };
  }
  if (RECOMMENDED_MAX_LENGTH_ERROR_AUDITS.has(auditId)) {
    return { auditId, level: 'error', expected: 0, name: 'maxLength', min: 0, max: MAX_SAFE_AUDIT_LENGTH };
  }
  const numericExpected = SAFE_MAX_NUMERIC_WARN_RULES.get(auditId);
  if (numericExpected !== undefined) {
    return { auditId, level: 'warn', expected: numericExpected, name: 'maxNumericValue', min: 0, max: MAX_SAFE_AUDIT_LENGTH };
  }
  return null;
}

function ruleForAssertion(assertion) {
  const category = categoryRule(assertion);
  if (category) {
    if (assertion.name !== 'auditRan') return category;
    return { ...category, expected: 1, name: 'auditRan', min: 0, max: 1 };
  }
  const recommended = recommendedRule(assertion);
  if (!recommended || assertion.name !== 'auditRan') return recommended;
  return { ...recommended, expected: 1, name: 'auditRan', min: 0, max: 1 };
}

function knownAssertionIdentity(assertion) {
  if (!isRecord(assertion)) return false;
  if (assertion.auditId === 'categories') return SAFE_CATEGORY_RULES.has(assertion.auditProperty);
  return typeof assertion.auditId === 'string'
    && (RECOMMENDED_MIN_SCORE_ERROR_AUDITS.has(assertion.auditId)
      || RECOMMENDED_MAX_LENGTH_ERROR_AUDITS.has(assertion.auditId)
      || SAFE_MAX_NUMERIC_WARN_RULES.has(assertion.auditId));
}

/**
 * The CI log may name only the fixed, reviewed policy labels below. It never
 * returns an assertion URL, free-form text, operator, values, report, cookie,
 * or unreviewed ID. Counts are capped; this observes the original policy only.
 */
export function safeLighthouseAssertionSummary(assertionResults) {
  const summary = { failures: [], unknownCount: 0, suppressedCount: 0 };
  if (!Array.isArray(assertionResults)) return summary;
  const scanned = assertionResults.slice(0, MAX_SAFE_ASSERTION_SCAN);
  for (const assertion of scanned) {
    if (!isRecord(assertion) || assertion.passed !== false) continue;
    const rule = ruleForAssertion(assertion);
    if (!rule) {
      if (knownAssertionIdentity(assertion)) summary.suppressedCount = boundedCount(summary.suppressedCount + 1);
      else summary.unknownCount = boundedCount(summary.unknownCount + 1);
      continue;
    }
    const valid = assertion.level === rule.level && assertion.name === rule.name
      && assertion.expected === rule.expected && typeof assertion.actual === 'number'
      && Number.isFinite(assertion.actual) && assertion.actual >= rule.min && assertion.actual <= rule.max;
    if (!valid || summary.failures.length >= MAX_SAFE_ASSERTION_FAILURES) {
      summary.suppressedCount = boundedCount(summary.suppressedCount + 1);
      continue;
    }
    summary.failures.push({ auditId: rule.auditId, level: rule.level,
      actual: assertion.actual, expected: rule.expected });
  }
  if (assertionResults.length > MAX_SAFE_ASSERTION_SCAN) {
    summary.suppressedCount = boundedCount(summary.suppressedCount + assertionResults.length - MAX_SAFE_ASSERTION_SCAN);
  }
  return summary;
}

/**
 * Read-only interpretation, not a score-policy replacement or proof of a fresh CI run.
 * LHCI 0.15.1 saves only failed assertions by default; [] is a valid success:
 * https://github.com/GoogleChrome/lighthouse-ci/blob/v0.15.1/packages/utils/src/assertions.js#L479
 * Callers must supply assertions from the same completed collect/assert invocation.
 * No URLs, arbitrary report text, headers, or cookies are returned or logged.
 */
export function verifyLighthousePreview({ expectedOrigin, reports, assertionResults } = {}) {
  const origin = previewOrigin(expectedOrigin);
  if (!origin) return result(['EXPECTED_ORIGIN_INVALID']);
  const urls = new Set(EXPECTED_PATHS.map((pathname) => `${origin}${pathname}`));
  const codes = [];
  const seen = new Set();
  const reportCount = Array.isArray(reports) ? reports.length : 0;
  if (!Array.isArray(reports) || reportCount !== EXPECTED_PATHS.length) codes.push('REPORT_COUNT_MISMATCH');

  for (const report of Array.isArray(reports) ? reports : []) {
    if (!isRecord(report)) {
      codes.push('REPORT_SHAPE_INVALID');
      continue;
    }
    const requested = cleanUrl(report.requestedUrl);
    const requestedHref = requested?.href;
    if (!requestedHref || !urls.has(requestedHref)) codes.push('REPORT_URL_INVALID');
    else if (seen.has(requestedHref)) codes.push('DUPLICATE_REPORT');
    else seen.add(requestedHref);

    // finalUrl is the LHCI grouping field. Newer Lighthouse also records these URLs.
    for (const field of ['finalUrl', 'finalDisplayedUrl', 'mainDocumentUrl']) {
      if (field !== 'finalUrl' && report[field] === undefined) continue;
      const final = cleanUrl(report[field]);
      if (!final || !requestedHref || final.href !== requestedHref) codes.push('FINAL_URL_MISMATCH');
    }
    if (report.runtimeError !== undefined && report.runtimeError !== null) codes.push('REPORT_RUNTIME_ERROR');
    const hasCategories = isRecord(report.categories) && CATEGORIES.every((category) => {
      const score = report.categories[category]?.score;
      return typeof score === 'number' && Number.isFinite(score) && score >= 0 && score <= 1;
    });
    if (typeof report.lighthouseVersion !== 'string' || !/^\d+\.\d+\.\d+/.test(report.lighthouseVersion)
      || typeof report.fetchTime !== 'string' || !Number.isFinite(Date.parse(report.fetchTime))
      || !isRecord(report.audits) || Object.keys(report.audits).length === 0 || !hasCategories) {
      codes.push('REPORT_SHAPE_INVALID');
    }
  }
  if (seen.size !== EXPECTED_PATHS.length) codes.push('MISSING_REPORT');

  let warningCount = 0;
  if (!Array.isArray(assertionResults)) codes.push('ASSERTIONS_INVALID');
  for (const assertion of Array.isArray(assertionResults) ? assertionResults : []) {
    if (!isRecord(assertion) || typeof assertion.passed !== 'boolean'
      || !['error', 'warn'].includes(assertion.level)
      || typeof assertion.auditId !== 'string' || !assertion.auditId.trim()) {
      codes.push('ASSERTIONS_INVALID');
      continue;
    }
    const url = cleanUrl(assertion.url);
    if (!url || !urls.has(url.href)) codes.push('ASSERTION_URL_MISMATCH');
    if (!assertion.passed && assertion.level === 'error') codes.push('REQUIRED_ASSERTION_FAILED');
    if (!assertion.passed && assertion.level === 'warn') warningCount++;
  }
  return result(codes, reportCount, Array.isArray(assertionResults) ? assertionResults.length : 0, warningCount);
}

/**
 * Read only LHCI's original files in the fixed .lighthouseci directory, never paths
 * supplied by manifest.json. treosh also writes duplicate *.report.json exports.
 * Source: lighthouse-ci v0.15.1 packages/utils/src/saved-reports.js (LHR_REGEX).
 */
export function readLighthousePreviewArtifacts(cwd, filesystem = { lstatSync, readFileSync, readdirSync }) {
  try {
    const directory = path.join(cwd, '.lighthouseci');
    const directoryStat = filesystem.lstatSync(directory);
    if (directoryStat.isSymbolicLink() || !directoryStat.isDirectory()) return { error: 'ARTIFACT_DIRECTORY_INVALID' };
    const names = filesystem.readdirSync(directory).filter((name) => REPORT_NAME.test(name));
    if (names.length !== EXPECTED_PATHS.length) return { error: 'REPORT_COUNT_MISMATCH' };
    const readJson = (name) => {
      const filename = path.join(directory, name);
      const stat = filesystem.lstatSync(filename);
      if (stat.isSymbolicLink() || !stat.isFile()) throw new Error('UNSAFE_ARTIFACT');
      return JSON.parse(filesystem.readFileSync(filename, 'utf8'));
    };
    const reports = names.sort().map(readJson);
    const assertionResults = readJson('assertion-results.json');
    return { reports, assertionResults };
  } catch {
    // JSON parse errors and filesystem errors can contain private raw text/paths.
    return { error: 'ARTIFACTS_UNREADABLE' };
  }
}

function readAssertionResultsOnly(cwd, filesystem = { lstatSync, readFileSync }) {
  try {
    const directory = path.join(cwd, '.lighthouseci');
  const directoryStat = filesystem.lstatSync(directory);
  if (directoryStat.isSymbolicLink() || !directoryStat.isDirectory()) return null;
  const filename = path.join(directory, 'assertion-results.json');
  const stat = filesystem.lstatSync(filename);
    if (stat.isSymbolicLink() || !stat.isFile() || !Number.isSafeInteger(stat.size)
      || stat.size < 0 || stat.size > MAX_SAFE_ASSERTION_RESULTS_BYTES) return null;
    return JSON.parse(filesystem.readFileSync(filename, 'utf8'));
  } catch {
    return null;
  }
}

export function runSafeAssertionSummaryCli({ cwd = process.cwd(), filesystem, stdout = process.stdout } = {}) {
  const assertions = readAssertionResultsOnly(cwd, filesystem);
  if (!Array.isArray(assertions)) {
    stdout.write('LHCI_ASSERTIONS_SAFE_UNAVAILABLE\n');
    return 0;
  }
  stdout.write(`LHCI_ASSERTIONS_SAFE ${JSON.stringify(safeLighthouseAssertionSummary(assertions))}\n`);
  return 0;
}

export function runLighthousePreviewCli(args, {
  cwd = process.cwd(), filesystem, stdout = process.stdout, stderr = process.stderr,
} = {}) {
  let checked;
  if (args.length === 1 && args[0] === '--safe-assertions-summary') {
    return runSafeAssertionSummaryCli({ cwd, filesystem, stdout });
  }
  if (args.length !== 2 || args[0] !== '--expected-origin') checked = result(['CLI_ARGUMENTS_INVALID']);
  else if (!previewOrigin(args[1])) checked = result(['EXPECTED_ORIGIN_INVALID']);
  else {
    const artifacts = readLighthousePreviewArtifacts(cwd, filesystem);
    checked = artifacts.error
      ? result([artifacts.error])
      : verifyLighthousePreview({ expectedOrigin: args[1], ...artifacts });
  }
  const summary = checked.ok
    ? `LIGHTHOUSE_PREVIEW_PASS reports=${checked.reportCount} assertions=${checked.assertionCount} warnings=${checked.warningCount}\n`
    : `LIGHTHOUSE_PREVIEW_FAIL ${checked.codes.join(',')}\n`;
  (checked.ok ? stdout : stderr).write(summary);
  return checked.ok ? 0 : 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = runLighthousePreviewCli(process.argv.slice(2));
}
