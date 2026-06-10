/**
 * RouteAgent enrichment + merge (extracted from api/ai-planner-full.js).
 *
 * Wraps the itinerary with airport/hotel context, calls RouteAgent (which
 * adds Naver geocoding + ODsay transit + airport↔hotel routes), then merges
 * the enriched output back onto `itinerary.days`. Failures here are
 * non-fatal — the plan still saves with whatever data the planner produced.
 *
 * Note: this function MUTATES the passed `itinerary` (matches the legacy
 * inline behavior). Callers don't need to capture a return value.
 *
 * 2026-05-09 (B9-15 PR-I): post-route LODGING BOOKEND validator 추가. RouteAgent
 * 가 좌표를 채운 후, 첫/마지막 stop 이 hotel/zone 5km 이내인지 검증. 위반 시
 * itinerary.quality_warnings 에 기록 + console.warn — 운영자 분석용.
 */
import { RouteAgent } from './agents/RouteAgent.js';
import { throttledTelegramAlert } from '../_shared/telegram-throttle.js';
import { computeDayRouteMetrics, isExcessiveDayRoute } from './routeQuality.js';

/** Haversine distance in meters between two {lat, lng} points. */
function distanceMeters(a, b) {
  if (!a || !b || a.lat == null || a.lng == null || b.lat == null || b.lng == null) return null;
  const R = 6371e3;
  const φ1 = (a.lat * Math.PI) / 180;
  const φ2 = (b.lat * Math.PI) / 180;
  const Δφ = ((b.lat - a.lat) * Math.PI) / 180;
  const Δλ = ((b.lng - a.lng) * Math.PI) / 180;
  const x = Math.sin(Δφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
  return Math.round(2 * R * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x)));
}

/**
 * LODGING BOOKEND validator (B9-15).
 * 호텔/zone 좌표 알면 각 Day 의 첫/마지막 stop 이 5km 이내인지 확인.
 * 위반 시 itinerary.quality_warnings 에 항목 추가 (자동 재배치 X — 부작용 위험).
 *
 * @param {object} itinerary  - 진단 대상 itinerary (mutated: quality_warnings 추가)
 * @param {object} anchor     - { lat, lng, label } hotel 또는 zone anchor 좌표
 */
/** P139 (2026-05-22): airport_transfer 카테고리 stop 은 lodging_bookend 검증
 *  대상에서 제외. plan 9845a69e Day 5 의 last stop "인천국제공항 T1"
 *  (category=airport_transfer) 가 다도시 day-lodging anchor (해운대 호텔) 와
 *  349.4km 측정 → false-positive lodging_bookend_violation 생성. 출국일 마지막
 *  stop = 공항 이동 = lodging 5km 이내 의도 자체가 부적절. 단도시 / 다도시
 *  양쪽 분기 모두 적용. */
function isAirportTransferStop(stop) {
  const cat = String(stop?.category || '').toLowerCase();
  return cat === 'airport_transfer' || cat === 'airport';
}

function validateLodgingBookend(itinerary, anchor, isMultiCity) {
  // P127 (2026-05-20): multi-city plan 일 때 single global anchor (예: 첫 도시 호텔)
  // 기준 검증은 도시 전환 day 마다 false-positive 5건+ 발생 (plan 209de47b / 5aeeecef
  // 회귀). 다도시 → 각 day 의 lodging stop (stops 안의 첫 lodging category) 좌표
  // 기준 그 day 검증으로 분기.
  const THRESHOLD_M = 5000;
  const warnings = [];

  if (isMultiCity) {
    // P127: day-level anchor — 각 day 의 lodging stop 자체 좌표 기준 그 day 의
    // 다른 stops 가 5km 이내인지 검증. day-anchor 좌표 없으면 그 day skip.
    for (let i = 0; i < (itinerary.days || []).length; i++) {
      const stops = itinerary.days[i].stops || [];
      if (stops.length === 0) continue;
      const dayLodging = stops.find((s) => s?.category === 'lodging' && s?.lat != null && s?.lng != null);
      if (!dayLodging) continue;
      const dayAnchor = { lat: dayLodging.lat, lng: dayLodging.lng };
      const first = stops[0];
      const last = stops[stops.length - 1];
      // P139: airport_transfer category 는 출국 동선 의도 — bookend 검증 자체 부적절. skip.
      const firstDist = isAirportTransferStop(first) ? null : distanceMeters(first, dayAnchor);
      const lastDist = isAirportTransferStop(last) ? null : distanceMeters(last, dayAnchor);
      if (firstDist != null && firstDist > THRESHOLD_M) {
        warnings.push({ day: i + 1, position: 'first', stopName: first.name || first.display_name, distM: firstDist, anchorBasis: 'day-lodging' });
      }
      if (lastDist != null && lastDist > THRESHOLD_M) {
        warnings.push({ day: i + 1, position: 'last', stopName: last.name || last.display_name, distM: lastDist, anchorBasis: 'day-lodging' });
      }
    }
    if (warnings.length > 0) {
      console.warn('[validator] LODGING BOOKEND (multi-city day-anchor) 위반:', warnings.map((w) => `Day${w.day} ${w.position}=${w.stopName} (${w.distM}m)`).join(' | '));
      itinerary.quality_warnings = itinerary.quality_warnings || [];
      // P161 (2026-05-23): UI panel (QualityWarningsPanel) heading 은 w.type 읽음 +
      // 다른 self-heal 함수들은 w.kind. kind/type/message 양쪽 mirror 로 panel + JSON dump 호환.
      itinerary.quality_warnings.push({
        kind: 'lodging_bookend_violation',
        type: 'lodging_bookend_violation',
        anchor: 'multi-city-day-anchor',
        severity: 'low',
        message: `Multi-city day-anchor 위반 ${warnings.length}건: ` + warnings.map((w) => `Day${w.day} ${w.position}=${w.stopName}`).join(', '),
        items: warnings,
      });
    } else {
      console.log('[validator] LODGING BOOKEND (multi-city day-anchor) OK — 모든 day 의 stops 가 그 day lodging 5km 이내');
    }
    return;
  }

  // 단도시 (regions.length<=1) — 기존 logic (단일 global anchor)
  if (!anchor || anchor.lat == null || anchor.lng == null) {
    console.log('[validator] LODGING BOOKEND skip — anchor coord 없음 (단도시)');
    return;
  }
  for (let i = 0; i < (itinerary.days || []).length; i++) {
    const stops = itinerary.days[i].stops || [];
    if (stops.length === 0) continue;
    const first = stops[0];
    const last = stops[stops.length - 1];
    // P139: airport_transfer skip — 출국일 마지막 stop = 공항 이동 의도.
    const firstDist = isAirportTransferStop(first) ? null : distanceMeters(first, anchor);
    const lastDist = isAirportTransferStop(last) ? null : distanceMeters(last, anchor);
    if (firstDist != null && firstDist > THRESHOLD_M) {
      warnings.push({ day: i + 1, position: 'first', stopName: first.name || first.display_name, distM: firstDist });
    }
    if (lastDist != null && lastDist > THRESHOLD_M) {
      warnings.push({ day: i + 1, position: 'last', stopName: last.name || last.display_name, distM: lastDist });
    }
  }
  if (warnings.length > 0) {
    console.warn('[validator] LODGING BOOKEND 위반:', warnings.map((w) => `Day${w.day} ${w.position}=${w.stopName} (${w.distM}m)`).join(' | '));
    itinerary.quality_warnings = itinerary.quality_warnings || [];
    // P161 (2026-05-23): UI panel heading + JSON dump 호환 — kind/type/message mirror.
    itinerary.quality_warnings.push({
      kind: 'lodging_bookend_violation',
      type: 'lodging_bookend_violation',
      anchor: anchor.label || '(unknown)',
      severity: 'low',
      message: `Lodging bookend 위반 ${warnings.length}건: ` + warnings.map((w) => `Day${w.day} ${w.position}=${w.stopName}`).join(', '),
      items: warnings,
    });
  } else {
    console.log('[validator] LODGING BOOKEND OK — 모든 Day 첫/마지막 stop 5km 이내');
  }
}

export async function enrichItineraryWithRoute(itinerary, { apiKey, body, hotel_address, arrival_airport, departure_airport, pax, zone_id }) {
  const routeStart = Date.now();
  // B-11 diag (2026-05-12): root cause 진단용 — 어느 환경 변수가 없는지, 입력 stop
  // 수가 얼마나 되는지, 출력에 transit 가 attach 됐는지 한 줄에 요약. 머지 후
  // Vercel 로그에서 RouteAgent 호출 결과 즉시 확인 가능.
  const totalInputStops = (itinerary.days || []).reduce((s, d) => s + (d.stops?.length || 0), 0);
  console.log('[planner] Step 2: RouteAgent...', {
    NAVER: !!process.env.NAVER_CLIENT_ID,
    NAVER_SECRET: !!process.env.NAVER_CLIENT_SECRET,
    ODSAY: !!process.env.ODSAY_API_KEY,
    GOOGLE_PLACES: !!process.env.GOOGLE_PLACES_API_KEY,
    inputStops: totalInputStops,
  });
  try {
    const routeAgent = new RouteAgent(apiKey);
    // Wrapped as an ITINERARY OBJECT (not just days array) so RouteAgent can
    // also enrich arrival_guide.route_to_hotel + departure_guide.route_to_airport
    // using the ODsay airport↔hotel routing added in this release.
    const wrapped = {
      itinerary: {
        days: (itinerary.days || []).map((d) => ({ ...d, places: d.stops || [] })),
        arrival_guide: itinerary.arrival_guide,
        departure_guide: itinerary.departure_guide,
      },
      hotel_address: hotel_address || '',
      arrival_airport,
      departure_airport,
      // Wizard inputs used for smart airport-transport recommendation
      // (late-night arrival → limousine, heavy luggage → taxi, etc.)
      arrival_time: body.arrival_time || '',
      luggage: body.luggage || null,
      pax,
      // 2026-05-05: area + recommended_zone 누락 → RouteAgent 의 hotel→airport
      // fallback 체인 (zone anchor / city center) 동작 안 함 → 출국 경로 표시 누락.
      // ai-planner-full handler 에서 계산한 area / 사용자 zone 선택을 전달.
      area: body.area || body.region || '',
      region: body.area || body.region || '',
      recommended_zone: body.recommendedZone || body.recommended_zone || '',
      // 2026-05-10 (P0-1 launch blocker): regions array — RouteAgent.js
      // _enrichMultiCityDays() 가 regions.length>=2 시 작동. 누락 시 PR #331 다도시
      // fix 가 backend 에서 dead code (audit A 발견).
      regions: Array.isArray(body.regions) && body.regions.length > 0
        ? body.regions
        : (body.area ? [body.area] : []),
      // P253 (2026-05-27): zone_id = Firestore zone_courses doc ID (예: "SEOUL_DAY_MYEONGDONG_STANDARD").
      // RouteAgent data.zone_id 로 읽어서 transitCache.lookupTransitCache(zoneId, ...) 호출.
      // 단도시 block_mode 에서 blocksUsed[0] 값. legacy path + 다도시 = null → cache miss.
      // 다도시는 RouteAgent 가 day.source_block_id 로 per-day zone_id 를 처리.
      zone_id: zone_id || null,
    };
    console.log('[planner] RouteAgent input days:', wrapped.itinerary.days.length, '| stops/day:', wrapped.itinerary.days.map((d) => (d.places || d.stops || []).length));
    const enriched = await routeAgent.call(JSON.stringify(wrapped));
    const enrichedData = JSON.parse(enriched.rawOutput);

    // enrichedData.itinerary may be array (legacy) or object (new wrapped form).
    const enrichedItin = enrichedData.itinerary;
    const enrichedDays = Array.isArray(enrichedItin) ? enrichedItin : (enrichedItin?.days || []);

    if (enrichedDays.length > 0) {
      enrichedDays.forEach((enrichedDay, i) => {
        // P326 (2026-05-31): intercity_transit day-level merge — block_mode 다도시는 RouteAgent
        //   _enrichMultiCityDays(KTX 등 생성)의 출력이 이 enrichedDay(shallow-copy)에만 붙는데, 아래
        //   stops/lodging merge 처럼 원본으로 복사 안 하면 persist 전에 손실됨 (생성됐다 버려짐 =
        //   다도시 서울→부산 KTX 0건 root cause). legacy 는 Gemini 가 원본에 직접 써서 살아남음.
        //   도시전환일은 stops 0 일 수도 있어 아래 enrichedStops>0 조건 밖에서 복사.
        if (itinerary.days[i] && enrichedDay.intercity_transit) {
          itinerary.days[i].intercity_transit = enrichedDay.intercity_transit;
        }
        const enrichedStops = enrichedDay.stops || enrichedDay.places || [];
        if (itinerary.days[i] && enrichedStops.length > 0) {
          const odsayCount = enrichedStops.filter((p) => p.transit_from_prev?.source === 'odsay').length;
          const geoCount = enrichedStops.filter((p) => p.lat != null).length;
          console.log(`[planner] Day ${i + 1}: ${enrichedStops.length} stops, ${geoCount} geocoded, ${odsayCount} ODsay routes`);

          itinerary.days[i].stops = enrichedStops.map((p, j) => {
            const original = itinerary.days[i].stops[j] || {};
            return {
              ...original,
              ...p,
              start_time: p.start_time || original.start_time,
              transit_from_prev: p.transit_from_prev != null ? p.transit_from_prev : original.transit_from_prev,
              travelFromPrev: p.travelFromPrev || null,
              entry_fee_krw: original.entry_fee_krw,
              reservation_required: original.reservation_required,
              reservation_note: original.reservation_note,
              recommended_items: original.recommended_items,
            };
          });
          // 2026-05-08 신규: lodging bookend 필드 day-level merge.
          // RouteAgent (Phase 2.5/2.6) 가 enrichedDay 에 attach 한 lodging_to_first /
          // last_to_lodging 를 itinerary.days[i] 로 그대로 옮긴다. 호텔/zone anchor
          // 좌표가 없어서 RouteAgent 가 attach 안 한 케이스는 undefined → UI 자동 미노출.
          if (enrichedDay.lodging_to_first) {
            itinerary.days[i].lodging_to_first = enrichedDay.lodging_to_first;
          }
          if (enrichedDay.last_to_lodging) {
            itinerary.days[i].last_to_lodging = enrichedDay.last_to_lodging;
          }
        }
      });
      // B9-15 (2026-05-09): LodgingBookend 미노출 진단 — 모든 day 가 lodging_to_first
      // 비어 있으면 anchor 좌표 잡기 실패. 운영자 분석용 telemetry.
      const dayWithBookend = enrichedDays.filter((d) => d.lodging_to_first || d.last_to_lodging).length;
      if (dayWithBookend === 0 && enrichedDays.length > 0) {
        console.warn('[planner] LodgingBookend missing on ALL days — RouteAgent anchor coord 잡기 실패. hotelAddress="' + (hotel_address || '') + '" recommended_zone="' + (body?.recommendedZone || body?.recommended_zone || '') + '"');
      } else {
        console.log(`[planner] LodgingBookend attached: ${dayWithBookend}/${enrichedDays.length} days`);
      }
    } else {
      console.warn('[planner] RouteAgent returned no itinerary days. Keys:', Object.keys(enrichedData));
    }

    // Merge RouteAgent's airport↔hotel route enrichment back onto the plan.
    if (enrichedItin && !Array.isArray(enrichedItin)) {
      if (enrichedItin.arrival_guide?.route_to_hotel && itinerary.arrival_guide) {
        itinerary.arrival_guide.route_to_hotel = enrichedItin.arrival_guide.route_to_hotel;
        console.log('[planner] Airport→Hotel route attached:', itinerary.arrival_guide.route_to_hotel.est_min, 'min');
      }
      if (enrichedItin.departure_guide?.route_to_airport && itinerary.departure_guide) {
        itinerary.departure_guide.route_to_airport = enrichedItin.departure_guide.route_to_airport;
        console.log('[planner] Hotel→Airport route attached:', itinerary.departure_guide.route_to_airport.est_min, 'min');
      }
    }
    console.log('[planner] Route + Time Stitch:', Date.now() - routeStart, 'ms');

    // batch 9 fix (B9-15 PR-I, 2026-05-09): LODGING BOOKEND post-validator.
    // RouteAgent 가 stops 좌표 채운 후 첫/마지막 stop 이 hotel/zone 5km 이내인지 검증.
    // arrival_guide.route_to_hotel.anchor_lat/lng 우선, 없으면 departure_guide
    // .route_to_airport.anchor_lat/lng (대체 — 출발편만 있는 케이스). 둘 다 없으면 skip.
    let anchorCoord = null;
    if (enrichedItin && !Array.isArray(enrichedItin)) {
      const ah = enrichedItin.arrival_guide?.route_to_hotel;
      const dh = enrichedItin.departure_guide?.route_to_airport;
      if (ah?.anchor_lat != null && ah?.anchor_lng != null) {
        anchorCoord = { lat: ah.anchor_lat, lng: ah.anchor_lng, label: ah.anchor_label || hotel_address || 'lodging' };
      } else if (ah?.hotel_lat != null && ah?.hotel_lng != null) {
        anchorCoord = { lat: ah.hotel_lat, lng: ah.hotel_lng, label: hotel_address || 'lodging' };
      } else if (dh?.anchor_lat != null && dh?.anchor_lng != null) {
        anchorCoord = { lat: dh.anchor_lat, lng: dh.anchor_lng, label: dh.anchor_label || hotel_address || 'lodging' };
      }
    }
    // P127 (2026-05-20): multi-city plan 에는 day-level anchor 사용. 단일 global
    // anchor (첫 도시 호텔) 기준 검증이 도시 전환 day false-positive 5건+ 발생.
    const isMultiCityForBookend = Array.isArray(body?.regions) && body.regions.length >= 2;
    validateLodgingBookend(itinerary, anchorCoord, isMultiCityForBookend);

    // 2026-06-10: 동선 compactness 측정 (관찰 전용 — stop 재정렬/시각 변경 X).
    // buildPrompt ZONE CLUSTERING STRICT 룰의 효과를 prod 로그로 추적. 식당이 meal
    // 시각에 고정돼 reorder 로는 못 푸는 zigzag(Day2 26km 류)를 측정만 한다.
    // 자체 try — routeQuality 가 throw 해도 위 outer catch(=route FAILED telegram 오발)로
    // 새지 않도록 격리. 측정 실패는 plan 에 무해.
    try {
      (itinerary.days || []).forEach((d, i) => {
        const m = computeDayRouteMetrics(d.stops || []);
        if (m.coordCount >= 3) {
          const flag = isExcessiveDayRoute(m) ? ' ZIGZAG' : '';
          console.log(`[routeQuality] Day ${i + 1} (${d.city || '?'}): path=${m.pathKm}km span=${m.spanKm}km ratio=${m.pathPerSpan} maxLeg=${m.maxLegKm}km${flag}`);
        }
      });
    } catch (rqErr) {
      console.warn('[routeQuality] skip:', rqErr.message);
    }

    // B-11 diag (2026-05-12): RouteAgent 후 최종 결과 요약. validate-prod-baseline
    // B-7 검증과 대응 — transit_from_prev attach 비율 출력. 0/N 이면 RouteAgent
    // 가 silent fail 한 신호 (TDZ ReferenceError 같은 회귀 빠른 감지).
    const allStops = (itinerary.days || []).flatMap((d) => d.stops || []);
    const stopsWithTransit = allStops.filter((s) => s.transit_from_prev != null).length;
    const stopsGeocoded = allStops.filter((s) => s.lat != null).length;
    const blindFallbackStops = allStops.filter((s) => s.transit_from_prev?._blind_fallback === true).length;
    console.log(`[routeEnrich] summary — transit attached: ${stopsWithTransit}/${allStops.length}, geocoded: ${stopsGeocoded}/${allStops.length}, blind_fallback: ${blindFallbackStops}/${stopsWithTransit}`);

    // PR #463 (Audit X-H4 — 2026-05-16): aggregate blind-fallback ratio.
    // Pre-fix: RouteAgent emitted per-pair console.warn but routeEnrichment
    // never aggregated, so a regional geocoding outage produced "car · 25분 /
    // 5.0km" on every stop without surfacing to the operator. User saw a plan
    // where ALL transits were identical and asked "how do I actually get
    // between places?" — CS triage was the only signal.
    //
    // Threshold = 40% blind ratio across at least 5 transit-bearing stops.
    // Below 5 stops we don't alert: single-day arrival plans naturally have
    // few transits and one missing geocode dominates the ratio. Dedup key
    // includes regions so a busan-day outage and a seoul-day outage surface
    // as separate signals.
    const BLIND_RATIO_THRESHOLD = 0.4;
    const MIN_TRANSITS_FOR_ALERT = 5;
    if (stopsWithTransit >= MIN_TRANSITS_FOR_ALERT) {
      const blindRatio = blindFallbackStops / stopsWithTransit;
      if (blindRatio > BLIND_RATIO_THRESHOLD) {
        const regionsKey = Array.isArray(itinerary?.regions) && itinerary.regions.length > 0
          ? itinerary.regions.slice(0, 3).join('+')
          : (body?.area || 'unknown');
        const blindPct = Math.round(blindRatio * 100);
        throttledTelegramAlert({
          key: `route-blind-fallback:${regionsKey}`,
          channel: 'admin',
          severity: 'high',
          message: [
            `⚠️ <b>RouteAgent blind 25min/5km fallback — ${blindPct}% of transits</b>`,
            ``,
            `<b>regions:</b> ${regionsKey}`,
            `<b>blind stops:</b> ${blindFallbackStops} / ${stopsWithTransit} transit-bearing (${blindPct}%)`,
            `<b>geocoded:</b> ${stopsGeocoded} / ${allStops.length} total stops`,
            `<b>hotel_address:</b> ${String(hotel_address || '(none)').slice(0, 120)}`,
            ``,
            `→ user 가 받은 plan 의 대부분 transit 이 "car · 25분 · 5km" 동일. 사실상 이동 정보 없음.`,
            `→ 회귀 원인 가능성:`,
            `• Gemini geocode 단계가 stop 의 address 를 못 채움 (address parsing 회귀)`,
            `• NAVER geocoding API outage / quota`,
            `• stop name 형식이 NAVER 가 인식 못 함 (display_name 만 출력, address 누락)`,
          ].join('\n'),
          context: {
            errorCode: 'route_blind_fallback_high',
            reason: regionsKey,
            step: 'routeEnrichment-summary',
          },
        }).catch(() => {});
        console.warn(`[routeEnrich] BLIND FALLBACK RATIO HIGH — ${blindPct}% (${blindFallbackStops}/${stopsWithTransit}), alert fired`);
      }
    }
  } catch (routeErr) {
    // B-11 (2026-05-12): TDZ ReferenceError 같은 회귀가 silent swallow 안 되도록
    // 명시적 에러 type + 한 줄 요약 로그.
    console.error('[planner] Route FAILED:', routeErr.name + ':', routeErr.message, '| stack:', routeErr.stack?.split('\n').slice(0, 3).join(' | '), '|', Date.now() - routeStart, 'ms');

    // PR #459 (Audit X-H5 — 2026-05-16): silent catch + console.error 만으로는
    // 운영자가 Vercel 로그 폴링 없이 알 수 없음. user 는 이미 plan 받았지만
    // 모든 stop 에 transit_from_prev 없음 (이동 정보 0건) → "이동 어떻게 해요?"
    // CS 문의. throttledTelegramAlert (5min Firestore dedup + in-memory fallback
    // P67) 로 운영자 가시화. errType+regionsKey 키로 dedup → 한 city 전체 RouteAgent
    // 실패 시 1 alert (storm 차단).
    const errType = routeErr.name || 'Error';
    const regionsKey = Array.isArray(itinerary?.regions) ? itinerary.regions.slice(0, 3).join('+') : 'unknown';
    throttledTelegramAlert({
      key: `route-enrich-fail:${errType}:${regionsKey}`,
      channel: 'admin',
      severity: 'high',
      message: [
        `⚠️ <b>RouteAgent enrichment 실패 — transit info 0건</b>`,
        ``,
        `<b>에러 타입:</b> ${errType}`,
        `<b>regions:</b> ${regionsKey}`,
        `<b>메시지:</b> ${String(routeErr.message || '').slice(0, 250).replace(/[<>&]/g, '_')}`,
        `<b>소요시간:</b> ${Date.now() - routeStart}ms`,
        ``,
        `→ user plan 받았지만 stop 들에 transit 없음. NAVER_DEVELOPERS_* / Gemini quota / 좌표 누락 점검.`,
      ].join('\n'),
      context: { errType, regionsKey, message: String(routeErr.message || '').slice(0, 200) },
    }).catch(() => {});
  }
}
