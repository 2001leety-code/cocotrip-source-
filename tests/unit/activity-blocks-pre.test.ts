/**
 * PR-E (2026-06-01): 트레킹/러닝 block_mode 편입 — feature flag (FEATURE_ACTIVITY_BLOCKS).
 *
 * Source: api/_ai_core/blockMode.js
 *
 * 끊긴 고리 #1 — fetchAvailableBlocks 가 block_type !== 'city_day' 를 명시적 제외
 *   (blockMode.js fetchAvailableBlocks) → P321 전환된 빠른 block_mode 경로에서
 *   트레킹/러닝 day 선택 불가. 위저드 칩·4lang·헬퍼·zone_courses(trekking 3 + running 2)
 *   인프라는 prod 가동 중이나 block_mode 만 버림.
 *
 * 검증:
 *   (a) flag OFF (미설정/'false') → fetchAvailableBlocks 가 trekking/running 제외 (현재 동작 byte-identical)
 *   (b) flag ON  ('true')        → trekking/running_route 포함
 *   (c) SAFETY — buildActivityMeta + expand 가 trekking_meta(난이도/체력/hazards/unsuitable_for) 보존
 *   (d) SAFETY — 거동 제약(mobility) 손님은 wheelchair_user unsuitable_for 활동 블록 제외
 *   (e) 프롬프트 — flag OFF 시 system prompt 문자열 byte-identical, ON 시 활동 규칙 append
 *
 * 주의: 백엔드 모듈(api/_ai_core/blockMode.js)만 import — firebase 의존 클라이언트
 *   컴포넌트 import 금지 (CI "0 test" crash 방지, R_Phase1 가드 패턴).
 */
import { describe, it, expect, afterEach } from 'vitest';
import {
  fetchAvailableBlocks,
  buildActivityMeta,
  expandBlocksToItinerary,
  buildBlockSelectionSystemPrompt,
  isActivityBlocksEnabled,
  isLimitedMobility,
} from '../../api/_ai_core/blockMode.js';

// ── fixtures ──────────────────────────────────────────────────────────────

function makeCityDayBlock(id: string, city = 'seoul') {
  return {
    id,
    city,
    zone: 'Jongno',
    theme: 'City day',
    intensity: 'standard',
    block_type: 'city_day',
    duration_min: 480,
    status: 'published',
    best_for: ['first_time_visitor'],
    dietary_options: [],
    unsuitable_for: [],
    stops: [
      { order: 1, category: 'culture', name: 'Palace', address: 'Seoul', stay_min: 90, entry_fee_krw: 3000, reservation_required: false, start_time_offset_min: 0 },
      { order: 2, category: 'culture', name: 'Museum', address: 'Seoul', stay_min: 60, entry_fee_krw: 0, reservation_required: false, start_time_offset_min: 120 },
      { order: 3, category: 'culture', name: 'Market', address: 'Seoul', stay_min: 60, entry_fee_krw: 0, reservation_required: false, start_time_offset_min: 240 },
    ],
  };
}

// 실제 jeju_hallasan_seongpanak_packed.json 구조 반영 (trekking_meta + unsuitable_for).
function makeTrekkingBlock(id = 'JEJU_TREK', city = 'jeju') {
  return {
    id,
    city,
    zone: 'Hallasan Seongpanak',
    theme: '한라산 성판악 코스',
    intensity: 'packed',
    block_type: 'trekking',
    duration_min: 165,
    status: 'published',
    best_for: ['expert_hiker', 'nature_lover'],
    dietary_options: [],
    unsuitable_for: ['wheelchair_user', 'elderly', 'young_children', 'altitude_sensitive'],
    requires_advance_booking: true,
    trekking_meta: {
      total_distance_km: 9.6,
      elevation_gain_m: 750,
      difficulty: 'expert',
      estimated_duration_min: 480,
      hazards: ['high_altitude_weather_change', 'no_water_above_4km', '12_30_pm_cutoff_at_jindallae'],
      recommended_gear: ['trekking_pole', 'water_2L', 'crampons_winter'],
    },
    stops: [
      { order: 1, category: 'culture', name: '성판악탐방안내소', address: '제주', stay_min: 30, entry_fee_krw: 0, reservation_required: true, start_time_offset_min: 0 },
      { order: 2, category: 'food', name: '', address: '제주', stay_min: 45, entry_fee_krw: 0, reservation_required: false, placeholder: 'verified_lunch', preferred_dietary: [], start_time_offset_min: 45 },
      { order: 3, category: 'nature', name: '백록담 정상', address: '제주', stay_min: 60, entry_fee_krw: 0, reservation_required: false, start_time_offset_min: 105 },
    ],
  };
}

// 실제 jeju_olle_7_5km_running.json 구조 반영 (running_meta).
function makeRunningBlock(id = 'JEJU_RUN', city = 'jeju') {
  return {
    id,
    city,
    zone: 'Jeju Olle Trail 7',
    theme: '제주 올레길 7코스 5.5km',
    intensity: 'relaxed',
    block_type: 'running_route',
    duration_min: 85,
    status: 'published',
    best_for: ['runner', 'morning_person'],
    dietary_options: [],
    unsuitable_for: ['wheelchair_user'],
    requires_advance_booking: false,
    running_meta: {
      total_km: 5.5,
      elevation_gain_m: 45,
      difficulty: 'beginner',
      surface_type: 'mixed',
    },
    stops: [
      { order: 1, category: 'activity', name: '외돌개', address: '제주', stay_min: 15, entry_fee_krw: 0, reservation_required: false, start_time_offset_min: 0 },
      { order: 2, category: 'nature', name: '돔베낭길', address: '제주', stay_min: 10, entry_fee_krw: 0, reservation_required: false, start_time_offset_min: 30 },
      { order: 3, category: 'food', name: '법환포구 카페', address: '제주', stay_min: 30, entry_fee_krw: 0, reservation_required: false, start_time_offset_min: 55 },
    ],
  };
}

function makeMockDb(docs: Array<{ id: string; data: Record<string, unknown> }>) {
  return {
    collection() {
      return {
        where() { return this; },
        get: async () => ({
          empty: docs.length === 0,
          forEach: (cb: (d: { id: string; data: () => Record<string, unknown> }) => void) => {
            for (const d of docs) cb({ id: d.id, data: () => d.data });
          },
        }),
      };
    },
  };
}

const ENV_KEY = 'FEATURE_ACTIVITY_BLOCKS';
const originalEnv = process.env[ENV_KEY];
afterEach(() => {
  if (originalEnv === undefined) delete process.env[ENV_KEY];
  else process.env[ENV_KEY] = originalEnv;
});

// ── (a) flag OFF — 현재 동작 byte-identical (trekking/running 제외) ──────────
describe('[PR-E] flag OFF → trekking/running 제외 (현재 동작 보존)', () => {
  it('미설정 → isActivityBlocksEnabled()=false', () => {
    delete process.env[ENV_KEY];
    expect(isActivityBlocksEnabled()).toBe(false);
  });

  it("'false' / 잡값 → false (P102 CRLF strip 포함)", () => {
    process.env[ENV_KEY] = 'false';
    expect(isActivityBlocksEnabled()).toBe(false);
    process.env[ENV_KEY] = 'yes';
    expect(isActivityBlocksEnabled()).toBe(false);
    process.env[ENV_KEY] = ' TRUE\r\n';
    expect(isActivityBlocksEnabled()).toBe(true); // case-insensitive + CRLF strip
  });

  it('flag OFF → fetchAvailableBlocks 가 city_day 만 반환 (trekking/running drop)', async () => {
    delete process.env[ENV_KEY];
    const db = makeMockDb([
      { id: 'CITY', data: makeCityDayBlock('CITY', 'jeju') },
      { id: 'TREK', data: makeTrekkingBlock('TREK', 'jeju') },
      { id: 'RUN', data: makeRunningBlock('RUN', 'jeju') },
    ]);
    const blocks = await fetchAvailableBlocks(db, 'jeju');
    expect(blocks.map((b) => b.id)).toEqual(['CITY']);
  });
});

// ── (b) flag ON — trekking/running_route 포함 ───────────────────────────────
describe('[PR-E] flag ON → 활동 블록 포함', () => {
  it("flag ON → fetchAvailableBlocks 가 city_day + trekking + running_route 모두 반환", async () => {
    process.env[ENV_KEY] = 'true';
    const db = makeMockDb([
      { id: 'CITY', data: makeCityDayBlock('CITY', 'jeju') },
      { id: 'TREK', data: makeTrekkingBlock('TREK', 'jeju') },
      { id: 'RUN', data: makeRunningBlock('RUN', 'jeju') },
    ]);
    const blocks = await fetchAvailableBlocks(db, 'jeju');
    expect(blocks.map((b) => b.id).sort()).toEqual(['CITY', 'RUN', 'TREK']);
  });

  it('flag ON 이어도 stops < 3 인 활동 블록은 여전히 invalid (기존 가드 유지)', async () => {
    process.env[ENV_KEY] = 'true';
    const thin = makeTrekkingBlock('THIN', 'jeju');
    thin.stops = thin.stops.slice(0, 2); // 2 stops only
    const db = makeMockDb([{ id: 'THIN', data: thin }]);
    const blocks = await fetchAvailableBlocks(db, 'jeju');
    expect(blocks).toEqual([]);
  });

  it('flag ON 이어도 unknown block_type 은 제외 (allowlist = city_day + trekking + running_route 만)', async () => {
    process.env[ENV_KEY] = 'true';
    const weird = makeCityDayBlock('WEIRD', 'jeju');
    weird.block_type = 'boat_tour';
    const db = makeMockDb([{ id: 'WEIRD', data: weird }]);
    const blocks = await fetchAvailableBlocks(db, 'jeju');
    expect(blocks).toEqual([]);
  });
});

// ── (c) SAFETY — trekking_meta / running_meta 보존 ──────────────────────────
describe('[PR-E SAFETY] buildActivityMeta — 난이도/체력/hazards/부적합 보존', () => {
  it('trekking → difficulty/elevation/distance/hazards/unsuitable_for 보존', () => {
    const meta = buildActivityMeta(makeTrekkingBlock());
    expect(meta).toBeTruthy();
    expect(meta!.activity_type).toBe('trekking');
    expect(meta!.difficulty).toBe('expert');
    expect(meta!.elevation_gain_m).toBe(750);
    expect(meta!.distance_km).toBe(9.6);
    expect(meta!.estimated_duration_min).toBe(480);
    expect(meta!.hazards).toContain('12_30_pm_cutoff_at_jindallae');
    expect(meta!.unsuitable_for).toContain('wheelchair_user');
    expect(meta!.unsuitable_for).toContain('altitude_sensitive');
    expect(meta!.requires_advance_booking).toBe(true);
  });

  it('running_route → difficulty + total_km(=distance_km) 보존', () => {
    const meta = buildActivityMeta(makeRunningBlock());
    expect(meta!.activity_type).toBe('running_route');
    expect(meta!.difficulty).toBe('beginner');
    expect(meta!.distance_km).toBe(5.5); // total_km 매핑
    expect(meta!.elevation_gain_m).toBe(45);
    expect(meta!.unsuitable_for).toEqual(['wheelchair_user']);
  });

  it('city_day → null (메타 부재, day shape 불변)', () => {
    expect(buildActivityMeta(makeCityDayBlock('CITY'))).toBeNull();
  });

  it('expandBlocksToItinerary → trekking day 에 activity_meta attach + quality_warning 박제', () => {
    const trek = makeTrekkingBlock('TREK', 'jeju');
    const sel = { day_selections: [{ day: 1, block_id: 'TREK', tweak_notes: '' }] };
    const out = expandBlocksToItinerary(sel, [trek], {
      durationDays: 1,
      language: 'en',
      area: 'jeju',
      startDate: '2026-06-01',
      // 일반 식당 매칭 (dietary 미강제) — placeholder food stop 합성 허용
      foodIndex: [{ name: '김밥집', city: 'jeju', type: 'restaurant', dietary_tags: [], rating: 4.5, reviews: 100 }],
    });
    expect(out.days).toHaveLength(1);
    const day = out.days[0] as Record<string, any>;
    expect(day.activity_meta).toBeTruthy();
    expect(day.activity_meta.difficulty).toBe('expert');
    expect(day.activity_meta.unsuitable_for).toContain('wheelchair_user');
    // SAFETY quality_warning 박제 (운영자 admin panel + 표기 의무 추적)
    const aw = (out.quality_warnings || []).filter((w: any) => w.type === 'block_mode_activity_day');
    expect(aw.length).toBe(1);
    expect(aw[0].count).toBe(1);
  });

  it('city_day expand → activity_meta 키 없음 + block_mode_activity_day warning 0 (byte-identical day)', () => {
    const city = makeCityDayBlock('CITY', 'seoul');
    const sel = { day_selections: [{ day: 1, block_id: 'CITY', tweak_notes: '' }] };
    const out = expandBlocksToItinerary(sel, [city], { durationDays: 1, language: 'en', area: 'seoul', startDate: '2026-06-01' });
    expect(Object.prototype.hasOwnProperty.call(out.days[0], 'activity_meta')).toBe(false);
    const aw = (out.quality_warnings || []).filter((w: any) => w.type === 'block_mode_activity_day');
    expect(aw.length).toBe(0);
  });
});

// ── (d) SAFETY — mobility 거동 제약 시 활동 블록 제외 ────────────────────────
describe('[PR-E SAFETY] mobility 거동 제약 → wheelchair-unsuitable 활동 블록 제외', () => {
  it('flag ON + mobility=wheelchair → trekking/running 제외, city_day 유지', async () => {
    process.env[ENV_KEY] = 'true';
    const db = makeMockDb([
      { id: 'CITY', data: makeCityDayBlock('CITY', 'jeju') },
      { id: 'TREK', data: makeTrekkingBlock('TREK', 'jeju') },
      { id: 'RUN', data: makeRunningBlock('RUN', 'jeju') },
    ]);
    const blocks = await fetchAvailableBlocks(db, 'jeju', { mobility: 'wheelchair' });
    // 활동 블록은 unsuitable_for=['wheelchair_user'] → 제외. city_day 만 남음.
    expect(blocks.map((b) => b.id)).toEqual(['CITY']);
  });

  it('flag ON + mobility=ok → 활동 블록 유지 (필터 비대상)', async () => {
    process.env[ENV_KEY] = 'true';
    const db = makeMockDb([
      { id: 'CITY', data: makeCityDayBlock('CITY', 'jeju') },
      { id: 'TREK', data: makeTrekkingBlock('TREK', 'jeju') },
    ]);
    const blocks = await fetchAvailableBlocks(db, 'jeju', { mobility: 'ok' });
    expect(blocks.map((b) => b.id).sort()).toEqual(['CITY', 'TREK']);
  });

  // 2026-06-04 trap 회귀가드: 과거 화이트리스트가 'ok'/'none' 뿐 → 'normal' 등 benign 값이 limited 오판
  //   → 트레킹/러닝 silent 제외(활동 day 0). isLimitedMobility 화이트리스트 확장으로 fix.
  it('flag ON + mobility=normal/good/빈값 (benign) → 활동 블록 유지', async () => {
    process.env[ENV_KEY] = 'true';
    const db = makeMockDb([
      { id: 'CITY', data: makeCityDayBlock('CITY', 'jeju') },
      { id: 'TREK', data: makeTrekkingBlock('TREK', 'jeju') },
    ]);
    for (const mob of ['normal', 'good', '', undefined]) {
      const blocks = await fetchAvailableBlocks(db, 'jeju', { mobility: mob });
      expect(blocks.map((b) => b.id).sort(), `mobility='${mob}'`).toEqual(['CITY', 'TREK']);
    }
  });

  it('flag OFF + mobility=wheelchair → mobility 필터 무효과 (활동 블록 자체가 없음, byte-identical)', async () => {
    delete process.env[ENV_KEY];
    const db = makeMockDb([
      { id: 'CITY', data: makeCityDayBlock('CITY', 'jeju') },
      { id: 'TREK', data: makeTrekkingBlock('TREK', 'jeju') },
    ]);
    const blocks = await fetchAvailableBlocks(db, 'jeju', { mobility: 'wheelchair' });
    expect(blocks.map((b) => b.id)).toEqual(['CITY']); // OFF 라 trekking 제외 (mobility 무관)
  });
});

// ── (e) 프롬프트 — OFF byte-identical, ON 시 활동 규칙 append ────────────────
describe('[PR-E] block selection prompt — OFF byte-identical, ON 시 활동 규칙', () => {
  it('flag OFF (default arg) → ## ACTIVITY BLOCKS 섹션 없음', () => {
    const p = buildBlockSelectionSystemPrompt('en');
    expect(p).not.toContain('## ACTIVITY BLOCKS');
  });

  it('opts.activityEnabled=false → OFF 와 동일 문자열 (byte-identical)', () => {
    expect(buildBlockSelectionSystemPrompt('en', { activityEnabled: false })).toBe(buildBlockSelectionSystemPrompt('en'));
  });

  it('opts.activityEnabled=true → ## ACTIVITY BLOCKS + full-day/도착·출국일 금지 규칙 포함', () => {
    const p = buildBlockSelectionSystemPrompt('en', { activityEnabled: true });
    expect(p).toContain('## ACTIVITY BLOCKS');
    expect(p).toContain('FULL-DAY');
    expect(p).toContain('arrival day');
    expect(p).toContain('departure day');
    // 기존 RULES 7 + OUTPUT LANGUAGE 도 유지 (append-only)
    expect(p).toContain('## OUTPUT LANGUAGE');
  });
});

// ── isLimitedMobility 화이트리스트 (2026-06-04 'normal' trap fix) ─────────────
describe('isLimitedMobility — 정상 거동 화이트리스트', () => {
  it('benign/정상 값 → limited=false (활동 블록 유지)', () => {
    for (const m of ['ok', 'none', 'normal', 'good', 'full', 'fine', 'OK', 'Normal', ' normal ', '', null, undefined]) {
      expect(isLimitedMobility(m as any), `mobility='${m}'`).toBe(false);
    }
  });
  it('실제 거동 제약 값 → limited=true (보수적 제외)', () => {
    for (const m of ['wheelchair', 'wheelchair_user', 'severe_mobility_limitation', 'limited', 'mobility_impaired']) {
      expect(isLimitedMobility(m), `mobility='${m}'`).toBe(true);
    }
  });
});
