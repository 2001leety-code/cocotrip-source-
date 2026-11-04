// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn(), loading: vi.fn(), dismiss: vi.fn() } }));
vi.mock('@/lib/posthog', () => ({ track: vi.fn() }));
vi.mock('@/lib/pdfFonts', () => ({ preparePdfFonts: vi.fn(async () => true) }));
import { generatePDF } from '../../src/pages/PlanDetailPage/pdfGenerator';
import { buildPlanHtml } from '../../api/pdf/generate.js';
import { renderBookingEmail, renderBookingEmailText } from '../../api/_email-renderer.js';
import { mealSlotNote, applyMealSlotNotes } from '../../src/lib/mealSlotNotes.js';
import { reattachFixedTipNotes } from '../../src/lib/fixedTipNotes.js';
import { projectPublicPlan } from '../../src/lib/publicPlanProjection.js';
import { visitNotice } from '../../src/lib/visitNotice.js';
describe('same meal selection snapshot across actual output surfaces', () => {
  for (const language of ['ko', 'en', 'ja', 'zh']) for (const selected of [false, true]) {
    it(`${language} selected=${selected}: shared, PDF, email and translated fixed note agree`, async () => {
      const stop = { order: 1, name: 'Fixture Restaurant', display_name: 'Fixture Restaurant', category: 'food',
        meal_slot_id: 'm1', restaurant_id: 'r1', start_time: '12:00', stay_min: 60, tip: 'Fixture body' };
      const itinerary = { tour_title: 'Offline fixture', meal_options_version: 1, meal_options: [{ mealId: 'm1', day: 1,
        status: 'feasible', baselineId: 'r1', selectedId: selected ? 'r1' : null, options: [{ id: 'r1', name: 'Fixture Restaurant', verificationStatus: 'halal_certified' }] }],
        days: [{ day: 1, city: 'seoul', stops: [stop] }] };
      applyMealSlotNotes(itinerary, language);
      const note = mealSlotNote(language, selected);
      const plan = { input: { language, area: 'seoul' }, itinerary, isPublic: true };
      const shared = projectPublicPlan(plan);
      expect(shared.itinerary.meal_options_version).toBe(1);
      expect(shared.itinerary.meal_options[0].selectedId || null).toBe(selected ? 'r1' : null);
      expect(shared.itinerary.days[0].stops[0].tip).toContain(note);
      expect(projectPublicPlan(shared)).toEqual(shared);
      expect(buildPlanHtml(plan)).toContain(note);
      const args = { guestName: 'Fixture', orderID: 'OFFLINE', tourTitle: 'Fixture', tourDate: '2026-12-01', vehicle: 'sedan', pax: 1,
        durationDays: 1, amountUSD: 0, amountKRW: 0, days: itinerary.days, language };
      expect(renderBookingEmail(args)).toContain(note); expect(renderBookingEmailText(args)).toContain(note);
      const elements: Element[] = []; const append = document.body.appendChild.bind(document.body);
      const spy = vi.spyOn(document.body, 'appendChild').mockImplementation(<T extends Node>(node: T): T => { if (node instanceof Element) elements.push(node); return append(node); });
      try { await generatePDF(plan as never, {}, {}, language); } finally { spy.mockRestore(); }
      const clientPdf = elements.find((el) => el.innerHTML.includes('pdf-day-wrapper'))?.innerHTML;
      expect(clientPdf).toContain(note);
      expect(clientPdf).toContain(visitNotice(language).title);
      expect(clientPdf).toContain(visitNotice(language).body);
      stop.tip = 'Translated body'; reattachFixedTipNotes(itinerary, language);
      expect(stop.tip).toContain(note); expect(stop.tip.split(note)).toHaveLength(2);
    });
  }
});
