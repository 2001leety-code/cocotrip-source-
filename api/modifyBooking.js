/**
 * Vercel API Route: Modify Booking
 * POST /api/modifyBooking
 * Headers: Authorization: Bearer <Firebase ID token>
 * body: { bookingID, changes: { tourDate?, paxCount?, pickupLocation?, dropoffLocation?, memo? } }
 *
 * 현재 범위: 메타데이터 변경(날짜/인원/픽업)만 지원. 가격 차이 처리는 차후 확장.
 * 이 API는 변경 가능 시점 검사 후 Firestore modifications 배열에 append하고 필드 갱신.
 *
 * 가격 재계산/차액 결제는 사용자가 charter 페이지에서 재예약하거나 WhatsApp으로 진행.
 *
 * Security (PR #418, Audit W-C4 — 2026-05-13): body.userEmail 신뢰 종료.
 * 이전엔 누구나 victim 의 bookingID + email 알면 (이메일 PII 유출/추측) 남의 예약
 * 날짜/픽업 등 변경 가능 → 운영자 dispatch 혼란. 이제 Authorization Bearer 의
 * verified email 만 사용.
 */
import { evaluateRefundPolicy } from './_refund-policy.js';
import { initAdminDb } from './_shared/firebase-admin.js';
import { FieldValue } from 'firebase-admin/firestore';
import { captureError } from './_shared/sentry.js';
import { verifyUserToken } from './_shared/user-auth.js';

export const config = { runtime: 'nodejs' };

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};
const JSON_CORS = { ...CORS, 'Content-Type': 'application/json' };

const _ok  = (data) => ({ ok: true, data });
const _err = (error, code = 'UNKNOWN_ERROR') => ({ ok: false, error, code });

const ALLOWED_FIELDS = ['tourDate', 'paxCount', 'pickupLocation', 'dropoffLocation', 'memo', 'airport'];

function airportPlainLine(airport) {
  if (!airport || typeof airport !== 'object') return '';
  const { terminal, flightNumber, luggage } = airport;
  const lug = luggage || {};
  const lugTotal = (lug.small ?? 0) + (lug.medium ?? 0) + (lug.large ?? 0);
  const parts = [];
  if (terminal) parts.push(`터미널 ${terminal}`);
  if (flightNumber) parts.push(`편명 ${flightNumber}`);
  if (lugTotal > 0) parts.push(`수하물 ${lugTotal}개(S${lug.small ?? 0}·M${lug.medium ?? 0}·L${lug.large ?? 0})`);
  return parts.length ? `\n공항: ${parts.join(' · ')}` : '';
}

function getDb() {
  const db = initAdminDb('modifyBooking');
  if (!db) throw new Error('Firestore unavailable — check FIREBASE_* env vars');
  return db;
}

async function notifyTelegram(msg) {
  try {
    const token  = process.env.TELEGRAM_BOT_TOKEN;
    const chatId = process.env.TELEGRAM_CHAT_ID;
    if (!token || !chatId) return;
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: msg }),
    });
  } catch (err) {
    console.error('[modifyBooking] telegram skipped:', err.message);
  }
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') { res.writeHead(200, CORS); return res.end(); }
  if (req.method !== 'POST') {
    res.writeHead(405, JSON_CORS);
    return res.end(JSON.stringify(_err('Method not allowed', 'METHOD_NOT_ALLOWED')));
  }

  try {
    // PR #418 (Audit W-C4): require Authorization: Bearer <ID-token>.
    // body.userEmail 무시 — verified auth.email 만 사용.
    const auth = await verifyUserToken(req);
    if (!auth.ok) {
      res.writeHead(auth.status, JSON_CORS);
      return res.end(JSON.stringify(_err(auth.error, 'AUTH_REQUIRED')));
    }
    const userEmail = auth.email;

    let body = req.body;
    if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
    body = body || {};

    const { bookingID, changes = {}, tier = 'Bronze' } = body;
    if (!bookingID) {
      res.writeHead(400, JSON_CORS);
      return res.end(JSON.stringify(_err('bookingID required', 'MISSING_FIELDS')));
    }

    // 변경 필드 화이트리스트 필터
    const cleanChanges = {};
    for (const k of Object.keys(changes)) {
      if (ALLOWED_FIELDS.includes(k) && changes[k] !== undefined && changes[k] !== null) {
        cleanChanges[k] = changes[k];
      }
    }
    if (Object.keys(cleanChanges).length === 0) {
      res.writeHead(400, JSON_CORS);
      return res.end(JSON.stringify(_err('No valid changes provided', 'NO_CHANGES')));
    }

    const db = getDb();

    const ref = db.collection('bookings').doc(bookingID);
    const doc = await ref.get();
    if (!doc.exists) {
      res.writeHead(404, JSON_CORS);
      return res.end(JSON.stringify(_err('Booking not found', 'NOT_FOUND')));
    }
    const booking = doc.data();
    if ((booking.userEmail || '').toLowerCase() !== userEmail.toLowerCase()) {
      res.writeHead(403, JSON_CORS);
      return res.end(JSON.stringify(_err('Not your booking', 'FORBIDDEN')));
    }
    if (booking.status !== 'CONFIRMED') {
      res.writeHead(409, JSON_CORS);
      return res.end(JSON.stringify(_err(`Cannot modify: status=${booking.status}`, 'INVALID_STATE')));
    }

    // 변경 가능 시점 (투어일 24시간 전까지)
    // PR #426 (Audit CY3 — 2026-05-14): pass tourTime so the modify window
    // cutoff isn't anchored at 00:00 KST. 6 PM tour gets correct 24h window.
    const policy = evaluateRefundPolicy({
      tourDate: booking.tourDate,
      tourTime: booking.tourTime || undefined,
      tier,
    });
    if (!policy.canModify) {
      res.writeHead(409, JSON_CORS);
      return res.end(JSON.stringify(_err('Modification deadline passed (24h before tour)', 'MODIFY_WINDOW_CLOSED')));
    }

    // 변경 이력 레코드
    const modEntry = {
      at: new Date().toISOString(),
      changes: Object.fromEntries(
        Object.entries(cleanChanges).map(([k, v]) => [k, { from: booking[k] ?? null, to: v }])
      ),
      requestedBy: userEmail,
    };

    const updatePayload = {
      ...cleanChanges,
      status: 'MODIFIED',
      modifications: FieldValue.arrayUnion(modEntry),
      updatedAt: FieldValue.serverTimestamp(),
    };
    await ref.update(updatePayload);

    // Telegram 알림 — 공항 객체는 요약에서 제외하고 별도 섹션에 표시
    const summary = Object.entries(cleanChanges)
      .filter(([k]) => k !== 'airport')
      .map(([k, v]) => `${k}: ${booking[k]}→${v}`)
      .join(', ');
    const mergedAirport = cleanChanges.airport ?? booking.airport;
    notifyTelegram(
      `🟡 [예약 변경]\n${booking.bookingRef || bookingID}\n고객: ${userEmail}\n변경: ${summary || '(공항 정보만)'}` +
      airportPlainLine(mergedAirport)
    );

    res.writeHead(200, JSON_CORS);
    return res.end(JSON.stringify(_ok({
      bookingID,
      status: 'MODIFIED',
      applied: cleanChanges,
      hoursUntilTour: policy.hoursUntilTour,
    })));
  } catch (err) {
    console.error('[modifyBooking] Error:', err);
    await captureError(err, { route: '/api/modifyBooking', method: req.method });
    res.writeHead(500, JSON_CORS);
    return res.end(JSON.stringify(_err(err.message, 'INTERNAL_ERROR')));
  }
}
