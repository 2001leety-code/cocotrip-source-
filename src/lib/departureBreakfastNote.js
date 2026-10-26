/**
 * 2026-10-24 (운영자 결정): 출국 11:00 전 식당 조식 면제 안내 — 문구 SSOT.
 * 백엔드(planPersister.applyDepartureBreakfastNote)가 체크아웃 tip 에 붙이고, 공개 공유 투영(publicPlanProjection)이
 * 보는 사람 언어로 다시 고른다. 순수·브라우저 안전(의존 0). 제공 보장 문구 금지 — 운영시간·식이 적합성은 손님 확인.
 */
export const DEPARTURE_BREAKFAST_NOTE = {
  ko: '출국일 조식은 이른 비행 때문에 일정에 넣지 않았습니다. 호텔 또는 공항에서 준비해 주세요 — 운영시간과 식이 요건을 확인하세요.',
  en: 'Breakfast on departure day is not in the itinerary because of the early flight. Please arrange it at your hotel or the airport — check opening hours and dietary requirements.',
  ja: '出国日の朝食は早朝便のため日程に入れていません。ホテルまたは空港でご用意ください — 営業時間と食事制限への対応をご確認ください。',
  zh: '因航班较早，离境日早餐未列入行程。请在酒店或机场自行安排 — 请确认营业时间及饮食要求。',
};

export function departureBreakfastNote(language) {
  return DEPARTURE_BREAKFAST_NOTE[language] || DEPARTURE_BREAKFAST_NOTE.en;
}

/** 2026-10-26: 이 stop 에 출국 조식 안내가 붙어 있나(planPersister.applyDepartureBreakfastNote 표식). */
export function hasBreakfastNote(stop) {
  return !!stop && ((typeof stop.breakfast_note === 'string' && !!stop.breakfast_note) || stop._breakfast_note === true);
}

/** 붙였던 조식 안내만 뗀다 — tip 의 고정 문장 + breakfast_note·_breakfast_note. 나머지 tip 보존. 표식 없으면 무변. @returns {boolean} */
export function stripBreakfastNote(stop) {
  if (!hasBreakfastNote(stop)) return false;
  const tip = stripBreakfastNoteText(typeof stop.tip === 'string' ? stop.tip : '', stop.breakfast_note);
  if (tip) stop.tip = tip;
  else delete stop.tip;
  delete stop.breakfast_note;
  delete stop._breakfast_note;
  return true;
}

/** 2일 이상 여행의 마지막 날(출국일)에 식당이 생기면 그날 조식 안내를 뗀다(화면 편집 저장 직전 재판정). @returns {boolean} */
export function stripBreakfastNoteIfLastDayHasMeal(itinerary) {
  const days = Array.isArray(itinerary?.days) ? itinerary.days : [];
  if (days.length < 2) return false;
  const stops = Array.isArray(days[days.length - 1]?.stops) ? days[days.length - 1].stops : [];
  if (!stops.some((s) => s?.category === 'food')) return false;
  let changed = false;
  for (const s of stops) changed = stripBreakfastNote(s) || changed;
  return changed;
}

/** tip 문자열에서 조식 안내 고정 문장(4개 언어 + extra)만 뗀 결과(양끝 공백 정리). 원본 무변(순수). */
export function stripBreakfastNoteText(tip, extra) {
  if (typeof tip !== 'string') return tip;
  const notes = [...new Set([extra, ...Object.values(DEPARTURE_BREAKFAST_NOTE)])].filter((n) => typeof n === 'string' && n);
  let out = tip;
  for (const n of notes) out = out.split(` ${n}`).join('').split(n).join('');
  return out.trim();
}
