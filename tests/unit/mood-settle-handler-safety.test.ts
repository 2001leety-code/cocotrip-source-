/* eslint-disable @typescript-eslint/no-explicit-any -- Firestore와 Vercel 응답을 작게 모사한다. */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const verifyUserTokenMock = vi.fn();
const computeRouteMock = vi.fn();
const notifyMock = vi.fn();
const sendEmailMock = vi.fn();

vi.mock('../../api/_shared/user-auth.js', () => ({
  verifyUserToken: verifyUserTokenMock,
}));
vi.mock('../../api/_shared/firebase-admin.js', () => ({
  initAdminDb: () => dbMock,
}));
vi.mock('../../api/_shared/mood-allowlist.js', () => ({
  getMoodAllowlist: async () => ({ admins: ['admin@x.com'] }),
  isAdminEmail: (allowlist: any, email: string) => allowlist.admins.includes(email),
}));
vi.mock('../../api/_shared/mood-route.js', () => ({
  computeRoute: computeRouteMock,
}));
vi.mock('../../api/_shared/cors.js', () => ({
  buildAdminJsonCors: () => ({ 'Content-Type': 'application/json' }),
}));
vi.mock('../../api/_shared/sentry.js', () => ({ captureError: vi.fn() }));
vi.mock('../../api/_shared/notify.js', () => ({ notify: notifyMock }));
vi.mock('../../api/_shared/mood-receipt.js', () => ({
  buildMoodSettlementReceiptEmail: () => ({ subject: 'receipt', html: '<p>receipt</p>', text: 'receipt' }),
}));
vi.mock('../../api/_send-email.js', () => ({ sendEmail: sendEmailMock }));

type StoredDoc = Record<string, any>;
type Ref = { collection: string; id: string; get: () => Promise<any> };

let bookingData: StoredDoc | null;
let clientData: StoredDoc | null;
let bookingUpdate: StoredDoc | null;
let clientUpdate: StoredDoc | null;
let beforeTransaction: (() => void) | null;
let transactionRuns: number;

function makeRef(collection: string, id: string): Ref {
  const ref: Ref = {
    collection,
    id,
    get: async () => {
      const data = collection === 'mood_bookings' ? bookingData : clientData;
      return { exists: Boolean(data), data: () => data };
    },
  };
  return ref;
}

const dbMock = {
  collection: vi.fn((collection: string) => ({
    doc: vi.fn((id: string) => makeRef(collection, id)),
  })),
  runTransaction: vi.fn(async (callback: any) => {
    transactionRuns += 1;
    if (beforeTransaction) {
      const hook = beforeTransaction;
      beforeTransaction = null;
      hook();
    }
    const pending: Array<{ ref: Ref; patch: StoredDoc }> = [];
    const result = await callback({
      get: async (ref: Ref) => {
        const data = ref.collection === 'mood_bookings' ? bookingData : clientData;
        return { exists: Boolean(data), data: () => data };
      },
      update: (ref: Ref, patch: StoredDoc) => pending.push({ ref, patch }),
    });
    for (const write of pending) {
      if (write.ref.collection === 'mood_bookings') {
        bookingUpdate = write.patch;
        bookingData = { ...(bookingData || {}), ...write.patch };
      } else {
        clientUpdate = write.patch;
        clientData = { ...(clientData || {}), ...write.patch };
      }
    }
    return result;
  }),
};

type MockResponse = {
  statusCode: number;
  body: string;
  writeHead: (status: number) => void;
  end: (body?: string) => void;
};

function makeResponse(): MockResponse {
  const response: MockResponse = {
    statusCode: 0,
    body: '',
    writeHead(status) {
      response.statusCode = status;
    },
    end(body) {
      response.body = body || '';
    },
  };
  return response;
}

async function call(body: StoredDoc) {
  const { default: handler } = await import('../../api/mood-settle.js');
  const response = makeResponse();
  await handler({
    method: 'POST',
    headers: { authorization: 'Bearer token' },
    body,
  } as any, response as any);
  return { response, json: JSON.parse(response.body || '{}') };
}

function validBody(overrides: StoredDoc = {}) {
  return {
    bookingId: 'booking-1',
    actualHours: 4,
    tollMode: 'estimated',
    manualAdjustmentKRW: 0,
    settlementReason: '',
    ...overrides,
  };
}

function validBooking(overrides: StoredDoc = {}) {
  return {
    clientId: 'COMPANY_A',
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

beforeEach(() => {
  vi.clearAllMocks();
  bookingData = validBooking();
  clientData = { name: 'MOOD', balanceKRW: 500000 };
  bookingUpdate = null;
  clientUpdate = null;
  beforeTransaction = null;
  transactionRuns = 0;
  verifyUserTokenMock.mockResolvedValue({
    ok: true,
    email: 'admin@x.com',
    uid: 'admin-1',
    emailVerified: true,
  });
  computeRouteMock.mockResolvedValue({
    ok: true,
    km: 80,
    tollKRW: 5000,
    durationMin: 95,
    path: [[126.9, 37.5], [127, 37.6]],
    points: [],
  });
  notifyMock.mockResolvedValue(undefined);
  sendEmailMock.mockResolvedValue(undefined);
});

describe('mood-settle 실제 톨비 선택', () => {
  it('estimated는 예약의 예상 톨비를 유지한다', async () => {
    const { response, json } = await call(validBody());

    expect(response.statusCode).toBe(200);
    expect(json.data).toMatchObject({
      finalAmountKRW: 173000,
      adjustmentKRW: 0,
      balanceKRW: 500000,
      estimatedTollKRW: 5000,
      tollKRW: 5000,
      manualAdjustmentKRW: 0,
    });
    expect(bookingUpdate).toMatchObject({
      status: 'completed',
      finalAmountKRW: 173000,
      adjustmentKRW: 0,
      estimatedTollKRW: 5000,
      tollMode: 'estimated',
      revision: 3,
      finalBreakdown: {
        tollKRW: 5000,
        estimatedTollKRW: 5000,
      },
    });
    expect(clientUpdate).toEqual({ balanceKRW: 500000 });
  });

  it('none은 실제 톨비를 0원으로 바꾸고 차액을 잔액에 환원한다', async () => {
    const { response, json } = await call(validBody({
      tollMode: 'none',
      settlementReason: '하이패스 비용이 발생하지 않음',
    }));

    expect(response.statusCode).toBe(200);
    expect(json.data).toMatchObject({
      finalAmountKRW: 168000,
      adjustmentKRW: -5000,
      balanceKRW: 505000,
      estimatedTollKRW: 5000,
      tollKRW: 0,
      settlementReason: '하이패스 비용이 발생하지 않음',
    });
    expect(bookingUpdate).toMatchObject({
      tollMode: 'none',
      settlementReason: '하이패스 비용이 발생하지 않음',
      finalBreakdown: { tollKRW: 0, estimatedTollKRW: 5000 },
    });
    expect(clientUpdate).toEqual({ balanceKRW: 505000 });
  });

  it('actual은 직접 입력한 실제 톨비만 반영한다', async () => {
    const { response, json } = await call(validBody({
      tollMode: 'actual',
      actualTollKRW: 2000,
      settlementReason: '실제 톨게이트 영수증 반영',
    }));

    expect(response.statusCode).toBe(200);
    expect(json.data).toMatchObject({
      finalAmountKRW: 170000,
      adjustmentKRW: -3000,
      balanceKRW: 503000,
      estimatedTollKRW: 5000,
      tollKRW: 2000,
    });
    expect(bookingUpdate).toMatchObject({
      tollMode: 'actual',
      finalBreakdown: { tollKRW: 2000, estimatedTollKRW: 5000 },
    });
  });

  it('실제 톨비 직접 입력은 빈값이 아닌 0~1,000,000원 정수만 허용한다', async () => {
    for (const actualTollKRW of ['', '   ', null, -1, 1.5, 1000001, 'not-money']) {
      bookingUpdate = null;
      clientUpdate = null;
      const { response, json } = await call(validBody({
        tollMode: 'actual',
        actualTollKRW,
        settlementReason: '실제 톨비 확인',
      }));
      expect.soft(response.statusCode).toBe(400);
      expect.soft(json.error).toBe('INVALID_ACTUAL_TOLL');
      expect.soft(bookingUpdate).toBeNull();
      expect.soft(clientUpdate).toBeNull();
    }
  });

  it('알 수 없는 tollMode를 기본값으로 바꾸지 않고 400으로 거절한다', async () => {
    const { response, json } = await call(validBody({ tollMode: 'free' }));

    expect.soft(response.statusCode).toBe(400);
    expect.soft(json.error).toBe('INVALID_TOLL_MODE');
    expect.soft(transactionRuns).toBe(0);
    expect.soft(bookingUpdate).toBeNull();
    expect.soft(clientUpdate).toBeNull();
  });
});

describe('mood-settle 실제 코스별 부담자', () => {
  it('실제 경로를 바꾸면 최종 지점 수와 같은 부담자 배열을 함께 저장한다', async () => {
    const coursePayers = ['mood', 'mood', 'influencer'];
    const { response, json } = await call(validBody({
      origin: '실제 출발지',
      waypoints: ['추가 방문지'],
      destination: '실제 도착지',
      coursePayers,
    }));

    expect(response.statusCode).toBe(200);
    expect(bookingUpdate).toMatchObject({
      coursePayers,
      finalBreakdown: {
        origin: '실제 출발지',
        waypoints: ['추가 방문지'],
        destination: '실제 도착지',
      },
    });
    expect(json.data.coursePayers).toEqual(coursePayers);
  });

  it('실제 경로의 지점 수와 부담자 길이가 다르거나 값이 잘못되면 계산 전에 거부한다', async () => {
    const cases = [
      { origin: '출발', destination: '도착' },
      { origin: '출발', destination: '도착', coursePayers: ['mood'] },
      { origin: '출발', destination: '도착', coursePayers: ['mood', 'company'] },
    ];
    for (const override of cases) {
      computeRouteMock.mockClear();
      const { response, json } = await call(validBody(override));
      expect.soft(response.statusCode).toBe(400);
      expect.soft(json.error).toBe('INVALID_COURSE_PAYERS');
      expect.soft(computeRouteMock).not.toHaveBeenCalled();
    }
    expect(bookingUpdate).toBeNull();
    expect(clientUpdate).toBeNull();
  });

  it('경로 변경 없이 부담자만 보내는 모호한 요청은 거부한다', async () => {
    const { response, json } = await call(validBody({ coursePayers: ['mood', 'influencer', 'influencer'] }));

    expect(response.statusCode).toBe(400);
    expect(json.error).toBe('INVALID_COURSE_PAYERS');
    expect(transactionRuns).toBe(0);
  });
});

describe('mood-settle 수동 금액 조정과 사유', () => {
  it('수동 조정액을 최종 금액에 더하고 전체 차액만 잔액에서 조정한다', async () => {
    const { response, json } = await call(validBody({
      tollMode: 'actual',
      actualTollKRW: 2000,
      manualAdjustmentKRW: 10000,
      settlementReason: '추가 주차비 10,000원과 실제 톨비 반영',
    }));

    expect(response.statusCode).toBe(200);
    expect(json.data).toMatchObject({
      finalAmountKRW: 180000,
      adjustmentKRW: 7000,
      balanceKRW: 493000,
      manualAdjustmentKRW: 10000,
    });
    expect(bookingUpdate).toMatchObject({
      finalAmountKRW: 180000,
      adjustmentKRW: 7000,
      manualAdjustmentKRW: 10000,
      settlementReason: '추가 주차비 10,000원과 실제 톨비 반영',
    });
    expect(clientUpdate).toEqual({ balanceKRW: 493000 });
  });

  it('톨비 변경이나 0이 아닌 수동 조정에는 사유가 필수다', async () => {
    const cases = [
      validBody({ tollMode: 'none' }),
      validBody({ tollMode: 'actual', actualTollKRW: 2000 }),
      validBody({ manualAdjustmentKRW: 1000 }),
    ];
    for (const body of cases) {
      const { response, json } = await call(body);
      expect.soft(response.statusCode).toBe(400);
      expect.soft(json.error).toBe('SETTLEMENT_REASON_REQUIRED');
    }
    expect(transactionRuns).toBe(0);
    expect(bookingUpdate).toBeNull();
    expect(clientUpdate).toBeNull();
  });

  it('수동 조정은 ±10,000,000원 이내 정수이며 최종 금액은 음수가 될 수 없다', async () => {
    let result = await call(validBody({
      manualAdjustmentKRW: 10000001,
      settlementReason: '한도 초과',
    }));
    expect(result.response.statusCode).toBe(400);
    expect(result.json.error).toBe('INVALID_MANUAL_ADJUSTMENT');

    result = await call(validBody({
      manualAdjustmentKRW: -200000,
      settlementReason: '과도한 감액',
    }));
    expect(result.response.statusCode).toBe(400);
    expect(result.json.error).toBe('INVALID_FINAL_AMOUNT');
    expect(bookingUpdate).toBeNull();
    expect(clientUpdate).toBeNull();
  });
});

describe('mood-settle 개정 번호 경쟁 방지', () => {
  it('사전 조회 뒤 예약 revision이 바뀌면 정산과 잔액 변경을 모두 중단한다', async () => {
    beforeTransaction = () => {
      if (bookingData) bookingData.revision = 3;
    };
    const { response, json } = await call(validBody());

    expect(response.statusCode).toBe(409);
    expect(json.error).toBe('BOOKING_CHANGED');
    expect(bookingUpdate).toBeNull();
    expect(clientUpdate).toBeNull();
    expect(clientData?.balanceKRW).toBe(500000);
  });
});

describe('mood-settle 손상 금액 fail-closed', () => {
  it('예약 원금이 숫자가 아니면 정산·잔액 변경을 거부한다', async () => {
    bookingData = validBooking({ amountKRW: 'not-money' });
    const { response, json } = await call(validBody());

    expect(response.statusCode).toBe(409);
    expect(json.error).toBe('INVALID_BOOKING_AMOUNT');
    expect(bookingUpdate).toBeNull();
    expect(clientUpdate).toBeNull();
  });

  it('고객 잔액이 숫자가 아니면 정산·잔액 변경을 거부한다', async () => {
    clientData = { balanceKRW: 'not-money' };
    const { response, json } = await call(validBody());

    expect(response.statusCode).toBe(409);
    expect(json.error).toBe('INVALID_CLIENT_BALANCE');
    expect(bookingUpdate).toBeNull();
    expect(clientUpdate).toBeNull();
  });

  it('숫자 모양 문자열도 Firestore 금액 타입 손상으로 보고 거부한다', async () => {
    bookingData = validBooking({ amountKRW: '173000' });
    let result = await call(validBody());
    expect.soft(result.response.statusCode).toBe(409);
    expect.soft(result.json.error).toBe('INVALID_BOOKING_AMOUNT');
    expect.soft(bookingUpdate).toBeNull();
    expect.soft(clientUpdate).toBeNull();

    bookingData = validBooking();
    clientData = { balanceKRW: '500000' };
    bookingUpdate = null;
    clientUpdate = null;
    result = await call(validBody());
    expect.soft(result.response.statusCode).toBe(409);
    expect.soft(result.json.error).toBe('INVALID_CLIENT_BALANCE');
    expect.soft(bookingUpdate).toBeNull();
    expect.soft(clientUpdate).toBeNull();
  });

  it('저장된 거리·예상 톨비가 손상되면 0원으로 바꾸어 정산하지 않는다', async () => {
    bookingData = validBooking({
      breakdown: {
        km: 'not-distance',
        tollKRW: 'not-toll',
        origin: '서울역',
        destination: '인천공항',
      },
    });
    const { response, json } = await call(validBody());

    expect.soft(response.statusCode).toBe(409);
    expect.soft(json.error).toBe('INVALID_BOOKING_BREAKDOWN');
    expect.soft(bookingUpdate).toBeNull();
    expect.soft(clientUpdate).toBeNull();
  });

  it('경로 재계산 성공 봉투의 숫자가 손상되면 과소 정산하지 않는다', async () => {
    computeRouteMock.mockResolvedValue({
      ok: true,
      km: Number.NaN,
      tollKRW: Number.NaN,
      durationMin: Number.NaN,
      path: [],
      points: [],
    });
    const { response, json } = await call(validBody({
      origin: '실제 출발지',
      destination: '실제 도착지',
      coursePayers: ['mood', 'influencer'],
    }));

    expect.soft(response.statusCode).toBe(422);
    expect.soft(json.error).toBe('ROUTE_RECALCULATION_FAILED');
    expect.soft(bookingUpdate).toBeNull();
    expect.soft(clientUpdate).toBeNull();
  });
});
