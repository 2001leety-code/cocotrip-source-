// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn(), loading: vi.fn(), dismiss: vi.fn() } }));
vi.mock('@/lib/posthog', () => ({ track: vi.fn() }));
vi.mock('@/lib/pdfFonts', () => ({ preparePdfFonts: vi.fn(async () => true) }));
import { generatePDF } from '../../src/pages/PlanDetailPage/pdfGenerator';
import { buildPlanHtml } from '../../api/pdf/generate.js';
import { renderBookingEmail, renderBookingEmailText } from '../../api/_email-renderer.js';
import { departureMealNote } from '../../src/lib/departureMealNote.js';
import { reattachFixedTipNotes } from '../../src/lib/fixedTipNotes.js';

describe('departure note survives actual output renderers', () => {
  it.each(['ko', 'en', 'ja', 'zh'])('%s: client PDF HTML, server PDF HTML, email HTML/text and translated fixed tip', async (language) => {
    const note = departureMealNote(language, ['dinner']);
    const stop = { order: 1, name: 'Airport', display_name: 'Airport', category: 'travel', start_time: '20:00', stay_min: 0,
      tip: note, departure_meal_note: note, departure_meal_roles: ['dinner'], _departure_meal_note: true };
    const days = [{ day: 1, city: 'busan', stops: [stop] }];
    const plan = { input: { language, area: 'busan' }, itinerary: { tour_title: 'Offline', days } };
    expect(buildPlanHtml(plan)).toContain(note);
    const args = { guestName: 'Offline', orderID: 'OFFLINE', tourTitle: 'Offline', tourDate: '2026-12-01', vehicle: 'sedan', pax: 1,
      durationDays: 1, amountUSD: 0, amountKRW: 0, days, language };
    expect(renderBookingEmail(args)).toContain(note);
    expect(renderBookingEmailText(args)).toContain(note);
    const elements: Element[] = [];
    const append = document.body.appendChild.bind(document.body);
    const spy = vi.spyOn(document.body, 'appendChild').mockImplementation(<T extends Node>(node: T): T => {
      if (node instanceof Element) elements.push(node);
      return append(node);
    });
    try { await generatePDF(plan as never, {}, {}, language); } finally { spy.mockRestore(); }
    const html = elements.find((el) => el.innerHTML.includes('pdf-day-wrapper'))?.innerHTML || '';
    expect(html).toContain(note);
    stop.tip = 'Translated body';
    reattachFixedTipNotes({ days }, language);
    expect(stop.tip).toContain(note);
    expect(stop.tip).not.toContain(departureMealNote(language, ['lunch', 'dinner']));
  });
});
