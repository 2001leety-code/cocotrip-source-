import { describe, it, expect, vi } from 'vitest';
vi.mock('../../api/_shared/firebase-admin.js', () => ({ initAdminDb: () => null }));
vi.mock('axios', () => ({ default: { get: vi.fn(async () => { throw new Error('unexpected network'); }) } }));
import { loadBoundMealDraft, draftPayloadFingerprint } from '../../api/_shared/meal-draft-binding.js';
import { normalizePrepayInput } from '../../api/_shared/prepay-coverage.js';
import { attachMealOptionState, mealDatabaseVersion } from '../../api/_ai_core/mealPlanIntegration.js';
import { memoryDb } from './helpers/payment-recovery-fixture';
describe('bound draft actual validator', () => {
 it('accepts verified hours, requires disclosure for unknown hours and rejects known closed hours', async () => {
 const rows = [{ name: 'Fixture 1', nameEn: 'Fixture 1', address: 'Seoul fixture', city: 'seoul', lat: 37.551, lng: 126.99, tag: 'halal', verification_status: 'halal_certified', opening_evidence: [{ date: '2026-12-01', from: '10:00', to: '16:00', source_url: 'https://example.test/hours', checked_at: '2026-11-02' }] }];
 const input = { startDate: '2026-12-01', durationDays: 1, dietaryRestrictions: ['Halal'], dietary: ['Halal'], area: 'seoul', regions: ['seoul'], tour_end_time: '16:00', meal_windows: { lunch: { from: '11:00', to: '15:00' }, dinner: null } };
 const itinerary = { days: [{ day: 1, city: 'seoul', date: '2026-12-01', stops: [
 { name: 'Museum', category: 'culture', start_time: '10:00', stay_min: 60, lat: 37.55, lng: 126.98 },
 { name: 'Fixture 1', display_name: 'Fixture 1', category: 'food', start_time: '12:00', stay_min: 60, lat: rows[0].lat, lng: rows[0].lng, verified: true, dietary_evidence: [{ diet: 'halal', tag: 'halal', verification_status: 'halal_certified' }], dietary_tags: ['halal'], transit_from_prev: { est_min: 20 } },
 { name: 'Gallery', category: 'culture', start_time: '15:00', stay_min: 30, lat: 37.56, lng: 126.99, transit_from_prev: { est_min: 20 } }
 ] }] };
 attachMealOptionState(itinerary, rows);
 const draft = { uid: 'owner', status: 'verified', input, itinerary, revision: 'r1', fingerprint: '', inputFingerprint: 'raw', dbVersion: mealDatabaseVersion(rows), draftId: 'd1' };
 draft.fingerprint = draftPayloadFingerprint(draft);
 const db = memoryDb(); db.rows.set('meal_plan_drafts/d1', draft);
 const args = { db: db.db, uid: 'owner', binding: draft, prepayInput: normalizePrepayInput(input).input, loadRows: async () => rows };
 expect((await loadBoundMealDraft(args)).itinerary).toEqual(itinerary);
 rows[0].opening_evidence = [];
 draft.dbVersion = mealDatabaseVersion(rows); draft.fingerprint = draftPayloadFingerprint(draft); db.rows.set('meal_plan_drafts/d1', draft);
 await expect(loadBoundMealDraft(args)).rejects.toThrow('MEAL_DRAFT_INVALID');
 Object.assign(draft, { status: 'opening_unconfirmed', openingNoticeVersion: 'meal-opening-unconfirmed-v1' });
 db.rows.set('meal_plan_drafts/d1', draft);
 expect((await loadBoundMealDraft(args)).status).toBe('opening_unconfirmed');
 rows[0].opening_evidence = [{ date: '2026-12-01', closed: true, source_url: 'https://example.test/hours', checked_at: '2026-11-02' }];
 draft.dbVersion = mealDatabaseVersion(rows); draft.fingerprint = draftPayloadFingerprint(draft); db.rows.set('meal_plan_drafts/d1', draft);
 await expect(loadBoundMealDraft(args)).rejects.toThrow('MEAL_DRAFT_INVALID');
 });
});
