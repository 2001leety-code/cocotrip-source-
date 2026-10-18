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
import { buildCartChildBookings, cartLineUsdAmounts } from './_shared/cart-capture.js';
import { confirmSlotLock, readSlotFields } from './_shared/slot-capacity.js';
import { toMinorUnits, verifyCaptureIntegrity } from './_shared/paypal-capture-verify.js';
import { recordPaymentReview, buildPaymentReviewResponse } from './_shared/payment-review.js';
import { internalApiBase } from './_shared/internal-base-url.js';
import { FieldValue } from 'firebase-admin/firestore';
import {
  isSameOrderProven, isLegacyOpenSnapshot, verifyBearerUid, validateIntent, acquirePaymentAttempt, reconcileCapture, summarizeVerifiedCapture,
  persistBookingsAtomically, shouldDispatchRetry, releaseHeldIntents, makeRetryPersister, recordProcessorResult, updateAttempt,
  releaseAttemptClaim, discardAttempt, finalizeAttempt, pendingPaymentResponse, notCapturedResponse, withBackoff,
} from './_shared/payment-fulfillment-recovery.js';

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
    try {
      cartLineUsdAmounts(snapshot);
    } catch {
      res.writeHead(409, JSON_CORS);
      return res.end(JSON.stringify(_err('Cart amounts could not be verified. Please create a new order.', 'INVALID_CART_AMOUNTS')));
    }

    // Same-order authority: original checkout capability cookie or the authenticated owner (legacy snapshots stay open).
    const verifiedUid = await verifyBearerUid(req.headers && req.headers.authorization);
    const sameOrderProven = isSameOrderProven({ req, flow: 'cart', orderID, snapshot, verifiedUid });
    if (!sameOrderProven && !isLegacyOpenSnapshot(snapshot)) {
      res.writeHead(403, JSON_CORS);
      return res.end(JSON.stringify(_err('The original checkout session is required for this order', 'RECOVERY_AUTH_REQUIRED')));
    }
    const reconcileOnly = body.reconcile === true;

    const isSandbox = resolveIsSandbox();
    if (isSandbox) console.warn('[captureCartOrder] SANDBOX MODE — 실제 결제 아님 (preview e2e)');
    const { accessToken, baseUrl: PAYPAL_BASE_URL } = await getPaypalAccessToken(isSandbox);

    // 1. Attempt record (used_paypal_orders lock + frozen intent + exclusive claim). Storage failure => capture 0.
    let intent;
    try {
      intent = validateIntent({ version: 1, body: { userEmail, lineCount: snapshot.lines.length }, uid: verifiedUid || null });
    } catch (intentErr) {
      res.writeHead(409, JSON_CORS);
      return res.end(JSON.stringify(_err(intentErr.message, intentErr.code || 'RECOVERY_INTENT_INVALID')));
    }
    const acquired = await acquirePaymentAttempt({
      db, orderID, flow: 'cart', environment: isSandbox ? 'sandbox' : 'live', requestKey: `${orderID}-cart-cap`, intent, userEmail, product: 'cart',
      createIfMissing: !reconcileOnly, allowRecovery: sameOrderProven,
    });
    if (acquired.kind === 'absent') {
      res.writeHead(409, JSON_CORS);
      return res.end(JSON.stringify({ ...notCapturedResponse({ orderID, flow: 'cart', reason: 'no_attempt_record' }), evidence: 'no_attempt_record' }));
    }
    if (acquired.kind === 'unauthorized') {
      console.warn('[captureCartOrder] recovery refused without same-order proof:', orderID);
      res.writeHead(409, JSON_CORS);
      return res.end(JSON.stringify(_err('Order already processed', 'DUPLICATE_ORDER')));
    }
    if (acquired.kind === 'finalized') {
      const stored = acquired.lock.finalResponse || { status: 200, body: _ok({ orderID, message: 'Cart booking already confirmed.' }) };
      res.writeHead(stored.status || 200, JSON_CORS);
      return res.end(JSON.stringify({ ...stored.body, replayed: true }));
    }
    if (acquired.kind === 'duplicate') {
      res.writeHead(409, JSON_CORS);
      return res.end(JSON.stringify(_err('Order already processed', 'DUPLICATE_ORDER')));
    }
    if (acquired.kind === 'in_progress') {
      res.writeHead(202, JSON_CORS);
      return res.end(JSON.stringify(pendingPaymentResponse({ orderID, flow: 'cart', paymentStatus: acquired.lock.captureVerified ? 'CAPTURED' : 'CAPTURE_UNKNOWN', inProgress: true })));
    }
    if (acquired.kind === 'cross_flow') {
      res.writeHead(400, JSON_CORS);
      return res.end(JSON.stringify(_err('This order must be paid through single checkout', 'CROSS_FLOW_ORDER')));
    }
    if (acquired.kind === 'environment') {
      res.writeHead(409, JSON_CORS);
      return res.end(JSON.stringify(_err('Order belongs to a different PayPal environment', 'ORDER_ENVIRONMENT_MISMATCH')));
    }
    const attempt = acquired.attempt;
    const stages = (attempt.lock && attempt.lock.stages) || {};
    const savedEmail = attempt.recovering ? ((attempt.lock.intent.body && attempt.lock.intent.body.userEmail) || '') : userEmail;

    // 2. 캡처/대조 — unknown 은 락 유지 + 202, provider 가 증명한 미결제만 락 해제.
    const postCapture = async () => {
      const captureRes = await fetch(`${PAYPAL_BASE_URL}/v2/checkout/orders/${orderID}/capture`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          'PayPal-Request-Id': `${orderID}-cart-cap`,
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
      await discardAttempt(attempt).catch(() => {});
      res.writeHead(409, JSON_CORS);
      return res.end(JSON.stringify(notCapturedResponse({ orderID, flow: 'cart', reason: reconciled.reason })));
    }
    if (reconciled.state !== 'captured') {
      console.error('[captureCartOrder] capture result UNKNOWN — lock retained:', orderID, reconciled.reason);
      await updateAttempt(attempt, { captureState: 'unknown', lastUnknownReason: reconciled.reason || 'unknown', lastUnknownAtMs: Date.now() }).catch(() => {});
      await releaseAttemptClaim(attempt);
      await throttledTelegramAlert({
        key: `cart-capture-unknown-${orderID}`, channel: 'admin', severity: 'warning',
        message: [`🕒 <b>CART capture 결과 미상 (주문 락 유지)</b>`, `<b>OrderID:</b> <code>${orderID}</code>`, `<b>사유:</b> ${reconciled.reason}`].join('\n'),
        context: { orderID, reason: reconciled.reason },
      }).catch(() => {});
      res.writeHead(202, JSON_CORS);
      return res.end(JSON.stringify(pendingPaymentResponse({ orderID, flow: 'cart', paymentStatus: 'CAPTURE_UNKNOWN' })));
    }
    const capture = reconciled.capture || null;
    const stored = reconciled.verified || null;

    const captureNode = capture && capture.purchase_units && capture.purchase_units[0]
      && capture.purchase_units[0].payments && capture.purchase_units[0].payments.captures
      && capture.purchase_units[0].payments.captures[0];
    const payerEmail = stored ? stored.payerEmail : ((capture.payer && capture.payer.email_address) || '');
    const payerName = stored ? stored.payerName : `${(capture.payer && capture.payer.name && capture.payer.name.given_name) || ''} ${(capture.payer && capture.payer.name && capture.payer.name.surname) || ''}`.trim();
    const capturedUsd = stored ? stored.amountValue : ((captureNode && captureNode.amount && captureNode.amount.value) || '');
    const captureID = stored ? stored.captureID : ((captureNode && captureNode.id) || '');

    // 3. ⚠️ capture 무결성 검증 (money-critical) — amount(정수 minor) + currency +
    //    개별 capture status + purchase-unit/capture cardinality 를 스냅샷과 대조.
    //
    //    이전 동작: 금액만 parseFloat 비교하고, 불일치해도 Telegram alert 만 쏘고 CONFIRMED 로
    //      **그대로 진행**했다 → 결제와 다른 예약이 확정 + 알림 유실 시 사고 은폐(Telegram=SSOT 아님).
    //    현재: 불일치 = 예약 확정·fan-out 중단 + durable payment_reviews 격리 + 202(재시도 금지).
    //      돈은 이미 캡처됐으므로 일반 실패로 버리지 않는다(사용자 재결제 = 이중청구).
    //      자동환불도 하지 않는다 — 운영자 판단(cocotrip-money-safety).
    const expectedMinor = toMinorUnits(snapshot.usdAmount, 'USD');
    const verdict = stored
      ? { ok: !stored.pending, pending: stored.pending, code: stored.pending ? 'CAPTURE_PENDING' : undefined, detail: 'replayed verified capture', captureID, amountMinor: stored.amountMinor, currency: stored.currency }
      : verifyCaptureIntegrity({ capture, expectedAmountMinor: expectedMinor, expectedCurrency: 'USD' });
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
      await updateAttempt(attempt, { status: 'captured', captureState: 'captured', reviewQuarantined: true, captureID, claimUntil: 0 }).catch(() => {});

      // 202 Accepted — 예약 미확정. retryable:false (재결제 = 이중청구).
      // paymentCaptured 는 실제 capture status 파생 (돈 안 움직인 verdict 에 "결제됨" 이라 하지 않음).
      res.writeHead(202, JSON_CORS);
      return res.end(JSON.stringify(buildPaymentReviewResponse({ orderID, captureID, capture })));
    }

    // 4. 라인별 child booking doc batch + 부모 carts/{orderID} + cart_orders status.
    const children = buildCartChildBookings(orderID, snapshot, { payerEmail, payerName, userEmail: savedEmail, captureID });
    // 🔴 Mandatory durable boundary (ghost-booking fix 버그헌트 #4 + 2026-10-10 recovery): parent carts doc,
    //   cart_orders status, EVERY stable child `${orderID}__${lineId}` and each child's processor retry intent
    //   commit in ONE transaction. Failure => 202 finalized:false, no fan-out; same-order replay repairs it.
    const captureVerified = stored || summarizeVerifiedCapture({ verdict, capture, payerEmail, payerName, amountValue: capturedUsd, captureID });
    const rawCapturePayload = { captureID, amount: (captureNode && captureNode.amount) || (stored ? { value: stored.amountValue, currency_code: stored.currency } : null), status: capture ? (capture.status || '') : stored.orderStatus };
    const persisted = await withBackoff(() => persistBookingsAtomically({
      db, attempt, timestamp: FieldValue.serverTimestamp(), lockPatch: { captureVerified, captureID },
      bookings: children.map((child) => ({
        orderID: child.childOrderID, payload: child.processorPayload, source: 'captureCartOrder',
        doc: {
          ...child.bookingDoc, rawCapturePayload,
          // 🔴 2026-07-29: 이 예약이 어느 PayPal 환경에서 만들어졌는지 (환경 교차 웹훅 차단 근거).
          paypalEnvironment: isSandbox ? 'sandbox' : 'live',
          createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(),
        },
      })),
      parents: [
        { ref: db.collection('carts').doc(orderID), onlyIfMissing: true, data: {
          orderID, captureID, status: 'CONFIRMED',
          totalKRW: snapshot.totalKRW, usdAmount: snapshot.usdAmount, usdRate: snapshot.usdRate,
          lineCount: children.length, payerEmail, userEmail: savedEmail,
          createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(),
        } },
        { ref: db.collection('cart_orders').doc(orderID), data: { status: 'captured', captureID, capturedAt: FieldValue.serverTimestamp() } },
      ],
    }));
    const batchOk = persisted.ok;
    if (!batchOk) {
      const batchErr = persisted.error || new Error('unknown');
      await updateAttempt(attempt, { status: 'captured', captureState: 'captured', captureVerified, captureID }).catch(() => {});
      await releaseAttemptClaim(attempt);
      await throttledTelegramAlert({
        key: `cart-bookings-write-fail-${orderID}`,
        channel: 'admin',
        severity: 'critical',
        message: [
          '🚨 <b>CART booking doc 저장 실패 (결제 완료됨 · 202 미확정 응답)</b>',
          `<b>OrderID:</b> <code>${orderID}</code> <b>CaptureID:</b> <code>${captureID}</code>`,
          `<b>금액:</b> $${snapshot.usdAmount} / ₩${(snapshot.totalKRW || 0).toLocaleString('ko-KR')}`,
          `<b>사유:</b> ${(batchErr.message || 'unknown').slice(0, 250)}`,
          '→ 손님 화면은 "예약 확인 중"(확정 아님). 같은 주문 재확인이 저장을 복구한다.',
        ].join('\n'),
        context: { orderID, captureID, source: 'captureCartOrder' },
      }).catch(() => {});
      console.error('[captureCartOrder] mandatory persistence failed → fan-out 스킵(유령예약 방지):', orderID);
      res.writeHead(202, JSON_CORS);
      return res.end(JSON.stringify(pendingPaymentResponse({ orderID, flow: 'cart', paymentStatus: 'CAPTURED' })));
    }
    const markStage = (stage, patch) => updateAttempt(attempt, { stages: { [stage]: { ...patch, atMs: Date.now() } } });

    // 5-1. 🔴 2026-08-08 투어 슬롯 정원 확정 (단건 capturePaypalOrder 형제 경로) — runs BEFORE the held
    //    intents are released so the cron can never dispatch a line while mandatory checks are still settling.
    //   createCartOrder 가 올려둔 pending 을 confirmed 로 넘긴다. 예약 doc 저장 성공(batchOk)
    //   뒤에만 — 예약이 없는데 좌석만 차지하면 정원이 영구 오염된다(단건 bookingWriteOk 게이트 동형).
    //   slot 필드가 없는 라인(차터 등)은 readSlotFields 가 null → 스킵 = 기존 동작.
    //   실패해도 응답은 성공이다 — 돈은 이미 캡처됐고 예약도 확정됐다. 운영자 알림으로 남긴다.
    if (batchOk) {
      for (const line of snapshot.lines) {
        const slot = readSlotFields(line && line.booking);
        if (!slot) continue;
        const stageKey = `slot_${line.lineId || 'L0'}`;
        if (stages[stageKey]) {
          if (stages[stageKey].state === 'started') {
            await throttledTelegramAlert({ key: `cart-slot-AMBIGUOUS-${orderID}-${stageKey}`, channel: 'admin', severity: 'high', message: `⚠️ <b>CART 슬롯 confirm 결과 불명 (이전 시도 중단) — 재실행 안 함</b>\n<b>OrderID:</b> <code>${orderID}</code> <b>line:</b> ${line.lineId || '?'}`, context: { orderID, lineId: line.lineId || null } }).catch(() => {});
          }
          continue;
        }
        try {
          await markStage(stageKey, { state: 'started' });
        } catch (markErr) {
          console.error('[captureCartOrder] slot stage marker failed — confirm skipped (ambiguity guard):', markErr.message);
          continue;
        }
        try {
          await confirmSlotLock({
            adminDb: db,
            tourId: slot.tourId,
            date: slot.date,
            slotId: slot.slotId,
            pax: slot.pax,
            capacity: slot.capacity,
            orderId: orderID,
          });
          console.log('[captureCartOrder] slot confirmed:', { orderID, tourId: slot.tourId, date: slot.date, slot: slot.slotId, pax: slot.pax });
          await markStage(stageKey, { state: 'completed' }).catch(() => {});
        } catch (slotErr) {
          const code = slotErr.code || 'SLOT_CONFIRM_FAILED';
          console.error('[captureCartOrder] slot confirm failed:', code, slotErr.message);
          await markStage(stageKey, { state: 'failed', code }).catch(() => {});
          await throttledTelegramAlert({
            key: `cart-slot-confirm-${code}`,
            channel: 'admin',
            severity: 'critical',
            message: [
              '🚨 <b>CART 슬롯 정원 확정 실패 (결제·예약은 완료됨)</b>',
              `<b>OrderID:</b> <code>${orderID}</code> <b>line:</b> ${line.lineId || '?'}`,
              `<b>tour:</b> ${slot.tourId}`,
              `<b>date/slot:</b> ${slot.date} / ${slot.slotId}`,
              `<b>pax:</b> ${slot.pax} <b>capacity:</b> ${slot.capacity}`,
              `<b>오류:</b> ${(slotErr.message || '').slice(0, 200)}`,
              code === 'SLOT_FULL_AT_CAPTURE'
                ? '🚨 overbooking 가능성 — 운영자 수동 검토 + 환불/조정 결정 필요.'
                : '슬롯 카운터 불일치. lockfix scripts/admin-slot-rebuild 검토.',
            ].join('\n'),
            context: { orderID, lineId: line.lineId || null, tourId: slot.tourId, date: slot.date, slotId: slot.slotId, pax: slot.pax, capacity: slot.capacity, code },
          }).catch(() => {});
        }
      }
    }

    // 5. 라인별 booking-processor fan-out (payload.orderID=childOrderID, retryDocId=childOrderID). Held intents
    //    are opened in one transaction only now; a failed release keeps every line non-runnable (202, replay
    //    releases). Only runnable lines dispatch; persisters never reset attempts or terminal states.
    const siteUrl = internalApiBase();
    const timestamp = FieldValue.serverTimestamp();
    let retryStatus;
    try {
      retryStatus = await releaseHeldIntents({ db, attempt, timestamp, intents: children.map((child) => ({ retryDocId: child.retryDocId, bookingId: child.childOrderID })) });
    } catch (releaseErr) {
      console.error('[captureCartOrder] held intent release failed — fan-out skipped (202):', releaseErr.message);
      if (releaseErr.code !== 'CLAIM_LOST') await releaseAttemptClaim(attempt);
      res.writeHead(202, JSON_CORS);
      return res.end(JSON.stringify({ ...pendingPaymentResponse({ orderID, flow: 'cart', paymentStatus: 'CAPTURED' }), reviewReason: releaseErr.code === 'CLAIM_LOST' ? 'claim_lost' : 'intent_release_failed' }));
    }
    const stoppedLines = children.filter((child) => retryStatus[child.retryDocId] === 'stopped');
    if (stoppedLines.length > 0) {
      console.warn('[captureCartOrder] stopped child bookings not dispatched:', orderID, stoppedLines.map((c) => c.childOrderID));
      await throttledTelegramAlert({ key: `cart-booking-stopped-at-release-${orderID}`, channel: 'admin', severity: 'high', message: `⚠️ <b>CART 라인 예약이 환불/취소 상태라 후속처리 미실행</b>\n<b>OrderID:</b> <code>${orderID}</code>\n<b>lines:</b> ${stoppedLines.map((c) => c.lineId).join(', ')}`, context: { orderID } }).catch(() => {});
    }
    if (stoppedLines.length === children.length) {
      const stoppedBody = { ...pendingPaymentResponse({ orderID, flow: 'cart', paymentStatus: 'CAPTURED' }), bookingStatus: 'BOOKING_STOPPED', reviewReason: 'booking_stopped' };
      await finalizeAttempt(attempt, { finalOutcome: 'booking_stopped', finalResponse: { status: 202, body: stoppedBody } }).catch(() => {});
      res.writeHead(202, JSON_CORS);
      return res.end(JSON.stringify(stoppedBody));
    }
    await Promise.allSettled(children.filter((child) => shouldDispatchRetry(retryStatus[child.childOrderID])).map(async (child) => {
      const result = await triggerBookingProcessor({
        db, siteUrl, payload: child.processorPayload, source: 'captureCartOrder', notify, retryDocId: child.retryDocId,
        persistRetry: makeRetryPersister({ db, timestamp }),
      });
      await recordProcessorResult({ db, orderID: child.childOrderID, retryDocId: child.retryDocId, result, timestamp }).catch((e) => {
        console.error('[captureCartOrder] processor state persist failed:', child.childOrderID, e.message);
      });
    }));

    // 6. 응답 (+ minimal replay record for later authorized same-order calls — no contact data).
    const successBody = _ok({
      orderID, captureID, payerEmail, payerName,
      lineCount: children.length,
      amount: capturedUsd, currency: 'USD',
      message: '장바구니 예약이 확정되었습니다. 상품별 확인 이메일을 발송 중입니다.',
    });
    successBody.finalized = true;
    await finalizeAttempt(attempt, {
      finalOutcome: 'confirmed',
      finalResponse: { status: 200, body: { ok: true, finalized: true, data: { orderID, lineCount: children.length, amount: capturedUsd, currency: 'USD', message: 'Cart booking confirmed.' } } },
    }).catch((e) => { console.error('[captureCartOrder] finalize marker failed (bookings durable; replay-safe):', e.message); });
    res.writeHead(200, JSON_CORS);
    res.end(JSON.stringify(successBody));
  } catch (err) {
    console.error('[captureCartOrder] Error:', err);
    res.writeHead(500, JSON_CORS);
    res.end(JSON.stringify(_err(err.message, 'INTERNAL_ERROR')));
  }
}
