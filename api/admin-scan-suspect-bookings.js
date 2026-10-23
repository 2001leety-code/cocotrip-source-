/**
 * Vercel API Route: Admin Scan Suspect Bookings
 * GET  /api/admin-scan-suspect-bookings  (list only)
 * POST /api/admin-scan-suspect-bookings  (list + batch replay if dryRun=false)
 * Headers: Authorization: Bearer <Firebase-ID-token>
 *
 * 2026-05-04 ~ 2026-05-07: 알림 누락 booking 일괄 복구 도구. 원래 PR #221~PR #223
 * 사이 (Braintree 통합 시점) booking-processor 호출이 ReferenceError 로 죽어 Firestore
 * 에는 booking 이 저장됐지만 텔레그램·이메일·Sheets 알림이 빠진 booking 을 식별하기 위해
 * 도입. 2026-05-07 Braintree 제거 후에도 PayPal capture 직후 booking-processor 호출이
 * fire-and-forget 이라 동일 패턴 (네트워크 장애 등) 의 누락 가능성이 있어 유지.
 *
 * GET  → 후보 목록만 반환 (dryRun)
 * POST → 후보 목록 + Optional 일괄 replay (body.dryRun=false 일 때만 실 발송)
 *
 * Body (POST):
 *   {
 *     since?:  ISO 8601 (default: 2026-05-03T11:51:00Z = PR #221 머지 시점)
 *     until?:  ISO 8601 (default: now)
 *     provider?: 'paypal' | 'braintree' | null (default: null = 모든 provider)
 *     dryRun?: boolean (default: true) — true 면 list 만, false 면 booking-processor 재호출
 *     limit?:  number (default: 50, max 100)
 *   }
 *
 * 멱등성 주의: 같은 booking 을 두 번 replay 하면 텔레그램·이메일·Sheets 모두 중복.
 * dryRun=false 신중히 사용. 한 번 replay 한 booking 은 Firestore booking doc 의
 * `replayedAt` 필드로 표시 → 다음 호출 시 자동 skip.
 *
 * 2026-10-23 (PR-4): 후보 판정 = booking-notification-state.js(예약 마커 + 재시도 문서 stepStatus).
 *   이전엔 replayedAt 없는 CONFIRMED 를 **전부** 후보로 잡아 정상 원발송 예약까지 일괄 재전송 대상이었다.
 *   후보 = failed(확실히 안 끝났고 재실행 안전) + unknown(결과 미상·근거 없음 — 수신 확인 필요).
 *   일괄 재전송은 failed 만, unknown 은 skippedUnknown 으로 돌려준다. 실제 호출 직전 최신 문서로 다시 판정한다.
 *   정산 필요(requiresReconciliation·추정가 상품)는 알림 상태와 무관하게 `reconciliation` 으로 따로 돌려준다.
 */
import { verifyAdminToken } from './_shared/admin-auth.js';
import { initAdminDb } from './_shared/firebase-admin.js';
import { internalApiBase, vercelBypassHeaders } from './_shared/internal-base-url.js';
import { outcomeFromResponseBody, isSemanticallyDone, OUTCOME } from './_shared/processor-outcome.js';
import { FieldValue } from 'firebase-admin/firestore';
import { productDisplayLabel, isCustomEstimateProduct } from './_shared/pricing.js';
import { captureError } from './_shared/sentry.js';
import { buildAdminCors, buildAdminJsonCors } from './_shared/cors.js';
import { classifyBookingNotificationState } from './_shared/booking-notification-state.js';
import { PENDING_PROCESSOR_RETRIES_COLLECTION } from './_shared/booking-processor-trigger.js';

export const maxDuration = 60;

/** 재시도 문서(정상 생략·결과 미상 근거). 조회 실패 = 근거 없음(null) — 그 자체로 실패로 보지 않는다. */
async function readRetryDoc(db, bookingId) {
  try {
    const snap = await db.collection(PENDING_PROCESSOR_RETRIES_COLLECTION).doc(bookingId).get();
    return snap.exists ? (snap.data() || null) : null;
  } catch (e) {
    console.warn('[admin-scan-suspect-bookings] retry doc lookup failed (treated as no evidence):', bookingId, e.message);
    return null;
  }
}
export const config = { runtime: 'nodejs' };

// PR #437 (W-H11): origin allowlist via buildAdminCors — was wildcard '*'.
const CORS_METHODS = 'GET, POST, OPTIONS';

function json(req, res, status, body) {
  res.writeHead(status, buildAdminJsonCors(req, { methods: CORS_METHODS }));
  return res.end(JSON.stringify(body));
}

const _ok  = (data) => ({ ok: true, data });
const _err = (msg, code = 'UNKNOWN_ERROR') => ({ ok: false, error: msg, code });

// PR #221 머지 시점 (UTC) — 이전 booking 은 다른 buggy state 일 수도 있어 별도 처리.
const DEFAULT_SINCE = '2026-05-03T11:51:00Z';

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') { res.writeHead(200, buildAdminCors(req, { methods: CORS_METHODS })); return res.end(); }
  if (req.method !== 'GET' && req.method !== 'POST') {
    return json(req, res, 405, _err('Method Not Allowed', 'METHOD_NOT_ALLOWED'));
  }

  const tokenAuth = await verifyAdminToken(req);
  if (!tokenAuth.ok) {
    return json(req, res, tokenAuth.status, _err(tokenAuth.error, 'AUTH_FAILED'));
  }

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
  body = body || {};

  // GET 은 항상 dryRun. POST 만 dryRun=false 가능.
  const dryRun = req.method === 'GET' ? true : (body.dryRun !== false);
  const since = new Date(body.since || DEFAULT_SINCE);
  const until = new Date(body.until || Date.now());
  // 2026-05-07: Braintree 제거 후 default = null (모든 provider 검색).
  // 호출자가 명시적으로 'paypal' / 'braintree' (legacy) 지정 가능.
  const provider = body.provider !== undefined ? body.provider : null;
  const limit = Math.min(100, Math.max(1, Number(body.limit) || 50));

  if (Number.isNaN(since.getTime()) || Number.isNaN(until.getTime())) {
    return json(req, res, 400, _err('Invalid since/until ISO date', 'INVALID_DATE'));
  }

  try {
    const db = initAdminDb('admin-scan-suspect-bookings');
    if (!db) {
      return json(req, res, 500, _err('Firestore unavailable — check FIREBASE_* env vars', 'DB_UNAVAILABLE'));
    }

    // 조회: createdAt in [since, until] + status=CONFIRMED + (provider 일치 시).
    // 후보 판정은 classifyBookingNotificationState — 정상 완료·24h 이내 처리 중·테스트·replayedAt 은 제외.
    let query = db.collection('bookings')
      .where('createdAt', '>=', since)
      .where('createdAt', '<=', until)
      .where('status', '==', 'CONFIRMED')
      .orderBy('createdAt', 'desc')
      .limit(limit);

    if (provider) {
      query = query.where('provider', '==', provider);
    }

    const snap = await query.get();
    const docs = [];
    snap.forEach((doc) => docs.push({ id: doc.id, data: doc.data() || {} }));
    const retryDocs = await Promise.all(docs.map((x) => readRetryDoc(db, x.id)));
    const nowMs = Date.now();
    const candidates = [];
    const reconciliation = [];
    const excluded = { complete: 0, pending: 0, test: 0 };
    docs.forEach(({ id, data: d }, idx) => {
      const verdict = classifyBookingNotificationState(d, nowMs, id, retryDocs[idx]);
      const row = {
        state: verdict.state,
        missingSteps: verdict.missingSteps,
        lastFailureReason: verdict.lastFailureReason,
        telegram: verdict.telegram,
        bookingId: id,
        bookingRef: d.bookingRef || null,
        productType: d.productType || null,
        productLabel: productDisplayLabel(d.productType),
        amountKRW: d.amountKRW || null,
        amountUSD: d.amountUSD || null,
        userEmail: d.userEmail || null,
        tourDate: d.tourDate || null,
        provider: d.provider || null,
        captureID: d.captureID || null,
        createdAt: d.createdAt?.toDate?.()?.toISOString?.() || null,
        requiresReconciliation: !!d.requiresReconciliation || isCustomEstimateProduct(d.productType),
      };
      // 정산 필요 여부는 알림 상태와 독립 — 알림이 정상이어도 정산 목록에서 빠지면 안 된다(테스트 결제만 제외).
      if (row.requiresReconciliation && verdict.state !== 'test') reconciliation.push(row);
      if (verdict.state !== 'failed' && verdict.state !== 'unknown') { excluded[verdict.state] += 1; return; }
      candidates.push(row);
    });

    const failedCandidates = candidates.filter((c) => c.state === 'failed');
    const unknownCandidates = candidates.filter((c) => c.state === 'unknown');
    const summary = {
      scanned: snap.size,
      candidatesCount: candidates.length,
      failedCount: failedCandidates.length,
      unknownCount: unknownCandidates.length,
      excludedComplete: excluded.complete,
      excludedPending: excluded.pending,
      excludedTest: excluded.test,
      reconciliation,
      rangeSince: since.toISOString(),
      rangeUntil: until.toISOString(),
    };

    if (dryRun) {
      // "범위 안 전체 정상" 이라고 단정하지 않는다 — 기간·CONFIRMED·provider 로 최신순 limit 건을 가져온 **뒤** 거른 결과다.
      const hint = candidates.length > 0
        ? `조회 ${snap.size}건 중 후보 ${candidates.length}건(실패 ${failedCandidates.length} · 결과 미상 ${unknownCandidates.length}). 일괄 재전송은 실패 건의 미완료 단계 재처리만 — POST { "dryRun": false }. 결과 미상은 고객 수신 확인 필요.`
        : `조회 ${snap.size}건 중 재전송 후보 0건${snap.size >= limit ? ` — 조회 한도 ${limit}건에 닿았습니다. since/until 로 기간을 나눠 다시 확인하세요.` : ''}`;
      return json(req, res, 200, _ok({ mode: 'dryRun', ...summary, candidates, hint }));
    }

    // 실제 replay — failed 만, booking-processor 를 sequence 로 호출 (Telegram rate limit 회피).
    //   unknown 은 다시 보내면 손님에게 두 번 갈 수 있다 → 건너뛰고 목록만 돌려준다.
    const siteUrl = internalApiBase();
    const results = [];
    for (const [i, c] of failedCandidates.entries()) {
      const docRef = db.collection('bookings').doc(c.bookingId);
      const fresh = await docRef.get();
      if (!fresh.exists) { results.push({ bookingId: c.bookingId, ok: false, error: 'NOT_FOUND' }); continue; }
      const b = fresh.data();
      if (b.replayedAt) { results.push({ bookingId: c.bookingId, ok: false, error: 'ALREADY_REPLAYED' }); continue; }
      // 스캔 뒤 다른 실행(재시도 큐 등)이 처리했을 수 있다 — 최신 예약·재시도 문서로 다시 판정.
      const freshState = classifyBookingNotificationState(b, Date.now(), c.bookingId, await readRetryDoc(db, c.bookingId)).state;
      if (freshState !== 'failed') { results.push({ bookingId: c.bookingId, ok: false, error: `STATE_${freshState.toUpperCase()}` }); continue; }

      const payload = {
      // 🔴 2026-07-29 (영구 주문 ID): 이전엔 `booking.captureID || <doc id>` 였다.
      //   최초 결제 때 booking-processor 가 받은 orderID 는 **문서 ID** 다
      //   (PayPal-direct = orderID, cart 자식 = orderID__lineId, 레거시 = captureId).
      //   재처리에서 captureID 를 orderID 자리에 넣으면 키가 통째로 바뀌어
      //     · 멱등 마커를 엉뚱한 문서(bookings/{captureID})에서 찾고
      //     · 적립 원장 문서 ID 가 달라져 **이중 적립**
      //     · 시트 중복 확인 키(N열)가 어긋나 **행이 하나 더**
      //   생긴다. 그래서 문서 ID 를 그대로 쓰고, captureID 는 captureId 로만 넘긴다.
        orderID: c.bookingId,
        captureId: b.captureID || null,
        payerEmail: b.userEmail || '',
        payerName: b.payerName || (b.userEmail || '').split('@')[0],
        amount: String(b.amountUSD || '0'),
        product: productDisplayLabel(b.productType),
        tourDate: b.tourDate || '',
        pickupLocation: b.pickupLocation || '',
        dropoffLocation: b.dropoffLocation || '',
        paxCount: b.paxCount || 1,
        vehicleType: b.vehicleType || '',
        customerPhone: b.customerPhone || undefined,
        couponApplied: !!b.couponDocId,
        memo: b.memo || '',
        itineraryData: b.itineraryData || null,
        airport: b.airport || null,
        userEmail: b.userEmail || '',
        bookingRef: b.bookingRef || undefined,
        requiresReconciliation: !!b.requiresReconciliation || isCustomEstimateProduct(b.productType),
      };

      try {
        const procRes = await fetch(`${siteUrl}/api/booking-processor`, {
          method: 'POST',
          headers: {
          'Content-Type': 'application/json',
          // booking-processor 는 내부 전용(2026-07-29 인증 게이트) — 서비스 토큰 동봉 필수.
          'x-internal-token': (process.env.INTERNAL_API_TOKEN || '').trim(),
          ...vercelBypassHeaders(),
        },
          body: JSON.stringify(payload),
        });
        const procJson = await procRes.json().catch(() => null);
        // 🔴 2026-07-29 (의미상 성공 계약): HTTP 200 을 완료로 보면 안 된다.
        //   booking-processor 는 내부 단계가 실패해도 200 을 준다. replayedAt 을 찍으면
        //   이 예약은 다시는 재처리 대상이 되지 않는다 — 시트도 메일도 적립도 없는 채로.
        const outcome = procRes.ok ? outcomeFromResponseBody(procJson) : OUTCOME.RETRYABLE;
        const done = isSemanticallyDone(outcome);
        if (done) {
          await docRef.update({
            replayedAt: FieldValue.serverTimestamp(),
            replayedBy: tokenAuth.email || 'admin',
            replayOutcome: outcome,
          });
        }
        results.push({
          bookingId: c.bookingId,
          ok: done,
          outcome,
          status: procRes.status,
          steps: procJson?.data?.steps || null,
          stepStatus: procJson?.data?.stepStatus || null,
        });
      } catch (err) {
        results.push({ bookingId: c.bookingId, ok: false, error: err.message });
      }

      // Telegram bot rate limit (~30 msg/sec) + Sheets API 안정 — 1초 간격(마지막 건 뒤엔 기다리지 않는다)
      if (i < failedCandidates.length - 1) await new Promise((r) => setTimeout(r, 1000));
    }

    return json(req, res, 200, _ok({
      mode: 'replay',
      ...summary,
      replayed: results.filter((r) => r.ok).length,
      failed:   results.filter((r) => !r.ok).length,
      results,
      skippedUnknown: unknownCandidates.map((c) => c.bookingId),
    }));
  } catch (err) {
    console.error('[admin-scan-suspect-bookings]', err);
    await captureError(err, { route: '/api/admin-scan-suspect-bookings', method: req.method });
    return json(req, res, 500, _err(err.message, 'INTERNAL_ERROR'));
  }
}
