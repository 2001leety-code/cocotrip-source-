/**
 * CocoTripKR — AI Chat Function (Vercel Native)
 * POST /api/chat
 * body: { message, messages, sessionId, language }
 * ENV: GEMINI_API_KEY, TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID
 */
import { GoogleGenerativeAI } from '@google/generative-ai';
import { notify } from './_shared/notify.js';
import { recordInquiryMessage, saveChatMessage } from './_shared/chat-relay.js';
import { FieldValue } from 'firebase-admin/firestore';
import { initAdminDb } from './_shared/firebase-admin.js';
import { wrapHandler, captureError } from './_shared/sentry.js';

// ── Firebase Admin (카운터 전용, 공유 헬퍼 사용) ──────────────────────
const counterDb = initAdminDb('chat');

export const maxDuration = 30;
export const config = { runtime: 'nodejs' };

// ── 표준 응답 래퍼 ──
const _ok  = (data) => ({ ok: true, data });
const _err = (msg, code = 'UNKNOWN_ERROR') => ({ ok: false, error: msg, code });

// ── Rate limit (Gemini abuse 방어) ──────────────────────────────────
// 정책: 로그인 필수 + sessionId 5분당 5건 + IP 일 50건 (defense-in-depth)
// 미들웨어가 아니라 인라인으로 둔 이유: counterDb 없으면 silent skip해야 하는데
// 미들웨어로 감쌌다가 카운터 다운되면 채팅 자체가 막힘. graceful degrade가 우선.
const RATE_USER_WINDOW_MS = 5 * 60 * 1000;
const RATE_USER_MAX = 5;
const RATE_IP_DAILY_MAX = 50;

async function checkRateLimit(userId, ip) {
  if (!counterDb) return { allowed: true }; // graceful skip if Firestore down
  const now = Date.now();

  // 1. user 슬라이딩 윈도우 5min
  const userRef = counterDb.collection('chat_rate_limits').doc(`u:${userId}`);
  const userSnap = await userRef.get();
  const stamps = userSnap.exists ? (userSnap.data().t || []) : [];
  const fresh = stamps.filter((t) => now - t < RATE_USER_WINDOW_MS);
  if (fresh.length >= RATE_USER_MAX) {
    const oldest = Math.min(...fresh);
    const retry = Math.ceil((RATE_USER_WINDOW_MS - (now - oldest)) / 1000);
    return { allowed: false, code: 'RATE_LIMIT_USER', retryAfter: retry };
  }

  // 2. IP daily cap (KST 기준)
  const kst = new Date(now + 9 * 60 * 60 * 1000);
  const dayKey = kst.toISOString().slice(0, 10);
  const ipRef = counterDb.collection('chat_rate_limits').doc(`ip:${ip}:${dayKey}`);
  const ipSnap = await ipRef.get();
  const ipCount = ipSnap.exists ? (ipSnap.data().c || 0) : 0;
  if (ipCount >= RATE_IP_DAILY_MAX) {
    return { allowed: false, code: 'RATE_LIMIT_IP', retryAfter: 3600 };
  }

  // 기록 (await 안 함 — 응답 지연 최소화. fail은 무시 가능, 다음 호출에서 다시 측정됨)
  fresh.push(now);
  Promise.all([
    userRef.set({ t: fresh, updatedAt: now }, { merge: true }),
    ipRef.set({ c: FieldValue.increment(1), lastUpdated: now }, { merge: true }),
  ]).catch((e) => console.warn('[chat] rate-limit write failed:', e.message));

  return { allowed: true };
}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};
const JSON_CORS = { ...CORS, 'Content-Type': 'application/json' };

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
2. If pax unknown → ask warmly
3. Once you have hours + pax → give full price breakdown
4. Then naturally suggest booking

POPULAR ROUTES (recommend proactively):
- Seoul highlights (8h): Gyeongbokgung → Bukchon → Insadong → Myeongdong → Namsan
- DMZ (8h): Imjingak → Dorasan Station → 3rd Tunnel → Dora Observatory
- Nami Island + Petite France (10h): Perfect for couples!
- Everland + Korean Folk Village (10h): Great for families
- Hongdae + Gangnam + Han River (8h): City vibes

FOR GROUPS 9+:
→ WhatsApp: wa.me/821087140611

REMEMBER:
You're not a chatbot. You're Taeo — someone who genuinely loves Korea and wants every visitor to have an amazing time. 🇰🇷`;

export default wrapHandler(async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.writeHead(200, CORS);
    return res.end();
  }
  if (req.method !== 'POST') {
    res.writeHead(405, JSON_CORS);
    return res.end(JSON.stringify(_err('Method not allowed', 'METHOD_NOT_ALLOWED')));
  }

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
  body = body || {};

  const { message, messages = [], sessionId = 'anon', language = 'en', userId } = body;
  if (!message?.trim()) {
    res.writeHead(400, JSON_CORS);
    return res.end(JSON.stringify(_err('message is required', 'MISSING_FIELDS')));
  }

  // Auth gate — UI에 이미 로그인 게이트 있지만 (ChatWidget L267), API 직접 호출 차단
  if (!userId || typeof userId !== 'string' || userId.length < 4) {
    res.writeHead(401, JSON_CORS);
    return res.end(JSON.stringify(_err('Login required', 'AUTH_REQUIRED')));
  }

  // Rate limit — Gemini 메시지당 ~₩0.13. abuse 방어 (5/5min user + 50/day IP)
  const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim()
    || req.socket?.remoteAddress
    || 'unknown';
  try {
    const rl = await checkRateLimit(userId, ip);
    if (!rl.allowed) {
      res.writeHead(429, { ...JSON_CORS, 'Retry-After': String(rl.retryAfter) });
      return res.end(JSON.stringify(_err('Too many requests. Please wait.', rl.code)));
    }
  } catch (e) {
    console.warn('[chat] rate-limit check error (allowing):', e.message);
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    res.writeHead(500, JSON_CORS);
    return res.end(JSON.stringify(_err('GEMINI_API_KEY not configured', 'CONFIG_ERROR')));
  }

  let aiResponse = '';
  try {
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({
      model: 'gemini-2.5-flash',
      systemInstruction: SYSTEM_PROMPT,
      generationConfig: {
        temperature: 0.75,
        maxOutputTokens: 350,
        thinkingConfig: { thinkingBudget: 0 },
      },
    });

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
    console.error('[chat] Gemini error:', err.message);
    await captureError(err, { route: '/api/chat', userId, language });
    aiResponse = "I'm sorry, I'm having trouble right now. Please contact us via WhatsApp: +82-10-8714-0611";
  }

  // 1. Firestore에 고객 + AI 메시지 저장 (양방향 채팅 이력)
  try {
    await Promise.all([
      saveChatMessage({ sessionId, from: 'customer', text: message }),
      saveChatMessage({ sessionId, from: 'ai', text: aiResponse }),
    ]);
  } catch (err) {
    console.warn('[chat] saveChatMessage failed (continuing):', err.message);
  }

  // 2. Telegram inquiry 채널로 발송 + message_id 매핑 저장
  //    관리자가 텔레그램 "Reply" 기능으로 답장하면 chat-poll로 고객에 전달됨
  try {
    const kst = new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
    const telegramMsg = `💬 <b>웹 채팅 문의</b>\n\n👤 세션: <code>${sessionId}</code>\n🌐 언어: ${language}\n\n<b>고객:</b> ${message}\n<b>AI답변:</b> ${aiResponse}\n\n⏰ ${kst}\n\n💡 이 메시지에 "답장(Reply)" 하면 고객에게 직접 전달됩니다.`;
    const result = await notify('inquiry', telegramMsg);
    if (result.ok && result.messageId) {
      await recordInquiryMessage({ telegramMessageId: result.messageId, sessionId, language });
    }
  } catch (err) {
    console.warn('[chat] Telegram failed (continuing):', err.message);
  }

  res.writeHead(200, JSON_CORS);
  res.end(JSON.stringify(_ok({ reply: aiResponse, sessionId })));

  // ── 비동기 카운터 (응답 후 실행) ──
  if (counterDb) {
    const kst = new Date(Date.now() + 9 * 60 * 60 * 1000);
    const monthKey = `${kst.getFullYear()}-${String(kst.getMonth() + 1).padStart(2, '0')}`;
    const dayKey = `${monthKey}-${String(kst.getDate()).padStart(2, '0')}`;
    const inc = FieldValue.increment(1);
    counterDb.collection('api_stats').doc(monthKey).set(
      { chatCount: inc, lastUpdated: new Date().toISOString() }, { merge: true }
    ).catch(e => console.warn('[chat] counter error:', e.message));
    counterDb.collection('api_stats').doc(monthKey)
      .collection('daily').doc(dayKey).set(
        { chatCount: inc, lastUpdated: new Date().toISOString() }, { merge: true }
      ).catch(e => console.warn('[chat] daily counter error:', e.message));
  }
});