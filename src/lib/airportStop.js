// 2026-11-16: "공항 stop" 판정 — 서버(RouteAgent: 출국일 공항 좌표 고정·숙소 복귀 생략)와
//   화면(DayTimeline: 마지막 날 숙소 복귀 카드)이 같은 규칙을 쓴다. 둘이 따로 고르면 한쪽만 고쳐진다.
//   공항 카테고리, blockMode 가 넣은 출국 이동 stop, 또는 이동(travel) stop 인데 이름에 공항 낱말이 있는 것.
//   travel 만 이름을 본다 — 식당·숙소 이름에 "Airport" 가 들어가도 공항으로 보지 않는다.
const AIRPORT_WORD_RE = /공항|airport|空港|机场|機場|\b(?:ICN|GMP|PUS|CJU|TAE|KWJ|MWX|YNY)\b/i;

/** @param {{ category?: string, name?: string, display_name?: string, _departure_airport_stop?: boolean } | null | undefined} stop */
export function isAirportStop(stop) {
  if (!stop || typeof stop !== 'object') return false;
  if (stop._departure_airport_stop === true) return true;
  const cat = String(stop.category || '').toLowerCase();
  if (cat === 'airport' || cat === 'airport_transfer') return true;
  return cat === 'travel' && AIRPORT_WORD_RE.test(`${stop.name || ''} ${stop.display_name || ''}`);
}
