import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import {
  assertNoAnalyticsEscaped,
  installAnalyticsGuard,
} from './e2e/fixtures/analytics-network-guard';
import {
  assertNoPaidApiAttempts,
  installPaidApiGuard,
} from './e2e/fixtures/paid-api-network-guard';
import { resolvePlaywrightBaseUrl } from './playwright-base-url';

/**
 * Vercel Deployment Protection bypass — 쿠키 방식 (2026-06-28).
 *
 * 기존: playwright config 의 use.extraHTTPHeaders 로 모든 요청에
 * `x-vercel-protection-bypass` 헤더를 주입했다. 그런데 이 헤더가 gstatic 폰트
 * (fonts.gstatic.com — cross-origin) 요청에도 붙어 CORS preflight 가 거부됨
 * (Access-Control-Allow-Headers 에 커스텀 헤더 없음) → 폰트 로드 실패 console
 * error → visual / wizard E2E spec 이 fail. #1006 CI 에서 발견.
 * prod 사용자는 이 헤더가 없으므로 prod 폰트는 정상 = prod 영향 0 (preview 검증 환경만 문제).
 *
 * 해결: query 로 1회 접근 + `x-vercel-set-bypass-cookie=true` → Vercel 이 bypass
 * 쿠키를 set → storageState 로 저장. 이후 테스트는 same-origin 쿠키로 인증되고,
 * cross-origin(gstatic) 요청엔 커스텀 헤더가 안 붙어 폰트 CORS 가 정상 동작.
 * Docs: https://vercel.com/docs/deployment-protection/methods-to-bypass-deployment-protection
 */
export const BYPASS_STATE_PATH = 'tests/.auth/vercel-bypass.json';

export default async function globalSetup() {
  const secret = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
  const baseURL = resolvePlaywrightBaseUrl();
  // secret 없으면 = 보호가 없는 로컬/명시 대상 → storageState 불필요.
  // config use.storageState 도 동일 조건으로 undefined.
  if (!secret) return;

  mkdirSync(dirname(BYPASS_STATE_PATH), { recursive: true });

  const browser = await chromium.launch();
  try {
    const ctx = await browser.newContext({ serviceWorkers: 'block' });
    const analytics = await installAnalyticsGuard(ctx);
    const paidApi = await installPaidApiGuard(ctx);
    const page = await ctx.newPage();
    const url = `${baseURL}/?x-vercel-protection-bypass=${encodeURIComponent(secret)}&x-vercel-set-bypass-cookie=true`;
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await ctx.storageState({ path: BYPASS_STATE_PATH });
    assertNoPaidApiAttempts(paidApi);
    assertNoAnalyticsEscaped(analytics);
  } finally {
    await browser.close();
  }
}
