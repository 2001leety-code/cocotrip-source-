import axios from "axios";
import { BaseAgent } from "./BaseAgent.js";
import { searchTransitRoute, formatTransitSummary, getSubwayStationInfo, getSubwayTimetable } from "../../_odsay_helper.js";
import { AIRPORT_COORDS } from "../constants.js";

// Klook/Trip.com pattern: pick the recommended option based on context.
//   - Late-night arrival → AREX last train ends ~23:42, recommend limousine bus
//   - Heavy luggage (3+ large) → recommend taxi (no transit transfers with bags)
//   - Otherwise → AREX express is fastest/cheapest for ICN
function pickRecommendedTransport({ arrivalTimeHHMM, luggage, paxCount }) {
  const hour = arrivalTimeHHMM ? parseInt(arrivalTimeHHMM.split(':')[0], 10) : null;
  const lateNight = hour !== null && (hour >= 23 || hour < 5);
  const totalLarge = (luggage?.large || 0);
  const heavyLoad = totalLarge >= 3 || (paxCount >= 4 && totalLarge >= 2);
  if (heavyLoad) return { key: 'taxi', reason_ko: '짐이 많아 환승 없는 택시를 추천합니다', reason_en: 'Taxi recommended — too many bags for transit transfers', reason_ja: '荷物が多いため、乗り換えなしのタクシーを推奨します', reason_zh: '行李较多，推荐无需换乘的出租车' };
  if (lateNight) return { key: 'limousine_bus', reason_ko: '늦은 시각 도착 — AREX 막차 후 운행하는 리무진 버스 추천', reason_en: 'Late arrival — AREX has stopped, take limousine bus', reason_ja: '深夜到着 — AREXの終電後はリムジンバスを推奨', reason_zh: '深夜到达 — AREX末班车已结束，推荐机场巴士' };
  return { key: 'arex_express', reason_ko: '가장 빠르고 저렴한 표준 옵션', reason_en: 'Fastest and cheapest standard option', reason_ja: '最速かつ最安の標準オプション', reason_zh: '最快最便宜的标准选择' };
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
        let hotelLat = null, hotelLng = null;
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
                }
            } catch (e) {
                console.warn(`  - Hotel geocoding failed: ${e.message}`);
            }
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
                rawItinerary.arrival_guide.route_to_hotel = { ...route, recommended_option: rec };
                console.log(`  - [Airport→Hotel] ${route.est_min}min via ${route.method}, recommended=${rec.key}`);
            }
        }

        if (hotelLat && hotelLng && departureAirportKey && AIRPORT_COORDS[departureAirportKey]) {
            const ap = AIRPORT_COORDS[departureAirportKey];
            const route = await this._routeAirportHotel({ lat: hotelLat, lng: hotelLng }, ap, 'departure');
            if (route && rawItinerary.departure_guide) {
                rawItinerary.departure_guide.route_to_airport = route;
                console.log(`  - [Hotel→Airport] ${route.est_min}min via ${route.method}`);
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
                    const transitData = await this._getTransitData(hotelPlace, places[0], clientId, clientSecret, 0);
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

            for (let i = 0; i < places.length; i++) {
                const place = places[i];

                // 첫 장소: 호텔 경로 있으면 사용, 없으면 null
                if (i === 0) {
                    place.start_time = this._formatTime(currentTime);
                    place.transit_from_prev = hotelTransit;
                    place.travelFromPrev = null;
                } else {
                    const transit = transitResults[i - 1];
                    const realTransitMin = transit.publicTransit?.duration
                        || transit.durationMin
                        || 25;

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
        let durationMin = 25;
        let distanceKm = 5.0;
        let drivingMin = null;
        let publicTransit = null;
        const name = curr.display_name || curr.name || curr.name_en || curr.name_ko || `stop-${index}`;

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

        return { index, durationMin, distanceKm, drivingMin, publicTransit };
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
     * ODsay route between airport coord and hotel coord.
     * Returns the same TransitFromPrev shape used by stop↔stop transit so the UI
     * can reuse the existing TransitArrow component without a special case.
     * Direction: 'arrival' (airport→hotel) or 'departure' (hotel→airport).
     */
    async _routeAirportHotel(from, to, direction) {
        try {
            const fromPlace = { lat: from.lat, lng: from.lng, name: direction === 'arrival' ? 'Airport' : 'Hotel' };
            const toPlace = { lat: to.lat, lng: to.lng, name: direction === 'arrival' ? 'Hotel' : 'Airport' };
            const td = await this._getTransitData(fromPlace, toPlace, (process.env.NAVER_CLIENT_ID || '').trim(), (process.env.NAVER_CLIENT_SECRET || '').trim(), 0);
            const pt = td.publicTransit;
            if (!pt) return null;
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
            console.warn(`  - Airport↔Hotel route (${direction}) failed: ${e.message}`);
            return null;
        }
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
