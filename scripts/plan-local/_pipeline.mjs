/**
 * _pipeline.mjs — 오프라인 POST-Gemini 파이프라인 실행 + 요약 출력.
 *
 * installMocks() 가 이미 호출된 상태에서 import 돼야 한다 (run.mjs 가 보장).
 * prod 모듈을 그대로 import 하되, firestoreAdmin / _transit_provider 는 mock 으로
 * 치환된 상태라 live Firestore/ODsay 호출이 0 이다.
 *
 * 흐름 (handlerCore 의 post-Gemini 부분만 재현):
 *   1. expandBlocksToItinerary(selection, blocks, userInput)        — block stops → itinerary.days
 *      (다도시면 expandBlocksToItineraryMultiCity)
 *   2. runRouteEnrichment(itinerary, ctx)                           — RouteAgent (transit = 캐시 transit_matrix, live 0)
 *   3. applyBackfillsAndTmoney(itinerary, ctx)                      — end_time/lodging backfill + budget self-heal + T-money
 *   4. applyRecommendedRestaurants(itinerary, ctx)                  — DB 식당 추천 (Gemini 미경유)
 *   5. computePricing(vehicle, durationDays)                        — 차량 가격
 *   (savePlan = Firestore write 는 의도적으로 skip — calc 만)
 */

import { setBlocks } from './_mocks.mjs';
import {
  expandBlocksToItinerary,
  expandBlocksToItineraryMultiCity,
} from '../../api/_ai_core/blockMode.js';
import {
  runRouteEnrichment,
  applyBackfillsAndTmoney,
  applyRecommendedRestaurants,
  computePricing,
} from '../../api/_ai_core/postResponsePipeline.js';
import { loadFoodIndex } from '../../api/_ai_core/geminiPipeline.js';

/**
 * fixtures 의 blocks / selection / userinput 으로 오프라인 플랜을 생성한다.
 * @param {object} args
 * @param {Array<object>} args.blocks      — zone_courses 블록들 (transit_matrix 포함)
 * @param {object} args.selection          — { day_selections: [{day, block_id, city?, tweak_notes}], language }
 * @param {object} args.userInput          — 정규화된 사용자 입력 (durationDays, regions, area, dietPrefs, ...)
 * @returns {Promise<{itinerary: object, pricing: object, blocksUsed: string[]}>}
 */
export async function runOfflinePlan({ blocks, selection, userInput }) {
  // 1) mock adminDb 가 보는 블록 등록 (transitCache 의 transit_matrix 조회용).
  setBlocks(blocks);
  // axios mock 의 geocoding 좌표표 구성 (block stop 의 실측 lat/lng → RouteAgent 가 채울 좌표).
  buildGeoTableFromBlocks(blocks);

  // foodIndex 주입 — placeholder 식당 매칭 (DB, Gemini 미경유). loadFoodIndex 는 로컬 파일.
  let foodIndex = [];
  try { foodIndex = await loadFoodIndex(); }
  catch (e) { console.warn('[harness] loadFoodIndex 실패 (placeholder 매칭 제한):', e.message); }

  const regions = Array.isArray(userInput.regions) ? userInput.regions : [];
  const area = userInput.area || regions[0] || '';
  const cities = blockCitiesOf(blocks);
  const isMultiCity = regions.length >= 2 || cities.length >= 2;

  // expand 가 보는 userInput (area / foodIndex 주입)
  const expandInput = { ...userInput, area, foodIndex };

  // 2) expandBlocksToItinerary (단/다도시 분기)
  let itinerary;
  if (isMultiCity) {
    // 다도시 expand 는 cityBlocksList 형태를 받는다: [{ city, blocks, ok }]
    const cityBlocksList = groupBlocksByCity(blocks);
    itinerary = expandBlocksToItineraryMultiCity(selection, cityBlocksList, expandInput);
  } else {
    itinerary = expandBlocksToItinerary(selection, blocks, expandInput);
  }

  const blocksUsed = (selection.day_selections || []).map((d) => d.block_id);

  // RouteAgent / persist 에 넘길 body (handlerCore 의 body 형태 부분 재현)
  const body = {
    regions: regions.length ? regions : (area ? [area] : []),
    area,
    arrival_airport: userInput.arrival_airport || '',
    departure_airport: userInput.departure_airport || '',
    arrival_time: userInput.arrival_time || userInput.arrivalTime || '',
    departure_time: userInput.departure_time || userInput.departureTime || '',
    tourStartTime: userInput.tour_start_time || userInput.tourStartTime || '09:00',
    tourEndTime: userInput.tour_end_time || userInput.tourEndTime || '21:00',
    pax: userInput.pax || 2,
    hotelByCity: userInput.hotelByCity || {},
    recommendedZones: userInput.recommendedZones || {},
    recommendedZone: userInput.recommendedZone || '',
    luggage: userInput.luggage || null,
  };

  // 3) RouteAgent enrichment — transit = 캐시 transit_matrix (live ODsay/Naver 0).
  //    zone_id = 단도시 block_mode 의 blocksUsed[0] (transitCache lookup 키).
  await runRouteEnrichment(itinerary, {
    apiKey: process.env.GEMINI_API_KEY || 'offline-dummy-key',
    body,
    hotel_address: userInput.hotel_address || '',
    arrival_airport: userInput.arrival_airport || '',
    departure_airport: userInput.departure_airport || '',
    pax: userInput.pax || 2,
    recommendedZone: userInput.recommendedZone || '',
    recommendedZoneAddress: userInput.recommendedZoneAddress || '',
    hotelAddressFromBody: userInput.hotel_address || '',
    zone_id: isMultiCity ? null : (blocksUsed[0] || null),
  });

  // 좌표 표시 보정: RouteAgent geocoding 이 못 채운 stop(주로 placeholder 식당)에
  //   소스 블록 stop 의 좌표(또는 직전 명소 근사)를 채움 — 동선 요약 표시용 (transit 는 이미 계산됨).
  backfillStopCoordsFromBlocks(itinerary, selection, blocks);

  // 4) backfills + budget self-heal + T-money (Firestore write 없음)
  applyBackfillsAndTmoney(itinerary, {
    hotelByCity: body.hotelByCity,
    body,
    hotel_address: userInput.hotel_address || '',
    hotelAddressFromBody: userInput.hotel_address || '',
    recommendedZone: userInput.recommendedZone || '',
    language: userInput.language || 'en',
    blockMode: true,
  });

  // 5) 추천 식당 (DB, Gemini 미경유)
  const dietPrefs = Array.isArray(userInput.dietPrefs) ? userInput.dietPrefs : [];
  await applyRecommendedRestaurants(itinerary, {
    area,
    dietPrefs,
    regions: body.regions,
    blockModeUsed: true,
    language: userInput.language || 'en',
  });

  // 6) 가격
  const vehicle = userInput.vehicle || 'staria_8';
  const durationDays = Number(userInput.durationDays) || (itinerary.days || []).length || 1;
  const pricing = { vehicle, ...computePricing(vehicle, durationDays) };

  return { itinerary, pricing, blocksUsed };
}

// ── helpers ──────────────────────────────────────────────────────────────────

/**
 * 블록 stop 의 실측 좌표로 axios mock 의 geocoding 좌표표를 구성.
 * RouteAgent 가 Naver geocode 호출 시 axios mock 이 이 표에서 query(주소/이름)를 매칭해
 * 좌표를 반환 → place.lat/lng 채워짐 → transitCache lookup(좌표 필요) 활성.
 */
function buildGeoTableFromBlocks(blocks) {
  const table = [];
  for (const b of blocks || []) {
    for (const s of (b.stops || [])) {
      const lat = Number(s.lat); const lng = Number(s.lng);
      if (!Number.isFinite(lat) || !Number.isFinite(lng) || (lat === 0 && lng === 0)) continue;
      const names = [
        s.address,
        s.name,
        s.name_i18n && s.name_i18n.en,
        s.name_i18n && s.name_i18n.ko,
        s.display_name,
      ].filter(Boolean);
      if (names.length) table.push({ q: names, lat, lng });
    }
  }
  globalThis.__PLAN_LOCAL_GEO__ = table;
}

/**
 * expand 출력 stop 에 좌표를 backfill — 소스 블록 stop 의 lat/lng 를 order 로 매칭 복사.
 * prod 의 Naver geocoding 단계를 오프라인에서 대체 (블록에 실측 좌표가 이미 있음).
 * → RouteAgent 의 transitCache lookup 분기(좌표 필요)가 활성화돼 캐시 transit_matrix 사용.
 */
function backfillStopCoordsFromBlocks(itinerary, selection, blocks) {
  const blockMap = new Map((blocks || []).map((b) => [b.id, b]));
  const days = Array.isArray(itinerary.days) ? itinerary.days : [];
  for (let di = 0; di < days.length; di++) {
    const day = days[di];
    const block = blockMap.get(day.source_block_id);
    if (!block) continue;
    const byOrder = new Map((block.stops || []).map((s) => [Number(s.order), s]));
    let lastLat = null, lastLng = null;
    for (const stop of (day.stops || [])) {
      const src = byOrder.get(Number(stop.order));
      const sLat = src && Number(src.lat);
      const sLng = src && Number(src.lng);
      if (src && Number.isFinite(sLat) && Number.isFinite(sLng) && (sLat !== 0 || sLng !== 0)) {
        stop.lat = sLat; stop.lng = sLng;
        lastLat = sLat; lastLng = sLng;
      } else if ((stop.lat == null || stop.lng == null) && lastLat != null) {
        // placeholder 식당(좌표 없음) → 직전 명소 좌표로 근사 (동선 표시 + 캐시 분기 활성).
        stop.lat = lastLat; stop.lng = lastLng;
      }
    }
  }
}

function blockCitiesOf(blocks) {
  return [...new Set((blocks || []).map((b) => String(b.city || '').toLowerCase()).filter(Boolean))];
}

/** 다도시 expand 가 기대하는 cityBlocksList: [{ city, blocks, ok }] (city 순서 = 등장 순서). */
function groupBlocksByCity(blocks) {
  const byCity = new Map();
  for (const b of blocks || []) {
    const c = String(b.city || '').toLowerCase();
    if (!c) continue;
    if (!byCity.has(c)) byCity.set(c, []);
    byCity.get(c).push(b);
  }
  return [...byCity.entries()].map(([city, list]) => ({ city, blocks: list, ok: true }));
}

// ── 하네스 품질 체크 ──────────────────────────────────────────────────────────

/**
 * No-undefined check: 모든 stop 의 display name / tip 에 "undefined" 또는
 * "[object Object]" 리터럴이 없어야 한다.
 */
export function checkNoUndefinedStrings(itinerary) {
  const BAD = ['undefined', '[object Object]'];
  const offenders = [];
  (itinerary.days || []).forEach((day, di) => {
    (day.stops || []).forEach((s, si) => {
      const nm = s.display_name || s.name || '';
      const tip = s.tip || '';
      for (const b of BAD) {
        if (nm.includes(b)) offenders.push(`day${day.day || di + 1} stop${si + 1} name="${nm}"`);
        if (tip.includes(b)) offenders.push(`day${day.day || di + 1} stop${si + 1} tip="${tip.slice(0, 60)}"`);
      }
    });
  });
  if (offenders.length) {
    console.log(`  ❌ checkNoUndefinedStrings: ${offenders.length}건`);
    offenders.slice(0, 5).forEach((o) => console.log(`     - ${o}`));
  } else {
    console.log('  ✅ checkNoUndefinedStrings: PASS');
  }
}

/**
 * Transit-leg presence check: 각 날, stop 이 2개 이상이면 2번째 stop 부터
 * transit_from_prev 가 있어야 한다.
 */
export function checkTransitLegPresence(itinerary) {
  let missing = 0;
  (itinerary.days || []).forEach((day, di) => {
    const stops = Array.isArray(day.stops) ? day.stops : [];
    if (stops.length < 2) return;
    for (let i = 1; i < stops.length; i++) {
      if (!stops[i].transit_from_prev) {
        missing++;
      }
    }
  });
  if (missing) {
    console.log(`  ❌ checkTransitLegPresence: ${missing}개 구간에 transit_from_prev 없음`);
  } else {
    console.log('  ✅ checkTransitLegPresence: PASS');
  }
}

// ── 다도시 bookend 체크 (intercity_transit 有 여부) ───────────────────────────

/**
 * checkMultiCityBookends: 다도시 플랜의 각 날에 intercity_transit 이 있는지 확인.
 * 단도시면 skip.
 */
export function checkMultiCityBookends(itinerary) {
  const days = itinerary.days || [];
  const cities = [...new Set(days.map((d) => d.city).filter(Boolean))];
  if (cities.length < 2) {
    console.log('  ✅ checkMultiCityBookends: PASS (단도시 — skip)');
    return;
  }
  let missing = 0;
  days.forEach((day, di) => {
    if (di === 0) return; // 첫 날은 intercity 없어도 OK
    if (!day.intercity_transit) missing++;
  });
  if (missing) {
    console.log(`  ❌ checkMultiCityBookends: ${missing}일에 intercity_transit 없음`);
  } else {
    console.log('  ✅ checkMultiCityBookends: PASS');
  }
}

// ── 콘솔 요약 출력 (동선 / transit / budget / T-money 눈으로 검증) ────────────
export function printPlanSummary(itinerary, pricing, { scenario, blocksUsed }) {
  const L = (s = '') => console.log(s);
  const num = (n) => (n == null ? '-' : Number(n).toLocaleString('en-US'));

  L('');
  L('═'.repeat(72));
  L(`  PLAN SUMMARY — scenario: ${scenario}`);
  L('═'.repeat(72));
  L(`  title    : ${itinerary.tour_title || '(none)'}`);
  L(`  days     : ${(itinerary.days || []).length}`);
  L(`  blocks   : ${(blocksUsed || []).join(', ') || '-'}`);
  L(`  vehicle  : ${pricing.vehicle}  price: ₩${num(pricing.priceKRW)} / $${pricing.priceUSD}`);
  L(`  T-money  : recommended load ₩${num(itinerary.t_money_recommended_load)}`);

  const budget = Array.isArray(itinerary.daily_budget_summary) ? itinerary.daily_budget_summary : [];

  (itinerary.days || []).forEach((day, di) => {
    L('');
    L('─'.repeat(72));
    L(`  DAY ${day.day || di + 1}${day.city ? `  [${day.city}]` : ''}${day.theme ? `  — ${day.theme}` : ''}`);
    L('─'.repeat(72));

    if (day.intercity_transit) {
      const it = day.intercity_transit;
      L(`  🚄 intercity: ${it.from_city || '?'} → ${it.to_city || '?'} via ${it.mode || '?'}` +
        ` (~${it.duration_min || it.est_min || '?'}min, ₩${num(it.est_fare_krw || it.cost_krw)})`);
    }

    const stops = Array.isArray(day.stops) ? day.stops : [];
    stops.forEach((s, si) => {
      const coord = (s.lat != null && s.lng != null) ? `(${Number(s.lat).toFixed(4)},${Number(s.lng).toFixed(4)})` : '(no-coord)';
      const nm = s.display_name || s.name || '(unnamed)';
      const cat = s.category ? `[${s.category}]` : '';
      L(`   ${String(s.start_time || '--:--').padEnd(5)}  ${nm} ${cat} ${coord}`);

      // 구간 transit (이 stop 까지 오는 이동)
      const t = s.transit_from_prev || (s.travelFromPrev && s.travelFromPrev.transitOptions);
      if (si > 0 && t) {
        const pub = t.publicTransit || (s.travelFromPrev && s.travelFromPrev.transitOptions && s.travelFromPrev.transitOptions.publicTransit);
        const mins = t.duration_min || t.est_min || (pub && pub.duration) || '?';
        const fare = t.est_fare_krw || (pub && pub.fare) || 0;
        const method = (pub && pub.method) || t.mode || t.method || '?';
        const src = t.source || (t._fromCache ? 'cache' : '') || '';
        L(`            ↳ transit: ${method} ~${mins}min ₩${num(fare)}${src ? `  {${src}}` : ''}`);
      }
    });

    const b = budget.find((x) => Number(x.day) === Number(day.day || di + 1)) || budget[di];
    if (b) {
      L(`   💰 budget: transport ₩${num(b.transport_krw)} | meals ₩${num(b.meals_krw)} | entry ₩${num(b.entry_fees_krw)} | total ₩${num(b.total_krw)}`);
    }
  });

  // recommended restaurants 요약
  const rec = itinerary.recommended_restaurants || {};
  const recCounts = Object.entries(rec).map(([k, v]) => `${k}=${Array.isArray(v) ? v.length : 0}`).join(' ');
  L('');
  L('─'.repeat(72));
  L(`  recommended_restaurants: ${recCounts || '(none)'}`);

  // quality warnings (있으면 — placeholder/intercity gap 등)
  const qw = Array.isArray(itinerary.quality_warnings) ? itinerary.quality_warnings : [];
  if (qw.length) {
    L(`  ⚠ quality_warnings (${qw.length}):`);
    qw.slice(0, 8).forEach((w) => L(`     - ${w.kind || w.type || '?'}: ${(w.message || '').slice(0, 90)}`));
  }
  L('═'.repeat(72));
  L('');
}
