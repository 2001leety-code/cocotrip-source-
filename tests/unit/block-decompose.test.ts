/**
 * block-decompose.test.ts — PR-A block decompose helper 회귀 ([P-Z03]).
 *
 * 2026-05-21. zone_courses block 의 fine-grained 수정 (insert/remove/swap).
 * order/start_time_offset_min 자동 재계산 검증. transit_matrix 무효 key 제거 검증.
 *
 * 검증 케이스 (8):
 *  1. decomposeBlock — block null/undefined → null
 *  2. decomposeBlock — block_type 누락 시 default 'city_day'
 *  3. recomposeBlock — order/start_time_offset_min 재계산
 *  4. insertStop — 끝에 추가 + order 재할당
 *  5. insertStop — 중간 추가 + order 재할당
 *  6. removeStop — 매칭 안 되면 원본 block 반환
 *  7. swapStop — order 보존
 *  8. removeStop — transit_matrix invalid key 제거
 */
import { describe, it, expect } from 'vitest';
import {
  decomposeBlock,
  recomposeBlock,
  insertStop,
  removeStop,
  swapStop,
} from '../../src/ai_planner/block-decompose';
import type { ZoneCourseBlock, ZoneCourseStop } from '../../src/data/zone_courses/types';

function makeStop(order: number, name: string, stayMin = 60): ZoneCourseStop {
  return {
    order,
    category: 'culture',
    name,
    name_i18n: { ko: name, en: name, ja: name, zh: name },
    address: `서울 ${name}`,
    lat: 0,
    lng: 0,
    start_time_offset_min: 0,
    stay_min: stayMin,
    entry_fee_krw: 0,
    reservation_required: false,
  };
}

function makeBlock(stops: ZoneCourseStop[]): ZoneCourseBlock {
  return {
    id: 'TEST_BLOCK',
    city: 'seoul',
    zone: 'Test',
    theme: 'Test',
    theme_i18n: { ko: 'Test', en: 'Test', ja: 'Test', zh: 'Test' },
    intensity: 'standard',
    duration_min: stops.reduce((s, x) => s + x.stay_min, 0),
    stops,
    transit_matrix: {
      '1->2': {
        from_order: 1,
        to_order: 2,
        mode: 'walk',
        duration_min: 10,
        distance_m: 500,
        cost_krw: 0,
        source: 'mock',
        fetched_at: '2026-05-21',
      },
      '2->3': {
        from_order: 2,
        to_order: 3,
        mode: 'walk',
        duration_min: 10,
        distance_m: 500,
        cost_krw: 0,
        source: 'mock',
        fetched_at: '2026-05-21',
      },
    },
    best_for: [],
    unsuitable_for: [],
    dietary_options: [],
    passport_required: false,
    requires_advance_booking: false,
    source: 'cocotrip_curated',
    verified_at: '2026-05-21',
    verified_by: 'test',
    last_review_date: '2026-05-21',
  };
}

describe('decomposeBlock', () => {
  it('null/undefined → null', () => {
    expect(decomposeBlock(null)).toBeNull();
    expect(decomposeBlock(undefined)).toBeNull();
  });

  it('block_type 누락 시 default city_day (backward compat)', () => {
    const b = makeBlock([makeStop(1, 'A'), makeStop(2, 'B')]);
    // make sure block_type 누락
    delete (b as Partial<ZoneCourseBlock>).block_type;
    const r = decomposeBlock(b);
    expect(r).not.toBeNull();
    expect(r!.metadata.block_type).toBe('city_day');
    expect(r!.stops).toHaveLength(2);
  });
});

describe('recomposeBlock', () => {
  it('order/start_time_offset_min 재계산', () => {
    const stops = [makeStop(5, 'A', 60), makeStop(99, 'B', 30), makeStop(2, 'C', 45)];
    const meta = {
      id: 'T',
      city: 'seoul' as const,
      zone: 'Z',
      theme: 't',
      block_type: 'city_day' as const,
      intensity: 'standard' as const,
    };
    const r = recomposeBlock(stops, meta);
    expect(r).not.toBeNull();
    expect(r!.stops!.map((s) => s.order)).toEqual([1, 2, 3]);
    expect(r!.stops![0].start_time_offset_min).toBe(0);
    expect(r!.stops![1].start_time_offset_min).toBe(60); // 0 + 60
    expect(r!.stops![2].start_time_offset_min).toBe(90); // 60 + 30
    expect(r!.duration_min).toBe(135); // 60+30+45
  });

  it('null input → null (no throw)', () => {
    expect(recomposeBlock(null, null)).toBeNull();
    expect(recomposeBlock([], null)).toBeNull();
  });
});

describe('insertStop', () => {
  it('끝에 추가 + order 재할당', () => {
    const b = makeBlock([makeStop(1, 'A'), makeStop(2, 'B')]);
    const r = insertStop(b, 99, makeStop(999, 'New'));
    expect(r.stops).toHaveLength(3);
    expect(r.stops.map((s) => s.order)).toEqual([1, 2, 3]);
    expect(r.stops[2].name).toBe('New');
  });

  it('중간 추가 (position=1) + order 재할당', () => {
    const b = makeBlock([makeStop(1, 'A'), makeStop(2, 'B')]);
    const r = insertStop(b, 1, makeStop(0, 'Mid'));
    expect(r.stops.map((s) => s.name)).toEqual(['A', 'Mid', 'B']);
    expect(r.stops.map((s) => s.order)).toEqual([1, 2, 3]);
  });

  it('invalid newStop (null) → 원본 block 반환', () => {
    const b = makeBlock([makeStop(1, 'A')]);
    const r = insertStop(b, 0, null);
    expect(r).toBe(b);
  });

  it('block 이 null 이면 throw (호출자 책임)', () => {
    expect(() => insertStop(null, 0, makeStop(1, 'X'))).toThrow();
  });
});

describe('removeStop', () => {
  it('매칭 안 되는 stopOrder → 원본 block 반환', () => {
    const b = makeBlock([makeStop(1, 'A'), makeStop(2, 'B')]);
    const r = removeStop(b, 99);
    expect(r).toBe(b);
  });

  it('transit_matrix invalid key 자동 제거', () => {
    const b = makeBlock([makeStop(1, 'A'), makeStop(2, 'B'), makeStop(3, 'C')]);
    const r = removeStop(b, 2);
    expect(r.stops).toHaveLength(2);
    // remaining stops 의 order 는 1,2 (재할당). 1->2 transit 은 from_order=1, to_order=2 였으니 유지.
    // 2->3 는 from_order=2,to_order=3 였는데 stop3 가 사라져 키 제거.
    expect(Object.keys(r.transit_matrix)).toContain('1->2');
    expect(Object.keys(r.transit_matrix)).not.toContain('2->3');
  });
});

describe('swapStop', () => {
  it('stop 교체 시 order 보존', () => {
    const b = makeBlock([makeStop(1, 'A'), makeStop(2, 'B'), makeStop(3, 'C')]);
    const r = swapStop(b, 2, makeStop(99, 'Bnew'));
    expect(r.stops[1].order).toBe(2);
    expect(r.stops[1].name).toBe('Bnew');
    expect(r.stops.map((s) => s.name)).toEqual(['A', 'Bnew', 'C']);
  });
});
