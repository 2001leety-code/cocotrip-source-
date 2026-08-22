/**
 * MOOD 이중 확인 정산 — 실제 핸들러 계약 회귀 (api/mood-settle.js → api/mood-settle-respond.js).
 *
 * 승인된 불변식:
 *  - 운영자 제안은 **돈을 움직이지 않는다** (잔액·finalAmountKRW·status 불변).
 *  - 명시 설정된 비운영자 승인자만 승인할 수 있고, 제안자 본인은 승인할 수 없다.
 *  - 승인자는 proposalId/action/idempotencyKey/미확정 톨비 확인만 보낸다 — 금액은 못 보낸다.
 *  - 승인은 저장된 서버 제안 + 현재 예약 revision/version/지문/정확한 금액을 재검증하고,
 *    **현재** 잔액에 정확한 델타만 한 트랜잭션으로 적용한다.
 *  - request_changes / withdraw / supersede 는 절대 돈을 움직이지 않는다.
 *  - 재시도·동시요청은 한 번만 적용된다. 자동 승인은 없다.
 *
 * 확정 사례 고정값: 예약가 537,740 · 438−46=392km · 미확정 톨비 5건 16,100 ·
 * 카드충전 10,000 제외 · 최종 551,300 · 델타 13,560.
 */
/* eslint-disable @typescript-eslint/no-explicit-any -- Firestore 문서를 그대로 읽어 단언한다. */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ADMIN_EMAIL,
  BOOKING_ID,
  CLIENT_ID,
  MOOD_APPROVER_EMAIL,
  MOOD_STAFF_EMAIL,
  OTHER_COMPANY_EMAIL,
  actAs,
  approveAs,
  bookingDoc,
  callCorrect,
  callPreview,
  callRespond,
  clientDoc,
  confirmedBooking,
  fixtureTollEntries,
  getSettlementDb,
  moodAllowlistDoc,
  proposalDoc,
  proposeInitial,
  resetSettlementWorld,
  settlementMocks,
  writesTo,
} from './helpers/moodSettlementHarness';

vi.mock('../../api/_shared/user-auth.js', () => ({ verifyUserToken: (...a: any[]) => settlementMocks.verifyUserToken(...a) }));
vi.mock('../../api/_shared/firebase-admin.js', () => ({ initAdminDb: () => getSettlementDb() }));
vi.mock('../../api/_shared/mood-route.js', () => ({ computeRoute: (...a: any[]) => settlementMocks.computeRoute(...a) }));
vi.mock('../../api/_shared/cors.js', () => ({ buildAdminJsonCors: () => ({ 'Content-Type': 'application/json' }) }));
vi.mock('../../api/_shared/sentry.js', () => ({ captureError: (...a: any[]) => settlementMocks.captureError(...a) }));
vi.mock('../../api/_shared/notify.js', () => ({ notify: (...a: any[]) => settlementMocks.notify(...a) }));
vi.mock('../../api/_shared/mood-receipt.js', () => ({
  buildMoodSettlementReceiptEmail: (...a: any[]) => settlementMocks.buildReceipt(...a),
}));
vi.mock('../../api/_send-email.js', () => ({ sendEmail: (...a: any[]) => settlementMocks.sendEmail(...a) }));

const FINAL = 551300;
const DELTA = 13560;
const TOLL = 16100;
const START_BALANCE = 1000000;

beforeEach(() => {
  resetSettlementWorld();
});

async function proposalIdOrThrow(overrides: Record<string, unknown> = {}) {
  const { preview, propose } = await proposeInitial(overrides);
  expect(preview.status).toBe(200);
  expect(propose?.status).toBe(200);
  return propose!.json.data.proposalId as string;
}

describe('제안 단계 — 돈이 움직이지 않는다', () => {
  it('운영자 제안은 확정 금액을 계산해 저장하지만 잔액·최종금액·상태를 바꾸지 않는다', async () => {
    const { preview, propose } = await proposeInitial();

    expect(preview.status).toBe(200);
    expect(propose!.status).toBe(200);
    expect(propose!.json.data).toMatchObject({
      mode: 'initial',
      status: 'awaiting_mood',
      version: 1,
      finalAmountKRW: FINAL,
      deltaKRW: DELTA,
      proposedBalanceKRW: START_BALANCE,
      proposedResultingBalanceKRW: START_BALANCE - DELTA,
      pendingIncludedTollCount: 5,
    });

    // 🔴 핵심: 제안만으로 고객 잔액과 예약 확정 상태가 절대 바뀌지 않는다.
    expect(clientDoc().balanceKRW).toBe(START_BALANCE);
    expect(writesTo('mood_clients')).toHaveLength(0);
    const booking = bookingDoc();
    expect(booking.status).toBe('confirmed');
    expect(booking.finalAmountKRW).toBeUndefined();
    expect(booking.balanceAfterKRW).toBeUndefined();
    expect(booking.settledAt).toBeUndefined();
    expect(booking.settlementApproval).toMatchObject({ status: 'awaiting_mood', finalAmountKRW: FINAL });
    expect(booking.settlementProposalVersion).toBe(1);
  });

  it('미리보기는 어떤 문서도 쓰지 않는다', async () => {
    const preview = await callPreview({
      bookingId: BOOKING_ID,
      actualHours: 10,
      actualTotalKm: 438,
      excludedKm: 46,
      tollMode: 'itemized',
      tollEntries: fixtureTollEntries(),
      acknowledgePendingTolls: true,
      settlementReason: '미리보기',
      expectedRevision: 1,
    });
    expect(preview.status).toBe(200);
    expect(getSettlementDb()._writes).toHaveLength(0);
  });

  it('제안 단계에서는 최종 영수증 메일을 보내지 않는다', async () => {
    await proposeInitial();
    expect(settlementMocks.sendEmail).not.toHaveBeenCalled();
    expect(settlementMocks.buildReceipt).not.toHaveBeenCalled();
  });
});

describe('승인 권한 — fail-closed', () => {
  it('제안한 운영자 본인은 승인할 수 없다', async () => {
    const proposalId = await proposalIdOrThrow();
    const res = await approveAs(ADMIN_EMAIL, proposalId);
    expect(res.status).toBe(403);
    expect(res.json.error).toBe('SETTLEMENT_APPROVER_REQUIRED');
    expect(clientDoc().balanceKRW).toBe(START_BALANCE);
  });

  it('승인자 목록에 없는 MOOD 직원은 승인할 수 없다', async () => {
    const proposalId = await proposalIdOrThrow();
    const res = await approveAs(MOOD_STAFF_EMAIL, proposalId);
    expect(res.status).toBe(403);
    expect(res.json.error).toBe('SETTLEMENT_APPROVER_REQUIRED');
    expect(clientDoc().balanceKRW).toBe(START_BALANCE);
  });

  it('allowlist 에 settlementApproverEmails 가 없으면 아무도 승인하지 못한다(fail-closed)', async () => {
    resetSettlementWorld({ allowlist: moodAllowlistDoc({ settlementApproverEmails: [] }) });
    const proposalId = await proposalIdOrThrow();
    const res = await approveAs(MOOD_APPROVER_EMAIL, proposalId);
    expect(res.status).toBe(403);
    expect(clientDoc().balanceKRW).toBe(START_BALANCE);
  });

  it('승인자가 운영자 목록에도 들어 있으면 두 번째 승인자가 될 수 없다', async () => {
    resetSettlementWorld({ allowlist: moodAllowlistDoc({ admins: [ADMIN_EMAIL, MOOD_APPROVER_EMAIL] }) });
    const proposalId = await proposalIdOrThrow();
    const res = await approveAs(MOOD_APPROVER_EMAIL, proposalId);
    expect(res.status).toBe(403);
    expect(clientDoc().balanceKRW).toBe(START_BALANCE);
  });

  it('다른 회사 소속 승인자는 이 client 제안에 접근하지 못한다', async () => {
    resetSettlementWorld({
      allowlist: moodAllowlistDoc({
        emails: [ADMIN_EMAIL, OTHER_COMPANY_EMAIL],
        settlementApproverEmails: [OTHER_COMPANY_EMAIL],
        clientId: 'COMPANY_B',
      }),
    });
    const proposalId = await proposalIdOrThrow();
    const res = await approveAs(OTHER_COMPANY_EMAIL, proposalId);
    expect(res.status).toBe(403);
    expect(res.json.error).toBe('PROPOSAL_CLIENT_FORBIDDEN');
    expect(clientDoc().balanceKRW).toBe(START_BALANCE);
  });

  it('승인자는 금액 필드를 보낼 수 없다', async () => {
    const proposalId = await proposalIdOrThrow();
    actAs(MOOD_APPROVER_EMAIL);
    const res = await callRespond({
      proposalId,
      action: 'approve',
      idempotencyKey: 'idem-approve-hack',
      acknowledgePendingTolls: true,
      finalAmountKRW: 1,
    });
    expect(res.status).toBe(400);
    expect(res.json.error).toBe('CLIENT_SETTLEMENT_FIELDS_FORBIDDEN');
    expect(clientDoc().balanceKRW).toBe(START_BALANCE);
  });

  it('자동 승인은 없다 — 제안 뒤 아무도 응답하지 않으면 잔액은 그대로다', async () => {
    await proposalIdOrThrow();
    expect(bookingDoc().status).toBe('confirmed');
    expect(clientDoc().balanceKRW).toBe(START_BALANCE);
  });
});

describe('승인 — 정확한 델타를 현재 잔액에 한 번만 적용', () => {
  it('MOOD 승인자가 승인하면 551,300원 확정 + 델타 13,560원만 현재 잔액에서 차감', async () => {
    const proposalId = await proposalIdOrThrow();
    const res = await approveAs(MOOD_APPROVER_EMAIL, proposalId);

    expect(res.status).toBe(200);
    expect(res.json.data).toMatchObject({
      status: 'approved',
      finalAmountKRW: FINAL,
      deltaKRW: DELTA,
      balanceKRW: START_BALANCE - DELTA,
    });
    const booking = bookingDoc();
    expect(booking).toMatchObject({
      status: 'completed',
      finalAmountKRW: FINAL,
      adjustmentKRW: DELTA,
      balanceAfterKRW: START_BALANCE - DELTA,
      tollMode: 'itemized',
      settledByEmail: ADMIN_EMAIL,
      approvedByEmail: MOOD_APPROVER_EMAIL,
    });
    expect(booking.finalBreakdown).toMatchObject({
      km: 392, actualTotalKm: 438, excludedKm: 46, tollKRW: TOLL, distanceSource: 'manual',
    });
    expect(booking.settlementApproval).toMatchObject({
      status: 'approved',
      proposedByEmail: ADMIN_EMAIL,
      approvedByEmail: MOOD_APPROVER_EMAIL,
      version: 1,
    });
    expect(clientDoc().balanceKRW).toBe(START_BALANCE - DELTA);
    expect(writesTo('mood_settlement_audit')).toHaveLength(1);
  });

  it('제안 이후 충전으로 잔액이 늘어도 승인은 제안 시점 잔액이 아닌 **현재** 잔액에 델타를 적용한다', async () => {
    const proposalId = await proposalIdOrThrow();
    // 운영자 충전(제안과 무관한 잔액 변동) — 예약 revision 은 건드리지 않는다.
    await getSettlementDb().collection('mood_clients').doc(CLIENT_ID).update({ balanceKRW: START_BALANCE + 200000 });

    const res = await approveAs(MOOD_APPROVER_EMAIL, proposalId);
    expect(res.status).toBe(200);
    expect(res.json.data.balanceKRW).toBe(START_BALANCE + 200000 - DELTA);
    expect(clientDoc().balanceKRW).toBe(START_BALANCE + 200000 - DELTA);
  });

  it('승인 트랜잭션은 예약·잔액·제안·감사·멱등 문서를 함께 커밋한다', async () => {
    const proposalId = await proposalIdOrThrow();
    const before = getSettlementDb()._writes.length;
    await approveAs(MOOD_APPROVER_EMAIL, proposalId);
    const approvalWrites = getSettlementDb()._writes.slice(before);
    expect(approvalWrites.every((w) => w.inTx)).toBe(true);
    const touched = new Set(approvalWrites.map((w) => w.path.split('/')[0]));
    expect(touched).toEqual(new Set([
      'mood_clients', 'mood_bookings', 'mood_settlement_proposals',
      'mood_settlement_audit', 'mood_settlement_idempotency',
    ]));
    expect(proposalDoc(proposalId)).toMatchObject({
      status: 'approved',
      approvedByEmail: MOOD_APPROVER_EMAIL,
      approvedPreviousBalanceKRW: START_BALANCE,
      approvedNewBalanceKRW: START_BALANCE - DELTA,
    });
  });

  it('트랜잭션이 실패하면 잔액도 예약도 바뀌지 않는다', async () => {
    const proposalId = await proposalIdOrThrow();
    getSettlementDb()._failNextTx(1, 'firestore unavailable');
    const res = await approveAs(MOOD_APPROVER_EMAIL, proposalId);
    expect(res.status).toBe(500);
    expect(clientDoc().balanceKRW).toBe(START_BALANCE);
    expect(bookingDoc().status).toBe('confirmed');
    expect(proposalDoc(proposalId).status).toBe('awaiting_mood');
  });

  it('승인 시에만 최종 영수증 메일을 보낸다', async () => {
    const proposalId = await proposalIdOrThrow();
    expect(settlementMocks.sendEmail).not.toHaveBeenCalled();
    await approveAs(MOOD_APPROVER_EMAIL, proposalId);
    expect(settlementMocks.sendEmail).toHaveBeenCalledTimes(1);
  });
});

describe('신용한도 — 제안 이후 잔액이 나빠지면 승인 시점에 다시 걸린다', () => {
  it('제안 시점엔 한도 안이었지만 승인 직전 잔액 드리프트로 초과하면 승인이 막히고 상태는 전부 그대로다', async () => {
    resetSettlementWorld({ client: { name: 'MOOD', balanceKRW: START_BALANCE, creditLimitKRW: 5000 } });
    const proposalId = await proposalIdOrThrow();
    // 제안 생성 뒤(제안 시점엔 문제 없었음) 다른 처리로 잔액이 5,000원까지 떨어졌다고 가정.
    await getSettlementDb().collection('mood_clients').doc(CLIENT_ID).update({ balanceKRW: 5000 });
    const before = getSettlementDb()._writes.length;

    const res = await approveAs(MOOD_APPROVER_EMAIL, proposalId);

    expect(res.status).toBe(409);
    expect(res.json.error).toBe('CREDIT_LIMIT_EXCEEDED');
    // 트랜잭션이 크레딧 검사에서 막혀 아무 컬렉션에도 안 쓰였다 — 잔액/예약/제안/감사/멱등 전부 그대로.
    expect(getSettlementDb()._writes.slice(before)).toHaveLength(0);
    expect(clientDoc().balanceKRW).toBe(5000);
    expect(bookingDoc().status).toBe('confirmed');
    expect(bookingDoc().finalAmountKRW).toBeUndefined();
    expect(proposalDoc(proposalId).status).toBe('awaiting_mood');
  });
});

describe('미확정 톨비 — 승인자도 따로 확인해야 한다', () => {
  it('승인자가 미확정 톨비를 확인하지 않으면 승인이 거부되고 잔액은 그대로다', async () => {
    const proposalId = await proposalIdOrThrow();
    actAs(MOOD_APPROVER_EMAIL);
    const res = await callRespond({ proposalId, action: 'approve', idempotencyKey: 'idem-noack-1' });
    expect(res.status).toBe(400);
    expect(res.json.error).toBe('PENDING_TOLL_ACK_REQUIRED');
    expect(clientDoc().balanceKRW).toBe(START_BALANCE);
    expect(bookingDoc().status).toBe('confirmed');
  });

  it('확인 후 승인하면 승인자의 확인 사실이 제안·감사에 남는다', async () => {
    const proposalId = await proposalIdOrThrow();
    const res = await approveAs(MOOD_APPROVER_EMAIL, proposalId, { idempotencyKey: 'idem-ack-1' });
    expect(res.status).toBe(200);
    expect(proposalDoc(proposalId).acknowledgedPendingTollsByApprover).toBe(true);
    const audit = writesTo('mood_settlement_audit')[0].data as any;
    expect(audit).toMatchObject({ pendingIncludedTollCount: 5, acknowledgedPendingTollsByApprover: true });
  });
});

describe('수정 요청 / 철회 — 돈이 움직이지 않는다', () => {
  it('MOOD 가 수정 요청하면 사유만 남고 잔액·예약 금액은 그대로다', async () => {
    const proposalId = await proposalIdOrThrow();
    actAs(MOOD_APPROVER_EMAIL);
    const res = await callRespond({
      proposalId, action: 'request_changes', reason: '톨비 근거 재확인 필요', idempotencyKey: 'idem-rc-1',
    });
    expect(res.status).toBe(200);
    expect(res.json.data.status).toBe('changes_requested');
    expect(clientDoc().balanceKRW).toBe(START_BALANCE);
    expect(writesTo('mood_clients')).toHaveLength(0);
    expect(bookingDoc().status).toBe('confirmed');
    expect(bookingDoc().settlementApproval).toMatchObject({
      status: 'changes_requested', changeRequestReason: '톨비 근거 재확인 필요',
    });
    expect(proposalDoc(proposalId).status).toBe('changes_requested');
  });

  it('수정 요청에는 사유가 필수다', async () => {
    const proposalId = await proposalIdOrThrow();
    actAs(MOOD_APPROVER_EMAIL);
    const res = await callRespond({ proposalId, action: 'request_changes', idempotencyKey: 'idem-rc-2' });
    expect(res.status).toBe(400);
    expect(res.json.error).toBe('CHANGE_REQUEST_REASON_REQUIRED');
  });

  it('수정 요청된 제안은 더 이상 승인할 수 없다', async () => {
    const proposalId = await proposalIdOrThrow();
    actAs(MOOD_APPROVER_EMAIL);
    await callRespond({ proposalId, action: 'request_changes', reason: '재확인', idempotencyKey: 'idem-rc-3' });
    const res = await approveAs(MOOD_APPROVER_EMAIL, proposalId, { idempotencyKey: 'idem-approve-after-rc' });
    expect(res.status).toBe(409);
    expect(res.json.error).toBe('PROPOSAL_NOT_AWAITING');
    expect(clientDoc().balanceKRW).toBe(START_BALANCE);
  });

  it('운영자 철회는 돈을 움직이지 않고, 승인자는 철회할 수 없다', async () => {
    const proposalId = await proposalIdOrThrow();
    actAs(MOOD_APPROVER_EMAIL);
    const forbidden = await callRespond({ proposalId, action: 'withdraw', idempotencyKey: 'idem-wd-x' });
    expect(forbidden.status).toBe(403);

    actAs(ADMIN_EMAIL);
    const res = await callRespond({ proposalId, action: 'withdraw', reason: '입력 오류', idempotencyKey: 'idem-wd-1' });
    expect(res.status).toBe(200);
    expect(res.json.data.status).toBe('withdrawn');
    expect(clientDoc().balanceKRW).toBe(START_BALANCE);
    expect(writesTo('mood_clients')).toHaveLength(0);
    expect(bookingDoc().status).toBe('confirmed');
  });

  it('재제안(supersede)은 이전 제안을 무효화하고 돈은 그대로 둔다', async () => {
    const first = await proposalIdOrThrow({ idempotencyKey: 'idem-propose-a' });
    const second = await proposalIdOrThrow({ idempotencyKey: 'idem-propose-b' });
    expect(second).not.toBe(first);
    expect(proposalDoc(first)).toMatchObject({ status: 'superseded', supersededByProposalId: second });
    expect(clientDoc().balanceKRW).toBe(START_BALANCE);
    expect(bookingDoc().settlementProposalVersion).toBe(2);

    const stale = await approveAs(MOOD_APPROVER_EMAIL, first, { idempotencyKey: 'idem-approve-stale' });
    expect(stale.status).toBe(409);
    expect(clientDoc().balanceKRW).toBe(START_BALANCE);
  });
});

describe('바인딩 — 오래된 제안은 승인되지 않는다', () => {
  it('제안 뒤 예약 revision 이 바뀌면 승인이 거부된다', async () => {
    const proposalId = await proposalIdOrThrow();
    await getSettlementDb().collection('mood_bookings').doc(BOOKING_ID).update({ revision: 99 });
    const res = await approveAs(MOOD_APPROVER_EMAIL, proposalId);
    expect(res.status).toBe(409);
    expect(res.json.error).toBe('STALE_REVISION');
    expect(clientDoc().balanceKRW).toBe(START_BALANCE);
  });

  it('제안 뒤 예약 원금이 바뀌면 승인이 거부된다', async () => {
    const proposalId = await proposalIdOrThrow();
    const revision = bookingDoc().revision;
    await getSettlementDb().collection('mood_bookings').doc(BOOKING_ID).update({ amountKRW: 400000, revision });
    const res = await approveAs(MOOD_APPROVER_EMAIL, proposalId);
    expect(res.status).toBe(409);
    expect(res.json.error).toBe('PROPOSAL_BOOKED_AMOUNT_MISMATCH');
    expect(clientDoc().balanceKRW).toBe(START_BALANCE);
  });

  it('저장된 제안 금액이 손상되면 서버 재계산이 이를 잡아 승인을 막는다', async () => {
    const proposalId = await proposalIdOrThrow();
    await getSettlementDb().collection('mood_settlement_proposals').doc(proposalId)
      .update({ finalAmountKRW: 5000000 });
    const res = await approveAs(MOOD_APPROVER_EMAIL, proposalId);
    expect(res.status).toBe(409);
    expect(clientDoc().balanceKRW).toBe(START_BALANCE);
  });

  it('예약의 승인 요약과 제안 version 이 어긋나면 승인을 막는다', async () => {
    const proposalId = await proposalIdOrThrow();
    const revision = bookingDoc().revision;
    await getSettlementDb().collection('mood_bookings').doc(BOOKING_ID)
      .update({ settlementProposalVersion: 7, revision });
    const res = await approveAs(MOOD_APPROVER_EMAIL, proposalId);
    expect(res.status).toBe(409);
    expect(res.json.error).toBe('PROPOSAL_VERSION_MISMATCH');
    expect(clientDoc().balanceKRW).toBe(START_BALANCE);
  });

  it('없는 제안은 404 다', async () => {
    actAs(MOOD_APPROVER_EMAIL);
    const res = await callRespond({ proposalId: 'no-such-proposal', action: 'approve', idempotencyKey: 'idem-404' });
    expect(res.status).toBe(404);
  });
});

describe('멱등성 — 재시도·동시 승인은 한 번만 적용된다', () => {
  it('같은 키로 승인을 재시도하면 같은 응답을 재생하고 잔액은 한 번만 바뀐다', async () => {
    const proposalId = await proposalIdOrThrow();
    const first = await approveAs(MOOD_APPROVER_EMAIL, proposalId, { idempotencyKey: 'idem-retry' });
    const second = await approveAs(MOOD_APPROVER_EMAIL, proposalId, { idempotencyKey: 'idem-retry' });

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(second.json.replayed).toBe(true);
    expect(second.json.data).toEqual(first.json.data);
    expect(clientDoc().balanceKRW).toBe(START_BALANCE - DELTA);
    expect(settlementMocks.sendEmail).toHaveBeenCalledTimes(1);
  });

  it('같은 키에 다른 요청이 오면 거부한다', async () => {
    const proposalId = await proposalIdOrThrow();
    await approveAs(MOOD_APPROVER_EMAIL, proposalId, { idempotencyKey: 'idem-conflict' });
    actAs(MOOD_APPROVER_EMAIL);
    const res = await callRespond({
      proposalId, action: 'request_changes', reason: '다른 요청', idempotencyKey: 'idem-conflict',
    });
    expect(res.status).toBe(409);
    expect(res.json.error).toBe('IDEMPOTENCY_CONFLICT');
    expect(clientDoc().balanceKRW).toBe(START_BALANCE - DELTA);
  });

  it('같은 제안에 서로 다른 키로 동시에 승인해도 잔액은 한 번만 바뀐다', async () => {
    const proposalId = await proposalIdOrThrow();
    actAs(MOOD_APPROVER_EMAIL);
    const [a, b] = await Promise.all([
      callRespond({ proposalId, action: 'approve', idempotencyKey: 'idem-race-a', acknowledgePendingTolls: true }),
      callRespond({ proposalId, action: 'approve', idempotencyKey: 'idem-race-b', acknowledgePendingTolls: true }),
    ]);
    const statuses = [a.status, b.status].sort();
    expect(statuses[0]).toBe(200);
    expect(statuses[1]).toBeGreaterThanOrEqual(400);
    expect(clientDoc().balanceKRW).toBe(START_BALANCE - DELTA);
  });
});

describe('정정(correction)도 같은 이중 확인을 거친다', () => {
  async function settleOnce() {
    const proposalId = await proposalIdOrThrow();
    const res = await approveAs(MOOD_APPROVER_EMAIL, proposalId);
    expect(res.status).toBe(200);
    return res;
  }

  it('정정 제안도 돈을 움직이지 않고, 승인해야 델타만 반영된다', async () => {
    await settleOnce();
    const balanceAfterInitial = clientDoc().balanceKRW;
    expect(balanceAfterInitial).toBe(START_BALANCE - DELTA);

    actAs(ADMIN_EMAIL);
    const correctionInput = {
      bookingId: BOOKING_ID,
      mode: 'correction',
      expectedRevision: bookingDoc().revision,
      reason: '누락된 톨비 영수증 1건 추가',
      tollMode: 'actual',
      actualTollKRW: 17300,
    };
    const preview = await callPreview(correctionInput);
    expect(preview.status).toBe(200);
    expect(getSettlementDb()._writes.filter((w) => w.path.startsWith('mood_clients/')).length).toBe(1);

    const propose = await callCorrect({
      ...correctionInput,
      previewHash: preview.json.data.previewHash,
      idempotencyKey: 'idem-correct-1',
    });
    expect(propose.status).toBe(200);
    expect(propose.json.data).toMatchObject({ mode: 'correction', status: 'awaiting_mood' });
    // 정정 제안 단계 — 잔액·최종금액 불변
    expect(clientDoc().balanceKRW).toBe(balanceAfterInitial);
    expect(bookingDoc().finalAmountKRW).toBe(FINAL);

    const correctionDelta = propose.json.data.deltaKRW;
    expect(correctionDelta).toBe(17300 - TOLL);

    const approved = await approveAs(MOOD_APPROVER_EMAIL, propose.json.data.proposalId, {
      idempotencyKey: 'idem-correct-approve',
    });
    expect(approved.status).toBe(200);
    expect(clientDoc().balanceKRW).toBe(balanceAfterInitial - correctionDelta);
    expect(bookingDoc()).toMatchObject({
      finalAmountKRW: FINAL + correctionDelta,
      correctionCount: 1,
      correctedByEmail: ADMIN_EMAIL,
      approvedByEmail: MOOD_APPROVER_EMAIL,
    });
  });

  it('정정 제안을 MOOD 가 수정 요청하면 금액은 그대로 남는다', async () => {
    await settleOnce();
    const balance = clientDoc().balanceKRW;
    actAs(ADMIN_EMAIL);
    const correctionInput = {
      bookingId: BOOKING_ID,
      mode: 'correction',
      expectedRevision: bookingDoc().revision,
      reason: '실제 시간 정정',
      actualHours: 11,
      // 저장된 톨비 근거가 여전히 미확정 5건이라 정정에서도 확인이 필요하다.
      acknowledgePendingTolls: true,
    };
    const preview = await callPreview(correctionInput);
    expect(preview.status).toBe(200);
    const propose = await callCorrect({
      ...correctionInput, previewHash: preview.json.data.previewHash, idempotencyKey: 'idem-correct-2',
    });
    expect(propose.status).toBe(200);

    actAs(MOOD_APPROVER_EMAIL);
    const res = await callRespond({
      proposalId: propose.json.data.proposalId,
      action: 'request_changes',
      reason: '실제 시간 근거 필요',
      idempotencyKey: 'idem-correct-rc',
    });
    expect(res.status).toBe(200);
    expect(clientDoc().balanceKRW).toBe(balance);
    expect(bookingDoc().finalAmountKRW).toBe(FINAL);
  });
});

describe('입력 계약', () => {
  it('POST 외 메서드는 405', async () => {
    actAs(MOOD_APPROVER_EMAIL);
    const res = await callRespond({}, 'GET');
    expect(res.status).toBe(405);
  });

  it('알 수 없는 action 은 400', async () => {
    const proposalId = await proposalIdOrThrow();
    actAs(MOOD_APPROVER_EMAIL);
    const res = await callRespond({ proposalId, action: 'settle_now', idempotencyKey: 'idem-bad-action' });
    expect(res.status).toBe(400);
    expect(res.json.error).toBe('INVALID_SETTLEMENT_ACTION');
  });

  it('멱등키가 없으면 400', async () => {
    const proposalId = await proposalIdOrThrow();
    actAs(MOOD_APPROVER_EMAIL);
    const res = await callRespond({ proposalId, action: 'approve' });
    expect(res.status).toBe(400);
    expect(res.json.error).toBe('INVALID_IDEMPOTENCY_KEY');
  });

  it('취소된 예약의 제안은 승인되지 않는다', async () => {
    const proposalId = await proposalIdOrThrow();
    const revision = bookingDoc().revision;
    await getSettlementDb().collection('mood_bookings').doc(BOOKING_ID)
      .update({ status: 'cancelled', revision });
    const res = await approveAs(MOOD_APPROVER_EMAIL, proposalId);
    expect(res.status).toBe(409);
    expect(res.json.error).toBe('BOOKING_NOT_SETTLEABLE');
    expect(clientDoc().balanceKRW).toBe(START_BALANCE);
  });

  it('공항 정액 서비스는 애초에 제안되지 않는다', async () => {
    resetSettlementWorld({ booking: confirmedBooking({ serviceType: 'airport' }) });
    const { preview } = await proposeInitial();
    expect(preview.status).toBeGreaterThanOrEqual(400);
    expect(clientDoc().balanceKRW).toBe(START_BALANCE);
  });
});
