/**
 * Vercel API Route: Modify Booking
 * POST /api/modifyBooking
 * 회원: Authorization: Bearer <Firebase ID token>  ·  게스트: body.manageToken (확인 메일 관리 링크)
 * body: { bookingID, changes: { memo?, airport?, tourDate? }, requestId? (날짜 변경 시 필수), manageToken? }
 *
 * 허용 변경 (2026-10-23, 후속 ②b):
 *   - memo / airport(편명·터미널) — 비가격 메타데이터.
 *   - tourDate — **같은 상품·슬롯·인원·가격**으로 날짜만. 투어는 확정 좌석을 새 날짜로 이전
 *     (slot-capacity.js transferConfirmedSlot, 한 트랜잭션), 차터(슬롯 바인딩 없음)는 예약만 변경.
 *   그 밖의 키(paxCount·pickupLocation 등 가격 영향)는 적용하지 않고 응답 `ignored` 로 돌려준다.
 *   (이전엔 조용히 무시해 회원 UI 가 보낸 날짜·인원 변경이 적용된 줄 알았다.)
 * 변경 가능 시점 = 현재 날짜·새 날짜 **양쪽** 24h 전까지(_refund-policy.js canModify — 무료 취소 기한과 같은 선).
 * 모든 쓰기는 트랜잭션 안에서 예약을 다시 읽어 재검증한 뒤에만 한다(상태·소유자/관리 토큰 버전·24h).
 * 환불·결제 코드는 호출하지 않는다. 변경 뒤 무료 취소 기한은 새 날짜 기준.
 *
 * 게스트 날짜 변경은 관리 토큰 버전을 올린다(옛 링크 무효) — 새 토큰은 커밋 **전에** 만들어 같은 버전으로
 * 서명하고, 응답에도 돌려준다(페이지가 현재 토큰을 교체). 메일은 추가 전달 수단이다.
 * 응답이 유실되면 같은 requestId 로 재시도 → tryRecoverChangeRequest 가 쓰기 없이 새 토큰만 다시 준다.
 *
 * Security (PR #418, Audit W-C4 — 2026-05-13): body.userEmail 신뢰 종료. 회원은 verified email 만,
 * 게스트는 서명된 관리 토큰만(booking-access.js — 헤더가 있으면 잘못돼도 게스트로 전환하지 않음).
 */
import { evaluateRefundPolicy } from './_refund-policy.js';
import { initAdminDb } from './_shared/firebase-admin.js';
import { FieldValue } from 'firebase-admin/firestore';
import { captureError } from './_shared/sentry.js';
import { sendDiscord } from './_shared/notify.js';
import {
  resolveBookingAccess, isGuestManagedBooking, verifyGuestManageToken, matchGuestEnvironment,
  currentDeployment,
} from './_shared/booking-access.js';
import { createBookingManageToken } from './_shared/booking-manage-token.js';
import { isCalendarDate, kstDatePlusDays } from './_shared/calendar-date.js';
import { fetchOrderSlotBindingState, transferConfirmedSlot } from './_shared/slot-capacity.js';
import { sendBookingChangeEmail } from './_shared/booking-change-emails.js';
import { throttledTelegramAlert } from './_shared/telegram-throttle.js';
import { publicSiteOrigin } from './_shared/internal-base-url.js';
import { productDisplayLabel } from './_shared/pricing.js';

export const config = { runtime: 'nodejs' };

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};
const JSON_CORS = { ...CORS, 'Content-Type': 'application/json' };
// 게스트 새 관리 토큰이 실릴 수 있는 응답 — 캐시 금지.
const JSON_NO_STORE = { ...JSON_CORS, 'Cache-Control': 'no-store' };

const _ok  = (data) => ({ ok: true, data });
const _err = (error, code = 'UNKNOWN_ERROR') => ({ ok: false, error, code });

// SAFETY: 가격에 영향 주는 필드(paxCount/pickup/dropoff)는 차액 결제가 없어
// 무료 업그레이드(1인 결제→7인 변경 등)가 가능했음 → 차등 청구 도입 전까지 제외.
// tourDate 는 가격이 날짜 무관(pricing.js)이라 같은 상품·슬롯·인원 조건으로 허용(②b).
const ALLOWED_FIELDS = ['memo', 'airport', 'tourDate'];

// 날짜 변경 요청 ID — 클라이언트가 모달을 열 때 만든 UUID v4. 응답 유실 뒤 재시도·복구의 열쇠.
const REQUEST_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// transferConfirmedSlot / 트랜잭션이 던지는 업무 거부 코드 → 409 (쓰기 0).
const CONFLICT_CODES = new Set([
  'BOOKING_CHANGED', 'SLOT_BINDING_MISMATCH', 'DATE_UNAVAILABLE', 'SLOT_FULL',
  'SLOT_TOUR_NOT_FOUND', 'SLOT_NOT_IN_TOUR', 'SLOT_INACTIVE', 'SLOT_CAPACITY_UNSET', 'SLOT_PRICE_MODIFIER_INVALID',
]);

function airportPlainLine(airport) {
  if (!airport || typeof airport !== 'object') return '';
  const { terminal, flightNumber, luggage } = airport;
  const lug = luggage || {};
  const n = (v) => Number(v) || 0;
  const lugTotal = n(lug.small) + n(lug.medium) + n(lug.large);
  const parts = [];
  if (terminal) parts.push(`터미널 ${terminal}`);
  if (flightNumber) parts.push(`편명 ${flightNumber}`);
  if (lugTotal > 0) parts.push(`수하물 ${lugTotal}개(S${n(lug.small)}·M${n(lug.medium)}·L${n(lug.large)})`);
  return parts.length ? `\n공항: ${parts.join(' · ')}` : '';
}

function getDb() {
  const db = initAdminDb('modifyBooking');
  if (!db) throw new Error('Firestore unavailable — check FIREBASE_* env vars');
  return db;
}

async function notifyTelegram(msg) {
  const discordMirror = sendDiscord(msg); // 디스코드 미러 (병렬 — 텔레그램/예약수정 응답 지연 0)
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
  } finally {
    await discordMirror.catch(() => {});
  }
}

function hasAuthorizationHeader(req) {
  const header = (req && req.headers && (req.headers.authorization || req.headers.Authorization)) || '';
  return Boolean(String(header).trim());
}

function bookingEnvironment(booking) {
  return (booking || {}).paypalEnvironment === 'sandbox' ? 'sandbox' : 'live';
}

function send(res, status, payload, headers = JSON_CORS) {
  res.writeHead(status, headers);
  return res.end(JSON.stringify(payload));
}

function changedError(code) {
  const e = new Error(code);
  e.code = code;
  return e;
}

/**
 * 게스트 날짜 변경 토큰 복구 — 커밋은 됐는데 응답이 유실되고 메일까지 실패해 손님이 어느 링크도 못 쓰는 경우.
 * 두 진입점이 이 함수 하나를 쓴다: (i) 정상 접근이 401(옛 토큰), (ii) 트랜잭션 재검증 BOOKING_CHANGED(동시 재시도).
 *
 * 🔴 Authorization 헤더가 있으면(잘못돼도) 복구를 시도하지 않는다 — 예약 읽기 0·쓰기 0(booking-access.js 와 같은 기준).
 * 성공해도 **예약을 쓰지 않는다** — 저장된 lastChangeRequest 가 바로 이 요청임을 증명할 때 새 버전 토큰만 다시 만든다.
 * 좌석·텔레그램·메일도 반복하지 않는다.
 *
 * @returns {Promise<null | { status: number, payload: object }>} null = 복구 대상 아님(호출자가 원래 거부 유지)
 */
async function tryRecoverChangeRequest({ req, body, bookingID, ref, newDate, ignored }) {
  if (hasAuthorizationHeader(req)) return null;
  const requestId = body && typeof body.requestId === 'string' ? body.requestId : '';
  if (!REQUEST_ID_RE.test(requestId) || !newDate) return null;
  const token = verifyGuestManageToken(body.manageToken, { orderID: bookingID });
  if (!token.ok) return null;

  const snap = await ref.get();
  const booking = snap.exists ? (snap.data() || {}) : null;
  if (!booking || !isGuestManagedBooking(booking)) return null;
  const lcr = booking.lastChangeRequest;
  if (!lcr || typeof lcr !== 'object') return null;
  const currentVersion = Number(booking.manageTokenVersion || 0);
  if (lcr.id !== requestId) return null;
  if (lcr.fromVersion !== token.payload.ver) return null;
  if (lcr.toVersion !== currentVersion) return null; // 그 뒤 취소·추가 변경이 있었다
  if (!matchGuestEnvironment(booking, token.payload)) return null;
  if (lcr.tourDate !== booking.tourDate || newDate !== booking.tourDate) return null; // 같은 요청(같은 날짜)

  let manageToken;
  try {
    manageToken = createBookingManageToken({
      orderID: bookingID,
      version: lcr.toVersion,
      paypalEnvironment: bookingEnvironment(booking),
      deployment: currentDeployment(),
      tourDate: booking.tourDate,
    }).token;
  } catch (tokenErr) {
    console.warn('[modifyBooking] recovery token unavailable:', tokenErr.message);
    return { status: 503, payload: _err('Manage link unavailable — please contact support', 'MANAGE_LINK_UNAVAILABLE') };
  }
  const policy = evaluateRefundPolicy({ tourDate: booking.tourDate, tourTime: booking.tourTime || undefined });
  return {
    status: 200,
    payload: _ok({
      bookingID,
      status: booking.status,
      applied: { tourDate: booking.tourDate },
      ignored,
      tourDate: booking.tourDate,
      hoursUntilTour: policy.hoursUntilTour,
      manageToken,
      recovered: true,
      emailSent: false,
    }),
  };
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') { res.writeHead(200, CORS); return res.end(); }
  if (req.method !== 'POST') return send(res, 405, _err('Method not allowed', 'METHOD_NOT_ALLOWED'));

  try {
    let body = req.body;
    if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
    body = body || {};

    const { bookingID } = body;
    const changes = body.changes && typeof body.changes === 'object' ? body.changes : {};
    if (!bookingID) return send(res, 400, _err('bookingID required', 'MISSING_FIELDS'));

    // 변경 필드 화이트리스트 필터 — 밖의 키는 적용하지 않고 돌려준다.
    const cleanChanges = {};
    const ignored = [];
    for (const k of Object.keys(changes)) {
      if (changes[k] === undefined || changes[k] === null) continue;
      if (ALLOWED_FIELDS.includes(k)) cleanChanges[k] = changes[k];
      else ignored.push(k);
    }
    const newDate = cleanChanges.tourDate === undefined ? '' : String(cleanChanges.tourDate);

    const db = getDb();
    const ref = db.collection('bookings').doc(bookingID);

    // 1. 접근 — 회원(Bearer + 소유자) 또는 게스트(관리 토큰). 실패는 동일 401(헤더 있으면 예약 조회 0).
    const access = await resolveBookingAccess({
      req, body, bookingID,
      loadBooking: async () => { const snap = await ref.get(); return snap.exists ? snap.data() : null; },
    });
    if (!access.ok) {
      if (access.status === 401 && newDate) {
        const recovered = await tryRecoverChangeRequest({ req, body, bookingID, ref, newDate, ignored });
        if (recovered) return send(res, recovered.status, recovered.payload, JSON_NO_STORE);
      }
      return send(res, access.status, _err(access.error, access.code));
    }
    const actor = access.actor;
    const booking = access.booking;
    const requestedBy = actor.email || 'guest';

    if (Object.keys(cleanChanges).length === 0) {
      return send(res, 400, { ...(_err('No valid changes provided', 'NO_CHANGES')), ignored });
    }

    // 2. 사전 가드(읽기 단계 — 쓰기 0).
    if (booking.status !== 'CONFIRMED') {
      return send(res, 409, _err(`Cannot modify: status=${booking.status}`, 'INVALID_STATE'));
    }
    if (booking.parentOrderID) {
      return send(res, 409, _err('Cart line items cannot be changed here — please contact support.', 'CART_CHILD_UNSUPPORTED'));
    }
    const productType = String(booking.productType || '');
    if (productType.startsWith('ai-planner')) {
      return send(res, 403, _err('AI Plans are digital products and cannot be modified.', 'NO_MODIFY_DIGITAL'));
    }
    // 변경 가능 시점 (현재 투어일 24시간 전까지)
    // PR #426 (Audit CY3 — 2026-05-14): pass tourTime so the modify window
    // cutoff isn't anchored at 00:00 KST. 6 PM tour gets correct 24h window.
    const policy = evaluateRefundPolicy({
      tourDate: booking.tourDate,
      tourTime: booking.tourTime || undefined,
    }); // tier 미전달 — modify 창은 시간 기반(canModify)이라 tier 무관. body.tier IDOR 제거.
    if (!policy.canModify) {
      return send(res, 409, _err('Modification deadline passed (24h before tour)', 'MODIFY_WINDOW_CLOSED'));
    }

    // 트랜잭션 안 재검증 — 재시도마다 현재 시각·최신 문서로 다시 판정한다. false = BOOKING_CHANGED(쓰기 0).
    //   targetDate 가 있으면(날짜 변경) 새 날짜도 24h 밖이어야 한다.
    const verifyBooking = (fresh, nowMs, targetDate) => {
      if (!fresh || fresh.status !== 'CONFIRMED') return false;
      if (fresh.tourDate !== booking.tourDate) return false;
      if (fresh.parentOrderID) return false;
      if (actor.type === 'guest') {
        if (!isGuestManagedBooking(fresh) || Number(fresh.manageTokenVersion || 0) !== actor.tokenVersion) return false;
      } else if ((fresh.userEmail || '').toLowerCase() !== String(actor.email || '').toLowerCase()) {
        return false;
      }
      const now = new Date(nowMs);
      if (!evaluateRefundPolicy({ tourDate: fresh.tourDate, tourTime: fresh.tourTime || undefined, now }).canModify) return false;
      if (targetDate && !evaluateRefundPolicy({ tourDate: targetDate, tourTime: fresh.tourTime || undefined, now }).canModify) return false;
      return true;
    };

    const nowIso = new Date().toISOString();
    const fieldChanges = (keys) => Object.fromEntries(keys.map((k) => [k, {
      from: booking[k] === undefined ? null : booking[k],
      to: cleanChanges[k],
    }]));

    // ── 메모·공항만 ──
    if (!newDate) {
      const modEntry = { at: nowIso, changes: fieldChanges(Object.keys(cleanChanges)), requestedBy };
      try {
        await db.runTransaction(async (tx) => {
          const freshSnap = await tx.get(ref);
          const fresh = freshSnap.exists ? (freshSnap.data() || {}) : null;
          if (!verifyBooking(fresh, Date.now(), null)) throw changedError('BOOKING_CHANGED');
          // status 를 'MODIFIED' 로 덮지 않음 — CONFIRMED 유지(cancel/재수정 게이트 보존). 이력은 modifications.
          tx.update(ref, {
            ...cleanChanges,
            modifications: FieldValue.arrayUnion(modEntry),
            lastModifiedAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
          });
        });
      } catch (txErr) {
        if (txErr && txErr.code === 'BOOKING_CHANGED') {
          return send(res, 409, _err('Booking changed meanwhile — please reload', 'BOOKING_CHANGED'));
        }
        throw txErr;
      }

      // Telegram 알림 — 공항 객체는 요약에서 제외하고 별도 섹션에 표시
      const summary = Object.entries(cleanChanges)
        .filter(([k]) => k !== 'airport')
        .map(([k, v]) => `${k}: ${booking[k]}→${v}`)
        .join(', ');
      const mergedAirport = cleanChanges.airport === undefined ? booking.airport : cleanChanges.airport;
      notifyTelegram(
        `🟡 [예약 변경]\n${booking.bookingRef || bookingID}\n고객: ${requestedBy}\n변경: ${summary || '(공항 정보만)'}` +
        airportPlainLine(mergedAirport)
      );

      return send(res, 200, _ok({
        bookingID,
        status: booking.status, // CONFIRMED 유지 (cancel/재수정 가능하게)
        applied: cleanChanges,
        ignored,
        hoursUntilTour: policy.hoursUntilTour,
      }));
    }

    // ── 날짜 변경 ──
    const requestId = typeof body.requestId === 'string' ? body.requestId : '';
    if (!REQUEST_ID_RE.test(requestId)) {
      return send(res, 400, _err('requestId (UUID v4) required for a date change', 'MISSING_REQUEST_ID'));
    }
    if (!isCalendarDate(newDate)) return send(res, 400, _err('tourDate must be a real YYYY-MM-DD date', 'INVALID_DATE'));
    if (newDate === booking.tourDate) return send(res, 400, _err('New date is the same as the current date', 'SAME_DATE'));
    const newPolicy = evaluateRefundPolicy({ tourDate: newDate, tourTime: booking.tourTime || undefined });
    if (!newPolicy.canModify) {
      return send(res, 409, _err('The new date must be at least 24 hours away', 'NEW_DATE_TOO_SOON'));
    }
    if (newDate > kstDatePlusDays(Date.now(), 365)) {
      return send(res, 400, _err('The new date is too far ahead (max 365 days)', 'NEW_DATE_TOO_FAR'));
    }

    // 좌석 근거 분류 — SSOT = paypal_order_snapshots/{orderID}.slotBooking (차터는 null 저장).
    const orderId = booking.orderID || bookingID;
    const bindingState = await fetchOrderSlotBindingState({ adminDb: db, orderId });
    const isCharter = productType.startsWith('charter');
    if (!(bindingState.kind === 'ok' || (bindingState.kind === 'none' && isCharter))) {
      return send(res, 409, _err('This booking has no seat record we can move — please contact support.', 'SLOT_BINDING_MISSING'));
    }

    const isGuest = actor.type === 'guest';
    const currentVersion = Number(booking.manageTokenVersion) || 0;
    // 절대값(increment 아님) — verifyBooking 이 현재 버전 일치를 보장하고, 새 토큰이 바로 이 값으로 서명된다.
    const nextVersion = currentVersion + 1;

    // 게스트: 새 토큰을 커밋 **전에** 만든다. 못 만들면 변경 자체를 거부(버전만 오르면 접근 공백).
    let newToken = null;
    if (isGuest) {
      try {
        newToken = createBookingManageToken({
          orderID: bookingID,
          version: nextVersion,
          paypalEnvironment: bookingEnvironment(booking),
          deployment: currentDeployment(),
          tourDate: newDate,
        }).token;
      } catch (tokenErr) {
        console.warn('[modifyBooking] manage token unavailable — date change refused:', tokenErr.message);
        return send(res, 503, _err('Manage link unavailable — please try again later or contact support', 'MANAGE_LINK_UNAVAILABLE'));
      }
    }

    const otherKeys = Object.keys(cleanChanges).filter((k) => k !== 'tourDate');
    const otherChanges = Object.fromEntries(otherKeys.map((k) => [k, cleanChanges[k]]));
    const bookingPatch = {
      ...otherChanges,
      tourDate: newDate,
      ...(booking.bookingDate !== undefined ? { bookingDate: newDate } : {}),
      modifications: FieldValue.arrayUnion({
        at: nowIso,
        changes: { tourDate: { from: booking.tourDate, to: newDate }, ...fieldChanges(otherKeys) },
        requestedBy,
        requestId,
      }),
      lastModifiedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      ...(isGuest ? {
        manageTokenVersion: nextVersion,
        manageLinkPending: { version: nextVersion, createdAt: nowIso },
      } : {}),
      lastChangeRequest: { id: requestId, fromVersion: currentVersion, toVersion: nextVersion, tourDate: newDate, at: nowIso },
    };
    const verifyForDate = (fresh, nowMs) => verifyBooking(fresh, nowMs, newDate);

    let slotTransferred = false;
    try {
      if (bindingState.kind === 'ok') {
        const b = bindingState.binding;
        await transferConfirmedSlot({
          adminDb: db,
          orderId,
          tourId: b.tourId,
          slotId: b.slotId,
          pax: b.pax,
          fromDate: booking.tourDate,
          toDate: newDate,
          bookingRef: ref,
          snapshotRef: db.collection('paypal_order_snapshots').doc(orderId),
          bookingPatch,
          verifyBooking: verifyForDate,
        });
        slotTransferred = true;
      } else {
        // 차터(슬롯 바인딩 없음) — 예약만. 스냅샷·원장 쓰기 없음.
        await db.runTransaction(async (tx) => {
          const freshSnap = await tx.get(ref);
          const fresh = freshSnap.exists ? (freshSnap.data() || {}) : null;
          if (!verifyForDate(fresh, Date.now())) throw changedError('BOOKING_CHANGED');
          tx.update(ref, bookingPatch);
        });
      }
    } catch (txErr) {
      const code = txErr && txErr.code;
      if (code === 'BOOKING_CHANGED' && isGuest) {
        // (ii) 동시 재시도 — 같은 요청이 먼저 커밋됐으면 쓰기 없이 새 토큰만 돌려준다.
        const recovered = await tryRecoverChangeRequest({ req, body, bookingID, ref, newDate, ignored });
        if (recovered) return send(res, recovered.status, recovered.payload, JSON_NO_STORE);
      }
      if (CONFLICT_CODES.has(code)) {
        return send(res, 409, _err(code === 'BOOKING_CHANGED' ? 'Booking changed meanwhile — please reload' : txErr.message, code));
      }
      throw txErr;
    }

    // ── 커밋 후 (best-effort) ──
    const refLabel = booking.bookingRef || bookingID;
    const seatLine = bindingState.kind === 'ok'
      ? `좌석 이전: ${bindingState.binding.tourId} / ${bindingState.binding.slotId} / ${bindingState.binding.pax}명`
      : '좌석: 슬롯 없음(차터)';
    notifyTelegram(
      `🟡 [예약 날짜 변경]\n${refLabel}\n고객: ${requestedBy}\n날짜: ${booking.tourDate} → ${newDate}\n${seatLine}\n⚠️ 시트 수동 갱신 필요`
    );

    const manageUrl = isGuest ? `${publicSiteOrigin()}/booking/manage#t=${newToken}` : null;
    const mail = await sendBookingChangeEmail({
      booking: { ...booking, tourDate: newDate },
      bookingID,
      label: productDisplayLabel(productType),
      oldDate: booking.tourDate,
      newDate,
      manageUrl,
      myPageUrl: isGuest ? null : `${publicSiteOrigin()}/mypage`,
    });
    if (isGuest) {
      if (mail.sent) {
        // 버전 조건부 — 이 변경의 pending 만 지운다(그 사이 다음 변경이 있었으면 건드리지 않는다).
        try {
          await db.runTransaction(async (tx) => {
            const latestSnap = await tx.get(ref);
            const latest = latestSnap.exists ? (latestSnap.data() || {}) : {};
            const pending = latest.manageLinkPending;
            if (Number(latest.manageTokenVersion || 0) !== nextVersion) return;
            if (!pending || Number(pending.version) !== nextVersion) return;
            tx.update(ref, { manageLinkPending: FieldValue.delete(), manageLinkSentAt: FieldValue.serverTimestamp() });
          });
        } catch (markErr) {
          console.warn('[modifyBooking] manageLinkPending clear failed (non-fatal):', markErr.message);
        }
      } else {
        throttledTelegramAlert({
          key: `manage-link-mail-failed-${bookingID}-${nextVersion}`,
          channel: 'admin',
          severity: 'high',
          message: `⚠️ <b>날짜 변경 — 새 관리 링크 메일 실패</b>\n<code>${refLabel}</code>\n날짜: ${booking.tourDate} → ${newDate}\n→ 손님 화면에는 새 링크가 반영됨. 메일 재전달 필요(manageLinkPending v${nextVersion}).`,
          context: { bookingID, version: nextVersion, error: mail.error || null },
        }).catch(() => {});
      }
    } else if (!mail.sent) {
      console.warn('[modifyBooking] change email failed (member):', mail.error);
    }

    return send(res, 200, _ok({
      bookingID,
      status: 'CONFIRMED',
      applied: cleanChanges,
      ignored,
      tourDate: newDate,
      hoursUntilTour: newPolicy.hoursUntilTour,
      slotTransferred,
      ...(isGuest ? { manageToken: newToken } : {}),
      emailSent: mail.sent,
    }), JSON_NO_STORE);
  } catch (err) {
    console.error('[modifyBooking] Error:', err && err.message);
    await captureError(err, { route: '/api/modifyBooking', method: req.method });
    return send(res, 500, _err(err.message, 'INTERNAL_ERROR'));
  }
}
