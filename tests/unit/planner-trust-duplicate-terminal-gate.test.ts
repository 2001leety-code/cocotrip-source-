/**
 * 종단 중복 게이트 (2026-08-24) — 완결 일정에 관광지·식당 중복이 0건이어야 한다.
 * 호텔/숙소 bookend 는 canonical 분류(qualityMetrics.findDuplicateStops, isLodging)로만 예외.
 *
 *   a) 순수 게이트: 비호텔 중복 → fail-closed, 호텔 반복 → 통과
 *   b) sync 경로(post_response/block_mode) — 마지막 mutation 뒤 회귀 방지
 *   c) background Pass3 경로 — 중복 있는 enrich 결과가 Firestore 를 덮어쓰지 않는다
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  runDuplicateStopGate, assertNoDuplicateStops, FINAL_GATE_DUPLICATE_CODE, FINAL_GATE_DIETARY_CODE,
} from '../../api/_ai_core/finalItineraryGate.js';
import { findDuplicateStops } from '../../api/_ai_core/qualityMetrics.js';

const dupDay = (dayNum: number) => ({
  day: dayNum,
  stops: [
    { order: 1, category: 'lodging', name: '호텔' },
    { order: 2, category: 'culture', name: '경복궁', address: '서울특별시 종로구 1' },
    { order: 3, category: 'food', name: '비건 하우스', address: '서울특별시 종로구 12' },
    { order: 4, category: 'culture', name: '경복궁', address: '서울특별시 종로구 1' }, // 진짜 중복
    { order: 5, category: 'lodging', name: '호텔' },
  ],
});
const okDay = (dayNum: number) => ({
  day: dayNum,
  stops: [
    { order: 1, category: 'lodging', name: '호텔' },
    { order: 2, category: 'culture', name: '경복궁', address: '서울특별시 종로구 1' },
    { order: 3, category: 'food', name: '비건 하우스', address: '서울특별시 종로구 12' },
    { order: 4, category: 'culture', name: '북촌', address: '서울특별시 종로구 3' },
    { order: 5, category: 'lodging', name: '호텔' },
  ],
});
// day2 는 okDay 와 비호텔 stop 이름이 전부 달라야 한다 — 같은 이름을 쓰면
// (findDuplicateStops 는 day 를 안 가리고 전체 stop 을 flatten 하므로) day 간
// 교차 중복으로 잡혀 "호텔만 반복되는" 케이스를 검증할 수 없다.
const okDay2 = (dayNum: number) => ({
  day: dayNum,
  stops: [
    { order: 1, category: 'lodging', name: '호텔' },
    { order: 2, category: 'culture', name: '남산타워', address: '서울특별시 용산구 1' },
    { order: 3, category: 'food', name: '한옥 비건 식당', address: '서울특별시 용산구 12' },
    { order: 4, category: 'culture', name: '이태원', address: '서울특별시 용산구 3' },
    { order: 5, category: 'lodging', name: '호텔' },
  ],
});

describe('a) 순수 게이트 — findDuplicateStops / runDuplicateStopGate', () => {
  it('관광지 재등장은 중복으로 잡는다', () => {
    const dups = findDuplicateStops({ days: [dupDay(1)] });
    expect(dups).toEqual([{ name: '경복궁', count: 2 }]);
    const r = runDuplicateStopGate({ days: [dupDay(1)] });
    expect(r.ok).toBe(false);
    expect(r.code).toBe(FINAL_GATE_DUPLICATE_CODE);
    expect(r.duplicates).toEqual([{ name: '경복궁', count: 2 }]);
  });

  it('같은 호텔이 day 시작/끝에 반복돼도 통과 (설계된 bookend, 예외)', () => {
    const r = runDuplicateStopGate({ days: [okDay(1)] });
    expect(r.ok).toBe(true);
    expect(r.duplicates).toEqual([]);
  });

  it('여러 day 에 걸쳐 같은 호텔이 반복돼도 통과 — 호텔은 항상 예외', () => {
    const r = runDuplicateStopGate({ days: [okDay(1), okDay2(2)] });
    expect(r.ok).toBe(true);
    expect(r.duplicates).toEqual([]);
  });

  it('cross-day 식당 중복 — 다른 day 에 같은 식당이 다시 나오면 fail', () => {
    const day1 = okDay(1); // food: 비건 하우스
    const day2 = { ...okDay2(2), stops: okDay2(2).stops.map((s) => (
      s.name === '한옥 비건 식당' ? { ...s, name: '비건 하우스' } : s // day1 과 같은 식당 재등장
    )) };
    const r = runDuplicateStopGate({ days: [day1, day2] });
    expect(r.ok).toBe(false);
    expect(r.code).toBe(FINAL_GATE_DUPLICATE_CODE);
    expect(r.duplicates).toEqual([{ name: '비건 하우스', count: 2 }]);
  });

  it('식이 요구 유무와 무관하게 항상 돈다 (ctx 자체를 안 받음)', () => {
    // runDuplicateStopGate 는 dietary 파라미터가 없다 — 시그니처 자체가 증거.
    expect(runDuplicateStopGate.length).toBe(1);
  });

  it('assertNoDuplicateStops 는 중복이면 stable code 로 throw, 부분성공/저장 없음', () => {
    let caught: unknown = null;
    try { assertNoDuplicateStops({ days: [dupDay(1)] }, 'post_response'); }
    catch (e) { caught = e; }
    expect(caught).toBeTruthy();
    const err = caught as { code?: string; statusCode?: number; stage?: string };
    expect(err.code).toBe(FINAL_GATE_DUPLICATE_CODE);
    expect(err.statusCode).toBe(422);
    expect(err.stage).toBe('post_response');
  });

  it('assertNoDuplicateStops 는 중복 없으면 조용히 통과', () => {
    expect(() => assertNoDuplicateStops({ days: [okDay(1)] }, 'post_response')).not.toThrow();
  });
});

describe('b) sync 경로 — 마지막 mutation 뒤 회귀 방지 (source 계약)', () => {
  it('postResponsePipeline 이 assertFinalItineraryValid 뒤에 assertNoDuplicateStops 를 호출한다', async () => {
    const src = (await import('node:fs')).readFileSync(
      (await import('node:path')).resolve(process.cwd(), 'api/_ai_core/postResponsePipeline.js'), 'utf-8');
    const dietaryIdx = src.indexOf('assertFinalItineraryValid(');
    const dupIdx = src.indexOf('assertNoDuplicateStops(');
    expect(dietaryIdx).toBeGreaterThan(-1);
    expect(dupIdx).toBeGreaterThan(dietaryIdx);
  });
});

describe('c) background Pass3 — 중복 있는 enrich 결과가 Firestore 를 안 덮어쓴다', () => {
  const validPlan = { days: [okDay(1)], _pass3_pending: true };

  beforeEach(() => { vi.resetModules(); vi.restoreAllMocks(); });

  async function runBg(enrichedResult: Record<string, unknown>) {
    process.env.PLANNER_PASS3_BACKGROUND = 'true';
    const updates: Array<{ planId: string; it: unknown }> = [];
    const settled: string[] = []; // fire-and-forget IIFE 종료 마킹 — 성공/스킵 두 경로 모두 채움
    vi.doMock('../../api/_ai_core/threePassPipeline.js', () => ({
      pass3Enrich: async () => enrichedResult,
    }));
    vi.doMock('../../api/_ai_core/planPersister.js', () => ({
      updatePlanEnrichment: async (_db: unknown, planId: string, it: unknown) => {
        updates.push({ planId, it });
        settled.push('updated');
      },
      savePlanSkeleton: async () => ({ planId: 'x', planUrl: '/x' }),
    }));
    vi.doMock('../../api/_shared/telegram-throttle.js', () => ({
      throttledTelegramAlert: async () => { settled.push('alert'); },
    }));
    vi.doMock('../../api/_ai_core/geminiPipeline.js', () => ({
      isPass3BackgroundEnabled: () => true,
      isStreamingEnabled: () => false,
      buildModel: () => ({}),
      loadFoodIndex: async () => [],
    }));
    const bg = await import('../../api/_ai_core/backgroundPipelines.js') as {
      triggerPass3BackgroundIfPending: (ctx: Record<string, unknown>) => void;
    };
    bg.triggerPass3BackgroundIfPending({
      adminDb: {}, planId: 'p1', language: 'en', apiKey: 'k',
      itinerary: JSON.parse(JSON.stringify(validPlan)), dietary: [],
    });
    // 게이트 실패 시 updates 는 끝까지 0 이므로 updates 만 기다리면 통과-스킵 케이스가 멈춘다.
    // settled(성공 write 또는 실패 alert) 를 기다려야 두 분기 모두 고정 sleep 없이 결정론적.
    await vi.waitFor(() => { if (settled.length === 0) throw new Error('not settled yet'); });
    return updates;
  }

  it('enrich 결과에 관광지 중복 → updatePlanEnrichment 미호출 (좋은 plan 을 안 덮어씀)', async () => {
    const updates = await runBg({ days: [dupDay(1)] });
    expect(updates).toHaveLength(0);
  });

  it('enrich 결과가 정상(중복 없음) → 기존대로 Firestore 갱신', async () => {
    const updates = await runBg({ days: [okDay(1)] });
    expect(updates).toHaveLength(1);
  });
});

describe('d) applyRecommendedRestaurants — 실제 실행 순서 (식이 게이트 먼저, 중복 게이트 나중)', () => {
  beforeEach(() => { vi.resetModules(); vi.restoreAllMocks(); });

  async function loadApplyRecommendedRestaurants() {
    vi.doMock('../../api/_ai_core/geminiPipeline.js', () => ({ loadFoodIndex: async () => [] }));
    vi.doMock('../../api/_ai_core/recommendedRestaurants.js', () => ({
      pickRecommendedRestaurantsByStyle: () => ({ general: [] }),
    }));
    const mod = await import('../../api/_ai_core/postResponsePipeline.js') as {
      applyRecommendedRestaurants: (itinerary: unknown, ctx: Record<string, unknown>) => Promise<unknown>;
    };
    return mod.applyRecommendedRestaurants;
  }

  const dupOnlyItinerary = () => ({
    days: [{
      day: 1,
      stops: [
        { order: 1, category: 'lodging', name: '호텔' },
        { order: 2, category: 'culture', name: '경복궁', address: '서울특별시 종로구 1' },
        { order: 3, category: 'food', name: '비건 하우스', address: '서울특별시 종로구 12' },
        { order: 4, category: 'culture', name: '경복궁', address: '서울특별시 종로구 1' }, // 중복
        { order: 5, category: 'lodging', name: '호텔' },
      ],
    }],
  });

  const dietaryAndDupItinerary = () => ({
    days: [{
      day: 1,
      stops: [
        { order: 1, category: 'lodging', name: '호텔' },
        { order: 2, category: 'culture', name: '경복궁', address: '서울특별시 종로구 1' },
        { order: 3, category: 'food', name: '일반 식당', address: '서울특별시 종로구 12' }, // vegan claim 없음 → 위반
        { order: 4, category: 'culture', name: '경복궁', address: '서울특별시 종로구 1' }, // 중복도 있음
        { order: 5, category: 'lodging', name: '호텔' },
      ],
    }],
  });

  it('식이 요구 없음 + 중복 있음 → 중복 게이트가 잡아 throw', async () => {
    const applyRecommendedRestaurants = await loadApplyRecommendedRestaurants();
    let caught: unknown = null;
    try {
      await applyRecommendedRestaurants(dupOnlyItinerary(), {
        area: 'seoul', dietPrefs: [], regions: ['seoul'], blockModeUsed: false, language: 'en', styles: [],
      });
    } catch (e) { caught = e; }
    expect((caught as { code?: string } | null)?.code).toBe(FINAL_GATE_DUPLICATE_CODE);
  });

  it('식이 위반 + 중복 둘 다 있음 → 식이 게이트가 먼저 잡아 throw (중복 게이트까지 안 감)', async () => {
    const applyRecommendedRestaurants = await loadApplyRecommendedRestaurants();
    let caught: unknown = null;
    try {
      await applyRecommendedRestaurants(dietaryAndDupItinerary(), {
        area: 'seoul', dietPrefs: ['vegan'], regions: ['seoul'], blockModeUsed: false, language: 'en', styles: [],
      });
    } catch (e) { caught = e; }
    expect((caught as { code?: string } | null)?.code).toBe(FINAL_GATE_DIETARY_CODE);
  });

  it('식이 요구 없음 + 중복 없음 → 정상 통과, foodIndex 반환', async () => {
    const applyRecommendedRestaurants = await loadApplyRecommendedRestaurants();
    const result = await applyRecommendedRestaurants({ days: [okDay(1)] }, {
      area: 'seoul', dietPrefs: [], regions: ['seoul'], blockModeUsed: false, language: 'en', styles: [],
    });
    expect(Array.isArray(result)).toBe(true);
  });
});
