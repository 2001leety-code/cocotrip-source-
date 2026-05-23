/**
 * P161 (2026-05-23): quality_warnings shape consistency 회귀 차단.
 *
 * 사용자 신고 (plan 8e767d9c, 2026-05-23): Firestore plan.itinerary.quality_warnings[0]
 * = { kind: undefined, message: undefined } — UI panel (QualityWarningsPanel) heading
 * 이 w.type 만 읽고 self-heal 함수들 (selfHealLodgingBookend / correctPreDawnStopTimes /
 * correctCrossCityLodgingStops / selfHealArrivalGuide / pushIntercityGapWarnings) 가
 * kind 만 push 한 회귀 — undefined 노출.
 *
 * 본 fix: 모든 quality_warnings.push 사이트가 kind + type + message 3 필드 동시 출력 의무.
 * 본 test: 핵심 5 push 사이트 모두 kind / type 둘 다 채워지는지 검증.
 */
import { describe, it, expect } from 'vitest';
import {
  selfHealLodgingBookend,
  selfHealArrivalGuide,
  correctPreDawnStopTimes,
  correctCrossCityLodgingStops,
  pushIntercityGapWarnings,
// @ts-expect-error — JS module
} from '../../api/_ai_core/planPersister.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Loose = any;

describe('P161 quality_warnings shape — 모든 push 사이트 kind+type+message 의무', () => {
  it('selfHealArrivalGuide push: kind=type=arrival_guide_self_healed + message non-empty', () => {
    const it: Loose = {};
    selfHealArrivalGuide(it, 'ICN T1');
    const w = it.quality_warnings[0];
    expect(w.kind).toBeDefined();
    expect(w.type).toBeDefined();
    expect(w.kind).toBe(w.type); // mirror
    expect(typeof w.message).toBe('string');
    expect(w.message.length).toBeGreaterThan(0);
  });

  it('selfHealLodgingBookend push: kind=type=lodging_bookend_self_healed + message', () => {
    const it: Loose = {
      days: [{
        day: 1, city: 'Seoul',
        stops: [
          { category: 'food', name: '아침 카페', start_time: '09:30' },
          { category: 'lodging', name: '명동 호텔', start_time: '20:00' },
        ],
      }],
    };
    selfHealLodgingBookend(it);
    const w = it.quality_warnings[0];
    expect(w.kind).toBe('lodging_bookend_self_healed');
    expect(w.type).toBe('lodging_bookend_self_healed');
    expect(typeof w.message).toBe('string');
    expect(w.message).toMatch(/Day 1/);
  });

  it('correctPreDawnStopTimes push: kind=type=predawn_auto_corrected + message', () => {
    const it: Loose = {
      days: [{
        day: 2, city: 'Busan',
        stops: [
          { category: 'lodging', name: '해운대 호텔', start_time: '03:30', stay_min: 0 },
          { category: 'food', name: '아침 식당', start_time: '04:30', stay_min: 60 },
        ],
      }],
    };
    correctPreDawnStopTimes(it);
    const w = it.quality_warnings[0];
    expect(w.kind).toBe('predawn_auto_corrected');
    expect(w.type).toBe('predawn_auto_corrected');
    expect(typeof w.message).toBe('string');
    expect(w.message).toMatch(/Day 2/);
  });

  it('correctCrossCityLodgingStops push: kind=type=cross_city_lodging_corrected + message', () => {
    const it: Loose = {
      days: [{
        day: 3, city: 'Busan',
        stops: [
          { category: 'lodging', name: '명동 호텔', address: '서울특별시 중구 명동' },
        ],
      }],
    };
    correctCrossCityLodgingStops(it, {}, {});
    const w = it.quality_warnings[0];
    expect(w.kind).toBe('cross_city_lodging_corrected');
    expect(w.type).toBe('cross_city_lodging_corrected');
    expect(typeof w.message).toBe('string');
  });

  it('pushIntercityGapWarnings push: kind=type=intercity_first_stop_gap + message', () => {
    const it: Loose = {
      days: [{
        day: 2, city: 'Busan',
        intercity_transit: { from_city: 'Seoul', to_city: 'Busan', arrival_at: '12:15' },
        stops: [
          { category: 'attraction', name: '해운대', start_time: '17:30' },
        ],
      }],
    };
    pushIntercityGapWarnings(it);
    const w = it.quality_warnings[0];
    expect(w.kind).toBe('intercity_first_stop_gap');
    expect(w.type).toBe('intercity_first_stop_gap');
    expect(typeof w.message).toBe('string');
    expect(w.message.length).toBeGreaterThan(0);
  });

  it('모든 push 사이트: kind 와 type 가 모두 정의 + 동일 값 (undefined 회귀 차단)', () => {
    // 통합 시나리오 — 여러 self-heal 동시 발동
    const it: Loose = {
      days: [{
        day: 1, city: 'Seoul',
        stops: [
          { category: 'food', name: '아침', start_time: '03:30', stay_min: 60 },
        ],
      }],
    };
    selfHealArrivalGuide(it, 'ICN T1');
    correctPreDawnStopTimes(it);
    selfHealLodgingBookend(it);

    // 모든 warning 의 kind / type 모두 string + 둘이 일치
    for (const w of it.quality_warnings) {
      expect(typeof w.kind).toBe('string');
      expect(typeof w.type).toBe('string');
      expect(w.kind).toBe(w.type);
      expect(w.kind.length).toBeGreaterThan(0);
      // message 도 항상 채워짐 (plan 8e767d9c {message:undefined} 회귀 차단)
      expect(typeof w.message).toBe('string');
      expect(w.message.length).toBeGreaterThan(0);
    }
  });
});
