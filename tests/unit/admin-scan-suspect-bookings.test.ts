/* eslint-disable @typescript-eslint/no-explicit-any -- 핸들러/Firestore 모킹 스캐폴딩. */
/**
 * /api/admin-scan-suspect-bookings · /api/admin-replay-booking-notifications (2026-10-23, PR-4 + Astra 명세 검토 r1).
 * 잠그는 것: 정상 원발송 50건 → 후보 0 + "조회 N건 중 후보 0"(한도 밖에 실패가 있어도 전체 정상이라 하지 않음) ·
 *   실패 1건 → 후보 1(state·missingSteps·lastFailureReason) · 재시도 문서의 정상 생략 근거 반영 ·
 *   정산 대상은 알림 상태와 무관하게 reconciliation 으로 보존 · 결과 미상은 나열되지만 일괄에서 skippedUnknown ·
 *   후보 0 인 POST 도 replay 모드(replayed 0) · 실행 직전 최신 문서·재시도 문서 재판정 · complete/unknown 부수효과 0 ·
 *   단건: complete 는 처리기 미호출 replayed:false, 그 밖엔 실행 + state, requiresReconciliation 전달.
 * 실제 booking-processor·Firestore 없음(fetch·DB 모킹).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

type Doc = Record<string, any>;
let store: Record<string, Doc>;
/** 단건 읽기(doc().get)가 볼 "최신" 문서 — 스캔(쿼리) 뒤 다른 실행이 문서를 바꾼 상황용. */
let fresh: Record<string, Doc>;
/** pending_processor_retries/{id} — 처리기 재시도 문서(정상 생략·결과 미상 근거). */
let retries: Record<string, Doc>;
const updates: Array<{ id: string; patch: Doc }> = [];
const fetchMock = vi.fn();

vi.mock('../../api/_shared/admin-auth.js', () => ({ verifyAdminToken: async () => ({ ok: true, uid: 'admin1', email: 'admin@x' }) }));
vi.mock('../../api/_shared/sentry.js', () => ({ captureError: vi.fn() }));
vi.mock('../../api/_shared/cors.js', () => ({ buildAdminCors: () => ({}), buildAdminJsonCors: () => ({}) }));
vi.mock('../../api/_shared/internal-base-url.js', () => ({ internalApiBase: () => 'https://unit.test', vercelBypassHeaders: () => ({}) }));
vi.mock('firebase-admin/firestore', () => ({ FieldValue: { serverTimestamp: () => 'TS' } }));

function makeDb() {
  const snapOf = (id: string, src: Record<string, Doc> = store) => ({ id, exists: Boolean(src[id]), data: () => (src[id] ? { ...src[id] } : undefined) });
  const query: any = {
    where: () => query,
    orderBy: () => query,
    limit: (n: number) => ({ ...query, _limit: n, get: async () => {
      const docs = Object.keys(store).slice(0, n).map((id) => snapOf(id));
      return { size: docs.length, docs, forEach: (fn: (d: any) => void) => docs.forEach(fn) };
    } }),
  };
  return {
    collection: (name: string) => (name === 'pending_processor_retries' ? {
      doc: (id: string) => ({ get: async () => snapOf(id, retries) }),
    } : {
      ...query,
      doc: (id: string) => ({
        get: async () => snapOf(id, fresh[id] ? fresh : store),
        update: async (patch: Doc) => { updates.push({ id, patch }); store[id] = { ...store[id], ...patch }; },
      }),
    }),
  };
}
vi.mock('../../api/_shared/firebase-admin.js', () => ({ initAdminDb: () => makeDb() }));

const { default: scanHandler } = await import('../../api/admin-scan-suspect-bookings.js');
const { default: replayHandler } = await import('../../api/admin-replay-booking-notifications.js');

const HOUR = 60 * 60 * 1000;
const OLD = new Date(Date.now() - 30 * HOUR).toISOString();
const done = (f: string) => ({ [f]: 1, [`${f}State`]: 'completed' });
/** 게스트 유료 정상 원발송 — 시트·확인메일 완료, 적립은 게스트라 정상 제외. */
const normal = (i: number) => ({
  status: 'CONFIRMED', bookingRef: `CT-${i}`, createdAt: OLD, paypalEnvironment: 'live', productType: 'tour_gyeongbok',
  amountUSD: '100', paymentVerified: true, captureID: `CAP-${i}`, uid: null,
  ...done('voucherSentAt'), ...done('sheetsAppendedAt'), ...done('telegramDispatchSentAt'), ...done('telegramPaymentSentAt'),
});
const failedDoc = { ...normal(900), voucherSentAt: undefined, voucherSentAtState: undefined, voucherFailedAt: 1, voucherError: 'Invalid login' };
const unknownDoc = { ...normal(901), voucherSentAt: undefined, voucherSentAtState: 'outcome_unknown', voucherSentAtStateUnknownReason: 'send_result_unknown: ETIMEDOUT' };

async function call(handler: any, method: string, body?: object) {
  const out = { statusCode: 0, body: '' };
  const res = { writeHead(c: number) { out.statusCode = c; }, end(b?: string) { out.body = b || ''; } };
  await handler({ method, url: '/api/x', headers: { host: 'unit.test' }, body } as any, res as any);
  return { ...out, json: out.body ? JSON.parse(out.body) : null };
}
const processorDone = () => ({ ok: true, status: 200, json: async () => ({ ok: true, data: { outcome: 'completed', steps: {}, stepStatus: {} } }) });

beforeEach(() => {
  store = {};
  fresh = {};
  retries = {};
  updates.length = 0;
  fetchMock.mockReset();
  fetchMock.mockImplementation(async () => processorDone());
  vi.stubGlobal('fetch', fetchMock);
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('admin-scan-suspect-bookings — candidates', () => {
  it('50 normal original sends → 0 candidates; hint says "조회 50건 중 후보 0" (+ limit note), not "all fine"', async () => {
    for (let i = 0; i < 50; i += 1) store[`ORD-${String(i).padStart(3, '0')}`] = normal(i);
    const r = await call(scanHandler, 'GET');
    expect(r.statusCode).toBe(200);
    expect(r.json.data).toMatchObject({ mode: 'dryRun', scanned: 50, candidatesCount: 0, failedCount: 0, unknownCount: 0, excludedComplete: 50 });
    expect(r.json.data.candidates).toEqual([]);
    expect(r.json.data.hint).toContain('조회 50건 중 재전송 후보 0건');
    expect(r.json.data.hint).toContain('조회 한도 50건');
    expect(r.json.data.hint).not.toMatch(/정상 전송|No suspect/);
  });

  it('a short scan without hitting the limit has no limit note', async () => {
    store['ORD-1'] = normal(1);
    const r = await call(scanHandler, 'GET');
    expect(r.json.data.hint).toBe('조회 1건 중 재전송 후보 0건');
  });

  it('49 normal + 1 failed → exactly that one candidate with state / missingSteps / lastFailureReason', async () => {
    for (let i = 0; i < 49; i += 1) store[`ORD-${String(i).padStart(3, '0')}`] = normal(i);
    store['ORD-FAIL'] = failedDoc;
    const r = await call(scanHandler, 'GET');
    expect(r.json.data).toMatchObject({ candidatesCount: 1, failedCount: 1, excludedComplete: 49 });
    expect(r.json.data.candidates[0]).toMatchObject({
      bookingId: 'ORD-FAIL', state: 'failed', missingSteps: ['email'], lastFailureReason: 'Invalid login', telegram: 'complete',
    });
  });

  it('50 normal within the limit + a failed booking outside it → still "조회 50건 중 0" with the limit note (never "all fine")', async () => {
    for (let i = 0; i < 50; i += 1) store[`ORD-${String(i).padStart(3, '0')}`] = normal(i);
    store['ORD-ZZZ-FAIL'] = failedDoc; // limit 50 밖 — 이번 조회엔 안 잡힌다
    const r = await call(scanHandler, 'GET');
    expect(r.json.data).toMatchObject({ scanned: 50, candidatesCount: 0 });
    expect(r.json.data.hint).toBe('조회 50건 중 재전송 후보 0건 — 조회 한도 50건에 닿았습니다. since/until 로 기간을 나눠 다시 확인하세요.');
  });

  it('retry doc evidence: sheets skipped (env not configured) → complete, not a candidate', async () => {
    store['ORD-S'] = { ...normal(5), sheetsAppendedAt: undefined, sheetsAppendedAtState: undefined };
    retries['ORD-S'] = { status: 'pending', stepStatus: { sheets: 'skipped_not_applicable', email: 'completed', loyalty: 'skipped_not_applicable' } };
    const r = await call(scanHandler, 'GET');
    expect(r.json.data).toMatchObject({ candidatesCount: 0, excludedComplete: 1 });
  });

  it('reconciliation targets stay listed regardless of notification state', async () => {
    store['ORD-EST-OK'] = { ...normal(7), requiresReconciliation: true }; // 알림 정상
    store['ORD-EST-FAIL'] = { ...failedDoc, productType: 'charter_custom_estimate' }; // 알림 실패 + 추정가
    store['ORD-PLAIN'] = normal(8);
    const r = await call(scanHandler, 'GET');
    expect(r.json.data.candidates.map((c: any) => c.bookingId)).toEqual(['ORD-EST-FAIL']);
    expect(r.json.data.reconciliation.map((c: any) => c.bookingId)).toEqual(['ORD-EST-OK', 'ORD-EST-FAIL']);
  });

  it('test payments and <24h in-flight bookings are excluded and counted', async () => {
    store['ADMIN-BYPASS-1'] = { ...failedDoc };
    store['ORD-NEW'] = { status: 'CONFIRMED', createdAt: new Date().toISOString(), paypalEnvironment: 'live' };
    const r = await call(scanHandler, 'GET');
    expect(r.json.data).toMatchObject({ candidatesCount: 0, excludedTest: 1, excludedPending: 1 });
  });
});

describe('admin-scan-suspect-bookings — batch replay', () => {
  it('unknown is listed but skipped by the batch (skippedUnknown); only failed is replayed', async () => {
    store['ORD-FAIL'] = failedDoc;
    store['ORD-UNK'] = unknownDoc;
    const list = await call(scanHandler, 'GET');
    expect(list.json.data.candidates.map((c: any) => [c.bookingId, c.state])).toEqual([['ORD-FAIL', 'failed'], ['ORD-UNK', 'unknown']]);

    const r = await call(scanHandler, 'POST', { dryRun: false });
    expect(r.json.data).toMatchObject({ mode: 'replay', replayed: 1, failed: 0, skippedUnknown: ['ORD-UNK'] });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).orderID).toBe('ORD-FAIL');
    expect(updates.map((u) => u.id)).toEqual(['ORD-FAIL']); // replayedAt 은 실패 건에만
  });

  it('only complete + unknown → POST has zero side effects (no processor call, no write) and reports skippedUnknown', async () => {
    store['ORD-OK'] = normal(1);
    store['ORD-UNK'] = unknownDoc;
    const r = await call(scanHandler, 'POST', { dryRun: false });
    expect(r.json.data).toMatchObject({ mode: 'replay', replayed: 0, failed: 0, skippedUnknown: ['ORD-UNK'] });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(updates).toEqual([]);
  });

  it('no candidates at all → POST still answers in replay mode with replayed 0 / failed 0', async () => {
    const r = await call(scanHandler, 'POST', { dryRun: false });
    expect(r.json.data).toMatchObject({ mode: 'replay', scanned: 0, replayed: 0, failed: 0, skippedUnknown: [], results: [] });
  });

  it('uses the retry doc as evidence: retryable → failed candidate; once it turns outcome_unknown the batch does not send', async () => {
    store['ORD-FAIL'] = { ...failedDoc, voucherFailedAt: undefined, voucherError: undefined };
    retries['ORD-FAIL'] = { status: 'pending', stepStatus: { email: 'retryable' } };
    const scan = await call(scanHandler, 'GET');
    expect(scan.json.data.candidates[0]).toMatchObject({ bookingId: 'ORD-FAIL', state: 'failed' });
    retries['ORD-FAIL'] = { status: 'manual-intervention', stepStatus: { email: 'outcome_unknown' } };
    const r = await call(scanHandler, 'POST', { dryRun: false });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(r.json.data.skippedUnknown).toEqual(['ORD-FAIL']);
  });

  it('re-judges the latest document right before replaying (completed meanwhile → not sent)', async () => {
    store['ORD-FAIL'] = failedDoc;
    fresh['ORD-FAIL'] = normal(900); // 스캔 뒤 재시도 큐가 메일을 보냈다
    const r = await call(scanHandler, 'POST', { dryRun: false });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(r.json.data.results[0]).toMatchObject({ bookingId: 'ORD-FAIL', ok: false, error: 'STATE_COMPLETE' });
  });
});

describe('admin-replay-booking-notifications — single replay', () => {
  it('unknown: still runs (operator action), reports the pre-replay state, writes nothing itself', async () => {
    store['ORD-UNK'] = unknownDoc;
    const r = await call(replayHandler, 'POST', { bookingId: 'ORD-UNK' });
    expect(r.statusCode).toBe(200);
    expect(r.json.data).toMatchObject({ bookingId: 'ORD-UNK', state: 'unknown', replayed: true, outcome: 'completed' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(updates).toEqual([]); // 미상 마커를 풀지 않는다 — 처리기의 선점 정책이 그대로 막는다
  });

  it('complete: does not call the processor, replayed:false + ALREADY_COMPLETE', async () => {
    store['ORD-OK'] = normal(1);
    const r = await call(replayHandler, 'POST', { bookingId: 'ORD-OK' });
    expect(r.json.data).toMatchObject({ bookingId: 'ORD-OK', state: 'complete', replayed: false, reason: 'ALREADY_COMPLETE' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('passes requiresReconciliation to the processor like the batch path', async () => {
    store['ORD-EST'] = { ...failedDoc, productType: 'charter_custom_estimate' };
    await call(replayHandler, 'POST', { bookingId: 'ORD-EST' });
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({ orderID: 'ORD-EST', requiresReconciliation: true });
  });
});
