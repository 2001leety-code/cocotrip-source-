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
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { aggregateAdminSales } from './_shared/adminSalesAggregate.js';
import { sweepExpiredDispatches, computeExpiryDate } from './_shared/dispatch-sweep.js';
import { productDisplayLabel } from './_shared/pricing.js';
import { relayAdminReply } from './_shared/chat-relay.js';
import { sendEmail } from './_send-email.js';
import { USD_TO_KRW } from './_shared/exchange-rate.js';
import { translate } from './_shared/translator.js';
import { sendDispatchToDriver } from './_shared/dispatch-helpers.js';
import { isUnassigned } from './_crons/dispatch-reminder.js';
import { morningBriefingTask } from './_crons/morning-briefing.js';
import { resolveDecision, DECISION_COLLECTION } from './_shared/decisionQueue.js';

export const maxDuration = 15;
export const config = { runtime: 'nodejs' };

const BOT_TAG = 'admin';

// 온디맨드 모닝 브리핑 스로틀 (인메모리, cold start 리셋 허용 — Firestore fan-out 비용/스팸 방지).
//   60초 이내 재호출 시 task 미실행. 시각 비교만 (날짜 헬퍼 아님 — inclusive/exclusive 무관).
let lastBriefingMs = 0;
const BRIEFING_THROTTLE_MS = 60 * 1000;

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
각 봇에서 <code>설명</code> 입력하면 자기 역할 가이드 나옴.

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
전체: <code>도움말</code>

<b>5. 다시 보려면</b>
<code>설명</code>`;

const HELP_TEXT = `<b>CocoTrip 관리자 봇</b>

<i>📖 처음이거나 헷갈리면: <code>설명</code> 입력 (전체 운영 가이드)</i>

<i>명령·인자 모두 한글로 입력하세요.</i>

<b>기본</b>
<code>시작</code> · <code>도움말</code> · <code>설명</code> · <code>아이디</code> · <code>상태</code>

<b>기사 관리</b>
<code>기사</code> — 등록 기사 목록
<code>기사추가 &lt;chatId&gt; &lt;이름&gt; [차종]</code>
<code>기사삭제 &lt;chatId&gt;</code>
<code>기사휴무 &lt;chatId&gt;</code> · <code>기사출근 &lt;chatId&gt;</code>
<code>누구 &lt;chatId&gt;</code> — 기사 정보 + 최근 7일 배차

<b>배차</b>
<code>배차 &lt;예약ID&gt; &lt;기사chatId&gt;</code>

<b>조회</b>
<code>예약</code> · <code>예약 2026-05-15</code> (날짜별)
<code>매출</code> · <code>매출 2026-05</code> (월별)
<code>통계</code> · <code>통계 2026-05</code> (기사별/상품별 분해)
<code>환율</code> — USD↔KRW 즉시 조회

<b>조회 확장</b>
<code>검색 &lt;검색어&gt;</code> — 고객명·예약번호·전화·기사 통합 검색
<code>예약상세 &lt;예약번호&gt;</code> — 1건 전체 정보 + 배차이력
<code>운행</code> · <code>운행 14</code> — 다가오는 운행 (기본 7일)
<code>추이</code> · <code>추이 30</code> — 일별 매출 추이
<code>문의</code> — 미응답 고객·차터 문의
<code>환불</code> — 환불·취소 현황
<code>배차현황</code> — 오늘 배차 수락/거절/대기 분포
<code>대기배차</code> — 기사 응답 대기 중 배차
<code>미배차</code> · <code>미배차 14</code> — 미배정 운행

<b>빠른 예약</b>
<code>빠른예약</code> — 양식 출력 → 채워서 전송

<b>사무실 연동</b>
<code>브리핑</code> — 어제 회사 한 장 즉시
<code>결정</code> — 대기 결정 승인/거절

<b>CS 티켓</b>
<code>이슈</code> · <code>이슈 open</code> (상태별)
<code>이슈추가 &lt;예약ID&gt; &lt;우선순위&gt; &lt;내용...&gt;</code>
<code>이슈해결 &lt;티켓ID&gt;</code> (또는 <code>해결 ...</code>)

<b>한글 사용 예시</b>
<code>예약</code> → 오늘 예약 목록
<code>매출</code> → 이번 달 매출
<code>기사</code> → 등록 기사 목록
<code>기사추가 1234567890 김기사 스타리아1호</code>
<code>배차 CT-20260502-123 1234567890</code>
<code>이슈추가 CT-20260502-123 high 픽업 30분 지연</code>
<code>해결 abc123def456</code>
<code>누구 1234567890</code>

<i>(기존 영문 슬래시 명령도 그대로 작동합니다.)</i>`;

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

  // 🔴 chat_id fail-closed (prod, 2026-06-13 ADM-1): TELEGRAM_CHAT_ID 미설정은 미스컨피그 →
  //   prod 에선 모든 chat 거부(어드민 명령이 pin 없이 누구에게나 열리던 fail-open 차단).
  //   설정 시 불일치 chat 거부(현행). dev/preview 만 미설정 통과(로컬). 알림이 이 chat 으로
  //   가므로 prod 에선 항상 설정됨 = 정상 동작 무변경. (webhook secret 대안 — 봇 토큰 불필요.)
  const adminChatId = process.env.TELEGRAM_CHAT_ID;
  if (!adminChatId) {
    if (String(process.env.VERCEL_ENV) === 'production') {
      console.error(`[${BOT_TAG}-webhook] TELEGRAM_CHAT_ID unset in prod — rejecting all`);
      res.status(200).json({ ok: true });
      return;
    }
  } else if (String(parsed.chatId) !== String(adminChatId)) {
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

  // 조회 확장 (읽기 전용) — '예약 상세'가 '예약'(/bookings)보다 먼저 매칭되도록 앞에 배치
  { re: /^(검색|찾기)\s+(.+)$/i, cmd: '/search', argGroup: 2 },
  { re: /^(예약상세|예약 상세|상세보기)\s+(.+)$/i, cmd: '/booking', argGroup: 2 },
  { re: /^(운행|다가오는운행|다가오는 운행|예정운행|예정 운행)(?:\s+(.+))?$/i, cmd: '/upcoming', argGroup: 2 },
  { re: /^(추이|매출추이|매출 추이)(?:\s+(.+))?$/i, cmd: '/trend', argGroup: 2 },
  { re: /^(문의|미응답문의|미응답 문의|고객문의|고객 문의)(?:\s+(.+))?$/i, cmd: '/inquiries', argGroup: 2 },
  { re: /^(환불|환불현황|환불 현황|취소현황|취소 현황)(?:\s+(.+))?$/i, cmd: '/refunds', argGroup: 2 },

  // 배차 운영 조회 (읽기 전용) — 인자 없음. '배차현황'은 인자 필수인 '배차'(/dispatch)와 충돌 안 함.
  { re: /^(배차현황|오늘배차|오늘 배차)$/, cmd: '/today_dispatch', argGroup: -1 },
  { re: /^(대기배차|응답대기|대기 배차|응답 대기)$/, cmd: '/pending_dispatch', argGroup: -1 },
  { re: /^(미배차|미배정|미배차예약)(?:\s+(.+))?$/, cmd: '/unassigned', argGroup: 2 },

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

  // 빠른 예약
  { re: /^(빠른예약|빠른 예약|퀵예약|퀵북|quick_book)$/i, cmd: '/quick_book', argGroup: -1 },

  // 사무실 연동 (읽기/상태기록 — 인자 없음)
  { re: /^(브리핑|브리핑지금|모닝브리핑|모닝 브리핑)$/, cmd: '/briefing', argGroup: -1 },
  { re: /^(결정|결정큐|의사결정|결정 큐|승인대기)$/, cmd: '/decisions', argGroup: -1 },
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
    const data = p.callbackData || '';
    if (data.startsWith('claim_approve:') || data.startsWith('claim_reject:')) {
      await handleClaimCallback(botToken, p);
      return;
    }
    if (data.startsWith('qb_confirm:') || data.startsWith('qb_cancel:') || data.startsWith('qb_dispatch:')) {
      await handleQuickBookCallback(botToken, p);
      return;
    }
    // 의사결정 큐 승인/거절 — 새 네임스페이스(dec:). status flip 만(자동실행 없음).
    if (data.startsWith('dec:')) {
      await handleDecisionCallback(botToken, p);
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
        `<code>도움말</code> 입력하면 명령어 목록이 나옵니다.`);
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

    case '/quick_book':
      await handleQuickBook(botToken, p);
      break;

    case '/search':
      await handleSearchCommand(botToken, p);
      break;

    case '/booking':
      await handleBookingDetailCommand(botToken, p);
      break;

    case '/upcoming':
      await handleUpcomingCommand(botToken, p);
      break;

    case '/trend':
      await handleTrendCommand(botToken, p);
      break;

    case '/inquiries':
      await handleInquiriesCommand(botToken, p);
      break;

    case '/refunds':
      await handleRefundsCommand(botToken, p);
      break;

    case '/today_dispatch':
      await handleTodayDispatchCommand(botToken, p);
      break;

    case '/pending_dispatch':
      await handlePendingDispatchCommand(botToken, p);
      break;

    case '/unassigned':
      await handleUnassignedCommand(botToken, p);
      break;

    case '/briefing':
      await handleBriefingCommand(botToken, p);
      break;

    case '/decisions':
      await handleDecisionsCommand(botToken, p);
      break;

    default:
      // 빠른 예약 양식 응답 처리 — "예약:" 접두어로 시작하는 텍스트
      if (p.text && p.text.trimStart().startsWith('예약:')) {
        await handleQuickBookInput(botToken, p, p.text);
        return;
      }
      if (p.text) {
        await sendBotMessage(botToken, p.chatId,
          `입력: ${p.text}\n\n명령어 목록은 <code>도움말</code> 입력.`);
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
      `1. 기사가 기사봇에 <code>아이디</code> 입력 후 chat_id 확인\n` +
      `2. <code>기사추가 &lt;chatId&gt; &lt;이름&gt; [차종]</code>`);
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
      `사용법: <code>기사추가 &lt;chatId&gt; &lt;이름&gt; [차종]</code>\n` +
      `예: <code>기사추가 1234567890 김기사 스타리아1호</code>`);
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
      `정보 수정은 <code>기사삭제</code> 후 다시 등록 또는 Firestore Console에서 직접.`);
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
    await sendBotMessage(botToken, p.chatId, `사용법: <code>기사삭제 &lt;chatId&gt;</code>`);
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
      `사용법: <code>${active ? '기사출근' : '기사휴무'} &lt;chatId&gt;</code>`);
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
      `사용법: <code>배차 &lt;예약ID&gt; &lt;기사chatId&gt;</code>\n` +
      `예: <code>배차 CT-20260502-123 1234567890</code>`);
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
      `<code>기사</code> 로 등록된 기사 확인`);
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
      `날짜 형식 오류. <code>YYYY-MM-DD</code> 형태로 입력.\n예: <code>예약 2026-05-15</code>`);
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

// ─────────────────────────────────────────────────────────────────────────────
// 조회 확장 명령 (전부 읽기 전용 — 환불/캡처/송금 등 금융 자동실행 없음.
//   어드민 chat_id fail-closed 게이트로 운영자 본인만 접근 → PII 노출 안전.)
// ─────────────────────────────────────────────────────────────────────────────

// 텔레그램 4096자 제한 가드 (기존 handleBookingsCommand 패턴 공용화)
function truncTelegram(text) {
  return text.length > 3900 ? text.slice(0, 3900) + '\n...(잘림)' : text;
}

// createdAt(Timestamp|string|epoch) → epoch ms (admin-sales.js bookingDateMs 와 동일 규약)
function bookingCreatedMs(b) {
  if (!b || !b.createdAt) return null;
  if (typeof b.createdAt.toDate === 'function') return b.createdAt.toDate().getTime();
  if (typeof b.createdAt === 'string') return new Date(b.createdAt).getTime();
  if (b.createdAt._seconds) return b.createdAt._seconds * 1000;
  return null;
}

// 'YYYY-MM-DD' + N일 → 'YYYY-MM-DD'.
// 컨벤션: 반환값은 운행 조회의 **inclusive** 상한으로 사용 (today..addDaysKst(today,N) 양끝 포함).
// 즉 N=0 이면 오늘 하루(inclusive), N=7 이면 오늘~7일 뒤까지 8일분(inclusive). exclusive 아님.
function addDaysKst(isoDate, n) {
  const d = new Date(isoDate + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// Firestore Timestamp|string|epoch → 경과 시간(시간 단위) | null
function ageHours(ts, nowMs) {
  let ms = null;
  if (ts && typeof ts.toMillis === 'function') ms = ts.toMillis();
  else if (typeof ts === 'string') ms = new Date(ts).getTime();
  else if (ts && ts._seconds) ms = ts._seconds * 1000;
  return ms ? Math.round((nowMs - ms) / 3600000) : null;
}

// /search <검색어> — 고객명·예약번호·이메일·전화·기사명 통합 검색 (최근 500건 + 기사 전수)
async function handleSearchCommand(botToken, p) {
  const query = (p.args || []).join(' ').trim();
  if (!query || query.length < 2) {
    await sendBotMessage(botToken, p.chatId,
      `사용법: <code>검색 &lt;검색어&gt;</code>\n` +
      `예: <code>검색 김철수</code> · <code>검색 CT-2026</code> · <code>검색 010-1234</code>`);
    return;
  }
  const db = initAdminDb('telegram-admin');
  if (!db) throw new Error('Firestore unavailable');

  const q = query.toLowerCase();
  const matches = [];

  // 예약번호로 보이면 단건 doc 직접 조회 (오래된 건도 잡음)
  if (/^ct-/i.test(query)) {
    try {
      const direct = await db.collection('bookings').doc(query).get();
      if (direct.exists) matches.push({ id: direct.id, ...direct.data() });
    } catch { /* ignore */ }
  }

  // 최근 bookings 스캔 (읽기비용 가드: createdAt desc 500건, 부분일치는 Firestore 불가→인메모리)
  const snap = await db.collection('bookings').orderBy('createdAt', 'desc').limit(500).get();
  snap.forEach((doc) => {
    if (matches.some((m) => m.id === doc.id)) return;
    const b = doc.data();
    const hay = [
      doc.id, b.payerName, b.customerName,
      b.userEmail, b.payerEmail, b.customerEmail,
      b.customerPhone, b.phone,
    ].map((v) => String(v || '').toLowerCase()).join(' | ');
    if (hay.includes(q)) matches.push({ id: doc.id, ...b });
  });

  // 기사명 검색 (drivers 소량 — 전수)
  const driverHits = [];
  const driverSnap = await db.collection('drivers').get();
  driverSnap.forEach((doc) => {
    const d = doc.data();
    if (String(d.name || '').toLowerCase().includes(q) || doc.id.includes(query)) {
      driverHits.push({ id: doc.id, ...d });
    }
  });

  if (matches.length === 0 && driverHits.length === 0) {
    await sendBotMessage(botToken, p.chatId,
      `🔍 "<b>${escapeHtmlLocal(query)}</b>" 검색 결과 없음.\n(최근 500건 예약 + 기사 기준)`);
    return;
  }

  const lines = [`🔍 "<b>${escapeHtmlLocal(query)}</b>" 검색 결과`, ''];
  if (matches.length) {
    lines.push(`<b>예약 ${matches.length}건</b>`);
    matches.slice(0, 15).forEach((b) => {
      lines.push(
        `<code>${b.id.slice(0, 20)}</code> · ${b.tourDate || '-'}\n` +
        `  ${b.payerName || b.customerName || b.userEmail || '-'} · ${b.productType || '-'} · $${b.amountUSD || '0'}`
      );
    });
    if (matches.length > 15) lines.push(`… 외 ${matches.length - 15}건`);
    lines.push('');
  }
  if (driverHits.length) {
    lines.push(`<b>기사 ${driverHits.length}명</b>`);
    driverHits.slice(0, 10).forEach((d) => {
      lines.push(`<code>${d.id}</code> · ${d.name || '?'} · ${d.vehicle || '-'}`);
    });
    lines.push('');
  }
  lines.push(`상세: <code>예약상세 &lt;예약번호&gt;</code>`);
  await sendBotMessage(botToken, p.chatId, truncTelegram(lines.join('\n')));
}

// /booking <orderID> — 단일 예약 상세 + 배차 이력 (읽기 전용)
async function handleBookingDetailCommand(botToken, p) {
  const orderID = (p.args[0] || '').trim();
  if (!orderID) {
    await sendBotMessage(botToken, p.chatId,
      `사용법: <code>예약상세 &lt;예약번호&gt;</code>\n예: <code>예약상세 CT-20260502-123</code>`);
    return;
  }
  const db = initAdminDb('telegram-admin');
  if (!db) throw new Error('Firestore unavailable');

  const snap = await db.collection('bookings').doc(orderID).get();
  if (!snap.exists) {
    await sendBotMessage(botToken, p.chatId,
      `예약 없음: <code>${escapeHtmlLocal(orderID)}</code>\n(<code>검색 &lt;고객명&gt;</code>으로 찾아보세요)`);
    return;
  }
  const b = snap.data();
  const status = b.adminStatus || b.status || '-';
  const lines = [
    `<b>예약 상세</b> <code>${snap.id}</code>`,
    ``,
    `상태: <b>${status}</b>`,
    `상품: ${b.productType || '-'}`,
    `투어일: ${b.tourDate || '-'}${b.tourTime ? ' ' + b.tourTime : ''}`,
    `인원: ${b.paxCount || '?'}명`,
    `고객: ${b.payerName || b.customerName || '-'}`,
    `연락처: ${b.customerPhone || b.phone || '-'}`,
    `이메일: ${b.userEmail || b.payerEmail || b.customerEmail || '-'}`,
    `픽업: ${b.pickupLocation || '-'}`,
    `드롭: ${b.dropoffLocation || '-'}`,
    b.flightNumber ? `항공편: ${b.flightNumber}` : null,
    `금액: $${b.amountUSD || '0'}`,
    b.memo ? `메모: ${String(b.memo).slice(0, 300)}` : null,
    `배차: ${b.driver ? `${b.driver} (${b.dispatchStatus || '-'})` : '미배정'}`,
  ].filter(Boolean);

  // 배차 이력 (doc id 가 {orderID}_{driverChatId} 라 where 로 조회)
  try {
    const dispSnap = await db.collection('dispatch_messages').where('orderID', '==', orderID).get();
    if (!dispSnap.empty) {
      const hist = [];
      dispSnap.forEach((d) => hist.push(d.data()));
      hist.sort((a, b2) => {
        const am = a.sentAt && a.sentAt.toMillis ? a.sentAt.toMillis() : 0;
        const bm = b2.sentAt && b2.sentAt.toMillis ? b2.sentAt.toMillis() : 0;
        return bm - am;
      });
      lines.push('');
      lines.push(`<b>배차 이력 (${hist.length})</b>`);
      hist.slice(0, 8).forEach((h) => {
        const icon = h.status === 'accepted' ? '✓' : h.status === 'rejected' ? '✗' : h.status === 'expired' ? '⌛' : '●';
        lines.push(`${icon} ${h.driverName || h.driverChatId || '-'} · ${h.status || '-'}`);
      });
    }
  } catch { /* 배차 조회 실패는 무시 (본문은 표시) */ }

  await sendBotMessage(botToken, p.chatId, truncTelegram(lines.join('\n')));
}

// /upcoming [일수|오늘|내일] — 다가오는 운행 (기본 7일) (읽기 전용)
async function handleUpcomingCommand(botToken, p) {
  let days = 7;
  const arg = (p.args[0] || '').trim();
  if (/^\d+$/.test(arg)) days = Math.min(Math.max(parseInt(arg, 10), 0), 60);
  else if (/^(오늘|today)$/i.test(arg)) days = 0;
  else if (/^(내일|tomorrow)$/i.test(arg)) days = 1;

  const db = initAdminDb('telegram-admin');
  if (!db) throw new Error('Firestore unavailable');

  const today = todayKstDate();
  const until = addDaysKst(today, days);

  let snap;
  try {
    // tourDate 범위 = today(inclusive) ~ until(inclusive). 둘 다 '>='/'<=' 라 양끝 포함.
    // 단일 필드(tourDate) range 라 composite index 불필요.
    snap = await db.collection('bookings')
      .where('tourDate', '>=', today)
      .where('tourDate', '<=', until)
      .get();
  } catch (err) {
    await sendBotMessage(botToken, p.chatId, `운행 조회 실패: ${escapeHtmlLocal(err.message)}`);
    return;
  }

  // status 는 대/소문자·빈값 혼재(CONFIRMED/confirmed/legacy) → lowercase 후 취소만 제외
  const rows = [];
  snap.forEach((doc) => {
    const b = doc.data();
    const st = (b.adminStatus || b.status || '').toLowerCase();
    if (st === 'canceled' || st === 'cancelled') return;
    rows.push({ id: doc.id, ...b });
  });
  rows.sort((a, b2) => String(a.tourDate).localeCompare(String(b2.tourDate)));

  if (rows.length === 0) {
    await sendBotMessage(botToken, p.chatId, `📅 ${today} ~ ${until} 예정 운행 없음.`);
    return;
  }

  const lines = [`📅 <b>다가오는 운행 (${today} ~ ${until}, ${rows.length}건)</b>`, ''];
  let curDate = '';
  rows.forEach((b) => {
    if (b.tourDate !== curDate) { curDate = b.tourDate; lines.push(`<b>${curDate}</b>`); }
    const driverInfo = b.driver ? `🚗 ${b.driver}` : '⚠️ 미배차';
    lines.push(
      ` <code>${b.id.slice(0, 18)}</code> ${b.tourTime || ''}\n` +
      `   ${b.productType || '-'} · ${b.paxCount || '?'}명 · ${b.payerName || b.customerName || '-'} · ${driverInfo}\n` +
      `   픽업: ${b.pickupLocation || '-'}`
    );
  });
  await sendBotMessage(botToken, p.chatId, truncTelegram(lines.join('\n')));
}

// /trend [일수] — 일별 매출 추이 (기본 30, 7~90). SSOT=aggregateAdminSales (테스트/취소 제외 동일)
async function handleTrendCommand(botToken, p) {
  const days = Math.min(Math.max(parseInt((p.args[0] || '30'), 10) || 30, 7), 90);

  const db = initAdminDb('telegram-admin');
  if (!db) throw new Error('Firestore unavailable');

  const now = new Date(Date.now() + 9 * 60 * 60 * 1000); // todayKST (admin-sales.js 동일 규약)
  const sinceCutoff = new Date(now);
  sinceCutoff.setUTCDate(sinceCutoff.getUTCDate() - days);

  let snap;
  try {
    snap = await db.collection('bookings')
      .where('createdAt', '>=', Timestamp.fromDate(sinceCutoff))
      .get();
  } catch (err) {
    await sendBotMessage(botToken, p.chatId, `추이 조회 실패: ${escapeHtmlLocal(err.message)}`);
    return;
  }

  const rawAll = [];
  snap.forEach((doc) => {
    const b = doc.data();
    rawAll.push({ id: doc.id, ...b, _createdAtMs: bookingCreatedMs(b) });
  });

  const agg = aggregateAdminSales(rawAll, { now, days });
  const daily = agg.daily || [];

  // 추세 = 전반 절반 합 vs 후반 절반 합
  const half = Math.floor(daily.length / 2);
  const firstSum = daily.slice(0, half).reduce((s, d) => s + d.usd, 0);
  const lastSum = daily.slice(half).reduce((s, d) => s + d.usd, 0);
  const trendIcon = lastSum > firstSum * 1.1 ? '📈 상승' : lastSum < firstSum * 0.9 ? '📉 하락' : '➡️ 보합';

  const totalUsd = daily.reduce((s, d) => s + d.usd, 0);
  const totalCnt = daily.reduce((s, d) => s + d.count, 0);

  const lines = [
    `📊 <b>일별 매출 추이 (최근 ${days}일)</b>`,
    ``,
    `합계: <b>$${totalUsd.toFixed(2)}</b> · ${totalCnt}건 · ${trendIcon}`,
    `(테스트·취소 제외 — 손익 SSOT 동일 기준)`,
    ``,
  ];
  // 최근 14일만 막대 (너무 길면 잘림)
  const recentDays = daily.slice(-14);
  const maxUsd = Math.max(1, ...recentDays.map((d) => d.usd));
  recentDays.forEach((d) => {
    const barLen = Math.round((d.usd / maxUsd) * 10);
    const bar = '█'.repeat(barLen) + '░'.repeat(Math.max(0, 10 - barLen));
    lines.push(`${d.date.slice(5)} ${bar} $${d.usd.toFixed(0)} (${d.count})`);
  });
  await sendBotMessage(botToken, p.chatId, truncTelegram(lines.join('\n')));
}

// /inquiries — 미응답 문의 (cs_tickets open/in_progress + charter_inquiries pending/NEW)
async function handleInquiriesCommand(botToken, p) {
  const db = initAdminDb('telegram-admin');
  if (!db) throw new Error('Firestore unavailable');

  const csOpen = [];
  try {
    const csSnap = await db.collection('cs_tickets')
      .where('status', 'in', ['open', 'in_progress']).limit(50).get();
    csSnap.forEach((doc) => csOpen.push({ id: doc.id, ...doc.data() }));
  } catch { /* graceful */ }

  // 차터 문의: writer 2종 — 인앱 모달='pending', 버스/VIP inquiry-submit='NEW'.
  //   'pending'만 매칭하면 버스/VIP 문의 전량 누락 → 반드시 ['pending','NEW'] in 매칭.
  const charterOpen = [];
  try {
    const chSnap = await db.collection('charter_inquiries')
      .where('status', 'in', ['pending', 'NEW']).limit(50).get();
    chSnap.forEach((doc) => charterOpen.push({ id: doc.id, ...doc.data() }));
  } catch { /* graceful */ }

  const nowMs = Date.now();
  csOpen.sort((a, b) => (ageHours(b.createdAt, nowMs) || 0) - (ageHours(a.createdAt, nowMs) || 0));
  charterOpen.sort((a, b) => (ageHours(b.createdAt, nowMs) || 0) - (ageHours(a.createdAt, nowMs) || 0));

  const total = csOpen.length + charterOpen.length;
  if (total === 0) {
    await sendBotMessage(botToken, p.chatId, `💬 미응답 문의 없음. 👍`);
    return;
  }

  const lines = [`💬 <b>미응답 문의 ${total}건</b>`, ''];
  if (csOpen.length) {
    lines.push(`<b>CS 티켓 ${csOpen.length}건</b> (오래된 순)`);
    csOpen.slice(0, 15).forEach((t) => {
      const h = ageHours(t.createdAt, nowMs);
      const aged = h != null ? (h >= 24 ? ` ⏰${h}h` : ` ${h}h`) : '';
      const icon = t.priority === 'critical' ? '🔴' : t.priority === 'high' ? '🟠' : '⚪';
      lines.push(` ${icon} <code>${t.id.slice(0, 12)}</code> ${t.customer || t.bookingId || '-'}${aged}\n   ${String(t.issue || '').slice(0, 60)}`);
    });
    lines.push('');
  }
  if (charterOpen.length) {
    lines.push(`<b>차터 견적 문의 ${charterOpen.length}건</b>`);
    charterOpen.slice(0, 15).forEach((c) => {
      const h = ageHours(c.createdAt, nowMs);
      const aged = h != null ? ` ${h}h` : '';
      lines.push(` 🚐 <code>${c.id.slice(0, 12)}</code> ${c.name || c.customerName || '-'}${aged}\n   ${String(c.message || c.notes || c.route || '').slice(0, 60)}`);
    });
  }
  await sendBotMessage(botToken, p.chatId, truncTelegram(lines.join('\n')));
}

// /refunds [일수] — 환불·취소 현황 (기본 90, 7~365) (읽기 전용)
async function handleRefundsCommand(botToken, p) {
  const days = Math.min(Math.max(parseInt((p.args[0] || '90'), 10) || 90, 7), 365);

  const db = initAdminDb('telegram-admin');
  if (!db) throw new Error('Firestore unavailable');

  const sinceCutoff = new Date(Date.now() + 9 * 60 * 60 * 1000);
  sinceCutoff.setUTCDate(sinceCutoff.getUTCDate() - days);

  let snap;
  try {
    snap = await db.collection('bookings')
      .where('createdAt', '>=', Timestamp.fromDate(sinceCutoff))
      .get();
  } catch (err) {
    await sendBotMessage(botToken, p.chatId, `환불 조회 실패: ${escapeHtmlLocal(err.message)}`);
    return;
  }

  // status 대문자 enum: CANCELED/CANCELLED, REFUNDED/PARTIALLY_REFUNDED/REFUND_PENDING.
  //   환불액은 refundedKRW(KRW) — USD 직접 필드 없음.
  const canceled = [];
  const refunded = [];
  let refundKRW = 0;
  snap.forEach((doc) => {
    const b = doc.data();
    const st = String(b.adminStatus || b.status || '').toUpperCase();
    if (st === 'CANCELED' || st === 'CANCELLED') {
      canceled.push({ id: doc.id, ...b });
    } else if (st.includes('REFUND')) {
      refunded.push({ id: doc.id, ...b });
      refundKRW += Number(b.refundedKRW || 0);
    }
  });

  if (canceled.length === 0 && refunded.length === 0) {
    await sendBotMessage(botToken, p.chatId, `💸 최근 ${days}일 환불·취소 없음.`);
    return;
  }

  const lines = [
    `💸 <b>환불·취소 현황 (최근 ${days}일)</b>`,
    ``,
    `취소: <b>${canceled.length}건</b>`,
    `환불: <b>${refunded.length}건</b> · 환불액 <b>₩${refundKRW.toLocaleString()}</b>`,
    ``,
  ];
  if (refunded.length) {
    lines.push(`<b>환불 내역</b>`);
    refunded.slice(0, 12).forEach((b) => {
      lines.push(` <code>${b.id.slice(0, 18)}</code> · ₩${Number(b.refundedKRW || 0).toLocaleString()} · ${String(b.refundReason || b.cancelReason || '-').slice(0, 40)}`);
    });
    lines.push('');
  }
  if (canceled.length) {
    lines.push(`<b>취소 내역</b>`);
    canceled.slice(0, 12).forEach((b) => {
      lines.push(` <code>${b.id.slice(0, 18)}</code> · ${String(b.cancelReason || '-').slice(0, 40)}`);
    });
  }
  await sendBotMessage(botToken, p.chatId, truncTelegram(lines.join('\n')));
}

// /today_dispatch — 오늘(KST) 발송된 배차 분포 (status별 + 기사별 집계) (읽기 전용)
async function handleTodayDispatchCommand(botToken, p) {
  const db = initAdminDb('telegram-admin');
  if (!db) throw new Error('Firestore unavailable');

  // todayKstDate()는 'YYYY-MM-DD' 문자열이라 Timestamp 쿼리에 못 씀.
  // KST 자정의 실제 UTC 시각을 직접 계산해 sentAt(Timestamp) range 쿼리.
  const kstNow = new Date(Date.now() + 9 * 60 * 60 * 1000);
  const realKstMidnightMs = Date.UTC(kstNow.getUTCFullYear(), kstNow.getUTCMonth(), kstNow.getUTCDate()) - 9 * 60 * 60 * 1000;

  let snap;
  try {
    snap = await db.collection('dispatch_messages')
      .where('sentAt', '>=', new Date(realKstMidnightMs))
      .get();
  } catch (err) {
    await sendBotMessage(botToken, p.chatId, `배차현황 조회 실패: ${escapeHtmlLocal(err.message)}`);
    return;
  }

  if (snap.empty) {
    await sendBotMessage(botToken, p.chatId, `🚖 오늘(${todayKstDate()}) 발송된 배차 없음.`);
    return;
  }

  const counts = { sent: 0, accepted: 0, rejected: 0, expired: 0 };
  // driverChatId(문자열) → { name, sent, accepted, rejected, expired }. plain object 사용
  // (Map.set 은 읽기전용 가드 정규식 /\.set\(/ 에 걸리므로 의도적으로 회피).
  const byDriver = {};
  snap.forEach((doc) => {
    const d = doc.data();
    const st = d.status || 'sent';
    if (counts[st] !== undefined) counts[st]++;
    const key = d.driverChatId != null ? String(d.driverChatId) : '?';
    if (!byDriver[key]) byDriver[key] = { name: d.driverName || key, sent: 0, accepted: 0, rejected: 0, expired: 0 };
    const entry = byDriver[key];
    if (entry[st] !== undefined) entry[st]++;
    if ((!entry.name || entry.name === key) && d.driverName) entry.name = d.driverName;
  });

  const lines = [
    `🚖 <b>오늘 배차 현황 (${todayKstDate()}, 총 ${snap.size}건)</b>`,
    ``,
    `수락 ${counts.accepted} · 거절 ${counts.rejected} · 대기 ${counts.sent} · 만료 ${counts.expired}`,
    ``,
    `<b>기사별</b>`,
  ];
  const driversSorted = Object.values(byDriver)
    .sort((a, b) => (b.sent + b.accepted + b.rejected + b.expired) - (a.sent + a.accepted + a.rejected + a.expired));
  driversSorted.forEach((d) => {
    const tot = d.sent + d.accepted + d.rejected + d.expired;
    lines.push(` 🚗 ${d.name}: ${tot}건 (수락 ${d.accepted}·거절 ${d.rejected}·대기 ${d.sent}·만료 ${d.expired})`);
  });
  await sendBotMessage(botToken, p.chatId, truncTelegram(lines.join('\n')));
}

// /pending_dispatch — 지금 기사 응답 대기 중(status='sent') 배차 + 만료까지 남은 시간 (읽기 전용)
async function handlePendingDispatchCommand(botToken, p) {
  const db = initAdminDb('telegram-admin');
  if (!db) throw new Error('Firestore unavailable');

  let snap;
  try {
    snap = await db.collection('dispatch_messages')
      .where('status', '==', 'sent')
      .get();
  } catch (err) {
    await sendBotMessage(botToken, p.chatId, `대기배차 조회 실패: ${escapeHtmlLocal(err.message)}`);
    return;
  }

  if (snap.empty) {
    await sendBotMessage(botToken, p.chatId, `⏳ 응답 대기 중인 배차 없음. 👍`);
    return;
  }

  const nowMs = Date.now();
  const rows = [];
  snap.forEach((doc) => {
    const d = doc.data();
    const expMs = (d.expiresAt && typeof d.expiresAt.toMillis === 'function') ? d.expiresAt.toMillis() : 0;
    const remainMin = expMs ? Math.round((expMs - nowMs) / 60000) : 0;
    rows.push({
      orderID: d.orderID || doc.id,
      driverName: d.driverName || (d.driverChatId != null ? String(d.driverChatId) : '?'),
      expMs,
      remainMin,
    });
  });
  // 만료 임박순 (expiresAt 오름차순). expiresAt 없으면(0) 맨 뒤로.
  rows.sort((a, b) => (a.expMs || Infinity) - (b.expMs || Infinity));

  const lines = [`⏳ <b>응답 대기 중 배차 (${rows.length}건)</b>`, ''];
  rows.forEach((r) => {
    const remainLabel = r.remainMin > 0 ? `남은 ${r.remainMin}분` : (r.expMs ? '만료 임박' : '만료시각 미상');
    lines.push(` <code>${String(r.orderID).slice(0, 20)}</code> · ${r.driverName} · ${remainLabel}`);
  });
  await sendBotMessage(botToken, p.chatId, truncTelegram(lines.join('\n')));
}

// /unassigned [일수] — 다가오는 운행 중 기사 미배정 (기본 7일, 1~30 clamp) (읽기 전용)
//   isUnassigned SSOT = dispatch-reminder cron 과 동일 판정. 쿼리도 fetchUnassignedBookings 와 동일 패턴.
async function handleUnassignedCommand(botToken, p) {
  let days = 7;
  const arg = (p.args[0] || '').trim();
  if (/^\d+$/.test(arg)) days = Math.min(Math.max(parseInt(arg, 10), 1), 30);

  const db = initAdminDb('telegram-admin');
  if (!db) throw new Error('Firestore unavailable');

  // tourDate 범위 = today(inclusive) ~ until(inclusive). 둘 다 '>='/'<=' 라 양끝 포함.
  const today = todayKstDate();
  const until = addDaysKst(today, days);

  let snap;
  try {
    // dispatch-reminder fetchUnassignedBookings 와 동일 쿼리 (status+tourDate composite index 재사용).
    // 인덱스 미존재/오류 시 graceful (dispatch-reminder.js L73-77 패턴).
    snap = await db.collection('bookings')
      .where('status', '==', 'CONFIRMED')
      .where('tourDate', '>=', today)
      .where('tourDate', '<=', until)
      .get();
  } catch (err) {
    await sendBotMessage(botToken, p.chatId, `미배차 조회 실패: ${escapeHtmlLocal(err.message)}`);
    return;
  }

  const rows = [];
  snap.forEach((doc) => {
    const b = doc.data();
    if (!isUnassigned(b)) return;
    rows.push({
      id: doc.id,
      bookingRef: b.bookingRef || doc.id,
      customerName: b.payerName || b.customerName || '-',
      productType: b.productType || b.product || '-',
      tourDate: b.tourDate || '-',
      paxCount: b.paxCount || '?',
    });
  });
  rows.sort((a, b) => String(a.tourDate).localeCompare(String(b.tourDate)));

  if (rows.length === 0) {
    await sendBotMessage(botToken, p.chatId, `✅ ${today} ~ ${until} 미배정 운행 없음. 👍`);
    return;
  }

  const lines = [`⚠️ <b>미배정 운행 (${today} ~ ${until}, ${rows.length}건)</b>`, ''];
  let curDate = '';
  rows.forEach((b) => {
    if (b.tourDate !== curDate) { curDate = b.tourDate; lines.push(`<b>${curDate}</b>`); }
    lines.push(` <code>${String(b.bookingRef).slice(0, 20)}</code> · ${b.customerName} · ${b.productType} · ${b.paxCount}명`);
  });
  await sendBotMessage(botToken, p.chatId, truncTelegram(lines.join('\n')));
}

// /sales [YYYY-MM] — 월별 매출 요약
async function handleSalesCommand(botToken, p) {
  const month = p.args[0] || thisMonthKst();
  if (!/^\d{4}-\d{2}$/.test(month)) {
    await sendBotMessage(botToken, p.chatId,
      `형식 오류. <code>YYYY-MM</code> 형태로 입력.\n예: <code>매출 2026-05</code>`);
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
      `형식 오류. <code>YYYY-MM</code> 형태로 입력.\n예: <code>통계 2026-05</code>`);
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
      `사용법: <code>이슈추가 &lt;예약ID&gt; &lt;우선순위&gt; &lt;내용...&gt; [plan:&lt;planId&gt;]</code>\n` +
      `우선순위: <code>low</code> | <code>medium</code> | <code>high</code> | <code>critical</code>\n` +
      `예: <code>이슈추가 CT-20260502-123 high 픽업 30분 지연</code>\n` +
      `예: <code>이슈추가 CT-20260502-123 high plan:abc123 음식 알레르기 누락</code>`);
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
      `인자 부족 (예약ID 우선순위 내용 필요).\n` +
      `예: <code>이슈추가 CT-20260502-123 high plan:abc123 픽업 지연</code>`);
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
      `사용법: <code>누구 &lt;chatId&gt;</code>\n` +
      `예: <code>누구 1234567890</code>`);
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
      `등록: <code>기사추가 ${chatId} 이름 차량</code>`);
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
      `사용법: <code>이슈해결 &lt;티켓ID&gt;</code> (또는 <code>해결 ...</code>)\n` +
      `티켓ID는 <code>이슈</code>로 확인 (앞 12자리만 입력 가능 — fullId 우선)`);
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
// ─────────────────────────────────────────────────────────────────────────────
// 사무실 연동 — 온디맨드 모닝 브리핑 + 의사결정 큐 [승인/거절]
//   안전선: 금융/발행/배포 자동실행 없음. 브리핑=순수 집계 발송, 결정=status flip 만.
// ─────────────────────────────────────────────────────────────────────────────

// /briefing — cron(08:30) 안 기다리고 "어제 회사 한 장" 즉시. AI 0원(순수 집계).
//   morningBriefingTask 가 내부에서 운영자 텔레그램으로 직접 발송(send-type)하므로
//   여기서는 task 호출만 — 별도 본문 재전송 금지(중복 발송 방지).
async function handleBriefingCommand(botToken, p) {
  const nowMs = Date.now();
  const sinceMs = nowMs - lastBriefingMs;
  if (lastBriefingMs > 0 && sinceMs < BRIEFING_THROTTLE_MS) {
    const agoSec = Math.round(sinceMs / 1000);
    await sendBotMessage(botToken, p.chatId,
      `⏳ 방금 생성됨 (${agoSec}초 전). 잠시 후 다시 시도해 주세요.`);
    return;
  }
  // 짧은 ack 1개(생성 시간 동안 무응답 방지) — task 가 본문을 별도 발송.
  await sendBotMessage(botToken, p.chatId, '📊 브리핑 생성 중...');
  lastBriefingMs = nowMs; // task 실행 직전에 갱신 (동시 재호출 스로틀).
  try {
    await morningBriefingTask();
  } catch (err) {
    console.error('[briefing] task 실패:', err.message);
    await sendBotMessage(botToken, p.chatId, `⚠️ 브리핑 생성 실패: ${escapeHtmlLocal(err.message)}`);
  }
}

// /decisions — pending 결정 목록을 각 건마다 [승인/거절] 인라인 버튼으로 발송 (읽기).
//   실제 status 변경은 콜백(handleDecisionCallback)에서 resolveDecision 만 호출.
async function handleDecisionsCommand(botToken, p) {
  const db = initAdminDb('telegram-admin');
  if (!db) throw new Error('Firestore unavailable');

  const snap = await db.collection(DECISION_COLLECTION)
    .where('status', '==', 'pending').limit(20).get();

  if (snap.empty) {
    await sendBotMessage(botToken, p.chatId, '📥 대기 중 결정 없음 👍');
    return;
  }

  await sendBotMessage(botToken, p.chatId, `📥 <b>승인/거절 대기 ${snap.size}건</b>`);

  // 각 결정마다 별도 메시지 + 인라인 키보드. callback_data='dec:{id}:{action}'.
  //   Firestore auto-id(~20자)면 'dec:{id}:approve'(~32바이트) — 64바이트 한도 안전.
  for (const doc of snap.docs) {
    const d = doc.data() || {};
    const title = truncTelegram(String(d.title || '(제목 없음)').slice(0, 200));
    const typeLine = d.type ? `\n유형: <code>${escapeHtmlLocal(String(d.type))}</code>` : '';
    const summaryLine = d.summary ? `\n${escapeHtmlLocal(String(d.summary).slice(0, 200))}` : '';
    await sendBotMessage(botToken, p.chatId,
      `• <b>${escapeHtmlLocal(title)}</b>${typeLine}${summaryLine}`,
      {
        replyMarkup: {
          inline_keyboard: [[
            { text: '✓ 승인', callback_data: `dec:${doc.id}:approve` },
            { text: '✕ 거절', callback_data: `dec:${doc.id}:reject` },
          ]],
        },
      });
  }
}

// dec:{id}:{action} 콜백 — 승인/거절. resolveDecision(status flip) 외 다운스트림
//   동작(발행/환불/배포/이메일 등) 절대 트리거 금지. 멱등: 이미 pending 아니면 no-op.
async function handleDecisionCallback(botToken, p) {
  const data = p.callbackData || '';
  const parts = data.split(':'); // dec:{id}:{action}
  const id = parts[1];
  const action = parts[2];

  if (!id || (action !== 'approve' && action !== 'reject')) {
    await callBot(botToken, 'answerCallbackQuery', {
      callback_query_id: p.callbackId, text: '잘못된 결정 데이터', show_alert: true,
    });
    return;
  }

  const db = initAdminDb('telegram-admin-decision');
  if (!db) {
    await callBot(botToken, 'answerCallbackQuery', {
      callback_query_id: p.callbackId, text: 'Firestore 연결 실패', show_alert: true,
    });
    return;
  }

  const ref = db.collection(DECISION_COLLECTION).doc(id);
  const snap = await ref.get();
  if (!snap.exists) {
    await callBot(botToken, 'answerCallbackQuery', {
      callback_query_id: p.callbackId, text: '결정을 찾을 수 없음', show_alert: true,
    });
    return;
  }

  const decision = snap.data() || {};
  // 멱등: 이미 처리됨(pending 아님)이면 no-op (중복 클릭 보호, handleClaimCallback 패턴 차용).
  if (decision.status && decision.status !== 'pending') {
    await callBot(botToken, 'answerCallbackQuery', {
      callback_query_id: p.callbackId, text: `이미 ${decision.status} 처리됨`, show_alert: true,
    });
    return;
  }

  const isApprove = action === 'approve';
  const newStatus = isApprove ? 'approved' : 'rejected';

  // ⚠️ status flip 만 — 발행/환불/배포/이메일 등 자동실행 절대 추가 금지.
  const result = await resolveDecision(db, id, newStatus);
  if (!result || !result.ok) {
    await callBot(botToken, 'answerCallbackQuery', {
      callback_query_id: p.callbackId,
      text: `처리 실패: ${(result && result.reason) || 'unknown'}`,
      show_alert: true,
    });
    return;
  }

  const title = escapeHtmlLocal(String(decision.title || '(제목 없음)').slice(0, 200));
  const statusLabel = isApprove ? '✓ 승인 처리됨' : '✕ 거절 처리됨';

  // 원본 메시지 갱신 (버튼 제거 + 처리 결과 표시).
  if (p.messageId) {
    try {
      await callBot(botToken, 'editMessageText', {
        chat_id: p.chatId,
        message_id: p.messageId,
        text: `${statusLabel} — ${title}\n<i>${new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}</i>`,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      });
    } catch (err) {
      console.warn('[decision-callback] editMessageText 실패:', err.message);
    }
  }

  await callBot(botToken, 'answerCallbackQuery', {
    callback_query_id: p.callbackId,
    text: isApprove ? '승인됨' : '거절됨',
  });
}

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

// ─────────────────────────────────────────────────────────────────────────────
// W6 — /quick_book 빠른 예약 등록
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Step 1: 양식 출력
 */
async function handleQuickBook(botToken, p) {
  const formText =
    `📋 <b>빠른 예약 등록 — 양식 복사해서 채워주세요</b>\n` +
    `\n` +
    `예약:\n` +
    `[필수]\n` +
    `서비스: airport_transfer    ← day_tour/multi_day/kpop_shuttle\n` +
    `차종: staria                ← sprinter/bus/vip\n` +
    `출발: 명동\n` +
    `도착: 인천공항\n` +
    `날짜: 2026-07-08\n` +
    `시각: 18:00\n` +
    `성인: 2 / 아동: 0\n` +
    `손님: 혜미\n` +
    `연락처: 010-\n` +
    `\n` +
    `[공항픽업만]\n` +
    `터미널: T1\n` +
    `편명: KE085\n` +
    `캐리어: S 2 / M 1 / L 0\n` +
    `\n` +
    `[선택]\n` +
    `옵션:                       ← guide/picket/childseat/night\n` +
    `숙소(다일):\n` +
    `메모:\n` +
    `\n` +
    `또는 자연어로 한 줄:\n` +
    `<code>예약: 7월 8일 18시 혜미 명동→인천공항 T1 KE085 성인 2 캐리어 S2 M1</code>`;
  await sendBotMessage(botToken, p.chatId, formText);
}

/**
 * Step 2: 운영자 입력 수신 → Gemini 파싱 → 검증 → 확인 keyboard 발송
 *
 * 진입 조건: 텍스트가 "예약:" 로 시작
 */
async function handleQuickBookInput(botToken, p, rawText) {
  await sendBotMessage(botToken, p.chatId, '⏳ 예약 정보 파싱 중...');

  let parsed;
  try {
    parsed = await geminiParseBookingInput(rawText);
  } catch (err) {
    await sendBotMessage(botToken, p.chatId, `❌ 파싱 실패: ${escapeHtmlLocal(err.message)}\n\n입력 형식을 확인해 주세요.`);
    return;
  }

  // 필수 필드 검증
  const missing = validateQuickBookFields(parsed);
  if (missing.length > 0) {
    await sendBotMessage(botToken, p.chatId,
      `⚠️ 필수 정보 누락:\n• ${missing.join('\n• ')}\n\n` +
      `다시 채워서 <code>예약:</code> 로 시작하는 텍스트를 보내주세요.`);
    return;
  }

  // 캐리어 7개 가드 (batch 6 W5 정책)
  const luggage = parsed.luggage || {};
  const totalLuggage = (luggage.small || 0) + (luggage.medium || 0) + (luggage.large || 0);
  if (totalLuggage > 7) {
    await sendBotMessage(botToken, p.chatId,
      `⚠️ 캐리어 총 ${totalLuggage}개 — 최대 7개까지 가능합니다.\n` +
      `S:${luggage.small || 0} + M:${luggage.medium || 0} + L:${luggage.large || 0} = ${totalLuggage}개`);
    return;
  }

  // 12h cutoff 검증
  if (parsed.date && parsed.time) {
    const { isPastCutoff } = await import('./_shared/booking-cutoff.js');
    const past = isPastCutoff(parsed.date, parsed.time, parsed.service || 'airport_transfer', 1);
    if (past) {
      await sendBotMessage(botToken, p.chatId,
        `⚠️ 마감 경고: ${parsed.date} ${parsed.time} KST 출발은 12시간 이내입니다.\n` +
        `긴급 배차가 필요하면 계속 진행하세요. [확인] 버튼으로 강제 등록 가능.`);
      // 경고만 — 등록 자체는 허용 (어드민 직접 등록이므로)
    }
  }

  // 이름 한글 → 영문 자동 변환
  let nameEn = null;
  const customerName = parsed.customerName || '';
  if (customerName && /[가-힯]/.test(customerName)) {
    try {
      const translated = await translate(customerName, 'en');
      if (translated && translated !== customerName) nameEn = translated;
    } catch { /* silent — 원문 유지 */ }
  }

  // 견적 계산
  const estimate = calcQuickBookEstimate(parsed);

  // 확인 메시지 조립
  const dayOfWeek = getDayOfWeek(parsed.date);
  const confirmText = buildConfirmText(parsed, nameEn, estimate, dayOfWeek, totalLuggage);

  // 임시 pending 데이터를 Firestore에 저장 (callback 시 조회)
  const db = initAdminDb('quick-book');
  if (!db) {
    await sendBotMessage(botToken, p.chatId, '❌ Firestore 연결 실패');
    return;
  }

  const pendingRef = db.collection('quick_book_pending').doc();
  await pendingRef.set({
    parsedData: parsed,
    nameEn: nameEn || null,
    estimate,
    rawText,
    createdAt: FieldValue.serverTimestamp(),
    chatId: p.chatId,
  });

  const pendingId = pendingRef.id;

  await callBot(botToken, 'sendMessage', {
    chat_id: p.chatId,
    text: confirmText,
    parse_mode: 'HTML',
    disable_web_page_preview: true,
    reply_markup: {
      inline_keyboard: [[
        { text: '✅ 확인 + 배차', callback_data: `qb_confirm:${pendingId}` },
        { text: '✏️ 수정', callback_data: `qb_cancel:edit` },
        { text: '❌ 취소', callback_data: `qb_cancel:abort` },
      ]],
    },
  });
}

/**
 * Gemini로 자연어/양식 → JSON 파싱
 */
async function geminiParseBookingInput(rawText) {
  const { GoogleGenerativeAI } = await import('@google/generative-ai');
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY 미설정');

  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({
    model: 'gemini-2.5-flash',
    generationConfig: {
      temperature: 0.1,
      maxOutputTokens: 512,
      thinkingConfig: { thinkingBudget: 0 },
      responseMimeType: 'application/json',
    },
  });

  const today = todayKstDate();
  const prompt = `You are a Korean tour booking assistant. Extract booking information from this operator input.

Input (Korean or mixed):
${rawText}

Extract and return EXACTLY this JSON (no explanation, no markdown):
{
  "service": "airport_transfer",
  "vehicle": "staria",
  "from": "",
  "to": "",
  "date": "YYYY-MM-DD",
  "time": "HH:mm",
  "adultCount": 1,
  "childCount": 0,
  "customerName": "",
  "customerPhone": "",
  "terminal": "",
  "flightNumber": "",
  "luggage": { "small": 0, "medium": 0, "large": 0 },
  "options": [],
  "hotelAddress": "",
  "notes": ""
}

Rules:
- service: one of airport_transfer / day_tour / multi_day / kpop_shuttle. Default: airport_transfer.
- vehicle: one of staria / sprinter / bus / vip. Default: staria.
- date: absolute YYYY-MM-DD. Today is ${today}. "7월 8일" = "2026-07-08".
- time: 24h HH:mm. "오후 6시" = "18:00", "18시" = "18:00".
- customerPhone: preserve as-is (010-...).
- terminal: T1 or T2 (Incheon default), or as given.
- luggage: S=small M=medium L=large. "S2 M1" → {"small":2,"medium":1,"large":0}.
- options: list from [guide, picket, childseat, night].
- If a field is not mentioned, use default value (empty string or 0 or []).
- ONLY return valid JSON. No explanation.`;

  const result = await model.generateContent(prompt);
  const text = (result.response.text() || '').trim();
  // Strip markdown code fences if any
  const clean = text.replace(/^```json?\s*/i, '').replace(/```\s*$/i, '').trim();

  let parsed;
  try {
    parsed = JSON.parse(clean);
  } catch {
    // 두 번째 시도: JSON 블록 추출
    const m = clean.match(/\{[\s\S]*\}/);
    if (!m) throw new Error(`Gemini 응답 파싱 불가: ${clean.slice(0, 200)}`);
    parsed = JSON.parse(m[0]);
  }
  return parsed;
}

/**
 * 필수 필드 검증 → 누락 목록 반환
 */
function validateQuickBookFields(parsed) {
  const missing = [];
  if (!parsed.from) missing.push('출발지 (from)');
  if (!parsed.to) missing.push('도착지 (to)');
  if (!parsed.date || !/^\d{4}-\d{2}-\d{2}$/.test(parsed.date)) missing.push('날짜 (YYYY-MM-DD)');
  if (!parsed.time || !/^\d{2}:\d{2}$/.test(parsed.time)) missing.push('시각 (HH:mm)');
  if (!parsed.customerName) missing.push('손님 이름');
  return missing;
}

/**
 * 견적 계산 (charter pricing 준용)
 * Staria: 기본 50,000 + km×2,000 / Sprinter: 100,000 + km×4,000 / Bus/VIP: 협의
 * 공항 고정 견적: staria 150,000 / sprinter 250,000
 */
function calcQuickBookEstimate(parsed) {
  const service = (parsed.service || '').toLowerCase();
  const vehicle = (parsed.vehicle || 'staria').toLowerCase();
  const pax = (parsed.adultCount || 1) + (parsed.childCount || 0);

  // 공항 픽업/드롭 — 고정 요금
  if (service === 'airport_transfer' || /공항/.test(parsed.from || '') || /공항/.test(parsed.to || '')) {
    if (vehicle === 'staria') return 150_000;
    if (vehicle === 'sprinter') return 250_000;
    return null; // bus/vip → 협의
  }

  // 당일 투어 — vehicleAndPrice 기준 단가
  if (service === 'day_tour' || service === 'multi_day') {
    if (vehicle === 'staria') return pax <= 8 ? 330_000 : 450_000;
    if (vehicle === 'sprinter') return 450_000;
    return null;
  }

  // K-pop 셔틀
  if (service === 'kpop_shuttle') return pax * 45_000;

  // fallback
  if (vehicle === 'staria') return 150_000;
  if (vehicle === 'sprinter') return 250_000;
  return null;
}

/**
 * 요일 문자열 (한국어)
 */
function getDayOfWeek(dateStr) {
  if (!dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return '';
  const days = ['(일)', '(월)', '(화)', '(수)', '(목)', '(금)', '(토)'];
  const d = new Date(`${dateStr}T12:00:00+09:00`);
  if (isNaN(d.getTime())) return '';
  return days[d.getDay()];
}

/**
 * 확인 메시지 텍스트 조립
 */
function buildConfirmText(parsed, nameEn, estimate, dayOfWeek, totalLuggage) {
  const luggage = parsed.luggage || {};
  const pax = (parsed.adultCount || 1) + (parsed.childCount || 0);
  const nameLine = nameEn
    ? `${escapeHtmlLocal(parsed.customerName)} (${escapeHtmlLocal(nameEn)})`
    : escapeHtmlLocal(parsed.customerName || '-');
  const vehicleLabel = {
    staria: 'Staria', sprinter: 'Sprinter', bus: '버스', vip: 'VIP 리무진',
  }[parsed.vehicle?.toLowerCase()] || parsed.vehicle || 'Staria';
  const luggageLine = totalLuggage > 0
    ? `S${luggage.small || 0} M${luggage.medium || 0} L${luggage.large || 0} (총 ${totalLuggage}개)`
    : '없음';
  const estimateLine = estimate != null
    ? `₩${estimate.toLocaleString('ko-KR')}`
    : '협의 (bus/vip)';
  const terminalLine = parsed.terminal ? ` ${parsed.terminal}` : '';
  const flightLine = parsed.flightNumber ? ` ${parsed.flightNumber}` : '';
  const optionsLine = parsed.options?.length ? parsed.options.join(', ') : '-';
  const notesLine = parsed.notes ? `\n📝 메모: ${escapeHtmlLocal(parsed.notes)}` : '';

  return (
    `📋 <b>예약 확인</b>\n\n` +
    `📅 ${parsed.date} ${dayOfWeek} ${parsed.time}\n` +
    `👤 ${nameLine}  ${escapeHtmlLocal(parsed.customerPhone || '')}\n` +
    `📍 ${escapeHtmlLocal(parsed.from || '-')} → ${escapeHtmlLocal(parsed.to || '-')}${terminalLine}${flightLine}\n` +
    `👥 성인 ${parsed.adultCount || 1}명` + (parsed.childCount ? ` / 아동 ${parsed.childCount}명` : '') + `\n` +
    `🧳 캐리어: ${luggageLine}\n` +
    `🚐 ${vehicleLabel}\n` +
    (parsed.options?.length ? `✨ 옵션: ${optionsLine}\n` : '') +
    `💰 견적: ${estimateLine}` +
    notesLine + `\n\n` +
    `<i>어드민 등록 시 자동 confirmed 처리됩니다.</i>`
  );
}

/**
 * Step 3: 콜백 처리 (확인/취소/배차)
 */
async function handleQuickBookCallback(botToken, p) {
  const data = p.callbackData || '';

  // 취소 (수정 or 중단)
  if (data.startsWith('qb_cancel:')) {
    const reason = data === 'qb_cancel:edit' ? '✏️ 수정 요청' : '❌ 예약 취소됨';
    if (p.messageId) {
      try {
        await callBot(botToken, 'editMessageText', {
          chat_id: p.chatId,
          message_id: p.messageId,
          text: `${reason}\n\n<code>빠른예약</code> 으로 다시 시작하세요.`,
          parse_mode: 'HTML',
        });
      } catch {}
    }
    await callBot(botToken, 'answerCallbackQuery', {
      callback_query_id: p.callbackId,
      text: reason,
    });
    return;
  }

  // 배차 선택
  if (data.startsWith('qb_dispatch:')) {
    const parts = data.split(':'); // qb_dispatch:{bookingId}:{driverChatId}
    const bookingId = parts[1];
    const driverChatId = parts[2];

    if (!bookingId || !driverChatId || driverChatId === 'later') {
      await callBot(botToken, 'answerCallbackQuery', {
        callback_query_id: p.callbackId,
        text: driverChatId === 'later' ? '⏭️ 배차를 나중에 처리합니다.' : '잘못된 데이터',
      });
      return;
    }

    const db = initAdminDb('quick-book-dispatch');
    if (!db) {
      await callBot(botToken, 'answerCallbackQuery', {
        callback_query_id: p.callbackId, text: 'Firestore 오류', show_alert: true,
      });
      return;
    }

    const bookingSnap = await db.collection('bookings').doc(bookingId).get();
    if (!bookingSnap.exists) {
      await callBot(botToken, 'answerCallbackQuery', {
        callback_query_id: p.callbackId, text: '예약을 찾을 수 없음', show_alert: true,
      });
      return;
    }

    const result = await sendDispatchToDriver({
      orderID: bookingId,
      booking: bookingSnap.data(),
      driverChatId,
    });

    if (result.ok) {
      await callBot(botToken, 'answerCallbackQuery', { callback_query_id: p.callbackId, text: '✅ 배차 발송 완료' });
      if (p.messageId) {
        const driverSnap = await db.collection('drivers').doc(String(driverChatId)).get();
        const driverName = driverSnap.exists ? (driverSnap.data()?.name || driverChatId) : driverChatId;
        try {
          await callBot(botToken, 'editMessageText', {
            chat_id: p.chatId,
            message_id: p.messageId,
            text: `✅ 배차 발송 완료\n예약: <code>${bookingId}</code>\n기사: ${escapeHtmlLocal(driverName)}`,
            parse_mode: 'HTML',
          });
        } catch {}
      }
    } else {
      await callBot(botToken, 'answerCallbackQuery', {
        callback_query_id: p.callbackId,
        text: `배차 실패: ${result.error}`,
        show_alert: true,
      });
    }
    return;
  }

  // 확인 (qb_confirm:{pendingId})
  if (data.startsWith('qb_confirm:')) {
    const pendingId = data.split(':')[1];

    const db = initAdminDb('quick-book-confirm');
    if (!db) {
      await callBot(botToken, 'answerCallbackQuery', {
        callback_query_id: p.callbackId, text: 'Firestore 오류', show_alert: true,
      });
      return;
    }

    const pendingSnap = await db.collection('quick_book_pending').doc(pendingId).get();
    if (!pendingSnap.exists) {
      await callBot(botToken, 'answerCallbackQuery', {
        callback_query_id: p.callbackId, text: '만료된 요청 (5분 초과 또는 이미 처리됨)', show_alert: true,
      });
      return;
    }

    const { parsedData, nameEn, estimate } = pendingSnap.data() || {};
    const pd = parsedData || {};

    // Firestore 예약 생성
    const timestamp = Date.now();
    const bookingRef = `ADMIN-QUICK-${timestamp}`;
    const luggage = pd.luggage || {};
    const totalLuggage = (luggage.small || 0) + (luggage.medium || 0) + (luggage.large || 0);
    const pax = (pd.adultCount || 1) + (pd.childCount || 0);

    const bookingData = {
      bookingRef,
      status: 'confirmed',
      adminStatus: 'CONFIRMED',
      paymentMethod: 'admin-quick-book',
      productType: pd.service || 'airport_transfer',
      vehicleType: pd.vehicle || 'staria',
      tourDate: pd.date || '',
      pickupTime: pd.time || '',
      pickupLocation: pd.from || '',
      dropoffLocation: pd.to || '',
      paxCount: pax,
      adultCount: pd.adultCount || 1,
      childCount: pd.childCount || 0,
      customerName: pd.customerName || '',
      customerNameEn: nameEn || null,
      customerPhone: pd.customerPhone || '',
      terminal: pd.terminal || null,
      flightNumber: pd.flightNumber || null,
      luggageSmall: luggage.small || 0,
      luggageMedium: luggage.medium || 0,
      luggageLarge: luggage.large || 0,
      luggageTotal: totalLuggage,
      options: pd.options || [],
      hotelAddress: pd.hotelAddress || null,
      memo: pd.notes || null,
      estimateKRW: estimate || null,
      amountUSD: estimate ? Math.ceil(estimate / (USD_TO_KRW || 1380) * 100) / 100 : null,
      source: 'admin-quick-book',
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    };

    const newBookingRef = db.collection('bookings').doc(bookingRef);
    await newBookingRef.set(bookingData);

    // pending 정리
    await pendingSnap.ref.delete().catch(() => {});

    // 메시지 업데이트
    if (p.messageId) {
      try {
        await callBot(botToken, 'editMessageText', {
          chat_id: p.chatId,
          message_id: p.messageId,
          text: `✅ <b>예약 등록 완료</b>\n<code>${bookingRef}</code>`,
          parse_mode: 'HTML',
        });
      } catch {}
    }

    await callBot(botToken, 'answerCallbackQuery', {
      callback_query_id: p.callbackId,
      text: '✅ 예약 등록 완료',
    });

    // 배차 prompt — 기사 목록 조회
    let dispatchKeyboard;
    try {
      const driversSnap = await db.collection('drivers').where('active', '==', true).get();
      // active 필드 없는 레거시 호환 — 전체 fetch
      let driverDocs = driversSnap.empty
        ? (await db.collection('drivers').get()).docs.filter((d) => d.data().active !== false)
        : driversSnap.docs;

      // 최대 4명만 버튼 (telegram inline_keyboard row 제한)
      driverDocs = driverDocs.slice(0, 4);

      if (driverDocs.length > 0) {
        const buttons = driverDocs.map((d) => ({
          text: `🚗 ${d.data().name || d.id}`,
          callback_data: `qb_dispatch:${bookingRef}:${d.id}`,
        }));
        buttons.push({ text: '⏭️ 나중에', callback_data: `qb_dispatch:${bookingRef}:later` });
        dispatchKeyboard = {
          inline_keyboard: [buttons.slice(0, 3), buttons.slice(3)].filter((r) => r.length > 0),
        };
      }
    } catch (e) {
      console.warn('[quick_book] driver fetch failed:', e.message);
    }

    await callBot(botToken, 'sendMessage', {
      chat_id: p.chatId,
      text:
        `✅ <b>예약 등록 완료</b> (<code>${bookingRef}</code>)\n\n배차할까요?`,
      parse_mode: 'HTML',
      reply_markup: dispatchKeyboard || {
        inline_keyboard: [[
          { text: '⏭️ 나중에', callback_data: `qb_dispatch:${bookingRef}:later` },
        ]],
      },
    });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// (end W6)
// ─────────────────────────────────────────────────────────────────────────────

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
