// @vitest-environment jsdom
/**
 * 2026-11-16 — 마지막 날이 공항에서 끝나면 "숙소로 돌아가기" 카드(day.last_to_lodging)를 그리지 않는다.
 *   옛 plan 에는 서버가 붙여 둔 값이 남아 있다(운영 시험 11/16 부산·제주: 공항 stop 뒤에 복귀 카드). 다른 날은 그대로.
 *   판정 = src/lib/airportStop.js (서버 RouteAgent 와 같은 규칙).
 */
import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

void React;
vi.mock('../../src/hooks/useLanguage', () => ({ useLanguage: () => ({ language: 'en', t: {}, changeLanguage: () => {} }) }));
vi.mock('../../src/pages/PlanDetailPage/components/DayRouteMap', () => ({ DayRouteMap: () => null }));
vi.mock('../../src/pages/PlanDetailPage/components/LodgingBookend', async () => {
  const { createElement } = await import('react');
  return { LodgingBookend: (p: { variant: string }) => createElement('div', { 'data-testid': 'bookend', 'data-variant': p.variant }) };
});
vi.mock('../../src/pages/PlanDetailPage/components/StopCard', () => ({ StopCard: () => null }));
vi.mock('../../src/pages/PlanDetailPage/components/SortableStopCard', () => ({ SortableStopCard: () => null }));
vi.mock('../../src/pages/PlanDetailPage/components/TransitArrow', () => ({ TransitArrow: () => null }));
vi.mock('../../src/pages/PlanDetailPage/components/TransitFallback', () => ({ TransitFallback: () => null }));
vi.mock('../../src/pages/PlanDetailPage/components/RouteInsightCard', () => ({ RouteInsightCard: () => null }));
vi.mock('../../src/pages/PlanDetailPage/components/OptimizePanel', () => ({ OptimizePanel: () => null }));
vi.mock('../../src/pages/PlanDetailPage/components/ActivityMetaChips', () => ({ ActivityMetaChips: () => null }));
vi.mock('../../src/pages/PlanDetailPage/components/CharterCTA', () => ({ CharterCTA: () => null }));
vi.mock('../../src/pages/PlanDetailPage/components/ConfirmDialog', () => ({ ConfirmDialog: () => null }));

import { DayTimeline } from '../../src/pages/PlanDetailPage/components/DayTimeline';

afterEach(cleanup);

const ret = { method: 'subway', est_min: 50, instruction: 'Return to Seoul', from_label: 'Airport', to_label: 'Hotel' };
const hotel = { category: 'lodging', name: 'Hotel', start_time: '07:00' };
const airport = { category: 'travel', name: '김해국제공항', display_name: 'Gimhae Airport', start_time: '10:00', _departure_airport_stop: true };
const food = { category: 'food', name: 'Lunch', start_time: '12:00' };

function returnCards(days: Array<{ day: number; stops: unknown[]; last_to_lodging?: unknown }>, dayIndex: number) {
  const plan = { itinerary: { days }, input: {} };
  render(<DayTimeline day={days[dayIndex] as never} dayIndex={dayIndex} editMode={false} onDeleteStop={() => {}} onAddStop={() => {}} plan={plan as never} />);
  return screen.queryAllByTestId('bookend').filter((n) => n.getAttribute('data-variant') === 'return').length;
}

describe('DayTimeline — 마지막 날 공항 끝 = 숙소 복귀 카드 없음', () => {
  it('마지막 날이 공항에서 끝나면(옛 plan 의 last_to_lodging 이 남아 있어도) 그리지 않는다', () => {
    expect(returnCards([{ day: 1, stops: [hotel, food] }, { day: 2, stops: [hotel, airport], last_to_lodging: ret }], 1)).toBe(0);
  });
  it('공항에서 끝나도 마지막 날이 아니면 그대로 그린다', () => {
    expect(returnCards([{ day: 1, stops: [hotel, airport], last_to_lodging: ret }, { day: 2, stops: [hotel, food] }], 0)).toBe(1);
  });
  it('마지막 날이 식당에서 끝나면 그대로 그린다', () => {
    expect(returnCards([{ day: 1, stops: [hotel, food] }, { day: 2, stops: [hotel, food], last_to_lodging: ret }], 1)).toBe(1);
  });
});
