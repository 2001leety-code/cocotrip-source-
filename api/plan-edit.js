import { initAdminDb } from './_shared/firebase-admin.js';
import { verifyFirebaseIdentityToken } from './_shared/user-auth.js';
import { validateCommand, applyOperation } from './_shared/plan-edit-operation.js';
import { createEditService, EditError } from './_shared/plan-edit-service.js';
import { canonicalJson, canonicalSource } from '../src/lib/planEditCanonical.js';
import { stripArrivalRestNoteIfDay1Active } from '../src/lib/arrivalRestNote.js';
import { stripBreakfastNoteIfLastDayHasMeal } from '../src/lib/departureBreakfastNote.js';

export const config = { runtime: 'nodejs' };
export const maxDuration = 30;
function cleanDays(days) {
  stripArrivalRestNoteIfDay1Active({ days });
  stripBreakfastNoteIfLastDayHasMeal({ days });
  return days;
}
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, code: 'METHOD_NOT_ALLOWED' });
  }
  try {
    const identity = await verifyFirebaseIdentityToken(req);
    if (!identity.ok || !identity.uid) return res.status(401).json({ ok: false, code: 'UNAUTHENTICATED' });
    const db = initAdminDb();
    if (!db) return res.status(503).json({ ok: false, code: 'EDIT_UNAVAILABLE' });
    const service = createEditService({
      db, validateCommand, canonicalJson, canonicalSource, applyOperation, cleanDays, now: Date.now,
    });
    return res.status(200).json(await service.execute(identity.uid, req.body));
  } catch (error) {
    if (error instanceof EditError) return res.status(error.status).json({ ok: false, code: error.code,
      ...(error.outcome === 'not_applied' ? {outcome:error.outcome,requestId:error.requestId} : {}) });
    return res.status(503).json({ ok: false, code: 'EDIT_UNAVAILABLE' });
  }
}
