/**
 * Payment + revision gate for /api/ai-planner-full.
 *
 * Verifies PayPal orders (live + sandbox), consumes revision credits for
 * regenerations, and blocks duplicates via used_paypal_orders.
 *
 * Return shape:
 *   { rejection: { statusCode, code, message, details? } }  // caller writes response
 *   { isRevision: boolean, isAdminBypass: boolean }         // caller proceeds
 */
import { FieldValue } from 'firebase-admin/firestore';
import { getPaypalAccessToken, resolveIsSandbox } from '../_shared/paypal.js';
import { captureError } from '../_shared/sentry.js';
import { isReviewFulfillable } from '../_shared/payment-review.js';
import { isAiPlannerFullProduct } from '../_shared/ai-planner-policy.js';
import { toMinorUnits, verifyCaptureIntegrity } from '../_shared/paypal-capture-verify.js';
import { claimPlanIssuance, PLAN_ISSUANCE_CODE } from '../_shared/plan-issuance.js';

// Audit P0-#2 (2026-05-04): TEST_ACCOUNTS hardcoded admin email 제거.
// 정책: BRAINTREE_ENV='production' → TEST- prefix order ID 전면 reject.
// BRAINTREE_ENV='sandbox' (또는 미설정 dev) → TEST- 허용 (E2E 테스트용).
// 인증: caller (ai-planner-full.js) 에서 verifyUserToken 으로 검증된 email 을 authenticatedEmail
// 로 전달해야 함. body.email 신뢰 종료.

// PayPal 단일 (5/3 Braintree 제거 + 5/7 PayPal Smart Buttons 복구).
// PayPal order ID: 17자 alphanumeric (예: 5O190127TN364715T)
// TEST orderId: 'TEST-' prefix (BRAINTREE_ENV ∈ {sandbox,dev} 일 때만 허용)
// ADMIN-BYPASS- prefix: LIVE 모드에서 어드민 이메일로 인증된 사용자가 결제 없이
//   즉시 예약/플랜 생성. ADMIN_EMAIL env var + Firebase ID token 서버 검증 이중 인증.
//   body.email 신뢰 종료 — authenticatedEmail(토큰에서 추출) 만 사용.
// MANUAL- prefix: admin-booking-action 이 PayPal QR 결제 [입금 확인] 클릭 시 server-side 로
//   ai-planner-full 트리거할 때 사용. orderId 형식 `MANUAL-${bookingRef}` — pending_bookings
//   doc 의 status='CONFIRMED' 와 매칭으로 인증 (위변조 시 매칭 실패로 reject).

// 어드민 bypass 허용 이메일 목록 (env var 우선, 없으면 하드코딩 fallback).
// ADMIN_BYPASS_EMAILS: 쉼표 구분 이메일 목록 (예: "a@b.com,c@d.com").
// 운영자 1명이므로 하드코딩 OK — env var로 재정의 가능.
const HARDCODED_ADMIN_EMAILS = ['2001leety@gmail.com'];
function getAdminBypassEmails() {
  const raw = (process.env.ADMIN_BYPASS_EMAILS || '').trim();
  if (raw) return raw.split(',').map(e => e.toLowerCase().trim()).filter(Boolean);
  const adminEmail = (process.env.ADMIN_EMAIL || '').toLowerCase().trim();
  if (adminEmail) return [adminEmail, ...HARDCODED_ADMIN_EMAILS];
  return HARDCODED_ADMIN_EMAILS;
}

function detectProvider(orderId) {
  if (!orderId) return null;
  if (orderId.startsWith('TEST-')) return 'test';
  if (orderId.startsWith('ADMIN-BYPASS-')) return 'admin-bypass';
  if (orderId.startsWith('MANUAL-')) return 'manual';
  return 'paypal';
}

function reject(statusCode, code, message, details) {
  return { rejection: { statusCode, code, message, ...(details ? { details } : {}) } };
}

/**
 * P1-②(여름 이벤트): AI 플랜 무료 쿠폰 검증 + 멱등 소비. 통과 { ok:true } / 실패 { rejection }.
 * 검증: 소유(uid)·productScope='ai-plan'·type='free'·미사용·미만료·durationDays≤maxDays(1~3).
 * 멱등: 트랜잭션으로 isUsed 재검사+세팅 → 더블클릭/동시요청도 1회만 소비(무료 plan 2개 생성=돈손실 차단).
 */
async function consumeAiPlanCoupon(adminDb, uid, code, durationDays) {
  if (!adminDb) return reject(500, 'FIRESTORE_UNAVAILABLE', 'Coupon check requires Firestore');
  if (!code) return reject(400, 'COUPON_MISSING', 'Coupon code required');
  const couponsRef = adminDb.collection('users').doc(uid).collection('coupons');
  const snap = await couponsRef.where('code', '==', code).limit(1).get();
  if (snap.empty) return reject(404, 'COUPON_NOT_FOUND', 'Coupon not found', '쿠폰을 찾을 수 없습니다.');
  const couponRef = snap.docs[0].ref;
  const coupon = snap.docs[0].data();
  if (coupon.productScope !== 'ai-plan' || coupon.type !== 'free') {
    return reject(400, 'COUPON_WRONG_TYPE', 'Not a free AI-plan coupon', '이 쿠폰은 AI 플랜 무료 쿠폰이 아닙니다.');
  }
  if (coupon.isUsed) return reject(403, 'COUPON_USED', 'Coupon already used', '이미 사용한 쿠폰입니다.');
  if (coupon.expiresAt && coupon.expiresAt < Date.now()) {
    return reject(403, 'COUPON_EXPIRED', 'Coupon expired', '만료된 쿠폰입니다.');
  }
  const maxDays = coupon.maxDays || 3;
  if (durationDays > maxDays) {
    return reject(400, 'COUPON_DAYS_EXCEEDED', `Free coupon covers up to ${maxDays} days`,
      `무료 쿠폰은 최대 ${maxDays}일 일정까지 사용 가능합니다 (현재 ${durationDays}일).`);
  }
  try {
    await adminDb.runTransaction(async (tx) => {
      const fresh = await tx.get(couponRef);
      if (fresh.data()?.isUsed) throw new Error('COUPON_USED');
      tx.update(couponRef, { isUsed: true, usedAt: new Date().toISOString() });
    });
  } catch (e) {
    if (e && e.message === 'COUPON_USED') {
      return reject(403, 'COUPON_USED', 'Coupon already used', '이미 사용한 쿠폰입니다.');
    }
    throw e;
  }
  return { ok: true };
}

/**
 * 버그헌트 A fix (2026-06-27): 무료 쿠폰 소비 후 plan 생성 실패 시 롤백(isUsed=false).
 * 무료 쿠폰은 게이트에서 즉시 소비되므로 생성 실패 시 1장뿐인 가입 쿠폰이 영구 소실된다
 * (재시도=COUPON_USED).
 * (2026-07-15 정정: "PayPal 경로는 set 성공 후 마킹" 은 옛 설계다. 이제 PayPal 경로도 게이트에서
 *  발급권을 선점하며, 대칭 보상은 releasePlanIssuance 가 담당한다 → _shared/plan-issuance.js.)
 * → handlerCore catch 에서 plan 미저장(planPersisted=false) 일 때만 호출해 되살린다(저장 성공 후엔 정당 소비).
 * 더블클릭 중복생성 방지는 consumeAiPlanCoupon 의 트랜잭션이 그대로 담당(이 함수는 실패 보상 전용).
 */
export async function restoreAiPlanCoupon(adminDb, uid, code) {
  if (!adminDb || !uid || !code) return;
  try {
    const couponsRef = adminDb.collection('users').doc(uid).collection('coupons');
    const snap = await couponsRef.where('code', '==', code).limit(1).get();
    if (snap.empty) return;
    await snap.docs[0].ref.update({ isUsed: false, usedAt: null, restoredAt: new Date().toISOString() });
    console.log('[paymentGate] 🎟️↩️ AI 무료 쿠폰 롤백 (plan 생성 실패) | uid:', uid, '| code:', code);
  } catch (e) {
    console.warn('[paymentGate] coupon restore failed:', e.message);
  }
}

export async function enforcePaymentAndRevision(body, adminDb, authenticatedEmail, authenticatedUid) {
  const revisionOf = body.revisionOf;
  const revisionToken = body.revisionToken;
  let isRevision = false;
  let isAdminBypass = false;
  // P0 원자 발급 (2026-07-15): 유료 PayPal 경로에서만 채워진다. 호출자(handlerCore)가 이 값을
  // inline savePlan 과 Inngest dispatch payload 양쪽에 명시 전달해야 한다 — 지역변수에만 두면
  // dispatch 조기 return 이 catch 를 건너뛰어 유실된다. 상세 = _shared/plan-issuance.js.
  let planClaim = null;

  if (revisionOf && adminDb) {
    console.log('[planner] Revision mode — checking credits for plan:', revisionOf);
    const origRef = adminDb.collection('plans').doc(revisionOf);
    const origDoc = await origRef.get();
    if (!origDoc.exists) {
      return reject(404, 'NOT_FOUND', 'Original plan not found');
    }
    const origData = origDoc.data();
    // SECURITY (버그헌트 2026-06-14): 소유권은 검증된 토큰 uid 로만 판정. 이전엔 body.uid 를
    // 신뢰해 임의 로그인 사용자가 body.uid=피해자uid 로 isOwner 우회 → 남의 plan revision +
    // revisionCredit 소각(IDOR). ai-planner-modify.js:573 / recalc-transit.js:78 와 동일 패턴.
    const uid = authenticatedUid || null;
    const isOwner = uid && origData.uid === uid;
    const hasToken = origData.accessToken && origData.accessToken === revisionToken;
    // Launch P1-4 (2026-05-10): origData.uid truthy check 강화.
    // 빈 문자열 ''은 falsy → 권한 가드 우회 가능 (인증 없이 revision 생성).
    // typeof string + length > 0 으로 명시적 검증.
    const hasValidOwnerUid = origData.uid &&
                             typeof origData.uid === 'string' &&
                             origData.uid.length > 0;
    if (!isOwner && !hasToken && hasValidOwnerUid) {
      return reject(403, 'FORBIDDEN', 'Unauthorized revision');
    }
    const credits = origData.revisionCredits ?? 0;
    if (credits <= 0) {
      return reject(403, 'REVISION_EXHAUSTED', 'No revision credits remaining', 'You have already used your free revision.');
    }
    // 🔴 동시성 fix (버그헌트 2026-06-19): 위 credits 체크는 fast-path(이미 읽은 값). 실제 감소는
    //   트랜잭션으로 원자화 — 더블클릭/동시요청이 둘 다 fast-path 통과해도 트랜잭션이 재읽기·재확인해
    //   1크레딧으로 plan 2개 생성(돈손실)을 차단. 한쪽은 retry 시 credits=0 → REVISION_EXHAUSTED.
    try {
      await adminDb.runTransaction(async (tx) => {
        const snap = await tx.get(origRef);
        const c = (snap.data()?.revisionCredits) || 0;
        if (c <= 0) throw new Error('REVISION_EXHAUSTED');
        tx.update(origRef, {
          revisionCredits: FieldValue.increment(-1),
          revisionCount: FieldValue.increment(1),
          lastRevisionAt: new Date().toISOString(),
        });
      });
    } catch (txErr) {
      if (txErr && txErr.message === 'REVISION_EXHAUSTED') {
        return reject(403, 'REVISION_EXHAUSTED', 'No revision credits remaining', 'You have already used your free revision.');
      }
      throw txErr;
    }
    isRevision = true;
    console.log('[planner] ✅ Revision credit consumed. Remaining:', credits - 1);
  }

  const paypalOrderId = body.paypalOrderId;
  // Audit P0-#2: requestEmail 은 인증된 email 사용 (caller 에서 verifyUserToken 으로 결정).
  // body.email 신뢰 종료 — 이전 버전에서 admin email 위장으로 TEST mode bypass 가능했음.
  const requestEmail = (authenticatedEmail || '').toLowerCase().trim();

  // P1-②(여름 이벤트): AI 플랜 무료 쿠폰 0원 경로 — paypalOrderId 대신 body.aiCouponCode.
  // revision 아닐 때만. 검증+멱등 소비는 consumeAiPlanCoupon. 통과 시 isFreeAiCoupon=true 반환.
  const aiCouponCode = body.aiCouponCode;
  if (!isRevision && aiCouponCode) {
    if (!authenticatedUid) {
      return reject(403, 'AUTH_REQUIRED', 'Login required', 'AI 무료 쿠폰은 로그인 후 사용할 수 있습니다.');
    }
    const durationDays = body.durationDays || (body.duration === 'multi_day' ? 2 : 1);
    const couponResult = await consumeAiPlanCoupon(adminDb, authenticatedUid, aiCouponCode, durationDays);
    if (couponResult.rejection) return couponResult;
    console.log('[planner] 🎟️ AI 무료 쿠폰 0원 통과 | uid:', authenticatedUid, '| days:', durationDays, '| code:', aiCouponCode);
    return { isRevision: false, isAdminBypass: false, isFreeAiCoupon: true, consumedCoupon: { uid: authenticatedUid, code: aiCouponCode } };
  }

  if (!isRevision && !paypalOrderId) {
    return reject(403, 'PAYMENT_REQUIRED', 'Payment required', 'PayPal order ID is missing. Please complete payment first.');
  }

  if (!isRevision && paypalOrderId) {
    const provider = detectProvider(paypalOrderId);

    if (provider === 'admin-bypass') {
      // 2026-05-07: LIVE 모드 어드민 결제 우회.
      // 보안 가드:
      //   1. Firebase ID token 서버 검증 (authenticatedEmail) — body.email 신뢰 종료.
      //   2. authenticatedEmail 이 ADMIN_BYPASS_EMAILS 목록에 있어야만 통과.
      //   3. 두 조건 모두 실패 시 403 FORBIDDEN (일반 사용자 ADMIN-BYPASS- prefix 위조 차단).
      // Firestore 감사 기록: admin_bypass_audit 컬렉션에 이메일·시각·orderId 저장.
      if (!requestEmail) {
        return reject(403, 'FORBIDDEN', 'Admin bypass requires authenticated email',
          'No email returned from Firebase ID token verification. Sign out + sign in again.');
      }
      const allowedEmails = getAdminBypassEmails();
      if (!allowedEmails.includes(requestEmail)) {
        // batch 9 fix (B9-6): reject 메시지에 정확한 디버깅 정보 — 운영자가 prod 에서
        // 즉시 원인 식별 가능. 이메일 노출은 본인이라 OK.
        console.warn('[planner] ADMIN-BYPASS- rejected for non-admin email:', requestEmail, '| allowed:', allowedEmails);
        return reject(403, 'FORBIDDEN', 'Admin bypass not allowed for this account',
          `Authenticated as "${requestEmail}" but not in admin allowlist. Allowed: [${allowedEmails.join(', ')}]. Configure ADMIN_BYPASS_EMAILS env var or sign in with the admin account.`);
      }
      console.log('[planner] 🟢 ADMIN BYPASS accepted — LIVE mode, no payment | admin:', requestEmail, '| orderId:', paypalOrderId);
      isAdminBypass = true;
      // 감사 기록 (비치명적 — 실패해도 bypass 허용)
      if (adminDb) {
        adminDb.collection('admin_bypass_audit').add({
          adminEmail: requestEmail,
          orderId: paypalOrderId,
          route: 'ai-planner-full',
          bypassedAt: new Date().toISOString(),
        }).catch((e) => console.warn('[planner] admin_bypass_audit write failed:', e.message));
      }
    } else if (provider === 'test') {
      // Audit P1-A (2026-05-05): fail-closed — TEST- prefix는 BRAINTREE_ENV가 정확히
      // {sandbox, development, dev} 중 하나일 때만 허용. 빈 문자열/production/오타/미설정
      // 전부 reject. 이전 P0-#2 fix는 'production' strict equal 만 reject 했고 빈 문자열은
      // 통과 → 운영자가 prod 에 BRAINTREE_ENV='' 로 둔 상태에서 인증 토큰만 가지면 무한
      // TEST- 우회 가능했음. 이제 운영자가 prod 에 의도적으로 'sandbox' 명시해야만 동작.
      // dev 로컬은 .env 로 'development' 또는 'dev' 자유 선택 가능.
      const ALLOWED_TEST_ENVS = new Set(['sandbox', 'development', 'dev']);
      const env = (process.env.BRAINTREE_ENV || '').toLowerCase().trim();
      if (!ALLOWED_TEST_ENVS.has(env)) {
        return reject(
          403,
          'FORBIDDEN',
          'Test mode not allowed',
          `TEST- prefix only allowed when BRAINTREE_ENV ∈ {sandbox, development, dev}; got "${env || '(unset)'}"`
        );
      }
      console.log('[planner] ✅ TEST MODE accepted (env=' + env + ') — skipping payment verification for:', requestEmail || 'anonymous');
    } else if (provider === 'manual') {
      // 2026-05-06: PayPal QR 수동 결제 — admin 이 mark-paid 클릭 시 server-side 트리거.
      // orderId 형식: `MANUAL-${bookingRef}` — pending_bookings 에서 status='CONFIRMED'
      // 인 경우만 통과. 위변조 시 매칭 실패 + status mismatch 로 reject.
      console.log('[planner] Manual PayPal QR mode | orderId:', paypalOrderId);
      const bookingRef = paypalOrderId.replace(/^MANUAL-/, '');
      if (!adminDb) {
        return reject(500, 'FIRESTORE_UNAVAILABLE', 'Manual mode requires Firestore admin');
      }
      try {
        const pendingDoc = await adminDb.collection('pending_bookings').doc(bookingRef).get();
        if (!pendingDoc.exists) {
          return reject(404, 'PENDING_NOT_FOUND', `pending_bookings/${bookingRef} not found`);
        }
        const pending = pendingDoc.data();
        if (pending.status !== 'CONFIRMED') {
          return reject(403, 'PAYMENT_NOT_CONFIRMED', `pending_bookings status: ${pending.status} (expected CONFIRMED)`);
        }
        // 멱등성: 같은 bookingRef 로 ai-planner-full 두 번 호출 차단
        const usedRef = adminDb.collection('used_paypal_orders').doc(paypalOrderId);
        const usedDoc = await usedRef.get();
        if (usedDoc.exists) {
          return reject(403, 'DUPLICATE_ORDER', 'AI plan already generated for this booking');
        }
        await usedRef.set({ usedAt: new Date().toISOString(), status: 'CONFIRMED', provider: 'manual', bookingRef });
      } catch (e) {
        console.error('[planner] Manual mode verify failed:', e.message);
        await captureError(e, { route: 'paymentGate', step: 'manual_verify', orderId: paypalOrderId });
        return reject(403, 'MANUAL_VERIFY_ERROR', e.message);
      }
    } else {
      // PayPal Smart Buttons (5/7 복구) — order capture 이미 capturePaypalOrder.js 에서 완료.
      // 여기서는 PayPal API 로 status sanity check + used_paypal_orders 멱등 가드.
      console.log('[planner] PayPal mode | email:', requestEmail);

      let ppToken, ppBase;
      try {
        // P314 (2026-05-30): sandbox e2e 토글 (prod 무조건 live — resolveIsSandbox 이중 가드).
        const auth = await getPaypalAccessToken(resolveIsSandbox());
        ppToken = auth.accessToken;
        ppBase = auth.baseUrl;
      } catch (e) {
        console.error('[planner] PayPal auth failed:', e.message);
        await captureError(e, { route: 'paymentGate', step: 'paypal_auth', orderId: paypalOrderId });
        return reject(403, 'PAYPAL_AUTH_ERROR', e.message);
      }

      const orderRes = await fetch(`${ppBase}/v2/checkout/orders/${paypalOrderId}`, {
        headers: { 'Authorization': `Bearer ${ppToken}`, 'Content-Type': 'application/json' },
      });
      // PayPal GET order 의 HTTP 자체가 실패하면 body 에 status 가 없다 — JSON 만 보고
      // 판단하지 말고 명시적으로 거부한다(조회 불가 = 결제 확인 불가 = 발급 금지).
      if (!orderRes.ok) {
        console.warn('[planner] PayPal order lookup HTTP 실패:', orderRes.status, paypalOrderId);
        return reject(403, 'PAYMENT_VERIFY_FAILED', 'Could not verify payment with PayPal',
          '결제 확인에 실패했습니다. 잠시 후 다시 시도해주세요.');
      }
      let orderData;
      try {
        orderData = await orderRes.json();
      } catch (parseErr) {
        // JSON parse 실패도 "결제 확인 불가" — 발급 금지.
        console.warn('[planner] PayPal order 응답 parse 실패:', parseErr.message, paypalOrderId);
        return reject(403, 'PAYMENT_VERIFY_FAILED', 'Could not verify payment with PayPal',
          '결제 확인에 실패했습니다. 잠시 후 다시 시도해주세요.');
      }
      console.log('[planner] PayPal order status:', orderData?.status, 'id:', paypalOrderId);

      // 🔴 fail-closed: COMPLETED 만 통과 (2026-07-15).
      //   이전엔 APPROVED 도 통과시켰다. APPROVED = 구매자 승인만 끝났고 **capture 되지 않은**
      //   상태 = 돈이 들어오지 않았다. PayPal 승인 후 브라우저에서 capture 호출만 차단하고
      //   이 endpoint 를 order ID 로 직접 호출하면 $9.90 이 캡처되지 않아도 플랜을 받을 수 있었다.
      //   CREATED / SAVED / VOIDED / PAYER_ACTION_REQUIRED / 미지 상태도 모두 거부한다.
      //   APPROVED 는 "결제 미완료" 로 안내하되 플랜은 절대 발급하지 않는다.
      if (orderData.status !== 'COMPLETED') {
        const detail = orderData.status === 'APPROVED'
          ? '결제가 아직 완료되지 않았습니다(승인만 완료). 결제를 마친 뒤 다시 시도해주세요.'
          : `Order status: ${orderData.status}`;
        return reject(403, 'PAYMENT_INCOMPLETE', 'Payment not completed', detail);
      }

      // 🔴 Admin DB 없이는 결제 신뢰 검증(격리 확인 + 발급 멱등성)을 할 수 없다 → 발급 금지.
      //   이전엔 `if (adminDb)` 로 감싸 DB 부재 시 두 검사가 통째로 스킵됐다(fail-open).
      if (!adminDb) {
        console.error('[planner] Admin DB unavailable — 결제 검증 불가, 발급 거부:', paypalOrderId);
        return reject(503, 'PAYMENT_VERIFY_UNAVAILABLE', 'Cannot verify payment state',
          '일시적인 오류입니다. 잠시 후 다시 시도해주세요.');
      }

      {
        // 🔴 격리(payment_reviews)를 **서버** 신뢰 경계로 사용 (2026-07-15).
        //   capture 무결성 불일치로 격리된 주문은 프론트가 202 안내 화면을 띄우지만,
        //   프론트를 우회해 이 endpoint 를 직접 호출하면 막을 수 없었다.
        //   plan_issued_orders 최종 통과 **전에** 확인한다.
        try {
          const reviewDoc = await adminDb.collection('payment_reviews').doc(paypalOrderId).get();
          if (reviewDoc.exists) {
            const rv = reviewDoc.data() || {};
            // resolvedAt 이 설정됐다고 자동 발급하지 않는다 — 어떻게 해결됐는지가 중요하다.
            // 환불(REFUNDED)로 해결된 건은 돈이 없으므로 발급하면 안 된다.
            // 판정은 _shared/payment-review.js 의 SSOT 헬퍼로 (리터럴 하드코딩 시 기록부와 드리프트).
            const allowed = isReviewFulfillable(rv);
            if (!allowed) {
              console.warn('[planner] payment_review 미해결/미허용 → 발급 거부:', paypalOrderId, rv.resolution ?? '(unresolved)');
              return reject(403, 'PAYMENT_UNDER_REVIEW', 'Payment is under manual review',
                '결제 확인 중입니다. 확인 후 안내드립니다. 다시 결제하지 마세요.');
            }
          }
        } catch (reviewErr) {
          // 조회 실패를 "격리 없음" 으로 간주해 유료 콘텐츠를 발급하지 않는다.
          console.error('[planner] payment_review 조회 실패 → 발급 거부(fail-closed):', reviewErr.message);
          await captureError(reviewErr, { route: 'paymentGate', step: 'payment_review_check', orderId: paypalOrderId });
          return reject(503, 'PAYMENT_REVIEW_CHECK_UNAVAILABLE', 'Could not verify payment review state',
            '일시적인 오류입니다. 잠시 후 다시 시도해주세요.');
        }

        // ─────────────────────────────────────────────────────────────────
        // 🔴 P0-A/P0-B (2026-07-15): 주문 provenance + 실제 capture 무결성.
        //
        //   이전엔 order status 만 봤다. 두 가지가 뚫려 있었다:
        //     (A) Order `COMPLETED` 는 "capture 라이프사이클이 시작됐다" 는 뜻일 뿐 돈이 들어왔다는
        //         뜻이 아니다. PayPal 공식: "The Order and Capture objects have separate lifecycles",
        //         Order COMPLETED 의 next step = "checking the Capture object status in the Order
        //         API response". 즉 COMPLETED 인데 capture 가 PENDING(eCheck/리스크홀드) 이거나
        //         DECLINED 일 수 있다.
        //     (B) 이 주문이 **AI 플래너용이었는지** 를 확인하지 않았다 → 정상 결제한 차터/공항 주문
        //         ID 를 여기에 넣으면 추가 결제 없이 플랜이 나왔다.
        //
        //   GET /v2/checkout/orders/{id} 200 은 capture 응답과 **동일한 `order` 스키마**를 반환하고
        //   (PayPal OpenAPI: 둘 다 `#/components/schemas/order`), payments.captures[] 가 기본 포함된다
        //   → capture 핸들러와 같은 검증기(verifyCaptureIntegrity)를 그대로 재사용한다. 복제 금지.
        let snap;
        try {
          snap = await adminDb.collection('paypal_order_snapshots').doc(paypalOrderId).get();
        } catch (snapErr) {
          // 조회 실패를 "스냅샷 없음" 으로 취급하지 않는다 (인프라 장애 ≠ 무결성 실패).
          console.error('[planner] order snapshot 조회 실패 → 발급 거부(fail-closed):', snapErr.message);
          await captureError(snapErr, { route: 'paymentGate', step: 'order_snapshot_check', orderId: paypalOrderId });
          return reject(503, 'PAYMENT_VERIFY_UNAVAILABLE', 'Could not verify order provenance',
            '일시적인 오류입니다. 잠시 후 다시 시도해주세요.');
        }
        if (!snap.exists) {
          // body fallback 금지 — 스냅샷이 유일한 provenance 근거다.
          // (createPaypalOrder 는 2026-07-15 부터 스냅샷 쓰기가 fail-closed 라 정상 신규 주문엔 항상 있다.)
          console.warn('[planner] order snapshot 없음 → 발급 거부:', paypalOrderId);
          return reject(403, 'ORDER_PROVENANCE_MISSING', 'Order provenance not found',
            '이 주문의 결제 정보를 확인할 수 없습니다. 고객센터로 문의해주세요.');
        }
        const snapData = snap.data() || {};

        // 상품 바인딩 — 하이픈/언더스코어 변형이 섞여 쓰이므로 SSOT 헬퍼로 정규화 비교.
        // (프론트는 'ai-planner-full' 을 보내고 스냅샷엔 원본이 저장된다 → 문자열 직접 비교 금지.)
        // P1-A (2026-07-15): 유료 발급 provenance 는 **정확히 ai_planner_full** 만 통과한다.
        //   기존 isAiPlannerProduct 는 startsWith('ai_planner') 라 ai_planner_quick 류도 통과했다.
        //   지금은 금액 검증이 받쳐서 안전하지만, 다른 가격의 ai_planner_* 상품이 생기면 뚫린다.
        //   isAiPlannerProduct 의 "AI 상품군" 넓은 의미는 쿠폰 정책·주문 생성·line item 에서 정당하므로
        //   전역 의미를 바꾸지 않고 정확 helper 를 따로 쓴다.
        if (!isAiPlannerFullProduct(snapData.productType)) {
          console.warn('[planner] 다른 상품 주문으로 플랜 요청 → 거부:', paypalOrderId, snapData.productType);
          return reject(403, 'ORDER_PRODUCT_MISMATCH', 'Order is not an AI planner purchase',
            'AI 플래너 결제 주문이 아닙니다. 다른 상품의 결제로는 플랜을 발급할 수 없습니다.');
        }

        // 금액은 주문 생성 당시 스냅샷 값 기준 (현재 환율로 재계산 금지) + 정수 minor 비교.
        const expectedCurrency = snapData.expectedCurrency || 'USD'; // legacy: create 가 항상 USD 로 주문 생성
        const expectedMinor = toMinorUnits(snapData.expectedUSD, expectedCurrency);
        if (expectedMinor === null) {
          console.warn('[planner] snapshot expectedUSD 무효 → 발급 거부:', paypalOrderId);
          return reject(403, 'ORDER_PROVENANCE_INVALID', 'Order snapshot amount invalid',
            '이 주문의 결제 금액을 확인할 수 없습니다. 고객센터로 문의해주세요.');
        }

        // 실제 capture 검증 — amount/currency/capture status/cardinality.
        const verdict = verifyCaptureIntegrity({
          capture: orderData, expectedAmountMinor: expectedMinor, expectedCurrency,
        });
        if (verdict.pending) {
          // ⚠️ capture-verify 의 pending 은 "예약 handler 는 booking doc 을 남긴다" 는 맥락의 신호다.
          //   디지털 상품 발급은 다르다 — PayPal 공식이 "Wait until COMPLETED or DECLINED before
          //   fulfilling" 이라고 명시하므로 **여기서는 이행하지 않는다**. 재결제 유도도 금지.
          console.warn('[planner] capture PENDING → 발급 보류:', paypalOrderId, verdict.detail);
          return reject(403, 'PAYMENT_PENDING_SETTLEMENT', 'Payment is pending settlement',
            '결제가 확인 중입니다(정산 대기). 완료되면 안내드립니다 — 다시 결제하지 마세요.');
        }
        if (!verdict.ok) {
          // DECLINED / FAILED / REFUNDED / PARTIALLY_REFUNDED / 금액·통화·구조 불일치.
          // 이 작업에서 자동환불은 하지 않는다 (운영자 판단).
          console.warn('[planner] capture 무결성 실패 → 발급 거부:', paypalOrderId, verdict.code, verdict.detail);
          return reject(403, 'PAYMENT_NOT_CAPTURED', `Capture not usable: ${verdict.code}`,
            '결제가 정상적으로 완료되지 않았습니다. 고객센터로 문의해주세요.');
        }
        // ─────────────────────────────────────────────────────────────────

        // B3 S1-a (P311, 2026-05-30): plan-발급 멱등성은 plan_issued_orders 로 분리한다.
        //   - used_paypal_orders (capturePaypalOrder 결제 capture 멱등성) 와 공유하면 capture 가
        //     먼저 만든 doc 을 DUPLICATE 로 오인해 유료 첫 plan 이 100% 403 이 된다 → 절대 불변.
        //
        // 🔴 P0 원자화 (2026-07-15): 여기는 원래 `issuedRef.get()` **읽기 전용** 검사였다.
        //   동시 요청 둘이 모두 "없음" 을 읽고 둘 다 유료 플랜을 생성할 수 있었다(비원자 read-then-pass).
        //   또 마킹이 planPersister 의 non-fatal .set().catch() 라 실패해도 삼켜져 결제 ID 가 재사용됐다.
        //   → 이제 transaction 으로 발급권을 **선점**하고 planId 를 **예약**한다(ISSUING).
        //     확정은 plans 저장 성공 후 finalize tx 가 한다 → _shared/plan-issuance.js 의 상태 모델 참조.
        //
        //   재시도 보장은 어떻게 되나: 예전엔 "write 를 persistPlan 까지 미룸" 이 그 답이었다.
        //   이제는 **release(생성 실패 시 claim 삭제) + lease 만료 + 완성 plan 대조 복구** 가 대신한다.
        //   claim 이 이 위치인 이유: 위의 payment_review·provenance·상품·금액·capture 무결성 검증이
        //   전부 끝난 뒤여야 한다. 검증 실패 주문이 발급권을 선점한 채 reject 되면 정당한 재시도가
        //   DUPLICATE 로 막히는 self-DoS 가 된다.
        let claimResult;
        try {
          claimResult = await claimPlanIssuance(adminDb, paypalOrderId, { uid: authenticatedUid });
        } catch (claimErr) {
          // transaction 최종 실패(충돌 재시도 소진·DB 장애) → Gemini 호출 **전** 에 retryable 로 중단.
          console.error('[planner] plan issuance claim tx 실패 → 발급 거부(fail-closed):', claimErr.message);
          await captureError(claimErr, { route: 'paymentGate', step: 'plan_issuance_claim', orderId: paypalOrderId });
          return reject(503, 'PLAN_ISSUANCE_CHECK_UNAVAILABLE', 'Could not reserve plan issuance',
            '일시적인 오류입니다. 잠시 후 다시 시도해주세요.');
        }
        if (claimResult.code === PLAN_ISSUANCE_CODE.DUPLICATE) {
          // 문자열 3종은 기존 계약 그대로 유지 — 프론트가 이 코드로 분기할 수 있다.
          return reject(403, 'DUPLICATE_ORDER', 'Order already used', 'This payment has already been used to generate a plan.');
        }
        if (claimResult.code === PLAN_ISSUANCE_CODE.IN_PROGRESS) {
          // 같은 주문이 이미 생성 중 — 재결제 유도 금지. 내부 상태/attemptId 는 노출하지 않는다.
          return reject(409, 'PLAN_GENERATION_IN_PROGRESS', 'Plan generation already in progress',
            '이 결제로 플랜을 생성하는 중입니다. 잠시 기다려 주세요 — 다시 결제하지 마세요.');
        }
        if (!claimResult.claim) {
          console.error('[planner] plan issuance claim 실패:', paypalOrderId, claimResult.code, claimResult.detail);
          return reject(503, 'PLAN_ISSUANCE_CHECK_UNAVAILABLE', 'Could not reserve plan issuance',
            '일시적인 오류입니다. 잠시 후 다시 시도해주세요.');
        }
        planClaim = claimResult.claim;
      }
    }
  }

  console.log('[planner] ✅ Auth passed:', isRevision ? `REVISION of ${revisionOf}` : paypalOrderId);
  // planClaim 은 유료 PayPal 경로에서만 실린다 — 여기는 revision/admin-bypass/TEST-/MANUAL-/유료가
  // 합류하는 지점이라 무조건 실으면 claim 하지 않은 경로도 attemptId 를 갖게 된다. 조건부 spread 유지.
  return { isRevision, isAdminBypass, ...(planClaim ? { planClaim } : {}) };
}
