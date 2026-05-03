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
import {
  resolveKrwAmount,
  isCustomEstimateProduct,
  productDisplayLabel,
  CUSTOM_ESTIMATE_MIN_KRW,
  CUSTOM_ESTIMATE_MAX_KRW,
} from './_shared/pricing.js';

export const maxDuration = 15;
export const config = { runtime: 'nodejs' };

const JSON_HEADERS = {
  'Content-Type': 'application/json',
  'Cache-Control': 'no-store',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const TEST_ACCOUNTS = ['2001leety@gmail.com'];

// 2026-05-03: productType → KRW 가격은 api/_shared/pricing.js (SSOT) 사용. 기존 inline
// 함수가 ai-planner-full 만 지원해서 차터/공항픽업 결제 시 "Unknown productType" 400.
// 사용자 신고 (airport_seoul_central 결제 시도) 후 fix.

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
      customAmountKRW,
    } = body;

    if (!nonce) {
      res.writeHead(400, JSON_HEADERS);
      return res.end(JSON.stringify({ ok: false, error: 'nonce is required', code: 'MISSING_NONCE' }));
    }
    if (!productType) {
      res.writeHead(400, JSON_HEADERS);
      return res.end(JSON.stringify({ ok: false, error: 'productType is required', code: 'MISSING_PRODUCT' }));
    }

    let krwAmount;
    if (isCustomEstimateProduct(productType)) {
      // 추정가 결제 — client가 보낸 customAmountKRW를 sanity range 내에서 신뢰.
      // 부산 등 zone fallback 견적, ICN 외 공항 픽업 등 매트릭스에 없는 케이스 결제용.
      // 위변조 위험은 sanity range + Firestore에 wizard state 저장으로 admin 검토 가능.
      const customKrw = Number(customAmountKRW);
      if (!Number.isFinite(customKrw) || customKrw < CUSTOM_ESTIMATE_MIN_KRW || customKrw > CUSTOM_ESTIMATE_MAX_KRW) {
        res.writeHead(400, JSON_HEADERS);
        return res.end(JSON.stringify({
          ok: false,
          error: `customAmountKRW out of allowed range (${CUSTOM_ESTIMATE_MIN_KRW.toLocaleString()}–${CUSTOM_ESTIMATE_MAX_KRW.toLocaleString()})`,
          code: 'INVALID_CUSTOM_AMOUNT',
        }));
      }
      krwAmount = Math.round(customKrw);
    } else {
      krwAmount = resolveKrwAmount(productType, passengers);
      if (!krwAmount) {
        res.writeHead(400, JSON_HEADERS);
        return res.end(JSON.stringify({ ok: false, error: `Unknown productType: ${productType}`, code: 'INVALID_PRODUCT' }));
      }
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

    // 2026-05-03 fix: 사용자가 결제 폼에서 이메일 미입력했지만 PayPal 결제 흐름에서
    // PayPal 계정 이메일이 transaction에 자동 첨부되는 경우 있음. 빈 userEmail 보다
    // Braintree가 받은 이메일(고객 PayPal/카드 명의 이메일) 우선 사용.
    const effectiveEmail = (userEmail && userEmail.trim())
      || transaction.customer?.email
      || transaction.paypalAccount?.payerEmail
      || '';
    if (effectiveEmail !== userEmail) {
      console.log('[braintreeCheckout] email fallback used:', effectiveEmail.slice(0, 4) + '...');
    }

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
          userEmail: effectiveEmail,
          payerName: customerName || null,
          productType: productType,
          tourDate: dateStart || '',
          tourEndDate: dateEnd || '',
          paxCount: passengers,
          pickupLocation, dropoffLocation, vehicleType, memo,
          ...(airport ? { airport } : {}),
          ...(couponDocId ? { couponDocId, couponUserId } : {}),
          // 2026-05-04: 추정가 결제는 어드민 사후 정산 필요 — 별도 플래그로 필터링 가능.
          // productType 이 변경돼도 데이터 레이크 쿼리는 이 boolean 으로 안정적으로 유지.
          ...(isCustomEstimateProduct(productType) ? { requiresReconciliation: true } : {}),
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

    // 2026-05-03 P0-1 fix: AI 플래너 외 상품 (차터/공항픽업/투어)은 booking-processor가
    // 이메일+텔레그램+PDF 영수증+Wallet pass+Sheets 기록 처리. PR #216 마이그레이션 시
    // 누락됐던 부분 — 차터 고객이 결제 후 확인 메일도 못 받던 원인. AI 플래너는 자체
    // emailNotifier가 처리하므로 booking-processor 호출 불필요.
    if (!productType.startsWith('ai-planner')) {
      const siteUrl = process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'https://cocotripkr.com';
      fetch(`${siteUrl}/api/booking-processor`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orderID: transaction.id,
          payerEmail: effectiveEmail,
          payerName: customerName,
          amount: transaction.amount,
          // 2026-05-04: 사람이 읽는 표면 (이메일·텔레그램·바우처) 에는 친화적 라벨 사용.
          // 내부 productType 키는 Firestore booking 의 productType 필드에 그대로 저장됨.
          product: productDisplayLabel(productType),
          // 2026-05-04 fix: 이전엔 destructure 안 된 `tourDate` 참조 → ReferenceError →
          // 500. 차터 결제 후 확인 메일·텔레그램 알림 누락 원인. body destructure 의
          // dateStart 를 사용해야 함 (Firestore booking 저장 라인과 동일 패턴).
          tourDate: dateStart || '',
          pickupLocation, dropoffLocation,
          paxCount: passengers,
          vehicleType, customerPhone: undefined, couponApplied: !!couponDocId,
          memo, itineraryData, airport,
        }),
      }).catch((err) => console.error('[braintreeCheckout] booking-processor call failed:', err.message));
    }

    res.writeHead(200, JSON_HEADERS);
    return res.end(JSON.stringify({
      ok: true,
      data: {
        transactionId: transaction.id,
        amount: transaction.amount,
        currency: transaction.currencyIsoCode || 'USD',
        status: transaction.status,
        payerEmail: effectiveEmail,  // fallback 적용된 값 — frontend가 ai-planner-full 호출 시 사용
        payerName: customerName || null,
      },
    }));
  } catch (err) {
    console.error('[braintreeCheckout] failed:', err.message);
    res.writeHead(500, JSON_HEADERS);
    return res.end(JSON.stringify({ ok: false, error: err.message, code: 'CHECKOUT_ERROR' }));
  }
}
