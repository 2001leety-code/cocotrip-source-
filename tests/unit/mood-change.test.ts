/* eslint-disable @typescript-eslint/no-explicit-any -- Firestore와 HTTP 응답을 작게 모사한다. */
import { createHash } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const verifyUserTokenMock = vi.fn();
const computeRouteMock = vi.fn();
const notifyMock = vi.fn();
const captureErrorMock = vi.fn();

vi.mock('../../api/_shared/user-auth.js', () => ({
  verifyUserToken: verifyUserTokenMock,
}));
vi.mock('../../api/_shared/mood-route.js', () => ({
  computeRoute: computeRouteMock,
}));
vi.mock('../../api/_shared/mood-allowlist.js', () => ({
  getMoodAllowlist: async () => dbState.allowlist,
  isAllowedEmail: (allowlist: any, email: string) => allowlist.emails.includes(email),
  isAdminEmail: (allowlist: any, email: string) => allowlist.admins.includes(email),
  isSettlementApproverEmail: (allowlist: any, email: string) =>
    (allowlist.settlementApproverEmails || []).includes(email) && !allowlist.admins.includes(email),
}));
vi.mock('../../api/_shared/cors.js', () => ({
  buildAdminJsonCors: () => ({ 'Content-Type': 'application/json' }),
}));
vi.mock('../../api/_shared/sentry.js', () => ({
  captureError: captureErrorMock,
}));
vi.mock('../../api/_shared/notify.js', () => ({
  notify: notifyMock,
}));

type StoredDoc = Record<string, any>;
type Ref = { __collection: string; __id: string; get: () => Promise<any> };

const dbState: {
  allowlist: { emails: string[]; admins: string[]; clientId: string };
  docs: Record<string, Record<string, StoredDoc>>;
  updates: Array<{ ref: Ref; patch: StoredDoc }>;
  sets: Array<{ ref: Ref; value: StoredDoc }>;
  transactionRuns: number;
  beforeTransaction?: () => void;
} = {
  allowlist: { emails: [], admins: [], clientId: '' },
  docs: {},
  updates: [],
  sets: [],
  transactionRuns: 0,
};

function documentAt(ref: Ref): StoredDoc | undefined {
  return dbState.docs[ref.__collection]?.[ref.__id];
}

function snap(ref: Ref) {
  const value = documentAt(ref);
  return {
    exists: Boolean(value),
    data: () => value,
  };
}

function ref(collection: string, id: string): Ref {
  const value: Ref = {
    __collection: collection,
    __id: id,
    get: async () => snap(value),
  };
  return value;
}

function writeDoc(target: Ref, value: StoredDoc, merge: boolean) {
  dbState.docs[target.__collection] ||= {};
  dbState.docs[target.__collection][target.__id] = merge
    ? { ...(documentAt(target) || {}), ...value }
    : value;
}

const dbMock = {
  collection: vi.fn((collection: string) => ({
    doc: vi.fn((id: string) => ref(collection, id)),
  })),
  runTransaction: vi.fn(async (callback: any) => {
    dbState.transactionRuns += 1;
    if (dbState.beforeTransaction) {
      const hook = dbState.beforeTransaction;
      dbState.beforeTransaction = undefined;
      hook();
    }
    const pendingUpdates: Array<{ ref: Ref; patch: StoredDoc }> = [];
    const pendingSets: Array<{ ref: Ref; value: StoredDoc }> = [];
    const result = await callback({
      get: async (target: Ref) => snap(target),
      update: (target: Ref, patch: StoredDoc) => pendingUpdates.push({ ref: target, patch }),
      set: (target: Ref, value: StoredDoc) => pendingSets.push({ ref: target, value }),
    });
    for (const write of pendingUpdates) {
      dbState.updates.push(write);
      writeDoc(write.ref, write.patch, true);
    }
    for (const write of pendingSets) {
      dbState.sets.push(write);
      writeDoc(write.ref, write.value, false);
    }
    return result;
  }),
};

vi.mock('../../api/_shared/firebase-admin.js', () => ({
  initAdminDb: () => dbMock,
}));

type MockResponse = {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
  writeHead: (status: number, headers?: Record<string, string>) => void;
  end: (body?: string) => void;
};

function response(): MockResponse {
  const res: MockResponse = {
    statusCode: 0,
    headers: {},
    body: '',
    writeHead(status, headers) {
      res.statusCode = status;
      res.headers = headers || {};
    },
    end(body) {
      res.body = body || '';
    },
  };
  return res;
}

const validSnapshot = (overrides: Record<string, any> = {}) => ({
  date: '2026-08-20',
  startTime: '09:30',
  durationHours: 4,
  serviceType: 'vehicle',
  origin: '서울역',
  destination: '인천공항 제1터미널',
  waypoints: ['성수동'],
  note: 'KE123 탑승',
  airportDirection: null,
  airportCode: null,
  influencerName: '코코',
  ...overrides,
});

const validBody = (overrides: Record<string, any> = {}) => ({
  bookingId: 'booking-1',
  expectedRevision: 0,
  idempotencyKey: 'change-unique-1',
  reason: '촬영 장소 변경',
  booking: validSnapshot(),
  amountKRW: 1,
  tollKRW: 1,
  km: 1,
  ...overrides,
});

async function call(body: Record<string, any>, method = 'POST') {
  const { default: handler } = await import('../../api/mood-change.js');
  const res = response();
  await handler({
    method,
    body,
    headers: { authorization: 'Bearer test-token' },
  } as any, res as any);
  return { res, json: JSON.parse(res.body || '{}') };
}

function booking(overrides: Record<string, any> = {}) {
  return {
    clientId: 'COMPANY_A',
    status: 'confirmed',
    revision: 0,
    amountKRW: 100000,
    date: '2026-08-19',
    startTime: '08:00',
    durationHours: 3,
    serviceType: 'vehicle',
    breakdown: {
      baseKRW: 90000,
      distanceSurchargeKRW: 10000,
      tollKRW: 0,
      km: 55,
      origin: '기존 출발지',
      destination: '기존 도착지',
      waypoints: null,
    },
    createdByEmail: 'staff@x.com',
    createdAt: 1,
    ...overrides,
  };
}

function collectionDocs(name: string) {
  return dbState.docs[name] || {};
}

beforeEach(() => {
  vi.clearAllMocks();
  dbState.allowlist = {
    emails: ['staff@x.com', 'admin@x.com'],
    admins: ['admin@x.com'],
    clientId: 'COMPANY_A',
  };
  dbState.docs = {
    mood_bookings: { 'booking-1': booking() },
    mood_clients: { COMPANY_A: { name: '무드', balanceKRW: 500000, creditLimitKRW: 300000 } },
  };
  dbState.updates = [];
  dbState.sets = [];
  dbState.transactionRuns = 0;
  dbState.beforeTransaction = undefined;
  verifyUserTokenMock.mockResolvedValue({
    ok: true,
    email: 'staff@x.com',
    uid: 'uid-1',
    emailVerified: true,
  });
  computeRouteMock.mockResolvedValue({
    ok: true,
    km: 80,
    tollKRW: 5000,
    durationMin: 95,
    path: [],
    points: [],
  });
  notifyMock.mockResolvedValue(undefined);
});

describe('mood-change 인증과 소유권', () => {
  it('Bearer 검증 실패 응답을 그대로 반환한다', async () => {
    verifyUserTokenMock.mockResolvedValue({ ok: false, status: 401, error: 'TOKEN_REQUIRED' });
    const { res, json } = await call(validBody());
    expect(res.statusCode).toBe(401);
    expect(json.error).toBe('TOKEN_REQUIRED');
    expect(dbState.updates).toHaveLength(0);
  });

  it('이메일 미인증 사용자를 거부한다', async () => {
    verifyUserTokenMock.mockResolvedValue({ ok: true, email: 'staff@x.com', emailVerified: false });
    const { res, json } = await call(validBody());
    expect(res.statusCode).toBe(403);
    expect(json.error).toBe('EMAIL_NOT_VERIFIED');
  });

  it('허용 목록 밖 사용자를 거부한다', async () => {
    verifyUserTokenMock.mockResolvedValue({ ok: true, email: 'outsider@x.com', emailVerified: true });
    const { res, json } = await call(validBody());
    expect(res.statusCode).toBe(403);
    expect(json.error).toBe('ACCESS_DENIED');
  });

  it('직원은 다른 회사 예약을 바꿀 수 없고 운영자는 바꿀 수 있다', async () => {
    dbState.docs.mood_bookings['booking-1'] = booking({ clientId: 'COMPANY_B' });
    dbState.docs.mood_clients.COMPANY_B = { balanceKRW: 500000 };
    let result = await call(validBody());
    expect(result.res.statusCode).toBe(403);
    expect(result.json.error).toBe('BOOKING_ACCESS_DENIED');

    verifyUserTokenMock.mockResolvedValue({ ok: true, email: 'admin@x.com', emailVerified: true });
    result = await call(validBody({ idempotencyKey: 'admin-change-1' }));
    expect(result.res.statusCode).toBe(200);
  });
});

describe('mood-change 입력과 경로 안전장치', () => {
  it('부분 수정값이 아니라 전체 예약 스냅샷을 요구한다', async () => {
    const { res, json } = await call(validBody({ booking: { date: '2026-08-20' } }));
    expect(res.statusCode).toBe(400);
    expect(json.error).toBe('FULL_SNAPSHOT_REQUIRED');
    expect(computeRouteMock).not.toHaveBeenCalled();
  });

  it('경유지 5개까지 허용하고 6개는 계산 전에 거부한다', async () => {
    const six = ['1', '2', '3', '4', '5', '6'];
    const { res, json } = await call(validBody({
      booking: validSnapshot({ waypoints: six }),
    }));
    expect(res.statusCode).toBe(400);
    expect(json.error).toBe('WAYPOINT_LIMIT_EXCEEDED');
    expect(computeRouteMock).not.toHaveBeenCalled();
  });

  it('명시한 경로 계산이 실패하면 금액과 예약을 쓰지 않는다', async () => {
    computeRouteMock.mockResolvedValue({ ok: false, status: 502, error: 'DIRECTIONS_FAILED' });
    const { res, json } = await call(validBody());
    expect(res.statusCode).toBe(422);
    expect(json.error).toBe('ROUTE_CALCULATION_FAILED');
    expect(json.routeError).toBe('DIRECTIONS_FAILED');
    expect(dbState.updates).toHaveLength(0);
    expect(dbState.sets).toHaveLength(0);
  });

  it('경로 성공 응답의 거리나 톨비가 망가져도 0원으로 통과시키지 않는다', async () => {
    computeRouteMock.mockResolvedValue({ ok: true, tollKRW: 5000, durationMin: 95 });
    const { res, json } = await call(validBody());
    expect(res.statusCode).toBe(422);
    expect(json.error).toBe('ROUTE_CALCULATION_FAILED');
    expect(dbState.updates).toHaveLength(0);
  });

  it('유한하지만 안전 범위를 넘은 경로 금액도 저장하지 않는다', async () => {
    computeRouteMock.mockResolvedValue({
      ok: true,
      km: Number.MAX_VALUE,
      tollKRW: 5000,
      durationMin: 95,
      path: [],
      points: [],
    });
    const { res, json } = await call(validBody());
    expect(res.statusCode).toBe(400);
    expect(json.error).toBe('INVALID_PRICING_RESULT');
    expect(dbState.updates).toHaveLength(0);
    expect(dbState.sets).toHaveLength(0);
  });

  it('클라이언트가 보낸 금액·거리·톨비를 무시하고 현재 서버 요율로 계산한다', async () => {
    const { res, json } = await call(validBody({ amountKRW: 10, tollKRW: 20, km: 1 }));
    expect(res.statusCode).toBe(200);
    // 차량 4시간 120,000 + 80km×600 48,000 + 톨비 5,000
    expect(json.data.amountKRW).toBe(173000);
    expect(json.data.adjustmentKRW).toBe(73000);
    expect(json.data.balanceKRW).toBe(427000);
    expect(json.data.breakdown).toMatchObject({
      baseKRW: 120000,
      distanceSurchargeKRW: 48000,
      tollKRW: 5000,
      km: 80,
    });
    expect(json.data.booking.routeSnapshot).toMatchObject({
      km: 80,
      tollKRW: 5000,
      durationMin: 95,
      path: [],
      points: [],
    });
  });

  it('공항 경유 예약은 경유 경로와 직행 경로 차이만 현재 요율로 더한다', async () => {
    computeRouteMock
      .mockResolvedValueOnce({ ok: true, km: 70, tollKRW: 9000, durationMin: 90 })
      .mockResolvedValueOnce({ ok: true, km: 50, tollKRW: 5000, durationMin: 60 });
    const { res, json } = await call(validBody({
      booking: validSnapshot({
        durationHours: 0,
        serviceType: 'airport',
        airportDirection: 'sending',
        airportCode: 'ICN',
        waypoints: ['촬영지'],
      }),
    }));
    expect(res.statusCode).toBe(200);
    expect(computeRouteMock).toHaveBeenCalledTimes(2);
    // 인천공항 110,000 + 우회 20km×600
    expect(json.data.amountKRW).toBe(122000);
    expect(json.data.breakdown.airportDetourKm).toBe(20);
    expect(json.data.breakdown.tollKRW).toBe(0);
  });
});

describe('mood-change 경로별 일정', () => {
  const oldSchedule = [
    { arrivalTime: null, pickupTime: '09:30' },
    { arrivalTime: '10:20', pickupTime: '11:20' },
    { arrivalTime: '13:00', pickupTime: null },
  ];
  const changedSchedule = [
    { arrivalTime: null, pickupTime: '09:30' },
    { arrivalTime: '10:20', pickupTime: '12:20' },
    { arrivalTime: '14:00', pickupTime: null },
  ];

  function scheduledBooking(overrides: Record<string, any> = {}) {
    return booking({
      amountKRW: 173000,
      date: '2026-08-20',
      startTime: '09:30',
      durationHours: 4,
      breakdown: {
        baseKRW: 120000,
        distanceSurchargeKRW: 48000,
        tollKRW: 5000,
        km: 80,
        origin: '서울역',
        destination: '인천공항 제1터미널',
        waypoints: ['성수동'],
      },
      routeSchedule: oldSchedule,
      ...overrides,
    });
  }

  it('일정만 바꿔도 금액·차액·잔액은 변하지 않고 시각만 저장한다', async () => {
    dbState.docs.mood_bookings['booking-1'] = scheduledBooking();
    const { res, json } = await call(validBody({
      booking: validSnapshot({ routeSchedule: changedSchedule }),
    }));

    expect.soft(res.statusCode).toBe(200);
    expect.soft(json.data.oldAmountKRW).toBe(173000);
    expect.soft(json.data.amountKRW).toBe(173000);
    expect.soft(json.data.adjustmentKRW).toBe(0);
    expect.soft(json.data.balanceKRW).toBe(500000);
    expect.soft(json.data.booking.routeSchedule).toEqual(changedSchedule);
    expect.soft(dbState.docs.mood_bookings['booking-1'].routeSchedule).toEqual(changedSchedule);
  });

  it('기존 화면이 일정을 안 보내도 경로와 시작시각이 같으면 저장된 일정을 보존한다', async () => {
    dbState.docs.mood_bookings['booking-1'] = scheduledBooking();
    const { res, json } = await call(validBody());

    expect.soft(res.statusCode).toBe(200);
    expect.soft(json.data.booking.routeSchedule).toEqual(oldSchedule);
    expect.soft(dbState.docs.mood_bookings['booking-1'].routeSchedule).toEqual(oldSchedule);
  });

  it.each([
    ['시작시각', { startTime: '10:00' }],
    ['경로', { waypoints: [] }],
  ])('일정을 안 보낸 예전 화면에서 %s가 바뀌면 낡은 일정을 제거한다', async (_label, snapshotOverrides) => {
    dbState.docs.mood_bookings['booking-1'] = scheduledBooking();
    const { res, json } = await call(validBody({
      booking: validSnapshot(snapshotOverrides),
    }));

    expect.soft(res.statusCode).toBe(200);
    expect.soft(Object.prototype.hasOwnProperty.call(json.data.booking, 'routeSchedule')).toBe(false);
  });

  it('같은 멱등 키에 일정만 다르게 보내도 서로 다른 요청으로 판단한다', async () => {
    dbState.docs.mood_bookings['booking-1'] = scheduledBooking();
    const firstBody = validBody({ booking: validSnapshot({ routeSchedule: changedSchedule }) });
    const first = await call(firstBody);
    const second = await call({
      ...firstBody,
      booking: validSnapshot({ routeSchedule: oldSchedule }),
    });

    expect.soft(first.res.statusCode).toBe(200);
    expect.soft(second.res.statusCode).toBe(409);
    expect.soft(second.json.error).toBe('IDEMPOTENCY_CONFLICT');
  });
});

describe('mood-change 원자성, 개정 번호, 멱등성', () => {
  it('확정 상태와 예상 개정 번호가 맞아야 한다', async () => {
    dbState.docs.mood_bookings['booking-1'] = booking({ status: 'completed' });
    let result = await call(validBody());
    expect(result.res.statusCode).toBe(409);
    expect(result.json.error).toBe('BOOKING_NOT_CHANGEABLE');

    dbState.docs.mood_bookings['booking-1'] = booking({ revision: 4 });
    result = await call(validBody({ idempotencyKey: 'revision-mismatch' }));
    expect(result.res.statusCode).toBe(409);
    expect(result.json).toMatchObject({ error: 'REVISION_CONFLICT', currentRevision: 4 });
  });

  it('현재 회사·고객 문서도 트랜잭션에서 다시 읽어 확인한다', async () => {
    dbState.beforeTransaction = () => {
      dbState.docs.mood_bookings['booking-1'].clientId = 'COMPANY_B';
      dbState.docs.mood_clients.COMPANY_B = { balanceKRW: 500000 };
    };
    const { res, json } = await call(validBody());
    expect(res.statusCode).toBe(403);
    expect(json.error).toBe('BOOKING_ACCESS_DENIED');
    expect(dbState.updates).toHaveLength(0);
  });

  it('트랜잭션 안에서 개정 번호를 다시 확인해 동시 변경을 차단한다', async () => {
    dbState.beforeTransaction = () => {
      dbState.docs.mood_bookings['booking-1'].revision = 1;
    };
    const { res, json } = await call(validBody());
    expect(res.statusCode).toBe(409);
    expect(json.error).toBe('REVISION_CONFLICT');
    expect(dbState.updates).toHaveLength(0);
  });

  it('차액만 잔액에 반영하고 예약·고객·감사·outbox·멱등 응답을 함께 쓴다', async () => {
    const before = structuredClone(dbState.docs.mood_bookings['booking-1']);
    const { res, json } = await call(validBody());
    expect(res.statusCode).toBe(200);
    expect(dbState.docs.mood_clients.COMPANY_A.balanceKRW).toBe(427000);
    expect(dbState.docs.mood_bookings['booking-1']).toMatchObject({
      amountKRW: 173000,
      revision: 1,
      lastAdjustmentKRW: 73000,
      lastChangeReason: '촬영 장소 변경',
      influencerName: '코코',
    });
    expect(json.data.booking).toMatchObject({
      id: 'booking-1',
      date: '2026-08-20',
      revision: 1,
      amountKRW: 173000,
    });

    const audits = Object.values(collectionDocs('mood_booking_change_events'));
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      bookingId: 'booking-1',
      reason: '촬영 장소 변경',
      oldAmountKRW: 100000,
      newAmountKRW: 173000,
      adjustmentKRW: 73000,
      before,
    });
    expect(audits[0].after).toMatchObject({ amountKRW: 173000, revision: 1 });

    expect(Object.values(collectionDocs('mood_notification_outbox'))[0]).toMatchObject({
      bookingId: 'booking-1',
      status: 'pending',
      adjustmentKRW: 73000,
    });
    expect(Object.values(collectionDocs('mood_booking_change_idempotency'))[0]).toMatchObject({
      bookingId: 'booking-1',
      status: 'completed',
      response: json,
    });
  });

  it('같은 키와 같은 요청은 저장된 성공 응답을 돌려주고 재계산·재차감하지 않는다', async () => {
    const body = validBody();
    const first = await call(body);
    const writesAfterFirst = dbState.updates.length + dbState.sets.length;
    const routeCallsAfterFirst = computeRouteMock.mock.calls.length;
    const second = await call(body);

    expect(first.res.statusCode).toBe(200);
    expect(second.res.statusCode).toBe(200);
    expect(second.json).toEqual(first.json);
    expect(dbState.docs.mood_clients.COMPANY_A.balanceKRW).toBe(427000);
    expect(dbState.updates.length + dbState.sets.length).toBe(writesAfterFirst);
    expect(computeRouteMock).toHaveBeenCalledTimes(routeCallsAfterFirst);
  });

  it('일정 필드 도입 전에 저장한 같은 요청의 성공 응답도 그대로 재생한다', async () => {
    const legacyStablePayload = JSON.stringify({
      bookingId: 'booking-1',
      expectedRevision: 0,
      reason: '촬영 장소 변경',
      booking: {
        date: '2026-08-20',
        startTime: '09:30',
        durationHours: 4,
        serviceType: 'vehicle',
        origin: '서울역',
        destination: '인천공항 제1터미널',
        waypoints: ['성수동'],
        note: 'KE123 탑승',
        airportDirection: null,
        airportCode: null,
        hasInfluencerName: true,
        influencerName: '코코',
        courseMoodPercentages: [100, 0, 0],
        courseShareSchemaVersion: 2,
      },
    });
    const documentId = createHash('sha256').update('staff@x.com:change-unique-1').digest('hex');
    const legacyResponse = { ok: true, data: { legacyReplay: true } };
    dbState.docs.mood_booking_change_idempotency = {
      [documentId]: {
        payloadHash: createHash('sha256').update(legacyStablePayload).digest('hex'),
        response: legacyResponse,
      },
    };

    const { res, json } = await call(validBody());

    expect(res.statusCode).toBe(200);
    expect(json).toEqual(legacyResponse);
    expect(computeRouteMock).not.toHaveBeenCalled();
    expect(dbState.updates).toHaveLength(0);
  });

  it('같은 키를 다른 payload에 다시 쓰면 충돌로 거부한다', async () => {
    const first = await call(validBody());
    expect(first.res.statusCode).toBe(200);
    const second = await call(validBody({ reason: '다른 변경 사유' }));
    expect(second.res.statusCode).toBe(409);
    expect(second.json.error).toBe('IDEMPOTENCY_CONFLICT');
    expect(dbState.docs.mood_clients.COMPANY_A.balanceKRW).toBe(427000);
  });

  it('레거시 예약 개정 번호는 0으로 보고 성공 후 1로 올린다', async () => {
    delete dbState.docs.mood_bookings['booking-1'].revision;
    const { res, json } = await call(validBody({ expectedRevision: 0 }));
    expect(res.statusCode).toBe(200);
    expect(json.data.revision).toBe(1);
  });
});

describe('mood-change 잔액 한도', () => {
  it('가격이 오를 때만 신용 한도를 검사한다', async () => {
    dbState.docs.mood_clients.COMPANY_A = { balanceKRW: -250000, creditLimitKRW: 300000 };
    let result = await call(validBody());
    expect(result.res.statusCode).toBe(409);
    expect(result.json.error).toBe('CREDIT_LIMIT_EXCEEDED');
    expect(dbState.docs.mood_clients.COMPANY_A.balanceKRW).toBe(-250000);

    dbState.docs.mood_bookings['booking-1'] = booking({ amountKRW: 100000 });
    dbState.docs.mood_clients.COMPANY_A = { balanceKRW: -350000, creditLimitKRW: 300000 };
    computeRouteMock.mockResolvedValue({ ok: true, km: 10, tollKRW: 0, durationMin: 20 });
    result = await call(validBody({
      idempotencyKey: 'refund-below-limit',
      booking: validSnapshot({ durationHours: 3, waypoints: [] }),
    }));
    // 새 금액 90,000, 10,000원 환원. 잔액이 여전히 한도 아래여도 감액은 허용한다.
    expect(result.res.statusCode).toBe(200);
    expect(result.json.data.adjustmentKRW).toBe(-10000);
    expect(result.json.data.balanceKRW).toBe(-340000);
  });

  it.each([0, -1, 1.5, '300000', Number.MAX_VALUE])(
    'creditLimitKRW가 명시된 잘못된 값이면 변경과 잔액 쓰기를 거절한다: %s',
    async (creditLimitKRW) => {
      dbState.docs.mood_clients.COMPANY_A = { balanceKRW: 500000, creditLimitKRW };
      const { res, json } = await call(validBody());

      expect.soft(res.statusCode).toBe(409);
      expect.soft(json.error).toBe('INVALID_CREDIT_LIMIT');
      expect.soft(dbState.docs.mood_clients.COMPANY_A.balanceKRW).toBe(500000);
      expect.soft(dbState.docs.mood_bookings['booking-1'].revision).toBe(0);
      expect.soft(dbState.updates).toHaveLength(0);
    },
  );

  it.each([undefined, null])(
    'creditLimitKRW가 %s이면 미설정으로 처리한다',
    async (creditLimitKRW) => {
      dbState.docs.mood_clients.COMPANY_A = creditLimitKRW === undefined
        ? { balanceKRW: 500000 }
        : { balanceKRW: 500000, creditLimitKRW };
      const { res, json } = await call(validBody());

      expect.soft(res.statusCode).toBe(200);
      expect.soft(json.data.balanceKRW).toBe(427000);
    },
  );
});
