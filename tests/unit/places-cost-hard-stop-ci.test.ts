import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { BrowserContext, Request, Route } from '@playwright/test';
import { describe, expect, it, vi } from 'vitest';
import {
  assertNoPaidApiAttempts,
  installPaidApiGuard,
  isGooglePlacesPaidUrl,
  redactPaidApiUrl,
} from '../e2e/fixtures/paid-api-network-guard';
import { resolvePlaywrightBaseUrl } from '../playwright-base-url';

const repoFile = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

function fakeRequest(url: string): Request {
  return { url: () => url } as Request;
}

describe('Google Places/Maps 자동 테스트 비용 hard-stop', () => {
  it.each([
    'https://maps.googleapis.com/maps/api/place/photo?key=secret&photo_reference=ref',
    'https://places.googleapis.com/v1/places/abc',
    'https://geo.maps.googleapis.com/some-future-path',
    'https://preview.example/api/place-photo?ref=secret',
    'https://preview.example/api/place-photo/',
    'https://preview.example/api/%70lace-photo?ref=secret',
    'https://preview.example/api/%ZZplace-photo?ref=secret',
    'https://preview.example/api/image-proxy?url=https%3A%2F%2Fmaps.googleapis.com%2Fmaps%2Fapi%2Fplace%2Fphoto%3Fkey%3Dsecret',
    'https://preview.example/api/image-proxy?url=https%253A%252F%252Fplaces.googleapis.com%252Fv1%252Fplaces%252Fabc',
    'https://preview.example/api/image-proxy?url=https%3A%2F%2Fold-preview.vercel.app%2Fapi%2Fplace-photo%3Fref%3Dsecret',
  ])('유료 경로를 판별한다: %s', (url) => {
    expect(isGooglePlacesPaidUrl(url)).toBe(true);
  });

  it.each([
    'https://maps.googleapis.com.evil.example/maps/api/place/photo',
    'https://example.com/maps.googleapis.com/maps/api/place/photo',
    'https://preview.example/api/place-photo-copy',
    'https://preview.example/api/image-proxy?url=https%3A%2F%2Fmedia-cdn.tripadvisor.com%2Fphoto.jpg',
    'https://fonts.googleapis.com/css2?family=Inter',
  ])('닮은 무료/외부 경로를 오탐하지 않는다: %s', (url) => {
    expect(isGooglePlacesPaidUrl(url)).toBe(false);
  });

  it('query를 지운 URL만 실패 메시지에 남긴다', () => {
    const request = fakeRequest(
      'https://maps.googleapis.com/maps/api/place/photo?key=do-not-log&photo_reference=private-ref',
    );
    const traffic = { attempted: [request], blocked: [request] };

    expect(redactPaidApiUrl(request.url())).toBe('https://maps.googleapis.com/maps/api/place/photo');
    expect(() => assertNoPaidApiAttempts(traffic)).toThrow(/유료 API 요청 시도 1건/);
    try {
      assertNoPaidApiAttempts(traffic);
    } catch (error) {
      expect(String(error)).not.toContain('do-not-log');
      expect(String(error)).not.toContain('private-ref');
    }
  });

  it('context에서 유료 요청은 abort하고 일반 요청은 fallback한다', async () => {
    const listeners = new Map<string, Array<(request: Request) => void>>();
    let routeHandler: ((route: Route) => unknown) | null = null;
    const context = {
      on: vi.fn((event: string, handler: (request: Request) => void) => {
        const handlers = listeners.get(event) || [];
        handlers.push(handler);
        listeners.set(event, handlers);
      }),
      route: vi.fn(async (_pattern: string, handler: (route: Route) => unknown) => {
        routeHandler = handler;
      }),
    } as unknown as BrowserContext;

    const traffic = await installPaidApiGuard(context);
    expect(routeHandler).not.toBeNull();

    const paidRequest = fakeRequest('https://preview.example/api/place-photo?ref=private-ref');
    for (const listener of listeners.get('request') || []) listener(paidRequest);
    const paidAbort = vi.fn(async () => undefined);
    const paidFallback = vi.fn(async () => undefined);
    await routeHandler!({
      request: () => paidRequest,
      abort: paidAbort,
      fallback: paidFallback,
    } as unknown as Route);

    expect(paidAbort).toHaveBeenCalledOnce();
    expect(paidFallback).not.toHaveBeenCalled();
    expect(traffic.attempted).toEqual([paidRequest]);
    expect(traffic.blocked).toEqual([paidRequest]);

    const fontRequest = fakeRequest('https://fonts.googleapis.com/css2?family=Inter');
    const fontAbort = vi.fn(async () => undefined);
    const fontFallback = vi.fn(async () => undefined);
    await routeHandler!({
      request: () => fontRequest,
      abort: fontAbort,
      fallback: fontFallback,
    } as unknown as Route);

    expect(fontAbort).not.toHaveBeenCalled();
    expect(fontFallback).toHaveBeenCalledOnce();
  });
});

describe('Playwright CI 비용 차단 계약', () => {
  it('CI에서는 BASE_URL 누락/공백을 즉시 거부한다', () => {
    expect(() => resolvePlaywrightBaseUrl({ CI: 'true' })).toThrow(/BASE_URL/);
    expect(() => resolvePlaywrightBaseUrl({ CI: '1', BASE_URL: '   ' })).toThrow(/BASE_URL/);
    expect(resolvePlaywrightBaseUrl({ CI: 'true', BASE_URL: ' https://preview.example ' }))
      .toBe('https://preview.example');
  });

  it('non-CI 기본 주소는 운영이 아니라 로컬 개발 서버다', () => {
    expect(resolvePlaywrightBaseUrl({})).toBe('http://127.0.0.1:5173');
    expect(resolvePlaywrightBaseUrl({ CI: '', BASE_URL: '   ' })).toBe('http://127.0.0.1:5173');
  });

  it('두 config가 fail-closed resolver와 service-worker 차단을 사용한다', () => {
    for (const config of ['playwright.config.ts', 'playwright.visual.config.ts']) {
      const source = repoFile(config);
      expect(source).toContain('baseURL: resolvePlaywrightBaseUrl()');
      expect(source).toContain("serviceWorkers: 'block'");
      expect(source).not.toMatch(/baseURL:\s*process\.env\.BASE_URL\s*\|\|\s*['"]https:\/\/cocotripkr\.com/);
    }
  });

  it('공용 fixture와 global setup이 첫 이동부터 유료 API guard를 설치한다', () => {
    const fixture = repoFile('tests/e2e/fixtures/analytics-guard.ts');
    expect(fixture).toContain('await installPaidApiGuard(context)');
    expect(fixture).toContain('assertNoPaidApiAttempts(paidApi)');

    const setup = repoFile('tests/global-setup.ts');
    const installAt = setup.indexOf('await installPaidApiGuard(ctx)');
    const gotoAt = setup.indexOf('await page.goto(');
    expect(installAt).toBeGreaterThan(-1);
    expect(gotoAt).toBeGreaterThan(installAt);
    expect(setup).toContain("browser.newContext({ serviceWorkers: 'block' })");
    expect(setup).toContain('assertNoPaidApiAttempts(paidApi)');
  });

  it('모든 visual spec이 공용 fixture를 거쳐 guard를 상속한다', () => {
    const visualSpecs = readdirSync(resolve(process.cwd(), 'tests/visual'))
      .filter((name) => name.endsWith('.spec.ts'));
    expect(visualSpecs.length).toBeGreaterThan(0);
    for (const spec of visualSpecs) {
      expect(repoFile(`tests/visual/${spec}`)).toMatch(/from ['"][^'"]*e2e\/fixtures\/analytics-guard['"]/);
    }
  });

  it('PR workflow에는 Google Places 키를 넣지 않는다', () => {
    const workflowDir = resolve(process.cwd(), '.github/workflows');
    const prWorkflows = readdirSync(workflowDir)
      .filter((name) => /^pr-.*\.ya?ml$/.test(name));
    expect(prWorkflows.length).toBeGreaterThan(0);
    for (const workflow of prWorkflows) {
      const source = readFileSync(resolve(workflowDir, workflow), 'utf8');
      expect(source, workflow).not.toMatch(/(?:VITE_)?GOOGLE_PLACES_API_KEY/);
    }
  });
});
