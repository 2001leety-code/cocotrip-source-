// 구간 길찾기 딥링크 회귀 테스트 (2026-07-19).
// 딥링크는 API 키·과금이 없는 URL 이다. 좌표가 없는 구형 플랜에서 깨진 링크를
// 노출하지 않는 것(=null 반환)이 핵심 계약.
import { describe, it, expect } from 'vitest';
import { buildTransitDirectionsLinks } from '../../src/pages/PlanDetailPage/components/TransitArrow';

const withPoints = {
  steps_detail: [
    { mode: 'walk', fromPoint: { lat: 37.5665, lng: 126.9784, name: '출발지' } },
    { mode: 'subway', fromPoint: { lat: 37.5044, lng: 127.0489, name: '선릉' }, toPoint: { lat: 37.5133, lng: 127.1001, name: '잠실' } },
  ],
};

describe('buildTransitDirectionsLinks', () => {
  it('구글맵은 transit 모드 딥링크를 만든다 (키 불필요)', () => {
    const l = buildTransitDirectionsLinks(withPoints, '잠실역')!;
    expect(l.google).toBe(
      'https://www.google.com/maps/dir/?api=1&origin=37.5665,126.9784&destination=37.5133,127.1001&travelmode=transit',
    );
    expect(l.google).not.toMatch(/key=|api_key/i); // 과금 키가 섞이면 안 됨
  });

  it('네이버는 lng,lat 순서 + 지점명을 인코딩한다', () => {
    const l = buildTransitDirectionsLinks(withPoints, '잠실역')!;
    expect(l.naver).toContain('126.9784,37.5665');   // 네이버는 경도,위도 순
    expect(l.naver).toContain('127.1001,37.5133');
    expect(l.naver).toContain(encodeURIComponent('잠실'));
    expect(l.naver).toContain('/transit');
  });

  it('도착 좌표가 없으면 anchor 로 폴백한다', () => {
    const l = buildTransitDirectionsLinks({
      steps_detail: [{ mode: 'walk', fromPoint: { lat: 37.5, lng: 127.0, name: 'A' } }],
      anchor_lat: 37.55, anchor_lng: 127.05, anchor_label: '호텔',
    }, undefined)!;
    expect(l.google).toContain('destination=37.55,127.05');
  });

  it('좌표가 없는 구형 플랜은 null — 깨진 버튼을 만들지 않는다', () => {
    expect(buildTransitDirectionsLinks({ steps_detail: [{ mode: 'bus' }] }, 'X')).toBeNull();
    expect(buildTransitDirectionsLinks({}, 'X')).toBeNull();
  });

  it('좌표가 숫자가 아니면 null (NaN/문자열 방어)', () => {
    expect(buildTransitDirectionsLinks({
      steps_detail: [{ mode: 'bus', fromPoint: { lat: NaN, lng: 127 }, toPoint: { lat: '37.5', lng: 127 } }],
    }, 'X')).toBeNull();
  });
});
