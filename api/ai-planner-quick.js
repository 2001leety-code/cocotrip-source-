/**
 * Vercel API Route: AI Planner Quick (1-page preview)
 * Rewrites from /api/ai-planner-quick
 */
import { GoogleGenerativeAI } from '@google/generative-ai';

export const maxDuration = 60;
export const config = { runtime: 'nodejs' };

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') { res.writeHead(200, CORS); return res.end(); }
  if (req.method !== 'POST') { res.writeHead(405, { ...CORS, 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ error: 'Method Not Allowed' })); }

  try {
    let rawBody = req.body;
    if (typeof rawBody === 'string') { try { rawBody = JSON.parse(rawBody); } catch { rawBody = {}; } }
    rawBody = rawBody || {};

    const destination = rawBody.destination || (rawBody.regions && rawBody.regions[0]) || 'Seoul';
    const prefsRaw = rawBody.preferences || rawBody.theme || rawBody.categories;
    const preferences = Array.isArray(prefsRaw) ? prefsRaw.join(', ') : (prefsRaw || 'K-food, culture');
    const durationDays = rawBody.durationDays || rawBody.duration || 3;
    const pax = rawBody.pax || rawBody.members || 2;

    const apiKey = process.env.GEMINI_API_KEY || process.env.VITE_GEMINI_API_KEY || '';
    if (!apiKey) throw new Error('API Key configuration missing');

    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });

    const systemPrompt = `당신은 코코트립의 마스터 요약 기획자입니다.
15초 내에 고객을 매료시킬 1일 차 여행 프리뷰를 작성하세요.

출력 형식은 반드시 아래 JSON 형태여야 합니다:
{
  "themes": ["핵심테마1", "핵심테마2"],
  "marketingNarrative": "이 여행이 고객에게 줄 서사적 감동 (마케팅 문구, 3문장 이내)",
  "day1MarkdownTable": "### Day 1 일정 미리보기\\n| 시간 | 명소 | 테마 |\\n|---|---|---|\\n| 10:00 | 명소1 | 팁1 |"
}`;

    const userPrompt = `목적지: ${destination}, 성향: ${preferences}, 총 ${durationDays}일 일정 중 1일차 프리뷰를 만들어주세요. 인원: ${pax}명`;

    const result = await model.generateContent({
      contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
      systemInstruction: { role: 'system', parts: [{ text: systemPrompt }] },
      generationConfig: { temperature: 0.7, maxOutputTokens: 1000, responseMimeType: 'application/json' },
    });

    const text = result.response.text();

    // 1차: 코드블록 전체 추출 (그리디 — 첫 ``` 부터 마지막 ``` 까지)
    let finalJsonStr = text;
    const matchBlock = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
    if (matchBlock) finalJsonStr = matchBlock[1];

    // 2차: 가장 바깥 { ... } 추출
    if (!finalJsonStr.trim().startsWith('{')) {
      const first = finalJsonStr.indexOf('{');
      const last  = finalJsonStr.lastIndexOf('}');
      if (first !== -1 && last > first) finalJsonStr = finalJsonStr.slice(first, last + 1);
    }

    let json;
    try {
      json = JSON.parse(finalJsonStr);
    } catch {
      // 3차 fallback: 텍스트에서 직접 { } 추출 시도
      const first = text.indexOf('{');
      const last  = text.lastIndexOf('}');
      if (first !== -1 && last > first) {
        try { json = JSON.parse(text.slice(first, last + 1)); } catch { /* ignore */ }
      }
      if (!json) json = { themes: [], marketingNarrative: text.replace(/```json?|```/g, '').trim(), day1MarkdownTable: '' };
    }

    res.writeHead(200, { ...CORS, 'Content-Type': 'application/json' });
    res.end(JSON.stringify(json));

  } catch (error) {
    console.error('Quick planner error:', error);
    res.writeHead(200, { ...CORS, 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Failed generating quick plan', details: error.message }));
  }
}
