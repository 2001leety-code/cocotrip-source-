// editService.js — synthetic owner-edit transaction adapter (ESM)
import { createHash } from 'node:crypto';
const SAFE_ID = /^[A-Za-z0-9_-]{1,128}$/;
const sha256 = (s) => createHash('sha256').update(s, 'utf8').digest('hex');
export class EditError extends Error {
  constructor(status, code) { super(code); this.status = status; this.code = code; }
}
const fail = (status, code) => { throw new EditError(status, code); };
const isSafeRevision = (r) =>
  Number.isSafeInteger(r) && r >= 0 && r < Number.MAX_SAFE_INTEGER;
const isValidResult = (r, requestId) =>
  r && r.ok === true && r.requestId === requestId &&
  Number.isSafeInteger(r.editRevision) && r.editRevision > 0 && typeof r.fingerprint === 'string' && /^[a-f0-9]{64}$/.test(r.fingerprint);
export function createEditService({
  db, validateCommand, canonicalJson, canonicalSource, applyOperation, cleanDays, now,
}) {
  if (!db || !validateCommand || !canonicalJson || !canonicalSource || !applyOperation || !cleanDays || !now) {
    throw new Error('EDIT_SERVICE_MISCONFIGURED');
  }
  async function execute(uid, raw) {
    // Outside tx: auth-derived uid is trusted input; validate command; fix time once.
    if (typeof uid !== 'string' || uid.length === 0) fail(401, 'UNAUTHENTICATED');
    let command;
    try { command = validateCommand(raw); } catch {
      const error = new EditError(400, 'INVALID_COMMAND');
      let body = raw;
      try { if (typeof body === 'string') body = JSON.parse(body); } catch { body = null; }
      if (body && typeof body === 'object' && typeof body.requestId === 'string' && SAFE_ID.test(body.requestId)) {
        error.outcome = 'not_applied'; error.requestId = body.requestId;
      }
      throw error;
    }
    const { planId, requestId, expectedFingerprint } = command;
    if (!SAFE_ID.test(String(planId)) || !SAFE_ID.test(String(requestId))) fail(400, 'INVALID_ID');
    if (typeof expectedFingerprint !== 'string' || expectedFingerprint.length !== 64) fail(400, 'INVALID_FINGERPRINT');
    const fixedNow = now();
    const digest = sha256(canonicalJson(command));
    const receiptKey = sha256(JSON.stringify([uid, planId, requestId]));
    const planRef = db.collection('plans').doc(planId);
    const receiptRef = db.collection('editReceipts').doc(receiptKey);
    return db.runTransaction(async (tx) => {
      // All reads before any write.
      const [planSnap, receiptSnap] = await Promise.all([tx.get(planRef), tx.get(receiptRef)]);
      if (!planSnap.exists) fail(404, 'PLAN_NOT_FOUND');
      const doc = planSnap.data() || {};
      if (typeof doc.uid !== 'string' || doc.uid.length === 0 || doc.uid !== uid) fail(403, 'FORBIDDEN');
      if (doc.planId !== planId) fail(409, 'PLAN_ID_MISMATCH');
      // Idempotent replay check (ownership already enforced above, even for replay).
      if (receiptSnap.exists) {
        const r = receiptSnap.data() || {};
        const exact = r.uid === uid && r.planId === planId && r.requestId === requestId && r.digest === digest;
        if (exact && isValidResult(r.result, requestId)) return r.result;
        fail(409, 'OP_ID_CONFLICT'); // never overwrite an existing receipt
      }
      const rejectNew = (status, code) => {
        const error = new EditError(status, code);
        error.outcome = 'not_applied'; error.requestId = requestId; throw error;
      };
      if (doc.status !== 'ready') rejectNew(409, 'PLAN_NOT_READY');
      if (doc._streaming_in_progress === true) rejectNew(409, 'PLAN_STREAMING');
      if (doc._p231_stub === true) rejectNew(409, 'PLAN_STUB');
      const currentRevision = doc.editRevision === undefined ? 0 : doc.editRevision;
      if (!isSafeRevision(currentRevision)) rejectNew(409, 'REVISION_INVALID');
      const currentFingerprint = sha256(canonicalSource(doc));
      if (currentFingerprint !== expectedFingerprint) rejectNew(409, 'FINGERPRINT_MISMATCH');
      let days;
      try { days = cleanDays(applyOperation(doc, command)); } catch { rejectNew(422, 'OPERATION_FAILED'); }
      if (!Array.isArray(days)) rejectNew(422, 'OPERATION_FAILED');
      const editRevision = currentRevision + 1;
      const updatedDoc = {
        ...doc,
        itinerary: { ...(doc.itinerary || {}), days },
        edited: true,
        lastEditedAt: fixedNow,
        editRevision,
      };
      const fingerprint = sha256(canonicalSource(updatedDoc));
      const result = { ok: true, requestId, editRevision, fingerprint };
      tx.update(planRef, {
        'itinerary.days': days,
        edited: true,
        lastEditedAt: fixedNow,
        editRevision,
      });
      tx.create(receiptRef, { uid, planId, requestId, digest, result });
      return result;
    });
  }
  return { execute };
}