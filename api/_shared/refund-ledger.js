/**
 * 환불 원장 — 웹훅 환불 처리를 **하나의 transaction** 으로 묶는다 (2026-07-29).
 *
 * 🔴 이전 구조가 깨지는 지점 (전부 실측 가능한 시나리오):
 *   1. paypal_webhook_log 확인 → 예약 갱신 → log 기록 이 **따로따로** 였다.
 *      예약을 갱신하고 log 기록 전에 죽으면, 재전송 때 **또 더한다**.
 *   2. 서로 다른 부분환불 2건이 동시에 오면 둘 다 같은 prior 를 읽는다.
 *      $5 + $4.90 → 누계가 $9.90 이 아니라 $5 또는 $4.90 으로 남는다(갱신 유실).
 *   3. pending_bookings 는 성공하고 bookings 는 실패해도 processed 로 기록됐다.
 *      두 저장소가 영원히 어긋난다.
 *   4. 같은 환불(refundId)이 다른 eventId 로 재전송되면 이벤트 멱등이 안 걸려 **두 번 누적**.
 *   5. 전액 환불(REFUNDED) 뒤에 작은 부분환불 이벤트가 늦게 도착하면
 *      상태가 PARTIALLY_REFUNDED 로 **내려갔다**.
 *
 * 해결: 읽기(로그·예약·대기예약) → 판정 → 쓰기(예약 2벌 + 로그 processed) 를
 *   **같은 transaction** 안에서 끝낸다. 하나라도 실패하면 아무것도 안 남고 재시도 가능.
 *   Firestore 는 읽은 문서가 커밋 전에 바뀌면 transaction 을 재실행하므로,
 *   동시 부분환불 2건은 재실행되며 최신 누계를 다시 읽는다.
 *
 * ⚠️ 네트워크 호출(PayPal 조회·텔레그램)은 transaction 밖에서 한다.
 *    transaction 함수는 재실행될 수 있어 부작용을 넣으면 안 된다.
 */

/** 다른 실행이 처리 중인 이벤트로 보는 시간. 서버리스 최대 실행시간보다 넉넉히. */
export const REFUND_EVENT_IN_FLIGHT_MS = 2 * 60 * 1000;

/** 전액으로 보는 하한 (수수료·환율 잔돈 흡수). */
export const FULL_REFUND_RATIO = 0.99;

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

/** 상태 서열 — 뒤늦게 온 작은 이벤트가 전액환불을 되돌리지 못하게 한다. */
const STATUS_RANK = { REFUNDED: 3, PARTIALLY_REFUNDED: 2 };
const rankOf = (s) => STATUS_RANK[s] || 0;

/**
 * 이번 환불 뒤의 예약 상태를 정한다. **절대 내려가지 않는다.**
 *
 * 우선순위:
 *   1. PayPal 이 알려준 capture 상태 (권위) — 있으면 그것이 진실이다.
 *   2. 누적 환불 USD vs 원결제 USD
 *   3. (레거시: 원결제 USD 를 모르는 옛 문서) KRW 비교
 */
export function decideRefundStatus({
  priorStatus,
  cumulativeRefundedUSD,
  originalUSD,
  priceKRW,
  cumulativeRefundedKRW,
  authoritativeCaptureStatus,
} = {}) {
  let next;
  const auth = String(authoritativeCaptureStatus || '').toUpperCase();
  if (auth === 'REFUNDED') {
    next = 'REFUNDED';
  } else if (auth === 'PARTIALLY_REFUNDED') {
    next = 'PARTIALLY_REFUNDED';
  } else if (Number(originalUSD) > 0) {
    next = round2(cumulativeRefundedUSD) < Number(originalUSD) * FULL_REFUND_RATIO
      ? 'PARTIALLY_REFUNDED'
      : 'REFUNDED';
  } else if (Number(priceKRW) > 0) {
    next = Number(cumulativeRefundedKRW) < Math.round(Number(priceKRW) * FULL_REFUND_RATIO)
      ? 'PARTIALLY_REFUNDED'
      : 'REFUNDED';
  } else {
    // 원결제 금액을 아예 모르는 문서 — 부분으로 두고 운영자가 확인하게 한다(전액 단정 금지).
    next = 'PARTIALLY_REFUNDED';
  }
  return rankOf(next) >= rankOf(priorStatus) ? next : priorStatus;
}

/**
 * 두 저장소의 상태 중 **서열이 높은 쪽**을 이전 상태로 본다.
 *
 * 🔴 bookings 우선으로 고르면 안 된다: pending_bookings 만 REFUNDED 로 갱신된 레거시 문서에서
 *   bookings 의 PARTIALLY_REFUNDED(또는 CONFIRMED)를 기준 삼으면, 이미 전액 환불된 예약이
 *   늦은 부분환불 이벤트 한 방에 **부분환불로 되돌아간다**. 단조성은 두 문서를 함께 봐야 성립한다.
 */
export function higherStatus(a, b) {
  return rankOf(a) >= rankOf(b) ? (a || b || null) : (b || null);
}

/**
 * 이 환불 웹훅이 이 예약 문서를 건드려도 되는 환경인가?
 *
 * 🔴 샌드박스(가짜 돈) 웹훅이 운영 예약을 환불처리하거나, 라이브 웹훅이 샌드박스 예약을
 *   건드리는 것을 막는다. 환경이 어긋나면 **데이터를 갱신하지 않고 격리**한다.
 *   환경 표시가 없는 레거시 문서는 live 웹훅만 허용한다(sandbox 는 확실할 때만 쓴다).
 *
 * @returns {{ok: true} | {ok: false, bookingEnvironment: string|null}}
 */
export function checkEnvironmentMatch(docEnv, webhookEnv) {
  return checkEnvironmentsMatch([docEnv], webhookEnv);
}

/**
 * 여러 저장소(bookings + pending_bookings)의 환경을 **함께** 본다.
 *
 * 🔴 한쪽만 골라서 비교하면 안 된다: bookings 는 sandbox 인데 pending 은 live 인 경우
 *   어느 쪽을 고르냐에 따라 통과/격리가 갈린다. 값이 있는 것은 **전부** 일치해야 한다.
 *
 * 규칙:
 *   · 환경값이 하나라도 있으면 → 그 값들이 전부 웹훅 환경과 같아야 한다.
 *   · 환경값이 하나도 없으면(레거시) → live 웹훅만 허용한다.
 *   · verifiedEnvironment 가 'unverified' 면 어떤 문서도 건드리지 않는다.
 */
export function checkEnvironmentsMatch(docEnvs, webhookEnv) {
  const hook = String(webhookEnv || '').toLowerCase();
  if (hook !== 'live' && hook !== 'sandbox') {
    return { ok: false, bookingEnvironment: null, webhookEnvironment: hook || 'unverified' };
  }
  const known = (docEnvs || [])
    .filter((e) => e !== null && e !== undefined && e !== '')
    .map((e) => String(e).toLowerCase());

  if (known.length === 0) {
    // 환경 표시 이전에 만들어진 예약 — sandbox 웹훅이 건드리게 두지 않는다.
    return hook === 'live'
      ? { ok: true }
      : { ok: false, bookingEnvironment: null, webhookEnvironment: hook };
  }
  const mismatch = known.find((e) => e !== hook);
  if (mismatch) return { ok: false, bookingEnvironment: mismatch, webhookEnvironment: hook };
  return { ok: true };
}

/** 이미 기록된 환불 이벤트인지 — refundId 기준(이벤트 재전송·eventId 변경에 견딘다). */
function alreadyCounted(ledgerData, refundId) {
  if (!refundId) return false;
  const map = (ledgerData && ledgerData.refundEvents) || {};
  return Boolean(map[refundId]);
}

/**
 * 환불 이벤트 1건을 원자적으로 반영한다.
 *
 * @returns {Promise<{applied: boolean, reason?: string, status?: string,
 *                    cumulativeRefundedUSD?: number, wroteBooking?: boolean, wrotePending?: boolean}>}
 */
export async function applyRefundEvent({
  db,
  FieldValue,
  eventId,
  eventType,
  refundId,
  captureId,
  refundedUSD,
  refundedKRW,
  usdToKrw,
  bookingsDocId,
  bookingRef,
  authoritativeCaptureStatus,
  webhookEnvironment,
  nowMs,
}) {
  if (!db) throw new Error('refund-ledger: db required');
  if (!eventId) throw new Error('refund-ledger: eventId required');

  const now = Number(nowMs) || Date.now();
  const logRef = db.collection('paypal_webhook_log').doc(eventId);
  const bookingDocRef = bookingsDocId ? db.collection('bookings').doc(bookingsDocId) : null;
  const pendingDocRef = bookingRef ? db.collection('pending_bookings').doc(bookingRef) : null;

  return db.runTransaction(async (tx) => {
    // ── 읽기 (Firestore 규칙: 쓰기 전에 읽기를 전부 끝내야 한다) ──
    const logSnap = await tx.get(logRef);
    const logData = logSnap.exists ? logSnap.data() : null;

    if (logData && logData.status === 'processed') {
      return { applied: false, reason: 'duplicate_event' };
    }
    if (logData && logData.status === 'in_progress') {
      const claimedAt = Number(logData.claimedAtMs) || 0;
      if (claimedAt && now - claimedAt < REFUND_EVENT_IN_FLIGHT_MS) {
        return { applied: false, reason: 'in_flight' };
      }
    }

    const bookingSnap = bookingDocRef ? await tx.get(bookingDocRef) : null;
    const pendingSnap = pendingDocRef ? await tx.get(pendingDocRef) : null;
    const bookingData = bookingSnap && bookingSnap.exists ? bookingSnap.data() : null;
    const pendingData = pendingSnap && pendingSnap.exists ? pendingSnap.data() : null;

    if (!bookingData && !pendingData) {
      // 갱신할 문서가 없다 → processed 로 못 박지 않는다(나중에 문서가 생기면 재처리 가능).
      return { applied: false, reason: 'unmatched' };
    }

    // 🔴 환경 교차 차단 — 샌드박스 웹훅이 운영 예약을(또는 그 반대) 건드리지 못한다.
    //   갱신은 전혀 하지 않고 이벤트만 격리 기록한다(운영자 확인 대상).
    // 두 저장소의 환경을 **함께** 본다. 한쪽만 골라 비교하면 어느 쪽을 고르냐로 판정이 갈린다.
    const envMatch = checkEnvironmentsMatch([
      bookingData && bookingData.paypalEnvironment,
      pendingData && pendingData.paypalEnvironment,
    ], webhookEnvironment);
    if (!envMatch.ok) {
      tx.set(logRef, {
        eventId,
        eventType: eventType || 'unknown',
        status: 'environment_mismatch',
        paypalEnvironment: String(webhookEnvironment || 'live').toLowerCase(),
        detail: {
          reason: 'webhook_environment_differs_from_booking',
          bookingEnvironment: envMatch.bookingEnvironment,
          captureId: captureId || null,
          refundId: refundId || null,
        },
        receivedAtMs: now,
      }, { merge: true });
      return {
        applied: false,
        reason: 'environment_mismatch',
        bookingEnvironment: envMatch.bookingEnvironment,
      };
    }

    // 같은 환불이 다른 eventId 로 재전송된 경우 — 두 저장소 어느 쪽에든 기록이 있으면 중복.
    if (alreadyCounted(bookingData, refundId) || alreadyCounted(pendingData, refundId)) {
      tx.set(logRef, {
        eventId,
        eventType: eventType || 'unknown',
        status: 'processed',
        paypalEnvironment: String(webhookEnvironment || 'live').toLowerCase(),
        detail: { reason: 'duplicate_refund_id', refundId: refundId || null, captureId: captureId || null },
        receivedAtMs: now,
      }, { merge: true });
      return { applied: false, reason: 'duplicate_refund' };
    }

    // 두 저장소가 어긋나 있으면(레거시) 큰 쪽을 진실로 본다 — 이미 돌려준 돈을 잊지 않는다.
    const priorUSD = Math.max(
      Number(bookingData && bookingData.refundedUSDTotal) || 0,
      Number(pendingData && pendingData.refundedUSDTotal) || 0,
    );
    const priorKRWTotal = Math.max(
      Number(bookingData && bookingData.refundedKRWTotal) || 0,
      Number(pendingData && pendingData.refundedKRWTotal) || 0,
    );
    // 🔴 bookings 우선이 아니라 **서열이 높은 쪽**. 한쪽만 REFUNDED 로 갱신된 레거시 문서에서
    //   낮은 쪽을 기준 삼으면 전액 환불이 늦은 부분환불 한 방에 되돌아간다.
    const priorStatus = higherStatus(
      bookingData && bookingData.status,
      pendingData && pendingData.status,
    );

    const thisUSD = round2(refundedUSD);
    const thisKRW = Number(refundedKRW) || 0;
    const cumulativeRefundedUSD = round2(priorUSD + thisUSD);
    const cumulativeRefundedKRW = priorKRWTotal + thisKRW;

    const originalUSD = Number((bookingData && bookingData.amountUSD)
      || (pendingData && pendingData.amountUSD)) || 0;
    const priceKRW = Number((bookingData && bookingData.amountKRW)
      || (pendingData && pendingData.priceKRW)) || 0;

    const status = decideRefundStatus({
      priorStatus,
      cumulativeRefundedUSD,
      originalUSD,
      priceKRW,
      cumulativeRefundedKRW,
      authoritativeCaptureStatus,
    });

    const updates = {
      status,
      refundedUSDTotal: cumulativeRefundedUSD,
      refundedKRWTotal: cumulativeRefundedKRW,
      // 마지막 이벤트 금액(표시용) — 판정 근거는 위 누계다.
      refundedUSD: thisUSD,
      refundedKRW: thisKRW,
      refundReason: 'PayPal webhook auto-refund',
      refundedAt: FieldValue.serverTimestamp(),
      refundedBySource: 'webhook',
      updatedAt: FieldValue.serverTimestamp(),
      lastRefundEventId: eventId,
      lastRefundId: refundId || null,
      lastRefundCaptureId: captureId || null,
      lastRefundEnvironment: String(webhookEnvironment || 'live').toLowerCase(),
    };
    if (usdToKrw) updates.refundExchangeRate = Number(usdToKrw);
    if (refundId) {
      // 환불 1건당 1줄 — 다음 이벤트가 이걸 보고 중복을 거른다.
      updates.refundEvents = {
        [refundId]: { usd: thisUSD, krw: thisKRW, eventId, captureId: captureId || null, atMs: now },
      };
    }

    // ── 쓰기 — 예약 2벌과 로그를 **같은 transaction** 에 넣는다.
    //    한쪽만 갱신된 채 processed 가 되는 상태가 구조적으로 불가능해진다.
    if (bookingData) tx.set(bookingDocRef, updates, { merge: true });
    if (pendingData) tx.set(pendingDocRef, updates, { merge: true });

    tx.set(logRef, {
      eventId,
      eventType: eventType || 'unknown',
      status: 'processed',
      // 어느 PayPal 환경에서 검증된 이벤트인지 — 사후 대사·격리 판정 근거.
      paypalEnvironment: String(webhookEnvironment || 'live').toLowerCase(),
      detail: {
        bookingRef: bookingRef || null,
        bookingsDocId: bookingsDocId || null,
        captureId: captureId || null,
        refundId: refundId || null,
        refundedUSD: thisUSD,
        refundedKRW: thisKRW,
        cumulativeRefundedUSD,
        resultStatus: status,
        authoritativeCaptureStatus: authoritativeCaptureStatus || null,
      },
      receivedAtMs: now,
    }, { merge: true });

    return {
      applied: true,
      status,
      cumulativeRefundedUSD,
      wroteBooking: Boolean(bookingData),
      wrotePending: Boolean(pendingData),
    };
  });
}

/**
 * 환불 PENDING / FAILED 상태 변경을 **하나의 transaction** 으로 반영한다 (2026-07-29).
 *
 * 🔴 이전 구조: bookings 저장 실패를 catch 로 숨기고, pending_bookings 동기화 실패도 숨긴 뒤
 *   paypal_webhook_log 만 processed 로 남겼다. 그 결과
 *     · 돈이 고객에게 안 갔는데(REFUND.FAILED) 예약은 그대로 REFUNDED 로 남고
 *     · processed 가 찍혀 PayPal 재전송도 차단돼 **영구히 은폐**됐다.
 *     · 두 저장소 중 한쪽만 바뀐 상태도 그대로 남았다.
 *
 * 이제 예약 2벌 + processed 기록이 같은 커밋이다. 하나라도 실패하면 아무것도 안 남고
 * 호출부가 5xx 로 응답해 PayPal 이 재전송한다.
 *
 * @returns {Promise<{applied: boolean, reason?: string, bookingRef?: string,
 *                    wroteBooking?: boolean, wrotePending?: boolean}>}
 */
export async function applyRefundStatusEvent({
  db, FieldValue, eventId, eventType, bookingsDocId, bookingRef,
  refundId, captureId, updates, webhookEnvironment, nowMs,
}) {
  if (!db) throw new Error('refund-ledger: db required');
  if (!eventId) throw new Error('refund-ledger: eventId required');
  if (!bookingsDocId) throw new Error('refund-ledger: bookingsDocId required');

  const now = Number(nowMs) || Date.now();
  const logRef = db.collection('paypal_webhook_log').doc(eventId);
  const bookingDocRef = db.collection('bookings').doc(bookingsDocId);
  const pendingDocRef = bookingRef ? db.collection('pending_bookings').doc(bookingRef) : null;

  return db.runTransaction(async (tx) => {
    const logSnap = await tx.get(logRef);
    const logData = logSnap.exists ? logSnap.data() : null;
    if (logData && logData.status === 'processed') {
      return { applied: false, reason: 'duplicate_event' };
    }

    const bookingSnap = await tx.get(bookingDocRef);
    if (!bookingSnap.exists) {
      return { applied: false, reason: 'unmatched' };
    }
    const pendingSnap = pendingDocRef ? await tx.get(pendingDocRef) : null;
    const pendingData = pendingSnap && pendingSnap.exists ? pendingSnap.data() : null;

    // 환경 검사는 호출부(guardWebhookEnvironment)에서 이미 했지만, transaction 안에서
    // 한 번 더 본다 — 그 사이 문서가 바뀌었을 수 있고, 여기가 마지막 관문이다.
    const envMatch = checkEnvironmentsMatch([
      (bookingSnap.data() || {}).paypalEnvironment,
      pendingData && pendingData.paypalEnvironment,
    ], webhookEnvironment);
    if (!envMatch.ok) {
      return { applied: false, reason: 'environment_mismatch', bookingEnvironment: envMatch.bookingEnvironment };
    }

    tx.set(bookingDocRef, updates, { merge: true });
    if (pendingData) tx.set(pendingDocRef, updates, { merge: true });

    tx.set(logRef, {
      eventId,
      eventType: eventType || 'unknown',
      status: 'processed',
      paypalEnvironment: String(webhookEnvironment || 'live').toLowerCase(),
      detail: {
        bookingsDocId, bookingRef: bookingRef || null,
        refundId: refundId || null, captureId: captureId || null,
        refundStatus: updates && updates.refundStatus,
      },
      receivedAtMs: now,
    }, { merge: true });

    return {
      applied: true,
      bookingRef: bookingRef || bookingsDocId,
      wroteBooking: true,
      wrotePending: Boolean(pendingData),
    };
  });
}

/**
 * PayPal 에서 capture 의 **권위 있는** 환불 상태를 읽는다.
 * COMPLETED / PARTIALLY_REFUNDED / REFUNDED.
 *
 * 실패하면 null 을 돌려주고 호출부는 누적 계산으로 판정한다 —
 * PayPal 이 느리다고 환불 기록이 멈추면 안 된다.
 */
export async function fetchAuthoritativeCaptureStatus(captureId, deps = {}) {
  if (!captureId) return null;
  const getToken = deps.getPaypalAccessToken;
  const isSandbox = deps.isSandbox;
  if (typeof getToken !== 'function') return null;
  try {
    const { accessToken, baseUrl } = await getToken(isSandbox);
    const res = await fetch(`${baseUrl}/v2/payments/captures/${encodeURIComponent(captureId)}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return null;
    const body = await res.json();
    const status = String(body && body.status ? body.status : '').toUpperCase();
    return status || null;
  } catch (e) {
    console.warn('[refund-ledger] capture 상태 조회 실패 (누적 계산으로 진행):', e.message);
    return null;
  }
}
