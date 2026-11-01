// @vitest-environment jsdom
/**
 * PR2 r9 — 서버가 합친 같은 숙소 표식(좌표 50m 이내, 이동정보 null)은 PDF 에서도 이동 대체 안내("도보 3분/택시 ₩4,800 (0m)")와
 *   일일 이동 합계 3분 가산이 없다. 화면 TransitFallback 과 같은 판정 함수(src/lib/sameSpot.isSameSpot). 실제 generatePDF HTML(외부 호출 0).
 */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn(), loading: vi.fn(), dismiss: vi.fn() } }));
vi.mock('@/lib/posthog', () => ({ track: vi.fn() }));
vi.mock('@/lib/pdfFonts', () => ({ preparePdfFonts: vi.fn(async () => true) }));

import { generatePDF } from '../../src/pages/PlanDetailPage/pdfGenerator';
import { isSameSpot, SAME_SPOT_M } from '../../src/lib/sameSpot';

const P = { lat: 37.5636, lng: 126.9826 };

async function pdfHtml(plan: unknown) {
  const appended: Element[] = [];
  const orig = document.body.appendChild.bind(document.body);
  const spy = vi.spyOn(document.body, 'appendChild').mockImplementation(<T extends Node>(node: T): T => { if (node instanceof Element) appended.push(node); return orig(node); });
  try { await generatePDF(plan as never, {}, {}, 'en'); } finally { spy.mockRestore(); }
  const el = appended.find((n) => n.innerHTML.includes('pdf-day-wrapper'));
  return el ? el.innerHTML : '';
}
const plan = (second: { lat: number; lng: number }) => ({
  input: { language: 'en' },
  itinerary: { tour_title: 'T', days: [
    { day: 1, city: 'seoul', theme: 'Arrival', stops: [
      { category: 'lodging', name: 'Hotel', start_time: '22:40', ...P },
      { category: 'lodging', name: 'Hotel', start_time: '22:40', transit_from_prev: null, ...second },
    ] },
  ] },
});
const transitTotal = (html: string) => /Transit<\/strong>: <span[^>]*>([^<]*)<\/span>/.exec(html)?.[1];

describe('PDF — merged same-hotel markers (same spot) get no fake travel', () => {
  it('same coordinates → no walk/taxi fallback block, daily transit total stays "—"', async () => {
    const html = await pdfHtml(plan(P));
    expect(html).toContain('pdf-day-wrapper');
    expect(html).not.toMatch(/min walk · or taxi/);
    expect(transitTotal(html)).toBe('—');
  });
  it('a different place 500 m away keeps the existing PDF estimate', async () => {
    const html = await pdfHtml(plan({ lat: P.lat + 0.0045, lng: P.lng }));
    expect(html).toMatch(/min walk · or taxi/);
    expect(transitTotal(html)).not.toBe('—');
  });
  it('one shared predicate: isSameSpot ≤ 50 m; screen and PDF both import it', () => {
    expect(SAME_SPOT_M).toBe(50);
    expect(isSameSpot(P.lat, P.lng, P.lat + 0.0004, P.lng)).toBe(true);   // ~44 m
    expect(isSameSpot(P.lat, P.lng, P.lat + 0.0006, P.lng)).toBe(false);  // ~67 m
    const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');
    expect(read('src/pages/PlanDetailPage/pdfGenerator.ts')).toContain("from '@/lib/sameSpot'");
    expect(read('src/pages/PlanDetailPage/components/TransitFallback.tsx')).toContain("from '@/lib/sameSpot'");
  });
});
