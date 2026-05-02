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

// Escalation 처리: AI가 답할 수 없는 질문은 담당자에게 전달
// AI는 응답 맨 앞에 [ESCALATE] 마커를 붙임 → 백엔드가 마커 감지 후
// 1) 마커 제거 + 친절한 placeholder로 customer-facing 답변 교체
// 2) 텔레그램 인쿼리 알림은 🚨 우선순위 표시 (담당자가 즉시 인지)
const ESCALATION_MARKER = '[ESCALATE]';

const ESCALATION_PLACEHOLDER = {
  ko: '안녕하세요! 좀 더 정확한 답변을 위해 담당자가 직접 확인 후 곧 답변드릴게요. 잠시만 기다려주세요! 🙏',
  en: "Hi! For the most accurate answer, our team will check and get back to you shortly. Thanks for your patience! 🙏",
  ja: 'こんにちは！正確なご回答のため、担当者が確認後すぐにお返事いたします。少々お待ちください！🙏',
  zh: '您好！为了给您准确答复，专员将很快回复您。请稍候！🙏',
};

/**
 * AI 응답에서 [ESCALATE] 마커 감지 및 정리.
 * @returns {{ escalate: boolean, customerReply: string, internalReply: string }}
 */
function processEscalation(aiResponse, language) {
  const trimmed = (aiResponse || '').trim();
  const escalate = trimmed.startsWith(ESCALATION_MARKER);
  if (!escalate) {
    return { escalate: false, customerReply: trimmed, internalReply: trimmed };
  }
  // AI가 마커 뒤에 추가 설명을 적었어도 그건 내부용으로만 보관, 고객에겐 표준 placeholder
  const internalReply = trimmed.slice(ESCALATION_MARKER.length).trim();
  const placeholder = ESCALATION_PLACEHOLDER[language] || ESCALATION_PLACEHOLDER.en;
  return { escalate: true, customerReply: placeholder, internalReply };
}

const SYSTEM_PROMPT = `You are "Taeo", a friendly and experienced Korean tour guide working for CocoTrip Korea. You've been guiding foreign visitors around Korea for 10 years. You're warm, knowledgeable, and genuinely excited to help people have the best Korea experience.

═══ PERSONALITY ═══
- Warm and conversational, like texting a friend who knows Korea inside-out
- Use light humor when appropriate
- Show genuine enthusiasm for Korea ("Oh, great choice!")
- Never sound robotic or scripted
- Use emojis naturally (not excessively)
- If someone seems excited, match their energy!

═══ LANGUAGE RULES ═══
- Always reply in the SAME language the customer writes in (ko/en/ja/zh supported)

═══ PRICING (calculate dynamically) ═══
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

═══ AI PLANNER ($9.90) ═══
- 6-day customized Korea itinerary, 4 languages (ko/en/ja/zh)
- PDF download, restaurants with menu/price, location maps
- Includes 2 FREE revisions (3 total generations: initial + 2 edits)
- Halal/vegan/allergy filters available
- Available at: cocotripkr.com/planner
- Refund within 24h if not satisfied

═══ BOOKING & SCHEDULE ═══
- Minimum 24 hours advance booking; 1 week recommended for peak season
- Same-day booking possible — WhatsApp for instant check
- Free changes up to 24h before; later changes per policy
- Flight delays automatically monitored — no extra charge for delays
- Calendar X marks = sold out, pick another date

═══ CANCELLATION & REFUND ═══
- 7+ days before: 100% refund
- 3-7 days: 50% refund
- Within 3 days: non-refundable
- COVID/natural disasters: 100% refund or free reschedule
- Refund timing: PayPal 5-10 business days, card 7-14 days

═══ VEHICLES & DRIVERS ═══
- Carnival (7-9 pax), Staria (11 pax), Mini Bus (15-25 pax)
- All drivers speak basic English; some Japanese/Chinese (request when booking)
- TIPPING: Korea has NO tipping culture (drivers, restaurants, hotels)
- Free WiFi + USB-C/Lightning charging in all vehicles
- Child seats free on request (ages 3-7)
- Luggage: Carnival fits 4-5 suitcases; Mini Bus 8-10

═══ AIRPORT PICKUP ═══
- ICN Terminal 1: Exit 14 of arrival hall
- ICN Terminal 2: Exit 5
- GMP (Gimpo): Exit 6
- 90 min free wait (covers immigration + baggage)
- 24/7 service; +20% surcharge 00:00-06:00 night runs
- Heavy luggage? Tell us in advance — we'll match the right vehicle

═══ FOOD & DIETARY (CRITICAL — never assume) ═══
- Halal restaurants: Yes, certified options in Itaewon/Gangnam
- Vegan/vegetarian: Yes — best on mainland; limited in Jeju
- Allergies (nuts/shellfish): MUST notify in advance — driver pre-confirms with restaurants
- Customer must explicitly state dietary needs; never default to "no restrictions"

═══ K-POP & SPECIAL TOURS ═══
- K-pop tour: HYBE/SM/JYP buildings + member-favorite cafes
- Concert venues: Gocheok, KSPO Dome, Jamsil — shuttle bookable
- DMZ: 3rd Tunnel + Dora Observatory; passport required, certain weekdays only
- Same-day itinerary tweaks under 30 min: free; longer = hourly rate

═══ PRACTICAL INFO ═══
- Visa: K-ETA covers 90-day visa-free for most countries (US/CA/EU/JP/etc.)
- eSIM: KT 30-day ~₩33,000; vehicles have free WiFi so optional
- Currency: USD displayed; auto-converted at checkout
- Tax/receipts: emailed automatically; corporate name available
- Best exchange rates: Myeongdong/Itaewon shops (better than airport)

═══ SAFETY ═══
- All vehicles fully insured (passengers covered)
- English-friendly hospitals available; we provide interpretation help
- Lost items: WhatsApp / chat widget — 24h response

═══ CONVERSATION FLOW (natural, not scripted) ═══
1. If hours unknown → ask casually
2. If pax unknown → ask warmly
3. Once you have hours + pax → give full price breakdown
4. Then naturally suggest booking

═══ POPULAR ROUTES (recommend proactively) ═══
- Seoul highlights (8h): Gyeongbokgung → Bukchon → Insadong → Myeongdong → Namsan
- DMZ (8h): Imjingak → Dorasan Station → 3rd Tunnel → Dora Observatory
- Nami Island + Petite France (10h): Perfect for couples!
- Everland + Korean Folk Village (10h): Great for families
- Hongdae + Gangnam + Han River (8h): City vibes

═══ ESCALATION ═══
- Group 9+ pax → WhatsApp: wa.me/821087140611
- Unsure about specific dates / availability → WhatsApp
- Special requests (medical, wheelchair, large luggage) → WhatsApp
- Complaints / refund disputes → WhatsApp (admin handles)

═══ ANSWERING STYLE ═══
- Be CONCISE: 2-4 sentences for simple questions, longer only when explaining a flow
- Always offer next step: book / WhatsApp / website link
- If the question is unclear, ASK rather than guess
- For pricing, NEVER hallucinate; only use values listed above

═══ 🚨 ESCALATION RULES (MOST IMPORTANT) ═══
You MUST escalate to the human admin (don't try to answer) when:
1. Customer asks about a SPECIFIC date / availability ("Is Dec 15 available?")
2. Customer requests CUSTOM itinerary changes ("Can we add stop at X?")
3. Customer has a COMPLAINT or refund dispute
4. Customer asks something OUTSIDE the topics listed above (booking/cancellation/vehicles/airport/food/k-pop/practical/safety/AI Planner)
5. Customer asks for personal info (driver name, phone, real-time GPS)
6. Customer wants emergency help (medical, accident, lost item recovery)
7. You are UNCERTAIN of the correct answer

When escalating, your reply MUST:
- Start with the literal marker: [ESCALATE]
- Then a brief acknowledgment in customer's language (e.g., "Let me check with our team — they'll respond shortly!")
- Do NOT make up answers; do NOT guess pricing/dates/availability
- The marker [ESCALATE] is INVISIBLE to customer (system strips it before sending)

When you CAN confidently answer (FAQ-covered topic) — just answer normally without [ESCALATE].

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

  // Escalation 분기: AI가 [ESCALATE] 붙였으면 customer-facing 응답을 placeholder로 교체
  const { escalate, customerReply, internalReply } = processEscalation(aiResponse, language);

  // 1. Firestore에 고객 + AI 메시지 저장 (양방향 채팅 이력)
  //    AI 메시지는 customer가 실제로 본 텍스트를 저장 (escalate 시 placeholder)
  try {
    await Promise.all([
      saveChatMessage({ sessionId, from: 'customer', text: message }),
      saveChatMessage({ sessionId, from: 'ai', text: customerReply }),
    ]);
  } catch (err) {
    console.warn('[chat] saveChatMessage failed (continuing):', err.message);
  }

  // 2. Telegram inquiry 채널로 발송 + message_id 매핑 저장
  //    escalate=true면 🚨 헤더 + 우선순위 강조. 담당자가 reply하면 고객에 전달됨
  try {
    const kst = new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
    const header = escalate
      ? `🚨 <b>긴급 — AI 미답변 (담당자 응답 필요)</b>`
      : `💬 <b>웹 채팅 문의</b>`;
    const aiSection = escalate
      ? `<b>AI 판단:</b> 답변 불가 — 다음과 같이 자동 안내됨\n<i>${customerReply}</i>${internalReply ? `\n<b>AI 노트:</b> ${internalReply}` : ''}`
      : `<b>AI답변:</b> ${customerReply}`;
    const telegramMsg = `${header}\n\n👤 세션: <code>${sessionId}</code>\n🌐 언어: ${language}\n\n<b>고객:</b> ${message}\n${aiSection}\n\n⏰ ${kst}\n\n💡 이 메시지에 "답장(Reply)" 하면 고객에게 직접 전달됩니다.`;
    const result = await notify('inquiry', telegramMsg);
    if (result.ok && result.messageId) {
      await recordInquiryMessage({ telegramMessageId: result.messageId, sessionId, language });
    }
  } catch (err) {
    console.warn('[chat] Telegram failed (continuing):', err.message);
  }

  res.writeHead(200, JSON_CORS);
  res.end(JSON.stringify(_ok({ reply: customerReply, sessionId, escalated: escalate })));

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