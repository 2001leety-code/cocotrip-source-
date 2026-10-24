import { describe, expect, it } from 'vitest';
import { projectPublicPlan } from '../../api/_shared/public-plan-projection.js';
import { resolvePlanAccess } from '../../api/get-plan.js';

const secret = 'PRIVATE-FIXTURE-ALPHA';
const hotel = 'Secret Lantern Hotel';
const address = 'Private Place 99';
function makePlan() {
  return {
    id: 'public-fixture', isPublic: true, uid: secret, guestEmail: secret,
    accessToken: secret, pricing: { total: 55 }, __truncated: true,
    unknown: { nested: secret },
    input: { language: 'en', nights: 3, area: 'Seoul', regions: ['Seoul'],
      guestName: secret, planner_intent_v1: { nested: secret },
      unknown: { deeply: secret }, hotel_address: address,
      hotelByCity: { Seoul: { name: hotel, address } }, luggage: { note: secret },
    },
    itinerary: {
      tour_title: 'City visit', _truncated_days: 1, private_echo: secret,
      accommodation: { name: hotel },
      arrival_guide: { route_to_hotel: { method: 'taxi', est_min: 20, instruction: address, geometry: [secret] } },
      departure_guide: { route_to_airport: { method: 'bus', est_min: 60, steps_detail: [{ from: hotel }] },
        luggage_storage: { location: secret } },
      days: [{ day: 1, city: 'Seoul', theme: 'Walk', lodging: { name: hotel, address },
        activity_meta: { activity_type: 'trekking', hazards: ['Loose rocks'], recommended_gear: ['Water'],
          unsuitable_for: ['Limited mobility'], private_note: secret },
        lodging_to_first: { method: 'walk', est_min: 5, from_label: hotel, steps_detail: [{ path: [1, 2, 3, 4] }] },
        stops: [
          { category: 'lodging', name: hotel, address, lat: 35.1, lng: 129.1, naverMapUrl: address,
            start_time: '08:00', end_time: '08:10', order: 0, tip: secret },
          { category: 'culture', name: 'Palace', display_name: 'Palace', lat: 37.58, lng: 126.98,
            start_time: '09:00', order: 1, personalization_reasoning: secret,
            tip: `Meet at ${hotel}`, description: `Reference ${secret}`,
            reservation_required: true, reservation_url: 'https://example.test/palace', reservation_secret: secret,
            transit_from_prev: { method: 'walk', est_min: 10, from_label: hotel, steps_detail: [{ path: [1, 2, 3, 4] }] },
            recommended_items: [{ name: 'Tea', note: 'Popular', unknown: secret }],
            dietary_evidence: [{ diet: 'vegan', tag: 'vegan', verification_status: 'vegan_options', guest: secret }],
          },
          { category: 'culture', name: 'Museum', lat: 37.59, lng: 126.99, order: 2,
            transit_from_prev: { method: 'bus', steps_detail: [{ mode: 'bus', busNo: '100',
              from: 'Palace', to: 'Museum', path: [37.58, 126.98, 37.59, 126.99],
              fromPoint: { lat: 37.58, lng: 126.98, name: 'Palace', unknown: secret },
              fromStationInfo: { hasElevator: true, unknown: secret }, unknown: secret,
            }] },
          },
        ],
      }],
    },
  };
}

describe('shared public plan projection', () => {
  it('keeps ordinary cities and places mentioned in private intent and hotel-adjacent transit', () => {
    const plan = makePlan();
    plan.input.planner_intent_v1 = { nested: 'Seoul' };
    Object.assign(plan.input, { luggage: { note: 'Palace' } });
    Object.assign(plan.itinerary.days[0].lodging_to_first, { first_station: 'Palace', last_station: 'Museum' });
    const output = projectPublicPlan(plan) as ReturnType<typeof makePlan>;
    expect(output.input.area).toBe('Seoul');
    expect(output.itinerary.days[0].stops[1].name).toBe('Palace');
    expect(output.itinerary.days[0].stops[2].name).toBe('Museum');
    expect(output.input.planner_intent_v1).toBeUndefined();
  });
  it('fails closed for unknown nested fields and known private echoes without mutating input', () => {
    const input = makePlan();
    const before = JSON.stringify(input);
    const projected = projectPublicPlan(input) as ReturnType<typeof makePlan>;
    const wire = JSON.stringify(projected);
    expect(wire).not.toContain(secret);
    expect(wire).not.toContain(hotel);
    expect(wire).not.toContain(address);
    expect(wire).not.toContain('personalization_reasoning');
    expect(wire).not.toContain('reservation_secret');
    expect(wire).not.toContain('luggage_storage');
    expect(projected.input.nights).toBe(3);
    expect(projected.itinerary._truncated_days).toBe(1);
    expect(projected.itinerary.days[0].activity_meta).toEqual({
      activity_type: 'trekking', hazards: ['Loose rocks'], recommended_gear: ['Water'], unsuitable_for: ['Limited mobility'],
    });
    expect(JSON.stringify(input)).toBe(before);
    expect(projectPublicPlan(projected)).toEqual(projected);
  });

  it('keeps tourist map routes while removing hotel endpoints and keeping hotel timing', () => {
    const projected = projectPublicPlan(makePlan()) as ReturnType<typeof makePlan>;
    const day = projected.itinerary.days[0];
    expect(day.stops[0]).toEqual({ category: 'lodging', name: 'Stay', display_name: 'Stay', order: 0,
      start_time: '08:00', end_time: '08:10' });
    expect(day.stops[1].lat).toBe(37.58);
    expect(day.stops[1].transit_from_prev).toEqual({ method: 'walk', est_min: 10 });
    expect(day.lodging_to_first).toEqual({ method: 'walk', est_min: 5 });
    expect(day.stops[2].transit_from_prev?.steps_detail?.[0].path).toEqual([37.58, 126.98, 37.59, 126.99]);
    expect(day.stops[2].transit_from_prev?.steps_detail?.[0].fromPoint).toEqual({ lat: 37.58, lng: 126.98, name: 'Palace' });
  });

  // 2026-10-24: 출국일 조식 안내(planPersister.applyDepartureBreakfastNote 가 저장한 고정 문구)만 공개, 호텔 고유 tip 은 계속 비공개.
  it('a lodging stop shows only the fixed breakfast notice as its public tip; without it, no tip (unchanged)', () => {
    const note = 'Breakfast on departure day is not in the itinerary because of the early flight. Please arrange it at your hotel or the airport — check opening hours and dietary requirements.';
    const plan = makePlan();
    Object.assign(plan.itinerary.days[0].stops[0], { tip: '호텔 고유 메모 ' + note, breakfast_note: note });
    const projected = projectPublicPlan(plan) as ReturnType<typeof makePlan>;
    const stay = projected.itinerary.days[0].stops[0] as Record<string, unknown>;
    expect(stay.tip).toBe(note);
    expect(JSON.stringify(projected)).not.toContain('호텔 고유 메모');
    expect(JSON.stringify(projected)).not.toContain(hotel);
    expect(projectPublicPlan(projected)).toEqual(projected); // 재투영 멱등
    const plain = projectPublicPlan(makePlan()) as ReturnType<typeof makePlan>;
    expect((plain.itinerary.days[0].stops[0] as Record<string, unknown>).tip).toBeUndefined();
  });

  it.each([['ko', '숙소'], ['en', 'Stay'], ['ja', '宿泊先'], ['zh', '住宿']])('uses generic %s hotel labels', (language, label) => {
    const projected = projectPublicPlan(makePlan(), { language }) as ReturnType<typeof makePlan>;
    expect(projected.itinerary.days[0].stops[0].name).toBe(label);
  });

  it('also summarizes a first-stop route with no explicit hotel stop, including legacy travel', () => {
    const projected = projectPublicPlan({ itinerary: { days: [{ stops: [{ category: 'culture', name: 'Palace',
      transit_from_prev: { method: 'walk', est_min: 8, steps_detail: [{ from: hotel, path: [1, 2, 3, 4] }] },
      travelFromPrev: { transitOptions: { publicTransit: { method: 'walk', duration: 8, fare: 0, transfers: 0,
        steps: [{ description: hotel }], secret } } },
    }] }] } }) as { itinerary: { days: { stops: Record<string, unknown>[] }[] } };
    expect(projected.itinerary.days[0].stops[0].transit_from_prev).toEqual({ method: 'walk', est_min: 8 });
    expect(projected.itinerary.days[0].stops[0].travelFromPrev).toEqual({ transitOptions: {
      publicTransit: { method: 'walk', duration: 8, fare: 0, transfers: 0 },
    } });
  });

  it('uses the same contract in resolvePlanAccess and retains full/denied/legacy behavior', () => {
    const original = makePlan();
    expect(resolvePlanAccess(original, secret).plan).toBe(original);
    expect(resolvePlanAccess(original, '').plan).toEqual(projectPublicPlan(original));
    expect(resolvePlanAccess({ itinerary: { days: [] } }, '').access).toBe('denied');
    expect(resolvePlanAccess({ isPublic: false, accessToken: secret }, 'wrong').access).toBe('denied');
    expect(resolvePlanAccess({ isPublic: true, input: { nights: 3 }, itinerary: { days: [] } }, '').plan)
      .toEqual({ isPublic: true, input: { nights: 3 }, itinerary: { days: [] } });
  });
});
