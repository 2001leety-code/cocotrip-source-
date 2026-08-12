/* eslint-disable @typescript-eslint/no-explicit-any -- API/Firestore 동작을 검증하는 인메모리 테스트 대역. */
/**
 * MOOD 신규 예약 돈 안전 계약.
 *
 * 주소가 명시된 예약은 경로 계산에 실패했는데도 기본요금만 차감해 확정하면 안 된다.
 * 또한 네트워크 재시도나 빠른 중복 클릭은 예약·차감을 한 번만 만들어야 한다.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

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
  get: () => Promise<{ exists: boolean; id: string; data: () => StoredDoc | undefined }>;
  set: (value: StoredDoc, options?: { merge?: boolean }) => Promise<void>;
  update: (value: StoredDoc) => Promise<void>;
};

const store = new Map<string, StoredDoc>();
let autoId = 0;
let transactionTail: Promise<void> = Promise.resolve();

function docKey(collection: string, id: string) {
  return `${collection}/${id}`;
}

function snapshot(ref: Ref) {
  const value = store.get(docKey(ref.__collection, ref.id));
  return {
    exists: value !== undefined,
    id: ref.id,
    data: () => value ? structuredClone(value) : undefined,
  };
}

function makeRef(collection: string, requestedId?: string): Ref {
  const id = requestedId || `auto_${++autoId}`;
  const ref = {
    __collection: collection,
    id,
    async get() {
      return snapshot(ref);
    },
    async set(value: StoredDoc, options?: { merge?: boolean }) {
      const key = docKey(collection, id);
      const previous = store.get(key) || {};
      store.set(key, structuredClone(options?.merge ? { ...previous, ...value } : value));
    },
    async update(value: StoredDoc) {
      const key = docKey(collection, id);
      store.set(key, structuredClone({ ...(store.get(key) || {}), ...value }));
    },
  };
  return ref;
}

const dbMock = {
  collection(collection: string) {
    return {
      doc(id?: string) {
        return makeRef(collection, id);
      },
    };
  },
  runTransaction<T>(callback: (tx: any) => Promise<T>): Promise<T> {
    // 같은 idempotency 문서를 읽는 두 요청이 실제 Firestore처럼 순서대로
    // 커밋되게 해 동시 요청의 중복 차감 여부를 검증한다.
    const previous = transactionTail;
    let release = () => {};
    transactionTail = new Promise<void>((resolve) => { release = resolve; });

    return previous.then(async () => {
      const staged: Array<() => void> = [];
      const tx = {
        get: async (ref: Ref) => snapshot(ref),
        set: (ref: Ref, value: StoredDoc, options?: { merge?: boolean }) => {
          staged.push(() => {
            const key = docKey(ref.__collection, ref.id);
            const previousValue = store.get(key) || {};
            store.set(key, structuredClone(options?.merge ? { ...previousValue, ...value } : value));
          });
        },
        create: (ref: Ref, value: StoredDoc) => {
          staged.push(() => {
            const key = docKey(ref.__collection, ref.id);
            if (store.has(key)) throw new Error('ALREADY_EXISTS');
            store.set(key, structuredClone(value));
          });
        },
        update: (ref: Ref, value: StoredDoc) => {
          staged.push(() => {
            const key = docKey(ref.__collection, ref.id);
            store.set(key, structuredClone({ ...(store.get(key) || {}), ...value }));
          });
        },
      };

      const result = await callback(tx);
      staged.forEach((commit) => commit());
      return result;
    }).finally(release);
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

const BASE_BODY = {
  clientId: 'COMPANY_A',
  date: '2026-08-20',
  startTime: '09:00',
  durationHours: 3,
  serviceType: 'vehicle',
  origin: '서울역',
  destination: '인천공항 제1터미널',
  waypoints: ['성수동'],
  idempotencyKey: 'mood-book-unit-request-0001',
};

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

function bookingDocs() {
  return [...store.entries()]
    .filter(([key]) => key.startsWith('mood_bookings/'))
    .map(([key, value]) => ({ id: key.slice('mood_bookings/'.length), ...value }));
}

function clientBalance() {
  return store.get('mood_clients/COMPANY_A')?.balanceKRW;
}

beforeEach(() => {
  store.clear();
  store.set('mood_clients/COMPANY_A', { name: 'Company A', balanceKRW: 1_000_000 });
  autoId = 0;
  transactionTail = Promise.resolve();
  verifyUserTokenMock.mockReset();
  verifyUserTokenMock.mockResolvedValue({
    ok: true,
    email: 'staff@x.com',
    uid: 'staff-1',
    emailVerified: true,
  });
  computeRouteMock.mockReset();
  computeRouteMock.mockResolvedValue({ ok: true, km: 48, tollKRW: 3_200, durationMin: 70 });
  notifyMock.mockReset();
  notifyMock.mockResolvedValue(undefined);
});

describe('mood-book 경로 실패 시 과소청구 차단', () => {
  it('경유지 6개는 400으로 거부하고 예약·잔액을 쓰지 않는다', async () => {
    const { response, json } = await callBook({
      ...BASE_BODY,
      waypoints: ['A', 'B', 'C', 'D', 'E', 'F'],
    });

    expect.soft(response.statusCode).toBe(400);
    expect.soft(String(json.error || '')).toContain('WAYPOINT_LIMIT_EXCEEDED');
    expect.soft(computeRouteMock).not.toHaveBeenCalled();
    expect.soft(bookingDocs()).toHaveLength(0);
    expect.soft(clientBalance()).toBe(1_000_000);
  });

  it('주소가 있는데 경로 계산이 실패하면 422로 거부하고 예약·잔액을 쓰지 않는다', async () => {
    computeRouteMock.mockResolvedValue({
      ok: false,
      status: 503,
      error: 'NAVER_DIRECTIONS_UNAVAILABLE',
    });

    const { response, json } = await callBook(BASE_BODY);

    expect.soft(response.statusCode).toBe(422);
    expect.soft(String(json.error || '')).toContain('ROUTE_CALCULATION_FAILED');
    expect.soft(bookingDocs()).toHaveLength(0);
    expect.soft(clientBalance()).toBe(1_000_000);
  });

  it('공항 직행 경로 계산 실패도 정액으로 확정하지 않고 422로 거부한다', async () => {
    computeRouteMock.mockResolvedValue({
      ok: false,
      status: 502,
      error: 'DIRECTIONS_FAILED',
    });

    const { response, json } = await callBook({
      ...BASE_BODY,
      serviceType: 'airport',
      durationHours: 0,
      airportCode: 'ICN',
      waypoints: [],
      idempotencyKey: 'mood-book-airport-direct-failure',
    });

    expect.soft(response.statusCode).toBe(422);
    expect.soft(String(json.error || '')).toContain('ROUTE_CALCULATION_FAILED');
    expect.soft(bookingDocs()).toHaveLength(0);
    expect.soft(clientBalance()).toBe(1_000_000);
  });

  it('공항 경유·직행 비교 중 하나라도 실패하면 정액으로 확정하지 않고 422로 거부한다', async () => {
    computeRouteMock
      .mockResolvedValueOnce({ ok: true, km: 65, tollKRW: 4_000, durationMin: 90 })
      .mockResolvedValueOnce({ ok: false, status: 502, error: 'DIRECTIONS_FAILED' });

    const { response, json } = await callBook({
      ...BASE_BODY,
      serviceType: 'airport',
      durationHours: 0,
      airportCode: 'ICN',
      idempotencyKey: 'mood-book-airport-waypoint-failure',
    });

    expect.soft(response.statusCode).toBe(422);
    expect.soft(String(json.error || '')).toContain('ROUTE_CALCULATION_FAILED');
    expect.soft(computeRouteMock).toHaveBeenCalledTimes(2);
    expect.soft(bookingDocs()).toHaveLength(0);
    expect.soft(clientBalance()).toBe(1_000_000);
  });

  it('성공 봉투라도 거리·시간이 숫자가 아니면 422로 닫고 0km 과소청구를 만들지 않는다', async () => {
    computeRouteMock.mockResolvedValue({
      ok: true,
      km: Number.NaN,
      tollKRW: Number.NaN,
      durationMin: Number.NaN,
    });

    const { response, json } = await callBook({
      ...BASE_BODY,
      idempotencyKey: 'mood-book-invalid-route-numbers',
    });

    expect.soft(response.statusCode).toBe(422);
    expect.soft(String(json.error || '')).toContain('ROUTE_CALCULATION_FAILED');
    expect.soft(bookingDocs()).toHaveLength(0);
    expect.soft(clientBalance()).toBe(1_000_000);
  });
});

describe('mood-book idempotencyKey 중복 차감 차단', () => {
  it('같은 키와 같은 요청을 재전송하면 저장된 성공 응답을 돌려주고 한 번만 차감한다', async () => {
    const first = await callBook(BASE_BODY);
    const afterFirst = clientBalance();
    const second = await callBook(BASE_BODY);

    expect.soft(first.response.statusCode).toBe(200);
    expect.soft(second.response.statusCode).toBe(200);
    expect.soft(second.json.data).toEqual(first.json.data);
    expect.soft(second.json.data?.bookingId).toBe(first.json.data?.bookingId);
    expect.soft(bookingDocs()).toHaveLength(1);
    expect.soft(clientBalance()).toBe(afterFirst);
    expect.soft(computeRouteMock).toHaveBeenCalledTimes(1);
    expect.soft(notifyMock).toHaveBeenCalledTimes(1);
  });

  it('같은 키에 다른 payload를 보내면 409 충돌로 거부하고 최초 예약만 유지한다', async () => {
    const first = await callBook(BASE_BODY);
    const afterFirst = clientBalance();
    const second = await callBook({ ...BASE_BODY, startTime: '10:00' });

    expect.soft(first.response.statusCode).toBe(200);
    expect.soft(second.response.statusCode).toBe(409);
    expect.soft(String(second.json.error || '')).toContain('IDEMPOTENCY_CONFLICT');
    expect.soft(bookingDocs()).toHaveLength(1);
    expect.soft(clientBalance()).toBe(afterFirst);
    expect.soft(computeRouteMock).toHaveBeenCalledTimes(1);
    expect.soft(notifyMock).toHaveBeenCalledTimes(1);
  });

  it('같은 요청이 동시에 들어와도 예약 ID 하나와 잔액 차감 한 번만 남는다', async () => {
    const [first, second] = await Promise.all([
      callBook(BASE_BODY),
      callBook(BASE_BODY),
    ]);

    expect.soft(first.response.statusCode).toBe(200);
    expect.soft(second.response.statusCode).toBe(200);
    expect.soft(first.json.data?.bookingId).toBe(second.json.data?.bookingId);
    expect.soft(bookingDocs()).toHaveLength(1);

    const booking = bookingDocs()[0];
    expect.soft(clientBalance()).toBe(1_000_000 - Number(booking?.amountKRW || 0));
    expect.soft(notifyMock).toHaveBeenCalledTimes(1);
  });
});

describe('실제 예약 화면 idempotencyKey 배선', () => {
  it.each([
    ['수기 예약', 'src/pages/MoodPortal.tsx'],
    ['AI 예약', 'src/components/mood/MoodAiBooking.tsx'],
  ])('%s 요청 payload가 서버 중복 차감 가드를 사용한다', (_label, relativePath) => {
    const source = readFileSync(resolve(process.cwd(), relativePath), 'utf8');
    const endpointIndex = source.indexOf("authFetch('/api/mood-book'");
    expect(endpointIndex).toBeGreaterThan(-1);

    // 키 필드는 요청 body 가까이에 있어야 한다. 파일 다른 기능에 같은 단어가 생겨도
    // 예약 요청 배선으로 오인하지 않도록 엔드포인트 직전의 payload 구성만 검사한다.
    const requestWindow = source.slice(Math.max(0, endpointIndex - 2_500), endpointIndex + 500);
    expect(requestWindow).toMatch(/idempotencyKey/);
  });
});

describe('mood-book money and credit safety', () => {
  it('requires an idempotency key before route calculation or writes', async () => {
    const bodyWithoutKey = { ...BASE_BODY } as Record<string, unknown>;
    delete bodyWithoutKey.idempotencyKey;
    const { response, json } = await callBook(bodyWithoutKey);

    expect.soft(response.statusCode).toBe(400);
    expect.soft(json.error).toBe('INVALID_IDEMPOTENCY_KEY');
    expect.soft(computeRouteMock).not.toHaveBeenCalled();
    expect.soft(bookingDocs()).toHaveLength(0);
    expect.soft(clientBalance()).toBe(1_000_000);
  });

  it('fails closed when backend pricing produces unsafe money fields', async () => {
    computeRouteMock.mockResolvedValue({
      ok: true,
      km: Number.MAX_VALUE,
      tollKRW: 0,
      durationMin: 70,
    });

    const { response, json } = await callBook(BASE_BODY);

    expect.soft(response.statusCode).toBe(500);
    expect.soft(json.error).toBe('INVALID_PRICING_RESULT');
    expect.soft(bookingDocs()).toHaveLength(0);
    expect.soft(clientBalance()).toBe(1_000_000);
  });

  it('rejects unsafe calculated balances without writing a booking', async () => {
    store.set('mood_clients/COMPANY_A', { balanceKRW: Number.MIN_SAFE_INTEGER });
    const { response, json } = await callBook(BASE_BODY);

    expect.soft(response.statusCode).toBe(409);
    expect.soft(json.error).toBe('INVALID_CALCULATED_BALANCE');
    expect.soft(bookingDocs()).toHaveLength(0);
    expect.soft(clientBalance()).toBe(Number.MIN_SAFE_INTEGER);
  });

  it.each([0, -1, 1.5, '300000', Number.MAX_VALUE])(
    'rejects an explicitly configured invalid credit limit: %s',
    async (creditLimitKRW) => {
      store.set('mood_clients/COMPANY_A', { balanceKRW: 1_000_000, creditLimitKRW });
      const { response, json } = await callBook(BASE_BODY);

      expect.soft(response.statusCode).toBe(409);
      expect.soft(json.error).toBe('INVALID_CREDIT_LIMIT');
      expect.soft(bookingDocs()).toHaveLength(0);
      expect.soft(clientBalance()).toBe(1_000_000);
    },
  );

  it('treats an explicit null credit limit as unset', async () => {
    store.set('mood_clients/COMPANY_A', { balanceKRW: 1_000_000, creditLimitKRW: null });
    const { response } = await callBook(BASE_BODY);

    expect.soft(response.statusCode).toBe(200);
    expect.soft(bookingDocs()).toHaveLength(1);
    expect.soft(clientBalance()).toBeLessThan(1_000_000);
  });
});
