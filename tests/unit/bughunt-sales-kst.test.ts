/**
 * bughunt-sales-kst — api/_shared/adminSalesAggregate.js 의 KST 자정 경계 정확성 회귀 잠금.
 *
 * 버그 #6 (HIGH 회계): aggregateAdminSales 가 받는 now = handler 의 todayKST()
 *   (= new Date(Date.now()+9h)) — UTC 필드가 KST 벽시계를 담은 값.
 *   구버전은 todayStart.setUTCHours(0,...) / startOfWeek·Month·Year 의 setUTCHours(0) 로
 *   경계를 만들어 그 epoch 이 Date.UTC(KST_Y,KST_M,KST_D,0)= 실 KST 자정보다 9h 늦었다.
 *   비교 대상 _createdAtMs 는 진짜 UTC epoch → today/week/month/ytd + daily 버킷 전부 9h 밀려
 *   KST 00:00~09:00 결제가 '어제'로, 월/연 경계서 오분류.
 *
 * 본 테스트는 'KST 정확 경계' 를 검증 — 기존 admin-sales-aggregate-coverage.test.ts 의
 * UTC 경계 기대값(now 를 이미 KST-shift 된 Date 로 가정하고 setUTCHours 결과를 그대로 기대)과
 * 달리, 실제 시간축(_createdAtMs = UTC epoch)에서 KST 달력일 경계가 맞는지 본다.
 *
 * 픽스처 시각축:
 *   now = new Date('2026-06-15T14:00:00Z')  ← KST 벽시계 2026-06-15(월) 14:00 (= 실 06-15 05:00Z + 9h).
 *   KST 자정 경계(실 UTC epoch):
 *     today  = 2026-06-14T15:00:00Z
 *     week   = 2026-06-13T15:00:00Z (그 주 일요일 06-14 KST 00:00)
 *     month  = 2026-05-31T15:00:00Z (06-01 KST 00:00)
 *     year   = 2025-12-31T15:00:00Z (01-01 KST 00:00)
 */
import { describe, it, expect } from 'vitest';
// @ts-expect-error — JS module
import { aggregateAdminSales } from '../../api/_shared/adminSalesAggregate.js';

// now = handler 의 todayKST() 자리. KST 벽시계 2026-06-15 14:00 을 UTC 필드로 표현.
const NOW = new Date('2026-06-15T14:00:00Z');
const ms = (iso: string) => new Date(iso).getTime();

type B = Record<string, unknown>;
function booking(over: B): B {
  return { id: over.id || 'PAY-' + Math.random().toString(36).slice(2), amountUSD: '10', ...over };
}

describe('bughunt #6 — KST 자정 경계 (off-by-9h fix)', () => {
  it("KST 00:00~09:00 결제(=UTC 전날 밤)는 '오늘'에 잡힌다 — 구버전은 '어제'로 누락", () => {
    // KST 2026-06-15 05:00 = UTC 2026-06-14T20:00Z. 실 KST 자정(06-14T15:00Z) 이후 → today.
    // 구버전 todayStart = 2026-06-15T00:00Z 였으면 이 건은 today 에서 빠졌다(버그).
    const rawAll = [
      booking({ orderID: 'PAY-earlyKST', amountUSD: '9.90', _createdAtMs: ms('2026-06-14T20:00:00Z') }),
    ];
    const r = aggregateAdminSales(rawAll, { now: NOW, days: 30 });
    expect(r.kpi.today).toEqual({ usd: 9.9, count: 1 });
    expect(r.kpi.week).toEqual({ usd: 9.9, count: 1 });
    expect(r.kpi.month).toEqual({ usd: 9.9, count: 1 });
    expect(r.kpi.ytd).toEqual({ usd: 9.9, count: 1 });
  });

  it("어제 KST 23:30 결제(=UTC 06-14T14:30Z, KST 자정 직전)는 '오늘'에 안 잡힌다", () => {
    // 실 KST 자정(06-14T15:00Z) 직전 → today 제외. (경계 하한 정확성.)
    const rawAll = [
      booking({ orderID: 'PAY-lateYest', amountUSD: '50', _createdAtMs: ms('2026-06-14T14:30:00Z') }),
    ];
    const r = aggregateAdminSales(rawAll, { now: NOW, days: 30 });
    expect(r.kpi.today).toEqual({ usd: 0, count: 0 });
    // week 에는 들어감 (이번 주 일요일 06-13T15:00Z 이후).
    expect(r.kpi.week).toEqual({ usd: 50, count: 1 });
  });

  it('월 경계: KST 06-01 03:00(=UTC 05-31T18:00Z)는 이번달, KST 05-31 23:00(=05-31T14:00Z)는 지난달', () => {
    const rawAll = [
      // KST 2026-06-01 03:00 → 이번달(month) 포함, 하지만 today/week 밖.
      booking({ orderID: 'PAY-monthStart', amountUSD: '30', _createdAtMs: ms('2026-05-31T18:00:00Z') }),
      // KST 2026-05-31 23:00 → 지난달 → month 제외 (ytd 만).
      booking({ orderID: 'PAY-lastMonth', amountUSD: '40', _createdAtMs: ms('2026-05-31T14:00:00Z') }),
    ];
    const r = aggregateAdminSales(rawAll, { now: NOW, days: 30 });
    expect(r.kpi.month).toEqual({ usd: 30, count: 1 });   // 06-01 건만
    expect(r.kpi.ytd).toEqual({ usd: 70, count: 2 });      // 둘 다 올해
    expect(r.byProduct['전세']).toEqual({ usd: 30, count: 1 }); // byProduct = 이번달 기준
  });

  it('연 경계: KST 01-01 02:00(=UTC 2025-12-31T17:00Z)는 올해(ytd), KST 2025-12-31 23:00은 작년', () => {
    const nowJan = new Date('2026-01-02T10:00:00Z'); // KST 2026-01-02 (year start = 2025-12-31T15:00Z)
    const rawAll = [
      // KST 2026-01-01 02:00 → 올해 ytd.
      booking({ orderID: 'PAY-yearStart', amountUSD: '100', _createdAtMs: ms('2025-12-31T17:00:00Z') }),
      // KST 2025-12-31 23:00 → 작년 → ytd 제외.
      booking({ orderID: 'PAY-lastYear', amountUSD: '200', _createdAtMs: ms('2025-12-31T14:00:00Z') }),
    ];
    const r = aggregateAdminSales(rawAll, { now: nowJan, days: 30 });
    expect(r.kpi.ytd).toEqual({ usd: 100, count: 1 });
  });

  it('daily 버킷이 KST 달력일로 매겨진다 — KST 00:00~09:00 결제가 오늘 셀에 들어감', () => {
    const rawAll = [
      // KST 2026-06-15 05:00 (UTC 06-14T20:00Z) → 구버전 isoDay(UTC)='2026-06-14'(버그). 신버전 '2026-06-15'.
      booking({ orderID: 'PAY-earlyKST', amountUSD: '9.90', _createdAtMs: ms('2026-06-14T20:00:00Z') }),
      // KST 2026-06-14 23:30 (UTC 06-14T14:30Z) → '2026-06-14' 셀.
      booking({ orderID: 'PAY-yest', amountUSD: '5', _createdAtMs: ms('2026-06-14T14:30:00Z') }),
    ];
    const r = aggregateAdminSales(rawAll, { now: NOW, days: 7 });
    expect(r.daily).toHaveLength(7);
    // window = KST 06-09 .. 06-15.
    expect(r.daily[0].date).toBe('2026-06-09');
    expect(r.daily[6].date).toBe('2026-06-15');
    const cell15 = r.daily.find((d: { date: string }) => d.date === '2026-06-15');
    const cell14 = r.daily.find((d: { date: string }) => d.date === '2026-06-14');
    expect(cell15).toEqual({ date: '2026-06-15', usd: 9.9, count: 1 });
    expect(cell14).toEqual({ date: '2026-06-14', usd: 5, count: 1 });
  });

  it('정확히 KST 자정 epoch 인 결제는 그 날에 포함된다 (>= 하한 경계 포함)', () => {
    const rawAll = [
      // 정확히 today KST 자정 = 2026-06-14T15:00:00Z.
      booking({ orderID: 'PAY-exact', amountUSD: '12', _createdAtMs: ms('2026-06-14T15:00:00Z') }),
    ];
    const r = aggregateAdminSales(rawAll, { now: NOW, days: 30 });
    expect(r.kpi.today).toEqual({ usd: 12, count: 1 });
  });
});
