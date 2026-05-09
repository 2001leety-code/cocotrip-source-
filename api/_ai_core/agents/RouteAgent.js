import axios from "axios";
import { BaseAgent } from "./BaseAgent.js";
import { searchTransitRoute, formatTransitSummary, getSubwayStationInfo, getSubwayTimetable } from "../../_odsay_helper.js";
import { AIRPORT_COORDS, CITY_CENTER_COORDS, lookupZoneCoord } from "../constants.js";

// Sentry import은 dynamic — `_shared/sentry.js`의 captureError가 SENTRY_DSN
// 없으면 no-op이라 안전. 실패해도 import 자체로 plan 깨지지 않게 try/catch.
let _captureError = null;
async function reportError(err, ctx) {
  try {
    if (_captureError === null) {
      const mod = await import('../../_shared/sentry.js');
      _captureError = mod.captureError || (() => {});
    }
    await _captureError(err, ctx);
  } catch { /* swallow — 알림 실패가 plan을 깨면 안 됨 */ }
}

// Pick the recommended airport transport based on context.
//   - Heavy luggage  → CocoTrip charter cross-sell. Korean taxi law restricts
//     trunk capacity (a sedan taxi typically only takes ONE large suitcase),
//     so a group with multiple checked bags can't physically use a taxi —
//     they need a 8-pax Staria van or larger. We pitch our own charter here
//     instead of recommending an option that won't actually work.
//   - Late-night arrival (≥23:00 or <05:00) → AREX last train ~23:42, so
//     recommend limousine bus.
//   - Otherwise → AREX express is the fastest/cheapest standard option.
//
// Heavy threshold:
//   ≥3 large bags, OR (≥2 large bags AND ≥4 pax), OR (≥2 mediums AND ≥1 large
//   AND ≥3 pax) — anything that clearly won't fit in a sedan trunk.
function pickRecommendedTransport({ arrivalTimeHHMM, luggage, paxCount }) {
  const hour = arrivalTimeHHMM ? parseInt(arrivalTimeHHMM.split(':')[0], 10) : null;
  const lateNight = hour !== null && (hour >= 23 || hour < 5);
  const large = luggage?.large || 0;
  const medium = luggage?.medium || 0;
  const heavyLoad = large >= 3
    || (paxCount >= 4 && large >= 2)
    || (paxCount >= 3 && medium >= 2 && large >= 1);
  if (heavyLoad) {
    return {
      key: 'cocotrip_charter',
      reason_ko: '한국 택시는 캐리어 1개만 가능 — 짐이 많아 코코트립 전용 차량을 추천합니다 (기사가 모든 짐 적재)',
      reason_en: 'Korean taxis can only fit 1 suitcase — book a CocoTrip charter; your driver loads all luggage',
      reason_ja: '韓国のタクシーはスーツケース1個のみ — 荷物が多い方は専用車両を推奨（ドライバーが全荷物を積載）',
      reason_zh: '韩国出租车只能放1个行李箱 — 行李较多请预订CocoTrip包车（司机协助装载所有行李）',
      cta_link: '/charter',
    };
  }
  if (lateNight) {
    return {
      key: 'limousine_bus',
      reason_ko: '늦은 시각 도착 — AREX 막차 후 운행하는 리무진 버스 추천',
      reason_en: 'Late arrival — AREX has stopped, take limousine bus',
      reason_ja: '深夜到着 — AREXの終電後はリムジンバスを推奨',
      reason_zh: '深夜到达 — AREX末班车已结束，推荐机场巴士',
    };
  }
  return {
    key: 'arex_express',
    reason_ko: '가장 빠르고 저렴한 표준 옵션',
    reason_en: 'Fastest and cheapest standard option',
    reason_ja: '最速かつ最安の標準オプション',
    reason_zh: '最快最便宜的标准选择',
  };
}

// Map the Wizard / Gemini `area` value to the matching charter product in
// createPaypalOrder.js PRODUCT_PRICES so the "book a charter" CTA deep-links
// to the correct regional tour instead of always offering Seoul.
// Unknown / unpriced regions (e.g. jeju) fall back to charter_seoul_city;
// the client side still filters out regions that don't offer a charter.
const REGION_TO_CHARTER_PRODUCT = {
    seoul_city: 'charter_seoul_city',
    seoul: 'charter_seoul_city',
    seoul_suburb: 'charter_seoul_suburb',
    dmz: 'charter_dmz',
    incheon: 'charter_seoul_city',
    suwon: 'charter_seoul_suburb',
    gangwon: 'charter_gangwon',
    gangneung: 'charter_gangwon',
    chuncheon: 'charter_gangwon',
    pyeongchang: 'charter_ski',
    ski: 'charter_ski',
    gyeongju: 'charter_gyeongju',
    jeonju: 'charter_gyeongju',
    busan: 'charter_busan',
    yeosu: 'charter_busan',
    daegu: 'charter_busan',
};

function regionToCharterProduct(region) {
    if (!region) return 'charter_seoul_city';
    const key = String(region).toLowerCase();
    return REGION_TO_CHARTER_PRODUCT[key] || 'charter_seoul_city';
}

export class RouteAgent extends BaseAgent {
    constructor(apiKey) {
        super(apiKey, "route");
        // Per-agent cache: one subwayStationInfo call per unique station per plan.
        // A typical plan touches <=20 unique subway stations, well within ODsay's
        // 1000 calls/day Basic tier budget.
        this._stationCache = {};
        // Separate cache for Seoul Open Data timetable API (first/last train).
        // Key is stationID:WEEK_TAG so weekday vs weekend of same station
        // don't collide across days.
        this._timetableCache = {};
    }
    async call(userPrompt) {
        console.log("\n[Route] Naver Maps + ODsay Transit + Time Stitching...");
        // Robust JSON extraction: strip fences, find outermost { }
        let jsonStr = userPrompt.replace(/^```(?:json)?\s*|```\s*$/gm, '').trim();
        const firstBrace = jsonStr.indexOf('{');
        const lastBrace = jsonStr.lastIndexOf('}');
        if (firstBrace !== -1 && lastBrace > firstBrace) {
            jsonStr = jsonStr.slice(firstBrace, lastBrace + 1);
        }
        let data;
        try {
            data = JSON.parse(jsonStr);
        }
        catch (e) {
            console.warn("  [Route] JSON parse failed, falling back to LLM:", e.message);
            return super.call(userPrompt);
        }
        const clientId = (process.env.NAVER_CLIENT_ID || "").trim();
        const clientSecret = (process.env.NAVER_CLIENT_SECRET || "").trim();
        // Support both Gemini output formats
        const rawItinerary = data.itinerary || {};
        const hotelAddress = data.hotel_address || '';
        const region = data.area || data.region || '';
        const charterProductType = regionToCharterProduct(region);
        const daysList = Array.isArray(rawItinerary) ? rawItinerary : (rawItinerary.days || []);

        // ════════════════════════════════════════════════════════
        // Trip-level: geocode hotel ONCE, route airport ↔ hotel
        // (Phase 1 of arrival/departure guide enrichment)
        // ════════════════════════════════════════════════════════
        // Resolve order (B9-15/16/25, 2026-05-09):
        //   1. Naver Geocoding(hotelAddress) — 도로명/호텔명 정확도 최고
        //   2. lookupZoneCoord(hotelAddress) — substring 매칭 ("명동 롯데호텔" → 명동)
        //   3. lookupZoneCoord(recommended_zone key/한글)
        // 모두 실패 시 hotelLat/Lng 는 null 로 남고 후속 fallback (city center) 진입.
        // anchorSource 는 어느 단계에서 좌표를 잡았는지 기록 — 분석/UI 라벨용.
        let hotelLat = null, hotelLng = null, anchorSource = null, anchorLabel = null;
        if (hotelAddress && clientId && clientSecret) {
            try {
                const geoUrl = "https://maps.apigw.ntruss.com/map-geocode/v2/geocode";
                const geoRes = await axios.get(geoUrl, {
                    params: { query: hotelAddress },
                    headers: { "X-NCP-APIGW-API-KEY-ID": clientId, "X-NCP-APIGW-API-KEY": clientSecret },
                    timeout: 5000,
                });
                if (geoRes.status === 200 && geoRes.data.addresses?.length > 0) {
                    hotelLng = parseFloat(geoRes.data.addresses[0].x);
                    hotelLat = parseFloat(geoRes.data.addresses[0].y);
                    anchorSource = 'naver_geocode';
                    anchorLabel = hotelAddress;
                }
            } catch (e) {
                console.warn(`  - Hotel geocoding failed: ${e.message}`);
            }
        }
        // Fallback chain step 2: zone substring/exact match on hotelAddress.
        // 호텔 주소에 등록된 zone 명이 들어 있으면 좌표 즉시 잡음. NCP 키 fail 또는
        // 단일 동 명("명동")인 경우의 보호 장치.
        if ((hotelLat == null || hotelLng == null) && hotelAddress) {
            const z = lookupZoneCoord(hotelAddress);
            if (z) {
                hotelLat = z.lat;
                hotelLng = z.lng;
                anchorSource = 'zone_lookup';
                anchorLabel = z.label;
                console.log(`  ✓ [hotel-coord] zone substring match: "${hotelAddress}" → ${z.label} (${z.lat}, ${z.lng})`);
            }
        }
        // Fallback chain step 3: explicit recommended_zone key/Korean 한국어 명.
        if ((hotelLat == null || hotelLng == null) && data.recommended_zone) {
            const z = lookupZoneCoord(data.recommended_zone);
            if (z) {
                hotelLat = z.lat;
                hotelLng = z.lng;
                anchorSource = 'zone_key';
                anchorLabel = z.label;
                console.log(`  ✓ [hotel-coord] zone key match: "${data.recommended_zone}" → ${z.label} (${z.lat}, ${z.lng})`);
            }
        }
        if (hotelLat == null || hotelLng == null) {
            console.warn(`  ⚠ [hotel-coord] all fallbacks failed — hotelAddress="${hotelAddress}" zone="${data.recommended_zone || ''}". LodgingBookend 미노출 + departure_guide city-center fallback.`);
        }

        const arrivalAirportKey = this._normalizeAirportKey(rawItinerary.arrival_guide?.airport || data.arrival_airport);
        const departureAirportKey = this._normalizeAirportKey(rawItinerary.departure_guide?.airport || data.departure_airport || arrivalAirportKey);

        if (hotelLat && hotelLng && arrivalAirportKey && AIRPORT_COORDS[arrivalAirportKey]) {
            const ap = AIRPORT_COORDS[arrivalAirportKey];
            const route = await this._routeAirportHotel(ap, { lat: hotelLat, lng: hotelLng }, 'arrival');
            if (route && rawItinerary.arrival_guide) {
                const rec = pickRecommendedTransport({
                    arrivalTimeHHMM: data.arrival_time,
                    luggage: data.luggage,
                    paxCount: data.pax || 2,
                });
                // B9-15/25: anchor_lat/lng/label 명시 attach — routeEnrichment.js
                // 의 validateLodgingBookend 가 이걸 사용. anchor_source 는 분석용
                // (naver_geocode / zone_lookup / zone_key) — UI 는 무시 가능.
                rawItinerary.arrival_guide.route_to_hotel = {
                    ...route,
                    recommended_option: rec,
                    anchor_lat: hotelLat,
                    anchor_lng: hotelLng,
                    anchor_label: anchorLabel,
                    anchor_source: anchorSource,
                };
                console.log(`  - [Airport→Hotel] ${route.est_min}min via ${route.method}, recommended=${rec.key}, anchor=${anchorSource}/${anchorLabel}`);
            }
        }

        // ════════════════════════════════════════════════════════
        // Hotel→Airport: 호텔→공항 경로 무조건 표시 정책 (2026-05-05)
        // ════════════════════════════════════════════════════════
        // 운영자 요청: "공항에서 숙소 가는 경로처럼, 숙소 → 공항도 무조건 표시".
        // Fallback 체인: hotel 좌표 → arrival_guide.address geocode → zone anchor
        // geocode → 도시 중심 좌표. 모두 실패해도 _failed=true 객체를 셋해서
        // 프론트가 graceful 메시지를 띄울 수 있게 한다.
        if (departureAirportKey && AIRPORT_COORDS[departureAirportKey] && rawItinerary.departure_guide) {
            const ap = AIRPORT_COORDS[departureAirportKey];
            const { coord: depFromCoord, source: depFromSource, label: depFromLabel } = await this._resolveHotelOrFallback({
                hotelLat,
                hotelLng,
                hotelAddress,
                arrivalGuide: rawItinerary.arrival_guide,
                recommendedZone: data.recommended_zone,
                region,
                clientId,
                clientSecret,
            });

            if (depFromCoord) {
                const route = await this._routeAirportHotel(depFromCoord, ap, 'departure');
                if (route) {
                    if (depFromSource !== 'hotel') {
                        route.fallback_origin = depFromSource; // 'arrival_guide' | 'zone_anchor' | 'city_center'
                        route.fallback_label = depFromLabel || null;
                    }
                    // B9-16/25: anchor_lat/lng/label 명시 attach — UI 가 "Seoul City
                    // Center" generic 대신 정확한 출발지명 노출 가능. trip-level
                    // hotelLat/Lng 가 있으면 그것을, 없으면 fallback chain 결과를 사용.
                    route.anchor_lat = depFromCoord.lat;
                    route.anchor_lng = depFromCoord.lng;
                    route.anchor_label = depFromLabel || anchorLabel || null;
                    route.anchor_source = depFromSource === 'hotel' ? (anchorSource || 'hotel') : depFromSource;
                    rawItinerary.departure_guide.route_to_airport = route;
                    console.log(`  - [Hotel→Airport] ${route.est_min}min via ${route.method} (origin=${depFromSource}, anchor=${route.anchor_source}/${route.anchor_label})`);
                } else {
                    // ODsay 끝까지 실패 — _failed 마커로 graceful 표시.
                    rawItinerary.departure_guide.route_to_airport = {
                        _failed: true,
                        _odsay_failed: true,
                        fallbackReason: 'odsay_unavailable',
                        fallback_origin: depFromSource,
                        fallback_label: depFromLabel || null,
                        method: 'unknown',
                        source: 'failed',
                        direction: 'departure',
                    };
                    console.warn('  - [Hotel→Airport] ODsay all attempts failed → _failed=true');
                    await reportError(new Error('ODsay departure route failed'), {
                        route: 'RouteAgent.routeToAirport',
                        airport: departureAirportKey,
                        origin: depFromSource,
                        region,
                    });
                }
            } else {
                // 좌표 자체를 못 잡음 (도시 중심도 미정의된 region) — 그래도 _failed
                // 객체를 두면 UI는 Gemini instruction fallback을 보여줄 수 있다.
                rawItinerary.departure_guide.route_to_airport = {
                    _failed: true,
                    _odsay_failed: false,
                    fallbackReason: 'no_origin_coord',
                    method: 'unknown',
                    source: 'failed',
                    direction: 'departure',
                };
                console.warn('  - [Hotel→Airport] no origin coord (region/zone fallback unmapped)');
            }
        }

        for (const dayPlan of daysList) {
            const places = dayPlan.stops || dayPlan.places || [];
            // Derive weekday for first/last-train lookup. Gemini writes
            // dayPlan.date as "YYYY-MM-DD"; Date.getDay() -> 0=Sun..6=Sat
            // which we map to WEEK_TAG inside getSubwayTimetable.
            const dayDate = dayPlan.date ? new Date(dayPlan.date) : null;
            const dayOfWeek = (dayDate && !isNaN(dayDate.getTime())) ? dayDate.getDay() : null;

            // ════════════════════════════════════════════════════════
            // Phase 1: 모든 장소의 좌표 확보 (Naver Geocoding)
            // ════════════════════════════════════════════════════════
            for (const place of places) {
                const address = place.address || "";
                const name = place.name || place.name_ko || place.display_name || place.name_en || "";
                let lat = null;
                let lng = null;
                // Layer 2: Geocoding multi-fallback (address -> name+region -> display_name)
                if (clientId && clientSecret) {
                    const geoUrl = "https://maps.apigw.ntruss.com/map-geocode/v2/geocode";
                    const queries = [
                        address,
                        name && region ? `${name} ${region}` : '',
                        place.display_name || place.name_en || '',
                    ].filter(Boolean);
                    for (const query of queries) {
                        try {
                            const res = await axios.get(geoUrl, {
                                params: { query },
                                headers: {
                                    "X-NCP-APIGW-API-KEY-ID": clientId,
                                    "X-NCP-APIGW-API-KEY": clientSecret,
                                },
                                timeout: 5000,
                            });
                            if (res.status === 200 && res.data.addresses && res.data.addresses.length > 0) {
                                lng = parseFloat(res.data.addresses[0].x);
                                lat = parseFloat(res.data.addresses[0].y);
                                break;
                            }
                        } catch (e) {
                            console.error(`  - [${name}] geocoding fallback failed for "${query}": ${e.message}`);
                        }
                    }
                }
                // Layer 2.5: Google Places fallback — Naver Geocoding은 도로명/지번에 강하지만
                // 관광지명 ("인사동 문화의 거리", "광화문 광장" 등)에 약함. Naver 모두 실패 시
                // Google Places Text Search로 시도. 키 없으면 skip.
                // Sprint 1 Step 3: Google Places로 좌표 + photo_reference 동시 fetch.
                // 좌표가 이미 있어도 photo는 fetch (시각 강화). 키 없으면 skip.
                if (process.env.GOOGLE_PLACES_API_KEY && (lat === null || !place.photo_ref)) {
                    try {
                        const placeQuery = name + (region ? ` ${region}` : '');
                        const gRes = await axios.get('https://maps.googleapis.com/maps/api/place/textsearch/json', {
                            params: { query: placeQuery, key: process.env.GOOGLE_PLACES_API_KEY, language: 'ko' },
                            timeout: 4000,
                        });
                        const first = gRes.data?.results?.[0];
                        if (first?.geometry?.location && lat === null) {
                            lat = first.geometry.location.lat;
                            lng = first.geometry.location.lng;
                            console.log(`  ✓ [${name}] Google Places geocoded: ${lat},${lng}`);
                        }
                        if (first?.photos?.[0]?.photo_reference && !place.photo_ref) {
                            place.photo_ref = first.photos[0].photo_reference;
                        }
                    } catch (gErr) {
                        console.warn(`  - [${name}] Google Places call failed: ${gErr.message}`);
                    }
                }
                place.lat = lat;
                place.lng = lng;
                place._geocoded = lat !== null;
                const nameKo = place.name || place.name_ko || place.display_name || place.name_en || name;
                place.naverMapUrl = `https://map.naver.com/v5/search/${encodeURIComponent(nameKo)}`;
            }

            // ════════════════════════════════════════════════════════
            // Phase 2: ODsay + Naver 경로 병렬 호출
            // ════════════════════════════════════════════════════════
            const transitPromises = [];
            for (let i = 1; i < places.length; i++) {
                const prev = places[i - 1];
                const curr = places[i];
                if (prev.lat && prev.lng && curr.lat && curr.lng) {
                    transitPromises.push(
                        this._getTransitData(prev, curr, clientId, clientSecret, i, dayOfWeek)
                    );
                } else {
                    transitPromises.push(Promise.resolve({
                        index: i,
                        durationMin: 25,
                        distanceKm: 5.0,
                        publicTransit: null,
                        drivingMin: null,
                    }));
                }
            }

            const transitResults = await Promise.all(transitPromises);

            // ════════════════════════════════════════════════════════
            // Phase 3: Dynamic Time Stitching — 서버가 시간 계산
            // ════════════════════════════════════════════════════════
            // 첫 장소의 start_time은 Gemini 값 유지 (또는 09:00 디폴트)
            let currentTime = this._parseTime(places[0]?.start_time || "09:00");
            const BUFFER_MIN = 5; // 초행길 여유 시간

            // ════════════════════════════════════════════════════════
            // Phase 2.5: 호텔 → 첫 번째 장소 경로 (hotelLat/hotelLng는 trip-level에서 이미 지오코딩됨)
            // ════════════════════════════════════════════════════════
            let hotelTransit = null;
            if (hotelLat && hotelLng && places.length > 0 && places[0].lat && places[0].lng) {
                try {
                    const hotelPlace = { lat: hotelLat, lng: hotelLng, name: 'Hotel', display_name: 'Hotel' };
                    const transitData = await this._getTransitData(hotelPlace, places[0], clientId, clientSecret, 0, dayOfWeek);
                    const pt = transitData.publicTransit;
                    hotelTransit = {
                        method: pt?.method || 'subway',
                        instruction: pt?.summary || `Take public transit from hotel to ${places[0].name || places[0].display_name || 'first stop'}`,
                        step_by_step: (pt?.steps || []).map(s => s.description || s.instruction || ''),
                        steps_detail: pt?.steps || [],
                        est_min: pt?.duration || transitData.durationMin || 25,
                        est_fare_krw: pt?.fare || 0,
                        source: 'odsay',
                        from_label: 'Hotel',
                    };
                    console.log(`  - [Hotel→${places[0].name}] ${hotelTransit.est_min}min via ${hotelTransit.method}`);
                } catch (hotelErr) {
                    console.warn('  - Hotel→FirstStop route failed:', hotelErr.message);
                }
            }
            // day-level mirror — UI 의 LodgingBookend 컴포넌트가 day.lodging_to_first 로 직접 접근
            if (hotelTransit) {
                dayPlan.lodging_to_first = hotelTransit;
            }

            // ════════════════════════════════════════════════════════
            // Phase 2.6 (2026-05-08 신규): 마지막 장소 → 숙소 복귀 경로
            // ════════════════════════════════════════════════════════
            // 사용자 신고: "Day 마지막에 숙소 복귀 경로 안 나옴 → 저녁 식사 후 어디로?"
            // 호텔/zone anchor 좌표가 있고, 마지막 stop 이 호텔과 다른 곳이면 ODsay 로 계산.
            if (hotelLat && hotelLng && places.length > 0) {
                const lastPlace = places[places.length - 1];
                if (lastPlace.lat && lastPlace.lng) {
                    // 호텔과 같은 좌표(50m 이내) 이면 의미 없음 — skip
                    const sameAsHotel = Math.abs(lastPlace.lat - hotelLat) < 0.0005
                        && Math.abs(lastPlace.lng - hotelLng) < 0.0005;
                    if (!sameAsHotel) {
                        try {
                            const hotelPlace = { lat: hotelLat, lng: hotelLng, name: 'Hotel', display_name: 'Hotel' };
                            const lastTransit = await this._getTransitData(lastPlace, hotelPlace, clientId, clientSecret, 999, dayOfWeek);
                            const pt = lastTransit.publicTransit;
                            const returnTransit = {
                                method: pt?.method || 'subway',
                                instruction: pt?.summary || `Return to hotel from ${lastPlace.name || lastPlace.display_name || 'last stop'}`,
                                step_by_step: (pt?.steps || []).map(s => s.description || s.instruction || ''),
                                steps_detail: pt?.steps || [],
                                est_min: pt?.duration || lastTransit.durationMin || 25,
                                est_fare_krw: pt?.fare || 0,
                                source: 'odsay',
                                from_label: lastPlace.display_name || lastPlace.name || 'last stop',
                                to_label: 'Hotel',
                                _isLodgingReturn: true,
                            };
                            dayPlan.last_to_lodging = returnTransit;
                            console.log(`  - [${lastPlace.name}→Hotel] ${returnTransit.est_min}min via ${returnTransit.method} (return)`);
                        } catch (retErr) {
                            console.warn('  - LastStop→Hotel route failed:', retErr.message);
                        }
                    }
                }
            }

            for (let i = 0; i < places.length; i++) {
                const place = places[i];

                // 첫 장소: 호텔 경로 있으면 사용, 없으면 null
                if (i === 0) {
                    place.start_time = this._formatTime(currentTime);
                    place.transit_from_prev = hotelTransit;
                    place.travelFromPrev = null;
                } else {
                    const transit = transitResults[i - 1];
                    // 2026-04-27 사용자 신고: 모든 transit이 "car · 25분"으로 동일 →
                    // root cause = prev/curr 좌표 없을 때 blind 25 fallback.
                    // 개선: 좌표 없을 때 Gemini가 plan에 넣은 est_min 우선 사용.
                    // Gemini는 보통 거리감 기반 예상치를 제공 (예: 명동→홍대 30분).
                    const geminiOriginal = places[i].transit_from_prev || {};
                    const realTransitMin = transit.publicTransit?.duration
                        || transit.drivingMin
                        || transit.durationMin  // havCarMin if coords exist
                        || geminiOriginal.est_min  // Gemini plan estimate
                        || 25;
                    // Diagnostic: log when fall through to last fallback (좌표 + Gemini 모두 없음)
                    if (!transit.publicTransit?.duration && !transit.drivingMin && !transit.durationMin && !geminiOriginal.est_min) {
                        console.warn(`  ⚠ [transit ${i}] no coords + no Gemini est_min → using flat 25min fallback. Check NAVER_CLIENT_ID / Gemini prompt.`);
                    }

                    // 이전 장소 체류 후 이동 시간 + 버퍼
                    const prevStayMin = places[i - 1].stay_min || 60;
                    currentTime += prevStayMin + realTransitMin + BUFFER_MIN;

                    place.start_time = this._formatTime(currentTime);

                    // ── 통합 transit_from_prev (ODsay 우선, Gemini fallback) ──
                    const pt = transit.publicTransit;
                    if (pt && pt.method !== 'walk') {
                        // ODsay 실제 데이터로 transit_from_prev 교체.
                        // steps_detail은 ODsay raw steps로 UI가 호선/출구/배차/중간정거장
                        // 렌더링에 쓴다. step_by_step(텍스트 배열)은 PDF/이메일 호환용.
                        place.transit_from_prev = {
                            method: pt.method || 'subway',
                            instruction_en: pt.summary || '',
                            step_by_step: (pt.steps || []).map(s => s.description),
                            steps_detail: pt.steps || [],
                            transfers: pt.transfers || 0,
                            total_walk_m: pt.totalWalk || 0,
                            first_station: pt.firstStation || null,
                            last_station: pt.lastStation || null,
                            est_min: pt.duration || realTransitMin,
                            est_fare_krw: pt.fare || 0,
                            source: 'odsay',
                        };
                    } else if (pt && pt.method === 'walk') {
                        place.transit_from_prev = {
                            method: 'walk',
                            instruction_en: pt.summary || `Walk ${realTransitMin} min`,
                            step_by_step: [],
                            est_min: pt.duration || realTransitMin,
                            est_fare_krw: 0,
                            source: 'odsay',
                        };
                    } else {
                        // ODsay 실패 → Gemini 원본 유지하되 시간은 Naver 기준 보정
                        const geminiTransit = place.transit_from_prev || {};
                        place.transit_from_prev = {
                            method: geminiTransit.method || 'car',
                            instruction_en: geminiTransit.instruction_en || '',
                            step_by_step: geminiTransit.step_by_step || [],
                            est_min: transit.drivingMin || geminiTransit.est_min || realTransitMin,
                            est_fare_krw: geminiTransit.est_fare_krw || 0,
                            source: 'naver_fallback',
                        };
                    }

                    // ── travelFromPrev (상세 옵션) ──
                    place.travelFromPrev = {
                        durationMin: transit.durationMin,
                        distanceKm: transit.distanceKm,
                        naverDirectionsUrl: place.naverMapUrl,
                        transitOptions: {
                            taxi: {
                                estimatedFare: (transit.drivingMin || transit.durationMin || 25) * 200 + 4800,
                                disclaimer: "추정 요금",
                            },
                            cocotrip: { available: true, productType: charterProductType },
                            ...(pt && pt.method !== 'walk' ? { publicTransit: pt } : {}),
                        },
                    };
                }

                // 좌표 없는 경우 기본값
                if (place.lat === null && i > 0) {
                    place.travelFromPrev = {
                        durationMin: 25,
                        distanceKm: 5.0,
                        naverDirectionsUrl: place.naverMapUrl,
                        transitOptions: {
                            cocotrip: { available: true, productType: charterProductType },
                        },
                    };
                }
            }

            console.log(`  [Route] Day ${dayPlan.day || '?'}: ${places.length} stops, time-stitched ${this._formatTime(this._parseTime(places[0]?.start_time || "09:00"))} ~ ${places[places.length - 1]?.start_time || '?'}`);
        }

        // Layer 4: Enforce transit completeness invariant
        this._enforceTransitCompleteness(data);

        const finalJsonStr = JSON.stringify(data, null, 2);
        console.log("  [Route] enrichment complete (Naver + ODsay + Time Stitch + Completeness Gate)");
        return {
            agentName: this.agentKey,
            systemPrompt: this.systemPrompt,
            userPrompt: userPrompt,
            rawOutput: finalJsonStr,
            thinkingSummary: "[route] Naver Maps + ODsay Transit + Dynamic Time Stitching complete",
            inputTokens: 0,
            outputTokens: 0,
        };
    }

    /**
     * 단일 구간의 경로 데이터를 병렬로 가져오기 (Naver Driving + ODsay Transit)
     */
    async _getTransitData(prev, curr, clientId, clientSecret, index, dayOfWeek) {
        // Haversine baseline — used to (a) prefer walking for <1.5km legs, and
        // (b) replace the legacy 25min/5km blind fallback when both APIs fail
        // but coordinates are known. Pedestrian pace 70m/min (~4.2km/h).
        const havKm = (prev?.lat != null && prev?.lng != null && curr?.lat != null && curr?.lng != null)
            ? this._haversineKm(prev.lat, prev.lng, curr.lat, curr.lng)
            : null;
        const havWalkMin = havKm != null ? Math.max(3, Math.round(havKm * 1000 / 70)) : null;
        // Coarse car estimate from straight-line distance: assume ~25km/h average
        // in dense urban areas (covers traffic + signals). Only used when no
        // routing API answers — better than a flat 25min.
        const havCarMin = havKm != null ? Math.max(5, Math.round((havKm / 25) * 60)) : null;
        let durationMin = havCarMin != null ? havCarMin : 25;
        let distanceKm = havKm != null ? Math.round(havKm * 10) / 10 : 5.0;
        let drivingMin = null;
        let publicTransit = null;
        const name = curr.display_name || curr.name || curr.name_en || curr.name_ko || `stop-${index}`;
        const fromName = prev?.display_name || prev?.name || prev?.name_en || prev?.name_ko || 'previous stop';

        // Naver Driving + ODsay Transit 병렬 호출
        const [naverResult, odsayResult] = await Promise.allSettled([
            // Naver Driving
            (clientId && clientSecret) ? axios.get("https://maps.apigw.ntruss.com/map-direction/v1/driving", {
                params: {
                    start: `${prev.lng},${prev.lat}`,
                    goal: `${curr.lng},${curr.lat}`,
                    option: "traoptimal",
                },
                headers: {
                    "X-NCP-APIGW-API-KEY-ID": clientId,
                    "X-NCP-APIGW-API-KEY": clientSecret,
                },
                timeout: 5000,
            }) : Promise.reject(new Error('no credentials')),
            // ODsay Transit (Layer 3: retry with 500ms backoff, 10s timeout)
            this._searchOdsayWithRetry(prev.lng, prev.lat, curr.lng, curr.lat),
        ]);

        // Naver 결과 처리
        if (naverResult.status === 'fulfilled' && naverResult.value?.data?.code === 0) {
            const summary = naverResult.value.data.route.traoptimal[0].summary;
            durationMin = Math.floor(summary.duration / 60000);
            distanceKm = Math.round((summary.distance / 1000) * 10) / 10;
            drivingMin = durationMin;
        }

        // ODsay 결과 처리
        if (odsayResult.status === 'fulfilled' && odsayResult.value) {
            publicTransit = formatTransitSummary(odsayResult.value);
            console.log(`  ✓ [${name}] ODsay: ${odsayResult.value.type} ${odsayResult.value.totalTime}min ₩${odsayResult.value.fare}`);

            // Enrich each subway step with station metadata (transfer lines,
            // accessibility, lost&found) + first/last train times. All
            // parallelised; caches prevent duplicate calls across segments
            // that touch the same station.
            if (publicTransit?.steps?.length) {
                const enrichments = publicTransit.steps.map(async (step) => {
                    if (step.mode !== 'subway') return;
                    const calls = [
                        getSubwayStationInfo(step.fromStationID, this._stationCache),
                        getSubwayStationInfo(step.toStationID, this._stationCache),
                    ];
                    // Timetable needs weekday — only run if we have a valid day
                    if (dayOfWeek !== null && dayOfWeek !== undefined) {
                        calls.push(getSubwayTimetable(step.fromStationID, dayOfWeek, this._timetableCache));
                    }
                    const [fromInfo, toInfo, fromTimetable] = await Promise.all(calls);
                    if (fromInfo) step.fromStationInfo = fromInfo;
                    if (toInfo) step.toStationInfo = toInfo;
                    if (fromTimetable) step.fromTimetable = fromTimetable;
                });
                await Promise.all(enrichments);
            }
        } else {
            const reason = odsayResult.status === 'rejected' ? odsayResult.reason?.message : 'null result';
            console.warn(`  - [${name}] ODsay unavailable: ${reason}`);
        }

        // Walk-first override for short legs: if straight-line distance is
        // under 1.5km, walking is almost always faster door-to-door than
        // taxi/transit (waiting + boarding + alighting). Replaces the
        // "북촌→인사동 차로 25분" symptom where ODsay returned a transit
        // option for what is really a 12-min walk.
        const SHORT_LEG_KM = 1.5;
        if (havKm != null && havKm < SHORT_LEG_KM) {
            const walkM = Math.round(havKm * 1000);
            const walkMin = havWalkMin || Math.max(3, Math.round(walkM / 70));
            // Only override when ODsay didn't already say "walk".
            if (!publicTransit || publicTransit.method !== 'walk') {
                publicTransit = {
                    method: 'walk',
                    duration: walkMin,
                    summary: `Walk ${walkMin}min (${walkM}m)`,
                    steps: [
                        { mode: 'walk', duration: walkMin, distance: walkM, from: fromName, to: name }
                    ],
                    fare: 0,
                    transfers: 0,
                    totalWalk: walkM,
                };
                console.log(`  ↪ [${fromName}→${name}] short leg ${havKm.toFixed(2)}km → walk ${walkMin}min`);
            }
            durationMin = walkMin;
            drivingMin = walkMin;
        }

        return { index, durationMin, distanceKm, drivingMin, publicTransit };
    }

    /**
     * Great-circle distance in km between two lat/lng points.
     * Used as a baseline so we never claim a flat 25min for adjacent stops.
     */
    _haversineKm(lat1, lng1, lat2, lng2) {
        const R = 6371;
        const toRad = (x) => (x * Math.PI) / 180;
        const dLat = toRad(lat2 - lat1);
        const dLng = toRad(lng2 - lng1);
        const a = Math.sin(dLat / 2) ** 2
            + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
        return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    }

    /**
     * Layer 3: ODsay search with 500ms backoff retry (max 2 attempts)
     */
    async _searchOdsayWithRetry(sx, sy, ex, ey) {
        for (let attempt = 0; attempt < 2; attempt++) {
            try {
                const result = await searchTransitRoute(sx, sy, ex, ey);
                return result;
            } catch (e) {
                if (attempt === 0) {
                    console.warn(`  - [ODsay] attempt 1 failed, retrying in 500ms: ${e.message}`);
                    await new Promise(r => setTimeout(r, 500));
                } else {
                    console.warn(`  - [ODsay] attempt 2 failed, giving up: ${e.message}`);
                    return null;
                }
            }
        }
        return null;
    }

    /**
     * Layer 4: Enforce transit completeness invariant.
     * subway/bus without step_by_step -> downgrade to car.
     */
    _enforceTransitCompleteness(data) {
        const days = (data.itinerary && data.itinerary.days) || data.days || [];
        let downgradeCount = 0;
        for (const day of days) {
            for (const stop of (day.stops || [])) {
                const t = stop.transit_from_prev;
                if (!t) continue;
                const needsDetail = t.method === 'subway' || t.method === 'bus';
                const hasDetail = Array.isArray(t.step_by_step)
                    && t.step_by_step.length > 0
                    && (t.instruction || t.instruction_en);
                if (needsDetail && !hasDetail) {
                    t._downgraded_from = t.method;
                    t.method = 'car';
                    t.source = 'downgrade';
                    downgradeCount++;
                }
            }
        }
        if (downgradeCount > 0) {
            console.log(`  [Route] enforceTransitCompleteness: downgraded ${downgradeCount} transit(s)`);
        }
    }

    /**
     * Normalize Gemini's "ICN T1" / "ICN T2" / "GMP" form to constants key.
     * Returns null if unrecognized so callers can skip routing.
     */
    _normalizeAirportKey(raw) {
        if (!raw) return null;
        const k = String(raw).trim().toUpperCase().replace(/\s+/g, '_');
        if (AIRPORT_COORDS[k]) return k;
        if (k.startsWith('ICN_T1') || k === 'ICN1' || k === 'INCHEON_T1') return 'ICN_T1';
        if (k.startsWith('ICN_T2') || k === 'ICN2' || k === 'INCHEON_T2') return 'ICN_T2';
        if (k.startsWith('ICN') || k === 'INCHEON') return 'ICN_T1';
        if (k === 'GIMPO') return 'GMP';
        if (k === 'BUSAN' || k === 'GIMHAE') return 'PUS';
        if (k === 'JEJU') return 'CJU';
        return null;
    }

    /**
     * Resolve hotel-side coordinate for hotel↔airport routing with fallback chain.
     * Order (B9-16/25 강화):
     *   1. hotelLat/hotelLng (already geocoded from hotel_address)
     *   2. lookupZoneCoord(recommended_zone) — 정적 좌표 매핑 (Naver 호출 X)
     *   3. lookupZoneCoord(hotelAddress) — substring 매핑 ("명동 롯데호텔" → 명동)
     *   4. arrival_guide.address geocode (Gemini's per-stop transport address)
     *   5. recommended_zone string Naver geocode (fallback for unmapped zones)
     *   6. CITY_CENTER_COORDS[region] — last resort, "도시 중심 기준"
     * Returns { coord, source, label } where source indicates which fallback was used.
     */
    async _resolveHotelOrFallback({ hotelLat, hotelLng, hotelAddress, arrivalGuide, recommendedZone, region, clientId, clientSecret }) {
        // 1) primary
        if (hotelLat && hotelLng) {
            return { coord: { lat: hotelLat, lng: hotelLng }, source: 'hotel', label: hotelAddress || null };
        }
        // 2/3) 정적 zone 좌표 매핑 — Naver 호출 전 첫 시도. NCP 키 fail 또는 단일 동
        // 명("명동")인 경우의 1차 보호. 좌표 정확도 ±100m, fail 가능성 0.
        if (recommendedZone) {
            const z = lookupZoneCoord(recommendedZone);
            if (z) return { coord: { lat: z.lat, lng: z.lng }, source: 'zone_anchor', label: z.label };
        }
        if (hotelAddress) {
            const z = lookupZoneCoord(hotelAddress);
            if (z) return { coord: { lat: z.lat, lng: z.lng }, source: 'zone_anchor', label: z.label };
        }
        const tryGeocode = async (q) => {
            if (!q || !clientId || !clientSecret) return null;
            try {
                const res = await axios.get('https://maps.apigw.ntruss.com/map-geocode/v2/geocode', {
                    params: { query: q },
                    headers: { 'X-NCP-APIGW-API-KEY-ID': clientId, 'X-NCP-APIGW-API-KEY': clientSecret },
                    timeout: 5000,
                });
                if (res.status === 200 && res.data.addresses?.length > 0) {
                    return { lat: parseFloat(res.data.addresses[0].y), lng: parseFloat(res.data.addresses[0].x) };
                }
            } catch (e) {
                console.warn(`  - fallback geocode "${q}" failed: ${e.message}`);
            }
            return null;
        };
        // 4) arrival_guide address (Gemini가 가끔 to_hotel 안내에 호텔 주소를 적어둠)
        const arrivalGuideAddr = arrivalGuide?.address || arrivalGuide?.hotel_address;
        if (arrivalGuideAddr) {
            const c = await tryGeocode(arrivalGuideAddr);
            if (c) return { coord: c, source: 'arrival_guide', label: arrivalGuideAddr };
        }
        // 5) recommended_zone (string key like 'myeongdong' or address — geocode 시도)
        if (recommendedZone) {
            const c = await tryGeocode(String(recommendedZone));
            if (c) return { coord: c, source: 'zone_anchor', label: String(recommendedZone) };
        }
        // 6) city center — last resort. 운영자 신고: 시청→노량진 우회 → 표시 부정확.
        const regionKey = String(region || '').toLowerCase().trim();
        const cc = CITY_CENTER_COORDS[regionKey];
        if (cc) {
            console.warn(`  ⚠ [_resolveHotelOrFallback] city_center fallback → "${cc.label}". hotelAddress="${hotelAddress || ''}" zone="${recommendedZone || ''}". Naver Geocoding 또는 zone 매핑 실패 — 운영자 검토 필요.`);
            return { coord: { lat: cc.lat, lng: cc.lng }, source: 'city_center', label: cc.label };
        }
        return { coord: null, source: 'none', label: null };
    }

    /**
     * ODsay route between airport coord and hotel coord.
     * Returns the same TransitFromPrev shape used by stop↔stop transit so the UI
     * can reuse the existing TransitArrow component without a special case.
     * Direction: 'arrival' (airport→hotel) or 'departure' (hotel→airport).
     *
     * Retry policy: 1 retry with 1s backoff on transient failure (network/timeout/5xx).
     * `_searchOdsayWithRetry` inside `_getTransitData` already does its own 500ms
     * retry, so this outer retry covers cases where _getTransitData itself throws
     * (e.g. axios network error before any ODsay call).
     */
    async _routeAirportHotel(from, to, direction) {
        const fromPlace = { lat: from.lat, lng: from.lng, name: direction === 'arrival' ? 'Airport' : 'Hotel' };
        const toPlace = { lat: to.lat, lng: to.lng, name: direction === 'arrival' ? 'Hotel' : 'Airport' };
        const cid = (process.env.NAVER_CLIENT_ID || '').trim();
        const csec = (process.env.NAVER_CLIENT_SECRET || '').trim();
        const MAX_ATTEMPTS = 2; // 1 try + 1 retry
        let lastErr = null;
        for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
            try {
                const td = await this._getTransitData(fromPlace, toPlace, cid, csec, 0);
                const pt = td.publicTransit;
                if (!pt) {
                    // No transit → 다음 attempt에서 같은 결과일 가능성 높지만,
                    // _getTransitData가 호출 중 transient 실패 시 null로 fallthrough할
                    // 수도 있어서 한 번 더 시도해본다.
                    if (attempt + 1 < MAX_ATTEMPTS) {
                        console.warn(`  - Airport↔Hotel (${direction}) attempt ${attempt + 1}: no publicTransit, retrying in 1s`);
                        await new Promise(r => setTimeout(r, 1000));
                        continue;
                    }
                    return null;
                }
                return {
                    method: pt.method || 'subway',
                    instruction: pt.summary || '',
                    step_by_step: (pt.steps || []).map(s => s.description || s.instruction || ''),
                    steps_detail: pt.steps || [],
                    transfers: pt.transfers || 0,
                    total_walk_m: pt.totalWalk || 0,
                    est_min: pt.duration || td.durationMin || 0,
                    est_fare_krw: pt.fare || 0,
                    source: 'odsay',
                    direction,
                };
            } catch (e) {
                lastErr = e;
                console.warn(`  - Airport↔Hotel (${direction}) attempt ${attempt + 1} failed: ${e.message}`);
                if (attempt + 1 < MAX_ATTEMPTS) {
                    await new Promise(r => setTimeout(r, 1000));
                }
            }
        }
        if (lastErr) {
            await reportError(lastErr, { route: 'RouteAgent._routeAirportHotel', direction });
        }
        return null;
    }

    /** "HH:MM" → 분(number) */
    _parseTime(timeStr) {
        const [h, m] = (timeStr || "09:00").split(":").map(Number);
        return (h || 0) * 60 + (m || 0);
    }

    /** 분(number) → "HH:MM" */
    _formatTime(totalMin) {
        const h = Math.floor(totalMin / 60) % 24;
        const m = totalMin % 60;
        return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
    }
}
