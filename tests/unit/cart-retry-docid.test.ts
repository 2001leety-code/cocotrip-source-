/**
 * cart PR2a — triggerBookingProcessor retryDocId 파라미터.
 * cart fan-out 라인별 retry 분리(orderID__lineId) → 단일 doc 덮어쓰기/충돌 회피.
 * 단건 경로(retryDocId 미전달)는 orderID 그대로 = 기존 동작 100% 불변.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { triggerBookingProcessor } from '../../api/_shared/booking-processor-trigger.js';

function makeDbMock() {
  const persisted: Array<{ id: string; data: Record<string, unknown> }> = [];
  const docRef = (id: string) => ({ set: vi.fn(async (data: Record<string, unknown>) => { persisted.push({ id, data }); }) });
  return { collection: vi.fn(() => ({ doc: docRef })), _persisted: persisted };
}

describe('triggerBookingProcessor — retryDocId (cart fan-out 라인별 retry)', () => {
  let originalFetch: typeof global.fetch;
  beforeEach(() => { originalFetch = global.fetch; });
  afterEach(() => { global.fetch = originalFetch; });

  it('retryDocId 미전달 = orderID 로 persist (단건 기존 동작 불변)', async () => {
    global.fetch = vi.fn(async () => new Response('boom', { status: 500 })) as unknown as typeof fetch;
    const db = makeDbMock();
    await triggerBookingProcessor({ db: db as never, siteUrl: 'https://e', payload: { orderID: 'ORD-1' }, source: 't' });
    expect(db._persisted[0].id).toBe('ORD-1');
    expect(db._persisted[0].data.orderID).toBe('ORD-1');
    expect(db._persisted[0].data.retryDocId).toBe('ORD-1');
  });

  it('retryDocId 전달 = 그 id 로 persist (cart 라인 분리)', async () => {
    global.fetch = vi.fn(async () => new Response('boom', { status: 500 })) as unknown as typeof fetch;
    const db = makeDbMock();
    await triggerBookingProcessor({
      db: db as never, siteUrl: 'https://e',
      payload: { orderID: 'ORD-1__line2' }, retryDocId: 'ORD-1__line2', source: 't',
    });
    expect(db._persisted[0].id).toBe('ORD-1__line2');
    expect(db._persisted[0].data.retryDocId).toBe('ORD-1__line2');
  });

  it('두 라인 = 두 독립 retry doc (단일 doc 덮어쓰기 회피 = batch-fanout 결함#1 방지)', async () => {
    global.fetch = vi.fn(async () => new Response('boom', { status: 500 })) as unknown as typeof fetch;
    const db = makeDbMock();
    await triggerBookingProcessor({ db: db as never, siteUrl: 'https://e', payload: { orderID: 'ORD-9__a' }, retryDocId: 'ORD-9__a', source: 't' });
    await triggerBookingProcessor({ db: db as never, siteUrl: 'https://e', payload: { orderID: 'ORD-9__b' }, retryDocId: 'ORD-9__b', source: 't' });
    expect(db._persisted.map(p => p.id)).toEqual(['ORD-9__a', 'ORD-9__b']);
  });
});
