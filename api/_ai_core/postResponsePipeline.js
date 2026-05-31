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
  pushIntercityGapWarnings,
  correctCrossCityLodgingStops,
  selfHealArrivalGuide,
  selfHealDepartureGuide,
  selfHealDailyBudget,
  // P270 (2026-05-28): dead code 복구 — selfHealLodgingBookend 가 planPersister 에
  // define 됐지만 applyBackfillsAndTmoney 호출 chain 누락 → block_mode plan 의 Day
  // 마지막 stop 이 lodging 아닐 때 (zone_courses JSON 자체에 lodging 없음) self_heal
  // 발동 안 됨 → 운영자 의도 ("호텔=동선 anchor, Day 마지막 호텔 복귀") 위반.
  selfHealLodgingBookend,
} from './planPersister.js';
import { pickRecommendedRestaurantsByStyle } from './recommendedRestaurants.js';
import { loadFoodIndex } from './geminiPipeline.js';
import { enrichItineraryWithRoute } from './routeEnrichment.js';
import { calcPrice } from './vehicleAndPrice.js';
import { throttledTelegramAlert } from '../_shared/telegram-throttle.js';
import { applyBlockModeDietaryWarnings } from './responseValidator.js';

// P203 (2026-05-26): routeEnrich 180s wall-clock cap.
// 배경: 5/25 prod alert step elapsed 27분 (1.67M ms) — Vercel 600s cap 도달 전
//   외부 API hang (Naver/ODsay) 또는 axios connect/TLS handshake 무한 대기.
// 결정: 180s = 99th percentile (Sample 4 outlier 151s) + 안전마진. partial 결과는
//   mutation-in-place 디자인으로 보존 (transit_from_prev 일부 누락).
// 출처: deep-search 2026-05-26 Agent A — agents/RouteAgent.js DAY_CONCURRENCY=3 +
//   Phase 2.4/2.5/2.6 sequential + Naver 5s + ODsay 12s × retry 누적 = 27분 가능.
const ROUTE_ENRICH_TIMEOUT_MS = 180_000;

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
    // P253 (2026-05-27): block_mode 에서 첫 번째 blocksUsed 항목 = Firestore zone_courses doc ID.
    // enrichItineraryWithRoute 의 wrapped 객체를 통해 RouteAgent data.zone_id 로 전달.
    zone_id,
  } = ctx;

  // ALREADY 또는 미정 → arrival_guide / departure_guide 제거
  if (!arrival_airport || arrival_airport === 'ALREADY') delete itinerary.arrival_guide;
  if (!departure_airport || departure_airport === 'ALREADY') delete itinerary.departure_guide;

  // P161 (2026-05-23): arrival_guide self-heal — Gemini 비결정성으로 통째 누락 시
  // 5-step skeleton 합성. plan 8e767d9c (2026-05-23) 사용자 신고: "도착하면 어떻게
  // 한국 입국하는 안내가 없어" — Intro 다음 빈 영역. P160 selfHealLodgingBookend
  // 패턴 동일 — arrival_airport 가 있고 ALREADY 아니면 항상 호출 (이미 채워졌으면 no-op).
  // P288 (2026-05-29): selfHeal personalize — ctx 전달 (hotel_address / recommendedZone / arrival_time).
  // Gemini prompt 변경 0 = cache miss risk 0. P276+P277 buildPrompt 강화 대안.
  selfHealArrivalGuide(itinerary, arrival_airport, {
    hotel_address: hotel_address || hotelAddressFromBody,
    recommendedZone,
    arrival_time: body?.arrival_time || body?.arrivalTime,
  });

  // ── P274 (2026-05-29): SAFETY-CRITICAL — arrival_guide.airport 가 input mismatch 시 강제 override ──
  // 운영자 신고 (prod plan 696b273d 등 4건): input='ICN' (terminal 미지정) → Gemini 가
  //   departure_guide.airport='ICN T1' hallucinate + arrival_guide.route_to_hotel
  //   .fromStationName='인천공항2터미널' (ODsay 가 T1/T2 좌표 ~260m 인접 — 임의 선택) → 자가 모순.
  // selfHealArrivalGuide 는 airport 누락만 채움 (planPersister.js:503 `!existing.airport`
  //   분기) — Gemini hallucinate 한 airport 는 override 안 함. 본 fix 가 input truth source.
  // 비교: trim + uppercase + whitespace→underscore 정규화 → 'ICN T1' = 'ICN_T1'.
  if (arrival_airport && arrival_airport !== 'ALREADY' && itinerary.arrival_guide?.airport) {
    const normIn = String(arrival_airport).trim().toUpperCase().replace(/\s+/g, '_');
    const normOut = String(itinerary.arrival_guide.airport).trim().toUpperCase().replace(/\s+/g, '_');
    if (normOut !== normIn) {
      console.warn(`[planner P274] arrival_guide.airport mismatch (input='${arrival_airport}' vs output='${itinerary.arrival_guide.airport}') → override with input`);
      itinerary.arrival_guide.airport = arrival_airport;
      itinerary.quality_warnings = itinerary.quality_warnings || [];
      itinerary.quality_warnings.push({
        kind: 'arrival_airport_overridden',
        type: 'arrival_airport_overridden',
        severity: 'high',
        message: `P274: arrival_guide.airport input='${arrival_airport}' vs Gemini output='${normOut}' → input 으로 override (terminal mismatch 자가 모순 차단)`,
      });
    }
  }

  // 2026-05-05 (운영자 요청): 숙소→공항 경로 무조건 표시 정책 강화.
  // Gemini 가 departure_guide 자체를 생성 안 한 케이스에 대비해 빈 객체라도
  // 만들어 둔다. 그래야 RouteAgent 가 route_to_airport 를 attach 할 수 있고,
  // 프론트엔드는 호텔/zone fallback 좌표로 출국 경로 카드를 항상 노출함.
  //
  // P205 (2026-05-26): nested airport 누락 분기 추가. 5/26 measure 5/5 sample 모두
  // departure_guide 객체는 있지만 airport field 누락. Gemini 가 객체 emit 후 nested
  // field 누락 — backend 가 입력 departure_airport 로 보충 (B-16 SAFETY 보장).
  if (departure_airport && departure_airport !== 'ALREADY') {
    if (!itinerary.departure_guide) {
      itinerary.departure_guide = { airport: departure_airport };
      console.log('[planner] departure_guide synthesized (airport=', departure_airport, ')');
    } else if (!itinerary.departure_guide.airport) {
      itinerary.departure_guide.airport = departure_airport;
      console.log('[planner P205] departure_guide.airport self-healed (=', departure_airport, ')');
    } else {
      // P274: departure_guide.airport 가 input mismatch 시 override (arrival 패턴 동일).
      // plan 696b273d 4건: input='ICN' → Gemini='ICN T1' (added terminal) hallucinate.
      const normIn = String(departure_airport).trim().toUpperCase().replace(/\s+/g, '_');
      const normOut = String(itinerary.departure_guide.airport).trim().toUpperCase().replace(/\s+/g, '_');
      if (normOut !== normIn) {
        console.warn(`[planner P274] departure_guide.airport mismatch (input='${departure_airport}' vs output='${itinerary.departure_guide.airport}') → override with input`);
        itinerary.departure_guide.airport = departure_airport;
        itinerary.quality_warnings = itinerary.quality_warnings || [];
        itinerary.quality_warnings.push({
          kind: 'departure_airport_overridden',
          type: 'departure_airport_overridden',
          severity: 'high',
          message: `P274: departure_guide.airport input='${departure_airport}' vs Gemini output='${normOut}' → input 으로 override (terminal mismatch 자가 모순 차단)`,
        });
      }
    }
  }

  // P323 (2026-05-31): departure_guide 6필드 self-heal — block_mode 는 Gemini 가 departure_guide
  //   6필드(짐보관/세금환급/권장출발/막판쇼핑 등) 안 만들어 1/7 emit → 프론트 카드 누락.
  //   selfHealArrivalGuide 대칭. departure_airport/airport 보장 직후 + RouteAgent route_to_airport
  //   attach 전 호출 (route_to_airport 는 selfHeal 이 spread 보존). Gemini prompt 변경 0 = cache miss 0.
  if (departure_airport && departure_airport !== 'ALREADY') {
    selfHealDepartureGuide(itinerary, departure_airport, {
      hotel_address: hotel_address || hotelAddressFromBody,
      recommendedZone,
    });
  }

  // ── RouteAgent enrichment (mutates itinerary in place) ────────────────
  // 2026-05-03: routeHotelAddress = hotel_address || zone anchor. zone만 골랐어도
  // 공항↔zone 환승 경로(arrival_guide.route_to_hotel)가 정상 계산됨. 사용자가
  // Firestore에서 보는 hotel_address 필드는 그대로 빈 값 유지.
  // P203 (2026-05-26): 180s wall-clock cap — 27분 hang 차단. timeout 시 partial
  //   결과 mutation-in-place 보존 + telegram alert. plan 응답은 routeEnrich 일부
  //   누락 상태로 정상 진행 (P83 'route-blind-fallback' alert 가 user-facing degradation 추적).
  const enrichStart = Date.now();
  let timeoutId;
  try {
    await Promise.race([
      enrichItineraryWithRoute(itinerary, {
        apiKey, body, hotel_address, arrival_airport, departure_airport, pax,
        // P253: zone_id 전달 — RouteAgent 의 transitCache lookup 에 필요.
        zone_id,
      }),
      new Promise((_, reject) => {
        timeoutId = setTimeout(
          () => reject(new Error('ROUTE_ENRICH_TIMEOUT')),
          ROUTE_ENRICH_TIMEOUT_MS,
        );
      }),
    ]);
  } catch (err) {
    if (err && err.message === 'ROUTE_ENRICH_TIMEOUT') {
      const elapsed = Date.now() - enrichStart;
      // P218: ms 원시값 + human 단위 병기 — 운영자 오해 ("63분 = 불가능") 제거.
      const es=Math.round(elapsed/1000); const eh=es>=60?`${Math.floor(es/60)}분 ${es%60}초`:`${es}초`;
      console.warn(`[routeEnrich P203] 180s timeout — partial mutation 보존 (elapsed=${elapsed}ms / ${eh})`);
      throttledTelegramAlert({
        key: 'route-enrich-timeout',
        channel: 'admin',
        severity: 'high',
        message: `🔴 <b>routeEnrich 180s wall-clock timeout (P203 cap)</b>\n\nelapsed=${elapsed}ms (${eh})\npartial mutation-in-place 결과 보존, plan 응답 진행.\n\nVercel 600s cap 도달 전 fail-fast — 27분 hang 차단.`,
      }).catch(() => {});
      // throw 안 함 — fall through to remaining steps (lodging-bookend / backfills / persist)
    } else {
      throw err;
    }
  } finally {
    clearTimeout(timeoutId);
  }

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

  // ── P152 (2026-05-22): cross-city lodging stops 강제 교정 ──────────────
  // 9-시나리오 시뮬레이션 7/9 실패 (B-13). buildPrompt + userMessageBuilder
  // 만으로는 Gemini 비결정성을 못 잡음 → 마지막 안전망. day.city 와 다른 도시
  // 명시한 lodging stop 을 city-appropriate placeholder 로 강제 override.
  correctCrossCityLodgingStops(itinerary, ctx.hotelByCity, ctx.body?.recommendedZones);

  // ── P119/P120/P123 (2026-05-20): day.lodging + 새벽 stops + 도시별 호텔 ──
  // plan 4792076e + 209de47b 회귀 동시 차단. 자세한 로직은 planPersister wrapper.
  // P123: hotelByCity (사용자 wizard 도시별 호텔) 우선 — Gemini wrong-city 호텔 override.
  backfillDayLodging(itinerary, ctx.hotelByCity);
  runUnreasonableStopTimesCheck(itinerary, ctx.body);

  // ── P143 (2026-05-22): intercity KTX → 첫 stop 90min+ 공백 detect ──
  // RouteAgent Phase 2.4 stitch 실패 또는 Gemini 임의값 silent pass 케이스.
  // quality_warnings 에 박제 → 운영자 UI panel (P121 QualityWarningsPanel) 즉시 노출.
  pushIntercityGapWarnings(itinerary);

  // ── P162 (2026-05-23): daily_budget_summary self-heal ────────────────
  // Gemini 가 daily_budget_summary 통째 비우는 회귀 (plan 36c12df2). UI 빈 칸 →
  // 결제 가치 체감 저하. stop count 기반 추정값 생성.
  // P289 (2026-05-29): pax 기반 personalize — ctx 전달 (Gemini prompt 변경 X).
  selfHealDailyBudget(itinerary, { pax: ctx.body?.pax });

  // ── P270 (2026-05-28): lodging bookend self-heal (dead code 복구) ───
  // 운영자 의도 "호텔=동선 anchor, Day 시작/마지막 호텔" SSOT 박제. block_mode plan
  // (zone_courses JSON 의 stops 자체에 lodging 없음) 의 Day 마지막 stop 이 food 등
  // non-lodging 일 때 synthesized lodging stop append. backfillDayLodging 이 day.lodging
  // 채운 후 호출 (synthesized name 기본값 사용 가능).
  // P290 (2026-05-29): personalize — ctx 전달 (P288/P289 패턴 동일).
  //   단일 도시 plan + 사용자 hotel/zone 입력 시 placeholder 대신 user input 사용.
  //   day.lodging?.name 우선 (multi-city 보존). Gemini prompt 변경 0 = cache miss risk 0.
  selfHealLodgingBookend(itinerary, {
    hotel_address: ctx.hotel_address || ctx.hotelAddressFromBody,
    recommendedZone: ctx.recommendedZone,
    // P-launch (2026-05-31): 합성 호텔 stop 4lang tip + block_mode 정상 bookend 표시 suppress.
    language: ctx.language,
    blockMode: ctx.blockMode,
  });

  // ── T-money 서버 계산 ─────────────────────────────────────────────────
  calculateTmoney(itinerary);
}

/**
 * Must-visit 맛집 추천 (DB 기반 — Gemini 미경유). dietPrefs 기준 per-style bucket.
 * @returns foodIndex (handlerCore 가 persistPlan 에 forward).
 */
export async function applyRecommendedRestaurants(itinerary, ctx) {
  const { area, dietPrefs, regions, blockModeUsed } = ctx;
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
  // P324 (2026-05-31): block_mode dietary SAFETY — block_mode 는 validateResponse(legacy 의 dietary/
  //   allergen 검증처)를 handlerCore:319 `if(!itinerary)` 가드로 우회 → food stop 최종 후 coverage +
  //   알레르기 warning 재검증 (warning-only, P280 retry loop 회피). legacy 는 validateResponse 가 처리.
  if (blockModeUsed) applyBlockModeDietaryWarnings(itinerary, dietPrefs);
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
