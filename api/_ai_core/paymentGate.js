/**
 * Payment + revision gate for /api/ai-planner-full.
 *
 * Verifies PayPal orders (live + sandbox), consumes revision credits for
 * regenerations, and blocks duplicates via used_paypal_orders.
 *
 * Return shape:
 *   { rejection: { statusCode, code, message, details? } }  // caller writes response
 *   { isRevision: boolean }                                 // caller proceeds
 */
import { FieldValue } from 'firebase-admin/firestore';
import { getPaypalAccessToken } from '../_shared/paypal.js';
import { captureError } from '../_shared/sentry.js';

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

export async function enforcePaymentAndRevision(body, adminDb, authenticatedEmail) {
  const revisionOf = body.revisionOf;
  const revisionToken = body.revisionToken;
  let isRevision = false;

  if (revisionOf && adminDb) {
    console.log('[planner] Revision mode — checking credits for plan:', revisionOf);
    const origRef = adminDb.collection('plans').doc(revisionOf);
    const origDoc = await origRef.get();
    if (!origDoc.exists) {
      return reject(404, 'NOT_FOUND', 'Original plan not found');
    }
    const origData = origDoc.data();
    const uid = body.uid || null;
    const isOwner = uid && origData.uid === uid;
    const hasToken = origData.accessToken && origData.accessToken === revisionToken;
    if (!isOwner && !hasToken && origData.uid) {
      return reject(403, 'FORBIDDEN', 'Unauthorized revision');
    }
    const credits = origData.revisionCredits ?? 0;
    if (credits <= 0) {
      return reject(403, 'REVISION_EXHAUSTED', 'No revision credits remaining', 'You have already used your free revision.');
    }
    await origRef.update({
      revisionCredits: FieldValue.increment(-1),
      revisionCount: FieldValue.increment(1),
      lastRevisionAt: new Date().toISOString(),
    });
    isRevision = true;
    console.log('[planner] ✅ Revision credit consumed. Remaining:', credits - 1);
  }

  const paypalOrderId = body.paypalOrderId;
  // Audit P0-#2: requestEmail 은 인증된 email 사용 (caller 에서 verifyUserToken 으로 결정).
  // body.email 신뢰 종료 — 이전 버전에서 admin email 위장으로 TEST mode bypass 가능했음.
  const requestEmail = (authenticatedEmail || '').toLowerCase().trim();

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
        const auth = await getPaypalAccessToken(false);
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
      const orderData = await orderRes.json();
      console.log('[planner] PayPal order status:', orderData.status, 'id:', paypalOrderId);

      if (orderData.status !== 'COMPLETED' && orderData.status !== 'APPROVED') {
        return reject(403, 'PAYMENT_INCOMPLETE', 'Payment not completed', `Order status: ${orderData.status}`);
      }

      if (adminDb) {
        const usedRef = adminDb.collection('used_paypal_orders').doc(paypalOrderId);
        const usedDoc = await usedRef.get();
        if (usedDoc.exists) {
          return reject(403, 'DUPLICATE_ORDER', 'Order already used', 'This payment has already been used to generate a plan.');
        }
        await usedRef.set({ usedAt: new Date().toISOString(), status: orderData.status, provider: 'paypal' });
      }
    }
  }

  console.log('[planner] ✅ Auth passed:', isRevision ? `REVISION of ${revisionOf}` : paypalOrderId);
  return { isRevision };
}
