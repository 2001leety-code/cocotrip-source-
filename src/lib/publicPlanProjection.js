/** Shared public-view contract. Unknown keys are omitted at every nesting level.
 * Pure/browser-safe: no database, environment, or network access.
 * Known private-string filtering supplements the schema; it cannot detect paraphrases.
 */
import { departureBreakfastNote } from './departureBreakfastNote.js';
import { revisitNote, stripRevisitNote } from './revisitNote.js';

const S = 'string';
const N = 'number';
const B = 'boolean';
const texts = [S];
const xy = { x: N, y: N };
const trainTimes = { first: S, last: S, firstDest: S, lastDest: S };
const stationInfo = {
  stationName: S, address: S, phone: S, lostCenterPhone: S,
  hasElevator: B, hasWheelchairLift: B, hasRestroom: B,
  transferLines: [{ lineKo: S, lineEn: S, lineKoJa: S, lineKoZh: S, stationID: N }],
};
const summaryTransit = {
  method: S, est_min: N, est_fare_krw: N, transfers: N, total_walk_m: N,
  source: S, _downgraded_from: S, _odsay_failed: B, _stale: B, _failed: B,
};
const detailStep = {
  mode: S, description: S, duration: N, line: S, lineKo: S, lineEn: S,
  subwayCode: N, fromStationID: N, toStationID: N,
  fromStationInfo: stationInfo, toStationInfo: stationInfo,
  fromTimetable: { up: trainTimes, down: trainTimes },
  from: S, fromRoman: S, to: S, toRoman: S, way: S, wayRoman: S,
  fromExit: S, toExit: S, fromExitCoord: xy, toExitCoord: xy,
  stationCount: N, intervalMin: N, passStops: texts,
  busNo: S, busType: S, fromArs: S, toArs: S, fromCoord: xy, toCoord: xy,
  distance: N, lineJa: S, lineZh: S, fromJa: S, fromZh: S,
  toJa: S, toZh: S, wayJa: S, wayZh: S, busTypeJa: S, busTypeZh: S,
  path: 'coordinates', routeColor: S, fromPoint: { lat: N, lng: N, name: S },
};
const publicTransit = {
  method: S, instruction: S, instruction_en: S,
  est_min: N, est_fare_krw: N, transfers: N, total_walk_m: N,
  source: S, _downgraded_from: S, _odsay_failed: B, _stale: B, _failed: B,
  from_label: S, first_station: S, last_station: S,
  step_by_step: texts, steps_detail: [detailStep],
};
const activityMeta = {
  activity_type: S, difficulty: S, elevation_gain_m: N, distance_km: N,
  estimated_duration_min: N, hazards: texts, recommended_gear: texts,
  unsuitable_for: texts, requires_advance_booking: B,
};
const inputSchema = {
  language: S, area: S, regions: texts, destination: S,
  startDate: S, endDate: S, nights: N, adults: N, pax: N, children: N,
  tour_start_time: S, tourStartTime: S,
};
const stopSchema = {
  order: N, start_time: S, end_time: S, stay_min: N, category: S,
  name: S, name_ko: S, name_en: S, display_name: S, address: S, address_en: S,
  lat: N, lng: N, naverMapUrl: S, googleMapsUrl: S,
  entry_fee_krw: N, entry_fee_note: S,
  reservation_required: B, reservation_note: S, reservation_url: S, reservation_phone: S,
  accessibility_note: S, tip: S, tip_en: S, description: S, local_tag: S,
  verified: B, dietary_tags: texts,
  dietary_evidence: [{ diet: S, tag: S, verification_status: S }],
  revisit: B, // 2026-10-24 검증 식당 재방문 정책 — 안내 문구(revisit_note)는 projectStop 이 보는 사람 언어로
};
const restaurantSchema = {
  name: S, nameEn: S, address: S, lat: N, lng: N, rating: N, reviewCount: N,
  cuisine: S, cuisineKo: S, priceLabel: S, priceLabelKo: S, placeId: S,
  googleMapsUrl: S, dong: S, dongEn: S, district: S, nearestStopKm: N, region: S,
};
const genericStay = { ko: '숙소', en: 'Stay', ja: '宿泊先', zh: '住宿' };
const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const isStay = (stop) => isRecord(stop) && /^(lodging|hotel|accommodation)$/i.test(String(stop.category || ''));

function normalized(value) {
  try { return decodeURIComponent(value).trim().toLowerCase(); }
  catch { return value.trim().toLowerCase(); }
}

function privateTerms(plan) {
  const terms = new Set();
  const add = (value) => {
    if (typeof value === 'string') {
      const term = normalized(value);
      if (term.length >= 2 && !Object.values(genericStay).some((label) => normalized(label) === term)) terms.add(term);
    } else if (Array.isArray(value)) {
      value.forEach(add);
    } else if (isRecord(value)) {
      Object.values(value).forEach(add);
    }
  };
  const addNamed = (record, names) => {
    if (isRecord(record)) names.forEach((name) => add(record[name]));
  };
  addNamed(plan, ['uid', 'verifiedHistoryUid', 'guestEmail', 'guestName', 'accessToken', 'regenerationToken']);
  addNamed(plan?.input, ['guestName', 'guestEmail', 'specialRequest', 'hotel_address', 'hotelByCity', 'recommended_zone_address']);
  const addStay = (stay) => {
    if (typeof stay === 'string') add(stay);
    else addNamed(stay, ['name', 'name_ko', 'name_en', 'display_name', 'hotel_name', 'address', 'address_en']);
  };
  for (const day of Array.isArray(plan?.itinerary?.days) ? plan.itinerary.days : []) {
    addStay(day.lodging);
    for (const stop of Array.isArray(day.stops) ? day.stops : []) {
      if (isStay(stop)) addStay(stop);
    }
  }
  return Array.from(terms);
}

function project(value, schema, terms) {
  if (schema === S) {
    if (typeof value !== 'string') return undefined;
    const text = normalized(value);
    return terms.some((term) => text.includes(term)) ? undefined : value;
  }
  if (schema === N) return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
  if (schema === B) return typeof value === 'boolean' ? value : undefined;
  if (schema === 'coordinates') {
    if (!Array.isArray(value)) return undefined;
    // Firestore routes use flat coordinates; retain the older paired shape too.
    if (value.length % 2 === 0 && value.every((n) => typeof n === 'number' && Number.isFinite(n))) return value.slice();
    return value.filter((point) => Array.isArray(point) && point.length === 2 && point.every((n) => typeof n === 'number' && Number.isFinite(n)))
      .map((point) => [point[0], point[1]]);
  }
  if (Array.isArray(schema)) {
    if (!Array.isArray(value)) return undefined;
    return value.map((item) => project(item, schema[0], terms)).filter((item) => item !== undefined);
  }
  if (!isRecord(value)) return undefined;
  const result = {};
  for (const key of Object.keys(schema)) {
    const item = project(value[key], schema[key], terms);
    if (item !== undefined) result[key] = item;
  }
  return result;
}

function assign(result, key, value) {
  if (value !== undefined) result[key] = value;
}

function projectTravel(value, privateEndpoint, terms) {
  if (!isRecord(value)) return undefined;
  // Legacy travelFromPrev can use the direct TransitFromPrev shape.
  const result = project(value, privateEndpoint ? summaryTransit : publicTransit, terms);
  const legacy = value.transitOptions?.publicTransit;
  if (isRecord(legacy)) {
    if (privateEndpoint) {
      // Keep the legacy wrapper so existing consumers can still display timing.
      result.transitOptions = { publicTransit: project(legacy,
        { method: S, duration: N, fare: N, transfers: N }, terms) };
    } else {
      result.transitOptions = { publicTransit: project(legacy, {
        method: S, duration: N, fare: N, transfers: N,
        steps: [{ mode: S, description: S }],
      }, terms) };
    }
  }
  return result;
}

function projectStop(stop, privateEndpoint, language, terms) {
  if (!isRecord(stop)) return undefined;
  if (isStay(stop)) {
    const result = project(stop, { order: N, start_time: S, end_time: S, stay_min: N }, terms);
    result.category = 'lodging';
    result.name = genericStay[language] || genericStay.en;
    result.display_name = result.name;
    // 2026-10-24: 숙소 tip 원문(호텔 고유 메모)은 비공개 그대로 — 백엔드가 붙인 출국일 조식 안내만 공개.
    //   문구는 저장값이 아니라 보는 사람 언어의 고정 문구(언어 전환 재투영에서 원문 언어로 되돌아가지 않게).
    //   breakfast_note 도 남겨 재투영해도 같은 결과(멱등).
    if ((typeof stop.breakfast_note === 'string' && stop.breakfast_note) || stop._breakfast_note === true) {
      result.tip = result.breakfast_note = departureBreakfastNote(language);
    }
    return result;
  }
  const result = project(stop, stopSchema, terms);
  // 2026-10-24 재방문 안내: 저장 언어 문장을 떼고 보는 사람 언어 고정 문장으로(언어 전환 재투영에도 1회·정확한 언어).
  if (typeof result.tip === 'string') result.tip = stripRevisitNote(result.tip, stop.revisit_note);
  if (stop.revisit === true && stop.category === 'food') {
    const note = revisitNote(language);
    // 본문 = 화면과 같은 폴백(tip 우선, 1회) — 저장 tip 이 비어도 옛 필드 설명이 사라지지 않게.
    const body = String(stripRevisitNote(result.tip || result.tip_en || '', stop.revisit_note) || '').trim();
    result.revisit_note = note;
    result.tip = body ? `${body} ${note}` : note;
  }
  if (Array.isArray(stop.recommended_items)) {
    result.recommended_items = stop.recommended_items.map((item) => project(item,
      typeof item === 'string' ? S : { name: S, price_krw: N, note: S }, terms))
      .filter((item) => item !== undefined);
  }
  assign(result, 'transit_from_prev', projectTravel(stop.transit_from_prev, privateEndpoint, terms));
  assign(result, 'travelFromPrev', projectTravel(stop.travelFromPrev, privateEndpoint, terms));
  return result;
}

function projectDay(day, language, terms) {
  if (!isRecord(day)) return undefined;
  const result = project(day, { day: N, date: S, theme: S, city: S, activity_meta: activityMeta }, terms);
  if (Array.isArray(day.stops)) {
    result.stops = day.stops.map((stop, index) => projectStop(stop,
      index === 0 || isStay(day.stops[index - 1]), language, terms)).filter((stop) => stop !== undefined);
  }
  for (const key of ['lodging_to_first', 'last_to_lodging', 'lodging_to_station', 'station_to_lodging']) {
    assign(result, key, project(day[key], summaryTransit, terms));
  }
  if (isRecord(day.intercity_transit)) {
    result.intercity_transit = project(day.intercity_transit, {
      mode: S, method: S, from_city: S, to_city: S, from_city_display: S, to_city_display: S,
      from_station: S, to_station: S, est_min: N, est_fare_krw: N,
      duration_min: N, cost_krw: N, recommended_depart: S, arrival_at: S, depart_estimated: B,
      instruction: S, booking_url: S,
      lodging_to_station: summaryTransit, station_to_lodging: summaryTransit,
    }, terms);
  }
  return result;
}

/** The same projection is used on server reads, client fallback reads, and translated responses.
 * @param {object} plan
 * @param {{language?: string, privateSource?: object}} options
 * @returns {object}
 */
export function projectPublicPlan(plan, options = {}) {
  const source = isRecord(plan) ? plan : {};
  const terms = privateTerms(source).concat(privateTerms(options.privateSource));
  const language = options.language || source.input?.language || 'en';
  const result = project(source, {
    id: S, planId: S, isPublic: B, status: S, title: S, tourTitle: S,
    _streaming_in_progress: B, _streaming_progress: N, __truncated: B,
    input: inputSchema,
  }, terms);
  if (!isRecord(source.itinerary)) return result;
  const itinerary = project(source.itinerary, {
    tour_title: S, t_money_recommended_load: N, _truncated_days: N, _streaming_skeleton: B,
    daily_budget_summary: [{ day: N, transport_krw: N, entry_fees_krw: N, meals_krw: N,
      total_krw: N, food_krw: N, transit_krw: N, entry_krw: N, activities_krw: N, shopping_estimate_krw: N }],
    arrival_guide: { airport: S,
      steps: [{ step: N, title: S, instruction: S, description: S, details: S, fare_krw: N, est_min: N }],
      route_to_hotel: summaryTransit,
      transport_to_hotel: { method: S, est_min: N, est_fare_krw: N, duration_min: N, cost_krw: N },
    },
    departure_guide: { airport: S, recommended_departure_time: S, latest_leave_hotel: S,
      route_to_airport: summaryTransit,
      to_airport: { method: S, est_min: N, est_fare_krw: N, duration_min: N, cost_krw: N },
      tax_refund: { eligible: B, min_purchase_krw: N, threshold_krw: N, location: S, note: S },
      last_minute_shopping: S,
    },
  }, terms);
  if (Array.isArray(source.itinerary.days)) {
    itinerary.days = source.itinerary.days.map((day) => projectDay(day, language, terms)).filter((day) => day !== undefined);
  }
  const restaurants = source.itinerary.recommended_restaurants;
  if (Array.isArray(restaurants)) itinerary.recommended_restaurants = project(restaurants, [restaurantSchema], terms);
  else if (isRecord(restaurants)) itinerary.recommended_restaurants = project(restaurants,
    { general: [restaurantSchema], vegan: [restaurantSchema], halal: [restaurantSchema] }, terms);
  result.itinerary = itinerary;
  return result;
}
