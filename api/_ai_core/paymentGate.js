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
import { Buffer } from 'buffer';
import { FieldValue } from 'firebase-admin/firestore';

const TEST_ACCOUNTS = ['2001leety@gmail.com'];

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
    const isTestOrderId = paypalOrderId.startsWith('TEST-');
    if (isTestOrderId && isTestAccount) {
      console.log('[planner] ✅ TEST MODE bypass — skipping PayPal verification for:', requestEmail);
    } else if (isTestOrderId && !isTestAccount) {
      return reject(403, 'FORBIDDEN', 'Unauthorized test mode', 'Test mode is only available for authorized accounts.');
    } else {
      const ppClientId = isTestAccount ? process.env.PAYPAL_SANDBOX_CLIENT_ID : process.env.PAYPAL_CLIENT_ID;
      const ppSecret = isTestAccount ? process.env.PAYPAL_SANDBOX_SECRET : process.env.PAYPAL_CLIENT_SECRET;
      const ppBase = isTestAccount ? 'https://api-m.sandbox.paypal.com' : 'https://api-m.paypal.com';

      console.log('[planner] PayPal mode:', isTestAccount ? 'SANDBOX' : 'LIVE', '| email:', requestEmail);

      const ppCreds = Buffer.from(`${ppClientId}:${ppSecret}`).toString('base64');
      const tokenRes = await fetch(`${ppBase}/v1/oauth2/token`, {
        method: 'POST',
        headers: { 'Authorization': `Basic ${ppCreds}`, 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'grant_type=client_credentials',
      });
      if (!tokenRes.ok) {
        const tokenBody = await tokenRes.text().catch(() => '');
        console.error('[planner] PayPal auth failed:', tokenRes.status, tokenBody);
        return reject(403, 'PAYPAL_AUTH_ERROR', `PayPal auth ${tokenRes.status}: ${tokenBody}`);
      }
      const ppToken = (await tokenRes.json()).access_token;

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
        await usedRef.set({ usedAt: new Date().toISOString(), status: orderData.status });
      }
    }
  }

  console.log('[planner] ✅ Auth passed:', isRevision ? `REVISION of ${revisionOf}` : paypalOrderId);
  return { isRevision };
}
