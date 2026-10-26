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
