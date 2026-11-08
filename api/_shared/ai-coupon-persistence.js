// Adapted from Fable synthetic/native excerpt draft, 2026-11-08; corrected by native review.
// Internal server evidence only. Client-supplied binding is never authorization.
import { createHash, randomUUID } from 'node:crypto';
export const BINDING_VERSION = 1;
export const FINGERPRINT_VERSION = 1;
export const STATE = Object.freeze({ ACTIVE: 'active', RESTORED: 'restored' });
export const OUTCOME = Object.freeze({ CONSUMED: 'consumed', COMMITTED: 'committed', PENDING: 'pending',
  RESTORED: 'restored', NOOP: 'noop', CONFLICT: 'conflict', UNKNOWN: 'unknown' });
export const ROOT = Object.freeze({ ABSENT: 'absent', COMPLETE: 'complete', INCOMPLETE: 'incomplete', CONFLICT: 'conflict', MALFORMED: 'malformed' });
const NS = 'aicp:v1:';
const ID_RE = /^[A-Za-z0-9_-]{1,128}$/;
const HEX64 = /^[a-f0-9]{64}$/;
const INCOMPLETE_STATUS = ['streaming', 'error'];
export class UnavailableError extends Error {
  constructor(cause) { super('COUPON_PERSISTENCE_UNAVAILABLE'); this.code = 'UNAVAILABLE'; this.cause = cause; }
}
const isId = s => typeof s === 'string' && ID_RE.test(s);
const isDocId = s => typeof s === 'string' && s.length > 0 && !s.includes('/') && s !== '.' && s !== '..' && Buffer.byteLength(s, 'utf8') <= 1500;
const isUidLike = s => typeof s === 'string' && s.length > 0 && s.length <= 256 && s.indexOf('/') < 0;
const isNullOrUid = s => s === null || isUidLike(s);
const isPlain = v => v !== null && typeof v === 'object' &&
  (Object.getPrototypeOf(v) === Object.prototype || Object.getPrototypeOf(v) === null);
const isNil = v => v === null || v === undefined;
const res = (outcome, reason, extra) => Object.freeze(Object.assign({ outcome, reason: reason || null }, extra || {}));
const conflict = (reason, extra) => res(OUTCOME.CONFLICT, reason, extra);
const sha = s => createHash('sha256').update(s, 'utf8').digest('hex');
// ---- pure: canonical JSON (sorted keys, undefined props omitted, strict rejects) ----
export function canonicalize(v) {
  if (v === null) return 'null';
  const t = typeof v;
  if (t === 'string') return JSON.stringify(v);
  if (t === 'boolean') return v ? 'true' : 'false';
  if (t === 'number') { if (!Number.isFinite(v)) throw new TypeError('FP_NONFINITE'); return JSON.stringify(v); }
  if (Array.isArray(v)) {
    const out = [];
    for (let i = 0; i < v.length; i++) {
      if (!(i in v) || v[i] === undefined) throw new TypeError('FP_SPARSE_ARRAY');
      out.push(canonicalize(v[i]));
    }
    return '[' + out.join(',') + ']';
  }
  if (isPlain(v)) {
    const keys = Object.keys(v).filter(k => v[k] !== undefined).sort();
    return '{' + keys.map(k => JSON.stringify(k) + ':' + canonicalize(v[k])).join(',') + '}';
  }
  throw new TypeError('FP_OPAQUE_VALUE'); // Date/Map/class/function/symbol/bigint/undefined root
}
export function fingerprintRequest(projection) {
  return Object.freeze({ version: FINGERPRINT_VERSION, hash: sha(NS + 'fp:' + canonicalize(projection)) });
}
export function derivePlanId(consumerUid, couponDocId, consumptionId) {
  return 'aicp_' + sha(NS + 'plan:' + canonicalize([consumerUid, couponDocId, consumptionId])).slice(0, 40);
}
export const newConsumptionId = () => randomUUID(); // call ONCE per attempt, outside tx
// ---- pure: binding ----
export function createBinding(p) {
  if (!isPlain(p)) throw new TypeError('BINDING_BAD_INPUT');
  const { consumerUid, couponDocId, consumptionId, requestProjection, planOwnerUid, verifiedHistoryUid, forceGuestToken } = p;
  if (!isUidLike(consumerUid) || !isDocId(couponDocId) || !isId(consumptionId)) throw new TypeError('BINDING_BAD_ID');
  if (!isNullOrUid(planOwnerUid) || !isNullOrUid(verifiedHistoryUid)) throw new TypeError('BINDING_BAD_OWNER');
  if (typeof forceGuestToken !== 'boolean') throw new TypeError('BINDING_BAD_TOKEN_MODE');
  const fp = fingerprintRequest(requestProjection);
  const b = { version: BINDING_VERSION, consumerUid, couponDocId, consumptionId,
    planId: derivePlanId(consumerUid, couponDocId, consumptionId),
    requestFingerprintVersion: fp.version, requestFingerprintHash: fp.hash,
    planOwnerUid, verifiedHistoryUid, forceGuestToken };
  if (!validateBinding(b)) throw new TypeError('BINDING_INVALID');
  return Object.freeze(b);
}
export function validateBinding(b) {
  if (!isPlain(b) || b.version !== BINDING_VERSION) return false;
  if (!isUidLike(b.consumerUid) || !isDocId(b.couponDocId) || !isId(b.consumptionId) || !isId(b.planId)) return false;
  if (b.planId !== derivePlanId(b.consumerUid, b.couponDocId, b.consumptionId)) return false;
  if (b.requestFingerprintVersion !== FINGERPRINT_VERSION || (typeof b.requestFingerprintHash !== 'string' || !HEX64.test(b.requestFingerprintHash))) return false;
  if (!isNullOrUid(b.planOwnerUid) || !isNullOrUid(b.verifiedHistoryUid) || typeof b.forceGuestToken !== 'boolean') return false;
  const keys = ['version', 'consumerUid', 'couponDocId', 'consumptionId', 'planId', 'requestFingerprintVersion', 'requestFingerprintHash', 'planOwnerUid', 'verifiedHistoryUid', 'forceGuestToken'];
  return Object.keys(b).length === keys.length && keys.every(key => Object.prototype.hasOwnProperty.call(b, key));
}
export function matchBinding(a, b) {
  return validateBinding(a) && validateBinding(b) && canonicalize(a) === canonicalize(b);
}
// same original request + owner descriptor + consumer/doc; ignores consumptionId/planId
export function sameRequest(a, b) {
  const pick = x => [x.consumerUid, x.couponDocId, x.requestFingerprintVersion, x.requestFingerprintHash,
    x.planOwnerUid, x.verifiedHistoryUid, x.forceGuestToken];
  return validateBinding(a) && validateBinding(b) && canonicalize(pick(a)) === canonicalize(pick(b));
}
export function rootFieldsFor(binding) {
  if (!validateBinding(binding)) throw new TypeError('BINDING_INVALID');
  return Object.freeze({ planId: binding.planId, uid: binding.planOwnerUid,
    verifiedHistoryUid: binding.verifiedHistoryUid, paymentSource: 'ai-coupon',
    isFreeCoupon: true, aiCouponBinding: binding });
}
// ---- pure: coupon locks (never cleared here) ----
export function lockState(c) {
  if (c.pendingCapture !== undefined && typeof c.pendingCapture !== 'boolean') return 'LOCK_MALFORMED';
  if (!isNil(c.usedOrderID) && typeof c.usedOrderID !== 'string') return 'LOCK_MALFORMED';
  if (c.pendingCapture === true) return 'LOCK_PENDING_CAPTURE';
  if (typeof c.usedOrderID === 'string' && c.usedOrderID.length > 0) return 'LOCK_FOREIGN_ORDER';
  return null;
}
// ---- pure: root classification (no ready-by-user guessing) ----
export function inspectRoot(root, binding) {
  if (isNil(root)) return ROOT.ABSENT;
  if (!isPlain(root) || !validateBinding(binding)) return ROOT.MALFORMED;
  if (!matchBinding(root.aiCouponBinding, binding) || root.planId !== binding.planId
      || root.uid !== binding.planOwnerUid || root.verifiedHistoryUid !== binding.verifiedHistoryUid
      || root.paymentSource !== 'ai-coupon' || root.isFreeCoupon !== true) return ROOT.CONFLICT;
  if (root.status === 'ready' && root._streaming_in_progress !== true && root._p231_stub !== true) return ROOT.COMPLETE;
  if (INCOMPLETE_STATUS.includes(root.status) && root.edited !== true
      && (root.editRevision === undefined || root.editRevision === null || root.editRevision === 0)
      && (root.lastEditedAt === undefined || root.lastEditedAt === null)) return ROOT.INCOMPLETE;
  return ROOT.MALFORMED;
}

// Transaction implementation below is independently authored by Astra.
// Fable transaction continuation was refused; no completed Fable tx code or final review exists.
const couponPath = b => `users/${b.consumerUid}/coupons/${b.couponDocId}`;
function refs(db, binding, couponRef, rootRefFor) {
  if (!validateBinding(binding)) throw new TypeError('BINDING_INVALID');
  const coupon = couponRef || db.collection('users').doc(binding.consumerUid).collection('coupons').doc(binding.couponDocId);
  const root = rootRefFor ? rootRefFor(binding.planId) : db.collection('plans').doc(binding.planId);
  if (coupon.path !== couponPath(binding) || root.path !== `plans/${binding.planId}`) throw new TypeError('BINDING_REF_MISMATCH');
  return { coupon, root };
}
async function getData(tx, ref) {
  const snap = await tx.get(ref); // rejected reads are NEVER absence
  return snap.exists ? snap.data() : null;
}
async function run(db, fn) {
  try { return await db.runTransaction(fn); }
  catch { return res(OUTCOME.UNKNOWN, 'COUPON_PERSISTENCE_UNAVAILABLE'); }
}
function retainedValid(c, binding) {
  return validateBinding(c.aiPlanBinding) && c.aiPlanBinding.consumerUid === binding.consumerUid
    && c.aiPlanBinding.couponDocId === binding.couponDocId;
}
const activeEvidence = (c, b) => c.aiPlanBindingState === STATE.ACTIVE && c.consumptionId === b.consumptionId && typeof c.isUsed === 'boolean';
const acceptableIncomplete = kind => kind === ROOT.ABSENT || kind === ROOT.INCOMPLETE;
export function consumeOrRecover({ db, couponRef, rootRefFor, binding, isEligible, nowIso }) {
  let proposed;
  try { proposed = refs(db, binding, couponRef, rootRefFor); } catch { return Promise.resolve(conflict('BAD_BINDING_OR_REF')); }
  return run(db, async tx => {
    const c = await getData(tx, proposed.coupon);
    if (!c) return conflict('COUPON_NOT_FOUND');
    const locked = lockState(c);
    if (locked) return conflict(locked);
    const retained = c.aiPlanBinding;
    if (retained !== undefined && retained !== null) {
      if (!retainedValid(c, binding) || ![STATE.ACTIVE, STATE.RESTORED].includes(c.aiPlanBindingState)) return conflict('INVALID_RETAINED_BINDING');
      const prior = refs(db, retained, couponRef, rootRefFor);
      const root = await getData(tx, prior.root);
      const kind = inspectRoot(root, retained);
      if (kind === ROOT.COMPLETE && !activeEvidence(c, retained)) return conflict('COMPLETION_STATE_CONFLICT');
      if (kind === ROOT.COMPLETE) return sameRequest(retained, binding)
        ? res(OUTCOME.COMMITTED, null, { binding: retained, planId: retained.planId }) : conflict('REQUEST_MISMATCH');
      if (!acceptableIncomplete(kind)) return conflict('ROOT_CONFLICT');
      if (c.aiPlanBindingState === STATE.ACTIVE) {
        if (c.consumptionId !== retained.consumptionId) return conflict('CONSUMPTION_MISMATCH');
        if (!sameRequest(retained, binding)) return conflict('REQUEST_MISMATCH');
        // Only the ORIGINAL in-process consume call can resume its own ACK-lost ID.
        if (matchBinding(retained, binding) && c.isUsed === true) return res(OUTCOME.CONSUMED, 'SAME_ATTEMPT', { binding: retained });
        return res(OUTCOME.PENDING, 'ACTIVE_CONSUMPTION');
      }
      if (c.isUsed !== false || !isNil(c.consumptionId) || matchBinding(retained, binding)) return conflict('RESTORE_NOT_PROVEN');
    } else if (c.isUsed || !isNil(c.consumptionId) || c.aiPlanBindingState !== undefined || !isNil(c.restoredAt)) {
      return conflict(c.isUsed ? 'COUPON_USED' : 'LEGACY_CONSUMPTION');
    }
    if (c.isUsed !== false) return conflict('COUPON_STATE_AMBIGUOUS');
    const eligibility = isEligible(c);
    if (eligibility) return conflict(eligibility.rejection?.code || 'COUPON_INELIGIBLE', { rejection: eligibility.rejection });
    if (await getData(tx, proposed.root)) return conflict('PLAN_ID_COLLISION');
    tx.update(proposed.coupon, { isUsed: true, usedAt: nowIso, consumptionId: binding.consumptionId,
      aiPlanBinding: binding, aiPlanBindingState: STATE.ACTIVE });
    return res(OUTCOME.CONSUMED, null, { binding });
  });
}
export function restoreOrResolve({ db, couponRef, rootRefFor, binding, nowIso }) {
  let target;
  try { target = refs(db, binding, couponRef, rootRefFor); } catch { return Promise.resolve(conflict('BAD_BINDING_OR_REF')); }
  return run(db, async tx => {
    const c = await getData(tx, target.coupon);
    if (!c || !matchBinding(c.aiPlanBinding, binding)) return res(OUTCOME.NOOP, 'DIFFERENT_CONSUMPTION');
    const root = await getData(tx, target.root);
    const locked = lockState(c);
    if (locked) return conflict(locked);
    const kind = inspectRoot(root, binding);
    if (kind === ROOT.COMPLETE) return activeEvidence(c, binding)
      ? res(OUTCOME.COMMITTED, null, { binding, planId: binding.planId }) : conflict('COMPLETION_STATE_CONFLICT');
    if (!acceptableIncomplete(kind)) return conflict('ROOT_CONFLICT');
    if (c.aiPlanBindingState === STATE.RESTORED && c.isUsed === false && isNil(c.consumptionId)) return res(OUTCOME.NOOP, 'ALREADY_RESTORED');
    if (c.aiPlanBindingState !== STATE.ACTIVE || c.consumptionId !== binding.consumptionId) return res(OUTCOME.NOOP, 'DIFFERENT_CONSUMPTION');
    tx.update(target.coupon, { isUsed: false, usedAt: null, consumptionId: null,
      restoredAt: nowIso, aiPlanBindingState: STATE.RESTORED });
    return res(OUTCOME.RESTORED, null);
  });
}
// Must run within the SAME transaction that reads/writes the canonical root.
// No new revocation/expiry policy is introduced after a valid consumption.
export async function readFinalFence({ tx, db, binding, root }) {
  const target = refs(db, binding);
  const c = await getData(tx, target.coupon);
  const kind = inspectRoot(root, binding);
  const fail = reason => { throw Object.assign(new Error('AI_COUPON_CONFLICT'), { code: 'AI_COUPON_CONFLICT', statusCode: 409, reason }); };
  if (!c || !matchBinding(c.aiPlanBinding, binding) || lockState(c)) fail('COUPON_BINDING_OR_LOCK');
  if (kind === ROOT.COMPLETE) {
    if (!activeEvidence(c, binding)) fail('COMPLETION_STATE_CONFLICT');
    return res(OUTCOME.COMMITTED, null, { binding, planId: binding.planId });
  }
  if (!acceptableIncomplete(kind) || c.aiPlanBindingState !== STATE.ACTIVE
      || c.consumptionId !== binding.consumptionId || c.isUsed !== true) fail('CONSUMPTION_INACTIVE');
  return res(OUTCOME.CONSUMED, null);
}

export function couponFailureDetails(language = 'en', committed = false) {
  const messages = {
    ko: ['이 쿠폰의 일정 상태를 확인해야 합니다. 다시 사용하지 말고 잠시 후 확인하거나 문의해 주세요.', '일정은 저장되었지만 확인 절차가 끝나지 않았습니다. 새 일정을 만들지 말고 같은 요청으로 다시 확인하거나 문의해 주세요.'],
    en: ['The itinerary status for this coupon needs checking. Do not use it again; check back shortly or contact support.', 'Your itinerary was saved, but confirmation is incomplete. Do not create another itinerary; retry the same request or contact support.'],
    ja: ['このクーポンの旅程の状態を確認する必要があります。再使用せず、しばらくしてから確認するか、お問い合わせください。', '旅程は保存されましたが、確認手続きが完了していません。新しい旅程は作成せず、同じ内容で再度確認するか、お問い合わせください。'],
    zh: ['此优惠券对应的行程状态需要确认。请勿再次使用，稍后查看或联系客服。', '行程已保存，但确认尚未完成。请勿创建新的行程，请用相同的请求重试或联系客服。'],
  };
  return (messages[language] || messages.en)[committed ? 1 : 0];
}
