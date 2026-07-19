// routeSegments — 실경로 세그먼트 공용 유틸 (2026-07-19).
//
// 플랜 상세(DayRouteMap)와 코스 빌더(CourseMiniMap)가 **같은 데이터 형태**를 쓰도록
// 한 곳에 모았다. 백엔드(_tmap_helper)가 저장/반환하는 steps_detail 이 입력이다.
//   · path 는 **평탄 배열** [lat,lng,lat,lng, …]
//     (Firestore 가 중첩 배열을 저장하지 못해 2026-07-19 prod 장애가 났다. 그 정책의 산물.)
//   · routeColor = 노선 공식 색, fromPoint = 승차 지점(이름+좌표)

export interface RouteSegment {
  path: [number, number][];
  color: string;
  dashed: boolean;
  label: string | null;                                        // "🚌 472" / "🚇 2호선"
  board: { lat: number; lng: number; name: string } | null;    // 승차 지점
}

export interface TransitStepLike {
  mode?: string;
  path?: number[] | [number, number][];
  routeColor?: string;
  busNo?: string;
  line?: string;
  lineKo?: string;
  fromPoint?: { lat?: number; lng?: number; name?: string | null } | null;
}

/** 수단별 기본색 — TMAP routeColor 가 있으면 그쪽(노선 공식 색)을 우선한다. */
export const MODE_COLOR: Record<string, string> = { walk: '#8B93A7', bus: '#2563EB', subway: '#7C5CFC' };

const isFiniteNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/**
 * 평탄 배열 [lat,lng, …] → 좌표쌍 [[lat,lng], …].
 * 구형(중첩) 형태로 저장된 문서도 그대로 받아준다(하위호환).
 */
export function chunkPath(p: unknown): [number, number][] | null {
  if (!Array.isArray(p) || p.length < 4) {
    if (Array.isArray(p) && p.length >= 2
      && p.every((pt) => Array.isArray(pt) && pt.length === 2 && isFiniteNum(pt[0]) && isFiniteNum(pt[1]))) {
      return p as [number, number][];
    }
    return null;
  }
  if (!p.every(isFiniteNum)) {
    if (p.every((pt) => Array.isArray(pt) && pt.length === 2 && isFiniteNum(pt[0]) && isFiniteNum(pt[1]))) {
      return p as unknown as [number, number][];
    }
    return null;
  }
  const out: [number, number][] = [];
  for (let i = 0; i + 1 < p.length; i += 2) out.push([p[i] as number, p[i + 1] as number]);
  return out.length >= 2 ? out : null;
}

/** steps_detail 배열 → 지도에 그릴 세그먼트. path 없는 step 은 건너뛴다(호출부가 직선 폴백). */
export function stepsToSegments(steps: TransitStepLike[] | undefined): RouteSegment[] {
  const segs: RouteSegment[] = [];
  for (const st of steps || []) {
    const path = chunkPath(st.path);
    if (!path) continue;
    const mode = String(st.mode || '').toLowerCase();
    const isWalk = mode.includes('walk');
    const line = st.lineKo || st.line || '';
    segs.push({
      path,
      color: st.routeColor || MODE_COLOR[isWalk ? 'walk' : mode.includes('bus') ? 'bus' : 'subway'] || '#7C5CFC',
      dashed: isWalk,
      label: isWalk ? null : (st.busNo ? `🚌 ${st.busNo}` : line ? `🚇 ${line}` : null),
      board: (!isWalk && st.fromPoint && isFiniteNum(st.fromPoint.lat) && isFiniteNum(st.fromPoint.lng))
        ? { lat: st.fromPoint.lat, lng: st.fromPoint.lng, name: st.fromPoint.name || '' }
        : null,
    });
  }
  return segs;
}
