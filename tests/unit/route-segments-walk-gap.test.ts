// 회귀 잠금 (2026-07-28) — 도보 구간이 지도에서 사라지던 버그.
//
// 백엔드는 도보 구간에 실좌표(path)를 안 만든다:
//   · api/_tmap_helper.js  — 300m 미만은 TMAP 호출 없이 도보 step 합성
//   · api/_ai_core/agents/RouteAgent.js — 도보 override / 마지막 구간 합성
// 이전 렌더 코드는 "실경로가 하나라도 있으면 실경로만 그린다"라서 지하철+도보가
// 섞인 날은 **도보 구간만 통째로 안 그려져** 지도에 구멍이 났다.
// pointsToSegments 가 구간 단위로 직선을 메우는 것이 그 fix 이며, 이 테스트가 잠금이다.
import { describe, it, expect } from 'vitest';
import { pointsToSegments, MODE_COLOR, type RoutePoint } from '@/lib/routeSegments';

/** 실좌표가 있는 지하철 step (평탄 배열 = Firestore 저장 형태). */
const subwayStep = {
  mode: 'subway',
  line: '2호선',
  path: [37.5, 127.0, 37.51, 127.01, 37.52, 127.02],
  routeColor: '#00A84D',
};

/** 도보 step — 백엔드가 좌표를 안 준다(이 버그의 본체). */
const walkStepNoPath = { mode: 'walk', distance: 180 };

describe('pointsToSegments — 도보 구간 직선 폴백', () => {
  it('지하철+도보가 섞여도 모든 구간이 그려진다 (구멍 없음)', () => {
    const points: RoutePoint[] = [
      { lat: 37.5, lng: 127.0 },                                    // 출발 (들어오는 구간 없음)
      { lat: 37.52, lng: 127.02, legSteps: [subwayStep] },          // 실경로 있음
      { lat: 37.522, lng: 127.023, legSteps: [walkStepNoPath] },    // 좌표 없는 도보
      { lat: 37.525, lng: 127.03 },                                 // steps_detail 자체가 없음
    ];
    const { segments, realLegs } = pointsToSegments(points);

    // 구간 3개 전부 = 지하철 1 + 폴백 2. 이전 코드는 지하철 1개만 그렸다.
    expect(segments).toHaveLength(3);
    expect(realLegs).toBe(1);

    // 폴백 구간은 앞뒤 지점을 정확히 잇는다.
    expect(segments[1].path).toEqual([[37.52, 127.02], [37.522, 127.023]]);
    expect(segments[2].path).toEqual([[37.522, 127.023], [37.525, 127.03]]);
    // 폴백은 도보 스타일(회색 점선).
    expect(segments[1].dashed).toBe(true);
    expect(segments[1].color).toBe(MODE_COLOR.walk);
  });

  it('힘든 구간 폴백은 앰버 (P5 범례 유지)', () => {
    const { segments } = pointsToSegments([
      { lat: 37.5, lng: 127.0 },
      { lat: 37.6, lng: 127.1, legHard: true },
    ]);
    expect(segments).toHaveLength(1);
    expect(segments[0].color).toBe('#FFB020');
  });

  it('실경로가 전무한 구형 플랜은 전 구간 직선 (지도가 비지 않는다)', () => {
    const { segments, realLegs } = pointsToSegments([
      { lat: 37.5, lng: 127.0 },
      { lat: 37.51, lng: 127.01 },
      { lat: 37.52, lng: 127.02 },
    ]);
    expect(realLegs).toBe(0);          // → 호출부가 "실제 경로 보기" 버튼 노출
    expect(segments).toHaveLength(2);
  });

  it('좌표 없는 지점은 건너뛰되 선은 이어진다', () => {
    const { segments } = pointsToSegments([
      { lat: 37.5, lng: 127.0 },
      { lat: NaN, lng: 127.01 },       // 좌표 깨진 stop
      { lat: 37.52, lng: 127.02 },
    ] as RoutePoint[]);
    expect(segments).toHaveLength(1);
    expect(segments[0].path).toEqual([[37.5, 127.0], [37.52, 127.02]]);
  });

  it('지점이 1개 이하면 그릴 것이 없다', () => {
    expect(pointsToSegments([{ lat: 37.5, lng: 127.0 }]).segments).toHaveLength(0);
    expect(pointsToSegments([]).segments).toHaveLength(0);
  });
});
