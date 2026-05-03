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
import { findTransaction as findBraintreeTransaction } from '../_shared/braintree.js';

const TEST_ACCOUNTS = ['2001leety@gmail.com'];

// 2026-05-03: Braintree 통합 추가. transaction ID 패턴으로 provider 자동 판별.
// PayPal order ID: 17자 alphanumeric (예: 5O190127TN364715T)
// Braintree transaction ID: 8자 alphanumeric (예: bz4j8q3x) — 짧고 lowercase 위주
// TEST orderId: 'TEST-' prefix
function detectProvider(orderId) {
  if (!orderId) return null;
  if (orderId.startsWith('TEST-')) return 'test';
  // PayPal orderId는 보통 17자 대문자+숫자. Braintree는 그보다 짧음 + 소문자 포함.
  // 정확한 판별은 Firestore에 provider 필드 저장이 더 안전 — 본 함수는 1차 추정.
  if (/^[A-Z0-9]{17,20}$/.test(orderId)) return 'paypal';
  return 'braintree';
}

function reject(statusCode, code, message, details) {
  return { rejection: { statusCode, code, message, ...(details ? { details } : {}) } };
}

export async function enforcePaymentAndRevision(body, adminDb) {
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
  const requestEmail = (body.email || '').toLowerCase().trim();

  if (!isRevision && !paypalOrderId) {
    return reject(403, 'PAYMENT_REQUIRED', 'Payment required', 'PayPal order ID is missing. Please complete payment first.');
  }

  const isTestAccount = TEST_ACCOUNTS.includes(requestEmail);

  if (!isRevision && paypalOrderId) {
    const provider = detectProvider(paypalOrderId);

    if (provider === 'test') {
      if (isTestAccount) {
        console.log('[planner] ✅ TEST MODE bypass — skipping payment verification for:', requestEmail);
      } else {
        return reject(403, 'FORBIDDEN', 'Unauthorized test mode', 'Test mode is only available for authorized accounts.');
      }
    } else if (provider === 'braintree') {
      // 2026-05-03: Braintree transaction 검증. braintreeCheckout.js가 이미 transaction
      // 생성 시 Firestore bookings에 저장 → 여기서는 status만 sanity check.
      console.log('[planner] Braintree mode | transactionId:', paypalOrderId);
      try {
        const tx = await findBraintreeTransaction(paypalOrderId);
        const acceptableStatuses = new Set([
          'submitted_for_settlement', 'settling', 'settlement_pending', 'settled', 'authorized',
        ]);
        if (!acceptableStatuses.has(tx.status)) {
          return reject(403, 'PAYMENT_INCOMPLETE', 'Payment not completed', `Braintree transaction status: ${tx.status}`);
        }
        if (adminDb) {
          const usedRef = adminDb.collection('used_paypal_orders').doc(paypalOrderId);
          const usedDoc = await usedRef.get();
          if (usedDoc.exists) {
            return reject(403, 'DUPLICATE_ORDER', 'Order already used', 'This payment has already been used to generate a plan.');
          }
          await usedRef.set({ usedAt: new Date().toISOString(), status: tx.status, provider: 'braintree' });
        }
      } catch (e) {
        console.error('[planner] Braintree verify failed:', e.message);
        return reject(403, 'PAYMENT_VERIFY_ERROR', e.message);
      }
    } else {
      // Legacy PayPal direct API path (한국 계정에서는 작동 X — 기존 booking 호환용 유지)
      console.log('[planner] PayPal direct mode (legacy) | email:', requestEmail);

      let ppToken, ppBase;
      try {
        const auth = await getPaypalAccessToken(false);
        ppToken = auth.accessToken;
        ppBase = auth.baseUrl;
      } catch (e) {
        console.error('[planner] PayPal auth failed:', e.message);
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
