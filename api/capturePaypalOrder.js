/**
 * Vercel API Route: Capture PayPal Order + trigger booking-processor
 * POST /api/capturePaypalOrder
 */
import { getPaypalAccessToken, resolveIsSandbox } from './_shared/paypal.js';
import { initAdminDb } from './_shared/firebase-admin.js';
import { checkAiPlannerCouponPolicy } from './_shared/ai-planner-policy.js';
import { confirmSlotLock, fetchServerSlotCapacity, readSlotFields } from './_shared/slot-capacity.js';
import { incrementGlobalPromoUsage, KNOWN_GLOBAL_PROMO_CODES } from './_shared/global-promo.js';
import { refundPaypalCapture } from './_shared/paypal-refund.js';
import { triggerBookingProcessor } from './_shared/booking-processor-trigger.js';
import { throttledTelegramAlert } from './_shared/telegram-throttle.js';
import { FieldValue } from 'firebase-admin/firestore';
import { notifyOperator } from './_shared/operator-alerts.js';
import { notify } from './_shared/notify.js';
import { featureEnabled } from './_shared/feature-flag.js';
import { sanitizeAttribution } from './_shared/attribution.js';
import { toMinorUnits, verifyCaptureIntegrity } from './_shared/paypal-capture-verify.js';
import { recordPaymentReview, buildPaymentReviewResponse } from './_shared/payment-review.js';
import { internalApiBase } from './_shared/internal-base-url.js';
import { loadPricingSpec } from './_shared/pricing.js';
import {
  isSameOrderProven, isLegacyOpenSnapshot, validateIntent, acquirePaymentAttempt, reconcileCapture, summarizeVerifiedCapture,
  persistBookingsAtomically, shouldDispatchRetry, releaseHeldIntents, recordTerminalBeforeRefund, markRefundCompleted, provenFullRefundID,
  makeRetryPersister, recordProcessorResult, updateAttempt,
  releaseAttemptClaim, discardAttempt, finalizeAttempt, pendingPaymentResponse, notCapturedResponse, withBackoff,
} from './_shared/payment-fulfillment-recovery.js';

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

export const maxDuration = 60;
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
    //
    // 🔴 2026-08-09 (F2): 이 body 슬롯 필드는 **더 이상 confirm 의 근거가 아니다.** 슬롯 확정은
    //   create 가 저장한 스냅샷 바인딩(_snapSlot)만 쓴다. 여기서 계속 읽는 이유는 두 가지뿐이다:
    //   (1) 클라가 "슬롯 예약" 이라 주장했는데 바인딩이 없는 상태를 운영자에게 알리기 위한 신호,
    //   (2) 그 알림에 클라가 무엇을 주장했는지 담아 진단 가능하게 하기 위해서.
    let { orderID, product, tourDate, tourTime, pickupLocation, dropoffLocation, paxCount, vehicleType, customerPhone, couponApplied, memo, itineraryData, userEmail = '', couponDocId, couponUserId, airport, promoCode,
      tourId, tourSlotId, bookingDate, slotCapacity,
      // 2026-06-30 트립닷컴식 예약정보 — 결제 직전 약관 동의 메타데이터(컴플라이언스 추적용). SMS 본인인증 제거 운영자.
      // 결제/금액/멱등성 로직 무관 — booking 레코드에 그대로 보존만. 미전달 시 기본값(false/'').
      // 2026-06-29 마케팅(선택) 동의 — termsAgreed 와 완전 독립. 미동의해도 결제 진행됨(강제동의 X).
      termsAgreed, termsAgreedAt, marketingConsent, marketingConsentAt,
      // P1 (2026-07-11): 장기 유입 귀속 스냅샷 (first/last UTM) — 결제/금액/멱등성 무관,
      // sanitizeAttribution 화이트리스트 통과분만 booking 레코드에 보존 (PII 미포함).
      attribution,
      // 2026-07-17: 고객 UI 언어 — booking-processor 이메일 언어 결정용(additive, 금액/멱등성 무관).
      language } = body;
    if (!orderID) { res.writeHead(400, JSON_CORS); return res.end(JSON.stringify(_err('orderID is required', 'MISSING_FIELDS'))); }

    // 🔴 cross-flow 가드 (money-critical) — 장바구니 주문을 단건 endpoint 로 캡처하는 경로 차단.
    //
    //   cart 주문은 cart_orders/{orderID} 에만 있고 단건 스냅샷(paypal_order_snapshots/{orderID})
    //   에는 없다. 아래 단건 스냅샷 필수 검증과 별개로 cart 전용 오류를 먼저 반환해
    //   정상 장바구니 결제로 재시도하게 한다.
    //
    //   배치 이유:
    //     - PayPal capture 호출 **전** = 돈이 움직이지 않음 → 사용자는 정상 cart 경로로 안전하게 재시도.
    //     - 단건 결제 lock 획득 **전** = 그 lock 을 소비해 정상 cart capture 를 막지 않음.
    //   조회 실패를 "문서 없음" 으로 취급하지 않는다 — 인프라 장애와 무결성 실패는 다르다.
    //   (아래 lock 획득도 이미 Firestore 를 필수로 요구하므로 새 의존성이 추가되는 것은 아니다.)
    //   역방향(단건 주문 → cart endpoint)은 captureCartOrder 가 cart_orders 스냅샷을 필수로
    //   요구해 capture 전 400(NO_SNAPSHOT) 으로 이미 차단된다 — 중복 방어 불필요.
    //   DB init 실패도 cart lookup 실패와 **동일한 안전 정책**을 쓴다. 이전엔 여기서 throw 해
    //   outer catch 의 500 INTERNAL_ERROR 로 빠졌고, 응답 메시지에 내부 env 변수명이 실릴 수 있었다.
    const _db = initAdminDb('capturePaypalOrder');
    try {
      if (!_db) throw new Error('admin db unavailable');
      const _cartDoc = await _db.collection('cart_orders').doc(orderID).get();
      if (_cartDoc.exists) {
        console.warn('[capturePaypalOrder] cross-flow 거부 (cart 주문이 단건 endpoint 로 들어옴):', orderID);
        res.writeHead(400, JSON_CORS);
        // 문구는 이 파일의 기존 관례대로 영어 — 프론트가 code 로 지역화한다(Korean-only 금지).
        return res.end(JSON.stringify(_err('Cart orders must be paid through cart checkout', 'CROSS_FLOW_ORDER')));
      }
    } catch (_cfErr) {
      // fail-closed — 돈이 움직이기 전이라 재시도가 안전하다.
      console.error('[capturePaypalOrder] cross-flow 조회 실패 → capture 미호출 (fail-closed):', _cfErr.message);
      res.writeHead(503, JSON_CORS);
      return res.end(JSON.stringify(_err('Could not verify the order right now — please retry', 'ORDER_CHECK_UNAVAILABLE')));
    }

    // SECURITY (버그헌트 #11 2026-06-14): createPaypalOrder 가 저장한 주문 스냅샷에서 product/pax/date 를
    // 가져와 capture-time body 위조(저가결제로 고가서비스 booking 기록)를 무력화. AI-planner-gate 등 모든
    // 후속 로직이 보정된 product 를 쓰도록 gate 전에 수행. 서버 주문 근거가 없으면
    // 돈이 움직이기 전에 거절한다. 클라이언트 본문으로 가격·상품을 대신하지 않는다.
    //
    // 🔴 금액 검증 (신규): 이전 주석은 "PayPal 이 capture 금액을 order amount 로 강제하므로 금액은
    //   위조 불가" 였다. 그것은 PayPal **내부** 일관성에만 참이고, "이 order 가 우리 서버 견적에서
    //   났는가 / currency 가 예상과 같은가" 라는 merchant invariant 는 보장하지 않는다.
    //   → snapshot 의 expectedUSD 를 아래 capture 검증에 사용한다 (createPaypalOrder 가 이미 저장 중).
    //
    // 🔴 F2 (2026-08-09) 슬롯 바인딩: 어떤 투어/슬롯/날짜/인원을 **결제했는지** 는 create 가
    //   pre-lock 성공 시 스냅샷에 남긴 slotBooking 이 유일한 근거다. capture body 의 같은 필드는
    //   create 가 잠근 슬롯과 아무 것에도 묶여 있지 않아, 바꿔 보내면 (a) 결제하지 않은 슬롯이
    //   confirmed 되고 (b) 결제한 슬롯의 pending 은 sweep 으로 풀려 무제한 오버부킹이 됐다.
    let _snapExpectedUSD = null;
    let _snapExpectedKRW = null;
    let _snapUsdRate = null;
    let _snapEstimateConsent = null;
    let _snapSlotBooking = null;
    let _snapRecoveryDigest = null;
    let _snapOwnerUid = null;
    try {
      const _snapDb = _db; // 위 cross-flow 가드에서 확보한 인스턴스 재사용 (initAdminDb 는 싱글톤 반환).
      if (_snapDb) {
        const _snap = await _snapDb.collection('paypal_order_snapshots').doc(orderID).get();
        if (!_snap.exists) {
          res.writeHead(409, JSON_CORS);
          return res.end(JSON.stringify(_err('Order details are missing. Please create a new order.', 'NO_ORDER_SNAPSHOT')));
        }
        if (_snap.exists) {
          const _s = _snap.data() || {};
          if (!_s.productType || _s.expectedCurrency !== 'USD' || toMinorUnits(_s.expectedUSD, 'USD') === null) {
            res.writeHead(409, JSON_CORS);
            return res.end(JSON.stringify(_err('Order details could not be verified. Please create a new order.', 'INVALID_ORDER_SNAPSHOT')));
          }
          if (_s.productType) product = _s.productType;
          if (_s.passengers != null) paxCount = _s.passengers;
          if (_s.dateStart) tourDate = _s.dateStart;
          if (_s.expectedUSD != null) _snapExpectedUSD = _s.expectedUSD;
          if (Number.isSafeInteger(_s.expectedKRW) && _s.expectedKRW > 0) _snapExpectedKRW = _s.expectedKRW;
          if (Number.isFinite(_s.usdRate) && _s.usdRate > 0) _snapUsdRate = _s.usdRate;
          // 🔴 P0-2: 추정가 정산조건 동의는 **주문 생성 시점에 서버가 만든 기록**만 신뢰한다.
          //   capture body 로 받지 않는다 — 받으면 결제 직전에 위조로 채워 넣을 수 있다.
          if (_s.estimateConsent) _snapEstimateConsent = _s.estimateConsent;
          // 🔴 F2: 슬롯 확정의 유일한 근거. 없으면 아래에서 confirm 을 포기한다(body 로 대체 금지).
          if (_s.slotBooking) _snapSlotBooking = _s.slotBooking;
          if (_s.recoveryDigest) _snapRecoveryDigest = _s.recoveryDigest;
          if (_s.ownerUid) _snapOwnerUid = _s.ownerUid;
          console.log('[capturePaypalOrder] order snapshot applied:', { orderID, product: _s.productType, hasExpectedUSD: _snapExpectedUSD != null });
        }
      }
    } catch (_snapErr) {
      console.warn('[capturePaypalOrder] order snapshot read failed before capture:', _snapErr.message);
      res.writeHead(503, JSON_CORS);
      return res.end(JSON.stringify(_err('Could not verify the order right now — please retry', 'ORDER_CHECK_UNAVAILABLE')));
    }
    // 5필드 전부 갖춘 바인딩만 통과(cart 형제 경로와 같은 헬퍼 — 반쪽 잠금 금지). 없으면 null.
    const _snapSlot = readSlotFields(_snapSlotBooking);
    // 클라가 슬롯 예약이라 주장했는가 — 바인딩이 없을 때 "비슬롯 상품(정상)" 과 "바인딩 유실/위조"
    // 를 구분하는 신호로만 쓴다. 이 값이 confirm 인자로 흘러가면 안 된다.
    const _bodyClaimsSlot = !!(tourId && tourSlotId && bookingDate);

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

    // 🔴 Same-order authority (2026-10-10 recovery contract): the browser that created the order
    //   (HttpOnly capability cookie) or the authenticated owner. Proof is what lets a caller read, adopt or
    //   replay an EXISTING attempt: without it acquirePaymentAttempt (allowRecovery=false) answers an existing
    //   record with the generic DUPLICATE_ORDER and writes nothing, and a same-order reconcile is refused up
    //   front (403). A NORMAL first capture needs no proof (2026-10-20 payments review): a browser that blocks
    //   cookies must still be able to pay, exactly as before the recovery contract — the attempt record it
    //   creates is then closed to everyone without proof. A bare orderID is never authority to replay
    //   someone's order. Snapshots without digest/owner are the documented legacy boundary.
    let verifiedBuyerUid = await verifyTokenUid(req.headers?.authorization);
    const _recoverySnapshot = { recoveryDigest: _snapRecoveryDigest, ownerUid: _snapOwnerUid };
    const _sameOrderProven = isSameOrderProven({ req, flow: 'single', orderID, snapshot: _recoverySnapshot, verifiedUid: verifiedBuyerUid });
    // Same-order reconcile ({orderID, reconcile:true}): never starts a new attempt from a bare orderID.
    const _reconcileOnly = body.reconcile === true;
    if (_reconcileOnly && !_sameOrderProven && !isLegacyOpenSnapshot(_recoverySnapshot)) {
      res.writeHead(403, JSON_CORS);
      return res.end(JSON.stringify(_err('The original checkout session is required for this order', 'RECOVERY_AUTH_REQUIRED')));
    }

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
      _couponOwnerVerified = !!verifiedBuyerUid && verifiedBuyerUid === couponUserId;
      if (!_couponOwnerVerified) {
        console.warn('[capturePaypalOrder] coupon ownership mismatch — 쿠폰 경로 스킵(IDOR 가드):', orderID);
      }
    }
    let bookingAttribution = sanitizeAttribution(attribution);
    // 🔴 Immutable pre-capture intent: everything a replay needs, frozen BEFORE any PayPal call.
    //   Storage/oversize/validation failure => zero capture calls. A retry never replaces these values.
    let intent;
    try {
      intent = validateIntent({
        version: 1,
        body: {
          product, tourDate, tourTime, pickupLocation, dropoffLocation, paxCount, vehicleType, customerPhone,
          couponApplied: !!couponApplied, memo, itineraryData: itineraryData || null, userEmail: userEmail || '',
          airport: airport || null, promoCode: promoCode || null, language: language || null,
          termsAgreed: termsAgreed === true, termsAgreedAt: termsAgreedAt || '',
          marketingConsent: marketingConsent === true, marketingConsentAt: marketingConsentAt || '',
          attribution: bookingAttribution || null,
          bodyClaimsSlot: _bodyClaimsSlot, bodySlot: { tourId: tourId || null, tourSlotId: tourSlotId || null, bookingDate: bookingDate || null, slotCapacity: slotCapacity || null },
        },
        uid: verifiedBuyerUid || null,
        coupon: (discountV2 && couponDocId && couponUserId && _couponOwnerVerified) ? { couponDocId, couponUserId } : null,
        discountV2: discountV2 === true,
      });
    } catch (intentErr) {
      console.warn('[capturePaypalOrder] intent rejected before capture:', intentErr.message);
      res.writeHead(409, JSON_CORS);
      return res.end(JSON.stringify(_err(intentErr.message, intentErr.code || 'RECOVERY_INTENT_INVALID')));
    }

    // 1.5 Attempt record = the old used_paypal_orders lock, now carrying the intent + exclusive claim.
    const _environment = _isSandboxCapture ? 'sandbox' : 'live';
    const acquired = await acquirePaymentAttempt({
      db: dbForLock, orderID, flow: 'single', environment: _environment, requestKey: `${orderID}-cap`,
      intent, userEmail, product: product || 'unknown', createIfMissing: !_reconcileOnly, allowRecovery: _sameOrderProven,
    });
    if (acquired.kind === 'absent') {
      // No attempt record = this contract never called the provider for this order (records are created
      // before any POST and discarded only on provider-proven nonpayment). Durable evidence of no capture.
      res.writeHead(409, JSON_CORS);
      return res.end(JSON.stringify({ ...notCapturedResponse({ orderID, flow: 'single', reason: 'no_attempt_record' }), evidence: 'no_attempt_record' }));
    }
    if (acquired.kind === 'unauthorized') {
      // Existing attempt but no proof of same-order ownership: generic answer, no private data, no writes.
      console.warn('[capturePaypalOrder] recovery refused without same-order proof:', orderID);
      res.writeHead(409, JSON_CORS);
      return res.end(JSON.stringify(_err('Order already processed', 'DUPLICATE_ORDER')));
    }
    if (acquired.kind === 'finalized') {
      // Same authorized caller asking again after completion: replay the recorded minimal answer.
      const stored = acquired.lock.finalResponse || { status: 200, body: _ok({ orderID, message: 'Booking already confirmed.' }) };
      res.writeHead(stored.status || 200, JSON_CORS);
      return res.end(JSON.stringify({ ...stored.body, replayed: true }));
    }
    if (acquired.kind === 'duplicate') {
      console.warn('[capturePaypalOrder] duplicate orderID blocked:', orderID);
      res.writeHead(409, JSON_CORS);
      return res.end(JSON.stringify(_err('Order already processed', 'DUPLICATE_ORDER')));
    }
    if (acquired.kind === 'in_progress') {
      res.writeHead(202, JSON_CORS);
      return res.end(JSON.stringify(pendingPaymentResponse({ orderID, flow: 'single', paymentStatus: acquired.lock.captureVerified ? 'CAPTURED' : 'CAPTURE_UNKNOWN', inProgress: true })));
    }
    if (acquired.kind === 'cross_flow') {
      res.writeHead(400, JSON_CORS);
      return res.end(JSON.stringify(_err('Cart orders must be paid through cart checkout', 'CROSS_FLOW_ORDER')));
    }
    if (acquired.kind === 'environment') {
      res.writeHead(409, JSON_CORS);
      return res.end(JSON.stringify(_err('Order belongs to a different PayPal environment', 'ORDER_ENVIRONMENT_MISMATCH')));
    }
    const attempt = acquired.attempt;
    const stages = (attempt.lock && attempt.lock.stages) || {};
    if (attempt.recovering) {
      // Replay uses ONLY the saved intent — capture-time body and identity never replace it.
      const saved = attempt.lock.intent;
      ({ product, tourDate, tourTime, pickupLocation, dropoffLocation, paxCount, vehicleType, customerPhone,
        couponApplied, memo, itineraryData, userEmail, airport, promoCode, language,
        termsAgreed, termsAgreedAt, marketingConsent, marketingConsentAt } = saved.body);
      verifiedBuyerUid = saved.uid || null;
      bookingAttribution = saved.body.attribution || null;
      couponDocId = saved.coupon ? saved.coupon.couponDocId : null;
      couponUserId = saved.coupon ? saved.coupon.couponUserId : null;
      _couponOwnerVerified = !!saved.coupon;
      intent = saved;
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
          if (data.isRevoked === true) throw new Error('COUPON_REVOKED');
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
        if (attempt.recovering) {
          // Money may already be captured — never abandon the order over a coupon; operator decides.
          console.error('[capturePaypalOrder] coupon pre-lock failed during recovery — continuing without coupon:', orderID);
          notifyOperator('coupon-race', `<code>${orderID}</code>\n복구 중 쿠폰 선점 실패: ${code} — 예약은 계속 진행, 쿠폰 수동 확인`).catch(() => {});
        } else {
          // capture 0회 — 주문 lock 해제, 사용자가 다른 쿠폰/쿠폰 없이 재시도 가능.
          await discardAttempt(attempt).catch((e) => {
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
    }

    // 2. Capture / reconcile. Existing or unknown attempts GET the order first; a fresh attempt POSTs
    //    under the exclusive claim with the stable idempotency key. Timeout / 5xx / bad JSON keep the
    //    order lock AND the coupon reservation (UNKNOWN, 202). Only provider-proven nonpayment releases.
    const postCapture = async () => {
      const captureRes = await fetch(`${PAYPAL_BASE_URL}/v2/checkout/orders/${orderID}/capture`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          // P790 (2026-06-03): PayPal 공식 멱등성 헤더 — 재시도/복구는 항상 같은 키를 쓴다.
          'PayPal-Request-Id': `${orderID}-cap`,
        },
        signal: AbortSignal.timeout(25_000),
      });
      const text = await captureRes.text();
      let body = null; let parseError = null;
      try { body = JSON.parse(text); } catch (e) { parseError = e.message; }
      return { status: captureRes.status, body, parseError };
    };
    const reconciled = await reconcileCapture({ attempt, orderID, baseUrl: PAYPAL_BASE_URL, accessToken, postCapture });
    if (reconciled.state === 'not_captured') {
      // PR #427 (CY4): capture never happened — release coupon + order lock so the user can pay again.
      if (couponLockRef) {
        couponLockRef.update({ isUsed: false, usedAt: null, usedOrderID: null, pendingCapture: false }).catch((e) => {
          console.warn('[capturePaypalOrder] coupon release after capture fail (non-fatal):', e.message);
        });
      }
      await discardAttempt(attempt).catch((delErr) => {
        console.warn('[capturePaypalOrder] lock release failed (CY1 retry path):', delErr.message);
      });
      console.warn('[capturePaypalOrder] capture not completed:', orderID, reconciled.reason);
      res.writeHead(409, JSON_CORS);
      return res.end(JSON.stringify(notCapturedResponse({ orderID, flow: 'single', reason: reconciled.reason })));
    }
    if (reconciled.state !== 'captured') {
      console.error('[capturePaypalOrder] capture result UNKNOWN — reservations retained:', orderID, reconciled.reason);
      await updateAttempt(attempt, { captureState: 'unknown', lastUnknownReason: reconciled.reason || 'unknown', lastUnknownAtMs: Date.now() }).catch(() => {});
      await releaseAttemptClaim(attempt);
      await throttledTelegramAlert({
        key: `single-capture-unknown-${orderID}`, channel: 'admin', severity: 'warning',
        message: [`🕒 <b>단건 capture 결과 미상 (주문·쿠폰 예약 유지)</b>`, `<b>OrderID:</b> <code>${orderID}</code>`, `<b>사유:</b> ${reconciled.reason}`, '→ 같은 주문 재확인 시 PayPal GET 으로 대조. 새 결제 생성은 차단됨.'].join('\n'),
        context: { orderID, reason: reconciled.reason },
      }).catch(() => {});
      res.writeHead(202, JSON_CORS);
      return res.end(JSON.stringify(pendingPaymentResponse({ orderID, flow: 'single', paymentStatus: 'CAPTURE_UNKNOWN' })));
    }
    // PR #427 (CY4): finalise coupon — clear the pendingCapture flag so the
    // coupon is unambiguously "spent" rather than "in-flight".
    if (couponLockRef) {
      try {
        await couponLockRef.update({ pendingCapture: false });
      } catch (e) {
        console.warn('[capturePaypalOrder] coupon finalise failed:', e.message);
      }
    }

    const capture = reconciled.capture || null;
    const _stored = reconciled.verified || null;
    // 필드 추출 + 누락 시 명시 로그 (LIVE 응답 누락이 admin 로그 미노출의 첫 번째 원인 후보).
    const captureNode = capture ? capture.purchase_units?.[0]?.payments?.captures?.[0] : null;
    const payerEmail = _stored ? _stored.payerEmail : (capture.payer?.email_address ?? '');
    const payerName = _stored ? _stored.payerName : `${capture.payer?.name?.given_name ?? ''} ${capture.payer?.name?.surname ?? ''}`.trim();
    const amount = _stored ? _stored.amountValue : (captureNode?.amount?.value ?? '');
    const captureID = _stored ? _stored.captureID : (captureNode?.id ?? '');
    const hasPayer = !!payerEmail;
    const hasCapture = !!captureID;
    const hasAmount = !!amount;
    if (!hasPayer || !hasCapture || !hasAmount) {
      console.error('[capturePaypalOrder] field missing:', { hasPayer, hasCapture, hasAmount, orderID });
    }

    // 🔴 capture 무결성 검증 (money-critical) — _shared/paypal-capture-verify.js (cart 와 공통 SSOT).
    //   amount(정수 minor) + currency + 개별 capture status + purchase-unit/capture cardinality 를
    //   서버 snapshot(expectedUSD)과 대조. A stored verified summary is replayed as-is (verified once).
    const _expectedMinor = toMinorUnits(_snapExpectedUSD, 'USD');
    const _verdict = _stored
      ? { ok: !_stored.pending, pending: _stored.pending, code: _stored.pending ? 'CAPTURE_PENDING' : undefined, detail: 'replayed verified capture', captureID, amountMinor: _stored.amountMinor, currency: _stored.currency }
      : verifyCaptureIntegrity({ capture, expectedAmountMinor: _expectedMinor, expectedCurrency: 'USD' });

    if (_verdict && _verdict.pending) {
      // 🔴 PENDING = PayPal 리스크 홀드 / eCheck = **정상 결제 흐름** (금액·통화는 이미 정합 확인됨).
      //   격리하면 booking doc 이 생기지 않고, 홀드 해제 시 오는 PAYMENT.CAPTURE.COMPLETED webhook 이
      //   예약을 못 찾아 'unmatched' 로 흘러 → 돈은 정산되고 예약은 영영 없음.
      //   → 기존 동작대로 예약을 진행하고, 정산 대기 사실만 기록/알림한다.
      console.warn('[capturePaypalOrder] capture PENDING (정산 대기) — 예약 진행:', orderID, _verdict.detail);
      await throttledTelegramAlert({
        key: `single-capture-pending-${orderID}`,
        channel: 'admin',
        severity: 'warning',
        message: [
          '🕒 <b>단건 capture PENDING (정산 대기 · 예약은 확정 진행)</b>',
          `<b>OrderID:</b> <code>${orderID}</code> <b>CaptureID:</b> <code>${captureID}</code>`,
          `<b>사유:</b> ${_verdict.detail}`,
          '→ PayPal 리스크 홀드/eCheck 추정. 금액·통화는 정합. 정산 완료 여부 확인 필요.',
        ].join('\n'),
        context: { orderID, captureID, code: _verdict.code },
      }).catch(() => {});
    } else if (_verdict && !_verdict.ok) {
      // 무결성 불일치 → 예약 확정 + 후속처리(booking doc·슬롯·이메일·바우처·processor) 전부 중단.
      // 일반 실패로 버리지 않는다 (사용자 재결제 = 이중청구). 자동환불도 안 함 = 운영자 판단.
      let _reviewRecorded = false;
      try {
        const _rdb = initAdminDb('capturePaypalOrder-review');
        if (!_rdb) throw new Error('Firestore unavailable');
        await recordPaymentReview({
          db: _rdb, serverTimestamp: FieldValue.serverTimestamp(),
          flow: 'single', orderID, verdict: _verdict, capture,
          expectedAmountMinor: _expectedMinor, expectedCurrency: 'USD',
          userEmail, payerEmail,
          // 운영자 해결(MANUALLY_CONFIRMED/REFUNDED)에 필요한 최소 정보 — 없으면 해결 자체가 불가능.
          // 쿠폰은 이 시점에 이미 소진(pre-lock)됐다 → 자동 복구하지 않고(운영자 판단) 기록만 남긴다.
          coupon: (couponDocId || promoCode) ? { couponDocId: couponDocId || null, couponUserId: couponUserId || null, promoCode: promoCode || null } : null,
          bookingPayload: {
            productType: product || '', tourDate: tourDate || '', tourTime: tourTime || '',
            paxCount: paxCount || 0, pickupLocation: pickupLocation || '', dropoffLocation: dropoffLocation || '',
            vehicleType: vehicleType || '', airport: airport || null,
            // 🔴 F2: 운영자 해결 화면은 **결제된** 슬롯을 봐야 한다 — body 주장이 아니라 스냅샷 바인딩.
            tourId: (_snapSlot && _snapSlot.tourId) || null,
            tourSlotId: (_snapSlot && _snapSlot.slotId) || null,
            bookingDate: (_snapSlot && _snapSlot.date) || null,
          },
        });
        _reviewRecorded = true;
      } catch (_revErr) {
        console.error('[capturePaypalOrder] payment_review 기록 실패 (캡처된 돈의 durable 기록 없음):', _revErr);
      }
      // ⚠️ await 필수 — 서버리스는 res.end() 후 실행이 정지될 수 있다. fire-and-forget 이면
      //   review 기록까지 실패한 최악의 경우에 **돈만 나가고 기록도 알림도 0** 이 된다.
      //   throttle key 는 주문별 — 상수 key 면 5분 창 안의 다른 주문 불일치가 통째로 억제된다.
      await throttledTelegramAlert({
        key: `single-capture-mismatch-${orderID}`,
        channel: 'admin',
        severity: 'critical',
        message: [
          '🚨 <b>단건 capture 무결성 불일치 (예약 미확정)</b>',
          '',
          `<b>OrderID:</b> <code>${orderID}</code>`,
          `<b>CaptureID:</b> <code>${captureID}</code>`,
          `<b>capture status:</b> ${capture?.purchase_units?.[0]?.payments?.captures?.[0]?.status ?? 'unknown'}`,
          `<b>사유:</b> ${_verdict.code} — ${_verdict.detail}`,
          (couponDocId || promoCode) ? '<b>쿠폰/프로모 소진됨</b> — 해결 시 복구 판단 필요' : '',
          '',
          _reviewRecorded
            ? '→ payment_reviews/{orderID} 격리됨(Firebase 콘솔에서 확인). 예약 미확정 · 이메일/바우처/슬롯 미실행.'
            : '🔴 payment_reviews 기록도 실패 — 즉시 수동 확인 필요(durable 기록 없음).',
        ].filter(Boolean).join('\n'),
        context: { orderID, captureID, code: _verdict.code, reviewRecorded: _reviewRecorded },
      }).catch((e) => { console.error('[capturePaypalOrder] mismatch 알림 실패:', e?.message); });
      // Quarantined attempt: not finalized, never re-captured; new orders stay blocked until the review resolves.
      await updateAttempt(attempt, { status: 'captured', captureState: 'captured', reviewQuarantined: true, captureID, claimUntil: 0 }).catch(() => {});

      // 202 Accepted — 예약 미확정. retryable:false (재결제 = 이중청구).
      // paymentCaptured 는 실제 capture status 에서 파생 (돈이 안 움직인 verdict 에 "결제됨" 이라 하지 않음).
      res.writeHead(202, JSON_CORS);
      return res.end(JSON.stringify(buildPaymentReviewResponse({
        orderID, captureID, capture,
      })));
    }

    // PayPal capture 응답에서 민감정보 없는 필드만 추려서 Firestore에 보존 (디버깅 + 운영자 매칭용).
    const rawCapturePayload = {
      payer: { email_address: payerEmail },
      amount: captureNode?.amount ?? (_stored ? { value: _stored.amountValue, currency_code: _stored.currency } : null),
      captureID,
      status: capture ? (capture.status ?? '') : _stored.orderStatus,
      create_time: captureNode?.create_time ?? capture?.create_time ?? '',
    };

    // 2.4 bookings/{orderID} 정식 레코드 생성 — cancel/modify/my-bookings API가 조회.
    // captureID는 취소 시 PayPal Refund 호출에 필수.
    //
    // PR #425 (Audit CY2 — 2026-05-14): amountKRW 를 capture 시점에 계산해
    // 저장. 이전엔 amountUSD 만 저장 → cancelBooking.js:167 의
    // `(booking.amountKRW || 0) * policy.refundRatio` 가 항상 0 → 마이페이지
    // 환불 영수증에 "₩0 환불" 표기 → 사용자 신고 폭주.
    // 주문 때 확정한 금액·환율을 보존한다. 이전 주문의 기록도 현재 환율로 재가격하지 않는다.
    const usdToKrw = _snapUsdRate || (_snapExpectedKRW ? _snapExpectedKRW / Number(_snapExpectedUSD) : 0)
      || (loadPricingSpec() || {}).charter_usd_fix_rate || 1350;
    const amountKRW = _snapExpectedKRW || Math.round(_verdict.amountMinor * usdToKrw / 100);
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
    // 🔴 2026-07-29 (#3 신뢰 가능한 uid 연결): 구매자 uid 는 **검증된 Firebase ID 토큰에서만**
    //   (verifiedBuyerUid, 위에서 1회 검증 + intent 에 동결). 비로그인 게스트 결제는 null.
    const processorPayload = {
      orderID,
      payerEmail,
      payerName,
      amount,
      product,
      tourDate,
      pickupLocation,
      dropoffLocation,
      paxCount,
      vehicleType,
      customerPhone,
      couponApplied,
      memo,
      itineraryData,
      airport,
      language,
    };
    const bookingDocPayload = {
      bookingRef: orderID,
      orderID,
      captureID,
      userEmail: (userEmail || '').toLowerCase(),
      // 검증된 Firebase 토큰 uid (게스트 결제는 null). 포인트 원장의 유일한 uid 출처.
      uid: verifiedBuyerUid || null,
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
      // 2026-06-30 트립닷컴식 예약정보 — 약관동의 메타. 결제 로직 무관, 추적용 보존 (SMS 본인인증 제거 운영자).
      termsAgreed: termsAgreed === true,
      termsAgreedAt: termsAgreedAt || '',
      // 2026-06-29 마케팅(선택) 동의 — bookings 문서 독립 필드. termsAgreed 와 무관, 결제 게이트 미포함.
      marketingConsent: marketingConsent === true,
      marketingConsentAt: marketingConsentAt || '',
      // 🔴 2026-07-30 (P0-2): 추정가 정산조건 동의 근거 — 주문 스냅샷(서버 생성)에서만 온다.
      //   { agreed, policyVersion, tolerancePct, agreedAtServer }. 확정가 상품은 null.
      estimateConsent: _snapEstimateConsent || null,
      airport: airport || null,
      amountUSD: amount,
      amountKRW,
      capturedExchangeRate: usdToKrw,
      // PayPal capture 응답에서 검증한 통화.
      currency: (_verdict && _verdict.currency) || 'USD',
      // 🔴 2026-07-29: 이 예약이 **어느 PayPal 환경**에서 만들어졌는지. 웹훅이 환경을 넘나들며
      //   문서를 건드리지 못하게 하는 근거값이다(샌드박스 웹훅이 운영 예약을 환불처리하는 사고 차단).
      paypalEnvironment: _isSandboxCapture ? 'sandbox' : 'live',
      // 감사/대사용 — false = 주문 스냅샷이 없어 amount/currency 검증을 못 한 레거시 경로.
      // (pending 은 금액·통화 검증을 통과한 상태이므로 verified 로 본다.)
      paymentVerified: !!(_verdict && (_verdict.ok || _verdict.pending)),
      // 🕒 PayPal 리스크 홀드/eCheck = 자금 정산 대기. 예약은 확정하되 정산 확인이 필요함을 남긴다.
      paymentPending: !!(_verdict && _verdict.pending),
      processorStatus: 'pending',
      purchaseCouponsEnabled: discountV2 === true,
      rawCapturePayload,
      // P1 (2026-07-11): 장기 유입 귀속 — first/last UTM 스냅샷 (화이트리스트 통과분만, PII 없음).
      // 유효 데이터 없으면 필드 생략. 어떤 실패도 결제/기록을 막지 않음(sanitize 는 throw 안 함).
      ...(bookingAttribution ? { attribution: bookingAttribution } : {}),
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    };
    // 🔴 Mandatory durable boundary: booking + processor retry intent + verified capture summary in ONE
    //   transaction (existing booking/intent docs are never replaced). Failure => 202 finalized:false,
    //   no slot / promo / processor / confirmed UI. Same-order replay reconstructs the missing state.
    const captureVerified = _stored || summarizeVerifiedCapture({ verdict: _verdict, capture, payerEmail, payerName, amountValue: amount, captureID });
    const persisted = await withBackoff(() => persistBookingsAtomically({
      db: dbForLock, attempt, timestamp: FieldValue.serverTimestamp(), lockPatch: { captureVerified, captureID },
      bookings: [{ orderID, doc: bookingDocPayload, payload: processorPayload, source: 'capturePaypalOrder' }],
    }));
    const bookingWriteOk = persisted.ok;
    if (!bookingWriteOk) {
      const lastBookingErr = persisted.error;
      console.error('[capturePaypalOrder] mandatory booking persistence failed:', lastBookingErr && lastBookingErr.message);
      await updateAttempt(attempt, { status: 'captured', captureState: 'captured', captureVerified, captureID }).catch(() => {});
      await releaseAttemptClaim(attempt);
      // CRITICAL — payment captured but reservation record missing. Same-order replay repairs it.
      await throttledTelegramAlert({
        key: `bookings-doc-write-fail-${orderID}`,
        channel: 'admin',
        severity: 'critical',
        message: [
          '🚨 <b>CRITICAL — bookings doc 저장 실패 (PayPal 결제 완료됨 · 202 미확정 응답)</b>',
          '',
          `<b>OrderID:</b> <code>${orderID}</code>`,
          `<b>CaptureID:</b> <code>${captureID}</code>`,
          `<b>금액:</b> $${amount} / ₩${amountKRW.toLocaleString('ko-KR')}`,
          `<b>이메일:</b> ${payerEmail || userEmail || '(none)'}`,
          `<b>최종 사유:</b> ${(lastBookingErr?.message || 'unknown').slice(0, 250)}`,
          '',
          '→ 손님 화면은 "예약 확인 중"(확정 아님). 같은 주문 재확인이 저장을 복구한다.',
          `→ 수동: <code>POST /api/admin-replay-booking-notifications {bookingId:"${orderID}"}</code>`,
        ].join('\n'),
        context: { orderID, captureID, amountUSD: amount, amountKRW, source: 'capturePaypalOrder' },
      }).catch(() => {});
      res.writeHead(202, JSON_CORS);
      return res.end(JSON.stringify(pendingPaymentResponse({ orderID, flow: 'single', paymentStatus: 'CAPTURED' })));
    }
    const retryStatusBefore = persisted.value.retryStatus[orderID] || 'pending';
    const markStage = (stage, patch) => updateAttempt(attempt, { stages: { [stage]: { ...patch, atMs: Date.now() } } });

    // AI 해금과 구매 쿠폰은 검증된 예약 문서를 읽는 booking-processor에서
    // 멱등 처리한다. Capture 함수 종료와 함께 후속 작업이 사라지는 경로를 없앤다.

    // P108 (2026-05-20): 슬롯 capacity confirm — bookings doc 저장 성공 후 pending
    // → confirmed 전환. 실패해도 booking 자체는 이미 confirmed (결제 완료) — alert 만 발사, throw X.
    // 슬롯 lock 만료 + 다른 confirmed 가 채워졌으면 SLOT_FULL_AT_CAPTURE — 운영자가
    // overbooking 발생 사실 인지하고 수동 환불/조정 결정. payment refund 자동 X
    // (운영자 정책: 결제 일단 받고 운영자가 사후 처리).
    //
    // 🔴 2026-08-09 (F2): 게이트가 **스냅샷 바인딩(_snapSlot)** 이다. 이전엔 body 4필드였고,
    //   create 가 잠근 슬롯과 묶여 있지 않아 capture 때 값을 갈아끼우면 결제하지 않은 슬롯이
    //   확정되고 결제한 슬롯은 sweep 으로 풀렸다. cart 형제 경로(captureCartOrder)는 이미
    //   cart_orders 스냅샷 라인에서 readSlotFields 로 읽는다 — 같은 계약을 단건에도 맞춘다.
    // Stage markers: a started/completed/failed slot stage is never re-run on replay (confirm is not
    //   order-idempotent — re-running would consume capacity twice). Started-but-unfinished = quarantined.
    let slotStageClaimed = false;
    if (bookingWriteOk && _snapSlot && !stages.slot) {
      try { await markStage('slot', { state: 'started' }); slotStageClaimed = true; } catch (e) {
        console.error('[capturePaypalOrder] slot stage marker failed — confirm skipped (ambiguity guard):', e.message);
        await throttledTelegramAlert({ key: `slot-confirm-STAGE_MARK_FAILED-${orderID}`, channel: 'admin', severity: 'high', message: `⚠️ <b>슬롯 confirm 보류 — 단계 기록 실패</b>\n<b>OrderID:</b> <code>${orderID}</code>\n→ 수동 좌석 확정 검토.`, context: { orderID } }).catch(() => {});
      }
    } else if (bookingWriteOk && _snapSlot && stages.slot && stages.slot.state === 'started') {
      await throttledTelegramAlert({ key: `slot-confirm-AMBIGUOUS-${orderID}`, channel: 'admin', severity: 'high', message: `⚠️ <b>슬롯 confirm 결과 불명 (이전 시도 중단) — 재실행 안 함</b>\n<b>OrderID:</b> <code>${orderID}</code>\n→ tour_availability 수동 확인.`, context: { orderID } }).catch(() => {});
    }
    if (slotStageClaimed) {
      try {
        const db = initAdminDb('capturePaypalOrder.slotConfirm');
        if (db) {
          // 🔴 2026-08-08 서버 정원 재확인 — 스냅샷 정원조차 그대로 믿지 않는다(create 이후
          //   운영자가 정원을 줄였을 수 있다). pending 이 만료된 주문은 confirmSlotLock 이 이 값으로
          //   SLOT_FULL_AT_CAPTURE 재검증을 하므로 과대 정원이면 재검증이 무력화된다. create
          //   경로(#1258)와 같은 원본 tours/{tourId}.slots[] 로 재확인 — 단 **어느 슬롯을**
          //   재확인할지는 스냅샷 바인딩이 정한다(F2: body 가 정하면 공격자가 고른 슬롯을 검증한다).
          //   여기는 돈이 이미 빠진 뒤 — 응답을 깨는 fail-closed 금지: 결정적 거부(삭제된 투어/슬롯·
          //   꺼짐·정원 미설정)는 confirm 을 포기하고 아래 catch 의 텔레그램 알림 경로로만 보낸다.
          //   Firestore 조회 장애(throw)만 **스냅샷 정원**(= create 시 서버가 검증한 값)으로 후퇴한다.
          let effectiveCapacity = _snapSlot.capacity;
          let verified = null;
          try {
            verified = await fetchServerSlotCapacity({ adminDb: db, tourId: _snapSlot.tourId, slotId: _snapSlot.slotId });
          } catch (verifyErr) {
            console.warn('[capturePaypalOrder] slot capacity verify failed — 스냅샷 정원으로 후퇴:', verifyErr.message);
          }
          if (verified) {
            if (!verified.ok) {
              console.warn('[capturePaypalOrder] slot capacity verify rejected:', verified.code,
                { tourId: _snapSlot.tourId, slot: _snapSlot.slotId, snapshotCapacity: effectiveCapacity });
              const e = new Error(`slot capacity verify rejected at capture: ${verified.code}`);
              e.code = verified.code;
              throw e;
            }
            if (verified.capacity !== effectiveCapacity) {
              console.warn('[capturePaypalOrder] slot capacity mismatch — 서버 값 사용:',
                { tourId: _snapSlot.tourId, slot: _snapSlot.slotId, snapshotCapacity: effectiveCapacity, serverCapacity: verified.capacity });
            }
            effectiveCapacity = verified.capacity;
          }
          await confirmSlotLock({
            adminDb: db,
            tourId: _snapSlot.tourId,
            date: _snapSlot.date,
            slotId: _snapSlot.slotId,
            pax: _snapSlot.pax,
            capacity: effectiveCapacity,
            orderId: orderID,
          });
          console.log('[capturePaypalOrder] slot confirmed:', { tourId: _snapSlot.tourId, date: _snapSlot.date, slot: _snapSlot.slotId, pax: _snapSlot.pax });
          await markStage('slot', { state: 'completed' }).catch(() => {});
        }
      } catch (slotErr) {
        const code = slotErr.code || 'SLOT_CONFIRM_FAILED';
        console.error('[capturePaypalOrder] slot confirm failed:', code, slotErr.message);
        await markStage('slot', { state: 'failed', code }).catch(() => {});
        // SLOT_FULL_AT_CAPTURE = overbooking risk — operator 즉시 인지 필요.
        const severity = code === 'SLOT_FULL_AT_CAPTURE' ? 'critical' : 'high';
        // ⚠️ await 필수 — 서버리스는 res.end() 뒤 실행을 중단할 수 있다(fire-and-forget = 알림 유실).
        //   throttle key 도 **주문별** — `slot-confirm-${code}` 같은 오류코드 단위 key 는 5분 창 안의
        //   서로 다른 유료 주문을 한 건으로 합쳐 뒤 주문의 orderID 를 운영자가 못 본다. 여기는
        //   결제·예약은 확정됐고 좌석만 미확정 = 주문마다 수동 복구가 필요하므로 한 건도 숨으면 안 된다.
        //   (같은 주문 재시도는 key 가 같으므로 계속 dedup 된다.)
        await throttledTelegramAlert({
          key: `slot-confirm-${code}-${orderID}`,
          channel: 'admin',
          severity,
          message: [
            `⚠️ <b>슬롯 confirm 실패 (결제 완료 후) — ${code}</b>`,
            ``,
            `<b>OrderID:</b> <code>${orderID}</code>`,
            `<b>tourId:</b> ${_snapSlot.tourId}`,
            `<b>date/slot:</b> ${_snapSlot.date} / ${_snapSlot.slotId}`,
            `<b>pax:</b> ${_snapSlot.pax} <b>capacity:</b> ${_snapSlot.capacity}`,
            `<b>오류:</b> ${slotErr.message?.slice(0, 200)}`,
            ``,
            `${code === 'SLOT_FULL_AT_CAPTURE' ? '🚨 overbooking 가능성 — 운영자 수동 검토 + 환불/조정 결정 필요.' : '슬롯 카운터 불일치. lockfix scripts/admin-slot-rebuild 검토.'}`,
          ].join('\n'),
          context: { orderID, tourId: _snapSlot.tourId, bookingDate: _snapSlot.date, tourSlotId: _snapSlot.slotId, paxCount: _snapSlot.pax, slotCapacity: _snapSlot.capacity, code },
        }).catch((e) => { console.error('[capturePaypalOrder] slot-confirm 알림 실패:', e?.message); });
      }
    } else if (bookingWriteOk && !_snapSlot && _bodyClaimsSlot && !attempt.recovering) {
      // 🔴 F2 fail-closed(슬롯 한정): 클라는 슬롯 예약이라 하는데 create 스냅샷에 바인딩이 없다.
      //   원인은 둘 중 하나다 — (a) capture body 위조/스냅샷 없는 레거시·클라 직접 주문,
      //   (b) 이 배포 **직전** 에 만들어져 바인딩 없이 저장된 in-flight 주문.
      //   어느 쪽이든 body 값으로 좌석을 확정하지 않는다(그게 이 버그의 본체였다). 대신 결제·예약은
      //   그대로 두고(돈은 이미 빠졌다) 운영자에게 알린다 — pending 은 sweep 으로 풀리므로
      //   (b) 인 경우 운영자가 좌석을 수동 확정해야 한다.
      console.warn('[capturePaypalOrder] slot confirm 스킵 — 스냅샷 슬롯 바인딩 없음 (body 신뢰 금지):',
        { orderID, bodyTourId: tourId, bodySlot: tourSlotId, bodyDate: bookingDate });
      // ⚠️ await + 주문별 key — 위 confirm-실패 경로와 같은 이유(서버리스 중단 유실 / 5분 창 병합).
      await throttledTelegramAlert({
        key: `slot-confirm-SLOT_SNAPSHOT_MISSING-${orderID}`,
        channel: 'admin',
        severity: 'high',
        message: [
          '⚠️ <b>슬롯 confirm 스킵 — 주문 스냅샷에 슬롯 바인딩 없음 (SLOT_SNAPSHOT_MISSING)</b>',
          ``,
          `<b>OrderID:</b> <code>${orderID}</code>`,
          `<b>클라 주장:</b> ${tourId} / ${bookingDate} / ${tourSlotId} (pax ${paxCount}, capacity ${slotCapacity})`,
          ``,
          '→ 결제·예약은 확정됨. 좌석만 미확정 — capture body 는 신뢰하지 않는다(위조 가능).',
          '→ 배포 직전 생성된 in-flight 주문이면 좌석 수동 확정 필요. 아니면 위조 시도.',
        ].join('\n'),
        context: { orderID, code: 'SLOT_SNAPSHOT_MISSING', bodyTourId: tourId || null, bodyTourSlotId: tourSlotId || null, bodyBookingDate: bookingDate || null },
      }).catch((e) => { console.error('[capturePaypalOrder] SLOT_SNAPSHOT_MISSING 알림 실패:', e?.message); });
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
    // 🔴 incrementGlobalPromoUsage is NOT order-idempotent (stores only lastOrderID) — the promo stage
    //   runs at most once per order. A started-but-unrecorded stage means the increment (and possibly the
    //   limit verdict) is unknown: fail closed — no processor, no confirmed answer, operator review.
    const _promoUpper = (promoCode && typeof promoCode === 'string') ? promoCode.toUpperCase() : '';
    const _promoKnown = !!_promoUpper && KNOWN_GLOBAL_PROMO_CODES.includes(_promoUpper);
    const _promoQuarantine = async (why) => {
      console.error('[capturePaypalOrder] promo stage unresolved — fail closed (no processor, 202):', orderID, why);
      await updateAttempt(attempt, { promoStageUnknown: true, promoStageUnknownReason: why, claimUntil: 0 }).catch(() => {});
      await throttledTelegramAlert({ key: `promo-stage-AMBIGUOUS-${orderID}`, channel: 'admin', severity: 'high', message: `⚠️ <b>글로벌 프로모 사용량 반영 결과 불명 — 재실행 안 함 · 예약 미확정(202)</b>\n<b>OrderID:</b> <code>${orderID}</code> <b>code:</b> ${_promoUpper}\n<b>사유:</b> ${why}\n→ global_promo_usage 수동 확인 후 used_paypal_orders.stages.promo 를 정리하세요.`, context: { orderID, why } }).catch(() => {});
      res.writeHead(202, JSON_CORS);
      return res.end(JSON.stringify({ ...pendingPaymentResponse({ orderID, flow: 'single', paymentStatus: 'CAPTURED' }), reviewReason: 'promo_stage_unknown' }));
    };
    if (_promoKnown && stages.promo && stages.promo.state !== 'completed') return _promoQuarantine('stage_started_without_record');
    if (_promoKnown && !stages.promo) {
      const upper = _promoUpper;
      const db = initAdminDb('capturePaypalOrder');
      let promoStageClaimed = false;
      try { await markStage('promo', { state: 'started', code: upper }); promoStageClaimed = true; } catch (e) {
        console.error('[capturePaypalOrder] promo stage marker failed — increment skipped (ambiguity guard):', e.message);
      }
      if (!promoStageClaimed) return _promoQuarantine('stage_marker_write_failed');
      if (promoStageClaimed) {
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
            // 0) 🔴 Durable terminal result BEFORE any external refund: every same-order replay from now on
            //    gets this 409 (never confirmed, never a second increment or refund). If this cannot be
            //    recorded, the refund stays with the operator (fail closed, 202).
            const promoBody = _err(
              `Promo code "${upper}" reached its usage limit. A manual refund will be issued — operator notified.`,
              'PROMO_LIMIT_EXCEEDED'
            );
            try {
              // Atomic: lock terminal + booking REFUND_PENDING + retry intent closed (held intent never opens).
              await recordTerminalBeforeRefund({
                db: dbForLock, attempt, orderID, retryDocIds: [orderID], refundReason: 'PROMO_LIMIT_EXCEEDED', timestamp: FieldValue.serverTimestamp(),
                lockPatch: {
                  stages: { promo: { state: 'completed', code: upper, limitExceeded: true, atMs: Date.now() } },
                  finalOutcome: 'promo_refund_required', finalResponse: { status: 409, body: promoBody },
                },
              });
            } catch (recordErr) {
              notifyOperator('coupon-race', `<code>${orderID}</code>\n사유: PROMO_LIMIT_EXCEEDED (${upper}) — 종결 기록 실패, 자동환불 보류\n→ 수동 환불 필요`).catch(() => {});
              return _promoQuarantine(`limit_exceeded_record_failed: ${recordErr.message}`);
            }
            console.warn('[capturePaypalOrder] booking stopped as', 'REFUND_PENDING', '— terminal recorded before refund:', orderID);
            notifyOperator('coupon-race',
              `<code>${orderID}</code>\n사유: PROMO_LIMIT_EXCEEDED (${upper})\n사용: ${promoResult.usedCount}/${promoResult.maxUses}\n자동환불 시도 중 — 후속 알림이 없으면 수동환불 필요`
            ).catch((alertErr) => console.error('[capturePaypalOrder] operator alert failed:', alertErr.message));
            // 1) Refund the PayPal capture (we already charged the user).
            let refundOk = false;
            let provenRefundID = null; // strict receipt proof — gates only the terminal client answer (step 4)
            try {
              const refundRes = await refundPaypalCapture({
                captureID,
                // 🔴 이중환불 방어 키 (2026-07-15). orderID + 사유 — 이 주문의 PROMO 자동환불 1건.
                //   used_paypal_orders 락이 재capture 를 막아 여기 두 번 도달하지 않지만,
                //   helper 가 키를 필수로 요구하고(fail-closed) 이 경로도 타임아웃 창이 있다.
                //   captureID 단독 금지 — cart 자식들이 captureID 를 공유한다(helper 주석 참조).
                idempotencyKey: `${orderID}:promo-limit`,
                refundUSD: amount,
                // capture 통화 우선 — 이 스코프에 검증된 통화가 이미 있다.
                currency: _verdict && _verdict.currency,
                note: `PROMO_LIMIT_EXCEEDED race (${upper}) — auto refund`,
                isSandbox: _isSandboxCapture,
                receipt: true,
              });
              // 🔴 F3b (2026-07-16): PENDING(비종단)을 REFUNDED 로 확정하면 미환불 은폐다. final 이
              //   true(=COMPLETED)일 때만 REFUNDED, PENDING 은 아래 REFUND_PENDING 분기로 떨어뜨린다.
              //   (helper F3a 가 PENDING 에 final:false 를 준다 — paypal-refund-idempotency.test.ts 보증.)
              refundOk = !!(refundRes?.ok && refundRes?.final);
              provenRefundID = provenFullRefundID(refundRes, { amountMinor: _verdict && _verdict.amountMinor, currency: _verdict && _verdict.currency });
            } catch (refundErr) {
              console.error('[capturePaypalOrder] auto-refund failed (operator must refund manually):', refundErr.message);
            }
            // 2) The booking is already REFUND_PENDING (written atomically with the terminal record above);
            //    a completed refund upgrades it to REFUNDED. Nothing else is ever downgraded.
            let refundTransitioned = false;
            try {
              if (refundOk) refundTransitioned = await markRefundCompleted({ db, orderID, timestamp: FieldValue.serverTimestamp(), refundID: provenRefundID || undefined });
            } catch (markErr) {
              console.error('[capturePaypalOrder] booking refund-mark failed (non-fatal):', markErr.message);
            }
            // 2.5) 🔴 쿠폰 복구 (버그헌트 #2 2026-06-19): PROMO 한도초과 자동환불 시, capture 성공으로
            //      이미 소진(isUsed=true)된 개인 쿠폰을 복구하지 않으면 사용자는 환불받아도 1회용 쿠폰
            //      영구 손실. capture-fail 경로(위)와 동일하게 복구.
            if (couponLockRef) {
              try {
                await couponLockRef.update({ isUsed: false, usedAt: null, usedOrderID: null, pendingCapture: false });
              } catch (cErr) {
                console.warn('[capturePaypalOrder] coupon restore after promo-refund failed (non-fatal):', cErr.message);
              }
            }
            // 3) Operator alert — even though we auto-refunded, operator should
            //    know the cap is being hit (may want to extend the campaign).
            notifyOperator('coupon-race',
              `<code>${orderID}</code>\n사유: PROMO_LIMIT_EXCEEDED (${upper})\n사용: ${promoResult.usedCount}/${promoResult.maxUses}\n자동환불: ${refundOk ? '성공' : '실패 — 수동환불 필요'}`
            ).catch((alertErr) => console.error('[capturePaypalOrder] operator alert failed:', alertErr.message));
            // 4) User response — explain refund. The terminal record was written before the refund; only
            //    the message is refreshed with the refund outcome (best effort).
            const refundedBody = refundOk
              ? _err(`Promo code "${upper}" reached its usage limit. Your payment has been refunded — please retry without the promo code.`, 'PROMO_LIMIT_EXCEEDED')
              : promoBody;
            // Terminal proof for the client (releases its recovery pointer): ONLY a strictly proven full refund
            //   whose booking transition THIS call confirmed. It is answered only once stored, so the
            //   same-order replay returns the same proof; otherwise the old body (pointer stays) is answered.
            const proofBody = provenRefundID && refundTransitioned
              ? { ...refundedBody, orderID, finalized: true, paymentStatus: 'REFUNDED', refundID: provenRefundID }
              : null;
            let answerBody = refundedBody;
            if (proofBody) {
              try {
                await updateAttempt(attempt, { finalOutcome: 'promo_refunded', finalResponse: { status: 409, body: proofBody } });
                answerBody = proofBody;
              } catch (storeErr) {
                console.error('[capturePaypalOrder] refund proof not stored — answering without proof:', storeErr.message);
              }
            }
            if (answerBody !== proofBody) {
              await updateAttempt(attempt, { finalOutcome: refundOk ? 'promo_refunded' : 'promo_refund_pending', finalResponse: { status: 409, body: refundedBody } }).catch(() => {});
            }
            res.writeHead(409, JSON_CORS);
            return res.end(JSON.stringify(answerBody));
          }
          await markStage('promo', { state: 'completed', code: upper, ok: !!(promoResult && promoResult.ok), crashed: promoResult === null }).catch(() => {});
        } else {
          await markStage('promo', { state: 'completed', code: upper, skipped: 'no_db' }).catch(() => {});
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
    //   - AbortController 로 45s timeout (Sandbox 실측 processor 약 33s)
    //   - response.ok 검증 (비-2xx 도 실패로 처리)
    //   - 실패 시 pending_processor_retries/{orderID} 등록 + 운영자 텔레그램 alert
    //   - 5분 마다 processor-retry-sweep cron 이 재시도
    // user 응답은 변함없이 즉시. helper 자체는 await 으로 호출하지만 promise 가 항상
    // resolve 하므로 정상 흐름에 영향 없음. 45s + Vercel maxDuration 60s 안에 안전.
    const siteUrl = internalApiBase();
    // Replay never re-dispatches a done / manual-intervention / permanent-failure intent, and durable
    //   retry records are written through persisters that keep attempts and terminal states intact.
    // Mandatory checks settled without a terminal outcome: open the held intent for normal dispatch. If the
    //   release cannot be recorded the intent stays non-runnable and the answer stays 202 (replay releases it).
    let retryStatusNow = retryStatusBefore;
    try {
      retryStatusNow = (await releaseHeldIntents({ db: dbForLock, attempt, intents: [{ retryDocId: orderID, bookingId: orderID }], timestamp: FieldValue.serverTimestamp() }))[orderID];
    } catch (releaseErr) {
      // CLAIM_LOST (another worker owns the attempt) or a storage failure: nothing was opened, answer 202.
      console.error('[capturePaypalOrder] held intent release failed — processor not dispatched (202):', releaseErr.message);
      if (releaseErr.code !== 'CLAIM_LOST') await releaseAttemptClaim(attempt);
      res.writeHead(202, JSON_CORS);
      return res.end(JSON.stringify({ ...pendingPaymentResponse({ orderID, flow: 'single', paymentStatus: 'CAPTURED' }), reviewReason: releaseErr.code === 'CLAIM_LOST' ? 'claim_lost' : 'intent_release_failed' }));
    }
    if (retryStatusNow === 'stopped') {
      // Booking was stopped (refund / cancel) while the mandatory checks ran: no processor, no new charge or
      // refund here. The attempt is finalized with this same non-active answer so replays stay effect-free.
      const stoppedBody = { ...pendingPaymentResponse({ orderID, flow: 'single', paymentStatus: 'CAPTURED' }), bookingStatus: 'BOOKING_STOPPED', reviewReason: 'booking_stopped' };
      console.warn('[capturePaypalOrder] booking stopped before release — not dispatched, not confirmed:', orderID);
      await throttledTelegramAlert({ key: `booking-stopped-at-release-${orderID}`, channel: 'admin', severity: 'high', message: `⚠️ <b>예약이 환불/취소 상태라 후속처리 미실행</b>\n<b>OrderID:</b> <code>${orderID}</code>\n→ 결제는 캡처됨. 환불 완료 여부를 확인하세요.`, context: { orderID } }).catch(() => {});
      await finalizeAttempt(attempt, { finalOutcome: 'booking_stopped', finalResponse: { status: 202, body: stoppedBody } }).catch(() => {});
      res.writeHead(202, JSON_CORS);
      return res.end(JSON.stringify(stoppedBody));
    }
    let processorResult;
    if (shouldDispatchRetry(retryStatusNow)) {
      processorResult = await triggerBookingProcessor({
        db: dbForLock,
        siteUrl,
        payload: processorPayload,
        source: 'capturePaypalOrder',
        notify,
        persistRetry: makeRetryPersister({ db: dbForLock, timestamp: FieldValue.serverTimestamp() }),
        timeoutMs: 45_000,
      });
      try {
        await recordProcessorResult({ db: dbForLock, orderID, retryDocId: orderID, result: processorResult, timestamp: FieldValue.serverTimestamp() });
      } catch (processorStateErr) {
        // 성공 표시 저장이 실패해도 Capture 전에 만든 pending intent가 남아
        // cron이 같은 orderID로 안전하게 수렴한다.
        console.error('[capturePaypalOrder] processor state persist failed:', processorStateErr.message);
      }
    } else {
      console.log('[capturePaypalOrder] processor intent not runnable on replay:', orderID, retryStatusNow);
      processorResult = { ok: retryStatusNow === 'done', outcome: retryStatusNow === 'done' ? 'completed' : retryStatusNow };
    }

    // 4. 결제·예약 확정 응답. 후속 실패는 durable queue가 별도로 재처리한다.
    const successBody = _ok({
      orderID,
      payerEmail,
      payerName,
      amount,
      currency: 'USD',
      processorOutcome: processorResult.outcome || 'retryable',
      message: '예약이 확정되었습니다. 확인 이메일을 발송 중입니다.',
    });
    successBody.finalized = true;
    // Minimal replay record (no contact data) for later same-order calls from the authorized caller.
    await finalizeAttempt(attempt, {
      finalOutcome: 'confirmed', processorOutcome: processorResult.outcome || 'retryable',
      finalResponse: { status: 200, body: { ok: true, finalized: true, data: { orderID, amount, currency: 'USD', processorOutcome: processorResult.outcome || 'retryable', message: 'Booking confirmed.' } } },
    }).catch((finalizeErr) => { console.error('[capturePaypalOrder] finalize marker failed (booking durable; replay-safe):', finalizeErr.message); });
    res.writeHead(200, JSON_CORS);
    res.end(JSON.stringify(successBody));
  } catch (err) {
    console.error('[capturePaypalOrder] Error:', err);
    res.writeHead(500, JSON_CORS);
    res.end(JSON.stringify(_err(err.message, 'INTERNAL_ERROR')));
  }
}
