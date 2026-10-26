/**
 * 2026-10-26 (운영자 승인): 도착 휴식일 안내 — 문구 SSOT.
 * 늦게 도착하는 날(constants.arrivalRestDayInfo)은 Day1 끼니 의무를 면제하고, 백엔드(planPersister.applyArrivalRestNote)가
 * Day1 숙소 tip 에 붙인다. 공개 공유 투영(publicPlanProjection)은 보는 사람 언어로 다시 고른다.
 * 순수·브라우저 안전(의존 0). 근처 식당 추천·제공 보장 문구 금지.
 */
import { strictHHMMToMin, REST_DAY_LATE_ARRIVAL_MIN } from './arrivalRestRules.js';

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

/** tip 문자열에서 휴식 안내 고정 문장(4개 언어 + extra)만 뗀 결과(양끝 공백 정리). 원본 무변(순수). */
export function stripArrivalRestText(tip, extra) {
  if (typeof tip !== 'string') return tip;
  const notes = [...new Set([extra, ...Object.values(ARRIVAL_REST_NOTE)])].filter((n) => typeof n === 'string' && n);
  let out = tip;
  for (const n of notes) out = out.split(` ${n}`).join('').split(n).join('');
  return out.trim();
}

/**
 * 붙였던 도착 휴식일 안내만 정확히 뗀다 — tip 에서 고정 문장(저장된 arrival_rest_note + 4개 언어 문구)만 제거하고
 * arrival_rest_note·_arrival_rest_note 삭제. 손님/모델이 쓴 나머지 tip 은 그대로(공백 정리는 양끝만). 표식 없는 stop 은 무변.
 * 서버(planPersister.applyArrivalRestNote)·화면 편집 저장(usePlanEditor)·번역(translate-plan) 공용.
 * @returns {boolean} 뗐으면 true
 */
export function stripArrivalRestNote(stop) {
  if (!hasArrivalRestNote(stop)) return false;
  const tip = stripArrivalRestText(typeof stop.tip === 'string' ? stop.tip : '', stop.arrival_rest_note);
  if (tip) stop.tip = tip;
  else delete stop.tip;
  delete stop.arrival_rest_note;
  delete stop._arrival_rest_note;
  return true;
}

const STRUCTURAL = new Set(['lodging', 'airport', 'travel']);

/** Day1 이 숙소·공항·이동뿐이 아니면(식당·관광이 생김) Day1 의 휴식 안내를 뗀다(화면 편집 저장 직전 재판정). @returns {boolean} */
export function stripArrivalRestNoteIfDay1Active(itinerary) {
  const day1 = Array.isArray(itinerary?.days) ? itinerary.days[0] : null;
  const stops = Array.isArray(day1?.stops) ? day1.stops : [];
  if (stops.every((s) => STRUCTURAL.has(s?.category))) return false;
  let changed = false;
  for (const s of stops) changed = stripArrivalRestNote(s) || changed;
  return changed;
}

/**
 * 2026-10-26: 실제 도착 휴식일 Day1 인가 — 2일 이상 여행 + Day1 이 숙소·공항·이동뿐 + (휴식 안내가 붙은 stop 이 있거나
 * 저장된 input.arrival_rest_day === true). 장소 수만 보지 않는다(식당 하나인 날은 휴식일이 아니다).
 * 예전 플랜(표식·플래그가 생기기 전 저장 — input.arrival_rest_day 필드 자체가 없음)만: 브라우저 안전 규칙 (i)
 * (저장된 도착 시각 엄격 HH:MM ≥ 18:00)로 대체 판정. 필드가 false 면 대체 판정하지 않는다.
 * @param {Array<object>} day1Stops
 * @param {{inputRestDay?: unknown, inputArrivalTime?: unknown, totalDays?: number}} opts
 */
export function isArrivalRestDay1(day1Stops, { inputRestDay, inputArrivalTime, totalDays } = {}) {
  const stops = Array.isArray(day1Stops) ? day1Stops : [];
  if (!(Number(totalDays) > 1)) return false;
  if (!stops.every((s) => STRUCTURAL.has(s?.category))) return false;
  if (stops.some(hasArrivalRestNote) || inputRestDay === true) return true;
  if (inputRestDay !== undefined) return false;
  const arr = strictHHMMToMin(inputArrivalTime);
  return arr !== null && arr >= REST_DAY_LATE_ARRIVAL_MIN;
}

/**
 * 휴식 카드 제목 — 화면 카드(planDetail.day1ArrivalOnlyTitle)와 같은 문구. PDF 는 locale JSON 대신 이 표를 쓴다
 * (카드 제목에 안내 문장을 쓰면 바로 아래 숙소 Tip 의 같은 문장과 중복 출력된다).
 */
export const ARRIVAL_REST_TITLE = {
  ko: '늦게 도착한 날은 숙소에서 쉬세요',
  en: 'Rest at your stay after a late arrival',
  ja: '到着が遅い日は宿で休みましょう',
  zh: '抵达较晚时请先在住宿处休息',
};

export function arrivalRestTitle(language) {
  return ARRIVAL_REST_TITLE[language] || ARRIVAL_REST_TITLE.en;
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

/**
 * 다음날 실제 첫 stop 시각(엄격 HH:MM) — 없거나 형식이 다르면 ''(그때 "내일 시작" 줄 생략).
 * 기본 09:00 을 쓰지 않는다: 다음날이 06:30 숙소·07:00 공항이면 "내일 09:00 시작" 은 틀린 말.
 */
export function nextDayStartTime(days, dayIndex) {
  const next = Array.isArray(days) ? days[Number(dayIndex) + 1] : null;
  const first = Array.isArray(next?.stops) ? next.stops[0] : null;
  const t = String(first?.start_time || '').trim();
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(t) ? t : '';
}
