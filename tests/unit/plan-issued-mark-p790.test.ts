/**
 * markPlanIssued 회귀 가드 (P790, 2026-06-03 자율 사이클).
 *
 * 배경: plan 발급 멱등성 마킹이 기존 fire-and-forget(await 없음) → serverless 응답 후 instance
 * freeze(P222/P319) 시 plan_issued_orders 마킹 미완 → 재시도가 paymentGate 검사 통과 → plan 중복발급
 * (돈 이중청구 아님 — capture 별개. Gemini 비용 + 중복 plan). fix: await + 헬퍼 추출(테스트 가능).
 *
 * 가드: 실 PayPal orderId 만 마킹 / ADMIN·TEST·MANUAL prefix skip / set 완료까지 await / non-fatal.
 */
import { describe, it, expect, vi } from 'vitest';
import { markPlanIssued } from '../../api/_ai_core/planPersister.js';

function mockDb() {
  const set = vi.fn(() => Promise.resolve());
  const doc = vi.fn(() => ({ set }));
  const collection = vi.fn(() => ({ doc }));
  return { db: { collection }, set, doc, collection };
}

describe('markPlanIssued — plan 발급 멱등성 마킹', () => {
  it('실 PayPal orderId → plan_issued_orders 마킹 (true)', async () => {
    const m = mockDb();
    const r = await markPlanIssued(m.db, '5O190127TN364715T', { planId: 'p1', uid: 'u1' });
    expect(r).toBe(true);
    expect(m.collection).toHaveBeenCalledWith('plan_issued_orders');
    expect(m.doc).toHaveBeenCalledWith('5O190127TN364715T');
    expect(m.set).toHaveBeenCalledTimes(1);
    const payload = m.set.mock.calls[0][0] as Record<string, unknown>;
    expect(payload.provider).toBe('paypal');
    expect(payload.planId).toBe('p1');
    expect(payload.uid).toBe('u1');
  });

  it.each(['ADMIN-BYPASS-abc', 'TEST-xyz', 'MANUAL-123'])('%s prefix → 마킹 skip (false)', async (oid) => {
    const m = mockDb();
    const r = await markPlanIssued(m.db, oid, { planId: 'p1' });
    expect(r).toBe(false);
    expect(m.set).not.toHaveBeenCalled();
  });

  it('빈/누락 orderId → skip (false)', async () => {
    const m = mockDb();
    expect(await markPlanIssued(m.db, '', {})).toBe(false);
    expect(await markPlanIssued(m.db, undefined as unknown as string, {})).toBe(false);
    expect(m.set).not.toHaveBeenCalled();
  });

  it('set 실패 → throw 안 함 (non-fatal), 시도=true', async () => {
    const set = vi.fn(() => Promise.reject(new Error('firestore down')));
    const db = { collection: () => ({ doc: () => ({ set }) }) };
    await expect(markPlanIssued(db, '5O190127TN364715T', { planId: 'p1' })).resolves.toBe(true);
  });

  it('🔴 await 보장 — set 의 promise 완료 전 반환 안 함 (freeze 유실 방지의 핵심)', async () => {
    let resolved = false;
    const set = vi.fn(() => new Promise<void>((res) => setTimeout(() => { resolved = true; res(); }, 20)));
    const db = { collection: () => ({ doc: () => ({ set }) }) };
    await markPlanIssued(db, '5O190127TN364715T', { planId: 'p1' });
    expect(resolved).toBe(true); // await 안 했으면 여기서 false (fire-and-forget 회귀 차단)
  });
});
