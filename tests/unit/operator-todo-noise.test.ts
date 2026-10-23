/* eslint-disable @typescript-eslint/no-explicit-any -- Firestore 문서 모킹 스캐폴딩. */
/**
 * 운영자 일일 To-do 소음 제거 (2026-10-23) — api/_crons/operator-todo-reminder.js.
 * 잠그는 것:
 *   (e) 처리 누락: 명시적 테스트 신호(ADMIN-BYPASS·sandbox 등)는 제외. 30일(UNPROCESSED_RECENT_DAYS) 안의 실제 미처리는
 *       건별 나열, 더 오래된 실제 미처리는 **건수만**(staleCount) — 숨기지 않는다. 페이지 처리로 앞쪽의 오래된 건이
 *       최근 실제 누락을 가리지 않는다.
 *   (d) 가입 쿠폰 0건: 전역 마감 여부가 아니라 **가입 시각** 기준 — 마감 뒤 가입자만 제외.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createFakeFirestore } from '../helpers/fake-firestore.js';

const DAY = 24 * 60 * 60 * 1000;
const promo = vi.hoisted(() => ({ endMs: Number.POSITIVE_INFINITY }));
vi.mock('../../api/onboarding-coupons.js', () => ({ isOnboardingPromoOpen: (now = Date.now()) => now <= promo.endMs }));
const dbHolder = vi.hoisted(() => ({ db: null as any }));
vi.mock('../../api/_shared/firebase-admin.js', () => ({ initAdminDb: () => dbHolder.db }));
vi.mock('../../api/_shared/operator-alerts.js', () => ({ notifyOperatorLong: vi.fn(async () => ({ ok: true })) }));
vi.mock('../../api/_shared/sentry.js', () => ({ captureError: vi.fn(async () => undefined) }));

const {
  fetchUnprocessedBookings, fetchUsersMissingOnboardingCoupons, buildMessage, operatorTodoTask, UNPROCESSED_RECENT_DAYS,
} = await import('../../api/_crons/operator-todo-reminder.js');

const ago = (days: number) => new Date(Date.now() - days * DAY).toISOString();
const unprocessed = (over: Record<string, any> = {}) => ({ status: 'CONFIRMED', amountUSD: '100.00', payerEmail: 'g@example.com', ...over });

beforeEach(() => { promo.endMs = Number.POSITIVE_INFINITY; });

describe('(e) fetchUnprocessedBookings — recent listed, stale counted, tests excluded', () => {
  it('31-day-old real booking → stale count 1, not listed; 29-day-old → listed', async () => {
    expect(UNPROCESSED_RECENT_DAYS).toBe(30);
    const db = createFakeFirestore({
      'bookings/OLD-31': unprocessed({ createdAt: ago(31) }),
      'bookings/REAL-29': unprocessed({ createdAt: ago(29) }),
    });
    const r = await fetchUnprocessedBookings(db);
    expect(r.items.map((i: any) => i.orderID)).toEqual(['REAL-29']);
    expect(r.staleCount).toBe(1);
  });

  it('explicit test bookings are in neither bucket (ADMIN-BYPASS id, admin-bypass payment, sandbox, TEST- capture)', async () => {
    const db = createFakeFirestore({
      'bookings/ADMIN-BYPASS-VALIDATE-x': unprocessed({ createdAt: ago(2) }),
      'bookings/ADMIN-BYPASS-OLD': unprocessed({ createdAt: ago(171) }),
      'bookings/B-SANDBOX': unprocessed({ createdAt: ago(2), paypalEnvironment: 'sandbox' }),
      'bookings/B-BYPASS': unprocessed({ createdAt: ago(40), paymentMethod: 'admin-bypass' }),
      'bookings/B-TESTCAP': unprocessed({ createdAt: ago(2), captureID: 'TEST-CAP-1' }),
      'bookings/B-REAL': unprocessed({ createdAt: ago(2), paypalEnvironment: 'live' }),
    });
    const r = await fetchUnprocessedBookings(db);
    expect(r.items.map((i: any) => i.orderID)).toEqual(['B-REAL']);
    expect(r.staleCount).toBe(0);
  });

  it('paging: 250 old test bookings ahead of a recent real one still surfaces it (page size 200)', async () => {
    const seed: Record<string, any> = {};
    for (let i = 0; i < 250; i++) seed[`bookings/ADMIN-BYPASS-${String(i).padStart(3, '0')}`] = unprocessed({ createdAt: ago(171) });
    seed['bookings/ZZ-REAL-RECENT'] = unprocessed({ createdAt: ago(2) });
    const db = createFakeFirestore(seed);
    const r = await fetchUnprocessedBookings(db);
    expect(r.items.map((i: any) => i.orderID)).toEqual(['ZZ-REAL-RECENT']);
    expect(r.staleCount).toBe(0);
  });

  it('still skips processed bookings (voucherSentAt / bookingRef) and those younger than 24h', async () => {
    const db = createFakeFirestore({
      'bookings/SENT': unprocessed({ createdAt: ago(3), voucherSentAt: ago(3) }),
      'bookings/REF': unprocessed({ createdAt: ago(40), bookingRef: 'CT-1' }),
      'bookings/FRESH': unprocessed({ createdAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString() }),
    });
    const r = await fetchUnprocessedBookings(db);
    expect(r.items).toEqual([]);
    expect(r.staleCount).toBe(0);
  });
});

describe('(e) buildMessage — stale bookings as one count line', () => {
  const empty = { couponWarnings: [], csTickets: [], complaints: [], missingCoupons: [], unprocessedBookings: [], refundRequests: [], charterInquiries: [], collectionMissing: [] };

  it('stale only → a message with just that one line', () => {
    const msg = buildMessage({ ...empty, unprocessedStaleCount: 18 });
    expect(msg).toContain('📄 오래된 미처리(30일+): 18건 — 목록 생략');
    // /admin/reconciliation 은 최신 50건만 봐서 오래된 건을 못 찾는다 → dryRun 응답의 staleItems 로 안내.
    //   텔레그램 HTML 모드라 URL 의 & 는 &amp; 로 실린다.
    expect(msg).toContain('→ GET /api/cron-runner?job=operator-todo-reminder&amp;dryRun=1 의 staleItems 에서 ID 확인');
    expect(msg).not.toContain('/admin/reconciliation');
    expect(msg).not.toContain('booking-processor 처리 누락');
  });

  it('nothing at all → no message', () => {
    expect(buildMessage({ ...empty, unprocessedStaleCount: 0 })).toBeNull();
  });
});

describe('(e) stale identifiers + scan cap (Astra r1)', () => {
  const STALE_ID = 'PAYPAL-ORDER-7XK29381ABCDEF0123'; // 16자 넘는 전체 doc.id 가 그대로 보존돼야 한다
  const processedRecent = (n: number, prefix = 'OK') => {
    const seed: Record<string, any> = {};
    for (let i = 0; i < n; i++) seed[`bookings/${prefix}-${String(i).padStart(4, '0')}`] = unprocessed({ createdAt: ago(2), voucherSentAt: ago(2) });
    return seed;
  };

  it('50 recent processed + one 31-day-old real miss → not listed, but kept in staleItems with the full doc id', async () => {
    const db = createFakeFirestore({ ...processedRecent(50), [`bookings/${STALE_ID}`]: unprocessed({ createdAt: ago(31) }) });
    const r = await fetchUnprocessedBookings(db);
    expect(r.items).toEqual([]);
    expect(r.staleCount).toBe(1);
    expect(r.staleItems).toEqual([expect.objectContaining({ orderID: STALE_ID, userEmail: 'g@example.com', amountUSD: '100.00' })]);
    expect(r.scanIncomplete).toBe(false);
  });

  it('1200 CONFIRMED bookings → stops at the 1000 cap with scanIncomplete=true and a warning line', async () => {
    const r = await fetchUnprocessedBookings(createFakeFirestore(processedRecent(1200)));
    expect(r.scanIncomplete).toBe(true);
    const msg = buildMessage({
      couponWarnings: [], csTickets: [], complaints: [], missingCoupons: [], unprocessedBookings: [], refundRequests: [], charterInquiries: [], collectionMissing: [],
      unprocessedStaleCount: 0, scanIncomplete: r.scanIncomplete,
    });
    expect(msg).toContain('⚠️ 스캔 상한(1000건) 도달 — 이후 건 미확인');
  });

  it('999 (and exactly 1000) bookings → scanIncomplete=false', async () => {
    expect((await fetchUnprocessedBookings(createFakeFirestore(processedRecent(999)))).scanIncomplete).toBe(false);
    expect((await fetchUnprocessedBookings(createFakeFirestore(processedRecent(1000)))).scanIncomplete).toBe(false);
  });

  it('dryRun response carries staleItems / unprocessedStale / scanIncomplete for the operator', async () => {
    dbHolder.db = createFakeFirestore({ ...processedRecent(3), [`bookings/${STALE_ID}`]: unprocessed({ createdAt: ago(45) }) });
    try {
      const out = await operatorTodoTask(true);
      expect(out.statusCode).toBe(200);
      expect(out.body).toMatchObject({ dryRun: true, unprocessedStale: 1, scanIncomplete: false });
      expect(out.body.staleItems.map((i: any) => i.orderID)).toEqual([STALE_ID]);
      expect(out.body.message).toContain('의 staleItems 에서 ID 확인');
    } finally {
      dbHolder.db = null;
    }
  });
});

describe('(d) fetchUsersMissingOnboardingCoupons — judged by sign-up time vs promo end', () => {
  const seed = () => createFakeFirestore({
    'users/u-before': { email: 'before@example.com', createdAt: ago(5) },
    'users/u-after': { email: 'after@example.com', createdAt: ago(2) },
  });

  it('promo open → both reported', async () => {
    const r = await fetchUsersMissingOnboardingCoupons(seed());
    expect(r.items.map((i: any) => i.email).sort()).toEqual(['after@example.com', 'before@example.com']);
  });

  it('run just after the promo ended (end = 3 days ago): signed up before → reported, after → excluded', async () => {
    promo.endMs = Date.now() - 3 * DAY;
    const r = await fetchUsersMissingOnboardingCoupons(seed());
    expect(r.items.map((i: any) => i.email)).toEqual(['before@example.com']);
    expect(r).not.toHaveProperty('skipped');
  });

  it('everyone signed up after the end → empty, not flagged as a failed collection', async () => {
    promo.endMs = Date.now() - 10 * DAY;
    const r = await fetchUsersMissingOnboardingCoupons(seed());
    expect(r.items).toEqual([]);
    expect(r).not.toHaveProperty('skipped');
  });
});
