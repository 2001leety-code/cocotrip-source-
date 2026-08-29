/* eslint-disable @typescript-eslint/no-explicit-any -- mood-data 핸들러/Firestore 응답 모킹. */
/** 예약 변경·최종 정산 뒤에도 화면이 최신 비용 근거와 수정 차수를 받는지 잠근다. */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const verifyUserTokenMock = vi.fn();

vi.mock('../../api/_shared/user-auth.js', () => ({
  verifyUserToken: (...args: any[]) => verifyUserTokenMock(...args),
  default: (...args: any[]) => verifyUserTokenMock(...args),
}));

vi.mock('../../api/_shared/mood-allowlist.js', () => ({
  getMoodAllowlist: async () => ({
    emails: ['staff@x.com'],
    admins: [],
    clientId: 'COMPANY_A',
  }),
  isAllowedEmail: (allowlist: any, email: string) => allowlist.emails.includes(email),
  isAdminEmail: (allowlist: any, email: string) => allowlist.admins.includes(email),
  isSettlementApproverEmail: (allowlist: any, email: string) =>
    (allowlist.settlementApproverEmails || []).includes(email) && !allowlist.admins.includes(email),
}));

vi.mock('../../api/_shared/cors.js', () => ({ buildAdminJsonCors: () => ({}) }));
vi.mock('../../api/_shared/sentry.js', () => ({ captureError: vi.fn() }));

const bookedBreakdown = {
  baseKRW: 120_000,
  distanceSurchargeKRW: 30_000,
  tollKRW: 7_200,
  km: 50,
  origin: '서울역',
  destination: '인천공항',
  waypoints: ['성수동'],
};

const finalBreakdown = {
  baseKRW: 120_000,
  distanceSurchargeKRW: 36_000,
  tollKRW: 0,
  otherAdjustmentKRW: -2_000,
  km: 60,
  origin: '용산역',
  destination: '인천공항 제1터미널',
  waypoints: ['성수동', '여의도'],
};

function pendingChangeBookingData(overrides: Record<string, unknown> = {}) {
  return {
    clientId: 'COMPANY_A',
    date: '2026-08-17',
    startTime: '09:00',
    durationHours: 3,
    serviceType: 'vehicle',
    amountKRW: 120_000,
    breakdown: bookedBreakdown,
    revision: 0,
    status: 'confirmed',
    createdByEmail: 'staff@x.com',
    createdAt: 3,
    bookingChangeApproval: {
      status: 'awaiting_mood',
      quoteId: 'a'.repeat(64),
      proposalRevision: 0,
      proposedByEmail: 'admin@x.com',
      proposedAt: 1_777_000_000_000,
      reason: '이용 시간 변경',
      currency: 'KRW',
      oldAmountKRW: 120_000,
      amountKRW: 150_000,
      adjustmentKRW: 30_000,
      balanceBeforeKRW: 846_000,
      balanceAfterKRW: 816_000,
      changedFields: ['durationHours'],
      proposedBooking: {
        date: '2026-08-17',
        startTime: '09:00',
        durationHours: 4,
        serviceType: 'vehicle',
        origin: '서울역',
        destination: '인천공항',
        waypoints: ['성수동'],
      },
      breakdown: { ...bookedBreakdown, baseKRW: 150_000 },
      routeSnapshot: null,
    },
    ...overrides,
  };
}

function baseBookingDocs() {
  return [
  {
    id: 'changed-booking',
    data: () => ({
      clientId: 'COMPANY_A',
      date: '2026-08-20',
      startTime: '09:00',
      durationHours: 4,
      serviceType: 'vehicle',
      amountKRW: 154_000,
      balanceAfterKRW: 846_000,
      breakdown: bookedBreakdown,
      routeSchedule: [
        { arrivalTime: null, pickupTime: '09:00' },
        { arrivalTime: '10:00', pickupTime: '12:00' },
        { arrivalTime: '13:00', pickupTime: null },
      ],
      finalBreakdown,
      revision: 3,
      status: 'completed',
      createdByEmail: 'staff@x.com',
      createdAt: 2,
    }),
  },
  {
    id: 'legacy-booking',
    data: () => ({
      clientId: 'COMPANY_A',
      date: '2026-08-19',
      startTime: '10:00',
      durationHours: 3,
      serviceType: 'manager',
      amountKRW: 120_000,
      breakdown: bookedBreakdown,
      status: 'confirmed',
      createdByEmail: 'staff@x.com',
      createdAt: 1,
    }),
  },
  {
    id: 'invalid-revision-booking',
    data: () => ({
      clientId: 'COMPANY_A',
      date: '2026-08-18',
      startTime: '11:00',
      durationHours: 3,
      serviceType: 'vehicle',
      amountKRW: 90_000,
      breakdown: bookedBreakdown,
      revision: -2,
      status: 'confirmed',
      createdByEmail: 'staff@x.com',
      createdAt: 0,
    }),
  },
  {
    id: 'pending-change-booking',
    data: () => pendingChangeBookingData(),
  },
  ];
}

let bookingDocs = baseBookingDocs();
let bookingAvailabilityDoc: Record<string, unknown> | null = {
  schemaVersion: 1,
  revision: 2,
  rules: [],
  exceptions: [],
};

const bookingsQuery: any = {
  where() { return bookingsQuery; },
  orderBy() { return bookingsQuery; },
  limit() { return bookingsQuery; },
  async get() { return { docs: bookingDocs }; },
};

const dbMock = {
  collection(name: string) {
    if (name === 'mood_bookings') return bookingsQuery;
    return {
      doc: (id: string) => ({
        get: async () => ({
          exists: name === 'mood_config' && id === 'booking_availability'
            ? Boolean(bookingAvailabilityDoc)
            : true,
          data: () => name === 'mood_config' && id === 'booking_availability'
            ? bookingAvailabilityDoc || undefined
            : { name: 'Company A', balanceKRW: 846_000 },
        }),
      }),
    };
  },
};

vi.mock('../../api/_shared/firebase-admin.js', () => ({ initAdminDb: () => dbMock }));

function makeResponse() {
  const response = {
    statusCode: undefined as number | undefined,
    body: '',
    writeHead(status: number) {
      response.statusCode = status;
      return response;
    },
    setHeader() {},
    end(body?: string | Buffer) {
      response.body = body instanceof Buffer ? body.toString('utf8') : (body || '');
      return response;
    },
  };
  return response;
}

beforeEach(() => {
  bookingDocs = baseBookingDocs();
  bookingAvailabilityDoc = { schemaVersion: 1, revision: 2, rules: [], exceptions: [] };
  verifyUserTokenMock.mockReset();
  verifyUserTokenMock.mockResolvedValue({
    ok: true,
    email: 'staff@x.com',
    uid: 'staff-1',
    emailVerified: true,
  });
});

describe('mood-data 예약 변경·정산 필드 회귀', () => {
  it('예약 설정 문서가 없으면 포털 데이터는 유지하되 bookingAvailability를 null로 내려 신규 작업을 잠근다', async () => {
    bookingAvailabilityDoc = null;
    const { default: handler } = await import('../../api/mood-data.js');
    const response = makeResponse();
    await handler({
      method: 'GET',
      url: '/api/mood-data',
      headers: { host: 'unit.test', authorization: 'Bearer token' },
    } as any, response as any);

    expect(response.statusCode).toBe(200);
    const json = JSON.parse(response.body);
    expect(json.data.bookingAvailability).toBeNull();
    expect(json.data.bookings).toHaveLength(4);
  });

  it('finalBreakdown과 유효한 revision을 손실 없이 반환한다', async () => {
    const { default: handler } = await import('../../api/mood-data.js');
    const response = makeResponse();
    await handler({
      method: 'GET',
      url: '/api/mood-data',
      headers: { host: 'unit.test', authorization: 'Bearer token' },
    } as any, response as any);

    expect(response.statusCode).toBe(200);
    const json = JSON.parse(response.body);
    const changed = json.data.bookings.find((booking: any) => booking.id === 'changed-booking');

    expect(json.data.bookingAvailability).toMatchObject({
      schemaVersion: 1,
      revision: 2,
      rules: [],
    });
    expect(changed.breakdown).toEqual(bookedBreakdown);
    expect(changed.finalBreakdown).toEqual(finalBreakdown);
    expect(changed.revision).toBe(3);
    expect(changed.routeSchedule).toEqual([
      { arrivalTime: null, pickupTime: '09:00' },
      { arrivalTime: '10:00', pickupTime: '12:00' },
      { arrivalTime: '13:00', pickupTime: null },
    ]);
  });

  it('레거시·잘못된 revision은 0, 없는 finalBreakdown은 null로 정규화한다', async () => {
    const { default: handler } = await import('../../api/mood-data.js');
    const response = makeResponse();
    await handler({
      method: 'GET',
      url: '/api/mood-data',
      headers: { host: 'unit.test', authorization: 'Bearer token' },
    } as any, response as any);

    expect(response.statusCode).toBe(200);
    const json = JSON.parse(response.body);
    const byId = Object.fromEntries(json.data.bookings.map((booking: any) => [booking.id, booking]));

    expect(byId['legacy-booking'].revision).toBe(0);
    expect(byId['legacy-booking'].finalBreakdown).toBeNull();
    expect(byId['legacy-booking'].routeSchedule).toBeNull();
    expect(byId['invalid-revision-booking'].revision).toBe(0);
    expect(byId['invalid-revision-booking'].finalBreakdown).toBeNull();
  });

  it('첫 번째 변경의 revision 0 MOOD 확인 대기 요약을 반환한다', async () => {
    const { default: handler } = await import('../../api/mood-data.js');
    const response = makeResponse();
    await handler({
      method: 'GET',
      url: '/api/mood-data',
      headers: { host: 'unit.test', authorization: 'Bearer token' },
    } as any, response as any);

    expect(response.statusCode).toBe(200);
    const json = JSON.parse(response.body);
    const pending = json.data.bookings.find((booking: any) => booking.id === 'pending-change-booking');
    expect(pending.revision).toBe(0);
    expect(pending.bookingChangeApproval).toMatchObject({
      status: 'awaiting_mood',
      proposalRevision: 0,
      oldAmountKRW: 120_000,
      amountKRW: 150_000,
      adjustmentKRW: 30_000,
      balanceAfterKRW: 816_000,
    });
  });

  it('음수 revision이나 금액 산식이 깨진 변경 대기 요약은 409로 닫는다', async () => {
    const invalidSummary = pendingChangeBookingData();
    invalidSummary.bookingChangeApproval = {
      ...invalidSummary.bookingChangeApproval,
      proposalRevision: -1,
      balanceAfterKRW: 999_999,
    };
    bookingDocs = [{ id: 'invalid-pending-change', data: () => invalidSummary }];
    const { default: handler } = await import('../../api/mood-data.js');
    const response = makeResponse();
    await handler({
      method: 'GET',
      url: '/api/mood-data',
      headers: { host: 'unit.test', authorization: 'Bearer token' },
    } as any, response as any);

    expect(response.statusCode).toBe(409);
    expect(JSON.parse(response.body)).toEqual({ ok: false, error: 'INVALID_BOOKING_CHANGE_APPROVAL' });
  });
});
