import { GoogleGenerativeAI } from "@google/generative-ai";
import { AgentResult } from "../models";
import { SYSTEM_PROMPTS, MODEL, MAX_TOKENS } from "../config";

export class BaseAgent {
  protected genAI: GoogleGenerativeAI;
  public agentKey: string;
  protected systemPrompt: string;

  constructor(apiKey: string, agentKey: string) {
    this.genAI = new GoogleGenerativeAI(apiKey);
    this.agentKey = agentKey;
    this.systemPrompt = SYSTEM_PROMPTS[agentKey] || "";
  }

  async call(userPrompt: string): Promise<AgentResult> {
    const model = this.genAI.getGenerativeModel({
      model: MODEL,
      systemInstruction: this.systemPrompt,
    });

    try {
      const result = await model.generateContent({
        contents: [{ role: "user", parts: [{ text: userPrompt }] }],
        generationConfig: {
          maxOutputTokens: MAX_TOKENS,
          temperature: 0.2,
        },
      });

      const response = result.response;
      let text = response.text();
      
      // JSON 추출 강화: 마크다운 백틱 등이 포함된 경우를 대비한 정규식 추출
      const jsonMatch = text.match(/(\{.*\}|\[.*\])/s);
      if (jsonMatch) {
        text = jsonMatch[0];
      }

      const inputTokens = response.usageMetadata?.promptTokenCount || 0;
      const outputTokens = response.usageMetadata?.candidatesTokenCount || 0;

      return {
        agentName: this.agentKey,
        systemPrompt: this.systemPrompt,
        userPrompt: userPrompt,
        rawOutput: text,
        thinkingSummary: `Gemini [${this.agentKey}] 생성 유효성 검증 완료`,
        inputTokens,
        outputTokens,
      };
    } catch (e: any) {
      console.error(`[${this.agentKey} 기술적 통신 오류]`, {
        message: e.message,
        stack: e.stack,
        prompt: userPrompt.substring(0, 100) + "..."
      });
      throw new Error(`[${this.agentKey}] 부서 응답 생성 실패: ${e.message}`);
    }
  }
}
