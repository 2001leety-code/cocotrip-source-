// @vitest-environment jsdom
//
// TMAP 역명 영문 표기 — 파서 출력이 실제로 화면에 영어로 찍히는지 component-level 검증.
// 필드 단위 검증은 tmap-station-localization.test.ts. 이 파일은 사용자가 보는 결과를 지킨다.
//
// 회귀 대상: `_tmap_helper.js` 가 lineEn/fromRoman/toRoman 을 안 채우면
// stationDisplay 의 `paren = translated || roman` 이 undefined 를 받아 한글만 렌더한다
// (translate-plan 은 "en 은 이미 영문이 있다"고 보고 건너뛰므로 구제되지 않는다).
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TransitArrow } from '../../src/pages/PlanDetailPage/components/TransitArrow';
import { mapTmapItineraryToRoute } from '../../api/_tmap_helper.js';

void React;

vi.mock('@/hooks/useLanguage', () => ({
  useLanguage: () => ({ language: 'en', t: { planDetail: { transit: {} } }, changeLanguage: () => {} }),
}));

/** TMAP 실응답 형태(2026-07-19 프로브: 강남→홍대입구). 노선명에 띄어쓰기가 없다. */
const TMAP_ITINERARY = {
  totalTime: 1500, totalDistance: 11000, transferCount: 0, pathType: 1,
  fare: { regular: { totalFare: 1400 } },
  legs: [{
    mode: 'SUBWAY', sectionTime: 1500, distance: 11000, route: '수도권2호선', routeColor: '009D3E',
    start: { name: '강남', lon: 127.0276, lat: 37.4979 },
    end: { name: '홍대입구', lon: 126.924, lat: 37.5572 },
  }],
};

function renderFromTmap() {
  const route = mapTmapItineraryToRoute(TMAP_ITINERARY)!;
  return render(
    <TransitArrow
      transit={{ method: 'subway', est_min: route.totalTime, steps_detail: route.steps } as never}
    />,
  );
}

describe('영어 화면 — TMAP 경로의 역명·노선명', () => {
  it('노선명이 영문으로 렌더된다 ("수도권2호선" 이 아니라 "Line 2")', () => {
    renderFromTmap();
    expect(screen.getByText('Line 2')).toBeInTheDocument();
    expect(screen.queryByText('수도권2호선')).not.toBeInTheDocument();
  });

  it('역명이 한글(영문) 병기로 렌더된다 — 현장 간판 대조가 가능해야 한다', () => {
    renderFromTmap();
    expect(screen.getByText('강남 (Gangnam)')).toBeInTheDocument();
    // 공식 영문명. TMAP lang=1 은 "Hongdae" 로 준다.
    expect(screen.getByText('홍대입구 (Hongik Univ.)')).toBeInTheDocument();
  });

  it('회귀 가드 — 로마자가 비면 한글만 렌더된다(수정 전 상태 재현)', () => {
    const route = mapTmapItineraryToRoute(TMAP_ITINERARY)!;
    const stripped = route.steps.map((s: Record<string, unknown>) => {
      const { lineEn: _l, fromRoman: _f, toRoman: _t, ...rest } = s;
      return rest;
    });
    render(<TransitArrow transit={{ method: 'subway', est_min: 25, steps_detail: stripped } as never} />);
    expect(screen.getByText('강남')).toBeInTheDocument();          // 병기 없음 = 버그 상태
    expect(screen.queryByText('강남 (Gangnam)')).not.toBeInTheDocument();
  });
});
