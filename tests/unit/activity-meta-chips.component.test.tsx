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
    expect(screen.getByText(/Wheelchair users/)).toBeInTheDocument();
    expect(screen.getByText(/Steep rock climb/)).toBeInTheDocument();
    // 장비도 4-lang 라벨 — humanize('Trekking Pole') 가 아니라 GEAR_LABEL.en 'Trekking poles'
    expect(screen.getByText(/Trekking poles/)).toBeInTheDocument();
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

  it('컷오프 토큰 → 전용 시간 배너 (한라산 12:30, 깨진 영어 아님)', () => {
    render(<ActivityMetaChips meta={{ activity_type: 'trekking', difficulty: 'expert', hazards: ['12_30_pm_cutoff_at_jindallae'] }} language="en" />);
    expect(screen.getByText(/Time cutoff/)).toBeInTheDocument();
    expect(screen.getByText(/12:30 PM/)).toBeInTheDocument();
    expect(screen.getByText(/Jindallae/)).toBeInTheDocument();
  });

  it('위험 토큰 4-lang — ko 고산 날씨 급변', () => {
    render(<ActivityMetaChips meta={{ activity_type: 'trekking', difficulty: 'expert', hazards: ['high_altitude_weather_change'] }} language="ko" />);
    expect(screen.getByText(/고산 날씨 급변/)).toBeInTheDocument();
  });

  it('미등록 위험 토큰 → humanize 폴백 (라벨 없다고 위험 숨김 금지)', () => {
    render(<ActivityMetaChips meta={{ activity_type: 'trekking', difficulty: 'hard', hazards: ['totally_new_token'] }} language="en" />);
    expect(screen.getByText(/Totally New Token/)).toBeInTheDocument();
  });

  it('부적합 4-lang — ko 휠체어 이용자 + 고산증 민감자 (절대 누락 금지)', () => {
    render(<ActivityMetaChips meta={{ activity_type: 'trekking', difficulty: 'expert', unsuitable_for: ['wheelchair_user', 'altitude_sensitive'] }} language="ko" />);
    expect(screen.getByText(/휠체어 이용자/)).toBeInTheDocument();
    expect(screen.getByText(/고산증 민감자/)).toBeInTheDocument();
  });

  it('장비(gear) 4-lang — ko 겨울 아이젠 + 헤드랜턴 (humanize 깨진 영어 방지)', () => {
    render(<ActivityMetaChips meta={{ activity_type: 'trekking', difficulty: 'expert', recommended_gear: ['crampons_winter', 'headlamp'] }} language="ko" />);
    expect(screen.getByText(/겨울 아이젠/)).toBeInTheDocument();
    expect(screen.getByText(/헤드랜턴/)).toBeInTheDocument();
  });

  it('미등록 장비 토큰 → humanize 폴백 (라벨 없다고 미표시 금지)', () => {
    render(<ActivityMetaChips meta={{ activity_type: 'trekking', difficulty: 'hard', recommended_gear: ['totally_new_gear'] }} language="en" />);
    expect(screen.getByText(/Totally New Gear/)).toBeInTheDocument();
  });
});
