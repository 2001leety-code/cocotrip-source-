/**
 * captureCartOrder — 장바구니(멀티상품) PayPal 캡처 + 예약 fan-out (sum-one-order, money-critical).
 *
 * createCartOrder 가 만든 cart_orders/{orderID} 스냅샷(서버 재계산 SSOT)을 신뢰원으로:
 *   1. used_paypal_orders 트랜잭션 락 (capturePaypalOrder 동일 — 이중청구 차단)
 *   2. PayPal 캡처 (멱등 헤더)
 *   3. ⚠️ capture 무결성 검증 (_shared/paypal-capture-verify.js — 단건과 공통 SSOT):
 *      amount(정수 minor) + currency + 개별 capture status + purchase-unit/capture cardinality.
 *      불일치 = 예약 미확정 + payment_reviews durable 격리 + 202(retryable:false).
 *   4. (검증 통과 시에만) 라인별 child booking doc batch + 부모 carts/{orderID}
 *   5. (검증 통과 시에만) 라인별 booking-processor fan-out (retryDocId=childOrderID)
 *
 * ⚠️ flag OFF(FEATURE_CART) = 404. v1 = 쿠폰 미지원(promoCode 거부 → PR#434 promo cap 이슈 자체 없음).
 *    부분 실패 = 결제 롤백 없음(운영자 정책) + 라인별 retry. 자동환불 안 함 = 운영자 판단.
 *    실 캡처는 운영자 실 PayPal e2e 로 검증 (자동 테스트는 주문생성/모킹까지).
 */
import { getPaypalAccessToken, resolveIsSandbox } from './_shared/paypal.js';
import { initAdminDb } from './_shared/firebase-admin.js';
import { featureEnabled } from './_shared/feature-flag.js';
import { triggerBookingProcessor } from './_shared/booking-processor-trigger.js';
import { throttledTelegramAlert } from './_shared/telegram-throttle.js';
import { notify } from './_shared/notify.js';
import { buildCartChildBookings } from './_shared/cart-capture.js';
import { toMinorUnits, verifyCaptureIntegrity } from './_shared/paypal-capture-verify.js';
import { recordPaymentReview, buildPaymentReviewResponse } from './_shared/payment-review.js';
import { internalApiBase } from './_shared/internal-base-url.js';
import { FieldValue } from 'firebase-admin/firestore';

export const maxDuration = 60;
export const config = { runtime: 'nodejs' };

const _ok  = (data) => ({ ok: true, data });
const _err = (msg, code = 'UNKNOWN_ERROR') => ({ ok: false, error: msg, code });
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};
const JSON_CORS = { ...CORS, 'Content-Type': 'application/json' };

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') { res.writeHead(200, CORS); return res.end(); }
  if (req.method !== 'POST') { res.writeHead(405, JSON_CORS); return res.end(JSON.stringify(_err('Method not allowed', 'METHOD_NOT_ALLOWED'))); }

  if (!featureEnabled(process.env.FEATURE_CART)) {
    res.writeHead(404, JSON_CORS);
    return res.end(JSON.stringify(_err('Cart checkout not enabled', 'CART_DISABLED')));
  }

  try {
    let body = req.body;
    if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
    body = body || {};
    const orderID = body.orderID;
    const userEmail = (body.userEmail || '').toLowerCase();
    if (!orderID) { res.writeHead(400, JSON_CORS); return res.end(JSON.stringify(_err('orderID is required', 'MISSING_FIELDS'))); }

    // v1: 장바구니 쿠폰 미지원 — promoCode/couponDocId 거부. 쿠폰 없음 = global-promo cap(PR#434)
    // 이슈 자체가 없음(안전 단순화). 총액 쿠폰(운영자 결정#2)은 v2.
    if (body.promoCode || body.couponDocId) {
      res.writeHead(400, JSON_CORS);
      return res.end(JSON.stringify(_err('장바구니는 현재 쿠폰 미지원입니다 — 단독 결제를 이용해주세요.', 'CART_PROMO_UNSUPPORTED')));
    }

    const db = initAdminDb('captureCartOrder');
    if (!db) throw new Error('Firestore unavailable — check FIREBASE_* env vars');

    // 0. cart_orders 스냅샷 로드 (서버 재계산 SSOT — 라인 amount + 합계 신뢰원).
    const snapSnap = await db.collection('cart_orders').doc(orderID).get();
    if (!snapSnap.exists) {
      res.writeHead(400, JSON_CORS);
      return res.end(JSON.stringify(_err('Cart order snapshot not found', 'NO_SNAPSHOT')));
    }
    const snapshot = snapSnap.data() || {};
    if (!Array.isArray(snapshot.lines) || snapshot.lines.length === 0) {
      res.writeHead(400, JSON_CORS);
      return res.end(JSON.stringify(_err('Cart snapshot has no lines', 'EMPTY_SNAPSHOT')));
    }

    const isSandbox = resolveIsSandbox();
    if (isSandbox) console.warn('[captureCartOrder] SANDBOX MODE — 실제 결제 아님 (preview e2e)');
    const { accessToken, baseUrl: PAYPAL_BASE_URL } = await getPaypalAccessToken(isSandbox);

    // 1. 이중 캡처 차단 락 (capturePaypalOrder L114-147 복제, orderID 단위).
    const lockRef = db.collection('used_paypal_orders').doc(orderID);
    try {
      await db.runTransaction(async (tx) => {
        const existing = await tx.get(lockRef);
        if (existing.exists) {
          const data = existing.data() || {};
          const stale = data.status === 'pending' && data.createdAtMs && (Date.now() - Number(data.createdAtMs)) > 30_000;
          if (data.status === 'captured' || !stale) throw new Error('DUPLICATE_ORDER');
        }
        tx.set(lockRef, { status: 'pending', createdAt: new Date().toISOString(), createdAtMs: Date.now(), userEmail, product: 'cart' });
      });
    } catch (lockErr) {
      if (lockErr.message === 'DUPLICATE_ORDER') {
        res.writeHead(409, JSON_CORS);
        return res.end(JSON.stringify(_err('Order already processed', 'DUPLICATE_ORDER')));
      }
      throw lockErr;
    }

    // 2. 캡처 — 실패 시 락 해제(재시도 허용).
    let capture;
    try {
      const captureRes = await fetch(`${PAYPAL_BASE_URL}/v2/checkout/orders/${orderID}/capture`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          'PayPal-Request-Id': `${orderID}-cart-cap`,
        },
      });
      capture = await captureRes.json();
      if (capture.status !== 'COMPLETED') throw new Error(`Capture status: ${capture.status || 'unknown'}`);
    } catch (captureErr) {
      lockRef.delete().catch(() => {});
      throw captureErr;
    }
    lockRef.update({ status: 'captured', capturedAt: FieldValue.serverTimestamp() }).catch(() => {});

    const captureNode = capture.purchase_units && capture.purchase_units[0]
      && capture.purchase_units[0].payments && capture.purchase_units[0].payments.captures
      && capture.purchase_units[0].payments.captures[0];
    const payerEmail = (capture.payer && capture.payer.email_address) || '';
    const payerName = `${(capture.payer && capture.payer.name && capture.payer.name.given_name) || ''} ${(capture.payer && capture.payer.name && capture.payer.name.surname) || ''}`.trim();
    const capturedUsd = (captureNode && captureNode.amount && captureNode.amount.value) || '';
    const captureID = (captureNode && captureNode.id) || '';

    // 3. ⚠️ capture 무결성 검증 (money-critical) — amount(정수 minor) + currency +
    //    개별 capture status + purchase-unit/capture cardinality 를 스냅샷과 대조.
    //
    //    이전 동작: 금액만 parseFloat 비교하고, 불일치해도 Telegram alert 만 쏘고 CONFIRMED 로
    //      **그대로 진행**했다 → 결제와 다른 예약이 확정 + 알림 유실 시 사고 은폐(Telegram=SSOT 아님).
    //    현재: 불일치 = 예약 확정·fan-out 중단 + durable payment_reviews 격리 + 202(재시도 금지).
    //      돈은 이미 캡처됐으므로 일반 실패로 버리지 않는다(사용자 재결제 = 이중청구).
    //      자동환불도 하지 않는다 — 운영자 판단(cocotrip-money-safety).
    const expectedMinor = toMinorUnits(snapshot.usdAmount, 'USD');
    const verdict = verifyCaptureIntegrity({
      capture, expectedAmountMinor: expectedMinor, expectedCurrency: 'USD',
    });
    if (verdict.pending) {
      // 🔴 PENDING = PayPal 리스크 홀드 / eCheck = 정상 결제 흐름 (금액·통화는 이미 정합).
      //   격리하면 booking doc 이 없어 홀드 해제 webhook 이 예약을 못 찾음 → 돈만 정산되고 예약 없음.
      //   → 기존대로 예약 확정 진행하고 정산 대기만 기록/알림.
      console.warn('[captureCartOrder] capture PENDING (정산 대기) — 예약 진행:', orderID, verdict.detail);
      await throttledTelegramAlert({
        key: `cart-capture-pending-${orderID}`,
        channel: 'admin',
        severity: 'warning',
        message: [
          '🕒 <b>CART capture PENDING (정산 대기 · 예약은 확정 진행)</b>',
          `<b>OrderID:</b> <code>${orderID}</code> <b>CaptureID:</b> <code>${captureID}</code>`,
          `<b>사유:</b> ${verdict.detail}`,
          '→ PayPal 리스크 홀드/eCheck 추정. 금액·통화는 정합. 정산 완료 여부 확인 필요.',
        ].join('\n'),
        context: { orderID, captureID, code: verdict.code },
      }).catch(() => {});
    } else if (!verdict.ok) {
      // durable 기록이 최우선 — 캡처된 돈의 유일한 SSOT.
      let reviewRecorded = false;
      try {
        await recordPaymentReview({
          db, serverTimestamp: FieldValue.serverTimestamp(),
          flow: 'cart', orderID, verdict, capture,
          expectedAmountMinor: expectedMinor, expectedCurrency: 'USD',
          userEmail, payerEmail,
          // 운영자 해결에 필요 — cart 는 라인 구성이 스냅샷에 있으므로 참조만 남긴다.
          bookingPayload: { snapshotRef: `cart_orders/${orderID}`, lineCount: Array.isArray(snapshot.lines) ? snapshot.lines.length : 0, totalKRW: snapshot.totalKRW ?? null },
        });
        await db.collection('cart_orders').doc(orderID).set(
          { status: 'payment_review', captureID, updatedAt: FieldValue.serverTimestamp() },
          { merge: true },
        );
        reviewRecorded = true;
      } catch (reviewErr) {
        console.error('[captureCartOrder] payment_review 기록 실패 (캡처된 돈의 durable 기록 없음):', reviewErr);
      }
      // ⚠️ await 필수 — 서버리스는 res.end() 후 정지 가능. fire-and-forget 이면 review 기록까지
      //   실패한 최악의 경우 돈만 나가고 기록도 알림도 0. key 는 주문별(상수 key = 다른 주문 억제).
      await throttledTelegramAlert({
        key: `cart-capture-mismatch-${orderID}`,
        channel: 'admin',
        severity: 'critical',
        message: [
          '🚨 <b>CART capture 무결성 불일치 (예약 미확정)</b>',
          '',
          `<b>OrderID:</b> <code>${orderID}</code>`,
          `<b>CaptureID:</b> <code>${captureID}</code>`,
          `<b>capture status:</b> ${captureNode?.status ?? 'unknown'}`,
          `<b>사유:</b> ${verdict.code} — ${verdict.detail}`,
          '',
          reviewRecorded
            ? '→ payment_reviews/{orderID} 격리됨(Firebase 콘솔에서 확인). 예약 미확정 · 이메일/바우처 미발송.'
            : '🔴 payment_reviews 기록도 실패 — 즉시 수동 확인 필요(durable 기록 없음).',
        ].join('\n'),
        context: { orderID, captureID, code: verdict.code, reviewRecorded },
      }).catch((e) => { console.error('[captureCartOrder] mismatch 알림 실패:', e?.message); });

      // 202 Accepted — 예약 미확정. retryable:false (재결제 = 이중청구).
      // paymentCaptured 는 실제 capture status 파생 (돈 안 움직인 verdict 에 "결제됨" 이라 하지 않음).
      res.writeHead(202, JSON_CORS);
      return res.end(JSON.stringify(buildPaymentReviewResponse({ orderID, captureID, capture })));
    }

    // 4. 라인별 child booking doc batch + 부모 carts/{orderID} + cart_orders status.
    const children = buildCartChildBookings(orderID, snapshot, { payerEmail, payerName, userEmail, captureID });
    // 🔴 ghost 예약 fix (버그헌트 #4 2026-06-19): batch.commit() 실패해도 catch 가 return 없어 아래
    //   booking-processor fan-out 이 강행 → booking doc 없는 childOrderID 로 확인메일/텔레그램 유령발송
    //   + my-bookings/cancel/voucher 404. batchOk 로 게이트(성공 시에만 발송).
    let batchOk = false;
    try {
      const batch = db.batch();
      for (const child of children) {
        batch.set(db.collection('bookings').doc(child.childOrderID), {
          ...child.bookingDoc,
          rawCapturePayload: { captureID, amount: (captureNode && captureNode.amount) || null, status: capture.status || '' },
          createdAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        }, { merge: true });
      }
      batch.set(db.collection('carts').doc(orderID), {
        orderID, captureID, status: 'CONFIRMED',
        totalKRW: snapshot.totalKRW, usdAmount: snapshot.usdAmount, usdRate: snapshot.usdRate,
        lineCount: children.length, payerEmail, userEmail,
        createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
      batch.set(db.collection('cart_orders').doc(orderID), {
        status: 'captured', captureID, capturedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
      await batch.commit();
      batchOk = true;
    } catch (batchErr) {
      // CRITICAL — 캡처됐는데 booking doc 저장 실패. alert (운영자 admin-replay 복구).
      throttledTelegramAlert({
        key: 'cart-bookings-write-fail',
        channel: 'admin',
        severity: 'critical',
        message: [
          '🚨 <b>CART booking doc 저장 실패 (결제 완료됨)</b>',
          `<b>OrderID:</b> <code>${orderID}</code> <b>CaptureID:</b> <code>${captureID}</code>`,
          `<b>금액:</b> $${snapshot.usdAmount} / ₩${(snapshot.totalKRW || 0).toLocaleString('ko-KR')}`,
          `<b>사유:</b> ${(batchErr.message || 'unknown').slice(0, 250)}`,
          '→ my-bookings/cancel/voucher 깨짐. 운영자 수동 복구.',
        ].join('\n'),
        context: { orderID, captureID, source: 'captureCartOrder' },
      }).catch(() => {});
    }

    // 5. 라인별 booking-processor fan-out (payload.orderID=childOrderID 부모 doc 충돌 회피,
    //    retryDocId=childOrderID 라인별 독립 retry). 부분 실패 = 롤백 없음(retry 큐 + 알림).
    //    병렬 await — retry 큐가 실패 라인 포착 보장 후 응답.
    const siteUrl = internalApiBase();
    // 🔴 #4: batch.commit() 성공 시에만 fan-out — 실패 시 booking doc 없어 유령발송 방지.
    //   batch 실패는 위 critical 알림 + 운영자 admin-replay(booking doc 생성 후 재발송)로 복구.
    if (batchOk) {
      await Promise.allSettled(children.map((child) => triggerBookingProcessor({
        db, siteUrl, payload: child.processorPayload, source: 'captureCartOrder', notify, retryDocId: child.retryDocId,
      })));
    } else {
      console.error('[captureCartOrder] batch.commit 실패 → booking-processor fan-out 스킵(유령예약 방지), 운영자 admin-replay 필요:', orderID);
    }

    // 6. 응답
    res.writeHead(200, JSON_CORS);
    res.end(JSON.stringify(_ok({
      orderID, captureID, payerEmail, payerName,
      lineCount: children.length,
      amount: capturedUsd, currency: 'USD',
      message: '장바구니 예약이 확정되었습니다. 상품별 확인 이메일을 발송 중입니다.',
    })));
  } catch (err) {
    console.error('[captureCartOrder] Error:', err);
    res.writeHead(500, JSON_CORS);
    res.end(JSON.stringify(_err(err.message, 'INTERNAL_ERROR')));
  }
}
