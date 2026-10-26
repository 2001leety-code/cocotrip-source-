/**
 * 2026-10-26 (운영자 승인): 도착 휴식일 안내 — 문구 SSOT.
 * 늦게 도착하는 날(constants.arrivalRestDayInfo)은 Day1 끼니 의무를 면제하고, 백엔드(planPersister.applyArrivalRestNote)가
 * Day1 숙소 tip 에 붙인다. 공개 공유 투영(publicPlanProjection)은 보는 사람 언어로 다시 고른다.
 * 순수·브라우저 안전(의존 0). 근처 식당 추천·제공 보장 문구 금지.
 */
export const ARRIVAL_REST_NOTE = {
  ko: '도착이 늦어 첫날은 호텔에서 쉬는 일정이에요. 첫날 저녁 식사는 일정에 넣지 않았어요.',
  en: 'You arrive late, so Day 1 is a rest evening at the hotel. No dinner stop is scheduled for Day 1.',
  ja: '到着が遅いため、初日はホテルでお休みいただく日程です。初日の夕食は日程に含めていません。',
  zh: '由于抵达较晚，第一天安排在酒店休息，第一天的晚餐未列入行程。',
};

export function arrivalRestNote(language) {
  return ARRIVAL_REST_NOTE[language] || ARRIVAL_REST_NOTE.en;
}

/** 2026-10-26: 이 stop 에 도착 휴식일 안내가 붙어 있나(planPersister.applyArrivalRestNote 가 붙인 표식). */
export function hasArrivalRestNote(stop) {
  return !!stop && ((typeof stop.arrival_rest_note === 'string' && !!stop.arrival_rest_note) || stop._arrival_rest_note === true);
}

const STRUCTURAL = new Set(['lodging', 'airport', 'travel']);

/**
 * 2026-10-26: 실제 도착 휴식일 Day1 인가 — 2일 이상 여행 + Day1 이 숙소·공항·이동뿐 + (휴식 안내가 붙은 stop 이 있거나
 * 저장된 input.arrival_rest_day === true). 장소 수만 보지 않는다(식당 하나인 날은 휴식일이 아니다).
 * @param {Array<object>} day1Stops
 * @param {{inputRestDay?: unknown, totalDays?: number}} opts
 */
export function isArrivalRestDay1(day1Stops, { inputRestDay, totalDays } = {}) {
  const stops = Array.isArray(day1Stops) ? day1Stops : [];
  if (!(Number(totalDays) > 1)) return false;
  if (!stops.every((s) => STRUCTURAL.has(s?.category))) return false;
  return stops.some(hasArrivalRestNote) || inputRestDay === true;
}

/** 휴식 카드의 "다음날 시작" 줄 — {time} 치환. */
export const ARRIVAL_REST_TOMORROW = {
  ko: '내일 일정은 {time}에 시작해요.',
  en: 'Your tour starts tomorrow at {time}.',
  ja: '明日の日程は{time}に始まります。',
  zh: '明天的行程从{time}开始。',
};

export function arrivalRestTomorrowLine(language, time) {
  return (ARRIVAL_REST_TOMORROW[language] || ARRIVAL_REST_TOMORROW.en).replace('{time}', String(time || '09:00'));
}
