export type AnyRec = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
import { readdirSync, readFileSync } from 'node:fs';
import { expandBlocksToItinerary, expandBlocksToItineraryMultiCity } from '../../api/_ai_core/blockMode.js';
import { runRouteEnrichment, applyBackfillsAndTmoney, arrivalRestDayFromCtx } from '../../api/_ai_core/postResponsePipeline.js';
import { runFinalItineraryValidation, tripTimesFrom } from '../../api/_ai_core/finalItineraryGate.js';
import { checkRequiredMeals, mealWindowsFromCtx, mealWindowsFromRequest, arrivalRestDayCityKey } from '../../api/_ai_core/responseValidator.js';
import { arrivalRestDayInfo, arrivalReadyMinutes, departureActivityDeadlineMin, singleDayMealWindows } from '../../api/_ai_core/constants.js';
import { shapeRequest } from '../../api/_ai_core/requestShaper.js';
import { enforceDietaryCoverage, buildTripFoodContext, mealCitiesForTrip } from '../../api/_ai_core/dietaryCoverageGate.js';
const totalDaysOf = (dur: string, kind: string) => (kind === 'multi' ? Math.max(dur === '3d' ? 3 : 1, 2) : (dur === '3d' ? 3 : 1));

const ROOT = process.cwd();
const SNAP = 'matrix';
const FOOD = JSON.parse(readFileSync(`${ROOT}/api/_food_index.json`, 'utf8'));
const ZC = `${ROOT}/src/data/zone_courses/`;
export const BLOCKS: AnyRec[] = readdirSync(ZC).filter((f) => f.endsWith('.json')).sort().map((f) => JSON.parse(readFileSync(ZC + f, 'utf8')));
const byCity = new Map<string, AnyRec[]>();
for (const b of BLOCKS) { const a = byCity.get(b.city) || []; a.push(b); byCity.set(b.city, a); }
const roleOf = (s: AnyRec) => { const ph = String(s?.placeholder || '').toLowerCase(); if (ph.includes('lunch')) return 'lunch'; if (ph.includes('dinner')) return 'dinner'; if (ph.includes('breakfast')) return 'breakfast'; if (ph.includes('cafe')) return 'cafe'; return null; };
const homeAirport = (city: string) => (['busan', 'ulsan', 'changwon', 'geoje', 'tongyeong'].includes(city) ? 'PUS' : city === 'jeju' ? 'CJU' : 'ICN_T1');

export const ARRIVALS0 = [
  { id: 'A0900', ap: 'ALREADY', t: '09:00' }, { id: 'A1300', ap: 'ALREADY', t: '13:00' }, { id: 'A1530', ap: 'ALREADY', t: '15:30' },
  { id: 'A1800', ap: 'ALREADY', t: '18:00' }, { id: 'Anone', ap: 'ALREADY', t: '' },
  { id: 'I0800', ap: 'HOME', t: '08:00' }, { id: 'I1200', ap: 'HOME', t: '12:00' }, { id: 'I1600', ap: 'HOME', t: '16:00' },
  { id: 'E1300', ap: '', t: '13:00' }, { id: 'Enone', ap: '', t: '' },
];
const DURS = ['3d', '1d', '1dDep'];
const DIETS: string[][] = [[], ['Halal'], ['Vegan']];
let DEP = '23:00';
let LEG = '20';
let transitLookups = 0;
export function setScenario(leg: string, departure: string) { LEG = leg; DEP = departure; }
export function getTransitLookups() { return transitLookups; }
export function resetTransitLookups() { transitLookups = 0; }
export function recordTransitLookup() { transitLookups++; }

function fnv(s: string) { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; } return h >>> 0; }
export function legMin(p: AnyRec, c: AnyRec) {
  if (/^\d+$/.test(LEG)) return Number(LEG);
  const a = String(p?.name || p?.display_name || '?'), b = String(c?.name || c?.display_name || '?');
  if (LEG === 'mixA') return fnv(`${a}>${b}`) % 2 ? 60 : 10;
  if (LEG === 'mixB') return fnv(`B:${a}>${b}`) % 3 === 0 ? 60 : 10;
  if (LEG === 'distA' || LEG === 'distB') {
    // location-based: same geography -> same leg in every snapshot, even when a snapshot picks a different restaurant
    const la1 = Number(p?.lat), lo1 = Number(p?.lng), la2 = Number(c?.lat), lo2 = Number(c?.lng);
    if (![la1, lo1, la2, lo2].every(Number.isFinite)) return 25;
    const R = 6371, dLa = (la2 - la1) * Math.PI / 180, dLo = (lo2 - lo1) * Math.PI / 180;
    const h = Math.sin(dLa / 2) ** 2 + Math.cos(la1 * Math.PI / 180) * Math.cos(la2 * Math.PI / 180) * Math.sin(dLo / 2) ** 2;
    const km = 2 * R * Math.asin(Math.sqrt(h));
    if (LEG === 'distA') return km < 2 ? 10 : 60;
    return Math.min(90, Math.round(10 + 6 * km));
  }
  return 20;
}

function pickDays(block: AnyRec, n: number) {
  const same = (byCity.get(block.city) || []).filter((b) => b.id !== block.id && b.block_type === 'city_day');
  const ids = [block.id];
  for (let i = 1; i < n; i++) ids.push((same[i - 1] || block).id);
  return ids;
}
function otherCityBlock(block: AnyRec) { return block.city === 'seoul' ? BLOCKS.find((b) => b.id === 'BUSAN_DAY_NAMPO_STANDARD') : BLOCKS.find((b) => b.id === 'SEOUL_DAY_MYEONGDONG_STANDARD'); }

const tfOf = (s: AnyRec) => (s.transit_from_prev && typeof s.transit_from_prev === 'object' ? (s.transit_from_prev.est_min === undefined ? null : s.transit_from_prev.est_min) : (s.transit_from_prev === null ? null : 'u'));
const summarize = (s: AnyRec) => ({ o: s.order, rr: s._blockMealRole, n: s.name, c: s.category, t: s.start_time, e: s.end_time, st: s.stay_min, bid: s.source_block_id, ev: s.dietary_evidence || null, v: s.verified, tf: tfOf(s), dmn: s.departure_meal_note ? 1 : 0 });

export async function runOne(block: AnyRec, arr: AnyRec, dur: string, diet: string[], kind: string) {
  const city = block.city;
  const ap = arr.ap === 'HOME' ? homeAirport(city) : arr.ap;
  const n = dur === '3d' ? 3 : 1;
  const multi = kind === 'multi';
  const other = multi ? otherCityBlock(block) : null;
  const regions = multi ? [city, other.city] : [city];
  const body: AnyRec = {
    area: city, regions, language: 'en', durationDays: multi ? Math.max(n, 2) : n, pax: 2, startDate: '2026-12-01',
    tourStartTime: '09:00', tourEndTime: '21:00', dietPrefs: diet,
    ...(arr.t ? { arrivalTime: arr.t } : {}), arrival_airport: ap,
    ...(dur === '1dDep' ? { departureTime: DEP, departure_airport: homeAirport(city) } : {}),
  };
  const shaped: AnyRec = shapeRequest(body, 'probe@example.invalid');
  const durationDays = Number(shaped.durationDays || body.durationDays);
  const area = city;
  const arrivalRestDay = arrivalRestDayInfo({ arrivalTime: shaped.arrivalTime, arrivalAirport: shaped.arrival_airport, cityKey: arrivalRestDayCityKey({ arrivalCity: shaped.arrivalCity, regions, area }), tourEndTime: shaped.tourEndTime }).rest && durationDays > 1;
  const mealWindows = mealWindowsFromRequest(shaped);
  try {
    enforceDietaryCoverage({ foodIndex: FOOD, regions, area: city, dietaryAll: diet, arrivalCity: shaped.arrivalCity, departureCity: shaped.departureCity });
    buildTripFoodContext({ cities: mealCitiesForTrip({ regions, area: city, arrivalCity: shaped.arrivalCity, departureCity: shaped.departureCity }), area: city, dietaryAll: diet, priceRange: 'Any', maxItems: Math.min(40, Math.max(10, totalDaysOf(dur, kind) * 4)) });
  } catch (e: AnyRec) {
    return { snap: SNAP, leg: LEG, block: block.id, city, arr: arr.id, ap, dur, diet: diet.join('') || 'none', kind, stage: 'pregate', err: e?.code || String(e?.message).slice(0, 80) };
  }
  const userInput: AnyRec = {
    durationDays, dietPrefs: diet, styles: [], language: 'en', startDate: '2026-12-01',
    arrival_time: shaped.arrivalTime, departure_time: shaped.departureTime, tour_start_time: shaped.tourStartTime, tour_end_time: shaped.tourEndTime,
    arrival_airport: shaped.arrival_airport, departure_airport: shaped.departure_airport, pax: 2,
    arrival_rest_day: arrivalRestDay, foodIndex: FOOD, area: city,
  };
  const rec: AnyRec = { snap: SNAP, leg: LEG, block: block.id, city, arr: arr.id, ap, dur, diet: diet.join('') || 'none', kind, restFlag: arrivalRestDay };
  let itin: AnyRec;
  const totalDays = multi ? Math.max(n, 2) : n;
  try {
    if (multi) {
      const sels = [{ day: 1, city, block_id: block.id }];
      for (let d = 2; d <= totalDays; d++) sels.push({ day: d, city: other.city, block_id: other.id });
      itin = expandBlocksToItineraryMultiCity({ day_selections: sels }, [{ city, blocks: [block] }, { city: other.city, blocks: [other] }], { ...userInput, regions });
    } else {
      const ids = pickDays(block, totalDays);
      itin = expandBlocksToItinerary({ day_selections: ids.map((id, i) => ({ day: i + 1, block_id: id, tweak_notes: '' })) }, BLOCKS, userInput);
    }
  } catch (e: AnyRec) {
    rec.stage = 'expand'; rec.err = e?.code || e?.message?.slice(0, 120); return rec;
  }
  rec.expandD1 = itin.days[0].stops.map((s: AnyRec) => ({ n: s.name, c: s.category, rr: s._blockMealRole }));
  rec.expandExempt = itin.days[0].exempt_meals || null;
  try {
    await runRouteEnrichment(itin, { apiKey: null, body, language: 'en', hotel_address: '', arrival_airport: shaped.arrival_airport, departure_airport: shaped.departure_airport, pax: 2, recommendedZone: '', recommendedZoneAddress: '', hotelAddressFromBody: '', zone_id: multi ? null : block.id, dietPrefs: diet, avoidStopNames: [] });
  } catch (e: AnyRec) {
    rec.stage = 'route'; rec.err = e?.code || e?.message?.slice(0, 120); rec.errDetails = e?.details; return rec;
  }
  const ctx = { hotelByCity: {}, body, hotel_address: '', hotelAddressFromBody: '', recommendedZone: '', language: 'en', blockMode: true, departureTime: shaped.departureTime, departure_airport: shaped.departure_airport, arrivalTime: shaped.arrivalTime, arrival_airport: shaped.arrival_airport, arrivalRestDay };
  try { applyBackfillsAndTmoney(itin, ctx); } catch (e: AnyRec) { rec.stage = 'backfill'; rec.err = e?.code || e?.message?.slice(0, 120); return rec; }
  const gctx: AnyRec = { area, dietPrefs: diet, regions, blockModeUsed: true, language: 'en', styles: [], avoidStopNames: [], departureTime: shaped.departureTime, arrivalTime: shaped.arrivalTime, arrival_airport: shaped.arrival_airport, tourEndTime: shaped.tourEndTime, arrivalRestDay, mealWindows, body };
  const tripTimes = tripTimesFrom({
    departureTime: gctx.departureTime || body.departureTime, arrivalTime: gctx.arrivalTime || body.arrivalTime, arrivalAirport: gctx.arrival_airport, departureAirport: shaped.departure_airport,
    area: gctx.area, regions: gctx.regions, tourEndTime: gctx.tourEndTime, meal_windows: mealWindowsFromCtx(gctx), arrival_rest_day: arrivalRestDayFromCtx(gctx),
  });
  const gate = runFinalItineraryValidation(itin, { language: 'en', dietary: diet, styles: [], foodIndex: FOOD, tripTimes });
  rec.stage = 'done';
  rec.gateOk = gate.ok; rec.gateCode = gate.code; rec.gateIssues = (gate.requiredMealIssues || []).concat((gate.violations || []).map((v: AnyRec) => v.message || v.type)).concat((gate.zeroFoodDays || []).map((z: AnyRec) => z.message));
  rec.bmeal = checkRequiredMeals(itin, tripTimes);
  rec.bmealNoExempt = checkRequiredMeals({ ...itin, days: itin.days.map((d: AnyRec) => { const rest = { ...d }; delete rest.exempt_meals; return rest; }) }, tripTimes);
  rec.days = itin.days.map((d: AnyRec) => ({ day: d.day, city: d.city, mealRemoved: !!d._routeMealRemoved, placementRemoved: d._routePlacementRemoved || 0, exempt: d.exempt_meals || null,
    ltf: d.lodging_to_first?.est_min === undefined ? null : d.lodging_to_first.est_min, ltl: d.last_to_lodging?.est_min === undefined ? null : d.last_to_lodging.est_min, stops: (d.stops || []).map(summarize) }));
  const tsMin = 9 * 60;
  const ready = shaped.arrivalTime ? arrivalReadyMinutes(shaped.arrivalTime, shaped.arrival_airport, city) : null;
  rec.R = Math.max(tsMin, ready === null ? 0 : ready);
  const [dh, dm] = DEP.split(':').map(Number);
  rec.deadline = dur === '1dDep' ? departureActivityDeadlineMin(dh * 60 + dm, homeAirport(city), city) : null;
  rec.win1 = singleDayMealWindows({ durationDays: 1, tourStartTime: `${String(Math.floor(rec.R / 60)).padStart(2, '0')}:${String(rec.R % 60).padStart(2, '0')}`, tourEndTime: '21:00', cityKey: city, ...(dur === '1dDep' ? { departureTime: DEP, departureAirport: homeAirport(city) } : {}) });
  rec.mealWindows = mealWindows || null;
  rec.blockFoodRoles = (block.stops || []).filter((s: AnyRec) => s.category === 'food').map((s: AnyRec) => ({ role: roleOf(s), off: s.start_time_offset_min, stay: s.stay_min, name: s.name || s.placeholder }));
  return rec;
}


// Full keyspace matches the original sweep: 128 blocks × 10 arrivals × (9 single + 1 multi) = 12,800.
export function allKeys(): string[] {
  const keys: string[] = [];
  for (const block of BLOCKS) for (const kind of ['single', 'multi']) for (const arr of ARRIVALS0) for (const dur of DURS) {
    if (kind === 'multi' && dur !== '3d') continue;
    for (const diet of DIETS) {
      if (kind === 'multi' && diet.length) continue;
      keys.push([block.id, arr.id, dur, diet[0] || 'none', kind].join('|'));
    }
  }
  return keys;
}

