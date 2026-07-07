/**
 * $9.90 AI 플래너 구매 쿠폰 발급 멱등성 가드 (운영자 2026-07-07 "가입 때도 구매 때도 둘 다").
 *
 * 🔴 SAFETY(money): 같은 orderID 재캡처(PayPal 멱등 재시도)가 쿠폰을 중복 발급하면 안 됨.
 * users/{uid}/purchaseCouponOrders/{orderID} 마커로 1건당 1쌍(차터5%+투어5%) 보장.
 * 최소 in-memory Firestore mock 으로 트랜잭션 멱등을 검증한다.
 */
import { describe, it, expect } from 'vitest';
import { issuePurchaseCouponsForOrder } from '../../api/onboarding-coupons.js';

// ── 최소 in-memory Firestore mock (collection/doc/runTransaction/get/set) ──
function makeMockDb() {
  const store = new Map<string, any>(); // path → data
  let autoId = 0;

  function docRef(path: string) {
    return {
      path,
      collection: (sub: string) => colRef(`${path}/${sub}`),
    };
  }
  function colRef(path: string) {
    return {
      path,
      doc: (id?: string) => docRef(`${path}/${id || `auto-${++autoId}`}`),
    };
  }

  const tx = {
    get: async (ref: any) => ({
      exists: store.has(ref.path),
      data: () => store.get(ref.path),
    }),
    set: (ref: any, data: any) => { store.set(ref.path, data); },
  };

  return {
    _store: store,
    collection: (name: string) => colRef(name),
    runTransaction: async (fn: (t: typeof tx) => Promise<any>) => fn(tx),
  };
}

const couponsIssued = (db: ReturnType<typeof makeMockDb>, uid: string) =>
  [...db._store.keys()].filter((k) => k.startsWith(`users/${uid}/coupons/`)).length;

describe('issuePurchaseCouponsForOrder — 멱등 발급', () => {
  it('첫 발급: 차터5% + 투어5% 2장 + 마커', async () => {
    const db = makeMockDb();
    const r = await issuePurchaseCouponsForOrder(db as never, 'uidA', 'ORDER1');
    expect(r.issued).toBe(2);
    expect(couponsIssued(db, 'uidA')).toBe(2);
    expect(db._store.has('users/uidA/purchaseCouponOrders/ORDER1')).toBe(true);
    // 쿠폰 스코프/값 확인
    const coupons = [...db._store.entries()].filter(([k]) => k.startsWith('users/uidA/coupons/')).map(([, v]) => v);
    expect(coupons.map((c) => c.productScope).sort()).toEqual(['charter', 'tour-package']);
    expect(coupons.every((c) => c.value === 5 && c.type === 'percent' && c.isUsed === false)).toBe(true);
    expect(coupons.every((c) => c.source === 'ai-plan-purchase')).toBe(true);
  });

  it('같은 orderID 재발급 → 0장 (멱등)', async () => {
    const db = makeMockDb();
    await issuePurchaseCouponsForOrder(db as never, 'uidA', 'ORDER1');
    const r2 = await issuePurchaseCouponsForOrder(db as never, 'uidA', 'ORDER1');
    expect(r2.issued).toBe(0);
    expect(r2.alreadyIssued).toBe(true);
    expect(couponsIssued(db, 'uidA')).toBe(2); // 여전히 2장 (중복 없음)
  });

  it('다른 orderID → 새 1쌍 추가 (구매마다 발급)', async () => {
    const db = makeMockDb();
    await issuePurchaseCouponsForOrder(db as never, 'uidA', 'ORDER1');
    const r2 = await issuePurchaseCouponsForOrder(db as never, 'uidA', 'ORDER2');
    expect(r2.issued).toBe(2);
    expect(couponsIssued(db, 'uidA')).toBe(4); // 2 orders × 2
  });

  it('uid/orderID 누락 → 발급 0 (방어)', async () => {
    const db = makeMockDb();
    expect((await issuePurchaseCouponsForOrder(db as never, '', 'ORDER1')).issued).toBe(0);
    expect((await issuePurchaseCouponsForOrder(db as never, 'uidA', '')).issued).toBe(0);
    expect((await issuePurchaseCouponsForOrder(null as never, 'uidA', 'ORDER1')).issued).toBe(0);
  });
});
