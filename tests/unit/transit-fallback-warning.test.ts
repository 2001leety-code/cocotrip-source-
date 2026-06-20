// shouldShowFallbackWarning + isPublicTransitMethod — 회귀 방지
//
// 사례 1.6 (오답노트 P1.6, 2026-04-27):
// 사용자가 prod에서 개인 차량(car) 모드 일정의 모든 stop 사이에
// "예상 이동 시간 — 실시간 교통 정보 없음" 경고가 노출돼 혼란.
// car 모드는 ODsay 대상이 아니라 'naver_fallback'이 정상 경로이므로
// 경고는 대중교통 모드에서만 표시되어야 한다.

import { describe, it, expect } from 'vitest';
import {
  isPublicTransitMethod,
  shouldShowFallbackWarning,
} from '../../src/pages/PlanDetailPage/components/TransitArrow';

describe('isPublicTransitMethod', () => {
  it('지하철·버스·복합은 true', () => {
    expect(isPublicTransitMethod('subway')).toBe(true);
    expect(isPublicTransitMethod('bus')).toBe(true);
    expect(isPublicTransitMethod('subway+bus')).toBe(true);
  });

  it('개인 차량/도보/택시는 false', () => {
    expect(isPublicTransitMethod('car')).toBe(false);
    expect(isPublicTransitMethod('walk')).toBe(false);
    expect(isPublicTransitMethod('taxi')).toBe(false);
  });

  it('undefined/빈 문자열은 false', () => {
    expect(isPublicTransitMethod(undefined)).toBe(false);
    expect(isPublicTransitMethod('')).toBe(false);
  });
});

describe('shouldShowFallbackWarning', () => {
  it('car + naver_fallback → 경고 X (사례 1.6 회귀 방지)', () => {
    expect(
      shouldShowFallbackWarning({ method: 'car', source: 'naver_fallback' }),
    ).toBe(false);
  });

  it('subway + naver_fallback → 경고 O (ODsay 실패 시)', () => {
    expect(
      shouldShowFallbackWarning({ method: 'subway', source: 'naver_fallback' }),
    ).toBe(true);
  });

  it('bus + naver_fallback → 경고 O', () => {
    expect(
      shouldShowFallbackWarning({ method: 'bus', source: 'naver_fallback' }),
    ).toBe(true);
  });

  it('subway+bus + naver_fallback → 경고 O', () => {
    expect(
      shouldShowFallbackWarning({ method: 'subway+bus', source: 'naver_fallback' }),
    ).toBe(true);
  });

  it('subway + odsay (정상 source) → 경고 X', () => {
    expect(
      shouldShowFallbackWarning({ method: 'subway', source: 'odsay' }),
    ).toBe(false);
  });

  it('source 미지정 → 경고 X', () => {
    expect(shouldShowFallbackWarning({ method: 'subway' })).toBe(false);
  });

  it('downgrade된 경우 (subway → walk) → 경고 X (별도 isDowngraded 분기에서 처리)', () => {
    expect(
      shouldShowFallbackWarning({
        method: 'subway',
        source: 'naver_fallback',
        _downgraded_from: 'subway',
      }),
    ).toBe(false);
  });

  it('walk + naver_fallback → 경고 X (도보는 traffic API 무관)', () => {
    expect(
      shouldShowFallbackWarning({ method: 'walk', source: 'naver_fallback' }),
    ).toBe(false);
  });

  it('null/undefined transit → 경고 X', () => {
    expect(shouldShowFallbackWarning(null)).toBe(false);
    expect(shouldShowFallbackWarning(undefined)).toBe(false);
  });

  // PR #(fix/plan-result-bughunt) #4 — deny-by-default 전환 후 회귀 방지
  // blind_25_no_coords: 좌표 없어서 25분 고정값 사용 — 실측 데이터 없음 → 경고 O
  it('subway + blind_25_no_coords → 경고 O (좌표 없어 25분 고정값, RouteAgent L1852)', () => {
    expect(
      shouldShowFallbackWarning({ method: 'subway', source: 'blind_25_no_coords' }),
    ).toBe(true);
  });

  it('bus + blind_25_no_coords → 경고 O', () => {
    expect(
      shouldShowFallbackWarning({ method: 'bus', source: 'blind_25_no_coords' }),
    ).toBe(true);
  });

  // cache: 검증된 캐시는 신뢰 source → 경고 X
  it('subway + cache → 경고 X (검증된 캐시)', () => {
    expect(
      shouldShowFallbackWarning({ method: 'subway', source: 'cache' }),
    ).toBe(false);
  });

  // tmap: 실측 API → 신뢰 source → 경고 X
  it('subway + tmap → 경고 X (실측 TMAP API)', () => {
    expect(
      shouldShowFallbackWarning({ method: 'subway', source: 'tmap' }),
    ).toBe(false);
  });

  // car + blind_25_no_coords → 경고 X (개인 차량은 isPublicTransitMethod false)
  it('car + blind_25_no_coords → 경고 X (개인 차량 모드)', () => {
    expect(
      shouldShowFallbackWarning({ method: 'car', source: 'blind_25_no_coords' }),
    ).toBe(false);
  });

  // gemini source — 추정값 → 경고 O
  it('subway + gemini → 경고 O (Gemini 추정값)', () => {
    expect(
      shouldShowFallbackWarning({ method: 'subway', source: 'gemini' }),
    ).toBe(true);
  });
});
