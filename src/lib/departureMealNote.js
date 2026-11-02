/**
 * 2026-11-02 (운영자 결정 ③ — PR3): 1일 여행 출국일에 출국 활동 마감 전 남은 시간 안에 필수 끼니(블록 식당 체류 그대로)가
 * 들어가지 않으면 그 끼니만 면제하고(day.exempt_meals) 공항 식사 안내를 붙인다 — 문구 SSOT.
 * 출국 조식 면제(#1461 departureBreakfastNote)·도착 휴식일 면제(#1473 arrivalRestNote)와 같은 방식.
 * 백엔드(planPersister.applyDepartureMealNote)가 붙이고, 공개 공유 투영·번역 재부착이 보는 사람 언어로 다시 고른다.
 * 순수·브라우저 안전(의존 0). 제공 보장 문구 금지 — 운영시간·식이 적합성은 손님 확인(식당을 추천하지 않는다).
 */
// r7: 어느 끼니인지 밝힌다(점심·저녁·둘 다). 붙인 stop 의 departure_meal_roles 로 다시 고른다(번역 재부착·공개 투영).
export const DEPARTURE_MEAL_NOTE = {
  lunch: {
    ko: '출국 전 남은 시간이 짧아 점심은 일정에 넣지 않았습니다. 공항에서 간단히 식사해 주세요 — 운영시간과 식이 요건을 확인하세요.',
    en: 'Lunch is not in the itinerary because there is too little time before your flight. Please have a quick meal at the airport — check opening hours and dietary requirements.',
    ja: '出国までの時間が短いため、昼食は日程に入れていません。空港で軽く食事をお取りください — 営業時間と食事制限への対応をご確認ください。',
    zh: '因登机前时间较短，午餐未列入行程。请在机场简单用餐 — 请确认营业时间及饮食要求。',
  },
  dinner: {
    ko: '출국 전 남은 시간이 짧아 저녁은 일정에 넣지 않았습니다. 공항에서 간단히 식사해 주세요 — 운영시간과 식이 요건을 확인하세요.',
    en: 'Dinner is not in the itinerary because there is too little time before your flight. Please have a quick meal at the airport — check opening hours and dietary requirements.',
    ja: '出国までの時間が短いため、夕食は日程に入れていません。空港で軽く食事をお取りください — 営業時間と食事制限への対応をご確認ください。',
    zh: '因登机前时间较短，晚餐未列入行程。请在机场简单用餐 — 请确认营业时间及饮食要求。',
  },
  both: {
    ko: '출국 전 남은 시간이 짧아 점심과 저녁은 일정에 넣지 않았습니다. 공항에서 간단히 식사해 주세요 — 운영시간과 식이 요건을 확인하세요.',
    en: 'Lunch and dinner are not in the itinerary because there is too little time before your flight. Please have a quick meal at the airport — check opening hours and dietary requirements.',
    ja: '出国までの時間が短いため、昼食と夕食は日程に入れていません。空港で軽く食事をお取りください — 営業時間と食事制限への対応をご確認ください。',
    zh: '因登机前时间较短，午餐和晚餐未列入行程。请在机场简单用餐 — 请确认营业时间及饮食要求。',
  },
};

/** @param {string} language @param {string[]} [roles] 면제 끼니(점심·저녁). 하나만 = 그 끼니, 그 밖 = 둘 다. */
export function departureMealNote(language, roles) {
  const r = Array.isArray(roles) ? roles.filter((x) => x === 'lunch' || x === 'dinner') : [];
  const set = DEPARTURE_MEAL_NOTE[r.length === 1 ? r[0] : 'both'];
  return set[language] || set.en;
}

/** 필수 끼니 검사(responseValidator B-MEAL)와 같은 판정: 카페 아닌 식당 + 엄격 HH:MM 시작 시(時). 아니면 -1. */
export function mealStopHour(s) {
  if (s?.category !== 'food' || s?._blockMealRole === 'cafe' || s?.cafe_not_meal === true) return -1;
  const m = String(s?.start_time || '').match(/^(\d{2}):(\d{2})$/);
  return m && Number(m[1]) < 24 && Number(m[2]) < 60 ? Number(m[1]) : -1;
}

/** 이 stop 에 출국일 공항 식사 안내가 붙어 있나(planPersister.applyDepartureMealNote 표식). */
export function hasDepartureMealNote(stop) {
  return !!stop && ((typeof stop.departure_meal_note === 'string' && !!stop.departure_meal_note) || stop._departure_meal_note === true);
}

/** tip 문자열에서 공항 식사 안내 고정 문장(4개 언어 + extra)만 뗀 결과(양끝 공백 정리). 원본 무변(순수). */
export function stripDepartureMealNoteText(tip, extra) {
  if (typeof tip !== 'string') return tip;
  const notes = [...new Set([extra, ...Object.values(DEPARTURE_MEAL_NOTE).flatMap((set) => Object.values(set))])].filter((n) => typeof n === 'string' && n);
  let out = tip;
  for (const n of notes) out = out.split(` ${n}`).join('').split(n).join('');
  return out.trim();
}

/** 붙였던 안내만 뗀다 — tip 고정 문장 + departure_meal_note·_departure_meal_note. 나머지 tip 보존. @returns {boolean} */
export function stripDepartureMealNote(stop) {
  if (!hasDepartureMealNote(stop)) return false;
  const tip = stripDepartureMealNoteText(typeof stop.tip === 'string' ? stop.tip : '', stop.departure_meal_note);
  if (tip) stop.tip = tip;
  else delete stop.tip;
  delete stop.departure_meal_note;
  delete stop._departure_meal_note;
  delete stop.departure_meal_roles;
  return true;
}

const ROLE_HOURS = { lunch: [11, 17], dinner: [17, 22] };
/**
 * 화면 편집 저장 직전 재판정: 면제한 끼니 시간대(점심 11–17시·저녁 17–22시)에 식당(카페 제외 — 검증기와 같은 판정)이 생긴 날은
 * 그 끼니의 면제·근거를 떼고, 남은 면제가 없으면 안내도 뗀다.
 * @returns {boolean} 바꿨으면 true
 */
export function stripDepartureMealExemptionIfMealAdded(itinerary) {
  let changed = false;
  for (const day of Array.isArray(itinerary?.days) ? itinerary.days : []) {
    const exempt = Array.isArray(day?.exempt_meals) ? day.exempt_meals : [];
    if (!exempt.length) continue;
    const stops = Array.isArray(day.stops) ? day.stops : [];
    const keep = exempt.filter((r) => { const [lo, hi] = ROLE_HOURS[r] || [0, 0]; return !stops.some((s) => mealStopHour(s) >= lo && mealStopHour(s) < hi); });
    if (keep.length === exempt.length) continue;
    changed = true;
    if (day.exempt_meal_basis && typeof day.exempt_meal_basis === 'object') {
      for (const r of exempt) if (!keep.includes(r)) delete day.exempt_meal_basis[r];
      if (!Object.keys(day.exempt_meal_basis).length) delete day.exempt_meal_basis;
    }
    if (keep.length) {
      day.exempt_meals = keep;
      for (const stop of stops) {
        if (!hasDepartureMealNote(stop)) continue;
        const lang = Object.keys(DEPARTURE_MEAL_NOTE.both).find((language) =>
          Object.values(DEPARTURE_MEAL_NOTE).some((set) => set[language] === stop.departure_meal_note)) || 'en';
        const oldNote = stop.departure_meal_note;
        const tip = stripDepartureMealNoteText(stop.tip, oldNote);
        const note = departureMealNote(lang, keep);
        stop.tip = tip ? `${tip} ${note}` : note;
        stop.departure_meal_note = note;
        stop.departure_meal_roles = [...keep];
      }
    }
    else { delete day.exempt_meals; for (const s of stops) stripDepartureMealNote(s); }
  }
  return changed;
}
