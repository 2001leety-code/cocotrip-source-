/* eslint-disable @typescript-eslint/no-explicit-any -- Firestore와 HTTP 응답을 작게 모사한다. */
import { createHash } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { openMoodBookingAvailabilityFixture } from '../helpers/mood-booking-availability';

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
  allowlist: { emails: string[]; admins: string[]; settlementApproverEmails: string[]; clientId: string };
  docs: Record<string, Record<string, StoredDoc>>;
  updates: Array<{ ref: Ref; patch: StoredDoc }>;
  sets: Array<{ ref: Ref; value: StoredDoc }>;
  transactionRuns: number;
  beforeTransaction?: () => void;
} = {
  allowlist: { emails: [], admins: [], settlementApproverEmails: [], clientId: '' },
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

async function callAs(email: string, body: Record<string, any>, method = 'POST') {
  verifyUserTokenMock.mockResolvedValue({ ok: true, email, uid: `uid-${email}`, emailVerified: true });
  return call(body, method);
}

async function preview(body: Record<string, any> = validBody()) {
  return callAs('admin@x.com', { ...body, action: 'preview' });
}

async function confirmQuote(
  body: Record<string, any>,
  quoteId: string,
  idempotencyKey = `${String(body.idempotencyKey || 'change')}-confirm`,
) {
  const proposed = await proposeQuote(body, quoteId, idempotencyKey);
  if (proposed.res.statusCode !== 200) return proposed;
  return callAs('approver@x.com', {
    action: 'approve',
    bookingId: String(body.bookingId || ''),
    quoteId,
    idempotencyKey: `${idempotencyKey}-approve`,
  });
}

async function proposeQuote(
  body: Record<string, any>,
  quoteId: string,
  idempotencyKey = `${String(body.idempotencyKey || 'change')}-confirm`,
) {
  return callAs('admin@x.com', {
    ...body,
    action: 'propose',
    quoteId,
    idempotencyKey,
  });
}

async function previewAndConfirm(
  body: Record<string, any> = validBody(),
  confirmIdempotencyKey?: string,
) {
  const previewResult = await preview(body);
  expect(previewResult.res.statusCode).toBe(200);
  const quoteId = previewResult.json.data.quoteId as string;
  const confirmResult = await confirmQuote(body, quoteId, confirmIdempotencyKey);
  return { preview: previewResult, confirm: confirmResult, quoteId };
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

function bookingMatchingSnapshot(overrides: Record<string, any> = {}) {
  return booking({
    amountKRW: 173000,
    ratePerHour: 30000,
    date: '2026-08-20',
    startTime: '09:30',
    durationHours: 4,
    serviceType: 'vehicle',
    note: 'KE123 탑승',
    influencerName: '코코',
    breakdown: {
      baseKRW: 120000,
      distanceSurchargeKRW: 48000,
      tollKRW: 5000,
      km: 80,
      origin: '서울역',
      destination: '인천공항 제1터미널',
      waypoints: ['성수동'],
    },
    routeSnapshot: {
      km: 80,
      tollKRW: 5000,
      durationMin: 95,
      path: [],
      points: [],
    },
    balanceAfterKRW: 427000,
    lastAdjustmentKRW: 73000,
    ...overrides,
  });
}

function collectionDocs(name: string) {
  return dbState.docs[name] || {};
}

function reverseObjectKeyOrder(value: any): any {
  if (Array.isArray(value)) return value.map(reverseObjectKeyOrder);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value).reverse().map(([key, entry]) => [key, reverseObjectKeyOrder(entry)]),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  dbState.allowlist = {
    emails: ['staff@x.com', 'admin@x.com', 'approver@x.com'],
    admins: ['admin@x.com'],
    settlementApproverEmails: ['approver@x.com'],
    clientId: 'COMPANY_A',
  };
  dbState.docs = {
    mood_config: { booking_availability: openMoodBookingAvailabilityFixture() },
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
    const result = await call(validBody());
    expect(result.res.statusCode).toBe(403);
    expect(result.json.error).toBe('BOOKING_ACCESS_DENIED');

    const body = validBody({ idempotencyKey: 'admin-change-1' });
    const adminPreview = await preview(body);
    expect(adminPreview.res.statusCode).toBe(200);
    const adminProposal = await callAs('admin@x.com', {
      ...body,
      action: 'propose',
      quoteId: adminPreview.json.data.quoteId,
      idempotencyKey: 'admin-change-1-propose',
    });
    expect(adminProposal.res.statusCode).toBe(200);
    expect(dbState.docs.mood_clients.COMPANY_B.balanceKRW).toBe(500000);
  });
});

describe('mood-change 입력과 경로 안전장치', () => {
  it('실제 변경이 없으면 경로 계산과 모든 쓰기 없이 거부한다', async () => {
    dbState.docs.mood_bookings['booking-1'] = bookingMatchingSnapshot();

    const { res, json } = await call(validBody());

    expect(res.statusCode).toBe(409);
    expect(json.error).toBe('NO_CHANGES');
    expect(computeRouteMock).not.toHaveBeenCalled();
    expect(dbState.transactionRuns).toBe(0);
    expect(dbState.updates).toHaveLength(0);
    expect(dbState.sets).toHaveLength(0);
  });

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
    const { res, json } = await preview(validBody());
    expect(res.statusCode).toBe(422);
    expect(json.error).toBe('ROUTE_CALCULATION_FAILED');
    expect(json.routeError).toBe('DIRECTIONS_FAILED');
    expect(dbState.updates).toHaveLength(0);
    expect(dbState.sets).toHaveLength(0);
  });

  it('경로 성공 응답의 거리나 톨비가 망가져도 0원으로 통과시키지 않는다', async () => {
    computeRouteMock.mockResolvedValue({ ok: true, tollKRW: 5000, durationMin: 95 });
    const { res, json } = await preview(validBody());
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
    const { res, json } = await preview(validBody());
    expect(res.statusCode).toBe(400);
    expect(json.error).toBe('INVALID_PRICING_RESULT');
    expect(dbState.updates).toHaveLength(0);
    expect(dbState.sets).toHaveLength(0);
  });

  it('금액 변경을 견적 없이 바로 확정하면 저장 전에 거부한다', async () => {
    const { res, json } = await call(validBody());

    expect(res.statusCode).toBe(409);
    expect(json.error).toBe('CHANGE_PROPOSAL_REQUIRED');
    expect(computeRouteMock).not.toHaveBeenCalled();
    expect(dbState.docs.mood_clients.COMPANY_A.balanceKRW).toBe(500000);
    expect(dbState.docs.mood_bookings['booking-1'].bookingChangeApproval).toBeUndefined();
    expect(dbState.updates).toHaveLength(0);
    expect(dbState.sets).toHaveLength(0);
  });

  it('클라이언트 금액·거리·톨비는 무시하고 서버 견적을 그대로 확정한다', async () => {
    const body = validBody({ amountKRW: 10, tollKRW: 20, km: 1 });
    const result = await previewAndConfirm(body);
    const { res, json } = result.confirm;
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
    expect(result.preview.json.data).toMatchObject({
      preview: true,
      currency: 'KRW',
      amountKRW: 173000,
      adjustmentKRW: 73000,
      balanceKRW: 427000,
    });
    expect(computeRouteMock).toHaveBeenCalledTimes(1);
  });

  it('공항 경유 예약은 경유 경로와 직행 경로 차이만 현재 요율로 더한다', async () => {
    computeRouteMock
      .mockResolvedValueOnce({ ok: true, km: 70, tollKRW: 9000, durationMin: 90 })
      .mockResolvedValueOnce({ ok: true, km: 50, tollKRW: 5000, durationMin: 60 });
    const result = await previewAndConfirm(validBody({
      booking: validSnapshot({
        durationHours: 0,
        serviceType: 'airport',
        airportDirection: 'sending',
        airportCode: 'ICN',
        waypoints: ['촬영지'],
      }),
    }));
    const { res, json } = result.confirm;
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
    return bookingMatchingSnapshot({
      routeSchedule: oldSchedule,
      ...overrides,
    });
  }

  it('일정만 바꾸면 경로를 다시 계산하지 않고 모든 저장 금액 필드를 보존한다', async () => {
    dbState.docs.mood_bookings['booking-1'] = scheduledBooking();
    const moneyBefore = {
      amountKRW: dbState.docs.mood_bookings['booking-1'].amountKRW,
      ratePerHour: dbState.docs.mood_bookings['booking-1'].ratePerHour,
      breakdown: structuredClone(dbState.docs.mood_bookings['booking-1'].breakdown),
      routeSnapshot: structuredClone(dbState.docs.mood_bookings['booking-1'].routeSnapshot),
      balanceAfterKRW: dbState.docs.mood_bookings['booking-1'].balanceAfterKRW,
      lastAdjustmentKRW: dbState.docs.mood_bookings['booking-1'].lastAdjustmentKRW,
    };
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
    expect.soft(computeRouteMock).not.toHaveBeenCalled();
    expect.soft(dbState.docs.mood_bookings['booking-1']).toMatchObject(moneyBefore);
    expect.soft(dbState.docs.mood_clients.COMPANY_A.balanceKRW).toBe(500000);
    expect.soft(dbState.updates.filter((write) => write.ref.__collection === 'mood_clients')).toHaveLength(0);
  });

  it('기존 화면이 일정을 안 보내도 경로와 시작시각이 같으면 저장된 일정을 보존한다', async () => {
    dbState.docs.mood_bookings['booking-1'] = scheduledBooking();
    const { res, json } = await call(validBody({
      booking: validSnapshot({ note: '새 메모' }),
    }));

    expect.soft(res.statusCode).toBe(200);
    expect.soft(json.data.booking.routeSchedule).toEqual(oldSchedule);
    expect.soft(dbState.docs.mood_bookings['booking-1'].routeSchedule).toEqual(oldSchedule);
  });

  it('일정을 안 보낸 예전 화면에서 시작시각이 바뀌면 낡은 일정을 제거한다', async () => {
    dbState.docs.mood_bookings['booking-1'] = scheduledBooking();
    const { res, json } = await call(validBody({
      booking: validSnapshot({ startTime: '10:00' }),
    }));

    expect.soft(res.statusCode).toBe(200);
    expect.soft(Object.prototype.hasOwnProperty.call(json.data.booking, 'routeSchedule')).toBe(false);
  });

  it('일정을 안 보낸 예전 화면에서 경로가 바뀌면 견적 확정 뒤 낡은 일정을 제거한다', async () => {
    dbState.docs.mood_bookings['booking-1'] = scheduledBooking();
    const result = await previewAndConfirm(validBody({
      booking: validSnapshot({ waypoints: [] }),
    }));

    expect.soft(result.confirm.res.statusCode).toBe(200);
    expect.soft(Object.prototype.hasOwnProperty.call(result.confirm.json.data.booking, 'routeSchedule')).toBe(false);
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
    const body = validBody();
    const previewResult = await preview(body);
    expect(previewResult.res.statusCode).toBe(200);
    dbState.beforeTransaction = () => {
      dbState.docs.mood_bookings['booking-1'].clientId = 'COMPANY_B';
      dbState.docs.mood_clients.COMPANY_B = { balanceKRW: 500000 };
    };
    const { res, json } = await confirmQuote(body, previewResult.json.data.quoteId);
    expect(res.statusCode).toBe(409);
    expect(json.error).toBe('CHANGE_QUOTE_MISMATCH');
    expect(dbState.updates).toHaveLength(0);
  });

  it('견적 뒤 트랜잭션 안에서 개정 번호를 다시 확인해 동시 변경을 차단한다', async () => {
    const body = validBody();
    const previewResult = await preview(body);
    expect(previewResult.res.statusCode).toBe(200);
    dbState.beforeTransaction = () => {
      dbState.docs.mood_bookings['booking-1'].revision = 1;
    };
    const { res, json } = await confirmQuote(body, previewResult.json.data.quoteId);
    expect(res.statusCode).toBe(409);
    expect(json.error).toBe('REVISION_CONFLICT');
    expect(dbState.updates).toHaveLength(0);
  });

  it.each(['awaiting_mood', 'changes_requested'])(
    '정산 확인 상태가 %s이면 예약 변경을 차단한다',
    async (status) => {
      dbState.docs.mood_bookings['booking-1'].settlementApproval = { status };

      const { res, json } = await preview(validBody());

      expect(res.statusCode).toBe(409);
      expect(json.error).toBe('SETTLEMENT_APPROVAL_PENDING');
      expect(dbState.docs.mood_clients.COMPANY_A.balanceKRW).toBe(500000);
      expect(dbState.updates).toHaveLength(0);
    },
  );

  it('트랜잭션 직전에 정산 확인이 생겨도 예약 변경을 차단한다', async () => {
    dbState.beforeTransaction = () => {
      dbState.docs.mood_bookings['booking-1'].settlementApproval = { status: 'changes_requested' };
    };

    const { res, json } = await preview(validBody());

    expect(res.statusCode).toBe(409);
    expect(json.error).toBe('SETTLEMENT_APPROVAL_PENDING');
    expect(dbState.docs.mood_clients.COMPANY_A.balanceKRW).toBe(500000);
    expect(dbState.updates).toHaveLength(0);
  });

  it('차액만 잔액에 반영하고 예약·고객·감사·outbox·멱등 응답을 함께 쓴다', async () => {
    const before = structuredClone(dbState.docs.mood_bookings['booking-1']);
    const body = validBody();
    const previewResult = await preview(body);
    const quoteId = previewResult.json.data.quoteId;

    expect(previewResult.res.statusCode).toBe(200);
    expect(computeRouteMock).toHaveBeenCalledTimes(1);
    expect(dbState.updates).toHaveLength(0);
    expect(dbState.sets).toHaveLength(1);
    expect(dbState.sets[0].ref.__collection).toBe('mood_booking_change_quotes');
    expect(Object.keys(collectionDocs('mood_booking_change_quotes'))).toEqual([quoteId]);
    expect(Object.keys(collectionDocs('mood_booking_change_events'))).toHaveLength(0);
    expect(dbState.docs.mood_clients.COMPANY_A.balanceKRW).toBe(500000);

    const { res, json } = await confirmQuote(body, quoteId);
    expect(res.statusCode).toBe(200);
    expect(computeRouteMock).toHaveBeenCalledTimes(1);
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
    expect(audits).toHaveLength(2);
    const approvedAudit = audits.find((audit) => audit.type === 'booking_change_approved');
    expect(approvedAudit).toMatchObject({
      bookingId: 'booking-1',
      reason: '촬영 장소 변경',
      oldAmountKRW: 100000,
      newAmountKRW: 173000,
      adjustmentKRW: 73000,
      before,
    });
    expect(approvedAudit.after).toMatchObject({ amountKRW: 173000, revision: 1 });

    const approvedOutbox = Object.values(collectionDocs('mood_notification_outbox'))
      .find((entry) => entry.type === 'mood_booking_change_approved');
    expect(approvedOutbox).toMatchObject({
      bookingId: 'booking-1',
      status: 'pending',
      adjustmentKRW: 73000,
    });
    const approvalIdempotency = Object.values(collectionDocs('mood_booking_change_idempotency'))
      .find((entry) => entry.action === 'approve');
    expect(approvalIdempotency).toMatchObject({
      bookingId: 'booking-1',
      status: 'completed',
      response: json,
    });
    expect(collectionDocs('mood_booking_change_quotes')[quoteId]).toMatchObject({
      status: 'approved',
      currency: 'KRW',
    });
  });

  it('비금액 변경은 같은 키와 같은 요청을 저장된 성공 응답으로 재생한다', async () => {
    dbState.docs.mood_bookings['booking-1'] = bookingMatchingSnapshot();
    const body = validBody({ booking: validSnapshot({ note: '새 메모' }) });
    const first = await call(body);
    const writesAfterFirst = dbState.updates.length + dbState.sets.length;
    const routeCallsAfterFirst = computeRouteMock.mock.calls.length;
    const second = await call(body);

    expect(first.res.statusCode).toBe(200);
    expect(second.res.statusCode).toBe(200);
    expect(second.json).toEqual(first.json);
    expect(dbState.docs.mood_clients.COMPANY_A.balanceKRW).toBe(500000);
    expect(dbState.updates.length + dbState.sets.length).toBe(writesAfterFirst);
    expect(computeRouteMock).toHaveBeenCalledTimes(routeCallsAfterFirst);
  });

  it('소비된 견적은 같은 키 재시도만 성공 응답을 재생하고 다른 키 재사용은 거부한다', async () => {
    const body = validBody();
    const previewResult = await preview(body);
    const quoteId = previewResult.json.data.quoteId;
    const first = await confirmQuote(body, quoteId, 'confirm-once');
    const writesAfterFirst = dbState.updates.length + dbState.sets.length;
    const routeCallsAfterFirst = computeRouteMock.mock.calls.length;

    const sameKeyReplay = await confirmQuote(body, quoteId, 'confirm-once');
    const differentKeyReplay = await confirmQuote(body, quoteId, 'confirm-again');

    expect(first.res.statusCode).toBe(200);
    expect(sameKeyReplay.res.statusCode).toBe(200);
    expect(sameKeyReplay.json).toEqual(first.json);
    expect(differentKeyReplay.res.statusCode).toBe(409);
    expect(differentKeyReplay.json.error).toBe('CHANGE_QUOTE_ALREADY_USED');
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
    const body = validBody();
    const previewResult = await preview(body);
    const first = await confirmQuote(body, previewResult.json.data.quoteId, 'same-confirm-key');
    expect(first.res.statusCode).toBe(200);
    const second = await callAs('admin@x.com', validBody({
      action: 'propose',
      idempotencyKey: 'same-confirm-key',
      quoteId: previewResult.json.data.quoteId,
      reason: '다른 변경 사유',
    }));
    expect(second.res.statusCode).toBe(409);
    expect(second.json.error).toBe('IDEMPOTENCY_CONFLICT');
    expect(dbState.docs.mood_clients.COMPANY_A.balanceKRW).toBe(427000);
  });

  it('같은 키와 같은 payload라도 다른 동작으로 재사용하면 충돌로 거부한다', async () => {
    const body = validBody({ idempotencyKey: 'cross-action-key' });
    const previewResult = await preview(body);
    const quoteId = previewResult.json.data.quoteId;
    const proposal = await proposeQuote(body, quoteId, 'cross-action-key');
    expect(proposal.res.statusCode).toBe(200);

    const conflict = await callAs('admin@x.com', {
      ...body,
      action: 'confirm',
      quoteId,
      idempotencyKey: 'cross-action-key',
    });

    expect(conflict.res.statusCode).toBe(409);
    expect(conflict.json.error).toBe('IDEMPOTENCY_CONFLICT');
    expect(dbState.docs.mood_clients.COMPANY_A.balanceKRW).toBe(500000);
    expect(dbState.docs.mood_bookings['booking-1'].revision).toBe(0);
  });

  it('레거시 예약 개정 번호는 0으로 보고 성공 후 1로 올린다', async () => {
    delete dbState.docs.mood_bookings['booking-1'].revision;
    const result = await previewAndConfirm(validBody({ expectedRevision: 0 }));
    const { res, json } = result.confirm;
    expect(res.statusCode).toBe(200);
    expect(json.data.revision).toBe(1);
  });
});

describe('mood-change 서버 견적 무결성', () => {
  it('서버 견적의 금액 구성값이 바뀌면 확정과 잔액 변경을 거부한다', async () => {
    const body = validBody();
    const previewResult = await preview(body);
    const quoteId = previewResult.json.data.quoteId;
    const quote = collectionDocs('mood_booking_change_quotes')[quoteId];
    quote.breakdown.tollKRW += 1;

    const { res, json } = await confirmQuote(body, quoteId);

    expect(res.statusCode).toBe(409);
    expect(json.error).toBe('CHANGE_QUOTE_INTEGRITY_FAILED');
    expect(dbState.docs.mood_bookings['booking-1'].revision).toBe(0);
    expect(dbState.docs.mood_clients.COMPANY_A.balanceKRW).toBe(500000);
    expect(computeRouteMock).toHaveBeenCalledTimes(1);
  });

  it('중첩 객체의 키 순서만 달라진 같은 견적은 무결성을 유지한다', async () => {
    const body = validBody();
    const previewResult = await preview(body);
    const quoteId = previewResult.json.data.quoteId;
    const quote = collectionDocs('mood_booking_change_quotes')[quoteId];
    quote.breakdown = reverseObjectKeyOrder(quote.breakdown);
    quote.routeSnapshot = reverseObjectKeyOrder(quote.routeSnapshot);

    const { res, json } = await confirmQuote(body, quoteId);

    expect(res.statusCode).toBe(200);
    expect(json.data).toMatchObject({ amountKRW: 173000, adjustmentKRW: 73000 });
    expect(computeRouteMock).toHaveBeenCalledTimes(1);
  });

  it('견적 뒤 고객 잔액이 달라지면 오래된 견적으로 확정하지 않는다', async () => {
    const body = validBody();
    const previewResult = await preview(body);
    const quoteId = previewResult.json.data.quoteId;
    dbState.docs.mood_clients.COMPANY_A.balanceKRW = 499999;

    const { res, json } = await confirmQuote(body, quoteId);

    expect(res.statusCode).toBe(409);
    expect(json.error).toBe('CHANGE_QUOTE_BALANCE_STALE');
    expect(dbState.docs.mood_bookings['booking-1'].revision).toBe(0);
    expect(dbState.docs.mood_clients.COMPANY_A.balanceKRW).toBe(499999);
    expect(computeRouteMock).toHaveBeenCalledTimes(1);
  });

  it('15분이 지난 견적은 경계 시각부터 만료로 거부한다', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-26T00:00:00.000Z'));
    try {
      const body = validBody();
      const previewResult = await preview(body);
      const quoteId = previewResult.json.data.quoteId;
      vi.advanceTimersByTime(15 * 60 * 1000);

      const { res, json } = await confirmQuote(body, quoteId);

      expect(res.statusCode).toBe(409);
      expect(json.error).toBe('CHANGE_QUOTE_EXPIRED');
      expect(dbState.docs.mood_bookings['booking-1'].revision).toBe(0);
      expect(dbState.docs.mood_clients.COMPANY_A.balanceKRW).toBe(500000);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('mood-change 잔액 한도', () => {
  it('가격이 오를 때만 신용 한도를 검사한다', async () => {
    dbState.docs.mood_clients.COMPANY_A = { balanceKRW: -250000, creditLimitKRW: 300000 };
    let result = await preview(validBody());
    expect(result.res.statusCode).toBe(409);
    expect(result.json.error).toBe('CREDIT_LIMIT_EXCEEDED');
    expect(dbState.docs.mood_clients.COMPANY_A.balanceKRW).toBe(-250000);

    dbState.docs.mood_bookings['booking-1'] = booking({ amountKRW: 100000 });
    dbState.docs.mood_clients.COMPANY_A = { balanceKRW: -350000, creditLimitKRW: 300000 };
    computeRouteMock.mockResolvedValue({ ok: true, km: 10, tollKRW: 0, durationMin: 20 });
    const decreaseBody = validBody({
      idempotencyKey: 'refund-below-limit',
      booking: validSnapshot({ durationHours: 3, waypoints: [] }),
    });
    const decreaseResult = await previewAndConfirm(decreaseBody);
    result = decreaseResult.confirm;
    // 새 금액 90,000, 10,000원 환원. 잔액이 여전히 한도 아래여도 감액은 허용한다.
    expect(result.res.statusCode).toBe(200);
    expect(result.json.data.adjustmentKRW).toBe(-10000);
    expect(result.json.data.balanceKRW).toBe(-340000);
  });

  it.each([0, -1, 1.5, '300000', Number.MAX_VALUE])(
    'creditLimitKRW가 명시된 잘못된 값이면 변경과 잔액 쓰기를 거절한다: %s',
    async (creditLimitKRW) => {
      dbState.docs.mood_clients.COMPANY_A = { balanceKRW: 500000, creditLimitKRW };
      const { res, json } = await preview(validBody());

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
      const result = await previewAndConfirm(validBody());
      const { res, json } = result.confirm;

      expect.soft(res.statusCode).toBe(200);
      expect.soft(json.data.balanceKRW).toBe(427000);
    },
  );
});

describe('mood-change 운영자 제안과 MOOD 양측 확인', () => {
  it('미리보기는 알리지 않고 제안·승인은 각각 한 번만 알리며 재시도는 중복 알림을 보내지 않는다', async () => {
    const body = validBody({ idempotencyKey: 'notification-contract' });
    const previewResult = await preview(body);
    const quoteId = previewResult.json.data.quoteId;
    expect(notifyMock).not.toHaveBeenCalled();

    const proposalKey = 'notification-proposal';
    const firstProposal = await proposeQuote(body, quoteId, proposalKey);
    const replayedProposal = await proposeQuote(body, quoteId, proposalKey);
    expect(firstProposal.res.statusCode).toBe(200);
    expect(replayedProposal.res.statusCode).toBe(200);
    expect(notifyMock).toHaveBeenCalledTimes(1);
    expect(notifyMock.mock.calls[0]?.[1]).toContain('금액 확인 요청');

    const approvalRequest = {
      action: 'approve',
      bookingId: 'booking-1',
      quoteId,
      idempotencyKey: 'notification-approval',
    };
    const firstApproval = await callAs('approver@x.com', approvalRequest);
    const replayedApproval = await callAs('approver@x.com', approvalRequest);
    expect(firstApproval.res.statusCode).toBe(200);
    expect(replayedApproval.res.statusCode).toBe(200);
    expect(notifyMock).toHaveBeenCalledTimes(2);
    expect(notifyMock.mock.calls[1]?.[1]).toContain('양측 확인 완료');
  });

  it('금액 영향 변경은 운영자만 제안하고 지정 MOOD 승인자만 확정한다', async () => {
    const body = validBody({ idempotencyKey: 'role-separated-change' });
    const staffPreview = await callAs('staff@x.com', { ...body, action: 'preview' });
    expect(staffPreview.res.statusCode).toBe(403);
    expect(staffPreview.json.error).toBe('ADMIN_REQUIRED');

    const adminPreview = await preview(body);
    const quoteId = adminPreview.json.data.quoteId;
    const staffProposal = await callAs('staff@x.com', {
      ...body,
      action: 'propose',
      quoteId,
      idempotencyKey: 'staff-proposal',
    });
    expect(staffProposal.res.statusCode).toBe(403);
    expect(staffProposal.json.error).toBe('ADMIN_REQUIRED');

    const proposal = await proposeQuote(body, quoteId, 'admin-proposal');
    expect(proposal.res.statusCode).toBe(200);

    const adminApproval = await callAs('admin@x.com', {
      action: 'approve',
      bookingId: 'booking-1',
      quoteId,
      idempotencyKey: 'admin-self-approve',
    });
    expect(adminApproval.res.statusCode).toBe(403);
    expect(adminApproval.json.error).toBe('CHANGE_APPROVER_REQUIRED');

    const staffApproval = await callAs('staff@x.com', {
      action: 'approve',
      bookingId: 'booking-1',
      quoteId,
      idempotencyKey: 'staff-approve',
    });
    expect(staffApproval.res.statusCode).toBe(403);
    expect(staffApproval.json.error).toBe('CHANGE_APPROVER_REQUIRED');

    const approval = await callAs('approver@x.com', {
      action: 'approve',
      bookingId: 'booking-1',
      quoteId,
      idempotencyKey: 'mood-approve',
    });
    expect(approval.res.statusCode).toBe(200);
  });

  it('운영자 제안 단계는 예약 본문·금액·잔액을 바꾸지 않는다', async () => {
    const body = validBody({ idempotencyKey: 'proposal-money-invariant' });
    const before = JSON.parse(JSON.stringify(dbState.docs.mood_bookings['booking-1']));
    const previewResult = await preview(body);
    const quoteId = previewResult.json.data.quoteId;
    const proposal = await proposeQuote(body, quoteId, 'proposal-money-invariant-confirm');

    expect(proposal.res.statusCode).toBe(200);
    expect(proposal.json.data.status).toBe('awaiting_mood');
    expect(dbState.docs.mood_clients.COMPANY_A.balanceKRW).toBe(500000);
    expect(dbState.docs.mood_bookings['booking-1']).toMatchObject({
      date: before.date,
      startTime: before.startTime,
      durationHours: before.durationHours,
      amountKRW: before.amountKRW,
      breakdown: before.breakdown,
      revision: before.revision,
      bookingChangeApproval: {
        status: 'awaiting_mood',
        quoteId,
        oldAmountKRW: 100000,
        amountKRW: 173000,
        adjustmentKRW: 73000,
      },
    });
    expect(collectionDocs('mood_booking_change_quotes')[quoteId]).toMatchObject({
      status: 'awaiting_mood',
      proposedByEmail: 'admin@x.com',
      proposedByRole: 'admin',
    });
  });

  it('MOOD 확정은 클라이언트 위조 금액 대신 서버 저장 제안만 적용한다', async () => {
    const body = validBody({ idempotencyKey: 'approval-server-snapshot' });
    const previewResult = await preview(body);
    const quoteId = previewResult.json.data.quoteId;
    await proposeQuote(body, quoteId, 'approval-server-snapshot-propose');

    const approval = await callAs('approver@x.com', {
      action: 'approve',
      bookingId: 'booking-1',
      quoteId,
      idempotencyKey: 'approval-server-snapshot-approve',
      amountKRW: 1,
      balanceKRW: 999999999,
      booking: validSnapshot({ durationHours: 1, origin: '위조 출발지' }),
    });

    expect(approval.res.statusCode).toBe(200);
    expect(approval.json.data).toMatchObject({ amountKRW: 173000, adjustmentKRW: 73000, balanceKRW: 427000 });
    expect(dbState.docs.mood_bookings['booking-1']).toMatchObject({
      durationHours: 4,
      amountKRW: 173000,
      breakdown: { origin: '서울역' },
    });
  });

  it('운영자는 확인 대기 제안을 철회할 수 있고 같은 요청은 안전하게 재생된다', async () => {
    const body = validBody({ idempotencyKey: 'withdraw-change' });
    const previewResult = await preview(body);
    const quoteId = previewResult.json.data.quoteId;
    await proposeQuote(body, quoteId, 'withdraw-change-propose');
    const request = {
      action: 'withdraw',
      bookingId: 'booking-1',
      quoteId,
      idempotencyKey: 'withdraw-change-confirm',
    };
    const first = await callAs('admin@x.com', request);
    const writesAfterFirst = dbState.updates.length + dbState.sets.length;
    const second = await callAs('admin@x.com', request);

    expect(first.res.statusCode).toBe(200);
    expect(second.res.statusCode).toBe(200);
    expect(second.json).toEqual(first.json);
    expect(dbState.updates.length + dbState.sets.length).toBe(writesAfterFirst);
    expect(dbState.docs.mood_clients.COMPANY_A.balanceKRW).toBe(500000);
    expect(dbState.docs.mood_bookings['booking-1']).toMatchObject({
      amountKRW: 100000,
      revision: 0,
      bookingChangeApproval: { status: 'withdrawn', quoteId },
    });
    expect(collectionDocs('mood_booking_change_quotes')[quoteId].status).toBe('withdrawn');
  });

  it('화면에 복제된 제안 금액이 서버 견적과 다르면 확정을 막는다', async () => {
    const body = validBody({ idempotencyKey: 'tampered-summary' });
    const previewResult = await preview(body);
    const quoteId = previewResult.json.data.quoteId;
    await proposeQuote(body, quoteId, 'tampered-summary-propose');
    dbState.docs.mood_bookings['booking-1'].bookingChangeApproval.amountKRW += 1;

    const approval = await callAs('approver@x.com', {
      action: 'approve',
      bookingId: 'booking-1',
      quoteId,
      idempotencyKey: 'tampered-summary-approve',
    });

    expect(approval.res.statusCode).toBe(409);
    expect(approval.json.error).toBe('CHANGE_PROPOSAL_MISMATCH');
    expect(dbState.docs.mood_clients.COMPANY_A.balanceKRW).toBe(500000);
    expect(dbState.docs.mood_bookings['booking-1'].amountKRW).toBe(100000);
  });

  it('비용 분담률만 바꾸면 경로를 다시 계산하지 않고 저장 금액·경로·잔액을 보존한다', async () => {
    const storedRouteSnapshot = {
      km: 80,
      tollKRW: 5000,
      durationMin: 95,
      path: [],
      points: [],
    };
    dbState.docs.mood_bookings['booking-1'] = bookingMatchingSnapshot({
      courseMoodPercentages: [100, 0, 0],
      courseShareSchemaVersion: 2,
      coursePayers: ['mood', 'influencer', 'influencer'],
      routeSnapshot: storedRouteSnapshot,
    });
    dbState.docs.mood_clients.COMPANY_A.balanceKRW = 427000;
    const body = validBody({
      idempotencyKey: 'share-only-change',
      booking: validSnapshot({ courseMoodPercentages: [50, 0, 0] }),
    });
    const result = await previewAndConfirm(body);

    expect(result.confirm.res.statusCode).toBe(200);
    expect(computeRouteMock).not.toHaveBeenCalled();
    expect(dbState.docs.mood_clients.COMPANY_A.balanceKRW).toBe(427000);
    expect(dbState.docs.mood_bookings['booking-1']).toMatchObject({
      amountKRW: 173000,
      ratePerHour: 30000,
      breakdown: bookingMatchingSnapshot().breakdown,
      routeSnapshot: storedRouteSnapshot,
      balanceAfterKRW: 427000,
      lastAdjustmentKRW: 73000,
      courseMoodPercentages: [50, 0, 0],
    });
  });
});
