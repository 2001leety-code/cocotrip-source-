import { GoogleGenerativeAI } from "@google/generative-ai";
import { SYSTEM_PROMPTS, MODEL, MAX_TOKENS } from "../config.js";
export class BaseAgent {
    genAI;
    agentKey;
    systemPrompt;
    constructor(apiKey, agentKey) {
        this.genAI = new GoogleGenerativeAI(apiKey);
        this.agentKey = agentKey;
        this.systemPrompt = SYSTEM_PROMPTS[agentKey] || "";
    }
    // onChunk: optional callback(text) called for each streamed token — use to write SSE chunks in real-time
    async call(userPrompt, onChunk) {
        const model = this.genAI.getGenerativeModel({
            model: MODEL,
            systemInstruction: this.systemPrompt,
        });
        try {
            const streamResult = await model.generateContentStream({
                contents: [{ role: "user", parts: [{ text: userPrompt }] }],
                generationConfig: {
                    maxOutputTokens: MAX_TOKENS,
                    temperature: 0.2,
                    responseMimeType: "application/json",
                    thinkingConfig: { thinkingBudget: 0 },
                },
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

            // Robust JSON extraction: strip markdown fences, find outermost { }
            text = text.replace(/^```(?:json)?\s*|```\s*$/gm, '').trim();
            const first = text.indexOf('{');
            const last = text.lastIndexOf('}');
            if (first !== -1 && last > first) {
                text = text.slice(first, last + 1);
            }

            // Validate JSON is parseable — if not, try to salvage
            try {
                JSON.parse(text);
            } catch {
                console.warn(`[${this.agentKey}] JSON parse failed, attempting salvage`);
                // Try to find JSON in the raw output
                const raw = text;
                const f2 = raw.indexOf('{');
                const l2 = raw.lastIndexOf('}');
                if (f2 !== -1 && l2 > f2) {
                    text = raw.slice(f2, l2 + 1);
                }
            }

            return {
                agentName: this.agentKey,
                systemPrompt: this.systemPrompt,
                userPrompt: userPrompt,
                rawOutput: text,
                thinkingSummary: `[${this.agentKey}] completed`,
                inputTokens,
                outputTokens,
            };
        }
        catch (e) {
            console.error(`[${this.agentKey}] API error:`, e.message);
            throw new Error(`[${this.agentKey}] generation failed: ${e.message}`);
        }
    }
}
