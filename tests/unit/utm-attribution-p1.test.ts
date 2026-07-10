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

const FIRST = 'cocotrip_utm_first';
const LAST = 'cocotrip_utm_last';
const SESSION = 'cocotrip_utm';

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
});

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

  it("PII 방어: '@' 포함 값은 저장 자체를 스킵", async () => {
    setUrl('?utm_source=user%40example.com&utm_medium=cpc');
    (await freshAnalytics()).initUtmCapture();
    const last = JSON.parse(localStorage.getItem(LAST)!);
    expect(last.utm_source).toBeUndefined(); // 이메일류 값 차단
    expect(last.utm_medium).toBe('cpc');
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
      a.trackPlannerComplete({ durationDays: 3, freeCoupon: true });
      a.trackFreePlanRedeemed(3);
      a.trackCharterQuoteStart();
      a.trackCharterQuoteComplete({ vehicleType: 'sedan' });
    }).not.toThrow();
  });
});
