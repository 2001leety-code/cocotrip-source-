/**
 * P167 (2026-05-23) — block-mode 다도시 지원 unit tests.
 *
 * 시나리오 5종:
 *   1. 단도시 (서울 5-day) — 기존 흐름 100% backward-compat (회귀 0)
 *   2. 2 도시 (서울 3-day + 부산 2-day, no dietary) — block-mode 성공, day-level city 보존
 *   3. 3 도시 (서울 + 부산 + 제주) — block-mode 성공, intercity city 보존
 *   4. dietary 매칭 실패 (vegan + 부산) — eligible: false graceful → legacy fallback
 *   5. lodging bookend 다도시 — 각 city day 의 lodging stop 이 그 city 호텔 (P122 학습)
 */
import { describe, it, expect, afterEach } from 'vitest';
import {
  fetchAvailableBlocksMultiCity,
  shouldUseBlockModeMultiCity,
  selectBlocksMultiCity,
  expandBlocksToItineraryMultiCity,
  tryRunBlockMode,
} from '../../api/_ai_core/blockMode.js';
import { normalizeRegionKey } from '../../api/_ai_core/responseValidator.js';

// ── fixture helpers ──────────────────────────────────────────────────────────

function makeBlock(
  id: string,
  city: string,
  opts: Partial<Record<string, unknown>> = {},
): Record<string, unknown> {
  return {
    id,
    city,
    zone: opts.zone || 'TestZone',
    theme: opts.theme || 'Test theme',
    intensity: opts.intensity || 'standard',
    block_type: 'city_day',
    duration_min: 480,
    dietary_options: (opts.dietary_options as string[]) || [],
    status: 'published',
    best_for: [],
    theme_i18n: { ko: 'Test', en: 'Test', ja: 'Test', zh: 'Test' },
    stops: (opts.stops as unknown[]) || [
      {
        order: 1,
        category: 'lodging',
        name: `${city} Hotel`,
        name_i18n: { ko: `${city} 호텔`, en: `${city} Hotel`, ja: `${city} Hotel`, zh: `${city} Hotel` },
        address: `${city} center`,
        stay_min: 0,
        entry_fee_krw: 0,
        reservation_required: false,
        start_time_offset_min: 0,
      },
      {
        order: 2,
        category: 'culture',
        name: `${city} Landmark`,
        name_i18n: { ko: `${city} 명소`, en: `${city} Landmark`, ja: `${city} L.`, zh: `${city} L.` },
        address: `${city}`,
        stay_min: 90,
        entry_fee_krw: 3000,
        reservation_required: false,
        start_time_offset_min: 0,
      },
      {
        order: 3,
        category: 'food',
        name: '',
        address: `${city}`,
        stay_min: 60,
        entry_fee_krw: 0,
        reservation_required: false,
        placeholder: 'verified_lunch',
        preferred_dietary: [],
        start_time_offset_min: 90,
      },
    ],
    ...opts,
  };
}

function makeMockDb(
  cityBlocksMap: Record<string, Array<{ id: string; data: Record<string, unknown> }>>,
  queriedCities?: string[],
) {
  return {
    collection() {
      return {
        where(field: string, _op: string, val: string) {
          // simulate chained where clauses
          const self = this as {
            _city?: string;
            _status?: string;
            where: typeof this.where;
            get: () => Promise<{ empty: boolean; forEach: (cb: (d: { id: string; data: () => Record<string, unknown> }) => void) => void }>;
          };
          if (field === 'city') { self._city = val; if (queriedCities) queriedCities.push(val); }
          if (field === 'status') self._status = val;
          return self;
        },
        get() {
          const self = this as { _city?: string };
          const city = self._city || '';
          const docs = cityBlocksMap[city] || [];
          return Promise.resolve({
            empty: docs.length === 0,
            forEach: (cb: (d: { id: string; data: () => Record<string, unknown> }) => void) => {
              for (const d of docs) cb({ id: d.id, data: () => d.data });
            },
          });
        },
      };
    },
  };
}

// ── 시나리오 1: 단도시 backward-compat ──────────────────────────────────────

describe('[P167 시나리오 1] 단도시 서울 5-day — backward-compat', () => {
  const originalEnv = process.env.PLANNER_BLOCK_MODE;
  afterEach(() => {
    if (originalEnv === undefined) delete process.env.PLANNER_BLOCK_MODE;
    else process.env.PLANNER_BLOCK_MODE = originalEnv;
  });

  it('shouldUseBlockModeMultiCity: 단도시 1-entry list는 그대로 eligible', () => {
    delete process.env.PLANNER_BLOCK_MODE;
    const seoulBlocks = [makeBlock('A', 'seoul'), makeBlock('B', 'seoul'), makeBlock('C', 'seoul')];
    const cityBlocksList = [{ city: 'seoul', blocks: seoulBlocks, ok: true }];
    const result = shouldUseBlockModeMultiCity(cityBlocksList, []);
    expect(result.eligible).toBe(true);
  });

  it('tryRunBlockMode: regions=[seoul_city] → single-city path (BLOCK_MODE_INELIGIBLE → skipped, not multi_city_not_supported)', async () => {
    delete process.env.PLANNER_BLOCK_MODE;
    // insufficient blocks → skipped with BLOCK_MODE_INELIGIBLE reason (not multi_city_not_supported)
    const db = makeMockDb({ seoul: [] }); // 0 blocks → insufficient
    const result = await tryRunBlockMode({
      adminDb: db,
      regions: ['seoul_city'],
      area: 'seoul',
      userInput: { durationDays: 5, dietPrefs: [], styles: [], language: 'en' },
      apiKey: 'test-key',
      foodIndex: [],
    });
    expect(result.skipped).toBe(true);
    // P167 회귀 검증: 'multi_city_not_supported' reason 이 절대 반환되지 않아야 함
    expect((result as { skipped: true; reason: string }).reason).not.toBe('multi_city_not_supported');
  });
});

// ── 시나리오 2: 2도시 서울+부산 ──────────────────────────────────────────────

describe('[P167 시나리오 2] 2도시 서울 3-day + 부산 2-day (no dietary)', () => {
  it('fetchAvailableBlocksMultiCity: 서울+부산 병렬 fetch', async () => {
    const db = makeMockDb({
      seoul: [
        { id: 's1', data: makeBlock('s1', 'seoul') },
        { id: 's2', data: makeBlock('s2', 'seoul') },
        { id: 's3', data: makeBlock('s3', 'seoul') },
      ],
      busan: [
        { id: 'b1', data: makeBlock('b1', 'busan') },
        { id: 'b2', data: makeBlock('b2', 'busan') },
        { id: 'b3', data: makeBlock('b3', 'busan') },
        { id: 'b4', data: makeBlock('b4', 'busan') },
        { id: 'b5', data: makeBlock('b5', 'busan') },
      ],
    });
    const result = await fetchAvailableBlocksMultiCity(db, ['seoul', 'busan'], []);
    expect(result).toHaveLength(2);
    expect(result[0].city).toBe('seoul');
    expect(result[0].blocks).toHaveLength(3);
    expect(result[0].ok).toBe(true);
    expect(result[1].city).toBe('busan');
    expect(result[1].blocks).toHaveLength(5);
    expect(result[1].ok).toBe(true);
  });

  it('shouldUseBlockModeMultiCity: 두 도시 모두 3+ blocks → eligible', () => {
    delete process.env.PLANNER_BLOCK_MODE;
    const cityBlocksList = [
      { city: 'seoul', blocks: [makeBlock('s1', 'seoul'), makeBlock('s2', 'seoul'), makeBlock('s3', 'seoul')], ok: true },
      { city: 'busan', blocks: [makeBlock('b1', 'busan'), makeBlock('b2', 'busan'), makeBlock('b3', 'busan')], ok: true },
    ];
    const result = shouldUseBlockModeMultiCity(cityBlocksList, []);
    expect(result.eligible).toBe(true);
  });

  it('expandBlocksToItineraryMultiCity: day-level city 보존 (서울 day → city=seoul)', () => {
    const seoulBlock = makeBlock('s1', 'seoul');
    const busanBlock = makeBlock('b1', 'busan');
    const cityBlocksList = [
      { city: 'seoul', blocks: [seoulBlock, makeBlock('s2', 'seoul'), makeBlock('s3', 'seoul')] },
      { city: 'busan', blocks: [busanBlock, makeBlock('b2', 'busan'), makeBlock('b3', 'busan')] },
    ];

    const blockSelections = {
      day_selections: [
        { day: 1, city: 'seoul', block_id: 's1', tweak_notes: '' },
        { day: 2, city: 'seoul', block_id: 's1', tweak_notes: '' },
        { day: 3, city: 'seoul', block_id: 's2', tweak_notes: '' },
        { day: 4, city: 'busan', block_id: 'b1', tweak_notes: '' },
        { day: 5, city: 'busan', block_id: 'b1', tweak_notes: '' },
      ],
    };

    const itinerary = expandBlocksToItineraryMultiCity(blockSelections, cityBlocksList, {
      durationDays: 5,
      language: 'en',
      startDate: '2026-06-01',
    });

    expect(itinerary.days).toHaveLength(5);
    expect(itinerary.planner_pipeline).toBe('block_mode');

    // city 보존 검증
    expect(itinerary.days[0].city).toBe('seoul');
    expect(itinerary.days[1].city).toBe('seoul');
    expect(itinerary.days[2].city).toBe('seoul');
    expect(itinerary.days[3].city).toBe('busan');
    expect(itinerary.days[4].city).toBe('busan');
  });
});

// ── 시나리오 3: 3도시 (서울+부산+제주) ───────────────────────────────────────

describe('[P167 시나리오 3] 3도시 서울+부산+제주', () => {
  it('shouldUseBlockModeMultiCity: 3 도시 모두 3+ blocks → eligible', () => {
    delete process.env.PLANNER_BLOCK_MODE;
    const cityBlocksList = [
      { city: 'seoul', blocks: [makeBlock('s1', 'seoul'), makeBlock('s2', 'seoul'), makeBlock('s3', 'seoul')], ok: true },
      { city: 'busan', blocks: [makeBlock('b1', 'busan'), makeBlock('b2', 'busan'), makeBlock('b3', 'busan')], ok: true },
      { city: 'jeju', blocks: [makeBlock('j1', 'jeju'), makeBlock('j2', 'jeju'), makeBlock('j3', 'jeju')], ok: true },
    ];
    const result = shouldUseBlockModeMultiCity(cityBlocksList, []);
    expect(result.eligible).toBe(true);
  });

  it('expandBlocksToItineraryMultiCity: 3 도시 city 필드 각각 보존', () => {
    const cityBlocksList = [
      { city: 'seoul', blocks: [makeBlock('s1', 'seoul'), makeBlock('s2', 'seoul'), makeBlock('s3', 'seoul')] },
      { city: 'busan', blocks: [makeBlock('b1', 'busan'), makeBlock('b2', 'busan'), makeBlock('b3', 'busan')] },
      { city: 'jeju', blocks: [makeBlock('j1', 'jeju'), makeBlock('j2', 'jeju'), makeBlock('j3', 'jeju')] },
    ];

    const blockSelections = {
      day_selections: [
        { day: 1, city: 'seoul', block_id: 's1', tweak_notes: '' },
        { day: 2, city: 'seoul', block_id: 's2', tweak_notes: '' },
        { day: 3, city: 'busan', block_id: 'b1', tweak_notes: '' },
        { day: 4, city: 'busan', block_id: 'b2', tweak_notes: '' },
        { day: 5, city: 'jeju', block_id: 'j1', tweak_notes: '' },
        { day: 6, city: 'jeju', block_id: 'j2', tweak_notes: '' },
      ],
    };

    const itinerary = expandBlocksToItineraryMultiCity(blockSelections, cityBlocksList, {
      durationDays: 6,
      language: 'en',
      startDate: '2026-07-01',
    });

    expect(itinerary.days).toHaveLength(6);
    const cities = itinerary.days.map((d) => d.city);
    expect(cities).toEqual(['seoul', 'seoul', 'busan', 'busan', 'jeju', 'jeju']);

    // intercity 전환 day 의 city 보존 (Day 2→3: seoul→busan)
    expect(itinerary.days[2].city).toBe('busan');
    expect(itinerary.days[2].source_block_id).toBe('b1');
  });
});

// ── 시나리오 4: dietary 매칭 실패 → eligible: false graceful ─────────────────

describe('[P167 시나리오 4] dietary 매칭 실패 (vegan + 부산) → eligible:false graceful', () => {
  it('shouldUseBlockModeMultiCity: 부산에 vegan block 없으면 ineligible (not throw)', () => {
    delete process.env.PLANNER_BLOCK_MODE;
    const cityBlocksList = [
      {
        city: 'seoul',
        blocks: [
          makeBlock('s1', 'seoul', { dietary_options: ['vegan'] }),
          makeBlock('s2', 'seoul', { dietary_options: ['vegan'] }),
          makeBlock('s3', 'seoul', { dietary_options: ['vegan'] }),
        ],
        ok: true,
      },
      {
        city: 'busan',
        // 부산에 vegan block 없음 (dietary_options: [])
        blocks: [
          makeBlock('b1', 'busan', { dietary_options: [] }),
          makeBlock('b2', 'busan', { dietary_options: [] }),
          makeBlock('b3', 'busan', { dietary_options: [] }),
        ],
        ok: true,
      },
    ];
    const result = shouldUseBlockModeMultiCity(cityBlocksList, ['vegan']);
    expect(result.eligible).toBe(false);
    expect(result.reason).toMatch(/no_dietary_block_for_busan/);
  });

  it('fetchAvailableBlocksMultiCity: fetch 실패 도시 → ok:false (throw 안 함)', async () => {
    // fetchAvailableBlocks 내부가 Firestore get() 예외를 catch 해 []를 반환함.
    // fetchAvailableBlocksMultiCity 는 이를 ok:true + blocks:[] 로 래핑 — catch 까지 안 감.
    // 따라서 ok:false 는 fetchAvailableBlocks 자체가 throw 하는 경우에만 발생 (현재 구현상 없음).
    // 테스트: 빈 결과 도시가 graceful(throw 없이) ok:true + blocks:[] 로 반환되는지 검증.
    const emptyDb = {
      collection() {
        return {
          _city: undefined as string | undefined,
          where(field: string, _op: string, val: string) {
            if (field === 'city') this._city = val;
            return this;
          },
          get: async () => ({
            // 항상 empty — get() 실패 없이 아무 결과도 없는 경우 시뮬레이션
            empty: true,
            forEach: (_cb: unknown) => {},
          }),
        };
      },
    };
    const result = await fetchAvailableBlocksMultiCity(emptyDb, ['seoul', 'busan'], []);
    // 예외 없이 graceful 반환 확인
    expect(result).toHaveLength(2);
    expect(result[0].ok).toBe(true);
    expect(result[0].blocks).toEqual([]);
    expect(result[1].ok).toBe(true);
    expect(result[1].blocks).toEqual([]);
  });

  it('shouldUseBlockModeMultiCity: fetch 실패 도시 (ok:false) → ineligible', () => {
    delete process.env.PLANNER_BLOCK_MODE;
    const cityBlocksList = [
      { city: 'seoul', blocks: [makeBlock('s1', 'seoul'), makeBlock('s2', 'seoul'), makeBlock('s3', 'seoul')], ok: true },
      { city: 'busan', blocks: [], ok: false },
    ];
    const result = shouldUseBlockModeMultiCity(cityBlocksList, []);
    expect(result.eligible).toBe(false);
    expect(result.reason).toMatch(/insufficient_blocks_for_busan/);
  });
});

// ── 시나리오 5: lodging bookend 다도시 (P122 학습) ───────────────────────────

describe('[P167 시나리오 5] lodging bookend 다도시 — city 정합성 검증', () => {
  it('expandBlocksToItineraryMultiCity: city mismatch block → throw', () => {
    // 부산 day 에 서울 block 박히면 throw
    const cityBlocksList = [
      { city: 'seoul', blocks: [makeBlock('s1', 'seoul'), makeBlock('s2', 'seoul'), makeBlock('s3', 'seoul')] },
      { city: 'busan', blocks: [makeBlock('b1', 'busan'), makeBlock('b2', 'busan'), makeBlock('b3', 'busan')] },
    ];

    const blockSelections = {
      day_selections: [
        { day: 1, city: 'seoul', block_id: 's1', tweak_notes: '' },
        { day: 2, city: 'busan', block_id: 's2', tweak_notes: '' }, // ← s2 = 서울 block, busan day 에 박힘 = mismatch
      ],
    };

    expect(() => expandBlocksToItineraryMultiCity(blockSelections, cityBlocksList, {
      durationDays: 2,
      language: 'en',
    })).toThrow(/city mismatch/i);
  });

  it('expandBlocksToItineraryMultiCity: hotelByCity[city] 가 day.lodging 에 반영됨 (P123 학습)', () => {
    const cityBlocksList = [
      { city: 'seoul', blocks: [makeBlock('s1', 'seoul'), makeBlock('s2', 'seoul'), makeBlock('s3', 'seoul')] },
      { city: 'busan', blocks: [makeBlock('b1', 'busan'), makeBlock('b2', 'busan'), makeBlock('b3', 'busan')] },
    ];

    const blockSelections = {
      day_selections: [
        { day: 1, city: 'seoul', block_id: 's1', tweak_notes: '' },
        { day: 2, city: 'seoul', block_id: 's2', tweak_notes: '' },
        { day: 3, city: 'busan', block_id: 'b1', tweak_notes: '' },
        { day: 4, city: 'busan', block_id: 'b2', tweak_notes: '' },
      ],
    };

    const itinerary = expandBlocksToItineraryMultiCity(blockSelections, cityBlocksList, {
      durationDays: 4,
      language: 'en',
      hotelByCity: {
        seoul: '명동 호텔 주소',
        busan: '해운대 그랜드 호텔',
      },
    });

    // 서울 day 의 lodging hint = 서울 호텔
    expect(itinerary.days[0].lodging?.name).toBe('명동 호텔 주소');
    expect(itinerary.days[1].lodging?.name).toBe('명동 호텔 주소');

    // 부산 day 의 lodging hint = 부산 호텔 (서울 호텔 박히면 안 됨 — P122 핵심)
    expect(itinerary.days[2].lodging?.name).toBe('해운대 그랜드 호텔');
    expect(itinerary.days[3].lodging?.name).toBe('해운대 그랜드 호텔');
  });

  it('expandBlocksToItineraryMultiCity: dietary 사용자 food placeholder 미매칭 → BLOCK_MODE_DIETARY_UNSATISFIED throw', () => {
    const blockWithFood = makeBlock('s1', 'seoul', {
      stops: [
        { order: 1, category: 'lodging', name: 'Seoul Hotel', address: 'Seoul', stay_min: 0, entry_fee_krw: 0, reservation_required: false, start_time_offset_min: 0 },
        { order: 2, category: 'culture', name: 'Palace', address: 'Seoul', stay_min: 90, entry_fee_krw: 3000, reservation_required: false, start_time_offset_min: 0 },
        { order: 3, category: 'food', name: '', address: 'Seoul', stay_min: 60, entry_fee_krw: 0, reservation_required: false, placeholder: 'verified_lunch', preferred_dietary: [], start_time_offset_min: 90 },
      ],
    });
    const cityBlocksList = [
      { city: 'seoul', blocks: [blockWithFood, makeBlock('s2', 'seoul'), makeBlock('s3', 'seoul')] },
      { city: 'busan', blocks: [makeBlock('b1', 'busan'), makeBlock('b2', 'busan'), makeBlock('b3', 'busan')] },
    ];

    const blockSelections = {
      day_selections: [{ day: 1, city: 'seoul', block_id: 's1', tweak_notes: '' }],
    };

    expect(() => expandBlocksToItineraryMultiCity(blockSelections, cityBlocksList, {
      durationDays: 1,
      language: 'en',
      dietPrefs: ['vegan'],
      foodIndex: [{ name: '일반식당', city: 'seoul', type: 'restaurant', dietary_tags: [], rating: 4, reviews: 100 }],
    })).toThrow(/dietary/i);
  });
});

// ── 시나리오 6: P321 한글 regions → 영문 cityKey 정규화 ──────────────────────
describe('[P321] 한글 regions 정규화 — block_mode silent legacy 폴백 방지', () => {
  const originalEnv = process.env.PLANNER_BLOCK_MODE;
  afterEach(() => {
    if (originalEnv === undefined) delete process.env.PLANNER_BLOCK_MODE;
    else process.env.PLANNER_BLOCK_MODE = originalEnv;
  });

  it('normalizeRegionKey: 한글 → 영문, 영문/unmapped → 그대로 (회귀 0)', () => {
    expect(normalizeRegionKey('서울')).toBe('seoul');
    expect(normalizeRegionKey('부산')).toBe('busan');
    expect(normalizeRegionKey('강릉')).toBe('gangneung');
    expect(normalizeRegionKey('Seoul')).toBe('seoul'); // 영문 그대로 (회귀 0)
    expect(normalizeRegionKey('busan')).toBe('busan');
  });

  it('tryRunBlockMode: 한글 다도시(["서울","부산"]) → Firestore 영문 키로 조회 (버그 fix)', async () => {
    delete process.env.PLANNER_BLOCK_MODE;
    const queried: string[] = [];
    // seoul 2개(<3) → eligible false → Gemini 안 거침(네트워크 0). 조회 city 추적만으로 정규화 검증.
    const db = makeMockDb({
      seoul: [makeBlock('s1', 'seoul'), makeBlock('s2', 'seoul')],
      busan: [makeBlock('b1', 'busan'), makeBlock('b2', 'busan'), makeBlock('b3', 'busan')],
    }, queried);
    const result = await tryRunBlockMode({
      adminDb: db,
      regions: ['서울', '부산'],
      area: 'seoul_city',
      userInput: { durationDays: 5, dietPrefs: [], styles: [], language: 'ko' },
      apiKey: 'test-key',
      foodIndex: [],
    });
    // 정규화 성공 = Firestore 'seoul'/'busan' 영문 키로 조회 (한글 '서울' 조회 = 0건 버그 방지)
    expect(queried).toContain('seoul');
    expect(queried).toContain('busan');
    expect(queried).not.toContain('서울');
    expect(queried).not.toContain('부산');
    expect(result.skipped).toBe(true); // 블록 2<3 이라 결국 skip — 단 '영문으로 조회됨'이 핵심
  });

  it('tryRunBlockMode: 영문 다도시(["Seoul","Busan"]) 회귀 0 — 동일 영문 조회', async () => {
    delete process.env.PLANNER_BLOCK_MODE;
    const queried: string[] = [];
    const db = makeMockDb({
      seoul: [makeBlock('s1', 'seoul'), makeBlock('s2', 'seoul')],
      busan: [makeBlock('b1', 'busan'), makeBlock('b2', 'busan'), makeBlock('b3', 'busan')],
    }, queried);
    await tryRunBlockMode({
      adminDb: db,
      regions: ['Seoul', 'Busan'],
      area: 'seoul_city',
      userInput: { durationDays: 5, dietPrefs: [], styles: [], language: 'en' },
      apiKey: 'test-key',
      foodIndex: [],
    });
    expect(queried).toContain('seoul');
    expect(queried).toContain('busan');
  });
});
