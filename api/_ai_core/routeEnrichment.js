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
 */
import { RouteAgent } from './agents/RouteAgent.js';

export async function enrichItineraryWithRoute(itinerary, { apiKey, body, hotel_address, arrival_airport, departure_airport, pax }) {
  const routeStart = Date.now();
  console.log('[planner] Step 2: RouteAgent...', {
    NAVER: !!process.env.NAVER_CLIENT_ID,
    ODSAY: !!process.env.ODSAY_API_KEY,
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
        }
      });
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
  } catch (routeErr) {
    console.error('[planner] Route FAILED:', routeErr.message, '| stack:', routeErr.stack?.split('\n').slice(0, 3).join(' | '), '|', Date.now() - routeStart, 'ms');
  }
}
