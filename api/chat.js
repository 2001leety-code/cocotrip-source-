/**
 * CocoTripKR — AI Chat Function (Vercel Native)
 * POST /api/chat
 * body: { message, messages, sessionId, language }
 * ENV: GEMINI_API_KEY, TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID
 */
import { GoogleGenerativeAI } from '@google/generative-ai';
import { notify } from './_shared/notify.js';
import { recordInquiryMessage, saveChatMessage } from './_shared/chat-relay.js';
import { detectAndTranslate } from './_shared/translator.js';
import { FieldValue } from 'firebase-admin/firestore';
import { initAdminDb } from './_shared/firebase-admin.js';
import { hashIp } from './_shared/ip-rate-limit.js';
import { wrapHandler, captureError } from './_shared/sentry.js';

// ── Firebase Admin (카운터 전용, 공유 헬퍼 사용) ──────────────────────
const counterDb = initAdminDb('chat');

export const maxDuration = 30;
export const config = { runtime: 'nodejs' };

// ── 표준 응답 래퍼 ──
const _ok  = (data) => ({ ok: true, data });
const _err = (msg, code = 'UNKNOWN_ERROR') => ({ ok: false, error: msg, code });

// ── Rate limit (Gemini abuse 방어) ──────────────────────────────────
// 정책: 로그인 userId 5분당 5건 + 일 50건 / 게스트 IP 5분당 5건 + 일 15건.
//
// PR #448 (Audit W-H14 — 2026-05-16): daily cap 키를 `ip:${ip}:${dayKey}` →
// `usr:${userId}:${dayKey}` 로 교체.
//
// Pre-fix: Vercel 함수가 NAT 뒤에서 동작 → 카페/회사/모바일 캐리어 공유 IP 의
// 정상 user 들이 같은 IP 카운터 공유 → 한 사용자가 50건 소진하면 같은 NAT 의
// 다른 사용자들 모두 차단. Vercel 자체 IP 가 outbound 에서 reuse 되는 케이스
// 도 동일 — 모든 chat 호출이 한 IP 로 묶임.
//
// Post-fix: 로그인 사용자는 uid 가 abuse 정의 단위(NAT 영향 없음, 50건/day).
//
// 게스트 허용 (2026-08-18 퍼널 감사 1번 — 로그인 벽 제거): userId 없으면
// sha256(IP) 를 가짜 userId 로 써서 같은 트랜잭션 로직을 재사용한다. 게스트는
// 안정 키가 IP 뿐이라 NAT 공유 리스크를 되받지만, 클라이언트 3문답 게이트가
// 1차 방어이고 이 캡은 게이트 우회(새로고침 등) 백스톱이다. 일 15건이면
// 같은 카페 NAT 의 게스트 5명 × 3문답까지 정상 통과.
//
// 미들웨어가 아니라 인라인으로 둔 이유: counterDb 없으면 silent skip해야 하는데
// 미들웨어로 감쌌다가 카운터 다운되면 채팅 자체가 막힘. graceful degrade가 우선.
const RATE_USER_WINDOW_MS = 5 * 60 * 1000;
const RATE_USER_MAX = 5;
const RATE_USER_DAILY_MAX = 50;
const RATE_GUEST_DAILY_MAX = 15;

async function checkRateLimit(userId, ip) {
  if (!counterDb) return { allowed: true }; // graceful skip if Firestore down
  const now = Date.now();

  // 게스트는 IP 해시를 키로 재사용 — 아래 doc 키/트랜잭션은 로그인과 동일 경로.
  const isGuest = !userId;
  if (isGuest) userId = `ip:${hashIp(ip)}`;
  const dailyMax = isGuest ? RATE_GUEST_DAILY_MAX : RATE_USER_DAILY_MAX;

  // 버그 #19 fix: 이전엔 get → cap검사 → fire-and-forget write(await 안 함) 였음.
  // 같은 userId 동시 요청 N건이 쓰기 전 동일 스냅샷을 읽어 전부 캡 통과(5/5min·50/day
  // 우회) → Gemini 호출비 증폭. _shared/ip-rate-limit.js 와 동일하게 read→cap검사→
  // increment 를 db.runTransaction() 안에서 atomic 하게 수행하고 await 한다.
  // 슬라이딩 윈도우(user 5분 최근 N) + 일 캡 둘 다 한 트랜잭션으로 직렬화.
  const userRef = counterDb.collection('chat_rate_limits').doc(`u:${userId}`);
  const kst = new Date(now + 9 * 60 * 60 * 1000);
  const dayKey = kst.toISOString().slice(0, 10);
  const dailyRef = counterDb.collection('chat_rate_limits').doc(`usr:${userId}:${dayKey}`);

  try {
    return await counterDb.runTransaction(async (tx) => {
      // Firestore 트랜잭션 규칙: 모든 read 가 모든 write 보다 먼저.
      const userSnap = await tx.get(userRef);
      const dailySnap = await tx.get(dailyRef);

      // 1. user 슬라이딩 윈도우 5min
      const stamps = userSnap.exists ? (userSnap.data().t || []) : [];
      const fresh = stamps.filter((t) => now - t < RATE_USER_WINDOW_MS);
      if (fresh.length >= RATE_USER_MAX) {
        const oldest = Math.min(...fresh);
        const retry = Math.ceil((RATE_USER_WINDOW_MS - (now - oldest)) / 1000);
        return { allowed: false, code: 'RATE_LIMIT_USER', retryAfter: retry };
      }

      // 2. daily cap (KST 기준). 로그인=uid 키 50건(PR #448), 게스트=IP 키 15건.
      const dailyCount = dailySnap.exists ? (dailySnap.data().c || 0) : 0;
      if (dailyCount >= dailyMax) {
        return { allowed: false, code: isGuest ? 'RATE_LIMIT_GUEST_DAILY' : 'RATE_LIMIT_USER_DAILY', retryAfter: 3600 };
      }

      // 두 캡 모두 통과 — 이 트랜잭션 안에서 atomic 하게 증가시키고 커밋.
      // 동시 요청은 트랜잭션 충돌 시 Firestore 가 재시도하므로 이중 통과 불가.
      fresh.push(now);
      tx.set(userRef, { t: fresh, updatedAt: now }, { merge: true });
      tx.set(dailyRef, { c: dailyCount + 1, lastUpdated: now }, { merge: true });

      return { allowed: true };
    });
  } catch (e) {
    // 트랜잭션 실패 → fail-OPEN (ip-rate-limit.js 와 동일 정책: abuse 방어가
    // Firestore 장애 때 정상 사용자를 막으면 안 됨). 다음 호출에서 다시 측정.
    console.warn('[chat] rate-limit tx failed (allowing):', e.message);
    return { allowed: true };
  }
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

═══ PRICING (quote base rates only — NEVER do arithmetic for the customer) ═══
- Base: ₩330,000 for 8 hours (Staria, 7 pax w/ captain seats — Staria 9 seats 9 pax at the same rate, no captain premium)
- Overtime: ₩33,000/hour after 8 hours
- Airport Seoul central: ₩124,800
- Airport Gangnam: ₩145,600
- Airport Gapyeong/Nami: ₩208,000
- Airport Gangneung/Sokcho: ₩364,000
- K-pop shuttle ONE WAY: ₩35,000/person
- K-pop shuttle ROUND TRIP: ₩65,000/person
- Sprinter (9-15 pax): instant quote on Charter, no custom quote needed
- Large bus (16+ pax): inquiry-only, custom quote required
- Staria (7-pax) charter/transfer bookings add a fixed ₩33,000 captain-seat premium — already included in the Charter page quote

NEVER calculate a total or per-person price yourself — the rates above are base reference only.
Charter pricing has extra variables (distance tiers, night surcharge, multi-day discounts, options)
that only the live calculator gets right. ALWAYS say something like:
  "The exact price — including any surcharges — is calculated instantly on cocotripkr.com/charter.
   What you see there is exactly what you'll be charged."

═══ AI PLANNER ($9.90) ═══
- Customized Korea itinerary, 4 languages (ko/en/ja/zh) — length follows the dates you pick (defaults to 3 days if you haven't picked dates yet)
- Free quick preview before you pay, so you can see the plan style first
- PDF download, restaurants with menu/price, location maps
- Includes 2 FREE revisions after purchase (3 total generations: initial + 2 edits)
- Halal/vegan/vegetarian filters available
- Available at: cocotripkr.com/planner
- AI Plans are digital products delivered immediately and are non-refundable (charter/tour bookings follow the separate cancellation policy below)

═══ BOOKING & SCHEDULE ═══
- Charter/vehicle bookings (transfer, airport pickup, multi-day, K-pop shuttle): cutoff is 1 hour before pickup — same-day booking is often possible
- Tours (Seoul city, DMZ, Gangwon, ski, Gyeongju/Jeonju, Busan day tours): cutoff is 8 hours before start
- 1 week advance recommended for peak season, but late booking usually works within the cutoffs above
- Free changes up to 12 hours before the tour/pickup; after that, changes follow the cancellation policy below
- Share your flight number when booking and we'll check your arrival to help time the pickup
- Calendar X marks = sold out, pick another date

═══ CANCELLATION & REFUND ═══
(2026-08-19 정정 — SSOT = api/_refund-policy.js, 2026-07-14 운영자 확정 24시간 바이너리.
 이전 프롬프트의 7일/3-7일 50% 등급표는 실존한 적 없는 옛 초안이라 손님에게 오답이 나갔다.)
- Cancel 24+ hours before the tour start (KST): 100% refund
- Within 24 hours of the tour start, or no-show: no refund
- Same policy for all customers (no loyalty-tier difference)
- If we cannot assign a vehicle or driver, the booking is cancelled automatically with a 100% refund
- Refund timing: processed to the original PayPal account within 7-10 business days

═══ VEHICLES & DRIVERS ═══
- Staria (7 pax, captain seats), Staria 9 (9 pax), Sprinter (9-15 pax, licensed guide required), Large bus (16+ pax, inquiry only)
- All drivers speak basic English; some Japanese/Chinese (request when booking)
- TIPPING: Korea has NO tipping culture (drivers, restaurants, hotels)
- Free WiFi + USB-C/Lightning charging in all vehicles
- Child seat: ₩20,000 add-on per trip (request when booking)
- Luggage: tell us how much luggage you have so we match the right vehicle

═══ AIRPORT PICKUP ═══
- ICN Terminal 1: Exit 14 of arrival hall
- ICN Terminal 2: Exit 5
- GMP (Gimpo): Exit 6
- 90 min free wait (covers immigration + baggage)
- Human support: weekdays 10:00-18:00 KST (lunch 12:00-13:00) — this AI chat answers anytime and escalates urgent issues to the team
- A +20% night surcharge may apply for late-evening/early-morning pickups — the Charter page quote shows it exactly
- Heavy luggage? Tell us in advance — we'll match the right vehicle

═══ FOOD & DIETARY (CRITICAL — never assume) ═══
- Halal restaurants: Yes, certified options in Itaewon/Gangnam
- Vegan/vegetarian: Yes — best on mainland; limited in Jeju
- Other special requests (schedule changes, accessibility needs, child seat): tell us in advance via the special-request field
- Customer must explicitly state dietary needs (Halal/Vegan/Vegetarian); never default to "no restrictions"

═══ K-POP & SPECIAL TOURS ═══
- K-pop tour: HYBE/SM/JYP buildings + member-favorite cafes
- Concert venues: Gocheok, KSPO Dome, Jamsil — shuttle bookable
- DMZ: 3rd Tunnel + Dora Observatory; passport required, operating days vary — check the tour page for the current schedule
- Same-day itinerary tweaks under 30 min: free; longer = hourly rate

═══ PRACTICAL INFO ═══
- Visa: K-ETA covers 90-day visa-free for most countries (US/CA/EU/JP/etc.) — please double-check the latest entry requirements before you travel
- eSIM: we don't sell eSIMs directly, but plan pages link a Trip.com eSIM option; vehicles also have free WiFi
- Currency: USD displayed; auto-converted at checkout
- Tax/receipts: emailed automatically; corporate name available
- Best exchange rates: Myeongdong/Itaewon shops (better than airport)

═══ SAFETY ═══
- All vehicles fully insured (passengers covered)
- English-friendly hospitals available; we provide interpretation help
- Lost items: contact us via WhatsApp / chat widget and we'll help track it down

═══ CONVERSATION FLOW (natural, not scripted) ═══
1. If hours unknown → ask casually
2. If pax unknown → ask warmly
3. Once you have hours + pax → give the base price + direct to Charter for the exact total (never calculate it yourself)
4. Then naturally suggest booking

═══ POPULAR ROUTES (recommend proactively) ═══
- Seoul highlights (8h): Gyeongbokgung → Bukchon → Insadong → Myeongdong → Namsan
- DMZ (8h): Imjingak → Dorasan Station → 3rd Tunnel → Dora Observatory
- Nami Island + Petite France (10h): Perfect for couples!
- Everland + Korean Folk Village (10h): Great for families
- Hongdae + Gangnam + Han River (8h): City vibes

═══ ROUTING (CRITICAL — distinguish 3 paths) ═══

A) BOOKING — direct to Charter page (self-service, instant)
   Trigger examples:
   - "How much for X?"
   - "Is Dec 15 available?"
   - "I want to book a tour to Nami Island"
   - "Can I get airport pickup on Friday?"
   - Group of 9-15 people (Sprinter — still instant quote, no custom quote needed)
   - Any standard date/price/availability question
   Response: Give the price (if known) + always include
     "👉 Please book here: cocotripkr.com/charter — instant confirmation,
      live calendar, all vehicle options."
   Do NOT escalate these — let the customer self-serve via Charter.

B) WHATSAPP / 1:1 CHAT (escalate to admin)
   Trigger examples:
   - Group 16+ pax needing a large bus (custom quote needed — 9-15 pax is instant via Sprinter, not this)
   - Regions/tours NOT in Charter (e.g., Sokcho overnight, Jeju multi-day,
     pickup from non-major city, business roadshow)
   - Special requests: medical equipment, wheelchair, oversized luggage,
     pet-friendly, English-only driver guarantee
   - Complaints / refund disputes
   - Emergency (accident, medical, lost item recovery)
   - Tour customization beyond standard menus
   Response: Use [ESCALATE] marker (system handles auto-routing to admin).
   Or for WhatsApp explicit: include "wa.me/821087140611"

C) FAQ — answer directly (no escalation, no Charter redirect needed)
   Trigger examples:
   - Cancellation policy
   - Tipping culture
   - Visa info, eSIM, currency
   - Halal/vegan availability (general)
   - Vehicle types overview
   - Driver languages
   Response: Answer concisely from FAQ knowledge above.

═══ ANSWERING STYLE ═══
- Be CONCISE: 2-4 sentences for simple questions, longer only when explaining a flow
- Always offer next step: book / WhatsApp / website link
- If the question is unclear, ASK rather than guess
- For pricing, NEVER hallucinate; only use values listed above

═══ 🚨 ESCALATION RULES (3-WAY ROUTING) ═══

STEP 1: Classify the question into one of:
  • FAQ → answer directly (e.g., cancellation policy, tipping, visa)
  • BOOKING → direct to Charter page (e.g., date check, price quote, "I want to book")
  • SPECIAL → escalate to admin via [ESCALATE]

STEP 2: Respond accordingly.

For FAQ:
  Just answer. No marker, no Charter link.

For BOOKING (most common case):
  Give price (if you know it from PRICING section) + ALWAYS include:
  "👉 Book here for instant confirmation: cocotripkr.com/charter"
  Do NOT use [ESCALATE]. Charter page handles it.

For SPECIAL (escalate to admin):
  Triggers:
  - Group 16+ pax requiring a large bus (custom quote) — 9-15 pax is instant via Sprinter, route to BOOKING instead
  - Regions/tours not in standard Charter (Sokcho overnight, Jeju multi-day, etc.)
  - Special accessibility (wheelchair, medical, pet)
  - Complaints / refund disputes
  - Emergency (accident, medical, lost item)
  - Itinerary customization beyond standard menu
  - Personal info requests (driver name, phone, GPS)

  Your reply MUST:
  - Start with the literal marker: [ESCALATE]
  - Then a brief acknowledgment in customer's language
    (e.g., "Let me check with our team — they'll respond shortly!"
     or "잠시만요! 담당자가 직접 확인 후 답변드릴게요!"
     or "WhatsApp으로 문의 부탁드려요: wa.me/821087140611")
  - The marker [ESCALATE] is INVISIBLE to customer (system strips it)

NEVER guess specific pricing/dates/availability. If unsure → BOOKING (Charter) or SPECIAL ([ESCALATE]).

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

  // 게스트 허용 (2026-08-18 퍼널 감사 1번 — 로그인 벽 제거). 이전엔 여기서
  // 401 AUTH_REQUIRED 를 냈지만, userId 는 클라이언트가 보내는 값이라 검증 없는
  // 게이트였다(아무 문자열이나 통과). 실방어는 아래 레이트리밋 — 게스트는
  // IP 키 일 15건으로 오히려 기존(가짜 uid 당 50건)보다 좁다.
  // 형식이 이상한 userId 는 게스트로 취급.
  const uid = (typeof userId === 'string' && userId.length >= 4) ? userId : null;

  // Rate limit — Gemini 메시지당 ~₩0.13. abuse 방어
  // (로그인: 5/5min + 50/day per uid · 게스트: 5/5min + 15/day per IP)
  const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim()
    || req.socket?.remoteAddress
    || 'unknown';
  try {
    const rl = await checkRateLimit(uid, ip);
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
    // 사용량 실측 기록(비용 가시화 2026-07-09) — fire-and-forget, 실패해도 채팅 흐름 영향 0.
    import('./_shared/apiUsageRecorder.js').then((m) => m.recordUsageFromResponse('chat', 'gemini-2.5-flash', result.response)).catch(() => {});
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
  //
  //    번역(PR-Q): 고객 메시지가 한국어가 아니면 Gemini로 한글 번역 추가.
  //    AI답변도 한국어가 아니면 운영자 가독성 위해 한글로 함께 표시.
  //    inquiry_messages 매핑에 detected language 저장 → 운영자 reply 시 그 언어로 자동 번역.
  try {
    const kst = new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
    const header = escalate
      ? `🚨 <b>긴급 — AI 미답변 (담당자 응답 필요)</b>`
      : `💬 <b>웹 채팅 문의</b>`;

    // 고객 메시지 번역 (Korean target).
    let customerKo = null;
    let detectedLang = language;
    let translateFailedTag = '';
    try {
      const det = await detectAndTranslate(message, 'ko');
      detectedLang = det.sourceLang || language;
      if (!det.isOriginal) {
        customerKo = det.translation;
        if (customerKo === null) translateFailedTag = ' ⚠️ 번역 실패';
      }
    } catch (e) {
      console.warn('[chat] customer translate failed:', e.message);
      translateFailedTag = ' ⚠️ 번역 실패';
    }

    // AI 답변(고객 노출용)도 한글이 아니면 운영자용 한글 추가.
    let aiKo = null;
    if (!escalate) {
      try {
        const det = await detectAndTranslate(customerReply, 'ko');
        if (!det.isOriginal && det.translation) aiKo = det.translation;
      } catch (e) {
        console.warn('[chat] ai translate failed:', e.message);
      }
    }

    const customerSection = customerKo
      ? `<b>📨 고객 (${detectedLang}):</b> ${message}\n<b>🇰🇷 번역:</b> ${customerKo}`
      : `<b>고객${translateFailedTag}:</b> ${message}`;
    const aiSection = escalate
      ? `<b>AI 판단:</b> 답변 불가 — 다음과 같이 자동 안내됨\n<i>${customerReply}</i>${internalReply ? `\n<b>AI 노트:</b> ${internalReply}` : ''}`
      : aiKo
        ? `<b>AI답변:</b> ${customerReply}\n<b>🇰🇷 번역:</b> ${aiKo}`
        : `<b>AI답변:</b> ${customerReply}`;
    const telegramMsg = `${header}\n\n👤 세션: <code>${sessionId}</code>\n🌐 언어: ${detectedLang}\n\n${customerSection}\n${aiSection}\n\n⏰ ${kst}\n\n💡 이 메시지에 "답장(Reply)" 하면 고객에게 직접 전달됩니다.`;
    const result = await notify('inquiry', telegramMsg);
    if (result.ok && result.messageId) {
      // 운영자 reply 시 detectedLang으로 번역 → 정확한 언어 매핑이 중요.
      await recordInquiryMessage({ telegramMessageId: result.messageId, sessionId, language: detectedLang });
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