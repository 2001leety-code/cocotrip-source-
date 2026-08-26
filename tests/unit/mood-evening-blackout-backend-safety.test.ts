/* eslint-disable @typescript-eslint/no-explicit-any -- MOOD API와 Firestore를 작게 모사하는 안전 회귀 테스트. */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const verifyUserTokenMock = vi.fn();
const computeRouteMock = vi.fn();
const notifyMock = vi.fn();

vi.mock('../../api/_shared/user-auth.js', () => ({
  verifyUserToken: (...args: any[]) => verifyUserTokenMock(...args),
  default: (...args: any[]) => verifyUserTokenMock(...args),
}));

vi.mock('../../api/_shared/mood-route.js', () => ({
  computeRoute: (...args: any[]) => computeRouteMock(...args),
}));

vi.mock('../../api/_shared/mood-allowlist.js', () => ({
  getMoodAllowlist: async () => ({
    emails: ['staff@x.com', 'approver@x.com'],
    admins: ['staff@x.com'],
    settlementApproverEmails: ['approver@x.com'],
    clientId: 'COMPANY_A',
  }),
  isAllowedEmail: (allowlist: any, email: string) => allowlist.emails.includes(email),
  isAdminEmail: (allowlist: any, email: string) => allowlist.admins.includes(email),
  isSettlementApproverEmail: (allowlist: any, email: string) =>
    (allowlist.settlementApproverEmails || []).includes(email) && !allowlist.admins.includes(email),
}));

vi.mock('../../api/_shared/cors.js', () => ({ buildAdminJsonCors: () => ({}) }));
vi.mock('../../api/_shared/sentry.js', () => ({ captureError: vi.fn() }));
vi.mock('../../api/_shared/notify.js', () => ({
  notify: (...args: any[]) => notifyMock(...args),
}));

type StoredDoc = Record<string, any>;
type Ref = {
  collection: string;
  id: string;
  get: () => Promise<{ exists: boolean; data: () => StoredDoc | undefined }>;
};

const docs: Record<string, Record<string, StoredDoc>> = {};
const writes: Array<{ kind: 'set' | 'update'; collection: string; id: string; value: StoredDoc }> = [];
let autoId = 0;
let beforeTransaction: (() => void) | undefined;

function stored(ref: Ref) {
  return docs[ref.collection] && docs[ref.collection][ref.id];
}

function snapshot(ref: Ref) {
  const value = stored(ref);
  return {
    exists: value !== undefined,
    data: () => value === undefined ? undefined : structuredClone(value),
  };
}

function makeRef(collection: string, requestedId?: string): Ref {
  const ref: Ref = {
    collection,
    id: requestedId || `auto-${++autoId}`,
    get: async () => snapshot(ref),
  };
  return ref;
}

function applyWrite(kind: 'set' | 'update', ref: Ref, value: StoredDoc) {
  docs[ref.collection] ||= {};
  const next = kind === 'update'
    ? { ...(docs[ref.collection][ref.id] || {}), ...value }
    : value;
  docs[ref.collection][ref.id] = structuredClone(next);
  writes.push({ kind, collection: ref.collection, id: ref.id, value: structuredClone(value) });
}

const dbMock = {
  collection: vi.fn((collection: string) => ({
    doc: vi.fn((id?: string) => makeRef(collection, id)),
  })),
  runTransaction: vi.fn(async (callback: (tx: any) => Promise<any>) => {
    if (beforeTransaction) {
      const hook = beforeTransaction;
      beforeTransaction = undefined;
      hook();
    }
    const staged: Array<() => void> = [];
    const result = await callback({
      get: async (ref: Ref) => snapshot(ref),
      set: (ref: Ref, value: StoredDoc) => staged.push(() => applyWrite('set', ref, value)),
      update: (ref: Ref, value: StoredDoc) => staged.push(() => applyWrite('update', ref, value)),
    });
    staged.forEach((commit) => commit());
    return result;
  }),
};

vi.mock('../../api/_shared/firebase-admin.js', () => ({ initAdminDb: () => dbMock }));

type MockResponse = {
  statusCode: number;
  body: string;
  headers: Record<string, string>;
  writeHead: (status: number, headers?: Record<string, string>) => MockResponse;
  setHeader: (name: string, value: string) => void;
  end: (body?: string | Buffer) => MockResponse;
};

function response(): MockResponse {
  const res: MockResponse = {
    statusCode: 0,
    body: '',
    headers: {},
    writeHead(status, headers) {
      res.statusCode = status;
      Object.assign(res.headers, headers || {});
      return res;
    },
    setHeader(name, value) {
      res.headers[name] = value;
    },
    end(body) {
      res.body = body instanceof Buffer ? body.toString('utf8') : (body || '');
      return res;
    },
  };
  return res;
}

const BOOK_BODY = {
  clientId: 'COMPANY_A',
  date: '2026-09-10',
  startTime: '18:00',
  durationHours: 3,
  serviceType: 'vehicle',
  origin: '서울역',
  destination: '인천공항',
  waypoints: [],
  idempotencyKey: 'evening-book-safety-0001',
};

const EXISTING_BOOKING = {
  clientId: 'COMPANY_A',
  status: 'confirmed',
  revision: 0,
  amountKRW: 100_000,
  date: '2026-09-10',
  startTime: '18:30',
  durationHours: 3,
  serviceType: 'vehicle',
  note: '기존 메모',
  breakdown: {
    baseKRW: 90_000,
    distanceSurchargeKRW: 10_000,
    tollKRW: 0,
    km: 20,
    origin: '기존 출발지',
    destination: '기존 도착지',
    waypoints: null,
  },
  createdByEmail: 'staff@x.com',
  createdAt: 1,
};

function changeBody(overrides: Record<string, any> = {}) {
  return {
    bookingId: 'existing-blocked',
    expectedRevision: 0,
    idempotencyKey: 'evening-change-safety-0001',
    reason: '촬영 동선 변경',
    booking: {
      date: '2026-09-10',
      startTime: '18:30',
      durationHours: 4,
      serviceType: 'vehicle',
      origin: '새 출발지',
      destination: '새 도착지',
      waypoints: [],
      note: '새 메모',
      airportDirection: null,
      airportCode: null,
      ...overrides,
    },
  };
}

async function callBook(body: Record<string, any>) {
  const { default: handler } = await import('../../api/mood-book.js');
  const res = response();
  await handler({
    method: 'POST',
    headers: { authorization: 'Bearer token' },
    body,
  } as any, res as any);
  return { res, json: JSON.parse(res.body || '{}') };
}

async function callChange(body: Record<string, any>) {
  const { default: handler } = await import('../../api/mood-change.js');
  const res = response();
  await handler({
    method: 'POST',
    headers: { authorization: 'Bearer token' },
    body,
  } as any, res as any);
  return { res, json: JSON.parse(res.body || '{}') };
}

async function callQuotedChange(body: Record<string, any>) {
  const preview = await callChange({ ...body, action: 'preview' });
  if (preview.res.statusCode !== 200) return { ...preview, preview };
  const proposal = await callChange({
    ...body,
    action: 'propose',
    quoteId: preview.json.data.quoteId,
    idempotencyKey: `${body.idempotencyKey}-propose`,
  });
  if (proposal.res.statusCode !== 200) return { ...proposal, preview, proposal };
  verifyUserTokenMock.mockResolvedValue({ ok: true, email: 'approver@x.com', uid: 'approver-1', emailVerified: true });
  const approval = await callChange({
    action: 'approve',
    bookingId: body.bookingId,
    quoteId: preview.json.data.quoteId,
    idempotencyKey: `${body.idempotencyKey}-approve`,
  });
  verifyUserTokenMock.mockResolvedValue({ ok: true, email: 'staff@x.com', uid: 'staff-1', emailVerified: true });
  return { ...approval, preview, proposal };
}

beforeEach(() => {
  vi.clearAllMocks();
  for (const key of Object.keys(docs)) delete docs[key];
  docs.mood_clients = { COMPANY_A: { name: '무드', balanceKRW: 500_000 } };
  docs.mood_bookings = { 'existing-blocked': structuredClone(EXISTING_BOOKING) };
  writes.length = 0;
  autoId = 0;
  beforeTransaction = undefined;
  verifyUserTokenMock.mockResolvedValue({
    ok: true,
    email: 'staff@x.com',
    uid: 'staff-1',
    emailVerified: true,
  });
  computeRouteMock.mockResolvedValue({
    ok: true,
    km: 30,
    tollKRW: 2_000,
    durationMin: 50,
    path: [],
    points: [],
  });
  notifyMock.mockResolvedValue(undefined);
});

describe('MOOD 저녁 제한 신규 예약 서버 안전', () => {
  it.each([
    ['첫날 경계', '2026-08-15', '18:00'],
    ['기간 중 목요일', '2026-08-20', '23:59'],
    ['기존 예약이 있는 날', '2026-09-10', '18:00'],
    ['마지막 대상 토요일', '2026-09-12', '18:01'],
  ])('%s은 409로 막고 경로·트랜잭션·기존 데이터를 건드리지 않는다', async (_label, date, startTime) => {
    const beforeBookings = structuredClone(docs.mood_bookings);
    const beforeClient = structuredClone(docs.mood_clients.COMPANY_A);
    const { res, json } = await callBook({ ...BOOK_BODY, date, startTime });

    expect.soft(res.statusCode).toBe(409);
    expect.soft(json.error).toBe('MOOD_EVENING_BOOKING_UNAVAILABLE');
    expect.soft(computeRouteMock).not.toHaveBeenCalled();
    expect.soft(dbMock.runTransaction).not.toHaveBeenCalled();
    expect.soft(writes).toHaveLength(0);
    expect.soft(docs.mood_bookings).toEqual(beforeBookings);
    expect.soft(docs.mood_clients.COMPANY_A).toEqual(beforeClient);
  });

  it.each([
    ['18시 직전', '2026-09-10', '17:59'],
    ['기간 중 일요일', '2026-08-16', '18:00'],
    ['종료일이지만 화요일', '2026-09-15', '18:00'],
    ['기간 뒤 목요일', '2026-09-17', '18:00'],
  ])('%s은 신규 예약을 허용한다', async (_label, date, startTime) => {
    const { res, json } = await callBook({
      ...BOOK_BODY,
      date,
      startTime,
      idempotencyKey: `allowed-${date}-${startTime}`,
    });

    expect.soft(res.statusCode).toBe(200);
    expect.soft(json.ok).toBe(true);
    expect.soft(computeRouteMock).toHaveBeenCalledTimes(1);
    expect.soft(dbMock.runTransaction).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['존재하지 않는 날짜', '2026-02-30', '18:00', 'INVALID_DATE'],
    ['시간대가 붙은 날짜', '2026-09-10T00:00:00+09:00', '18:00', 'date 는 YYYY-MM-DD 형식'],
    ['24시', '2026-09-10', '24:00', 'startTime 은 HH:mm 형식'],
  ])('%s 입력은 400으로 닫고 계산·쓰기를 하지 않는다', async (_label, date, startTime, error) => {
    const { res, json } = await callBook({ ...BOOK_BODY, date, startTime });

    expect.soft(res.statusCode).toBe(400);
    expect.soft(json.error).toBe(error);
    expect.soft(computeRouteMock).not.toHaveBeenCalled();
    expect.soft(dbMock.runTransaction).not.toHaveBeenCalled();
    expect.soft(writes).toHaveLength(0);
  });
});

describe('MOOD 저녁 제한 기존 예약 변경 서버 안전', () => {
  it('기존 차단 슬롯의 날짜·시각을 유지하면 주소·금액·메모 변경을 허용한다', async () => {
    const { res, json } = await callQuotedChange(changeBody());

    expect.soft(res.statusCode).toBe(200);
    expect.soft(json.ok).toBe(true);
    expect.soft(computeRouteMock).toHaveBeenCalledTimes(1);
    expect.soft(docs.mood_bookings['existing-blocked']).toMatchObject({
      date: '2026-09-10',
      startTime: '18:30',
      durationHours: 4,
      note: '새 메모',
      revision: 1,
      breakdown: {
        origin: '새 출발지',
        destination: '새 도착지',
      },
    });
    expect.soft(json.data.amountKRW).not.toBe(100_000);
  });

  it.each([
    ['같은 날 다른 차단 시각', { startTime: '18:31' }],
    ['다른 차단일', { date: '2026-09-11', startTime: '18:30' }],
  ])('%s으로 옮기면 경로·트랜잭션·쓰기에 앞서 차단한다', async (_label, overrides) => {
    const before = structuredClone(docs);
    const { res, json } = await callChange(changeBody(overrides));

    expect.soft(res.statusCode).toBe(409);
    expect.soft(json.error).toBe('MOOD_EVENING_BOOKING_UNAVAILABLE');
    expect.soft(computeRouteMock).not.toHaveBeenCalled();
    expect.soft(dbMock.runTransaction).not.toHaveBeenCalled();
    expect.soft(writes).toHaveLength(0);
    expect.soft(docs).toEqual(before);
  });

  it('허용 슬롯의 기존 예약을 새 차단 슬롯으로 옮기지 못한다', async () => {
    docs.mood_bookings['existing-blocked'] = {
      ...structuredClone(EXISTING_BOOKING),
      date: '2026-09-09',
      startTime: '10:00',
    };
    const before = structuredClone(docs);
    const { res, json } = await callChange(changeBody({ date: '2026-09-12', startTime: '18:00' }));

    expect.soft(res.statusCode).toBe(409);
    expect.soft(json.error).toBe('MOOD_EVENING_BOOKING_UNAVAILABLE');
    expect.soft(computeRouteMock).not.toHaveBeenCalled();
    expect.soft(writes).toHaveLength(0);
    expect.soft(docs).toEqual(before);
  });

  it('검사 뒤 예약 시각이 바뀌는 경쟁 상황도 트랜잭션에서 다시 차단해 쓰지 않는다', async () => {
    beforeTransaction = () => {
      docs.mood_bookings['existing-blocked'].startTime = '18:31';
    };
    const { res, json } = await callQuotedChange(changeBody());

    expect.soft(res.statusCode).toBe(409);
    expect.soft(json.error).toBe('MOOD_EVENING_BOOKING_UNAVAILABLE');
    expect.soft(writes).toHaveLength(0);
    expect.soft(docs.mood_bookings['existing-blocked'].revision).toBe(0);
  });

  it('이미 성공해 저장된 동일 변경 재시도는 현재 시각이 달라도 멱등 응답을 우선 재생한다', async () => {
    const replay = { ok: true, data: { bookingId: 'existing-blocked', revision: 1 } };
    const { createHash } = await import('node:crypto');
    const key = createHash('sha256').update('staff@x.com:evening-change-safety-0001').digest('hex');
    docs.mood_booking_change_idempotency = {
      [key]: {
        bookingId: 'existing-blocked',
        actorEmail: 'staff@x.com',
        payloadHash: createHash('sha256').update(JSON.stringify({
          bookingId: 'existing-blocked',
          expectedRevision: 0,
          reason: '촬영 동선 변경',
          booking: {
            date: '2026-09-10',
            startTime: '18:30',
            durationHours: 4,
            serviceType: 'vehicle',
            origin: '새 출발지',
            destination: '새 도착지',
            waypoints: [],
            note: '새 메모',
            airportDirection: null,
            airportCode: null,
            hasInfluencerName: false,
            influencerName: null,
            courseMoodPercentages: [100, 0],
            courseShareSchemaVersion: 2,
          },
        })).digest('hex'),
        response: replay,
      },
    };
    docs.mood_bookings['existing-blocked'].startTime = '19:00';

    const { res, json } = await callChange(changeBody());

    expect.soft(res.statusCode).toBe(200);
    expect.soft(json).toEqual(replay);
    expect.soft(computeRouteMock).not.toHaveBeenCalled();
    expect.soft(writes).toHaveLength(0);
  });
});
