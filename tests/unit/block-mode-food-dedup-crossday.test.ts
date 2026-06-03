/**
 * 크로스-day 식당 중복 방지 통합 가드 (2026-06-03, 자율 사이클).
 *
 * 신고 (plan 4d214e83, 서울+부산 5일): "같은 식당('홍대 맛집 깃뜰') 6회 반복".
 * fix(#760): expandBlocksToItinerary / expandBlocksToItineraryMultiCity 가 usedFoodNames Set 을
 *   **day 루프 밖에서 1개** 선언(L674/L1297) → 전 day 누적 → matchFoodPlaceholder(excludeNames) 로
 *   매 day 차순위 선택 → 같은 식당 재배정 차단.
 *
 * ⚠️ 기존 plan-quality-4d214e83.test.ts 는 matchFoodPlaceholder 를 고립 테스트(명시적 Set 주입).
 *   본 테스트는 **expand 함수가 Set 을 day 루프 가로질러 실제로 누적·전달하는 통합 불변식**을 잠근다.
 *   누군가 `new Set()` 을 day 루프 안으로 옮기면(스코프 회귀) 이 테스트가 잡는다 (고립 테스트는 못 잡음).
 */
import { describe, it, expect } from 'vitest';
import { expandBlocksToItinerary, expandBlocksToItineraryMultiCity } from '../../api/_ai_core/blockMode.js';

// 식당 3곳 (rating 내림차순 = 1·2·3순위 결정적). 좌표 없음 → 근접 가중 미적용, base(rating) 정렬.
const seoulFood = [
  { name: '식당A', city: 'seoul', type: 'restaurant', rating: 4.9, reviewCount: 1000, dietary_tags: [] },
  { name: '식당B', city: 'seoul', type: 'restaurant', rating: 4.8, reviewCount: 900, dietary_tags: [] },
  { name: '식당C', city: 'seoul', type: 'restaurant', rating: 4.7, reviewCount: 800, dietary_tags: [] },
];
// 식당 1곳만 있는 블록 (food placeholder 1 stop) — 같은 블록을 여러 day 가 선택해도 day 마다 달라야 함.
const lunchBlock = { id: 'BLK_LUNCH', zone: 'seoul', theme: '점심', stops: [{ order: 1, placeholder: 'verified_lunch', category: 'food' }] };

const foodNamesOf = (itin: any): string[] =>
  (itin.days || []).flatMap((d: any) => (d.stops || []).filter((s: any) => s.verified).map((s: any) => s.name));

describe('expandBlocksToItinerary — 크로스-day 식당 dedup (단도시)', () => {
  it('3 day 가 같은 블록 선택 → 3개 모두 다른 식당 (usedFoodNames 누적 입증)', () => {
    const sel = { day_selections: [1, 2, 3].map((day) => ({ day, block_id: 'BLK_LUNCH', tweak_notes: '' })) };
    const itin = expandBlocksToItinerary(sel, [lunchBlock], { durationDays: 3, area: 'seoul', foodIndex: seoulFood, language: 'en', dietPrefs: [] });
    const names = foodNamesOf(itin);
    expect(names).toHaveLength(3);
    expect(new Set(names).size).toBe(3); // 전부 distinct = 크로스-day dedup 작동 ("6번 반복" 회귀 차단)
  });

  it('식당 < day 수 → 소진 후 graceful 재사용 (crash 없음, 앞 3개는 distinct)', () => {
    const sel = { day_selections: [1, 2, 3, 4].map((day) => ({ day, block_id: 'BLK_LUNCH', tweak_notes: '' })) };
    const itin = expandBlocksToItinerary(sel, [lunchBlock], { durationDays: 4, area: 'seoul', foodIndex: seoulFood, language: 'en', dietPrefs: [] });
    const names = foodNamesOf(itin);
    expect(names).toHaveLength(4);
    expect(new Set(names.slice(0, 3)).size).toBe(3); // 1~3일 distinct
    expect(names[3]).toBe('식당A'); // 소진 → 1순위 재사용 (graceful)
  });
});

describe('expandBlocksToItineraryMultiCity — 크로스-day 식당 dedup (다도시, 신고 shape)', () => {
  const busanFood = [
    { name: '부산식당A', city: 'busan', type: 'restaurant', rating: 4.9, reviewCount: 1000, dietary_tags: [] },
  ];
  const seoulBlock = { id: 'BLK_SEOUL', zone: 'seoul', theme: '서울', stops: [{ order: 1, placeholder: 'verified_lunch', category: 'food' }] };
  const busanBlock = { id: 'BLK_BUSAN', zone: 'busan', theme: '부산', stops: [{ order: 1, placeholder: 'verified_lunch', category: 'food' }] };
  const cityBlocksList = [
    { city: 'seoul', blocks: [seoulBlock] },
    { city: 'busan', blocks: [busanBlock] },
  ];

  it('서울 2 day(같은 블록) → 서울 식당 2개 distinct + 부산 day = 부산 식당 (도시 분리 유지)', () => {
    const sel = {
      day_selections: [
        { day: 1, city: 'seoul', block_id: 'BLK_SEOUL', tweak_notes: '' },
        { day: 2, city: 'seoul', block_id: 'BLK_SEOUL', tweak_notes: '' },
        { day: 3, city: 'busan', block_id: 'BLK_BUSAN', tweak_notes: '' },
      ],
    };
    const itin = expandBlocksToItineraryMultiCity(sel, cityBlocksList, { durationDays: 3, foodIndex: [...seoulFood, ...busanFood], language: 'en', dietPrefs: [] });
    const d = itin.days || [];
    const seoulDayNames = [d[0], d[1]].map((x: any) => (x.stops || []).find((s: any) => s.verified)?.name);
    const busanDayName = (d[2].stops || []).find((s: any) => s.verified)?.name;
    expect(seoulDayNames[0]).toBeTruthy();
    expect(seoulDayNames[1]).toBeTruthy();
    expect(seoulDayNames[0]).not.toBe(seoulDayNames[1]); // 서울 day1 ≠ day2 = 크로스-day dedup
    expect(busanDayName).toBe('부산식당A'); // 부산 day = 부산 식당 (도시 경계 유지)
  });
});
