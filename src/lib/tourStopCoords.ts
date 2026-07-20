// ─────────────────────────────────────────────────────────────────────────────
// tourStopCoords.ts — 투어 stop 좌표의 "쓸 수 있는 값인가" 판정 한 곳.
//
// 같은 판정을 어드민(입력 검증·핀 개수 표시)과 손님 화면(TourStopMap 이 지도를 그릴지)이
// 각자 들고 있으면 한쪽만 고쳐져 "어드민엔 핀 2개인데 손님 화면엔 지도가 없다" 같은 어긋남이 난다.
// 판정은 여기서만 한다.
// ─────────────────────────────────────────────────────────────────────────────

/** 좌표가 실제로 지도에 찍힐 수 있는 값인지. (undefined·빈칸·NaN 전부 false, 0 은 유효) */
export function hasStopCoords(stop: { lat?: number; lng?: number }): boolean {
  return Number.isFinite(stop.lat) && Number.isFinite(stop.lng);
}

/**
 * 좌표 입력창 문자열 → 저장할 값. 비우면 undefined(= 좌표 없음).
 * 🔴 undefined 는 Firestore 가 거부하지만 저장 경로의 stripUndefined 가 털어낸다
 *    (`@/lib/firestore-safe`). 여기서 0 으로 대체하면 아프리카 앞바다에 핀이 찍힌다.
 */
export function parseCoordInput(raw: string): number | undefined {
  if (raw.trim() === '') return undefined;
  const n = Number(raw);
  return Number.isFinite(n) ? n : undefined;
}

/** 지도는 핀이 2개 이상일 때만 의미가 있다(1개면 CourseMiniMap 이 스스로 null 을 반환). */
export const MIN_STOPS_FOR_MAP = 2;

/** 좌표를 가진 stop 개수 — 어드민 진행 표시와 지도 렌더 판단이 같은 수를 본다. */
export function countStopsWithCoords(stops: Array<{ lat?: number; lng?: number }>): number {
  return stops.filter(hasStopCoords).length;
}
