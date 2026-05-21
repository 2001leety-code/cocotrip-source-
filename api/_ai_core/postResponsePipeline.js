/**
 * Post-Gemini → Firestore 저장까지의 enrichment + price + persist 파이프라인.
 *
 * Extracted from api/ai-planner-full.js L612-710 (P129, 2026-05-21).
 * 흐름: guide cleanup → RouteAgent → end_time/lodging backfill →
 *       unreasonable stops check → T-money → recommended_restaurants →
 *       calcPrice → persistPlan. 모든 부수효과 (mutating itinerary,
 *       Firestore write) 유지.
 *
 * 본 모듈은 handlerCore.withStep 호출 의무 — RouteAgent / persistPlan
 * await 가 step instrumentation 의 핵심. 그래서 본 모듈은 함수 합성만
 * 노출하고, withStep wrapping 은 handlerCore 에서 한다.
 */
import {
  calculateTmoney, persistPlan, backfillStopEndTimes, backfillDayLodging,
  runUnreasonableStopTimesCheck,
} from './planPersister.js';
import { pickRecommendedRestaurantsByStyle } from './recommendedRestaurants.js';
import { loadFoodIndex } from './geminiPipeline.js';
import { enrichItineraryWithRoute } from './routeEnrichment.js';
import { calcPrice } from './vehicleAndPrice.js';

/**
 * arrival_guide / departure_guide 정리 + RouteAgent enrichment.
 * @param itinerary - Gemini 응답 (in-place mutation).
 * @param ctx - { apiKey, body, hotel_address, arrival_airport, departure_airport, pax, recommendedZone, recommendedZoneAddress, hotelAddressFromBody }
 */
export async function runRouteEnrichment(itinerary, ctx) {
  const {
    apiKey, body, hotel_address /* effective for RouteAgent */,
    arrival_airport, departure_airport, pax,
    recommendedZone, recommendedZoneAddress, hotelAddressFromBody,
  } = ctx;

  // ALREADY 또는 미정 → arrival_guide / departure_guide 제거
  if (!arrival_airport || arrival_airport === 'ALREADY') delete itinerary.arrival_guide;
  if (!departure_airport || departure_airport === 'ALREADY') delete itinerary.departure_guide;

  // 2026-05-05 (운영자 요청): 숙소→공항 경로 무조건 표시 정책 강화.
  // Gemini 가 departure_guide 자체를 생성 안 한 케이스에 대비해 빈 객체라도
  // 만들어 둔다. 그래야 RouteAgent 가 route_to_airport 를 attach 할 수 있고,
  // 프론트엔드는 호텔/zone fallback 좌표로 출국 경로 카드를 항상 노출함.
  if (departure_airport && departure_airport !== 'ALREADY' && !itinerary.departure_guide) {
    itinerary.departure_guide = { airport: departure_airport };
    console.log('[planner] departure_guide synthesized (airport=', departure_airport, ')');
  }

  // ── RouteAgent enrichment (mutates itinerary in place) ────────────────
  // 2026-05-03: routeHotelAddress = hotel_address || zone anchor. zone만 골랐어도
  // 공항↔zone 환승 경로(arrival_guide.route_to_hotel)가 정상 계산됨. 사용자가
  // Firestore에서 보는 hotel_address 필드는 그대로 빈 값 유지.
  await enrichItineraryWithRoute(itinerary, {
    apiKey,
    body,
    hotel_address,
    arrival_airport,
    departure_airport,
    pax,
  });

  // arrival_guide / departure_guide의 route_to_hotel에 zone fallback이 적용됐음을
  // 표시 — UI가 "Lotte Hotel 기준" 대신 "홍대 지역 기준"으로 라벨링할 수 있게.
  if (!hotelAddressFromBody && recommendedZoneAddress) {
    if (itinerary.arrival_guide?.route_to_hotel) {
      itinerary.arrival_guide.route_to_hotel.anchor_label = recommendedZone;
      itinerary.arrival_guide.route_to_hotel.anchor_address = recommendedZoneAddress;
    }
    if (itinerary.departure_guide?.route_to_airport) {
      itinerary.departure_guide.route_to_airport.anchor_label = recommendedZone;
      itinerary.departure_guide.route_to_airport.anchor_address = recommendedZoneAddress;
    }
  }
}

/**
 * end_time backfill + day.lodging backfill + 새벽 stops 검출 + T-money.
 * @param itinerary - in-place mutation
 * @param ctx - { hotelByCity, body }
 */
export function applyBackfillsAndTmoney(itinerary, ctx) {
  // ── P112 (2026-05-20): end_time backfill ──────────────────────────────
  // Gemini/RouteAgent 가 일부 stop 에 end_time 안 채우면 UI 가 "15:45-undefined"
  // 류 표시 + PDF/email/voucher downstream 깨짐. start_time + stay_min 으로
  // 자동 계산. 이미 채워진 stop 은 override X (timeline stitching 결과 존중).
  backfillStopEndTimes(itinerary);

  // ── P119/P120/P123 (2026-05-20): day.lodging + 새벽 stops + 도시별 호텔 ──
  // plan 4792076e + 209de47b 회귀 동시 차단. 자세한 로직은 planPersister wrapper.
  // P123: hotelByCity (사용자 wizard 도시별 호텔) 우선 — Gemini wrong-city 호텔 override.
  backfillDayLodging(itinerary, ctx.hotelByCity);
  runUnreasonableStopTimesCheck(itinerary, ctx.body);

  // ── T-money 서버 계산 ─────────────────────────────────────────────────
  calculateTmoney(itinerary);
}

/**
 * Must-visit 맛집 추천 (DB 기반 — Gemini 미경유). dietPrefs 기준 per-style bucket.
 * @returns foodIndex (handlerCore 가 persistPlan 에 forward).
 */
export async function applyRecommendedRestaurants(itinerary, ctx) {
  const { area, dietPrefs, regions } = ctx;
  // 동선 5km 이내 + plan 미포함 식당 중 rating × log(reviews) 상위 10개씩.
  // dietPrefs 기준 per-style bucket: { general, vegan?, halal? } — 섞지 않음.
  // 2026-05-05 regression fix: 이전엔 general만 노출 → vegan/halal 사용자도
  // 일반 식당만 봤음. SAFETY-CRITICAL (CLAUDE.md J).
  let foodIndexForQuality = [];
  try {
    const foodIndex = await loadFoodIndex();
    foodIndexForQuality = foodIndex;
    // 2026-05-11 (B-3 fix): regions array forward — 다도시 plan 시 도시별
    // 추천 식당 분배 (5+5 또는 4+3+3). 단도시는 regions=[area] → 기존 10개 동일.
    itinerary.recommended_restaurants = pickRecommendedRestaurantsByStyle(
      foodIndex, itinerary, area, dietPrefs, regions,
    );
    const _bucketSizes = Object.entries(itinerary.recommended_restaurants)
      .map(([k, v]) => `${k}=${Array.isArray(v) ? v.length : 0}`).join(' ');
    console.log('[planner] recommended_restaurants buckets:', _bucketSizes);
  } catch (recErr) {
    // Non-critical — plan still ships if recommendation fails.
    console.warn('[planner] recommended_restaurants failed:', recErr.message);
    itinerary.recommended_restaurants = { general: [] };
  }
  return foodIndexForQuality;
}

/**
 * 가격 계산 (KRW + USD).
 */
export function computePricing(vehicle, durationDays) {
  const priceKRW = calcPrice(vehicle, durationDays);
  const exchangeRate = Number(process.env.KRW_USD_RATE) || 1380;
  const priceUSD = Math.round(priceKRW / exchangeRate * 100) / 100;
  return { priceKRW, priceUSD };
}

/**
 * Firestore 저장. handlerCore 가 await withStep('persistPlan', () => savePlan(...)) 로 호출.
 */
export async function savePlan(adminDb, ctx) {
  return persistPlan(adminDb, ctx);
}
