/* eslint-disable @typescript-eslint/no-explicit-any -- 서버 HTTP와 Firestore 동작을 작은 메모리 모형으로 검증한다. */
import { createHash } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  checkMoodBookingAvailability,
  checkMoodBookingChangeAvailability,
  isValidMoodBookingDate,
  MOOD_EVENING_BLACKOUT_ERROR,
  MOOD_EVENING_BLACKOUT_REASON,
} from '../../api/_shared/mood-booking-availability.js';

const verifyUserTokenMock = vi.fn();
const computeRouteMock = vi.fn();
const notifyMock = vi.fn();

type StoredDoc = Record<string, any>;
type Ref = {
  collection: string;
  id: string;
  get: () => Promise<{ exists: boolean; data: () => StoredDoc | undefined }>;
};

const store = new Map<string, StoredDoc>();
let transactionRuns = 0;
let generatedId = 0;
let beforeTransaction: (() => void) | undefined;

function keyOf(ref: Ref) {
  return `${ref.collection}/${ref.id}`;
}

function snapshot(ref: Ref) {
  const value = store.get(keyOf(ref));
  return {
    exists: value !== undefined,
    data: () => value,
  };
}

function makeRef(collection: string, requestedId?: string): Ref {
  const ref: Ref = {
    collection,
    id: requestedId || `generated-${++generatedId}`,
    get: async () => snapshot(ref),
  };
  return ref;
}

function merge(ref: Ref, value: StoredDoc) {
  store.set(keyOf(ref), { ...(store.get(keyOf(ref)) || {}), ...value });
}

const dbMock = {
  collection: vi.fn((collection: string) => ({
    doc: vi.fn((id?: string) => makeRef(collection, id)),
  })),
  runTransaction: vi.fn(async (callback: any) => {
    transactionRuns += 1;
    if (beforeTransaction) {
      const hook = beforeTransaction;
      beforeTransaction = undefined;
      hook();
    }
    return callback({
      get: async (ref: Ref) => snapshot(ref),
      update: (ref: Ref, value: StoredDoc) => merge(ref, value),
      set: (ref: Ref, value: StoredDoc) => store.set(keyOf(ref), value),
      create: (ref: Ref, value: StoredDoc) => store.set(keyOf(ref), value),
    });
  }),
};

vi.mock('../../api/_shared/user-auth.js', () => ({
  verifyUserToken: (...args: any[]) => verifyUserTokenMock(...args),
}));
vi.mock('../../api/_shared/firebase-admin.js', () => ({
  initAdminDb: () => dbMock,
}));
vi.mock('../../api/_shared/mood-allowlist.js', () => ({
  getMoodAllowlist: async () => ({
    emails: ['staff@cocotrip.test'],
    admins: [],
    clientId: 'MOOD',
  }),
  isAllowedEmail: (allowlist: any, email: string) => allowlist.emails.includes(email),
  isAdminEmail: (allowlist: any, email: string) => allowlist.admins.includes(email),
  isSettlementApproverEmail: (allowlist: any, email: string) =>
    (allowlist.settlementApproverEmails || []).includes(email) && !allowlist.admins.includes(email),
}));
vi.mock('../../api/_shared/mood-route.js', () => ({
  computeRoute: (...args: any[]) => computeRouteMock(...args),
}));
vi.mock('../../api/_shared/notify.js', () => ({
  notify: (...args: any[]) => notifyMock(...args),
}));
vi.mock('../../api/_shared/cors.js', () => ({ buildAdminJsonCors: () => ({}) }));
vi.mock('../../api/_shared/sentry.js', () => ({ captureError: vi.fn() }));

function response() {
  const res = {
    statusCode: 0,
    body: '',
    headers: {} as Record<string, string>,
    writeHead(status: number, headers?: Record<string, string>) {
      res.statusCode = status;
      res.headers = headers || {};
      return res;
    },
    setHeader(name: string, value: string) {
      res.headers[name] = value;
    },
    end(body?: string | Buffer) {
      res.body = body instanceof Buffer ? body.toString('utf8') : (body || '');
      return res;
    },
  };
  return res;
}

const bookBody = (overrides: Record<string, any> = {}) => ({
  clientId: 'MOOD',
  date: '2026-09-10',
  startTime: '18:00',
  durationHours: 3,
  serviceType: 'vehicle',
  idempotencyKey: 'evening-book-001',
  ...overrides,
});

const changeSnapshot = (overrides: Record<string, any> = {}) => ({
  date: '2026-09-10',
  startTime: '18:00',
  durationHours: 3,
  serviceType: 'vehicle',
  origin: '',
  destination: '',
  waypoints: [],
  note: '주소와 메모만 변경',
  airportDirection: null,
  airportCode: null,
  ...overrides,
});

const changeBody = (overrides: Record<string, any> = {}) => ({
  bookingId: 'existing-sep10',
  expectedRevision: 0,
  idempotencyKey: 'evening-change-001',
  reason: '기존 예약 상세 변경',
  booking: changeSnapshot(),
  ...overrides,
});

async function callBook(body: Record<string, any>) {
  const { default: handler } = await import('../../api/mood-book.js');
  const res = response();
  await handler({
    method: 'POST',
    body,
    headers: { authorization: 'Bearer test' },
  } as any, res as any);
  return { res, json: JSON.parse(res.body || '{}') };
}

async function callChange(body: Record<string, any>) {
  const { default: handler } = await import('../../api/mood-change.js');
  const res = response();
  await handler({
    method: 'POST',
    body,
    headers: { authorization: 'Bearer test' },
  } as any, res as any);
  return { res, json: JSON.parse(res.body || '{}') };
}

function existingBooking(overrides: Record<string, any> = {}) {
  return {
    clientId: 'MOOD',
    status: 'confirmed',
    revision: 0,
    amountKRW: 90000,
    date: '2026-09-10',
    startTime: '18:00',
    durationHours: 3,
    serviceType: 'vehicle',
    note: '기존 예약',
    breakdown: {
      baseKRW: 90000,
      distanceSurchargeKRW: 0,
      tollKRW: 0,
      km: 0,
      origin: '',
      destination: '',
      waypoints: [],
    },
    ...overrides,
  };
}

function sha256(value: string) {
  return createHash('sha256').update(value).digest('hex');
}

beforeEach(() => {
  vi.clearAllMocks();
  store.clear();
  transactionRuns = 0;
  generatedId = 0;
  beforeTransaction = undefined;
  store.set('mood_bookings/existing-sep10', existingBooking());
  store.set('mood_clients/MOOD', { name: 'MOOD', balanceKRW: 500000 });
  verifyUserTokenMock.mockResolvedValue({
    ok: true,
    email: 'staff@cocotrip.test',
    emailVerified: true,
  });
  computeRouteMock.mockResolvedValue({ ok: true, km: 10, tollKRW: 0, durationMin: 20 });
  notifyMock.mockResolvedValue(undefined);
});

describe('MOOD 저녁 예약 제한 서버 정책', () => {
  it.each([
    ['2026-08-15', '17:59', true],
    ['2026-08-15', '18:00', false],
    ['2026-08-20', '23:59', false],
    ['2026-08-21', '18:00', false],
    ['2026-08-22', '18:00', false],
    ['2026-08-23', '18:00', true],
    ['2026-08-14', '18:00', true],
    ['2026-09-12', '18:00', false],
    ['2026-09-17', '18:00', true],
  ])('%s %s 예약 가능 여부는 %s다', (date, startTime, ok) => {
    expect(checkMoodBookingAvailability(date, startTime).ok).toBe(ok);
  });

  it('기존 9월 10일 저녁 예약은 같은 날짜·시각을 유지할 때만 상세를 바꿀 수 있다', () => {
    expect(checkMoodBookingChangeAvailability('2026-09-10', '18:00', '2026-09-10', '18:00').ok).toBe(true);
    expect(checkMoodBookingChangeAvailability('2026-09-10', '18:00', '2026-09-10', '18:30')).toMatchObject({
      ok: false,
      error: MOOD_EVENING_BLACKOUT_ERROR,
    });
    expect(checkMoodBookingChangeAvailability('2026-09-10', '18:00', '2026-09-11', '18:00').ok).toBe(false);
    expect(checkMoodBookingChangeAvailability('2026-09-10', '18:00', '2026-09-10', '17:59').ok).toBe(true);
  });

  it.each(['2026-02-30', '2026-13-01', '2026-08-20T18:00+09:00'])(
    '실제 한국 달력 날짜가 아닌 값은 거부한다: %s',
    (date) => expect(isValidMoodBookingDate(date)).toBe(false),
  );
});

describe('mood-book 서버 차단과 멱등 재생', () => {
  it('새 9월 10일 18시 예약을 경로 계산과 쓰기 전에 409로 막는다', async () => {
    const { res, json } = await callBook(bookBody());

    expect(res.statusCode).toBe(409);
    expect(json).toEqual({
      ok: false,
      error: MOOD_EVENING_BLACKOUT_ERROR,
      reason: MOOD_EVENING_BLACKOUT_REASON,
    });
    expect(computeRouteMock).not.toHaveBeenCalled();
    expect(transactionRuns).toBe(0);
  });

  it('정책 적용 전에 성공했던 같은 예약 요청의 멱등 재시도는 저장 응답을 돌려준다', async () => {
    const body = bookBody();
    const requestPayload = {
      clientId: 'MOOD',
      date: '2026-09-10',
      startTime: '18:00',
      durationHours: 3,
      serviceType: 'vehicle',
      origin: '',
      destination: '',
      waypoints: [],
      airportDirection: null,
      airportCode: null,
      note: '',
      influencerName: '',
      courseMoodPercentages: [],
      courseShareSchemaVersion: 2,
    };
    const documentId = sha256(`book:staff@cocotrip.test:${body.idempotencyKey}`);
    store.set(`mood_idempotency/${documentId}`, {
      operation: 'book',
      payloadHash: sha256(JSON.stringify(requestPayload)),
      responseData: { bookingId: 'pre-policy-booking' },
    });

    const { res, json } = await callBook(body);

    expect(res.statusCode).toBe(200);
    expect(json).toEqual({ ok: true, data: { bookingId: 'pre-policy-booking' } });
    expect(computeRouteMock).not.toHaveBeenCalled();
    expect(transactionRuns).toBe(0);
  });

  it.each(['2026-02-30', '2026-13-01', '2026-08-20T18:00+09:00'])(
    '잘못된 달력 날짜를 400으로 막는다: %s',
    async (date) => {
      const { res } = await callBook(bookBody({ date }));
      expect(res.statusCode).toBe(400);
      expect(transactionRuns).toBe(0);
    },
  );
});

describe('mood-change 기존 예약 보호', () => {
  it('9월 10일 기존 저녁 예약의 날짜·시각이 같으면 메모 등 상세 변경을 허용한다', async () => {
    const { res, json } = await callChange(changeBody());

    expect(res.statusCode).toBe(200);
    expect(json.ok).toBe(true);
    expect(store.get('mood_bookings/existing-sep10')).toMatchObject({
      date: '2026-09-10',
      startTime: '18:00',
      note: '주소와 메모만 변경',
      revision: 1,
    });
    expect(computeRouteMock).not.toHaveBeenCalled();
    expect(transactionRuns).toBe(1);
  });

  it.each([
    ['2026-09-10', '18:30'],
    ['2026-09-11', '18:00'],
  ])('기존 예약을 다른 차단 시간대로 옮기지 못하게 한다: %s %s', async (date, startTime) => {
    const { res, json } = await callChange(changeBody({
      booking: changeSnapshot({ date, startTime }),
      idempotencyKey: `move-${date}-${startTime}`,
    }));

    expect(res.statusCode).toBe(409);
    expect(json.error).toBe(MOOD_EVENING_BLACKOUT_ERROR);
    expect(computeRouteMock).not.toHaveBeenCalled();
    expect(transactionRuns).toBe(0);
    expect(store.get('mood_bookings/existing-sep10')).toMatchObject({
      date: '2026-09-10',
      startTime: '18:00',
      revision: 0,
    });
  });

  it('정책 적용 전에 저장된 동일 변경 요청은 현재 슬롯이 달라져도 멱등 응답을 우선 재생한다', async () => {
    const body = changeBody({
      idempotencyKey: 'pre-policy-change-replay',
      booking: changeSnapshot({ date: '2026-09-11', startTime: '18:00' }),
    });
    const normalizedSnapshot = {
      date: '2026-09-11',
      startTime: '18:00',
      durationHours: 3,
      serviceType: 'vehicle',
      origin: '',
      destination: '',
      waypoints: [],
      note: '주소와 메모만 변경',
      airportDirection: null,
      airportCode: null,
      hasInfluencerName: false,
      influencerName: null,
      courseMoodPercentages: [],
      courseShareSchemaVersion: 2,
    };
    const stablePayload = JSON.stringify({
      bookingId: body.bookingId,
      expectedRevision: body.expectedRevision,
      reason: body.reason,
      booking: normalizedSnapshot,
    });
    const documentId = sha256(`staff@cocotrip.test:${body.idempotencyKey}`);
    const storedResponse = { ok: true, data: { bookingId: body.bookingId, revision: 1 } };
    store.set(`mood_booking_change_idempotency/${documentId}`, {
      payloadHash: sha256(stablePayload),
      response: storedResponse,
    });

    const { res, json } = await callChange(body);

    expect(res.statusCode).toBe(200);
    expect(json).toEqual(storedResponse);
    expect(computeRouteMock).not.toHaveBeenCalled();
    expect(transactionRuns).toBe(1);
  });

  it('사전 확인 뒤 예약 슬롯이 동시에 바뀌면 트랜잭션에서 다시 차단한다', async () => {
    beforeTransaction = () => {
      store.set('mood_bookings/existing-sep10', existingBooking({
        date: '2026-09-11',
        startTime: '18:00',
      }));
    };

    const { res, json } = await callChange(changeBody());

    expect(res.statusCode).toBe(409);
    expect(json).toMatchObject({
      ok: false,
      error: MOOD_EVENING_BLACKOUT_ERROR,
      reason: MOOD_EVENING_BLACKOUT_REASON,
    });
    expect(transactionRuns).toBe(1);
    expect(store.get('mood_bookings/existing-sep10')).toMatchObject({
      date: '2026-09-11',
      startTime: '18:00',
      revision: 0,
    });
  });
});
