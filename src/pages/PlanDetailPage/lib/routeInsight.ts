/**
 * UIUX 가이드 P5 'AI Route Insight' — 세그먼트 단위 "힘든 이동" 감지 (2026-07-13).
 * day 단위 CharterCTA(3환승+/downgrade/120분+)와 별개로, 개별 구간의 피로도를 판정해
 * 해당 구간 바로 아래에 차터 제안 카드를 노출한다. RouteAgent 실측 필드만 사용:
 *   transfers(환승 수) · total_walk_m(도보 미터) · est_min(소요 분) — 추정·환각 없음.
 * 하루 최대 1개(최고 점수 구간만) — 스팸 방지.
 */

export type TiringReason = 'transfers' | 'walk' | 'duration';

interface TransitLike {
  method?: string;
  mode?: string;
  transfers?: number;
  total_walk_m?: number;
  est_min?: number;
}

interface StopLike {
  transit_from_prev?: TransitLike | null;
}

// 임계값 — 가이드 p.5 시나리오("버스 환승 + 15분 오르막") 기준.
const TRANSFERS_MIN = 2;   // 환승 2회 이상
const WALK_M_MIN = 900;    // 도보 900m+ (~13분)
const DURATION_MIN = 60;   // 대중교통 60분 이상

const PUBLIC_MODES = new Set(['subway', 'bus', 'train', 'public_transit', 'arex_express']);

/** 대중교통 구간만 판정 대상 (walk/car/taxi 는 차터 제안 무의미). */
function isPublicTransit(t: TransitLike): boolean {
  return PUBLIC_MODES.has(String(t.mode || t.method || ''));
}

export function segmentTiringReasons(t: TransitLike | null | undefined): TiringReason[] {
  if (!t || !isPublicTransit(t)) return [];
  const reasons: TiringReason[] = [];
  if ((t.transfers || 0) >= TRANSFERS_MIN) reasons.push('transfers');
  if ((t.total_walk_m || 0) >= WALK_M_MIN) reasons.push('walk');
  if ((t.est_min || 0) >= DURATION_MIN) reasons.push('duration');
  return reasons;
}

function score(t: TransitLike): number {
  return (t.transfers || 0) * 30 + (t.total_walk_m || 0) / 30 + Math.max(0, (t.est_min || 0) - 45);
}

export interface TiringSegment {
  /** stops 배열 내 인덱스 — 이 stop 의 transit_from_prev 가 힘든 구간 */
  index: number;
  reasons: TiringReason[];
  transfers: number;
  walkMin: number;
  estMin: number;
}

/** 하루 stops 에서 가장 힘든 대중교통 구간 1개(임계 초과분만). 없으면 null. */
export function findMostTiringSegment(stops: StopLike[] | null | undefined): TiringSegment | null {
  if (!Array.isArray(stops)) return null;
  let best: TiringSegment | null = null;
  let bestScore = -1;
  stops.forEach((s, index) => {
    const t = s?.transit_from_prev;
    const reasons = segmentTiringReasons(t);
    if (reasons.length === 0) return;
    const sc = score(t as TransitLike);
    if (sc > bestScore) {
      bestScore = sc;
      best = {
        index,
        reasons,
        transfers: (t as TransitLike).transfers || 0,
        walkMin: Math.round(((t as TransitLike).total_walk_m || 0) / 70),
        estMin: (t as TransitLike).est_min || 0,
      };
    }
  });
  return best;
}
