import { TripRequest, AgentResult } from "./models.js";
import { AGENT_DISPLAY_NAMES, AGENT_TASKS } from "./config.js";
import { PlannerAgent, DesignerAgent, MarketingAgent, CSAgent } from "./agents/SimpleAgents.js";
import { RouteAgent } from "./agents/RouteAgent.js";
import { QAAgent } from "./agents/QAAgent.js";

export const AGENT_ORDER = ["planner", "route", "designer", "marketing", "qa", "cs"];

export class CocoTripOrchestrator {
  private agents: Record<string, any>;
  
  constructor() {
    const apiKey = process.env.GEMINI_API_KEY || process.env.VITE_GEMINI_API_KEY || "";
    if (!apiKey) {
      console.warn("경고: GEMINI_API_KEY 환경변수가 설정되지 않았습니다.");
    }
    
    this.agents = {
      planner: new PlannerAgent(apiKey),
      route: new RouteAgent(apiKey),
      designer: new DesignerAgent(apiKey),
      marketing: new MarketingAgent(apiKey),
      qa: new QAAgent(apiKey),
      cs: new CSAgent(apiKey),
    };
  }

  private _buildPrompt(request: TripRequest, previous: AgentResult[], currentAgent: string): string {
    const lines: string[] = [];

    lines.push("[코코트립 외국인 프라이빗 투어 VVIP 요청]");
    lines.push(`- 목적지: ${request.destination}`);
    lines.push(`- 투어 일정: ${request.startDate} ~ ${request.endDate} (총 ${request.durationDays}일차)`);
    lines.push(`- 핵심 관심사: ${request.preferences}`);
    lines.push(`- 인원수: ${request.pax}명`);
    lines.push(`- 지원 언어: ${request.language}`);
    lines.push(`- 요청 차량: ${request.vehicleType}`);
    lines.push("");

    if (previous.length > 0) {
      const last = previous[previous.length - 1];
      const display = AGENT_DISPLAY_NAMES[last.agentName] || last.agentName;
      lines.push(`[직전 단계(${display})의 최신 결과 데이터]`);
      lines.push(last.rawOutput);
      lines.push("");
    }

    lines.push(AGENT_TASKS[currentAgent]);
    return lines.join("\n");
  }

  async *streamRun(request: TripRequest) {
    const results: AgentResult[] = [];
    const totalSteps = AGENT_ORDER.length;
    
    for (let i = 0; i < totalSteps; i++) {
      const agentKey = AGENT_ORDER[i];
      const prompt = this._buildPrompt(request, results, agentKey);
      
      const result = await this.agents[agentKey].call(prompt);
      results.push(result);
      
      yield { step: i + 1, totalSteps, agent: agentKey, result };
    }
  }
}
