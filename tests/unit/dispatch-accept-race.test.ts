/* eslint-disable @typescript-eslint/no-explicit-any -- 핸들러/Firestore 모킹 스캐폴딩. */
/**
 * dispatch accept 경합 회귀 (2026-06-13 버그헌트 — booking-dispatch-race FIX1).
 *
 * 결함: handleAccept 의 status 확인~쓰기가 비원자 read-then-write → 같은 배차에 콜백 2건
 *   동시 진입(Telegram 재전송/기사 더블탭) 또는 broadcast 시 두 기사 동시 수락하면 둘 다
 *   통과 → bookings.dispatchedDriverId last-write-wins = 한 예약에 기사 2명 배정.
 * fix: accept claim 을 runTransaction 으로 원자화 — 단 1명만 'sent'→'accepted' 통과.
 *   bookings 는 set(merge) 로 미존재(capture 직후) 시에도 NOT_FOUND 없이 안전.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const callBotMock = vi.fn();
vi.mock('../../api/_shared/telegram-bot.js', () => ({
  callBot: (...a: any[]) => callBotMock(...a),
  sendBotMessage: vi.fn(), verifyWebhookSecret: vi.fn(), parseUpdate: vi.fn(),
}));
const notifyMock = vi.fn();
vi.mock('../../api/_shared/notify.js', () => ({ notify: (...a: any[]) => notifyMock(...a) }));
vi.mock('../../api/_shared/dispatch-sweep.js', () => ({ sweepExpiredDispatches: vi.fn() }));
vi.mock('firebase-admin/firestore', () => ({ FieldValue: { serverTimestamp: () => 'TS' } }));

let dbImpl: any;
vi.mock('../../api/_shared/firebase-admin.js', () => ({ initAdminDb: () => dbImpl }));

// @ts-expect-error — ESM .js (Vercel serverless 모듈)
import { handleAccept } from '../../api/telegram-webhook-driver.js';

// 상태 저장 firestore mock — dispatch_messages(여러 건 id별) + bookings 1건 in-memory.
// runTransaction 은 콜백 동기 실행(순차 호출 = 첫 commit 후 둘째가 갱신 상태를 본다 → 가드 검증).
function makeWorld(initialBooking: any = null) {
  const dispatches: Record<string, any> = {};
  let booking: any = initialBooking;
  function dispatchRef(id: string) {
    if (!(id in dispatches)) dispatches[id] = { status: 'sent' };
    return { __kind: 'dispatch', __id: id };
  }
  const bookingRef = { __kind: 'booking' };
  const db: any = {
    collection: (name: string) => ({ doc: (id?: string) => (name === 'bookings' ? bookingRef : { __kind: 'dispatch', __id: id }) }),
    runTransaction: async (fn: any) => {
      const tx = {
        get: async (ref: any) => {
          if (ref.__kind === 'dispatch') {
            const d = dispatches[ref.__id];
            return d ? { exists: true, data: () => ({ ...d }) } : { exists: false, data: () => ({}) };
          }
          return booking ? { exists: true, data: () => ({ ...booking }) } : { exists: false, data: () => ({}) };
        },
        update: (ref: any, patch: any) => {
          if (ref.__kind === 'dispatch') Object.assign(dispatches[ref.__id], patch);
          else booking = { ...(booking || {}), ...patch };
        },
        set: (ref: any, patch: any, opts: any) => {
          if (ref.__kind === 'booking') booking = opts?.merge ? { ...(booking || {}), ...patch } : { ...patch };
          else dispatches[ref.__id] = { ...(opts?.merge ? dispatches[ref.__id] : {}), ...patch };
        },
      };
      return fn(tx);
    },
  };
  return { db, dispatchRef, getDispatch: (id: string) => dispatches[id], getBooking: () => booking };
}

const drvA = { driverName: '기사A', driverChatId: 111, driverVehicle: 'staria', telegramMessageId: null };
const drvB = { driverName: '기사B', driverChatId: 222, driverVehicle: 'sprinter', telegramMessageId: null };

describe('dispatch accept 경합 — runTransaction first-to-accept (FIX1)', () => {
  beforeEach(() => { callBotMock.mockReset(); notifyMock.mockReset(); });

  it('같은 배차 더블탭 → 첫 수락만 배정, 둘째는 ALREADY_TAKEN', async () => {
    const w = makeWorld(null);
    dbImpl = w.db;
    const ref = w.dispatchRef('d1');

    await handleAccept('tok', { chatId: 111, callbackId: 'cbA' }, ref, drvA, 'ord1');
    expect(w.getDispatch('d1').status).toBe('accepted');
    expect(w.getBooking().dispatchedDriverId).toBe(111);
    expect(w.getBooking().dispatchStatus).toBe('accepted');

    // 같은 dispatch 재진입(이미 accepted) → 차단
    await handleAccept('tok', { chatId: 111, callbackId: 'cbA2' }, ref, drvA, 'ord1');
    const lastToast = JSON.stringify(callBotMock.mock.calls.at(-1));
    expect(lastToast).toContain('이미 다른 기사가 수락');
  });

  it('broadcast 두 기사 동시 수락(다른 dispatch 행) → 한 예약에 1명만 (덮어쓰기 없음)', async () => {
    const w = makeWorld(null);
    dbImpl = w.db;
    const refA = w.dispatchRef('d1');
    const refB = w.dispatchRef('d2'); // 둘 다 status='sent'

    await handleAccept('tok', { chatId: 111, callbackId: 'cbA' }, refA, drvA, 'ord1');
    expect(w.getBooking().dispatchedDriverId).toBe(111);

    // 기사B 가 자기 dispatch(여전히 sent)로 수락 시도 → bookings.dispatchStatus='accepted' 가드
    await handleAccept('tok', { chatId: 222, callbackId: 'cbB' }, refB, drvB, 'ord1');
    expect(w.getBooking().dispatchedDriverId).toBe(111); // 여전히 기사A
    expect(w.getBooking().driver).toBe('기사A');
    expect(w.getDispatch('d2').status).toBe('sent'); // B 의 dispatch 는 accepted 로 안 바뀜
  });

  it('booking 문서 미존재(capture 직후)에도 첫 수락 성공 — set(merge) NOT_FOUND 회피', async () => {
    const w = makeWorld(null); // booking 없음
    dbImpl = w.db;
    await handleAccept('tok', { chatId: 111, callbackId: 'cb' }, w.dispatchRef('d1'), drvA, 'ord2');
    expect(w.getBooking()).not.toBeNull();
    expect(w.getBooking().dispatchStatus).toBe('accepted');
  });

  it('차단된(ALREADY_TAKEN) 수락은 부수효과 없음 — notify 미발화', async () => {
    const w = makeWorld(null);
    dbImpl = w.db;
    const ref = w.dispatchRef('d1');
    await handleAccept('tok', { chatId: 111, callbackId: 'cb1' }, ref, drvA, 'ord3');
    notifyMock.mockReset();
    await handleAccept('tok', { chatId: 333, callbackId: 'cb2' }, ref, drvA, 'ord3');
    expect(notifyMock).not.toHaveBeenCalled();
  });
});
