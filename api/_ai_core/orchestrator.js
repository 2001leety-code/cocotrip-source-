import { AGENT_DISPLAY_NAMES, AGENT_TASKS } from "./config.js";
import { PlannerAgent, DesignerAgent, MarketingAgent, CSAgent } from "./agents/SimpleAgents.js";
import { RouteAgent } from "./agents/RouteAgent.js";
import { QAAgent } from "./agents/QAAgent.js";
export const AGENT_ORDER = ["planner", "route", "designer", "marketing", "qa", "cs"];
export class CocoTripOrchestrator {
    agents;
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
    _buildPrompt(request, previous, currentAgent) {
        const lines = [];
        if (currentAgent === "planner") {
            lines.push("[코코트립 외국인 프라이빗 투어 VVIP 요청]");
            lines.push(`- 목적지: ${request.destination}`);
            lines.push(`- 투어 일정: ${request.startDate} ~ ${request.endDate} (총 ${request.durationDays}일차)`);
            lines.push(`- 핵심 관심사: ${request.preferences}`);
            lines.push(`- 인원수: ${request.pax}명`);
            lines.push(`- 지원 언어: ${request.language}`);
            lines.push(`- 요청 차량: ${request.vehicleType}`);
        }
        else {
            for (const prev of previous) {
                const display = AGENT_DISPLAY_NAMES[prev.agentName] || prev.agentName;
                lines.push(`[이전 ${display}의 완료 결과 데이터]`);
                lines.push(prev.rawOutput);
                lines.push("");
            }
        }
        lines.push(AGENT_TASKS[currentAgent]);
        return lines.join("\n");
    }
    // onChunk(agentKey, text): optional real-time token callback to write SSE progress chunks
    async *streamRun(request, onChunk) {
        const results = [];
        const totalSteps = 3;
        // 1. 기획팀: AI 일정 생성
        const plannerPrompt = this._buildPrompt(request, results, "planner");
        const plannerResult = await this.agents.planner.call(
            plannerPrompt,
            onChunk ? (text) => onChunk("planner", text) : undefined
        );
        results.push(plannerResult);
        yield { step: 1, totalSteps, agent: "planner", result: plannerResult };
        // 2. 기술팀: 네이버지도 좌표/경로 보강 (로컬 처리, 빠름)
        const routePrompt = this._buildPrompt(request, results, "route");
        const routeResult = await this.agents.route.call(
            routePrompt,
            onChunk ? (text) => onChunk("route", text) : undefined
        );
        results.push(routeResult);
        yield { step: 2, totalSteps, agent: "route", result: routeResult };
        // 3. 검수팀: 예산 산출 및 QA (로컬 처리, 빠름)
        const qaPrompt = this._buildPrompt(request, results, "qa");
        const qaResult = await this.agents.qa.call(
            qaPrompt,
            onChunk ? (text) => onChunk("qa", text) : undefined
        );
        results.push(qaResult);
        yield { step: 3, totalSteps, agent: "qa", result: qaResult };
    }
}
