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

  // onChunk: optional real-time token callback for SSE streaming
  async call(userPrompt: string, onChunk?: (text: string) => void): Promise<AgentResult> {
    const model = this.genAI.getGenerativeModel({
      model: MODEL,
      systemInstruction: this.systemPrompt,
    });

    try {
      // generateContentStream: yields tokens immediately → prevents 504 on Vercel
      const streamResult = await model.generateContentStream({
        contents: [{ role: "user", parts: [{ text: userPrompt }] }],
        generationConfig: {
          maxOutputTokens: MAX_TOKENS,
          temperature: 0.2,
          // Disable thinking mode — adds 30-60s latency on Gemini 2.5 Flash
          thinkingConfig: { thinkingBudget: 0 },
        } as any,
      });

      let text = "";
      let inputTokens = 0;
      let outputTokens = 0;

      for await (const chunk of streamResult.stream) {
        const chunkText = chunk.text();
        if (chunkText) {
          text += chunkText;
          if (onChunk) onChunk(chunkText);
        }
      }

      const finalResponse = await streamResult.response;
      inputTokens = finalResponse.usageMetadata?.promptTokenCount || 0;
      outputTokens = finalResponse.usageMetadata?.candidatesTokenCount || 0;

      // JSON 추출 강화: 마크다운 백틱 등이 포함된 경우를 대비한 정규식 추출
      const jsonMatch = text.match(/(\{.*\}|\[.*\])/s);
      if (jsonMatch) {
        text = jsonMatch[0];
      }

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
