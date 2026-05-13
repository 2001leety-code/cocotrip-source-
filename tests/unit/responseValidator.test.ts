// Coverage for api/_ai_core/responseValidator.js — validatePatternStructure (B-10/B-12/B-13/B-14/B-15).
// Pure function tests — no Gemini call needed.
import { describe, it, expect } from 'vitest';
// @ts-expect-error — JS module, no types
import { validatePatternStructure, checkSoftQualityWarnings } from '../../api/_ai_core/responseValidator.js';

interface Stop {
  name?: string;
  display_name?: string;
  address?: string;
  category?: string;
  start_time?: string;
  transit_to_airport?: boolean;
  next_destination?: string;
}
interface IntercityTransit {
  mode?: string;
  from_city?: string;
  to_city?: string;
}
interface Day {
  day?: number;
  day_index?: number;
  city?: string;
  theme?: string;
  stops?: Stop[];
  return_to_airport?: boolean;
  airport_transfer?: boolean;
  intercity_transit?: IntercityTransit;
}
interface AirportField {
  airport?: string;
}
interface Itinerary {
  days?: Day[];
  arrival_guide?: AirportField;
  departure_guide?: AirportField;
}

// Helper: a structurally-correct day with N stops (lodging bookend, 4+ stops).
// 2026-05-12: B-13 4-layer fallback 추가 후, 다도시 plan 에서도 이 helper 가
// 잡히지 않도록 lodging name 에 city 토큰 자동 삽입 (Seoul 호텔 / Busan 호텔 등).
// 2026-05-13 (PR #407 B-MEAL): full day 는 점심+저녁 둘 다 필수.
// 기본 makeValidDay 가 dinner food stop 도 포함 (18:30) — B-MEAL 통과.
function makeValidDay(opts: { day?: number; city?: string; stops?: Stop[] } = {}): Day {
  const city = opts.city ?? 'Seoul';
  // city 한글 매핑 — B-13 L1 (lodging name 매칭) 자동 통과.
  const cityKor: Record<string, string> = {
    Seoul: '서울', Busan: '부산', Jeju: '제주', Gangneung: '강릉',
    Sokcho: '속초', Gyeongju: '경주', Jeonju: '전주',
  };
  const cityToken = cityKor[city] || city;
  return {
    day: opts.day ?? 1,
    city,
    stops: opts.stops ?? [
      { category: 'lodging', name: `${cityToken} 호텔 출발`, start_time: '09:00' },
      { category: 'attraction', name: '경복궁', start_time: '10:30' },
      { category: 'food', name: '광장시장', start_time: '12:30' },
      { category: 'attraction', name: '북촌한옥마을', start_time: '14:30' },
      { category: 'food', name: '인사동 한식', start_time: '18:30' },
      { category: 'lodging', name: `${cityToken} 호텔 복귀`, start_time: '20:30' },
    ],
  };
}

describe('validatePatternStructure (api/_ai_core/responseValidator.js)', () => {
  describe('valid itinerary', () => {
    it('returns empty errors for a well-formed single-day plan', () => {
      const itinerary: Itinerary = {
        days: [makeValidDay()],
        departure_guide: { airport: 'ICN T1' },
      };
      const errors = validatePatternStructure(itinerary, {});
      expect(errors).toEqual([]);
    });

    it('returns empty errors for multi-day plan with lodging bookends', () => {
      const itinerary: Itinerary = {
        days: [makeValidDay({ day: 1 }), makeValidDay({ day: 2 })],
        departure_guide: { airport: 'ICN T1' },
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
      const itinerary: Itinerary = {
        days: [makeValidDay(), lastDay],
        arrival_guide: { airport: 'ICN T1' },
        departure_guide: { airport: 'ICN T1' },
      };
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

    // 2026-05-12 오후 자율 검증 시스템 첫 적용 — W2 prod intermittent fail 진단 결과
    // 4-layer fallback 추가. 다음 4 케이스 모두 PASS 해야 false positive 차단.
    it('B-13 L2 fallback — passes when day.theme contains city token', () => {
      const itinerary: Itinerary = {
        days: [
          makeValidDay({ day: 1, city: 'Seoul' }),
          {
            day: 2,
            city: 'Busan',
            theme: 'Busan Day 1 — 해운대 & 광안리',
            stops: [
              // lodging name 만 ("Lotte L7") — city 토큰 없음. theme 이 잡아줌.
              { category: 'lodging', name: 'L7 Hotel', address: 'Suyeong-gu', start_time: '12:00' },
              { category: 'attraction', name: 'Beach', start_time: '14:00' },
              { category: 'food', name: 'Restaurant', start_time: '18:00' },
              { category: 'lodging', name: 'L7 Hotel', start_time: '21:00' },
            ],
          },
        ],
      };
      const errors = validatePatternStructure(itinerary, { regions: ['seoul', 'busan'] });
      expect(errors.some((e: string) => e.includes('B-13'))).toBe(false);
    });

    it('B-13 L3 fallback — passes when day.intercity_transit.to_city matches', () => {
      const itinerary: Itinerary = {
        days: [
          makeValidDay({ day: 1, city: 'Seoul' }),
          {
            day: 2,
            city: 'Busan',
            theme: 'Coastal Adventure',
            intercity_transit: { mode: 'KTX', from_city: 'Seoul', to_city: 'Busan' },
            stops: [
              // city 토큰 lodging/theme 둘 다 없음. intercity_transit 이 잡아줌.
              { category: 'lodging', name: 'Skybay Hotel', address: 'Suyeong-gu', start_time: '12:00' },
              { category: 'attraction', name: 'Beach', start_time: '14:00' },
              { category: 'food', name: 'Sashimi', start_time: '18:00' },
              { category: 'lodging', name: 'Skybay Hotel', start_time: '21:00' },
            ],
          },
        ],
      };
      const errors = validatePatternStructure(itinerary, { regions: ['seoul', 'busan'] });
      expect(errors.some((e: string) => e.includes('B-13'))).toBe(false);
    });

    it('B-13 L4 fallback — passes when lodging name is known hotel chain', () => {
      const itinerary: Itinerary = {
        days: [
          makeValidDay({ day: 1, city: 'Seoul' }),
          {
            day: 2,
            city: 'Busan',
            theme: 'Day Out',
            stops: [
              // city 토큰 없음 + intercity_transit 없음. Lotte 체인이 잡아줌.
              { category: 'lodging', name: 'Lotte L7 Gangnam', address: 'Gangnam-gu', start_time: '12:00' },
              { category: 'attraction', name: 'Beach', start_time: '14:00' },
              { category: 'food', name: 'Restaurant', start_time: '18:00' },
              { category: 'lodging', name: 'Lotte L7 Gangnam', start_time: '21:00' },
            ],
          },
        ],
      };
      const errors = validatePatternStructure(itinerary, { regions: ['seoul', 'busan'] });
      expect(errors.some((e: string) => e.includes('B-13'))).toBe(false);
    });

    it('B-13 still flags when ALL 4 layers fail (true mismatch)', () => {
      const itinerary: Itinerary = {
        days: [
          makeValidDay({ day: 1, city: 'Seoul' }),
          {
            day: 2,
            city: 'Busan',
            theme: 'Generic Day',
            intercity_transit: { mode: 'KTX', from_city: 'Seoul', to_city: 'Daegu' }, // 잘못된 to_city
            stops: [
              // 진짜 mismatch: city 토큰 없음 + theme 없음 + intercity_transit 다른 도시 + 무명 호텔
              { category: 'lodging', name: 'Cozy Stay', address: '서울 강남구', start_time: '12:00' },
              { category: 'attraction', name: 'Beach', start_time: '14:00' },
              { category: 'food', name: 'Restaurant', start_time: '18:00' },
              { category: 'lodging', name: 'Cozy Stay', start_time: '21:00' },
            ],
          },
        ],
      };
      const errors = validatePatternStructure(itinerary, { regions: ['seoul', 'busan'] });
      expect(errors.some((e: string) => e.includes('B-13') && e.includes('Day 2'))).toBe(true);
    });

    it('B-13 extended CITY_KOR_ALIASES — Yongin/Sejong/Pohang etc.', () => {
      const itinerary: Itinerary = {
        days: [
          makeValidDay({ day: 1, city: 'Seoul' }),
          {
            day: 2,
            city: 'Yongin',
            stops: [
              { category: 'lodging', name: '용인 호텔', address: '경기도 용인시', start_time: '12:00' },
              { category: 'attraction', name: 'Everland', start_time: '14:00' },
              { category: 'food', name: 'Local food', start_time: '18:00' },
              { category: 'lodging', name: '용인 호텔', start_time: '21:00' },
            ],
          },
        ],
      };
      const errors = validatePatternStructure(itinerary, { regions: ['seoul', 'yongin'] });
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

  // 2026-05-12 자율 검증 1차 fix — B-16 hard validation (PDF 사전조건).
  // arrival_guide.airport OR departure_guide.airport 적어도 하나 채워야 PDF 페이지 렌더 가능.
  describe('B-16: arrival_guide / departure_guide airport hard validation', () => {
    it('flags when BOTH arrival_guide and departure_guide are missing', () => {
      const itinerary: Itinerary = { days: [makeValidDay({ day: 1 })] };
      const errors = validatePatternStructure(itinerary, {});
      expect(errors.some((e: string) => e.includes('B-16'))).toBe(true);
    });

    it('passes when departure_guide.airport is present', () => {
      const itinerary: Itinerary = {
        days: [makeValidDay({ day: 1 })],
        departure_guide: { airport: 'ICN T1' },
      };
      const errors = validatePatternStructure(itinerary, {});
      expect(errors.some((e: string) => e.includes('B-16'))).toBe(false);
    });

    it('passes when arrival_guide.airport is present (departure missing)', () => {
      const itinerary: Itinerary = {
        days: [makeValidDay({ day: 1 })],
        arrival_guide: { airport: 'GMP' },
      };
      const errors = validatePatternStructure(itinerary, {});
      expect(errors.some((e: string) => e.includes('B-16'))).toBe(false);
    });

    it('flags when airport field is empty string', () => {
      const itinerary: Itinerary = {
        days: [makeValidDay({ day: 1 })],
        arrival_guide: { airport: '' },
        departure_guide: { airport: '   ' },
      };
      const errors = validatePatternStructure(itinerary, {});
      expect(errors.some((e: string) => e.includes('B-16'))).toBe(true);
    });
  });

  // 2026-05-13 PR #407: B-DC + B-MEAL 신규 hard validation.
  // 사용자 PDF 보고 (Guest-5--2026-05-14) 트리거: 5일 결제했는데 PDF Day 4 까지만
  // (Day 5 누락) + Day 2 저녁 누락 (hotel 17:43 종료) + 불고기 Day 1/4 중복.
  describe('B-DC: day count must match request.durationDays', () => {
    it('flags when itinerary.days.length is less than requested', () => {
      const itinerary: Itinerary = {
        days: [makeValidDay({ day: 1 }), makeValidDay({ day: 2 }), makeValidDay({ day: 3 }), makeValidDay({ day: 4 })],
        departure_guide: { airport: 'ICN T1' },
      };
      const errors = validatePatternStructure(itinerary, { durationDays: 5 });
      expect(errors.some((e: string) => e.includes('B-DC') && e.includes('days.length=4') && e.includes('durationDays=5'))).toBe(true);
    });

    it('flags when itinerary.days.length is greater than requested', () => {
      const itinerary: Itinerary = {
        days: [makeValidDay({ day: 1 }), makeValidDay({ day: 2 }), makeValidDay({ day: 3 })],
        departure_guide: { airport: 'ICN T1' },
      };
      const errors = validatePatternStructure(itinerary, { durationDays: 2 });
      expect(errors.some((e: string) => e.includes('B-DC') && e.includes('days.length=3') && e.includes('durationDays=2'))).toBe(true);
    });

    it('passes when itinerary.days.length matches requested', () => {
      const itinerary: Itinerary = {
        days: [makeValidDay({ day: 1 }), makeValidDay({ day: 2 }), makeValidDay({ day: 3 })],
        departure_guide: { airport: 'ICN T1' },
      };
      const errors = validatePatternStructure(itinerary, { durationDays: 3 });
      expect(errors.filter((e: string) => e.includes('B-DC'))).toEqual([]);
    });

    it('also accepts snake_case duration_days', () => {
      const itinerary: Itinerary = {
        days: [makeValidDay({ day: 1 })],
        departure_guide: { airport: 'ICN T1' },
      };
      const errors = validatePatternStructure(itinerary, { duration_days: 3 });
      expect(errors.some((e: string) => e.includes('B-DC'))).toBe(true);
    });

    it('skips when durationDays is missing or invalid (backward compat)', () => {
      const itinerary: Itinerary = {
        days: [makeValidDay({ day: 1 })],
        departure_guide: { airport: 'ICN T1' },
      };
      // request 빈 객체 — durationDays 없음 → B-DC skip
      expect(validatePatternStructure(itinerary, {}).filter((e: string) => e.includes('B-DC'))).toEqual([]);
      // durationDays=0 → skip
      expect(validatePatternStructure(itinerary, { durationDays: 0 }).filter((e: string) => e.includes('B-DC'))).toEqual([]);
      // durationDays=null → skip
      expect(validatePatternStructure(itinerary, { durationDays: null }).filter((e: string) => e.includes('B-DC'))).toEqual([]);
      // durationDays='abc' → skip
      expect(validatePatternStructure(itinerary, { durationDays: 'abc' }).filter((e: string) => e.includes('B-DC'))).toEqual([]);
    });
  });

  describe('B-MEAL: lunch + dinner coverage per full day', () => {
    // Helper — day with only lodging + attractions, no food stops
    function makeDayNoFood(day: number): Day {
      return {
        day,
        city: 'Seoul',
        stops: [
          { category: 'lodging', name: '서울 호텔 출발', start_time: '09:00' },
          { category: 'attraction', name: 'A1', start_time: '10:00' },
          { category: 'attraction', name: 'A2', start_time: '14:00' },
          { category: 'attraction', name: 'A3', start_time: '16:00' },
          { category: 'lodging', name: '서울 호텔 복귀', start_time: '20:00' },
        ],
      };
    }

    it('flags full day with no lunch (only dinner)', () => {
      // 3-day plan: day 2 = full day, no lunch
      const day2NoLunch: Day = {
        day: 2,
        city: 'Seoul',
        stops: [
          { category: 'lodging', name: '서울 호텔 출발', start_time: '09:00' },
          { category: 'attraction', name: '경복궁', start_time: '10:00' },
          { category: 'attraction', name: 'N서울타워', start_time: '14:00' },
          { category: 'food', name: '저녁 식당', start_time: '18:30' },
          { category: 'lodging', name: '서울 호텔 복귀', start_time: '20:30' },
        ],
      };
      const itinerary: Itinerary = {
        days: [makeValidDay({ day: 1 }), day2NoLunch, makeValidDay({ day: 3 })],
        departure_guide: { airport: 'ICN T1' },
      };
      const errors = validatePatternStructure(itinerary, {});
      expect(errors.some((e: string) => e.includes('B-MEAL-LUNCH') && e.includes('Day 2'))).toBe(true);
      expect(errors.some((e: string) => e.includes('B-MEAL-DINNER') && e.includes('Day 2'))).toBe(false);
    });

    it('flags full day with no dinner (only lunch) — sample from Guest PDF Day 2', () => {
      // Wizard 5-day plan, Day 2 reproduces PDF bug: hotel return 17:43 with no dinner.
      const day2NoDinner: Day = {
        day: 2,
        city: 'Seoul',
        stops: [
          { category: 'lodging', name: '서울 호텔 출발', start_time: '09:30' },
          { category: 'attraction', name: '북촌한옥마을', start_time: '10:52' },
          { category: 'food', name: 'KUT SEOUL', start_time: '13:12' },
          { category: 'attraction', name: '인사동거리', start_time: '14:36' },
          { category: 'attraction', name: '조계사', start_time: '16:18' },
          { category: 'lodging', name: '서울 호텔 복귀', start_time: '17:43' },
        ],
      };
      const itinerary: Itinerary = {
        days: [makeValidDay({ day: 1 }), day2NoDinner, makeValidDay({ day: 3 })],
        departure_guide: { airport: 'ICN T1' },
      };
      const errors = validatePatternStructure(itinerary, {});
      expect(errors.some((e: string) => e.includes('B-MEAL-DINNER') && e.includes('Day 2'))).toBe(true);
      expect(errors.some((e: string) => e.includes('B-MEAL-LUNCH') && e.includes('Day 2'))).toBe(false);
    });

    it('flags full day with no food at all', () => {
      const itinerary: Itinerary = {
        days: [makeValidDay({ day: 1 }), makeDayNoFood(2), makeValidDay({ day: 3 })],
        departure_guide: { airport: 'ICN T1' },
      };
      const errors = validatePatternStructure(itinerary, {});
      expect(errors.some((e: string) => e.includes('B-MEAL-LUNCH') && e.includes('Day 2'))).toBe(true);
      expect(errors.some((e: string) => e.includes('B-MEAL-DINNER') && e.includes('Day 2'))).toBe(true);
    });

    it('allows arrival day (first) with only dinner — common 15:00 check-in pattern', () => {
      // Wizard 5-day plan, Day 1 reproduces PDF: 15:00 check-in, dinner 18:52, hotel 21:15.
      const day1Arrival: Day = {
        day: 1,
        city: 'Seoul',
        stops: [
          { category: 'lodging', name: '서울 호텔 도착', start_time: '15:00' },
          { category: 'attraction', name: '명동거리', start_time: '16:44' },
          { category: 'food', name: '한식왕비집', start_time: '18:52' },
          { category: 'attraction', name: '명동성당', start_time: '20:17' },
          { category: 'lodging', name: '서울 호텔 복귀', start_time: '21:15' },
        ],
      };
      const itinerary: Itinerary = {
        days: [day1Arrival, makeValidDay({ day: 2 }), makeValidDay({ day: 3 })],
        departure_guide: { airport: 'ICN T1' },
      };
      const errors = validatePatternStructure(itinerary, {});
      // 도착일은 점심 OR 저녁 중 1개 OK
      expect(errors.filter((e: string) => e.includes('B-MEAL') && e.includes('Day 1'))).toEqual([]);
    });

    it('flags arrival day with no food at all', () => {
      const itinerary: Itinerary = {
        days: [makeDayNoFood(1), makeValidDay({ day: 2 }), makeValidDay({ day: 3 })],
        departure_guide: { airport: 'ICN T1' },
      };
      const errors = validatePatternStructure(itinerary, {});
      // 도착일도 식사 0건 = 차단 (점심 또는 저녁 중 최소 1개)
      expect(errors.some((e: string) => e.includes('B-MEAL') && e.includes('Day 1') && e.includes('도착일'))).toBe(true);
    });

    it('allows departure day (last) with only lunch — common pre-departure pattern', () => {
      const dayLastLunchOnly: Day = {
        day: 3,
        city: 'Seoul',
        stops: [
          { category: 'lodging', name: '서울 호텔 출발', start_time: '09:00' },
          { category: 'attraction', name: '남산타워', start_time: '10:00' },
          { category: 'food', name: '점심 식당', start_time: '12:30' },
          { category: 'travel', name: '인천국제공항 T1', start_time: '15:00' },
        ],
      };
      const itinerary: Itinerary = {
        days: [makeValidDay({ day: 1 }), makeValidDay({ day: 2 }), dayLastLunchOnly],
        arrival_guide: { airport: 'ICN T1' },
        departure_guide: { airport: 'ICN T1' },
      };
      const errors = validatePatternStructure(itinerary, {});
      expect(errors.filter((e: string) => e.includes('B-MEAL') && e.includes('Day 3'))).toEqual([]);
    });

    it('allows single-day plan with both lunch and dinner', () => {
      const itinerary: Itinerary = {
        days: [makeValidDay({ day: 1 })],
        departure_guide: { airport: 'ICN T1' },
      };
      const errors = validatePatternStructure(itinerary, {});
      // makeValidDay 가 lunch 12:30 + dinner 18:30 둘 다 있음 → 통과
      expect(errors.filter((e: string) => e.includes('B-MEAL'))).toEqual([]);
    });

    it('flags single-day plan with only lunch (B-MEAL-DINNER)', () => {
      const singleDayNoDinner: Day = {
        day: 1,
        city: 'Seoul',
        stops: [
          { category: 'lodging', name: '서울 호텔', start_time: '09:00' },
          { category: 'attraction', name: '경복궁', start_time: '10:00' },
          { category: 'food', name: '광장시장', start_time: '12:30' },
          { category: 'attraction', name: '명동', start_time: '15:00' },
        ],
      };
      const itinerary: Itinerary = { days: [singleDayNoDinner] };
      const errors = validatePatternStructure(itinerary, {});
      // 단일일 = full day 처리 → 점심 + 저녁 둘 다 필수
      expect(errors.some((e: string) => e.includes('B-MEAL-DINNER'))).toBe(true);
    });

    it('counts lunch at boundary 13:59 and dinner at boundary 17:00 / 20:59', () => {
      const dayBoundary: Day = {
        day: 2,
        city: 'Seoul',
        stops: [
          { category: 'lodging', name: '서울 호텔 출발', start_time: '09:00' },
          { category: 'attraction', name: 'A', start_time: '10:00' },
          { category: 'food', name: '점심 13:59', start_time: '13:59' },
          { category: 'attraction', name: 'B', start_time: '15:00' },
          { category: 'food', name: '저녁 20:59', start_time: '20:59' },
          { category: 'lodging', name: '서울 호텔 복귀', start_time: '21:30' },
        ],
      };
      const itinerary: Itinerary = {
        days: [makeValidDay({ day: 1 }), dayBoundary, makeValidDay({ day: 3 })],
      };
      const errors = validatePatternStructure(itinerary, {});
      expect(errors.filter((e: string) => e.includes('B-MEAL') && e.includes('Day 2'))).toEqual([]);
    });

    it('rejects lunch at boundary 14:00 (out of range)', () => {
      const dayLateLunch: Day = {
        day: 2,
        city: 'Seoul',
        stops: [
          { category: 'lodging', name: '서울 호텔 출발', start_time: '09:00' },
          { category: 'attraction', name: 'A', start_time: '10:00' },
          { category: 'food', name: '점심 14:00 (late)', start_time: '14:00' },
          { category: 'attraction', name: 'B', start_time: '16:00' },
          { category: 'food', name: '저녁 18:30', start_time: '18:30' },
          { category: 'lodging', name: '서울 호텔 복귀', start_time: '21:00' },
        ],
      };
      const itinerary: Itinerary = {
        days: [makeValidDay({ day: 1 }), dayLateLunch, makeValidDay({ day: 3 })],
      };
      const errors = validatePatternStructure(itinerary, {});
      // 14:00 = 점심 slot 밖 → B-MEAL-LUNCH 위반
      expect(errors.some((e: string) => e.includes('B-MEAL-LUNCH') && e.includes('Day 2'))).toBe(true);
    });
  });
});

// 2026-05-12 자율 검증 1차 fix — B-18 SOFT warning (telegram alert only, plan 저장 OK).
// local_tag 비율 < 30% 시 warning 반환. SAFETY-CRITICAL 아니므로 hard 차단 X.
describe('checkSoftQualityWarnings (B-18 local_tag underfill)', () => {
  interface StopWithTag extends Stop {
    local_tag?: string;
  }
  function makeStopsWithLocalTagRatio(
    total: number,
    tagged: number,
  ): StopWithTag[] {
    const stops: StopWithTag[] = [];
    for (let i = 0; i < total; i++) {
      stops.push({
        category: i % 2 === 0 ? 'attraction' : 'food',
        name: `stop ${i}`,
        local_tag: i < tagged ? 'Local Pick' : '',
      });
    }
    return stops;
  }

  it('returns warning when local_tag ratio < 30%', () => {
    const itinerary: Itinerary = {
      days: [
        { day: 1, stops: makeStopsWithLocalTagRatio(10, 1) }, // 10%
      ],
    };
    const warnings = checkSoftQualityWarnings(itinerary);
    expect(warnings.length).toBe(1);
    expect(warnings[0].type).toBe('local_tag_underfill');
    expect(warnings[0].severity).toBe('low');
    expect(warnings[0].ratio).toBeCloseTo(0.1, 2);
  });

  it('returns empty warnings when local_tag ratio >= 30%', () => {
    const itinerary: Itinerary = {
      days: [
        { day: 1, stops: makeStopsWithLocalTagRatio(10, 4) }, // 40%
      ],
    };
    const warnings = checkSoftQualityWarnings(itinerary);
    expect(warnings).toEqual([]);
  });

  it('excludes lodging / travel / airport categories from ratio', () => {
    // 4 lodging + 1 attraction (tagged Local Pick) = 1/1 = 100% on eligible stops.
    // But total eligible = 1 < 5 → skip (statistical insignificance) → empty.
    const itinerary: Itinerary = {
      days: [
        {
          day: 1,
          stops: [
            { category: 'lodging', name: 'L1', local_tag: '' },
            { category: 'lodging', name: 'L2', local_tag: '' },
            { category: 'travel', name: 'T1', local_tag: '' },
            { category: 'airport', name: 'A1', local_tag: '' },
            { category: 'attraction', name: 'A2', local_tag: 'Local Pick' },
          ],
        },
      ],
    };
    const warnings = checkSoftQualityWarnings(itinerary);
    expect(warnings).toEqual([]);
  });

  it('skips check when totalEligible < 5 (statistical insignificance)', () => {
    const itinerary: Itinerary = {
      days: [
        {
          day: 1,
          stops: [
            { category: 'attraction', name: 'A1', local_tag: '' },
            { category: 'food', name: 'F1', local_tag: '' },
          ],
        },
      ],
    };
    const warnings = checkSoftQualityWarnings(itinerary);
    expect(warnings).toEqual([]);
  });

  it('only counts valid local_tag values (Local Pick / Hidden Gem / Bakery Pilgrimage / Blue Ribbon)', () => {
    // 8 attraction + 2 food, but local_tags are all invalid ("custom_tag")
    const itinerary: Itinerary = {
      days: [
        {
          day: 1,
          stops: [
            { category: 'attraction', name: 'A1', local_tag: 'custom_tag' },
            { category: 'attraction', name: 'A2', local_tag: 'custom_tag' },
            { category: 'attraction', name: 'A3', local_tag: 'custom_tag' },
            { category: 'attraction', name: 'A4', local_tag: 'custom_tag' },
            { category: 'attraction', name: 'A5', local_tag: 'custom_tag' },
            { category: 'food', name: 'F1', local_tag: '' },
            { category: 'food', name: 'F2', local_tag: '' },
          ],
        },
      ],
    };
    const warnings = checkSoftQualityWarnings(itinerary);
    // 0% valid tags → warning fires.
    expect(warnings.length).toBe(1);
    expect(warnings[0].localTagCount).toBe(0);
    expect(warnings[0].totalEligible).toBe(7);
  });

  it('handles missing itinerary gracefully (empty warnings)', () => {
    expect(checkSoftQualityWarnings(null as unknown as Itinerary)).toEqual([]);
    expect(checkSoftQualityWarnings({} as Itinerary)).toEqual([]);
    expect(checkSoftQualityWarnings({ days: [] })).toEqual([]);
  });
});
