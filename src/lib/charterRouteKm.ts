/**
 * 차터 경유지(waypoint) 경로기반 가격 — 프론트 route-km 해석 (FEATURE_CHARTER_WAYPOINTS).
 *
 * 프론트는 서버 TMAP_APP_KEY 를 못 쓰므로 /api/charter-route-km 로 좌표를 보내 실제 도로 주행거리(km)를
 * 받아 견적을 표시한다. 실제 청구는 createPaypalOrder 가 동일 좌표(body.routeCoords)로 TMAP km 를 다시
 * 재조회해 재계산(P311). 둘 다 helper 의 trafficInfo:'N' 결정론 → 같은 좌표면 같은 km → 표시가==청구가.
 *
 * 🔴 discountFlags.ts 와 동일 규율: 멀티데이/transfer 견적을 화면에 표시하는 **모든** 호출처
 *   (resolveProductType · useQuoteCalculator · MultiDayReceipt · TransferReceipt)는 routeKm 을 넘겨야
 *   한다. 안 넘기면 표시=matrix 직선가, 청구=TMAP 경로가 → 표시≠청구.
 */
import { useEffect, useState } from 'react';
import type { WizardState } from '@/components/charter/types';

/** 프론트 플래그 — VITE_FEATURE_CHARTER_WAYPOINTS. 백엔드 FEATURE_CHARTER_WAYPOINTS 와 **쌍**(둘 다 ON). */
export function charterWaypointsEnabled(): boolean {
  return import.meta.env.VITE_FEATURE_CHARTER_WAYPOINTS === 'true';
}

export interface RouteCoord { lng: number; lat: number; }
export interface RouteCoords { origin: RouteCoord; dest: RouteCoord; waypoints: RouteCoord[]; }

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const validPt = (p: { lng?: number; lat?: number } | null | undefined): p is RouteCoord =>
  !!p && isNum(p.lng) && isNum(p.lat) && p.lat >= -90 && p.lat <= 90 && p.lng >= -180 && p.lng <= 180;

/**
 * WizardState → routeCoords. 플래그 ON + 경유지 1개 이상 + origin/dest 좌표까지 있어야 반환.
 * 하나라도 없으면 null → 호출처는 기존 matrix km 경로로 폴백(무경유 예약 = 무영향).
 */
export function routeCoordsFromState(state: WizardState): RouteCoords | null {
  if (!charterWaypointsEnabled()) return null;
  const wps = (state.waypoints || [])
    .filter((w) => validPt(w))
    .slice(0, 5)
    .map((w) => ({ lng: w.lng, lat: w.lat }));
  if (wps.length === 0) return null; // 경유지 없으면 경로 계산 불필요
  const origin = isNum(state.originLng) && isNum(state.originLat) ? { lng: state.originLng, lat: state.originLat } : null;
  const dest = isNum(state.destLng) && isNum(state.destLat) ? { lng: state.destLng, lat: state.destLat } : null;
  if (!validPt(origin) || !validPt(dest)) return null; // 출발/도착 좌표 필요(AddressAutocomplete 확정분)
  return { origin, dest, waypoints: wps };
}

/** 좌표 시그니처 — 캐시 키 + 좌표 변경 감지(effect dep)용. 소수 5자리(≈1m)로 안정화. */
export function routeCoordsSignature(rc: RouteCoords): string {
  const p = (c: RouteCoord) => `${c.lng.toFixed(5)},${c.lat.toFixed(5)}`;
  return [p(rc.origin), ...rc.waypoints.map(p), p(rc.dest)].join('_');
}

// 같은 좌표는 한 번만 조회(견적/결제 화면 재렌더 시 TMAP 재호출 방지). null = 조회 실패도 캐시.
const _cache = new Map<string, number | null>();

/** /api/charter-route-km 호출 → km(성공) | null(실패). 결과 캐시. */
export async function fetchCharterRouteKm(rc: RouteCoords): Promise<number | null> {
  const key = routeCoordsSignature(rc);
  if (_cache.has(key)) return _cache.get(key) || null;
  try {
    const res = await fetch('/api/charter-route-km', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ routeCoords: rc }),
    });
    const json = await res.json().catch(() => null);
    const km = res.ok && json?.ok && isNum(json?.data?.km) && json.data.km > 0 ? json.data.km : null;
    _cache.set(key, km);
    return km;
  } catch {
    _cache.set(key, null);
    return null;
  }
}

export interface CharterRouteKmResult {
  routeKm: number | null;     // 경로 km (경유지 반영). null = 미해석/실패/무경유.
  routeCoords: RouteCoords | null; // 결제 body 로 보낼 좌표(있으면 waypoints 활성).
  loading: boolean;           // 조회 중 — 결제 버튼 대기용.
  failed: boolean;            // 조회 실패 — 경유지 있는데 km 못 받음(결제 차단 신호).
}

/**
 * React 훅 — 경유지 좌표가 바뀔 때 /api/charter-route-km 조회. 좌표 없으면 즉시 null(무영향).
 * 결과는 견적 표시(useQuoteCalculator·resolveProductType)와 결제 body(routeCoords) 양쪽에 쓴다.
 */
export function useCharterRouteKm(state: WizardState): CharterRouteKmResult {
  const rc = routeCoordsFromState(state);
  const key = rc ? routeCoordsSignature(rc) : null;
  const [routeKm, setRouteKm] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (!rc || !key) { setRouteKm(null); setLoading(false); setFailed(false); return; }
    if (_cache.has(key)) {
      const km = _cache.get(key) || null;
      setRouteKm(km); setLoading(false); setFailed(km == null);
      return;
    }
    setLoading(true); setFailed(false);
    fetchCharterRouteKm(rc).then((km) => {
      if (cancelled) return;
      setRouteKm(km); setLoading(false); setFailed(km == null);
    });
    return () => { cancelled = true; };
    // key 만 dep — 좌표 시그니처가 같으면 재조회 안 함.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return { routeKm, routeCoords: rc, loading, failed };
}
