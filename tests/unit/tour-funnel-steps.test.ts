/**
 * 투어 예약창 단계 계측 (2026-08-19 퍼널 감사 2번).
 *
 * 배경: 투어 퍼널은 CTA 클릭(book_now_click)과 결제 시작(payment_started) 사이가
 *   통째로 비어 있었다 — 다이얼로그 열림·연락처 단계 진입·필수 입력 완료 어디서
 *   사람이 떠나는지 볼 수 없었다(차터는 charter_step 으로 이미 보고 있음).
 *
 * 가드: ① trackTourBookingStart / trackTourStep 이 GA4 로 올바른 이벤트명·속성 발화
 *       ② 동의 전엔 즉시 전송 없음(전역 대기열 — promo_view 와 동일 경로)
 *       ③ TourBookingDialog 가 실제로 배선(dead-code 회귀 방지) + 중복 방지 가드 존재
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

function stubWindow(gtag: ReturnType<typeof vi.fn>, consent: string | null) {
  vi.stubGlobal('window', {
    gtag,
    addEventListener: () => {},
    removeEventListener: () => {},
    localStorage: { getItem: () => consent, setItem: () => {} },
  });
}

describe('trackTourBookingStart / trackTourStep — GA4 발화', () => {
  beforeEach(() => { vi.resetModules(); });
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

  it('동의 accepted → tour_booking_start 발화', async () => {
    vi.stubEnv('VITE_GA_MEASUREMENT_ID', 'G-TEST123');
    const gtag = vi.fn();
    stubWindow(gtag, 'accepted');
    const { trackTourBookingStart } = await import('../../src/lib/analytics');
    trackTourBookingStart();
    const eventCalls = gtag.mock.calls.filter((c) => c[0] === 'event');
    expect(eventCalls).toHaveLength(1);
    expect(eventCalls[0][1]).toBe('tour_booking_start');
  });

  it('동의 accepted → tour_step 이 step 속성으로 발화 (2와 3)', async () => {
    vi.stubEnv('VITE_GA_MEASUREMENT_ID', 'G-TEST123');
    const gtag = vi.fn();
    stubWindow(gtag, 'accepted');
    const { trackTourStep } = await import('../../src/lib/analytics');
    trackTourStep(2);
    trackTourStep(3);
    const eventCalls = gtag.mock.calls.filter((c) => c[0] === 'event');
    expect(eventCalls).toHaveLength(2);
    expect(eventCalls[0][1]).toBe('tour_step');
    expect(eventCalls[0][2].step).toBe(2);
    expect(eventCalls[1][2].step).toBe(3);
  });

  it('🔴 동의 미결정(unset) → 즉시 전송 없음 (대기열 경로, gtag 0회)', async () => {
    vi.stubEnv('VITE_GA_MEASUREMENT_ID', 'G-TEST123');
    const gtag = vi.fn();
    stubWindow(gtag, null);
    const { trackTourBookingStart, trackTourStep } = await import('../../src/lib/analytics');
    trackTourBookingStart();
    trackTourStep(2);
    expect(gtag.mock.calls.filter((c) => c[0] === 'event')).toHaveLength(0);
  });
});

describe('TourBookingDialog — 계측 배선 가드 (dead-code 회귀 방지)', () => {
  const src = readFileSync(
    join(process.cwd(), 'src', 'components', 'tours', 'TourBookingDialog.tsx'),
    'utf8',
  );

  it('analytics 헬퍼 2개를 import', () => {
    expect(src).toMatch(/import\s*\{[^}]*\btrackTourBookingStart\b[^}]*\}\s*from\s*'@\/lib\/analytics'/);
    expect(src).toMatch(/import\s*\{[^}]*\btrackTourStep\b[^}]*\}\s*from\s*'@\/lib\/analytics'/);
  });

  it('Dialog onOpenChange 가 열림 신호를 state 로 올린다 (snapshot step=2 복원도 커버)', () => {
    expect(src).toMatch(/<Dialog onOpenChange=\{\(open\) => \{ if \(open\) setDialogEverOpened\(true\); \}\}>/);
  });

  it('열린 적 없으면 아무것도 안 쏜다 (dialogEverOpened 게이트)', () => {
    expect(src).toMatch(/if \(!dialogEverOpened\) return;/);
  });

  it('시작 1회 + 도달 최대 단계 상승 시만 발화 (중복 방지 ref 가드)', () => {
    expect(src).toMatch(/startTracked\.current = true;\s*\n\s*trackTourBookingStart\(\)/);
    expect(src).toMatch(/maxTrackedStep\.current < 2/);
    expect(src).toMatch(/maxTrackedStep\.current < 3/);
    expect(src).toMatch(/trackTourStep\(2\)/);
    expect(src).toMatch(/trackTourStep\(3\)/);
  });

  it('step 3 은 필수 입력 완료(step2Complete)에 묶인다 — 결제 버튼 노출과 같은 조건', () => {
    expect(src).toMatch(/step === 2 && step2Complete && maxTrackedStep\.current < 3/);
  });
});

describe('posthog.ts — 이벤트명 union 등록 (오타 시 컴파일 실패의 이중 잠금)', () => {
  const src = readFileSync(join(process.cwd(), 'src', 'lib', 'posthog.ts'), 'utf8');
  it('tour_booking_start / tour_step 등록', () => {
    expect(src).toMatch(/'tour_booking_start'/);
    expect(src).toMatch(/'tour_step'/);
  });
});
