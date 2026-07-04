// @vitest-environment jsdom
//
// PR-E SAFETY (2026-06-12): 플래너 결과 미리보기(ItineraryResult)에도 트레킹/러닝
// activity_meta 칩을 노출. 그동안 PlanDetailPage(DayTimeline)에만 있어 미리보기에선
// 난이도/위험/부적합이 안 보였음 — 같은 ActivityMetaChips 컴포넌트를 Day 1 본문에 연결.
// activity_meta 없으면(flag OFF / city_day) 미렌더 = byte-identical 동작 보존.
//
// 주변 광고/섹션 컴포넌트는 mock(no-op) — 이 테스트는 activity_meta 배선만 검증.
import React from 'react';
import { describe, it, expect, beforeAll, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

void React;

// jsdom 은 matchMedia 미구현 — useIsMobile 가 호출하므로 폴리필 (import 전에 설정).
beforeAll(() => {
  if (!window.matchMedia) {
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: (query: string) => ({
        matches: false, media: query, onchange: null,
        addEventListener: () => {}, removeEventListener: () => {},
        addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false,
      }),
    });
  }
});

// 주변 섹션 mock — activity_meta 와 무관한 광고/추천/예약 컴포넌트는 no-op 으로.
vi.mock('../../src/pages/PlannerPage/components/EnrichingBanner', () => ({ EnrichingBanner: () => null }));
vi.mock('../../src/pages/PlannerPage/components/DailyTipsSection', () => ({ DailyTipsSection: () => null }));
vi.mock('../../src/pages/PlannerPage/components/TimelineCard', () => ({ TimelineCard: () => null }));
vi.mock('../../src/pages/PlannerPage/components/TransportBadge', () => ({ TransportBadge: () => null }));
vi.mock('../../src/pages/PlannerPage/components/RainyDaySection', () => ({ RainyDaySection: () => null }));
vi.mock('../../src/pages/PlannerPage/components/MealsSection', () => ({ MealsSection: () => null }));
vi.mock('../../src/pages/PlannerPage/components/AccommodationCard', () => ({ AccommodationCard: () => null }));
vi.mock('../../src/pages/PlannerPage/components/BudgetCard', () => ({ BudgetCard: () => null }));
vi.mock('../../src/pages/PlannerPage/components/SeasonalSpotsBanner', () => ({ SeasonalSpotsBanner: () => null }));
vi.mock('../../src/pages/PlannerPage/components/TourRecommendationsSection', () => ({ TourRecommendationsSection: () => null }));
vi.mock('../../src/pages/PlannerPage/components/OwnTourUpsellSection', () => ({ OwnTourUpsellSection: () => null }));
vi.mock('../../src/pages/PlannerPage/components/FlightSearchSection', () => ({ FlightSearchSection: () => null }));
vi.mock('../../src/pages/PlannerPage/components/EsimSection', () => ({ EsimSection: () => null }));
vi.mock('../../src/pages/PlannerPage/components/CustomerSupportSection', () => ({ CustomerSupportSection: () => null }));
vi.mock('../../src/pages/PlannerPage/components/ComboPackageBanner', () => ({ ComboPackageBanner: () => null }));
vi.mock('../../src/pages/PlannerPage/components/CharterBanner', () => ({ CharterBanner: () => null }));
vi.mock('../../src/pages/PlannerPage/components/AirportPickupCard', () => ({ AirportPickupCard: () => null }));

// ActivityMetaChips 는 실제 컴포넌트를 그대로 사용(배선 검증 대상이므로 mock 안 함).
import { ItineraryResult } from '../../src/pages/PlannerPage/components/ItineraryResult';
import type { PlannerResponse, DayItinerary } from '../../src/pages/PlannerPage/types';

const p = { resetBtn: 'Reset', dayLabel: 'Day', placesUnit: 'places', tripTitleFormat: '{nights}N {days}D {regions}' } as Record<string, unknown>;

function makeResult(day1: Partial<DayItinerary>): PlannerResponse {
  return {
    meta: { categories: ['nature'], regions: ['Seoul'], startDate: '2026-07-01', endDate: '2026-07-03', generatedAt: '2026-07-01' },
    itinerary: [
      { day: 1, date: '07-01', places: [], meals: [], ...day1 },
      { day: 2, date: '07-02', places: [], meals: [] },
    ],
  } as PlannerResponse;
}

describe('ItineraryResult — activity_meta 미리보기 노출', () => {
  it('Day 1 에 activity_meta(트레킹) 있으면 SAFETY 칩 렌더', () => {
    render(
      <ItineraryResult
        result={makeResult({ activity_meta: { activity_type: 'trekking', difficulty: 'expert', distance_km: 12, unsuitable_for: ['wheelchair_user'], hazards: ['steep_rock_climb'] } })}
        onReset={() => {}} p={p} lang="en"
      />,
    );
    expect(screen.getByTestId('activity-meta')).toBeInTheDocument();
    expect(screen.getByText(/12km/)).toBeInTheDocument();
    expect(screen.getByText(/Wheelchair users/)).toBeInTheDocument();
  }, 20000);

  it('activity_meta 없으면 칩 미렌더 (city_day / flag OFF byte-identical)', () => {
    render(<ItineraryResult result={makeResult({})} onReset={() => {}} p={p} lang="en" />);
    expect(screen.queryByTestId('activity-meta')).toBeNull();
  }, 20000);
});
