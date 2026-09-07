import { lstatSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const EXPECTED_PATHS = ['/', '/tours', '/charter'];
const REPORT_NAME = /^lhr-\d+\.json$/;
const CATEGORIES = ['performance', 'accessibility', 'best-practices', 'seo'];

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

export function runLighthousePreviewCli(args, {
  cwd = process.cwd(), filesystem, stdout = process.stdout, stderr = process.stderr,
} = {}) {
  let checked;
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
