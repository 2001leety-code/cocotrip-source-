/**
 * 2026-10-26: tip 에 붙는 고정 안내(재방문·도착 휴식·출국 조식)의 번역 처리 — 순수·브라우저 안전.
 * 번역은 본문만 하고(고정 문장을 의역하면 정확 일치 제거가 안 되어 본문에 남는다), 번역 후 대상 언어 고정 문구를 다시 붙인다.
 * 문구 SSOT 는 각 모듈(revisitNote / arrivalRestNote / departureBreakfastNote).
 */
import { stripRevisitNote } from './revisitNote.js';
import { arrivalRestNote, hasArrivalRestNote, stripArrivalRestText } from './arrivalRestNote.js';
import { departureBreakfastNote, hasBreakfastNote, stripBreakfastNoteText } from './departureBreakfastNote.js';

/** 번역 입력용 tip — 고정 안내(재방문·도착 휴식·출국 조식, 4개 언어 + 저장값)를 뗀 본문. 원본 무변. */
export function stripFixedTipNotes(tip, stop = {}) {
  if (typeof tip !== 'string') return tip;
  return stripBreakfastNoteText(stripArrivalRestText(stripRevisitNote(tip, stop.revisit_note), stop.arrival_rest_note), stop.breakfast_note);
}

/**
 * 번역 후: 휴식·조식 표식이 있는 stop 의 tip 에서 (번역됐든 원문이든) 그 고정 문구를 떼고 대상 언어 문구를 다시 붙인다
 * (휴식 → 조식 순, 공개 투영과 같은 순서). 표식 필드도 대상 언어로. 표식 없는 stop 은 무변. 재방문 안내는 applyRevisitNotes 몫.
 */
export function reattachFixedTipNotes(itinerary, language) {
  for (const day of Array.isArray(itinerary?.days) ? itinerary.days : []) {
    for (const stop of Array.isArray(day?.stops) ? day.stops : []) {
      const rest = hasArrivalRestNote(stop);
      const breakfast = hasBreakfastNote(stop);
      if (!rest && !breakfast) continue;
      let tip = stripBreakfastNoteText(stripArrivalRestText(typeof stop.tip === 'string' ? stop.tip : '', stop.arrival_rest_note), stop.breakfast_note);
      if (rest) { const n = arrivalRestNote(language); tip = tip ? `${tip} ${n}` : n; stop.arrival_rest_note = n; stop._arrival_rest_note = true; }
      if (breakfast) { const n = departureBreakfastNote(language); tip = tip ? `${tip} ${n}` : n; stop.breakfast_note = n; stop._breakfast_note = true; }
      stop.tip = tip;
    }
  }
}
