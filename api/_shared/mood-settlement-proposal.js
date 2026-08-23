/**
 * MOOD 이중 확인 정산 — 서버 저장 제안(proposal) 공통 계약.
 *
 * 운영자 제안 단계에서는 잔액/최종금액을 바꾸지 않는다. 이 모듈이 만든 서버 제안을
 * `mood_settlement_proposals`에 저장하고, MOOD 지정 승인자가 같은 제안을 승인할 때만
 * mood-settle-respond.js가 잔액과 예약을 한 트랜잭션으로 확정한다.
 */
import { computeMoodTotalKRW, fixedPriceFor, MOOD_MAX_DURATION_HOURS } from './mood-pricing.js';
import { buildSettlementPreviewHash, normalizeTollEntries } from './mood-settle-calc.js';

export const MOOD_SETTLEMENT_PROPOSAL_STATUSES = Object.freeze([
  'awaiting_mood',
  'changes_requested',
  'approved',
  'withdrawn',
  'superseded',
]);

export function settlementProposalVersionOf(booking) {
  const value = booking && booking.settlementProposalVersion;
  return Number.isInteger(value) && value >= 0 ? value : 0;
}

export function buildSettlementProposalId({ bookingId, actorEmail, idempotencyKey }) {
  return buildSettlementPreviewHash({
    scope: 'mood-settlement-proposal',
    bookingId,
    actorEmail: String(actorEmail || '').toLowerCase().trim(),
    idempotencyKey,
  });
}

export function buildSettlementIdempotencyDocumentId({ scope, actorEmail, idempotencyKey }) {
  return buildSettlementPreviewHash({
    scope,
    actorEmail: String(actorEmail || '').toLowerCase().trim(),
    idempotencyKey,
  });
}

export function countPendingIncludedTolls(entries) {
  if (!Array.isArray(entries)) return 0;
  return entries.filter((entry) => (
    entry
    && typeof entry === 'object'
    && entry.includedInSettlement === true
    && entry.status === 'pending'
  )).length;
}

export function buildSettlementApprovalSummary(proposal, overrides = {}) {
  const value = { ...proposal, ...overrides };
  return {
    status: value.status,
    mode: value.mode,
    proposalId: value.proposalId,
    version: value.version,
    bookedAmountKRW: value.bookedAmountKRW,
    previousFinalAmountKRW: value.previousFinalAmountKRW,
    finalAmountKRW: value.finalAmountKRW,
    deltaKRW: value.deltaKRW,
    actualHours: value.actualHours,
    finalBreakdown: value.finalBreakdown,
    tollMode: value.tollMode,
    tollEntries: value.tollEntries,
    settlementReason: value.settlementReason,
    proposedBalanceKRW: value.proposedBalanceKRW,
    proposedResultingBalanceKRW: value.proposedResultingBalanceKRW,
    pendingIncludedTollCount: value.pendingIncludedTollCount,
    proposedByEmail: value.proposedByEmail,
    proposedAt: value.proposedAt,
    changeRequestReason: value.changeRequestReason || null,
    approvedByEmail: value.approvedByEmail || null,
    approvedAt: value.approvedAt || null,
  };
}

function invalid(error) {
  return { ok: false, status: 409, error };
}

function sameMoneyBreakdown(left, right) {
  return left.baseKRW === right.baseKRW
    && left.distanceSurchargeKRW === right.distanceSurchargeKRW
    && left.tollKRW === right.tollKRW
    && left.km === right.km;
}

/**
 * 승인 직전 서버 저장 제안의 금액·예약 binding을 다시 검증한다.
 * 클라이언트가 보낸 금액은 인자로조차 받지 않는다.
 */
export function validateStoredSettlementProposal({ proposal, booking }) {
  if (!proposal || typeof proposal !== 'object' || Array.isArray(proposal)) return invalid('INVALID_SETTLEMENT_PROPOSAL');
  if (!booking || typeof booking !== 'object' || Array.isArray(booking)) return invalid('INVALID_BOOKING');
  if (proposal.status !== 'awaiting_mood') return invalid('PROPOSAL_NOT_AWAITING');
  if (proposal.mode !== 'initial' && proposal.mode !== 'correction') return invalid('INVALID_PROPOSAL_MODE');
  if (proposal.clientId !== booking.clientId) return invalid('PROPOSAL_CLIENT_MISMATCH');
  if (!Number.isInteger(proposal.version) || proposal.version <= 0) return invalid('INVALID_PROPOSAL_VERSION');
  if (settlementProposalVersionOf(booking) !== proposal.version) return invalid('PROPOSAL_VERSION_MISMATCH');
  if (!Number.isInteger(proposal.bookingRevisionAfterProposal) || proposal.bookingRevisionAfterProposal < 0) {
    return invalid('INVALID_PROPOSAL_REVISION');
  }
  const bookingRevision = Number.isInteger(booking.revision) ? booking.revision : 0;
  if (bookingRevision !== proposal.bookingRevisionAfterProposal) return invalid('STALE_REVISION');
  const approval = booking.settlementApproval;
  if (
    !approval
    || approval.status !== 'awaiting_mood'
    || approval.proposalId !== proposal.proposalId
    || approval.version !== proposal.version
    || approval.mode !== proposal.mode
  ) {
    return invalid('SETTLEMENT_APPROVAL_MISMATCH');
  }
  if (proposal.mode === 'initial' && booking.status !== 'confirmed') return invalid('BOOKING_NOT_SETTLEABLE');
  if (proposal.mode === 'correction' && booking.status !== 'completed') return invalid('NOT_SETTLED');

  if (
    typeof proposal.previewHash !== 'string'
    || !/^[a-f0-9]{64}$/.test(proposal.previewHash)
    || !proposal.previewPayload
    || buildSettlementPreviewHash(proposal.previewPayload) !== proposal.previewHash
  ) {
    return invalid('PROPOSAL_PREVIEW_MISMATCH');
  }
  const preview = proposal.previewPayload;
  if (
    preview.mode !== proposal.mode
    || preview.bookingId !== proposal.bookingId
    || preview.revision !== proposal.bookingRevisionBefore
    || preview.actualHours !== proposal.actualHours
    || !proposal.finalBreakdown
    || preview.km !== proposal.finalBreakdown.km
    || preview.tollMode !== proposal.tollMode
    || preview.tollKRW !== proposal.finalBreakdown.tollKRW
    || preview.manualAdjustmentKRW !== proposal.manualAdjustmentKRW
    || preview.bookedAmountKRW !== proposal.bookedAmountKRW
    || preview.finalAmountKRW !== proposal.finalAmountKRW
    || JSON.stringify(preview.tollEntries) !== JSON.stringify(proposal.tollEntries)
    || (proposal.mode === 'initial' && preview.settlementReason !== proposal.settlementReason)
    || (proposal.mode === 'correction' && (
      preview.correctionReason !== proposal.settlementReason
      || preview.previousFinalAmountKRW !== proposal.previousFinalAmountKRW
    ))
  ) {
    return invalid('PROPOSAL_PREVIEW_BINDING_MISMATCH');
  }

  if (
    typeof proposal.actualHours !== 'number'
    || !Number.isFinite(proposal.actualHours)
    || proposal.actualHours <= 0
    || proposal.actualHours > MOOD_MAX_DURATION_HOURS
  ) {
    return invalid('INVALID_PROPOSAL_ACTUAL_HOURS');
  }
  if (fixedPriceFor(booking.serviceType) !== null) return invalid('AIRPORT_NO_SETTLE');
  const hasStoredRate = booking.ratePerHour !== undefined && booking.ratePerHour !== null;
  if (hasStoredRate && (!Number.isSafeInteger(booking.ratePerHour) || booking.ratePerHour <= 0)) {
    return invalid('INVALID_BOOKING_RATE');
  }
  const breakdown = proposal.finalBreakdown;
  if (
    !breakdown
    || typeof breakdown !== 'object'
    || Array.isArray(breakdown)
    || !Number.isSafeInteger(breakdown.baseKRW)
    || breakdown.baseKRW < 0
    || !Number.isSafeInteger(breakdown.distanceSurchargeKRW)
    || breakdown.distanceSurchargeKRW < 0
    || !Number.isSafeInteger(breakdown.tollKRW)
    || breakdown.tollKRW < 0
    || typeof breakdown.km !== 'number'
    || !Number.isFinite(breakdown.km)
    || breakdown.km < 0
  ) {
    return invalid('INVALID_PROPOSAL_BREAKDOWN');
  }
  const priced = computeMoodTotalKRW({
    serviceType: booking.serviceType,
    durationHours: proposal.actualHours,
    km: breakdown.km,
    tollKRW: breakdown.tollKRW,
    ratePerHourOverride: hasStoredRate ? booking.ratePerHour : undefined,
  });
  if (!priced.ok || !sameMoneyBreakdown(breakdown, priced)) return invalid('PROPOSAL_PRICE_MISMATCH');

  if (
    !Number.isSafeInteger(proposal.manualAdjustmentKRW)
    || Math.abs(proposal.manualAdjustmentKRW) > 10000000
  ) {
    return invalid('INVALID_PROPOSAL_MANUAL_ADJUSTMENT');
  }
  const expectedFinalAmount = priced.amountKRW + proposal.manualAdjustmentKRW;
  if (!Number.isSafeInteger(expectedFinalAmount) || expectedFinalAmount < 0 || proposal.finalAmountKRW !== expectedFinalAmount) {
    return invalid('PROPOSAL_FINAL_AMOUNT_MISMATCH');
  }
  if (!Number.isSafeInteger(proposal.bookedAmountKRW) || proposal.bookedAmountKRW < 0 || proposal.bookedAmountKRW !== booking.amountKRW) {
    return invalid('PROPOSAL_BOOKED_AMOUNT_MISMATCH');
  }
  const previousFinalAmount = proposal.mode === 'initial' ? proposal.bookedAmountKRW : proposal.previousFinalAmountKRW;
  if (
    !Number.isSafeInteger(previousFinalAmount)
    || previousFinalAmount < 0
    || (proposal.mode === 'correction' && previousFinalAmount !== booking.finalAmountKRW)
  ) {
    return invalid('PROPOSAL_PREVIOUS_AMOUNT_MISMATCH');
  }
  const expectedDelta = proposal.finalAmountKRW - previousFinalAmount;
  if (!Number.isSafeInteger(expectedDelta) || proposal.deltaKRW !== expectedDelta) return invalid('PROPOSAL_DELTA_MISMATCH');

  if (!['estimated', 'none', 'actual', 'itemized'].includes(proposal.tollMode)) return invalid('INVALID_PROPOSAL_TOLL_MODE');
  let pendingIncludedTollCount = 0;
  if (proposal.tollMode === 'itemized') {
    const normalized = normalizeTollEntries(proposal.tollEntries);
    if (!normalized.ok || normalized.includedTollKRW !== breakdown.tollKRW) return invalid('INVALID_PROPOSAL_TOLL_ENTRIES');
    pendingIncludedTollCount = normalized.pendingIncludedCount;
  } else if (proposal.tollEntries !== null) {
    return invalid('INVALID_PROPOSAL_TOLL_ENTRIES');
  }
  if (proposal.pendingIncludedTollCount !== pendingIncludedTollCount) return invalid('INVALID_PROPOSAL_PENDING_TOLLS');

  return {
    ok: true,
    value: {
      priced,
      previousFinalAmountKRW: previousFinalAmount,
      deltaKRW: expectedDelta,
      pendingIncludedTollCount,
    },
  };
}
