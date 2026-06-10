import { describe, it, expect } from 'vitest';
// @ts-expect-error — ESM .js, no type decls
import { aggregateDecisionSummary, enqueueDecision, resolveDecision } from '../../api/_shared/decisionQueue.js';

// 2026-06-10 의사결정 큐(P5) — 머지 전 로컬 검증($0).

/** Firestore mock: collection().where().where().limit().get() + .add() + .doc().update(). */
function mockDb({ dupExists = false } = {}) {
  const calls: any = { added: null, updated: null };
  const q: any = { where: () => q, limit: () => q, get: async () => ({ empty: !dupExists, docs: [] }) };
  const col: any = {
    where: () => q,
    add: async (d: any) => { calls.added = d; return { id: 'new1' }; },
    doc: (id: string) => ({ update: async (d: any) => { calls.updated = { id, ...d }; } }),
  };
  return { db: { collection: () => col }, calls };
}

describe('aggregateDecisionSummary — pending 집계 (순수)', () => {
  const docs = [
    { status: 'pending', type: 'content_publish', title: 'A', createdAtMs: 100 },
    { status: 'pending', type: 'content_publish', title: 'B', createdAtMs: 200 },
    { status: 'pending', type: 'cs_reply', title: 'C', createdAtMs: 300 },
    { status: 'approved', type: 'content_publish', title: 'D', createdAtMs: 400 }, // 제외
    { status: 'rejected', type: 'cs_reply', title: 'E', createdAtMs: 500 },         // 제외
  ];
  it('pending 만 카운트 (approved/rejected 제외)', () => {
    expect(aggregateDecisionSummary(docs).total).toBe(3);
  });
  it('type 별 분포', () => {
    expect(aggregateDecisionSummary(docs).byType).toEqual({ content_publish: 2, cs_reply: 1 });
  });
  it('top 3 = createdAtMs 내림차순', () => {
    expect(aggregateDecisionSummary(docs).top.map((t: any) => t.title)).toEqual(['C', 'B', 'A']);
  });
  it('빈/undefined → 0 (throw 없음)', () => {
    expect(aggregateDecisionSummary([]).total).toBe(0);
    expect(aggregateDecisionSummary(undefined).total).toBe(0);
  });
});

describe('enqueueDecision — 멱등 + 검증', () => {
  const item = { type: 'content_publish', title: '발행 검토', dedupeKey: 'content-20000' };
  it('pending 중복 없으면 add', async () => {
    const { db, calls } = mockDb({ dupExists: false });
    const r = await enqueueDecision(db, item);
    expect(r.ok).toBe(true);
    expect(r.added).toBe(true);
    expect(calls.added.status).toBe('pending');
    expect(calls.added.dedupeKey).toBe('content-20000');
  });
  it('같은 dedupeKey pending 있으면 skip (멱등)', async () => {
    const { db, calls } = mockDb({ dupExists: true });
    const r = await enqueueDecision(db, item);
    expect(r.skipped).toBe(true);
    expect(calls.added).toBeNull();
  });
  it('dedupeKey/title 누락 → ok:false (add 안 함)', async () => {
    const { db, calls } = mockDb();
    expect((await enqueueDecision(db, { title: 'x' } as any)).ok).toBe(false);
    expect((await enqueueDecision(db, { dedupeKey: 'k' } as any)).ok).toBe(false);
    expect(calls.added).toBeNull();
  });
});

describe('resolveDecision — 상태 변경', () => {
  it('approve → approved + resolvedAtMs', async () => {
    const { db, calls } = mockDb();
    const r = await resolveDecision(db, 'id1', 'approved');
    expect(r.ok).toBe(true);
    expect(calls.updated.status).toBe('approved');
    expect(calls.updated.resolvedAtMs).toBeGreaterThan(0);
  });
  it('pending/잘못된 상태 → ok:false (update 안 함)', async () => {
    const { db, calls } = mockDb();
    expect((await resolveDecision(db, 'id1', 'pending')).ok).toBe(false);
    expect((await resolveDecision(db, 'id1', 'bogus')).ok).toBe(false);
    expect((await resolveDecision(db, '', 'approved')).ok).toBe(false);
    expect(calls.updated).toBeNull();
  });
});
