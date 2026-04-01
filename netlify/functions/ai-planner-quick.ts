import { Context } from "@netlify/functions";
import { GoogleGenerativeAI } from "@google/generative-ai";

export const maxDuration = 300; 
export const runtime = 'nodejs'; // 혹은 'edge' (스트리밍 사용 시)

export default async (req: Request, context: Context) => {
  // CORS 처리
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 200,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Requested-With",
        "Access-Control-Max-Age": "86400",
      },
    });
  }

  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  try {
    const rawBody = await req.json();
    const destination = rawBody.destination || "Seoul";
    const preferences = rawBody.preferences || "K-pop";
    const durationDays = rawBody.durationDays || 3;

    const apiKey = process.env.GEMINI_API_KEY || process.env.VITE_GEMINI_API_KEY || "";
    if (!apiKey) throw new Error("API Key configuration missing");

    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

    const systemPrompt = `당신은 코코트립의 마스터 요약 기획자입니다.
15초 내에 고객을 매료시킬 1일 차 여행 프리뷰를 작성하세요.

출력 형식은 반드시 아래 JSON 형태여야 합니다:
{
  "themes": ["핵심테마1", "핵심테마2"],
  "marketingNarrative": "이 여행이 고객에게 줄 서사적 감동 (마케팅 문구, 3문장 이내)",
  "day1MarkdownTable": "### Day 1 일정 미리보기\\n| 시간 | 명소 | 테마 |\\n|---|---|---|\\n| 10:00 | 명소1 | 팁1 |"
}`;

    const userPrompt = `목적지: ${destination}, 성향: ${preferences}, 총 ${durationDays}일 일정 중 1일차 프리뷰를 만들어주세요.`;

    const result = await model.generateContent({
      contents: [{ role: "user", parts: [{ text: userPrompt }] }],
      systemInstruction: { role: "system", parts: [{ text: systemPrompt }] },
      generationConfig: { temperature: 0.7, maxOutputTokens: 1000 }
    });

    const text = result.response.text();
    let finalJsonStr = text;
    const matchBlock = text.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
    if (matchBlock) finalJsonStr = matchBlock[1];

    const json = JSON.parse(finalJsonStr);

    return new Response(JSON.stringify(json), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
      }
    });

  } catch (error: any) {
    return new Response(JSON.stringify({ error: "Failed generating quick plan", details: error.message }), {
      status: 400,
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
    });
  }
};
