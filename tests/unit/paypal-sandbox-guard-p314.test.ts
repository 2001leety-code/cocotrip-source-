// ─────────────────────────────────────────────────────────────────────────────
// P314 (2026-05-30) — PayPal sandbox e2e 토글 prod 격리 회귀 테스트
//
// 배경: 운영자(한국인)가 한국 PayPal 로 자국 기업 결제 불가 + 외국인 테스터 없음
//   → PayPal sandbox 가짜 미국 buyer 로 P311 출시 blocker(결제 멱등성) e2e 검증.
//
// resolveIsSandbox() 이중 가드:
//   - HARD: VERCEL_ENV !== 'production'  (Vercel 런타임 주입 — prod 배포는 항상 production)
//   - SOFT: PAYPAL_ENV === 'sandbox'     (preview 에서도 명시해야)
//
// ⭐ 가장 중요: prod 에서는 PAYPAL_ENV 가 무엇이든 무조건 false (실 결제가 sandbox 로
//    새서 "돈 안 받고 plan 발급" 되는 사고 차단). 이 테스트가 그 가드 회귀를 박제.
//
// vitest env 격리: vi.stubEnv / vi.unstubAllEnvs (수동 save/restore 의 테스트간 누수 회피).
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect, vi, afterEach } from 'vitest';
// @ts-expect-error — paypal.js 는 JS 모듈 (타입 선언 없음)
import { resolveIsSandbox } from '../../api/_shared/paypal.js';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('P314 — resolveIsSandbox prod 격리 가드', () => {
  it('⭐ prod (VERCEL_ENV=production) + PAYPAL_ENV=sandbox → false (실 결제 sandbox 누수 차단)', () => {
    vi.stubEnv('VERCEL_ENV', 'production');
    vi.stubEnv('PAYPAL_ENV', 'sandbox');
    expect(resolveIsSandbox()).toBe(false);
  });

  it('preview + PAYPAL_ENV=sandbox → true (e2e 활성)', () => {
    vi.stubEnv('VERCEL_ENV', 'preview');
    vi.stubEnv('PAYPAL_ENV', 'sandbox');
    expect(resolveIsSandbox()).toBe(true);
  });

  it('preview + PAYPAL_ENV 미설정 → false (명시 안 하면 live)', () => {
    vi.stubEnv('VERCEL_ENV', 'preview');
    vi.stubEnv('PAYPAL_ENV', '');
    expect(resolveIsSandbox()).toBe(false);
  });

  it('preview + PAYPAL_ENV=live → false', () => {
    vi.stubEnv('VERCEL_ENV', 'preview');
    vi.stubEnv('PAYPAL_ENV', 'live');
    expect(resolveIsSandbox()).toBe(false);
  });

  it('development + PAYPAL_ENV=sandbox → true (로컬 dev e2e)', () => {
    vi.stubEnv('VERCEL_ENV', 'development');
    vi.stubEnv('PAYPAL_ENV', 'sandbox');
    expect(resolveIsSandbox()).toBe(true);
  });

  it('대소문자 무관 — PAYPAL_ENV=SANDBOX → true (preview)', () => {
    vi.stubEnv('VERCEL_ENV', 'preview');
    vi.stubEnv('PAYPAL_ENV', 'SANDBOX');
    expect(resolveIsSandbox()).toBe(true);
  });

  it('⭐ prod + PAYPAL_ENV=SANDBOX (대문자) 도 false (대소문자 우회 차단)', () => {
    vi.stubEnv('VERCEL_ENV', 'production');
    vi.stubEnv('PAYPAL_ENV', 'SANDBOX');
    expect(resolveIsSandbox()).toBe(false);
  });
});
