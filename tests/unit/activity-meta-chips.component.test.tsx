// @vitest-environment jsdom
//
// PR-E SAFETY (2026-06-02): 트레킹/러닝 day 난이도·위험·부적합 화면 노출 (ActivityMetaChips).
// backend buildActivityMeta 가 채운 day.activity_meta 를 사용자가 보는지 — 그동안 admin 패널에만
// 있고 plan 화면 미렌더였음. flag OFF/city_day = activity_meta undefined → 미렌더 (byte-identical).
import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ActivityMetaChips } from '../../src/pages/PlanDetailPage/components/ActivityMetaChips';

void React;

describe('ActivityMetaChips — 트레킹/러닝 SAFETY 노출', () => {
  it('trekking → 난이도/거리/고도/부적합/위험/장비 모두 표시', () => {
    render(
      <ActivityMetaChips
        meta={{
          activity_type: 'trekking',
          difficulty: 'expert',
          distance_km: 12,
          elevation_gain_m: 850,
          hazards: ['steep_rock_climb'],
          recommended_gear: ['trekking_pole'],
          unsuitable_for: ['wheelchair_user'],
        }}
        language="en"
      />,
    );
    expect(screen.getByText(/Expert/)).toBeInTheDocument();
    expect(screen.getByText(/12km/)).toBeInTheDocument();
    expect(screen.getByText(/850m/)).toBeInTheDocument();
    // SAFETY: 부적합 + 위험 + 장비 노출 (외국인 사고 예방)
    expect(screen.getByText(/Wheelchair User/)).toBeInTheDocument();
    expect(screen.getByText(/Steep Rock Climb/)).toBeInTheDocument();
    expect(screen.getByText(/Trekking Pole/)).toBeInTheDocument();
  });

  it('난이도 4-lang — ko 는 "어려움"', () => {
    render(<ActivityMetaChips meta={{ activity_type: 'trekking', difficulty: 'hard' }} language="ko" />);
    expect(screen.getByText(/어려움/)).toBeInTheDocument();
  });

  it('running_route → 러닝 라벨 + 난이도', () => {
    render(<ActivityMetaChips meta={{ activity_type: 'running_route', difficulty: 'beginner' }} language="en" />);
    expect(screen.getByText(/Running/)).toBeInTheDocument();
    expect(screen.getByText(/Beginner/)).toBeInTheDocument();
  });

  it('city_day(비활동 activity_type) → null 렌더 (flag OFF byte-identical)', () => {
    const { container } = render(<ActivityMetaChips meta={{ activity_type: 'city_day' } as never} language="en" />);
    expect(container.querySelector('[data-testid="activity-meta"]')).toBeNull();
  });

  it('unsuitable_for 없으면 경고 배너 미표시 (조건부 SAFETY)', () => {
    render(<ActivityMetaChips meta={{ activity_type: 'trekking', difficulty: 'easy' }} language="en" />);
    expect(screen.queryByText(/Not suitable for/)).toBeNull();
  });
});
