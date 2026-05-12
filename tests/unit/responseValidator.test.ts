// Coverage for api/_ai_core/responseValidator.js — validatePatternStructure (B-10/B-12/B-13/B-14/B-15).
// Pure function tests — no Gemini call needed.
import { describe, it, expect } from 'vitest';
// @ts-expect-error — JS module, no types
import { validatePatternStructure } from '../../api/_ai_core/responseValidator.js';

interface Stop {
  name?: string;
  display_name?: string;
  address?: string;
  category?: string;
  start_time?: string;
  transit_to_airport?: boolean;
  next_destination?: string;
}
interface Day {
  day?: number;
  day_index?: number;
  city?: string;
  stops?: Stop[];
  return_to_airport?: boolean;
  airport_transfer?: boolean;
}
interface Itinerary {
  days?: Day[];
}

// Helper: a structurally-correct day with N stops (lodging bookend, 4+ stops).
function makeValidDay(opts: { day?: number; city?: string; stops?: Stop[] } = {}): Day {
  return {
    day: opts.day ?? 1,
    city: opts.city ?? 'Seoul',
    stops: opts.stops ?? [
      { category: 'lodging', name: '호텔 출발', start_time: '09:00' },
      { category: 'attraction', name: '경복궁', start_time: '10:30' },
      { category: 'food', name: '광장시장', start_time: '12:30' },
      { category: 'attraction', name: '북촌한옥마을', start_time: '14:30' },
      { category: 'lodging', name: '호텔 복귀', start_time: '20:00' },
    ],
  };
}

describe('validatePatternStructure (api/_ai_core/responseValidator.js)', () => {
  describe('valid itinerary', () => {
    it('returns empty errors for a well-formed single-day plan', () => {
      const itinerary: Itinerary = { days: [makeValidDay()] };
      const errors = validatePatternStructure(itinerary, {});
      expect(errors).toEqual([]);
    });

    it('returns empty errors for multi-day plan with lodging bookends', () => {
      const itinerary: Itinerary = {
        days: [makeValidDay({ day: 1 }), makeValidDay({ day: 2 })],
      };
      const errors = validatePatternStructure(itinerary, {});
      expect(errors).toEqual([]);
    });

    it('allows last-day travel category as departure airport stop (B-10 + B-15)', () => {
      const lastDay: Day = {
        day: 2,
        city: 'Seoul',
        stops: [
          { category: 'lodging', name: '호텔 출발', start_time: '09:00' },
          { category: 'attraction', name: 'N서울타워', start_time: '10:30' },
          { category: 'food', name: '롯데월드몰', start_time: '12:30' },
          { category: 'travel', name: '인천국제공항 T1', start_time: '15:00' },
        ],
      };
      const itinerary: Itinerary = { days: [makeValidDay(), lastDay] };
      const errors = validatePatternStructure(itinerary, {
        arrival_airport: 'ICN',
        departure_airport: 'ICN',
      });
      expect(errors).toEqual([]);
    });
  });

  describe('B-10: lodging bookend', () => {
    it('flags day starting with non-lodging category', () => {
      const itinerary: Itinerary = {
        days: [
          {
            day: 1,
            stops: [
              { category: 'attraction', name: '경복궁', start_time: '09:00' },
              { category: 'food', name: '식당', start_time: '12:00' },
              { category: 'attraction', name: '광화문', start_time: '14:00' },
              { category: 'lodging', name: '호텔', start_time: '20:00' },
            ],
          },
        ],
      };
      const errors = validatePatternStructure(itinerary, {});
      expect(errors.some((e: string) => e.includes('B-10') && e.includes('stops[0]'))).toBe(true);
    });

    it('flags day ending with non-lodging/non-travel category', () => {
      const itinerary: Itinerary = {
        days: [
          {
            day: 1,
            stops: [
              { category: 'lodging', name: '호텔 출발', start_time: '09:00' },
              { category: 'attraction', name: '경복궁', start_time: '10:00' },
              { category: 'food', name: '식당', start_time: '12:00' },
              { category: 'attraction', name: '광화문', start_time: '14:00' },
            ],
          },
        ],
      };
      const errors = validatePatternStructure(itinerary, {});
      expect(errors.some((e: string) => e.includes('B-10') && e.includes('stops[-1]'))).toBe(true);
    });
  });

  describe('B-12: min 4 stops per day', () => {
    it('flags day with 3 stops', () => {
      const itinerary: Itinerary = {
        days: [
          {
            day: 1,
            stops: [
              { category: 'lodging', name: '호텔 출발', start_time: '09:00' },
              { category: 'attraction', name: '경복궁', start_time: '10:00' },
              { category: 'lodging', name: '호텔 복귀', start_time: '18:00' },
            ],
          },
        ],
      };
      const errors = validatePatternStructure(itinerary, {});
      expect(errors.some((e: string) => e.includes('B-12'))).toBe(true);
    });

    it('flags empty stops array', () => {
      const itinerary: Itinerary = { days: [{ day: 1, stops: [] }] };
      const errors = validatePatternStructure(itinerary, {});
      expect(errors.some((e: string) => e.includes('B-12') && e.includes('stops.length=0'))).toBe(true);
    });

    it('flags missing stops field', () => {
      const itinerary: Itinerary = { days: [{ day: 1 }] };
      const errors = validatePatternStructure(itinerary, {});
      expect(errors.some((e: string) => e.includes('B-12'))).toBe(true);
    });
  });

  describe('B-14: stop start_time < 24:00', () => {
    it('flags hour >= 24', () => {
      const itinerary: Itinerary = {
        days: [
          {
            day: 1,
            stops: [
              { category: 'lodging', name: '호텔 출발', start_time: '09:00' },
              { category: 'attraction', name: '경복궁', start_time: '11:00' },
              { category: 'food', name: '심야포차', start_time: '24:30' },
              { category: 'lodging', name: '호텔 복귀', start_time: '23:00' },
            ],
          },
        ],
      };
      const errors = validatePatternStructure(itinerary, {});
      expect(errors.some((e: string) => e.includes('B-14') && e.includes('24:30'))).toBe(true);
    });

    it('flags hour 25', () => {
      const itinerary: Itinerary = {
        days: [
          {
            day: 1,
            stops: [
              { category: 'lodging', name: '호텔 출발', start_time: '09:00' },
              { category: 'attraction', name: '경복궁', start_time: '25:00' },
              { category: 'food', name: '식당', start_time: '12:00' },
              { category: 'lodging', name: '호텔 복귀', start_time: '20:00' },
            ],
          },
        ],
      };
      const errors = validatePatternStructure(itinerary, {});
      expect(errors.some((e: string) => e.includes('B-14') && e.includes('25:00'))).toBe(true);
    });

    it('accepts 23:59', () => {
      const itinerary: Itinerary = {
        days: [
          {
            day: 1,
            stops: [
              { category: 'lodging', name: '호텔 출발', start_time: '09:00' },
              { category: 'attraction', name: '경복궁', start_time: '11:00' },
              { category: 'food', name: '한강 야경', start_time: '23:59' },
              { category: 'lodging', name: '호텔 복귀', start_time: '23:59' },
            ],
          },
        ],
      };
      const errors = validatePatternStructure(itinerary, {});
      expect(errors.some((e: string) => e.includes('B-14'))).toBe(false);
    });

    it('flags minutes >= 60', () => {
      const itinerary: Itinerary = {
        days: [
          {
            day: 1,
            stops: [
              { category: 'lodging', name: '호텔 출발', start_time: '09:00' },
              { category: 'attraction', name: '경복궁', start_time: '10:75' },
              { category: 'food', name: '식당', start_time: '12:00' },
              { category: 'lodging', name: '호텔 복귀', start_time: '20:00' },
            ],
          },
        ],
      };
      const errors = validatePatternStructure(itinerary, {});
      expect(errors.some((e: string) => e.includes('B-14') && e.includes('minutes'))).toBe(true);
    });
  });

  describe('B-13: 다도시 도시 전환 lodging name 매칭', () => {
    it('flags Seoul day with Busan lodging name (regions=[seoul,busan])', () => {
      const itinerary: Itinerary = {
        days: [
          // Day 1 부산 — 정상
          {
            day: 1,
            city: 'Busan',
            stops: [
              { category: 'lodging', name: '해운대 호텔', address: '부산광역시 해운대구', start_time: '09:00' },
              { category: 'attraction', name: '해운대 해수욕장', start_time: '10:30' },
              { category: 'food', name: '광안리 회센터', start_time: '12:30' },
              { category: 'lodging', name: '해운대 호텔', address: '부산광역시 해운대구', start_time: '20:00' },
            ],
          },
          // Day 2 서울 — 그런데 lodging 이 부산 호텔로 잘못 매칭 (B-13 violation)
          {
            day: 2,
            city: 'Seoul',
            stops: [
              { category: 'lodging', name: '해운대 호텔', address: '부산광역시 해운대구', start_time: '09:00' },
              { category: 'attraction', name: '경복궁', start_time: '11:30' },
              { category: 'food', name: '광장시장', start_time: '13:00' },
              { category: 'lodging', name: '명동 호텔', address: '서울특별시 중구', start_time: '20:00' },
            ],
          },
        ],
      };
      const errors = validatePatternStructure(itinerary, { regions: ['seoul', 'busan'] });
      expect(errors.some((e: string) => e.includes('B-13') && e.includes('Day 2'))).toBe(true);
    });

    it('passes when lodging address matches Seoul day', () => {
      const itinerary: Itinerary = {
        days: [
          {
            day: 1,
            city: 'Seoul',
            stops: [
              { category: 'lodging', name: '명동 호텔', address: '서울특별시 중구 명동길', start_time: '09:00' },
              { category: 'attraction', name: '경복궁', start_time: '10:30' },
              { category: 'food', name: '광장시장', start_time: '12:30' },
              { category: 'lodging', name: '명동 호텔', address: '서울특별시 중구 명동길', start_time: '20:00' },
            ],
          },
          {
            day: 2,
            city: 'Busan',
            stops: [
              { category: 'lodging', name: '해운대 그랜드 호텔', address: '부산광역시 해운대구', start_time: '12:00' },
              { category: 'attraction', name: '해운대 해수욕장', start_time: '14:00' },
              { category: 'food', name: '돼지국밥', start_time: '18:00' },
              { category: 'lodging', name: '해운대 그랜드 호텔', address: '부산광역시 해운대구', start_time: '21:00' },
            ],
          },
        ],
      };
      const errors = validatePatternStructure(itinerary, { regions: ['seoul', 'busan'] });
      expect(errors.some((e: string) => e.includes('B-13'))).toBe(false);
    });

    it('passes English city alias (Seoul name)', () => {
      const itinerary: Itinerary = {
        days: [
          {
            day: 1,
            city: 'Seoul',
            stops: [
              { category: 'lodging', name: 'Seoul Station Hotel', address: 'Jung-gu', start_time: '09:00' },
              { category: 'attraction', name: 'Gyeongbokgung', start_time: '10:30' },
              { category: 'food', name: 'Tosokchon', start_time: '12:30' },
              { category: 'lodging', name: 'Seoul Station Hotel', address: 'Jung-gu', start_time: '20:00' },
            ],
          },
          {
            day: 2,
            city: 'Busan',
            stops: [
              { category: 'lodging', name: 'Haeundae Beach Hotel', address: '부산 해운대구', start_time: '12:00' },
              { category: 'attraction', name: 'Haeundae Beach', start_time: '14:00' },
              { category: 'food', name: 'Milmyeon', start_time: '18:00' },
              { category: 'lodging', name: 'Haeundae Beach Hotel', address: '부산 해운대구', start_time: '21:00' },
            ],
          },
        ],
      };
      const errors = validatePatternStructure(itinerary, { regions: ['seoul', 'busan'] });
      expect(errors.some((e: string) => e.includes('B-13'))).toBe(false);
    });

    it('skips B-13 for single-city plan (regions.length === 1)', () => {
      // day.city 가 명시되어도 단도시 plan 이면 B-13 검증 skip
      const itinerary: Itinerary = {
        days: [
          {
            day: 1,
            city: 'Busan', // 의도적 mismatch
            stops: [
              { category: 'lodging', name: '서울 명동 호텔', address: '서울특별시 중구', start_time: '09:00' },
              { category: 'attraction', name: '경복궁', start_time: '10:30' },
              { category: 'food', name: '광장시장', start_time: '12:30' },
              { category: 'lodging', name: '서울 명동 호텔', address: '서울특별시 중구', start_time: '20:00' },
            ],
          },
        ],
      };
      const errors = validatePatternStructure(itinerary, { regions: ['seoul'] });
      expect(errors.some((e: string) => e.includes('B-13'))).toBe(false);
    });

    it('skips B-13 when day.city missing', () => {
      const itinerary: Itinerary = {
        days: [
          // city 누락 → B-13 skip
          {
            day: 1,
            stops: [
              { category: 'lodging', name: '해운대 호텔', address: '부산', start_time: '09:00' },
              { category: 'attraction', name: '경복궁', start_time: '10:30' },
              { category: 'food', name: '광장시장', start_time: '12:30' },
              { category: 'lodging', name: '해운대 호텔', address: '부산', start_time: '20:00' },
            ],
          },
        ],
      };
      const errors = validatePatternStructure(itinerary, { regions: ['seoul', 'busan'] });
      expect(errors.some((e: string) => e.includes('B-13'))).toBe(false);
    });

    it('skips B-13 when first stop is not lodging (B-10 jumps in first)', () => {
      const itinerary: Itinerary = {
        days: [
          {
            day: 1,
            city: 'Seoul',
            stops: [
              // 첫 stop = attraction → B-10 fail, B-13 skip
              { category: 'attraction', name: '해운대 해수욕장', address: '부산', start_time: '09:00' },
              { category: 'food', name: '광장시장', start_time: '11:00' },
              { category: 'attraction', name: '경복궁', start_time: '13:00' },
              { category: 'lodging', name: '명동 호텔', start_time: '20:00' },
            ],
          },
        ],
      };
      const errors = validatePatternStructure(itinerary, { regions: ['seoul', 'busan'] });
      // B-10 잡힘, B-13 은 skip (lodging stop[0] 아니므로)
      expect(errors.some((e: string) => e.includes('B-10'))).toBe(true);
      expect(errors.some((e: string) => e.includes('B-13'))).toBe(false);
    });
  });

  describe('B-15: 출국일 공항 또는 travel/airport category 또는 meta', () => {
    it('flags last day missing airport stop when departure_airport given', () => {
      const itinerary: Itinerary = { days: [makeValidDay({ day: 1 }), makeValidDay({ day: 2 })] };
      const errors = validatePatternStructure(itinerary, {
        departure_airport: 'ICN',
      });
      expect(errors.some((e: string) => e.includes('B-15') && e.includes('출국일'))).toBe(true);
    });

    it('passes when last day has travel category stop', () => {
      const itinerary: Itinerary = {
        days: [
          makeValidDay({ day: 1 }),
          {
            day: 2,
            city: 'Seoul',
            stops: [
              { category: 'lodging', name: '호텔 출발', start_time: '09:00' },
              { category: 'food', name: '아침 식사', start_time: '10:00' },
              { category: 'attraction', name: '면세점 쇼핑', start_time: '12:00' },
              { category: 'travel', name: '인천공항 T1', address: '인천국제공항', start_time: '15:00' },
            ],
          },
        ],
      };
      const errors = validatePatternStructure(itinerary, { departure_airport: 'ICN' });
      // pattern-level B-15 should pass (no B-15 errors). Note: there may be other
      // valid errors (e.g. last stop is travel not lodging) — B-10 accepts both.
      expect(errors.some((e: string) => e.includes('B-15'))).toBe(false);
    });

    it('passes when last day has airport category stop (regression alignment)', () => {
      const itinerary: Itinerary = {
        days: [
          makeValidDay({ day: 1 }),
          {
            day: 2,
            city: 'Seoul',
            stops: [
              { category: 'lodging', name: '호텔 출발', start_time: '09:00' },
              { category: 'food', name: '아침 식사', start_time: '10:00' },
              { category: 'attraction', name: '면세점 쇼핑', start_time: '12:00' },
              { category: 'airport', name: '인천국제공항 T1', start_time: '15:00' },
            ],
          },
        ],
      };
      const errors = validatePatternStructure(itinerary, { departure_airport: 'ICN' });
      expect(errors.some((e: string) => e.includes('B-15'))).toBe(false);
    });

    it('passes when last day has return_to_airport meta', () => {
      const itinerary: Itinerary = {
        days: [
          makeValidDay({ day: 1 }),
          {
            day: 2,
            city: 'Seoul',
            return_to_airport: true,
            stops: [
              { category: 'lodging', name: '호텔 출발', start_time: '09:00' },
              { category: 'food', name: '아침 식사', start_time: '10:00' },
              { category: 'attraction', name: '면세점 쇼핑', start_time: '12:00' },
              { category: 'lodging', name: '명동 호텔 체크아웃', start_time: '15:00' },
            ],
          },
        ],
      };
      const errors = validatePatternStructure(itinerary, { departure_airport: 'ICN' });
      expect(errors.some((e: string) => e.includes('B-15'))).toBe(false);
    });

    it('passes when last stop has transit_to_airport meta', () => {
      const itinerary: Itinerary = {
        days: [
          makeValidDay({ day: 1 }),
          {
            day: 2,
            city: 'Seoul',
            stops: [
              { category: 'lodging', name: '호텔 출발', start_time: '09:00' },
              { category: 'food', name: '아침 식사', start_time: '10:00' },
              { category: 'attraction', name: '면세점 쇼핑', start_time: '12:00' },
              { category: 'lodging', name: '호텔 체크아웃', transit_to_airport: true, start_time: '15:00' },
            ],
          },
        ],
      };
      const errors = validatePatternStructure(itinerary, { departure_airport: 'ICN' });
      expect(errors.some((e: string) => e.includes('B-15'))).toBe(false);
    });

    it('passes when last day stop name mentions airport', () => {
      const itinerary: Itinerary = {
        days: [
          makeValidDay({ day: 1 }),
          {
            day: 2,
            city: 'Seoul',
            stops: [
              { category: 'lodging', name: '호텔 출발', start_time: '09:00' },
              { category: 'food', name: '아침 식사', start_time: '10:00' },
              { category: 'attraction', name: '서울역', start_time: '12:00' },
              { category: 'lodging', name: '인천국제공항 도착', address: '인천 중구 공항로', start_time: '15:00' },
            ],
          },
        ],
      };
      const errors = validatePatternStructure(itinerary, { departure_airport: 'ICN' });
      // B-15 should not flag (airport keyword in name). B-10 might still pass since
      // last category is 'lodging'.
      expect(errors.some((e: string) => e.includes('B-15'))).toBe(false);
    });

    it('passes when last stop name contains ICN token only', () => {
      const itinerary: Itinerary = {
        days: [
          makeValidDay({ day: 1 }),
          {
            day: 2,
            city: 'Seoul',
            stops: [
              { category: 'lodging', name: '호텔 출발', start_time: '09:00' },
              { category: 'food', name: '아침 식사', start_time: '10:00' },
              { category: 'attraction', name: '면세점', start_time: '12:00' },
              { category: 'lodging', name: 'ICN Terminal 1', start_time: '15:00' },
            ],
          },
        ],
      };
      const errors = validatePatternStructure(itinerary, { departure_airport: 'ICN' });
      expect(errors.some((e: string) => e.includes('B-15'))).toBe(false);
    });

    it('skips B-15 when departure_airport is ALREADY', () => {
      const itinerary: Itinerary = { days: [makeValidDay({ day: 1 }), makeValidDay({ day: 2 })] };
      const errors = validatePatternStructure(itinerary, {
        departure_airport: 'ALREADY',
      });
      expect(errors.some((e: string) => e.includes('B-15'))).toBe(false);
    });

    it('skips B-15 when departure_airport is already_in_korea', () => {
      const itinerary: Itinerary = { days: [makeValidDay({ day: 1 }), makeValidDay({ day: 2 })] };
      const errors = validatePatternStructure(itinerary, {
        departure_airport: 'already_in_korea',
      });
      expect(errors.some((e: string) => e.includes('B-15'))).toBe(false);
    });

    it('skips B-15 when no airport info in request', () => {
      const itinerary: Itinerary = { days: [makeValidDay({ day: 1 }), makeValidDay({ day: 2 })] };
      const errors = validatePatternStructure(itinerary, {});
      expect(errors.some((e: string) => e.includes('B-15'))).toBe(false);
    });

    it('falls back to arrival_airport when departure_airport missing', () => {
      const itinerary: Itinerary = { days: [makeValidDay({ day: 1 }), makeValidDay({ day: 2 })] };
      const errors = validatePatternStructure(itinerary, { arrival_airport: 'ICN' });
      expect(errors.some((e: string) => e.includes('B-15'))).toBe(true);
    });
  });

  describe('edge cases', () => {
    it('returns error for missing days array', () => {
      const errors = validatePatternStructure({} as Itinerary, {});
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0]).toContain('days');
    });

    it('returns error for null itinerary', () => {
      const errors = validatePatternStructure(null as unknown as Itinerary, {});
      expect(errors.length).toBeGreaterThan(0);
    });

    it('accepts camelCase request keys', () => {
      const itinerary: Itinerary = { days: [makeValidDay({ day: 1 }), makeValidDay({ day: 2 })] };
      const errors = validatePatternStructure(itinerary, {
        departureAirport: 'ICN',
      });
      expect(errors.some((e: string) => e.includes('B-15'))).toBe(true);
    });

    it('handles missing start_time gracefully (no B-14 error)', () => {
      const itinerary: Itinerary = {
        days: [
          {
            day: 1,
            stops: [
              { category: 'lodging', name: '호텔 출발' },
              { category: 'attraction', name: '경복궁' },
              { category: 'food', name: '식당' },
              { category: 'lodging', name: '호텔 복귀' },
            ],
          },
        ],
      };
      const errors = validatePatternStructure(itinerary, {});
      expect(errors.some((e: string) => e.includes('B-14'))).toBe(false);
    });
  });
});
