/**
 * PR2 r10→r11: 같은 숙소 판정 — 한 모듈에서 RouteAgent(생성 때 병합)·recalc-transit(편집 후 재계산)·qualityMetrics(경로 실패 집계)가 공유.
 *   RouteAgent 가 병합한 stop 에 `same_lodging_as_prev: true` 를 남긴다(공개 투영 스키마 밖 — 외부 노출 없음).
 *   저장 뒤 읽는 쪽은 그 표식을 "생성 때 병합했음" 신호로만 쓰고, **같은 규칙으로 다시 확인**해 둘 다 참일 때만 병합(이동 0).
 *   편집으로 앞 stop 이 바뀌어 규칙이 거짓이면 표식이 있어도 병합 아님.
 */
export const SAME_LODGING_FIELD = 'same_lodging_as_prev';

const cat = (s) => String(s?.category || '').toLowerCase();
const normKey = (v) => String(v || '').trim().toLowerCase().replace(/\s+/g, ' ');
const lodgingNameKey = (p) => normKey(p?.name || p?.display_name);
const coordOf = (p) => {
  const ok = (v) => v !== null && v !== undefined && v !== '' && Number.isFinite(Number(v));
  return ok(p?.lat) && ok(p?.lng) ? { lat: Number(p.lat), lng: Number(p.lng) } : null;
};
function distanceM(a, b) {
  const rad = (d) => (d * Math.PI) / 180;
  const h = Math.sin(rad(b.lat - a.lat) / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lng - a.lng) / 2) ** 2;
  return 2 * 6371000 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

/**
 * 같은 숙소의 연속 표식(숙소 → 숙소) — PR2 r4: **두 좌표가 모두 유효할 때만** 50m 안이면 같은 숙소. 이름은 보지 않는다
 *   (이름이 같아도 좌표가 다르면 다른 지점, 좌표 누락은 판정 불가 → 합치지 않음 — Number(null)=0 함정 제거).
 */
export function isSameLodgingMarker(a, b) {
  if (cat(a) !== 'lodging' || cat(b) !== 'lodging') return false;
  const ca = coordOf(a), cb = coordOf(b);
  if (!ca || !cb) return false;
  return distanceM(ca, cb) <= 50;
}

/**
 * 좌표로 판정할 수 없는 같은 예약 숙소의 북엔드(r5→r7). 체류·좌표 누락은 근거가 아니다.
 *   그날이 **숙소뿐**이고 마지막 두 숙소의 정규화 이름이 같고, 주소가 둘 다 있으면 일치, 한쪽만 있으면 그 주소 = 예약 숙소 주소(bookedAddress),
 *   둘 다 없으면 이름만(권역 placeholder). 두 좌표가 모두 유효하면 이 규칙은 쓰지 않는다(50m 규칙만). 도시 이동일은 호출자가 끈다.
 */
export function isLodgingBookendPair(places, i, bookedAddress = '') {
  const a = places[i - 1], b = places[i];
  if (i <= 0 || i !== places.length - 1 || cat(a) !== 'lodging' || cat(b) !== 'lodging') return false;
  if (coordOf(a) && coordOf(b)) return false;
  if (!places.every((p) => cat(p) === 'lodging')) return false; // 활동이 있는 날 = 합치지 않음
  if (!lodgingNameKey(a) || lodgingNameKey(a) !== lodgingNameKey(b)) return false;
  const aa = normKey(a?.address), ab = normKey(b?.address);
  if (aa && ab) return aa === ab;
  if (aa || ab) return !!normKey(bookedAddress) && (aa || ab) === normKey(bookedAddress);
  return true;
}

/**
 * PR2 r12: 유효 예약 숙소 주소 — 손님 호텔 주소, 없으면 권역 대표 주소(requestShaper.routeHotelAddress 와 같은 규칙).
 *   source = 요청 body·RouteAgent data·저장된 plan.input 어느 것이든(같은 필드 이름). 생성·재계산·품질 집계가 이 한 함수로 같은 값을 얻는다.
 */
export function effectiveBookedAddress(source) {
  const s = source && typeof source === 'object' ? source : {};
  return String(s.hotel_address || s.recommended_zone_address || '').trim();
}

/**
 * 저장된 stops[i] 가 앞 숙소와 합친 같은 숙소 표식인가 = 표식(생성 때 병합) **그리고** 지금도 같은 규칙으로 같은 숙소.
 *   bookedAddress: 예약 숙소 주소(재계산 = plan.input.hotel_address). 모르면 '' — 한쪽 주소만 있는 쌍은 합치지 않는 보수 쪽.
 */
export function isMergedLodgingStop(stops, i, bookedAddress = '') {
  const cur = stops?.[i];
  if (!cur || cur[SAME_LODGING_FIELD] !== true || i <= 0) return false;
  return isSameLodgingMarker(stops[i - 1], cur) || isLodgingBookendPair(stops, i, bookedAddress);
}
