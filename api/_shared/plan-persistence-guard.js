// Adapted from the reviewed synthetic Fable draft (2026-11-08).
// Internal server writers only: a client-provided ID/boolean is not provenance.
import { canonicalJson } from '../../src/lib/planEditCanonical.js';
import { PLAN_ISSUANCE_COLLECTION, isCompletedPlanForClaim } from './plan-issuance.js';

const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const conflict = (reason) => { throw Object.assign(new Error(`PLAN_PERSISTENCE_CONFLICT: ${reason}`), { code: 'PLAN_PERSISTENCE_CONFLICT' }); };
export function hasPlanEditMarkers(doc) {
  return doc.edited === true || (doc.editRevision !== undefined && doc.editRevision !== null && doc.editRevision !== 0)
    || (doc.lastEditedAt !== undefined && doc.lastEditedAt !== null);
}
export function isCompletePlanRoot(doc) {
  return !!doc && doc.status === 'ready' && doc._streaming_in_progress !== true && doc._p231_stub !== true;
}
function freezeDeep(value) {
  if (value && typeof value === 'object') { Object.values(value).forEach(freezeDeep); Object.freeze(value); }
  return value;
}
// Firestore ignores undefined object properties; arrays/opaque values must still be valid JSON.
export function prepareGenerationPayload(value) { return freezeDeep(JSON.parse(canonicalJson(value))); }
function assertIdentity(doc, expected) {
  if (!doc || doc.planId !== expected.planId || !own(doc, 'uid') || doc.uid !== expected.uid) conflict('owner or plan mismatch');
}
function assertInputBinding(doc, expected) {
  if (!doc.input || !expected.input || canonicalJson(doc.input) !== canonicalJson(expected.input)) conflict('original input mismatch');
  for (const key of ['paymentSource', 'isFreeCoupon', 'isAdminBypass']) {
    if (doc[key] !== expected[key]) conflict('generation provenance mismatch');
  }
  if ((doc.verifiedHistoryUid || null) !== (expected.verifiedHistoryUid || null)) conflict('history owner mismatch');
}
function assertStreamingBinding(doc, expected, skeletonInput) {
  assertIdentity(doc, expected);
  if (hasPlanEditMarkers(doc) || doc.status !== 'streaming' || doc._streaming_in_progress !== true) conflict('not an eligible streaming root');
  // Initial worker stub has no input. Full skeleton contains a subset of normalized input.
  if (!doc.input) { if (doc._p231_stub !== true) conflict('missing skeleton input'); return; }
  const sourceInput = skeletonInput || expected.input;
  for (const [key, value] of Object.entries(doc.input)) {
    if (value !== undefined && canonicalJson(value) !== canonicalJson(sourceInput[key])) conflict('skeleton input mismatch');
  }
  for (const key of ['paymentSource', 'isFreeCoupon', 'isAdminBypass']) {
    if (own(doc, key) && doc[key] !== expected[key]) conflict('skeleton provenance mismatch');
  }
}
async function readPaidFence(tx, db, claim, phase) {
  if (!claim) return null;
  if (!claim.orderId || !claim.attemptId || !claim.planId) conflict('incomplete claim');
  const snap = await tx.get(db.collection(PLAN_ISSUANCE_COLLECTION).doc(claim.orderId));
  const current = snap.exists ? snap.data() : null;
  if (!current || current.attemptId !== claim.attemptId || current.planId !== claim.planId) conflict('claim fenced');
  if (phase !== 'failure' && current.status !== 'COMMITTING' && current.status !== 'ISSUED') conflict('claim not committing or issued');
  return current;
}
function assertReusable(root, expected, claim, trustedFixedId) {
  assertIdentity(root, expected);
  if (!isCompletePlanRoot(root)) conflict('root is not complete');
  if (!trustedFixedId) conflict('missing fixed server generation ID');
  assertInputBinding(root, expected);
  if (claim && !isCompletedPlanForClaim({ exists: true, data: () => root }, claim)) conflict('completed order mismatch');
}

export async function commitGenerationRoot(db, { finalDoc, issuanceClaim = null, trustedFixedId = false, requireReady = false, skeletonInput = null }) {
  const expected = prepareGenerationPayload(finalDoc);
  const sourceInput = skeletonInput ? prepareGenerationPayload(skeletonInput) : null;
  const claim = issuanceClaim ? prepareGenerationPayload(issuanceClaim) : null;
  if (!isCompletePlanRoot(expected) || hasPlanEditMarkers(expected) || !expected.planId || !own(expected, 'uid')) conflict('invalid final payload');
  if (claim && (claim.planId !== expected.planId || claim.orderId !== expected.input?.paypalOrderId)) conflict('claim payload mismatch');
  const ref = db.collection('plans').doc(expected.planId);
  return db.runTransaction(async tx => {
    const snap = await tx.get(ref);
    const fence = await readPaidFence(tx, db, claim, 'final');
    const current = snap.exists ? snap.data() : null;
    if (current && current.status === 'ready') {
      assertReusable(current, expected, claim, trustedFixedId);
      return { reused: true, root: current };
    }
    if (requireReady || (fence && fence.status === 'ISSUED')) conflict('issued root is missing or incomplete');
    if (current) assertStreamingBinding(current, expected, sourceInput);
    tx.set(ref, expected);
    return { reused: false, root: expected };
  });
}

export async function repairGenerationListing(db, { finalDoc, issuanceClaim = null, trustedFixedId = false }) {
  // Existing root metadata may contain native Firestore Timestamp values.
  // Compare only original generation identity/input, never clone the entire saved root.
  const expected = prepareGenerationPayload({
    planId: finalDoc.planId, uid: finalDoc.uid, input: finalDoc.input,
    paymentSource: finalDoc.paymentSource, isFreeCoupon: finalDoc.isFreeCoupon,
    isAdminBypass: finalDoc.isAdminBypass, verifiedHistoryUid: finalDoc.verifiedHistoryUid,
  });
  const claim = issuanceClaim ? prepareGenerationPayload(issuanceClaim) : null;
  const ref = db.collection('plans').doc(expected.planId);
  return db.runTransaction(async tx => {
    const snap = await tx.get(ref);
    await readPaidFence(tx, db, claim, 'listing');
    const root = snap.exists ? snap.data() : null;
    assertReusable(root, expected, claim, trustedFixedId);
    if (root.uid) {
      const input = root.input;
      const summary = {
        planId: root.planId, createdAt: root.createdAt, status: root.status,
        tourTitle: root.itinerary?.tour_title || `${input.guestName}'s Korea Itinerary`,
        startDate: input.startDate, area: input.area, pax: input.pax,
      };
      // Whitelist merge only. Never copy root token/input or delete unrelated list metadata.
      tx.set(db.collection('users').doc(root.uid).collection('plans').doc(root.planId), summary, { merge: true });
    }
    return root;
  });
}

const PATCH_KEYS = {
  progress: ['itinerary.days', '_streaming_progress', '_streaming_in_progress', '_streaming_last_update'],
  enrichment: ['itinerary.days', 'itinerary._pass3_pending', 'itinerary._pass3_completed_at'],
  failure: ['status', '_streaming_in_progress', '_streaming_error', '_streaming_error_message', '_streaming_error_code', '_streaming_error_details', '_failed_at'],
  skeleton: ['planId', 'status', '_streaming_in_progress', '_streaming_started_at', '_p231_stub', 'isPublic', 'paymentSource', 'isFreeCoupon', 'isAdminBypass', 'createdAt', 'createdAtMs', 'uid', 'accessToken', 'guestEmail', 'input', 'pricing', 'revisionCredits', 'revisionCount', 'itinerary', '_block_mode_used'],
  block: ['itinerary', '_block_mode_used'],
};
export async function guardGenerationPatch(db, planId, patch, options = {}) {
  const { kind, merge = true, create = false, issuanceClaim = null } = options;
  const keys = PATCH_KEYS[kind];
  if (!keys || !planId) conflict('invalid patch kind or plan');
  if (Object.keys(patch).some(key => !keys.includes(key))) conflict('unsupported patch field');
  const payload = prepareGenerationPayload(patch); // no dates/random/mutation in retried callback
  const claim = issuanceClaim ? prepareGenerationPayload(issuanceClaim) : null;
  const ref = db.collection('plans').doc(planId);
  return db.runTransaction(async tx => {
    const snap = await tx.get(ref);
    if (!snap.exists) {
      if (!create || kind !== 'skeleton') return { written: false, reason: 'missing' };
      if (payload.planId !== planId || !own(payload, 'uid') || payload.status !== 'streaming' || payload._streaming_in_progress !== true) conflict('invalid new skeleton');
      if (merge) tx.set(ref, payload, { merge: true });
      else tx.set(ref, payload);
      return { written: true };
    }
    const current = snap.data();
    if (hasPlanEditMarkers(current)) return { written: false, reason: 'edited' };
    if (kind !== 'enrichment' && current.status === 'ready') return { written: false, reason: 'ready' };
    if (current.planId !== planId || (own(options, 'uid') && current.uid !== options.uid)) return { written: false, reason: 'identity' };
    if (kind !== 'enrichment' && (current.status !== 'streaming' || current._streaming_in_progress !== true)) return { written: false, reason: 'not_streaming' };
    if (kind === 'failure' && claim) {
      try { await readPaidFence(tx, db, claim, 'failure'); } catch (error) {
        if (error.code !== 'PLAN_PERSISTENCE_CONFLICT') throw error;
        return { written: false, reason: 'claim_mismatch' };
      }
      if (claim.planId !== planId) return { written: false, reason: 'claim_mismatch' };
    }
    // Preserve original set(...,{merge:true}) dotted-key semantics; do not change to update().
    if (merge) tx.set(ref, payload, { merge: true });
      else tx.set(ref, payload);
    return { written: true };
  });
}
