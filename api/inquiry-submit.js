/**
 * POST /api/inquiry-submit
 *
 * Bus / VIP 차량 선택 시 노출되는 상담 폼 제출.
 * Firestore `charter_inquiries/{inquiryId}` 저장 + InquiryCHAT_BOT 채널 알림.
 *
 * Body:
 *   {
 *     name, email, phone?, eventDate, pax,
 *     vehicle: 'bus' | 'vip',
 *     details, language: 'ko'|'en'|'ja'|'zh',
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

const ALLOWED_VEHICLES = new Set(['bus', 'vip']);
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
      eventDate = '',
      pax,
      vehicle = '',
      details = '',
      language = 'en',
      wizardSnapshot = null,
    } = body;

    // 입력 검증 — silent fail X, 명시적 에러 코드.
    const trimmedName = String(name).trim();
    const trimmedEmail = String(email).trim().toLowerCase();
    const trimmedDetails = String(details).trim();
    if (trimmedName.length < 2) {
      res.writeHead(400, JSON_HEADERS);
      return res.end(JSON.stringify(_err('name required (min 2 chars)', 'INVALID_NAME')));
    }
    if (!/\S+@\S+\.\S+/.test(trimmedEmail)) {
      res.writeHead(400, JSON_HEADERS);
      return res.end(JSON.stringify(_err('email required', 'INVALID_EMAIL')));
    }
    if (!eventDate || typeof eventDate !== 'string') {
      res.writeHead(400, JSON_HEADERS);
      return res.end(JSON.stringify(_err('eventDate required', 'INVALID_DATE')));
    }
    const paxNum = Number(pax);
    if (!Number.isFinite(paxNum) || paxNum < 1 || paxNum > 999) {
      res.writeHead(400, JSON_HEADERS);
      return res.end(JSON.stringify(_err('pax out of range', 'INVALID_PAX')));
    }
    if (!ALLOWED_VEHICLES.has(String(vehicle))) {
      res.writeHead(400, JSON_HEADERS);
      return res.end(JSON.stringify(_err('vehicle must be bus|vip', 'INVALID_VEHICLE')));
    }
    if (trimmedDetails.length < 5) {
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

    const inquiryId = genInquiryId();
    await adminDb.collection('charter_inquiries').doc(inquiryId).set({
      inquiryId,
      name: trimmedName,
      email: trimmedEmail,
      phone: phone ? String(phone).trim() : null,
      eventDate,
      pax: paxNum,
      vehicle,
      details: trimmedDetails,
      language: lang,
      wizardSnapshot: wizardSnapshot || null,
      userId,
      status: 'NEW',
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });

    // 텔레그램 InquiryCHAT_BOT 채널 알림 — 운영자 본인 채널과 분리.
    // 메시지 포맷 (PR-F): 행사 일자 / 인원 / 차량 (Bus 또는 VIP) / 행사 내용 / 연락처 / 이메일 / 제출 시각
    try {
      const vehicleLabel = vehicle === 'vip' ? '의전 차량 (VIP)' : '대형버스 (Bus)';
      const submittedAt = new Date().toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
      const text = [
        '📨 <b>새 차터 상담 문의</b>',
        '',
        `<b>문의번호:</b> <code>${inquiryId}</code>`,
        `<b>행사 일자:</b> ${eventDate}`,
        `<b>인원:</b> ${paxNum}명`,
        `<b>차량:</b> ${vehicleLabel}`,
        '',
        '<b>행사 내용:</b>',
        trimmedDetails.length > 500 ? trimmedDetails.slice(0, 500) + '…' : trimmedDetails,
        '',
        phone ? `<b>연락처:</b> ${phone}` : '<b>연락처:</b> (미입력)',
        `<b>이메일:</b> ${trimmedEmail}`,
        `<b>이름:</b> ${trimmedName}`,
        `<b>언어:</b> ${lang}`,
        `<b>제출 시각:</b> ${submittedAt}`,
      ].join('\n');

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
