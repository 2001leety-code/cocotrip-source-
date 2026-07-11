// @vitest-environment jsdom
/**
 * P1 장기 유입 귀속 (2026-07-11 마케팅 지시서) — first/last UTM 회귀 가드.
 *
 * 핵심 불변식:
 *   1. first = 최초 유입 1회 고정 (이후 어떤 유입도 덮지 못함)
 *   2. last  = UTM 있는 유입마다 갱신
 *   3. PII 금지 — '@' 포함 값·비허용 키는 저장/스냅샷 어디에도 못 들어감
 *   4. 어떤 실패도 throw 없음 (추적 실패가 로그인·예약·결제를 막으면 안 됨)
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

// PostHog 이중 전송 검증용 mock — analytics.ts 의 trackFunnel 이 posthog.track 을 부른다.
const posthogTrackSpy = vi.fn();
vi.mock('../../src/lib/posthog', () => ({
  track: (...args: unknown[]) => { posthogTrackSpy(...args); return Promise.resolve(); },
}));

const FIRST = 'cocotrip_utm_first';
const LAST = 'cocotrip_utm_last';
const SESSION = 'cocotrip_utm';
const PENDING = 'coco_planner_pending_complete';

function setUrl(search: string) {
  window.history.replaceState({}, '', `/${search}`);
}

async function freshAnalytics() {
  vi.resetModules();
  return import('../../src/lib/analytics');
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  setUrl('');
  posthogTrackSpy.mockClear();
});

// GA4 발화 관측용 — gtag mock + GA_ID 주입 (없으면 trackEvent 가 no-op 이라 발화 검증 불가)
function installGtagSpy() {
  const gtagSpy = vi.fn();
  (window as unknown as { gtag?: unknown }).gtag = gtagSpy;
  vi.stubEnv('VITE_GA_MEASUREMENT_ID', 'G-TEST');
  return gtagSpy;
}

describe('initUtmCapture — first/last 분리', () => {
  it('첫 유입: first + last + session 모두 기록', async () => {
    setUrl('?utm_source=google&utm_medium=cpc&utm_campaign=summer');
    const { initUtmCapture } = await freshAnalytics();
    initUtmCapture();
    const first = JSON.parse(localStorage.getItem(FIRST)!);
    const last = JSON.parse(localStorage.getItem(LAST)!);
    expect(first.utm_source).toBe('google');
    expect(first.ts).toBeTypeOf('string');
    expect(last.utm_campaign).toBe('summer');
    expect(JSON.parse(sessionStorage.getItem(SESSION)!).utm_source).toBe('google');
  });

  it('두 번째 유입: first 는 고정, last 만 갱신', async () => {
    setUrl('?utm_source=google&utm_campaign=first_camp');
    const a1 = await freshAnalytics();
    a1.initUtmCapture();

    setUrl('?utm_source=meta&utm_campaign=second_camp');
    const a2 = await freshAnalytics();
    a2.initUtmCapture();

    const first = JSON.parse(localStorage.getItem(FIRST)!);
    const last = JSON.parse(localStorage.getItem(LAST)!);
    expect(first.utm_source).toBe('google');   // 최초 유입 보존
    expect(first.utm_campaign).toBe('first_camp');
    expect(last.utm_source).toBe('meta');      // 최근 유입 갱신
    expect(last.utm_campaign).toBe('second_camp');
  });

  it('UTM 없는 재방문: first/last 둘 다 무변경', async () => {
    setUrl('?utm_source=google');
    (await freshAnalytics()).initUtmCapture();
    const lastBefore = localStorage.getItem(LAST);

    setUrl('');
    (await freshAnalytics()).initUtmCapture();
    expect(localStorage.getItem(LAST)).toBe(lastBefore);
    expect(JSON.parse(localStorage.getItem(FIRST)!).utm_source).toBe('google');
  });

  it("PII 최소화: '@' 포함 값은 저장 자체를 스킵", async () => {
    setUrl('?utm_source=user%40example.com&utm_medium=cpc');
    (await freshAnalytics()).initUtmCapture();
    const last = JSON.parse(localStorage.getItem(LAST)!);
    expect(last.utm_source).toBeUndefined(); // 이메일류 값 차단
    expect(last.utm_medium).toBe('cpc');
  });

  it('PII 최소화: 전화형 값 차단 명세 (완전 차단이 아닌 휴리스틱 — 이 케이스들이 차단 범위)', async () => {
    // 차단: 구분자 전화 / +국제전화 / 0시작 순수숫자(한국 전화)
    // 허용: 0 미시작 순수 숫자(광고 ID) / 날짜 포함 캠페인명
    setUrl('?utm_source=010-1234-5678&utm_medium=%2B82-10-1234-5678&utm_campaign=01012345678&utm_term=1234567890123456&utm_content=camp-2026-07-11');
    (await freshAnalytics()).initUtmCapture();
    const last = JSON.parse(localStorage.getItem(LAST)!);
    expect(last.utm_source).toBeUndefined();      // 010-1234-5678 차단
    expect(last.utm_medium).toBeUndefined();      // +82-10-1234-5678 차단
    expect(last.utm_campaign).toBeUndefined();    // 01012345678 차단
    expect(last.utm_term).toBe('1234567890123456'); // 광고 ID 허용
    expect(last.utm_content).toBe('camp-2026-07-11'); // 캠페인명 허용
  });

  it('120자 초과 값은 잘린다', async () => {
    setUrl(`?utm_campaign=${'x'.repeat(300)}`);
    (await freshAnalytics()).initUtmCapture();
    const last = JSON.parse(localStorage.getItem(LAST)!);
    expect(last.utm_campaign.length).toBeLessThanOrEqual(120);
  });
});

describe('getAttributionSnapshot — 예약·가입 문서 저장용', () => {
  it('first/last 가 있으면 { first, last } 반환, 허용 키만', async () => {
    setUrl('?utm_source=google&utm_medium=cpc');
    const a = await freshAnalytics();
    a.initUtmCapture();
    const snap = a.getAttributionSnapshot()!;
    expect(snap.first!.utm_source).toBe('google');
    expect(snap.last!.utm_medium).toBe('cpc');
    // 허용 외 키 없음 (utm 5종 + ts)
    const allowed = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'ts'];
    for (const k of Object.keys(snap.first!)) expect(allowed).toContain(k);
  });

  it('유입 기록 전혀 없으면 null (필드 생략용)', async () => {
    const a = await freshAnalytics();
    expect(a.getAttributionSnapshot()).toBeNull();
  });

  it('저장소 오염(임의 키 주입)돼도 허용 키만 통과', async () => {
    localStorage.setItem(FIRST, JSON.stringify({ utm_source: 'x', email: 'a@b.c', injected: 'bad' }));
    const a = await freshAnalytics();
    const snap = a.getAttributionSnapshot()!;
    expect(snap.first!.utm_source).toBe('x');
    expect(snap.first).not.toHaveProperty('email');
    expect(snap.first).not.toHaveProperty('injected');
  });

  it('저장소 깨진 JSON 이어도 throw 없이 null', async () => {
    localStorage.setItem(FIRST, '{{{broken');
    localStorage.setItem(LAST, '{{{broken');
    const a = await freshAnalytics();
    expect(() => a.getAttributionSnapshot()).not.toThrow();
    expect(a.getAttributionSnapshot()).toBeNull();
  });
});

describe('P1 이벤트 헬퍼 — GA 미설정 시 no-op (흐름 무영향)', () => {
  it('전부 throw 없이 호출 가능', async () => {
    const a = await freshAnalytics();
    expect(() => {
      a.trackPromoView('top_banner');
      a.trackPromoClick('top_banner', '/tours');
      a.trackPromoDismiss('top_banner');
      a.trackWelcomeCouponIssued(3);
      a.trackWelcomeCouponModalView();
      a.trackCharterQuoteStart();
      a.trackCharterQuoteComplete({ vehicleType: 'sedan' });
    }).not.toThrow();
  });
});

describe('P1 이중 전송 — 퍼널 이벤트는 GA4 + PostHog 둘 다 (운영자 보완 지시)', () => {
  it('promo_view 가 gtag 와 posthog.track 양쪽에 도달', async () => {
    const gtagSpy = installGtagSpy();
    const a = await freshAnalytics();
    a.trackPromoView('top_banner');
    expect(gtagSpy).toHaveBeenCalledWith('event', 'promo_view', expect.objectContaining({ placement: 'top_banner' }));
    expect(posthogTrackSpy).toHaveBeenCalledWith('promo_view', expect.objectContaining({ placement: 'top_banner' }));
  });

  it('posthog.track 이 throw 해도 GA4 발화·호출부는 무사', async () => {
    posthogTrackSpy.mockImplementationOnce(() => { throw new Error('posthog down'); });
    const gtagSpy = installGtagSpy();
    const a = await freshAnalytics();
    expect(() => a.trackPromoDismiss('top_banner')).not.toThrow();
    expect(gtagSpy).toHaveBeenCalled();
  });
});

describe('planner_complete — Firestore 상태 확정 시점 정확히 1회 (운영자 보완 지시)', () => {
  const PLAN_ID = 'plan-abc-123';

  it("streaming 수락 시점엔 이벤트 없음 — marker 만 심김", async () => {
    const gtagSpy = installGtagSpy();
    const a = await freshAnalytics();
    a.markPlannerPendingComplete(PLAN_ID, { durationDays: 3, freeCoupon: true });
    // 아직 status 미확정 — 어떤 완료 이벤트도 없어야 함
    expect(gtagSpy).not.toHaveBeenCalledWith('event', 'planner_complete', expect.anything());
    expect(sessionStorage.getItem(PENDING)).toContain(PLAN_ID);
    // streaming 상태 관찰 = 대기 (marker 유지)
    expect(a.trackPlannerOutcomeFromStatus(PLAN_ID, 'streaming')).toBeNull();
    expect(sessionStorage.getItem(PENDING)).toContain(PLAN_ID);
  });

  it("status 'ready' 확정 → planner_complete + free_plan_redeemed 발화, 재호출은 무발화(중복 방지)", async () => {
    const gtagSpy = installGtagSpy();
    const a = await freshAnalytics();
    a.markPlannerPendingComplete(PLAN_ID, { durationDays: 3, freeCoupon: true });

    expect(a.trackPlannerOutcomeFromStatus(PLAN_ID, 'ready')).toBe('completed');
    expect(gtagSpy).toHaveBeenCalledWith('event', 'planner_complete', expect.objectContaining({ free_coupon: 'true' }));
    expect(gtagSpy).toHaveBeenCalledWith('event', 'free_plan_redeemed', expect.objectContaining({ duration_days: 3 }));
    expect(posthogTrackSpy).toHaveBeenCalledWith('planner_complete', expect.anything());
    expect(posthogTrackSpy).toHaveBeenCalledWith('free_plan_redeemed', expect.anything());

    // onSnapshot 다중 호출 시뮬레이션 — marker 소진 후엔 무발화
    gtagSpy.mockClear();
    expect(a.trackPlannerOutcomeFromStatus(PLAN_ID, 'ready')).toBeNull();
    expect(gtagSpy).not.toHaveBeenCalled();
  });

  it('유료 플랜(freeCoupon:false)은 free_plan_redeemed 미발화', async () => {
    const gtagSpy = installGtagSpy();
    const a = await freshAnalytics();
    a.markPlannerPendingComplete(PLAN_ID, { durationDays: 5, freeCoupon: false });
    expect(a.trackPlannerOutcomeFromStatus(PLAN_ID, 'ready')).toBe('completed');
    expect(gtagSpy).toHaveBeenCalledWith('event', 'planner_complete', expect.objectContaining({ free_coupon: 'false' }));
    expect(gtagSpy).not.toHaveBeenCalledWith('event', 'free_plan_redeemed', expect.anything());
  });

  it("스트리밍 최종 실패(status 'error') → 완료 이벤트 금지 + marker 폐기", async () => {
    const gtagSpy = installGtagSpy();
    const a = await freshAnalytics();
    a.markPlannerPendingComplete(PLAN_ID, { durationDays: 3, freeCoupon: true });

    expect(a.trackPlannerOutcomeFromStatus(PLAN_ID, 'error')).toBe('failed');
    expect(gtagSpy).not.toHaveBeenCalledWith('event', 'planner_complete', expect.anything());
    expect(gtagSpy).not.toHaveBeenCalledWith('event', 'free_plan_redeemed', expect.anything());
    // marker 폐기 — 이후 ready 가 와도(재시도 새 marker 전까지) 무발화
    expect(a.trackPlannerOutcomeFromStatus(PLAN_ID, 'ready')).toBeNull();
    expect(gtagSpy).not.toHaveBeenCalledWith('event', 'planner_complete', expect.anything());
  });

  it('다른 planId(옛/타인 플랜 열람) → 무시, marker 유지', async () => {
    installGtagSpy();
    const a = await freshAnalytics();
    a.markPlannerPendingComplete(PLAN_ID, { durationDays: 3 });
    expect(a.trackPlannerOutcomeFromStatus('other-plan-999', 'ready')).toBeNull();
    expect(sessionStorage.getItem(PENDING)).toContain(PLAN_ID);
  });
});
