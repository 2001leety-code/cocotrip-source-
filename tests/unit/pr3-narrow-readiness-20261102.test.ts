import { describe, expect, it } from 'vitest';
import { arrivalReadyMinutes, arrivalRestDayInfo } from '../../api/_ai_core/constants.js';
import { expandBlocksToItinerary, expandBlocksToItineraryMultiCity } from '../../api/_ai_core/blockMode.js';
import { mealWindowsForStoredPlan, mealWindowsFromRequest } from '../../api/_ai_core/responseValidator.js';

const block = {
  id: 'B1', city: 'seoul', zone: 'test', theme: 'test', intensity: 'standard',
  stops: [
    { order: 1, name: 'Museum', category: 'culture', start_time_offset_min: 0, stay_min: 60 },
    { order: 2, placeholder: 'verified_dinner', category: 'food', start_time_offset_min: 375, stay_min: 60 },
  ],
};
const selection = { day_selections: [{ day: 1, city: 'seoul', block_id: 'B1', tweak_notes: '' }], language: 'en' };
const input = { area: 'seoul', language: 'en', durationDays: 1, dietPrefs: [], foodIndex: [{ name: 'Restaurant', city: 'seoul', type: 'restaurant', rating: 4.5, reviewCount: 100 }] };
const single = (extra: Record<string, unknown>) => expandBlocksToItinerary(selection, [block], { ...input, ...extra });
const multi = (extra: Record<string, unknown>) => expandBlocksToItineraryMultiCity(selection, [{ city: 'seoul', blocks: [block] }], { ...input, ...extra });

describe('arrival readiness', () => {
  it.each(['ALREADY', 'already_in_korea', 'Already', ' already_in_korea '])('%s has no airport buffer', (airport) => {
    expect(arrivalReadyMinutes('14:00', airport, 'seoul')).toBe(840);
    expect(arrivalRestDayInfo({ arrivalTime: '16:59', arrivalAirport: airport, cityKey: 'seoul', tourEndTime: '18:00' }).rest).toBe(false);
    expect(arrivalRestDayInfo({ arrivalTime: '17:00', arrivalAirport: airport, cityKey: 'seoul', tourEndTime: '18:00' })).toMatchObject({ rest: true, reason: 'ready_near_tour_end' });
  });
  it('keeps blank airport unknown for rest and applies real airport transit', () => {
    expect(arrivalRestDayInfo({ arrivalTime: '14:00', arrivalAirport: '', cityKey: 'seoul' }).readyMin).toBeNull();
    expect(arrivalReadyMinutes('14:00', 'ICN_T1', 'seoul')).toBe(1020);
    expect(arrivalRestDayInfo({ arrivalTime: '18:00', arrivalAirport: 'ICN_T1', cityKey: 'seoul' })).toMatchObject({ rest: true, reason: 'late_arrival' });
  });
});

describe('block expansion time resolution', () => {
  it.each([single, multi])('matches camel and snake inputs and gives camel precedence', (expand) => {
    const base = { arrival_airport: 'ALREADY', tourEndTime: '22:00' };
    const camel = expand({ ...base, arrivalTime: '10:15', tourStartTime: '09:00' });
    const snake = expand({ arrival_airport: 'ALREADY', arrival_time: '10:15', tour_start_time: '09:00', tour_end_time: '22:00' });
    const mixed = expand({ ...base, arrivalTime: '10:15', arrival_time: '16:00', tourStartTime: '09:00', tour_start_time: '12:00' });
    expect(camel.days[0].stops[0].start_time).toBe('10:15');
    expect(snake.days[0].stops[0].start_time).toBe('10:15');
    expect(mixed.days[0].stops[0].start_time).toBe('10:15');
  });
  it.each([single, multi])('does not force the dinner placeholder from 15:15 to 17:00', (expand) => {
    const result = expand({ tourStartTime: '09:00', tourEndTime: '21:00' });
    const meal = result.days[0].stops.find((s: { category: string }) => s.category === 'food');
    expect(meal).toBeDefined();
    expect(meal.start_time).toBe('15:15');
  });
});

describe('stored meal windows', () => {
  it('preserves saved windows including explicit null', () => {
    const saved = { lunch: { from: '12:00', to: '14:00' }, dinner: null };
    expect(mealWindowsForStoredPlan({ meal_windows: saved }, 1)).toEqual(saved);
    expect(mealWindowsForStoredPlan({ meal_windows: null }, 1)).toBeNull();
  });
  it('reconstructs old ALREADY plans using the legacy airport buffer', () => {
    const legacy = { arrival_airport: 'ALREADY', arrival_time: '14:00', tour_start_time: '09:00', tour_end_time: '21:00', area: 'seoul' };
    const stored = mealWindowsForStoredPlan(legacy, 1);
    const oldBehavior = mealWindowsFromRequest({ ...legacy, arrival_airport: '', durationDays: 1 });
    const newBehavior = mealWindowsFromRequest({ ...legacy, durationDays: 1 });
    expect(stored).toEqual(oldBehavior);
    expect(stored).not.toEqual(newBehavior);
  });
});
