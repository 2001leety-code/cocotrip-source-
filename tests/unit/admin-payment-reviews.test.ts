/**
 * /api/admin-payment-reviews + resolvePaymentReview — 격리 해제 기록 (P1, 2026-07-15).
 *
 * 이전엔 resolution writer 가 코드베이스에 **아예 없어서** 격리 해제 = Firebase 콘솔 수동 편집뿐이었다.
 * 정상 결제인데 오격리된 고객을 풀어줄 제품 표면이 없었다.
 *
 * 행위 테스트 — 핸들러를 실제로 실행해 응답과 Firestore 쓰기를 관찰한다.
 *
 * ## 이 파일이 지키는 것
 * - **기록만, 실행 없음**: 환불/확정 API 를 부르지 않는다.
 * - **4필드 원자 기록**: isReviewFulfillable 이 resolvedAt AND resolution 을 보므로 한쪽만 쓰면
 *   영구 격리(또는 무단 해제)가 된다.
 * - **resolvedBy 는 검증된 토큰의 이메일** — 클라가 보낸 값을 신뢰하지 않는다.
 * - **이미 해결된 건은 덮어쓰지 않는다** — 최초 판단·감사 흔적 보존.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const authHolder: { result: unknown } = { result: { ok: true, email: 'admin@cocotrip.kr', uid: 'u1' } };
const dbHolder: { db: unknown } = { db: null };

vi.mock('../../api/_shared/admin-auth.js', () => ({ verifyAdminToken: async () => authHolder.result }));
vi.mock('../../api/_shared/firebase-admin.js', () => ({ initAdminDb: () => dbHolder.db }));
vi.mock('firebase-admin/firestore', () => ({ FieldValue: { serverTimestamp: () => 'TS' } }));

const { default: handler } = await import('../../api/admin-payment-reviews.js');
const { PAYMENT_REVIEW_RESOLUTION } = await import('../../api/_shared/payment-review.js');

type Doc = Record<string, unknown>;
let writes: Array<{ id: string; data: Doc }>;

function makeDb(docs: Record<string, Doc> = {}) {
  return {
    collection: (name: string) => ({
      where: () => ({
        limit: () => ({
          get: async () => {
            const entries = Object.entries(docs).filter(([, v]) => v.resolvedAt == null);
            return {
              size: entries.length,
              docs: entries.map(([id, data]) => ({ id, data: () => data })),
            };
          },
        }),
      }),
      doc: (id: string) => ({
        get: async () => (docs[id] ? { exists: true, data: () => docs[id] } : { exists: false, data: () => undefined }),
        set: async (data: Doc) => { writes.push({ id: `${name}/${id}`, data }); Object.assign(docs[id] || {}, data); },
      }),
    }),
  };
}

function mockRes() {
  const out = { statusCode: 0, body: '', headers: {} as Record<string, string> };
  return { out, writeHead(c: number, h: Record<string, string>) { out.statusCode = c; out.headers = h; }, end(b?: string) { out.body = b || ''; } };
}

async function call(req: Record<string, unknown>) {
  const res = mockRes();
  await handler(req, res);
  return { ...res.out, json: res.out.body ? JSON.parse(res.out.body) : null };
}

const REVIEW = {
  flow: 'single', mismatchCode: 'AMOUNT_MISMATCH', mismatchDetail: 'expected 990 got 100',
  expectedAmountMinor: 990, expectedCurrency: 'USD', actualAmountMinor: 100, actualCurrency: 'USD',
  paymentCaptured: true, captureID: 'CAP-1', captureStatus: 'COMPLETED',
  userEmail: 'cust@example.com', payerEmail: 'payer@example.com',
  resolvedAt: null, resolvedBy: null, resolution: null, auditNote: null,
  bookingPayload: { secret: 'should-not-leak' },
};

beforeEach(() => {
  writes = [];
  authHolder.result = { ok: true, email: 'admin@cocotrip.kr', uid: 'u1' };
  dbHolder.db = makeDb({ 'ORDER-1': { ...REVIEW } });
});

describe('인증 — admin 전용', () => {
  it('verifyAdminToken 실패 → 그 status 그대로, DB 접근 없음', async () => {
    authHolder.result = { ok: false, status: 403, error: 'Not admin' };
    const r = await call({ method: 'GET', headers: {} });
    expect(r.statusCode).toBe(403);
    expect(r.json.code).toBe('AUTH_FAILED');
    expect(writes).toHaveLength(0);
  });

  it('OPTIONS → 200 프리플라이트', async () => {
    const r = await call({ method: 'OPTIONS', headers: {} });
    expect(r.statusCode).toBe(200);
  });

  it('DB 없음 → 503', async () => {
    dbHolder.db = null;
    const r = await call({ method: 'GET', headers: {} });
    expect(r.statusCode).toBe(503);
  });

  it('PUT → 405', async () => {
    const r = await call({ method: 'PUT', headers: {} });
    expect(r.statusCode).toBe(405);
  });
});

describe('GET — 미해결 큐', () => {
  it('미해결 건을 반환한다', async () => {
    const r = await call({ method: 'GET', headers: {} });
    expect(r.statusCode).toBe(200);
    expect(r.json.count).toBe(1);
    expect(r.json.items[0].orderID).toBe('ORDER-1');
    expect(r.json.items[0].mismatchCode).toBe('AMOUNT_MISMATCH');
  });

  it('해결된 건은 큐에서 빠진다', async () => {
    dbHolder.db = makeDb({ 'ORDER-1': { ...REVIEW, resolvedAt: 'TS', resolution: 'REFUNDED' } });
    const r = await call({ method: 'GET', headers: {} });
    expect(r.json.count).toBe(0);
  });

  it('🔴 bookingPayload 같은 민감 필드를 목록에 흘리지 않는다', async () => {
    const r = await call({ method: 'GET', headers: {} });
    expect(r.body).not.toContain('should-not-leak');
    expect(r.json.items[0].bookingPayload).toBeUndefined();
    expect(r.json.items[0].payerEmail).toBeUndefined();
  });

  it('돈 상태 큐라 캐시 금지', async () => {
    const r = await call({ method: 'GET', headers: {} });
    expect(r.headers['Cache-Control']).toBe('no-store');
  });
});

describe('POST — 해결 기록', () => {
  it('MANUALLY_CONFIRMED → 4필드를 원자적으로 함께 기록', async () => {
    const r = await call({ method: 'POST', headers: {}, body: { orderID: 'ORDER-1', resolution: PAYMENT_REVIEW_RESOLUTION.MANUALLY_CONFIRMED, auditNote: '입금 확인' } });
    expect(r.statusCode).toBe(200);
    expect(r.json.ok).toBe(true);
    expect(writes).toHaveLength(1);
    const w = writes[0].data;
    // 🔴 isReviewFulfillable 이 resolvedAt AND resolution 을 보므로 둘 다 있어야 한다.
    expect(w.resolution).toBe('MANUALLY_CONFIRMED');
    expect(w.resolvedAt).toBe('TS');
    expect(w.resolvedBy).toBe('admin@cocotrip.kr');
    expect(w.auditNote).toBe('입금 확인');
  });

  it('🔴 resolvedBy 는 검증된 토큰의 이메일 — 클라가 보낸 값 무시', async () => {
    await call({ method: 'POST', headers: {}, body: { orderID: 'ORDER-1', resolution: 'REFUNDED', resolvedBy: 'attacker@evil.com' } });
    expect(writes[0].data.resolvedBy).toBe('admin@cocotrip.kr');
  });

  it.each(['CONFIRMED', 'manually_confirmed', 'APPROVED', '', 'DROP TABLE'])(
    '🔴 화이트리스트 밖 resolution=%s → 400, 기록 0', async (bad) => {
      const r = await call({ method: 'POST', headers: {}, body: { orderID: 'ORDER-1', resolution: bad } });
      expect(r.statusCode).toBe(400);
      expect(writes).toHaveLength(0);
    });

  it.each(Object.values(PAYMENT_REVIEW_RESOLUTION))('허용 resolution=%s → 200', async (good) => {
    const r = await call({ method: 'POST', headers: {}, body: { orderID: 'ORDER-1', resolution: good } });
    expect(r.statusCode).toBe(200);
  });

  it('orderID 누락 → 400', async () => {
    const r = await call({ method: 'POST', headers: {}, body: { resolution: 'REFUNDED' } });
    expect(r.statusCode).toBe(400);
    expect(writes).toHaveLength(0);
  });

  it('없는 격리 건 → 404', async () => {
    const r = await call({ method: 'POST', headers: {}, body: { orderID: 'NOPE', resolution: 'REFUNDED' } });
    expect(r.statusCode).toBe(404);
    expect(writes).toHaveLength(0);
  });

  it('🔴 이미 해결된 건은 덮어쓰지 않는다 (최초 판단·감사 보존, 멱등)', async () => {
    dbHolder.db = makeDb({ 'ORDER-1': { ...REVIEW, resolvedAt: 'TS-FIRST', resolvedBy: 'first@a.com', resolution: 'REFUNDED' } });
    const r = await call({ method: 'POST', headers: {}, body: { orderID: 'ORDER-1', resolution: 'MANUALLY_CONFIRMED' } });
    expect(r.statusCode).toBe(200);
    expect(r.json.alreadyResolved).toBe(true);
    // 최초 REFUNDED 판단이 MANUALLY_CONFIRMED 로 뒤집히면 안 된다 = 무단 이행 허용.
    expect(writes).toHaveLength(0);
  });

  it('문자열 body 도 파싱한다', async () => {
    const r = await call({ method: 'POST', headers: {}, body: JSON.stringify({ orderID: 'ORDER-1', resolution: 'REJECTED' }) });
    expect(r.statusCode).toBe(200);
  });

  it('auditNote 는 500자로 자른다', async () => {
    await call({ method: 'POST', headers: {}, body: { orderID: 'ORDER-1', resolution: 'REJECTED', auditNote: 'x'.repeat(900) } });
    expect(String(writes[0].data.auditNote)).toHaveLength(500);
  });
});

// resolvePaymentReview 를 **직접** 호출한다. 엔드포인트에도 같은 화이트리스트가 있어서
// (방어심층) 엔드포인트 경유 테스트만으로는 모듈 자체의 가드가 검증되지 않는다 —
// 뮤테이션에서 실제로 드러났다(모듈 가드를 지워도 엔드포인트가 먼저 막아 초록불).
// 이 모듈은 export 라 다른 호출자가 생길 수 있으므로 자체 가드를 직접 고정한다.
describe('resolvePaymentReview — 모듈 자체 가드 (엔드포인트 우회 호출 대비)', () => {
  const mod = () => import('../../api/_shared/payment-review.js');

  it.each(['CONFIRMED', 'manually_confirmed', '', 'anything'])(
    '🔴 화이트리스트 밖 resolution=%s → INVALID_RESOLUTION, 기록 0', async (bad) => {
      const { resolvePaymentReview } = await mod();
      const docs: Record<string, Record<string, unknown>> = { 'O-1': { resolvedAt: null } };
      const r = await resolvePaymentReview({
        db: makeDb(docs), serverTimestamp: 'TS', orderID: 'O-1',
        resolution: bad, resolvedBy: 'a@b.com',
      });
      expect(r.ok).toBe(false);
      expect(r.code).toBe('INVALID_RESOLUTION');
      expect(writes).toHaveLength(0);
    });

  it('🔴 resolvedBy 없으면 거부 — 누가 해결했는지 모르는 기록은 감사 무의미', async () => {
    const { resolvePaymentReview } = await mod();
    const r = await resolvePaymentReview({
      db: makeDb({ 'O-1': { resolvedAt: null } }), serverTimestamp: 'TS', orderID: 'O-1',
      resolution: 'REFUNDED', resolvedBy: '',
    });
    expect(r.ok).toBe(false);
    expect(r.code).toBe('NO_RESOLVER');
    expect(writes).toHaveLength(0);
  });

  it('db/orderID 없으면 BAD_REQUEST', async () => {
    const { resolvePaymentReview } = await mod();
    expect((await resolvePaymentReview({ db: null, orderID: 'O-1', resolution: 'REFUNDED', resolvedBy: 'a@b.com' })).code).toBe('BAD_REQUEST');
    expect((await resolvePaymentReview({ db: makeDb({}), orderID: '', resolution: 'REFUNDED', resolvedBy: 'a@b.com' })).code).toBe('BAD_REQUEST');
  });

  it('🔴 기록 후 isReviewFulfillable 이 실제로 통과한다 (판정부와 기록부 정합)', async () => {
    const { resolvePaymentReview, isReviewFulfillable, PAYMENT_REVIEW_RESOLUTION: RES } = await mod();
    const docs: Record<string, Record<string, unknown>> = { 'O-1': { resolvedAt: null } };
    await resolvePaymentReview({
      db: makeDb(docs), serverTimestamp: 'TS', orderID: 'O-1',
      resolution: RES.MANUALLY_CONFIRMED, resolvedBy: 'a@b.com',
    });
    // 기록부가 쓴 문서를 판정부가 읽어 이행을 허용해야 한다 — 이게 어긋나면 영구 격리.
    expect(isReviewFulfillable(docs['O-1'])).toBe(true);
  });

  it('🔴 REFUNDED/REJECTED 기록은 이행을 허용하지 않는다 (돈이 없거나 미확정)', async () => {
    const { resolvePaymentReview, isReviewFulfillable, PAYMENT_REVIEW_RESOLUTION: RES } = await mod();
    for (const bad of [RES.REFUNDED, RES.REJECTED]) {
      const docs: Record<string, Record<string, unknown>> = { 'O-1': { resolvedAt: null } };
      await resolvePaymentReview({ db: makeDb(docs), serverTimestamp: 'TS', orderID: 'O-1', resolution: bad, resolvedBy: 'a@b.com' });
      expect(isReviewFulfillable(docs['O-1'])).toBe(false);
    }
  });
});

describe('🔴 범위 — 기록만, 실행 없음', () => {
  it('환불/확정 API 를 부르지 않는다 (fetch 0회)', async () => {
    const f = vi.fn();
    global.fetch = f as never;
    await call({ method: 'POST', headers: {}, body: { orderID: 'ORDER-1', resolution: 'REFUNDED' } });
    // resolution=REFUNDED 는 "환불로 종결했다는 기록" 이지 환불 실행이 아니다.
    // 실 환불은 admin-booking-action 의 mark-refunded 가 한다.
    expect(f).not.toHaveBeenCalled();
  });

  it('payment_reviews 외 컬렉션을 건드리지 않는다', async () => {
    await call({ method: 'POST', headers: {}, body: { orderID: 'ORDER-1', resolution: 'REFUNDED' } });
    expect(writes.every((w) => w.id.startsWith('payment_reviews/'))).toBe(true);
  });
});
