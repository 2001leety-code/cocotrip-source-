/* eslint-disable @typescript-eslint/no-explicit-any -- serverless handler와 Firestore 트랜잭션을 메모리로 검증한다. */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  checkMoodBookingAvailability,
  DEFAULT_MOOD_BOOKING_AVAILABILITY,
  moodBookingAvailabilityFromSnapshot,
  normalizeMoodBookingAvailabilityRule,
} from '../../api/_shared/mood-booking-availability.js';

const verifyUserTokenMock = vi.fn();
const captureErrorMock = vi.fn();

type StoredDoc = Record<string, any>;
type Ref = { collection: string; id: string; get: () => Promise<any> };
const store = new Map<string, StoredDoc>();
let beforeTransaction: (() => void) | undefined;

function keyOf(ref: Ref) {
  return `${ref.collection}/${ref.id}`;
}

function snapshot(ref: Ref) {
  const value = store.get(keyOf(ref));
  return {
    exists: value !== undefined,
    data: () => value === undefined ? undefined : structuredClone(value),
  };
}

function makeRef(collection: string, id: string): Ref {
  const ref: Ref = { collection, id, get: async () => snapshot(ref) };
  return ref;
}

const dbMock = {
  collection: vi.fn((collection: string) => ({
    doc: vi.fn((id: string) => makeRef(collection, id)),
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
      set: (ref: Ref, value: StoredDoc) => staged.push(() => store.set(keyOf(ref), structuredClone(value))),
    });
    staged.forEach((commit) => commit());
    return result;
  }),
};

vi.mock('../../api/_shared/user-auth.js', () => ({
  verifyUserToken: (...args: any[]) => verifyUserTokenMock(...args),
}));
vi.mock('../../api/_shared/firebase-admin.js', () => ({ initAdminDb: () => dbMock }));
vi.mock('../../api/_shared/mood-allowlist.js', () => ({
  getMoodAllowlist: async () => ({
    emails: ['admin@x.com', 'staff@x.com'],
    admins: ['admin@x.com'],
    clientId: 'MOOD',
  }),
  isAllowedEmail: (allowlist: any, email: string) => allowlist.emails.includes(email),
  isAdminEmail: (allowlist: any, email: string) => allowlist.admins.includes(email),
}));
vi.mock('../../api/_shared/cors.js', () => ({ buildAdminJsonCors: () => ({}) }));
vi.mock('../../api/_shared/sentry.js', () => ({
  captureError: (...args: any[]) => captureErrorMock(...args),
}));

function response() {
  const res = {
    statusCode: 0,
    body: '',
    headers: {} as Record<string, string>,
    writeHead(status: number, headers?: Record<string, string>) {
      res.statusCode = status;
      Object.assign(res.headers, headers || {});
      return res;
    },
    end(body?: string | Buffer) {
      res.body = body instanceof Buffer ? body.toString('utf8') : (body || '');
      return res;
    },
  };
  return res;
}

async function callApi(method: string, body?: Record<string, any>) {
  const { default: handler } = await import('../../api/mood-booking-blocks.js');
  const res = response();
  await handler({
    method,
    body,
    headers: { authorization: 'Bearer token' },
  } as any, res as any);
  return { res, json: JSON.parse(res.body || '{}') };
}

const CUSTOM_RULE = {
  id: 'sep-photo-block',
  enabled: true,
  startDate: '2026-09-20',
  endDate: '2026-09-20',
  weekdays: [0],
  mode: 'full_day',
  startTime: null,
  reason: '촬영팀 휴무',
};

beforeEach(() => {
  vi.clearAllMocks();
  store.clear();
  beforeTransaction = undefined;
  store.set('mood_config/allowlist', {
    emails: ['admin@x.com', 'staff@x.com'],
    admins: ['admin@x.com'],
    clientId: 'MOOD',
  });
  verifyUserTokenMock.mockResolvedValue({
    ok: true,
    email: 'admin@x.com',
    uid: 'admin-1',
    emailVerified: true,
  });
});

describe('예약 차단 정책 정규화', () => {
  it('설정 문서가 없으면 기존 저녁 차단을 revision 0 기본값으로 반환한다', () => {
    const availability = moodBookingAvailabilityFromSnapshot({ exists: false });
    expect(availability).toEqual(DEFAULT_MOOD_BOOKING_AVAILABILITY);
    expect(checkMoodBookingAvailability('2026-09-10', '18:00', availability).ok).toBe(false);
  });

  it('존재하는 rules:[] 문서는 명시적으로 모든 시간을 연다', () => {
    const availability = moodBookingAvailabilityFromSnapshot({
      exists: true,
      data: () => ({ schemaVersion: 1, revision: 3, rules: [] }),
    });
    expect(availability).toEqual({ schemaVersion: 1, revision: 3, rules: [] });
    expect(checkMoodBookingAvailability('2026-09-10', '18:00', availability)).toEqual({ ok: true });
  });

  it.each([
    {},
    { rules: [] },
    { schemaVersion: 1, rules: [] },
    { revision: 0, rules: [] },
  ])('존재하지만 필수 스키마가 빠진 설정은 개방으로 보정하지 않고 거부한다: %o', (data) => {
    expect(() => moodBookingAvailabilityFromSnapshot({
      exists: true,
      data: () => data,
    })).toThrow();
  });

  it('종일 차단은 startTime=null만 허용하고 중복 요일·잘못된 날짜를 거부한다', () => {
    expect(normalizeMoodBookingAvailabilityRule(CUSTOM_RULE)).toMatchObject({ ok: true });
    expect(normalizeMoodBookingAvailabilityRule({ ...CUSTOM_RULE, startTime: '00:00' })).toMatchObject({
      ok: false,
      error: 'INVALID_BOOKING_BLOCK_START_TIME',
    });
    expect(normalizeMoodBookingAvailabilityRule({ ...CUSTOM_RULE, weekdays: [0, 0] }).ok).toBe(false);
    expect(normalizeMoodBookingAvailabilityRule({ ...CUSTOM_RULE, endDate: '2026-02-30' }).ok).toBe(false);
  });
});

describe('/api/mood-booking-blocks 인증·멱등·revision', () => {
  it('허용된 직원 GET은 누락 문서의 기본 정책을 공개 계약 위치로 받는다', async () => {
    verifyUserTokenMock.mockResolvedValue({
      ok: true,
      email: 'staff@x.com',
      uid: 'staff-1',
      emailVerified: true,
    });
    const { res, json } = await callApi('GET');
    expect(res.statusCode).toBe(200);
    expect(json.data.bookingAvailability).toMatchObject({ schemaVersion: 1, revision: 0 });
    expect(json.data.bookingAvailability.rules).toHaveLength(1);
  });

  it('미검증 이메일은 조회도 거부하고 일반 직원은 수정하지 못한다', async () => {
    verifyUserTokenMock.mockResolvedValueOnce({
      ok: true,
      email: 'staff@x.com',
      uid: 'staff-1',
      emailVerified: false,
    });
    expect((await callApi('GET')).res.statusCode).toBe(403);

    verifyUserTokenMock.mockResolvedValueOnce({
      ok: true,
      email: 'staff@x.com',
      uid: 'staff-1',
      emailVerified: true,
    });
    const result = await callApi('POST', {
      action: 'upsert', expectedRevision: 0, requestId: 'staff-denied-001', rule: CUSTOM_RULE,
    });
    expect(result.res.statusCode).toBe(403);
    expect(store.get('mood_config/booking_availability')).toBeUndefined();
    expect(store.get('mood_booking_block_audit/staff-denied-001')).toBeUndefined();
  });

  it('admin upsert는 기본 규칙을 보존하며 revision과 감사기록을 원자적으로 쓴다', async () => {
    const body = {
      action: 'upsert', expectedRevision: 0, requestId: 'upsert-request-001', rule: CUSTOM_RULE,
    };
    const first = await callApi('POST', body);
    expect(first.res.statusCode).toBe(200);
    expect(first.json.data.bookingAvailability).toMatchObject({ schemaVersion: 1, revision: 1 });
    expect(first.json.data.bookingAvailability.rules.map((rule: any) => rule.id)).toEqual([
      'legacy-evening-blackout-2026',
      'sep-photo-block',
    ]);
    expect(store.get('mood_config/booking_availability')).toMatchObject({ revision: 1 });
    expect(store.get('mood_booking_block_audit/upsert-request-001')).toMatchObject({
      action: 'upsert',
      actorEmail: 'admin@x.com',
      previousRevision: 0,
      revision: 1,
      ruleId: 'sep-photo-block',
    });

    const replay = await callApi('POST', body);
    expect(replay.res.statusCode).toBe(200);
    expect(replay.json.data.bookingAvailability).toEqual(first.json.data.bookingAvailability);
    expect(store.get('mood_config/booking_availability')?.revision).toBe(1);
  });

  it('같은 requestId의 다른 payload와 stale revision을 각각 409로 막는다', async () => {
    const body = {
      action: 'upsert', expectedRevision: 0, requestId: 'conflict-request-001', rule: CUSTOM_RULE,
    };
    expect((await callApi('POST', body)).res.statusCode).toBe(200);

    const idempotencyConflict = await callApi('POST', {
      ...body,
      rule: { ...CUSTOM_RULE, reason: '다른 사유' },
    });
    expect(idempotencyConflict.res.statusCode).toBe(409);
    expect(idempotencyConflict.json.error).toBe('IDEMPOTENCY_CONFLICT');

    const revisionConflict = await callApi('POST', {
      action: 'delete', expectedRevision: 0, requestId: 'stale-delete-001', ruleId: CUSTOM_RULE.id,
    });
    expect(revisionConflict.res.statusCode).toBe(409);
    expect(revisionConflict.json.error).toBe('REVISION_CONFLICT');
    expect(revisionConflict.json.data.bookingAvailability.revision).toBe(1);
  });

  it('바깥 권한 확인 뒤 admins에서 회수되면 같은 트랜잭션에서 쓰기를 중단한다', async () => {
    beforeTransaction = () => {
      store.set('mood_config/allowlist', {
        emails: ['admin@x.com', 'staff@x.com'],
        admins: [],
        clientId: 'MOOD',
      });
    };
    const result = await callApi('POST', {
      action: 'upsert', expectedRevision: 0, requestId: 'revoked-admin-001', rule: CUSTOM_RULE,
    });

    expect(result.res.statusCode).toBe(403);
    expect(result.json.error).toBe('ADMIN_REQUIRED');
    expect(store.get('mood_config/booking_availability')).toBeUndefined();
    expect(store.get('mood_booking_block_audit/revoked-admin-001')).toBeUndefined();
  });

  it('delete는 단일 규칙만 제거하고 같은 requestId 재시도에 revision을 재증가시키지 않는다', async () => {
    await callApi('POST', {
      action: 'upsert', expectedRevision: 0, requestId: 'for-delete-upsert', rule: CUSTOM_RULE,
    });
    const body = {
      action: 'delete', expectedRevision: 1, requestId: 'delete-request-001', ruleId: CUSTOM_RULE.id,
    };
    const first = await callApi('POST', body);
    expect(first.res.statusCode).toBe(200);
    expect(first.json.data.bookingAvailability).toMatchObject({ revision: 2 });
    expect(first.json.data.bookingAvailability.rules.map((rule: any) => rule.id)).toEqual([
      'legacy-evening-blackout-2026',
    ]);

    const replay = await callApi('POST', body);
    expect(replay.res.statusCode).toBe(200);
    expect(replay.json.data.bookingAvailability.revision).toBe(2);
    expect(store.get('mood_config/booking_availability')?.revision).toBe(2);
  });

  it('잘못된 규칙과 최대 개수 초과는 설정·감사기록을 쓰지 않는다', async () => {
    const invalid = await callApi('POST', {
      action: 'upsert',
      expectedRevision: 0,
      requestId: 'invalid-rule-001',
      rule: { ...CUSTOM_RULE, weekdays: [7] },
    });
    expect(invalid.res.statusCode).toBe(400);
    expect(store.get('mood_config/booking_availability')).toBeUndefined();
    expect(store.get('mood_booking_block_audit/invalid-rule-001')).toBeUndefined();

    store.set('mood_config/booking_availability', {
      schemaVersion: 1,
      revision: 7,
      rules: Array.from({ length: 50 }, (_, index) => ({
        ...CUSTOM_RULE,
        id: `existing-${index}`,
      })),
    });
    const overLimit = await callApi('POST', {
      action: 'upsert', expectedRevision: 7, requestId: 'over-limit-001', rule: CUSTOM_RULE,
    });
    expect(overLimit.res.statusCode).toBe(409);
    expect(overLimit.json.error).toBe('BOOKING_BLOCK_RULE_LIMIT');
    expect(store.get('mood_booking_block_audit/over-limit-001')).toBeUndefined();
    expect(store.get('mood_config/booking_availability')?.revision).toBe(7);
  });
});
