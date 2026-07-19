// 실경로 세그먼트 공용 유틸 회귀 테스트 (2026-07-19).
// 플랜 상세와 코스 빌더가 같은 변환을 쓰므로 여기서 계약을 고정한다.
// 핵심: 평탄 배열(Firestore 중첩배열 금지 정책) 복원 + geometry 없으면 세그먼트 0(직선 폴백).
import { describe, it, expect } from 'vitest';
import { chunkPath, stepsToSegments } from '../../src/lib/routeSegments';

describe('chunkPath — 평탄 배열 복원', () => {
  it('[lat,lng,lat,lng] → 좌표쌍', () => {
    expect(chunkPath([37.5, 127.0, 37.6, 127.1])).toEqual([[37.5, 127.0], [37.6, 127.1]]);
  });

  it('구형 중첩 배열도 그대로 받아준다 (하위호환)', () => {
    expect(chunkPath([[37.5, 127.0], [37.6, 127.1]])).toEqual([[37.5, 127.0], [37.6, 127.1]]);
  });

  it('점이 1개뿐이거나 비면 null — 선을 못 그리므로 폴백시킨다', () => {
    expect(chunkPath([37.5, 127.0])).toBeNull();
    expect(chunkPath([])).toBeNull();
    expect(chunkPath(undefined)).toBeNull();
    expect(chunkPath('nope')).toBeNull();
  });

  it('숫자가 아닌 값이 섞이면 null (NaN 좌표 방어)', () => {
    expect(chunkPath([37.5, 'x', 37.6, 127.1])).toBeNull();
  });
});

describe('stepsToSegments — 지도 세그먼트 변환', () => {
  const steps = [
    { mode: 'walk', path: [37.5, 127.0, 37.51, 127.01] },
    {
      mode: 'subway', line: '수도권2호선', routeColor: '#009D3E',
      path: [37.51, 127.01, 37.52, 127.02, 37.53, 127.03],
      fromPoint: { lat: 37.51, lng: 127.01, name: '선릉' },
    },
    { mode: 'bus', busNo: '472', routeColor: '#0068B7', path: [37.53, 127.03, 37.54, 127.04], fromPoint: { lat: 37.53, lng: 127.03, name: '서울광장' } },
  ];

  it('도보는 점선·회색이고 라벨/승차핀이 없다', () => {
    const [walk] = stepsToSegments(steps);
    expect(walk.dashed).toBe(true);
    expect(walk.label).toBeNull();
    expect(walk.board).toBeNull();
  });

  it('지하철·버스는 노선 공식색 실선 + 수단칩 + 승차핀', () => {
    const segs = stepsToSegments(steps);
    const subway = segs[1], bus = segs[2];
    expect(subway.color).toBe('#009D3E');
    expect(subway.dashed).toBe(false);
    expect(subway.label).toBe('🚇 수도권2호선');
    expect(subway.board).toMatchObject({ name: '선릉' });
    expect(bus.label).toBe('🚌 472');
    expect(bus.color).toBe('#0068B7');
  });

  it('routeColor 가 없으면 수단 기본색으로 떨어진다', () => {
    const [seg] = stepsToSegments([{ mode: 'bus', busNo: '100', path: [37.5, 127.0, 37.6, 127.1] }]);
    expect(seg.color).toBe('#2563EB');
  });

  it('path 없는 step 은 세그먼트를 만들지 않는다 (호출부가 직선 폴백)', () => {
    expect(stepsToSegments([{ mode: 'bus', busNo: '472' }])).toEqual([]);
    expect(stepsToSegments(undefined)).toEqual([]);
  });
});
