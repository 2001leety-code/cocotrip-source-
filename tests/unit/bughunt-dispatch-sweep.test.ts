/* eslint-disable @typescript-eslint/no-explicit-any -- Firestore/봇 모킹 스캐폴딩. */
/**
 * dispatch sweep 비트랜잭션 expired 덮어쓰기 경합 회귀 (2026-06-14 버그헌트 #9 — sweep-accept-race).
 *
 * 결함: sweepExpiredDispatches 가 status=='sent' AND expiresAt<=now 쿼리로 가져온 dispatch
 *   doc 을 doc.ref.update({status:'expired'}) 로 트랜잭션/재확인 없이 무조건 덮어썼다.
 *   sweep 은 telegram-webhook-driver 콜백 처리 직전 lazy 실행 → 기사가 만료 직전 [수락] 을
 *   누르면 handleAccept 트랜잭션이 sent→accepted + bookings.dispatchStatus='accepted' 를
 *   먼저 커밋하는데, 쿼리 스냅샷('sent')을 들고 있던 sweep 이 'expired' 로 덮어써
 *   dispatch_messages=expired 인데 bookings=accepted 불일치 + 허위 '재배차 필요' 알림
 *   → 한 예약에 기사 2명 배정 위험.
 * fix: update 를 runTransaction 으로 감싸 tx.get 후 freshStatus==='sent' 일 때만 'expired'
 *   전이(accept 가 먼저 커밋했으면 스킵). 운영자 알림도 실제 expired 전이 성공 건만 발화.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const callBotMock = vi.fn();
vi.mock('../../api/_shared/telegram-bot.js', () => ({
  callBot: (...a: any[]) => callBotMock(...a),
}));
const notifyMock = vi.fn();
vi.mock('../../api/_shared/notify.js', () => ({ notify: (...a: any[]) => notifyMock(...a) }));
vi.mock('firebase-admin/firestore', () => ({ FieldValue: { serverTimestamp: () => 'TS' } }));

let dbImpl: any;
vi.mock('../../api/_shared/firebase-admin.js', () => ({ initAdminDb: () => dbImpl }));

// @ts-expect-error — ESM .js (Vercel serverless 모듈)
import { sweepExpiredDispatches } from '../../api/_shared/dispatch-sweep.js';

/**
 * 상태 저장 firestore mock — dispatch_messages in-memory.
 * 쿼리는 현재 status==='sent' 인 doc 만 반환(컬렉션 .where 체인 모킹).
 * runTransaction 콜백은 동기 실행 → tx.get 이 항상 최신 상태(외부 변경 반영)를 본다.
 * onTxGet 훅으로 "트랜잭션 진입 직후 accept 가 먼저 커밋" 시나리오를 주입한다.
 */
function makeWorld(initial: Record<string, any>, onTxGet?: (id: string) => void) {
  const docs: Record<string, any> = { ...initial };
  function makeRef(id: string) {
    return {
      __id: id,
      update: async (patch: any) => { Object.assign(docs[id], patch); },
    };
  }
  // 쿼리 시점에 status==='sent' 인 doc 들의 스냅샷 (sweep 이 들고 도는 stale 목록 재현)
  const sentAtQuery = Object.keys(docs).filter((id) => docs[id].status === 'sent');
  const snapDocs = sentAtQuery.map((id) => ({
    id,
    ref: makeRef(id),
    data: () => ({ ...docs[id] }),
  }));
  const query = {
    where: () => query,
    limit: () => query,
    get: async () => ({ empty: snapDocs.length === 0, docs: snapDocs }),
  };
  const db: any = {
    collection: () => query,
    runTransaction: async (fn: any) => {
      const tx = {
        get: async (ref: any) => {
          if (onTxGet) onTxGet(ref.__id); // 트랜잭션 진입 → accept 선커밋 주입 지점
          const d = docs[ref.__id];
          return d ? { exists: true, data: () => ({ ...d }) } : { exists: false, data: () => ({}) };
        },
        update: (ref: any, patch: any) => { Object.assign(docs[ref.__id], patch); },
      };
      return fn(tx);
    },
  };
  return { db, get: (id: string) => docs[id] };
}

const OPTS = { driverBotToken: 'drvtok', adminBotToken: 'admtok', adminChatId: 99 };

describe('dispatch sweep — 비트랜잭션 expired 덮어쓰기 경합 (버그헌트 #9)', () => {
  beforeEach(() => { callBotMock.mockReset(); notifyMock.mockReset(); });

  it('정상 만료(여전히 sent) → expired 전이 + 운영자 알림 발화', async () => {
    const w = makeWorld({ d1: { status: 'sent', orderID: 'ord1', driverName: '기사A' } });
    dbImpl = w.db;
    const res = await sweepExpiredDispatches(OPTS);
    expect(w.get('d1').status).toBe('expired');
    expect(res.swept).toBe(1);
    // 운영자 dispatch 알림 발화
    expect(notifyMock).toHaveBeenCalledTimes(1);
    expect(notifyMock.mock.calls[0][0]).toBe('dispatch');
  });

  it('만료 직전 accept 가 먼저 커밋 → sweep 이 accepted 를 expired 로 덮지 않음', async () => {
    // 쿼리 스냅샷 시점엔 'sent'. 트랜잭션 tx.get 직전 accept 가 sent→accepted 선커밋 재현.
    const w = makeWorld(
      { d1: { status: 'sent', orderID: 'ord1', driverName: '기사A' } },
      (id) => { if (id === 'd1') w.get(id).status = 'accepted'; },
    );
    dbImpl = w.db;
    const res = await sweepExpiredDispatches(OPTS);
    // accepted 유지 — expired 로 덮어쓰기 차단 (불일치/이중배차 방지)
    expect(w.get('d1').status).toBe('accepted');
    expect(res.swept).toBe(0);
  });

  it('accept 가 이긴 건은 운영자 허위 재배차 알림 미발화', async () => {
    const w = makeWorld(
      { d1: { status: 'sent', orderID: 'ord1', driverName: '기사A' } },
      (id) => { if (id === 'd1') w.get(id).status = 'accepted'; },
    );
    dbImpl = w.db;
    await sweepExpiredDispatches(OPTS);
    expect(notifyMock).not.toHaveBeenCalled();
  });

  it('accept 가 이긴 건은 Telegram 편집/삭제(PII)도 스킵', async () => {
    const w = makeWorld(
      { d1: { status: 'sent', orderID: 'ord1', driverName: '기사A', telegramMessageId: 555, driverChatId: 111 } },
      (id) => { if (id === 'd1') w.get(id).status = 'accepted'; },
    );
    dbImpl = w.db;
    await sweepExpiredDispatches(OPTS);
    expect(callBotMock).not.toHaveBeenCalled();
  });

  it('혼합 배치: 한 건은 만료, 한 건은 accept 선점 → 만료 건만 처리', async () => {
    const w = makeWorld(
      {
        d1: { status: 'sent', orderID: 'ord1', driverName: '기사A' },
        d2: { status: 'sent', orderID: 'ord2', driverName: '기사B' },
      },
      (id) => { if (id === 'd2') w.get(id).status = 'accepted'; }, // d2 만 accept 선점
    );
    dbImpl = w.db;
    const res = await sweepExpiredDispatches(OPTS);
    expect(w.get('d1').status).toBe('expired');
    expect(w.get('d2').status).toBe('accepted');
    expect(res.swept).toBe(1);
    // 만료된 d1 1건에 대해서만 운영자 알림
    expect(notifyMock).toHaveBeenCalledTimes(1);
    expect(notifyMock.mock.calls[0][1]).toContain('ord1');
  });
});
