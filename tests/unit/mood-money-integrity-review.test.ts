/**
 * mood-settle 무결성 — 이중 확인 계약(제안 vs 승인)으로 갱신.
 * 🔴 previewHash 는 예약/입력에서만 나오고 고객 잔액·신용한도와 무관하므로, 트랜잭션 내부
 * (잔액·신용한도) 검증을 독립적으로 찌르려면 "정상 고객"으로 지문을 받은 뒤 고객만 바꾼다.
 */
/* eslint-disable @typescript-eslint/no-explicit-any -- API handler용 Firestore/응답 최소 모사. */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeFakeDb, type FakeDb } from './helpers/fakeFirestore';

const verifyUserTokenMock = vi.fn();
const computeRouteMock = vi.fn();
const dbHolder: { db: any } = { db: null };

vi.mock('../../api/_shared/user-auth.js', () => ({ verifyUserToken: verifyUserTokenMock }));
vi.mock('../../api/_shared/firebase-admin.js', () => ({ initAdminDb: () => dbHolder.db }));
vi.mock('../../api/_shared/mood-allowlist.js', () => ({
  getMoodAllowlist: async () => ({
    emails: ['staff@x.com', 'admin@x.com', 'approver@x.com'],
    admins: ['admin@x.com'],
    settlementApproverEmails: ['approver@x.com'],
    clientId: 'COMPANY_A',
  }),
  isAllowedEmail: (allowlist: any, email: string) => allowlist.emails.includes(email),
  isAdminEmail: (allowlist: any, email: string) => allowlist.admins.includes(email),
  isSettlementApproverEmail: (allowlist: any, email: string) =>
    Boolean(allowlist.settlementApproverEmails?.includes(email)) && !allowlist.admins.includes(email),
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
    breakdown: { km: 80, tollKRW: 5000, origin: '서울역', destination: '인천공항', waypoints: [] },
    ...overrides,
  };
}

async function call(modulePath: string, body: Record<string, any>, asEmail = 'admin@x.com') {
  verifyUserTokenMock.mockResolvedValue({ ok: true, email: asEmail, uid: asEmail, emailVerified: true });
  const { default: handler } = await import(modulePath);
  const response = makeResponse();
  await handler({ method: 'POST', headers: { authorization: 'Bearer token' }, body } as any, response as any);
  verifyUserTokenMock.mockResolvedValue({ ok: true, email: 'admin@x.com', uid: 'admin-1', emailVerified: true });
  return { response, json: JSON.parse(response.body || '{}') };
}
const callPreview = (body: Record<string, any>) => call('../../api/mood-settle-preview.js', body);
const callSettle = (body: Record<string, any>) => call('../../api/mood-settle.js', body);
const callRespond = (body: Record<string, any>, asEmail = 'approver@x.com') => call('../../api/mood-settle-respond.js', body, asEmail);

function settleBody(overrides: Record<string, any> = {}) {
  return {
    bookingId: 'booking-1',
    actualHours: 4,
    tollMode: 'estimated',
    manualAdjustmentKRW: 0,
    settlementReason: '',
    expectedRevision: 1,
    previewHash: 'a'.repeat(64),
    idempotencyKey: 'idem-money-integrity',
    ...overrides,
  };
}

function dataDb({ balanceKRW, amountKRW, bookingOverrides = {} }: { balanceKRW: any; amountKRW: any; bookingOverrides?: Record<string, any> }) {
  const bookingQuery: any = {
    where() { return bookingQuery; },
    orderBy() { return bookingQuery; },
    limit() { return bookingQuery; },
    async get() {
      return {
        docs: [{
          id: 'booking-1',
          data: () => ({
            clientId: 'COMPANY_A', amountKRW, status: 'confirmed', date: '2026-08-20', startTime: '09:00',
            durationHours: 4, serviceType: 'vehicle', ...bookingOverrides,
          }),
        }],
      };
    },
  };
  return {
    collection(name: string) {
      if (name === 'mood_bookings') return bookingQuery;
      return {
        doc: (id: string) => ({
          get: async () => name === 'mood_config' && id === 'booking_availability'
            ? snap(null)
            : snap({ balanceKRW, name: 'MOOD' }),
        }),
      };
    },
  };
}

async function callData() {
  const { default: handler } = await import('../../api/mood-data.js');
  const response = makeResponse();
  await handler({ method: 'GET', url: '/api/mood-data', headers: { host: 'unit.test', authorization: 'Bearer token' } } as any, response as any);
  return { response, json: JSON.parse(response.body || '{}') };
}

beforeEach(() => {
  vi.clearAllMocks();
  verifyUserTokenMock.mockResolvedValue({ ok: true, email: 'admin@x.com', uid: 'admin-1', emailVerified: true });
  computeRouteMock.mockResolvedValue({ ok: true, km: 60, tollKRW: 2000, durationMin: 80, path: [], points: [] });
});

describe('mood-settle 저장 요율 무결성', () => {
  it('저장 요율이 숫자형 문자열이면 현재 요율로 조용히 대체하지 않고 거부한다', async () => {
    const db: FakeDb = makeFakeDb({ 'mood_bookings/booking-1': baseBooking({ ratePerHour: '1' }), 'mood_clients/COMPANY_A': { balanceKRW: 500000 } });
    dbHolder.db = db;
    const { response, json } = await callSettle(settleBody());
    expect(response.statusCode).toBe(409);
    expect(json.error).toBe('INVALID_BOOKING_RATE');
    expect(db._writes).toHaveLength(0);
  });

  it('레거시 예약에서 요율 필드가 아예 없을 때만 현재 요율을 사용한다', async () => {
    const legacy = baseBooking();
    delete legacy.ratePerHour;
    const db: FakeDb = makeFakeDb({ 'mood_bookings/booking-1': legacy, 'mood_clients/COMPANY_A': { balanceKRW: 500000 } });
    dbHolder.db = db;
    const preview = await callPreview({ ...settleBody(), previewHash: undefined });
    expect(preview.response.statusCode).toBe(200);
    const { response, json } = await callSettle({ ...settleBody(), previewHash: preview.json.data.previewHash });
    expect(response.statusCode).toBe(200);
    // 🔴 요율 복구 결과(finalAmountKRW)는 제안 단계 응답에 이미 실려 있다 — 승인 전이어도 검증 가능.
    expect(json.data.finalAmountKRW).toBe(173000);
    expect(json.data.settlementApproval.finalAmountKRW).toBe(173000);
    expect(db._peek('mood_clients/COMPANY_A')?.balanceKRW).toBe(500000); // 제안만으로 잔액 불변
  });
});

describe('mood-settle 차액과 신용한도', () => {
  it('정산 추가 차감이 신용한도를 넘으면 예약과 잔액을 모두 보존한다', async () => {
    const booking = baseBooking({ amountKRW: 100000 });
    const safeDb = makeFakeDb({ 'mood_bookings/booking-1': booking, 'mood_clients/COMPANY_A': { balanceKRW: 500000 } });
    dbHolder.db = safeDb;
    const preview = await callPreview({ ...settleBody(), previewHash: undefined });
    expect(preview.response.statusCode).toBe(200);

    const db: FakeDb = makeFakeDb({ 'mood_bookings/booking-1': booking, 'mood_clients/COMPANY_A': { balanceKRW: -250000, creditLimitKRW: 300000 } });
    dbHolder.db = db;
    const { response, json } = await callSettle({ ...settleBody(), previewHash: preview.json.data.previewHash });
    expect(response.statusCode).toBe(409);
    expect(json.error).toBe('CREDIT_LIMIT_EXCEEDED');
    expect(db._writes).toHaveLength(0);
  });

  it('감액 정산은 기존 잔액이 이미 한도 아래여도 승인 시점에 환원한다', async () => {
    const booking = baseBooking({ amountKRW: 200000 });
    const db: FakeDb = makeFakeDb({
      'mood_bookings/booking-1': booking,
      'mood_clients/COMPANY_A': { balanceKRW: -350000, creditLimitKRW: 300000 },
    });
    dbHolder.db = db;
    const preview = await callPreview({ ...settleBody(), previewHash: undefined });
    expect(preview.response.statusCode).toBe(200);
    const propose = await callSettle({ ...settleBody(), previewHash: preview.json.data.previewHash });
    expect(propose.response.statusCode).toBe(200);
    expect(db._peek('mood_clients/COMPANY_A')?.balanceKRW).toBe(-350000); // 제안만으로 불변

    const approve = await callRespond({
      proposalId: propose.json.data.proposalId, action: 'approve', idempotencyKey: 'idem-approve-credit',
    });
    expect(approve.response.statusCode).toBe(200);
    expect(approve.json.data.deltaKRW).toBe(-27000);
    expect(db._peek('mood_clients/COMPANY_A')?.balanceKRW).toBe(-323000);
  });
});

describe('mood-settle 실제 경로로 손상 breakdown 복구', () => {
  it('저장 breakdown이 손상돼도 유효한 실제 경로를 입력하면 새 경로로 안전하게 정산한다', async () => {
    const db: FakeDb = makeFakeDb({
      'mood_bookings/booking-1': baseBooking({ breakdown: { km: 'broken', tollKRW: 'broken' } }),
      'mood_clients/COMPANY_A': { balanceKRW: 500000 },
    });
    dbHolder.db = db;
    const previewBody = settleBody({ origin: '실제 출발지', destination: '실제 도착지', courseMoodPercentages: [100, 0], previewHash: undefined });
    const preview = await callPreview(previewBody);
    expect(preview.response.statusCode).toBe(200);
    const { response, json } = await callSettle({ ...previewBody, previewHash: preview.json.data.previewHash });
    expect(response.statusCode).toBe(200);
    expect(json.data.settlementApproval.finalBreakdown).toMatchObject({ km: 60, tollKRW: 2000, recomputed: true });
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
    dbHolder.db = dataDb({ balanceKRW: 500000, amountKRW: 173000, bookingOverrides: { status: 'completed', finalAmountKRW: 'broken' } });
    const { response, json } = await callData();
    expect(response.statusCode).toBe(409);
    expect(json.error).toBe('INVALID_BOOKING_MONEY');
  });

  it('금액 분해의 톨비가 손상되면 0원으로 숨기지 않고 409를 반환한다', async () => {
    dbHolder.db = dataDb({ balanceKRW: 500000, amountKRW: 173000, bookingOverrides: { breakdown: { baseKRW: 120000, tollKRW: 'broken', km: 80 } } });
    const { response, json } = await callData();
    expect(response.statusCode).toBe(409);
    expect(json.error).toBe('INVALID_BOOKING_MONEY');
  });
});
