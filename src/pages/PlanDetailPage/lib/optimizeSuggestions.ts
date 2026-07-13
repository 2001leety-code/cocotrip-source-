/**
 * UIUX 가이드 P4 'Edit & Optimize' — 최적화 제안 (Time / Transport / Walking), 2026-07-13.
 *
 * 정직 원칙: 전부 plan 의 실데이터에서만 파생 —
 *  - Time: stop 실좌표(lat/lng, RouteAgent 지오코딩)로 방문 순서 총 이동거리 비교.
 *    적용 시 기존 reorder → _stale → /api/recalc-transit 파이프라인이 실측으로 재계산.
 *  - Walking: transit_from_prev.total_walk_m (RouteAgent 실측) 하루 합산.
 *  - Transport: transfers (실측) 하루 합산.
 * 추정·환각 수치 없음. 좌표 없는 stop 이 끼어 있으면 Time 제안 자체를 포기(오제안 방지).
 *
 * 순서 제약: lodging/travel/airport stop(B-10 bookend·도시 간 이동)은 위치 고정,
 * 첫 stop 도 고정(당일 출발점) — 사이의 관광 stop 만 재배열 후보.
 * 순수 모듈 (React/firebase 무접촉) — vitest 직접 테스트.
 */

export interface OptimizeStopLike {
  category?: string;
  lat?: number;
  lng?: number;
  transit_from_prev?: {
    transfers?: number;
    total_walk_m?: number;
    est_min?: number;
    est_fare_krw?: number;
  } | null;
}

// 임계값 — 미미한 개선(재계산 비용 대비)엔 제안하지 않음.
const TIME_MIN_SAVING_PCT = 15;   // 경로 거리 15% 이상 단축
const TIME_MIN_SAVING_KM = 0.8;   // 절대 0.8km 이상 단축
const WALK_DAY_M_MIN = 2500;      // 하루 도보 2.5km+ (~36분)
const TRANSFERS_DAY_MIN = 5;      // 하루 환승 5회+
const MAX_FREE_BRUTE = 6;         // 완전탐색 상한 (6! = 720)

const FIXED_CATEGORIES = new Set(['lodging', 'travel', 'airport']);

function haversineKm(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6371;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLng = ((bLng - aLng) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((aLat * Math.PI) / 180) * Math.cos((bLat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

function hasCoords(s: OptimizeStopLike): boolean {
  return typeof s.lat === 'number' && typeof s.lng === 'number' && Number.isFinite(s.lat) && Number.isFinite(s.lng);
}

function pathKm(stops: OptimizeStopLike[], order: number[]): number {
  let total = 0;
  for (let i = 1; i < order.length; i++) {
    const a = stops[order[i - 1]];
    const b = stops[order[i]];
    total += haversineKm(a.lat!, a.lng!, b.lat!, b.lng!);
  }
  return total;
}

function permutations(arr: number[]): number[][] {
  if (arr.length <= 1) return [arr];
  const out: number[][] = [];
  arr.forEach((v, i) => {
    const rest = [...arr.slice(0, i), ...arr.slice(i + 1)];
    permutations(rest).forEach((p) => out.push([v, ...p]));
  });
  return out;
}

export interface TimeSuggestion {
  type: 'time';
  /** stops 인덱스의 새 방문 순서 (기존 인덱스 기준 permutation) */
  proposedOrder: number[];
  currentKm: number;
  proposedKm: number;
  savingPct: number;
}

/**
 * 방문 순서 최적화 제안. 조건:
 *  - 모든 stop 에 실좌표 존재 (하나라도 없으면 null — 부분 좌표로 오제안 금지)
 *  - 자유 stop(고정 카테고리·첫 stop 제외) ≥ 3
 *  - 개선폭 ≥ 15% AND ≥ 0.8km
 * 자유 stop ≤ 6 이면 완전탐색(최적해), 그 이상은 nearest-neighbor 근사.
 */
export function suggestTimeOrder(stops: OptimizeStopLike[] | null | undefined): TimeSuggestion | null {
  if (!Array.isArray(stops) || stops.length < 4) return null;
  if (!stops.every(hasCoords)) return null;

  const freeIdx: number[] = [];
  const slots: number[] = []; // 자유 stop 이 들어가는 위치들
  stops.forEach((s, i) => {
    const fixed = i === 0 || FIXED_CATEGORIES.has(String(s.category || ''));
    if (!fixed) {
      freeIdx.push(i);
      slots.push(i);
    }
  });
  if (freeIdx.length < 3) return null;

  const currentOrder = stops.map((_, i) => i);
  const currentKm = pathKm(stops, currentOrder);
  if (currentKm <= 0) return null;

  const buildOrder = (freePerm: number[]): number[] => {
    const order = [...currentOrder];
    slots.forEach((slot, k) => { order[slot] = freePerm[k]; });
    return order;
  };

  let bestOrder = currentOrder;
  let bestKm = currentKm;

  if (freeIdx.length <= MAX_FREE_BRUTE) {
    for (const perm of permutations(freeIdx)) {
      const order = buildOrder(perm);
      const km = pathKm(stops, order);
      if (km < bestKm) { bestKm = km; bestOrder = order; }
    }
  } else {
    // greedy nearest-neighbor: 슬롯을 앞에서부터 채우며, 직전 위치(고정 stop 또는
    // 이미 채운 슬롯)의 stop 에서 가장 가까운 자유 stop 을 선택. 슬롯이 비연속
    // (사이에 고정 stop)이어도 order[slot-1] 은 항상 확정 상태.
    const order = [...currentOrder];
    const remaining = new Set(freeIdx);
    slots.forEach((slot) => {
      const prev = stops[order[slot - 1]];
      let nearest = -1;
      let nearestKm = Infinity;
      remaining.forEach((idx) => {
        const km = haversineKm(prev.lat!, prev.lng!, stops[idx].lat!, stops[idx].lng!);
        if (km < nearestKm) { nearestKm = km; nearest = idx; }
      });
      remaining.delete(nearest);
      order[slot] = nearest;
    });
    const km = pathKm(stops, order);
    if (km < bestKm) { bestKm = km; bestOrder = order; }
  }

  const savingKm = currentKm - bestKm;
  const savingPct = (savingKm / currentKm) * 100;
  if (savingPct < TIME_MIN_SAVING_PCT || savingKm < TIME_MIN_SAVING_KM) return null;

  return {
    type: 'time',
    proposedOrder: bestOrder,
    currentKm: Math.round(currentKm * 10) / 10,
    proposedKm: Math.round(bestKm * 10) / 10,
    savingPct: Math.round(savingPct),
  };
}

export interface WalkingSuggestion {
  type: 'walking';
  totalWalkM: number;
  totalWalkMin: number; // 70m/분 경험칙 (routeInsight 와 동일)
}

export function suggestWalking(stops: OptimizeStopLike[] | null | undefined): WalkingSuggestion | null {
  if (!Array.isArray(stops)) return null;
  const totalWalkM = stops.reduce((sum, s) => sum + (s.transit_from_prev?.total_walk_m || 0), 0);
  if (totalWalkM < WALK_DAY_M_MIN) return null;
  return { type: 'walking', totalWalkM, totalWalkMin: Math.round(totalWalkM / 70) };
}

export interface TransportSuggestion {
  type: 'transport';
  totalTransfers: number;
  totalFareKrw: number;
}

export function suggestTransport(stops: OptimizeStopLike[] | null | undefined): TransportSuggestion | null {
  if (!Array.isArray(stops)) return null;
  const totalTransfers = stops.reduce((sum, s) => sum + (s.transit_from_prev?.transfers || 0), 0);
  if (totalTransfers < TRANSFERS_DAY_MIN) return null;
  const totalFareKrw = stops.reduce((sum, s) => sum + (s.transit_from_prev?.est_fare_krw || 0), 0);
  return { type: 'transport', totalTransfers, totalFareKrw };
}

export type OptimizeSuggestion = TimeSuggestion | WalkingSuggestion | TransportSuggestion;

/** 하루 stops 의 최적화 제안 묶음 (타입별 최대 1개, time → transport → walking 순). */
export function buildOptimizeSuggestions(stops: OptimizeStopLike[] | null | undefined): OptimizeSuggestion[] {
  const out: OptimizeSuggestion[] = [];
  const time = suggestTimeOrder(stops);
  if (time) out.push(time);
  const transport = suggestTransport(stops);
  if (transport) out.push(transport);
  const walking = suggestWalking(stops);
  if (walking) out.push(walking);
  return out;
}
