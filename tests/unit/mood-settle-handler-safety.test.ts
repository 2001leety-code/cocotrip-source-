/**
 * mood-settle.js(제안) → mood-settle-respond.js(승인) 이중 확인 계약.
 *
 * 🔴 mood-settle.js 는 이제 제안만 만든다 — 검증/계산 실패는 그대로 그 자리에서 막히고
 * (아래 각 케이스), **성공** 케이스만 이어서 MOOD 승인자가 승인해야 잔액·완료 상태가 커밋된다.
 * 검증 순서상 previewHash 실제 일치 비교는 각 검증을 통과한 뒤 맨 마지막에 일어나므로,
 * 실패를 기대하는 테스트는 형식만 맞는 더미 해시(64자리 hex)를 써도 그 앞에서 막힌다.
 */
/* eslint-disable @typescript-eslint/no-explicit-any -- Firestore와 Vercel 응답을 작게 모사한다. */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ADMIN_EMAIL,
  BOOKING_ID,
  CLIENT_ID,
  MOOD_APPROVER_EMAIL,
  actAs,
  bookingDoc,
  callPreview,
  callRespond,
  callSettle,
  clientDoc,
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
function nextKey(prefix: string) {
  idemCounter += 1;
  return `${prefix}-${idemCounter}`;
}

function validBody(overrides: Record<string, any> = {}) {
  return {
    bookingId: BOOKING_ID,
    actualHours: 4,
    tollMode: 'estimated',
    manualAdjustmentKRW: 0,
    settlementReason: '',
    expectedRevision: bookingDoc()?.revision || 2,
    previewHash: DUMMY_HASH,
    idempotencyKey: nextKey('propose'),
    ...overrides,
  };
}

function validBooking(overrides: Record<string, any> = {}) {
  return {
    clientId: CLIENT_ID,
    clientName: 'MOOD',
    status: 'confirmed',
    revision: 2,
    amountKRW: 173000,
    ratePerHour: 30000,
    date: '2026-08-20',
    startTime: '09:30',
    durationHours: 4,
    serviceType: 'vehicle',
    breakdown: {
      baseKRW: 120000,
      distanceSurchargeKRW: 48000,
      tollKRW: 5000,
      km: 80,
      origin: '서울역',
      destination: '인천공항',
      waypoints: ['성수동'],
    },
    coursePayers: ['mood', 'influencer', 'influencer'],
    createdByEmail: null,
    ...overrides,
  };
}

/** 검증 실패를 기대하는 호출 — DB 를 건드리지 않아야 함을 함께 증명한다. */
async function proposeRejected(overrides: Record<string, any> = {}) {
  const before = getSettlementDb()._writes.length;
  const res = await callSettle(validBody(overrides));
  return { res, writesAfter: getSettlementDb()._writes.length - before };
}

/** 미리보기 → 제안 → MOOD 승인까지 실제로 태워, 승인 시점에만 돈이 움직임을 증명한다. */
async function proposeAndApprove(overrides: Record<string, any> = {}) {
  const body = validBody(overrides);
  delete (body as any).previewHash;
  delete (body as any).idempotencyKey;
  const preview = await callPreview(body);
  if (preview.status !== 200) return { stage: 'preview' as const, preview };
  const propose = await callSettle({ ...body, previewHash: preview.json.data.previewHash, idempotencyKey: nextKey('propose-ok') });
  if (propose.status !== 200) return { stage: 'propose' as const, preview, propose };
  // 🔴 제안 직후에는 잔액도 예약 상태도 절대 바뀌지 않는다.
  expect(clientDoc().balanceKRW).toBe(500000);
  expect(bookingDoc().status).toBe('confirmed');
  actAs(MOOD_APPROVER_EMAIL);
  const approve = await callRespond({
    proposalId: propose.json.data.proposalId,
    action: 'approve',
    idempotencyKey: nextKey('approve-ok'),
    acknowledgePendingTolls: true,
  });
  actAs(ADMIN_EMAIL);
  return { stage: 'approve' as const, preview, propose, approve };
}

beforeEach(() => {
  idemCounter = 0;
  resetSettlementWorld({ booking: validBooking(), client: { name: 'MOOD', balanceKRW: 500000 } });
  settlementMocks.computeRoute.mockResolvedValue({
    ok: true, km: 80, tollKRW: 5000, durationMin: 95, path: [[126.9, 37.5], [127, 37.6]], points: [],
  });
});

describe('mood-settle 실제 톨비 선택', () => {
  it('estimated는 예약의 예상 톨비를 유지한다', async () => {
    const { approve } = await proposeAndApprove();

    expect(approve!.status).toBe(200);
    expect(approve!.json.data).toMatchObject({ finalAmountKRW: 173000, deltaKRW: 0, balanceKRW: 500000 });
    expect(bookingDoc()).toMatchObject({
      status: 'completed',
      finalAmountKRW: 173000,
      adjustmentKRW: 0,
      estimatedTollKRW: 5000,
      tollMode: 'estimated',
      revision: 4,
      finalBreakdown: { tollKRW: 5000, estimatedTollKRW: 5000 },
    });
    expect(clientDoc().balanceKRW).toBe(500000);
  });

  it('none은 실제 톨비를 0원으로 바꾸고 차액을 잔액에 환원한다', async () => {
    const { approve } = await proposeAndApprove({ tollMode: 'none', settlementReason: '하이패스 비용이 발생하지 않음' });

    expect(approve!.status).toBe(200);
    expect(approve!.json.data).toMatchObject({ finalAmountKRW: 168000, deltaKRW: -5000, balanceKRW: 505000 });
    expect(bookingDoc()).toMatchObject({
      tollMode: 'none',
      settlementReason: '하이패스 비용이 발생하지 않음',
      finalBreakdown: { tollKRW: 0, estimatedTollKRW: 5000 },
    });
    expect(clientDoc().balanceKRW).toBe(505000);
  });

  it('actual은 직접 입력한 실제 톨비만 반영한다', async () => {
    const { approve } = await proposeAndApprove({ tollMode: 'actual', actualTollKRW: 2000, settlementReason: '실제 톨게이트 영수증 반영' });

    expect(approve!.status).toBe(200);
    expect(approve!.json.data).toMatchObject({ finalAmountKRW: 170000, deltaKRW: -3000, balanceKRW: 503000 });
    expect(bookingDoc()).toMatchObject({ tollMode: 'actual', finalBreakdown: { tollKRW: 2000, estimatedTollKRW: 5000 } });
  });

  it('실제 톨비 직접 입력은 빈값이 아닌 0~1,000,000원 정수만 허용한다', async () => {
    for (const actualTollKRW of ['', '   ', null, -1, 1.5, 1000001, 'not-money']) {
      const { res, writesAfter } = await proposeRejected({ tollMode: 'actual', actualTollKRW, settlementReason: '실제 톨비 확인' });
      expect.soft(res.status).toBe(400);
      expect.soft(res.json.error).toBe('INVALID_ACTUAL_TOLL');
      expect.soft(writesAfter).toBe(0);
    }
  });

  it('알 수 없는 tollMode를 기본값으로 바꾸지 않고 400으로 거절한다', async () => {
    const { res, writesAfter } = await proposeRejected({ tollMode: 'free' });
    expect.soft(res.status).toBe(400);
    expect.soft(res.json.error).toBe('INVALID_TOLL_MODE');
    expect.soft(writesAfter).toBe(0);
  });
});

describe('mood-settle 실제 코스별 MOOD 부담률', () => {
  it('실제 경로를 바꾸면 최종 지점 수와 같은 부담률 배열을 함께 저장한다', async () => {
    const courseMoodPercentages = [100, 50, 0];
    const { propose, approve } = await proposeAndApprove({
      origin: '실제 출발지', waypoints: ['추가 방문지'], destination: '실제 도착지', courseMoodPercentages,
    });

    expect(propose!.status).toBe(200);
    expect(propose!.json.data.settlementApproval.finalBreakdown).toMatchObject({
      origin: '실제 출발지', waypoints: ['추가 방문지'], destination: '실제 도착지',
    });
    expect(approve!.status).toBe(200);
    expect(bookingDoc()).toMatchObject({
      courseMoodPercentages, courseShareSchemaVersion: 2, coursePayers: null,
      finalBreakdown: { origin: '실제 출발지', waypoints: ['추가 방문지'], destination: '실제 도착지' },
    });
  });

  it('실제 경로의 지점 수와 부담률 길이가 다르거나 값이 잘못되면 계산 전에 거부한다', async () => {
    const cases = [
      { origin: '출발', destination: '도착' },
      { origin: '출발', destination: '도착', courseMoodPercentages: [100] },
      { origin: '출발', destination: '도착', courseMoodPercentages: [100, 101] },
    ];
    for (const override of cases) {
      settlementMocks.computeRoute.mockClear();
      const { res, writesAfter } = await proposeRejected(override);
      expect.soft(res.status).toBe(400);
      expect.soft(res.json.error).toBe('INVALID_COURSE_MOOD_PERCENTAGES');
      expect.soft(settlementMocks.computeRoute).not.toHaveBeenCalled();
      expect.soft(writesAfter).toBe(0);
    }
  });

  it('경로 변경 없이 부담률만 보내는 모호한 요청은 거부한다', async () => {
    const { res, writesAfter } = await proposeRejected({ courseMoodPercentages: [100, 50, 0] });
    expect(res.status).toBe(400);
    expect(res.json.error).toBe('INVALID_COURSE_MOOD_PERCENTAGES');
    expect(writesAfter).toBe(0);
  });

  it('실제 경로 변경 요청의 구 coursePayers 필드는 canonical 값으로 조용히 바꾸지 않고 거부한다', async () => {
    const { res, writesAfter } = await proposeRejected({
      origin: '실제 출발지', destination: '실제 도착지', courseMoodPercentages: [100, 0], coursePayers: ['mood', 'influencer'],
    });
    expect(res.status).toBe(400);
    expect(res.json.error).toBe('INVALID_COURSE_MOOD_PERCENTAGES');
    expect(settlementMocks.computeRoute).not.toHaveBeenCalled();
    expect(writesAfter).toBe(0);
  });

  it('비율 필드가 전혀 없는 레거시 예약은 기본 100·0 배열로 올려 정산한다', async () => {
    const booking = validBooking();
    delete (booking as any).coursePayers;
    resetSettlementWorld({ booking, client: { name: 'MOOD', balanceKRW: 500000 } });
    settlementMocks.computeRoute.mockResolvedValue({
      ok: true, km: 80, tollKRW: 5000, durationMin: 95, path: [[126.9, 37.5], [127, 37.6]], points: [],
    });

    const { approve } = await proposeAndApprove();

    expect(approve!.status).toBe(200);
    expect(bookingDoc()).toMatchObject({
      courseMoodPercentages: [100, 0, 0], courseShareSchemaVersion: 2, coursePayers: ['mood', 'influencer', 'influencer'],
    });
  });

  it('손상된 v2 예약은 유효한 구 coursePayers가 있어도 되돌리지 않고 정산을 막는다', async () => {
    resetSettlementWorld({
      booking: validBooking({ courseMoodPercentages: [100, '50', 0], courseShareSchemaVersion: 2, coursePayers: ['mood', 'influencer', 'influencer'] }),
      client: { name: 'MOOD', balanceKRW: 500000 },
    });
    const { res, writesAfter } = await proposeRejected();
    expect(res.status).toBe(409);
    expect(res.json.error).toBe('INVALID_STORED_COURSE_SHARE');
    expect(writesAfter).toBe(0);
  });
});

describe('mood-settle 수동 금액 조정과 사유', () => {
  it('수동 조정액을 최종 금액에 더하고 전체 차액만 잔액에서 조정한다', async () => {
    const { approve } = await proposeAndApprove({
      tollMode: 'actual', actualTollKRW: 2000, manualAdjustmentKRW: 10000, settlementReason: '추가 주차비 10,000원과 실제 톨비 반영',
    });

    expect(approve!.status).toBe(200);
    expect(approve!.json.data).toMatchObject({ finalAmountKRW: 180000, deltaKRW: 7000, balanceKRW: 493000 });
    expect(bookingDoc()).toMatchObject({
      finalAmountKRW: 180000, adjustmentKRW: 7000, manualAdjustmentKRW: 10000,
      settlementReason: '추가 주차비 10,000원과 실제 톨비 반영',
    });
    expect(clientDoc().balanceKRW).toBe(493000);
  });

  it('톨비 변경이나 0이 아닌 수동 조정에는 사유가 필수다', async () => {
    const cases = [{ tollMode: 'none' }, { tollMode: 'actual', actualTollKRW: 2000 }, { manualAdjustmentKRW: 1000 }];
    for (const override of cases) {
      const { res, writesAfter } = await proposeRejected(override);
      expect.soft(res.status).toBe(400);
      expect.soft(res.json.error).toBe('SETTLEMENT_REASON_REQUIRED');
      expect.soft(writesAfter).toBe(0);
    }
  });

  it('수동 조정은 ±10,000,000원 이내 정수이며 최종 금액은 음수가 될 수 없다', async () => {
    let result = await proposeRejected({ manualAdjustmentKRW: 10000001, settlementReason: '한도 초과' });
    expect(result.res.status).toBe(400);
    expect(result.res.json.error).toBe('INVALID_MANUAL_ADJUSTMENT');

    result = await proposeRejected({ manualAdjustmentKRW: -200000, settlementReason: '과도한 감액' });
    expect(result.res.status).toBe(400);
    expect(result.res.json.error).toBe('INVALID_FINAL_AMOUNT');
    expect(result.writesAfter).toBe(0);
  });
});

describe('mood-settle 개정 번호 경쟁 방지', () => {
  it('preSnap 이후 승자가 먼저 커밋되면 패자는 BOOKING_CHANGED 로 막히고 잔액은 그대로다', async () => {
    const body = validBody();
    delete (body as any).previewHash;
    const preview = await callPreview(body);
    expect(preview.status).toBe(200);
    const requestA = { ...body, previewHash: preview.json.data.previewHash, idempotencyKey: nextKey('race-a') };
    const requestB = { ...body, previewHash: preview.json.data.previewHash, idempotencyKey: nextKey('race-b') };

    const [a, b] = await Promise.all([callSettle(requestA), callSettle(requestB)]);
    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual([200, 409]);
    const loser = a.status === 409 ? a : b;
    expect(loser.json.error).toBe('BOOKING_CHANGED');
    expect(clientDoc().balanceKRW).toBe(500000);
  });
});

describe('mood-settle 손상 금액 fail-closed', () => {
  it('예약 원금이 숫자가 아니면 정산·잔액 변경을 거부한다', async () => {
    resetSettlementWorld({ booking: validBooking({ amountKRW: 'not-money' }), client: { name: 'MOOD', balanceKRW: 500000 } });
    const { res, writesAfter } = await proposeRejected();
    expect(res.status).toBe(409);
    expect(res.json.error).toBe('INVALID_BOOKING_AMOUNT');
    expect(writesAfter).toBe(0);
  });

  it('고객 잔액이 숫자가 아니면 정산·잔액 변경을 거부한다', async () => {
    // previewHash 는 예약/입력에서만 나오고 고객 잔액과 무관 — 정상 상태에서 지문을 받은 뒤
    // 잔액만 손상시켜, mood-settle.js 트랜잭션 자체의 잔액 검증을 독립적으로 증명한다.
    const body = validBody();
    delete (body as any).previewHash;
    const preview = await callPreview(body);
    expect(preview.status).toBe(200);
    await getSettlementDb().collection('mood_clients').doc(CLIENT_ID).update({ balanceKRW: 'not-money' });
    const before = getSettlementDb()._writes.length;
    const res = await callSettle({ ...body, previewHash: preview.json.data.previewHash });
    expect(res.status).toBe(409);
    expect(res.json.error).toBe('INVALID_CLIENT_BALANCE');
    expect(getSettlementDb()._writes.length - before).toBe(0);
  });

  it('숫자 모양 문자열도 Firestore 금액 타입 손상으로 보고 거부한다', async () => {
    resetSettlementWorld({ booking: validBooking({ amountKRW: '173000' }), client: { name: 'MOOD', balanceKRW: 500000 } });
    const result = await proposeRejected();
    expect.soft(result.res.status).toBe(409);
    expect.soft(result.res.json.error).toBe('INVALID_BOOKING_AMOUNT');
    expect.soft(result.writesAfter).toBe(0);

    resetSettlementWorld({ booking: validBooking(), client: { name: 'MOOD', balanceKRW: 500000 } });
    settlementMocks.computeRoute.mockResolvedValue({
      ok: true, km: 80, tollKRW: 5000, durationMin: 95, path: [[126.9, 37.5], [127, 37.6]], points: [],
    });
    const body = validBody();
    delete (body as any).previewHash;
    const preview = await callPreview(body);
    expect.soft(preview.status).toBe(200);
    await getSettlementDb().collection('mood_clients').doc(CLIENT_ID).update({ balanceKRW: '500000' });
    const before = getSettlementDb()._writes.length;
    const res2 = await callSettle({ ...body, previewHash: preview.json.data.previewHash });
    expect.soft(res2.status).toBe(409);
    expect.soft(res2.json.error).toBe('INVALID_CLIENT_BALANCE');
    expect.soft(getSettlementDb()._writes.length - before).toBe(0);
  });

  it('저장된 거리·예상 톨비가 손상되면 0원으로 바꾸어 정산하지 않는다', async () => {
    resetSettlementWorld({
      booking: validBooking({ breakdown: { km: 'not-distance', tollKRW: 'not-toll', origin: '서울역', destination: '인천공항' } }),
      client: { name: 'MOOD', balanceKRW: 500000 },
    });
    const { res, writesAfter } = await proposeRejected();
    expect.soft(res.status).toBe(409);
    expect.soft(res.json.error).toBe('INVALID_BOOKING_BREAKDOWN');
    expect.soft(writesAfter).toBe(0);
  });

  it('경로 재계산 성공 봉투의 숫자가 손상되면 과소 정산하지 않는다', async () => {
    settlementMocks.computeRoute.mockResolvedValue({ ok: true, km: Number.NaN, tollKRW: Number.NaN, durationMin: Number.NaN, path: [], points: [] });
    const { res, writesAfter } = await proposeRejected({ origin: '실제 출발지', destination: '실제 도착지', courseMoodPercentages: [100, 0] });
    expect.soft(res.status).toBe(422);
    expect.soft(res.json.error).toBe('ROUTE_RECALCULATION_FAILED');
    expect.soft(writesAfter).toBe(0);
  });
});
