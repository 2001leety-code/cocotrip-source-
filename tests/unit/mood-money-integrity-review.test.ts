/* eslint-disable @typescript-eslint/no-explicit-any -- API handler용 Firestore/응답 최소 모사. */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const verifyUserTokenMock = vi.fn();
const computeRouteMock = vi.fn();
const dbHolder: { db: any } = { db: null };

vi.mock('../../api/_shared/user-auth.js', () => ({ verifyUserToken: verifyUserTokenMock }));
vi.mock('../../api/_shared/firebase-admin.js', () => ({ initAdminDb: () => dbHolder.db }));
vi.mock('../../api/_shared/mood-allowlist.js', () => ({
  getMoodAllowlist: async () => ({
    emails: ['staff@x.com', 'admin@x.com'],
    admins: ['admin@x.com'],
    clientId: 'COMPANY_A',
  }),
  isAllowedEmail: (allowlist: any, email: string) => allowlist.emails.includes(email),
  isAdminEmail: (allowlist: any, email: string) => allowlist.admins.includes(email),
}));
vi.mock('../../api/_shared/mood-route.js', () => ({ computeRoute: computeRouteMock }));
vi.mock('../../api/_shared/cors.js', () => ({ buildAdminJsonCors: () => ({}) }));
vi.mock('../../api/_shared/sentry.js', () => ({ captureError: vi.fn() }));
vi.mock('../../api/_shared/notify.js', () => ({ notify: vi.fn() }));
vi.mock('../../api/_shared/mood-receipt.js', () => ({
  buildMoodSettlementReceiptEmail: () => ({ subject: '', html: '', text: '' }),
}));
vi.mock('../../api/_send-email.js', () => ({ sendEmail: vi.fn() }));

function makeResponse() {
  const response = {
    statusCode: 0,
    body: '',
    writeHead(status: number) { response.statusCode = status; },
    end(body?: string) { response.body = body || ''; },
  };
  return response;
}

function snap(data: any) {
  return { exists: Boolean(data), data: () => data };
}

function baseBooking(overrides: Record<string, any> = {}) {
  return {
    clientId: 'COMPANY_A',
    status: 'confirmed',
    revision: 1,
    amountKRW: 173000,
    ratePerHour: 30000,
    serviceType: 'vehicle',
    durationHours: 4,
    breakdown: {
      km: 80,
      tollKRW: 5000,
      origin: '서울역',
      destination: '인천공항',
      waypoints: [],
    },
    ...overrides,
  };
}

function settleDb(options: {
  booking?: any;
  client?: any;
  bookingUpdate?: ReturnType<typeof vi.fn>;
  clientUpdate?: ReturnType<typeof vi.fn>;
} = {}) {
  const booking = options.booking || baseBooking();
  const client = options.client || { balanceKRW: 500000 };
  const bookingUpdate = options.bookingUpdate || vi.fn();
  const clientUpdate = options.clientUpdate || vi.fn();
  const bookingRef = { collection: 'mood_bookings', id: 'booking-1', get: async () => snap(booking) };
  const clientRef = { collection: 'mood_clients', id: 'COMPANY_A', get: async () => snap(client) };
  return {
    collection(name: string) {
      return { doc: () => name === 'mood_bookings' ? bookingRef : clientRef };
    },
    runTransaction: async (callback: any) => callback({
      get: async (ref: any) => ref.collection === 'mood_bookings' ? snap(booking) : snap(client),
      update: (ref: any, patch: any) => ref.collection === 'mood_bookings'
        ? bookingUpdate(patch)
        : clientUpdate(patch),
    }),
  };
}

async function callSettle(body: Record<string, any>) {
  const { default: handler } = await import('../../api/mood-settle.js');
  const response = makeResponse();
  await handler({ method: 'POST', headers: { authorization: 'Bearer token' }, body } as any, response as any);
  return { response, json: JSON.parse(response.body || '{}') };
}

function settleBody(overrides: Record<string, any> = {}) {
  return {
    bookingId: 'booking-1',
    actualHours: 4,
    tollMode: 'estimated',
    manualAdjustmentKRW: 0,
    ...overrides,
  };
}

function dataDb({
  balanceKRW,
  amountKRW,
  bookingOverrides = {},
}: {
  balanceKRW: any;
  amountKRW: any;
  bookingOverrides?: Record<string, any>;
}) {
  const bookingQuery: any = {
    where() { return bookingQuery; },
    orderBy() { return bookingQuery; },
    limit() { return bookingQuery; },
    async get() {
      return {
        docs: [{
          id: 'booking-1',
          data: () => ({
            clientId: 'COMPANY_A',
            amountKRW,
            status: 'confirmed',
            date: '2026-08-20',
            startTime: '09:00',
            durationHours: 4,
            serviceType: 'vehicle',
            ...bookingOverrides,
          }),
        }],
      };
    },
  };
  return {
    collection(name: string) {
      if (name === 'mood_bookings') return bookingQuery;
      return { doc: () => ({ get: async () => snap({ balanceKRW, name: 'MOOD' }) }) };
    },
  };
}

async function callData() {
  const { default: handler } = await import('../../api/mood-data.js');
  const response = makeResponse();
  await handler({
    method: 'GET',
    url: '/api/mood-data',
    headers: { host: 'unit.test', authorization: 'Bearer token' },
  } as any, response as any);
  return { response, json: JSON.parse(response.body || '{}') };
}

beforeEach(() => {
  vi.clearAllMocks();
  verifyUserTokenMock.mockResolvedValue({
    ok: true,
    email: 'admin@x.com',
    uid: 'admin-1',
    emailVerified: true,
  });
  computeRouteMock.mockResolvedValue({
    ok: true,
    km: 60,
    tollKRW: 2000,
    durationMin: 80,
    path: [],
    points: [],
  });
});

describe('mood-settle 저장 요율 무결성', () => {
  it('저장 요율이 숫자형 문자열이면 현재 요율로 조용히 대체하지 않고 거부한다', async () => {
    const bookingUpdate = vi.fn();
    const clientUpdate = vi.fn();
    dbHolder.db = settleDb({
      booking: baseBooking({ ratePerHour: '1' }),
      bookingUpdate,
      clientUpdate,
    });
    const { response, json } = await callSettle(settleBody());
    expect(response.statusCode).toBe(409);
    expect(json.error).toBe('INVALID_BOOKING_RATE');
    expect(bookingUpdate).not.toHaveBeenCalled();
    expect(clientUpdate).not.toHaveBeenCalled();
  });

  it('레거시 예약에서 요율 필드가 아예 없을 때만 현재 요율을 사용한다', async () => {
    const legacy = baseBooking();
    delete legacy.ratePerHour;
    const bookingUpdate = vi.fn();
    dbHolder.db = settleDb({ booking: legacy, bookingUpdate });
    const { response, json } = await callSettle(settleBody());
    expect(response.statusCode).toBe(200);
    expect(json.data.finalAmountKRW).toBe(173000);
    expect(bookingUpdate).toHaveBeenCalledWith(expect.objectContaining({ finalAmountKRW: 173000 }));
  });
});

describe('mood-settle 차액과 신용한도', () => {
  it('정산 추가 차감이 신용한도를 넘으면 예약과 잔액을 모두 보존한다', async () => {
    const bookingUpdate = vi.fn();
    const clientUpdate = vi.fn();
    dbHolder.db = settleDb({
      booking: baseBooking({ amountKRW: 100000 }),
      client: { balanceKRW: -250000, creditLimitKRW: 300000 },
      bookingUpdate,
      clientUpdate,
    });
    const { response, json } = await callSettle(settleBody());
    expect(response.statusCode).toBe(409);
    expect(json.error).toBe('CREDIT_LIMIT_EXCEEDED');
    expect(bookingUpdate).not.toHaveBeenCalled();
    expect(clientUpdate).not.toHaveBeenCalled();
  });

  it('감액 정산은 기존 잔액이 이미 한도 아래여도 환원한다', async () => {
    const clientUpdate = vi.fn();
    dbHolder.db = settleDb({
      booking: baseBooking({ amountKRW: 200000 }),
      client: { balanceKRW: -350000, creditLimitKRW: 300000 },
      clientUpdate,
    });
    const { response, json } = await callSettle(settleBody());
    expect(response.statusCode).toBe(200);
    expect(json.data.adjustmentKRW).toBe(-27000);
    expect(clientUpdate).toHaveBeenCalledWith({ balanceKRW: -323000 });
  });
});

describe('mood-settle 실제 경로로 손상 breakdown 복구', () => {
  it('저장 breakdown이 손상돼도 유효한 실제 경로를 입력하면 새 경로로 안전하게 정산한다', async () => {
    const bookingUpdate = vi.fn();
    dbHolder.db = settleDb({
      booking: baseBooking({ breakdown: { km: 'broken', tollKRW: 'broken' } }),
      bookingUpdate,
    });
    const { response, json } = await callSettle(settleBody({
      origin: '실제 출발지',
      destination: '실제 도착지',
      coursePayers: ['mood', 'influencer'],
    }));
    expect(response.statusCode).toBe(200);
    expect(json.data).toMatchObject({ km: 60, tollKRW: 2000, routeRecomputed: true });
    expect(bookingUpdate).toHaveBeenCalledWith(expect.objectContaining({
      finalBreakdown: expect.objectContaining({ km: 60, tollKRW: 2000, recomputed: true }),
    }));
  });
});

describe('mood-data 손상 금액 fail-closed', () => {
  it('고객 잔액이 숫자형 문자열이면 0원으로 표시하지 않고 409를 반환한다', async () => {
    dbHolder.db = dataDb({ balanceKRW: '500000', amountKRW: 173000 });
    const { response, json } = await callData();
    expect(response.statusCode).toBe(409);
    expect(json.error).toBe('INVALID_CLIENT_BALANCE');
  });

  it('예약 금액이 손상되면 0원 예약으로 표시하지 않고 409를 반환한다', async () => {
    dbHolder.db = dataDb({ balanceKRW: 500000, amountKRW: 'broken' });
    const { response, json } = await callData();
    expect(response.statusCode).toBe(409);
    expect(json.error).toBe('INVALID_BOOKING_AMOUNT');
  });

  it('완료 예약의 최종 금액이 손상되면 예상 금액으로 대신 표시하지 않고 409를 반환한다', async () => {
    dbHolder.db = dataDb({
      balanceKRW: 500000,
      amountKRW: 173000,
      bookingOverrides: { status: 'completed', finalAmountKRW: 'broken' },
    });
    const { response, json } = await callData();
    expect(response.statusCode).toBe(409);
    expect(json.error).toBe('INVALID_BOOKING_MONEY');
  });

  it('금액 분해의 톨비가 손상되면 0원으로 숨기지 않고 409를 반환한다', async () => {
    dbHolder.db = dataDb({
      balanceKRW: 500000,
      amountKRW: 173000,
      bookingOverrides: { breakdown: { baseKRW: 120000, tollKRW: 'broken', km: 80 } },
    });
    const { response, json } = await callData();
    expect(response.statusCode).toBe(409);
    expect(json.error).toBe('INVALID_BOOKING_MONEY');
  });
});
