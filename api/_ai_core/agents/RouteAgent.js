import axios from "axios";
import { BaseAgent } from "./BaseAgent.js";
export class RouteAgent extends BaseAgent {
    constructor(apiKey) {
        super(apiKey, "route");
    }
    async call(userPrompt) {
        console.log("\n[Route] Naver Maps API enrichment...");
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
        const clientId = process.env.NAVER_CLIENT_ID || "";
        const clientSecret = process.env.NAVER_CLIENT_SECRET || "";
        const itinerary = data.itinerary || [];
        for (const dayPlan of itinerary) {
            const places = dayPlan.places || [];
            let prevLat = null;
            let prevLng = null;
            for (const place of places) {
                const address = place.address || "";
                const name = place.name || "";
                let lat = null;
                let lng = null;
                if (clientId && clientSecret && address) {
                    try {
                        const geoUrl = "https://naveropenapi.apigw.ntruss.com/map-geocode/v2/geocode";
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
                if (!place.naverMapUrl) {
                    place.naverMapUrl = `https://map.naver.com/v5/search/${encodeURIComponent(name)}`;
                }
                if (prevLat !== null && prevLng !== null && lat !== null && lng !== null) {
                    let durationMin = null;
                    let distanceKm = null;
                    if (clientId && clientSecret) {
                        try {
                            const dirUrl = "https://naveropenapi.apigw.ntruss.com/map-direction/v1/driving";
                            const res = await axios.get(dirUrl, {
                                params: {
                                    start: `${prevLng},${prevLat}`,
                                    goal: `${lng},${lat}`,
                                    option: "traoptimal",
                                },
                                headers: {
                                    "X-NCP-APIGW-API-KEY-ID": clientId,
                                    "X-NCP-APIGW-API-KEY": clientSecret,
                                },
                                timeout: 5000,
                            });
                            if (res.status === 200 && res.data.code === 0) {
                                const summary = res.data.route.traoptimal[0].summary;
                                durationMin = Math.floor(summary.duration / 60000);
                                distanceKm = Math.round((summary.distance / 1000) * 10) / 10;
                            }
                        }
                        catch (e) {
                            console.error(`  - 경로 계산 실패: ${e.message}`);
                        }
                    }
                    if (durationMin === null) {
                        durationMin = 25;
                        distanceKm = 5.0;
                    }
                    place.travelFromPrev = {
                        durationMin,
                        distanceKm,
                        naverDirectionsUrl: place.naverMapUrl,
                        transitOptions: {
                            taxi: { estimatedFare: durationMin * 200 + 4800, disclaimer: "추정 요금" },
                            cocotrip: { available: true, productType: "charter_seoul_city" },
                        },
                    };
                }
                else {
                    place.travelFromPrev = null;
                }
                if (lat === null) {
                    place.travelFromPrev = {
                        durationMin: 25,
                        distanceKm: 5.0,
                        naverDirectionsUrl: place.naverMapUrl,
                        transitOptions: {
                            cocotrip: { available: true, productType: "charter_seoul_city" },
                        },
                    };
                }
                prevLat = lat;
                prevLng = lng;
            }
        }
        const finalJsonStr = JSON.stringify(data, null, 2);
        console.log("  [Route] enrichment complete");
        return {
            agentName: this.agentKey,
            systemPrompt: this.systemPrompt,
            userPrompt: userPrompt,
            rawOutput: finalJsonStr,
            thinkingSummary: "[route] Naver Maps API enrichment complete",
            inputTokens: 0,
            outputTokens: 0,
        };
    }
}
