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
import {
  triggerBookingProcessor,
  PENDING_PROCESSOR_RETRIES_COLLECTION,
} from './_shared/booking-processor-trigger.js';
import { throttledTelegramAlert } from './_shared/telegram-throttle.js';
import { FieldValue } from 'firebase-admin/firestore';
import { notifyOperator } from './_shared/operator-alerts.js';
import { notify } from './_shared/notify.js';
import { featureEnabled } from './_shared/feature-flag.js';
import { sanitizeAttribution } from './_shared/attribution.js';
import { toMinorUnits, verifyCaptureIntegrity } from './_shared/paypal-capture-verify.js';
import { recordPaymentReview, buildPaymentReviewResponse } from './_shared/payment-review.js';
import { internalApiBase } from './_shared/internal-base-url.js';

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
    //   에는 없다. 스냅샷이 없으면 아래 금액 검증이 스킵되므로(PAYMENT_STRICT_PROVENANCE 기본 off),
    //   싼 cart 주문을 승인한 뒤 이 endpoint 에 비싼 product/pax 를 body 로 보내면 낮은 금액으로
    //   고가 예약이 CONFIRMED 로 기록될 수 있다.
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
    // 후속 로직이 보정된 product 를 쓰도록 gate 전에 수행. 스냅샷 없으면(client-side 주문/legacy/쓰기실패)
    // body 유지 = graceful(결제 차단 금지).
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
    let _snapEstimateConsent = null;
    let _snapSlotBooking = null;
    try {
      const _snapDb = _db; // 위 cross-flow 가드에서 확보한 인스턴스 재사용 (initAdminDb 는 싱글톤 반환).
      if (_snapDb) {
        const _snap = await _snapDb.collection('paypal_order_snapshots').doc(orderID).get();
        if (_snap.exists) {
          const _s = _snap.data() || {};
          if (_s.productType) product = _s.productType;
          if (_s.passengers != null) paxCount = _s.passengers;
          if (!tourDate && _s.dateStart) tourDate = _s.dateStart;
          if (_s.expectedUSD != null) _snapExpectedUSD = _s.expectedUSD;
          // 🔴 P0-2: 추정가 정산조건 동의는 **주문 생성 시점에 서버가 만든 기록**만 신뢰한다.
          //   capture body 로 받지 않는다 — 받으면 결제 직전에 위조로 채워 넣을 수 있다.
          if (_s.estimateConsent) _snapEstimateConsent = _s.estimateConsent;
          // 🔴 F2: 슬롯 확정의 유일한 근거. 없으면 아래에서 confirm 을 포기한다(body 로 대체 금지).
          if (_s.slotBooking) _snapSlotBooking = _s.slotBooking;
          console.log('[capturePaypalOrder] order snapshot applied:', { orderID, product: _s.productType, hasExpectedUSD: _snapExpectedUSD != null });
        }
      }
    } catch (_snapErr) {
      console.warn('[capturePaypalOrder] order snapshot read failed (graceful, body 유지):', _snapErr.message);
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
    // 🟡 동시성 fix (버그헌트 #10 2026-06-19): await — fire-and-forget 면 Firestore 일시장애 시 lock 이
    //   'pending' 으로 남아 30초 후 재캡처(ALREADY_CAPTURED)→쿠폰 오롤백·사용자 오류. 실패 시 운영자 알림.
    try {
      await lockRef.update({ status: 'captured', capturedAt: FieldValue.serverTimestamp() });
    } catch (e) {
      console.warn('[capturePaypalOrder] lock status update failed:', e.message);
      notifyOperator('lock-update-fail', `<code>${orderID}</code> capture 성공 후 lock status 갱신 실패 — 재시도 시 재캡처 위험, 수동 확인 권장.`).catch(() => {});
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

    // 🔴 capture 무결성 검증 (money-critical) — _shared/paypal-capture-verify.js (cart 와 공통 SSOT).
    //   amount(정수 minor) + currency + 개별 capture status + purchase-unit/capture cardinality 를
    //   서버 snapshot(expectedUSD)과 대조. 이전에 이 경로엔 금액 검증이 **전혀 없었고**
    //   booking currency 는 'USD' 하드코딩이었다.
    //
    //   ⚠️ 마이그레이션 안전장치: snapshot 이 없는 order(레거시 / client-side 주문 / create 시
    //     snapshot 쓰기 실패 — createPaypalOrder 의 snapshot 쓰기는 best-effort)는 expectedUSD 를
    //     알 수 없다. 이를 즉시 fail-closed 하면 **배포 시점 in-flight 주문이 깨진다**.
    //     → 기본 = "알림 후 진행"(기존 동작 유지). PAYMENT_STRICT_PROVENANCE=true 로 켜면 격리.
    //     snapshot 이 **있는** order 는 플래그와 무관하게 항상 엄격 검증된다(= 실질 보안 이득).
    const _expectedMinor = toMinorUnits(_snapExpectedUSD, 'USD');
    const _strictProvenance = featureEnabled(process.env.PAYMENT_STRICT_PROVENANCE);
    let _verdict = null;
    if (_expectedMinor === null && !_strictProvenance) {
      console.warn('[capturePaypalOrder] snapshot expectedUSD 없음 — 금액 검증 스킵(관대 모드):', orderID);
      throttledTelegramAlert({
        key: 'capture-no-snapshot',
        channel: 'admin',
        severity: 'warning',
        message: [
          '⚠️ <b>단건 capture — 주문 스냅샷 없음 (금액 미검증 진행)</b>',
          `<b>OrderID:</b> <code>${orderID}</code> <b>CaptureID:</b> <code>${captureID}</code>`,
          '→ 레거시/클라이언트 주문 또는 create 시 스냅샷 쓰기 실패 = provenance 확인 불가.',
          '→ 이런 주문이 0 이 되면 PAYMENT_STRICT_PROVENANCE=true 로 격리 전환 가능.',
        ].join('\n'),
        context: { orderID, captureID, source: 'capturePaypalOrder' },
      }).catch(() => {});
    } else {
      _verdict = verifyCaptureIntegrity({
        capture, expectedAmountMinor: _expectedMinor, expectedCurrency: 'USD',
      });
    }

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
    const bookingAttribution = sanitizeAttribution(attribution);
    // 🔴 2026-07-29 (#3 신뢰 가능한 uid 연결): 구매자 uid 를 **검증된 Firebase ID 토큰에서만**
    //   뽑아 예약 문서에 남긴다. 이전에는 이 값이 어디에도 저장되지 않아, 뒤따르는
    //   booking-processor 가 요청 body 의 userId 를 그대로 믿고 포인트를 적립했다
    //   (= 외부에서 남의 uid 로 코인 발급 가능). 이제 원장은 이 필드만 본다.
    //   비로그인 게스트 결제는 null → 적립 대상 아님(정상).
    const verifiedBuyerUid = await verifyTokenUid(req.headers?.authorization);
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
      // 검증 통과 시 = PayPal capture 응답에서 실제 확인된 통화. 검증 스킵(스냅샷 없는 레거시)이면 'USD' 가정.
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
    const BOOKING_WRITE_BACKOFF_MS = [200, 500, 1000];
    let bookingWriteOk = false;
    let lastBookingErr = null;
    for (let attempt = 0; attempt < BOOKING_WRITE_BACKOFF_MS.length; attempt++) {
      try {
        const db = initAdminDb('capturePaypalOrder');
        if (!db) throw new Error('Firestore unavailable');
        const batch = db.batch();
        batch.set(db.collection('bookings').doc(orderID), bookingDocPayload, { merge: true });
        batch.set(db.collection(PENDING_PROCESSOR_RETRIES_COLLECTION).doc(orderID), {
          orderID,
          retryDocId: orderID,
          payload: processorPayload,
          source: 'capturePaypalOrder',
          status: 'pending',
          outcome: 'retryable',
          attempts: 0,
          intentCreatedAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        }, { merge: false });
        await batch.commit();
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
    if (bookingWriteOk && _snapSlot) {
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
            `<b>tourId:</b> ${_snapSlot.tourId}`,
            `<b>date/slot:</b> ${_snapSlot.date} / ${_snapSlot.slotId}`,
            `<b>pax:</b> ${_snapSlot.pax} <b>capacity:</b> ${_snapSlot.capacity}`,
            `<b>오류:</b> ${slotErr.message?.slice(0, 200)}`,
            ``,
            `${code === 'SLOT_FULL_AT_CAPTURE' ? '🚨 overbooking 가능성 — 운영자 수동 검토 + 환불/조정 결정 필요.' : '슬롯 카운터 불일치. lockfix scripts/admin-slot-rebuild 검토.'}`,
          ].join('\n'),
          context: { orderID, tourId: _snapSlot.tourId, bookingDate: _snapSlot.date, tourSlotId: _snapSlot.slotId, paxCount: _snapSlot.pax, slotCapacity: _snapSlot.capacity, code },
        }).catch(() => {});
      }
    } else if (bookingWriteOk && _bodyClaimsSlot) {
      // 🔴 F2 fail-closed(슬롯 한정): 클라는 슬롯 예약이라 하는데 create 스냅샷에 바인딩이 없다.
      //   원인은 둘 중 하나다 — (a) capture body 위조/스냅샷 없는 레거시·클라 직접 주문,
      //   (b) 이 배포 **직전** 에 만들어져 바인딩 없이 저장된 in-flight 주문.
      //   어느 쪽이든 body 값으로 좌석을 확정하지 않는다(그게 이 버그의 본체였다). 대신 결제·예약은
      //   그대로 두고(돈은 이미 빠졌다) 운영자에게 알린다 — pending 은 sweep 으로 풀리므로
      //   (b) 인 경우 운영자가 좌석을 수동 확정해야 한다.
      console.warn('[capturePaypalOrder] slot confirm 스킵 — 스냅샷 슬롯 바인딩 없음 (body 신뢰 금지):',
        { orderID, bodyTourId: tourId, bodySlot: tourSlotId, bodyDate: bookingDate });
      throttledTelegramAlert({
        key: 'slot-confirm-SLOT_SNAPSHOT_MISSING',
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
      }).catch(() => {});
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
              });
              // 🔴 F3b (2026-07-16): PENDING(비종단)을 REFUNDED 로 확정하면 미환불 은폐다. final 이
              //   true(=COMPLETED)일 때만 REFUNDED, PENDING 은 아래 REFUND_PENDING 분기로 떨어뜨린다.
              //   (helper F3a 가 PENDING 에 final:false 를 준다 — paypal-refund-idempotency.test.ts 보증.)
              refundOk = !!(refundRes?.ok && refundRes?.final);
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
    //   - AbortController 로 45s timeout (Sandbox 실측 processor 약 33s)
    //   - response.ok 검증 (비-2xx 도 실패로 처리)
    //   - 실패 시 pending_processor_retries/{orderID} 등록 + 운영자 텔레그램 alert
    //   - 5분 마다 processor-retry-sweep cron 이 재시도
    // user 응답은 변함없이 즉시. helper 자체는 await 으로 호출하지만 promise 가 항상
    // resolve 하므로 정상 흐름에 영향 없음. 45s + Vercel maxDuration 60s 안에 안전.
    const siteUrl = internalApiBase();
    const processorResult = await triggerBookingProcessor({
      db: dbForLock,
      siteUrl,
      payload: processorPayload,
      source: 'capturePaypalOrder',
      notify,
      timeoutMs: 45_000,
    });
    try {
      const processorBatch = dbForLock.batch();
      const retryRef = dbForLock.collection(PENDING_PROCESSOR_RETRIES_COLLECTION).doc(orderID);
      const bookingRef = dbForLock.collection('bookings').doc(orderID);
      if (processorResult.ok) {
        processorBatch.set(retryRef, {
          status: 'done',
          outcome: processorResult.outcome || 'completed',
          completedAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        }, { merge: true });
        processorBatch.set(bookingRef, {
          processorStatus: 'completed',
          processorOutcome: processorResult.outcome || 'completed',
          processorCompletedAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        }, { merge: true });
      } else {
        processorBatch.set(bookingRef, {
          processorStatus: processorResult.docStatus || 'pending',
          processorOutcome: processorResult.outcome || 'retryable',
          processorLastError: processorResult.reason || 'unknown',
          updatedAt: FieldValue.serverTimestamp(),
        }, { merge: true });
      }
      await processorBatch.commit();
    } catch (processorStateErr) {
      // 성공 표시 저장이 실패해도 Capture 전에 만든 pending intent가 남아
      // cron이 같은 orderID로 안전하게 수렴한다.
      console.error('[capturePaypalOrder] processor state persist failed:', processorStateErr.message);
    }

    // 4. 결제·예약 확정 응답. 후속 실패는 durable queue가 별도로 재처리한다.
    res.writeHead(200, JSON_CORS);
    res.end(JSON.stringify(_ok({
      orderID,
      payerEmail,
      payerName,
      amount,
      currency: 'USD',
      processorOutcome: processorResult.outcome || 'retryable',
      message: '예약이 확정되었습니다. 확인 이메일을 발송 중입니다.',
    })));
  } catch (err) {
    console.error('[capturePaypalOrder] Error:', err);
    res.writeHead(500, JSON_CORS);
    res.end(JSON.stringify(_err(err.message, 'INTERNAL_ERROR')));
  }
}
