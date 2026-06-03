/**
 * "선택한 취미 = 전용 day 1개 보장" (pinActivityDays) 회귀 가드 (2026-06-03).
 *
 * 운영자 신고/실측(plan c7192a27): HangangBike(따릉이) 선택해도 plan 에 안 나옴 — 따릉이 블록은
 * block_type='city_day' 라 서울 블록 다수와 동등 경쟁 → Gemini 선택기가 탈락. fix: Gemini 선택 후
 * day_selections 후처리로 취미 블록을 안전 day 에 강제 pin (flag FEATURE_PINNED_ACTIVITY_DAY).
 *
 * 가드: flag OFF=no-op(byte-identical) / 첫·마지막 day 보호 / 도시 정합 / cap(day<3) / hard dietary skip / dedup.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { pinActivityDays } from '../../api/_ai_core/blockMode.js';

const BIKE = { id: 'SEOUL_DAY_HANGANG_BIKE_YEOUIDO_STANDARD', block_type: 'city_day', city: 'seoul', theme: '한강 자전거 + 여의도 (따릉이 라이딩)' };
const TREK = { id: 'SEOUL_BUKHANSAN_BAEGUNDAE_PACKED', block_type: 'trekking', city: 'seoul', theme: '북한산 백운대' };
const seoulPool = [
  { id: 'SEOUL_JONGNO', block_type: 'city_day', city: 'seoul', theme: '종로' },
  { id: 'SEOUL_GANGNAM', block_type: 'city_day', city: 'seoul', theme: '강남' },
  { id: 'SEOUL_HONGDAE', block_type: 'city_day', city: 'seoul', theme: '홍대' },
  BIKE, TREK,
];
const busanPool = [
  { id: 'BUSAN_HAEUNDAE', block_type: 'city_day', city: 'busan', theme: '해운대' },
  { id: 'BUSAN_NAMPO', block_type: 'city_day', city: 'busan', theme: '남포' },
];

const sel = (rows: Array<{ day: number; block_id: string; city?: string }>) => ({ day_selections: rows.map((r) => ({ tweak_notes: '', ...r })) });
const singlePool = () => seoulPool;
const multiPool = (city: string) => (city === 'busan' ? busanPool : seoulPool);

afterEach(() => vi.unstubAllEnvs());

describe('pinActivityDays — flag OFF (기본): no-op (byte-identical)', () => {
  it('flag 미설정 → day_selections 변경 0', () => {
    const s = sel([{ day: 1, block_id: 'SEOUL_JONGNO' }, { day: 2, block_id: 'SEOUL_GANGNAM' }, { day: 3, block_id: 'SEOUL_HONGDAE' }]);
    const before = JSON.stringify(s);
    const pinned = pinActivityDays(s, singlePool, { styles: ['HangangBike'], dietPrefs: [] });
    expect(pinned).toEqual([]);
    expect(JSON.stringify(s)).toBe(before);
  });
});

describe('pinActivityDays — flag ON', () => {
  it('따릉이 선택 + 블록 후보 존재 + 미포함 → 중간 day 1개를 따릉이로 강제 배정', () => {
    vi.stubEnv('FEATURE_PINNED_ACTIVITY_DAY', 'true');
    const s = sel([{ day: 1, block_id: 'SEOUL_JONGNO' }, { day: 2, block_id: 'SEOUL_GANGNAM' }, { day: 3, block_id: 'SEOUL_HONGDAE' }]);
    const pinned = pinActivityDays(s, singlePool, { styles: ['Food', 'HangangBike'], dietPrefs: [] });
    expect(pinned).toEqual(['HangangBike']);
    expect(s.day_selections[1].block_id).toBe(BIKE.id); // 중간 day(idx1) 교체
    expect(s.day_selections[0].block_id).toBe('SEOUL_JONGNO'); // 첫날(도착) 보호
    expect(s.day_selections[2].block_id).toBe('SEOUL_HONGDAE'); // 마지막날(출국) 보호
  });

  it('첫날·마지막날만 있고 중간 없음(2일) → cap, no-op', () => {
    vi.stubEnv('FEATURE_PINNED_ACTIVITY_DAY', 'true');
    const s = sel([{ day: 1, block_id: 'SEOUL_JONGNO' }, { day: 2, block_id: 'SEOUL_GANGNAM' }]);
    const before = JSON.stringify(s);
    expect(pinActivityDays(s, singlePool, { styles: ['HangangBike'], dietPrefs: [] })).toEqual([]);
    expect(JSON.stringify(s)).toBe(before);
  });

  it('이미 따릉이 day 있으면 → 중복 추가 안 함 (dedup)', () => {
    vi.stubEnv('FEATURE_PINNED_ACTIVITY_DAY', 'true');
    const s = sel([{ day: 1, block_id: 'SEOUL_JONGNO' }, { day: 2, block_id: BIKE.id }, { day: 3, block_id: 'SEOUL_HONGDAE' }]);
    const before = JSON.stringify(s);
    expect(pinActivityDays(s, singlePool, { styles: ['HangangBike'], dietPrefs: [] })).toEqual([]);
    expect(JSON.stringify(s)).toBe(before);
  });

  it('취미 미선택 → no-op', () => {
    vi.stubEnv('FEATURE_PINNED_ACTIVITY_DAY', 'true');
    const s = sel([{ day: 1, block_id: 'SEOUL_JONGNO' }, { day: 2, block_id: 'SEOUL_GANGNAM' }, { day: 3, block_id: 'SEOUL_HONGDAE' }]);
    expect(pinActivityDays(s, singlePool, { styles: ['Food', 'Photo'], dietPrefs: [] })).toEqual([]);
  });

  it('hard dietary(halal) → skip (식당 매칭 throw 회피)', () => {
    vi.stubEnv('FEATURE_PINNED_ACTIVITY_DAY', 'true');
    const s = sel([{ day: 1, block_id: 'SEOUL_JONGNO' }, { day: 2, block_id: 'SEOUL_GANGNAM' }, { day: 3, block_id: 'SEOUL_HONGDAE' }]);
    expect(pinActivityDays(s, singlePool, { styles: ['HangangBike'], dietPrefs: ['halal'] })).toEqual([]);
    expect(s.day_selections[1].block_id).toBe('SEOUL_GANGNAM');
  });

  it('후보 풀에 취미 블록 없음 → graceful no-op (강제 throw 안 함)', () => {
    vi.stubEnv('FEATURE_PINNED_ACTIVITY_DAY', 'true');
    const noBike = [{ id: 'SEOUL_JONGNO', block_type: 'city_day', city: 'seoul', theme: '종로' }, { id: 'SEOUL_GANGNAM', block_type: 'city_day', city: 'seoul', theme: '강남' }, { id: 'SEOUL_HONGDAE', block_type: 'city_day', city: 'seoul', theme: '홍대' }];
    const s = sel([{ day: 1, block_id: 'SEOUL_JONGNO' }, { day: 2, block_id: 'SEOUL_GANGNAM' }, { day: 3, block_id: 'SEOUL_HONGDAE' }]);
    expect(pinActivityDays(s, () => noBike, { styles: ['HangangBike'], dietPrefs: [] })).toEqual([]);
  });

  it('트레킹(block_type=trekking) 선택 → 트레킹 블록 pin', () => {
    vi.stubEnv('FEATURE_PINNED_ACTIVITY_DAY', 'true');
    const s = sel([{ day: 1, block_id: 'SEOUL_JONGNO' }, { day: 2, block_id: 'SEOUL_GANGNAM' }, { day: 3, block_id: 'SEOUL_HONGDAE' }]);
    expect(pinActivityDays(s, singlePool, { styles: ['Trekking'], dietPrefs: [] })).toEqual(['Trekking']);
    expect(s.day_selections[1].block_id).toBe(TREK.id);
  });

  it('다도시 — 따릉이(서울)는 서울 day 에만 pin, 부산 day 불변 (도시 정합)', () => {
    vi.stubEnv('FEATURE_PINNED_ACTIVITY_DAY', 'true');
    // idx0 day1 seoul(도착), idx1 day2 seoul(중간), idx2 day3 busan(중간), idx3 day4 busan(출국)
    const s = sel([
      { day: 1, block_id: 'SEOUL_JONGNO', city: 'seoul' },
      { day: 2, block_id: 'SEOUL_GANGNAM', city: 'seoul' },
      { day: 3, block_id: 'BUSAN_HAEUNDAE', city: 'busan' },
      { day: 4, block_id: 'BUSAN_NAMPO', city: 'busan' },
    ]);
    const pinned = pinActivityDays(s, multiPool, { styles: ['HangangBike'], dietPrefs: [] });
    expect(pinned).toEqual(['HangangBike']);
    expect(s.day_selections[1].block_id).toBe(BIKE.id);      // 서울 중간 day 교체
    expect(s.day_selections[2].block_id).toBe('BUSAN_HAEUNDAE'); // 부산 day 불변 (따릉이 서울 전용)
    expect(s.day_selections[0].block_id).toBe('SEOUL_JONGNO');   // 도착 보호
    expect(s.day_selections[3].block_id).toBe('BUSAN_NAMPO');    // 출국 보호
  });
});
