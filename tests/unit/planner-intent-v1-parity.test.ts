// 2026-08-24 (planner-intent-v1): the client (src/pages/PlannerPage/lib/
// plannerIntent.ts) and server (api/_shared/plannerIntentV1.js) each carry
// their own copy of "what does a full-generation request look like", because
// api/ and src/ don't cross-import. This test feeds the client builder's
// output straight into the server normalizer and checks every field
// round-trips identically for NEW and REVISION, across all 4 reservation
// statuses, with no allergy concept anywhere.
import { describe, it, expect } from 'vitest';
import {
  buildFullPlannerIntentPayload,
  buildPlannerIntentV1,
  RESERVATION_STATUSES,
  PLANNER_INTENT_KEY,
} from '../../src/pages/PlannerPage/lib/plannerIntent';
import type { PlannerFormValues } from '../../src/components/PlannerForm';
import { normalizePlannerIntentV1 } from '../../api/_shared/plannerIntentV1.js';

function fullValues(overrides: Partial<PlannerFormValues> = {}): PlannerFormValues {
  return {
    categories: ['K-food', 'K-culture'],
    regions: ['Seoul', 'Busan'],
    cityKey: 'seoul',
    cityKeys: ['seoul', 'busan'],
    startDate: '2026-09-01',
    endDate: '2026-09-05',
    durationDays: 5,
    pax: 3,
    reservation_status: 'flight_hotel',
    arrival_airport: 'ICN',
    departure_airport: 'PUS',
    arrival_time: '14:30',
    departure_time: '20:00',
    tour_start_time: '10:00',
    tour_end_time: '20:00',
    hotel_address: '서울 강남구 테헤란로',
    hotelByCity: { seoul: '서울 강남구 테헤란로', busan: '부산 해운대구' },
    recommended_zone: 'gangnam',
    recommended_zones: { seoul: 'gangnam', busan: 'haeundae' },
    recommended_zone_address: '서울 강남구',
    tourPace: 'full',
    dietPrefs: ['Seafood', 'Street'],
    dietaryRestrictions: ['Halal'],
    priceRange: 'Moderate',
    spiceLevel: 'hot',
    bucketDishes: ['bibimbap', 'kimchi-jjigae'],
    companions: 'family',
    luggage: { small: 1, medium: 2, large: 0 },
    wantAccom: true,
    accomBudget: 'luxury',
    freeText: 'Please avoid seafood restaurants near the hotel.',
    arrival_city: 'seoul',
    departure_city: 'busan',
    entry_city: 'seoul',
    mobility: 'ok',
    uid: 'user-123',
    ...overrides,
  };
}

describe('PlannerIntent v1 parity (client -> server)', () => {
  for (const status of RESERVATION_STATUSES) {
    it(`NEW generation round-trips every field for reservation_status=${status}`, () => {
      const values = fullValues({ reservation_status: status });
      const { flat } = buildFullPlannerIntentPayload(values, 'en');
      const body = JSON.parse(JSON.stringify(flat));
      const intent = normalizePlannerIntentV1(body);

      expect(intent.reservationStatus).toBe(status);
      expect(intent.cityKeys).toEqual(['seoul', 'busan']);
      expect(intent.arrivalCityKey).toBe('seoul');
      expect(intent.departureCityKey).toBe('busan');
      expect(intent.startDate).toBe('2026-09-01');
      expect(intent.endDate).toBe('2026-09-05');
      expect(intent.durationDays).toBe(5);
      expect(intent.pax).toBe(3);
      expect(intent.arrivalAirport).toBe('ICN');
      expect(intent.departureAirport).toBe('PUS');
      expect(intent.arrivalTime).toBe('14:30');
      expect(intent.departureTime).toBe('20:00');
      expect(intent.tourStartTime).toBe('10:00');
      expect(intent.tourEndTime).toBe('20:00');
      expect(intent.hotelAddress).toBe('서울 강남구 테헤란로');
      expect(intent.hotelByCity).toEqual({ seoul: '서울 강남구 테헤란로', busan: '부산 해운대구' });
      expect(intent.recommendedZone).toBe('gangnam');
      expect(intent.recommendedZones).toEqual({ seoul: 'gangnam', busan: 'haeundae' });
      expect(intent.tourPace).toBe('full');
      expect(intent.activities).toEqual(['K-food', 'K-culture']);
      expect(intent.foodStyles).toEqual(['Seafood', 'Street']);
      expect(intent.dietaryRestrictions).toEqual(['Halal']);
      expect(intent.priceRange).toBe('Moderate');
      expect(intent.spiceLevel).toBe('hot');
      expect(intent.bucketDishes).toEqual(['bibimbap', 'kimchi-jjigae']);
      expect(intent.companions).toBe('family');
      expect(intent.luggage).toEqual({ small: 1, medium: 2, large: 0 });
      expect(intent.wantAccom).toBe(true);
      expect(intent.accomBudget).toBe('luxury');
      expect(intent.specialRequest).toBe('Please avoid seafood restaurants near the hotel.');
      expect(intent.revision).toBeNull();
    });
  }

  it('REVISION carries the exact same travel-preference fields as NEW, plus revision metadata', () => {
    const values = fullValues();
    const { flat: newFlat } = buildFullPlannerIntentPayload(values, 'en');
    const { flat: revFlat } = buildFullPlannerIntentPayload(values, 'en', {
      reasonCodes: ['not_enough_food', 'wrong_pace'],
      note: 'Too much walking on day 2',
      avoidStopNames: ['광장시장', '광장시장'],
    });

    const newIntent = normalizePlannerIntentV1(JSON.parse(JSON.stringify(newFlat)));
    const revIntent = normalizePlannerIntentV1(JSON.parse(JSON.stringify(revFlat)));

    // Every travel-preference field is identical — revision never silently
    // drops recommended_zone/recommended_zones/hotelByCity/etc.
    const { revision: _n, ...newRest } = newIntent;
    const { revision: _r, ...revRest } = revIntent;
    expect(revRest).toEqual(newRest);

    expect(revIntent.revision).toEqual({
      reasonCodes: ['not_enough_food', 'wrong_pace'],
      note: 'Too much walking on day 2',
      avoidStopNames: ['광장시장'], // deduped
    });
  });

  it('never fabricates durationDays/pax/dates for missing values', () => {
    const values = fullValues({ durationDays: undefined, pax: undefined, startDate: '', endDate: '' });
    const intent = buildPlannerIntentV1(values, 'en');
    expect(intent.durationDays).toBeNull();
    expect(intent.pax).toBeNull();
    expect(intent.startDate).toBe('');
    expect(intent.endDate).toBe('');
  });

  it('no allergy concept anywhere — dietaryRestrictions carries only what was passed, never seeded from an allergies field', () => {
    const values = fullValues({ dietaryRestrictions: [] });
    (values as unknown as { allergies?: string[] }).allergies = ['Nuts', 'Shellfish'];
    const { flat } = buildFullPlannerIntentPayload(values, 'en');
    const body = JSON.parse(JSON.stringify(flat));
    expect(body.dietaryRestrictions).toEqual([]);
    const intent = normalizePlannerIntentV1(body);
    expect(intent.dietaryRestrictions).toEqual([]);
  });

  it(`flat's ${PLANNER_INTENT_KEY} and the top-level legacy fields cannot diverge (gate-critical startDate/durationDays)`, () => {
    const values = fullValues();
    const { flat } = buildFullPlannerIntentPayload(values, 'en');
    const body = flat as Record<string, unknown>;
    const v1 = body[PLANNER_INTENT_KEY] as { startDate: string; durationDays: number };
    expect(body.startDate).toBe(v1.startDate);
    expect(body.durationDays).toBe(v1.durationDays);
  });
});
