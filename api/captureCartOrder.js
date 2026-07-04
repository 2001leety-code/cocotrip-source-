/**
 * captureCartOrder — 장바구니(멀티상품) PayPal 캡처 + 예약 fan-out (sum-one-order, money-critical).
 *
 * createCartOrder 가 만든 cart_orders/{orderID} 스냅샷(서버 재계산 SSOT)을 신뢰원으로:
 *   1. used_paypal_orders 트랜잭션 락 (capturePaypalOrder 동일 — 이중청구 차단)
 *   2. PayPal 캡처 (멱등 헤더)
 *   3. ⚠️ 캡처 금액 == 스냅샷 합계 검증 (capturePaypalOrder L260 무검증 보완)
 *   4. 라인별 child booking doc(bookings/{orderID}__{lineId}) batch + 부모 carts/{orderID}
 *   5. 라인별 booking-processor fan-out (retryDocId=childOrderID, PR2a 멱등 활용)
 *
 * ⚠️ flag OFF(FEATURE_CART) = 404. v1 = 쿠폰 미지원(promoCode 거부 → PR#434 promo cap 이슈 자체 없음).
 *    부분 실패 = 결제 롤백 없음(운영자 정책, capturePaypalOrder L375 승계) + 라인별 retry.
 *    실 캡처는 운영자 실 PayPal e2e 로 검증 (자동 테스트는 주문생성/모킹까지).
 */
import { getPaypalAccessToken, resolveIsSandbox } from './_shared/paypal.js';
import { initAdminDb } from './_shared/firebase-admin.js';
import { featureEnabled } from './_shared/feature-flag.js';
import { triggerBookingProcessor } from './_shared/booking-processor-trigger.js';
import { throttledTelegramAlert } from './_shared/telegram-throttle.js';
import { notify } from './_shared/notify.js';
import { verifyCartCaptureAmount, buildCartChildBookings } from './_shared/cart-capture.js';
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

    // 3. ⚠️ 캡처 금액 == 스냅샷 합계 검증. 불일치 = 변조/stale 의심 → critical alert.
    //    money 는 이미 캡처됨 → 자동환불 안 함(위험). 스냅샷이 라인 amount SSOT 이므로 진행.
    const amountCheck = verifyCartCaptureAmount(snapshot.usdAmount, capturedUsd);
    if (!amountCheck.ok) {
      throttledTelegramAlert({
        key: 'cart-amount-mismatch',
        channel: 'admin',
        severity: 'critical',
        message: [
          '🚨 <b>CART 캡처 금액 불일치 (결제 완료됨)</b>',
          '',
          `<b>OrderID:</b> <code>${orderID}</code>`,
          `<b>CaptureID:</b> <code>${captureID}</code>`,
          `<b>스냅샷 USD:</b> ${amountCheck.expected} / <b>캡처 USD:</b> ${amountCheck.captured} (diff ${amountCheck.diff})`,
          '',
          '→ 변조/snapshot stale 의심. 운영자 수동 검토 (자동환불 안 함).',
        ].join('\n'),
        context: { orderID, captureID, expected: amountCheck.expected, captured: amountCheck.captured },
      }).catch(() => {});
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
    const siteUrl = process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'https://cocotripkr.com';
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
