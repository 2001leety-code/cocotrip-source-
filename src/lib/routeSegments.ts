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

// ── (2026-07-28) 구간별 직선 폴백 ─────────────────────────────────────────────
// 도보 구간은 백엔드가 좌표(path)를 아예 안 만든다:
//   · _tmap_helper.js  — 300m 미만은 TMAP 호출 없이 도보 step 합성 (path 없음)
//   · RouteAgent.js    — 도보 override / 마지막 구간 합성 (path 없음)
// 이전 렌더 코드는 "실경로가 하나라도 있으면 실경로만, 하나도 없으면 전부 직선"이라
// 지하철+도보가 섞인 날에는 **도보 구간만 통째로 안 그려져 지도에 구멍**이 났다.
// 여기서 구간 단위로 메워 어떤 조합이든 선이 끊기지 않게 한다.

/** 지도에 찍을 지점 + 이 지점으로 **들어오는** 구간(leg)의 정보. */
export interface RoutePoint {
  lat: number;
  lng: number;
  /** 이 지점으로 오는 구간의 실경로 step 들. 없거나 좌표가 없으면 직선으로 폴백. */
  legSteps?: TransitStepLike[];
  /** 이 구간이 힘든 이동인지 — 폴백 직선 색상용(P5 범례와 동일 앰버). */
  legHard?: boolean;
}

/** 실경로 좌표가 없는 구간을 메우는 직선의 색 (힘든 구간은 앰버). */
const FALLBACK_HARD_COLOR = '#FFB020';

/**
 * 지점 열 → 그릴 세그먼트 열. 구간에 실경로가 없으면 직선(점선)으로 메운다.
 *
 * @returns segments = 그릴 것 전부 / realLegs = 실좌표가 있던 구간 수
 *          (realLegs === 0 이면 호출부가 "실제 경로 보기" 버튼을 노출한다)
 */
export function pointsToSegments(points: RoutePoint[]): { segments: RouteSegment[]; realLegs: number } {
  const segments: RouteSegment[] = [];
  let realLegs = 0;
  let prev: [number, number] | null = null;

  for (const p of points || []) {
    if (!isFiniteNum(p?.lat) || !isFiniteNum(p?.lng)) continue;
    const here: [number, number] = [p.lat, p.lng];
    const real = stepsToSegments(p.legSteps);
    if (real.length > 0) {
      segments.push(...real);
      realLegs += 1;
    } else if (prev) {
      segments.push({
        path: [prev, here],
        color: p.legHard ? FALLBACK_HARD_COLOR : MODE_COLOR.walk,
        dashed: true,
        label: null,
        board: null,
      });
    }
    prev = here;
  }
  return { segments, realLegs };
}
