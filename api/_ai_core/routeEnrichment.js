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
function validateLodgingBookend(itinerary, anchor) {
  if (!anchor || anchor.lat == null || anchor.lng == null) {
    console.log('[validator] LODGING BOOKEND skip — anchor coord 없음');
    return;
  }
  const THRESHOLD_M = 5000;
  const warnings = [];
  for (let i = 0; i < (itinerary.days || []).length; i++) {
    const stops = itinerary.days[i].stops || [];
    if (stops.length === 0) continue;
    const first = stops[0];
    const last = stops[stops.length - 1];
    const firstDist = distanceMeters(first, anchor);
    const lastDist = distanceMeters(last, anchor);
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
    itinerary.quality_warnings.push({ type: 'lodging_bookend_violation', anchor: anchor.label || '(unknown)', items: warnings });
  } else {
    console.log('[validator] LODGING BOOKEND OK — 모든 Day 첫/마지막 stop 5km 이내');
  }
}

export async function enrichItineraryWithRoute(itinerary, { apiKey, body, hotel_address, arrival_airport, departure_airport, pax }) {
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
    };
    console.log('[planner] RouteAgent input days:', wrapped.itinerary.days.length, '| stops/day:', wrapped.itinerary.days.map((d) => (d.places || d.stops || []).length));
    const enriched = await routeAgent.call(JSON.stringify(wrapped));
    const enrichedData = JSON.parse(enriched.rawOutput);

    // enrichedData.itinerary may be array (legacy) or object (new wrapped form).
    const enrichedItin = enrichedData.itinerary;
    const enrichedDays = Array.isArray(enrichedItin) ? enrichedItin : (enrichedItin?.days || []);

    if (enrichedDays.length > 0) {
      enrichedDays.forEach((enrichedDay, i) => {
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
    validateLodgingBookend(itinerary, anchorCoord);

    // B-11 diag (2026-05-12): RouteAgent 후 최종 결과 요약. validate-prod-baseline
    // B-7 검증과 대응 — transit_from_prev attach 비율 출력. 0/N 이면 RouteAgent
    // 가 silent fail 한 신호 (TDZ ReferenceError 같은 회귀 빠른 감지).
    const allStops = (itinerary.days || []).flatMap((d) => d.stops || []);
    const stopsWithTransit = allStops.filter((s) => s.transit_from_prev != null).length;
    const stopsGeocoded = allStops.filter((s) => s.lat != null).length;
    console.log(`[routeEnrich] summary — transit attached: ${stopsWithTransit}/${allStops.length}, geocoded: ${stopsGeocoded}/${allStops.length}`);
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
