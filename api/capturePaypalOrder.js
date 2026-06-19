/**
 * Vercel API Route: Capture PayPal Order + trigger booking-processor
 * POST /api/capturePaypalOrder
 */
import { getPaypalAccessToken, resolveIsSandbox } from './_shared/paypal.js';
import { initAdminDb } from './_shared/firebase-admin.js';
import { checkAiPlannerCouponPolicy } from './_shared/ai-planner-policy.js';
import { confirmSlotLock } from './_shared/slot-capacity.js';
import { incrementGlobalPromoUsage, KNOWN_GLOBAL_PROMO_CODES } from './_shared/global-promo.js';
import { refundPaypalCapture } from './_shared/paypal-refund.js';
import { triggerBookingProcessor } from './_shared/booking-processor-trigger.js';
import { throttledTelegramAlert } from './_shared/telegram-throttle.js';
import { FieldValue } from 'firebase-admin/firestore';
import { notifyOperator } from './_shared/operator-alerts.js';
import { notify } from './_shared/notify.js';
import { featureEnabled } from './_shared/feature-flag.js';

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

// Firebase ID token에서 uid 추출 (쿠폰 소유자 검증 — body couponUserId 위조 IDOR 차단).
async function verifyTokenUid(authHeader) {
  const m = /^Bearer\s+(.+)$/.exec(authHeader || '');
  if (!m) return null;
  try {
    const { getAuth } = await import('firebase-admin/auth');
    const { getApps } = await import('firebase-admin/app');
    if (!getApps().length) return null;
    const decoded = await getAuth().verifyIdToken(m[1], true);
    return decoded.uid || null;
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
    //
    // P108 (2026-05-20): tourId/tourSlotId/bookingDate/slotCapacity 도 추출 —
    // 슬롯 capacity confirm 용. createPaypalOrder 의 pre-lock 과 짝.
    let { orderID, product, tourDate, tourTime, pickupLocation, dropoffLocation, paxCount, vehicleType, customerPhone, couponApplied, memo, itineraryData, userEmail = '', couponDocId, couponUserId, airport, promoCode,
      tourId, tourSlotId, bookingDate, slotCapacity } = body;
    if (!orderID) { res.writeHead(400, JSON_CORS); return res.end(JSON.stringify(_err('orderID is required', 'MISSING_FIELDS'))); }

    // SECURITY (버그헌트 #11 2026-06-14): createPaypalOrder 가 저장한 주문 스냅샷에서 product/pax/date 를
    // 가져와 capture-time body 위조(저가결제로 고가서비스 booking 기록)를 무력화. AI-planner-gate 등 모든
    // 후속 로직이 보정된 product 를 쓰도록 gate 전에 수행. 스냅샷 없으면(client-side 주문/legacy/쓰기실패)
    // body 유지 = graceful(결제 차단 금지). PayPal 이 capture 금액을 order amount 로 강제하므로 금액은 위조 불가.
    try {
      const _snapDb = initAdminDb('capturePaypalOrder-snapshot');
      if (_snapDb) {
        const _snap = await _snapDb.collection('paypal_order_snapshots').doc(orderID).get();
        if (_snap.exists) {
          const _s = _snap.data() || {};
          if (_s.productType) product = _s.productType;
          if (_s.passengers != null) paxCount = _s.passengers;
          if (!tourDate && _s.dateStart) tourDate = _s.dateStart;
          console.log('[capturePaypalOrder] order snapshot applied:', { orderID, product: _s.productType });
        }
      }
    } catch (_snapErr) {
      console.warn('[capturePaypalOrder] order snapshot read failed (graceful, body 유지):', _snapErr.message);
    }

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

    // 1. Access Token + baseUrl from shared helper.
    // P314 (2026-05-30): sandbox e2e 토글. capture = 실제 돈 빠지는 곳 → resolveIsSandbox
    // 이중 가드 (VERCEL_ENV!=='production' AND PAYPAL_ENV==='sandbox') 로 prod 무조건 live.
    // sandbox 결정 시 prod 로그에서 즉시 감지되도록 경고 (prod 에 찍히면 안 됨).
    const _isSandboxCapture = resolveIsSandbox();
    if (_isSandboxCapture) console.warn('[capturePaypalOrder] ⚠️ SANDBOX MODE — 실제 결제 아님 (preview e2e)');
    const { accessToken, baseUrl: PAYPAL_BASE_URL } = await getPaypalAccessToken(_isSandboxCapture);

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
    // 🔴 돈 버그 fix (2026-06-14): 쿠폰 소진(isUsed=true)을 createPaypalOrder 청구 게이트와
    //   동일한 FEATURE_DISCOUNT_V2 조건으로 게이트. v2 OFF(현 prod 기본)면 createPaypalOrder.js:237
    //   가 청구가에 할인을 반영 안 함(=정가 청구) → capture 가 v2 게이트 없이 쿠폰을 burn 하면
    //   화면 5%할인가/실제 정가청구/1회용 쿠폰 소진 = 표시≠청구 + 쿠폰 손실. v2 OFF 시 couponLockRef
    //   를 null 로 유지 → 소진 스킵(쿠폰 보존). v2 ON 시에만 정상 pre-lock/소진. (프론트 피커도
    //   discountV2 OFF면 숨김 → 3경로 일관: 정가·미노출·미소진.)
    const discountV2 = featureEnabled(process.env.FEATURE_DISCOUNT_V2);
    // 🔴 IDOR fix (버그헌트 2026-06-19): couponUserId 는 body 값. 정의만 있고 미호출이던
    //   토큰 검증(verifyTokenUid)을 연결 — 요청자 토큰 uid 가 couponUserId 와 일치할 때만 쿠폰
    //   경로 허용. 불일치/토큰없음이면 쿠폰 소진 스킵(결제는 계속) → 타인 1회용 쿠폰 강제소진 차단.
    //   프론트는 authFetch 로 토큰 전송 = 정상 쿠폰 결제 무영향, 게스트(#969)는 쿠폰 없어 무관.
    let _couponOwnerVerified = false;
    if (couponDocId && couponUserId) {
      const _authUid = await verifyTokenUid(req.headers?.authorization);
      _couponOwnerVerified = !!_authUid && _authUid === couponUserId;
      if (!_couponOwnerVerified) {
        console.warn('[capturePaypalOrder] coupon ownership mismatch — 쿠폰 경로 스킵(IDOR 가드):', orderID);
      }
    }
    const couponLockRef = (discountV2 && couponDocId && couponUserId && _couponOwnerVerified)
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
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          // P790 (2026-06-03): PayPal 공식 멱등성 헤더 — 네트워크 timeout 재시도 시 PayPal 이 새 capture
          // 대신 캐시 응답 반환. orderID 기반 키 = 재시도 동일 키. (이중청구는 used_paypal_orders 락 +
          // PayPal 서버측 완료주문 재-capture 거부로 이미 차단 — 본 헤더는 defense-in-depth.)
          'PayPal-Request-Id': `${orderID}-cap`,
        },
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
    // 🔴 회계 버그 fix (2026-06-14): 거래일 환율을 시스템 FX SSOT 라이브 환율로 통일.
    //   이전엔 정적 env 두 개를 OR 로 묶고 마지막에 상수 폴백 → booking-processor.js:224 는
    //   getUsdToKrwRaw() 라이브를 쓰는데 Firestore bookings 엔 정적값 저장 → 같은 거래에 두 KRW
    //   공존 + 회계 부정확. 이제 getUsdToKrwRaw()(라이브 4소스 + floor 1450) 로 통일.
    //   ⚠️ best-effort — 환율 조회 실패/타임아웃 시에도 결제(capture)는 절대 막지 않고 정책 floor
    //   (1450)로 폴백(이전 정적 상수 의존 제거). 라이브 경로 자체가 _exchange-rate.js 내부에서
    //   try/catch + 폴백을 보장하지만, import 실패 등 만일에 대비해 외곽도 try/catch.
    let usdToKrw = 1450; // 정책 floor (RATE_FLOOR) — 라이브 실패 시 안전 폴백.
    try {
      const { getUsdToKrwRaw } = await import('./_exchange-rate.js');
      const liveRate = await getUsdToKrwRaw();
      if (Number.isFinite(liveRate) && liveRate > 0) usdToKrw = liveRate;
    } catch (rateErr) {
      console.warn('[capturePaypalOrder] live FX fetch failed, using floor 1450:', rateErr.message);
    }
    const amountKRW = Math.round(parseFloat(amount || '0') * usdToKrw);
    //
    // PR #444 (Audit Y-H14 — 2026-05-16): bookings doc write was best-effort
    // with a silent console.error catch. If the write failed (Firestore brownout,
    // quota, network blip) the user's PayPal capture had already SUCCEEDED but
    // my-bookings / cancelBooking / modifyBooking / voucher all key off this
    // doc → user sees no reservation → CS escalation. Now:
    //   - retry up to 3 times with exponential backoff (200/500/1000ms)
    //   - on total failure: throttled operator alert with orderID + captureID
    //     (operator can recover via /api/admin-replay-booking-notifications)
    //   - payment is NOT rolled back — money was captured, the right move is
    //     to recover the booking record, not refund
    const bookingDocPayload = {
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
    };
    const BOOKING_WRITE_BACKOFF_MS = [200, 500, 1000];
    let bookingWriteOk = false;
    let lastBookingErr = null;
    for (let attempt = 0; attempt < BOOKING_WRITE_BACKOFF_MS.length; attempt++) {
      try {
        const db = initAdminDb('capturePaypalOrder');
        if (!db) throw new Error('Firestore unavailable');
        await db.collection('bookings').doc(orderID).set(bookingDocPayload, { merge: true });
        bookingWriteOk = true;
        break;
      } catch (bookingErr) {
        lastBookingErr = bookingErr;
        const msg = bookingErr.message || String(bookingErr);
        console.error(`[capturePaypalOrder] bookings doc write failed (attempt ${attempt + 1}/${BOOKING_WRITE_BACKOFF_MS.length}):`, msg);
        if (attempt < BOOKING_WRITE_BACKOFF_MS.length - 1) {
          await new Promise((resolve) => setTimeout(resolve, BOOKING_WRITE_BACKOFF_MS[attempt]));
        }
      }
    }
    if (!bookingWriteOk) {
      // CRITICAL — payment captured but reservation record missing. Throttled
      // alert (dedup per orderID prefix to prevent storm on Firestore outage).
      // Operator recovers via /api/admin-replay-booking-notifications.
      throttledTelegramAlert({
        key: 'bookings-doc-write-fail',
        channel: 'admin',
        severity: 'critical',
        message: [
          '🚨 <b>CRITICAL — bookings doc 저장 실패 (PayPal 결제 완료됨)</b>',
          '',
          `<b>OrderID:</b> <code>${orderID}</code>`,
          `<b>CaptureID:</b> <code>${captureID}</code>`,
          `<b>금액:</b> $${amount} / ₩${amountKRW.toLocaleString('ko-KR')}`,
          `<b>이메일:</b> ${payerEmail || userEmail || '(none)'}`,
          `<b>최종 사유:</b> ${(lastBookingErr?.message || 'unknown').slice(0, 250)}`,
          '',
          '→ user 결제 완료. my-bookings / cancel / voucher 모두 깨짐 상태.',
          `→ 복구: <code>POST /api/admin-replay-booking-notifications {bookingId:"${orderID}"}</code>`,
        ].join('\n'),
        context: { orderID, captureID, amountUSD: amount, amountKRW, source: 'capturePaypalOrder' },
      }).catch(() => {});
    }

    // P108 (2026-05-20): 슬롯 capacity confirm — bookings doc 저장 성공 후 pending
    // → confirmed 전환. body 에 4 필드 모두 있어야 함 (createPaypalOrder 와 동일).
    // 실패해도 booking 자체는 이미 confirmed (결제 완료) — alert 만 발사, throw X.
    // 슬롯 lock 만료 + 다른 confirmed 가 채워졌으면 SLOT_FULL_AT_CAPTURE — 운영자가
    // overbooking 발생 사실 인지하고 수동 환불/조정 결정. payment refund 자동 X
    // (운영자 정책: 결제 일단 받고 운영자가 사후 처리).
    if (bookingWriteOk && tourId && tourSlotId && bookingDate && Number.isFinite(Number(slotCapacity)) && Number(slotCapacity) > 0 && Number(paxCount) > 0) {
      try {
        const db = initAdminDb('capturePaypalOrder.slotConfirm');
        if (db) {
          await confirmSlotLock({
            adminDb: db,
            tourId,
            date: bookingDate,
            slotId: tourSlotId,
            pax: Number(paxCount),
            capacity: Number(slotCapacity),
            orderId: orderID,
          });
          console.log('[capturePaypalOrder] slot confirmed:', { tourId, date: bookingDate, slot: tourSlotId, pax: paxCount });
        }
      } catch (slotErr) {
        const code = slotErr.code || 'SLOT_CONFIRM_FAILED';
        console.error('[capturePaypalOrder] slot confirm failed:', code, slotErr.message);
        // SLOT_FULL_AT_CAPTURE = overbooking risk — operator 즉시 인지 필요.
        const severity = code === 'SLOT_FULL_AT_CAPTURE' ? 'critical' : 'high';
        throttledTelegramAlert({
          key: `slot-confirm-${code}`,
          channel: 'admin',
          severity,
          message: [
            `⚠️ <b>슬롯 confirm 실패 (결제 완료 후) — ${code}</b>`,
            ``,
            `<b>OrderID:</b> <code>${orderID}</code>`,
            `<b>tourId:</b> ${tourId}`,
            `<b>date/slot:</b> ${bookingDate} / ${tourSlotId}`,
            `<b>pax:</b> ${paxCount} <b>capacity:</b> ${slotCapacity}`,
            `<b>오류:</b> ${slotErr.message?.slice(0, 200)}`,
            ``,
            `${code === 'SLOT_FULL_AT_CAPTURE' ? '🚨 overbooking 가능성 — 운영자 수동 검토 + 환불/조정 결정 필요.' : '슬롯 카운터 불일치. lockfix scripts/admin-slot-rebuild 검토.'}`,
          ].join('\n'),
          context: { orderID, tourId, bookingDate, tourSlotId, paxCount, slotCapacity, code },
        }).catch(() => {});
      }
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
                isSandbox: _isSandboxCapture,
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

    // 3. Booking-processor trigger — PR #436 (Audit Y-H8 — 2026-05-16).
    //
    // 이전 fire-and-forget `fetch().catch()` 는 HTTP 500/504 같은 비-2xx 응답에는
    // .catch 가 발화 안 함 → user 는 "예약 확정" 받았는데 downstream (Google Sheets,
    // 고객 확인 이메일, voucher PDF, 텔레그램 채널 #2) 가 silent fail. 운영자가
    // 수동으로 /admin-replay-booking-notifications 돌리기 전에는 사라짐.
    //
    // 이제 triggerBookingProcessor helper 가:
    //   - AbortController 로 25s timeout
    //   - response.ok 검증 (비-2xx 도 실패로 처리)
    //   - 실패 시 pending_processor_retries/{orderID} 등록 + 운영자 텔레그램 alert
    //   - 5분 마다 processor-retry-sweep cron 이 재시도
    // user 응답은 변함없이 즉시. helper 자체는 await 으로 호출하지만 promise 가 항상
    // resolve 하므로 정상 흐름에 영향 없음. 25s + Vercel maxDuration 60s 안에 안전.
    const siteUrl = process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'https://cocotripkr.com';
    const processorPayload = { orderID, payerEmail, payerName, amount, product, tourDate, pickupLocation, dropoffLocation, paxCount, vehicleType, customerPhone, couponApplied, memo, itineraryData, airport };
    // Fire-and-don't-await: respond to the user immediately, helper records its
    // own outcome and operator alert in background.
    void triggerBookingProcessor({
      db: initAdminDb('capturePaypalOrder'),
      siteUrl,
      payload: processorPayload,
      source: 'capturePaypalOrder',
      notify,
    });

    // 4. Respond immediately
    res.writeHead(200, JSON_CORS);
    res.end(JSON.stringify(_ok({ orderID, payerEmail, payerName, amount, currency: 'USD', message: '예약이 확정되었습니다. 확인 이메일을 발송 중입니다.' })));
  } catch (err) {
    console.error('[capturePaypalOrder] Error:', err);
    res.writeHead(500, JSON_CORS);
    res.end(JSON.stringify(_err(err.message, 'INTERNAL_ERROR')));
  }
}