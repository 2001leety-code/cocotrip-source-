// ─────────────────────────────────────────────────────────────────────────────
// A1-7-2 SAFETY publish validation 테스트
//
// 회귀 차단:
//   - block_type='trekking' / 'running_route' 코스 가 meta 누락 채로 publish 되면
//     AI 플래너가 등산 안내 없이 추천 → SAFETY 사고 위험.
//   - validateZoneCoursePublish 가 누락 정확히 감지하고 한국어 메시지 + 어느 탭
//     으로 이동해야 하는지 반환해야 함.
//
// 매트릭스:
//   - trekking → trekking_meta 필수 8 필드
//   - running_route → running_meta 필수 6 필드
//   - city_day / cafe_hop / cycling / guided_tour / dmz_tour / undefined → meta 요구 X
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect } from 'vitest';
import {
  validateZoneCoursePublish,
  isMissingMetaValue,
  BLOCK_TYPE_META_REQUIREMENTS,
} from '../../src/lib/zone-course-publish-validation';

// 풀-채운 trekking_meta — basic 8 필드 모두 truthy
const FULL_TREKKING_META = {
  total_distance_km: 12.5,
  elevation_gain_m: 850,
  difficulty: 'moderate',
  trail_type: 'loop',
  estimated_duration_min: 360,
  recommended_gear: ['등산화', '스틱', '방한복'],
  hazards: ['낙석', '급경사'],
  trailhead_address: '서울 강북구 우이동 등산로 입구',
};

// 풀-채운 running_meta
const FULL_RUNNING_META = {
  total_km: 5,
  surface_type: 'paved',
  elevation_gain_m: 30,
  loop_or_out_and_back: 'loop',
  lighting_quality: 'good',
  difficulty: 'easy',
};

const BASIC_OK = {
  id: 'SEOUL_BUKHANSAN_TREK',
  city: 'seoul',
  zone: 'gangbuk',
  theme: '북한산 트레킹',
  stops: [{ name: 'A' } as never, { name: 'B' } as never],
};

describe('A1-7-2 validateZoneCoursePublish — SAFETY publish gate', () => {
  describe('basic 필드 검증', () => {
    it('id 누락 → missing_basic', () => {
      const r = validateZoneCoursePublish({ ...BASIC_OK, id: undefined });
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.reason).toBe('missing_basic');
        expect(r.message).toContain('Basic');
      }
    });

    it('city 누락 → missing_basic', () => {
      const r = validateZoneCoursePublish({ ...BASIC_OK, city: undefined });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toBe('missing_basic');
    });

    it('zone 누락 → missing_basic', () => {
      const r = validateZoneCoursePublish({ ...BASIC_OK, zone: undefined });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toBe('missing_basic');
    });

    it('theme 누락 → missing_basic', () => {
      const r = validateZoneCoursePublish({ ...BASIC_OK, theme: undefined });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toBe('missing_basic');
    });
  });

  describe('stops 검증', () => {
    it('stops 0개 → insufficient_stops', () => {
      const r = validateZoneCoursePublish({ ...BASIC_OK, stops: [] });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toBe('insufficient_stops');
    });

    it('stops 1개 → insufficient_stops', () => {
      const r = validateZoneCoursePublish({ ...BASIC_OK, stops: [{ name: 'A' } as never] });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toBe('insufficient_stops');
    });

    it('stops 2개 + block_type 없음 → ok', () => {
      const r = validateZoneCoursePublish(BASIC_OK);
      expect(r.ok).toBe(true);
    });
  });

  describe('SAFETY — trekking 매트릭스', () => {
    it('block_type=trekking + trekking_meta 빈 객체 → missing_meta + 8 missingKeys', () => {
      const r = validateZoneCoursePublish({
        ...BASIC_OK,
        block_type: 'trekking',
        trekking_meta: {},
      } as never);
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.reason).toBe('missing_meta');
        expect(r.missingMeta?.metaField).toBe('trekking_meta');
        expect(r.missingMeta?.safetyLabel).toBe('등산');
        expect(r.missingMeta?.missingKeys).toHaveLength(8);
        expect(r.message).toContain('등산');
        expect(r.message).toContain('SAFETY-CRITICAL');
      }
    });

    it('block_type=trekking + trekking_meta 없음 (undefined) → missing_meta + 8 missingKeys', () => {
      const r = validateZoneCoursePublish({
        ...BASIC_OK,
        block_type: 'trekking',
      } as never);
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.reason).toBe('missing_meta');
        expect(r.missingMeta?.missingKeys).toHaveLength(8);
      }
    });

    it('block_type=trekking + trekking_meta 부분 채움 (4 필드) → missing_meta + 4 missingKeys', () => {
      const partial = {
        total_distance_km: 10,
        elevation_gain_m: 500,
        difficulty: 'easy',
        trail_type: 'out_and_back',
        // estimated_duration_min, recommended_gear, hazards, trailhead_address 누락
      };
      const r = validateZoneCoursePublish({
        ...BASIC_OK,
        block_type: 'trekking',
        trekking_meta: partial,
      } as never);
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.reason).toBe('missing_meta');
        expect(r.missingMeta?.missingKeys).toHaveLength(4);
        const keys = r.missingMeta?.missingKeys.map((k) => k.key) || [];
        expect(keys).toContain('estimated_duration_min');
        expect(keys).toContain('recommended_gear');
        expect(keys).toContain('hazards');
        expect(keys).toContain('trailhead_address');
      }
    });

    it('block_type=trekking + 빈 배열 (recommended_gear=[]) → 그 필드 missing 으로 잡힘', () => {
      const r = validateZoneCoursePublish({
        ...BASIC_OK,
        block_type: 'trekking',
        trekking_meta: { ...FULL_TREKKING_META, recommended_gear: [] },
      } as never);
      expect(r.ok).toBe(false);
      if (!r.ok && r.missingMeta) {
        expect(r.missingMeta.missingKeys.map((k) => k.key)).toContain('recommended_gear');
      }
    });

    it('block_type=trekking + 0 (total_distance_km=0) → SAFETY 누락 처리', () => {
      const r = validateZoneCoursePublish({
        ...BASIC_OK,
        block_type: 'trekking',
        trekking_meta: { ...FULL_TREKKING_META, total_distance_km: 0 },
      } as never);
      expect(r.ok).toBe(false);
      if (!r.ok && r.missingMeta) {
        expect(r.missingMeta.missingKeys.map((k) => k.key)).toContain('total_distance_km');
      }
    });

    it('block_type=trekking + trekking_meta 풀 채움 → ok', () => {
      const r = validateZoneCoursePublish({
        ...BASIC_OK,
        block_type: 'trekking',
        trekking_meta: FULL_TREKKING_META,
      } as never);
      expect(r.ok).toBe(true);
    });
  });

  describe('SAFETY — running_route 매트릭스', () => {
    it('block_type=running_route + running_meta 빈 객체 → missing_meta + 6 missingKeys', () => {
      const r = validateZoneCoursePublish({
        ...BASIC_OK,
        block_type: 'running_route',
        running_meta: {},
      } as never);
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.reason).toBe('missing_meta');
        expect(r.missingMeta?.metaField).toBe('running_meta');
        expect(r.missingMeta?.safetyLabel).toBe('러닝');
        expect(r.missingMeta?.missingKeys).toHaveLength(6);
      }
    });

    it('block_type=running_route + 풀 채움 → ok', () => {
      const r = validateZoneCoursePublish({
        ...BASIC_OK,
        block_type: 'running_route',
        running_meta: FULL_RUNNING_META,
      } as never);
      expect(r.ok).toBe(true);
    });
  });

  describe('매트릭스에 없는 block_type — meta 요구 X', () => {
    it('block_type=city_day → ok (meta 없어도)', () => {
      const r = validateZoneCoursePublish({ ...BASIC_OK, block_type: 'city_day' } as never);
      expect(r.ok).toBe(true);
    });

    it('block_type=cafe_hop → ok', () => {
      const r = validateZoneCoursePublish({ ...BASIC_OK, block_type: 'cafe_hop' } as never);
      expect(r.ok).toBe(true);
    });

    it('block_type=cycling → ok (운영자 의도: cycling 은 추가 검증 강제 X)', () => {
      const r = validateZoneCoursePublish({ ...BASIC_OK, block_type: 'cycling' } as never);
      expect(r.ok).toBe(true);
    });

    it('block_type undefined → ok', () => {
      const r = validateZoneCoursePublish(BASIC_OK);
      expect(r.ok).toBe(true);
    });
  });

  describe('검증 순서 — basic → stops → meta', () => {
    it('basic 누락이면 meta 검증 skip (사용자 혼란 방지)', () => {
      const r = validateZoneCoursePublish({
        id: undefined,
        block_type: 'trekking',
        trekking_meta: {},
      } as never);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toBe('missing_basic');
    });

    it('stops 부족이면 meta 검증 skip', () => {
      const r = validateZoneCoursePublish({
        ...BASIC_OK,
        stops: [{ name: 'A' } as never],
        block_type: 'trekking',
        trekking_meta: {},
      });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toBe('insufficient_stops');
    });
  });
});

describe('A1-7-2 isMissingMetaValue — 누락 판정', () => {
  it('null → true', () => expect(isMissingMetaValue(null)).toBe(true));
  it('undefined → true', () => expect(isMissingMetaValue(undefined)).toBe(true));
  it('빈 문자열 → true', () => expect(isMissingMetaValue('')).toBe(true));
  it('공백만 → true', () => expect(isMissingMetaValue('   ')).toBe(true));
  it('빈 배열 → true', () => expect(isMissingMetaValue([])).toBe(true));
  it('0 → true (SAFETY: 거리/고도 0은 작성 누락)', () => expect(isMissingMetaValue(0)).toBe(true));
  it('NaN → true', () => expect(isMissingMetaValue(NaN)).toBe(true));
  it('Infinity → true', () => expect(isMissingMetaValue(Infinity)).toBe(true));
  it('정상 문자열 → false', () => expect(isMissingMetaValue('moderate')).toBe(false));
  it('정상 숫자 → false', () => expect(isMissingMetaValue(12.5)).toBe(false));
  it('비어있지 않은 배열 → false', () => expect(isMissingMetaValue(['등산화'])).toBe(false));
});

describe('A1-7-2 BLOCK_TYPE_META_REQUIREMENTS — 매트릭스 구조', () => {
  it('trekking 매트릭스 = trekking_meta + 8 필드', () => {
    expect(BLOCK_TYPE_META_REQUIREMENTS.trekking.metaField).toBe('trekking_meta');
    expect(BLOCK_TYPE_META_REQUIREMENTS.trekking.requiredKeys).toHaveLength(8);
    expect(BLOCK_TYPE_META_REQUIREMENTS.trekking.safetyLabel).toBe('등산');
  });

  it('running_route 매트릭스 = running_meta + 6 필드', () => {
    expect(BLOCK_TYPE_META_REQUIREMENTS.running_route.metaField).toBe('running_meta');
    expect(BLOCK_TYPE_META_REQUIREMENTS.running_route.requiredKeys).toHaveLength(6);
    expect(BLOCK_TYPE_META_REQUIREMENTS.running_route.safetyLabel).toBe('러닝');
  });

  it('safety 영역만 등록 — city_day / cafe_hop / cycling 은 매트릭스 없음 (운영자 의도)', () => {
    expect(BLOCK_TYPE_META_REQUIREMENTS.city_day).toBeUndefined();
    expect(BLOCK_TYPE_META_REQUIREMENTS.cafe_hop).toBeUndefined();
    expect(BLOCK_TYPE_META_REQUIREMENTS.cycling).toBeUndefined();
  });
});
