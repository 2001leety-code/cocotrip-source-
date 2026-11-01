/**
 * PR2 r8/r9: 같은 지점 판정 — 서버(RouteAgent)가 같은 숙소 출발·복귀 표식을 합치면 그 stop 의 이동정보는 null 이다.
 *   화면(TransitFallback)과 PDF(pdfGenerator 의 이동 대체 안내·일일 합계)가 이 한 함수로 "이동 없음"을 판정한다(한쪽만 고침 재발 방지).
 *   기준 50m = 서버 50m 좌표 병합(RouteAgent.isSameLodgingMarker)과 같은 값.
 */
export const SAME_SPOT_M = 50;

/** 두 좌표 사이 거리(m, haversine). */
export function distanceM(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const φ1 = (lat1 * Math.PI) / 180;
  const φ2 = (lat2 * Math.PI) / 180;
  const Δφ = ((lat2 - lat1) * Math.PI) / 180;
  const Δλ = ((lng2 - lng1) * Math.PI) / 180;
  const a = Math.sin(Δφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
  return 2 * 6371000 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** 같은 지점(≤50m)인가 — 반올림한 미터 기준(화면·PDF 표시 값과 같은 반올림). */
export function isSameSpot(lat1: number, lng1: number, lat2: number, lng2: number): boolean {
  return Math.round(distanceM(lat1, lng1, lat2, lng2)) <= SAME_SPOT_M;
}
