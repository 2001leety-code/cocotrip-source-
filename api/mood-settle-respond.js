/**
 * POST /api/mood-settle-respond — MOOD 이중 확인 정산 응답.
 *
 * approve/request_changes: 명시된 MOOD 정산 승인자만, 자기 clientId 제안만 가능.
 * withdraw: 운영자만 가능. 클라이언트가 보내는 금액은 받지 않고 서버 저장 proposal만 쓴다.
 * approve 순간에만 booking + client balance + proposal + audit + idempotency를 한 트랜잭션으로
 * 확정한다. 응답 유실 재시도는 같은 성공 응답을 재생하고 잔액은 한 번만 바뀐다.
 */
import { initAdminDb } from './_shared/firebase-admin.js';
import { verifyUserToken } from './_shared/user-auth.js';
import { captureError } from './_shared/sentry.js';
import { buildAdminJsonCors } from './_shared/cors.js';
import {
  getMoodAllowlist,
  isAdminEmail,
  isAllowedEmail,
  isSettlementApproverEmail,
} from './_shared/mood-allowlist.js';
import { buildSettlementPreviewHash } from './_shared/mood-settle-calc.js';
import {
  buildSettlementApprovalSummary,
  buildSettlementIdempotencyDocumentId,
  validateStoredSettlementProposal,
} from './_shared/mood-settlement-proposal.js';
import { notify } from './_shared/notify.js';
import { buildMoodSettlementReceiptEmail } from './_shared/mood-receipt.js';
import { sendEmail } from './_send-email.js';

export const maxDuration = 15;
export const config = { runtime: 'nodejs' };

const CORS_METHODS = 'POST, OPTIONS';
const ACTIONS = new Set(['approve', 'request_changes', 'withdraw']);
const CLIENT_FORBIDDEN_FIELDS = [
  'amountKRW',
  'finalAmountKRW',
  'deltaKRW',
  'balanceKRW',
  'actualHours',
  'finalBreakdown',
  'tollEntries',
  'manualAdjustmentKRW',
  'previewHash',
  'expectedRevision',
];

function responseAuditId(action, proposalId) {
  return buildSettlementPreviewHash({ type: `settlement-${action}`, proposalId });
}

function validCreditLimit(clientData, deltaKRW, newBalanceKRW) {
  const creditLimitKRW = clientData.creditLimitKRW;
  if (creditLimitKRW === undefined || creditLimitKRW === null) return { ok: true };
  if (!Number.isSafeInteger(creditLimitKRW) || creditLimitKRW <= 0) {
    return { ok: false, error: 'INVALID_CREDIT_LIMIT' };
  }
  if (deltaKRW > 0 && newBalanceKRW < -creditLimitKRW) {
    return { ok: false, error: 'CREDIT_LIMIT_EXCEEDED' };
  }
  return { ok: true };
}

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
  const proposalId = typeof body.proposalId === 'string' ? body.proposalId.trim() : '';
  if (proposalId.length < 8 || proposalId.length > 200) {
    res.writeHead(400, JSON_HEADERS);
    return res.end(JSON.stringify({ ok: false, error: 'INVALID_PROPOSAL_ID' }));
  }
  const action = typeof body.action === 'string' ? body.action.trim() : '';
  if (!ACTIONS.has(action)) {
    res.writeHead(400, JSON_HEADERS);
    return res.end(JSON.stringify({ ok: false, error: 'INVALID_SETTLEMENT_ACTION' }));
  }
  const reason = String(body.reason || '').trim();
  if (action === 'request_changes' && !reason) {
    res.writeHead(400, JSON_HEADERS);
    return res.end(JSON.stringify({ ok: false, error: 'CHANGE_REQUEST_REASON_REQUIRED' }));
  }
  if (reason.length > 500) {
    res.writeHead(400, JSON_HEADERS);
    return res.end(JSON.stringify({ ok: false, error: 'SETTLEMENT_RESPONSE_REASON_TOO_LONG' }));
  }
  const idempotencyKey = typeof body.idempotencyKey === 'string' ? body.idempotencyKey.trim() : '';
  if (idempotencyKey.length < 8 || idempotencyKey.length > 200) {
    res.writeHead(400, JSON_HEADERS);
    return res.end(JSON.stringify({ ok: false, error: 'INVALID_IDEMPOTENCY_KEY' }));
  }
  if (CLIENT_FORBIDDEN_FIELDS.some((field) => Object.prototype.hasOwnProperty.call(body, field))) {
    res.writeHead(400, JSON_HEADERS);
    return res.end(JSON.stringify({ ok: false, error: 'CLIENT_SETTLEMENT_FIELDS_FORBIDDEN' }));
  }
  const acknowledgePendingTolls = body.acknowledgePendingTolls === true;
  const requestPayloadHash = buildSettlementPreviewHash({
    mode: 'settlement-response',
    proposalId,
    action,
    reason: reason || null,
    acknowledgePendingTolls,
  });

  try {
    const db = initAdminDb('mood-settle-respond');
    if (!db) {
      res.writeHead(500, JSON_HEADERS);
      return res.end(JSON.stringify({ ok: false, error: 'Firestore unavailable' }));
    }
    const allowlist = await getMoodAllowlist(db);
    const admin = isAdminEmail(allowlist, email);
    const moodApprover = isAllowedEmail(allowlist, email) && isSettlementApproverEmail(allowlist, email);
    if (action === 'withdraw' ? !admin : !moodApprover) {
      res.writeHead(403, JSON_HEADERS);
      return res.end(JSON.stringify({ ok: false, error: action === 'withdraw' ? '권한 없음 (운영자 전용)' : 'SETTLEMENT_APPROVER_REQUIRED' }));
    }

    const proposalRef = db.collection('mood_settlement_proposals').doc(proposalId);
    const idempotencyRef = db.collection('mood_settlement_idempotency').doc(buildSettlementIdempotencyDocumentId({
      scope: 'mood-settlement-response',
      actorEmail: email,
      idempotencyKey,
    }));
    const priorIdempotencySnap = await idempotencyRef.get();
    if (priorIdempotencySnap.exists) {
      const stored = priorIdempotencySnap.data() || {};
      if (stored.payloadHash !== requestPayloadHash) {
        res.writeHead(409, JSON_HEADERS);
        return res.end(JSON.stringify({ ok: false, error: 'IDEMPOTENCY_CONFLICT' }));
      }
      if (!stored.response || typeof stored.response !== 'object') {
        res.writeHead(409, JSON_HEADERS);
        return res.end(JSON.stringify({ ok: false, error: 'IDEMPOTENCY_RESPONSE_MISSING' }));
      }
      res.writeHead(200, JSON_HEADERS);
      return res.end(JSON.stringify({ ...stored.response, replayed: true }));
    }

    const respondedAt = Date.now();
    const auditRef = db.collection('mood_settlement_audit').doc(responseAuditId(action, proposalId));
    const result = await db.runTransaction(async (tx) => {
      const [idempotencySnap, proposalSnap] = await Promise.all([
        tx.get(idempotencyRef),
        tx.get(proposalRef),
      ]);
      if (idempotencySnap.exists) {
        const stored = idempotencySnap.data() || {};
        if (stored.payloadHash !== requestPayloadHash) return { ok: false, status: 409, error: 'IDEMPOTENCY_CONFLICT' };
        if (!stored.response || typeof stored.response !== 'object') {
          return { ok: false, status: 409, error: 'IDEMPOTENCY_RESPONSE_MISSING' };
        }
        return { ok: true, replayed: true, response: stored.response };
      }
      if (!proposalSnap.exists) return { ok: false, status: 404, error: 'PROPOSAL_NOT_FOUND' };
      const proposal = proposalSnap.data() || {};
      if (proposal.proposalId !== proposalId) return { ok: false, status: 409, error: 'PROPOSAL_ID_MISMATCH' };
      if (!admin) {
        if (!allowlist.clientId || proposal.clientId !== allowlist.clientId) {
          return { ok: false, status: 403, error: 'PROPOSAL_CLIENT_FORBIDDEN' };
        }
        if (String(proposal.proposedByEmail || '').toLowerCase() === String(email || '').toLowerCase()) {
          return { ok: false, status: 403, error: 'SECOND_APPROVER_MUST_DIFFER' };
        }
      }

      const bookingRef = db.collection('mood_bookings').doc(String(proposal.bookingId || ''));
      const bookingSnap = await tx.get(bookingRef);
      if (!bookingSnap.exists) return { ok: false, status: 404, error: 'BOOKING_NOT_FOUND' };
      const booking = bookingSnap.data() || {};
      if (booking.clientId !== proposal.clientId) return { ok: false, status: 409, error: 'PROPOSAL_CLIENT_MISMATCH' };
      const currentRevision = Number.isInteger(booking.revision) ? booking.revision : 0;

      if (action === 'approve') {
        const validated = validateStoredSettlementProposal({ proposal, booking });
        if (!validated.ok) return validated;
        if (validated.value.pendingIncludedTollCount > 0 && !acknowledgePendingTolls) {
          return { ok: false, status: 400, error: 'PENDING_TOLL_ACK_REQUIRED' };
        }

        const clientRef = db.collection('mood_clients').doc(String(proposal.clientId || ''));
        const clientSnap = await tx.get(clientRef);
        if (!clientSnap.exists) return { ok: false, status: 404, error: 'CLIENT_NOT_FOUND' };
        const clientData = clientSnap.data() || {};
        const previousBalanceKRW = clientData.balanceKRW;
        if (!Number.isSafeInteger(previousBalanceKRW)) return { ok: false, status: 409, error: 'INVALID_CLIENT_BALANCE' };
        const deltaKRW = validated.value.deltaKRW;
        const newBalanceKRW = previousBalanceKRW - deltaKRW;
        if (!Number.isSafeInteger(deltaKRW) || !Number.isSafeInteger(newBalanceKRW)) {
          return { ok: false, status: 409, error: 'INVALID_CALCULATED_BALANCE' };
        }
        const credit = validCreditLimit(clientData, deltaKRW, newBalanceKRW);
        if (!credit.ok) return { ok: false, status: 409, error: credit.error };

        const nextRevision = currentRevision + 1;
        const approvalSummary = buildSettlementApprovalSummary(proposal, {
          status: 'approved',
          approvedByEmail: email,
          approvedAt: respondedAt,
          changeRequestReason: null,
        });
        const bookingPatch = {
          status: 'completed',
          actualHours: proposal.actualHours,
          finalAmountKRW: proposal.finalAmountKRW,
          finalBreakdown: proposal.finalBreakdown,
          adjustmentKRW: proposal.finalAmountKRW - proposal.bookedAmountKRW,
          manualAdjustmentKRW: proposal.manualAdjustmentKRW,
          estimatedTollKRW: proposal.estimatedTollKRW,
          tollMode: proposal.tollMode,
          tollEntries: proposal.tollEntries,
          settlementReason: proposal.settlementReason || null,
          balanceAfterKRW: newBalanceKRW,
          settlementApproval: approvalSummary,
          revision: nextRevision,
          approvedByEmail: email,
          approvedAt: respondedAt,
        };
        if (proposal.mode === 'initial') {
          bookingPatch.courseMoodPercentages = proposal.courseMoodPercentages;
          bookingPatch.courseShareSchemaVersion = proposal.courseShareSchemaVersion;
          bookingPatch.coursePayers = proposal.coursePayers;
          if (proposal.finalRouteSnapshot) bookingPatch.finalRouteSnapshot = proposal.finalRouteSnapshot;
          bookingPatch.settledAt = respondedAt;
          bookingPatch.settledByEmail = proposal.proposedByEmail;
        } else {
          bookingPatch.correctionCount = (Number.isInteger(booking.correctionCount) ? booking.correctionCount : 0) + 1;
          bookingPatch.lastCorrectionReason = proposal.settlementReason;
          bookingPatch.correctedAt = respondedAt;
          bookingPatch.correctedByEmail = proposal.proposedByEmail;
        }
        const response = {
          ok: true,
          data: {
            proposalId,
            bookingId: proposal.bookingId,
            mode: proposal.mode,
            status: 'approved',
            version: proposal.version,
            finalAmountKRW: proposal.finalAmountKRW,
            deltaKRW,
            balanceKRW: newBalanceKRW,
            revision: nextRevision,
          },
        };

        tx.update(clientRef, { balanceKRW: newBalanceKRW });
        tx.update(bookingRef, bookingPatch);
        tx.update(proposalRef, {
          status: 'approved',
          approvedByEmail: email,
          approvedAt: respondedAt,
          approvedPreviousBalanceKRW: previousBalanceKRW,
          approvedNewBalanceKRW: newBalanceKRW,
          acknowledgedPendingTollsByApprover: acknowledgePendingTolls,
        });
        tx.set(auditRef, {
          type: proposal.mode,
          action: 'approved',
          proposalId,
          proposalVersion: proposal.version,
          bookingId: proposal.bookingId,
          clientId: proposal.clientId,
          beforeSnapshot: {
            status: booking.status,
            amountKRW: booking.amountKRW,
            finalAmountKRW: booking.finalAmountKRW === undefined ? null : booking.finalAmountKRW,
            revision: currentRevision,
          },
          afterSnapshot: {
            status: 'completed',
            finalAmountKRW: proposal.finalAmountKRW,
            revision: nextRevision,
          },
          deltaKRW,
          previousBalanceKRW,
          newBalanceKRW,
          proposedByEmail: proposal.proposedByEmail,
          proposedAt: proposal.proposedAt,
          approvedByEmail: email,
          approvedAt: respondedAt,
          byEmail: email,
          at: respondedAt,
          actualHours: proposal.actualHours,
          finalBreakdown: proposal.finalBreakdown,
          tollMode: proposal.tollMode,
          tollEntries: proposal.tollEntries,
          pendingIncludedTollCount: proposal.pendingIncludedTollCount,
          acknowledgedPendingTollsByApprover: acknowledgePendingTolls,
          settlementReason: proposal.settlementReason || null,
        });
        tx.set(idempotencyRef, {
          scope: 'mood-settlement-response',
          proposalId,
          bookingId: proposal.bookingId,
          actorEmail: email,
          payloadHash: requestPayloadHash,
          status: 'completed',
          response,
          createdAt: respondedAt,
          completedAt: respondedAt,
        });
        return { ok: true, replayed: false, response, proposal, booking, priced: validated.value.priced };
      }

      if (proposal.status !== 'awaiting_mood') return { ok: false, status: 409, error: 'PROPOSAL_NOT_AWAITING' };
      const approval = booking.settlementApproval;
      if (
        !approval
        || approval.proposalId !== proposalId
        || approval.version !== proposal.version
        || approval.status !== 'awaiting_mood'
        || currentRevision !== proposal.bookingRevisionAfterProposal
      ) {
        return { ok: false, status: 409, error: 'SETTLEMENT_APPROVAL_MISMATCH' };
      }
      const nextStatus = action === 'request_changes' ? 'changes_requested' : 'withdrawn';
      const nextRevision = currentRevision + 1;
      const approvalSummary = buildSettlementApprovalSummary(proposal, {
        status: nextStatus,
        changeRequestReason: reason || null,
      });
      const response = {
        ok: true,
        data: {
          proposalId,
          bookingId: proposal.bookingId,
          mode: proposal.mode,
          status: nextStatus,
          version: proposal.version,
          finalAmountKRW: proposal.finalAmountKRW,
          deltaKRW: proposal.deltaKRW,
          revision: nextRevision,
          ...(action === 'request_changes' ? { changeRequestReason: reason } : {}),
        },
      };
      tx.update(proposalRef, {
        status: nextStatus,
        respondedByEmail: email,
        respondedAt,
        ...(action === 'request_changes' ? { changeRequestReason: reason } : { withdrawReason: reason || null }),
      });
      tx.update(bookingRef, {
        settlementApproval: approvalSummary,
        revision: nextRevision,
      });
      tx.set(auditRef, {
        type: 'settlement_response',
        action: nextStatus,
        proposalId,
        proposalVersion: proposal.version,
        bookingId: proposal.bookingId,
        clientId: proposal.clientId,
        reason: reason || null,
        proposedByEmail: proposal.proposedByEmail,
        proposedAt: proposal.proposedAt,
        byEmail: email,
        at: respondedAt,
      });
      tx.set(idempotencyRef, {
        scope: 'mood-settlement-response',
        proposalId,
        bookingId: proposal.bookingId,
        actorEmail: email,
        payloadHash: requestPayloadHash,
        status: 'completed',
        response,
        createdAt: respondedAt,
        completedAt: respondedAt,
      });
      return { ok: true, replayed: false, response, proposal, booking };
    });

    if (!result.ok) {
      res.writeHead(result.status || 409, JSON_HEADERS);
      return res.end(JSON.stringify({ ok: false, error: result.error || 'SETTLEMENT_RESPONSE_FAILED' }));
    }

    if (!result.replayed) {
      const proposal = result.proposal || {};
      const booking = result.booking || {};
      try {
        if (action === 'approve') {
          const delta = result.response.data.deltaKRW;
          const adjustment = delta > 0 ? `추가 ${delta.toLocaleString('ko-KR')}원`
            : delta < 0 ? `환원 ${(-delta).toLocaleString('ko-KR')}원` : '변동 없음';
          await notify('booking',
            `<b>MOOD 이중 확인 · 정산 확정</b>\n` +
            `${booking.clientName || booking.clientId || '-'} · ${booking.date} ${booking.startTime}\n` +
            `최종 ${proposal.finalAmountKRW.toLocaleString('ko-KR')}원 (${adjustment})\n` +
            `MOOD 승인자 ${email}`);
        } else {
          await notify('booking',
            `<b>MOOD 정산 ${action === 'request_changes' ? '수정 요청' : '제안 철회'}</b>\n` +
            `${booking.clientName || booking.clientId || '-'} · ${booking.date} ${booking.startTime}\n` +
            `${reason || '사유 없음'}\n처리자 ${email}`);
        }
      } catch (notifyError) {
        console.warn('[mood-settle-respond] notify 실패:', notifyError?.message);
      }

      if (action === 'approve') {
        try {
          const toEmail = booking.createdByEmail;
          if (toEmail) {
            const priced = result.priced || {};
            const bookedBreakdown = booking.breakdown || {};
            const finalBreakdown = proposal.finalBreakdown || {};
            const receipt = buildMoodSettlementReceiptEmail({
              clientName: booking.clientName || booking.clientId || '-',
              bookingId: proposal.bookingId,
              date: booking.date,
              startTime: booking.startTime,
              serviceType: booking.serviceType,
              bookedHours: Number(booking.durationHours) || 0,
              actualHours: proposal.actualHours,
              bookedKm: Number(bookedBreakdown.km) || 0,
              actualKm: Number(finalBreakdown.km) || 0,
              ratePerHour: priced.ratePerHour,
              baseKRW: finalBreakdown.baseKRW,
              distanceSurchargeKRW: finalBreakdown.distanceSurchargeKRW,
              tollKRW: finalBreakdown.tollKRW,
              bookedAmountKRW: proposal.bookedAmountKRW,
              finalAmountKRW: proposal.finalAmountKRW,
              adjustmentKRW: proposal.finalAmountKRW - proposal.bookedAmountKRW,
              newBalance: result.response.data.balanceKRW,
              routeRecomputed: finalBreakdown.recomputed === true,
              waypointCount: Array.isArray(finalBreakdown.waypoints) ? finalBreakdown.waypoints.length : 0,
            });
            await sendEmail({ to: toEmail, subject: receipt.subject, html: receipt.html, text: receipt.text });
          }
        } catch (emailError) {
          console.warn('[mood-settle-respond] receipt 메일 실패:', emailError?.message);
        }
      }
    }

    console.log('[mood-settle-respond]', email, '→', proposalId, '|', action, result.replayed ? '| 멱등 재생' : '');
    res.writeHead(200, JSON_HEADERS);
    return res.end(JSON.stringify({ ...result.response, replayed: result.replayed }));
  } catch (err) {
    console.error('[mood-settle-respond] failed:', err.message);
    await captureError(err, { route: '/api/mood-settle-respond', email });
    res.writeHead(500, JSON_HEADERS);
    return res.end(JSON.stringify({ ok: false, error: '서버 오류' }));
  }
}
