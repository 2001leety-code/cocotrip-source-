import { BaseAgent } from "./BaseAgent.js";
export class QAAgent extends BaseAgent {
    constructor(apiKey) {
        super(apiKey, "qa");
    }
    async call(userPrompt) {
        console.log("\n[QA] Budget calculation and data validation...");
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
            console.warn(`  [QA] JSON parse failed (${e.message}), falling back to LLM`);
            return super.call(userPrompt);
        }
        const errors = [];
        const warnings = [];
        let totalPlaces = 0;
        let transportCost = 0;
        let mealsCost = 0;
        const itinerary = data.itinerary || [];
        const totalDays = itinerary.length;
        for (const day of itinerary) {
            const places = day.places || [];
            totalPlaces += places.length;
            if (places.length > 3) {
                errors.push(`Day ${day.day || '?'}: 추천 명소가 3곳을 초과하여 고객 피로도가 우려됩니다.`);
            }
            let dayTotalMin = 0;
            for (const p of places) {
                dayTotalMin += parseInt(p.stayDuration || "0", 10);
                const travel = p.travelFromPrev;
                if (travel && travel.durationMin) {
                    dayTotalMin += parseInt(travel.durationMin, 10);
                }
                if (!p.lat || !p.naverMapUrl) {
                    errors.push(`Day ${day.day || '?'} ${p.name || ''}: 위치 좌표 누락 (Critical)`);
                }
            }
            // 식사/휴식시간 평균 2시간(120분) 추가
            const totalDayTimeMin = dayTotalMin + 120;
            let dailyCost = 330000;
            // 8시간(480분) 초과시 시간당 33,000원 산정
            if (totalDayTimeMin > 480) {
                const overtimeHours = Math.ceil((totalDayTimeMin - 480) / 60);
                dailyCost += (overtimeHours * 33000);
                warnings.push(`Day ${day.day || '?'}: 예상 투어 시간이 ${totalDayTimeMin}분으로 8시간을 초과하여 초과요금이 적용되었습니다.`);
            }
            transportCost += dailyCost;
            mealsCost += 150000;
        }
        const activitiesCost = 50000 * totalPlaces;
        data.meta = {
            generatedAt: new Date().toISOString(),
            version: "1.0",
            language: "en",
            totalDays,
            totalPlaces,
            estimatedBudget: {
                transportation: transportCost,
                meals: mealsCost,
                activities: activitiesCost,
                total: transportCost + mealsCost + activitiesCost,
                currency: "KRW"
            },
            cocoTripRecommendation: {
                vehicleType: "staria",
                productType: "charter_seoul_city",
                priceKRW: transportCost,
                bookingUrl: "https://cocotripkr.com/charter"
            }
        };
        data.qaSummary = {
            passed: errors.length === 0,
            errors,
            warnings,
            checkedAt: new Date().toISOString()
        };
        const finalStr = JSON.stringify(data, null, 2);
        console.log(`  [QA] Budget: staria total ${transportCost} KRW`);
        return {
            agentName: this.agentKey,
            systemPrompt: "",
            userPrompt: "",
            rawOutput: finalStr,
            thinkingSummary: "[qa] budget calculation and validation complete",
            inputTokens: 0,
            outputTokens: 0
        };
    }
}
