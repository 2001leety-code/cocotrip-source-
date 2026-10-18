/**
 * payment-fulfillment-recovery — capture-once / fulfil-once contract shared by
 * capturePaypalOrder (single) and captureCartOrder (cart).
 *
 * Durable record: used_paypal_orders/{orderID} (the existing lock doc, extended).
 *   status            'pending' | 'captured'            (legacy field, kept)
 *   flow, environment, requestKey                        bound at first capture attempt
 *   intent            validated original input + verified identity + server snapshot
 *   claimToken/claimUntil                                exclusive worker lease (not payment evidence)
 *   captureState      'none' | 'posted' | 'unknown' | 'captured' | 'not_captured'
 *   captureVerified   amount/currency/status verified capture summary (money evidence)
 *   bookingDurable    booking + retry intent committed atomically
 *   stages            { slot, promo, ... } completion markers (never re-run when present)
 *   finalized         all mandatory stages recorded; finalResponse replayed to same-order calls
 *
 * Rules: a lost lease never proves nonpayment; a timeout/5xx/bad JSON never proves
 * payment or nonpayment; replays only ever use the saved intent, never a new body.
 */
import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { toMinorUnits } from './paypal-capture-verify.js';

export const USED_ORDERS_COLLECTION = 'used_paypal_orders';
export const RETRIES_COLLECTION = 'pending_processor_retries';
export const SNAPSHOT_COLLECTION = { single: 'paypal_order_snapshots', cart: 'cart_orders' };
export const CLAIM_LEASE_MS = 120_000;
export const LEGACY_STALE_MS = 30_000;
export const MAX_INTENT_BYTES = 700_000;
export const CLOSED_RETRY_STATES = ['done', 'manual-intervention', 'permanent-failure'];
/**
 * New retry intents are created in this durable but NON-runnable state. The processor-retry-sweep cron only
 * selects status === 'pending', so a held intent can never be dispatched before the capture handler has
 * settled the mandatory slot / promo decisions. releaseHeldIntents opens it; terminal outcomes close it.
 */
export const HELD_RETRY_STATUS = 'held';
export const RUNNABLE_RETRY_STATUS = 'pending';
const STOPPED_BOOKING_STATUSES = ['REFUNDED', 'REFUND_PENDING', 'CANCELLED', 'CANCELED'];
const FLOWS = ['single', 'cart'];
const cookieName = (flow) => `cocotrip_checkout_${flow}`;
const sha256 = (value) => createHash('sha256').update(String(value)).digest('hex');

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/** Drops undefined members of plain objects/arrays. Firestore sentinels, Dates, Timestamps pass through untouched. */
export function omitUndefined(value) {
  if (Array.isArray(value)) return value.map((item) => (item === undefined ? null : omitUndefined(item)));
  if (!isPlainObject(value)) return value;
  const out = {};
  for (const [key, item] of Object.entries(value)) {
    if (item !== undefined) out[key] = omitUndefined(item);
  }
  return out;
}

export function codedError(message, code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

// ── Checkout capability (HttpOnly, per flow) ─────────────────────────────────
export function newCheckoutCapability() {
  const secret = randomBytes(32).toString('hex');
  return { secret, digest: sha256(secret) };
}

function parseCheckoutEntries(raw) {
  return String(raw || '').split('|').map((item) => /^([A-Za-z0-9_-]{1,100})\.([a-f0-9]{64})$/.exec(item.trim())).filter(Boolean)
    .map((m) => ({ orderID: m[1], secret: m[2] }));
}

/** Every proof the browser holds for this flow, newest first. */
export function readCheckoutEntries(req, flow) {
  const header = (req && req.headers && req.headers.cookie) || '';
  const prefix = `${cookieName(flow)}=`;
  const part = header.split(';').map((item) => item.trim()).find((item) => item.startsWith(prefix));
  return part ? parseCheckoutEntries(part.slice(prefix.length)) : [];
}

/** Set-Cookie value for a new order; `req` carries the browser's prior entries so they are kept. */
export function checkoutCookie(flow, orderID, secret, req = null) {
  const prior = readCheckoutEntries(req, flow).filter((entry) => entry.orderID !== orderID);
  // Newest first; 5 entries ≈ 850 bytes (ponytail: raise only if guests really juggle more concurrent orders).
  const value = [{ orderID, secret }, ...prior].slice(0, 5).map((e) => `${e.orderID}.${e.secret}`).join('|');
  return `${cookieName(flow)}=${value}; Path=/api; HttpOnly; Secure; SameSite=Lax; Max-Age=2592000`;
}

/** Proof for one order, or the newest entry when no orderID is given. */
export function readCheckoutCookie(req, flow, orderID = null) {
  const entries = readCheckoutEntries(req, flow);
  return (orderID ? entries.find((entry) => entry.orderID === orderID) : entries[0]) || null;
}

export function capabilityMatches(secret, digest) {
  if (!/^[a-f0-9]{64}$/.test(secret || '') || !/^[a-f0-9]{64}$/.test(digest || '')) return false;
  return timingSafeEqual(Buffer.from(sha256(secret), 'hex'), Buffer.from(digest, 'hex'));
}

export function hasCheckoutCapability(req, flow, orderID, digest) {
  const proof = readCheckoutCookie(req, flow, orderID);
  return !!proof && capabilityMatches(proof.secret, digest);
}

/** Positive proof of same-order authority: the original browser capability or the authenticated owner. */
export function isSameOrderProven({ req, flow, orderID, snapshot, verifiedUid }) {
  const digest = snapshot && snapshot.recoveryDigest;
  const ownerUid = snapshot && snapshot.ownerUid;
  if (digest && hasCheckoutCapability(req, flow, orderID, digest)) return true;
  return !!verifiedUid && !!ownerUid && verifiedUid === ownerUid;
}

/** Snapshots created before capabilities existed carry neither field (deliberate legacy boundary). */
export function isLegacyOpenSnapshot(snapshot) {
  return !(snapshot && (snapshot.recoveryDigest || snapshot.ownerUid));
}

/**
 * Normal first capture: proof, or the documented legacy boundary. Recovery / replay of a saved intent
 * additionally requires proof (callers check isSameOrderProven when the attempt record already exists).
 */
export function isSameOrderAuthorized(args) {
  return isLegacyOpenSnapshot(args.snapshot) || isSameOrderProven(args);
}

export async function verifyBearerUid(authHeader) {
  const match = /^Bearer\s+(.+)$/.exec(authHeader || '');
  if (!match) return null;
  try {
    const { getAuth } = await import('firebase-admin/auth');
    const { getApps } = await import('firebase-admin/app');
    if (!getApps().length) return null;
    const decoded = await getAuth().verifyIdToken(match[1], true);
    return decoded.uid || null;
  } catch {
    return null;
  }
}

// ── Response shapes ──────────────────────────────────────────────────────────
export function pendingPaymentResponse({ orderID, flow, paymentStatus, inProgress = false }) {
  const captured = paymentStatus === 'CAPTURED';
  return {
    ok: false, code: 'PAYMENT_RECOVERY_PENDING', orderID, flow,
    paymentStatus: captured ? 'CAPTURED' : 'CAPTURE_UNKNOWN',
    bookingStatus: captured ? 'BOOKING_RECOVERY_PENDING' : 'BOOKING_STATE_UNKNOWN',
    finalized: false, retryable: false, inProgress,
    error: captured
      ? 'Payment was received. Your booking is still being recorded — do not pay again.'
      : 'Your payment result is still being confirmed — do not pay again.',
  };
}

export function notCapturedResponse({ orderID, flow, reason }) {
  return {
    ok: false, code: 'PAYMENT_NOT_CAPTURED', orderID, flow,
    paymentStatus: 'NOT_CAPTURED', finalized: false, retryable: true,
    error: `Payment was not completed (${reason || 'declined'}). You can start a new payment.`,
  };
}

export function lockPaymentStatus(lock) {
  return lock && (lock.captureVerified || lock.status === 'captured') ? 'CAPTURED' : 'CAPTURE_UNKNOWN';
}

/** True when this attempt still needs the customer to stay on the same order before paying anything else. */
export function isCheckoutUnresolved(lock, review) {
  if (!lock || lock.finalized === true || lock.bookingDurable === true) return false;
  if (lock.captureState === 'not_captured') return false;
  if (lock.reviewQuarantined === true) return !(review && review.resolvedAt != null);
  return true;
}

/** Scans both flow cookies; returns the pending response that must block new order creation, or null. */
export async function findUnfinishedCheckout({ db, req }) {
  for (const flow of FLOWS) for (const proof of readCheckoutEntries(req, flow)) {
    if (!db) throw codedError('Payment recovery storage unavailable', 'RECOVERY_CHECK_UNAVAILABLE');
    let lock; let snapshot; let review = null;
    try {
      const lockSnap = await db.collection(USED_ORDERS_COLLECTION).doc(proof.orderID).get();
      if (!lockSnap.exists) continue;
      lock = lockSnap.data() || {};
      const snap = await db.collection(SNAPSHOT_COLLECTION[flow]).doc(proof.orderID).get();
      snapshot = snap.exists ? snap.data() || {} : null;
      if (lock.reviewQuarantined === true) {
        const reviewSnap = await db.collection('payment_reviews').doc(proof.orderID).get();
        review = reviewSnap.exists ? reviewSnap.data() : null;
      }
    } catch (error) {
      throw codedError(`Payment recovery check failed: ${error.message}`, 'RECOVERY_CHECK_UNAVAILABLE');
    }
    if (!snapshot || !capabilityMatches(proof.secret, snapshot.recoveryDigest)) continue;
    if (!isCheckoutUnresolved(lock, review)) continue;
    return pendingPaymentResponse({ orderID: proof.orderID, flow, paymentStatus: lockPaymentStatus(lock) });
  }
  return null;
}

// ── Attempt record ───────────────────────────────────────────────────────────
export function validateIntent(intent) {
  const cleaned = omitUndefined(JSON.parse(JSON.stringify(omitUndefined(intent))));
  if (!cleaned || typeof cleaned !== 'object' || !cleaned.body) throw codedError('Booking input is invalid', 'RECOVERY_INTENT_INVALID');
  if (Buffer.byteLength(JSON.stringify(cleaned), 'utf8') > MAX_INTENT_BYTES) {
    throw codedError('Booking input is too large to record safely', 'RECOVERY_INTENT_INVALID');
  }
  return cleaned;
}

/**
 * Transactionally binds (or re-claims) the attempt record for this order.
 * kinds: claimed | finalized | duplicate | in_progress | cross_flow | environment | absent
 * `createIfMissing:false` (same-order reconcile) never starts a new attempt: an absent record is durable
 * evidence that this contract never issued a provider call for the order.
 */
export async function acquirePaymentAttempt({ db, orderID, flow, environment, requestKey, intent, userEmail = '', product = '', nowMs = Date.now(), createIfMissing = true, allowRecovery = true }) {
  if (!db) throw new Error('Firestore unavailable');
  const ref = db.collection(USED_ORDERS_COLLECTION).doc(orderID);
  const claimToken = randomUUID();
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const lock = snap.exists ? snap.data() || {} : null;
    if (!lock && !createIfMissing) return { kind: 'absent' };
    // Any existing record is a recovery/replay: without positive same-order proof nothing is adopted,
    // re-claimed or revealed (allowRecovery=false => generic 'unauthorized', zero writes).
    if (lock && !allowRecovery) return { kind: 'unauthorized' };
    if (!lock) {
      const fresh = {
        status: 'pending', createdAt: new Date(nowMs).toISOString(), createdAtMs: nowMs, userEmail, product: product || 'unknown',
        flow, environment, requestKey, intent, captureState: 'none', claimToken, claimUntil: nowMs + CLAIM_LEASE_MS, stages: {},
      };
      tx.set(ref, fresh);
      return { kind: 'claimed', attempt: { ref, db, claimToken, lock: fresh, recovering: false } };
    }
    if (lock.finalized === true) return { kind: 'finalized', lock };
    if (lock.flow && lock.flow !== flow) return { kind: 'cross_flow', lock };
    if (lock.environment && lock.environment !== environment) return { kind: 'environment', lock };
    if (!lock.intent) {
      // Legacy lock (pre-recovery deploy): captured or fresh pending keeps the old duplicate answer.
      const stale = lock.status === 'pending' && lock.createdAtMs && (nowMs - Number(lock.createdAtMs)) > LEGACY_STALE_MS;
      if (lock.status === 'captured' || !stale) return { kind: 'duplicate', lock };
      const adopted = { ...lock, flow, environment, requestKey, intent, captureState: 'posted', claimToken, claimUntil: nowMs + CLAIM_LEASE_MS, stages: lock.stages || {} };
      tx.set(ref, adopted, { merge: true });
      return { kind: 'claimed', attempt: { ref, db, claimToken, lock: adopted, recovering: true } };
    }
    if (Number(lock.claimUntil) > nowMs) return { kind: 'in_progress', lock };
    tx.set(ref, { claimToken, claimUntil: nowMs + CLAIM_LEASE_MS }, { merge: true });
    return { kind: 'claimed', attempt: { ref, db, claimToken, lock: { ...lock, claimToken }, recovering: true } };
  });
}

export async function updateAttempt(attempt, patch) {
  await attempt.db.runTransaction(async (tx) => {
    const snap = await tx.get(attempt.ref);
    if (!snap.exists || (snap.data() || {}).claimToken !== attempt.claimToken) throw codedError('Payment claim changed', 'CLAIM_LOST');
    tx.set(attempt.ref, omitUndefined(patch), { merge: true });
  });
}

export async function releaseAttemptClaim(attempt) {
  try { await updateAttempt(attempt, { claimUntil: 0 }); } catch (error) { console.warn('[payment-recovery] claim release skipped:', error.message); }
}

/** Proven nonpayment only: removes the attempt so the customer can pay again. */
export async function discardAttempt(attempt) {
  await attempt.db.runTransaction(async (tx) => {
    const snap = await tx.get(attempt.ref);
    if (!snap.exists) return;
    const lock = snap.data() || {};
    if (lock.claimToken !== attempt.claimToken || lock.captureVerified || lock.bookingDurable) throw codedError('Attempt cannot be discarded', 'CLAIM_LOST');
    tx.delete(attempt.ref);
  });
}

export async function finalizeAttempt(attempt, patch = {}) {
  await updateAttempt(attempt, { ...patch, finalized: true, finalizedAtMs: Date.now(), claimUntil: 0 });
}

// ── Provider reconciliation ──────────────────────────────────────────────────
function captureNodes(order) {
  const unit = order && Array.isArray(order.purchase_units) ? order.purchase_units[0] : null;
  return unit && unit.payments && Array.isArray(unit.payments.captures) ? unit.payments.captures : [];
}

export function classifyOrderLookup(order, orderID) {
  if (!order || typeof order !== 'object' || (order.id && order.id !== orderID)) return { state: 'unknown', reason: 'lookup-mismatch' };
  if (order.status === 'COMPLETED' || captureNodes(order).length > 0) return { state: 'captured', capture: order };
  if (order.status === 'APPROVED') return { state: 'approved' };
  if (['CREATED', 'SAVED', 'VOIDED', 'PAYER_ACTION_REQUIRED'].includes(order.status)) return { state: 'not_captured', reason: `order-${order.status}` };
  return { state: 'unknown', reason: `order-${order.status || 'unknown'}` };
}

/**
 * Only these PayPal 422 issues prove that the capture request was processed and refused. Any other
 * 4xx (401/403/404/409/429, generic validation) is NOT proof the order never captured — stay unknown.
 */
export const DEFINITIVE_DECLINE_ISSUES = Object.freeze([
  'INSTRUMENT_DECLINED', 'ORDER_NOT_APPROVED', 'ORDER_EXPIRED', 'TRANSACTION_REFUSED', 'PAYER_CANNOT_PAY',
  'PAYEE_BLOCKED_TRANSACTION', 'MAX_NUMBER_OF_PAYMENT_ATTEMPTS_EXCEEDED', 'PAYER_ACCOUNT_RESTRICTED', 'PAYER_ACCOUNT_LOCKED_OR_CLOSED',
]);

export function classifyCaptureResponse({ status, body, parseError }, orderID) {
  if (parseError || !body || typeof body !== 'object') return { state: 'unknown', reason: `capture-unparsable-${status || 0}` };
  if (status >= 200 && status < 300) {
    if (body.id && body.id !== orderID) return { state: 'unknown', reason: 'capture-id-mismatch' };
    return body.status === 'COMPLETED' ? { state: 'captured', capture: body } : { state: 'unknown', reason: `capture-status-${body.status || 'unknown'}` };
  }
  const issues = Array.isArray(body.details) ? body.details.map((d) => d && d.issue).filter(Boolean) : [];
  if (issues.includes('ORDER_ALREADY_CAPTURED')) return { state: 'already_captured' };
  const decline = issues.find((issue) => DEFINITIVE_DECLINE_ISSUES.includes(issue));
  if (status === 422 && decline) return { state: 'not_captured', reason: decline };
  return { state: 'unknown', reason: `http-${status}${issues[0] ? `-${issues[0]}` : body.name ? `-${body.name}` : ''}` };
}

export async function fetchPaypalOrder({ baseUrl, accessToken, orderID, timeoutMs = 20_000 }) {
  try {
    const response = await fetch(`${baseUrl}/v2/checkout/orders/${orderID}`, {
      headers: { Authorization: `Bearer ${accessToken}` }, signal: AbortSignal.timeout(timeoutMs),
    });
    const text = await response.text();
    let body = null;
    try { body = JSON.parse(text); } catch { return { state: 'unknown', reason: `lookup-unparsable-${response.status}` }; }
    if (!response.ok) return { state: 'unknown', reason: `lookup-http-${response.status}` };
    return classifyOrderLookup(body, orderID);
  } catch (error) {
    return { state: 'unknown', reason: `lookup-${error.name === 'TimeoutError' ? 'timeout' : 'network'}` };
  }
}

/**
 * Resolves the payment state for a claimed attempt.
 *   captured     { capture } provider object (POST or GET shape) or { verified } stored summary
 *   unknown      keep every reservation; respond 202
 *   not_captured provider proved the order never captured
 * `postCapture()` is supplied by the handler (keeps the PayPal-Request-Id literal there) and returns {status, body, parseError}.
 */
export async function reconcileCapture({ attempt, orderID, baseUrl, accessToken, postCapture }) {
  const lock = attempt.lock || {};
  if (lock.captureVerified) return { state: 'captured', verified: lock.captureVerified, source: 'store' };
  const lookupFirst = attempt.recovering || lock.captureState === 'posted' || lock.captureState === 'unknown';
  if (lookupFirst) {
    const lookup = await fetchPaypalOrder({ baseUrl, accessToken, orderID });
    if (lookup.state !== 'approved') return { ...lookup, source: 'get' };
  }
  try {
    await updateAttempt(attempt, { captureState: 'posted', capturePostedAtMs: Date.now() });
  } catch (error) {
    return { state: 'unknown', reason: `intent-write-${error.code || 'failed'}`, noPost: true };
  }
  let classified;
  try {
    classified = classifyCaptureResponse(await postCapture(), orderID);
  } catch (error) {
    classified = { state: 'unknown', reason: `capture-${error.name === 'TimeoutError' ? 'timeout' : 'network'}` };
  }
  if (classified.state === 'already_captured') {
    const lookup = await fetchPaypalOrder({ baseUrl, accessToken, orderID });
    return lookup.state === 'captured' ? { ...lookup, source: 'get' } : { state: 'unknown', reason: 'already-captured-unverified' };
  }
  return { ...classified, source: 'post' };
}

export function summarizeVerifiedCapture({ verdict, capture, payerEmail, payerName, amountValue, captureID }) {
  return {
    captureID, amountValue: amountValue || '', amountMinor: verdict.amountMinor, currency: verdict.currency,
    pending: verdict.pending === true, payerEmail: payerEmail || '', payerName: payerName || '',
    orderStatus: (capture && capture.status) || '', verifiedAtMs: Date.now(),
  };
}

// ── Durable booking + intent ─────────────────────────────────────────────────
/**
 * One transaction: every missing booking doc, every missing retry intent, parent docs, and
 * the attempt record (captured + bookingDurable). Existing bookings/intents are never replaced.
 * @returns {{retryStatus: Record<string,string>, created: string[]}}
 */
export async function persistBookingsAtomically({ db, attempt, bookings, parents = [], lockPatch = {}, timestamp }) {
  return db.runTransaction(async (tx) => {
    const lockSnap = await tx.get(attempt.ref);
    if (!lockSnap.exists || (lockSnap.data() || {}).claimToken !== attempt.claimToken) throw codedError('Payment claim changed', 'CLAIM_LOST');
    const rows = await Promise.all(bookings.map(async (booking) => {
      const bookingRef = db.collection('bookings').doc(booking.orderID);
      const retryRef = db.collection(RETRIES_COLLECTION).doc(booking.orderID);
      const [bookingSnap, retrySnap] = await Promise.all([tx.get(bookingRef), tx.get(retryRef)]);
      return { booking, bookingRef, retryRef, bookingSnap, retrySnap };
    }));
    const parentSnaps = await Promise.all(parents.map((parent) => tx.get(parent.ref)));
    const retryStatus = {};
    const created = [];
    for (const row of rows) {
      if (!row.bookingSnap.exists) { tx.set(row.bookingRef, row.booking.doc); created.push(row.booking.orderID); }
      if (row.retrySnap.exists) {
        retryStatus[row.booking.orderID] = (row.retrySnap.data() || {}).status || 'pending';
      } else {
        retryStatus[row.booking.orderID] = HELD_RETRY_STATUS;
        tx.set(row.retryRef, {
          orderID: row.booking.orderID, retryDocId: row.booking.orderID, payload: row.booking.payload,
          source: row.booking.source, status: HELD_RETRY_STATUS, heldReason: 'awaiting_mandatory_checks',
          outcome: 'retryable', attempts: 0, intentCreatedAt: timestamp, updatedAt: timestamp,
        });
      }
    }
    parents.forEach((parent, index) => {
      if (parent.onlyIfMissing && parentSnaps[index].exists) return;
      tx.set(parent.ref, parent.data, { merge: parent.merge !== false });
    });
    tx.set(attempt.ref, omitUndefined({ ...lockPatch, status: 'captured', captureState: 'captured', bookingDurable: true, bookingDurableAtMs: Date.now() }), { merge: true });
    return { retryStatus, created };
  });
}

/** Only a runnable ('pending') intent may be dispatched: held, done, manual and permanent never are. */
export function shouldDispatchRetry(status) {
  return status === RUNNABLE_RETRY_STATUS;
}

export function isStoppedBookingStatus(status) {
  return STOPPED_BOOKING_STATUSES.includes(String(status || '').toUpperCase());
}

/**
 * Release gate: opens held intents for normal dispatch once the mandatory checks settled without a
 * terminal outcome. Fails closed inside ONE transaction:
 *   - the caller must still hold the attempt claim (a worker that lost it opens nothing: CLAIM_LOST);
 *   - an intent whose booking is REFUNDED / REFUND_PENDING / cancelled is never opened. A held or pending
 *     one is closed (permanent-failure, attempts kept) so neither the cron nor a replay can dispatch it;
 *   - closed records and already-pending records of active bookings are left untouched.
 * @param {{db:object, attempt:object, intents:Array<{retryDocId:string, bookingId:string}>, timestamp:*}} args
 * @returns {Record<string,string>} status per retryDocId: 'pending' | 'stopped' | closed status | 'missing'
 */
export async function releaseHeldIntents({ db, attempt, intents, timestamp }) {
  return db.runTransaction(async (tx) => {
    const lockSnap = await tx.get(attempt.ref);
    if (!lockSnap.exists || (lockSnap.data() || {}).claimToken !== attempt.claimToken) throw codedError('Payment claim changed', 'CLAIM_LOST');
    const retryRefs = intents.map((item) => db.collection(RETRIES_COLLECTION).doc(item.retryDocId));
    const bookingRefs = intents.map((item) => db.collection('bookings').doc(item.bookingId || item.retryDocId));
    const [retrySnaps, bookingSnaps] = await Promise.all([
      Promise.all(retryRefs.map((ref) => tx.get(ref))),
      Promise.all(bookingRefs.map((ref) => tx.get(ref))),
    ]);
    const status = {};
    intents.forEach((item, index) => {
      const retry = retrySnaps[index].exists ? retrySnaps[index].data() || {} : null;
      const booking = bookingSnaps[index].exists ? bookingSnaps[index].data() || {} : {};
      const current = retry ? retry.status || RUNNABLE_RETRY_STATUS : 'missing';
      if (retry && CLOSED_RETRY_STATES.includes(current)) { status[item.retryDocId] = current; return; }
      if (isStoppedBookingStatus(booking.status)) {
        if (retry) {
          tx.set(retryRefs[index], {
            status: 'permanent-failure', outcome: 'failed_permanent', heldReason: null,
            lastFailureReason: `booking_stopped:${String(booking.status).toUpperCase()}`, closedAt: timestamp, updatedAt: timestamp,
          }, { merge: true });
        }
        status[item.retryDocId] = 'stopped';
        return;
      }
      if (current === HELD_RETRY_STATUS) {
        tx.set(retryRefs[index], { status: RUNNABLE_RETRY_STATUS, heldReason: null, releasedAt: timestamp, updatedAt: timestamp }, { merge: true });
        status[item.retryDocId] = RUNNABLE_RETRY_STATUS;
        return;
      }
      status[item.retryDocId] = current;
    });
    return status;
  });
}

/**
 * Terminal refund-required outcome, written BEFORE any external refund in ONE transaction:
 * attempt record finalized (replays answer the stored terminal response), booking stopped as
 * REFUND_PENDING (never downgrading REFUNDED / cancelled), retry intents closed (never reopened,
 * never dispatched by cron or replay). Pre-existing closed intents keep their status and attempts.
 */
export async function recordTerminalBeforeRefund({ db, attempt, orderID, retryDocIds = [], lockPatch, refundReason, timestamp }) {
  const reason = refundReason;
  const bookingRef = db.collection('bookings').doc(orderID);
  const retryRefs = retryDocIds.map((id) => db.collection(RETRIES_COLLECTION).doc(id));
  await db.runTransaction(async (tx) => {
    const lockSnap = await tx.get(attempt.ref);
    if (!lockSnap.exists || (lockSnap.data() || {}).claimToken !== attempt.claimToken) throw codedError('Payment claim changed', 'CLAIM_LOST');
    const [bookingSnap, ...retrySnaps] = await Promise.all([tx.get(bookingRef), ...retryRefs.map((ref) => tx.get(ref))]);
    const booking = bookingSnap.exists ? bookingSnap.data() || {} : {};
    if (!STOPPED_BOOKING_STATUSES.includes(String(booking.status || '').toUpperCase())) {
      tx.set(bookingRef, { status: 'REFUND_PENDING', refundReason: reason, refundRequestedAt: timestamp, processorStatus: 'stopped', updatedAt: timestamp }, { merge: true });
    }
    retrySnaps.forEach((snap, index) => {
      const data = snap.exists ? snap.data() || {} : {};
      if (CLOSED_RETRY_STATES.includes(data.status)) return;
      tx.set(retryRefs[index], {
        status: 'permanent-failure', outcome: 'failed_permanent', lastFailureReason: reason, heldReason: null,
        closedAt: timestamp, updatedAt: timestamp, ...(snap.exists ? {} : { orderID, retryDocId: retryDocIds[index], attempts: 0 }),
      }, { merge: true });
    });
    tx.set(attempt.ref, omitUndefined({ ...lockPatch, finalized: true, finalizedAtMs: Date.now(), claimUntil: 0 }), { merge: true });
  });
}

/**
 * After a successful external refund: REFUND_PENDING => REFUNDED only (never from any other state).
 * `refundID` is stored only together with that transition. Returns true only when THIS call made the
 * transition; already REFUNDED / any other status / missing booking => false (no old refund identity is inferred).
 */
export async function markRefundCompleted({ db, orderID, timestamp, refundID }) {
  const bookingRef = db.collection('bookings').doc(orderID);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(bookingRef);
    if (!snap.exists || (snap.data() || {}).status !== 'REFUND_PENDING') return false;
    tx.set(bookingRef, omitUndefined({ status: 'REFUNDED', refundedAt: timestamp, updatedAt: timestamp, refundID: refundID || undefined }), { merge: true });
    return true;
  });
}

/**
 * Strict receipt proof for a client-visible terminal refund (gates ONLY that response; bookkeeping keeps the
 * helper's ok/final contract). Requires HTTP 2xx, provider status COMPLETED, a non-empty refund id, and a
 * refunded amount + currency equal to the FULL original capture. Pending, failed, partial, other-currency,
 * an error body claiming COMPLETED, or a receipt without amount are never proof.
 * @returns {string|null} the refund id when proven
 */
export function provenFullRefundID(result, { amountMinor, currency }) {
  if (!result || result.ok !== true || result.final !== true) return null;
  const httpStatus = Number(result.httpStatus);
  if (!(httpStatus >= 200 && httpStatus < 300)) return null;
  const refund = result.refund;
  if (!refund || typeof refund !== 'object' || refund.status !== 'COMPLETED') return null;
  if (typeof refund.id !== 'string' || !refund.id.trim()) return null;
  const expectedCurrency = typeof currency === 'string' ? currency.toUpperCase() : '';
  if (!expectedCurrency || !Number.isSafeInteger(amountMinor) || amountMinor <= 0) return null;
  const amount = refund.amount;
  if (!amount || typeof amount !== 'object' || amount.currency_code !== expectedCurrency) return null;
  return toMinorUnits(amount.value, expectedCurrency) === amountMinor ? refund.id : null;
}

/** persistRetry callback for triggerBookingProcessor: never resets attempts or closed states. */
export function makeRetryPersister({ db, timestamp }) {
  return async (orderID, payload, reason, meta = {}) => {
    const ref = db.collection(RETRIES_COLLECTION).doc(meta.retryDocId || orderID);
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const existing = snap.exists ? snap.data() || {} : null;
      if (existing && CLOSED_RETRY_STATES.includes(existing.status)) {
        tx.set(ref, { lastFailureAt: timestamp, lastFailureReason: reason, staleResultIgnored: true }, { merge: true });
        return;
      }
      tx.set(ref, omitUndefined({
        orderID, retryDocId: meta.retryDocId || orderID, payload: existing && existing.payload ? existing.payload : payload,
        source: existing && existing.source ? existing.source : meta.source, status: meta.status || 'pending',
        outcome: meta.outcome || 'retryable', stepStatus: meta.stepStatus || null, lastFailureAt: timestamp,
        lastFailureReason: reason, attempts: existing ? Number(existing.attempts || 0) : 0,
        firstFailureAt: existing && existing.firstFailureAt ? existing.firstFailureAt : timestamp,
      }), { merge: true });
    });
  };
}

/** Records a processor outcome without downgrading done/manual/permanent intents or completed bookings. */
export async function recordProcessorResult({ db, orderID, retryDocId, result, timestamp }) {
  const retryRef = db.collection(RETRIES_COLLECTION).doc(retryDocId || orderID);
  const bookingRef = db.collection('bookings').doc(orderID);
  await db.runTransaction(async (tx) => {
    const [retrySnap, bookingSnap] = await Promise.all([tx.get(retryRef), tx.get(bookingRef)]);
    const retry = retrySnap.exists ? retrySnap.data() || {} : {};
    const booking = bookingSnap.exists ? bookingSnap.data() || {} : {};
    if (result && result.ok) {
      if (retry.status !== 'done') tx.set(retryRef, { status: 'done', outcome: result.outcome || 'completed', completedAt: timestamp, updatedAt: timestamp }, { merge: true });
      if (booking.processorStatus !== 'completed') {
        tx.set(bookingRef, { processorStatus: 'completed', processorOutcome: result.outcome || 'completed', processorCompletedAt: timestamp, updatedAt: timestamp }, { merge: true });
      }
      return;
    }
    if (!CLOSED_RETRY_STATES.includes(retry.status)) {
      tx.set(retryRef, omitUndefined({
        status: (result && result.docStatus) || 'pending', outcome: (result && result.outcome) || 'retryable',
        stepStatus: (result && result.stepStatus) || null, lastFailureReason: (result && result.reason) || 'unknown', updatedAt: timestamp,
      }), { merge: true });
    }
    if (booking.processorStatus !== 'completed') {
      tx.set(bookingRef, {
        processorStatus: (result && result.docStatus) || 'pending', processorOutcome: (result && result.outcome) || 'retryable',
        processorLastError: (result && result.reason) || 'unknown', updatedAt: timestamp,
      }, { merge: true });
    }
  });
}

export async function withBackoff(task, delaysMs = [200, 500, 1000]) {
  let lastError = null;
  for (let attempt = 0; attempt < delaysMs.length; attempt++) {
    try {
      return { ok: true, value: await task(attempt) };
    } catch (error) {
      lastError = error;
      if (error && error.code === 'CLAIM_LOST') break;
      if (attempt < delaysMs.length - 1) await new Promise((resolve) => setTimeout(resolve, delaysMs[attempt]));
    }
  }
  return { ok: false, error: lastError };
}
