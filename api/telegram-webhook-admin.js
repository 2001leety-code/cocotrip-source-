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
import { relayAdminReply } from './_shared/chat-relay.js';

export const maxDuration = 15;
export const config = { runtime: 'nodejs' };

const BOT_TAG = 'admin';

const HELP_TEXT = `<b>CocoTrip 관리자 봇</b>

<i>모든 명령은 영문 슬래시 또는 한글 단어로 사용 가능 (인자도 한글 OK)</i>

<b>기본</b>
/start  /help  /id  /status
한글:  시작  도움말  아이디  상태

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

<b>CS 티켓</b>
/cs_list [open|in_progress|resolved|all] — <b>이슈</b> 또는 이슈 open
/cs_add &lt;orderID&gt; &lt;priority&gt; &lt;issue...&gt; — <b>이슈추가 ...</b>
/cs_resolve &lt;ticketId&gt; — <b>이슈해결 ...</b> (또는 해결)

<b>한글 사용 예시</b>
<code>예약</code> → 오늘 예약 목록
<code>매출</code> → 이번 달 매출
<code>기사</code> → 등록 기사 목록
<code>기사추가 1234567890 김기사 스타리아1호</code>
<code>배차 CT-20260502-123 1234567890</code>
<code>이슈추가 CT-20260502-123 high 픽업 30분 지연</code>
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
        await sendBotMessage(botToken, parsed.chatId,
          `✓ 고객에게 전달 완료\n세션: <code>${result.sessionId}</code>`);
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

  // CS 티켓 (인자 선택)
  { re: /^(이슈|이슈목록|씨에스|cs)(?:\s+(.+))?$/i, cmd: '/cs_list', argGroup: 2 },
  { re: /^(이슈추가|이슈 추가|cs추가|cs 추가)\s+(.+)$/i, cmd: '/cs_add', argGroup: 2 },
  { re: /^(이슈해결|이슈 해결|cs해결|cs 해결|해결)\s+(.+)$/i, cmd: '/cs_resolve', argGroup: 2 },

  // 누구 (whois)
  { re: /^(누구|whois)\s+(\d+)$/i, cmd: '/whois', argGroup: 2 },
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
    await callBot(botToken, 'answerCallbackQuery', {
      callback_query_id: p.callbackId,
      text: '관리자봇은 콜백 사용 안 함',
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
    `상품: ${booking.productType || '-'}\n` +
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

  const krwRate = 1380;
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
    lines.push(
      `${stIcon} ${icon} <code>${doc.id.slice(0, 12)}</code>\n` +
      `  ${t.bookingId || '-'} · ${t.customer || '-'}\n` +
      `  ${(t.issue || '').slice(0, 80)}`
    );
  });
  await sendBotMessage(botToken, p.chatId, lines.join('\n'));
}

// /cs_add <orderID> <priority> <issue...>
async function handleCsAdd(botToken, p) {
  if (p.args.length < 3) {
    await sendBotMessage(botToken, p.chatId,
      `사용법: <code>/cs_add &lt;orderID&gt; &lt;priority&gt; &lt;issue...&gt;</code>\n` +
      `priority: <code>low</code> | <code>medium</code> | <code>high</code> | <code>critical</code>\n` +
      `예: <code>/cs_add CT-20260502-123 high 픽업 30분 지연</code>`);
    return;
  }

  const [orderID, priority, ...issueParts] = p.args;
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

  const ref = await db.collection('cs_tickets').add({
    bookingId: orderID,
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
