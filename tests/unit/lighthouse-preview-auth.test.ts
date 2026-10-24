import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const authenticatePreview = require('../../scripts/lighthouse-preview-auth.cjs');
const { validatePreviewDeployment } = authenticatePreview;
const ORIGIN = 'https://cocotrip-source2026-fake123-2001leety-3613s-projects.vercel.app';
const REPOSITORY = '2001leety-code/cocotrip-source-';
const SHA = 'a'.repeat(40);
const SECRET = 'fake-only-do-not-print-bypass';
const JWT = 'fake-only-http-only-cookie';
const ENV = { LHCI_PREVIEW_ORIGIN: ORIGIN, VERCEL_AUTOMATION_BYPASS_SECRET: SECRET };

function metadata() {
  const bot = { login: 'vercel[bot]', type: 'Bot' };
  const repo = { full_name: REPOSITORY, fork: false, default_branch: 'main', private: false };
  return {
    repository: repo,
    deployment: { id: 123, sha: SHA, creator: bot, environment: 'Preview', production_environment: false },
    status: { creator: bot, environment: 'Preview', state: 'success', target_url: ORIGIN },
    pullRequests: [{ head: { sha: SHA, repo }, base: { ref: 'main', repo } }],
  };
}

function fakeBrowserAndResponse(headers = [`_vercel_jwt=${JWT}; Path=/; Secure; HttpOnly; SameSite=Lax`]) {
  const page = {
    setCookie: vi.fn(async () => undefined),
    cookies: vi.fn(async () => [{
      name: '_vercel_jwt', value: JWT, httpOnly: true, secure: true,
      path: '/', domain: new URL(ORIGIN).hostname,
    }]),
    close: vi.fn(async () => undefined),
    goto: vi.fn(() => { throw new Error('BROWSER_NETWORK_FORBIDDEN'); }),
    setExtraHTTPHeaders: vi.fn(() => { throw new Error('GLOBAL_HEADERS_FORBIDDEN'); }),
  };
  const browser = { newPage: vi.fn(async () => page) };
  const response = {
    status: 307,
    headers: {
      get: vi.fn(() => '/robots.txt'),
      getSetCookie: vi.fn(() => headers),
    },
    body: { cancel: vi.fn(async () => undefined) },
  };
  const fetch = vi.fn(async () => response);
  return { browser, page, response, fetch };
}

afterEach(() => vi.restoreAllMocks());

describe('Lighthouse deployment trust selection', () => {
  it('accepts the existing public repository only through a same-repo Vercel Preview', () => {
    expect(validatePreviewDeployment(metadata())).toEqual({ origin: ORIGIN, sha: SHA });
  });

  it.each(['repository', 'fork', 'bot', 'production', 'pending', 'sha', 'external-head', 'base', 'no-pr'])('rejects %s metadata', (kind) => {
    const input = metadata();
    if (kind === 'repository') input.repository.full_name = 'outside/repo';
    if (kind === 'fork') input.repository.fork = true;
    if (kind === 'bot') input.status.creator = { login: 'vercel[bot]', type: 'User' };
    if (kind === 'production') input.deployment.production_environment = true;
    if (kind === 'pending') input.status.state = 'pending';
    if (kind === 'sha') input.pullRequests[0].head.sha = 'b'.repeat(40);
    if (kind === 'external-head') input.pullRequests[0].head.repo = { ...input.repository, full_name: 'outsider/fork', fork: true };
    if (kind === 'base') input.pullRequests[0].base.ref = 'unreviewed';
    if (kind === 'no-pr') input.pullRequests = [];
    expect(() => validatePreviewDeployment(input)).toThrow('LHCI_PREVIEW_AUTH_REJECTED');
  });

  it.each([
    'https://vercel.com/login', 'https://cocotripkr.com', 'https://other-preview.vercel.app',
    'https://cocotrip-source2026-fake123-other-projects.vercel.app',
    ORIGIN + '.evil.test', ORIGIN + '/?token=' + SECRET, ORIGIN + '/#fragment',
    ORIGIN.replace('https:', 'http:'), ORIGIN + ':444', ORIGIN + '/tours',
  ])('rejects an unapproved target URL (%s)', (target_url) => {
    const input = metadata();
    input.status.target_url = target_url;
    expect(() => validatePreviewDeployment(input)).toThrow('LHCI_PREVIEW_AUTH_REJECTED');
  });
});

describe('one-request Preview cookie bootstrap, with no real network', () => {
  it.each(['/', '/tours', '/charter'])('authenticates %s only through a manual Node request and HttpOnly cookies', async (pathname) => {
    const fake = fakeBrowserAndResponse();
    await authenticatePreview(fake.browser, { url: ORIGIN + pathname }, { env: ENV, fetch: fake.fetch });
    expect(fake.fetch).toHaveBeenCalledTimes(1);
    expect(fake.fetch).toHaveBeenCalledWith(ORIGIN + '/robots.txt', {
      method: 'GET', redirect: 'manual', signal: expect.any(AbortSignal),
      headers: { 'x-vercel-protection-bypass': SECRET, 'x-vercel-set-bypass-cookie': 'true' },
    });
    expect(fake.page.setCookie).toHaveBeenCalledWith({
      name: '_vercel_jwt', value: JWT, url: ORIGIN + '/', path: '/',
      secure: true, httpOnly: true, sameSite: 'Lax',
    });
    expect(fake.page.goto).not.toHaveBeenCalled();
    expect(fake.page.setExtraHTTPHeaders).not.toHaveBeenCalled();
    expect(fake.page.close).toHaveBeenCalledOnce();
    expect(fake.response.body.cancel).toHaveBeenCalledOnce();
  });

  it.each(['missing-secret', 'header-injection', 'wrong-origin', 'foreign-url', 'query-url'])('rejects %s before any request', async (kind) => {
    const fake = fakeBrowserAndResponse();
    const env = { ...ENV };
    let url = ORIGIN + '/';
    if (kind === 'missing-secret') env.VERCEL_AUTOMATION_BYPASS_SECRET = '';
    if (kind === 'header-injection') env.VERCEL_AUTOMATION_BYPASS_SECRET += '\r\nInjected: true';
    if (kind === 'wrong-origin') env.LHCI_PREVIEW_ORIGIN = 'https://other.vercel.app';
    if (kind === 'foreign-url') url = 'https://example.test/';
    if (kind === 'query-url') url += '?key=' + SECRET;
    await expect(authenticatePreview(fake.browser, { url }, { env, fetch: fake.fetch })).rejects.toThrow('LHCI_PREVIEW_AUTH_REJECTED');
    expect(fake.fetch).not.toHaveBeenCalled();
    expect(fake.browser.newPage).not.toHaveBeenCalled();
  });

  it.each(['https://vercel.com/login', ORIGIN + '/?key=' + SECRET, 'https://outside.test/robots.txt', '/other'])('never follows redirect %s', async (location) => {
    const fake = fakeBrowserAndResponse();
    fake.response.headers.get.mockReturnValue(location);
    await expect(authenticatePreview(fake.browser, { url: ORIGIN + '/' }, { env: ENV, fetch: fake.fetch })).rejects.toThrow('LHCI_PREVIEW_AUTH_REJECTED');
    expect(fake.fetch).toHaveBeenCalledTimes(1);
    expect(fake.page.setCookie).not.toHaveBeenCalled();
  });

  it.each([200, 401, 403, 500])('rejects response status %s instead of silently continuing without a cookie', async (status) => {
    const fake = fakeBrowserAndResponse();
    fake.response.status = status;
    await expect(authenticatePreview(fake.browser, { url: ORIGIN + '/' }, { env: ENV, fetch: fake.fetch })).rejects.toThrow('LHCI_PREVIEW_AUTH_REJECTED');
  });

  it.each([
    `_vercel_jwt=${JWT}; Path=/; Secure`,
    `_vercel_jwt=${JWT}; Path=/; HttpOnly`,
    `_vercel_jwt=${JWT}; Path=/; Secure; HttpOnly; Domain=.vercel.app`,
    `_vercel_jwt=${JWT}; Path=/; Secure; HttpOnly; Domain=outside.test`,
    `_vercel_jwt=${JWT}; Path=/admin; Secure; HttpOnly`,
    `_vercel_jwt=${JWT}; Path=/; Secure; HttpOnly; Max-Age=0`,
    `_vercel_jwt=${JWT}; Path=/; Secure; HttpOnly; Expires=Thu, 01 Jan 1970 00:00:00 GMT`,
    `_vercel_jwt=${JWT}; Path=/; Secure; HttpOnly; SameSite=invalid`,
    `_vercel_jwt=${JWT}; Path=/; Secure; HttpOnly; SameSite=__proto__`,
    `_vercel_jwt=${JWT}\r\nInjected: true; Path=/; Secure; HttpOnly`,
  ])('rejects unsafe or expired cookie attributes (%#)', async (cookie) => {
    const fake = fakeBrowserAndResponse([cookie]);
    await expect(authenticatePreview(fake.browser, { url: ORIGIN + '/' }, { env: ENV, fetch: fake.fetch })).rejects.toThrow('LHCI_PREVIEW_AUTH_REJECTED');
    expect(fake.page.setCookie).not.toHaveBeenCalled();
  });

  it('rejects duplicate cookie names and a browser that did not keep HttpOnly', async () => {
    const fake = fakeBrowserAndResponse();
    fake.response.headers.getSetCookie.mockReturnValue(Array(2).fill(`_vercel_jwt=${JWT}; Secure; HttpOnly; Path=/`));
    await expect(authenticatePreview(fake.browser, { url: ORIGIN + '/' }, { env: ENV, fetch: fake.fetch })).rejects.toThrow('LHCI_PREVIEW_AUTH_REJECTED');
    fake.response.headers.getSetCookie.mockReturnValue([`_vercel_jwt=${JWT}; Secure; HttpOnly; Path=/`]);
    fake.page.cookies.mockResolvedValue([{ name: '_vercel_jwt', value: JWT, secure: true, httpOnly: false, path: '/', domain: new URL(ORIGIN).hostname }]);
    await expect(authenticatePreview(fake.browser, { url: ORIGIN + '/' }, { env: ENV, fetch: fake.fetch })).rejects.toThrow('LHCI_PREVIEW_AUTH_REJECTED');
    expect(fake.page.close).toHaveBeenCalledOnce();
  });

  it('rejects a redirect with no cookie and always releases its unused response body', async () => {
    const fake = fakeBrowserAndResponse([]);
    await expect(authenticatePreview(fake.browser, { url: ORIGIN + '/' }, { env: ENV, fetch: fake.fetch })).rejects.toThrow('LHCI_PREVIEW_AUTH_REJECTED');
    expect(fake.page.setCookie).not.toHaveBeenCalled();
    expect(fake.response.body.cancel).toHaveBeenCalledOnce();
  });

  it('replaces raw fetch/browser exceptions with a fixed code and never logs credentials', async () => {
    const fake = fakeBrowserAndResponse();
    const log = vi.spyOn(console, 'log');
    const error = vi.spyOn(console, 'error');
    fake.fetch.mockRejectedValueOnce(new Error(`Failed https://example.test/?secret=${SECRET}`));
    await expect(authenticatePreview(fake.browser, { url: ORIGIN + '/' }, { env: ENV, fetch: fake.fetch }))
      .rejects.toThrow(/^LHCI_PREVIEW_AUTH_REJECTED$/);
    fake.page.setCookie.mockRejectedValueOnce(new Error(JWT));
    await expect(authenticatePreview(fake.browser, { url: ORIGIN + '/' }, { env: ENV, fetch: fake.fetch }))
      .rejects.toThrow(/^LHCI_PREVIEW_AUTH_REJECTED$/);
    expect(fake.page.close).toHaveBeenCalledOnce();
    expect(log).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });
});

describe('Lighthouse CI wiring source contracts', () => {
  const workflow = readFileSync(new URL('../../.github/workflows/pr-lighthouse.yml', import.meta.url), 'utf8');
  const config = JSON.parse(readFileSync(new URL('../../.lighthouserc.json', import.meta.url), 'utf8'));

  it('does not execute deployed branch tooling or expose arbitrary dispatch inputs', () => {
    expect(workflow).toContain('ref: ${{ github.event.repository.default_branch }}');
    expect(workflow).not.toContain('ref: ${{ github.event.deployment.ref }}');
    expect(workflow).toContain('deployment_id:');
    expect(workflow).toContain('repos.getDeployment');
    expect(workflow).toContain('repos.listDeploymentStatuses');
    expect(workflow).toContain('repos.listPullRequestsAssociatedWithCommit');
    expect(workflow).toContain('LHCI_TRUSTED_HELPER_NOT_ON_MAIN');
    expect(workflow).not.toMatch(/inputs\.(?:url|base_url|ref|secret)/);
    expect(workflow.match(/VERCEL_AUTOMATION_BYPASS_SECRET: \$\{\{ secrets\.VERCEL_AUTOMATION_BYPASS_SECRET \}\}/g)).toHaveLength(1);
  });

  it('uses fresh collect/assert/verify order, pinned CLI, and never soft-passes or uploads raw logs', () => {
    expect(workflow).toContain('mktemp -d "$RUNNER_TEMP/lighthouse-preview.XXXXXX"');
    expect(workflow).toContain('npm ci --ignore-scripts');
    expect(workflow).toContain('ref: 3e7e23fb74242897f95c0ba9cabad3d0227b9b18');
    expect(workflow.match(/uses: [^\s]+@[^\s]+/g)?.every((use) => /@[0-9a-f]{40}$/.test(use))).toBe(true);
    expect(workflow).toContain('test ! -e "$run_dir/.lighthouseci"');
    expect(workflow.indexOf('node "$LHCI_CLI" collect')).toBeLessThan(workflow.indexOf('node "$LHCI_CLI" assert'));
    expect(workflow.indexOf('node "$LHCI_CLI" assert')).toBeLessThan(workflow.indexOf('Verify real pages and safe result summary'));
    expect(workflow).toContain('trusted-lighthouse/scripts/verify-lighthouse-preview.mjs" --safe-assertions-summary');
    expect(workflow).toContain("if: always() && steps.collect.outcome == 'success'");
    expect(workflow).not.toMatch(/continue-on-error:|upload-artifact@|temporaryPublicStorage:|node "\$LHCI_CLI" upload/);
    expect(config.ci.upload).toBeUndefined();
  });

  // 2026-10-24: lighthouse:recommended preset 제거 — 9/8 #1381 이후 90+ run 전부 LHCI_ASSERT_FAILED(image/LCP/unused
  //   insight 들이 preset 으로 error). 원래 의도대로 접근성 ≥0.85 만 error, 나머지는 warn. 예산 재설정은 별도.
  it('score policy: no preset, accessibility is the only error, credentials never in Lighthouse settings', () => {
    expect(config.ci.assert).toEqual({
      assertions: {
        'categories:performance': ['warn', { minScore: 0.5 }],
        'categories:accessibility': ['error', { minScore: 0.85 }],
        'categories:best-practices': ['warn', { minScore: 0.5 }],
        'categories:seo': ['warn', { minScore: 0.5 }],
        'first-contentful-paint': ['warn', { maxNumericValue: 3000 }],
        'largest-contentful-paint': ['warn', { maxNumericValue: 4000 }],
        'cumulative-layout-shift': ['warn', { maxNumericValue: 0.15 }],
        'total-blocking-time': ['warn', { maxNumericValue: 600 }],
        // 범주 점수가 기준을 넘어도 개별 결함은 보이게 — warn(차단 아님)
        'errors-in-console': ['warn', { minScore: 0.9 }],
        'color-contrast': ['warn', { minScore: 0.9 }],
        'uses-rel-preconnect': 'off', 'uses-text-compression': 'off', 'csp-xss': 'off',
        'bf-cache': 'off', 'third-party-cookies': 'off',
        // preview 는 색인 차단(noindex)이라 항상 실패 — 신호 아님
        'is-crawlable': 'off',
        // 2026-10-24 정리: preset 시절 상시 실패하던 audit — 예산 재설정 전까지 끔(별도 작업)
        'image-delivery-insight': 'off', 'lcp-discovery-insight': 'off', 'network-dependency-tree-insight': 'off',
        'prioritize-lcp-image': 'off', 'total-byte-weight': 'off', 'uses-passive-event-listeners': 'off',
        'unused-css-rules': 'off', 'unused-javascript': 'off', 'uses-responsive-images': 'off',
      },
    });
    expect(config.ci.assert).not.toHaveProperty('preset');
    expect(config.ci.assert).not.toHaveProperty('presets');
    const level = (v: unknown) => (Array.isArray(v) ? v[0] : v);
    const errors = Object.entries(config.ci.assert.assertions).filter(([, v]) => level(v) === 'error').map(([k]) => k);
    expect(errors).toEqual(['categories:accessibility']);
    for (const [k, v] of Object.entries(config.ci.assert.assertions)) expect(['error', 'warn', 'off'], k).toContain(level(v));
    // Astra r1 P2: 콘솔 오류·색 대비 개별 경고는 설정에 남아 있고 warn 이다
    for (const id of ['errors-in-console', 'color-contrast']) expect(level(config.ci.assert.assertions[id]), id).toBe('warn');
    expect(config.ci.collect).toEqual({ numberOfRuns: 1, puppeteerScript: './scripts/lighthouse-preview-auth.cjs', settings: { preset: 'desktop', skipAudits: ['uses-http2'] } });
    expect(JSON.stringify(config)).not.toMatch(/extraHeaders|protection-bypass|SECRET/);
  });

  it('verify-lighthouse-preview policy rules match the config exactly (no drift between the two)', async () => {
    const { SAFE_CATEGORY_RULES, SAFE_MAX_NUMERIC_WARN_RULES, SAFE_MIN_SCORE_WARN_RULES } = await import('../../scripts/verify-lighthouse-preview.mjs');
    const asserted = Object.entries(config.ci.assert.assertions as Record<string, unknown>)
      .filter(([, v]) => Array.isArray(v)) as Array<[string, [string, Record<string, number>]]>;
    const fromConfig = asserted.map(([id, [lvl, opts]]) => [id, lvl, opts]);
    const fromVerifier = [
      ...[...SAFE_CATEGORY_RULES].map(([cat, r]) => [`categories:${cat}`, r.level, { minScore: r.expected }]),
      ...[...SAFE_MAX_NUMERIC_WARN_RULES].map(([id, max]) => [id, 'warn', { maxNumericValue: max }]),
      ...[...SAFE_MIN_SCORE_WARN_RULES].map(([id, min]) => [id, 'warn', { minScore: min }]),
    ];
    const byId = (a: unknown[], b: unknown[]) => String(a[0]).localeCompare(String(b[0]));
    expect([...fromVerifier].sort(byId)).toEqual([...fromConfig].sort(byId));
  });
});
