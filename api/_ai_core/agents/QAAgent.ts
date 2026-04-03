import { BaseAgent } from "./BaseAgent.js";
import { AgentResult } from "../models.js";

export class QAAgent extends BaseAgent {
  constructor(apiKey: string) {
    super(apiKey, "qa");
  }

  async call(userPrompt: string): Promise<AgentResult> {
    console.log("\n[검수팀] 최종 예산 팩트체크 및 데이터 정합성 검수를 진행합니다...");
    
    let jsonStr = userPrompt;
    const matchBlock = userPrompt.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
    if (matchBlock) {
      jsonStr = matchBlock[1];
    } else {
      const matchBrace = userPrompt.match(/(\{[\s\S]*\})/);
      if (matchBrace) {
        jsonStr = matchBrace[1];
      }
    }

    let data;
    try {
      data = JSON.parse(jsonStr);
    } catch (e: any) {
      console.warn(`  [경고] 이전 단계 출력 파싱 불가(${e.message}). LLM에 넘깁니다.`);
      return super.call(userPrompt);
    }

    const errors: string[] = [];
    const warnings: string[] = [];
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
    console.log(`  - 예산 산출 완료: 스타리아 전세 총 ${transportCost}원`);
    
    return {
      agentName: this.agentKey,
      systemPrompt: "",
      userPrompt: "",
      rawOutput: `\`\`\`json\n${finalStr}\n\`\`\``,
      thinkingSummary: "TypeScript로 정밀 예산 산출 및 정합성 검증 완료",
      inputTokens: 0,
      outputTokens: 0
    };
  }
}
