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
