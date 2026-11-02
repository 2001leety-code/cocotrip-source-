const COPY = {
  ko: { unselected: '식당 미선택 · 일정은 기준 식당으로 계산되었습니다.', selected: '선택한 식당으로 일정을 다시 검증했습니다.' },
  en: { unselected: 'Restaurant not selected yet. The itinerary uses the baseline restaurant.', selected: 'The itinerary has been revalidated for the selected restaurant.' },
  ja: { unselected: 'レストランは未選択です。行程は基準のレストランで計算されています。', selected: '選択したレストランで行程を再検証しました。' },
  zh: { unselected: '尚未选择餐厅。行程按基准餐厅计算。', selected: '已按所选餐厅重新验证行程。' },
};
export function mealSlotNote(language, selected) { return (COPY[language] || COPY.en)[selected ? 'selected' : 'unselected']; }
export function stripMealSlotNote(tip, explicit) {
  let text = typeof tip === 'string' ? tip : '';
  for (const note of [...Object.values(COPY).flatMap((copy) => Object.values(copy)), explicit].filter(Boolean)) text = text.split(note).join('');
  return text.replace(/\s{2,}/g, ' ').trim();
}
export function applyMealSlotNotes(itinerary, language) {
  if (itinerary?.meal_options_version !== 1) return;
  const slots = new Map((itinerary.meal_options || []).map((slot) => [slot.mealId, slot]));
  for (const day of itinerary.days || []) for (const stop of day.stops || []) {
    const slot = slots.get(stop.meal_slot_id);
    if (!slot) continue;
    const note = mealSlotNote(language, !!slot.selectedId);
    const body = stripMealSlotNote(stop.tip, stop.meal_selection_note);
    stop.tip = body ? `${body} ${note}` : note;
    stop.meal_selection_note = note;
    stop.meal_selection_state = slot.selectedId ? 'selected' : 'unselected';
  }
}
