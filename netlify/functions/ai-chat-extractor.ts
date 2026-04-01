import { Context } from "@netlify/functions";
import { GoogleGenerativeAI } from "@google/generative-ai";

export const maxDuration = 300; 
export const runtime = 'nodejs'; // 혹은 'edge' (스트리밍 사용 시)

export default async (req: Request, context: Context) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 200,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      },
    });
  }

  try {
    const rawBody = await req.json();
    const { message, history = [], currentExtracted = {} } = rawBody;

    const apiKey = process.env.GEMINI_API_KEY || process.env.VITE_GEMINI_API_KEY || "";
    if (!apiKey) throw new Error("API Key configuration missing");

    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

    const systemPrompt = `You are an enthusiastic CocoTrip planner AI embedded in our booking wizard.
Your goal is to extract exactly 4 things from the user's conversation to plan an itinerary:
1. destination (string e.g. "Seoul", "Busan")
2. durationDays (number, min 1)
3. pax (number of people, default 1 if not mentioned)
4. preferences (array of strings, e.g. ["luxury", "foodie", "kpop", "nature", "shopping"])

CURRENTLY EXTRACTED: ${JSON.stringify(currentExtracted)}
USER CONTEXT HISTORY: ${JSON.stringify(history)}

Current User Message: "${message}"

INSTRUCTIONS:
1. Analyze the new message and update the extracted values.
2. If any of the 4 mandatory fields (destination, durationDays, pax, preferences) are missing or clearly unset, 'isComplete' must be false.
3. If 'isComplete' is false, 'reply' MUST ask a natural Korean question in a friendly tone to gather the remaining missing fields. (E.g. "부산으로 3일간 가시는군요! 몇 분이서 가는지, 그리고 어떤 여행(호캉스, 맛집, K-pop 등)을 좋아하시는지 알려주세요!")
4. If 'isComplete' is true, 'reply' MUST be a very excited confirmation in Korean. (E.g. "완벽합니다! 4분이서 떠나는 3일간의 서울 호캉스 여행, 제가 바로 최고의 일정을 구성해 드릴게요! 아래 '일정 생성하기' 버튼을 눌러주세요!")
5. RETURN EXACTLY VALID JSON ONLY. No markdown block \`\`\`json wrappers.

JSON SCHEMA:
{
  "extracted": {
    "destination": "string",
    "durationDays": "number",
    "pax": "number",
    "preferences": ["string"]
  },
  "reply": "string",
  "isComplete": "boolean"
}`;

    const result = await model.generateContent({
      contents: [{ role: "user", parts: [{ text: "Process my message: " + message }] }],
      systemInstruction: { role: "system", parts: [{ text: systemPrompt }] },
      generationConfig: { temperature: 0.2, maxOutputTokens: 1000 }
    });

    const text = result.response.text();
    let finalJsonStr = text;
    const matchBlock = text.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
    if (matchBlock) finalJsonStr = matchBlock[1];

    const json = JSON.parse(finalJsonStr);

    return new Response(JSON.stringify(json), {
      status: 200,
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
    });

  } catch (error: any) {
    return new Response(JSON.stringify({ error: "Failed to extract chatting", details: error.message }), {
      status: 400,
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
    });
  }
};
