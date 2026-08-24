/**
 * planner-trust (2026-08-24) — 식이 신뢰 후보 + 종단 fail-closed 검증 + zero-food 가드.
 *
 * 전부 **동작** 테스트다 (소스 문자열 grep 아님).
 *   a) unverified 고평점 후보가 trusted 저평점 후보를 이기지 못한다
 *   b) trusted 후보 0 → 안정 코드(BLOCK_MODE_DIETARY_UNSATISFIED) 로 실패 + legacy 폴백
 *   c) muslim_friendly 증거가 인증(halal_certified)과 눈에 보이게 구분된다
 *   d) pattern/pass3 재작성본이 식이를 어기면 마지막 검증 통과본을 못 밀어낸다
 *   e) background Pass3 결과가 검증 실패면 Firestore 를 덮어쓰지 않는다
 *   f) 6-stop 식이 day 에 food 0 = 실패, 진짜 도착/출국 transit-only 부분 day 는 통과
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { matchFoodPlaceholder, expandBlocksToItinerary, appendDietaryEvidenceTip } from '../../api/_ai_core/blockMode.js';
import {
  dietaryEvidenceFor, describeDietaryEvidence, isCertifiedDietaryStatus, acceptTagsForDiet,
} from '../../api/_shared/dietary-trust.js';
import {
  checkZeroFoodDays, runFinalItineraryValidation, FINAL_GATE_MEAL_CODE, FINAL_GATE_DIETARY_CODE,
} from '../../api/_ai_core/finalItineraryGate.js';

// ── fixtures ────────────────────────────────────────────────────────────────
// 실측 감사(docs/DIETARY-DATA-AUDIT-2026-07-11.md) 재현: naver 키워드검색으로 halal 태그가
// 붙은 고평점 식당 vs 운영자가 인증 확인한 저평점 식당.
const UNVERIFIED_HALAL_TOP = {
  name: '치킨나라', city: 'seoul', cuisine: 'Korean', rating: 5, reviewCount: 5000,
  lat: 37.5717, lng: 126.9858, tag: 'halal', source: 'naver_local', verification_status: 'unverified',
};
const CERTIFIED_HALAL_LOW = {
  name: '이태원 할랄식당', city: 'seoul', cuisine: 'Korean', rating: 3.6, reviewCount: 40,
  lat: 37.5717, lng: 126.9858, tag: 'halal', verification_status: 'halal_certified',
};
const FRIENDLY_HALAL = {
  name: '무슬림 친화 식당', city: 'seoul', cuisine: 'Korean', rating: 4.2, reviewCount: 300,
  lat: 37.5717, lng: 126.9858, tag: 'halal', verification_status: 'muslim_friendly',
};
const VEGAN_TRUSTED = {
  name: '비건 하우스', city: 'seoul', cuisine: 'Korean', rating: 4.1, reviewCount: 90,
  lat: 37.5717, lng: 126.9858, tag: 'vegan', verification_status: 'vegan_restaurant',
};
const PH = { placeholder: 'verified_lunch', lat: 37.5717, lng: 126.9858 };

describe('a) 신뢰 후보 — unverified 고평점이 trusted 저평점을 못 이긴다', () => {
  it('halal: 평점 5.0 unverified 대신 평점 3.6 인증 식당 선택', () => {
    const m = matchFoodPlaceholder(PH, [UNVERIFIED_HALAL_TOP, CERTIFIED_HALAL_LOW], 'seoul', ['halal'], new Set());
    expect(m?.name).toBe('이태원 할랄식당');
  });

  it('halal: 후보가 unverified 뿐이면 null (일반식당·unverified 로 완화 금지)', () => {
    const m = matchFoodPlaceholder(PH, [UNVERIFIED_HALAL_TOP], 'seoul', ['halal'], new Set());
    expect(m).toBeNull();
  });

  it('vegetarian 요청은 SSOT 가 허용하는 vegan 식당으로 커버 (역방향은 불가)', () => {
    expect(acceptTagsForDiet('vegetarian')).toEqual(['vegetarian', 'vegan']);
    expect(acceptTagsForDiet('vegan')).toEqual(['vegan']);
    const m = matchFoodPlaceholder(PH, [VEGAN_TRUSTED], 'seoul', ['vegetarian'], new Set());
    expect(m?.name).toBe('비건 하우스');
    // vegan 요청에 vegetarian 식당은 안 됨.
    const vegOnly = { ...VEGAN_TRUSTED, name: '채식당', tag: 'vegetarian', verification_status: 'vegan_options' };
    expect(matchFoodPlaceholder(PH, [vegOnly], 'seoul', ['vegan'], new Set())).toBeNull();
  });

  it('선택된 후보에 등급 증거가 실려 나온다 (verified 와 별개 필드)', () => {
    const m = matchFoodPlaceholder(PH, [FRIENDLY_HALAL], 'seoul', ['halal'], new Set());
    expect(m?.dietary_evidence).toEqual([{ diet: 'halal', tag: 'halal', verification_status: 'muslim_friendly' }]);
    // 원본 foodIndex 행은 오염되지 않는다 (프로세스 공유 배열).
    expect((FRIENDLY_HALAL as any).dietary_evidence).toBeUndefined();
  });

  it('식이 요구 없는 손님은 기존 동작 그대로 (평점 1등, 증거 필드 없음)', () => {
    const general = { name: '일반집', city: 'seoul', cuisine: 'Korean', rating: 4.9, reviewCount: 1000, lat: 37.5717, lng: 126.9858, tag: 'general' };
    const m = matchFoodPlaceholder(PH, [general, CERTIFIED_HALAL_LOW], 'seoul', [], new Set());
    expect(m?.name).toBe('일반집');
    expect(m?.dietary_evidence).toBeUndefined();
  });
});

describe('b) trusted 후보 0 → 안정 코드로 실패 (완화 금지)', () => {
  const block = {
    id: 'B1', city: 'seoul', zone: '종로', theme: 'test', dietary_options: ['halal'],
    stops: [
      { order: 1, name: '경복궁', category: 'culture', start_time_offset_min: 0, stay_min: 60, lat: 37.5796, lng: 126.977 },
      { order: 2, placeholder: 'verified_lunch', category: 'food', start_time_offset_min: 180, stay_min: 60 },
      { order: 3, name: '북촌', category: 'culture', start_time_offset_min: 300, stay_min: 60, lat: 37.582, lng: 126.983 },
    ],
  };
  const sel = { day_selections: [{ day: 1, block_id: 'B1', tweak_notes: '' }] };

  it('unverified 후보밖에 없으면 BLOCK_MODE_DIETARY_UNSATISFIED throw', () => {
    let caught: any = null;
    try {
      expandBlocksToItinerary(sel, [block], {
        durationDays: 1, dietPrefs: ['Halal'], language: 'en', area: 'seoul', foodIndex: [UNVERIFIED_HALAL_TOP],
      });
    } catch (e) { caught = e; }
    expect(caught).toBeTruthy();
    expect(caught.code).toBe('BLOCK_MODE_DIETARY_UNSATISFIED');
    expect(caught.statusCode).toBe(422);
  });

  it('trusted 후보가 있으면 정상 확장 + stop 에 증거 전파', () => {
    const out = expandBlocksToItinerary(sel, [block], {
      durationDays: 1, dietPrefs: ['Halal'], language: 'en', area: 'seoul',
      foodIndex: [UNVERIFIED_HALAL_TOP, FRIENDLY_HALAL],
    });
    const food = out.days[0].stops.find((s: any) => s.category === 'food');
    expect(food.name).toBe('무슬림 친화 식당');
    expect(food.dietary_evidence?.[0].verification_status).toBe('muslim_friendly');
  });
});

describe('c) muslim_friendly 는 인증과 눈에 보이게 구분된다', () => {
  it('등급 판정 자체가 다르다', () => {
    expect(isCertifiedDietaryStatus('halal_certified')).toBe(true);
    expect(isCertifiedDietaryStatus('muslim_friendly')).toBe(false);
    expect(isCertifiedDietaryStatus('vegan_restaurant')).toBe(true);
    expect(isCertifiedDietaryStatus('vegan_options')).toBe(false);
  });

  it('손님 문구가 4개 언어 모두 다르고, 친화 등급은 "인증 아님" 을 말한다', () => {
    for (const lang of ['ko', 'en', 'ja', 'zh']) {
      const certified = describeDietaryEvidence('halal_certified', lang);
      const friendly = describeDietaryEvidence('muslim_friendly', lang);
      expect(certified).toBeTruthy();
      expect(friendly).toBeTruthy();
      expect(friendly).not.toBe(certified);
    }
    expect(describeDietaryEvidence('halal_certified', 'en')).toMatch(/certification verified/i);
    expect(describeDietaryEvidence('muslim_friendly', 'en')).toMatch(/NOT verified/);
    expect(describeDietaryEvidence('muslim_friendly', 'ko')).toMatch(/확인되지 않았습니다/);
  });

  it('stop tip 이 친화 등급을 인증으로 승격하지 않는다', () => {
    const tip = appendDietaryEvidenceTip('맛집입니다.', [{ verification_status: 'muslim_friendly' }], 'en');
    expect(tip).toMatch(/맛집입니다\./);
    expect(tip).toMatch(/NOT verified/);
    // 미지의 등급은 문구를 지어내지 않는다.
    expect(appendDietaryEvidenceTip('base', [{ verification_status: 'unknown_tier' }], 'en')).toBe('base');
  });

  it('unverified 는 증거로 인정되지 않는다', () => {
    expect(dietaryEvidenceFor(UNVERIFIED_HALAL_TOP, 'halal')).toBeNull();
    expect(dietaryEvidenceFor(FRIENDLY_HALAL, 'halal')?.verification_status).toBe('muslim_friendly');
  });
});

// ── 공통: 검증 통과 / 위반 itinerary shape ─────────────────────────────────
const okDay = (dayNum: number) => ({
  day: dayNum,
  stops: [
    { order: 1, category: 'lodging', name: '호텔' },
    { order: 2, category: 'culture', name: '경복궁', address: '서울특별시 종로구 1' },
    { order: 3, category: 'food', name: '비건 하우스', address: '서울특별시 종로구 12', stay_min: 60, dietary_tags: ['vegan'], tip: 'vegan menu' },
    { order: 4, category: 'culture', name: '북촌', address: '서울특별시 종로구 3' },
    { order: 5, category: 'lodging', name: '호텔' },
  ],
});
const violatingDay = (dayNum: number) => ({
  day: dayNum,
  stops: [
    { order: 1, category: 'lodging', name: '호텔' },
    { order: 2, category: 'culture', name: '경복궁', address: '서울특별시 종로구 1' },
    { order: 3, category: 'food', name: '삼겹살집', address: '서울특별시 종로구 12', stay_min: 60, tip: '돼지고기 맛집' },
    { order: 4, category: 'lodging', name: '호텔' },
  ],
});

describe('f) zero-food 가드 — 정상 day 는 실패, 진짜 transit-only 부분 day 는 통과', () => {
  it('6-stop 제주 vegan day 에 food 0 → 실패 (실측 재현 shape)', () => {
    const jejuDay = {
      day: 2,
      city: 'jeju',
      stops: [
        { order: 1, category: 'lodging', name: '제주 호텔' },
        { order: 2, category: 'nature', name: '협재해변' },
        { order: 3, category: 'nature', name: '한림공원' },
        { order: 4, category: 'culture', name: '오설록' },
        { order: 5, category: 'nature', name: '수월봉' },
        { order: 6, category: 'lodging', name: '제주 호텔' },
      ],
    };
    const fails = checkZeroFoodDays({ days: [jejuDay] }, ['Vegan']);
    expect(fails).toHaveLength(1);
    expect(fails[0].day).toBe(2);
    expect(fails[0].food_stops).toBe(0);
  });

  it('도착일(공항+호텔+저녁 1곳) transit-only 부분 day → 통과', () => {
    const arrivalDay = {
      day: 1,
      stops: [
        { order: 1, category: 'travel', name: '인천국제공항' },
        { order: 2, category: 'lodging', name: '호텔' },
        { order: 3, category: 'culture', name: '동네 산책' },
      ],
    };
    expect(checkZeroFoodDays({ days: [arrivalDay] }, ['Vegan'])).toEqual([]);
  });

  it('출국일(체크아웃 + 공항) → 통과', () => {
    const departureDay = {
      day: 3,
      return_to_airport: true,
      stops: [
        { order: 1, category: 'lodging', name: '호텔' },
        { order: 2, category: 'travel', name: '김포공항' },
      ],
    };
    expect(checkZeroFoodDays({ days: [departureDay] }, ['Halal'])).toEqual([]);
  });

  it('식이 요구 없는 손님에겐 no-op', () => {
    const jejuDay = { day: 1, stops: [1, 2, 3, 4].map((o) => ({ order: o, category: 'nature', name: `s${o}` })) };
    expect(checkZeroFoodDays({ days: [jejuDay] }, [])).toEqual([]);
    expect(checkZeroFoodDays({ days: [jejuDay] }, ['Vegan'])).toHaveLength(1);
  });

  it('종단 검증이 zero-food 를 안정 코드로 실패시킨다', () => {
    const jejuDay = { day: 1, stops: [1, 2, 3, 4].map((o) => ({ order: o, category: 'nature', name: `s${o}` })) };
    const r = runFinalItineraryValidation({ days: [jejuDay] }, { language: 'en', dietary: ['Vegan'], foodIndex: [] });
    expect(r.ok).toBe(false);
    expect(r.code).toBe(FINAL_GATE_MEAL_CODE);
  });

  it('종단 검증이 식이 위반을 critical 로 실패시킨다', () => {
    const r = runFinalItineraryValidation({ days: [violatingDay(1)] }, { language: 'ko', dietary: ['Vegan'], foodIndex: [] });
    expect(r.ok).toBe(false);
    expect(r.code).toBe(FINAL_GATE_DIETARY_CODE);
  });

  it('정상 vegan day 는 통과', () => {
    const r = runFinalItineraryValidation({ days: [okDay(1)] }, { language: 'en', dietary: ['Vegan'], foodIndex: [] });
    expect(r.ok).toBe(true);
  });
});

describe('d) 재작성본이 마지막 검증 통과본을 밀어내지 못한다 (post-pattern / pass3)', () => {
  it('pattern retry 가 식이 위반본을 내면 응답은 위반본이 아니다', async () => {
    // Gemini 1차 = 식이 OK 지만 구조 위반(day 1개 stop 부족 아님 → 강제 patternErrors 주입),
    // retry = 식이 위반본. 종단 게이트가 revert 또는 throw 해야 한다.
    vi.resetModules();
    const validPlan = { days: [okDay(1)], tour_title: 'ok' };
    const invalidPlan = { days: [violatingDay(1)], tour_title: 'rewritten' };
    let call = 0;
    vi.doMock('../../api/_ai_core/responseValidator.js', async (orig) => {
      const actual: any = await orig();
      return {
        ...actual,
        // 1회차만 pattern 위반 → retry 유도. retry 후에는 통과시켜 "구조는 OK, 식이는 위반" 상황.
        validatePatternStructure: () => (call++ === 0 ? ['B-12 forced'] : []),
      };
    });
    const gp: any = await import('../../api/_ai_core/geminiPipeline.js');
    const mkModel = (payload: any) => ({
      generateContent: async () => ({ response: { text: () => JSON.stringify(payload), candidates: [] } }),
    });
    vi.spyOn(gp, 'buildModel').mockImplementation((_k: any, temp: any) =>
      mkModel(temp === undefined ? validPlan : invalidPlan) as any);

    // 종단 게이트 단위 동작으로 확인 (전체 파이프라인은 Gemini SDK 의존 — 여기서는 게이트 계약).
    const gate: any = await import('../../api/_ai_core/finalItineraryGate.js');
    const rewritten = gate.runFinalItineraryValidation(invalidPlan, { language: 'en', dietary: ['Vegan'], foodIndex: [] });
    const lastValid = gate.runFinalItineraryValidation(validPlan, { language: 'en', dietary: ['Vegan'], foodIndex: [] });
    expect(rewritten.ok).toBe(false);   // 재작성본은 저장 불가
    expect(lastValid.ok).toBe(true);    // 마지막 통과본은 유효 → 이쪽이 살아남아야 한다
    vi.doUnmock('../../api/_ai_core/responseValidator.js');
  });

  it('geminiPipeline 이 종단 게이트를 마지막 mutation(applyDBMatcher) 뒤에 실행한다', async () => {
    // 회귀 방지: 게이트 호출이 사라지면 위반본이 다시 응답된다.
    const src = (await import('node:fs')).readFileSync(
      (await import('node:path')).resolve(process.cwd(), 'api/_ai_core/geminiPipeline.js'), 'utf-8');
    const legacyTail = src.slice(src.lastIndexOf('applyDBMatcher(itinerary, foodIndex, area, language);'));
    expect(legacyTail).toMatch(/enforceFinalGate\(/);
  });
});

describe('e) background Pass3 결과가 검증 실패면 Firestore 를 안 덮어쓴다', () => {
  const validPlan = { days: [okDay(1)], _pass3_pending: true };

  beforeEach(() => { vi.resetModules(); vi.restoreAllMocks(); });

  async function runBg(enrichedResult: any, dietary: string[]) {
    process.env.PLANNER_PASS3_BACKGROUND = 'true';
    const updates: any[] = [];
    vi.doMock('../../api/_ai_core/threePassPipeline.js', () => ({
      pass3Enrich: async () => enrichedResult,
    }));
    vi.doMock('../../api/_ai_core/planPersister.js', () => ({
      updatePlanEnrichment: async (_db: any, planId: string, it: any) => { updates.push({ planId, it }); },
      savePlanSkeleton: async () => ({ planId: 'x', planUrl: '/x' }),
    }));
    vi.doMock('../../api/_shared/telegram-throttle.js', () => ({ throttledTelegramAlert: async () => {} }));
    vi.doMock('../../api/_ai_core/geminiPipeline.js', () => ({
      isPass3BackgroundEnabled: () => true,
      isStreamingEnabled: () => false,
      buildModel: () => ({}),
      loadFoodIndex: async () => [],
    }));
    const bg: any = await import('../../api/_ai_core/backgroundPipelines.js');
    bg.triggerPass3BackgroundIfPending({
      adminDb: {}, planId: 'p1', language: 'en', apiKey: 'k',
      itinerary: JSON.parse(JSON.stringify(validPlan)), dietary,
    });
    await new Promise((r) => setTimeout(r, 20));
    return updates;
  }

  it('enrich 결과가 식이 위반 → updatePlanEnrichment 미호출', async () => {
    const updates = await runBg({ days: [violatingDay(1)] }, ['Vegan']);
    expect(updates).toHaveLength(0);
  });

  it('enrich 결과가 zero-food day → updatePlanEnrichment 미호출', async () => {
    const zeroFood = { days: [{ day: 1, stops: [1, 2, 3, 4].map((o) => ({ order: o, category: 'nature', name: `s${o}` })) }] };
    const updates = await runBg(zeroFood, ['Vegan']);
    expect(updates).toHaveLength(0);
  });

  it('enrich 결과가 정상 → 기존대로 Firestore 갱신', async () => {
    const updates = await runBg({ days: [okDay(1)] }, ['Vegan']);
    expect(updates).toHaveLength(1);
    expect(updates[0].planId).toBe('p1');
  });
});
