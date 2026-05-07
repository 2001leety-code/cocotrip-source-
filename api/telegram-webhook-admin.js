/**
 * Vercel API Route: Admin Telegram Bot Webhook
 * POST /api/telegram-webhook-admin
 *
 * 관리자(태연님) 텔레그램 봇이 받는 모든 메시지/콜백의 진입점.
 *
 * 명령:
 *   /start /help /id /status — Phase 1
 *   /drivers                  — 등록된 기사 목록
 *   /dispatch <orderID> <chatId> — 특정 기사에게 배차 발송
 *
 * 보안:
 *   - X-Telegram-Bot-Api-Secret-Token 헤더 검증
 *   - 어드민 chat_id (TELEGRAM_CHAT_ID) 외 다른 chat_id는 침묵 무시
 *
 * ENV:
 *   TELEGRAM_ADMIN_BOT_TOKEN    — 관리자용 봇 토큰 (없으면 TELEGRAM_BOT_TOKEN 폴백)
 *   TELEGRAM_DRIVER_BOT_TOKEN   — 기사봇 토큰 (dispatch 발송 시 필요)
 *   TELEGRAM_CHAT_ID            — 태연님 chat_id (인가 검증)
 *   TELEGRAM_WEBHOOK_SECRET     — webhook 검증
 */
import { callBot, sendBotMessage, verifyWebhookSecret, parseUpdate } from './_shared/telegram-bot.js';
import { initAdminDb } from './_shared/firebase-admin.js';
import { FieldValue } from 'firebase-admin/firestore';
import { sweepExpiredDispatches, computeExpiryDate } from './_shared/dispatch-sweep.js';
import { productDisplayLabel } from './_shared/pricing.js';
import { relayAdminReply } from './_shared/chat-relay.js';
import { sendEmail } from './_send-email.js';
import { USD_TO_KRW } from './_shared/exchange-rate.js';

export const maxDuration = 15;
export const config = { runtime: 'nodejs' };

const BOT_TAG = 'admin';

// 운영 가이드 — admin 봇 역할 + 자주 헷갈리는 배차 흐름
// driver/inquiry 봇에도 각자 자기 역할 가이드(/설명) 있음
const EXPLAIN_TEXT = `<b>📖 COCOTRIPKR (메인) 봇 가이드</b>

<b>1. 이 봇의 역할</b>
🤖 어드민 통합 봇입니다. 다음 3가지를 처리:
• 어드민 명령어 입력·실행
• 새 예약 알림 (PayPal 결제 후 자동)
• 일일 매출/AI 비용 cron (오전 7시)
• 시스템 에러 알림 (API 실패 시)

<b>2. 다른 봇과의 차이</b>
🚗 Driver_Chat — 기사용 (배차 [수락/거절])
💬 InquiryCHAT_BOT — 고객 채팅 위젯 답장 릴레이
각 봇에서 <code>/설명</code> 입력하면 자기 역할 가이드 나옴.

<b>3. 배차 3단계 (자주 헷갈림)</b>

❌ 안 됨: Driver_Chat에 "11/2 남이섬 배차해줘"
   → 자연어 안 받음, Driver봇은 어드민 입력 받지 않음

✅ 메인 봇(여기)에서 3단계:

  STEP 1 — 예약 ID 찾기
  <code>예약 2026-11-02</code>
  → 그날 예약 + <code>CT-...</code> ID 표시

  STEP 2 — 기사 chat_id 찾기
  <code>기사</code>
  → 등록된 기사 + 각 chat_id 표시

  미등록 기사면:
  • 기사가 Driver_Chat에 <code>아이디</code> 입력 → chat_id 받음
  • 그 chat_id로 <code>기사추가 1234567890 김기사 스타리아</code>

  STEP 3 — 배차 발송
  <code>배차 CT-20261102-XXX 1234567890</code>
  → Driver_Chat에 [✓ 수락][✗ 거절] 버튼 발송
  → 10분 무응답 시 자동 거절

<b>4. 자주 쓰는 명령 (한글)</b>
조회: <code>예약</code> · <code>예약 2026-11-02</code> · <code>매출</code>
기사: <code>기사</code> · <code>기사추가 ...</code> · <code>누구 1234567890</code>
배차: <code>배차 CT-... 1234567890</code>
CS:   <code>이슈</code> · <code>이슈추가 ...</code> · <code>해결 ...</code>
전체: <code>/help</code> 또는 <code>도움말</code>

<b>5. 다시 보려면</b>
<code>/설명</code> 또는 <code>설명</code>`;

const HELP_TEXT = `<b>CocoTrip 관리자 봇</b>

<i>📖 처음이거나 헷갈리면: <code>/설명</code> 입력 (전체 운영 가이드)</i>

<i>모든 명령은 영문 슬래시 또는 한글 단어로 사용 가능 (인자도 한글 OK)</i>

<b>기본</b>
/start  /help  /explain  /id  /status
한글:  시작  도움말  설명  아이디  상태

<b>기사 관리</b>
/drivers — <b>기사</b>, 기사목록
/driver_add &lt;chatId&gt; &lt;name&gt; [vehicle] — <b>기사추가 ...</b>
/driver_remove &lt;chatId&gt; — <b>기사삭제 ...</b>
/driver_off &lt;chatId&gt; — <b>기사휴무 ...</b>
/driver_on &lt;chatId&gt; — <b>기사출근 ...</b>
/whois &lt;chatId&gt; — <b>누구 ...</b> (기사 정보 + 최근 7일 배차)

<b>배차</b>
/dispatch &lt;orderID&gt; &lt;driverChatId&gt; — <b>배차 ...</b>

<b>조회</b>
/bookings [YYYY-MM-DD] — <b>예약</b> 또는 예약 2026-05-15
/sales [YYYY-MM] — <b>매출</b> 또는 매출 2026-05
/stats [YYYY-MM] — <b>통계</b> 또는 통계 2026-05 (기사별/상품별 분해)
/rate — <b>환율</b> (USD↔KRW 즉시 조회)

<b>CS 티켓</b>
/cs_list [open|in_progress|resolved|all] — <b>이슈</b> 또는 이슈 open
/cs_add &lt;orderID&gt; &lt;priority&gt; &lt;issue...&gt; [plan:&lt;planId&gt;] — <b>이슈추가 ...</b>
/cs_resolve &lt;ticketId&gt; — <b>이슈해결 ...</b> (또는 해결)

<b>한글 사용 예시</b>
<code>예약</code> → 오늘 예약 목록
<code>매출</code> → 이번 달 매출
<code>기사</code> → 등록 기사 목록
<code>기사추가 1234567890 김기사 스타리아1호</code>
<code>배차 CT-20260502-123 1234567890</code>
<code>이슈추가 CT-20260502-123 high 픽업 30분 지연</code>
<code>이슈추가 CT-20260502-123 high plan:abc123 음식 알레르기 누락</code>
<code>해결 abc123def456</code>
<code>누구 1234567890</code>`;

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ ok: false, error: 'POST only' });
    return;
  }

  if (!verifyWebhookSecret(req, process.env.TELEGRAM_WEBHOOK_SECRET)) {
    console.warn(`[${BOT_TAG}-webhook] invalid secret token`);
    res.status(401).json({ ok: false, error: 'unauthorized' });
    return;
  }

  const botToken = process.env.TELEGRAM_ADMIN_BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN;
  if (!botToken) {
    console.error(`[${BOT_TAG}-webhook] no bot token configured`);
    res.status(500).json({ ok: false, error: 'bot not configured' });
    return;
  }

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { body = {}; }
  }
  const parsed = parseUpdate(body || {});

  if (!parsed || !parsed.chatId) {
    res.status(200).json({ ok: true });
    return;
  }

  const adminChatId = process.env.TELEGRAM_CHAT_ID;
  if (adminChatId && String(parsed.chatId) !== String(adminChatId)) {
    console.warn(`[${BOT_TAG}-webhook] unauthorized chat_id:`, parsed.chatId);
    res.status(200).json({ ok: true });
    return;
  }

  console.log(`[${BOT_TAG}-webhook] cmd:`, parsed.command, '| text:', parsed.text?.slice(0, 60));

  // Lazy expiry: 매 어드민 활동마다 만료된 dispatch_messages 정리
  // (Vercel Hobby cron 1일 1회 제약 회피).
  try {
    await sweepExpiredDispatches({
      driverBotToken: process.env.TELEGRAM_DRIVER_BOT_TOKEN,
      adminBotToken: botToken,
      adminChatId: parsed.chatId,
    });
  } catch (err) {
    console.warn(`[${BOT_TAG}-webhook] sweep 실패 (무시):`, err.message);
  }

  // 인쿼리 메시지에 reply한 경우 → 고객 ChatWidget으로 릴레이
  if (parsed.replyToMessageId && parsed.text && !parsed.command) {
    try {
      const result = await relayAdminReply({
        replyToMessageId: parsed.replyToMessageId,
        text: parsed.text,
        adminName: parsed.fromName || '관리자',
      });
      if (result.relayed) {
        const langTag = result.targetLang && result.targetLang !== 'ko' ? ` (${result.targetLang})` : '';
        const transTag = result.translationFailed
          ? '\n⚠️ 번역 실패 — 한국어 원문 그대로 전달됨'
          : result.translated
            ? `\n🌐 자동 번역 적용 (한글 → ${result.targetLang})`
            : '';
        await sendBotMessage(botToken, parsed.chatId,
          `✓ 고객에게 전달 완료${langTag}\n세션: <code>${result.sessionId}</code>${transTag}`);
        res.status(200).json({ ok: true });
        return;
      }
    } catch (err) {
      console.warn(`[${BOT_TAG}-webhook] relay 실패:`, err.message);
    }
  }

  try {
    await routeCommand(botToken, parsed);
    res.status(200).json({ ok: true });
  } catch (err) {
    console.error(`[${BOT_TAG}-webhook] handler error:`, err);
    // 핸들러 에러를 사용자에게도 표시 (관리자만 받으므로 안전)
    try {
      await sendBotMessage(botToken, parsed.chatId, `오류: ${err.message}`);
    } catch {}
    res.status(200).json({ ok: false, error: err.message });
  }
}

// 한글 텍스트 → 슬래시 명령 매핑
// 명령 자체는 영문/숫자만 허용되지만 (Telegram 제약), 일반 텍스트로
// 한글 단어를 보내면 동일 명령으로 라우팅. argGroup = 인자가 들어있는
// 캡쳐 그룹 인덱스 (-1이면 인자 없음). null이면 매칭 실패 케이스.
const KOREAN_ALIASES = [
  // 기본 (인자 없음)
  { re: /^(시작|스타트)$/, cmd: '/start', argGroup: -1 },
  { re: /^(도움|도움말|헬프|명령|명령어)$/, cmd: '/help', argGroup: -1 },
  { re: /^(설명|가이드|매뉴얼|사용법|운영가이드|운영 가이드)$/, cmd: '/explain', argGroup: -1 },
  { re: /^(내아이디|아이디|내 아이디)$/, cmd: '/id', argGroup: -1 },
  { re: /^(상태|시스템상태)$/, cmd: '/status', argGroup: -1 },
  { re: /^(기사목록|기사|기사명단)$/, cmd: '/drivers', argGroup: -1 },

  // 기사 관리 (인자 필수)
  { re: /^(기사추가|기사 추가|기사등록|기사 등록)\s+(.+)$/, cmd: '/driver_add', argGroup: 2 },
  { re: /^(기사삭제|기사 삭제|기사제거|기사 제거)\s+(.+)$/, cmd: '/driver_remove', argGroup: 2 },
  { re: /^(기사휴무|기사 휴무|기사비활성|기사 비활성|기사오프|기사 오프)\s+(.+)$/, cmd: '/driver_off', argGroup: 2 },
  { re: /^(기사출근|기사 출근|기사활성|기사 활성|기사온|기사 온)\s+(.+)$/, cmd: '/driver_on', argGroup: 2 },

  // 배차 (인자 필수)
  { re: /^(배차|배차발송|배차 발송)\s+(.+)$/, cmd: '/dispatch', argGroup: 2 },

  // 조회 (인자 선택 — 생략 시 오늘/이번달)
  { re: /^(예약목록|예약|오늘예약|오늘 예약)(?:\s+(.+))?$/, cmd: '/bookings', argGroup: 2 },
  { re: /^(매출|매출요약|매출 요약)(?:\s+(.+))?$/, cmd: '/sales', argGroup: 2 },
  { re: /^(통계|월간통계|월간 통계)(?:\s+(.+))?$/, cmd: '/stats', argGroup: 2 },

  // CS 티켓 (인자 선택)
  { re: /^(이슈|이슈목록|씨에스|cs)(?:\s+(.+))?$/i, cmd: '/cs_list', argGroup: 2 },
  { re: /^(이슈추가|이슈 추가|cs추가|cs 추가)\s+(.+)$/i, cmd: '/cs_add', argGroup: 2 },
  { re: /^(이슈해결|이슈 해결|cs해결|cs 해결|해결)\s+(.+)$/i, cmd: '/cs_resolve', argGroup: 2 },

  // 누구 (whois)
  { re: /^(누구|whois)\s+(\d+)$/i, cmd: '/whois', argGroup: 2 },

  // 환율 — 인자 없음
  { re: /^(환율|레이트|환율조회|환율 조회)$/i, cmd: '/rate', argGroup: -1 },
];

function resolveKoreanAlias(p) {
  if (p.command) return p;
  if (!p.text) return p;
  const trimmed = p.text.trim();
  for (const { re, cmd, argGroup } of KOREAN_ALIASES) {
    const m = trimmed.match(re);
    if (m) {
      const argStr = argGroup > 0 ? m[argGroup] : null;
      const args = argStr ? argStr.trim().split(/\s+/).filter(Boolean) : [];
      return { ...p, command: cmd, args };
    }
  }
  return p;
}

async function routeCommand(botToken, p) {
  if (p.isCallback) {
    // 2026-05-03: claim_approve:ID / claim_reject:ID 콜백 처리.
    // 기타 콜백은 거부 (실수로 옛 메시지 클릭 시 이슈 방지).
    const data = p.callbackData || '';
    if (data.startsWith('claim_approve:') || data.startsWith('claim_reject:')) {
      await handleClaimCallback(botToken, p);
      return;
    }
    await callBot(botToken, 'answerCallbackQuery', {
      callback_query_id: p.callbackId,
      text: '관리자봇은 일반 콜백 사용 안 함',
    });
    return;
  }

  // 한글 별칭 변환 (슬래시 명령 없을 때만)
  p = resolveKoreanAlias(p);

  switch (p.command) {
    case '/start':
      await sendBotMessage(botToken, p.chatId,
        `CocoTrip 관리자 봇입니다.\n\n` +
        `/help 로 명령어 목록 확인.`);
      break;

    case '/help':
      await sendBotMessage(botToken, p.chatId, HELP_TEXT);
      break;

    case '/explain':
      await sendBotMessage(botToken, p.chatId, EXPLAIN_TEXT);
      break;

    case '/id':
      await sendBotMessage(botToken, p.chatId,
        `<b>내 chat_id</b>\n<code>${p.chatId}</code>`);
      break;

    case '/status':
      await sendBotMessage(botToken, p.chatId,
        `<b>시스템 상태</b>\n` +
        `봇 webhook: 정상\n` +
        `Phase: 2 (dispatch)\n` +
        `시간: ${new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}`);
      break;

    case '/drivers':
      await handleDriversCommand(botToken, p);
      break;

    case '/driver_add':
      await handleDriverAdd(botToken, p);
      break;

    case '/driver_remove':
      await handleDriverRemove(botToken, p);
      break;

    case '/driver_off':
      await handleDriverActive(botToken, p, false);
      break;

    case '/driver_on':
      await handleDriverActive(botToken, p, true);
      break;

    case '/dispatch':
      await handleDispatchCommand(botToken, p);
      break;

    case '/bookings':
      await handleBookingsCommand(botToken, p);
      break;

    case '/sales':
      await handleSalesCommand(botToken, p);
      break;

    case '/stats':
      await handleStatsCommand(botToken, p);
      break;

    case '/cs_list':
      await handleCsList(botToken, p);
      break;

    case '/cs_add':
      await handleCsAdd(botToken, p);
      break;

    case '/cs_resolve':
      await handleCsResolve(botToken, p);
      break;

    case '/whois':
      await handleWhois(botToken, p);
      break;

    case '/rate':
      await handleRateCommand(botToken, p);
      break;

    default:
      if (p.text) {
        await sendBotMessage(botToken, p.chatId,
          `Echo: ${p.text}\n\n명령어를 사용하시려면 /help`);
      }
  }
}

async function handleDriversCommand(botToken, p) {
  const db = initAdminDb('telegram-admin');
  if (!db) throw new Error('Firestore unavailable');

  const snap = await db.collection('drivers').get();
  if (snap.empty) {
    await sendBotMessage(botToken, p.chatId,
      `등록된 기사 없음.\n\n` +
      `등록 방법:\n` +
      `1. 기사가 기사봇에 /id 입력 후 chat_id 확인\n` +
      `2. <code>/driver_add &lt;chatId&gt; &lt;name&gt; [vehicle]</code>`);
    return;
  }

  const lines = [`<b>등록된 기사 (${snap.size}명)</b>\n`];
  snap.forEach((doc) => {
    const d = doc.data();
    const status = d.active === false ? '⏸ 비활성' : '✓ 활성';
    lines.push(`<code>${doc.id}</code> · ${d.name || '?'} · ${d.vehicle || '?'} · ${status}`);
  });
  await sendBotMessage(botToken, p.chatId, lines.join('\n'));
}

// /driver_add <chatId> <name> [vehicle...]
async function handleDriverAdd(botToken, p) {
  if (p.args.length < 2) {
    await sendBotMessage(botToken, p.chatId,
      `사용법: <code>/driver_add &lt;chatId&gt; &lt;name&gt; [vehicle]</code>\n` +
      `예: <code>/driver_add 1234567890 김기사 스타리아1호</code>`);
    return;
  }

  const [chatId, name, ...vehicleParts] = p.args;
  if (!/^\d+$/.test(chatId)) {
    await sendBotMessage(botToken, p.chatId, `chatId는 숫자만 가능합니다: <code>${chatId}</code>`);
    return;
  }
  const vehicle = vehicleParts.join(' ').trim();

  const db = initAdminDb('telegram-admin');
  if (!db) throw new Error('Firestore unavailable');

  const ref = db.collection('drivers').doc(chatId);
  const existing = await ref.get();
  if (existing.exists) {
    await sendBotMessage(botToken, p.chatId,
      `이미 등록된 기사입니다: <code>${chatId}</code>\n` +
      `정보 수정은 <code>/driver_remove</code> 후 다시 등록 또는 Firestore Console에서 직접.`);
    return;
  }

  await ref.set({
    chatId: Number(chatId),
    name,
    vehicle: vehicle || '',
    active: true,
    registeredAt: new Date(),
  });

  await sendBotMessage(botToken, p.chatId,
    `✓ 기사 등록 완료\n` +
    `chatId: <code>${chatId}</code>\n` +
    `이름: ${name}\n` +
    (vehicle ? `차량: ${vehicle}\n` : '') +
    `\n이제 기사봇으로 배차 메시지를 받을 수 있습니다.`);
}

// /driver_remove <chatId>
async function handleDriverRemove(botToken, p) {
  if (p.args.length < 1) {
    await sendBotMessage(botToken, p.chatId, `사용법: <code>/driver_remove &lt;chatId&gt;</code>`);
    return;
  }

  const [chatId] = p.args;
  const db = initAdminDb('telegram-admin');
  if (!db) throw new Error('Firestore unavailable');

  const ref = db.collection('drivers').doc(chatId);
  const doc = await ref.get();
  if (!doc.exists) {
    await sendBotMessage(botToken, p.chatId, `등록되지 않은 chatId: <code>${chatId}</code>`);
    return;
  }

  const data = doc.data();
  await ref.delete();

  await sendBotMessage(botToken, p.chatId,
    `✓ 기사 삭제 완료\n` +
    `<code>${chatId}</code> · ${data?.name || '?'}`);
}

// /driver_off <chatId> 또는 /driver_on <chatId>
async function handleDriverActive(botToken, p, active) {
  if (p.args.length < 1) {
    await sendBotMessage(botToken, p.chatId,
      `사용법: <code>${active ? '/driver_on' : '/driver_off'} &lt;chatId&gt;</code>`);
    return;
  }

  const [chatId] = p.args;
  const db = initAdminDb('telegram-admin');
  if (!db) throw new Error('Firestore unavailable');

  const ref = db.collection('drivers').doc(chatId);
  const doc = await ref.get();
  if (!doc.exists) {
    await sendBotMessage(botToken, p.chatId, `등록되지 않은 chatId: <code>${chatId}</code>`);
    return;
  }

  await ref.update({ active });

  const data = doc.data();
  await sendBotMessage(botToken, p.chatId,
    `${active ? '✓ 활성화' : '⏸ 비활성화'} 완료\n` +
    `<code>${chatId}</code> · ${data?.name || '?'}`);
}

async function handleDispatchCommand(botToken, p) {
  const driverBotToken = process.env.TELEGRAM_DRIVER_BOT_TOKEN;
  if (!driverBotToken) {
    await sendBotMessage(botToken, p.chatId,
      `오류: TELEGRAM_DRIVER_BOT_TOKEN 미설정.\n` +
      `Vercel 환경변수에 기사봇 토큰을 추가해 주세요.`);
    return;
  }

  if (p.args.length < 2) {
    await sendBotMessage(botToken, p.chatId,
      `사용법: <code>/dispatch &lt;orderID&gt; &lt;driverChatId&gt;</code>\n` +
      `예: <code>/dispatch CT-20260502-123 1234567890</code>`);
    return;
  }

  const [orderID, driverChatId] = p.args;
  const db = initAdminDb('telegram-admin');
  if (!db) throw new Error('Firestore unavailable');

  // 1. 예약 조회
  const bookingDoc = await db.collection('bookings').doc(orderID).get();
  if (!bookingDoc.exists) {
    await sendBotMessage(botToken, p.chatId, `예약을 찾을 수 없습니다: <code>${orderID}</code>`);
    return;
  }
  const booking = bookingDoc.data();

  // 2. 기사 조회
  const driverDoc = await db.collection('drivers').doc(driverChatId).get();
  if (!driverDoc.exists) {
    await sendBotMessage(botToken, p.chatId,
      `기사를 찾을 수 없습니다: <code>${driverChatId}</code>\n` +
      `<code>/drivers</code> 로 등록된 기사 확인`);
    return;
  }
  const driver = driverDoc.data();

  if (driver.active === false) {
    await sendBotMessage(botToken, p.chatId, `기사가 비활성 상태입니다: ${driver.name}`);
    return;
  }

  // 3. 기사봇으로 배차 메시지 발송 (인라인 키보드)
  const dispatchText =
    `<b>새 배차 요청</b>\n` +
    `예약번호: <code>${orderID}</code>\n` +
    `상품: ${productDisplayLabel(booking.productType)}\n` +
    `날짜: ${booking.tourDate || '-'}\n` +
    `인원: ${booking.paxCount || '?'}명\n` +
    `픽업: ${booking.pickupLocation || '-'}\n` +
    (booking.dropoffLocation ? `드롭오프: ${booking.dropoffLocation}\n` : '') +
    (booking.memo ? `\n메모: ${booking.memo}\n` : '') +
    `\n10분 내 응답 부탁드립니다.`;

  const sent = await callBot(driverBotToken, 'sendMessage', {
    chat_id: Number(driverChatId),
    text: dispatchText,
    parse_mode: 'HTML',
    reply_markup: {
      inline_keyboard: [[
        { text: '✓ 수락', callback_data: `accept:${orderID}` },
        { text: '✗ 거절', callback_data: `reject:${orderID}` },
      ]],
    },
  });

  // 4. dispatch_messages 로그 기록
  const msgId = `${orderID}_${driverChatId}`;
  const sentAt = new Date();
  await db.collection('dispatch_messages').doc(msgId).set({
    orderID,
    driverChatId: Number(driverChatId),
    driverName: driver.name || '',
    driverVehicle: driver.vehicle || '',
    status: 'sent',
    telegramMessageId: sent.result?.message_id || null,
    sentAt: FieldValue.serverTimestamp(),
    expiresAt: computeExpiryDate(sentAt),  // sentAt + 10분
  });

  // 5. bookings에 dispatch 기록 (아직 accepted는 아님)
  await db.collection('bookings').doc(orderID).update({
    dispatchedAt: FieldValue.serverTimestamp(),
    dispatchedTo: { chatId: Number(driverChatId), name: driver.name || '' },
    updatedAt: FieldValue.serverTimestamp(),
  });

  await sendBotMessage(botToken, p.chatId,
    `✓ 배차 발송 완료\n` +
    `예약: <code>${orderID}</code>\n` +
    `기사: ${driver.name} (${driver.vehicle || '-'})\n` +
    `메시지ID: ${sent.result?.message_id || '-'}\n\n` +
    `기사 응답을 기다리는 중...`);
}

// 오늘 KST 날짜 (YYYY-MM-DD)
function todayKstDate() {
  const now = new Date();
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  return kst.toISOString().slice(0, 10);
}

// 이번 달 KST (YYYY-MM)
function thisMonthKst() {
  return todayKstDate().slice(0, 7);
}

// /bookings [YYYY-MM-DD] — 특정 일자 예약 목록
async function handleBookingsCommand(botToken, p) {
  const date = p.args[0] || todayKstDate();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    await sendBotMessage(botToken, p.chatId,
      `날짜 형식 오류. <code>YYYY-MM-DD</code> 형태로 입력.\n예: <code>/bookings 2026-05-15</code>`);
    return;
  }

  const db = initAdminDb('telegram-admin');
  if (!db) throw new Error('Firestore unavailable');

  const snap = await db.collection('bookings')
    .where('tourDate', '==', date)
    .orderBy('createdAt', 'desc')
    .get();

  if (snap.empty) {
    await sendBotMessage(botToken, p.chatId, `<b>${date}</b> 예약 없음.`);
    return;
  }

  const lines = [`<b>${date} 예약 (${snap.size}건)</b>\n`];
  let totalUSD = 0;
  let cancelledCnt = 0;

  snap.forEach((doc) => {
    const b = doc.data();
    const status = (b.adminStatus || b.status || '').toLowerCase();
    const isCancel = status === 'canceled' || status === 'cancelled';
    if (isCancel) cancelledCnt++;
    else totalUSD += parseFloat(String(b.amountUSD || 0));

    const statusIcon = isCancel ? '✗'
      : status === 'completed' ? '✓'
      : status === 'pending' ? '⏳'
      : '●';
    const driverInfo = b.driver ? ` | ${b.driver}` : ' | 미배정';

    lines.push(
      `${statusIcon} <code>${doc.id.slice(0, 18)}</code>\n` +
      `  ${b.productType || '-'} · ${b.paxCount || '?'}명${driverInfo}\n` +
      `  ${b.payerName || b.userEmail || '-'} · $${b.amountUSD || '0'}`
    );
  });

  lines.push(``);
  lines.push(`매출: <b>$${totalUSD.toFixed(2)}</b>${cancelledCnt > 0 ? ` (취소 ${cancelledCnt}건 제외)` : ''}`);

  // 4096자 초과 방지
  const text = lines.join('\n');
  await sendBotMessage(botToken, p.chatId, text.length > 3900 ? text.slice(0, 3900) + '\n...(잘림)' : text);
}

// /sales [YYYY-MM] — 월별 매출 요약
async function handleSalesCommand(botToken, p) {
  const month = p.args[0] || thisMonthKst();
  if (!/^\d{4}-\d{2}$/.test(month)) {
    await sendBotMessage(botToken, p.chatId,
      `형식 오류. <code>YYYY-MM</code> 형태로 입력.\n예: <code>/sales 2026-05</code>`);
    return;
  }

  const db = initAdminDb('telegram-admin');
  if (!db) throw new Error('Firestore unavailable');

  // tourDate prefix 매칭으로 월별 조회
  const monthStart = `${month}-01`;
  const [year, mo] = month.split('-').map(Number);
  const nextMonth = mo === 12 ? `${year + 1}-01-01` : `${year}-${String(mo + 1).padStart(2, '0')}-01`;

  const snap = await db.collection('bookings')
    .where('tourDate', '>=', monthStart)
    .where('tourDate', '<', nextMonth)
    .get();

  if (snap.empty) {
    await sendBotMessage(botToken, p.chatId, `<b>${month}</b> 예약 없음.`);
    return;
  }

  let totalUSD = 0;
  let count = 0;
  let cancelledCnt = 0;
  let pax = 0;
  const byProduct = new Map();

  snap.forEach((doc) => {
    const b = doc.data();
    const status = (b.adminStatus || b.status || '').toLowerCase();
    if (status === 'canceled' || status === 'cancelled') {
      cancelledCnt++;
      return;
    }
    count++;
    const usd = parseFloat(String(b.amountUSD || 0));
    totalUSD += usd;
    pax += Number(b.paxCount || 0);
    const pt = b.productType || '기타';
    const prev = byProduct.get(pt) || { count: 0, usd: 0 };
    byProduct.set(pt, { count: prev.count + 1, usd: prev.usd + usd });
  });

  const krwRate = USD_TO_KRW;
  const totalKRW = Math.round(totalUSD * krwRate);

  const lines = [
    `<b>${month} 매출 요약</b>`,
    ``,
    `유효 예약: <b>${count}건</b> (취소 ${cancelledCnt}건 별도)`,
    `총 인원: <b>${pax}명</b>`,
    `매출: <b>$${totalUSD.toFixed(2)}</b> ≈ <b>₩${totalKRW.toLocaleString()}</b>`,
    `평균 단가: $${count > 0 ? (totalUSD / count).toFixed(2) : '0'}`,
    ``,
    `<b>상품별</b>`,
  ];

  const sortedProducts = Array.from(byProduct.entries()).sort((a, b) => b[1].usd - a[1].usd);
  sortedProducts.slice(0, 10).forEach(([pt, v]) => {
    lines.push(`• ${pt}: ${v.count}건 · $${v.usd.toFixed(0)}`);
  });

  await sendBotMessage(botToken, p.chatId, lines.join('\n'));
}

// 월간 통계 분류용 — productType prefix → 한글 라벨 + 이모지.
// 매칭 순서 중요: 가장 구체적인 prefix 먼저.
const PRODUCT_CATEGORY_RULES = [
  { prefix: 'charter',  label: '차터',   icon: '🚗', match: (pt) => /^charter[_-]/i.test(pt) || /charter/i.test(pt) },
  { prefix: 'tour',     label: '투어',   icon: '🚙', match: (pt) => /^tour[_-]/i.test(pt) || /tour/i.test(pt) },
  { prefix: 'airport',  label: '공항',   icon: '✈️', match: (pt) => /^airport[_-]/i.test(pt) || /airport/i.test(pt) || /pickup/i.test(pt) },
  { prefix: 'shuttle',  label: '셔틀',   icon: '🚌', match: (pt) => /shuttle/i.test(pt) },
  { prefix: 'kpop',     label: 'K-POP', icon: '🎤', match: (pt) => /kpop/i.test(pt) },
  { prefix: 'planner',  label: 'AI 플래너', icon: '🤖', match: (pt) => /planner|ai/i.test(pt) },
];

function classifyProductForStats(productTypeOrService) {
  const pt = String(productTypeOrService || '').toLowerCase();
  if (!pt) return { label: '기타', icon: '🧾', prefix: 'misc' };
  for (const rule of PRODUCT_CATEGORY_RULES) {
    if (rule.match(pt)) return { label: rule.label, icon: rule.icon, prefix: rule.prefix };
  }
  return { label: '기타', icon: '🧾', prefix: 'misc' };
}

// KRW 금액 추출 — pricePaidKRW 또는 totalKRW 우선, 없으면 amountUSD × rate 폴백.
// rate: 실시간 환율 (기본 USD_TO_KRW = 1380 fallback)
function extractKrwAmount(b, rate = USD_TO_KRW) {
  const direct = Number(b.pricePaidKRW || b.totalKRW || b.priceKRW || 0);
  if (direct > 0) return Math.round(direct);
  const usd = parseFloat(String(b.amountUSD || 0)) || 0;
  return Math.round(usd * rate);
}

/**
 * /stats 의 메인 집계 함수. month=YYYY-MM 입력받아 해당 월 bookings 를 모두 fetch한 뒤
 * 기사별/상품별로 분해한 한글 리포트를 반환.
 *
 * 데이터 소스: bookings 컬렉션 where tourDate prefix = YYYY-MM
 * - status='CONFIRMED' 만 매출 집계 (status 비어있어도 dispatchStatus='accepted'면 포함)
 * - status='REFUNDED' 는 별도 카운트
 * - status='CANCELED' 는 제외 (어디에도 카운트 안 됨)
 *
 * 필드 폴백:
 *   기사명: driver | driverName | (없으면 '미배정')
 *   기사 chatId: driverChatId
 *   차량: vehicleType | driverVehicle (PR-N 신규 필드, 미반영 가능)
 *   금액(KRW): pricePaidKRW | totalKRW | priceKRW > amountUSD × 1380
 *   상품: productType | serviceType
 *
 * @param {string} yearMonth — 'YYYY-MM' 형식
 * @returns {Promise<string>} 텔레그램 HTML 메시지 본문
 */
async function buildStatsReport(yearMonth) {
  const db = initAdminDb('telegram-admin');
  if (!db) throw new Error('Firestore unavailable');

  const monthStart = `${yearMonth}-01`;
  const [year, mo] = yearMonth.split('-').map(Number);
  const nextMonth = mo === 12 ? `${year + 1}-01-01` : `${year}-${String(mo + 1).padStart(2, '0')}-01`;
  // 표시용 월말 (자정 - 1일 = 해당월 마지막 날). YYYY-MM-DD 형식 만들기.
  const monthEndDate = new Date(year, mo, 0);  // mo는 1-12, Date의 month는 0-indexed → mo로 넣으면 다음달 -1일 = 이번달 마지막날
  const monthEnd = monthEndDate.toISOString().slice(0, 10);

  // 실시간 환율 조회 (Firestore 6h 캐시 자동 적용 — 실패 시 1380 fallback)
  let liveRate = USD_TO_KRW;
  let rateSource = 'fallback-hardcoded';
  try {
    const { getExchangeRate } = await import('./_exchange-rate.js');
    const rateInfo = await getExchangeRate();
    if (rateInfo && rateInfo.krwPerUsd > 0) {
      liveRate = rateInfo.krwPerUsd;
      rateSource = rateInfo.source || 'live';
    }
  } catch (e) {
    console.warn('[stats] 환율 조회 실패, fallback 1380 사용:', e.message);
  }

  const snap = await db.collection('bookings')
    .where('tourDate', '>=', monthStart)
    .where('tourDate', '<', nextMonth)
    .get();

  if (snap.empty) {
    return `<b>📊 통계 — ${yearMonth}</b>\n\n이번 달 데이터 없음.\n\n기간: ${monthStart} ~ ${monthEnd}`;
  }

  // driverChatId 별: { count, krw, name, vehicle }
  const byDriver = new Map();
  // category prefix 별: { count, krw, label, icon }
  const byCategory = new Map();

  let totalCount = 0;
  let totalKRW = 0;
  let refundCount = 0;
  let refundKRW = 0;

  snap.forEach((doc) => {
    const b = doc.data();
    const status = String(b.status || b.adminStatus || '').toUpperCase();

    // CANCELED 는 어디에도 카운트 안 됨
    if (status === 'CANCELED' || status === 'CANCELLED') return;

    const krw = extractKrwAmount(b, liveRate);

    // REFUNDED 는 별도 집계만
    if (status === 'REFUNDED') {
      refundCount++;
      refundKRW += krw;
      return;
    }

    // 매출 집계 — CONFIRMED 또는 (status 비어있고 acceptedAt 있는 레거시 docs) 포함
    // status='CONFIRMED' 가 표준이지만, 레거시 booking 중 status 누락된 경우 필터 제외 방지
    if (status && status !== 'CONFIRMED') return;

    totalCount++;
    totalKRW += krw;

    // 기사별 — driverChatId 가 키. 미배정은 '0' 키.
    const driverKey = b.driverChatId != null ? String(b.driverChatId) : '0';
    const driverName = b.driver || b.driverName || (driverKey === '0' ? '미배정' : '?');
    const driverVehicle = b.vehicleType || b.driverVehicle || '';
    const dPrev = byDriver.get(driverKey) || { count: 0, krw: 0, name: driverName, vehicle: driverVehicle };
    dPrev.count++;
    dPrev.krw += krw;
    // 이름/차량은 첫 등장 정보 유지하되 비어있으면 갱신
    if (!dPrev.name || dPrev.name === '?') dPrev.name = driverName;
    if (!dPrev.vehicle && driverVehicle) dPrev.vehicle = driverVehicle;
    byDriver.set(driverKey, dPrev);

    // 상품별 — productType 우선, 없으면 serviceType
    const cat = classifyProductForStats(b.productType || b.serviceType);
    const cPrev = byCategory.get(cat.prefix) || { count: 0, krw: 0, label: cat.label, icon: cat.icon };
    cPrev.count++;
    cPrev.krw += krw;
    byCategory.set(cat.prefix, cPrev);
  });

  if (totalCount === 0 && refundCount === 0) {
    return `<b>📊 통계 — ${yearMonth}</b>\n\n이번 달 유효 데이터 없음 (모두 취소).\n\n기간: ${monthStart} ~ ${monthEnd}`;
  }

  const isFallbackRate = rateSource === 'fallback-hardcoded';
  const rateLabel = isFallbackRate
    ? `₩${Math.round(liveRate).toLocaleString()}/$ — 폴백(고정)`
    : `₩${Math.round(liveRate).toLocaleString()}/$ — ${rateSource}`;
  const lines = [`<b>📊 통계 — ${yearMonth}</b>`, `환율: ${rateLabel}`, ''];

  // 기사별 (count desc) — 0건 entry 는 자동 제외 (count++ 한 entry만 byDriver 에 들어감)
  if (byDriver.size > 0) {
    lines.push(`<b>기사별 배차:</b>`);
    const driversSorted = Array.from(byDriver.values()).sort((a, b) => b.count - a.count);
    for (const d of driversSorted) {
      const veh = d.vehicle ? ` (${d.vehicle})` : '';
      lines.push(` 🚗 ${d.name}${veh}: ${d.count}건 / ₩${d.krw.toLocaleString()}`);
    }
    lines.push(` <b>합계: ${totalCount}건 / ₩${totalKRW.toLocaleString()}</b>`);
    lines.push('');
  }

  // 상품별 (krw desc) — 0건 entry 는 자동 제외
  if (byCategory.size > 0) {
    lines.push(`<b>상품별 매출:</b>`);
    const catsSorted = Array.from(byCategory.values()).sort((a, b) => b.krw - a.krw);
    for (const c of catsSorted) {
      lines.push(` ${c.icon} ${c.label}: ${c.count}건 / ₩${c.krw.toLocaleString()}`);
    }
    lines.push(` <b>합계: ${totalCount}건 / ₩${totalKRW.toLocaleString()}</b>`);
    lines.push('');
  }

  const avgPrice = totalCount > 0 ? Math.round(totalKRW / totalCount) : 0;
  lines.push(`평균 단가: ₩${avgPrice.toLocaleString()}`);
  if (refundCount > 0) {
    lines.push(`환불 건수: ${refundCount}건 / ₩${refundKRW.toLocaleString()}`);
  }
  lines.push('');
  lines.push(`기간: ${monthStart} ~ ${monthEnd}`);

  return lines.join('\n');
}

// /stats [YYYY-MM] — 월간 통계 (기사별 + 상품별 분해)
async function handleStatsCommand(botToken, p) {
  const month = p.args[0] || thisMonthKst();
  if (!/^\d{4}-\d{2}$/.test(month)) {
    await sendBotMessage(botToken, p.chatId,
      `형식 오류. <code>YYYY-MM</code> 형태로 입력.\n예: <code>/stats 2026-05</code>`);
    return;
  }

  const text = await buildStatsReport(month);
  // 4096자 초과 방지 (기사 50명 + 상품 10개 = 약 70라인 → 안전)
  await sendBotMessage(botToken, p.chatId, text.length > 3900 ? text.slice(0, 3900) + '\n...(잘림)' : text);
}

const VALID_CS_PRIORITIES = ['low', 'medium', 'high', 'critical'];
const VALID_CS_STATUSES = ['open', 'in_progress', 'resolved'];

// /cs_list [status] — open 기본
async function handleCsList(botToken, p) {
  const filter = (p.args[0] || 'open').toLowerCase();
  if (filter !== 'all' && !VALID_CS_STATUSES.includes(filter)) {
    await sendBotMessage(botToken, p.chatId,
      `상태 오류. 가능: <code>open</code>, <code>in_progress</code>, <code>resolved</code>, <code>all</code>`);
    return;
  }

  const db = initAdminDb('telegram-admin');
  if (!db) throw new Error('Firestore unavailable');

  let q = db.collection('cs_tickets').orderBy('createdAt', 'desc').limit(20);
  if (filter !== 'all') q = q.where('status', '==', filter);

  // where + orderBy 조합 시 인덱스 필요해 query 재구성
  const snap = filter === 'all'
    ? await db.collection('cs_tickets').orderBy('createdAt', 'desc').limit(20).get()
    : await db.collection('cs_tickets').where('status', '==', filter).limit(20).get();

  if (snap.empty) {
    await sendBotMessage(botToken, p.chatId, `<b>CS 티켓 (${filter})</b>\n등록된 티켓 없음.`);
    return;
  }

  const lines = [`<b>CS 티켓 (${filter}, ${snap.size}건)</b>\n`];
  snap.forEach((doc) => {
    const t = doc.data();
    const icon = t.priority === 'critical' ? '🔴' : t.priority === 'high' ? '🟠' : t.priority === 'medium' ? '🟡' : '⚪';
    const stIcon = t.status === 'open' ? '○' : t.status === 'in_progress' ? '◐' : '●';
    const planTag = t.planId ? ` · plan:<code>${String(t.planId).slice(0, 12)}</code>` : '';
    lines.push(
      `${stIcon} ${icon} <code>${doc.id.slice(0, 12)}</code>\n` +
      `  ${t.bookingId || '-'} · ${t.customer || '-'}${planTag}\n` +
      `  ${(t.issue || '').slice(0, 80)}`
    );
  });
  await sendBotMessage(botToken, p.chatId, lines.join('\n'));
}

// /cs_add <orderID> <priority> <issue...>
//        [plan:<planId>] 토큰 어느 위치에든 들어가면 추출 → cs_tickets.planId 저장
//        - planId 형식: alphanumeric + hyphen/underscore, 최소 4자 (Firestore doc id 호환)
//        - 누락 시 planId=null (학습 루프 집계 시 obvious-null 처리)
async function handleCsAdd(botToken, p) {
  if (p.args.length < 3) {
    await sendBotMessage(botToken, p.chatId,
      `사용법: <code>/cs_add &lt;orderID&gt; &lt;priority&gt; &lt;issue...&gt; [plan:&lt;planId&gt;]</code>\n` +
      `priority: <code>low</code> | <code>medium</code> | <code>high</code> | <code>critical</code>\n` +
      `예: <code>/cs_add CT-20260502-123 high 픽업 30분 지연</code>\n` +
      `예: <code>/cs_add CT-20260502-123 high plan:abc123 음식 알레르기 누락</code>`);
    return;
  }

  // plan:<id> 토큰 추출 (어디 위치하든 OK; 첫 매칭만 사용)
  const PLAN_TOKEN_RE = /^plan:([A-Za-z0-9_-]{4,})$/;
  let planId = null;
  const filteredArgs = [];
  for (const tok of p.args) {
    if (planId === null) {
      const m = tok.match(PLAN_TOKEN_RE);
      if (m) { planId = m[1]; continue; }
    }
    filteredArgs.push(tok);
  }

  if (filteredArgs.length < 3) {
    await sendBotMessage(botToken, p.chatId,
      `인자 부족 (orderID priority issue 필요).\n` +
      `예: <code>/cs_add CT-20260502-123 high plan:abc123 픽업 지연</code>`);
    return;
  }

  const [orderID, priority, ...issueParts] = filteredArgs;
  const priorityLower = priority.toLowerCase();
  if (!VALID_CS_PRIORITIES.includes(priorityLower)) {
    await sendBotMessage(botToken, p.chatId,
      `priority 오류. 가능: ${VALID_CS_PRIORITIES.join(', ')}`);
    return;
  }
  const issue = issueParts.join(' ').trim();

  const db = initAdminDb('telegram-admin');
  if (!db) throw new Error('Firestore unavailable');

  // booking 정보 자동 채움
  let customer = '';
  try {
    const bookingDoc = await db.collection('bookings').doc(orderID).get();
    if (bookingDoc.exists) {
      const b = bookingDoc.data();
      customer = b.payerName || b.userEmail || '';
    }
  } catch {}

  // planId 미지정 시 booking.planId 자동 추론 (있으면)
  if (!planId) {
    try {
      const bookingDoc = await db.collection('bookings').doc(orderID).get();
      if (bookingDoc.exists) {
        const b = bookingDoc.data();
        if (b.planId && typeof b.planId === 'string') planId = b.planId;
      }
    } catch {}
  }

  const ref = await db.collection('cs_tickets').add({
    bookingId: orderID,
    planId: planId || null,
    customer: customer || '-',
    issue,
    priority: priorityLower,
    status: 'open',
    createdAt: FieldValue.serverTimestamp(),
  });

  await sendBotMessage(botToken, p.chatId,
    `✓ CS 티켓 생성\n` +
    `ID: <code>${ref.id.slice(0, 12)}</code>\n` +
    `예약: <code>${orderID}</code>\n` +
    (planId ? `플랜: <code>${planId}</code>\n` : '') +
    `우선순위: <b>${priorityLower}</b>\n` +
    `이슈: ${issue}`);
}

// /whois <chatId> — 빠른 기사 조회
async function handleWhois(botToken, p) {
  if (p.args.length < 1) {
    await sendBotMessage(botToken, p.chatId,
      `사용법: <code>/whois &lt;chatId&gt;</code>\n` +
      `한글: <code>누구 1234567890</code>`);
    return;
  }
  const [chatId] = p.args;
  if (!/^\d+$/.test(chatId)) {
    await sendBotMessage(botToken, p.chatId, `chatId는 숫자만 가능: <code>${chatId}</code>`);
    return;
  }

  const db = initAdminDb('telegram-admin');
  if (!db) throw new Error('Firestore unavailable');

  const driverDoc = await db.collection('drivers').doc(chatId).get();
  if (!driverDoc.exists) {
    await sendBotMessage(botToken, p.chatId,
      `<code>${chatId}</code> 등록 안 됨.\n\n` +
      `등록: <code>/driver_add ${chatId} 이름 차량</code>`);
    return;
  }
  const d = driverDoc.data();

  // 최근 1주일 배차 이력
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const dispatches = await db.collection('dispatch_messages')
    .where('driverChatId', '==', Number(chatId))
    .where('sentAt', '>=', weekAgo)
    .get();

  const stats = { sent: 0, accepted: 0, rejected: 0, expired: 0 };
  dispatches.forEach((doc) => {
    const s = doc.data().status || 'sent';
    if (stats[s] !== undefined) stats[s]++;
  });

  await sendBotMessage(botToken, p.chatId,
    `<b>${d.name || '?'}</b>\n` +
    `chatId: <code>${chatId}</code>\n` +
    `차량: ${d.vehicle || '-'}\n` +
    `상태: ${d.active === false ? '⏸ 비활성' : '✓ 활성'}\n` +
    `\n<b>최근 7일 배차</b>\n` +
    `발송: ${stats.sent}건\n` +
    `수락: ${stats.accepted}건\n` +
    `거절: ${stats.rejected}건\n` +
    `만료: ${stats.expired}건`);
}

// /cs_resolve <ticketId>
async function handleCsResolve(botToken, p) {
  if (p.args.length < 1) {
    await sendBotMessage(botToken, p.chatId,
      `사용법: <code>/cs_resolve &lt;ticketId&gt;</code>\n` +
      `ticketId는 <code>/cs_list</code>로 확인 (앞 12자리만 입력 가능 — fullId 우선)`);
    return;
  }

  const [ticketIdInput] = p.args;
  const db = initAdminDb('telegram-admin');
  if (!db) throw new Error('Firestore unavailable');

  // 정확 일치 우선, 없으면 prefix 매칭 (12자리)
  let ref = db.collection('cs_tickets').doc(ticketIdInput);
  let snap = await ref.get();

  if (!snap.exists) {
    // prefix 매칭
    const all = await db.collection('cs_tickets').where('status', 'in', ['open', 'in_progress']).get();
    let matched = null;
    all.forEach((d) => {
      if (d.id.startsWith(ticketIdInput)) matched = d;
    });
    if (!matched) {
      await sendBotMessage(botToken, p.chatId, `티켓을 찾을 수 없음: <code>${ticketIdInput}</code>`);
      return;
    }
    ref = matched.ref;
    snap = matched;
  }

  await ref.update({
    status: 'resolved',
    resolvedAt: FieldValue.serverTimestamp(),
  });

  const data = snap.data();
  await sendBotMessage(botToken, p.chatId,
    `✓ 해결 처리 완료\n` +
    `<code>${snap.id.slice(0, 12)}</code> · ${data.bookingId || '-'}\n` +
    `이슈: ${data.issue || '-'}`);
}

// /rate (한글: 환율) — 즉시 환율 조회 (Firestore 6h 캐시 — 만료 시 외부 API 갱신)
async function handleRateCommand(botToken, p) {
  try {
    const { getExchangeRate } = await import('./_exchange-rate.js');
    const info = await getExchangeRate();

    const krwPerUsd = Number(info.krwPerUsd) || 0;
    const fetchedKst = info.fetchedAt
      ? new Date(info.fetchedAt).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })
      : '-';

    const ageMs = info.fetchedAt ? (Date.now() - new Date(info.fetchedAt).getTime()) : 0;
    const ageMin = Math.round(ageMs / 60000);
    let ageLabel;
    if (ageMin < 1) ageLabel = '방금 전';
    else if (ageMin < 60) ageLabel = `${ageMin}분 전`;
    else if (ageMin < 60 * 24) ageLabel = `${Math.round(ageMin / 60)}시간 전`;
    else ageLabel = `${Math.round(ageMin / (60 * 24))}일 전`;

    const sourceLabel = info.source || '-';
    const isFallback = sourceLabel === 'fallback-hardcoded';
    const warning = isFallback
      ? `\n\n⚠️ 외부 API 모두 실패 → 폴백 환율 사용 중. 운영자 점검 필요.`
      : '';

    const msg =
      `<b>💱 USD → KRW 환율</b>\n` +
      `\n` +
      `₩${Math.round(krwPerUsd).toLocaleString()} / $1\n` +
      `1 KRW ≈ $${(1 / krwPerUsd).toFixed(6)}\n` +
      `\n` +
      `<b>출처:</b> ${escapeHtmlLocal(sourceLabel)}\n` +
      `<b>갱신:</b> ${fetchedKst} KST (${ageLabel})\n` +
      `<b>캐시 TTL:</b> 6시간 (Firestore <code>system/exchange_rate</code>)` +
      warning;

    await sendBotMessage(botToken, p.chatId, msg);
  } catch (e) {
    console.error('[admin-webhook] /rate 오류:', e);
    await sendBotMessage(botToken, p.chatId, `환율 조회 실패: ${e.message}`);
  }
}

// 2026-05-03: 옵션 B — 무료 클레임 텔레그램 1-click 승인/거부.
// notify-claim.js 가 발송한 메시지의 [✓승인][✗거부] 버튼 콜백 핸들러.
async function handleClaimCallback(botToken, p) {
  const data = p.callbackData || '';
  const isApprove = data.startsWith('claim_approve:');
  const claimId = data.split(':')[1];

  if (!claimId) {
    await callBot(botToken, 'answerCallbackQuery', {
      callback_query_id: p.callbackId, text: '잘못된 클레임 ID', show_alert: true,
    });
    return;
  }

  const db = initAdminDb('telegram-admin-claim');
  if (!db) {
    await callBot(botToken, 'answerCallbackQuery', {
      callback_query_id: p.callbackId, text: 'Firestore 연결 실패', show_alert: true,
    });
    return;
  }

  const ref = db.collection('pending_free_claims').doc(claimId);
  const snap = await ref.get();
  if (!snap.exists) {
    await callBot(botToken, 'answerCallbackQuery', {
      callback_query_id: p.callbackId, text: '클레임을 찾을 수 없음', show_alert: true,
    });
    return;
  }

  const claim = snap.data() || {};

  // 이미 처리된 클레임은 재처리 거부 (중복 클릭 보호).
  if (claim.status && claim.status !== 'pending') {
    await callBot(botToken, 'answerCallbackQuery', {
      callback_query_id: p.callbackId,
      text: `이미 ${claim.status} 처리됨`,
      show_alert: true,
    });
    return;
  }

  const newStatus = isApprove ? 'approved' : 'rejected';
  const customerEmail = claim.email || '';
  const rejectReason = isApprove ? null
    : '예약 정보 검증 실패 — 영수증/PNR 정보를 다시 확인해 회신해 주세요.';

  await ref.update({
    status: newStatus,
    reviewedAt: FieldValue.serverTimestamp(),
    reviewedBy: 'telegram_admin',
    ...(rejectReason ? { rejectReason } : {}),
  });

  // 사용자 이메일 발송 — 실패해도 전체 흐름은 진행 (admin이 수동 follow-up 가능).
  let emailNote = '';
  if (customerEmail) {
    try {
      if (isApprove) {
        await sendEmail({
          to: customerEmail,
          subject: '[CocoTrip] 무료 AI 플랜 신청이 승인되었습니다',
          html: buildApproveEmailHtml(),
          text: buildApproveEmailText(),
        });
        emailNote = '✉️ 승인 이메일 발송 완료';
      } else {
        await sendEmail({
          to: customerEmail,
          subject: '[CocoTrip] 무료 AI 플랜 신청 검토 결과',
          html: buildRejectEmailHtml(rejectReason),
          text: buildRejectEmailText(rejectReason),
        });
        emailNote = '✉️ 거부 안내 이메일 발송 완료';
      }
    } catch (err) {
      console.error('[claim-callback] email send failed:', err);
      emailNote = `⚠️ 이메일 발송 실패: ${err.message}`;
    }
  } else {
    emailNote = '⚠️ 이메일 주소 없음 — 수동 연락 필요';
  }

  const statusLine = isApprove ? '✅ <b>승인 처리 완료</b>' : '❌ <b>거부 처리 완료</b>';
  const updatedText =
    `${statusLine}\n` +
    `이메일: <code>${escapeHtmlLocal(customerEmail || '-')}</code>\n` +
    `클레임: <code>${escapeHtmlLocal(claimId)}</code>\n` +
    (rejectReason ? `사유: ${escapeHtmlLocal(rejectReason)}\n` : '') +
    `${emailNote}\n\n` +
    `<i>${new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}</i>`;

  // 원본 메시지 갱신 (버튼 제거 + 처리 결과 표시).
  if (p.messageId) {
    try {
      await callBot(botToken, 'editMessageText', {
        chat_id: p.chatId,
        message_id: p.messageId,
        text: updatedText,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      });
    } catch (err) {
      console.warn('[claim-callback] editMessageText 실패:', err.message);
    }
  }

  await callBot(botToken, 'answerCallbackQuery', {
    callback_query_id: p.callbackId,
    text: isApprove ? '승인 처리 완료' : '거부 처리 완료',
  });
}

function escapeHtmlLocal(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function buildApproveEmailHtml() {
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"></head>
<body style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;background:#f3f4f6;">
  <div style="background:#1a1a2e;border-radius:12px 12px 0 0;padding:24px 28px;text-align:center;">
    <h1 style="color:#C4956A;margin:0;font-size:22px;letter-spacing:2px;">COCOTRIPKR</h1>
  </div>
  <div style="background:#fff;padding:28px;border-radius:0 0 12px 12px;">
    <h2 style="color:#059669;margin-top:0;font-size:18px;">✅ Free AI Plan Approved!</h2>
    <p style="color:#374151;font-size:14px;line-height:1.6;">
      Great news — we verified your CocoTrip booking. Your <strong>free AI travel plan</strong> is on the way.
    </p>
    <div style="background:#f0fdf4;border-left:4px solid #10b981;padding:14px 18px;margin:20px 0;border-radius:6px;">
      <p style="margin:0;color:#065f46;font-size:13px;">
        Our team will deliver your full itinerary by email <strong>within 24 hours</strong>.
        You don't need to do anything else.
      </p>
    </div>
    <p style="color:#6b7280;font-size:12px;margin-top:24px;">
      Questions? Reply to this email or message us via the chat widget at
      <a href="https://cocotripkr.com" style="color:#C4956A;">cocotripkr.com</a>.
    </p>
  </div>
</body></html>`;
}

function buildApproveEmailText() {
  return `Free AI Plan Approved!

Great news — we verified your CocoTrip booking. Your free AI travel plan is on the way.

Our team will deliver your full itinerary by email within 24 hours. You don't need to do anything else.

Questions? Reply to this email or message us at cocotripkr.com.

— CocoTripKR`;
}

function buildRejectEmailHtml(reason) {
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"></head>
<body style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;background:#f3f4f6;">
  <div style="background:#1a1a2e;border-radius:12px 12px 0 0;padding:24px 28px;text-align:center;">
    <h1 style="color:#C4956A;margin:0;font-size:22px;letter-spacing:2px;">COCOTRIPKR</h1>
  </div>
  <div style="background:#fff;padding:28px;border-radius:0 0 12px 12px;">
    <h2 style="color:#374151;margin-top:0;font-size:18px;">Free Plan Claim — More Info Needed</h2>
    <p style="color:#374151;font-size:14px;line-height:1.6;">
      We reviewed your free AI plan request but couldn't verify your booking yet.
    </p>
    <div style="background:#fef3c7;border-left:4px solid #f59e0b;padding:14px 18px;margin:20px 0;border-radius:6px;">
      <p style="margin:0;color:#92400e;font-size:13px;">
        ${escapeHtmlLocal(reason || 'Please reply with additional booking proof.')}
      </p>
    </div>
    <p style="color:#374151;font-size:14px;line-height:1.6;">
      You can simply reply to this email with screenshots/PDFs of your flight + hotel booking
      confirmations, or resubmit at
      <a href="https://cocotripkr.com/planner" style="color:#C4956A;">cocotripkr.com/planner</a>.
    </p>
    <p style="color:#6b7280;font-size:12px;margin-top:24px;">
      Sorry for the extra step — this protects the program for genuine CocoTrip customers.
    </p>
  </div>
</body></html>`;
}

function buildRejectEmailText(reason) {
  return `Free Plan Claim — More Info Needed

We reviewed your free AI plan request but couldn't verify your booking yet.

${reason || 'Please reply with additional booking proof.'}

You can simply reply to this email with screenshots/PDFs of your flight + hotel booking confirmations, or resubmit at cocotripkr.com/planner.

Sorry for the extra step — this protects the program for genuine CocoTrip customers.

— CocoTripKR`;
}
