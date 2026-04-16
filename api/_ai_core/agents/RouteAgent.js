import axios from "axios";
import { BaseAgent } from "./BaseAgent.js";
import { searchTransitRoute, formatTransitSummary } from "../../_odsay_helper.js";

export class RouteAgent extends BaseAgent {
    constructor(apiKey) {
        super(apiKey, "route");
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
        const daysList = Array.isArray(rawItinerary) ? rawItinerary : (rawItinerary.days || []);

        for (const dayPlan of daysList) {
            const places = dayPlan.stops || dayPlan.places || [];

            // ════════════════════════════════════════════════════════
            // Phase 1: 모든 장소의 좌표 확보 (Naver Geocoding)
            // ════════════════════════════════════════════════════════
            for (const place of places) {
                const address = place.address || "";
                const name = place.name || place.name_ko || place.display_name || place.name_en || "";
                let lat = null;
                let lng = null;
                if (clientId && clientSecret && address) {
                    try {
                        const geoUrl = "https://maps.apigw.ntruss.com/map-geocode/v2/geocode";
                        const res = await axios.get(geoUrl, {
                            params: { query: address },
                            headers: {
                                "X-NCP-APIGW-API-KEY-ID": clientId,
                                "X-NCP-APIGW-API-KEY": clientSecret,
                            },
                            timeout: 5000,
                        });
                        if (res.status === 200 && res.data.addresses?.length > 0) {
                            lng = parseFloat(res.data.addresses[0].x);
                            lat = parseFloat(res.data.addresses[0].y);
                        }
                    }
                    catch (e) {
                        console.error(`  - [${name}] 좌표 변환 실패: ${e.message}`);
                    }
                }
                place.lat = lat;
                place.lng = lng;
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
                        this._getTransitData(prev, curr, clientId, clientSecret, i)
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

            for (let i = 0; i < places.length; i++) {
                const place = places[i];

                // 첫 장소: Gemini 시간 유지, 이후: 동적 계산
                if (i === 0) {
                    place.start_time = this._formatTime(currentTime);
                    place.transit_from_prev = null;
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
                        // ODsay 실제 데이터로 transit_from_prev 교체
                        place.transit_from_prev = {
                            method: pt.method || 'subway',
                            instruction_en: pt.summary || '',
                            step_by_step: (pt.steps || []).map(s => s.description),
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
                            cocotrip: { available: true, productType: "charter_seoul_city" },
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
                            cocotrip: { available: true, productType: "charter_seoul_city" },
                        },
                    };
                }
            }

            console.log(`  [Route] Day ${dayPlan.day || '?'}: ${places.length} stops, time-stitched ${this._formatTime(this._parseTime(places[0]?.start_time || "09:00"))} ~ ${places[places.length - 1]?.start_time || '?'}`);
        }

        const finalJsonStr = JSON.stringify(data, null, 2);
        console.log("  [Route] enrichment complete (Naver + ODsay + Time Stitch)");
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
    async _getTransitData(prev, curr, clientId, clientSecret, index) {
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
            // ODsay Transit
            searchTransitRoute(prev.lng, prev.lat, curr.lng, curr.lat),
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
        } else {
            const reason = odsayResult.status === 'rejected' ? odsayResult.reason?.message : 'null result';
            console.warn(`  - [${name}] ODsay unavailable: ${reason}`);
        }

        return { index, durationMin, distanceKm, drivingMin, publicTransit };
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
