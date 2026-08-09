/**
 * 회귀 — sweepExpiredPending 이 Firestore 깊은 병합 아래에서 수렴하는가 (F3, 2026-08-09).
 *
 * 버그: sweep 은 "만료 엔트리를 뺀 맵"을 만들어 `set(..., {merge:true})` 로 썼다.
 * Firestore 의 merge 는 **중첩 맵을 깊게 병합**하므로 JS 객체에서 키를 빼도 문서에서는
 * 지워지지 않는다 → 만료 엔트리가 문서에 영구 잔존 → 5분 cron 이 같은 doc 을 매번
 * 다시 "sweep" 하며 영원히 재기록한다(swept 가 절대 0 으로 수렴하지 않음).
 *   피해: (a) 무의미한 Firestore 트랜잭션·쓰기 영구 반복(비용·쿼터),
 *         (b) 날짜 doc 무한 성장 → 장기적으로 1MiB 한도,
 *         (c) `swept` 지표가 영영 0 이 안 됨.
 *   돈 영향 없음 — 만료 엔트리는 summarizeSlot 이 이미 집계에서 제외한다(아래 회귀로 잠금).
 *
 * 왜 기존 테스트가 못 잡았나: 기존 목의 merge 는 얕은 병합(`{...cur, ...data}`)이라
 * `slot_pending` 을 통째로 교체했다 = 실제 Firestore 와 다른 의미론. 이 파일의 목은
 * 중첩 맵을 재귀 병합하는 **실제 merge 의미론**을 쓴다.
 *
 * 수정: 만료된 양수 엔트리를 지우려 하지 말고 releaseSlotLock 과 같은
 * **tombstone(`count:0` + 과거 `expiresAt`)** 으로 명시적으로 덮는다. `swept` 는 이번
 * 호출에서 새로 무력화한 양수 엔트리만 세므로 2회차는 0 → 쓰기도 없다.
 *
 * Approach: Firestore-free. runTransaction 목 + 깊은 병합 + 쓰기 횟수 계수.
 */
import { describe, it, expect } from 'vitest';
import {
  acquireSlotLock,
  releaseSlotLock,
  sweepExpiredPending,
  summarizeSlot,
} from '../../api/_shared/slot-capacity.js';

type Doc = Record<string, unknown>;

const isPlainObject = (v: unknown): v is Doc =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** Firestore `set(..., {merge:true})` 의미론: 중첩 맵은 재귀 병합, 그 외는 교체. */
function deepMerge(target: Doc, source: Doc): Doc {
  const out: Doc = { ...target };
  for (const [k, v] of Object.entries(source)) {
    out[k] = isPlainObject(v) && isPlainObject(out[k])
      ? deepMerge(out[k] as Doc, v)
      : structuredClone(v);
  }
  return out;
}

/**
 * 깊은 병합 목 — set/merge 는 Firestore 와 같게, 쓰기 횟수를 센다.
 * `doc(path).set(...)` (트랜잭션 밖 경로, releaseSlotLock) 도 지원.
 */
function makeDeepMergeDb(initialDocs: Record<string, Doc> = {}) {
  const store = new Map<string, Doc>();
  for (const [path, data] of Object.entries(initialDocs)) store.set(path, structuredClone(data));
  let writes = 0;

  function write(path: string, data: Doc, opts: { merge?: boolean } = {}) {
    writes += 1;
    const cur = store.get(path);
    store.set(path, opts.merge && cur ? deepMerge(cur, data) : structuredClone(data));
  }

  function doc(path: string) {
    return {
      path,
      set: async (data: Doc, opts: { merge?: boolean } = {}) => { write(path, data, opts); },
    };
  }

  async function runTransaction(fn: (tx: unknown) => Promise<unknown>) {
    const tx = {
      get(ref: { path: string }) {
        const cur = store.get(ref.path);
        return Promise.resolve({
          exists: cur !== undefined,
          data: () => structuredClone(cur || {}),
        });
      },
      set(ref: { path: string }, data: Doc, opts: { merge?: boolean } = {}) {
        write(ref.path, data, opts);
      },
    };
    return fn(tx);
  }

  return { doc, runTransaction, _peek: (path: string) => store.get(path), _writes: () => writes };
}

const PATH = 'tour_availability/test-tour/dates/2026-06-01';
const base = { tourId: 'test-tour', date: '2026-06-01' };
const past = (ms = 60_000) => new Date(Date.now() - ms).toISOString();
const future = (ms = 60_000) => new Date(Date.now() + ms).toISOString();
const pendingOf = (db: ReturnType<typeof makeDeepMergeDb>, slotId: string) =>
  ((db._peek(PATH)!.slot_pending as Record<string, Record<string, { count?: number }>>) || {})[slotId];
/** 저장된 doc 을 경로로 파고든다(캐스팅 없이 중첩 값 단언용). */
const nested = (db: ReturnType<typeof makeDeepMergeDb>, path: string[]): unknown =>
  path.reduce<unknown>((cur, k) => (isPlainObject(cur) ? cur[k] : undefined), db._peek(PATH));

// 목 자체가 Firestore 를 흉내내는지부터 확인 — 목이 틀리면 아래 회귀가 전부 무의미.
describe('deepMerge 목 — Firestore merge 의미론', () => {
  it('중첩 맵에서 빠진 키는 병합으로 지워지지 않는다', () => {
    const db = makeDeepMergeDb({ [PATH]: { slot_pending: { a: { X: { count: 2 } } } } });
    // 실제 sweep 이 하던 쓰기 = "X 를 뺀 맵".
    db.doc(PATH).set({ slot_pending: { a: {} } }, { merge: true });
    expect(nested(db, ['slot_pending', 'a', 'X', 'count'])).toBe(2); // 남아 있다
  });
});

describe('sweepExpiredPending — 깊은 병합에서의 수렴 (F3)', () => {
  it('만료 양수 엔트리 + 활성 엔트리: 1회차 swept=1, 2회차 swept=0 이고 쓰기도 없다', async () => {
    const db = makeDeepMergeDb({
      [PATH]: {
        slot_pending: {
          'slot-a': {
            'ORD-EXP': { count: 2, expiresAt: past() },
            'ORD-OK': { count: 3, expiresAt: future() },
          },
        },
      },
    });

    const r1 = await sweepExpiredPending({ ...base, adminDb: db });
    expect(r1.swept).toBe(1);

    const writesAfterFirst = db._writes();
    const r2 = await sweepExpiredPending({ ...base, adminDb: db });
    expect(r2.swept).toBe(0); // 🔴 수정 전: 1 (영구 재기록)
    expect(db._writes()).toBe(writesAfterFirst); // 2회차는 문서를 쓰지 않는다

    const r3 = await sweepExpiredPending({ ...base, adminDb: db });
    expect(r3.swept).toBe(0);
    expect(db._writes()).toBe(writesAfterFirst);
  });

  it('만료 엔트리는 무력화되고(count 0) 활성 엔트리는 무손상', async () => {
    const db = makeDeepMergeDb({
      [PATH]: {
        slot_pending: {
          'slot-a': {
            'ORD-EXP': { count: 2, expiresAt: past() },
            'ORD-OK': { count: 3, expiresAt: future() },
          },
        },
      },
    });
    await sweepExpiredPending({ ...base, adminDb: db });

    const slotA = pendingOf(db, 'slot-a');
    expect(slotA['ORD-EXP'].count).toBe(0); // 죽은 엔트리 = tombstone
    expect(slotA['ORD-OK'].count).toBe(3); // 활성 주문 보존
    expect(summarizeSlot(db._peek(PATH)!, 'slot-a').pending).toBe(3);
  });

  it('모든 엔트리 만료여도 수렴한다 (1회차 swept=2 → 2회차 0)', async () => {
    const db = makeDeepMergeDb({
      [PATH]: {
        slot_pending: {
          'slot-a': {
            'ORD-1': { count: 2, expiresAt: past() },
            'ORD-2': { count: 4, expiresAt: past(120_000) },
          },
        },
      },
    });
    expect((await sweepExpiredPending({ ...base, adminDb: db })).swept).toBe(2);
    expect((await sweepExpiredPending({ ...base, adminDb: db })).swept).toBe(0); // 🔴 수정 전: 2
    expect(summarizeSlot(db._peek(PATH)!, 'slot-a')).toEqual({ confirmed: 0, pending: 0, total: 0 });
  });

  it('다른 slot 은 건드리지 않는다 (활성 슬롯 무손상 + 만료 슬롯만 수렴)', async () => {
    const okExpiry = future();
    const db = makeDeepMergeDb({
      [PATH]: {
        slot_bookings: { 'slot-b': 4 },
        slot_pending: {
          'slot-a': { 'ORD-EXP': { count: 2, expiresAt: past() } },
          'slot-b': { 'ORD-OK': { count: 1, expiresAt: okExpiry } },
        },
      },
    });
    expect((await sweepExpiredPending({ ...base, adminDb: db })).swept).toBe(1);
    expect((await sweepExpiredPending({ ...base, adminDb: db })).swept).toBe(0);

    expect(pendingOf(db, 'slot-b')['ORD-OK']).toEqual({ count: 1, expiresAt: okExpiry });
    expect(nested(db, ['slot_bookings', 'slot-b'])).toBe(4); // 확정석 불변
    expect(summarizeSlot(db._peek(PATH)!, 'slot-b')).toEqual({ confirmed: 4, pending: 1, total: 5 });
  });

  it('만료 엔트리 무력화가 capacity 계산을 바꾸지 않는다 (회귀)', async () => {
    const db = makeDeepMergeDb({
      [PATH]: {
        status: 'available',
        slot_bookings: { 'slot-a': 1 },
        slot_pending: {
          'slot-a': {
            'ORD-EXP': { count: 5, expiresAt: past() },
            'ORD-OK': { count: 2, expiresAt: future() },
          },
        },
      },
    });
    const before = summarizeSlot(db._peek(PATH)!, 'slot-a');
    await sweepExpiredPending({ ...base, adminDb: db });
    expect(summarizeSlot(db._peek(PATH)!, 'slot-a')).toEqual(before); // 만료분은 원래 0으로 셌다

    // sweep 후에도 남은 정원이 같다: confirmed 1 + pending 2 = 3, capacity 7 → 4 좌석.
    const r = await acquireSlotLock({
      ...base, adminDb: db, slotId: 'slot-a', pax: 4, capacity: 7, orderId: 'ORD-NEW',
    });
    expect(r.remaining).toBe(0);
    await expect(acquireSlotLock({
      ...base, adminDb: db, slotId: 'slot-a', pax: 1, capacity: 7, orderId: 'ORD-OVER',
    })).rejects.toThrow(/Slot full/);
  });

  it('releaseSlotLock 이 남긴 tombstone 은 다시 세지 않는다 (쓰기 0)', async () => {
    const db = makeDeepMergeDb();
    await acquireSlotLock({
      ...base, adminDb: db, slotId: 'slot-a', pax: 2, capacity: 7, orderId: 'ORD-1',
    });
    await releaseSlotLock({ ...base, adminDb: db, slotId: 'slot-a', orderId: 'ORD-1' });

    const writesBefore = db._writes();
    const r = await sweepExpiredPending({ ...base, adminDb: db });
    expect(r.swept).toBe(0); // 🔴 수정 전: 1 (이미 무력화된 엔트리를 매 tick 재기록)
    expect(db._writes()).toBe(writesBefore);
  });

  it('하위호환: 옛 단일 엔트리(슬롯 루트)도 수렴한다', async () => {
    const db = makeDeepMergeDb({
      [PATH]: {
        slot_pending: {
          'slot-a': { count: 2, expiresAt: past(), orderId: 'OLD-EXP' },
          'slot-b': { count: 1, expiresAt: future(), orderId: 'OLD-OK' },
        },
      },
    });
    expect((await sweepExpiredPending({ ...base, adminDb: db })).swept).toBe(1);
    // 🔴 수정 전: 루트 count 가 그대로 2 라 매 tick swept=1 무한 반복.
    expect((await sweepExpiredPending({ ...base, adminDb: db })).swept).toBe(0);
    expect(summarizeSlot(db._peek(PATH)!, 'slot-a').pending).toBe(0);
    expect(summarizeSlot(db._peek(PATH)!, 'slot-b').pending).toBe(1); // 활성 옛 엔트리 보존
  });

  it('만료 판정 불가(expiresAt 없음) 양수 엔트리도 한 번만 무력화된다', async () => {
    const db = makeDeepMergeDb({
      [PATH]: { slot_pending: { 'slot-a': { 'ORD-BAD': { count: 3 } } } },
    });
    expect((await sweepExpiredPending({ ...base, adminDb: db })).swept).toBe(1);
    expect((await sweepExpiredPending({ ...base, adminDb: db })).swept).toBe(0);
    expect(pendingOf(db, 'slot-a')['ORD-BAD'].count).toBe(0);
  });

  it('문서 없음 → swept 0, 쓰기 0', async () => {
    const db = makeDeepMergeDb();
    expect((await sweepExpiredPending({ ...base, adminDb: db })).swept).toBe(0);
    expect(db._writes()).toBe(0);
  });
});
