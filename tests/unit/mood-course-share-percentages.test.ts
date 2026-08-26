/* eslint-disable @typescript-eslint/no-explicit-any -- API와 Firestore를 메모리에서 작게 모사한다. */
/**
 * MOOD 코스별 비율 분담의 독립 안전 계약.
 *
 * 새 계약은 각 지점 순서마다 MOOD 부담률(0~100 정수)을 하나씩 저장한다.
 * 각 코스의 인플루언서 금액은 코스 금액에서 MOOD 금액을 뺀 값으로 계산해
 * 원 단위 반올림이나 코스 나머지가 있어도 전체 합계를 잃지 않아야 한다.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  allocateMoodShareCostByCourse,
  normalizeMoodCoursePercentages,
  type MoodBookingShareStop,
} from '../../src/lib/moodBookingShare';

const verifyUserTokenMock = vi.fn();
const computeRouteMock = vi.fn();
const notifyMock = vi.fn();

vi.mock('../../api/_shared/user-auth.js', () => ({
  verifyUserToken: (...args: any[]) => verifyUserTokenMock(...args),
  default: (...args: any[]) => verifyUserTokenMock(...args),
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
vi.mock('../../api/_shared/mood-receipt.js', () => ({
  buildMoodSettlementReceiptEmail: () => ({ subject: '', html: '', text: '' }),
}));
vi.mock('../../api/_send-email.js', () => ({ sendEmail: vi.fn() }));

type StoredDoc = Record<string, any>;
type Snapshot = {
  exists: boolean;
  id: string;
  data: () => StoredDoc | undefined;
};
type Ref = {
  __collection: string;
  id: string;
  get: () => Promise<Snapshot>;
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
        .map(([key, value]) => ({ id: key.slice(prefix.length), value }))
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

async function callQuotedChange(body: Record<string, any>) {
  const preview = await callChange({ ...body, action: 'preview' });
  if (preview.response.statusCode !== 200) return { ...preview, preview };
  const proposal = await callChange({
    ...body,
    action: 'propose',
    quoteId: preview.json.data.quoteId,
    idempotencyKey: `${body.idempotencyKey}-propose`,
  });
  if (proposal.response.statusCode !== 200) return { ...proposal, preview, proposal };
  verifyUserTokenMock.mockResolvedValue({ ok: true, email: 'approver@x.com', uid: 'approver', emailVerified: true });
  const approval = await callChange({
    action: 'approve',
    bookingId: body.bookingId,
    quoteId: preview.json.data.quoteId,
    idempotencyKey: `${body.idempotencyKey}-approve`,
  });
  verifyUserTokenMock.mockResolvedValue({ ok: true, email: 'staff@x.com', uid: 'staff', emailVerified: true });
  return { ...approval, preview, proposal };
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

async function callSettle(body: Record<string, any>) {
  const { default: handler } = await import('../../api/mood-settle.js');
  const response = makeResponse();
  await handler({
    method: 'POST',
    url: '/api/mood-settle',
    headers: { host: 'unit.test', authorization: 'Bearer token' },
    body,
  } as any, response as any);
  return { response, json: JSON.parse(response.body || '{}') };
}

async function callSettlePreview(body: Record<string, any>) {
  const { default: handler } = await import('../../api/mood-settle-preview.js');
  const response = makeResponse();
  await handler({
    method: 'POST',
    url: '/api/mood-settle-preview',
    headers: { host: 'unit.test', authorization: 'Bearer token' },
    body,
  } as any, response as any);
  return { response, json: JSON.parse(response.body || '{}') };
}

async function callSettleRespond(body: Record<string, any>) {
  const { default: handler } = await import('../../api/mood-settle-respond.js');
  const response = makeResponse();
  await handler({
    method: 'POST',
    url: '/api/mood-settle-respond',
    headers: { host: 'unit.test', authorization: 'Bearer token' },
    body,
  } as any, response as any);
  return { response, json: JSON.parse(response.body || '{}') };
}

/**
 * 운영자 제안 → MOOD 승인자 승인까지 한 번에 태운다.
 * 코스 부담률은 제안에 실려 저장되고, 최종 예약 문서에는 승인 시점에만 커밋된다.
 */
async function settleThroughApproval(body: Record<string, any>) {
  const bookingId = String(body.bookingId);
  const expectedRevision = Number((store.get(`mood_bookings/${bookingId}`) as any)?.revision || 0);
  const previewInput = { ...body, expectedRevision };
  const preview = await callSettlePreview(previewInput);
  if (preview.response.statusCode !== 200) return { stage: 'preview' as const, ...preview };
  const propose = await callSettle({
    ...previewInput,
    previewHash: preview.json.data.previewHash,
    idempotencyKey: `settle-propose-${bookingId}`,
  });
  if (propose.response.statusCode !== 200) return { stage: 'propose' as const, ...propose };
  verifyUserTokenMock.mockResolvedValue({ ok: true, email: 'approver@x.com', uid: 'approver', emailVerified: true });
  const approve = await callSettleRespond({
    proposalId: propose.json.data.proposalId,
    action: 'approve',
    idempotencyKey: `settle-approve-${bookingId}`,
  });
  verifyUserTokenMock.mockResolvedValue({ ok: true, email: 'staff@x.com', uid: 'staff', emailVerified: true });
  return { stage: 'approve' as const, ...approve, propose };
}

function docsIn(collection: string) {
  const prefix = `${collection}/`;
  return [...store.entries()]
    .filter(([key]) => key.startsWith(prefix))
    .map(([key, value]) => ({ id: key.slice(prefix.length), ...clone(value) }));
}

const BOOK_PERCENTAGES = [100, 50, 0, 33, 67];
const BOOK_BODY = {
  clientId: 'COMPANY_A',
  date: '2026-08-25',
  startTime: '09:00',
  durationHours: 4,
  serviceType: 'vehicle',
  origin: '출발지',
  waypoints: ['경유지 1', '경유지 2', '경유지 3'],
  destination: '도착지',
  courseMoodPercentages: BOOK_PERCENTAGES,
  idempotencyKey: 'course-percent-book-request',
};

const CHANGE_PERCENTAGES = [100, 50, 33, 0];

function changeBody(courseMoodPercentages: any = CHANGE_PERCENTAGES) {
  return {
    bookingId: 'booking-change',
    expectedRevision: 0,
    idempotencyKey: 'course-percent-change-request',
    reason: '코스별 부담 비율 변경',
    booking: {
      date: '2026-08-26',
      startTime: '10:00',
      durationHours: 4,
      serviceType: 'vehicle',
      origin: '새 출발지',
      waypoints: ['새 경유지 1', '새 경유지 2'],
      destination: '새 도착지',
      note: '부담 비율 확인',
      airportDirection: null,
      airportCode: null,
      influencerName: '인플루언서 A',
      courseMoodPercentages,
    },
  };
}

function seedChangeBooking() {
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
    courseMoodPercentages: [100, 0, 100],
    courseShareSchemaVersion: 2,
    coursePayers: ['mood', 'influencer', 'mood'],
    createdByEmail: 'staff@x.com',
    createdAt: 1,
  });
}

function seedSettleBooking() {
  store.set('mood_bookings/booking-settle', {
    clientId: 'COMPANY_A',
    status: 'confirmed',
    revision: 0,
    amountKRW: 173_000,
    ratePerHour: 30_000,
    date: '2026-08-24',
    startTime: '08:00',
    durationHours: 4,
    serviceType: 'vehicle',
    breakdown: {
      baseKRW: 120_000,
      distanceSurchargeKRW: 48_000,
      tollKRW: 5_000,
      km: 80,
      origin: '기존 출발지',
      waypoints: ['기존 경유지'],
      destination: '기존 도착지',
    },
    courseMoodPercentages: [100, 0, 50],
    courseShareSchemaVersion: 2,
    coursePayers: null,
    createdByEmail: null,
    createdAt: 1,
  });
}

/** 제안 API 의 사전 게이트(개정·지문·멱등키)는 통과시키고, 코스 부담률 검증만 남긴다. */
function settleBody(courseMoodPercentages: any) {
  return {
    bookingId: 'booking-settle',
    actualHours: 4,
    tollMode: 'estimated',
    manualAdjustmentKRW: 0,
    settlementReason: '',
    expectedRevision: Number((store.get('mood_bookings/booking-settle') as any)?.revision || 0),
    previewHash: 'a'.repeat(64),
    idempotencyKey: 'course-percent-settle-request',
    origin: '실제 출발지',
    waypoints: ['실제 경유지 1', '실제 경유지 2'],
    destination: '실제 도착지',
    courseMoodPercentages,
  };
}

function dataBooking(overrides: Record<string, any>) {
  return {
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
    status: 'confirmed',
    revision: 0,
    createdByEmail: 'staff@x.com',
    createdAt: 1,
    ...overrides,
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

describe('코스별 MOOD 비율 계산과 원 단위 보존', () => {
  it('0·50·100과 33·67 비율을 순서 그대로 정규화한다', () => {
    const input = [0, 50, 100, 33, 67];
    const result = normalizeMoodCoursePercentages(input, 5);

    expect(result).toEqual(input);
    expect(result).not.toBe(input);
  });

  it('50:50 홀수 원은 MOOD를 반올림하고 상대 금액을 빼서 총액을 보존한다', () => {
    const result = allocateMoodShareCostByCourse(101, [
      { address: '홀수 원 코스', moodPercentage: 50 },
    ]);

    expect(result.courses[0]).toMatchObject({
      amountKRW: 101,
      moodPercentage: 50,
      influencerPercentage: 50,
      moodKRW: 51,
      influencerKRW: 50,
    });
    expect(result.mood.totalKRW + result.influencer.totalKRW).toBe(101);
  });

  it('코스 나머지와 0·50·100·33·67 혼합에서도 코스별·전체 합계를 잃지 않는다', () => {
    const stops: MoodBookingShareStop[] = [0, 50, 100, 33, 67]
      .map((moodPercentage, index) => ({ address: `코스 ${index + 1}`, moodPercentage }));
    const result = allocateMoodShareCostByCourse(10_003, stops);

    expect(result.courses.map((course) => course.amountKRW)).toEqual([2_000, 2_000, 2_000, 2_000, 2_003]);
    expect(result.courses.map((course) => course.moodKRW)).toEqual([0, 1_000, 2_000, 660, 1_342]);
    expect(result.courses.map((course) => course.influencerKRW)).toEqual([2_000, 1_000, 0, 1_340, 661]);
    expect(result.remainderKRW).toBe(3);
    for (const course of result.courses) {
      expect(course.moodKRW + course.influencerKRW).toBe(course.amountKRW);
    }
    expect(result.mood.totalKRW + result.influencer.totalKRW).toBe(10_003);
    expect(result.courses.reduce((sum, course) => sum + course.amountKRW, 0)).toBe(10_003);
  });

  it('구형 payer는 위치를 유지해 mood=100, influencer=0으로 변환한다', () => {
    const legacy = ['mood', 'influencer', 'mood', 'influencer'] as const;
    const normalized = normalizeMoodCoursePercentages(undefined, 4, [...legacy]);
    const distributed = allocateMoodShareCostByCourse(401, [
      { address: 'A', payer: 'mood' },
      { address: 'B', payer: 'influencer' },
      { address: 'C', payer: 'mood' },
      { address: 'D', payer: 'influencer' },
    ]);

    expect(normalized).toEqual([100, 0, 100, 0]);
    expect(distributed.courses.map((course) => course.moodPercentage)).toEqual([100, 0, 100, 0]);
    expect(distributed.mood.totalKRW + distributed.influencer.totalKRW).toBe(401);
  });
});

describe('mood-book·mood-change 비율 입력 fail-closed', () => {
  const invalidCases: Array<[string, any, any]> = [
    ['배열 아님', '100,50,0,33,67', '100,50,33,0'],
    ['명시 null', null, null],
    ['길이 불일치', [100, 50, 0, 33], [100, 50, 33]],
    ['문자열 값', [100, 50, '0', 33, 67], [100, '50', 33, 0]],
    ['소수', [100, 50.5, 0, 33, 67], [100, 50.5, 33, 0]],
    ['0 미만', [100, 50, -1, 33, 67], [100, 50, -1, 0]],
    ['100 초과', [100, 50, 101, 33, 67], [100, 50, 101, 0]],
  ];

  it.each(invalidCases)('%s 값은 두 쓰기 API 모두 계산 전에 400으로 거절한다', async (_label, bookValue, changeValue) => {
    const book = await callBook({ ...BOOK_BODY, courseMoodPercentages: bookValue });
    expect.soft(book.response.statusCode).toBe(400);
    expect.soft(book.json.error).toBe('INVALID_COURSE_MOOD_PERCENTAGES');
    expect.soft(docsIn('mood_bookings')).toHaveLength(0);
    expect.soft(store.get('mood_clients/COMPANY_A')?.balanceKRW).toBe(1_000_000);

    seedChangeBooking();
    const change = await callChange(changeBody(changeValue));
    expect.soft(change.response.statusCode).toBe(400);
    expect.soft(change.json.error).toBe('INVALID_COURSE_MOOD_PERCENTAGES');
    expect.soft(store.get('mood_bookings/booking-change')?.revision).toBe(0);
    expect.soft(docsIn('mood_booking_change_events')).toHaveLength(0);
    expect.soft(computeRouteMock).not.toHaveBeenCalled();

    seedSettleBooking();
    const settle = await callSettle(settleBody(changeValue));
    expect.soft(settle.response.statusCode).toBe(400);
    expect.soft(settle.json.error).toBe('INVALID_COURSE_MOOD_PERCENTAGES');
    expect.soft(store.get('mood_bookings/booking-settle')?.status).toBe('confirmed');
    expect.soft(computeRouteMock).not.toHaveBeenCalled();
  });

  it('새 쓰기 요청에 구형 coursePayers가 있으면 canonical 배열이 함께 있어도 400으로 거절한다', async () => {
    const book = await callBook({
      ...BOOK_BODY,
      coursePayers: ['mood', 'influencer', 'influencer', 'mood', 'influencer'],
    });
    expect.soft(book.response.statusCode).toBe(400);
    expect.soft(book.json.error).toBe('INVALID_COURSE_MOOD_PERCENTAGES');

    seedChangeBooking();
    const changeRequest: Record<string, any> = changeBody();
    changeRequest.booking.coursePayers = ['mood', 'influencer', 'mood', 'influencer'];
    const change = await callChange(changeRequest);
    expect.soft(change.response.statusCode).toBe(400);
    expect.soft(change.json.error).toBe('INVALID_COURSE_MOOD_PERCENTAGES');
    expect.soft(docsIn('mood_booking_change_events')).toHaveLength(0);
    expect.soft(computeRouteMock).not.toHaveBeenCalled();

    seedSettleBooking();
    const settle = await callSettle({
      ...settleBody([100, 50, 33, 0]),
      coursePayers: ['mood', 'influencer', 'mood', 'influencer'],
    });
    expect.soft(settle.response.statusCode).toBe(400);
    expect.soft(settle.json.error).toBe('INVALID_COURSE_MOOD_PERCENTAGES');
    expect.soft(computeRouteMock).not.toHaveBeenCalled();
  });

  it('클라이언트가 스키마 버전을 보내면 2만 허용한다', async () => {
    const book = await callBook({ ...BOOK_BODY, courseShareSchemaVersion: 1 });
    expect.soft(book.response.statusCode).toBe(400);
    expect.soft(book.json.error).toBe('INVALID_COURSE_SHARE_SCHEMA_VERSION');

    seedChangeBooking();
    const changeRequest: Record<string, any> = changeBody();
    changeRequest.booking.courseShareSchemaVersion = 1;
    const change = await callChange(changeRequest);
    expect.soft(change.response.statusCode).toBe(400);
    expect.soft(change.json.error).toBe('INVALID_COURSE_SHARE_SCHEMA_VERSION');
    expect.soft(computeRouteMock).not.toHaveBeenCalled();

    seedSettleBooking();
    const settle = await callSettle({
      ...settleBody([100, 50, 33, 0]),
      courseShareSchemaVersion: 1,
    });
    expect.soft(settle.response.statusCode).toBe(400);
    expect.soft(settle.json.error).toBe('INVALID_COURSE_SHARE_SCHEMA_VERSION');
    expect.soft(computeRouteMock).not.toHaveBeenCalled();
  });

  it('명시 null 스키마 버전은 미전달로 간주하지 않고 거절한다', async () => {
    const book = await callBook({ ...BOOK_BODY, courseShareSchemaVersion: null });
    expect.soft(book.response.statusCode).toBe(400);
    expect.soft(book.json.error).toBe('INVALID_COURSE_SHARE_SCHEMA_VERSION');

    seedChangeBooking();
    const changeRequest: Record<string, any> = changeBody();
    changeRequest.booking.courseShareSchemaVersion = null;
    const change = await callChange(changeRequest);
    expect.soft(change.response.statusCode).toBe(400);
    expect.soft(change.json.error).toBe('INVALID_COURSE_SHARE_SCHEMA_VERSION');

    seedSettleBooking();
    const settle = await callSettle({
      ...settleBody([100, 50, 33, 0]),
      courseShareSchemaVersion: null,
    });
    expect.soft(settle.response.statusCode).toBe(400);
    expect.soft(settle.json.error).toBe('INVALID_COURSE_SHARE_SCHEMA_VERSION');
    expect.soft(computeRouteMock).not.toHaveBeenCalled();
  });
});

describe('비율 저장·조회·멱등 계약', () => {
  it('canonical 배열을 생략하면 첫 코스 100, 나머지 0으로 정규화한다', async () => {
    const bookRequest: Record<string, any> = { ...BOOK_BODY, idempotencyKey: 'course-percent-default-book' };
    delete bookRequest.courseMoodPercentages;
    const book = await callBook(bookRequest);

    expect(book.response.statusCode).toBe(200);
    expect(docsIn('mood_bookings')[0].courseMoodPercentages).toEqual([100, 0, 0, 0, 0]);

    seedChangeBooking();
    const changeRequest: Record<string, any> = changeBody();
    delete changeRequest.booking.courseMoodPercentages;
    const change = await callQuotedChange(changeRequest);

    expect(change.response.statusCode).toBe(200);
    expect(store.get('mood_bookings/booking-change')?.courseMoodPercentages).toEqual([100, 0, 0, 0]);
  });

  it('book은 혼합 비율과 스키마 버전을 위치 그대로 저장하고 같은 키의 비율 변경을 막는다', async () => {
    const first = await callBook(BOOK_BODY);

    expect(first.response.statusCode).toBe(200);
    const bookings = docsIn('mood_bookings');
    expect(bookings).toHaveLength(1);
    expect(bookings[0]).toMatchObject({
      courseMoodPercentages: BOOK_PERCENTAGES,
      courseShareSchemaVersion: 2,
      coursePayers: null,
    });
    expect(first.json.data).toMatchObject({
      courseMoodPercentages: BOOK_PERCENTAGES,
      courseShareSchemaVersion: 2,
      coursePayers: null,
    });

    const balanceAfterFirst = store.get('mood_clients/COMPANY_A')?.balanceKRW;
    const conflict = await callBook({
      ...BOOK_BODY,
      courseMoodPercentages: [100, 50, 0, 34, 67],
    });

    expect(conflict.response.statusCode).toBe(409);
    expect(conflict.json.error).toBe('IDEMPOTENCY_CONFLICT');
    expect(docsIn('mood_bookings')).toHaveLength(1);
    expect(store.get('mood_clients/COMPANY_A')?.balanceKRW).toBe(balanceAfterFirst);
    expect(docsIn('mood_bookings')[0].courseMoodPercentages).toEqual(BOOK_PERCENTAGES);
  });

  it('change는 비율을 예약·감사·멱등 응답에 저장하고 이전 revision의 비율 변경을 막는다', async () => {
    seedChangeBooking();
    const first = await callQuotedChange(changeBody());

    expect(first.response.statusCode).toBe(200);
    expect(store.get('mood_bookings/booking-change')).toMatchObject({
      courseMoodPercentages: CHANGE_PERCENTAGES,
      courseShareSchemaVersion: 2,
      coursePayers: null,
    });
    expect(first.json.data.booking.courseMoodPercentages).toEqual(CHANGE_PERCENTAGES);
    const approvalAudit = docsIn('mood_booking_change_events').find((entry) => entry.type === 'booking_change_approved');
    expect(approvalAudit?.after.courseMoodPercentages).toEqual(CHANGE_PERCENTAGES);
    const approvalIdempotency = docsIn('mood_booking_change_idempotency').find((entry) => entry.action === 'approve');
    expect(approvalIdempotency?.response.data.booking.courseMoodPercentages)
      .toEqual(CHANGE_PERCENTAGES);

    const balanceAfterFirst = store.get('mood_clients/COMPANY_A')?.balanceKRW;
    const conflict = await callChange(changeBody([100, 50, 34, 0]));

    expect(conflict.response.statusCode).toBe(409);
    expect(conflict.json.error).toBe('REVISION_CONFLICT');
    expect(store.get('mood_bookings/booking-change')?.courseMoodPercentages).toEqual(CHANGE_PERCENTAGES);
    expect(store.get('mood_clients/COMPANY_A')?.balanceKRW).toBe(balanceAfterFirst);
    expect(docsIn('mood_booking_change_events')).toHaveLength(2);
  });

  it('mood-data는 0·50·100·33·67 배열의 위치와 길이를 그대로 반환한다', async () => {
    const percentages = [67, 0, 100, 33, 50];
    store.set('mood_bookings/booking-data-v2', dataBooking({
      courseMoodPercentages: percentages,
      courseShareSchemaVersion: 2,
      coursePayers: null,
    }));

    const { response, json } = await callData();

    expect(response.statusCode).toBe(200);
    expect(json.data.bookings).toHaveLength(1);
    expect(json.data.bookings[0]).toMatchObject({
      courseMoodPercentages: percentages,
      courseShareSchemaVersion: 2,
      coursePayers: null,
    });
  });

  it('mood-data는 구형 coursePayers를 위치 그대로 100·0 배열로 변환한다', async () => {
    store.set('mood_bookings/booking-data-legacy', dataBooking({
      breakdown: {
        origin: '출발지',
        waypoints: ['경유지'],
        destination: '도착지',
      },
      coursePayers: ['mood', 'influencer', 'mood'],
    }));

    const { response, json } = await callData();

    expect(response.statusCode).toBe(200);
    expect(json.data.bookings[0]).toMatchObject({
      courseMoodPercentages: [100, 0, 100],
      courseShareSchemaVersion: 2,
      coursePayers: ['mood', 'influencer', 'mood'],
    });
  });

  it('change는 구형 저장 예약의 payer 위치를 감사 before의 100·0 비율로 보존한다', async () => {
    seedChangeBooking();
    const legacyBooking = store.get('mood_bookings/booking-change') || {};
    delete legacyBooking.courseMoodPercentages;
    delete legacyBooking.courseShareSchemaVersion;
    legacyBooking.coursePayers = ['mood', 'influencer', 'mood'];
    store.set('mood_bookings/booking-change', legacyBooking);

    const { response } = await callQuotedChange(changeBody());

    expect(response.statusCode).toBe(200);
    const approvalAudit = docsIn('mood_booking_change_events').find((entry) => entry.type === 'booking_change_approved');
    expect(approvalAudit?.before).toMatchObject({
      courseMoodPercentages: [100, 0, 100],
      courseShareSchemaVersion: 2,
      coursePayers: ['mood', 'influencer', 'mood'],
    });
    expect(store.get('mood_bookings/booking-change')?.courseMoodPercentages).toEqual(CHANGE_PERCENTAGES);
  });

  it('settle은 구형 저장 예약의 payer 위치를 100·0 비율로 승격해 최종 저장한다', async () => {
    seedSettleBooking();
    const legacyBooking = store.get('mood_bookings/booking-settle') || {};
    delete legacyBooking.courseMoodPercentages;
    delete legacyBooking.courseShareSchemaVersion;
    legacyBooking.coursePayers = ['mood', 'influencer', 'mood'];
    store.set('mood_bookings/booking-settle', legacyBooking);

    const { response } = await settleThroughApproval({
      bookingId: 'booking-settle',
      actualHours: 4,
      tollMode: 'estimated',
      manualAdjustmentKRW: 0,
      settlementReason: '',
    });

    expect(response.statusCode).toBe(200);
    // 승인 전에는 예약이 confirmed 로 남아 있었고, 승인 시점에만 승격된 비율이 커밋된다.
    expect(store.get('mood_bookings/booking-settle')).toMatchObject({
      status: 'completed',
      courseMoodPercentages: [100, 0, 100],
      courseShareSchemaVersion: 2,
      coursePayers: ['mood', 'influencer', 'mood'],
    });
  });

  it('손상된 v2 배열이 있으면 유효한 구형 배열로 조용히 되돌리지 않는다', async () => {
    store.set('mood_bookings/booking-data-damaged', dataBooking({
      breakdown: {
        origin: '출발지',
        waypoints: ['경유지'],
        destination: '도착지',
      },
      courseMoodPercentages: [100, '50', 0],
      courseShareSchemaVersion: 2,
      coursePayers: ['mood', 'influencer', 'mood'],
    }));

    const { response, json } = await callData();

    expect(response.statusCode).toBe(409);
    expect(json.error).toBe('INVALID_COURSE_SHARE');
  });

  it.each([
    ['버전 누락', { courseMoodPercentages: [100, 0, 100] }],
    ['잘못된 버전', { courseMoodPercentages: [100, 0, 100], courseShareSchemaVersion: 1 }],
    ['길이 손상', { courseMoodPercentages: [100, 0], courseShareSchemaVersion: 2 }],
    ['범위 손상', { courseMoodPercentages: [100, 101, 0], courseShareSchemaVersion: 2 }],
  ])('저장된 v2 %s은 legacy fallback 없이 조회를 409로 중단한다', async (_label, damagedShare) => {
    store.set('mood_bookings/booking-data-damaged-shape', dataBooking({
      breakdown: {
        origin: '출발지',
        waypoints: ['경유지'],
        destination: '도착지',
      },
      ...damagedShare,
      coursePayers: ['mood', 'influencer', 'mood'],
    }));

    const { response, json } = await callData();

    expect(response.statusCode).toBe(409);
    expect(json.error).toBe('INVALID_COURSE_SHARE');
  });
});
