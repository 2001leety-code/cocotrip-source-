/**
 * buildCityPerDay 한/영/일/중 도시 키 정규화 회귀 가드 (2026-06-03, 자율 사이클).
 *
 * 배경 (P321 standing obligation): "city 키가 흐르는 모든 경로는 normalizeRegionKey 필수."
 * buildCityPerDay 의 perDayCity 분기는 .toLowerCase() 만 거쳐 한글('서울')이 영문키('seoul')와
 * mismatch → daySchedule.available_blocks 빈 배열 + day_selections.city 한글 → 취미 pin 실패 위험.
 *
 * ⚠️ 정직한 분류: 현재 perDayCity 는 프론트/백 어디서도 set 안 되는 dead input → 활성 prod 버그 아님
 * (fallback=영문 cities 사용). 이 fix 는 JSDoc 상 의도된 입력(per-day 도시 매핑)을 향후 wiring 할 때
 * P321 재발을 막는 **선제 하드닝**. fallback(perDayCity=null) 경로는 byte-identical 보장.
 */
import { describe, it, expect } from 'vitest';
import { buildCityPerDay } from '../../api/_ai_core/blockMode.js';

describe('buildCityPerDay — perDayCity 키 정규화 (P321 의무)', () => {
  it('한글 perDayCity → 영문 cityKey 로 정규화', () => {
    const r = buildCityPerDay(['seoul', 'busan'], 5, { 1: '서울', 2: '서울', 3: '부산', 4: '부산', 5: '부산' });
    expect(r).toEqual(['seoul', 'seoul', 'busan', 'busan', 'busan']);
  });

  it('영문 대소문자 + _suffix 혼용 → 영문 base key', () => {
    const r = buildCityPerDay(['seoul', 'busan'], 3, { 1: 'Seoul', 2: 'BUSAN', 3: 'seoul_city' });
    expect(r).toEqual(['seoul', 'busan', 'seoul']);
  });

  it('영문 perDayCity → 그대로 (회귀 0)', () => {
    const r = buildCityPerDay(['seoul', 'busan'], 3, { 1: 'seoul', 2: 'busan', 3: 'busan' });
    expect(r).toEqual(['seoul', 'busan', 'busan']);
  });

  it('빈/누락 day → cities[0] fallback (정규화 빈값 → 폴백 유지)', () => {
    const r = buildCityPerDay(['seoul', 'busan'], 3, { 1: '부산' });
    expect(r).toEqual(['busan', 'seoul', 'seoul']); // day2,3 누락 → cities[0]='seoul'
  });

  it('perDayCity=null → 균등 분배 fallback (현 prod 경로, byte-identical)', () => {
    const r = buildCityPerDay(['seoul', 'busan'], 4, null);
    expect(r).toEqual(['seoul', 'seoul', 'busan', 'busan']);
  });

  it('perDayCity=null 단일 도시 → 전 day 동일', () => {
    const r = buildCityPerDay(['seoul'], 3, null);
    expect(r).toEqual(['seoul', 'seoul', 'seoul']);
  });
});
