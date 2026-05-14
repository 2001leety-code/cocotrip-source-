/**
 * Vercel API Route: Capture PayPal Order + trigger booking-processor
 * POST /api/capturePaypalOrder
 */
import { getPaypalAccessToken } from './_shared/paypal.js';
import { initAdminDb } from './_shared/firebase-admin.js';
import { FieldValue } from 'firebase-admin/firestore';
import { notifyOperator } from './_shared/operator-alerts.js';
import { notify } from './_shared/notify.js';

// ── Admin bypass 허용 이메일 목록 ─────────────────────────────────────────
// ADMIN_BYPASS_EMAILS env var (쉼표 구분) 우선, 없으면 ADMIN_EMAIL env var,
// 없으면 하드코딩 fallback. body.userEmail 신뢰 종료 — Firebase token 검증값 사용.
const HARDCODED_ADMIN_EMAILS = ['2001leety@gmail.com'];
function getAdminBypassEmails() {
  const raw = (process.env.ADMIN_BYPASS_EMAILS || '').trim();
  if (raw) return raw.split(',').map(e => e.toLowerCase().trim()).filter(Boolean);
  const adminEmail = (process.env.ADMIN_EMAIL || '').toLowerCase().trim();
  if (adminEmail) return [adminEmail, ...HARDCODED_ADMIN_EMAILS];
  return HARDCODED_ADMIN_EMAILS;
}

// Firebase ID token에서 email 추출 (보안 가드 — body.userEmail 위장 차단)
async function verifyTokenEmail(authHeader) {
  const m = /^Bearer\s+(.+)$/.exec(authHeader || '');
  if (!m) return null;
  try {
    const { getAuth } = await import('firebase-admin/auth');
    const { getApps } = await import('firebase-admin/app');
    if (!getApps().length) return null;
    const decoded = await getAuth().verifyIdToken(m[1], true);
    return (decoded.email || '').toLowerCase().trim() || null;
  } catch {
    return null;
  }
}

export const maxDuration = 30;
export const config = { runtime: 'nodejs' };

// ── 표준 응답 래퍼 ──
const _ok  = (data) => ({ ok: true, data });
const _err = (msg, code = 'UNKNOWN_ERROR') => ({ ok: false, error: msg, code });

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};
const JSON_CORS = { ...CORS, 'Content-Type': 'application/json' };

// PayPal token + baseUrl resolution moved to api/_shared/paypal.js
// (shared with cancelBooking.js + createPaypalOrder.js).
// Launch (2026-04-30) 이후 live only — sandbox 분기 제거 (dead code 정리).

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') { res.writeHead(200, CORS); return res.end(); }
  if (req.method !== 'POST') { res.writeHead(405, JSON_CORS); return res.end(JSON.stringify(_err('Method not allowed', 'METHOD_NOT_ALLOWED'))); }

  try {
    let body = req.body;
    if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
    body = body || {};

    // PR #426 (Audit CY3 — 2026-05-14): persist tourTime so the cancel/modify
    // window calculation uses the actual tour start hour, not the 00:00 KST
    // default. Optional — bookings without tourTime fall back to legacy.
    const { orderID, product, tourDate, tourTime, pickupLocation, dropoffLocation, paxCount, vehicleType, customerPhone, couponApplied, memo, itineraryData, userEmail = '', couponDocId, couponUserId, airport, promoCode } = body;
    if (!orderID) { res.writeHead(400, JSON_CORS); return res.end(JSON.stringify(_err('orderID is required', 'MISSING_FIELDS'))); }

    console.log('[capturePaypalOrder] LIVE mode | email:', userEmail);

    // 1. Access Token + baseUrl from shared helper (live only)
    const { accessToken, baseUrl: PAYPAL_BASE_URL } = await getPaypalAccessToken(false);

    // 1.5 Duplicate orderID guard — used_paypal_orders 중복 방지.
    //
    // PR #425 (Audit CY1 — 2026-05-14): 이전엔 read-then-set non-atomic +
    // 캡처 성공 전 영구 lock. 두 가지 버그:
    //   (a) race — 동일 orderID 동시 호출 시 둘 다 .get() 통과 → 이중 capture
    //       → 같은 카드에서 두 번 청구.
    //   (b) capture fail 후 영구 lock — 네트워크 일시 장애로 capture 실패해도
    //       used_paypal_orders 가 남아 사용자가 재시도 시 DUPLICATE_ORDER.
    // 이제 트랜잭션으로 lock 을 acquire + capture 후 status 업데이트 +
    // capture 실패 시 lock 삭제 (재시도 허용).
    const dbForLock = initAdminDb('capturePaypalOrder');
    if (!dbForLock) throw new Error('Firestore unavailable — check FIREBASE_* env vars');
    const lockRef = dbForLock.collection('used_paypal_orders').doc(orderID);
    try {
      await dbForLock.runTransaction(async (tx) => {
        const existing = await tx.get(lockRef);
        if (existing.exists) {
          const data = existing.data() || {};
          // 이미 captured 상태면 진짜 중복. pending 인데 30초 이상 stale 이면
          // 이전 cold-start fail 가능성 — 재시도 허용.
          const stale = data.status === 'pending'
            && data.createdAtMs
            && (Date.now() - Number(data.createdAtMs)) > 30_000;
          if (data.status === 'captured' || !stale) {
            throw new Error('DUPLICATE_ORDER');
          }
          // stale pending → overwrite 로 재시도.
        }
        tx.set(lockRef, {
          status: 'pending',
          createdAt: new Date().toISOString(),
          createdAtMs: Date.now(),
          userEmail,
          product: product || 'unknown',
        });
      });
    } catch (lockErr) {
      if (lockErr.message === 'DUPLICATE_ORDER') {
        console.warn('[capturePaypalOrder] duplicate orderID blocked:', orderID);
        res.writeHead(409, JSON_CORS);
        return res.end(JSON.stringify(_err('Order already processed', 'DUPLICATE_ORDER')));
      }
      throw lockErr;
    }

    // 2. Capture — wrapped so we can release the lock on failure.
    let capture;
    try {
      const captureRes = await fetch(`${PAYPAL_BASE_URL}/v2/checkout/orders/${orderID}/capture`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      });
      capture = await captureRes.json();
      if (capture.status !== 'COMPLETED') {
        throw new Error(`Capture status: ${capture.status ?? 'unknown'}`);
      }
    } catch (captureErr) {
      // Release lock so the user can retry. We don't await — the response
      // path stays fast and a leftover lock auto-expires via the 30s stale
      // check above.
      lockRef.delete().catch((delErr) => {
        console.warn('[capturePaypalOrder] lock release failed (CY1 retry path):', delErr.message);
      });
      throw captureErr;
    }
    // Mark lock as captured so future retries are correctly rejected.
    lockRef.update({ status: 'captured', capturedAt: FieldValue.serverTimestamp() }).catch((e) => {
      console.warn('[capturePaypalOrder] lock status update failed (non-fatal):', e.message);
    });

    // 필드 추출 + 누락 시 명시 로그 (LIVE 응답 누락이 admin 로그 미노출의 첫 번째 원인 후보).
    const captureNode = capture.purchase_units?.[0]?.payments?.captures?.[0];
    const payerEmail = capture.payer?.email_address ?? '';
    const payerName = `${capture.payer?.name?.given_name ?? ''} ${capture.payer?.name?.surname ?? ''}`.trim();
    const amount = captureNode?.amount?.value ?? '';
    const captureID = captureNode?.id ?? '';
    const hasPayer = !!payerEmail;
    const hasCapture = !!captureID;
    const hasAmount = !!amount;
    if (!hasPayer || !hasCapture || !hasAmount) {
      console.error('[capturePaypalOrder] field missing:', { hasPayer, hasCapture, hasAmount, orderID });
    }

    // PayPal capture 응답에서 민감정보 없는 필드만 추려서 Firestore에 보존 (디버깅 + 운영자 매칭용).
    const rawCapturePayload = {
      payer: { email_address: payerEmail },
      amount: captureNode?.amount ?? null,
      captureID,
      status: capture.status ?? '',
      create_time: captureNode?.create_time ?? capture.create_time ?? '',
    };

    // 2.4 bookings/{orderID} 정식 레코드 생성 — cancel/modify/my-bookings API가 조회.
    // captureID는 취소 시 PayPal Refund 호출에 필수.
    //
    // PR #425 (Audit CY2 — 2026-05-14): amountKRW 를 capture 시점에 계산해
    // 저장. 이전엔 amountUSD 만 저장 → cancelBooking.js:167 의
    // `(booking.amountKRW || 0) * policy.refundRatio` 가 항상 0 → 마이페이지
    // 환불 영수증에 "₩0 환불" 표기 → 사용자 신고 폭주.
    const usdToKrw = Number(process.env.KRW_USD_RATE)
      || Number(process.env.VITE_USD_KRW_RATE)
      || 1430;
    const amountKRW = Math.round(parseFloat(amount || '0') * usdToKrw);
    try {
      const db = initAdminDb('capturePaypalOrder');
      if (!db) throw new Error('Firestore unavailable');
      await db.collection('bookings').doc(orderID).set({
        bookingRef: orderID,
        orderID,
        captureID,
        userEmail: (userEmail || '').toLowerCase(),
        payerEmail,
        payerName,
        status: 'CONFIRMED',
        productType: product || '',
        tourDate: tourDate || '',
        // PR #426 (CY3): persist tourTime for refund-cutoff accuracy.
        tourTime: tourTime || '',
        pickupLocation: pickupLocation || '',
        dropoffLocation: dropoffLocation || '',
        paxCount: paxCount || 0,
        vehicleType: vehicleType || '',
        customerPhone: customerPhone || '',
        couponApplied: !!couponApplied,
        memo: memo || '',
        airport: airport || null,
        amountUSD: amount,
        amountKRW,
        capturedExchangeRate: usdToKrw,
        currency: 'USD',
        rawCapturePayload,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
    } catch (bookingErr) {
      // 예약 레코드 저장 실패해도 결제는 통과 (booking-processor가 sheets에 기록)
      console.error('[capturePaypalOrder] bookings doc write failed:', bookingErr.message);
    }

    // 2.5 쿠폰 소진 처리 — runTransaction 으로 race condition 차단.
    // 검증(applyPromoCode)과 차감이 분리되어 있어 동일 쿠폰 동시 적용 시 둘 다 통과 가능했음.
    // 결제 capture 는 이미 성공했으므로 COUPON_ALREADY_USED 발생해도 결제 취소 불가 →
    // bookings/{orderID}.couponWarning 에 기록 (운영자 수동 환불 대상).
    if (couponDocId && couponUserId) {
      const db = initAdminDb('capturePaypalOrder');
      if (!db) {
        console.error('[capturePaypalOrder] coupon mark skipped: Firestore unavailable');
      } else {
        const couponRef = db.collection('users').doc(couponUserId)
          .collection('coupons').doc(couponDocId);
        try {
          await db.runTransaction(async (tx) => {
            const snap = await tx.get(couponRef);
            if (!snap.exists) throw new Error('COUPON_NOT_FOUND');
            const data = snap.data() || {};
            if (data.isUsed === true) throw new Error('COUPON_ALREADY_USED');
            tx.update(couponRef, {
              isUsed: true,
              usedAt: FieldValue.serverTimestamp(),
              usedOrderID: orderID,
            });
          });
          console.log('[capturePaypalOrder] coupon marked used:', couponDocId);
        } catch (couponErr) {
          const code = couponErr.message || 'UNKNOWN';
          console.error('[capturePaypalOrder] coupon update failed:', code, '| orderID:', orderID);
          if (code === 'COUPON_ALREADY_USED' || code === 'COUPON_NOT_FOUND') {
            try {
              await db.collection('bookings').doc(orderID).set({
                couponWarning: code,
                couponWarningAt: FieldValue.serverTimestamp(),
                couponDocId,
                couponUserId,
              }, { merge: true });
            } catch (warnErr) {
              console.error('[capturePaypalOrder] couponWarning write failed:', warnErr.message);
            }
            // PR-G: 운영자 즉시 알림 — 수동 환불 필요. silent fail 금지.
            notifyOperator('coupon-warning',
              `<code>${orderID}</code>\n사유: ${code}\n쿠폰: ${couponDocId} (uid ${couponUserId.slice(0, 8)})\n→ 수동 환불 필요`
            ).catch((alertErr) => console.error('[capturePaypalOrder] operator alert failed:', alertErr.message));
          }
        }
      }
    }

    // 2.6 글로벌 프로모 사용량 증가 (COCO5/COCO10/EARLY50). 트랜잭션으로 race-safe.
    // applyPromoCode 의 limit gate 가 read-only 이므로 여기서 실제 increment.
    if (promoCode && typeof promoCode === 'string') {
      const upper = promoCode.toUpperCase();
      const KNOWN_GLOBAL = ['COCO5', 'COCO10', 'EARLY50'];
      if (KNOWN_GLOBAL.includes(upper)) {
        try {
          const db = initAdminDb('capturePaypalOrder');
          if (db) {
            await db.runTransaction(async (tx) => {
              const ref = db.collection('global_promo_usage').doc(upper);
              const snap = await tx.get(ref);
              const cur = snap.exists ? Number(snap.data()?.usedCount || 0) : 0;
              tx.set(ref, { usedCount: cur + 1, lastUsedAt: FieldValue.serverTimestamp() }, { merge: true });
            });
          }
        } catch (promoErr) {
          console.error('[capturePaypalOrder] global_promo_usage increment failed:', promoErr.message);
        }
      }
    }

    // 3. Fire-and-forget booking-processor
    const siteUrl = process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'https://cocotripkr.com';
    fetch(`${siteUrl}/api/booking-processor`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orderID, payerEmail, payerName, amount, product, tourDate, pickupLocation, dropoffLocation, paxCount, vehicleType, customerPhone, couponApplied, memo, itineraryData, airport }),
    }).catch(err => console.error('[capturePaypalOrder] booking-processor call failed:', err.message));

    // 4. Respond immediately
    res.writeHead(200, JSON_CORS);
    res.end(JSON.stringify(_ok({ orderID, payerEmail, payerName, amount, currency: 'USD', message: '예약이 확정되었습니다. 확인 이메일을 발송 중입니다.' })));
  } catch (err) {
    console.error('[capturePaypalOrder] Error:', err);
    res.writeHead(500, JSON_CORS);
    res.end(JSON.stringify(_err(err.message, 'INTERNAL_ERROR')));
  }
}