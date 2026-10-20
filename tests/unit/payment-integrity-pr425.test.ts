/**
 * PR #425 — Audit CY1 + CY2 + CY5 regression slot.
 *
 * Three payment-integrity bugs that all silently lost money or trapped
 * the user before this PR:
 *   - CY1: used_paypal_orders non-atomic check-then-set + locked the
 *          orderID before capture, so a capture failure stranded the
 *          user (retry → DUPLICATE_ORDER) and a race let two simultaneous
 *          requests both pass the existence check.
 *   - CY2: amountKRW was never stored, so cancelBooking.js computed
 *          refundKRW=0 and the customer's mypage showed "₩0 refunded".
 *   - CY5: admin mark-refunded set Firestore status='REFUNDED' and sent
 *          the refund email — but never called PayPal /captures/{id}/refund.
 *          Customers thought they'd been refunded; the money stayed.
 *
 * These are static-shape assertions over the source — full integration
 * tests would need PayPal sandbox + Firestore emulator which are out of
 * scope for fast vitest CI. The shape checks catch the original bug
 * pattern AND any future refactor that drops the safeguards.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  acquirePaymentAttempt, classifyCaptureResponse, reconcileCapture, discardAttempt, releaseAttemptClaim,
} from '../../api/_shared/payment-fulfillment-recovery.js';

type Doc = Record<string, unknown>;
type Ref = { __path: string };
const isPlain = (v: unknown): v is Doc => !!v && typeof v === 'object' && !Array.isArray(v);
function mergeDeep(base: unknown, patch: Doc): Doc {
  if (!isPlain(base)) return { ...patch };
  const out: Doc = { ...base };
  for (const [key, value] of Object.entries(patch)) out[key] = isPlain(value) && isPlain(base[key]) ? mergeDeep(base[key], value) : value;
  return out;
}
/** In-memory Firestore — transaction writes are staged and committed when the callback resolves (serial only). */
function memoryDb() {
  const store = new Map<string, Doc>();
  const read = (path: string) => {
    const data = store.get(path);
    return { exists: !!data, data: () => (data ? structuredClone(data) : undefined) };
  };
  const db = {
    store,
    transactions: 0,
    collection: (name: string) => ({ doc: (id: string): Ref => ({ __path: `${name}/${id}` }) }),
    runTransaction: async (fn: (tx: unknown) => Promise<unknown>) => {
      db.transactions += 1;
      const staged: Array<() => void> = [];
      const result = await fn({
        get: async (ref: Ref) => read(ref.__path),
        set: (ref: Ref, data: Doc, opts?: { merge?: boolean }) => {
          staged.push(() => { store.set(ref.__path, opts && opts.merge ? mergeDeep(store.get(ref.__path), data) : { ...data }); });
        },
        delete: (ref: Ref) => { staged.push(() => { store.delete(ref.__path); }); },
      });
      staged.forEach((commit) => commit());
      return result;
    },
  };
  return db;
}
const ORDER = 'PR425-ORDER';
const LOCK = `used_paypal_orders/${ORDER}`;
async function claim(db: ReturnType<typeof memoryDb>, nowMs = Date.now()) {
  const acquired = await acquirePaymentAttempt({
    db, orderID: ORDER, flow: 'single', environment: 'live', requestKey: `${ORDER}-cap`, intent: { version: 1, body: {} }, nowMs,
  });
  return acquired;
}
const reconcile = (attempt: unknown, postCapture: () => Promise<unknown>) =>
  reconcileCapture({ attempt, orderID: ORDER, baseUrl: 'https://api.mock', accessToken: 't', postCapture });

afterEach(() => { vi.unstubAllGlobals(); });

const capture = readFileSync(
  resolve(process.cwd(), 'api/capturePaypalOrder.js'),
  'utf8',
);
const adminAction = readFileSync(
  resolve(process.cwd(), 'api/admin-booking-action.js'),
  'utf8',
);
const cancel = readFileSync(
  resolve(process.cwd(), 'api/cancelBooking.js'),
  'utf8',
);
const paypalRefund = readFileSync(
  resolve(process.cwd(), 'api/_shared/paypal-refund.js'),
  'utf8',
);

describe('PR #425 CY1 — capturePaypalOrder lock is transactional + releasable', () => {
  // 2026-10-10: the used_paypal_orders read+write moved from an inline runTransaction into the
  //   shared acquirePaymentAttempt helper. The handler must acquire it before the capture POST, and
  //   the helper must do the check-and-set inside one transaction.
  it('lock acquire uses runTransaction (race-safe) via acquirePaymentAttempt before capture', async () => {
    const acquireCall = capture.indexOf('acquirePaymentAttempt({');
    const captureCall = capture.indexOf('/capture`');
    expect(acquireCall).toBeGreaterThan(-1);
    expect(captureCall).toBeGreaterThan(acquireCall);

    const db = memoryDb();
    const first = await claim(db);
    const second = await claim(db);
    expect(first.kind).toBe('claimed');
    expect(second.kind).toBe('in_progress'); // a second request cannot start another capture
    expect(db.transactions).toBe(2);
  });

  // Old contract (CY1): delete the lock on every capture error. That was unsafe — a timeout, 5xx or
  //   unparsable 2xx does not prove the money did not move, and deleting the lock let the customer
  //   pay again (double charge). New contract: only provider-proven nonpayment releases the lock;
  //   UNKNOWN keeps it and the same order is reconciled with a PayPal GET on retry.
  it('classifies only explicit provider rejection as NOT_CAPTURED; ambiguity is UNKNOWN', () => {
    expect(classifyCaptureResponse({ status: 422, body: { name: 'UNPROCESSABLE_ENTITY', details: [{ issue: 'INSTRUMENT_DECLINED' }] } }, ORDER))
      .toMatchObject({ state: 'not_captured', reason: 'INSTRUMENT_DECLINED' });
    expect(classifyCaptureResponse({ status: 500, body: { name: 'INTERNAL_SERVER_ERROR' } }, ORDER).state).toBe('unknown');
    expect(classifyCaptureResponse({ status: 200, body: null, parseError: 'Unexpected token' }, ORDER).state).toBe('unknown');
    expect(classifyCaptureResponse({ status: 201, body: { id: ORDER, status: 'PENDING' } }, ORDER).state).toBe('unknown');
    expect(classifyCaptureResponse({ status: 201, body: { id: 'OTHER', status: 'COMPLETED' } }, ORDER).state).toBe('unknown');
    expect(classifyCaptureResponse({ status: 422, body: { details: [{ issue: 'ORDER_ALREADY_CAPTURED' }] } }, ORDER).state).toBe('already_captured');
  });

  it.each([
    ['5xx', async () => ({ status: 503, body: { name: 'SERVICE_UNAVAILABLE' }, parseError: null })],
    ['timeout', async () => { throw Object.assign(new Error('timed out'), { name: 'TimeoutError' }); }],
    ['bad JSON', async () => ({ status: 200, body: null, parseError: 'Unexpected end of JSON input' })],
  ])('capture %s → UNKNOWN and the lock is retained (no re-payment window)', async (_kind, postCapture) => {
    const db = memoryDb();
    const acquired = await claim(db);
    const result = await reconcile(acquired.attempt, postCapture);
    expect(result.state).toBe('unknown');
    expect(db.store.get(LOCK)).toMatchObject({ captureState: 'posted' });
  });

  it('explicit NOT_CAPTURED → discardAttempt releases the lock so the customer can pay again', async () => {
    const db = memoryDb();
    const acquired = await claim(db);
    const result = await reconcile(acquired.attempt, async () => ({
      status: 422, body: { details: [{ issue: 'INSTRUMENT_DECLINED' }] }, parseError: null,
    }));
    expect(result.state).toBe('not_captured');
    await discardAttempt(acquired.attempt);
    expect(db.store.has(LOCK)).toBe(false);
    expect((await claim(db)).kind).toBe('claimed');
  });

  it('a lock carrying verified-capture evidence is never discarded', async () => {
    const db = memoryDb();
    const acquired = await claim(db);
    db.store.set(LOCK, { ...db.store.get(LOCK), captureVerified: { captureID: 'CAP-1' } });
    await expect(discardAttempt(acquired.attempt)).rejects.toMatchObject({ code: 'CLAIM_LOST' });
    expect(db.store.has(LOCK)).toBe(true);
  });

  it('retry after UNKNOWN re-claims the same order and reconciles with GET first (no second POST)', async () => {
    const db = memoryDb();
    const now = Date.now();
    const acquired = await claim(db, now);
    await reconcile(acquired.attempt, async () => ({ status: 504, body: { name: 'GATEWAY_TIMEOUT' }, parseError: null }));
    await releaseAttemptClaim(acquired.attempt);

    const order = { id: ORDER, status: 'COMPLETED', purchase_units: [{ payments: { captures: [{ id: 'CAP-1', status: 'COMPLETED' }] } }] };
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200, text: async () => JSON.stringify(order) }));
    vi.stubGlobal('fetch', fetchMock);
    const retry = await claim(db, now + 1000);
    expect(retry.kind).toBe('claimed');
    expect(retry.attempt.recovering).toBe(true);
    const postCapture = vi.fn();
    const result = await reconcile(retry.attempt, postCapture);
    expect(result).toMatchObject({ state: 'captured', source: 'get' });
    expect(postCapture).not.toHaveBeenCalled();
    expect(String((fetchMock.mock.calls[0] as unknown[])[0])).toBe(`https://api.mock/v2/checkout/orders/${ORDER}`);
  });

  it('handler discards the attempt only on not_captured; the UNKNOWN branch keeps it and answers 202', () => {
    const notCaptured = capture.indexOf("reconciled.state === 'not_captured'");
    const unknown = capture.indexOf("reconciled.state !== 'captured'");
    expect(notCaptured).toBeGreaterThan(-1);
    expect(unknown).toBeGreaterThan(notCaptured);
    expect(capture.slice(notCaptured, unknown)).toMatch(/discardAttempt\(attempt\)/);
    const unknownBranch = capture.slice(unknown, capture.indexOf('return res.end', unknown));
    expect(unknownBranch).not.toMatch(/discardAttempt|\.delete\(/);
    expect(unknownBranch).toMatch(/releaseAttemptClaim\(attempt\)/);
    expect(unknownBranch).toMatch(/writeHead\(202/);
    expect(capture).not.toMatch(/lockRef\.delete\(\)/);
  });

  it('lock is upgraded to status=captured on success', () => {
    expect(capture).toMatch(/status:\s*['"]captured['"]/);
  });
});

describe('PR #425 CY2 — capturePaypalOrder persists amountKRW', () => {
  it('uses the order snapshot KRW amount or its saved FX rate, never a capture-time rate', () => {
    // 주문 생성 시점에 고정한 원화 금액·환율을 보존한다. 캡처 이후 라이브 FX 변화로
    // 예약 원장이나 취소/환불 금액을 재가격하지 않는다.
    expect(capture).toMatch(/const usdToKrw = _snapUsdRate/);
    expect(capture).toMatch(/const amountKRW = _snapExpectedKRW \|\| Math\.round\(/);
    expect(capture).not.toMatch(/getUsdToKrwRaw/);
  });

  it('writes amountKRW into the booking document', () => {
    // Check that amountKRW appears in the bookings.set({...}) payload.
    expect(capture).toMatch(/amountKRW,?\s*\n/);
  });
});

describe('PR #425 CY5 — admin mark-refunded calls PayPal API when captureID present', () => {
  it('imports refundPaypalCapture from shared helper', () => {
    expect(adminAction).toMatch(/from\s+['"]\.\/_shared\/paypal-refund\.js['"]/);
  });

  // ⚠️ 고정 길이 slice(idx, idx+5000) 는 함정이었다 — 분기 안에 주석 한 줄만 추가돼도
  //   검사 대상이 윈도우 밖으로 밀려 무관한 실패가 난다(2026-07-16 F3c-lite 추가로 실제 발생).
  //   섹션 경계 = 다음 action 분기(mark-canceled)까지로 잡는다.
  function markRefundedSection() {
    const idx = adminAction.indexOf("action === 'mark-refunded'");
    expect(idx).toBeGreaterThan(-1);
    const end = adminAction.indexOf("action === 'mark-canceled'", idx);
    return adminAction.slice(idx, end > idx ? end : undefined);
  }

  it('invokes refundPaypalCapture inside the mark-refunded branch', () => {
    expect(markRefundedSection()).toMatch(/refundPaypalCapture\s*\(/);
  });

  it('aborts the Firestore update when PayPal refund fails', () => {
    // If PayPal refund fails we must NOT set status='REFUNDED' — otherwise
    // mypage/email say "refunded" but the money is still with the merchant
    // (exactly the CY5 production bug we are fixing).
    const section = markRefundedSection();
    expect(section).toMatch(/if\s*\(\s*!result\.ok\s*\)/);
    expect(section).toMatch(/return\s+res\.end\(JSON\.stringify\(_err/);
  });

  it('records refundSource=paypal-api vs manual on the Firestore doc', () => {
    const section = markRefundedSection();
    expect(section).toMatch(/refundSource:\s*['"]paypal-api['"]/);
    expect(section).toMatch(/refundSource:\s*['"]manual['"]/);
  });
});

describe('PR #425 — shared paypal-refund helper', () => {
  it('exposes refundPaypalCapture', () => {
    expect(paypalRefund).toMatch(/export\s+async\s+function\s+refundPaypalCapture/);
  });

  it('rejects calls without a captureID', () => {
    expect(paypalRefund).toMatch(/NO_CAPTURE_ID/);
  });

  it('classifies COMPLETED and PENDING as success', () => {
    expect(paypalRefund).toMatch(/COMPLETED.*PENDING|status\s*===\s*['"]COMPLETED['"]/s);
  });
});

describe('PR #425 — cancelBooking uses the shared helper', () => {
  it('imports refundPaypalCapture and no longer fetches PayPal directly', () => {
    expect(cancel).toMatch(/from\s+['"]\.\/_shared\/paypal-refund\.js['"]/);
    // The old direct fetch('...v2/payments/captures/...') call inside
    // cancelBooking.js is gone (now lives only in paypal-refund.js). Doc
    // comments mentioning the URL are fine — we only flag executable lines.
    const codeLines = cancel
      .split('\n')
      .filter((l) => {
        const trimmed = l.trim();
        // Skip doc/comment lines.
        if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) return false;
        return l.includes('v2/payments/captures');
      });
    expect(codeLines.length, 'PayPal capture URL should only appear via the shared helper, never in raw fetch()').toBe(0);
  });
});
