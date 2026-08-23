/**
 * POST /api/mood-settle-correct — 완료된 MOOD 정산 정정 (운영자 전용)
 *
 * 이미 status='completed' 로 확정 정산된 예약을, 나중에 발견된 실사용 근거(예: 누락된
 * 톨비 영수증, 잘못 기록된 실제 시간)로 다시 계산해 최종금액·잔액을 "차액만" 조정한다.
 * 최초 정산(mood-settle.js)과 같은 SSOT(computeMoodTotalKRW + mood-settle-calc 검증)를 쓴다.
 *
 * 🔴 원본 예약(amountKRW/booked) 은 건드리지 않는다 — 이번 정정의 델타는 "직전 finalAmountKRW
 *    대비" 로만 계산해 잔액을 조정한다(초기 정산 이후 여러 번 정정돼도 이중차감/이중환원 없음).
 * 🔴 expectedRevision + idempotencyKey 필수 — 정정 대상 예약이 그 사이 바뀌면 거부하고,
 *    같은 키·같은 요청의 재시도는 저장된 성공 응답을 재생한다. 같은 키에 다른 요청은 거부한다.
 *
 * Body: { bookingId, expectedRevision, reason,
 *         actualHours?, tollMode?, actualTollKRW?, tollEntries?, actualTotalKm?, excludedKm?,
 *         manualAdjustmentKRW? }
 * 생략한 필드는 직전 정산값을 그대로 유지한다. reason 은 항상 필수(정정은 예외 처리라 사유 필수).
 * 경로(출발/도착) 재측정은 정정 범위 밖 — origin/destination/waypoints 를 보내면 400.
 */
import { initAdminDb } from './_shared/firebase-admin.js';
import { verifyUserToken } from './_shared/user-auth.js';
import { captureError } from './_shared/sentry.js';
import { buildAdminJsonCors } from './_shared/cors.js';
import { getMoodAllowlist, isAdminEmail } from './_shared/mood-allowlist.js';
import { MOOD_MAX_DURATION_HOURS } from './_shared/mood-pricing.js';
import { buildSettlementPreviewHash, calculateMoodCorrection, validateActualDistance, normalizeTollEntries } from './_shared/mood-settle-calc.js';
import {
  buildSettlementApprovalSummary,
  buildSettlementIdempotencyDocumentId,
  buildSettlementProposalId,
  countPendingIncludedTolls,
  settlementProposalVersionOf,
} from './_shared/mood-settlement-proposal.js';

export const maxDuration = 15;
export const config = { runtime: 'nodejs' };

const CORS_METHODS = 'POST, OPTIONS';

export default async function handler(req, res) {
  const JSON_HEADERS = { 'Cache-Control': 'no-store', ...buildAdminJsonCors(req, { methods: CORS_METHODS, headers: 'Authorization, Content-Type' }) };

  if (req.method === 'OPTIONS') { res.writeHead(200, JSON_HEADERS); return res.end(); }
  if (req.method !== 'POST') {
    res.writeHead(405, JSON_HEADERS);
    return res.end(JSON.stringify({ ok: false, error: 'POST only' }));
  }

  const auth = await verifyUserToken(req);
  if (!auth.ok) {
    res.writeHead(auth.status, JSON_HEADERS);
    return res.end(JSON.stringify({ ok: false, error: auth.error }));
  }
  if (!auth.emailVerified) {
    res.writeHead(403, JSON_HEADERS);
    return res.end(JSON.stringify({ ok: false, error: '이메일 미검증' }));
  }
  const email = auth.email;

  let body = req.body || {};
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }

  const bookingId = String(body.bookingId || '').trim();
  if (!bookingId) {
    res.writeHead(400, JSON_HEADERS);
    return res.end(JSON.stringify({ ok: false, error: 'bookingId 필수' }));
  }
  const idempotencyKey = typeof body.idempotencyKey === 'string' ? body.idempotencyKey.trim() : '';
  if (idempotencyKey.length < 8 || idempotencyKey.length > 200) {
    res.writeHead(400, JSON_HEADERS);
    return res.end(JSON.stringify({ ok: false, error: 'INVALID_IDEMPOTENCY_KEY' }));
  }
  if (body.expectedRevision === undefined || body.expectedRevision === null) {
    res.writeHead(400, JSON_HEADERS);
    return res.end(JSON.stringify({ ok: false, error: 'EXPECTED_REVISION_REQUIRED' }));
  }
  const expectedRevision = Number(body.expectedRevision);
  if (!Number.isInteger(expectedRevision) || expectedRevision < 0) {
    res.writeHead(400, JSON_HEADERS);
    return res.end(JSON.stringify({ ok: false, error: 'INVALID_EXPECTED_REVISION' }));
  }
  const previewHash = typeof body.previewHash === 'string' ? body.previewHash.trim() : '';
  if (!/^[a-f0-9]{64}$/.test(previewHash)) {
    res.writeHead(400, JSON_HEADERS);
    return res.end(JSON.stringify({ ok: false, error: previewHash ? 'INVALID_PREVIEW_HASH' : 'PREVIEW_REQUIRED' }));
  }
  const reason = String(body.reason || '').trim();
  if (!reason) {
    res.writeHead(400, JSON_HEADERS);
    return res.end(JSON.stringify({ ok: false, error: 'CORRECTION_REASON_REQUIRED' }));
  }
  if (reason.length > 500) {
    res.writeHead(400, JSON_HEADERS);
    return res.end(JSON.stringify({ ok: false, error: 'CORRECTION_REASON_TOO_LONG' }));
  }
  if (body.origin !== undefined || body.destination !== undefined || body.waypoints !== undefined) {
    res.writeHead(400, JSON_HEADERS);
    return res.end(JSON.stringify({ ok: false, error: 'ROUTE_EDIT_NOT_SUPPORTED_IN_CORRECTION' }));
  }

  const hasActualHours = body.actualHours !== undefined && body.actualHours !== null;
  const actualHours = hasActualHours ? Number(body.actualHours) : null;
  if (hasActualHours && (!Number.isFinite(actualHours) || actualHours <= 0 || actualHours > MOOD_MAX_DURATION_HOURS)) {
    res.writeHead(400, JSON_HEADERS);
    return res.end(JSON.stringify({ ok: false, error: `actualHours 는 0 초과 ${MOOD_MAX_DURATION_HOURS} 이하` }));
  }

  const hasTollMode = body.tollMode !== undefined && body.tollMode !== null && body.tollMode !== '';
  const tollMode = hasTollMode ? String(body.tollMode) : null;
  if (hasTollMode && !['estimated', 'none', 'actual', 'itemized'].includes(tollMode)) {
    res.writeHead(400, JSON_HEADERS);
    return res.end(JSON.stringify({ ok: false, error: 'INVALID_TOLL_MODE' }));
  }
  const hasActualTollKRW = body.actualTollKRW !== undefined
    && body.actualTollKRW !== null
    && String(body.actualTollKRW).trim() !== '';
  const actualTollKRW = hasActualTollKRW ? Number(body.actualTollKRW) : Number.NaN;
  if (tollMode === 'actual' && (!hasActualTollKRW || !Number.isInteger(actualTollKRW) || actualTollKRW < 0 || actualTollKRW > 1000000)) {
    res.writeHead(400, JSON_HEADERS);
    return res.end(JSON.stringify({ ok: false, error: 'INVALID_ACTUAL_TOLL' }));
  }
  let tollEntries = [];
  let itemizedTollKRW = 0;
  let pendingIncludedTollCount = 0;
  if (tollMode === 'itemized') {
    const normalizedEntries = normalizeTollEntries(body.tollEntries);
    if (!normalizedEntries.ok) {
      res.writeHead(400, JSON_HEADERS);
      return res.end(JSON.stringify({ ok: false, error: normalizedEntries.error }));
    }
    tollEntries = normalizedEntries.entries;
    itemizedTollKRW = normalizedEntries.includedTollKRW;
    pendingIncludedTollCount = normalizedEntries.pendingIncludedCount;
  } else if (body.tollEntries !== undefined) {
    res.writeHead(400, JSON_HEADERS);
    return res.end(JSON.stringify({ ok: false, error: 'INVALID_TOLL_ENTRIES' }));
  }
  const acknowledgedPendingTolls = body.acknowledgePendingTolls === true;
  if (pendingIncludedTollCount > 0 && !acknowledgedPendingTolls) {
    res.writeHead(400, JSON_HEADERS);
    return res.end(JSON.stringify({ ok: false, error: 'PENDING_TOLL_ACK_REQUIRED' }));
  }

  const hasManualDistance = body.actualTotalKm !== undefined && body.actualTotalKm !== null;
  let manualDistance = null;
  if (hasManualDistance) {
    const validated = validateActualDistance({ actualTotalKm: body.actualTotalKm, excludedKm: body.excludedKm });
    if (!validated.ok) {
      res.writeHead(400, JSON_HEADERS);
      return res.end(JSON.stringify({ ok: false, error: validated.error }));
    }
    manualDistance = validated;
  } else if (body.excludedKm !== undefined) {
    res.writeHead(400, JSON_HEADERS);
    return res.end(JSON.stringify({ ok: false, error: 'INVALID_EXCLUDED_KM' }));
  }

  const hasManualAdjustment = body.manualAdjustmentKRW !== undefined && body.manualAdjustmentKRW !== null;
  const manualAdjustmentKRW = hasManualAdjustment ? Number(body.manualAdjustmentKRW) : null;
  if (hasManualAdjustment && (!Number.isInteger(manualAdjustmentKRW) || Math.abs(manualAdjustmentKRW) > 10000000)) {
    res.writeHead(400, JSON_HEADERS);
    return res.end(JSON.stringify({ ok: false, error: 'INVALID_MANUAL_ADJUSTMENT' }));
  }

  const requestPayloadHash = buildSettlementPreviewHash({
    mode: 'correction-request',
    bookingId,
    expectedRevision,
    reason,
    actualHours: hasActualHours ? actualHours : null,
    tollMode: hasTollMode ? tollMode : null,
    actualTollKRW: hasActualTollKRW ? actualTollKRW : null,
    tollEntries: tollMode === 'itemized' ? tollEntries : null,
    acknowledgedPendingTolls,
    actualTotalKm: hasManualDistance ? manualDistance.actualTotalKm : null,
    excludedKm: hasManualDistance ? manualDistance.excludedKm : null,
    manualAdjustmentKRW: hasManualAdjustment ? manualAdjustmentKRW : null,
    previewHash,
  });

  try {
    const db = initAdminDb('mood-settle-correct');
    if (!db) {
      res.writeHead(500, JSON_HEADERS);
      return res.end(JSON.stringify({ ok: false, error: 'Firestore unavailable' }));
    }

    const allowlist = await getMoodAllowlist(db);
    if (!isAdminEmail(allowlist, email)) {
      res.writeHead(403, JSON_HEADERS);
      return res.end(JSON.stringify({ ok: false, error: '권한 없음 (운영자 전용)' }));
    }

    const bookingRef = db.collection('mood_bookings').doc(bookingId);
    const proposalId = buildSettlementProposalId({ bookingId, actorEmail: email, idempotencyKey });
    const proposalRef = db.collection('mood_settlement_proposals').doc(proposalId);
    const idempotencyRef = db.collection('mood_settlement_idempotency').doc(buildSettlementIdempotencyDocumentId({
      scope: 'mood-settlement-proposal',
      actorEmail: email,
      idempotencyKey,
    }));
    const proposedAt = Date.now();

    const result = await db.runTransaction(async (tx) => {
      const [idempotencySnap, bSnap] = await Promise.all([
        tx.get(idempotencyRef),
        tx.get(bookingRef),
      ]);
      if (idempotencySnap.exists) {
        const stored = idempotencySnap.data() || {};
        if (stored.payloadHash !== requestPayloadHash) {
          return { ok: false, status: 409, error: 'IDEMPOTENCY_CONFLICT' };
        }
        if (!stored.response || typeof stored.response !== 'object') {
          return { ok: false, status: 409, error: 'IDEMPOTENCY_RESPONSE_MISSING' };
        }
        return { ok: true, replayed: true, response: stored.response };
      }
      if (!bSnap.exists) return { ok: false, status: 404, error: 'BOOKING_NOT_FOUND' };
      const b = bSnap.data() || {};
      if (b.status !== 'completed') return { ok: false, status: 409, error: 'NOT_SETTLED' };
      const currentRevision = Number.isInteger(b.revision) ? b.revision : 0;
      if (currentRevision !== expectedRevision) return { ok: false, status: 409, error: 'STALE_REVISION' };
      const calculated = calculateMoodCorrection({
        booking: b,
        bookingId,
        expectedRevision: currentRevision,
        reason,
        hasActualHours,
        actualHours,
        hasManualDistance,
        manualDistance,
        hasTollMode,
        tollMode,
        actualTollKRW,
        tollEntries,
        itemizedTollKRW,
        acknowledgedPendingTolls,
        hasManualAdjustment,
        manualAdjustmentKRW,
      });
      if (!calculated.ok) return calculated;
      const {
        effectiveActualHours,
        effectiveActualTotalKm,
        effectiveExcludedKm,
        distanceSource,
        estimatedTollKRW,
        effectiveTollMode,
        effectiveTollEntries,
        finalPriced,
        effectiveManualAdjustmentKRW,
        currentFinalAmount,
        originalAmount,
        newFinalAmount,
        deltaKRW,
        newBreakdown,
        previewPayload,
        previewHash: calculatedPreviewHash,
      } = calculated.value;
      if (previewHash !== calculatedPreviewHash) {
        return { ok: false, status: 409, error: 'PREVIEW_MISMATCH' };
      }

      const clientRef = db.collection('mood_clients').doc(String(b.clientId || ''));
      const cSnap = await tx.get(clientRef);
      if (!cSnap.exists) return { ok: false, status: 404, error: 'CLIENT_NOT_FOUND' };
      const clientData = cSnap.data() || {};
      const balance = clientData.balanceKRW;
      if (!Number.isSafeInteger(balance)) return { ok: false, status: 409, error: 'INVALID_CLIENT_BALANCE' };
      const newBalance = balance - deltaKRW;
      if (!Number.isSafeInteger(deltaKRW) || !Number.isSafeInteger(newBalance)) {
        return { ok: false, status: 409, error: 'INVALID_CALCULATED_BALANCE' };
      }
      const creditLimitKRW = clientData.creditLimitKRW;
      if (creditLimitKRW !== undefined && creditLimitKRW !== null) {
        if (!Number.isSafeInteger(creditLimitKRW) || creditLimitKRW <= 0) {
          return { ok: false, status: 409, error: 'INVALID_CREDIT_LIMIT' };
        }
        if (deltaKRW > 0 && newBalance < -creditLimitKRW) {
          return { ok: false, status: 409, error: 'CREDIT_LIMIT_EXCEEDED' };
        }
      }

      const existingApproval = b.settlementApproval && typeof b.settlementApproval === 'object'
        ? b.settlementApproval
        : null;
      let previousProposalRef = null;
      let previousProposalSnap = null;
      if (
        existingApproval
        && existingApproval.proposalId
        && existingApproval.proposalId !== proposalId
        && (existingApproval.status === 'awaiting_mood' || existingApproval.status === 'changes_requested')
      ) {
        previousProposalRef = db.collection('mood_settlement_proposals').doc(String(existingApproval.proposalId));
        previousProposalSnap = await tx.get(previousProposalRef);
        if (!previousProposalSnap.exists) return { ok: false, status: 409, error: 'ACTIVE_PROPOSAL_NOT_FOUND' };
      }

      const nextRevision = currentRevision + 1;
      const version = settlementProposalVersionOf(b) + 1;
      const effectiveStoredTollEntries = effectiveTollMode === 'itemized' ? effectiveTollEntries : null;
      const effectivePendingIncludedTollCount = countPendingIncludedTolls(effectiveStoredTollEntries);
      const proposal = {
        proposalId,
        bookingId,
        clientId: b.clientId,
        mode: 'correction',
        version,
        status: 'awaiting_mood',
        bookingRevisionBefore: currentRevision,
        bookingRevisionAfterProposal: nextRevision,
        previewHash: calculatedPreviewHash,
        previewPayload,
        actualHours: effectiveActualHours,
        finalAmountKRW: newFinalAmount,
        bookedAmountKRW: originalAmount,
        previousFinalAmountKRW: currentFinalAmount,
        deltaKRW,
        finalBreakdown: newBreakdown,
        manualAdjustmentKRW: effectiveManualAdjustmentKRW,
        estimatedTollKRW,
        tollMode: effectiveTollMode,
        tollEntries: effectiveStoredTollEntries,
        pendingIncludedTollCount: effectivePendingIncludedTollCount,
        acknowledgedPendingTollsByOperator: acknowledgedPendingTolls,
        settlementReason: reason,
        courseMoodPercentages: Array.isArray(b.courseMoodPercentages) ? b.courseMoodPercentages : null,
        courseShareSchemaVersion: b.courseShareSchemaVersion || null,
        coursePayers: Array.isArray(b.coursePayers) ? b.coursePayers : null,
        finalRouteSnapshot: b.finalRouteSnapshot || null,
        proposedBalanceKRW: balance,
        proposedResultingBalanceKRW: newBalance,
        proposedByEmail: email,
        proposedAt,
        changeRequestReason: null,
        approvedByEmail: null,
        approvedAt: null,
      };
      const approvalSummary = buildSettlementApprovalSummary(proposal);
      const response = {
        ok: true,
        data: {
          bookingId,
          proposalId,
          mode: 'correction',
          status: 'awaiting_mood',
          version,
          finalAmountKRW: newFinalAmount,
          previousFinalAmountKRW: currentFinalAmount,
          deltaKRW,
          proposedBalanceKRW: balance,
          proposedResultingBalanceKRW: newBalance,
          actualHours: effectiveActualHours,
          baseKRW: finalPriced.baseKRW,
          distanceSurchargeKRW: finalPriced.distanceSurchargeKRW,
          km: finalPriced.km,
          distanceSource,
          actualTotalKm: effectiveActualTotalKm,
          excludedKm: effectiveExcludedKm,
          tollKRW: finalPriced.tollKRW,
          estimatedTollKRW,
          tollMode: effectiveTollMode,
          tollEntries: effectiveStoredTollEntries,
          pendingIncludedTollCount: effectivePendingIncludedTollCount,
          manualAdjustmentKRW: effectiveManualAdjustmentKRW,
          reason,
          revision: nextRevision,
          settlementApproval: approvalSummary,
        },
      };

      if (previousProposalRef && previousProposalSnap) {
        tx.update(previousProposalRef, {
          status: 'superseded',
          supersededByProposalId: proposalId,
          supersededByEmail: email,
          supersededAt: proposedAt,
        });
      }
      tx.set(proposalRef, proposal);
      tx.update(bookingRef, {
        settlementApproval: approvalSummary,
        settlementProposalVersion: version,
        revision: nextRevision,
      });
      tx.set(idempotencyRef, {
        scope: 'mood-settlement-proposal',
        bookingId,
        proposalId,
        actorEmail: email,
        payloadHash: requestPayloadHash,
        status: 'completed',
        response,
        createdAt: proposedAt,
        completedAt: proposedAt,
      });

      return {
        ok: true,
        replayed: false,
        response,
      };
    });

    if (!result.ok) {
      res.writeHead(result.status, JSON_HEADERS);
      return res.end(JSON.stringify({ ok: false, error: result.error }));
    }

    const response = result.response;
    console.log('[mood-settle-correct]', email, '→', bookingId, result.replayed ? '| 멱등 재생' : `| 정정 최종 ${response.data.finalAmountKRW} | 델타 ${response.data.deltaKRW}`);
    res.writeHead(200, JSON_HEADERS);
    return res.end(JSON.stringify({ ...response, replayed: result.replayed }));
  } catch (err) {
    console.error('[mood-settle-correct] failed:', err.message);
    await captureError(err, { route: '/api/mood-settle-correct', email });
    res.writeHead(500, JSON_HEADERS);
    return res.end(JSON.stringify({ ok: false, error: '서버 오류' }));
  }
}
