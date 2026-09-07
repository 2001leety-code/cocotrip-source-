import { afterEach, describe, expect, it, vi } from 'vitest';
import path from 'node:path';
import {
  readLighthousePreviewArtifacts,
  runLighthousePreviewCli,
  verifyLighthousePreview,
} from '../../scripts/verify-lighthouse-preview.mjs';

const ORIGIN = 'https://cocotrip-fake-preview.vercel.app';
const PATHS = ['/', '/tours', '/charter'];
const PRIVATE_TEXT = 'fake-private-cookie-and-key-never-print';

// Matches Lighthouse 12 / LHCI 0.15.1 fields without real pages or customer data.
function report(pathname = '/') {
  return {
    lighthouseVersion: '12.6.1',
    requestedUrl: `${ORIGIN}${pathname}`,
    finalUrl: `${ORIGIN}${pathname}`,
    finalDisplayedUrl: `${ORIGIN}${pathname}`,
    mainDocumentUrl: `${ORIGIN}${pathname}`,
    fetchTime: '2026-09-07T09:08:49.000Z',
    audits: { 'document-title': { score: 1 } },
    categories: Object.fromEntries(['performance', 'accessibility', 'best-practices', 'seo']
      .map((name) => [name, { score: 0.9 }])),
  };
}

function fixture() {
  return { expectedOrigin: ORIGIN, reports: PATHS.map(report), assertionResults: [] as object[] };
}

function assertion(overrides = {}) {
  return {
    auditId: 'categories', auditProperty: 'accessibility', name: 'minScore',
    level: 'error', passed: false, url: ORIGIN + '/',
    expected: 0.85, actual: 0.84, operator: '>=', values: [0.84], ...overrides,
  };
}

function memoryArtifacts() {
  const cwd = path.resolve('fake-lighthouse-workspace');
  const directory = path.join(cwd, '.lighthouseci');
  const files = new Map<string, string>(PATHS.map((pathname, index) => [
    path.join(directory, `lhr-${1700000000000 + index}.json`), JSON.stringify(report(pathname)),
  ]));
  files.set(path.join(directory, 'assertion-results.json'), '[]');
  const links = new Set<string>();
  const filesystem = {
    lstatSync: vi.fn((filename: string) => {
      if (filename !== directory && !files.has(filename)) throw new Error(PRIVATE_TEXT);
      return {
        isSymbolicLink: () => links.has(filename),
        isDirectory: () => filename === directory,
        isFile: () => files.has(filename),
      };
    }),
    readdirSync: vi.fn(() => [...files.keys()].map((filename) => path.basename(filename))),
    readFileSync: vi.fn((filename: string) => {
      if (!files.has(filename)) throw new Error(PRIVATE_TEXT);
      return files.get(filename) || '';
    }),
  };
  return { cwd, directory, files, links, filesystem };
}

afterEach(() => vi.unstubAllGlobals());

describe('pure Lighthouse preview result verification', () => {
  it('accepts three genuine-shaped reports and the default all-passing empty assertion array', () => {
    expect(verifyLighthousePreview(fixture())).toEqual({
      ok: true, codes: [], reportCount: 3, assertionCount: 0, warningCount: 0,
    });
  });

  it('keeps warnings non-blocking and accepts includePassedAssertions output', () => {
    const input = fixture();
    input.assertionResults = [assertion({ level: 'warn' }), assertion({ passed: true, actual: 0.85 })];
    expect(verifyLighthousePreview(input)).toMatchObject({ ok: true, assertionCount: 2, warningCount: 1 });
  });

  it('uses the assertion decision without copying or lowering the accessibility threshold', () => {
    const input = fixture();
    input.assertionResults = [assertion()];
    // High raw scores do not override the existing required assertion decision.
    expect(verifyLighthousePreview(input).codes).toContain('REQUIRED_ASSERTION_FAILED');
    input.assertionResults = [assertion({ passed: true, actual: 0.85 })];
    input.reports[0].categories.performance.score = 0.2;
    expect(verifyLighthousePreview(input).ok).toBe(true);
  });

  it.each([undefined, [], [report()], [report('/'), report('/tours')]])('rejects missing reports (%j)', (reports) => {
    expect(verifyLighthousePreview({ ...fixture(), reports }).ok).toBe(false);
  });

  it('rejects a duplicated route even when the report count is three', () => {
    const input = fixture();
    input.reports[2] = report('/tours');
    expect(verifyLighthousePreview(input).codes).toEqual(expect.arrayContaining(['DUPLICATE_REPORT', 'MISSING_REPORT']));
  });

  it('rejects an extra fourth run instead of silently choosing a representative', () => {
    const input = fixture();
    input.reports.push(report());
    expect(verifyLighthousePreview(input).codes).toContain('REPORT_COUNT_MISMATCH');
  });

  it.each(['finalUrl', 'finalDisplayedUrl', 'mainDocumentUrl'] as const)('rejects foreign and wrong-path %s redirects', (field) => {
    for (const destination of ['https://vercel.com/login', 'https://elsewhere.vercel.app/', ORIGIN + '/tours']) {
      const input = fixture();
      input.reports[0][field] = destination;
      expect(verifyLighthousePreview(input).codes).toContain('FINAL_URL_MISMATCH');
    }
  });

  it('rejects query-bearing login results without exposing any URL or private report content', () => {
    const input = fixture();
    Object.assign(input.reports[0], {
      finalUrl: `https://vercel.com/login?next=${PRIVATE_TEXT}`,
      runtimeError: { code: 'NO_FCP', message: PRIVATE_TEXT },
      cookies: [{ value: PRIVATE_TEXT }],
    });
    const output = verifyLighthousePreview(input);
    expect(output.ok).toBe(false);
    expect(JSON.stringify(output)).not.toMatch(/https:|login|next=|fake-private/);
  });

  it('requires the LHCI finalUrl field even when newer display URLs are valid', () => {
    const input = fixture();
    Object.assign(input.reports[0], { finalUrl: undefined });
    expect(verifyLighthousePreview(input).codes).toContain('FINAL_URL_MISMATCH');
  });

  it('accepts a null runtime error and original reports without optional newer URL fields', () => {
    const input = fixture();
    Object.assign(input.reports[0], { runtimeError: null, mainDocumentUrl: undefined, finalDisplayedUrl: undefined });
    expect(verifyLighthousePreview(input).ok).toBe(true);
  });

  it.each(['?key=fake', '#fragment', '/', '/other'])('rejects changed requested route suffix %s', (suffix) => {
    const input = fixture();
    input.reports[1].requestedUrl += suffix;
    expect(verifyLighthousePreview(input).codes).toContain('REPORT_URL_INVALID');
  });

  it.each([{}, { code: 'NO_FCP' }, '', false, 0])('rejects every present non-null runtime error (%j)', (runtimeError) => {
    const input = fixture();
    Object.assign(input.reports[0], { runtimeError });
    expect(verifyLighthousePreview(input).codes).toContain('REPORT_RUNTIME_ERROR');
  });

  it.each([null, {}, { requestedUrl: ORIGIN + '/', finalUrl: ORIGIN + '/' }])('rejects incomplete report shapes (%j)', (invalid) => {
    expect(verifyLighthousePreview({ ...fixture(), reports: [invalid, report('/tours'), report('/charter')] }).ok).toBe(false);
  });

  it.each([null, Number.NaN, -1, 2])('rejects missing or invalid category measurement (%j)', (score) => {
    const input = fixture();
    Object.assign(input.reports[0].categories.accessibility, { score });
    expect(verifyLighthousePreview(input).codes).toContain('REPORT_SHAPE_INVALID');
  });

  it.each([null, undefined, '[]', {}, [null], [assertion({ passed: 'false' })], [assertion({ level: 'off' })], [assertion({ auditId: '' })]])(
    'rejects absent or malformed assertion data (%j)', (assertionResults) => {
      expect(verifyLighthousePreview({ ...fixture(), assertionResults }).codes).toContain('ASSERTIONS_INVALID');
    },
  );

  it.each(['https://vercel.com/login', ORIGIN + '/missing', ORIGIN + '/?cookie=fake'])('rejects unmatched assertion URLs (%s)', (url) => {
    expect(verifyLighthousePreview({ ...fixture(), assertionResults: [assertion({ url, level: 'warn' })] }).codes)
      .toContain('ASSERTION_URL_MISMATCH');
  });

  it.each(['', undefined, 'http://preview.vercel.app', 'https://cocotripkr.com', 'https://vercel.com/login',
    ORIGIN + '/tours', ORIGIN + '/?key=fake', ORIGIN + '/#fake', 'https://fake:password@preview.vercel.app',
    'https://preview.vercel.app.evil.test', 'https://preview.vercel.app:444', ' https://preview.vercel.app'])(
    'rejects invalid expected preview origins (%s)', (expectedOrigin) => {
    expect(verifyLighthousePreview({ ...fixture(), expectedOrigin }).codes).toEqual(['EXPECTED_ORIGIN_INVALID']);
    },
  );
});

describe('offline fixed-directory CLI adapter', () => {
  it('reads original lhr files, ignoring treosh export duplicates and manifest-provided paths', () => {
    const memory = memoryArtifacts();
    memory.files.set(path.join(memory.directory, 'preview.report.json'), PRIVATE_TEXT);
    memory.files.set(path.join(memory.directory, 'manifest.json'), JSON.stringify([{ jsonPath: '../../private.json' }]));
    const artifacts = readLighthousePreviewArtifacts(memory.cwd, memory.filesystem);
    expect(verifyLighthousePreview({ expectedOrigin: ORIGIN, ...artifacts }).ok).toBe(true);
    expect(memory.filesystem.readFileSync.mock.calls.map(([filename]) => path.basename(filename))).toEqual([
      'lhr-1700000000000.json', 'lhr-1700000000001.json', 'lhr-1700000000002.json', 'assertion-results.json',
    ]);
  });

  it.each(['directory', 'report', 'assertions'])('refuses symlinked %s without reading its contents', (kind) => {
    const memory = memoryArtifacts();
    const target = kind === 'directory' ? memory.directory : path.join(memory.directory,
      kind === 'report' ? 'lhr-1700000000000.json' : 'assertion-results.json');
    memory.links.add(target);
    expect(readLighthousePreviewArtifacts(memory.cwd, memory.filesystem).error).toBeTruthy();
    expect(memory.filesystem.readFileSync.mock.calls.some(([filename]) => filename === target)).toBe(false);
  });

  it.each(['missing', 'malformed'])('rejects %s assertion file rather than treating it as []', (kind) => {
    const memory = memoryArtifacts();
    const filename = path.join(memory.directory, 'assertion-results.json');
    if (kind === 'missing') memory.files.delete(filename);
    else memory.files.set(filename, PRIVATE_TEXT);
    expect(readLighthousePreviewArtifacts(memory.cwd, memory.filesystem)).toEqual({ error: 'ARTIFACTS_UNREADABLE' });
  });

  it('rejects malformed report JSON without exposing parser error contents', () => {
    const memory = memoryArtifacts();
    memory.files.set(path.join(memory.directory, 'lhr-1700000000000.json'), PRIVATE_TEXT);
    const stderr = { write: vi.fn() };
    expect(runLighthousePreviewCli(['--expected-origin', ORIGIN], { ...memory, stderr })).toBe(1);
    expect(stderr.write).toHaveBeenCalledWith('LIGHTHOUSE_PREVIEW_FAIL ARTIFACTS_UNREADABLE\n');
  });

  it('rejects a missing original even when an exported report is present', () => {
    const memory = memoryArtifacts();
    memory.files.delete(path.join(memory.directory, 'lhr-1700000000000.json'));
    memory.files.set(path.join(memory.directory, 'preview.report.json'), JSON.stringify(report()));
    expect(readLighthousePreviewArtifacts(memory.cwd, memory.filesystem)).toEqual({ error: 'REPORT_COUNT_MISMATCH' });
    expect(memory.filesystem.readFileSync).not.toHaveBeenCalled();
  });

  it('returns CLI exit codes with safe summaries and makes no external requests', () => {
    const fetch = vi.fn(() => { throw new Error('NETWORK_FORBIDDEN'); });
    vi.stubGlobal('fetch', fetch);
    const memory = memoryArtifacts();
    const stdout = { write: vi.fn() };
    const stderr = { write: vi.fn() };
    const options = { ...memory, stdout, stderr };
    expect(runLighthousePreviewCli(['--expected-origin', ORIGIN], options)).toBe(0);
    expect(stdout.write).toHaveBeenCalledWith('LIGHTHOUSE_PREVIEW_PASS reports=3 assertions=0 warnings=0\n');
    memory.files.set(path.join(memory.directory, 'assertion-results.json'), JSON.stringify([
      assertion({ message: PRIVATE_TEXT, url: `https://vercel.com/login?key=${PRIVATE_TEXT}` }),
    ]));
    expect(runLighthousePreviewCli(['--expected-origin', ORIGIN], options)).toBe(1);
    expect(stderr.write).toHaveBeenCalledWith('LIGHTHOUSE_PREVIEW_FAIL ASSERTION_URL_MISMATCH,REQUIRED_ASSERTION_FAILED\n');
    expect(JSON.stringify([...stdout.write.mock.calls, ...stderr.write.mock.calls])).not.toContain(PRIVATE_TEXT);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('rejects arbitrary file arguments and invalid origins before reading any artifact', () => {
    const memory = memoryArtifacts();
    const stderr = { write: vi.fn() };
    expect(runLighthousePreviewCli(['--reports-dir', `../${PRIVATE_TEXT}`], { ...memory, stderr })).toBe(1);
    expect(runLighthousePreviewCli(['--expected-origin', `${ORIGIN}/?key=${PRIVATE_TEXT}`], { ...memory, stderr })).toBe(1);
    expect(memory.filesystem.lstatSync).not.toHaveBeenCalled();
    expect(JSON.stringify(stderr.write.mock.calls)).not.toContain(PRIVATE_TEXT);
  });
});
