/**
 * A1-2 (2026-05-24): admin PostHog query host resolution + error formatting.
 *
 * Root cause of 403:
 *   백엔드 HOST default 가 `https://us.i.posthog.com` (PostHog ingestion host, public).
 *   `/api/projects/<id>/insights/trend/` 는 PostHog private endpoint — query host
 *   (`https://us.posthog.com`) 로 가야 함. ingestion host 는 query 거부 → 403.
 *
 * Fix:
 *   1. resolvePosthogQueryHost(rawHost) 도입 — default `https://us.posthog.com`.
 *   2. 운영자가 실수로 ingestion host 입력 시 query host 로 자동 교정.
 *   3. formatPosthogError(label, status, detail) — 401/403/404 를 운영자가 어떤
 *      ENV 를 손봐야 하는지 즉시 알 수 있게 분기.
 *
 * 회귀 방지: HOST default 가 다시 `us.i.posthog.com` 으로 되돌아가면 prod 403
 *           재발 — 본 unit test 가 차단.
 */
import { describe, it, expect } from 'vitest';
// @ts-expect-error — JS module
import { resolvePosthogQueryHost, formatPosthogError } from '../../api/_shared/posthog-host.js';

describe('A1-2 resolvePosthogQueryHost', () => {
  it('empty / undefined → US Cloud query host default', () => {
    expect(resolvePosthogQueryHost(undefined)).toBe('https://us.posthog.com');
    expect(resolvePosthogQueryHost('')).toBe('https://us.posthog.com');
    expect(resolvePosthogQueryHost('   ')).toBe('https://us.posthog.com');
  });

  it('default 는 절대 ingestion host (us.i.posthog.com) 가 아님 — A1-2 회귀 차단', () => {
    // 만약 default 가 us.i.posthog.com 으로 돌아가면 prod 403 재발.
    expect(resolvePosthogQueryHost(undefined)).not.toMatch(/us\.i\.posthog\.com/);
  });

  it('운영자가 실수로 us.i.posthog.com (ingestion) 입력 → us.posthog.com (query) 로 자동 교정', () => {
    expect(resolvePosthogQueryHost('https://us.i.posthog.com')).toBe('https://us.posthog.com');
    expect(resolvePosthogQueryHost('https://us.i.posthog.com/')).toBe('https://us.posthog.com');
    expect(resolvePosthogQueryHost('http://us.i.posthog.com')).toBe('https://us.posthog.com');
  });

  it('운영자가 실수로 eu.i.posthog.com (ingestion) 입력 → eu.posthog.com (query) 로 자동 교정', () => {
    expect(resolvePosthogQueryHost('https://eu.i.posthog.com')).toBe('https://eu.posthog.com');
  });

  it('명시적으로 us.posthog.com 입력 → 그대로 유지', () => {
    expect(resolvePosthogQueryHost('https://us.posthog.com')).toBe('https://us.posthog.com');
    expect(resolvePosthogQueryHost('https://us.posthog.com/')).toBe('https://us.posthog.com');
  });

  it('명시적으로 eu.posthog.com 입력 → 그대로 유지 (EU Cloud)', () => {
    expect(resolvePosthogQueryHost('https://eu.posthog.com')).toBe('https://eu.posthog.com');
  });

  it('self-host 커스텀 host 그대로 유지', () => {
    expect(resolvePosthogQueryHost('https://posthog.mycompany.com')).toBe('https://posthog.mycompany.com');
  });

  it('whitespace trim', () => {
    expect(resolvePosthogQueryHost('  https://us.posthog.com  ')).toBe('https://us.posthog.com');
  });
});

describe('A1-2 formatPosthogError — operator-actionable message', () => {
  it('401 → POSTHOG_PERSONAL_API_KEY 갱신 안내', () => {
    const msg = formatPosthogError('trend', 401, '{"detail":"Invalid token"}');
    expect(msg).toMatch(/401/);
    expect(msg).toMatch(/POSTHOG_PERSONAL_API_KEY/);
    expect(msg).toMatch(/Personal API Keys/);
  });

  it('403 → ingestion host 잘못 지정 가능성 명시 (A1-2 진단 매뉴얼)', () => {
    const msg = formatPosthogError('trend', 403, '{"detail":"Forbidden"}');
    expect(msg).toMatch(/403/);
    expect(msg).toMatch(/POSTHOG_HOST/);
    expect(msg).toMatch(/us\.i\.posthog\.com/);
    expect(msg).toMatch(/us\.posthog\.com/);
  });

  it('404 → POSTHOG_PROJECT_ID 잘못 안내', () => {
    const msg = formatPosthogError('trend', 404, '');
    expect(msg).toMatch(/404/);
    expect(msg).toMatch(/POSTHOG_PROJECT_ID/);
  });

  it('기타 status → raw 형식 유지 (snippet 포함)', () => {
    const msg = formatPosthogError('breakdown', 500, '{"error":"internal"}');
    expect(msg).toMatch(/500/);
    expect(msg).toMatch(/breakdown/);
  });

  it('detail body 가 200 자 초과 시 잘림', () => {
    const longDetail = 'x'.repeat(500);
    const msg = formatPosthogError('trend', 403, longDetail);
    // snippet 부분만 200자 — 메시지 앞부분 (한국어 설명) 은 별도
    expect(msg.length).toBeLessThan(500);
  });

  it('label 변형 (funnel:plan_generated 같은 nested key) 지원', () => {
    const msg = formatPosthogError('funnel:plan_generated', 403, '');
    expect(msg).toMatch(/funnel:plan_generated/);
    expect(msg).toMatch(/403/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 회귀 방지: api/admin-posthog-visitors.js + admin-posthog-funnel.js 가 host helper
// 를 사용하고 있는지 source-level 검증.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('A1-2 source-level guard — visitors.js + funnel.js 가 helper 사용', () => {
  const visitorsSrc = readFileSync(
    resolve(process.cwd(), 'api/admin-posthog-visitors.js'),
    'utf8',
  );
  const funnelSrc = readFileSync(
    resolve(process.cwd(), 'api/admin-posthog-funnel.js'),
    'utf8',
  );

  it('visitors.js — resolvePosthogQueryHost import + 사용', () => {
    expect(visitorsSrc).toMatch(/resolvePosthogQueryHost/);
    expect(visitorsSrc).toMatch(/_shared\/posthog-host/);
  });

  it('visitors.js — 하드코드 default `us.i.posthog.com` 가 코드에 없음 (회귀 차단)', () => {
    // 주석/docstring 의 ingestion host 설명은 OK — 실제 default 할당 패턴만 차단.
    expect(visitorsSrc).not.toMatch(/POSTHOG_HOST\s*\|\|\s*['"]https:\/\/us\.i\.posthog\.com/);
  });

  it('funnel.js — resolvePosthogQueryHost import + 사용', () => {
    expect(funnelSrc).toMatch(/resolvePosthogQueryHost/);
    expect(funnelSrc).toMatch(/_shared\/posthog-host/);
  });

  it('funnel.js — 하드코드 default `us.i.posthog.com` 가 코드에 없음 (회귀 차단)', () => {
    expect(funnelSrc).not.toMatch(/POSTHOG_HOST\s*\|\|\s*['"]https:\/\/us\.i\.posthog\.com/);
  });

  it('visitors.js — formatPosthogError 호출 (운영자 actionable error)', () => {
    expect(visitorsSrc).toMatch(/formatPosthogError\(\s*['"]trend['"]/);
    expect(visitorsSrc).toMatch(/formatPosthogError\(\s*['"]breakdown['"]/);
  });

  it('funnel.js — formatPosthogError 호출', () => {
    expect(funnelSrc).toMatch(/formatPosthogError\(/);
  });
});
