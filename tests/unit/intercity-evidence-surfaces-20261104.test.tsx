// @vitest-environment jsdom
import * as React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { intercityEvidenceNotices } from '../../src/lib/intercityEvidence.js';
import { projectPublicPlan } from '../../src/lib/publicPlanProjection.js';
import { planToMarkdown } from '../../src/pages/PlanDetailPage/lib/planToMarkdown';
import { buildPlanHtml } from '../../api/pdf/generate.js';
const state = vi.hoisted(() => ({ language: 'en' }));
vi.mock('@/hooks/useLanguage', () => ({ useLanguage: () => ({ t: {}, language: state.language }) }));
vi.mock('../../src/pages/PlanDetailPage/components/DayRouteMap', () => ({ DayRouteMap: () => null }));
vi.mock('../../src/pages/PlanDetailPage/components/CharterCTA', () => ({ CharterCTA: () => null }));
vi.mock('../../src/pages/PlanDetailPage/components/PlanMealOptions', () => ({ PlanMealOptions: () => null }));
vi.mock('../../src/pages/PlanDetailPage/components/SortableStopCard', () => ({ SortableStopCard: () => null }));
vi.mock('../../src/pages/PlanDetailPage/components/StopCard', () => ({ StopCard: () => null }));
vi.mock('../../src/pages/PlanDetailPage/components/OptimizePanel', () => ({ OptimizePanel: () => null }));
import { DayTimeline } from '../../src/pages/PlanDetailPage/components/DayTimeline';

const leg = { method: 'bus', est_min: 20, source: 'odsay' };
const segment = { mode: 'KTX', from_city: 'Seoul', to_city: 'Busan', recommended_depart: '09:20', arrival_at: '12:05', est_min: 165, depart_estimated: true };
describe('intercity evidence notices', () => {
  it.each(['ko', 'en', 'ja', 'zh'])('keeps %s notices consistent on screen, Markdown, server PDF and shared plans', (language) => {
    state.language = language;
    const notices = intercityEvidenceNotices(segment, language);
    expect(notices).toHaveLength(3);
    const day = { day: 5, city: 'busan', intercity_transit: segment, stops: [] };
    const plan = { input: { language }, itinerary: { days: [day] } };
    const screen = renderToStaticMarkup(<DayTimeline day={day} dayIndex={4} plan={plan} editMode={false} onDeleteStop={() => {}} onAddStop={() => {}} />);
    const md = planToMarkdown(plan as never, { language });
    const pdf = buildPlanHtml(plan);
    const shared = projectPublicPlan(plan);
    for (const notice of notices) {
      expect(screen).toContain(notice);
      expect(md).toContain(notice);
      expect(pdf).toContain(notice);
      expect(planToMarkdown(shared as never, { language })).toContain(notice);
    }
  });
  it('does not label present connections as unavailable or assert that they are verified', () => {
    expect(intercityEvidenceNotices({ lodging_to_station: leg, station_to_lodging: leg }, 'en')).toEqual([]);
  });
  it('reports only the missing side and treats an empty object as missing data', () => {
    expect(intercityEvidenceNotices({ lodging_to_station: leg }, 'en')).toEqual([expect.stringContaining('Arrival station/terminal-to-hotel')]);
    expect(intercityEvidenceNotices({ lodging_to_station: {}, station_to_lodging: leg }, 'en')).toEqual([expect.stringContaining('Hotel-to-departure')]);
  });
  it('retains estimated local-connection notice after public projection removes private fallback flags', () => {
    const fallback = { ...leg, source: 'naver_fallback', _bookend_fallback: true };
    const plan = { itinerary: { days: [{ day: 1, intercity_transit: { ...segment, lodging_to_station: fallback, station_to_lodging: leg } }] } };
    const projected = projectPublicPlan(plan).itinerary.days[0].intercity_transit;
    expect(projected.lodging_to_station).not.toHaveProperty('_bookend_fallback');
    expect(intercityEvidenceNotices(projected, 'en')).toEqual(intercityEvidenceNotices(plan.itinerary.days[0].intercity_transit, 'en'));
    expect(intercityEvidenceNotices(projected, 'en')).toContain('Station/terminal access uses estimated directions. Check the actual route before travel.');
  });
  it('supports a legitimate zero-minute same-location connection and unknown language fallback', () => {
    const data = { lodging_to_station: { ...leg, est_min: 0 }, station_to_lodging: leg };
    expect(intercityEvidenceNotices(data, 'en')).toEqual([]);
    expect(intercityEvidenceNotices(segment, 'unknown')).toEqual(intercityEvidenceNotices(segment, 'en'));
    expect(intercityEvidenceNotices(segment, '__proto__')).toEqual(intercityEvidenceNotices(segment, 'en'));
    expect(intercityEvidenceNotices(segment, 'constructor')).toEqual(intercityEvidenceNotices(segment, 'en'));
  });
});
