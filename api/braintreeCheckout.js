/**
 * POST /api/braintreeCheckout
 *
 * Drop-in UI에서 받은 payment_method_nonce를 실제 결제로 변환 (transaction.sale).
 * 성공 시 transactionId 반환 → 클라이언트가 onPaymentSuccess(transactionId) 호출 →
 * 기존 ai-planner-full / capturePaypalOrder 흐름과 호환 (transactionId가 paypalOrderId
 * 자리에 들어감).
 *
 * Body:
 *   { nonce, productType, passengers, dateStart, dateEnd, language?, promoCode?,
 *     userEmail, customerName?, ... 기존 capturePaypalOrder와 같은 필드 }
 *
 * Response (success):
 *   { ok: true, data: { transactionId, amount, currency, status, payerEmail, payerName } }
 *
 * 환경변수 + TEST 모드:
 *   - email이 TEST_ACCOUNTS에 있으면 sandbox transaction (Braintree sandbox env로 처리)
 *     실제 카드 결제 X — Braintree sandbox 카드 (4111 1111 1111 1111 등) 사용.
 *   - 그 외는 production transaction.
 */
import { createTransaction } from './_shared/braintree.js';
import { initAdminDb } from './_shared/firebase-admin.js';
import { FieldValue } from 'firebase-admin/firestore';

export const maxDuration = 15;
export const config = { runtime: 'nodejs' };

const JSON_HEADERS = {
  'Content-Type': 'application/json',
  'Cache-Control': 'no-store',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const TEST_ACCOUNTS = ['2001leety@gmail.com'];

// productType → KRW 가격 (createPaypalOrder.js와 동일 로직 — SSOT 미흡, 추후 통합 권장)
function resolveKrwAmount(productType, passengers) {
  if (productType === 'ai-planner-full') return 13_300;
  // 나머지는 createPaypalOrder.js의 resolveKrwAmount() 참조 — 본 PR에서는 ai-planner만 우선 처리
  // (charter / airport_transfer는 후속 PR에서 동일 패턴 추가)
  return null;
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.writeHead(200, JSON_HEADERS);
    return res.end();
  }
  if (req.method !== 'POST') {
    res.writeHead(405, JSON_HEADERS);
    return res.end(JSON.stringify({ ok: false, error: 'POST only' }));
  }

  try {
    let body = req.body;
    if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
    body = body || {};

    const {
      nonce,
      productType,
      passengers = 1,
      dateStart = '',
      dateEnd = '',
      promoCode,
      userEmail = '',
      customerName,
      pickupLocation = '',
      dropoffLocation = '',
      vehicleType = '',
      memo = '',
      itineraryData,
      airport,
      couponDocId,
      couponUserId,
    } = body;

    if (!nonce) {
      res.writeHead(400, JSON_HEADERS);
      return res.end(JSON.stringify({ ok: false, error: 'nonce is required', code: 'MISSING_NONCE' }));
    }
    if (!productType) {
      res.writeHead(400, JSON_HEADERS);
      return res.end(JSON.stringify({ ok: false, error: 'productType is required', code: 'MISSING_PRODUCT' }));
    }

    let krwAmount = resolveKrwAmount(productType, passengers);
    if (!krwAmount) {
      res.writeHead(400, JSON_HEADERS);
      return res.end(JSON.stringify({ ok: false, error: `Unknown productType: ${productType}`, code: 'INVALID_PRODUCT' }));
    }

    // 프로모 코드 — 단순화 (createPaypalOrder.js의 EARLY50 동일 로직)
    if (promoCode === 'EARLY50') krwAmount = Math.round(krwAmount * 0.8);

    // KRW → USD 환율 변환 (Braintree는 머천트 기본 통화로 정산. 한국 머천트는 보통 USD/KRW
    // 둘 다 enable. 본 PR은 USD 우선, KRW multi-currency 활성 후 currency 분기 가능).
    const { getUsdToKrwRaw } = await import('./_exchange-rate.js');
    const usdToKrw = await getUsdToKrwRaw();
    const usdAmount = (krwAmount / usdToKrw).toFixed(2);

    const isTestAccount = TEST_ACCOUNTS.includes(userEmail.toLowerCase().trim());
    console.log('[braintreeCheckout] mode:', isTestAccount ? 'SANDBOX (test acct)' : 'LIVE',
      '| product:', productType, '| amount: $' + usdAmount, '| nonce:', String(nonce).slice(0, 12) + '...');

    // Braintree transaction 생성 — submitForSettlement:true → 즉시 capture
    const transaction = await createTransaction({
      nonce,
      amount: usdAmount,
      currency: 'USD',
      orderId: `CT-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      customer: {
        email: userEmail || undefined,
        firstName: customerName || undefined,
      },
    });

    // Firestore booking 저장 (capturePaypalOrder.js와 동일 스키마)
    try {
      const adminDb = initAdminDb('braintreeCheckout');
      if (adminDb) {
        await adminDb.collection('bookings').doc(transaction.id).set({
          captureID: transaction.id,
          provider: 'braintree',
          processorResponse: transaction.processorResponseCode || null,
          status: 'CONFIRMED',
          paymentStatus: transaction.status,
          amountUSD: transaction.amount,
          amountKRW: krwAmount,
          exchangeRate: usdToKrw,
          userEmail,
          payerName: customerName || null,
          productType: productType,
          tourDate: dateStart || '',
          tourEndDate: dateEnd || '',
          paxCount: passengers,
          pickupLocation, dropoffLocation, vehicleType, memo,
          ...(airport ? { airport } : {}),
          ...(couponDocId ? { couponDocId, couponUserId } : {}),
          itineraryData: itineraryData || null,
          createdAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        });
      }
    } catch (dbErr) {
      console.error('[braintreeCheckout] firestore save failed (transaction OK):', dbErr.message);
      // transaction은 이미 capture됐으니 여기서 fail throw하면 안 됨 — 사용자 환불 무한 루프 방지.
      // booking 데이터 잃은 건 별도 수기 보정.
    }

    res.writeHead(200, JSON_HEADERS);
    return res.end(JSON.stringify({
      ok: true,
      data: {
        transactionId: transaction.id,
        amount: transaction.amount,
        currency: transaction.currencyIsoCode || 'USD',
        status: transaction.status,
        payerEmail: userEmail,
        payerName: customerName || null,
      },
    }));
  } catch (err) {
    console.error('[braintreeCheckout] failed:', err.message);
    res.writeHead(500, JSON_HEADERS);
    return res.end(JSON.stringify({ ok: false, error: err.message, code: 'CHECKOUT_ERROR' }));
  }
}
