/* eslint-disable @typescript-eslint/no-explicit-any -- API와 Firestore를 메모리에서 작게 모사한다. */
/**
 * MOOD 코스별 부담 주체 백엔드 계약.
 *
 * 출발·경유·도착 N개 지점마다 부담 주체가 정확히 하나 있어야 하며, 허용 값은
 * mood/influencer뿐이다. 이 배열은 신규 예약, 조회, 변경, 감사·멱등 기록까지
 * 손실 없이 이어져야 한다.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const verifyUserTokenMock = vi.fn();
const computeRouteMock = vi.fn();
const notifyMock = vi.fn();

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
  normEmail: (email: string) => String(email || '').toLowerCase().trim(),
}));

vi.mock('../../api/_shared/mood-route.js', () => ({
  computeRoute: (...args: any[]) => computeRouteMock(...args),
}));

vi.mock('../../api/_shared/notify.js', () => ({
  notify: (...args: any[]) => notifyMock(...args),
}));

vi.mock('../../api/_shared/cors.js', () => ({ buildAdminJsonCors: () => ({}) }));
vi.mock('../../api/_shared/sentry.js', () => ({ captureError: vi.fn() }));

type StoredDoc = Record<string, any>;
type Ref = {
  __collection: string;
  id: string;
  get: () => Promise<Snapshot>;
};
type Snapshot = {
  exists: boolean;
  id: string;
  data: () => StoredDoc | undefined;
};

const store = new Map<string, StoredDoc>();
let autoId = 0;

function docKey(collection: string, id: string) {
  return `${collection}/${id}`;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function snapshot(ref: Ref): Snapshot {
  const value = store.get(docKey(ref.__collection, ref.id));
  return {
    exists: value !== undefined,
    id: ref.id,
    data: () => value === undefined ? undefined : clone(value),
  };
}

function makeRef(collection: string, requestedId?: string): Ref {
  const id = requestedId || `auto_${++autoId}`;
  const ref: Ref = {
    __collection: collection,
    id,
    async get() {
      return snapshot(ref);
    },
  };
  return ref;
}

function writeSet(ref: Ref, value: StoredDoc, merge = false) {
  const key = docKey(ref.__collection, ref.id);
  const previous = store.get(key) || {};
  store.set(key, clone(merge ? { ...previous, ...value } : value));
}

function writeUpdate(ref: Ref, value: StoredDoc) {
  writeSet(ref, { ...(store.get(docKey(ref.__collection, ref.id)) || {}), ...value });
}

function queryFor(collection: string, clientId?: string) {
  const state = { clientId, orderDirection: 'desc', limit: 200 };
  const query: any = {
    where(field: string, operator: string, value: string) {
      if (field === 'clientId' && operator === '==') state.clientId = value;
      return query;
    },
    orderBy(_field: string, direction: string) {
      state.orderDirection = direction;
      return query;
    },
    limit(value: number) {
      state.limit = value;
      return query;
    },
    async get() {
      const prefix = `${collection}/`;
      const docs = [...store.entries()]
        .filter(([key, value]) => key.startsWith(prefix) && (!state.clientId || value.clientId === state.clientId))
        .map(([key, value]) => ({
          id: key.slice(prefix.length),
          value,
        }))
        .sort((a, b) => {
          const difference = Number(a.value.createdAt || 0) - Number(b.value.createdAt || 0);
          return state.orderDirection === 'desc' ? -difference : difference;
        })
        .slice(0, state.limit)
        .map(({ id, value }) => ({ id, data: () => clone(value) }));
      return { docs };
    },
  };
  return query;
}

const dbMock = {
  collection(collection: string) {
    const query = queryFor(collection);
    return {
      doc(id?: string) {
        return makeRef(collection, id);
      },
      where: query.where,
      orderBy: query.orderBy,
      limit: query.limit,
      get: query.get,
    };
  },
  async runTransaction<T>(callback: (tx: any) => Promise<T>): Promise<T> {
    const writes: Array<() => void> = [];
    const tx = {
      get: async (ref: Ref) => snapshot(ref),
      set: (ref: Ref, value: StoredDoc, options?: { merge?: boolean }) => {
        writes.push(() => writeSet(ref, value, Boolean(options && options.merge)));
      },
      update: (ref: Ref, value: StoredDoc) => {
        writes.push(() => writeUpdate(ref, value));
      },
    };
    const result = await callback(tx);
    writes.forEach((write) => write());
    return result;
  },
};

vi.mock('../../api/_shared/firebase-admin.js', () => ({ initAdminDb: () => dbMock }));

type MockResponse = {
  statusCode?: number;
  body: string;
  headers: Record<string, string>;
  writeHead: (status: number, headers?: Record<string, string>) => MockResponse;
  setHeader: (name: string, value: string) => void;
  end: (body?: string | Buffer) => MockResponse;
};

function makeResponse(): MockResponse {
  const response: MockResponse = {
    body: '',
    headers: {},
    writeHead(status, headers) {
      response.statusCode = status;
      Object.assign(response.headers, headers || {});
      return response;
    },
    setHeader(name, value) {
      response.headers[name] = value;
    },
    end(body) {
      response.body = body instanceof Buffer ? body.toString('utf8') : (body || '');
      return response;
    },
  };
  return response;
}

async function callBook(body: Record<string, any>) {
  const { default: handler } = await import('../../api/mood-book.js');
  const response = makeResponse();
  await handler({
    method: 'POST',
    url: '/api/mood-book',
    headers: { host: 'unit.test', authorization: 'Bearer token' },
    body,
  } as any, response as any);
  return { response, json: JSON.parse(response.body || '{}') };
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

async function callChange(body: Record<string, any>) {
  const { default: handler } = await import('../../api/mood-change.js');
  const response = makeResponse();
  await handler({
    method: 'POST',
    url: '/api/mood-change',
    headers: { host: 'unit.test', authorization: 'Bearer token' },
    body,
  } as any, response as any);
  return { response, json: JSON.parse(response.body || '{}') };
}

function docsIn(collection: string) {
  const prefix = `${collection}/`;
  return [...store.entries()]
    .filter(([key]) => key.startsWith(prefix))
    .map(([key, value]) => ({ id: key.slice(prefix.length), ...clone(value) }));
}

const BOOK_BODY = {
  clientId: 'COMPANY_A',
  date: '2026-08-25',
  startTime: '09:00',
  durationHours: 4,
  serviceType: 'vehicle',
  origin: '출발지',
  waypoints: ['경유지 1', '경유지 2', '경유지 3'],
  destination: '도착지',
  idempotencyKey: 'course-payers-book-request',
};

const EXPECTED_DEFAULT_PAYERS = [
  'mood',
  'influencer',
  'influencer',
  'influencer',
  'influencer',
];

const CHANGE_PAYERS = ['mood', 'mood', 'influencer', 'influencer'];

function changeBody(coursePayers = CHANGE_PAYERS) {
  return {
    bookingId: 'booking-change',
    expectedRevision: 0,
    idempotencyKey: 'course-payers-change-request',
    reason: '코스별 부담 주체 변경',
    booking: {
      date: '2026-08-26',
      startTime: '10:00',
      durationHours: 4,
      serviceType: 'vehicle',
      origin: '새 출발지',
      waypoints: ['새 경유지 1', '새 경유지 2'],
      destination: '새 도착지',
      note: '부담 주체 확인',
      airportDirection: null,
      airportCode: null,
      influencerName: '인플루언서 A',
      coursePayers,
    },
  };
}

beforeEach(() => {
  store.clear();
  store.set('mood_clients/COMPANY_A', {
    name: 'Company A',
    balanceKRW: 1_000_000,
    creditLimitKRW: 500_000,
  });
  autoId = 0;
  verifyUserTokenMock.mockReset();
  verifyUserTokenMock.mockResolvedValue({
    ok: true,
    email: 'staff@x.com',
    uid: 'staff-1',
    emailVerified: true,
  });
  computeRouteMock.mockReset();
  computeRouteMock.mockResolvedValue({
    ok: true,
    km: 80,
    tollKRW: 5_000,
    durationMin: 95,
    path: [],
    points: [],
  });
  notifyMock.mockReset();
  notifyMock.mockResolvedValue(undefined);
});

describe('mood-book 코스별 부담 주체 검증과 기본값', () => {
  it('지점 수와 coursePayers 길이가 다르면 계산·예약·차감 전에 400으로 거부한다', async () => {
    const { response, json } = await callBook({
      ...BOOK_BODY,
      coursePayers: ['mood', 'influencer', 'influencer', 'influencer'],
    });

    expect(response.statusCode).toBe(400);
    expect(json.error).toBe('INVALID_COURSE_PAYERS');
    expect(computeRouteMock).not.toHaveBeenCalled();
    expect(docsIn('mood_bookings')).toHaveLength(0);
    expect(store.get('mood_clients/COMPANY_A')?.balanceKRW).toBe(1_000_000);
  });

  it('mood/influencer 이외 값은 계산·예약·차감 전에 400으로 거부한다', async () => {
    const { response, json } = await callBook({
      ...BOOK_BODY,
      coursePayers: ['mood', 'influencer', 'company', 'influencer', 'influencer'],
    });

    expect(response.statusCode).toBe(400);
    expect(json.error).toBe('INVALID_COURSE_PAYERS');
    expect(computeRouteMock).not.toHaveBeenCalled();
    expect(docsIn('mood_bookings')).toHaveLength(0);
    expect(store.get('mood_clients/COMPANY_A')?.balanceKRW).toBe(1_000_000);
  });

  it('동선이 없는데 비어 있지 않은 coursePayers를 보내면 400으로 거부한다', async () => {
    const withoutRoute: Record<string, any> = { ...BOOK_BODY };
    delete withoutRoute.origin;
    delete withoutRoute.destination;
    delete withoutRoute.waypoints;
    const { response, json } = await callBook({
      ...withoutRoute,
      coursePayers: ['mood'],
    });

    expect(response.statusCode).toBe(400);
    expect(json.error).toBe('INVALID_COURSE_PAYERS');
    expect(docsIn('mood_bookings')).toHaveLength(0);
    expect(store.get('mood_clients/COMPANY_A')?.balanceKRW).toBe(1_000_000);
  });

  it('미전달이면 N개 지점을 첫 코스 MOOD, 나머지 인플루언서로 저장한다', async () => {
    const { response } = await callBook(BOOK_BODY);

    expect(response.statusCode).toBe(200);
    const bookings = docsIn('mood_bookings');
    expect(bookings).toHaveLength(1);
    expect(bookings[0].coursePayers).toEqual(EXPECTED_DEFAULT_PAYERS);
  });

  it('유효한 명시 배열은 코스 순서를 바꾸지 않고 예약에 저장한다', async () => {
    const requestedPayers = ['mood', 'mood', 'influencer', 'mood', 'influencer'];
    const { response } = await callBook({ ...BOOK_BODY, coursePayers: requestedPayers });

    expect(response.statusCode).toBe(200);
    expect(docsIn('mood_bookings')[0].coursePayers).toEqual(requestedPayers);
  });
});

describe('mood-data coursePayers 조회 계약', () => {
  it('예약 문서의 코스별 부담 주체를 순서와 길이 그대로 반환한다', async () => {
    store.set('mood_bookings/booking-data', {
      clientId: 'COMPANY_A',
      date: '2026-08-25',
      startTime: '09:00',
      durationHours: 4,
      serviceType: 'vehicle',
      amountKRW: 173_000,
      breakdown: {
        origin: '출발지',
        waypoints: ['경유지 1', '경유지 2', '경유지 3'],
        destination: '도착지',
      },
      coursePayers: EXPECTED_DEFAULT_PAYERS,
      status: 'confirmed',
      revision: 0,
      createdByEmail: 'staff@x.com',
      createdAt: 1,
    });

    const { response, json } = await callData();

    expect(response.statusCode).toBe(200);
    expect(json.data.bookings).toHaveLength(1);
    expect(json.data.bookings[0].coursePayers).toEqual(EXPECTED_DEFAULT_PAYERS);
  });

  it('손상된 중간 값을 제거해 코스 순서를 당기지 않고 배열 전체를 null로 무효화한다', async () => {
    store.set('mood_bookings/booking-data-invalid', {
      clientId: 'COMPANY_A',
      date: '2026-08-25',
      startTime: '09:00',
      durationHours: 4,
      serviceType: 'vehicle',
      amountKRW: 173_000,
      breakdown: {
        origin: '출발지',
        waypoints: ['경유지 1', '경유지 2'],
        destination: '도착지',
      },
      coursePayers: ['mood', 'damaged', 'influencer', 'influencer'],
      status: 'confirmed',
      revision: 0,
      createdByEmail: 'staff@x.com',
      createdAt: 1,
    });

    const { response, json } = await callData();

    expect(response.statusCode).toBe(200);
    expect(json.data.bookings[0].coursePayers).toBeNull();
  });
});

describe('mood-change coursePayers 저장·감사·멱등 충돌', () => {
  it('변경값을 예약과 감사·멱등 응답에 저장하고, 같은 키의 다른 분담값은 409로 막는다', async () => {
    const previousPayers = ['mood', 'influencer', 'influencer'];
    store.set('mood_bookings/booking-change', {
      clientId: 'COMPANY_A',
      status: 'confirmed',
      revision: 0,
      amountKRW: 100_000,
      date: '2026-08-24',
      startTime: '08:00',
      durationHours: 3,
      serviceType: 'vehicle',
      breakdown: {
        baseKRW: 90_000,
        distanceSurchargeKRW: 10_000,
        tollKRW: 0,
        km: 55,
        origin: '기존 출발지',
        waypoints: ['기존 경유지'],
        destination: '기존 도착지',
      },
      coursePayers: previousPayers,
      createdByEmail: 'staff@x.com',
      createdAt: 1,
    });

    const first = await callChange(changeBody());

    expect(first.response.statusCode).toBe(200);
    expect(store.get('mood_bookings/booking-change')?.coursePayers).toEqual(CHANGE_PAYERS);
    expect(first.json.data.booking.coursePayers).toEqual(CHANGE_PAYERS);

    const audits = docsIn('mood_booking_change_events');
    expect(audits).toHaveLength(1);
    expect(audits[0].before.coursePayers).toEqual(previousPayers);
    expect(audits[0].after.coursePayers).toEqual(CHANGE_PAYERS);

    const idempotencyDocs = docsIn('mood_booking_change_idempotency');
    expect(idempotencyDocs).toHaveLength(1);
    expect(idempotencyDocs[0].response.data.booking.coursePayers).toEqual(CHANGE_PAYERS);

    const balanceAfterFirst = store.get('mood_clients/COMPANY_A')?.balanceKRW;
    const conflictPayers = ['influencer', 'mood', 'influencer', 'influencer'];
    const conflict = await callChange(changeBody(conflictPayers));

    expect(conflict.response.statusCode).toBe(409);
    expect(conflict.json.error).toBe('IDEMPOTENCY_CONFLICT');
    expect(store.get('mood_bookings/booking-change')?.coursePayers).toEqual(CHANGE_PAYERS);
    expect(store.get('mood_clients/COMPANY_A')?.balanceKRW).toBe(balanceAfterFirst);
    expect(docsIn('mood_booking_change_events')).toHaveLength(1);
    expect(computeRouteMock).toHaveBeenCalledTimes(1);
  });
});
