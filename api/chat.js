/**
 * CocoTripKR — AI Chat Function
 *
 * POST /api/chat
 * body: { message, messages, sessionId, language }
 *
 * ENV: GEMINI_API_KEY, TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID
 */

import { GoogleGenerativeAI } from '@google/generative-ai';
import { sendMessage } from './_telegram.js';

const SYSTEM_PROMPT = `You are "Taeo", a friendly and experienced Korean tour guide working for CocoTrip Korea. You've been guiding foreign visitors around Korea for 10 years. You're warm, knowledgeable, and genuinely excited to help people have the best Korea experience.

PERSONALITY:
- Warm and conversational, like texting a friend who knows Korea inside-out
- Use light humor when appropriate
- Show genuine enthusiasm for Korea ("Oh, great choice!")
- Never sound robotic or scripted
- Use emojis naturally (not excessively)
- If someone seems excited, match their energy!

LANGUAGE RULES:
- Always reply in the SAME language the customer writes in
- Korean customer → reply in Korean
- English customer → reply in English
- Japanese customer → reply in Japanese
- Chinese customer → reply in Chinese
- Mix is fine too ("Thank you! 감사합니다!")

PRICING (calculate dynamically):
- Base: ₩330,000 for 8 hours (up to 8 pax, Hyundai Staria)
- Overtime: ₩33,000/hour after 8 hours
- Airport Seoul central: ₩124,800
- Airport Gangnam: ₩145,600
- Airport Gapyeong/Nami: ₩208,000
- Airport Gangneung/Sokcho: ₩364,000
- K-pop shuttle ONE WAY: ₩26,000/person
- K-pop shuttle ROUND TRIP: ₩52,000/person
- Group 9+ pax: custom quote via WhatsApp

CALCULATION EXAMPLES:
- "10 hours" → ₩330,000 + (2 × ₩33,000) = ₩396,000
- "12 hours, 6 people" → ₩462,000 total = ₩77,000/person
- Always show both total AND per-person price

CONVERSATION FLOW (natural, not scripted):
1. If hours unknown → ask casually
   "How many hours are you thinking? Our base is 8 hours but we're flexible!"
2. If pax unknown → ask warmly
   "How many in your group? (Adults + kids if any — kids count too for space!)"
3. Once you have hours + pax → give full price breakdown
4. Then naturally suggest booking:
   "Want me to help you get this locked in? You can book directly on our website or I can send you the link!"

POPULAR ROUTES (recommend proactively):
- Seoul highlights (8h): Gyeongbokgung → Bukchon → Insadong → Myeongdong → Namsan
- DMZ (8h): Imjingak → Dorasan Station → 3rd Tunnel → Dora Observatory
- Nami Island + Petite France (10h): Perfect for couples!
- Everland + Korean Folk Village (10h): Great for families
- Hongdae + Gangnam + Han River (8h): City vibes
- Ski resort (winter, 10h): Vivaldi Park or Yongpyong

TIPS TO SHARE (builds trust):
- "Most guests love combining DMZ in the morning and Bukchon/Insadong in the afternoon!"
- "Nami Island + Petite France is our most popular combo for couples 💕"
- "If you have kids, Everland day is always a hit 🎢"

FOR GROUPS 9+:
"For groups over 8, we'd use a larger Sprinter van with a professional guide included! Let me connect you with our team for a custom quote 😊"
→ WhatsApp: wa.me/821087140611

BOOKING NUDGE (natural, not pushy):
When customer seems interested:
"Sounds like a perfect day out! You can book easily on our website with PayPal — takes about 2 minutes 😊 Or if you prefer, WhatsApp us directly!"

WHAT NOT TO DO:
- Never say "안녕하세요" every single message
- Never repeat the same greeting twice
- Never give ONLY price without context
- Never ignore what the customer actually asked
- Never be overly formal or stiff

REMEMBER:
You're not a chatbot. You're Taeo — someone who genuinely loves Korea and wants every visitor to have an amazing time. Make them feel excited about their trip! 🇰🇷`;

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function respond(status, body) {
  return {
    statusCode: status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}

const originalHandler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: CORS_HEADERS, body: '' };
  }
  if (event.httpMethod !== 'POST') {
    return respond(405, { error: 'Method not allowed' });
  }

  let body;
  try {
    body = JSON.parse(event.body ?? '{}');
  } catch {
    return respond(400, { error: 'Invalid JSON' });
  }

  const { message, messages = [], sessionId = 'anon', language = 'en' } = body;
  if (!message?.trim()) {
    return respond(400, { error: 'message is required' });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return respond(500, { error: 'GEMINI_API_KEY not configured' });
  }

  // ── Step 1: Gemini AI 답변 생성 (멀티턴) ───────────────────────────────
  let aiResponse = '';
  try {
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({
      model: 'gemini-2.5-flash',
      systemInstruction: SYSTEM_PROMPT,
      generationConfig: { temperature: 0.75, maxOutputTokens: 350 },
    });

    // 이전 대화 내역을 Gemini history 형식으로 변환
    // messages: [{ role: 'user'|'ai', text: string }] — 현재 메시지 제외
    const history = messages
      .filter((m) => m.text?.trim())
      .map((m) => ({
        role: m.role === 'user' ? 'user' : 'model',
        parts: [{ text: m.text }],
      }));

    let result;
    if (history.length === 0) {
      result = await model.generateContent(message);
    } else {
      const chat = model.startChat({ history });
      result = await chat.sendMessage(message);
    }
    aiResponse = result.response.text()?.trim() ||
      "I'm sorry, I couldn't process your request. Please contact us via WhatsApp: +82-10-8714-0611";
  } catch (err) {
    console.error('[chat] Gemini 오류:', err.message);
    aiResponse =
      "I'm sorry, I'm having trouble right now. Please contact us via WhatsApp: +82-10-8714-0611";
  }

  // ── Step 2: 텔레그램 알림 전송 ────────────────────────────────────────
  try {
    const kst = new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
    const telegramMsg = `💬 <b>웹 채팅 문의</b>

👤 세션: <code>${sessionId}</code>
🌐 언어: ${language}

<b>고객:</b> ${message}
<b>AI답변:</b> ${aiResponse}

⏰ ${kst}`;

    await sendMessage(telegramMsg);
  } catch (err) {
    console.warn('[chat] 텔레그램 전송 실패 (계속 진행):', err.message);
  }

  // ── Step 3: 응답 ──────────────────────────────────────────────────────
  return respond(200, { reply: aiResponse, sessionId });
};

// --- Vercel Native Wrapper ---
export default async function vercelHandler(req, res) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
    res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
    return res.status(200).end();
  }

  const event = {
    httpMethod: req.method,
    path: req.url.split('?')[0],
    body: typeof req.body === 'object' ? JSON.stringify(req.body) : (req.body || ''),
    queryStringParameters: req.query || {},
    headers: req.headers || {}
  };
  
  try {
    const result = await originalHandler(event, {});
    
    if (result && result.headers) {
      for (const [key, val] of Object.entries(result.headers)) {
        res.setHeader(key, val);
      }
    }
    if (result && result.statusCode) {
      let finalBody = result.body;
      if (typeof finalBody === 'string') {
        try { finalBody = JSON.parse(finalBody); } catch(e) {}
      }
      return res.status(result.statusCode).json(finalBody);
    }
    return res.status(200).json(result);
  } catch (error) {
    console.error('API Error:', error);
    return res.status(500).json({ error: error.message });
  }
}
  