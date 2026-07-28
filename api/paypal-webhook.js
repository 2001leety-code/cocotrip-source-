/**
 * POST /api/paypal-webhook
 *
 * PayPal Business Webhook 수신 endpoint — 한국 체류 외국인 사용자의 paypal.me/cocotripkr
 * 결제가 머천트 계정에 입금되면 PayPal 이 이 endpoint 로 IPN-style webhook 발사.
 * memo 의 bookingRef (CT-YYYYMMDD-XXX) 로 자동 매칭 → admin 클릭 0건 워크플로우.
 *
 * 처리 이벤트:
 *   PAYMENT.CAPTURE.COMPLETED — 자동 [입금 확인] (mark-paid 동등)
 *   PAYMENT.SALE.COMPLETED    — 레거시 NVP/SOAP 거래도 paypal.me 에서 발사
 *   PAYMENT.CAPTURE.REFUNDED  — 자동 [환불 처리] (mark-refunded 동등)
 *   PAYMENT.SALE.REFUNDED     — 레거시 환불
 *   * 그 외 — 로그만 남기고 200 응답 (PayPal 재시도 차단)
 *
 * 보안:
 *   PayPal verify-webhook-signature API 호출 — 헤더 5종 + 본문 + webhook_id 매칭 확인.
 *   PAYPAL_WEBHOOK_ID 미설정 시 모든 이벤트 거부 (운영자 등록 누락 방지).
 *
 * 멱등:
 *   paypal_webhook_log/{eventId} doc 존재 여부로 중복 처리 차단.
 *   confirmBookingAsPaid 자체도 status='CONFIRMED' 면 부수효과 스킵.
 *
 * 운영자 등록:
 *   PayPal Developer Dashboard → My Apps & Credentials → 본인 앱 → Webhooks → Add Webhook
 *   URL: https://cocotripkr.com/api/paypal-webhook
 *   Events: PAYMENT.CAPTURE.COMPLETED, PAYMENT.CAPTURE.REFUNDED
 *           (옵션) PAYMENT.SALE.COMPLETED, PAYMENT.SALE.REFUNDED
 *   Webhook ID 복사 → Vercel env PAYPAL_WEBHOOK_ID 등록 (Production)
 *
 * ENV:
 *   PAYPAL_WEBHOOK_ID         — 등록된 webhook ID (필수)
 *   PAYPAL_CLIENT_ID          — 기존 (signature verify 용)
 *   PAYPAL_CLIENT_SECRET      — 기존
 *   PAYPAL_WEBHOOK_TOLERANCE  — amount 매칭 허용오차 (옵션, default 0.01 = 1%)
 */
import { FieldValue } from 'firebase-admin/firestore';
import { initAdminDb } from './_shared/firebase-admin.js';
import { captureError } from './_shared/sentry.js';
import { notify } from './_shared/notify.js';
import { getPaypalAccessToken } from './_shared/paypal.js';
import { confirmBookingAsPaid } from './_shared/booking-confirm.js';

// PR #423 (CZ6): disable Vercel's auto-bodyParser so we receive the raw
// PayPal-signed bytes. If Vercel parses + we re-stringify (the previous
// branch in readRawBody), key ordering and number normalisation drift
// from PayPal's canonical form and verify-webhook-signature returns
// FAILURE on every legitimate event — auto-confirm silently stops working.
export const config = {
  runtime: 'nodejs',
  api: { bodyParser: false },
};
export const maxDuration = 30;

const JSON_HEADERS = {
  'Content-Type': 'application/json',
  'Cache-Control': 'no-store',
};

const BOOKING_REF_PATTERN = /CT-\d{8}-\d{3}/;

// PR #423 (CZ6): PayPal signs the raw request bytes. To verify the signature
// we MUST parse the body ourselves from the original bytes — never let
// Vercel parse + re-stringify, because key ordering / number normalisation
// drift produces a JSON shape that PayPal's canonical-form hash rejects.
//
// With `api: { bodyParser: false }` set above, req.body is undefined and we
// always read the IncomingMessage stream. The two preserved branches handle
// dev/test setups where the stream has already been consumed.
async function readRawBody(req) {
  if (typeof req.body === 'string') return req.body;
  if (Buffer.isBuffer?.(req.body)) return req.body.toString('utf8');
  // No fallback to JSON.stringify(req.body) — that's the exact bug CZ6 fixes.
  return new Promise((resolve, reject) => {
    let data = '';
    req.setEncoding?.('utf8');
    req.on('data', (chunk) => { data += chunk; });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

async function verifyWebhookSignature({ headers, bodyString, webhookId, isSandbox }) {
  const { accessToken, baseUrl } = await getPaypalAccessToken(isSandbox);

  // PayPal 은 webhook_event 필드를 객체로 받음 — 본문을 그대로 파싱해서 전달.
  // (raw string 이 아니라 JSON 인 점이 가장 자주 헷갈리는 부분)
  let webhookEvent;
  try {
    webhookEvent = JSON.parse(bodyString);
  } catch {
    return { verified: false, reason: 'invalid_json' };
  }

  const verifyPayload = {
    auth_algo: headers['paypal-auth-algo'] || headers['Paypal-Auth-Algo'],
    cert_url: headers['paypal-cert-url'] || headers['Paypal-Cert-Url'],
    transmission_id: headers['paypal-transmission-id'] || headers['Paypal-Transmission-Id'],
    transmission_sig: headers['paypal-transmission-sig'] || headers['Paypal-Transmission-Sig'],
    transmission_time: headers['paypal-transmission-time'] || headers['Paypal-Transmission-Time'],
    webhook_id: webhookId,
    webhook_event: webhookEvent,
  };

  // 누락 헤더 = signature 위변조 가능성. 즉시 거부.
  for (const [k, v] of Object.entries(verifyPayload)) {
    if (k === 'webhook_event') continue;
    if (!v) return { verified: false, reason: `missing_header:${k}`, webhookEvent };
  }

  const res = await fetch(`${baseUrl}/v1/notifications/verify-webhook-signature`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(verifyPayload),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    return { verified: false, reason: `verify_api_${res.status}`, debug: txt, webhookEvent };
  }
  const data = await res.json().catch(() => ({}));
  return {
    verified: data.verification_status === 'SUCCESS',
    reason: data.verification_status || 'unknown',
    webhookEvent,
  };
}

function extractBookingRefFromEvent(event) {
  const r = event?.resource || {};
  // 후보 필드 — paypal.me/Checkout API/SOAP 모두 대응
  const candidates = [
    r.note_to_payee,
    r.custom_id,
    r.invoice_id,
    r.purchase_units?.[0]?.custom_id,
    r.purchase_units?.[0]?.invoice_id,
    r.description,
  ].filter(Boolean);

  for (const text of candidates) {
    const m = String(text).match(BOOKING_REF_PATTERN);
    if (m) return m[0];
  }
  return null;
}

function extractAmountUSD(event) {
  const r = event?.resource || {};
  // PAYMENT.CAPTURE.* 와 PAYMENT.SALE.* 의 amount 위치가 다름
  const amount = r.amount || r.purchase_units?.[0]?.amount || {};
  const value = parseFloat(amount.value || amount.total || '0');
  const currency = amount.currency_code || amount.currency || 'USD';
  return { value: Number.isFinite(value) ? value : 0, currency };
}

function extractRefundedCaptureId(event) {
  // refund 이벤트의 links 에 up rel 로 원래 capture id 가 들어 있음
  const links = event?.resource?.links || [];
  const upLink = links.find((l) => l.rel === 'up');
  if (!upLink?.href) return null;
  // href 형식: https://api.paypal.com/v2/payments/captures/{captureId}
  const m = String(upLink.href).match(/\/(captures|sale)\/([^/?]+)/);
  return m ? m[2] : null;
}

/**
 * PR #438 (Audit Y-H7 — 2026-05-16): PayPal-direct flow (createPaypalOrder +
 * capturePaypalOrder) 는 order memo 에 custom_id/invoice_id/note_to_payee 를
 * 안 넣어서 webhook 이 bookingRef 로 매칭 불가 → 매 capture 마다
 * "unmatched" alert 발사. 이걸 막으려면 PayPal 이 capture event 에 함께 주는
 * `supplementary_data.related_ids.order_id` 로 우리 `bookings/{orderID}` 를
 * 직접 lookup. capturePaypalOrder 가 이미 status='CONFIRMED' 로 저장한 후라
 * webhook 은 단순 ack 만 하면 됨 (사용자에게는 redundant alert 없음).
 */
function extractPaypalOrderId(event) {
  const r = event?.resource || {};
  return r.supplementary_data?.related_ids?.order_id
      || r.purchase_units?.[0]?.payments?.captures?.[0]?.supplementary_data?.related_ids?.order_id
      || null;
}

async function logWebhookEvent({ db, eventId, eventType, status, detail }) {
  try {
    await db.collection('paypal_webhook_log').doc(eventId).set({
      eventId,
      eventType: eventType || 'unknown',
      status, // 'processed' | 'duplicate' | 'unmatched' | 'unsupported' | 'verify_failed' | 'error'
      detail: detail || null,
      receivedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
  } catch (e) {
    console.warn('[paypal-webhook] log failed:', e.message);
  }
}

async function alertAdmin(text) {
  try { await notify('admin', text); } catch {}
}

/**
 * PR #440 (Audit Y-H9 — 2026-05-16): operator alert for verify_failed,
 * deduplicated so a misconfigured webhook secret doesn't spam Telegram.
 *
 * Uses Firestore as a 1-hour-per-reason throttle. Doc key is
 * sha256(reason) so distinct verify-failure reasons each get one
 * alert per hour. If Firestore is unavailable, fall back to always
 * alerting (operator visibility > spam concerns during outage).
 */
async function alertVerifyFailedDedup({ db, eventId, reason, eventType }) {
  const reasonKey = String(reason || 'unknown').slice(0, 200);
  const message = [
    '🚨 <b>PayPal Webhook signature 검증 실패</b>',
    '',
    `<b>이벤트 ID:</b> <code>${(eventId || 'unknown').slice(0, 80)}</code>`,
    `<b>이벤트 타입:</b> ${eventType || 'unknown'}`,
    `<b>실패 사유:</b> ${reasonKey}`,
    '',
    '→ 본 응답은 PayPal 에 200 ack (재시도 storm 차단). 진짜 misconfig 라면',
    '  PAYPAL_WEBHOOK_ID 또는 PAYPAL_*_CLIENT_SECRET 점검 필요.',
    '→ 1시간당 같은 사유 1회만 알림 (dedup).',
  ].join('\n');

  if (!db) {
    notify('admin', message).catch(() => {});
    return;
  }

  try {
    const { createHash } = await import('node:crypto');
    const reasonHash = createHash('sha256').update(reasonKey).digest('hex').slice(0, 32);
    const throttleRef = db.collection('paypal_verify_alert_throttle').doc(reasonHash);
    const now = Date.now();
    const WINDOW_MS = 60 * 60 * 1000;
    const shouldSend = await db.runTransaction(async (tx) => {
      const snap = await tx.get(throttleRef);
      const lastSentMs = snap.exists ? Number(snap.data()?.lastSentMs || 0) : 0;
      if (lastSentMs && (now - lastSentMs) < WINDOW_MS) return false;
      tx.set(throttleRef, { lastSentMs: now, lastReason: reasonKey, lastEventId: eventId || null }, { merge: true });
      return true;
    });
    if (shouldSend) {
      notify('admin', message).catch(() => {});
    } else {
      console.log('[paypal-webhook] verify_failed alert deduped (within 1h window):', reasonHash);
    }
  } catch (e) {
    // Throttle infra failure — alert anyway so the real issue isn't masked.
    console.warn('[paypal-webhook] verify_failed dedup throttle failed (alerting anyway):', e.message);
    notify('admin', message).catch(() => {});
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.writeHead(405, JSON_HEADERS);
    return res.end(JSON.stringify({ ok: false, error: 'POST only' }));
  }

  const headers = req.headers || {};
  const eventId = headers['paypal-transmission-id'] || headers['Paypal-Transmission-Id'] || `noheader-${Date.now()}`;

  try {
    const webhookId = process.env.PAYPAL_WEBHOOK_ID;
    if (!webhookId) {
      // 운영자가 PAYPAL_WEBHOOK_ID 미등록 — 모든 webhook 거부 (signature 검증 불가)
      console.error('[paypal-webhook] PAYPAL_WEBHOOK_ID not configured — rejecting');
      await alertAdmin('🚨 <b>PayPal Webhook 미구성</b>\n\nPAYPAL_WEBHOOK_ID env 누락. PayPal Developer Dashboard 에서 webhook 등록 후 Vercel env 추가 필요.');
      res.writeHead(503, JSON_HEADERS);
      return res.end(JSON.stringify({ ok: false, error: 'webhook not configured' }));
    }

    const adminDb = initAdminDb('paypal-webhook');
    if (!adminDb) {
      console.error('[paypal-webhook] Firestore unavailable');
      // 200 으로 응답해서 PayPal 재시도 부담 줄이고, sentry 로 운영자 알림
      res.writeHead(200, JSON_HEADERS);
      return res.end(JSON.stringify({ ok: false, error: 'firestore unavailable' }));
    }

    // 멱등 — 같은 transmission-id 재시도면 처리 스킵
    const logRef = adminDb.collection('paypal_webhook_log').doc(eventId);
    const existing = await logRef.get();
    if (existing.exists && existing.data()?.status === 'processed') {
      res.writeHead(200, JSON_HEADERS);
      return res.end(JSON.stringify({ ok: true, idempotent: true }));
    }

    // raw body 읽기
    const bodyString = await readRawBody(req);

    // signature 검증 — sandbox / live 양쪽 시도 (PayPal 은 sandbox/live 가 다른 API 베이스)
    let verifyResult = await verifyWebhookSignature({
      headers, bodyString, webhookId, isSandbox: false,
    });
    if (!verifyResult.verified && process.env.PAYPAL_SANDBOX_CLIENT_ID) {
      // live 검증 실패 + sandbox 자격 있음 → sandbox 로 한 번 더 (테스트 webhook).
      // 🔴 (2026-07-16) sandbox 웹훅은 **자기만의 Webhook ID** 를 갖는다(대시보드 별도 등록).
      //   live ID 로 sandbox verify 를 치면 무조건 FAILURE → 샌드박스 이벤트 전부 폐기
      //   = 샌드박스 e2e(eCheck PENDING→FAILED 관찰) 원천 불가. 미설정 시 기존 폴백 유지.
      const sandboxResult = await verifyWebhookSignature({
        headers, bodyString,
        webhookId: process.env.PAYPAL_SANDBOX_WEBHOOK_ID || webhookId,
        isSandbox: true,
      });
      if (sandboxResult.verified) verifyResult = sandboxResult;
    }

    if (!verifyResult.verified) {
      console.error('[paypal-webhook] signature verification failed:', verifyResult.reason);
      await logWebhookEvent({
        db: adminDb, eventId,
        eventType: verifyResult.webhookEvent?.event_type,
        status: 'verify_failed',
        detail: { reason: verifyResult.reason },
      });

      // PR #440 (Audit Y-H9 — 2026-05-16): respond 200 (NOT 401) on
      // verify_failed.
      //
      // Pre-fix: 401 → PayPal interprets as "deliverable but unprocessed"
      // and retries up to 25 times over 3 days (per PayPal IPN docs).
      // Each retry calls verifyWebhookSignature → consumes PayPal API
      // quota. A single misconfigured webhook secret could storm 25×
      // /transmission for every PayPal event.
      //
      // Signature failure is DETERMINISTIC — retrying won't fix it.
      // The right behavior is to ack so PayPal stops, log the failure
      // for forensics (already done above), and surface to the operator
      // via Telegram with dedup (so a misconfig storm doesn't spam the
      // channel either). Security is unaffected: we still don't process
      // the unverified event below.
      await alertVerifyFailedDedup({
        db: adminDb,
        eventId,
        reason: verifyResult.reason,
        eventType: verifyResult.webhookEvent?.event_type,
      });

      res.writeHead(200, JSON_HEADERS);
      return res.end(JSON.stringify({ ok: false, error: 'signature verification failed', acked: true }));
    }

    const event = verifyResult.webhookEvent;
    const eventType = event.event_type || 'unknown';
    console.log('[paypal-webhook] verified event:', eventType, eventId);

    // ─── PAYMENT.CAPTURE.COMPLETED / PAYMENT.SALE.COMPLETED ─────────
    if (eventType === 'PAYMENT.CAPTURE.COMPLETED' || eventType === 'PAYMENT.SALE.COMPLETED') {
      const bookingRef = extractBookingRefFromEvent(event);
      const { value: amountUSD, currency } = extractAmountUSD(event);
      const paypalTxId = event.resource?.id || null;

      if (!bookingRef) {
        // PR #438 (Audit Y-H7 — 2026-05-16): PayPal-direct flow (Smart
        // Buttons) doesn't carry our bookingRef in any memo field, but the
        // capture event DOES carry the original PayPal order id under
        // supplementary_data.related_ids.order_id. capturePaypalOrder.js
        // stores `bookings/{orderID}` with status='CONFIRMED' before this
        // webhook arrives, so the right behavior here is just to ack —
        // not to alert the operator (alert is for genuine unmatched cases
        // like manual QR with malformed memo).
        const paypalOrderId = extractPaypalOrderId(event);
        if (paypalOrderId) {
          const directBookingDoc = await adminDb.collection('bookings').doc(paypalOrderId).get();
          if (directBookingDoc.exists) {
            const directData = directBookingDoc.data() || {};
            await logWebhookEvent({
              db: adminDb, eventId, eventType,
              status: 'processed',
              detail: {
                reason: 'already_confirmed_via_capture_endpoint',
                bookingRef: directData.bookingRef || paypalOrderId,
                paypalOrderId, paypalTxId, amountUSD, currency,
              },
            });
            console.log('[paypal-webhook] PayPal-direct capture ack (no alert):', paypalOrderId);
            res.writeHead(200, JSON_HEADERS);
            return res.end(JSON.stringify({ ok: true, status: 'already_confirmed' }));
          }
        }
        console.warn('[paypal-webhook] no bookingRef in memo — manual review:', eventId);
        await logWebhookEvent({
          db: adminDb, eventId, eventType,
          status: 'unmatched',
          detail: { reason: 'no_booking_ref', amountUSD, currency, paypalTxId, paypalOrderId },
        });
        await alertAdmin(
          '⚠️ <b>PayPal Webhook — bookingRef 미매칭</b>\n\n' +
          `PayPal TX: <code>${paypalTxId}</code>\n` +
          (paypalOrderId ? `PayPal Order: <code>${paypalOrderId}</code>\n` : '') +
          `금액: $${amountUSD} ${currency}\n` +
          'memo 에 CT-YYYYMMDD-XXX 패턴 없음 — admin UI 에서 수동 매칭 필요'
        );
        res.writeHead(200, JSON_HEADERS);
        return res.end(JSON.stringify({ ok: true, status: 'unmatched' }));
      }

      // pending_bookings 매칭 + amount 검증
      const pendingSnap = await adminDb.collection('pending_bookings').doc(bookingRef).get();
      if (!pendingSnap.exists) {
        await logWebhookEvent({
          db: adminDb, eventId, eventType,
          status: 'unmatched',
          detail: { reason: 'pending_not_found', bookingRef, amountUSD, paypalTxId },
        });
        await alertAdmin(
          '⚠️ <b>PayPal Webhook — pending_bookings 없음</b>\n\n' +
          `예약번호: <code>${bookingRef}</code>\n` +
          `PayPal TX: <code>${paypalTxId}</code>\n` +
          `금액: $${amountUSD} ${currency}`
        );
        res.writeHead(200, JSON_HEADERS);
        return res.end(JSON.stringify({ ok: true, status: 'unmatched' }));
      }
      const pending = pendingSnap.data();

      // amount sanity — PriceUSD 와 ±1% (또는 env 설정값) 매칭.
      //
      // PR #431 (Audit Y-H6 — 2026-05-14): default rate 1380 → 1430.
      // 1380 was the launch-era estimate; the current policy_krw_per_usd
      // (src/data/pricing_spec.json) is 1430. Stale 1380 produced a ~3.5 %
      // expected-USD undershoot, so legitimate refund webhooks were being
      // logged as `amount_mismatch` and routed to the operator queue.
      // Pulls from the same env var precedence as capturePaypalOrder.js
      // (PR #425): KRW_USD_RATE > VITE_USD_KRW_RATE > 1430 default.
      const tolerance = parseFloat(process.env.PAYPAL_WEBHOOK_TOLERANCE || '0.01');
      const fallbackUsdToKrw = Number(process.env.KRW_USD_RATE)
        || Number(process.env.VITE_USD_KRW_RATE)
        || 1430;
      const expectedUSD = parseFloat(pending.priceUSD || (Number(pending.priceKRW || 0) / fallbackUsdToKrw));
      if (expectedUSD > 0 && Math.abs(amountUSD - expectedUSD) / expectedUSD > tolerance) {
        await logWebhookEvent({
          db: adminDb, eventId, eventType,
          status: 'unmatched',
          detail: {
            reason: 'amount_mismatch',
            bookingRef, paypalTxId,
            paidUSD: amountUSD, expectedUSD,
            tolerancePct: tolerance,
          },
        });
        await alertAdmin(
          '⚠️ <b>PayPal Webhook — 금액 불일치</b>\n\n' +
          `예약번호: <code>${bookingRef}</code>\n` +
          `PayPal TX: <code>${paypalTxId}</code>\n` +
          `결제: $${amountUSD}\n` +
          `예상: $${expectedUSD.toFixed(2)} (허용오차 ${(tolerance * 100).toFixed(1)}%)\n\n` +
          'admin UI 에서 수동 검토'
        );
        res.writeHead(200, JSON_HEADERS);
        return res.end(JSON.stringify({ ok: true, status: 'amount_mismatch' }));
      }

      // 자동 confirm
      const result = await confirmBookingAsPaid({
        db: adminDb,
        bookingRef,
        paypalTransactionId: paypalTxId,
        source: 'webhook',
      });
      if (!result.ok) {
        await logWebhookEvent({
          db: adminDb, eventId, eventType,
          status: 'error',
          detail: { reason: result.code, error: result.error, bookingRef, paypalTxId },
        });
        await alertAdmin(`🚨 <b>PayPal Webhook confirm 실패</b>\n\n예약: ${bookingRef}\n사유: ${result.error}`);
        res.writeHead(200, JSON_HEADERS);
        return res.end(JSON.stringify({ ok: false, error: result.error }));
      }

      await logWebhookEvent({
        db: adminDb, eventId, eventType,
        status: 'processed',
        detail: {
          bookingRef, paypalTxId,
          bookingId: result.bookingId,
          amountUSD,
          alreadyConfirmed: !!result.alreadyConfirmed,
        },
      });

      console.log('[paypal-webhook] auto-confirmed:', bookingRef, '→', result.bookingId);
      res.writeHead(200, JSON_HEADERS);
      return res.end(JSON.stringify({ ok: true, status: 'confirmed', bookingRef }));
    }

    // ─── PAYMENT.CAPTURE.REFUNDED / PAYMENT.SALE.REFUNDED ───────────
    if (eventType === 'PAYMENT.CAPTURE.REFUNDED' || eventType === 'PAYMENT.SALE.REFUNDED') {
      const captureId = extractRefundedCaptureId(event);
      const { value: refundedUSD } = extractAmountUSD(event);

      if (!captureId) {
        await logWebhookEvent({
          db: adminDb, eventId, eventType,
          status: 'unmatched',
          detail: { reason: 'no_capture_id_in_links' },
        });
        res.writeHead(200, JSON_HEADERS);
        return res.end(JSON.stringify({ ok: true, status: 'unmatched' }));
      }

      // PR #438 (Audit Y-H7 — 2026-05-16): match across all three storage
      // shapes so PayPal-direct refunds stop being silent-unmatched:
      //   (1) bookings/{captureId}  — legacy ID-as-captureId shape
      //   (2) bookings where captureID==captureId — PR #425 shape (doc id=orderID)
      //   (3) pending_bookings where paypalTransactionId==captureId — admin-matched manual QR
      // Capture the actual bookings doc ID (could be captureId OR orderID) so
      // the subsequent update writes to the RIGHT doc rather than creating an
      // orphan at bookings/{captureId} (the Y-H7 silent bug).
      let bookingsDocId = null;
      let bookingRef = null;
      let priceKRW = 0;
      // 🔴 2026-07-29 (#4): 부분/전액 판정을 **USD 끼리** 하기 위해 원결제 USD 를 같이 읽는다.
      //   capturedExchangeRate = 결제 당시 실제 적용 환율(표시용 KRW 환산에만 쓴다).
      let originalUSD = 0;
      let capturedRate = 0;

      let bookingDoc = await adminDb.collection('bookings').doc(captureId).get();
      if (bookingDoc.exists) {
        bookingsDocId = captureId;
        bookingRef = bookingDoc.data().bookingRef || captureId;
        priceKRW = bookingDoc.data().amountKRW || 0;
        originalUSD = Number(bookingDoc.data().amountUSD) || 0;
        capturedRate = Number(bookingDoc.data().capturedExchangeRate) || 0;
      } else {
        // PR #438: try captureID field — PayPal-direct flow's doc id is orderID.
        // 🔴 F6 (2026-07-16): .limit(1) 제거. cart 형제 예약 N개가 하나의 captureID 를 공유하므로
        //   (cart-capture.js) limit(1) 은 임의 1건이 아니라 Firestore equality 쿼리의 암묵
        //   __name__ ASC 정렬 때문에 **항상 첫 라인(__L0)**만 골라 REFUNDED 로 마킹한다 → 실제
        //   환불된 라인은 CONFIRMED 로 남고 엉뚱한 라인이 환불처리된다(기록 오류). size>1 이면
        //   captureID 만으로 어느 라인 환불인지 특정 불가 → 자동 마킹 금지, 운영자 수동 확인.
        const captureFieldMatch = await adminDb.collection('bookings')
          .where('captureID', '==', captureId)
          .get();
        if (captureFieldMatch.size > 1) {
          await logWebhookEvent({
            db: adminDb, eventId, eventType,
            status: 'ambiguous',
            detail: {
              reason: 'captureID_shared_by_cart_siblings',
              captureId,
              candidates: captureFieldMatch.docs.map((d) => d.id),
              refundedUSD,
            },
          });
          await alertAdmin(`⚠️ <b>cart 환불 webhook — 형제 ${captureFieldMatch.size}건이 captureID 공유</b>\n\nCapture: <code>${captureId}</code>\n환불액: $${refundedUSD}\n→ 어느 라인 환불인지 수동 확인 필요`);
          res.writeHead(200, JSON_HEADERS);
          return res.end(JSON.stringify({ ok: true, status: 'ambiguous' }));
        }
        if (!captureFieldMatch.empty) {
          bookingDoc = captureFieldMatch.docs[0];
          bookingsDocId = bookingDoc.id;
          bookingRef = bookingDoc.data().bookingRef || bookingDoc.id;
          priceKRW = bookingDoc.data().amountKRW || 0;
        originalUSD = Number(bookingDoc.data().amountUSD) || 0;
        capturedRate = Number(bookingDoc.data().capturedExchangeRate) || 0;
        } else {
          // Manual QR path — admin-matched paypalTransactionId on pending_bookings.
          const pendingMatch = await adminDb.collection('pending_bookings')
            .where('paypalTransactionId', '==', captureId)
            .limit(1).get();
          if (!pendingMatch.empty) {
            bookingRef = pendingMatch.docs[0].id;
            priceKRW = pendingMatch.docs[0].data().priceKRW || 0;
            // bookingsDocId stays null — pending_bookings update only.
          }
        }
      }

      if (!bookingRef) {
        await logWebhookEvent({
          db: adminDb, eventId, eventType,
          status: 'unmatched',
          detail: { reason: 'capture_not_in_bookings', captureId },
        });
        await alertAdmin(`⚠️ <b>PayPal 환불 webhook — booking 미매칭</b>\n\nCapture: <code>${captureId}</code>\n환불액: $${refundedUSD}`);
        res.writeHead(200, JSON_HEADERS);
        return res.end(JSON.stringify({ ok: true, status: 'unmatched' }));
      }

      // 🔴 2026-07-29 (#4): 표시용 KRW 환산은 **원결제 당시 환율**로 한다.
      //   이전에는 지금 시점의 env 환율(없으면 1430)로 환산했다. 결제 환율과 다르면
      //   같은 금액이 다른 KRW 로 찍히고, 아래 부분/전액 판정까지 뒤집혔다.
      //   capturedExchangeRate 가 없는 레거시 문서만 env/기본값으로 폴백한다.
      const usdToKrw = capturedRate
        || Number(process.env.KRW_USD_RATE)
        || Number(process.env.VITE_USD_KRW_RATE)
        || 1430;
      const refundedKRW = Math.round(refundedUSD * usdToKrw);
      // 🟡 부분/전체 판별: 이번 환불액이 원결제 KRW 보다 (1% 이상) 작으면 부분환불 →
      //   status='REFUNDED'(전액) 로 오기록하지 않고 'PARTIALLY_REFUNDED' 로 기록.
      //   (이전엔 부분환불도 무조건 REFUNDED → 운영자/고객 화면에 전액환불로 오표시.)
      //   ⚠️ refundedKRW 누적(increment) 은 도입 안 함: admin mark-refunded 가
      //   refundPaypalCapture 로 PayPal 환불을 트리거하면 이 webhook 도 같은 환불로 발사되어
      //   admin set + webhook increment 이중합산 위험. 이번 이벤트 금액(set) 유지가 안전.
      // 🔴 2026-07-29 (#4): 부분/전액 판정에서 **환율을 완전히 제거**한다.
      //   PayPal 은 USD 로 결제하고 USD 로 환불한다. 그 둘을 직접 비교하는 것이 진실이고,
      //   KRW 를 거치면 환율 하나로 판정이 뒤집힌다.
      //   실제 사고 구조: 원결제 ₩13,300 을 환율 1,468 로 $9.06 청구 → 전액 환불 $9.06 을
      //   env 환율 1,430 으로 환산하면 ₩12,956 < ₩13,167(99%) → **전액인데 부분으로 오기록**.
      //   원결제 USD 를 모르는 레거시 문서에서만 옛 KRW 비교로 폴백한다.
      const isPartialRefund = originalUSD > 0
        ? refundedUSD < originalUSD * 0.99
        : (priceKRW > 0 && refundedKRW < Math.round(priceKRW * 0.99));

      const updates = {
        status: isPartialRefund ? 'PARTIALLY_REFUNDED' : 'REFUNDED',
        refundedKRW,
        refundReason: 'PayPal webhook auto-refund',
        refundedAt: FieldValue.serverTimestamp(),
        refundedBySource: 'webhook',
        updatedAt: FieldValue.serverTimestamp(),
      };

      // pending_bookings 업데이트 (없을 수도 있음 — bookings only 케이스)
      try {
        await adminDb.collection('pending_bookings').doc(bookingRef).update(updates);
      } catch (e) {
        console.warn('[paypal-webhook] pending_bookings update skipped:', e.message);
      }
      // bookings doc 업데이트 — PR #438: use the actual doc ID we matched on
      // (captureId for legacy shape, orderID for PayPal-direct). Skip when we
      // matched via pending_bookings only (no bookings mirror exists yet).
      if (bookingsDocId) {
        try {
          await adminDb.collection('bookings').doc(bookingsDocId).set(updates, { merge: true });
        } catch (e) {
          console.warn('[paypal-webhook] bookings update failed:', e.message);
        }
      }

      await logWebhookEvent({
        db: adminDb, eventId, eventType,
        status: 'processed',
        detail: { bookingRef, captureId, refundedUSD, refundedKRW },
      });

      const telText = [
        '💸 <b>환불 자동 처리 (PayPal Webhook)</b>',
        '',
        `<b>예약번호:</b> <code>${bookingRef}</code>`,
        `<b>환불액:</b> $${refundedUSD} (≈ ₩${refundedKRW.toLocaleString('ko-KR')})`,
        `<b>Capture:</b> <code>${captureId}</code>`,
      ].join('\n');
      notify('booking', telText).catch(() => {});

      res.writeHead(200, JSON_HEADERS);
      return res.end(JSON.stringify({ ok: true, status: 'refunded', bookingRef }));
    }

    // ─── PAYMENT.REFUND.FAILED / PAYMENT.REFUND.PENDING ─────────────
    // 🔴 F4 (2026-07-16): 이전엔 이 두 이벤트에 핸들러가 없어 'unsupported' 로 폐기 + 200 ack 로
    //   PayPal 재시도까지 차단됐다. PENDING 환불(eCheck)이 FAILED 로 뒤집혀도 DB 는 CANCELED/REFUNDED
    //   그대로 = 고객은 "환불됨" 메일을 받았는데 돈은 안 감(미환불 은폐). 성공(CAPTURE.REFUNDED)만
    //   처리되고 실패만 버려지는 비대칭이 핵심이었다.
    //   ⚠️ PAYMENT.REFUND.COMPLETED 는 존재하지 않는다 — 완료는 PAYMENT.CAPTURE.REFUNDED 로 온다.
    //   🔑 운영자: PayPal Developer Dashboard → Webhooks 에 두 이벤트 구독을 추가해야 실제로 도착한다.
    if (eventType === 'PAYMENT.REFUND.FAILED' || eventType === 'PAYMENT.REFUND.PENDING') {
      const refundId = event?.resource?.id || null;
      const captureId = extractRefundedCaptureId(event); // refund 이벤트도 links.up 이 capture 를 가리킴
      const isFailed = eventType === 'PAYMENT.REFUND.FAILED';

      // 매칭 1순위 = refundID (cancelBooking·admin 이 저장, 환불 1건당 유일 → 형제 모호성 없음).
      let matched = null;
      if (refundId) {
        const byRefund = await adminDb.collection('bookings').where('refundID', '==', refundId).get();
        if (byRefund.size === 1) matched = byRefund.docs[0];
      }
      // 폴백 = captureID. cart 형제가 공유하므로 F6 과 동일한 모호성 가드.
      if (!matched && captureId) {
        const byCapture = await adminDb.collection('bookings').where('captureID', '==', captureId).get();
        if (byCapture.size > 1) {
          await logWebhookEvent({
            db: adminDb, eventId, eventType,
            status: 'ambiguous',
            detail: { reason: 'captureID_shared_by_cart_siblings', refundId, captureId, candidates: byCapture.docs.map((d) => d.id) },
          });
          await alertAdmin(`⚠️ <b>환불 ${isFailed ? '실패' : 'PENDING'} webhook — cart 형제 공유로 특정 불가</b>\n\nRefund: <code>${refundId}</code>\nCapture: <code>${captureId}</code>\n→ 수동 확인 필요`);
          res.writeHead(200, JSON_HEADERS);
          return res.end(JSON.stringify({ ok: true, status: 'ambiguous' }));
        }
        if (byCapture.size === 1) matched = byCapture.docs[0];
      }

      if (!matched) {
        await logWebhookEvent({
          db: adminDb, eventId, eventType,
          status: 'unmatched',
          detail: { reason: 'refund_not_in_bookings', refundId, captureId },
        });
        // FAILED 는 돈 문제 — 매칭 실패도 조용히 버리지 않는다.
        if (isFailed) await alertAdmin(`🚨 <b>환불 실패 webhook — booking 미매칭</b>\n\nRefund: <code>${refundId}</code>\nCapture: <code>${captureId}</code>\n→ PayPal 거래내역에서 수동 대조 필요`);
        res.writeHead(200, JSON_HEADERS);
        return res.end(JSON.stringify({ ok: true, status: 'unmatched' }));
      }

      if (!isFailed) {
        // PENDING = 관측 기록만. 종단 status 는 건드리지 않는다 (정상 eCheck 흐름일 수 있음 —
        //   완료되면 PAYMENT.CAPTURE.REFUNDED 가 온다).
        try {
          await adminDb.collection('bookings').doc(matched.id).set({
            refundStatus: 'PENDING', updatedAt: FieldValue.serverTimestamp(),
          }, { merge: true });
        } catch (e) { console.warn('[paypal-webhook] refund-pending mark failed:', e.message); }
        await logWebhookEvent({
          db: adminDb, eventId, eventType,
          status: 'processed',
          detail: { bookingsDocId: matched.id, refundId, captureId, refundStatus: 'PENDING' },
        });
        res.writeHead(200, JSON_HEADERS);
        return res.end(JSON.stringify({ ok: true, status: 'refund_pending_recorded' }));
      }

      // FAILED — 돈이 고객에게 안 갔다. 종단 상태를 되돌려 은폐를 끊고 운영자를 부른다.
      //   자동 재환불은 하지 않는다(운영자가 원인 확인 후 수동 — 재시도 폭주 방지).
      const failUpdates = {
        status: 'REFUND_FAILED',
        refundStatus: 'FAILED',
        refundFailedAt: FieldValue.serverTimestamp(),
        refundFailedSource: 'webhook',
        updatedAt: FieldValue.serverTimestamp(),
      };
      try {
        await adminDb.collection('bookings').doc(matched.id).set(failUpdates, { merge: true });
      } catch (e) { console.warn('[paypal-webhook] refund-failed mark failed:', e.message); }
      // admin mark-refunded 경로는 pending_bookings 에도 REFUNDED 를 썼다 — best-effort 동기화.
      const failBookingRef = matched.data().bookingRef || matched.id;
      try {
        await adminDb.collection('pending_bookings').doc(failBookingRef).update(failUpdates);
      } catch (e) { console.warn('[paypal-webhook] pending_bookings refund-failed sync skipped:', e.message); }

      await logWebhookEvent({
        db: adminDb, eventId, eventType,
        status: 'processed',
        detail: { bookingsDocId: matched.id, bookingRef: failBookingRef, refundId, captureId },
      });
      await alertAdmin([
        '🚨 <b>환불 실패 (PayPal Webhook) — 고객에게 돈이 안 갔음</b>',
        '',
        `<b>예약번호:</b> <code>${failBookingRef}</code>`,
        `<b>Refund:</b> <code>${refundId}</code>`,
        `<b>Capture:</b> <code>${captureId}</code>`,
        '→ status=REFUND_FAILED 로 전환됨. PayPal 에서 원인 확인 후 수동 재환불 필요',
      ].join('\n'));

      res.writeHead(200, JSON_HEADERS);
      return res.end(JSON.stringify({ ok: true, status: 'refund_failed', bookingRef: failBookingRef }));
    }

    // ─── 그 외 이벤트 ────────────────────────────────────────────────
    await logWebhookEvent({
      db: adminDb, eventId, eventType,
      status: 'unsupported',
      detail: { resource_type: event?.resource_type },
    });
    res.writeHead(200, JSON_HEADERS);
    return res.end(JSON.stringify({ ok: true, status: 'unsupported', eventType }));
  } catch (err) {
    console.error('[paypal-webhook] failed:', err.message, err.stack);
    await captureError(err, { route: '/api/paypal-webhook', eventId });
    // 500 응답 → PayPal 재시도. 단, 같은 eventId 면 위 멱등 체크가 차단.
    res.writeHead(500, JSON_HEADERS);
    return res.end(JSON.stringify({ ok: false, error: err.message || 'internal error' }));
  }
}
