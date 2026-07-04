/**
 * POST /api/inquiry-submit
 *
 * Bus 차량 선택 시 노출되는 상담 폼 제출. (vip 선택지 제거 2026-06-30.)
 * 2026-07-02: 투어 페이지 맞춤형 투어 문의(vehicle='tour_custom') 추가 —
 *   region/theme/budget/whatsapp 필드, 이메일 또는 전화 중 하나 필수, 날짜/상세 선택.
 * Firestore `charter_inquiries/{inquiryId}` 저장 + InquiryCHAT_BOT 채널 알림.
 *
 * Body:
 *   {
 *     name, email, phone?, whatsapp?, eventDate, pax,
 *     vehicle: 'bus' | 'tour_custom',
 *     details, region?, theme?, budget?,
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
const ALLOWED_VEHICLES = new Set(['bus', 'tour_custom']);
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
      language = 'en',
      wizardSnapshot = null,
    } = body;

    // 입력 검증 — silent fail X, 명시적 에러 코드.
    // tour_custom (투어 페이지 맞춤 문의): 이메일 또는 전화 중 하나 필수, 날짜/상세는 선택.
    const isTourCustom = String(vehicle) === 'tour_custom';
    const trimmedName = String(name).trim();
    const trimmedEmail = String(email).trim().toLowerCase();
    const trimmedPhone = String(phone).trim().slice(0, 40);
    const trimmedWhatsapp = String(whatsapp).trim().slice(0, 40);
    const trimmedEventDate = String(eventDate || '').trim().slice(0, 40);
    const trimmedDetails = String(details).trim();
    const trimmedRegion = String(region).trim().slice(0, 40);
    const trimmedTheme = String(theme).trim().slice(0, 200);
    const trimmedBudget = String(budget).trim().slice(0, 40);
    if (trimmedName.length < 2) {
      res.writeHead(400, JSON_HEADERS);
      return res.end(JSON.stringify(_err('name required (min 2 chars)', 'INVALID_NAME')));
    }
    const emailValid = /\S+@\S+\.\S+/.test(trimmedEmail);
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
    if (!isTourCustom) {
      if (!eventDate || typeof eventDate !== 'string') {
        res.writeHead(400, JSON_HEADERS);
        return res.end(JSON.stringify(_err('eventDate required', 'INVALID_DATE')));
      }
    } else if (eventDate && typeof eventDate !== 'string') {
      res.writeHead(400, JSON_HEADERS);
      return res.end(JSON.stringify(_err('eventDate must be string', 'INVALID_DATE')));
    }
    const paxNum = Number(pax);
    if (!Number.isFinite(paxNum) || paxNum < 1 || paxNum > 999) {
      res.writeHead(400, JSON_HEADERS);
      return res.end(JSON.stringify(_err('pax out of range', 'INVALID_PAX')));
    }
    if (!ALLOWED_VEHICLES.has(String(vehicle))) {
      res.writeHead(400, JSON_HEADERS);
      return res.end(JSON.stringify(_err('vehicle not allowed', 'INVALID_VEHICLE')));
    }
    if (!isTourCustom && trimmedDetails.length < 5) {
      res.writeHead(400, JSON_HEADERS);
      return res.end(JSON.stringify(_err('details too short', 'INVALID_DETAILS')));
    }
    const lang = ALLOWED_LANGS.has(language) ? language : 'en';

    // 옵션 인증 — 토큰 있으면 uid 추출.
    let userId = null;
    const authHeader = req.headers?.authorization || req.headers?.Authorization || '';
    const tokenMatch = String(authHeader).match(/^Bearer\s+(.+)$/i);
    if (tokenMatch) {
      try {
        const { getAuth } = await import('firebase-admin/auth');
        const { getApps } = await import('firebase-admin/app');
        if (getApps().length > 0) {
          const decoded = await getAuth().verifyIdToken(tokenMatch[1]);
          userId = decoded.uid;
        }
      } catch (e) {
        console.warn('[inquiry-submit] token verify failed:', e.message);
      }
    }

    const adminDb = initAdminDb('inquiry-submit');
    if (!adminDb) {
      console.error('[inquiry-submit] Firestore admin unavailable');
      res.writeHead(500, JSON_HEADERS);
      return res.end(JSON.stringify(_err('Firestore unavailable', 'FIRESTORE_UNAVAILABLE')));
    }

    // 비용 DoS 가드 — 무인증(옵션 토큰) + Gemini 번역 + Telegram 발송 + Firestore write.
    // 입력 검증 통과 후, 고비용 작업 전에 per-IP rate-limit (fail-open).
    const rl = await checkIpRateLimit({
      db: adminDb, ip: getClientIp(req),
      collection: 'inquiry_rate_limits',
      maxRequests: 5, errorLabel: 'inquiry submissions',
    });
    if (!rl.ok) {
      res.writeHead(rl.status, { ...JSON_HEADERS, 'Retry-After': String(rl.retryAfterSec) });
      return res.end(JSON.stringify(_err(rl.error, 'RATE_LIMITED')));
    }

    const inquiryId = genInquiryId();
    await adminDb.collection('charter_inquiries').doc(inquiryId).set({
      inquiryId,
      name: trimmedName,
      email: trimmedEmail || null,
      phone: trimmedPhone || null,
      whatsapp: trimmedWhatsapp || null,
      eventDate: trimmedEventDate || null,
      pax: paxNum,
      vehicle,
      details: trimmedDetails,
      region: trimmedRegion || null,
      theme: trimmedTheme || null,
      budget: trimmedBudget || null,
      language: lang,
      wizardSnapshot: wizardSnapshot || null,
      userId,
      status: 'NEW',
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });

    // 텔레그램 InquiryCHAT_BOT 채널 알림 — 운영자 본인 채널과 분리.
    // 메시지 포맷 (PR-F): 행사 일자 / 인원 / 차량 (Bus 또는 VIP) / 행사 내용 / 연락처 / 이메일 / 제출 시각
    //
    // 번역(PR-Q): 행사 내용이 한국어가 아니면 Gemini로 한글 번역 추가 (운영자 가독성).
    // 번역 실패는 silent — 원문은 항상 유지.
    try {
      // 신규 협의 폼은 bus / tour_custom (vip 는 더 이상 도달 안 함).
      const vehicleLabel = isTourCustom ? '맞춤형 투어 (Custom Tour)' : '대형버스 (Bus)';
      const submittedAt = new Date().toISOString().replace('T', ' ').slice(0, 19) + ' UTC';

      // 행사 내용 한글 번역 시도. (tour_custom 은 요청사항 선택 입력 — 비어 있으면 스킵.)
      let detailsKo = null;
      let detailsLang = lang;
      let translateFailed = false;
      if (trimmedDetails) {
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
        isTourCustom ? '🎯 <b>새 맞춤 투어 문의</b>' : '📨 <b>새 차터 상담 문의</b>',
        '',
        `<b>문의번호:</b> <code>${inquiryId}</code>`,
        `<b>${isTourCustom ? '여행 일자' : '행사 일자'}:</b> ${esc(trimmedEventDate) || '(미정)'}`,
        `<b>인원:</b> ${paxNum}명`,
        `<b>${isTourCustom ? '유형' : '차량'}:</b> ${vehicleLabel}`,
      ];
      if (isTourCustom) {
        lines.push(
          `<b>지역:</b> ${esc(trimmedRegion) || '(미입력)'}`,
          `<b>테마:</b> ${esc(trimmedTheme) || '(미입력)'}`,
          `<b>예산:</b> ${esc(trimmedBudget) || '(미정)'}`,
        );
      }
      lines.push(
        '',
        detailsKo ? `<b>📨 ${isTourCustom ? '요청사항' : '행사 내용'} (${detailsLang}):</b>` : `<b>${isTourCustom ? '요청사항' : '행사 내용'}:</b>${translateFailed ? ' ⚠️ 번역 실패' : ''}`,
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
        `<b>이름:</b> ${esc(trimmedName)}`,
        `<b>언어:</b> ${detailsLang}`,
        `<b>제출 시각:</b> ${submittedAt}`,
      );
      const text = lines.join('\n');

      await notifyInquiry(text);
    } catch (notifyErr) {
      // 알림 실패해도 저장은 성공 — silent log (사용자에겐 success 응답).
      console.warn('[inquiry-submit] telegram notify failed:', notifyErr.message);
    }

    console.log('[inquiry-submit] saved:', inquiryId, 'vehicle:', vehicle, 'email:', trimmedEmail);

    res.writeHead(200, JSON_HEADERS);
    return res.end(JSON.stringify({ success: true, inquiryId }));
  } catch (err) {
    console.error('[inquiry-submit] failed:', err.message);
    await captureError(err, { route: '/api/inquiry-submit', method: req.method });
    res.writeHead(500, JSON_HEADERS);
    return res.end(JSON.stringify(_err(err.message || 'internal error', 'INTERNAL_ERROR')));
  }
}
