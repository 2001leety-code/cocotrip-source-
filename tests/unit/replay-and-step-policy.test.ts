/**
 * 관리자 재처리 키 · 단계별 완료 정책 · 두 저장소 상태 단조성 (2026-07-29 P0).
 *
 * 1. 재처리(admin-replay / admin-scan-suspect)가 captureID 를 orderID 자리에 넣었다.
 *    최초 결제 때 booking-processor 가 받은 orderID 는 **문서 ID** 인데 키가 통째로 바뀌어
 *      · 멱등 마커를 엉뚱한 문서에서 찾고 · 적립 원장 ID 가 달라져 이중 적립
 *      · 시트 중복 확인 키(N열)가 어긋나 행이 하나 더
 *    생겼다.
 *
 * 2. 완료 기록이 3회 실패했을 때 **전부** outcome_unknown 으로 격리했다.
 *    시트·적립은 외부에 멱등 키가 있어 재실행이 안전한데, 격리하면 영원히 미완료로 남는다.
 *
 * 3. 환불 이전 상태를 bookings 우선으로 골랐다. pending 만 REFUNDED 인 레거시에서
 *    늦은 부분환불 한 방에 전액환불이 되돌아갔다.
 */
import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { generateKeyPairSync } from 'node:crypto';
import { createFakeFirestore, FieldValue } from '../helpers/fake-firestore.js';
import {
  claimStep, finalizeStep, isStepCompleted, CLAIM,
  COMPLETE_STEP_MAX_ATTEMPTS, STEP_CLAIM_STALE_MS,
} from '../../api/_shared/booking-idempotency.js';
import { applyRefundEvent, higherStatus } from '../../api/_shared/refund-ledger.js';

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');
const SHEETS = 'sheetsAppendedAt';
const LOYALTY = 'loyaltyEarnedAt';
const VOUCHER = 'voucherSentAt';

/** completeStep 쓰기만 골라 실패시키는 db 래퍼 — 실제 finalizeStep 경로를 그대로 태운다. */
function withFailingWrites(db: ReturnType<typeof createFakeFirestore>, failFor: string) {
  return {
    ...db,
    collection: (name: string) => {
      const col = db.collection(name);
      return {
        ...col,
        doc: (id: string) => {
          const d = col.doc(id);
          return {
            ...d,
            set: async (data: Record<string, unknown>, opts?: unknown) => {
              // 완료 기록(= <field>State: 'completed')만 실패. 격리 쓰기는 통과시킨다.
              if (data && data[`${failFor}State`] === 'completed') throw new Error('firestore write down');
              return d.set(data, opts as never);
            },
          };
        },
      };
    },
  } as unknown as ReturnType<typeof createFakeFirestore>;
}

describe('1. 관리자 재처리는 영구 주문 ID(문서 ID)를 쓴다', () => {
  it('admin-replay 가 captureID 를 orderID 자리에 넣지 않는다', () => {
    const src = read('api/admin-replay-booking-notifications.js');
    expect(src).not.toMatch(/orderID:\s*booking\.captureID/);
    expect(src).toContain('orderID: bookingId');
    expect(src).toContain('captureId: booking.captureID || null');
  });

  it('admin-scan-suspect 도 마찬가지', () => {
    const src = read('api/admin-scan-suspect-bookings.js');
    expect(src).not.toMatch(/orderID:\s*b\.captureID/);
    expect(src).toContain('orderID: c.bookingId');
    expect(src).toContain('captureId: b.captureID || null');
  });

  it('captureID ≠ orderID 인 일반 예약: 재처리 키가 최초 결제와 같다', async () => {
    // 최초 결제: 문서 ID = orderID(=5O1901…), captureID 는 별개 값.
    const db = createFakeFirestore({
      'bookings/5O190127TN364715T': { captureID: 'CAP-ZZZ', bookingRef: 'CT-20260729-001' },
    });
    const first = await claimStep({ db, orderID: '5O190127TN364715T', field: LOYALTY, nowMs: 1_000 });
    expect(first.claimed).toBe(true);
    await finalizeStep({ db, FieldValue, orderID: '5O190127TN364715T', field: LOYALTY });

    // 재처리가 문서 ID 를 쓰면 "이미 완료" 로 스킵된다 (= 이중 적립 없음).
    const replay = await claimStep({ db, orderID: '5O190127TN364715T', field: LOYALTY, nowMs: 9_000_000 });
    expect(replay.reason).toBe(CLAIM.ALREADY_COMPLETED);

    // 옛 동작(captureID 사용)이었다면 다른 문서를 보므로 그대로 선점 성공 = 이중 적립.
    const wrong = await claimStep({ db, orderID: 'CAP-ZZZ', field: LOYALTY, nowMs: 9_000_000 });
    expect(wrong.claimed).toBe(true);
  });

  it('cart 자식은 orderID__lineId 문서 ID 가 그대로 유지된다', async () => {
    const db = createFakeFirestore({
      'bookings/ORD-P__L0': { captureID: 'CAP-SHARED', bookingRef: 'CT-A' },
      'bookings/ORD-P__L1': { captureID: 'CAP-SHARED', bookingRef: 'CT-B' },
    });
    for (const id of ['ORD-P__L0', 'ORD-P__L1']) {
      expect((await claimStep({ db, orderID: id, field: SHEETS, nowMs: 1_000 })).claimed).toBe(true);
      await finalizeStep({ db, FieldValue, orderID: id, field: SHEETS });
    }
    // 형제가 captureID 를 공유해도 각자 독립적으로 1회씩만 처리된다.
    for (const id of ['ORD-P__L0', 'ORD-P__L1']) {
      expect((await claimStep({ db, orderID: id, field: SHEETS, nowMs: 9_000_000 })).reason)
        .toBe(CLAIM.ALREADY_COMPLETED);
    }
  });
});

describe('2. 완료 기록 실패 시 단계별 정책', () => {
  const ORDER = 'ORD-POLICY';

  it('메일은 격리한다 (재발송하면 손님에게 두 번 간다)', async () => {
    const db = createFakeFirestore({ [`bookings/${ORDER}`]: {} });
    await claimStep({ db, orderID: ORDER, field: VOUCHER, nowMs: 1_000 });
    const out = await finalizeStep({
      db: withFailingWrites(db, VOUCHER), FieldValue, orderID: ORDER, field: VOUCHER,
    });
    expect(out.ok).toBe(false);
    expect(out.state).toBe('outcome_unknown');
    expect(out.attempts).toBe(COMPLETE_STEP_MAX_ATTEMPTS);
    expect(db.__get(`bookings/${ORDER}`)!.voucherSentAtState).toBe('outcome_unknown');
  });

  it('🔴 시트는 격리하지 않고 재시도 가능 상태로 남긴다', async () => {
    const db = createFakeFirestore({ [`bookings/${ORDER}`]: {} });
    await claimStep({ db, orderID: ORDER, field: SHEETS, nowMs: 1_000 });
    const out = await finalizeStep({
      db: withFailingWrites(db, SHEETS), FieldValue, orderID: ORDER, field: SHEETS,
    });
    expect(out.state).toBe('retry');
    expect(db.__get(`bookings/${ORDER}`)!.sheetsAppendedAtState).toBe('in_progress');

    // 다음 재시도가 회수 → 외부 중복 확인 → completed 로 수렴한다.
    const again = await claimStep({
      db, orderID: ORDER, field: SHEETS, nowMs: 1_000 + STEP_CLAIM_STALE_MS + 1,
    });
    expect(again.claimed).toBe(true);
    const ok = await finalizeStep({ db, FieldValue, orderID: ORDER, field: SHEETS });
    expect(ok.state).toBe('completed');
    expect(isStepCompleted(db.__get(`bookings/${ORDER}`)!, SHEETS)).toBe(true);
  });

  it('🔴 적립도 재시도 가능 상태로 남긴다 (원장 문서 ID 가 orderID 로 고정)', async () => {
    const db = createFakeFirestore({ [`bookings/${ORDER}`]: {} });
    await claimStep({ db, orderID: ORDER, field: LOYALTY, nowMs: 1_000 });
    const out = await finalizeStep({
      db: withFailingWrites(db, LOYALTY), FieldValue, orderID: ORDER, field: LOYALTY,
    });
    expect(out.state).toBe('retry');
    expect(db.__get(`bookings/${ORDER}`)!.loyaltyEarnedAtState).toBe('in_progress');

    const again = await claimStep({
      db, orderID: ORDER, field: LOYALTY, nowMs: 1_000 + STEP_CLAIM_STALE_MS + 1,
    });
    expect(again.claimed).toBe(true);
    expect((await finalizeStep({ db, FieldValue, orderID: ORDER, field: LOYALTY })).state)
      .toBe('completed');
  });

  it('booking-processor 가 공용 finalizeStep 을 실제로 부른다', () => {
    const src = read('api/booking-processor.js');
    expect(src).toContain('finalizeStep({ db, FieldValue, orderID, field, detail })');
    // 정책 분기를 처리기에 복붙해 두지 않는다(한 곳에서만 결정).
    expect(src).not.toContain("markOutcomeUnknown({\n          db, orderID, field,\n          reason: `external_ok");
  });
});

describe('3. 외부 결과는 재시도해도 한 번만 존재한다 (시트 실물 경로)', () => {
  let appendCalls = 0;
  let rows: string[][] = [];

  beforeAll(() => {
    const { privateKey } = generateKeyPairSync('rsa', {
      modulusLength: 2048,
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
      publicKeyEncoding: { type: 'spki', format: 'pem' },
    });
    process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL = 'test@example.iam.gserviceaccount.com';
    process.env.GOOGLE_PRIVATE_KEY = privateKey as string;
    process.env.GOOGLE_SHEETS_SPREADSHEET_ID = 'SHEET-TEST';
  });
  afterEach(() => { vi.restoreAllMocks(); });

  it('완료 기록 3회 실패 → 재시도 → 기존 행 확인 → completed, 행은 1개', async () => {
    appendCalls = 0; rows = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      const u = String(url);
      if (u.includes('oauth2.googleapis.com/token')) {
        return { ok: true, json: async () => ({ access_token: 't' }) } as unknown as Response;
      }
      if (u.includes(':append')) {
        appendCalls += 1;
        rows.push(JSON.parse(String(init?.body)).values[0]);
        return { ok: true, json: async () => ({ updates: { updatedRange: `A${rows.length}` } }) } as unknown as Response;
      }
      return { ok: true, json: async () => ({ values: rows.map((r) => [r[13]]) }) } as unknown as Response;
    }));
    const { appendBooking } = await import('../../api/_google-sheets.js');

    const ORDER = 'ORD-SHEET-POLICY';
    const db = createFakeFirestore({ [`bookings/${ORDER}`]: {} });
    const booking = { transactionId: ORDER, customerName: '홍길동' };

    // 1회차 — 선점 → append 성공 → 완료 기록 3회 실패 → retry 상태
    expect((await claimStep({ db, orderID: ORDER, field: SHEETS, nowMs: 1_000 })).claimed).toBe(true);
    await appendBooking(booking);
    const first = await finalizeStep({
      db: withFailingWrites(db, SHEETS), FieldValue, orderID: ORDER, field: SHEETS,
    });
    expect(first.state).toBe('retry');

    // 2회차 — 회수 → append 는 기존 행을 찾아 추가하지 않음 → completed
    expect((await claimStep({
      db, orderID: ORDER, field: SHEETS, nowMs: 1_000 + STEP_CLAIM_STALE_MS + 1,
    })).claimed).toBe(true);
    const retry = await appendBooking(booking);
    expect(retry.deduped).toBe(true);
    expect((await finalizeStep({ db, FieldValue, orderID: ORDER, field: SHEETS })).state).toBe('completed');

    expect(appendCalls).toBe(1);   // 🔴 외부 결과는 정확히 1건
    expect(rows).toHaveLength(1);
  });
});

describe('4. 환불 이전 상태는 두 저장소 중 서열이 높은 쪽', () => {
  const base = (bStatus: string, pStatus: string) => ({
    'bookings/ORD-1': {
      bookingRef: 'CT-1', captureID: 'CAP-1', amountUSD: 9.9,
      status: bStatus, paypalEnvironment: 'live', refundedUSDTotal: 9.9,
    },
    'pending_bookings/CT-1': { status: pStatus, refundedUSDTotal: 9.9 },
  });
  const late = (db: ReturnType<typeof createFakeFirestore>, over: Record<string, unknown> = {}) =>
    applyRefundEvent({
      db, FieldValue, eventId: 'E-LATE', eventType: 'PAYMENT.CAPTURE.REFUNDED',
      refundId: 'R-LATE', captureId: 'CAP-1', refundedUSD: 0.5, refundedKRW: 0,
      bookingsDocId: 'ORD-1', bookingRef: 'CT-1', webhookEnvironment: 'live', ...over,
    } as never);

  it('bookings=PARTIALLY_REFUNDED, pending=REFUNDED → 둘 다 REFUNDED 유지', async () => {
    const db = createFakeFirestore(base('PARTIALLY_REFUNDED', 'REFUNDED'));
    await late(db);
    expect(db.__get('bookings/ORD-1')!.status).toBe('REFUNDED');
    expect(db.__get('pending_bookings/CT-1')!.status).toBe('REFUNDED');
  });

  it('bookings=CONFIRMED, pending=REFUNDED → 둘 다 REFUNDED 유지', async () => {
    const db = createFakeFirestore(base('CONFIRMED', 'REFUNDED'));
    await late(db);
    expect(db.__get('bookings/ORD-1')!.status).toBe('REFUNDED');
    expect(db.__get('pending_bookings/CT-1')!.status).toBe('REFUNDED');
  });

  it('PayPal 권위 조회가 실패해도(null) 되돌아가지 않는다', async () => {
    const db = createFakeFirestore(base('CONFIRMED', 'REFUNDED'));
    await late(db, { authoritativeCaptureStatus: null });
    expect(db.__get('bookings/ORD-1')!.status).toBe('REFUNDED');
  });

  it('higherStatus 서열', () => {
    expect(higherStatus('PARTIALLY_REFUNDED', 'REFUNDED')).toBe('REFUNDED');
    expect(higherStatus('REFUNDED', 'PARTIALLY_REFUNDED')).toBe('REFUNDED');
    expect(higherStatus('CONFIRMED', 'REFUNDED')).toBe('REFUNDED');
    expect(higherStatus('CONFIRMED', null)).toBe('CONFIRMED');
    expect(higherStatus(null, null)).toBeNull();
  });

  it('아직 부분환불 단계면 정상적으로 부분환불로 남는다 (과잉 승격 없음)', async () => {
    const db = createFakeFirestore({
      'bookings/ORD-1': {
        bookingRef: 'CT-1', captureID: 'CAP-1', amountUSD: 9.9,
        status: 'CONFIRMED', paypalEnvironment: 'live',
      },
      'pending_bookings/CT-1': { status: 'CONFIRMED' },
    });
    await applyRefundEvent({
      db, FieldValue, eventId: 'E1', eventType: 'PAYMENT.CAPTURE.REFUNDED',
      refundId: 'R1', captureId: 'CAP-1', refundedUSD: 2, refundedKRW: 0,
      bookingsDocId: 'ORD-1', bookingRef: 'CT-1', webhookEnvironment: 'live',
    } as never);
    expect(db.__get('bookings/ORD-1')!.status).toBe('PARTIALLY_REFUNDED');
    expect(db.__get('pending_bookings/CT-1')!.status).toBe('PARTIALLY_REFUNDED');
  });
});
