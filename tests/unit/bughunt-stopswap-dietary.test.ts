/**
 * Bughunt #14 (SAFETY 식이) — stop_swap 검수 checkDietary 가 프로덕션 실제 필드 r.tag 미독으로
 * 정상 halal/vegan 교체를 false-reject 하던 회귀 방지.
 *
 * Source: api/ai-planner-modify.js — checkDietary + applyStopSwap
 *
 * 배경:
 *   프로덕션 _food_index.json 은 식이태그를 `tag` (단일 문자열, 예 "halal") 에 저장하고
 *   `dietary_tags` (배열) 는 없다 (build-food-index.js). stop_swap 은 matchFoodPlaceholder 로
 *   halal/vegan hard-filter 된 식당(= tag 보유)을 고른 뒤, 직후 checkDietary 로 재검수한다.
 *   버그 전 checkDietary 는 stop.dietary_tags(배열) 만 읽어, 프로덕션 식당의 tag 를 못 봐서
 *   적합 식당인데도 DIETARY_UNSATISFIED 로 거부 → halal/vegan 손님 수정이 사실상 불가했다.
 *
 * 수정:
 *   (a) checkDietary 가 dietaryTagsOf 처럼 stop.tag + stop.dietary_tags 둘 다 정규화해 읽음.
 *   (b) applyStopSwap 의 swapped 생성 시 matched.tag 를 dietary_tags 로 승격(둘 다 채움).
 *
 * 본 테스트는 export 된 실제 구현(checkDietary / applyStopSwap)을 직접 호출 — 카피본 drift 방지.
 */
import { describe, it, expect } from 'vitest';

import {
  checkDietary,
  applyStopSwap,
} from '../../api/ai-planner-modify.js';

describe('checkDietary — r.tag 단일 문자열 정규화 (bughunt #14)', () => {
  it('식이 선호 없으면 항상 통과 (early ok)', () => {
    expect(checkDietary({ name: 'X' }, []).ok).toBe(true);
    expect(checkDietary({ name: 'X' }, null as unknown as string[]).ok).toBe(true);
    expect(checkDietary({ name: 'X' }, ['nuts']).ok).toBe(true); // nuts 는 dietCritical 아님
  });

  it('프로덕션 필드 stop.tag(문자열)만 있어도 halal 통과 — 버그 핵심', () => {
    // 프로덕션 _food_index.json 모양: dietary_tags 없음, tag 단일 문자열.
    const prodStop = { name: '할랄식당', tag: 'halal' };
    const r = checkDietary(prodStop, ['halal']);
    expect(r.ok).toBe(true); // 버그 전엔 false (tag 미독)
  });

  it('legacy stop.dietary_tags(배열) 경로도 그대로 통과 (회귀 0)', () => {
    const legacyStop = { name: 'V식당', dietary_tags: ['vegan'] };
    expect(checkDietary(legacyStop, ['vegan']).ok).toBe(true);
  });

  it('tag·dietary_tags 둘 다 있으면 합쳐서 검사 (vegetarian + halal)', () => {
    const stop = { name: 'X', tag: 'halal', dietary_tags: ['vegetarian'] };
    expect(checkDietary(stop, ['halal']).ok).toBe(true);
    expect(checkDietary(stop, ['vegetarian']).ok).toBe(true);
    expect(checkDietary(stop, ['halal', 'vegetarian']).ok).toBe(true);
  });

  it('대소문자 무관 정규화 (HALAL → halal)', () => {
    expect(checkDietary({ name: 'X', tag: 'HALAL' }, ['halal']).ok).toBe(true);
    expect(checkDietary({ name: 'X', tag: 'halal' }, ['HALAL']).ok).toBe(true);
  });

  it('fail-closed 유지 — 식이 태그 전혀 없으면 거부 (안전)', () => {
    const noTag = { name: '일반식당' };
    const r = checkDietary(noTag, ['halal']);
    expect(r.ok).toBe(false);
    expect(r.missing).toBe('halal');
  });

  it('tag 가 다른 식이면 거부 (halal 요구에 vegan tag)', () => {
    const r = checkDietary({ name: 'X', tag: 'vegan' }, ['halal']);
    expect(r.ok).toBe(false);
    expect(r.missing).toBe('halal');
  });
});

describe('applyStopSwap — matched.tag 승격 + checkDietary 통과 (bughunt #14)', () => {
  // oldStop 에는 식이태그가 없다 (이게 버그 트리거 조건 — 폴백이 빈 태그로 떨어짐).
  function makeItinerary() {
    return {
      days: [
        {
          day: 1,
          stops: [
            { order: 1, name: '호텔', category: 'lodging' },
            { order: 2, name: '기존식당', category: 'food', start_time: '12:00', stay_min: 60 },
            { order: 3, name: '호텔', category: 'lodging' },
          ],
        },
      ],
    };
  }

  const classified = {
    target: { day_index: 1, stop_order: 2, stop_name: '식당' },
    raw_text: '2일차 식당 바꿔줘',
  };

  it('프로덕션 모양 food(tag 문자열)로 교체 시 거부되지 않고 dietary_tags 로 승격', () => {
    const itinerary = makeItinerary();
    // 프로덕션 _food_index.json row: tag 단일 문자열, dietary_tags 없음.
    const foodIndex = [
      { name: '서울할랄키친', display_name: 'Seoul Halal Kitchen', city: 'seoul', tag: 'halal', cuisine: 'korean', rating: 4.7, reviewCount: 200 },
    ];
    const res = applyStopSwap({
      itinerary,
      classified,
      dietPrefs: ['halal'],
      foodIndex,
      area: 'seoul',
    });

    // 버그 전: code DIETARY_UNSATISFIED 로 false. 수정 후: ok.
    expect(res.ok).toBe(true);
    expect(res.intent).toBe('stop_swap');

    const swapped = itinerary.days[0].stops[1];
    expect(swapped.name).toBe('서울할랄키친');
    // (b) matched.tag 가 dietary_tags 로 승격됨.
    expect(Array.isArray(swapped.dietary_tags)).toBe(true);
    expect(swapped.dietary_tags).toContain('halal');
    // 원본 tag 필드도 보존 (downstream 일관성).
    expect(swapped.tag).toBe('halal');
    expect(swapped.verified).toBe(true);
    // order/start_time/stay_min 보존.
    expect(swapped.order).toBe(2);
    expect(swapped.start_time).toBe('12:00');
    expect(swapped.stay_min).toBe(60);
  });

  it('fail-closed 유지 — 후보가 식이 불만족이면 NO_ALTERNATIVE (안전)', () => {
    const itinerary = makeItinerary();
    // halal 요구인데 후보엔 halal tag 식당이 없음 → matchFoodPlaceholder hard-filter 가 0 → null.
    const foodIndex = [
      { name: '일반식당', city: 'seoul', tag: 'vegan', cuisine: 'korean', rating: 4.6, reviewCount: 80 },
    ];
    const res = applyStopSwap({
      itinerary,
      classified,
      dietPrefs: ['halal'],
      foodIndex,
      area: 'seoul',
    });
    expect(res.ok).toBe(false);
    // matchFoodPlaceholder 가 SAFETY hard-filter 로 null 반환 → NO_ALTERNATIVE.
    expect(res.code).toBe('NO_ALTERNATIVE');
    // 안전: 원본 stop 변경 안 됨.
    expect(itinerary.days[0].stops[1].name).toBe('기존식당');
  });

  it('식이 무제한 손님은 tag 무관하게 교체 성공 (회귀 0)', () => {
    const itinerary = makeItinerary();
    const foodIndex = [
      { name: '맛집', city: 'seoul', cuisine: 'korean', rating: 4.8, reviewCount: 300 },
    ];
    const res = applyStopSwap({
      itinerary,
      classified,
      dietPrefs: [],
      foodIndex,
      area: 'seoul',
    });
    expect(res.ok).toBe(true);
    expect(itinerary.days[0].stops[1].name).toBe('맛집');
  });
});
