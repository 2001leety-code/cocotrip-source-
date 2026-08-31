/**
 * POST /api/inquiry-submit
 *
 * Bus 차량 선택 시 노출되는 상담 폼 제출. (vip 선택지 제거 2026-06-30.)
 * 2026-07-02: 투어 페이지 맞춤형 투어 문의(vehicle='tour_custom') 추가 —
 *   region/theme/budget/whatsapp 필드, 이메일 또는 전화 중 하나 필수, 날짜/상세 선택.
 * 2026-08-31: PlanDetail 차터 참고견적 문의(vehicle='charter') 추가 —
 *   plan 접근권한 확인 후 서버 가격표와 플랜 원본으로 금액·투어·일정을 재산출.
 * Firestore `charter_inquiries/{inquiryId}` 저장 + InquiryCHAT_BOT 채널 알림.
 *
 * Body:
 *   {
 *     name, email, phone?, whatsapp?, eventDate, pax,
 *     vehicle: 'bus' | 'tour_custom' | 'charter',
 *     details, region?, theme?, budget?,
 *     planId?, accessToken?, expectedTourKey?, expectedAmountKRW?, expectedHours?,
 *     language: 'ko'|'en'|'ja'|'zh',
 *     wizardSnapshot: { origin, service, destinationKey, destinationCustom }
 *   }
 *
 * 응답: { success: true, inquiryId } / 400 / 500
 *
 * 인증 옵션 — Bearer 토큰 있으면 uid 매칭 (없어도 신청 허용 — 비로그인 외국인 사용자 우선).
 *
 * 텔레그램 알림 채널 (PR-F 분리, 2026-05-08):
 *   InquiryCHAT_BOT — 운영자 본인 채널과 별도. 사양:
 *     bot token  fallback: TELEGRAM_INQUIRY_BOT_TOKEN → INQUIRY_BOT_TOKEN → TELEGRAM_BOT_TOKEN
 *     chat id    fallback: TELEGRAM_INQUIRY_CHAT_ID → INQUIRY_CHAT_ID → TELEGRAM_CHAT_ID
 *   둘 다 dedicated 키 등록되면 Inquiry 봇이 별도 채널로 보낸다. 미설정 시 운영자 채널 폴백.
 */
import { captureError } from './_shared/sentry.js';
import { initAdminDb } from './_shared/firebase-admin.js';
import { FieldValue } from 'firebase-admin/firestore';
import { detectAndTranslate } from './_shared/translator.js';
import { checkIpRateLimit, getClientIp } from './_shared/ip-rate-limit.js';
import { verifyFirebaseIdentityToken } from './_shared/user-auth.js';
import {
  INQUIRY_AUTO_ACK_ELIGIBILITY_VERSION,
  INQUIRY_SUBMISSION_PROVENANCE,
} from './_shared/inquiry-auto-ack-constants.js';
import { validInquiryResponseEmail } from './_shared/inquiry-email.js';
import {
  buildPlanInquiryContext,
  canAccessPlanForInquiry,
  resolvePlanInquiryQuote,
} from './_shared/inquiry-quote.js';

const TELEGRAM_API = 'https://api.telegram.org';

/**
 * Inquiry 전용 토큰/chat_id 해석 — 4단계 fallback.
 * TELEGRAM_INQUIRY_* (1순위) → INQUIRY_* (2순위) → TELEGRAM_* (3순위, 운영자 본인 채널 폴백)
 */
function resolveInquiryChannel() {
  const token =
    process.env.TELEGRAM_INQUIRY_BOT_TOKEN ||
    process.env.INQUIRY_BOT_TOKEN ||
    process.env.TELEGRAM_BOT_TOKEN ||
    null;
  const chatId =
    process.env.TELEGRAM_INQUIRY_CHAT_ID ||
    process.env.INQUIRY_CHAT_ID ||
    process.env.TELEGRAM_CHAT_ID ||
    null;
  // 어느 변수에서 해석됐는지 디버그 로그용 — 운영자가 분리 상태 확인 가능.
  const tokenSource = process.env.TELEGRAM_INQUIRY_BOT_TOKEN ? 'TELEGRAM_INQUIRY_BOT_TOKEN'
    : process.env.INQUIRY_BOT_TOKEN ? 'INQUIRY_BOT_TOKEN'
    : process.env.TELEGRAM_BOT_TOKEN ? 'TELEGRAM_BOT_TOKEN(fallback)'
    : 'none';
  const chatSource = process.env.TELEGRAM_INQUIRY_CHAT_ID ? 'TELEGRAM_INQUIRY_CHAT_ID'
    : process.env.INQUIRY_CHAT_ID ? 'INQUIRY_CHAT_ID'
    : process.env.TELEGRAM_CHAT_ID ? 'TELEGRAM_CHAT_ID(fallback)'
    : 'none';
  return { token, chatId, tokenSource, chatSource };
}

async function notifyInquiry(text) {
  const { token, chatId, tokenSource, chatSource } = resolveInquiryChannel();
  if (!token || !chatId) {
    console.warn('[inquiry-submit] InquiryCHAT_BOT not configured — token:', tokenSource, 'chat:', chatSource);
    return { ok: false, error: 'no_token_or_chat' };
  }
  try {
    const res = await fetch(`${TELEGRAM_API}/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      }),
    });
    const data = await res.json();
    if (!data.ok) {
      console.error('[inquiry-submit] Telegram error:', data.description, '— token:', tokenSource, 'chat:', chatSource);
      return { ok: false, error: data.description };
    }
    console.log('[inquiry-submit] notified InquiryCHAT_BOT — token:', tokenSource, 'chat:', chatSource, 'msgId:', data.result?.message_id);
    return { ok: true, messageId: data.result?.message_id };
  } catch (err) {
    console.error('[inquiry-submit] notify fetch failed:', err.message);
    return { ok: false, error: err.message };
  }
}

export const config = { runtime: 'nodejs' };
export const maxDuration = 15;

const JSON_HEADERS = {
  'Content-Type': 'application/json',
  'Cache-Control': 'no-store',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

// 2026-06-30: vip 선택지 제거 → 신규 협의 폼은 bus 만 허용. (과거 vip 예약 레코드 표시는 별도 라벨로 보존.)
// 2026-07-02: tour_custom 추가 — 투어 페이지 맞춤형 투어 견적 문의 (결제 없음, 상담만).
const ALLOWED_VEHICLES = new Set(['bus', 'tour_custom', 'charter']);
const ALLOWED_LANGS = new Set(['ko', 'en', 'ja', 'zh']);

function _err(error, code = 'UNKNOWN_ERROR') {
  return { success: false, error, code };
}

function genInquiryId() {
  // INQ-YYYYMMDD-XXXX (4자리 random)
  const d = new Date();
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  const rand = Math.floor(1000 + Math.random() * 9000);
  return `INQ-${yyyy}${mm}${dd}-${rand}`;
}

function isAlreadyExistsError(err) {
  const code = err && err.code;
  return code === 6 || code === '6' || code === 'already-exists' || code === 'ALREADY_EXISTS';
}

async function createInquiryWithoutOverwrite(adminDb, data) {
  let collisionError = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const inquiryId = genInquiryId();
    try {
      await adminDb.collection('charter_inquiries').doc(inquiryId).create({
        ...data,
        inquiryId,
      });
      return inquiryId;
    } catch (err) {
      if (!isAlreadyExistsError(err)) throw err;
      collisionError = err;
    }
  }
  const error = new Error('Could not allocate inquiry id');
  error.cause = collisionError;
  throw error;
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.writeHead(200, JSON_HEADERS);
    return res.end();
  }
  if (req.method !== 'POST') {
    res.writeHead(405, JSON_HEADERS);
    return res.end(JSON.stringify(_err('POST only', 'METHOD_NOT_ALLOWED')));
  }

  try {
    let body = req.body;
    if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
    body = body || {};

    const {
      name = '',
      email = '',
      phone = '',
      whatsapp = '',
      eventDate = '',
      pax,
      vehicle = '',
      details = '',
      region = '',
      theme = '',
      budget = '',
      travelStyle = '',
      duration = '',
      language = 'en',
      wizardSnapshot = null,
      planId = '',
      accessToken = '',
      expectedTourKey = '',
      expectedAmountKRW,
      expectedHours,
    } = body;

    // 입력 검증 — silent fail X, 명시적 에러 코드.
    // tour_custom (투어 페이지 맞춤 문의): 이메일 또는 전화 중 하나 필수, 날짜/상세는 선택.
    const isTourCustom = String(vehicle) === 'tour_custom';
    const isPlanCharter = String(vehicle) === 'charter';
    const trimmedName = String(name).trim().slice(0, 200);
    const trimmedEmail = String(email).trim().toLowerCase().slice(0, 200);
    const trimmedPhone = String(phone).trim().slice(0, 40);
    const trimmedWhatsapp = String(whatsapp).trim().slice(0, 40);
    const trimmedEventDate = String(eventDate || '').trim().slice(0, 40);
    const trimmedDetails = String(details || '').trim().slice(0, 5000);
    const trimmedRegion = String(region).trim().slice(0, 40);
    const trimmedTheme = String(theme).trim().slice(0, 200);
    const trimmedBudget = String(budget).trim().slice(0, 40);
    const trimmedTravelStyle = String(travelStyle).trim().slice(0, 40);
    const trimmedDuration = String(duration).trim().slice(0, 40);
    const trimmedPlanId = String(planId || '').trim().slice(0, 200);
    const trimmedAccessToken = String(accessToken || '').trim().slice(0, 1000);
    const trimmedExpectedTourKey = String(expectedTourKey || '').trim().slice(0, 80);
    const expectedAmountNum = Number(expectedAmountKRW);
    const expectedHoursNum = Number(expectedHours);
    const normalizedWizardSnapshot = wizardSnapshot && typeof wizardSnapshot === 'object'
      ? {
        origin: String(wizardSnapshot.origin || '').trim().slice(0, 200) || null,
        service: String(wizardSnapshot.service || '').trim().slice(0, 80) || null,
        destinationKey: String(wizardSnapshot.destinationKey || '').trim().slice(0, 120) || null,
        destinationCustom: String(wizardSnapshot.destinationCustom || '').trim().slice(0, 200) || null,
      }
      : null;
    // 문의 유형과 source를 서버에서 묶어 다른 화면 출처로 위장하지 못하게 한다.
    const normalizedSource = isPlanCharter
      ? 'plan_detail_charter_inquiry'
      : isTourCustom
        ? 'tour_custom_modal'
        : 'charter_wizard';

    if (!ALLOWED_VEHICLES.has(String(vehicle))) {
      res.writeHead(400, JSON_HEADERS);
      return res.end(JSON.stringify(_err('vehicle not allowed', 'INVALID_VEHICLE')));
    }
    if (!isPlanCharter && trimmedName.length < 2) {
      res.writeHead(400, JSON_HEADERS);
      return res.end(JSON.stringify(_err('name required (min 2 chars)', 'INVALID_NAME')));
    }
    const normalizedValidEmail = validInquiryResponseEmail(trimmedEmail);
    const emailValid = Boolean(normalizedValidEmail);
    if (isTourCustom) {
      // 이메일 또는 전화 중 하나는 필수 — 입력된 이메일이 형식 불량이면 명시적 거부.
      // 전화는 숫자 5자리 이상(길이만 재면 문자 5자도 유일 연락수단으로 통과).
      if (!emailValid && trimmedPhone.replace(/\D/g, '').length < 5) {
        res.writeHead(400, JSON_HEADERS);
        return res.end(JSON.stringify(_err('email or phone required', 'INVALID_CONTACT')));
      }
      if (trimmedEmail && !emailValid) {
        res.writeHead(400, JSON_HEADERS);
        return res.end(JSON.stringify(_err('email invalid', 'INVALID_EMAIL')));
      }
    } else if (!emailValid) {
      res.writeHead(400, JSON_HEADERS);
      return res.end(JSON.stringify(_err('email required', 'INVALID_EMAIL')));
    }
    if (!isTourCustom && !isPlanCharter) {
      if (!eventDate || typeof eventDate !== 'string') {
        res.writeHead(400, JSON_HEADERS);
        return res.end(JSON.stringify(_err('eventDate required', 'INVALID_DATE')));
      }
    } else if (eventDate && typeof eventDate !== 'string') {
      res.writeHead(400, JSON_HEADERS);
      return res.end(JSON.stringify(_err('eventDate must be string', 'INVALID_DATE')));
    }
    const paxNum = isPlanCharter ? null : Number(pax);
    if (!isPlanCharter && (!Number.isFinite(paxNum) || paxNum < 1 || paxNum > 999)) {
      res.writeHead(400, JSON_HEADERS);
      return res.end(JSON.stringify(_err('pax out of range', 'INVALID_PAX')));
    }
    if (!isTourCustom && !isPlanCharter && trimmedDetails.length < 5) {
      res.writeHead(400, JSON_HEADERS);
      return res.end(JSON.stringify(_err('details too short', 'INVALID_DETAILS')));
    }
    if (isPlanCharter) {
      const rawPlanId = String(planId || '').trim();
      const planIdValid = trimmedPlanId && rawPlanId.length <= 200 && !trimmedPlanId.includes('/');
      if (!planIdValid) {
        res.writeHead(400, JSON_HEADERS);
        return res.end(JSON.stringify(_err('valid planId required', 'INVALID_PLAN_ID')));
      }
      if (!trimmedExpectedTourKey || !Number.isSafeInteger(expectedAmountNum) || expectedAmountNum <= 0 || expectedAmountNum > 100000000 || !Number.isFinite(expectedHoursNum) || expectedHoursNum <= 0 || expectedHoursNum > 24) {
        res.writeHead(400, JSON_HEADERS);
        return res.end(JSON.stringify(_err('displayed quote confirmation required', 'QUOTE_EXPECTATION_REQUIRED')));
      }
    }
    const lang = ALLOWED_LANGS.has(language) ? language : 'en';

    // 옵션 인증 — 헤더가 없으면 게스트, 있으면 Firebase 검증 실패를 익명으로 강등하지 않는다.
    let userId = null;
    let verifiedIdentityEmail = null;
    const authHeader = req.headers?.authorization || req.headers?.Authorization || '';
    if (String(authHeader).trim()) {
      const auth = await verifyFirebaseIdentityToken(req);
      if (!auth.ok) {
        res.writeHead(auth.status || 401, JSON_HEADERS);
        return res.end(JSON.stringify(_err('Invalid sign-in token', 'AUTH_INVALID')));
      }
      userId = auth.uid;
      if (auth.emailVerified === true) {
        verifiedIdentityEmail = validInquiryResponseEmail(auth.email);
      }
    }

    const adminDb = initAdminDb('inquiry-submit');
    if (!adminDb) {
      console.error('[inquiry-submit] Firestore admin unavailable');
      res.writeHead(500, JSON_HEADERS);
      return res.end(JSON.stringify(_err('Firestore unavailable', 'FIRESTORE_UNAVAILABLE')));
    }

    // 비용 DoS 가드 — 무인증(옵션 토큰) + Gemini 번역 + Telegram 발송 + Firestore write.
    // 입력 검증 통과 후, 고비용 작업 전에 per-IP rate-limit.
    const rl = await checkIpRateLimit({
      db: adminDb, ip: getClientIp(req),
      collection: 'inquiry_rate_limits',
      maxRequests: 5, errorLabel: 'inquiry submissions',
    });
    if (!rl.ok) {
      res.writeHead(rl.status, { ...JSON_HEADERS, 'Retry-After': String(rl.retryAfterSec) });
      return res.end(JSON.stringify(_err(rl.error, 'RATE_LIMITED')));
    }
    // PlanDetail 문의는 플랜 원본 조회·알림까지 이어져 rate-limit 장애 시 fail-closed.
    if (isPlanCharter && rl.degraded) {
      res.writeHead(503, { ...JSON_HEADERS, 'Retry-After': '60' });
      return res.end(JSON.stringify(_err('Inquiry protection temporarily unavailable', 'RATE_LIMIT_UNAVAILABLE')));
    }

    let planContext = null;
    let quote = null;
    if (isPlanCharter) {
      const planSnap = await adminDb.collection('plans').doc(trimmedPlanId).get();
      if (!planSnap.exists) {
        res.writeHead(404, JSON_HEADERS);
        return res.end(JSON.stringify(_err('Plan not found', 'PLAN_NOT_FOUND')));
      }
      const plan = planSnap.data() || {};
      if (!canAccessPlanForInquiry(plan, userId, trimmedAccessToken)) {
        res.writeHead(403, JSON_HEADERS);
        return res.end(JSON.stringify(_err('Plan access denied', 'PLAN_ACCESS_DENIED')));
      }

      quote = resolvePlanInquiryQuote(plan);
      if (!quote.ok) {
        const status = quote.code === 'PRICING_UNAVAILABLE' || quote.code === 'PRICING_INVALID' ? 503 : 422;
        res.writeHead(status, JSON_HEADERS);
        return res.end(JSON.stringify(_err('Server quote unavailable for this plan', quote.code)));
      }
      if (quote.tourKey !== trimmedExpectedTourKey || quote.amountKRW !== expectedAmountNum || quote.hours !== expectedHoursNum) {
        res.writeHead(409, JSON_HEADERS);
        return res.end(JSON.stringify({
          ..._err('Displayed quote changed; confirm the current server quote', 'QUOTE_CHANGED'),
          quote,
        }));
      }
      planContext = buildPlanInquiryContext(plan);
    }

    const recipientVerifiedForAutoAck = Boolean(
      normalizedValidEmail && verifiedIdentityEmail === normalizedValidEmail,
    );
    const automaticAckGuardVerified = rl.degraded !== true && recipientVerifiedForAutoAck;
    const inquiryId = await createInquiryWithoutOverwrite(adminDb, {
      name: trimmedName,
      email: trimmedEmail || null,
      phone: trimmedPhone || null,
      whatsapp: trimmedWhatsapp || null,
      eventDate: isPlanCharter ? planContext.eventDate : trimmedEventDate || null,
      pax: isPlanCharter ? planContext.pax : paxNum,
      vehicle: String(vehicle),
      details: isPlanCharter ? '' : trimmedDetails,
      notes: isPlanCharter ? trimmedDetails || null : null,
      region: trimmedRegion || null,
      theme: trimmedTheme || null,
      budget: trimmedBudget || null,
      travelStyle: trimmedTravelStyle || null,
      duration: trimmedDuration || null,
      language: lang,
      wizardSnapshot: isPlanCharter ? null : normalizedWizardSnapshot,
      source: normalizedSource,
      contractVersion: isPlanCharter ? 'inquiry.v2' : 'inquiry.v1',
      // 자동 접수 확인은 이 서버 표식과 정상 rate-limit 판정을 모두 요구한다.
      // 과거 PWA의 익명 Firestore 직접 문서나 보호장치 장애 중 접수된 문서는 수동 처리한다.
      submissionProvenance: INQUIRY_SUBMISSION_PROVENANCE,
      autoAckEligibilityVersion: automaticAckGuardVerified
        ? INQUIRY_AUTO_ACK_ELIGIBILITY_VERSION
        : null,
      rateLimitVerifiedForAutoAck: rl.degraded !== true,
      recipientVerifiedForAutoAck,
      autoAckCandidate: automaticAckGuardVerified,
      userId,
      ...(isPlanCharter ? {
        planId: trimmedPlanId,
        recommendedTour: quote.recommendedTour,
        quotedKRW: quote.amountKRW,
        hours: quote.hours,
        startDate: planContext.startDate,
        dayCount: planContext.dayCount,
        itinerarySummary: planContext.itinerarySummary,
        quote: {
          currency: quote.currency,
          pricingKey: quote.tourKey,
          productType: quote.productType,
          pricingVersion: quote.pricingVersion,
          amountKRW: quote.amountKRW,
          hours: quote.hours,
          provenance: quote.provenance,
          kind: 'reference',
        },
        quoteCalculatedAt: FieldValue.serverTimestamp(),
      } : {}),
      status: 'NEW',
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });

    // 텔레그램 InquiryCHAT_BOT 채널 알림 — 운영자 본인 채널과 분리.
    // 메시지 포맷: 일정 / 인원 / 문의 유형 / 요청사항 / 연락처 / 서버 참고견적 / 제출 시각.
    //
    // 번역(PR-Q): 행사 내용이 한국어가 아니면 Gemini로 한글 번역 추가 (운영자 가독성).
    // 번역 실패는 silent — 원문은 항상 유지.
    try {
      const vehicleLabel = isPlanCharter
        ? '플랜 기반 차터 (차량 확정 전)'
        : isTourCustom
          ? '맞춤형 투어 (Custom Tour)'
          : '대형버스 (Bus)';
      const submittedAt = new Date().toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
      const effectiveDate = isPlanCharter ? planContext.startDate : trimmedEventDate;
      const effectivePax = isPlanCharter ? planContext.pax : paxNum;

      // 행사 내용 한글 번역 시도. (tour_custom 은 요청사항 선택 입력 — 비어 있으면 스킵.)
      // 플랜 차터 메모는 추가 개인정보 외부전송을 피하기 위해 Gemini 번역을 건너뛴다.
      let detailsKo = null;
      let detailsLang = lang;
      let translateFailed = false;
      if (trimmedDetails && !isPlanCharter) {
        try {
          const det = await detectAndTranslate(trimmedDetails, 'ko');
          detailsLang = det.sourceLang || lang;
          if (!det.isOriginal) {
            if (det.translation === null) translateFailed = true;
            else detailsKo = det.translation;
          }
        } catch (e) {
          console.warn('[inquiry-submit] translate failed:', e.message);
          translateFailed = true;
        }
      }

      const detailsTrunc = trimmedDetails.length > 500 ? trimmedDetails.slice(0, 500) + '…' : trimmedDetails;
      const detailsKoTrunc = detailsKo && detailsKo.length > 500 ? detailsKo.slice(0, 500) + '…' : detailsKo;

      // parse_mode HTML 에 사용자 입력 그대로 넣으면 '<' 하나로 Telegram 400 → 알림 통째 유실.
      const esc = (v) => String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

      const lines = [
        isPlanCharter
          ? '🚐 <b>새 플랜 차터 견적 문의</b>'
          : isTourCustom
          ? '🎯 <b>새 맞춤 투어 문의</b>'
          : '📨 <b>새 차터 상담 문의</b>',
        '',
        `<b>문의번호:</b> <code>${inquiryId}</code>`,
        `<b>${isTourCustom || isPlanCharter ? '여행 일자' : '행사 일자'}:</b> ${esc(effectiveDate) || '(미정)'}`,
        `<b>인원:</b> ${effectivePax ? `${effectivePax}명` : '(미입력)'}`,
        `<b>${isTourCustom ? '유형' : '차량'}:</b> ${vehicleLabel}`,
      ];
      if (isPlanCharter) {
        lines.push(
          `<b>플랜:</b> <code>${esc(trimmedPlanId)}</code>`,
          `<b>서버 계산 참고견적:</b> ₩${quote.amountKRW.toLocaleString('en-US')} / ${quote.hours}시간`,
          `<b>추천 투어:</b> ${esc(quote.recommendedTour)}`,
          `<b>가격 정본:</b> ${esc(quote.pricingVersion)} · ${quote.currency} · ${esc(quote.provenance)}`,
        );
      }
      if (isTourCustom) {
        lines.push(
          `<b>지역:</b> ${esc(trimmedRegion) || '(미입력)'}`,
          `<b>여행 스타일:</b> ${esc(trimmedTravelStyle) || '(미입력)'}`,
          `<b>기간:</b> ${esc(trimmedDuration) || '(미입력)'}`,
          `<b>테마:</b> ${esc(trimmedTheme) || '(미입력)'}`,
          `<b>예산:</b> ${esc(trimmedBudget) || '(미정)'}`,
        );
      }
      lines.push(
        '',
        detailsKo ? `<b>📨 ${isTourCustom || isPlanCharter ? '요청사항' : '행사 내용'} (${detailsLang}):</b>` : `<b>${isTourCustom || isPlanCharter ? '요청사항' : '행사 내용'}:</b>${translateFailed ? ' ⚠️ 번역 실패' : ''}`,
        esc(detailsTrunc) || '(미입력)',
      );
      if (detailsKoTrunc) {
        lines.push('', '<b>🇰🇷 한글 번역:</b>', esc(detailsKoTrunc));
      }
      lines.push(
        '',
        trimmedPhone ? `<b>연락처:</b> ${esc(trimmedPhone)}` : '<b>연락처:</b> (미입력)',
      );
      if (trimmedWhatsapp) {
        lines.push(`<b>WhatsApp:</b> ${esc(trimmedWhatsapp)}`);
      }
      lines.push(
        `<b>이메일:</b> ${esc(trimmedEmail) || '(미입력)'}`,
        `<b>이름:</b> ${esc(trimmedName) || '(미입력)'}`,
        `<b>언어:</b> ${detailsLang}`,
        `<b>제출 시각:</b> ${submittedAt}`,
      );
      const text = lines.join('\n');

      await notifyInquiry(text);
    } catch (notifyErr) {
      // 알림 실패해도 저장은 성공 — silent log (사용자에겐 success 응답).
      console.warn('[inquiry-submit] telegram notify failed:', notifyErr.message);
    }

    console.log('[inquiry-submit] saved:', inquiryId, 'vehicle:', vehicle);

    res.writeHead(200, JSON_HEADERS);
    return res.end(JSON.stringify({
      success: true,
      inquiryId,
      status: 'NEW',
      ...(isPlanCharter ? { quote } : {}),
    }));
  } catch (err) {
    console.error('[inquiry-submit] failed:', err.message);
    await captureError(err, { route: '/api/inquiry-submit', method: req.method });
    res.writeHead(500, JSON_HEADERS);
    return res.end(JSON.stringify(_err(err.message || 'internal error', 'INTERNAL_ERROR')));
  }
}
