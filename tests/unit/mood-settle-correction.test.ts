/**
 * MOOD 완료 정산 정정 — 이중 확인 계약 (preview → correct 제안 → respond 승인).
 *
 * 🔴 mood-settle-correct.js 는 제안만 만든다(돈 불변). mood-settle-respond.js 의 approve 만
 * 잔액·finalAmountKRW·감사·멱등을 한 트랜잭션으로 커밋한다. 두 단계를 각각 증명한다.
 */
/* eslint-disable @typescript-eslint/no-explicit-any -- Vercel/Firestore 테스트 더블 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ADMIN_EMAIL,
  BOOKING_ID,
  CLIENT_ID,
  MOOD_APPROVER_EMAIL,
  actAs,
  callCorrect,
  callPreview,
  callRespond,
  getSettlementDb,
  resetSettlementWorld,
  settlementMocks,
} from './helpers/moodSettlementHarness';

vi.mock('../../api/_shared/user-auth.js', () => ({ verifyUserToken: (...a: any[]) => settlementMocks.verifyUserToken(...a) }));
vi.mock('../../api/_shared/firebase-admin.js', () => ({ initAdminDb: () => getSettlementDb() }));
vi.mock('../../api/_shared/cors.js', () => ({ buildAdminJsonCors: () => ({ 'Content-Type': 'application/json' }) }));
vi.mock('../../api/_shared/sentry.js', () => ({ captureError: (...a: any[]) => settlementMocks.captureError(...a) }));
vi.mock('../../api/_shared/notify.js', () => ({ notify: (...a: any[]) => settlementMocks.notify(...a) }));
vi.mock('../../api/_shared/mood-receipt.js', () => ({
  buildMoodSettlementReceiptEmail: (...a: any[]) => settlementMocks.buildReceipt(...a),
}));
vi.mock('../../api/_send-email.js', () => ({ sendEmail: (...a: any[]) => settlementMocks.sendEmail(...a) }));

const tollEntries = [
  { label: '서울 → 평택', date: '2026-08-20 11:23:47', amountKRW: 5100, status: 'pending', includedInSettlement: true, evidenceRef: null },
  { label: '평택 → 송악', date: '2026-08-20 11:46:50', amountKRW: 2300, status: 'pending', includedInSettlement: true, evidenceRef: null },
  { label: '당진 → 서산', date: '2026-08-20 12:27:13', amountKRW: 1700, status: 'pending', includedInSettlement: true, evidenceRef: null },
  { label: '서산 → 당진', date: '2026-08-20 16:25:56', amountKRW: 1700, status: 'pending', includedInSettlement: true, evidenceRef: null },
  { label: '송악 → 서울', date: '2026-08-20 18:32:09', amountKRW: 5300, status: 'pending', includedInSettlement: true, evidenceRef: null },
  { label: '충전(제외내역)', date: '2026-08-20 15:27:25', amountKRW: 10000, status: 'confirmed', includedInSettlement: false, evidenceRef: '하이패스 카드 캡처' },
];

function settledBooking(overrides: Record<string, unknown> = {}) {
  return {
    clientId: CLIENT_ID,
    status: 'completed',
    revision: 2,
    amountKRW: 537740,
    ratePerHour: 30000,
    serviceType: 'vehicle',
    durationHours: 10,
    actualHours: 10,
    breakdown: { baseKRW: 300000, distanceSurchargeKRW: 228540, tollKRW: 9200, km: 380.9 },
    finalAmountKRW: 551300,
    finalBreakdown: {
      baseKRW: 300000,
      distanceSurchargeKRW: 235200,
      tollKRW: 16100,
      estimatedTollKRW: 9200,
      km: 392,
      distanceSource: 'manual',
      actualTotalKm: 438,
      excludedKm: 46,
    },
    estimatedTollKRW: 9200,
    tollMode: 'itemized',
    tollEntries,
    manualAdjustmentKRW: 0,
    correctionCount: 0,
    ...overrides,
  };
}

function correctionPayload(overrides: Record<string, unknown> = {}) {
  return {
    mode: 'correction',
    bookingId: BOOKING_ID,
    expectedRevision: 2,
    reason: '픽업 전 제외 거리를 48km로 바로잡음',
    actualHours: 10,
    actualTotalKm: 438,
    excludedKm: 48,
    tollMode: 'itemized',
    tollEntries,
    acknowledgePendingTolls: true,
    manualAdjustmentKRW: 0,
    ...overrides,
  };
}

beforeEach(() => {
  resetSettlementWorld({ booking: settledBooking(), client: { name: 'MOOD', balanceKRW: 986440 } });
});

describe('MOOD 완료 정산 정정 — 이중 확인', () => {
  it('제안 단계는 읽기 전용(잔액·finalAmountKRW 불변), 승인해야만 차액·감사·멱등이 한 트랜잭션에 남는다', async () => {
    const payload = correctionPayload();
    const preview = await callPreview(payload);
    expect(preview.status).toBe(200);
    expect(preview.json.data).toMatchObject({
      previousFinalAmountKRW: 551300,
      finalAmountKRW: 550100,
      deltaKRW: -1200,
      km: 390,
    });
    expect(getSettlementDb()._writes).toHaveLength(0);

    const request = { ...payload };
    delete (request as Record<string, unknown>).mode;
    const propose = await callCorrect({
      ...request,
      idempotencyKey: 'correction-booking-1-rev-2',
      previewHash: preview.json.data.previewHash,
    });
    expect(propose.status).toBe(200);
    expect(propose.json.data).toMatchObject({ mode: 'correction', status: 'awaiting_mood', finalAmountKRW: 550100, deltaKRW: -1200 });
    // 🔴 제안만으로는 잔액·확정 금액이 절대 바뀌지 않는다.
    expect(getSettlementDb()._peek('mood_clients/COMPANY_A')?.balanceKRW).toBe(986440);
    expect(getSettlementDb()._peek('mood_bookings/booking-1')).toMatchObject({ finalAmountKRW: 551300, correctionCount: 0 });

    actAs(MOOD_APPROVER_EMAIL);
    const approved = await callRespond({
      proposalId: propose.json.data.proposalId,
      action: 'approve',
      idempotencyKey: 'correction-approve-1',
      acknowledgePendingTolls: true,
    });
    expect(approved.status).toBe(200);
    expect(approved.json.data).toMatchObject({ finalAmountKRW: 550100, deltaKRW: -1200, balanceKRW: 987640, revision: 4 });
    expect(getSettlementDb()._peek('mood_clients/COMPANY_A')?.balanceKRW).toBe(987640);
    expect(getSettlementDb()._peek('mood_bookings/booking-1')).toMatchObject({
      amountKRW: 537740,
      finalAmountKRW: 550100,
      adjustmentKRW: 12360,
      balanceAfterKRW: 987640,
      revision: 4,
      correctionCount: 1,
    });
    const auditWrites = getSettlementDb()._writes.filter((write) => write.path.startsWith('mood_settlement_audit/'));
    expect(auditWrites).toHaveLength(1);
    expect(auditWrites[0].data).toMatchObject({
      deltaKRW: -1200,
      previousBalanceKRW: 986440,
      newBalanceKRW: 987640,
      byEmail: MOOD_APPROVER_EMAIL,
    });

    const writesAfterFirst = getSettlementDb()._writes.length;
    const replay = await callRespond({
      proposalId: propose.json.data.proposalId,
      action: 'approve',
      idempotencyKey: 'correction-approve-1',
      acknowledgePendingTolls: true,
    });
    expect(replay.status).toBe(200);
    expect(replay.json.replayed).toBe(true);
    expect(replay.json.data).toEqual(approved.json.data);
    expect(getSettlementDb()._writes).toHaveLength(writesAfterFirst);
    expect(getSettlementDb()._peek('mood_clients/COMPANY_A')?.balanceKRW).toBe(987640);

    const conflict = await callRespond({
      proposalId: propose.json.data.proposalId,
      action: 'request_changes',
      reason: '같은 키를 다른 내용으로 재사용',
      idempotencyKey: 'correction-approve-1',
    });
    expect(conflict.status).toBe(409);
    expect(conflict.json.error).toBe('IDEMPOTENCY_CONFLICT');
    expect(getSettlementDb()._peek('mood_clients/COMPANY_A')?.balanceKRW).toBe(987640);
  });

  it('정정 제안 생성 트랜잭션이 실패하면 예약·잔액 중 아무것도 바뀌지 않는다', async () => {
    const payload = correctionPayload();
    const preview = await callPreview(payload);
    getSettlementDb()._failNextTx(1, 'forced atomic failure');
    const request = { ...payload };
    delete (request as Record<string, unknown>).mode;
    const result = await callCorrect({
      ...request,
      idempotencyKey: 'correction-atomic-failure',
      previewHash: preview.json.data.previewHash,
    });
    expect(result.status).toBe(500);
    expect(getSettlementDb()._peek('mood_clients/COMPANY_A')?.balanceKRW).toBe(986440);
    expect(getSettlementDb()._peek('mood_bookings/booking-1')).toMatchObject({ finalAmountKRW: 551300, revision: 2, correctionCount: 0 });
  });

  it('MOOD 가 정정 제안에 수정을 요청하면 잔액·finalAmountKRW 는 그대로다', async () => {
    const payload = correctionPayload();
    const preview = await callPreview(payload);
    const request = { ...payload };
    delete (request as Record<string, unknown>).mode;
    const propose = await callCorrect({
      ...request,
      idempotencyKey: 'correction-rc-1',
      previewHash: preview.json.data.previewHash,
    });
    expect(propose.status).toBe(200);

    actAs(MOOD_APPROVER_EMAIL);
    const res = await callRespond({
      proposalId: propose.json.data.proposalId,
      action: 'request_changes',
      reason: '거리 산정 근거 재확인',
      idempotencyKey: 'correction-rc-2',
    });
    expect(res.status).toBe(200);
    expect(res.json.data.status).toBe('changes_requested');
    expect(getSettlementDb()._peek('mood_clients/COMPANY_A')?.balanceKRW).toBe(986440);
    expect(getSettlementDb()._peek('mood_bookings/booking-1')).toMatchObject({ finalAmountKRW: 551300, correctionCount: 0 });

    actAs(ADMIN_EMAIL);
    const stale = await callRespond({
      proposalId: propose.json.data.proposalId,
      action: 'approve',
      idempotencyKey: 'correction-approve-after-rc',
      acknowledgePendingTolls: true,
    });
    expect(stale.status).toBe(403); // admin 은 애초에 승인자가 아니다
  });
});
