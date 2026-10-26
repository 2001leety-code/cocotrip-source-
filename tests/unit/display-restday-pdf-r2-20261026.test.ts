// @vitest-environment jsdom
/**
 * 2026-10-26 표시 PR r2-2 — PDF 1일차 휴식 카드 제목이 안내 문장이면 바로 아래 숙소 Tip 의 같은 문장과 중복 출력됐다.
 *   제목 = 별도 4개 언어 제목(arrivalRestTitle). 실제 generatePDF 로 만든 HTML 에서 안내 문장 1회·제목 1회·다음날 실제 시각 확인.
 *   jsdom 에선 레이아웃 높이 0 → generatePDF 가 캡처 전에 "빈 콘텐츠" 로 멈춘다(HTML 조립까지는 실행). 외부 호출 0.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn(), loading: vi.fn(), dismiss: vi.fn() } }));
vi.mock('@/lib/posthog', () => ({ track: vi.fn() }));
vi.mock('@/lib/pdfFonts', () => ({ preparePdfFonts: vi.fn(async () => true) }));

import { generatePDF } from '../../src/pages/PlanDetailPage/pdfGenerator';
import { ARRIVAL_REST_NOTE, ARRIVAL_REST_TITLE } from '../../src/lib/arrivalRestNote.js';

const count = (s: string, needle: string) => s.split(needle).length - 1;

async function pdfHtml(plan: unknown, lang: string) {
  const appended: Element[] = [];
  const orig = document.body.appendChild.bind(document.body);
  const spy = vi.spyOn(document.body, 'appendChild').mockImplementation(<T extends Node>(node: T): T => { if (node instanceof Element) appended.push(node); return orig(node); });
  try {
    await generatePDF(plan as never, {}, {}, lang);
  } finally {
    spy.mockRestore();
  }
  const el = appended.find((n) => n.innerHTML.includes('pdf-day-wrapper'));
  return el ? el.innerHTML : '';
}

describe('PDF rest card title is not the note sentence (no duplicate)', () => {
  const plan = (lang: string) => ({
    input: { language: lang, arrival_rest_day: true },
    itinerary: { tour_title: 'T', days: [
      { day: 1, city: 'seoul', theme: 'Arrival', stops: [{ category: 'lodging', name: 'Hotel', start_time: '23:00', tip: ARRIVAL_REST_NOTE[lang as 'ko'], arrival_rest_note: ARRIVAL_REST_NOTE[lang as 'ko'], _arrival_rest_note: true }] },
      { day: 2, city: 'seoul', theme: 'Departure', stops: [{ category: 'lodging', name: 'Hotel', start_time: '06:30' }, { category: 'airport', name: 'Incheon International Airport', start_time: '07:00' }] },
    ] },
  });
  it.each(['ko', 'en', 'ja', 'zh'])('%s: note once (hotel tip), separate title once, tomorrow line uses the next day first stop 06:30', async (lang) => {
    const html = await pdfHtml(plan(lang), lang);
    expect(html).toContain('pdf-day-wrapper');
    expect(count(html, ARRIVAL_REST_NOTE[lang as 'ko'])).toBe(1);
    expect(count(html, ARRIVAL_REST_TITLE[lang as 'ko'])).toBe(1);
    expect(html).toContain('06:30');
    expect(html).not.toContain('09:00');
  });
});
