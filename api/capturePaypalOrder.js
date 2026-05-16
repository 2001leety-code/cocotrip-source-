/**
 * Vercel API Route: Capture PayPal Order + trigger booking-processor
 * POST /api/capturePaypalOrder
 */
import { getPaypalAccessToken } from './_shared/paypal.js';
import { initAdminDb } from './_shared/firebase-admin.js';
import { checkAiPlannerCouponPolicy } from './_shared/ai-planner-policy.js';
import { incrementGlobalPromoUsage, KNOWN_GLOBAL_PROMO_CODES } from './_shared/global-promo.js';
import { refundPaypalCapture } from './_shared/paypal-refund.js';
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

    // PR #433 (Audit Y-H10 — 2026-05-16): AI Planner = 디지털 상품 → 쿠폰/프로모
    // reject. 이전엔 createPaypalOrder.js 만 검증해서 product='ai_planner_full'
    // + couponDocId 를 capture-time 에 보내면 booking 이 AI planner 로 기록되되
    // 쿠폰을 함께 소비하는 우회가 가능했다 (특히 createPaypalOrder 를 우회하는
    // PayPal Smart Buttons client-side order 흐름에서). createPaypalOrder 와
    // 동일 helper 호출로 양 endpoint 정책 통일.
    const aiPlannerGate = checkAiPlannerCouponPolicy({ product, promoCode, couponDocId });
    if (!aiPlannerGate.ok) {
      console.warn('[capturePaypalOrder] AI Planner coupon rejected at capture:', { orderID, ...aiPlannerGate.debug });
      res.writeHead(aiPlannerGate.status, JSON_CORS);
      return res.end(JSON.stringify(_err(aiPlannerGate.error, aiPlannerGate.code)));
    }

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

    // 1.6 쿠폰 PRE-LOCK — PR #427 (Audit CY4 — 2026-05-14).
    //
    // 이전엔 capture 성공 후에 쿠폰을 isUsed=true 로 마킹했음. 두 가지 race
    // 상황에서 사용자가 손해:
    //   A) 두 요청이 동시 진입 → 둘 다 createPaypalOrder 단계에서 쿠폰 검증
    //      통과 → 둘 다 capture 성공 → 한 명은 mark 성공, 다른 한 명은
    //      COUPON_ALREADY_USED. 패자는 PayPal 에 결제됐는데 할인 안 받음 →
    //      운영자가 수동으로 차액 환불해야 함.
    //   B) 사용자가 결제 진행 중 다른 탭/세션에서 같은 쿠폰을 별도 booking 에
    //      사용 → A 와 동일.
    //
    // 이제 capture 호출 전에 쿠폰을 트랜잭션으로 선점 (isUsed=true). 트랜잭션
    // 실패 시 즉시 409 반환 + used_paypal_orders lock 해제 → 사용자가 다른
    // 쿠폰 / 쿠폰 없이 재시도 가능. capture 실패 시 쿠폰 + lock 둘 다 해제 →
    // 정상적인 재시도 흐름 보장.
    const couponLockRef = (couponDocId && couponUserId)
      ? dbForLock.collection('users').doc(couponUserId)
          .collection('coupons').doc(couponDocId)
      : null;
    if (couponLockRef) {
      try {
        await dbForLock.runTransaction(async (tx) => {
          const snap = await tx.get(couponLockRef);
          if (!snap.exists) throw new Error('COUPON_NOT_FOUND');
          const data = snap.data() || {};
          if (data.isUsed === true && data.usedOrderID !== orderID) {
            // 다른 orderID 가 이미 점유. 같은 orderID 면 idempotent 재시도로 간주.
            throw new Error('COUPON_ALREADY_USED');
          }
          tx.update(couponLockRef, {
            isUsed: true,
            usedAt: FieldValue.serverTimestamp(),
            usedOrderID: orderID,
            // pendingCapture flag — capture 실패 시 자동 rollback 의 신호.
            // capture 성공 후 false 로 변경.
            pendingCapture: true,
          });
        });
        console.log('[capturePaypalOrder] coupon pre-locked:', couponDocId);
      } catch (couponErr) {
        const code = couponErr.message || 'UNKNOWN';
        console.warn('[capturePaypalOrder] coupon pre-lock failed:', code, '| orderID:', orderID);
        // orderID lock 해제 — 사용자가 다른 쿠폰/쿠폰 없이 재시도 가능.
        lockRef.delete().catch((e) => {
          console.warn('[capturePaypalOrder] lock release after coupon fail (non-fatal):', e.message);
        });
        // 운영자 알림 — 쿠폰 race 발생을 인지 (수동 환불 불필요 — capture 안 일어났음).
        notifyOperator('coupon-race',
          `<code>${orderID}</code>\n사유: ${code}\n쿠폰: ${couponDocId} (uid ${couponUserId.slice(0, 8)})\n→ capture 전 차단 — 환불 불필요`
        ).catch((alertErr) => console.error('[capturePaypalOrder] operator alert failed:', alertErr.message));
        res.writeHead(409, JSON_CORS);
        return res.end(JSON.stringify(_err(`Coupon unavailable: ${code}`, code)));
      }
    }

    // 2. Capture — wrapped so we can release BOTH locks on failure.
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
      // Release orderID lock so the user can retry. We don't await — the
      // response path stays fast and a leftover lock auto-expires via the
      // 30s stale check above.
      lockRef.delete().catch((delErr) => {
        console.warn('[capturePaypalOrder] lock release failed (CY1 retry path):', delErr.message);
      });
      // PR #427 (CY4): release coupon too — capture never happened so the
      // coupon discount wasn't actually consumed. Without this, a network
      // blip during capture would burn the user's coupon.
      if (couponLockRef) {
        couponLockRef.update({
          isUsed: false,
          usedAt: null,
          usedOrderID: null,
          pendingCapture: false,
        }).catch((e) => {
          console.warn('[capturePaypalOrder] coupon release after capture fail (non-fatal):', e.message);
        });
      }
      throw captureErr;
    }
    // Mark lock as captured so future retries are correctly rejected.
    lockRef.update({ status: 'captured', capturedAt: FieldValue.serverTimestamp() }).catch((e) => {
      console.warn('[capturePaypalOrder] lock status update failed (non-fatal):', e.message);
    });
    // PR #427 (CY4): finalise coupon — clear the pendingCapture flag so the
    // coupon is unambiguously "spent" rather than "in-flight".
    if (couponLockRef) {
      couponLockRef.update({ pendingCapture: false }).catch((e) => {
        console.warn('[capturePaypalOrder] coupon finalise failed (non-fatal):', e.message);
      });
    }

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

    // 2.5 쿠폰 처리 — PR #427 이후 capture 전 pre-lock 으로 이동됨 (section 1.6).
    // 여기까지 왔다면 쿠폰은 이미 isUsed=true + pendingCapture=false 상태.
    // 더 이상 운영자 수동 환불 case (capture 성공 + 쿠폰 race fail) 발생 안 함.

    // 2.6 글로벌 프로모 사용량 증가 + transactional cap 체크 (COCO5/COCO10/EARLY50).
    //
    // PR #434 (Audit Y-H11 — 2026-05-16): 이전엔 transaction 이 atomic increment
    // 만 하고 cap (maxUses) 검증을 안 해서, applyPromoCode 의 read-only gate 를
    // race 로 통과한 N 명 (예: 60 명) 이 모두 EARLY50 (limit=50) 의 +1 을 받아
    // 51~60 번째에게 무단으로 20% 할인 부여됨. 이제 cap check 가 같은 transaction
    // 내부에서 일어나며, 초과 시 PayPal capture 를 즉시 환불 + booking 도큐먼트도
    // refunded 로 마킹 + 운영자 알림. 사용자 UX 는 약간 나빠지지만 (charged-then-
    // refunded) 회계 정합성은 유지된다.
    if (promoCode && typeof promoCode === 'string') {
      const upper = promoCode.toUpperCase();
      if (KNOWN_GLOBAL_PROMO_CODES.includes(upper)) {
        const db = initAdminDb('capturePaypalOrder');
        if (db) {
          let promoResult;
          try {
            promoResult = await incrementGlobalPromoUsage({ db, code: upper, orderID });
          } catch (promoErr) {
            // Transaction infra error — log + skip the cap enforcement (better
            // than refunding a legit payment over a Firestore blip). The
            // applyPromoCode soft-gate already filtered most over-limit attempts.
            console.error('[capturePaypalOrder] global_promo_usage transaction crashed:', promoErr.message);
            promoResult = null;
          }
          if (promoResult && !promoResult.ok && promoResult.code === 'PROMO_LIMIT_EXCEEDED') {
            console.warn('[capturePaypalOrder] PROMO_LIMIT_EXCEEDED race detected:',
              { orderID, promoCode: upper, usedCount: promoResult.usedCount, maxUses: promoResult.maxUses });
            // 1) Refund the PayPal capture (we already charged the user).
            let refundOk = false;
            try {
              const refundRes = await refundPaypalCapture({
                captureID,
                refundUSD: amount,
                note: `PROMO_LIMIT_EXCEEDED race (${upper}) — auto refund`,
                isSandbox: false,
              });
              refundOk = !!refundRes?.ok;
            } catch (refundErr) {
              console.error('[capturePaypalOrder] auto-refund failed (operator must refund manually):', refundErr.message);
            }
            // 2) Mark the booking as refunded so cancel/modify/voucher paths
            //    don't treat it as active.
            try {
              await db.collection('bookings').doc(orderID).set({
                status: refundOk ? 'REFUNDED' : 'REFUND_PENDING',
                refundReason: 'PROMO_LIMIT_EXCEEDED',
                refundedAt: FieldValue.serverTimestamp(),
                updatedAt: FieldValue.serverTimestamp(),
              }, { merge: true });
            } catch (markErr) {
              console.error('[capturePaypalOrder] booking refund-mark failed (non-fatal):', markErr.message);
            }
            // 3) Operator alert — even though we auto-refunded, operator should
            //    know the cap is being hit (may want to extend the campaign).
            notifyOperator('coupon-race',
              `<code>${orderID}</code>\n사유: PROMO_LIMIT_EXCEEDED (${upper})\n사용: ${promoResult.usedCount}/${promoResult.maxUses}\n자동환불: ${refundOk ? '성공' : '실패 — 수동환불 필요'}`
            ).catch((alertErr) => console.error('[capturePaypalOrder] operator alert failed:', alertErr.message));
            // 4) User response — explain refund.
            res.writeHead(409, JSON_CORS);
            return res.end(JSON.stringify(_err(
              refundOk
                ? `Promo code "${upper}" reached its usage limit. Your payment has been refunded — please retry without the promo code.`
                : `Promo code "${upper}" reached its usage limit. A manual refund will be issued — operator notified.`,
              'PROMO_LIMIT_EXCEEDED'
            )));
          }
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