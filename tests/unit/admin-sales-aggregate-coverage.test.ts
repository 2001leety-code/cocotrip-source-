/**
 * test/admin-financial-coverage — api/_shared/adminSalesAggregate.js (FINANCIAL).
 *
 * admin-sales.js 의 매출 KPI 집계 (today/week/month/ytd) + TEST-/ADMIN-BYPASS- 제외 +
 * CANCELED 제외 + 일별/상품별/최근 변환을 byte-identical 하게 추출한 순수 함수의 회귀 잠금.
 *
 * 이 테스트는 "coverage(검증)" 목적 — 값/임계치/공식을 바꾸지 않는다. 알려진 KRW(USD) 숫자를
 * 박아서 admin-sales.js 가 향후 리팩터될 때 집계 결과가 1원이라도 바뀌면 즉시 fail.
 *
 * 시계(now) 는 결정적 fixture 로 주입 — admin-sales.js handler 가 todayKST() (UTC+9 shift) 을
 * 넘기는 그 값. 본 모듈은 now 에 대해 UTC 날짜 경계 산출 (KST 라벨이지만 UTC 연산 — 원본 동일).
 */
import { describe, it, expect } from 'vitest';
// @ts-expect-error — JS module
import {
  aggregateAdminSales,
  classifyProduct,
} from '../../api/_shared/adminSalesAggregate.js';

// 고정 기준 시각. 2026-06-15 05:00:00Z. (handler 가 넘기는 todayKST() 자리)
//   todayStart  = 2026-06-15T00:00:00Z
//   weekStart   = 그 주 일요일 00:00Z
//   monthStart  = 2026-06-01T00:00:00Z
//   yearStart   = 2026-01-01T00:00:00Z
const NOW = new Date('2026-06-15T05:00:00Z');
const ms = (iso: string) => new Date(iso).getTime();

// 한 건 booking fixture helper. handler 가 normalize 한 모양 { id, ..., _createdAtMs }.
type B = Record<string, unknown>;
function booking(over: B): B {
  return { id: over.id || 'PAY-' + Math.random().toString(36).slice(2), ...over };
}

describe('adminSalesAggregate — KPI 기간 버킷 (today/week/month/ytd)', () => {
  it('동일 건이 모든 상위 기간에 누적 — today ⊆ week ⊆ month ⊆ ytd', () => {
    // 오늘(06-15) 1건만 존재 → 4개 버킷 모두 동일 합산.
    const rawAll = [
      booking({ orderID: 'PAY-1', amountUSD: '9.90', _createdAtMs: ms('2026-06-15T02:00:00Z') }),
    ];
    const r = aggregateAdminSales(rawAll, { now: NOW, days: 30 });
    expect(r.kpi.today).toEqual({ usd: 9.9, count: 1 });
    expect(r.kpi.week).toEqual({ usd: 9.9, count: 1 });
    expect(r.kpi.month).toEqual({ usd: 9.9, count: 1 });
    expect(r.kpi.ytd).toEqual({ usd: 9.9, count: 1 });
  });

  it('기간 경계 정확 — 어제/지난주/지난달/작년 건은 각 상위 버킷에만 포함', () => {
    const rawAll = [
      // 오늘
      booking({ orderID: 'PAY-today', amountUSD: '10', _createdAtMs: ms('2026-06-15T01:00:00Z') }),
      // 이번주(일요일 06-14) 이지만 어제 → week+ 에는 들어가지만 today 엔 X
      booking({ orderID: 'PAY-week', amountUSD: '20', _createdAtMs: ms('2026-06-14T12:00:00Z') }),
      // 이번달이지만 지난주(06-05) → month/ytd 만
      booking({ orderID: 'PAY-month', amountUSD: '30', _createdAtMs: ms('2026-06-05T12:00:00Z') }),
      // 올해이지만 지난달(03-01) → ytd 만
      booking({ orderID: 'PAY-ytd', amountUSD: '40', _createdAtMs: ms('2026-03-01T12:00:00Z') }),
    ];
    const r = aggregateAdminSales(rawAll, { now: NOW, days: 30 });
    expect(r.kpi.today).toEqual({ usd: 10, count: 1 });
    expect(r.kpi.week).toEqual({ usd: 30, count: 2 });   // today + week
    expect(r.kpi.month).toEqual({ usd: 60, count: 3 });  // + month
    expect(r.kpi.ytd).toEqual({ usd: 100, count: 4 });   // + ytd
  });

  it('amountUSD 합산은 소수 2자리로 round (부동소수 누적 방어)', () => {
    const rawAll = [
      booking({ orderID: 'PAY-a', amountUSD: '9.90', _createdAtMs: ms('2026-06-15T01:00:00Z') }),
      booking({ orderID: 'PAY-b', amountUSD: '0.10', _createdAtMs: ms('2026-06-15T02:00:00Z') }),
      booking({ orderID: 'PAY-c', amountUSD: '0.20', _createdAtMs: ms('2026-06-15T03:00:00Z') }),
    ];
    const r = aggregateAdminSales(rawAll, { now: NOW, days: 30 });
    // 9.90 + 0.10 + 0.20 = 10.2 (round 2dp)
    expect(r.kpi.today).toEqual({ usd: 10.2, count: 3 });
  });
});

describe('adminSalesAggregate — TEST-/ADMIN-BYPASS- 운영자 테스트 결제 제외 (핵심)', () => {
  it('TEST- / ADMIN-BYPASS- prefix booking 은 매출/카운트에서 전부 제외', () => {
    const rawAll = [
      booking({ id: 'PAY-real', orderID: 'PAY-real', bookingRef: 'PAY-real', amountUSD: '9.90', _createdAtMs: ms('2026-06-15T01:00:00Z') }),
      // 운영자 테스트 — 제외 대상
      booking({ orderID: 'TEST-self-1', amountUSD: '1000', _createdAtMs: ms('2026-06-15T02:00:00Z') }),
      booking({ orderID: 'ADMIN-BYPASS-self-2', amountUSD: '2000', _createdAtMs: ms('2026-06-15T03:00:00Z') }),
      // doc id 자체가 prefix (bookings.doc(orderID) 흐름)
      booking({ id: 'TEST-doc', amountUSD: '500', _createdAtMs: ms('2026-06-15T04:00:00Z') }),
      // paymentMethod 명시 신호
      booking({ orderID: 'weird', paymentMethod: 'admin-bypass', amountUSD: '300', _createdAtMs: ms('2026-06-15T04:30:00Z') }),
    ];
    const r = aggregateAdminSales(rawAll, { now: NOW, days: 30 });
    // 실제 결제 9.90 1건만 집계 (테스트 3800 USD 전부 제외)
    expect(r.kpi.today).toEqual({ usd: 9.9, count: 1 });
    expect(r.kpi.ytd).toEqual({ usd: 9.9, count: 1 });
    expect(r.totalBookings).toBe(1);
    expect(r.excluded.adminBypass).toBe(4);
    expect(r.recent).toHaveLength(1);
    expect(r.recent[0].bookingRef).toBe('PAY-real');
  });

  it('MANUAL- prefix 는 실제 입금 → 제외하지 않음 (의도, 운영자 손해 방지)', () => {
    const rawAll = [
      booking({ orderID: 'MANUAL-CT-1', amountUSD: '150', _createdAtMs: ms('2026-06-15T01:00:00Z') }),
    ];
    const r = aggregateAdminSales(rawAll, { now: NOW, days: 30 });
    expect(r.kpi.today).toEqual({ usd: 150, count: 1 });
    expect(r.excluded.adminBypass).toBe(0);
    expect(r.totalBookings).toBe(1);
  });
});

describe('adminSalesAggregate — CANCELED 취소 처리', () => {
  it('CANCELED 건은 KPI 합산/카운트에서 제외되지만 excluded.canceled 로 집계', () => {
    const rawAll = [
      booking({ orderID: 'PAY-ok', amountUSD: '9.90', status: 'PAID', _createdAtMs: ms('2026-06-15T01:00:00Z') }),
      booking({ orderID: 'PAY-cancel', amountUSD: '500', status: 'CANCELED', _createdAtMs: ms('2026-06-15T02:00:00Z') }),
    ];
    const r = aggregateAdminSales(rawAll, { now: NOW, days: 30 });
    expect(r.kpi.today).toEqual({ usd: 9.9, count: 1 });   // 취소분 합산 안 됨
    expect(r.excluded.canceled).toBe(1);
    // totalBookings 는 (bypass 제외 후) 전체 건 — CANCELED 도 포함 (원본 동일: all.length)
    expect(r.totalBookings).toBe(2);
  });

  it('CANCELED 이면서 ADMIN-BYPASS- → adminBypass 로만 카운트 (canceled 중복 카운트 X)', () => {
    // 원본: canceledBookings 는 !isAdminBypassBooking 조건이라 bypass+canceled 는 canceled 에서 빠짐.
    const rawAll = [
      booking({ orderID: 'TEST-cancel', status: 'CANCELED', amountUSD: '99', _createdAtMs: ms('2026-06-15T01:00:00Z') }),
    ];
    const r = aggregateAdminSales(rawAll, { now: NOW, days: 30 });
    expect(r.excluded.adminBypass).toBe(1);
    expect(r.excluded.canceled).toBe(0);
    expect(r.totalBookings).toBe(0);
  });

  it('CANCELED 는 daily / byProduct / recent 매핑에서도 누적 안 됨', () => {
    const rawAll = [
      booking({ orderID: 'PAY-c', status: 'CANCELED', productType: 'pickup', amountUSD: '500', _createdAtMs: ms('2026-06-15T01:00:00Z') }),
      booking({ orderID: 'PAY-ok', status: 'PAID', productType: 'pickup', amountUSD: '9.90', _createdAtMs: ms('2026-06-15T02:00:00Z') }),
    ];
    const r = aggregateAdminSales(rawAll, { now: NOW, days: 30 });
    expect(r.byProduct['픽업']).toEqual({ usd: 9.9, count: 1 });
    const todayCell = r.daily.find((d: { date: string }) => d.date === '2026-06-15');
    expect(todayCell).toEqual({ date: '2026-06-15', usd: 9.9, count: 1 });
  });
});

describe('adminSalesAggregate — 일별 (daily, 최근 N일)', () => {
  it('days=7 → 정확히 7개 셀, 날짜 오름차순, 결제 없는 날은 0', () => {
    const rawAll = [
      booking({ orderID: 'PAY-1', amountUSD: '10', _createdAtMs: ms('2026-06-15T01:00:00Z') }),
      booking({ orderID: 'PAY-2', amountUSD: '5', _createdAtMs: ms('2026-06-13T01:00:00Z') }),
    ];
    const r = aggregateAdminSales(rawAll, { now: NOW, days: 7 });
    expect(r.daily).toHaveLength(7);
    // 오름차순 06-09 .. 06-15
    expect(r.daily[0].date).toBe('2026-06-09');
    expect(r.daily[6].date).toBe('2026-06-15');
    expect(r.daily[6]).toEqual({ date: '2026-06-15', usd: 10, count: 1 });
    expect(r.daily[4]).toEqual({ date: '2026-06-13', usd: 5, count: 1 });
    // 결제 없는 날
    expect(r.daily[5]).toEqual({ date: '2026-06-14', usd: 0, count: 0 });
  });

  it('window 밖(N일 이전) 결제는 daily 에 안 들어감 (kpi 와 독립)', () => {
    const rawAll = [
      // days=7 window 는 06-09~06-15. 06-01 은 밖.
      booking({ orderID: 'PAY-old', amountUSD: '40', _createdAtMs: ms('2026-06-01T01:00:00Z') }),
    ];
    const r = aggregateAdminSales(rawAll, { now: NOW, days: 7 });
    const sum = r.daily.reduce((s: number, d: { usd: number }) => s + d.usd, 0);
    expect(sum).toBe(0);
    // 하지만 month KPI 엔 잡힘
    expect(r.kpi.month.usd).toBe(40);
  });

  it('같은 날 여러 건 → daily 셀에 합산 + round', () => {
    const rawAll = [
      booking({ orderID: 'PAY-a', amountUSD: '9.90', _createdAtMs: ms('2026-06-15T01:00:00Z') }),
      booking({ orderID: 'PAY-b', amountUSD: '9.90', _createdAtMs: ms('2026-06-15T09:00:00Z') }),
      booking({ orderID: 'PAY-c', amountUSD: '0.20', _createdAtMs: ms('2026-06-15T20:00:00Z') }),
    ];
    const r = aggregateAdminSales(rawAll, { now: NOW, days: 7 });
    const todayCell = r.daily.find((d: { date: string }) => d.date === '2026-06-15');
    expect(todayCell).toEqual({ date: '2026-06-15', usd: 20, count: 3 });
  });
});

describe('adminSalesAggregate — 상품별 (byProduct, 이번달 기준)', () => {
  it('classifyProduct 분류 + 이번달만 집계', () => {
    const rawAll = [
      booking({ orderID: 'PAY-1', productType: 'pickup', amountUSD: '50', _createdAtMs: ms('2026-06-10T01:00:00Z') }),
      booking({ orderID: 'PAY-2', productType: '셔틀버스', amountUSD: '30', _createdAtMs: ms('2026-06-11T01:00:00Z') }),
      booking({ orderID: 'PAY-3', productType: 'ai-planner', amountUSD: '9.90', _createdAtMs: ms('2026-06-12T01:00:00Z') }),
      booking({ orderID: 'PAY-4', productType: 'tour-gyeongju', amountUSD: '120', _createdAtMs: ms('2026-06-13T01:00:00Z') }),
      booking({ orderID: 'PAY-5', productType: 'something-else', amountUSD: '200', _createdAtMs: ms('2026-06-14T01:00:00Z') }),
      // 지난달 → byProduct 에서 제외 (이번달 기준)
      booking({ orderID: 'PAY-old', productType: 'pickup', amountUSD: '999', _createdAtMs: ms('2026-05-20T01:00:00Z') }),
    ];
    const r = aggregateAdminSales(rawAll, { now: NOW, days: 30 });
    expect(r.byProduct).toEqual({
      '픽업': { usd: 50, count: 1 },
      '셔틀': { usd: 30, count: 1 },
      'AI플래너': { usd: 9.9, count: 1 },
      '투어': { usd: 120, count: 1 },
      '전세': { usd: 200, count: 1 },
    });
  });

  it('classifyProduct 단위 — prefix/키워드 규칙', () => {
    expect(classifyProduct('pickup-incheon')).toBe('픽업');
    expect(classifyProduct('공항픽업')).toBe('픽업');
    expect(classifyProduct('shuttle')).toBe('셔틀');
    expect(classifyProduct('AI Planner')).toBe('AI플래너');
    expect(classifyProduct('tour-seoul')).toBe('투어');
    expect(classifyProduct('charter-vip')).toBe('전세');
    expect(classifyProduct('')).toBe('전세');
    expect(classifyProduct()).toBe('전세');
  });
});

describe('adminSalesAggregate — 최근 20건 (recent)', () => {
  it('_createdAtMs 내림차순 정렬 + 최대 20건 + 필드 매핑/폴백', () => {
    const rawAll = Array.from({ length: 25 }, (_, i) =>
      booking({
        orderID: `PAY-${i}`,
        bookingRef: `CT-${i}`,
        amountUSD: String(i + 1),
        _createdAtMs: ms('2026-06-15T00:00:00Z') + i * 1000,
      }),
    );
    const r = aggregateAdminSales(rawAll, { now: NOW, days: 30 });
    expect(r.recent).toHaveLength(20);
    // 최신(i=24) 먼저
    expect(r.recent[0].bookingRef).toBe('CT-24');
    expect(r.recent[0].amountUSD).toBe(25);
    expect(r.recent[19].bookingRef).toBe('CT-5');
  });

  it('recent 필드 폴백 — bookingRef 없으면 id, email 은 userEmail||payerEmail, createdAt ISO', () => {
    const rawAll = [
      booking({
        id: 'DOC-1',
        amountUSD: '9.90',
        payerEmail: 'guest@example.com',
        tourDate: '2026-07-01',
        productType: 'pickup',
        paxCount: 2,
        status: 'PAID',
        _createdAtMs: ms('2026-06-15T03:00:00Z'),
      }),
    ];
    const r = aggregateAdminSales(rawAll, { now: NOW, days: 30 });
    expect(r.recent[0]).toEqual({
      bookingRef: 'DOC-1',           // bookingRef 없음 → id 폴백
      tourDate: '2026-07-01',
      productType: 'pickup',
      paxCount: 2,
      amountUSD: 9.9,
      status: 'PAID',
      customerEmail: 'guest@example.com',  // payerEmail 폴백
      createdAt: '2026-06-15T03:00:00.000Z',
    });
  });

  it('_createdAtMs 없는 건은 recent 에서 제외', () => {
    const rawAll = [
      booking({ id: 'PAY-no-date', orderID: 'PAY-no-date', bookingRef: 'PAY-no-date', amountUSD: '9.90', _createdAtMs: null }),
      booking({ id: 'PAY-ok', orderID: 'PAY-ok', bookingRef: 'PAY-ok', amountUSD: '9.90', _createdAtMs: ms('2026-06-15T01:00:00Z') }),
    ];
    const r = aggregateAdminSales(rawAll, { now: NOW, days: 30 });
    expect(r.recent).toHaveLength(1);
    expect(r.recent[0].bookingRef).toBe('PAY-ok');
  });
});

describe('adminSalesAggregate — 엣지 케이스', () => {
  it('빈 배열 → 0 KPI + days 개 빈 daily + 빈 byProduct/recent', () => {
    const r = aggregateAdminSales([], { now: NOW, days: 30 });
    expect(r.kpi).toEqual({
      today: { usd: 0, count: 0 },
      week: { usd: 0, count: 0 },
      month: { usd: 0, count: 0 },
      ytd: { usd: 0, count: 0 },
    });
    expect(r.daily).toHaveLength(30);
    expect(r.daily.every((d: { usd: number; count: number }) => d.usd === 0 && d.count === 0)).toBe(true);
    expect(r.byProduct).toEqual({});
    expect(r.recent).toEqual([]);
    expect(r.totalBookings).toBe(0);
    expect(r.excluded).toEqual({ adminBypass: 0, canceled: 0 });
  });

  it('amountUSD 누락/빈문자/NaN → 0 으로 처리 (count 는 됨)', () => {
    const rawAll = [
      booking({ orderID: 'PAY-1', _createdAtMs: ms('2026-06-15T01:00:00Z') }),               // amountUSD 누락
      booking({ orderID: 'PAY-2', amountUSD: '', _createdAtMs: ms('2026-06-15T02:00:00Z') }),  // 빈 문자
      booking({ orderID: 'PAY-3', amountUSD: 'abc', _createdAtMs: ms('2026-06-15T03:00:00Z') }), // NaN
      booking({ orderID: 'PAY-4', amountUSD: '9.90', _createdAtMs: ms('2026-06-15T04:00:00Z') }),
    ];
    const r = aggregateAdminSales(rawAll, { now: NOW, days: 30 });
    expect(r.kpi.today).toEqual({ usd: 9.9, count: 4 }); // 3건은 0 USD 지만 count 됨
  });

  it('amountUSD 가 number 타입이어도 처리 (parseFloat 호환)', () => {
    const rawAll = [
      booking({ orderID: 'PAY-1', amountUSD: 9.9, _createdAtMs: ms('2026-06-15T01:00:00Z') }),
    ];
    const r = aggregateAdminSales(rawAll, { now: NOW, days: 30 });
    expect(r.kpi.today).toEqual({ usd: 9.9, count: 1 });
  });
});
