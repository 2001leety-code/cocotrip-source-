/**
 * P247 (2026-05-27) — B-13 validator false positive 완화 + B-REGION-COVERAGE 정규화
 *
 * 문제: regions=['서울','부산'] (한글) + day.city='Seoul' (영문) 조합 시
 *   1. B-REGION-COVERAGE — cityHits['서울'] 계속 0 → false positive "0 days assigned"
 *   2. B-13 L5 hasExplicitOtherCity — '서울' != 'seoul' → otherCities에 자기도시 포함
 *      → hay.includes('서울') (서울특별시 주소) = TRUE → false alert
 *
 * Fix: normalizeRegionKey() 로 regions + day.city 를 영문 lowercase 로 정규화 후 비교.
 */
import { describe, it, expect } from 'vitest';
import { validatePatternStructure } from '../../api/_ai_core/responseValidator.js';

// ── 헬퍼: 정상 plan day 생성 ──────────────────────────────────────────────────
function makeDay(city: string, lodgingName: string, lodgingAddr: string, extraStops: object[] = []) {
  return {
    day: 1,
    city,
    theme: `${city} Day 1`,
    stops: [
      {
        category: 'lodging',
        name: lodgingName,
        address: lodgingAddr,
        start_time: '09:00',
        stay_min: 60,
      },
      { category: 'attraction', name: '관광지1', address: '서울 중구 을지로 1', start_time: '10:00', stay_min: 60 },
      { category: 'food', name: '식당1', address: '서울 중구 명동길 1', start_time: '12:00', stay_min: 60 },
      { category: 'attraction', name: '관광지2', address: '서울 중구 을지로 2', start_time: '14:00', stay_min: 60 },
      { category: 'lodging', name: lodgingName, address: lodgingAddr, start_time: '21:00', stay_min: 480 },
      ...extraStops,
    ],
  };
}

function makeItinerary(days: object[]) {
  return {
    days,
    arrival_guide: { airport: 'ICN' },
    departure_guide: { airport: 'ICN' },
  };
}

// ── Case 1: B-13 false positive — regions 한글, day.city 영문, 주소 정상 ──────
describe('P247 B-13 — 한글 regions + 영문 day.city false positive 제거', () => {
  it('명동 호텔 + 서울특별시 주소가 Seoul day 에서 B-13 alert 없어야 함', () => {
    const itinerary = makeItinerary([
      makeDay('Seoul', '명동 호텔', '서울특별시 중구 명동길 14'),
      makeDay('Seoul', '명동 호텔', '서울특별시 중구 명동길 14'),
      makeDay('Busan', '해운대 호텔', '부산광역시 해운대구 해운대해변로 264'),
      makeDay('Busan', '해운대 호텔', '부산광역시 해운대구 해운대해변로 264'),
    ]);
    const errors = validatePatternStructure(itinerary, {
      regions: ['서울', '부산'],   // 한글 regions (admin Test Mode 전달 형식)
      durationDays: 4,
    });
    const b13Errors = errors.filter((e) => e.includes('B-13'));
    expect(b13Errors).toHaveLength(0);
  });

  it('해운대 호텔 + 부산광역시 주소가 Busan day 에서 B-13 alert 없어야 함', () => {
    const itinerary = makeItinerary([
      makeDay('Busan', '해운대 호텔', '부산광역시 해운대구 해운대해변로 264'),
      makeDay('Busan', '해운대 호텔', '부산광역시 해운대구 해운대해변로 264'),
    ]);
    const errors = validatePatternStructure(itinerary, {
      regions: ['서울', '부산'],
      durationDays: 2,
    });
    const b13Errors = errors.filter((e) => e.includes('B-13'));
    expect(b13Errors).toHaveLength(0);
  });
});

// ── Case 2: 진짜 cross-city mismatch — B-13 alert 발동해야 함 ─────────────────
describe('P247 B-13 — 진짜 cross-city mismatch 는 여전히 검출', () => {
  it('Seoul day 에 부산광역시 주소 호텔 → B-13 발동', () => {
    const itinerary = makeItinerary([
      makeDay('Seoul', '해운대 호텔', '부산광역시 해운대구 해운대해변로 264'),
      makeDay('Busan', '해운대 호텔', '부산광역시 해운대구 해운대해변로 264'),
    ]);
    const errors = validatePatternStructure(itinerary, {
      regions: ['서울', '부산'],
      durationDays: 2,
    });
    const b13Errors = errors.filter((e) => e.includes('B-13'));
    // Day 1 (Seoul day) 의 부산 주소 → 1건 발동
    expect(b13Errors.length).toBeGreaterThanOrEqual(1);
  });

  it('Busan day 에 서울특별시 주소 호텔 → B-13 발동', () => {
    const itinerary = makeItinerary([
      makeDay('Seoul', '명동 호텔', '서울특별시 중구 명동길 14'),
      makeDay('Busan', '명동 호텔', '서울특별시 중구 명동길 14'),
    ]);
    const errors = validatePatternStructure(itinerary, {
      regions: ['서울', '부산'],
      durationDays: 2,
    });
    const b13Errors = errors.filter((e) => e.includes('B-13'));
    // Day 2 (Busan day) 의 서울 주소 → 1건 발동
    expect(b13Errors.length).toBeGreaterThanOrEqual(1);
  });
});

// ── Case 3: B-REGION-COVERAGE — 한글 regions + 영문 day.city 정상 배정 ─────────
describe('P247 B-REGION-COVERAGE — 한글 regions 정규화', () => {
  it('regions=[서울,부산], days=[Seoul×2,Busan×2] → B-REGION-COVERAGE 없어야 함', () => {
    const itinerary = makeItinerary([
      makeDay('Seoul', '명동 호텔', '서울특별시 중구 명동길 14'),
      makeDay('Seoul', '명동 호텔', '서울특별시 중구 명동길 14'),
      makeDay('Busan', '해운대 호텔', '부산광역시 해운대구 해운대해변로 264'),
      makeDay('Busan', '해운대 호텔', '부산광역시 해운대구 해운대해변로 264'),
    ]);
    const errors = validatePatternStructure(itinerary, {
      regions: ['서울', '부산'],
      durationDays: 4,
    });
    const coverageErrors = errors.filter((e) => e.includes('B-REGION-COVERAGE'));
    expect(coverageErrors).toHaveLength(0);
  });

  it('regions=[서울,부산], days=[Seoul×4] → Busan 0 days → B-REGION-COVERAGE 발동', () => {
    const itinerary = makeItinerary([
      makeDay('Seoul', '명동 호텔', '서울특별시 중구 명동길 14'),
      makeDay('Seoul', '명동 호텔', '서울특별시 중구 명동길 14'),
      makeDay('Seoul', '명동 호텔', '서울특별시 중구 명동길 14'),
      makeDay('Seoul', '명동 호텔', '서울특별시 중구 명동길 14'),
    ]);
    const errors = validatePatternStructure(itinerary, {
      regions: ['서울', '부산'],
      durationDays: 4,
    });
    const coverageErrors = errors.filter((e) => e.includes('B-REGION-COVERAGE'));
    expect(coverageErrors.length).toBeGreaterThanOrEqual(1);
  });
});

// ── Case 4: 영문 regions 도 여전히 정상 작동 (backward compat) ──────────────────
describe('P247 — 영문 regions backward compatibility', () => {
  it('regions=[Seoul,Busan] (영문) + Seoul day → false positive 없음', () => {
    const itinerary = makeItinerary([
      makeDay('Seoul', '명동 호텔', '서울특별시 중구 명동길 14'),
      makeDay('Seoul', '명동 호텔', '서울특별시 중구 명동길 14'),
      makeDay('Busan', '해운대 호텔', '부산광역시 해운대구 해운대해변로 264'),
      makeDay('Busan', '해운대 호텔', '부산광역시 해운대구 해운대해변로 264'),
    ]);
    const errors = validatePatternStructure(itinerary, {
      regions: ['Seoul', 'Busan'],
      durationDays: 4,
    });
    const b13Errors = errors.filter((e) => e.includes('B-13'));
    const coverageErrors = errors.filter((e) => e.includes('B-REGION-COVERAGE'));
    expect(b13Errors).toHaveLength(0);
    expect(coverageErrors).toHaveLength(0);
  });

  it('regions=[seoul,busan] (lowercase 영문) + Seoul day → false positive 없음', () => {
    const itinerary = makeItinerary([
      makeDay('Seoul', '명동 호텔', '서울특별시 중구 명동길 14'),
      makeDay('Busan', '해운대 호텔', '부산광역시 해운대구 해운대해변로 264'),
    ]);
    const errors = validatePatternStructure(itinerary, {
      regions: ['seoul', 'busan'],
      durationDays: 2,
    });
    const b13Errors = errors.filter((e) => e.includes('B-13'));
    const coverageErrors = errors.filter((e) => e.includes('B-REGION-COVERAGE'));
    expect(b13Errors).toHaveLength(0);
    expect(coverageErrors).toHaveLength(0);
  });
});
