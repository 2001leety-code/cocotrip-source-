/**
 * PR2 r10: 저장된 플랜에서 "같은 숙소로 합친 표식의 이동 null" 과 "경로 실패의 이동 null" 을 구분한다.
 *   RouteAgent 가 병합한 stop 에 `same_lodging_as_prev: true` 를 남긴다(공개 투영 스키마 밖 — 외부 노출 없음).
 *   읽는 쪽(recalc-transit 재계산·qualityMetrics 경로 실패 집계)은 이 함수로 판정 — 편집으로 앞 stop 이 바뀌어
 *   앞이 숙소가 아니거나 다른 숙소(이름 다름·좌표 50m 밖)면 표식이 있어도 병합이 아니다(자동 해제).
 */
export const SAME_LODGING_FIELD = 'same_lodging_as_prev';

const isLodging = (s) => String(s?.category || '').toLowerCase() === 'lodging';
const nameKey = (s) => String(s?.name || s?.display_name || '').trim().toLowerCase().replace(/\s+/g, ' ');
const coord = (s) => {
  const ok = (v) => v !== null && v !== undefined && v !== '' && Number.isFinite(Number(v));
  return ok(s?.lat) && ok(s?.lng) ? { lat: Number(s.lat), lng: Number(s.lng) } : null;
};
function distanceM(a, b) {
  const rad = (d) => (d * Math.PI) / 180;
  const h = Math.sin(rad(b.lat - a.lat) / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lng - a.lng) / 2) ** 2;
  return 2 * 6371000 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

/** stops[i] 가 앞 숙소와 합친 같은 숙소 표식인가(표식 + 지금도 같은 숙소). */
export function isMergedLodgingStop(stops, i) {
  const cur = stops?.[i];
  const prev = i > 0 ? stops[i - 1] : null;
  if (!cur || cur[SAME_LODGING_FIELD] !== true || !prev || !isLodging(cur) || !isLodging(prev)) return false;
  const a = coord(prev), b = coord(cur);
  if (a && b) return distanceM(a, b) <= 50;
  return !!nameKey(prev) && nameKey(prev) === nameKey(cur);
}
