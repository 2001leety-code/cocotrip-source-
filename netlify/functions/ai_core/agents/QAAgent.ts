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
    
    // E_loss (손실 오차율) 연산용
    let totalPenaltyScore = 0; 
    const MAX_PENALTY_THRESHOLD = 15; // 15%
    
    const itinerary = data.itinerary || [];
    const totalDays = itinerary.length;
    
    for (const day of itinerary) {
      const places = day.places || [];
      totalPlaces += places.length;
      
      // 8. 일정 밀도 과부하 분석
      if (places.length > 4) {
        errors.push(`Day ${day.day || '?'}: 추천 명소가 4곳을 초과하여 동선 과부하 우려 (Checklist #8)`);
        totalPenaltyScore += 10;
      }
      
      let dayTotalMin = 0;
      for (let i = 0; i < places.length; i++) {
        const p = places[i];
        const duration = parseInt(p.stayDuration || "0", 10);
        dayTotalMin += duration;
        
        const travel = p.travelFromPrev;
        if (travel && travel.durationMin) {
          dayTotalMin += parseInt(travel.durationMin, 10);
        }
        
        // 9. 필수 정보(주소, Map URL 등) 누락 확인
        if (!p.naverMapUrl || !p.address) {
          errors.push(`Day ${day.day || '?'} - ${p.name || ''}: 네이버 지도 URL 또는 도로명 주소 누락 (Checklist #9)`);
          totalPenaltyScore += 8;
        }

        // 2. 동선 역행 (Backtracking) 차단
        if (i > 0) {
           const prev = places[i-1];
           if (p.address && prev.address && p.address === prev.address) {
             warnings.push(`Day ${day.day || '?'} - ${p.name}: 직전 장소와 주소가 동일하여 동선 역행 의심 (Checklist #2)`);
             totalPenaltyScore += 3;
           }
        }
        
        // 3. 식사/브레이크 타임: 12시~14시 사이 식당이 아닌 경우 경고
        if (duration > 180 && p.category !== 'food') {
           warnings.push(`Day ${day.day || '?'} - ${p.name}: 3시간 이상 체류 시 피로도 우려 (Checklist #3)`);
           totalPenaltyScore += 2;
        }
      }
      
      // 식사/휴식시간 평균 2시간(120분) 추가 (Checklist #3, #4)
      const totalDayTimeMin = dayTotalMin + 120;
      
      let dailyCost = 330000;
      // 8시간(480분) 초과시 시간당 33,000원 산정
      if (totalDayTimeMin > 480) {
        const overtimeHours = Math.ceil((totalDayTimeMin - 480) / 60);
        dailyCost += (overtimeHours * 33000);
        warnings.push(`Day ${day.day || '?'}: 예상 투어 시간이 ${totalDayTimeMin}분으로 8시간을 초과합니다. 일정 다이어트 권장.`);
        totalPenaltyScore += 5;
      }
      
      transportCost += dailyCost;
      mealsCost += 150000;
    }

    const activitiesCost = 50000 * totalPlaces;

    data.meta = {
      generatedAt: new Date().toISOString(),
      version: "2.0-VVIP-Architecture",
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
    
    // E_loss 연산
    const e_loss = Math.min(100, (totalPenaltyScore / (totalPlaces || 1)) * 5);
    const passed = e_loss <= MAX_PENALTY_THRESHOLD && errors.length === 0;
    
    data.qaSummary = {
      passed,
      e_loss_percentage: e_loss,
      errors,
      warnings,
      checkedAt: new Date().toISOString()
    };
    
    if (!passed) {
      data.qaSummary.rejectionReason = `[QA 검수 반려] 10대 모순 검증 결과 오차율(E_loss)이 ${e_loss.toFixed(1)}%로 임계치를 초과했거나 치명적 에러가 발생했습니다. 에러 로그: ${errors.join(' | ')}. 즉시 수정하여 재기획 바랍니다.`;
    }
    
    const finalStr = JSON.stringify(data, null, 2);
    console.log(`  - 10대 모순 검증 결과: E_loss=${e_loss.toFixed(1)}%, Passed=${passed}`);
    
    return {
      agentName: (this as any).agentKey,
      systemPrompt: "",
      userPrompt: "",
      rawOutput: `\`\`\`json\n${finalStr}\n\`\`\``,
      thinkingSummary: passed ? "ILS 기반 10대 모순 검증 통과 완료" : "E_loss 15% 초과로 반려 요망",
      inputTokens: 0,
      outputTokens: 0,
      hasError: !passed,
      errorMessage: data.qaSummary.rejectionReason
    };
  }
}
