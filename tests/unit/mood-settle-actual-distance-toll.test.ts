/**
 * MOOD 정산 — 실사용 거리(총 주행 − 제외거리)와 항목별 톨비 (2026-08-20 확정 케이스 회귀).
 * 이중 확인 계약: mood-settle.js/mood-settle-correct.js 는 제안만 만든다. 아래 확정 사례의
 * 최종 금액·잔액은 mood-settle-respond.js 의 approve 로만 커밋된다.
 *
 * 확정 사례: 타임라인 총 438km, 픽업 전 제외 46km → 서버가 계산한 정산거리는 392km.
 * 톨비 항목 합계 16,100원(포함) + 카드충전 10,000원(제외) → 서버 합산 톨비는 16,100원만.
 * actualHours=10, 예약 당시 단가 30,000원/h → 최종 551,300원, 예약가(537,740) 대비 +13,560.
 */
/* eslint-disable @typescript-eslint/no-explicit-any -- Firestore/Vercel 응답을 작게 모사한다. */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ADMIN_EMAIL,
  BOOKING_ID,
  MOOD_APPROVER_EMAIL,
  actAs,
  actualUsagePayload,
  bookingDoc,
  callCorrect,
  callPreview,
  callRespond,
  callSettle,
  clientDoc,
  confirmedBooking,
  getSettlementDb,
  resetSettlementWorld,
  settlementMocks,
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

const DUMMY_HASH = 'a'.repeat(64);
let idemCounter = 0;
function nextKey(prefix: string) { idemCounter += 1; return `settle-${prefix}-${idemCounter}`; }

/** 즉시 거절을 기대하는 호출 — 형식만 맞는 더미 지문으로도 검증 순서상 그 앞에서 막힌다. */
function rejectBody(overrides: Record<string, any> = {}) {
  return {
    bookingId: BOOKING_ID,
    expectedRevision: bookingDoc()?.revision || 1,
    previewHash: DUMMY_HASH,
    idempotencyKey: nextKey('reject'),
    ...overrides,
  };
}

beforeEach(() => {
  idemCounter = 0;
  resetSettlementWorld();
});

describe('mood-settle 실사용 거리 — 2026-08-20 확정 사례 회귀', () => {
  it('총 438km − 제외 46km = 392km, 톨비 항목 16,100원만 포함 → 제안은 무변경, 승인 시 최종 551,300원(+13,560)', async () => {
    const payload = actualUsagePayload({ expectedRevision: 1 });
    const preview = await callPreview(payload);
    expect(preview.status).toBe(200);
    expect(preview.json.data).toMatchObject({
      revision: 1, baseKRW: 300000, distanceSurchargeKRW: 235200, tollKRW: 16100,
      finalAmountKRW: 551300, deltaKRW: 13560, currentBalanceKRW: 1000000, resultingBalanceKRW: 986440,
    });

    const propose = await callSettle({ ...payload, previewHash: preview.json.data.previewHash, idempotencyKey: nextKey('propose') });
    expect(propose.status).toBe(200);
    expect(propose.json.data).toMatchObject({ finalAmountKRW: 551300, deltaKRW: 13560, proposedResultingBalanceKRW: 986440 });
    // 🔴 제안만으로 잔액·완료 상태는 절대 바뀌지 않는다.
    expect(clientDoc().balanceKRW).toBe(1000000);
    expect(bookingDoc().status).toBe('confirmed');

    actAs(MOOD_APPROVER_EMAIL);
    const approve = await callRespond({ proposalId: propose.json.data.proposalId, action: 'approve', idempotencyKey: nextKey('approve'), acknowledgePendingTolls: true });
    expect(approve.status).toBe(200);
    expect(approve.json.data).toMatchObject({ finalAmountKRW: 551300, deltaKRW: 13560, balanceKRW: 986440 });
    expect(bookingDoc()).toMatchObject({
      finalAmountKRW: 551300,
      finalBreakdown: { km: 392, distanceSource: 'manual', actualTotalKm: 438, excludedKm: 46, tollKRW: 16100 },
      tollMode: 'itemized', balanceAfterKRW: 986440,
    });
    expect(clientDoc().balanceKRW).toBe(986440);
    const auditWrites = getSettlementDb()._writes.filter((w) => w.path.startsWith('mood_settlement_audit/'));
    expect(auditWrites).toHaveLength(1);
    expect(auditWrites[0].data).toMatchObject({
      type: 'initial', bookingId: BOOKING_ID, deltaKRW: 13560, previousBalanceKRW: 1000000, newBalanceKRW: 986440, byEmail: MOOD_APPROVER_EMAIL,
      tollEntries: expect.arrayContaining([
        expect.objectContaining({ label: '서울 → 평택', status: 'pending', includedInSettlement: true }),
        expect.objectContaining({ label: '충전(제외내역)', amountKRW: 10000, includedInSettlement: false }),
      ]),
    });
  });

  it('제외거리가 총 주행거리를 넘으면 거부한다', async () => {
    const res = await callSettle(rejectBody({ actualHours: 10, actualTotalKm: 100, excludedKm: 200, settlementReason: '오류 케이스' }));
    expect(res.status).toBe(400);
    expect(res.json.error).toBe('EXCLUDED_KM_EXCEEDS_TOTAL');
    expect(bookingDoc().status).toBe('confirmed');
  });

  it('음수·비정상 실사용 거리를 거부한다', async () => {
    for (const bad of [-10, Number.NaN, 5000]) {
      const res = await callSettle(rejectBody({ actualHours: 10, actualTotalKm: bad, excludedKm: 0, settlementReason: '오류 케이스' }));
      expect.soft(res.status).toBe(400);
      expect.soft(res.json.error).toBe('INVALID_ACTUAL_TOTAL_KM');
    }
  });

  it('클라가 정산거리·톨비 합계를 조작해 보내도 서버가 무시하고 재계산한다', async () => {
    const body = rejectBody({
      actualHours: 10, actualTotalKm: 438, excludedKm: 46, billableKm: 1, km: 1,
      tollMode: 'itemized',
      tollEntries: [
        { label: '경부고속도로', amountKRW: 9600, status: 'confirmed', includedInSettlement: true },
        { label: '인천대교', amountKRW: 6500, status: 'confirmed', includedInSettlement: true },
      ],
      settlementReason: '조작 방지 확인',
      previewHash: undefined,
    });
    const preview = await callPreview(body);
    expect(preview.status).toBe(200);
    const res = await callSettle({ ...body, previewHash: preview.json.data.previewHash });
    expect(res.status).toBe(200);
    expect(res.json.data.settlementApproval.finalBreakdown).toMatchObject({ km: 392, tollKRW: 16100 });
  });

  it('경로 재측정(origin/destination)과 실사용 거리 입력을 동시에 보내면 거부한다', async () => {
    const res = await callSettle(rejectBody({
      actualHours: 10, actualTotalKm: 438, excludedKm: 46, origin: '서울역', destination: '인천공항', courseMoodPercentages: [100, 0], settlementReason: '충돌 케이스',
    }));
    expect(res.status).toBe(400);
    expect(res.json.error).toBe('CONFLICTING_DISTANCE_SOURCE');
  });

  it('실사용 거리 입력에는 사유가 필수다', async () => {
    const res = await callSettle(rejectBody({ actualHours: 10, actualTotalKm: 438, excludedKm: 46 }));
    expect(res.status).toBe(400);
    expect(res.json.error).toBe('SETTLEMENT_REASON_REQUIRED');
  });
});

describe('mood-settle 항목별 톨비(itemized)', () => {
  it('포함할 미확정 톨비가 있으면 잠정 정산 확인이 필수다', async () => {
    const payload = actualUsagePayload({ expectedRevision: 1, previewHash: DUMMY_HASH, idempotencyKey: nextKey('ack') });
    delete (payload as any).acknowledgePendingTolls;
    const res = await callSettle(payload);
    expect(res.status).toBe(400);
    expect(res.json.error).toBe('PENDING_TOLL_ACK_REQUIRED');
    expect(bookingDoc().status).toBe('confirmed');
  });

  it('상태값이 잘못됐거나 라벨이 없으면 거부한다', async () => {
    const res = await callSettle(rejectBody({
      actualHours: 10, tollMode: 'itemized',
      tollEntries: [{ label: '', amountKRW: 1000, status: 'confirmed', includedInSettlement: true }],
      settlementReason: '오류',
    }));
    expect(res.status).toBe(400);
    expect(res.json.error).toBe('INVALID_TOLL_ENTRY_LABEL');
  });

  it('행 개수 상한(50)을 넘으면 거부한다', async () => {
    const entries = Array.from({ length: 51 }, (_, i) => ({ label: `행${i}`, amountKRW: 100, status: 'confirmed', includedInSettlement: true }));
    const res = await callSettle(rejectBody({ actualHours: 10, tollMode: 'itemized', tollEntries: entries, settlementReason: '오류' }));
    expect(res.status).toBe(400);
    expect(res.json.error).toBe('TOO_MANY_TOLL_ENTRIES');
  });
});

describe('mood-settle 미리보기와 확정 일치', () => {
  it('미리보기는 쓰기 0건이고, 같은 지문으로 만든 제안의 금액·잔액 예고치가 완전히 같다', async () => {
    const payload = actualUsagePayload({ expectedRevision: 1 });
    const preview = await callPreview(payload);
    expect(preview.status).toBe(200);
    expect(preview.json.data).toMatchObject({
      revision: 1, baseKRW: 300000, distanceSurchargeKRW: 235200, tollKRW: 16100,
      finalAmountKRW: 551300, deltaKRW: 13560, currentBalanceKRW: 1000000, resultingBalanceKRW: 986440,
    });
    expect(getSettlementDb()._writes).toHaveLength(0);

    const committed = await callSettle({ ...payload, previewHash: preview.json.data.previewHash, idempotencyKey: nextKey('match') });
    expect(committed.status).toBe(200);
    expect(committed.json.data).toMatchObject({
      finalAmountKRW: preview.json.data.finalAmountKRW,
      deltaKRW: preview.json.data.deltaKRW,
      proposedResultingBalanceKRW: preview.json.data.resultingBalanceKRW,
    });
    expect(committed.json.data.settlementApproval.finalBreakdown).toMatchObject({
      baseKRW: preview.json.data.baseKRW, distanceSurchargeKRW: preview.json.data.distanceSurchargeKRW, tollKRW: preview.json.data.tollKRW,
    });
  });

  it('경로와 코스 부담률을 같은 미리보기 지문에 묶고, 바뀐 부담률로 제안하지 못하게 한다', async () => {
    const payload = {
      bookingId: BOOKING_ID, actualHours: 10, origin: '서울역', destination: '당진', waypoints: [],
      courseMoodPercentages: [100, 0], courseShareSchemaVersion: 2, tollMode: 'actual', actualTollKRW: 16100,
      settlementReason: '실제 경로와 코스 부담률 확인', expectedRevision: 1,
    };
    const preview = await callPreview(payload);
    expect(preview.status).toBe(200);
    expect(preview.json.data).toMatchObject({ courseMoodPercentages: [100, 0], courseShareSchemaVersion: 2, finalAmountKRW: 551300 });

    const changed = await callSettle({ ...payload, courseMoodPercentages: [0, 100], previewHash: preview.json.data.previewHash, idempotencyKey: nextKey('changed') });
    expect(changed.status).toBe(409);
    expect(changed.json.error).toBe('PREVIEW_MISMATCH');
    expect(bookingDoc().status).toBe('confirmed');

    const propose = await callSettle({ ...payload, previewHash: preview.json.data.previewHash, idempotencyKey: nextKey('propose-ok') });
    expect(propose.status).toBe(200);
    actAs(MOOD_APPROVER_EMAIL);
    const approve = await callRespond({ proposalId: propose.json.data.proposalId, action: 'approve', idempotencyKey: nextKey('approve-ok') });
    expect(approve.status).toBe(200);
    expect(bookingDoc()).toMatchObject({ courseMoodPercentages: [100, 0], courseShareSchemaVersion: 2 });
  });

  it('경로 미리보기도 잘못된 부담률·구 필드를 확정과 같은 오류로 거부한다', async () => {
    const invalidPercentage = await callPreview({ bookingId: BOOKING_ID, actualHours: 10, origin: '서울역', destination: '당진', courseMoodPercentages: [100] });
    expect(invalidPercentage.status).toBe(400);
    expect(invalidPercentage.json.error).toBe('INVALID_COURSE_MOOD_PERCENTAGES');
    expect(settlementMocks.computeRoute).not.toHaveBeenCalled();

    const legacyPayers = await callPreview({ bookingId: BOOKING_ID, actualHours: 10, origin: '서울역', destination: '당진', courseMoodPercentages: [100, 0], coursePayers: ['mood', 'influencer'] });
    expect(legacyPayers.status).toBe(400);
    expect(legacyPayers.json.error).toBe('INVALID_COURSE_MOOD_PERCENTAGES');
    expect(settlementMocks.computeRoute).not.toHaveBeenCalled();
  });

  it('손상된 저장 코스 부담률은 미리보기와 제안 모두 같은 오류로 막는다', async () => {
    resetSettlementWorld({ booking: confirmedBooking({ courseMoodPercentages: [100], courseShareSchemaVersion: 2 }) });
    const preview = await callPreview(actualUsagePayload({ expectedRevision: 1 }));
    expect(preview.status).toBe(409);
    expect(preview.json.error).toBe('INVALID_STORED_COURSE_SHARE');

    const usage = actualUsagePayload({ expectedRevision: 1 });
    const committed = await callSettle(rejectBody(usage));
    expect(committed.status).toBe(409);
    expect(committed.json.error).toBe('INVALID_STORED_COURSE_SHARE');
    expect(bookingDoc().status).toBe('confirmed');
  });
});

describe('mood-settle 미리보기 예상 revision (STALE_REVISION)', () => {
  it('expectedRevision 이 저장된 revision 과 다르면 정산을 막는다', async () => {
    resetSettlementWorld({ booking: confirmedBooking({ revision: 5 }) });
    const res = await callSettle(rejectBody({ actualHours: 8, expectedRevision: 1 }));
    expect(res.status).toBe(409);
    expect(res.json.error).toBe('STALE_REVISION');
    expect(bookingDoc().revision).toBe(5);
  });

  it('expectedRevision 이 일치하면 제안이 정상 진행한다(잔액은 그대로)', async () => {
    const body = { bookingId: BOOKING_ID, actualHours: 8, expectedRevision: 1, settlementReason: '' };
    const preview = await callPreview(body);
    expect(preview.status).toBe(200);
    const res = await callSettle({ ...body, previewHash: preview.json.data.previewHash, idempotencyKey: nextKey('stale-ok') });
    expect(res.status).toBe(200);
    expect(res.json.data.revision).toBe(2);
    expect(clientDoc().balanceKRW).toBe(1000000);
  });
});

describe('정정(mood-settle-correct)도 같은 확정 사례 금액을 쓴다', () => {
  it('완료된 예약을 정정 제안해도 승인 전까지 잔액은 그대로다', async () => {
    // 먼저 확정 사례로 완료시킨다.
    const initialPayload = actualUsagePayload({ expectedRevision: 1 });
    const preview1 = await callPreview(initialPayload);
    const propose1 = await callSettle({ ...initialPayload, previewHash: preview1.json.data.previewHash, idempotencyKey: nextKey('init') });
    actAs(MOOD_APPROVER_EMAIL);
    await callRespond({ proposalId: propose1.json.data.proposalId, action: 'approve', idempotencyKey: nextKey('init-approve'), acknowledgePendingTolls: true });
    actAs(ADMIN_EMAIL);
    expect(bookingDoc().finalAmountKRW).toBe(551300);

    const correctionInput = {
      bookingId: BOOKING_ID, mode: 'correction', expectedRevision: bookingDoc().revision,
      reason: '톨비 1건 누락 추가', tollMode: 'actual', actualTollKRW: 17300,
    };
    const preview2 = await callPreview(correctionInput);
    expect(preview2.status).toBe(200);
    const propose2 = await callCorrect({ ...correctionInput, previewHash: preview2.json.data.previewHash, idempotencyKey: nextKey('correct') });
    expect(propose2.status).toBe(200);
    expect(propose2.json.data.status).toBe('awaiting_mood');
    expect(clientDoc().balanceKRW).toBe(986440); // 정정 제안만으로 불변
    expect(bookingDoc().finalAmountKRW).toBe(551300);
  });
});
