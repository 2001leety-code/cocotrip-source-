// @vitest-environment jsdom
//
// TransitArrow 컴포넌트 — 사례 1.6 (오답노트 P1.6) 회귀 방지 component-level 테스트.
// shouldShowFallbackWarning 순수 함수는 transit-fallback-warning.test.ts에서 검증.
// 이 파일은 실제 React 렌더 결과(DOM에 경고 텍스트가 들어갔는지)를 확인.

import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TransitArrow } from '../../src/pages/PlanDetailPage/components/TransitArrow';

void React; // automatic JSX runtime이 안 잡힐 때 대비 — 명시 import로 ReferenceError 회피.

// useLanguage mock — Provider 없이 ko/en dict 직접 주입.
vi.mock('@/hooks/useLanguage', () => ({
  useLanguage: () => ({
    language: 'ko',
    t: { planDetail: { transit: { transitEstimated: '예상 이동 시간 — 실시간 교통 정보 없음' } } },
    changeLanguage: () => {},
  }),
}));

const FALLBACK_WARNING = '예상 이동 시간 — 실시간 교통 정보 없음';

describe('TransitArrow — fallback 경고 노출 (사례 1.6)', () => {
  it('car + naver_fallback → 경고 DOM에 없음', () => {
    render(
      <TransitArrow
        transit={{ method: 'car', est_min: 25, source: 'naver_fallback' } as never}
      />,
    );
    expect(screen.queryByText(FALLBACK_WARNING)).not.toBeInTheDocument();
  });

  it('subway + naver_fallback → 경고 DOM에 노출', () => {
    render(
      <TransitArrow
        transit={{ method: 'subway', est_min: 30, source: 'naver_fallback' } as never}
      />,
    );
    expect(screen.getByText(FALLBACK_WARNING)).toBeInTheDocument();
  });

  it('bus + naver_fallback → 경고 노출', () => {
    render(
      <TransitArrow
        transit={{ method: 'bus', est_min: 20, source: 'naver_fallback' } as never}
      />,
    );
    expect(screen.getByText(FALLBACK_WARNING)).toBeInTheDocument();
  });

  it('subway + odsay (정상 source) → 경고 없음', () => {
    render(
      <TransitArrow
        transit={{ method: 'subway', est_min: 30, source: 'odsay' } as never}
      />,
    );
    expect(screen.queryByText(FALLBACK_WARNING)).not.toBeInTheDocument();
  });

  it('walk + naver_fallback → 경고 없음 (도보는 traffic 무관)', () => {
    render(
      <TransitArrow
        transit={{ method: 'walk', est_min: 10, source: 'naver_fallback' } as never}
      />,
    );
    expect(screen.queryByText(FALLBACK_WARNING)).not.toBeInTheDocument();
  });

  it('downgrade(subway→walk) + naver_fallback → 경고 없음 (별도 isDowngraded 분기)', () => {
    render(
      <TransitArrow
        transit={{
          method: 'subway',
          est_min: 30,
          source: 'naver_fallback',
          _downgraded_from: 'subway',
        } as never}
      />,
    );
    expect(screen.queryByText(FALLBACK_WARNING)).not.toBeInTheDocument();
  });
});
