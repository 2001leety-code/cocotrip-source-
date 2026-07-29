/**
 * 외부 작업(시트·메일) 멱등 — **경쟁 + 실패 주입 행위 테스트** (2026-07-29).
 *
 * 고치는 결함:
 *   1. 선점(in_progress) 후 외부 작업이 **성공** 했는데 완료 기록 전에 프로세스가 죽으면,
 *      5분 뒤 재시도가 시트 행과 메일을 **한 번 더** 만들었다.
 *   2. Firestore 선점이 불가능할 때 `return true` 로 외부 작업을 그냥 진행했다(fail-open).
 *      중복 방지 장치가 죽었는데 중복 위험 작업만 계속 나가는 구조였다.
 *
 * 해결:
 *   · 시트 — 주문 ID(N열)로 조회 후 없을 때만 추가 → 몇 번 재시도해도 1행.
 *   · 메일 — SMTP 는 멱등 키가 없다. 보냈는지 확신할 수 없으면 **보내지 않고**
 *            outcome_unknown 으로 격리해 운영자가 판단한다.
 *   · 선점 저장소 불능 → 외부 작업 중단(store_unavailable), 재시도 대기.
 */
import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import { generateKeyPairSync } from 'node:crypto';
import { createFakeFirestore, makeBarrier, FieldValue } from '../helpers/fake-firestore.js';
import {
  claimStep, claimStepSafe, completeStep, markOutcomeUnknown,
  bookingStepGuards, isStepCompleted, CLAIM, STEP_ZOMBIE_POLICY, STEP_CLAIM_STALE_MS,
} from '../../api/_shared/booking-idempotency.js';

const ORDER = 'ORDER-STEP-1';
const SHEETS = 'sheetsAppendedAt';
const VOUCHER = 'voucherSentAt';

// ── 시트 dedupe 검증용: 진짜 RSA 키를 만들어 JWT 서명 경로까지 그대로 태운다 ──
let appendCalls: unknown[] = [];
let sheetRows: string[][] = [];

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

function mockSheetsHttp() {
  appendCalls = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const u = String(url);
    if (u.includes('oauth2.googleapis.com/token')) {
      return { ok: true, json: async () => ({ access_token: 'fake-token' }) } as unknown as Response;
    }
    if (u.includes(':append')) {
      appendCalls.push(JSON.parse(String(init?.body)));
      const row = JSON.parse(String(init?.body)).values[0];
      sheetRows.push(row);
      return { ok: true, json: async () => ({ updates: { updatedRange: `시트1!A${sheetRows.length}` } }) } as unknown as Response;
    }
    // values GET — N열 조회
    return {
      ok: true,
      json: async () => ({ values: sheetRows.map((r) => [r[13]]) }),
    } as unknown as Response;
  }));
}

describe('시트 — 주문 ID 로 조회 후 없을 때만 추가', () => {
  it('append 성공 직후 완료 기록이 실패해도, 재시도 시 행이 늘지 않는다', async () => {
    sheetRows = [];
    mockSheetsHttp();
    const { appendBooking } = await import('../../api/_google-sheets.js');
    const booking = { customerName: '홍길동', transactionId: ORDER, product: 'charter' };

    // 1회차 — 실제 추가
    const first = await appendBooking(booking);
    expect(first.deduped).toBeUndefined();
    expect(appendCalls).toHaveLength(1);

    // 완료 기록 실패로 죽었다고 가정하고 그대로 재시도
    const second = await appendBooking(booking);
    const third = await appendBooking(booking);

    expect(second.deduped).toBe(true);
    expect(third.deduped).toBe(true);
    expect(appendCalls).toHaveLength(1);   // 🔴 정확히 1행
    expect(sheetRows).toHaveLength(1);
  });

  it('다른 주문은 정상적으로 추가된다 (dedupe 가 과잉 차단하지 않는다)', async () => {
    sheetRows = [];
    mockSheetsHttp();
    const { appendBooking } = await import('../../api/_google-sheets.js');
    await appendBooking({ transactionId: 'ORDER-A', customerName: 'A' });
    await appendBooking({ transactionId: 'ORDER-B', customerName: 'B' });
    expect(appendCalls).toHaveLength(2);
  });

  it('조회가 실패하면 던진다 — "없음" 으로 착각해 중복 추가하지 않는다', async () => {
    sheetRows = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (String(url).includes('oauth2.googleapis.com/token')) {
        return { ok: true, json: async () => ({ access_token: 't' }) } as unknown as Response;
      }
      return { ok: false, json: async () => ({ error: { message: 'quota' } }) } as unknown as Response;
    }));
    const { appendBooking } = await import('../../api/_google-sheets.js');
    await expect(appendBooking({ transactionId: ORDER })).rejects.toThrow('Sheets 조회 실패');
  });
});

describe('선점 — 동시 호출은 한 쪽만 통과', () => {
  it('같은 단계를 동시에 선점하면 정확히 1개만 claimed', async () => {
    const db = createFakeFirestore({ [`bookings/${ORDER}`]: { status: 'CONFIRMED' } });
    const barrier = makeBarrier(2);
    db.__beforeCommit = async ({ attempt }) => { if (attempt === 1) await barrier.wait(); };

    const results = await Promise.all([
      claimStep({ db, orderID: ORDER, field: VOUCHER }),
      claimStep({ db, orderID: ORDER, field: VOUCHER }),
    ]);
    expect(results.filter((r) => r.claimed)).toHaveLength(1);
    expect(results.find((r) => !r.claimed)!.reason).toBe(CLAIM.IN_FLIGHT);
  });

  it('완료된 단계는 다시 선점하지 않는다', async () => {
    const db = createFakeFirestore({
      [`bookings/${ORDER}`]: { voucherSentAtState: 'completed', voucherSentAt: 1 },
    });
    const r = await claimStep({ db, orderID: ORDER, field: VOUCHER });
    expect(r).toEqual({ claimed: false, reason: CLAIM.ALREADY_COMPLETED });
  });
});

describe('선점 저장소 불능 — fail-open 제거', () => {
  it('db 가 없으면 외부 작업을 진행하지 않는다', async () => {
    const r = await claimStepSafe({ db: null, orderID: ORDER, field: VOUCHER });
    expect(r.claimed).toBe(false);
    expect(r.reason).toBe(CLAIM.STORE_UNAVAILABLE);
  });

  it('transaction 이 터져도 claimed=true 로 넘어가지 않는다', async () => {
    const db = createFakeFirestore({ [`bookings/${ORDER}`]: {} });
    db.__beforeCommit = async () => { throw new Error('firestore down'); };
    const r = await claimStepSafe({ db, orderID: ORDER, field: VOUCHER });
    expect(r.claimed).toBe(false);
    expect(r.reason).toBe(CLAIM.STORE_UNAVAILABLE);
  });
});

describe('좀비 선점 — 단계별로 다르게 다룬다', () => {
  const stale = (field: string) => ({
    [`bookings/${ORDER}`]: {
      [`${field}State`]: 'in_progress',
      [`${field}StateAt`]: 1_000_000,
    },
  });

  it('시트는 재선점한다 (외부에 중복 방지 키가 있으므로 안전)', async () => {
    const db = createFakeFirestore(stale(SHEETS));
    const r = await claimStep({
      db, orderID: ORDER, field: SHEETS, nowMs: 1_000_000 + STEP_CLAIM_STALE_MS + 1,
    });
    expect(r.claimed).toBe(true);
    expect(STEP_ZOMBIE_POLICY[SHEETS]).toBe('reclaim');
  });

  it('메일은 재발송하지 않고 outcome_unknown 으로 격리한다', async () => {
    const db = createFakeFirestore(stale(VOUCHER));
    const r = await claimStep({
      db, orderID: ORDER, field: VOUCHER, nowMs: 1_000_000 + STEP_CLAIM_STALE_MS + 1,
    });
    expect(r.claimed).toBe(false);
    expect(r.reason).toBe(CLAIM.OUTCOME_UNKNOWN);
    expect(db.__get(`bookings/${ORDER}`)!.voucherSentAtState).toBe('outcome_unknown');
    expect(STEP_ZOMBIE_POLICY[VOUCHER]).toBe('quarantine');
  });

  it('격리된 뒤에는 몇 번을 다시 돌려도 발송으로 넘어가지 않는다', async () => {
    const db = createFakeFirestore(stale(VOUCHER));
    const now = 1_000_000 + STEP_CLAIM_STALE_MS + 1;
    await claimStep({ db, orderID: ORDER, field: VOUCHER, nowMs: now });
    for (let i = 0; i < 3; i += 1) {
      const again = await claimStep({ db, orderID: ORDER, field: VOUCHER, nowMs: now + i * 1000 });
      expect(again.claimed).toBe(false);
      expect(again.reason).toBe(CLAIM.OUTCOME_UNKNOWN);
    }
  });

  it('아직 신선한 선점은 좀비로 보지 않는다', async () => {
    const db = createFakeFirestore(stale(VOUCHER));
    const r = await claimStep({
      db, orderID: ORDER, field: VOUCHER, nowMs: 1_000_000 + STEP_CLAIM_STALE_MS - 1,
    });
    expect(r.reason).toBe(CLAIM.IN_FLIGHT);
    expect(db.__get(`bookings/${ORDER}`)!.voucherSentAtState).toBe('in_progress');
  });
});

describe('성공 후 완료 기록 실패 — 메일이 두 번 가지 않는다', () => {
  it('전체 흐름: 발송 성공 → 완료 기록 실패 → 재시도 시 격리', async () => {
    const db = createFakeFirestore({ [`bookings/${ORDER}`]: { status: 'CONFIRMED' } });
    let sendCount = 0;
    const sendMail = async () => { sendCount += 1; };

    // 1회차 — 선점 → 발송 성공 → 완료 기록이 실패(Firestore 순간 장애)
    const claim1 = await claimStep({ db, orderID: ORDER, field: VOUCHER, nowMs: 1_000 });
    expect(claim1.claimed).toBe(true);
    await sendMail();
    const failingDb = { collection: () => ({ doc: () => ({ set: async () => { throw new Error('down'); } }) }) };
    await expect(completeStep({ db: failingDb as never, FieldValue, orderID: ORDER, field: VOUCHER }))
      .rejects.toThrow('down');

    // 2회차 — 5분 뒤 재시도. 보냈는지 알 수 없으므로 **보내지 않는다**.
    const claim2 = await claimStep({
      db, orderID: ORDER, field: VOUCHER, nowMs: 1_000 + STEP_CLAIM_STALE_MS + 1,
    });
    expect(claim2.claimed).toBe(false);
    expect(claim2.reason).toBe(CLAIM.OUTCOME_UNKNOWN);
    expect(sendCount).toBe(1);   // 🔴 정확히 1회
  });

  it('markOutcomeUnknown 은 사유를 남겨 운영자가 판단할 수 있게 한다', async () => {
    const db = createFakeFirestore({ [`bookings/${ORDER}`]: {} });
    await markOutcomeUnknown({
      db, orderID: ORDER, field: VOUCHER, reason: 'external_ok_but_completion_write_failed', nowMs: 42,
    });
    const doc = db.__get(`bookings/${ORDER}`)!;
    expect(doc.voucherSentAtState).toBe('outcome_unknown');
    expect(doc.voucherSentAtStateUnknownReason).toContain('completion_write_failed');
    expect(doc.voucherSentAtStateUnknownAtMs).toBe(42);
  });

  it('완료 기록에 성공하면 이후 선점은 완료로 스킵된다', async () => {
    const db = createFakeFirestore({ [`bookings/${ORDER}`]: {} });
    await claimStep({ db, orderID: ORDER, field: VOUCHER, nowMs: 1_000 });
    await completeStep({ db, FieldValue, orderID: ORDER, field: VOUCHER });
    const again = await claimStep({ db, orderID: ORDER, field: VOUCHER, nowMs: 9_999_999 });
    expect(again.reason).toBe(CLAIM.ALREADY_COMPLETED);
    expect(bookingStepGuards(db.__get(`bookings/${ORDER}`)!).skipVoucher).toBe(true);
  });
});

describe('시트 — 성공 후 완료 기록 실패 전체 흐름', () => {
  it('재시도해도 시트는 1행, 두 번째엔 dedupe 로 끝난다', async () => {
    sheetRows = [];
    mockSheetsHttp();
    const { appendBooking } = await import('../../api/_google-sheets.js');
    const db = createFakeFirestore({ [`bookings/${ORDER}`]: {} });
    const booking = { transactionId: ORDER, customerName: '홍길동' };

    const c1 = await claimStep({ db, orderID: ORDER, field: SHEETS, nowMs: 1_000 });
    expect(c1.claimed).toBe(true);
    await appendBooking(booking);
    // 완료 기록 실패 (프로세스 종료)

    const c2 = await claimStep({
      db, orderID: ORDER, field: SHEETS, nowMs: 1_000 + STEP_CLAIM_STALE_MS + 1,
    });
    expect(c2.claimed).toBe(true);           // 시트는 재실행 허용
    const r2 = await appendBooking(booking);
    expect(r2.deduped).toBe(true);           // 그러나 행은 늘지 않는다
    expect(appendCalls).toHaveLength(1);

    await completeStep({ db, FieldValue, orderID: ORDER, field: SHEETS });
    expect(isStepCompleted(db.__get(`bookings/${ORDER}`)!, SHEETS)).toBe(true);
  });
});

describe('SMTP 오류 분류 — 확실한 실패만 재발송', () => {
  it('보내기 전 실패는 재발송 가능, 전송 중 오류는 결과 미상', async () => {
    const { isAmbiguousSendError } = await import('../../api/booking-processor.js');
    // 확실히 안 나감
    expect(isAmbiguousSendError({ preSend: true, message: 'env missing' })).toBe(false);
    expect(isAmbiguousSendError({ code: 'EAUTH' })).toBe(false);
    expect(isAmbiguousSendError({ code: 'ECONNECTION' })).toBe(false);
    expect(isAmbiguousSendError({ code: 'EENVELOPE' })).toBe(false);
    // 나갔는지 알 수 없음 → 재발송 금지
    expect(isAmbiguousSendError({ code: 'ETIMEDOUT' })).toBe(true);
    expect(isAmbiguousSendError({ code: 'ESOCKET' })).toBe(true);
    expect(isAmbiguousSendError({ message: 'who knows' })).toBe(true);
  });
});
