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
// canonical 중복 분류(lodging 예외) — 점수 지표와 종단 게이트가 쓰는 것과 같은 소스.
import { findDuplicateStops } from '../../api/_ai_core/qualityMetrics.js';
// 종단 식이/식사커버리지 게이트 — 식이 요구 없으면 no-op.
import { runFinalItineraryValidation } from '../../api/_ai_core/finalItineraryGate.js';

/**
 * fixtures 의 blocks / selection / userinput 으로 오프라인 플랜을 생성한다.
 * @param {object} args
 * @param {Array<object>} args.blocks      — zone_courses 블록들 (transit_matrix 포함)
 * @param {object} args.selection          — { day_selections: [{day, block_id, city?, tweak_notes}], language }
 * @param {object} args.userInput          — 정규화된 사용자 입력 (durationDays, regions, area, dietPrefs, ...)
 * @returns {Promise<{itinerary: object, pricing: object, blocksUsed: string[], foodIndex: object[]}>}
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

  return { itinerary, pricing, blocksUsed, foodIndex };
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

/**
 * dev-only post-plan ASSERTION — 다도시(도시 변경) day 의 호텔↔역 bookend leg 누락 검사.
 *
 * 배경: "서울→부산 KTX 가이드가 그냥 부산 나옴" 류 버그 — intercity_transit 은 있는데
 * RouteAgent 의 lodging_to_station(이전 호텔→출발역) / station_to_lodging(도착역→새 호텔)
 * leg 가 비어 UI(LodgingBookend)가 그 transit arrow 를 통째로 미렌더 → 사용자 화면에
 * 호텔↔역 이동 안내 빈칸. 이 클래스의 버그를 배포 전 로컬에서 잡는다.
 *
 * 출력: 명확히 라벨된 PASS / FAIL 줄 + 누락 leg 요약. 절대 throw 안 함(하네스 중단 X).
 * 프로덕션 코드와 결합 없음 — 하네스 전용 (itinerary 읽기만).
 *
 * @param {object} itinerary  runOfflinePlan 결과의 itinerary
 * @returns {{ ok: boolean, cityChangeDays: number, missing: Array<object> }}
 */
export function checkMultiCityBookends(itinerary) {
  const L = (s = '') => console.log(s);
  const days = Array.isArray(itinerary && itinerary.days) ? itinerary.days : [];

  // 도시 변경 day = intercity_transit(or city-change) 이 존재하는 day.
  const cityChangeDays = days.filter((d) => d && d.intercity_transit
    && (d.intercity_transit.mode || d.intercity_transit.method));

  L('─'.repeat(72));
  L('  🚇 MULTI-CITY BOOKEND CHECK (dev-only, 배포 전 회귀 가드)');
  L('─'.repeat(72));

  if (cityChangeDays.length === 0) {
    L('  (도시 변경 day 없음 — 단일 도시 plan, 검사 skip)');
    L('═'.repeat(72));
    L('');
    return { ok: true, cityChangeDays: 0, missing: [] };
  }

  const missing = [];
  for (const d of cityChangeDays) {
    const it = d.intercity_transit;
    const fromTo = `${it.from_city || '?'}→${it.to_city || '?'}`;
    const tag = (leg) => {
      if (!leg) return null;
      const bf = leg._bookend_fallback ? ' (fallback)' : '';
      const mins = (leg.est_min === undefined || leg.est_min === null) ? '?' : leg.est_min;
      return `${leg.method || '?'} ~${mins}min${bf}`;
    };
    const pre = it.lodging_to_station;
    const post = it.station_to_lodging;
    const preTag = tag(pre);
    const postTag = tag(post);

    const missingLegs = [];
    if (!pre) missingLegs.push('lodging_to_station(호텔→역)');
    if (!post) missingLegs.push('station_to_lodging(역→호텔)');

    if (missingLegs.length > 0) {
      missing.push({ day: d.day, fromTo, mode: it.mode || it.method || '?', missingLegs });
      L(`  ❌ FAIL  Day ${d.day}  ${fromTo} via ${it.mode || it.method || '?'}`);
      L(`           pre(lodging_to_station)=${preTag || 'MISSING'}  post(station_to_lodging)=${postTag || 'MISSING'}`);
      L(`           → 누락: ${missingLegs.join(', ')}  (UI 에서 호텔↔역 이동 안내 빈칸)`);
    } else {
      L(`  ✅ PASS  Day ${d.day}  ${fromTo} via ${it.mode || it.method || '?'}`);
      L(`           pre=${preTag}  post=${postTag}`);
    }
  }

  L('');
  if (missing.length > 0) {
    L(`  ⚠ RESULT: FAIL — ${missing.length}/${cityChangeDays.length} 도시변경 day 에 bookend leg 누락.`);
    L(`     이 plan 을 배포하면 사용자가 "KTX 가이드가 그냥 도착 도시만 나옴" 으로 신고할 수 있음.`);
    L(`     원인 후보: STATION_COORDS 미등록 역명 / dayHotel 좌표 계산 실패 / ODsay null + fallback 합성 실패.`);
  } else {
    L(`  ✅ RESULT: PASS — ${cityChangeDays.length}/${cityChangeDays.length} 도시변경 day 모두 호텔↔역 bookend leg 보유.`);
  }
  L('═'.repeat(72));
  L('');

  return { ok: missing.length === 0, cityChangeDays: cityChangeDays.length, missing };
}

// ── 성공 아티팩트 쓰기 전 fail-closed 품질 게이트 ────────────────────────────
// run.mjs 가 outputs/plan-<scenario>.json 을 쓰기 **직전**에 호출한다. 하나라도
// 실패하면 파일을 안 쓰고 nonzero exit — "실패했는데 성공 산출물이 남는" 상황 방지.

/** 요청한 day 수 == 생성된 day 수. */
export function checkExactDayCount(itinerary, userInput) {
  const expected = Number(userInput && userInput.durationDays) || 0;
  const days = (itinerary && Array.isArray(itinerary.days)) ? itinerary.days : [];
  const actual = days.length;
  return { ok: expected > 0 && actual === expected, expected, actual };
}

/** 모든 day 가 stop 1개 이상. */
export function checkAllDaysNonEmpty(itinerary) {
  const days = (itinerary && Array.isArray(itinerary.days)) ? itinerary.days : [];
  const emptyDays = days
    .map((d, i) => ({ day: Number(d.day) || i + 1, stops: Array.isArray(d.stops) ? d.stops.length : 0 }))
    .filter((d) => d.stops === 0)
    .map((d) => d.day);
  return { ok: emptyDays.length === 0, emptyDays };
}

/** 비-lodging 중복 stop 0건. qualityMetrics.findDuplicateStops(=lodging 예외)와 같은 소스. */
export function checkNoDuplicateStops(itinerary) {
  const duplicates = findDuplicateStops(itinerary);
  return { ok: duplicates.length === 0, duplicates };
}

/** halal/vegan/vegetarian 요구 시 종단 식이·식사커버리지 게이트 통과. 요구 없으면 no-op(ok:true). */
export function checkDietaryCoverage(itinerary, userInput, foodIndex) {
  const dietary = Array.isArray(userInput && userInput.dietPrefs) ? userInput.dietPrefs : [];
  const result = runFinalItineraryValidation(itinerary, {
    language: userInput && userInput.language,
    dietary,
    styles: userInput && userInput.styles,
    foodIndex,
  });
  return { ok: result.ok, code: result.code, violations: result.violations, zeroFoodDays: result.zeroFoodDays };
}

/**
 * 5개 fail-closed 체크를 전부 돌려 종합 판정. 순수 함수(process.exit/파일쓰기 없음) —
 * run.mjs 가 결과를 보고 아티팩트 쓰기/exit code 를 결정한다.
 * @param {{itinerary: object, userInput: object, foodIndex?: object[]}} args
 * @returns {{ok: boolean, failures: Array<{check: string, message: string, detail: object}>}}
 */
export function runPreWriteQualityChecks({ itinerary, userInput, foodIndex }) {
  const failures = [];

  const dayCount = checkExactDayCount(itinerary, userInput);
  if (!dayCount.ok) {
    failures.push({
      check: 'day_count',
      message: `요청 day 수(${dayCount.expected}) ≠ 생성 day 수(${dayCount.actual})`,
      detail: dayCount,
    });
  }

  const nonEmpty = checkAllDaysNonEmpty(itinerary);
  if (!nonEmpty.ok) {
    failures.push({
      check: 'empty_day',
      message: `빈 day 존재: day ${nonEmpty.emptyDays.join(', ')}`,
      detail: nonEmpty,
    });
  }

  const dup = checkNoDuplicateStops(itinerary);
  if (!dup.ok) {
    failures.push({
      check: 'duplicate_stops',
      message: `비-lodging 중복 stop: ${dup.duplicates.map((d) => `${d.name}×${d.count}`).join(', ')}`,
      detail: dup,
    });
  }

  const bookend = checkMultiCityBookends(itinerary);
  if (!bookend.ok) {
    failures.push({
      check: 'multi_city_bookend',
      message: `다도시 bookend 누락: day ${bookend.missing.map((m) => m.day).join(', ')}`,
      detail: bookend,
    });
  }

  const dietary = checkDietaryCoverage(itinerary, userInput, foodIndex);
  if (!dietary.ok) {
    failures.push({
      check: 'dietary_coverage',
      message: `식이/식사커버리지 게이트 실패 (${dietary.code})`,
      detail: dietary,
    });
  }

  return { ok: failures.length === 0, failures };
}
