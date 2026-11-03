import { isPreviewEmailSuppressed, suppressedEmailReceipt } from './email-delivery-policy.js';
import { paidPlanRevisionDefaults } from './plan-purchase-defaults.js';
import { shapeRequest } from '../_ai_core/requestShaper.js';
import { createHash, randomUUID } from 'node:crypto';
import { normalizePrepayInput, prepayFingerprint } from './prepay-coverage.js';
import { loadMealFoodRows } from '../_ai_core/mealFoodRows.js';
import { validateStoredMealDraft, mealDatabaseVersion } from '../_ai_core/mealPlanIntegration.js';
import { beginPlanCommit, finalizePlanIssuance } from './plan-issuance.js';

export const MEAL_DRAFT_BINDING_VERSION = 1;
/** Only genuinely pre-contract snapshots may follow the legacy recovery path. */
export function mealDraftContractMode(snapshot) {
  const owns = (key) => Object.prototype.hasOwnProperty.call(snapshot, key);
  if (!owns('mealDraftBindingVersion') && !owns('mealDraftSnapshot')) return 'legacy';
  return owns('mealDraftBindingVersion') && snapshot.mealDraftBindingVersion === MEAL_DRAFT_BINDING_VERSION ? 'v1' : 'invalid';
}
export const MEAL_OPENING_NOTICE_VERSION = 'meal-opening-unconfirmed-v1';
const digest = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const fail = (code) => { throw Object.assign(new Error(code), { code }); };
export const draftPayloadFingerprint = (draft) => digest({ input: draft.inputFingerprint, canonicalInput: draft.input, itinerary: draft.itinerary, revision: draft.revision, dbVersion: draft.dbVersion });
export function assertMealDraftIntegrity(draft, uid, binding, prepayInput) {
  if (!uid || draft.uid !== uid) fail('MEAL_DRAFT_OWNER_MISMATCH');
  if (!['verified', 'opening_unconfirmed'].includes(draft.status) || !binding || draft.revision !== binding.revision || draft.fingerprint !== binding.fingerprint) fail('MEAL_DRAFT_STALE');
  if (draft.status === 'opening_unconfirmed' && binding.openingNoticeVersion !== MEAL_OPENING_NOTICE_VERSION) fail('MEAL_DRAFT_NOTICE_REQUIRED');
  if (draftPayloadFingerprint(draft) !== draft.fingerprint) fail('MEAL_DRAFT_INTEGRITY');
  const normalized = normalizePrepayInput(draft.input, { requireFutureStart: false });
  if (!normalized.ok || prepayFingerprint(normalized.input) !== prepayFingerprint(prepayInput)) fail('MEAL_DRAFT_INPUT_MISMATCH');
  if (!Array.isArray(draft.itinerary?.days) || draft.itinerary.days.length !== prepayInput.durationDays) fail('MEAL_DRAFT_INVALID');
  // Leave substantial room for both the order and final plan document metadata.
  if (Buffer.byteLength(JSON.stringify(draft), 'utf8') > 650000) fail('MEAL_DRAFT_TOO_LARGE');
}
export async function loadBoundMealDraft({ db, uid, binding, prepayInput, loadRows = loadMealFoodRows, validate = true }) {
  if (!binding || !/^[A-Za-z0-9_-]{1,128}$/.test(binding.draftId || '')) fail('MEAL_DRAFT_REQUIRED');
  const doc = await db.collection('meal_plan_drafts').doc(binding.draftId).get();
  if (!doc.exists) fail('MEAL_DRAFT_MISSING');
  const draft = doc.data();
  assertMealDraftIntegrity(draft, uid, binding, prepayInput);
  if (validate) {
    const rows = await loadRows();
    if (mealDatabaseVersion(rows) !== draft.dbVersion) fail('MEAL_DRAFT_DATABASE_CHANGED');
    const allowUnconfirmedOpening = draft.status === 'opening_unconfirmed' && binding.openingNoticeVersion === MEAL_OPENING_NOTICE_VERSION;
    const checked = await validateStoredMealDraft({ input: draft.input, itinerary: draft.itinerary }, rows, undefined, { allowUnconfirmedOpening });
    if (checked.status !== 'verified' && !(allowUnconfirmedOpening && checked.status === 'opening_unconfirmed')) fail('MEAL_DRAFT_INVALID');
  }
  return { ...draft, draftId: binding.draftId, ...(draft.status === 'opening_unconfirmed' ? { openingNoticeVersion: MEAL_OPENING_NOTICE_VERSION, openingNoticeRecordedAt: new Date().toISOString() } : {}) };
}
export async function persistBoundMealDraft(db, draft, claim, { guest = false, pricing = null } = {}) {
  if (!claim?.planId || !claim.orderId) fail('PLAN_ISSUANCE_CHECK_UNAVAILABLE');
  const accessToken = guest ? randomUUID() : null;
  const doc = { planId: claim.planId, status: 'ready', isPublic: false, uid: draft.uid,
    verifiedHistoryUid: draft.uid, accessToken, paymentSource: 'paypal', isFreeCoupon: false, isAdminBypass: false,
    ...paidPlanRevisionDefaults(), ...(pricing ? { pricing } : {}), createdAt: new Date().toISOString(), createdAtMs: Date.now(), guestEmail: draft.input.email || null,
    mealOptionsRevision: randomUUID(), mealDraftBinding: { draftId: draft.draftId, revision: draft.revision, fingerprint: draft.fingerprint, ...(draft.status === 'opening_unconfirmed' ? { openingNoticeVersion: draft.openingNoticeVersion, openingNoticeRecordedAt: draft.openingNoticeRecordedAt } : {}) },
    input: { ...draft.input, paypalOrderId: claim.orderId }, itinerary: draft.itinerary };
  if (Buffer.byteLength(JSON.stringify(doc), 'utf8') > 900000) fail('MEAL_DRAFT_TOO_LARGE');
  const begun = await beginPlanCommit(db, claim);
  if (!begun.ok) fail(begun.code);
  if (begun.alreadyIssued) {
    const existing = (await db.collection('plans').doc(claim.planId).get()).data();
    return { planId: claim.planId, planUrl: `/my-plans/${claim.planId}${existing.accessToken ? `?token=${existing.accessToken}` : ''}`, itinerary: existing.itinerary };
  }
  await db.collection('plans').doc(claim.planId).set(doc);
  const finalized = await finalizePlanIssuance(db, claim);
  if (!finalized.ok) fail(finalized.code);
  return { planId: claim.planId, planUrl: `/my-plans/${claim.planId}${accessToken ? `?token=${accessToken}` : ''}`, itinerary: draft.itinerary };
}

/** Preserve the paid purchase response and notification contract without regenerating the itinerary. */
export async function fulfillBoundMealDraft({ db, draft, claim, guest, authenticatedEmail, pricingFor, notify }) {
  const shaped = shapeRequest(draft.input, authenticatedEmail || null, guest, guest ? null : draft.uid);
  const { vehicle, durationDays } = shaped;
  const pricing = { vehicle, ...pricingFor(vehicle, durationDays) };
  const saved = await persistBoundMealDraft(db, draft, claim, { guest, pricing });
  notify({ adminDb: db, ...shaped, uid: draft.uid, itinerary: saved.itinerary, planId: saved.planId, planUrl: saved.planUrl, orderId: claim.orderId });
  return { ...saved, firestoreSaved: true, emailSent: !!shaped.email && !isPreviewEmailSuppressed(), ...(isPreviewEmailSuppressed() ? { emailDelivery: suppressedEmailReceipt() } : {}), pricing };
}
