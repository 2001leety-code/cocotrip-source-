/**
 * Vercel API Route: AI Chat Extractor
 * Rewrites from /api/ai-chat-extractor
 */
import { GoogleGenerativeAI } from '@google/generative-ai';

export const maxDuration = 300;
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

    const { message = '', history = [], currentExtracted = {} } = rawBody;

    const apiKey = process.env.GEMINI_API_KEY || process.env.VITE_GEMINI_API_KEY || '';
    if (!apiKey) throw new Error('API Key configuration missing');

    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });

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
2. If any mandatory fields are missing, 'isComplete' must be false.
3. If 'isComplete' is false, 'reply' MUST ask a natural Korean question to gather missing fields.
4. If 'isComplete' is true, 'reply' should be an excited confirmation in Korean.
5. RETURN EXACTLY VALID JSON ONLY. No markdown wrappers.

JSON SCHEMA:
{
  "extracted": { "destination": "string", "durationDays": "number", "pax": "number", "preferences": ["string"] },
  "reply": "string",
  "isComplete": "boolean"
}`;

    const result = await model.generateContent({
      contents: [{ role: 'user', parts: [{ text: 'Process my message: ' + message }] }],
      systemInstruction: { role: 'system', parts: [{ text: systemPrompt }] },
      generationConfig: { temperature: 0.2, maxOutputTokens: 1000 },
    });

    const text = result.response.text();
    let finalJsonStr = text;
    const matchBlock = text.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
    if (matchBlock) finalJsonStr = matchBlock[1];

    let json;
    try { json = JSON.parse(finalJsonStr); } catch { json = { reply: text, extracted: currentExtracted, isComplete: false }; }

    res.writeHead(200, { ...CORS, 'Content-Type': 'application/json' });
    res.end(JSON.stringify(json));

  } catch (error) {
    console.error('Chat extractor error:', error);
    res.writeHead(200, { ...CORS, 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ reply: '죄송합니다, 잠시 후 다시 시도해 주세요.', extracted: {}, isComplete: false }));
  }
}
