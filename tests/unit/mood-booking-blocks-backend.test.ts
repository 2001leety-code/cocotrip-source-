/* eslint-disable @typescript-eslint/no-explicit-any -- serverless handler와 Firestore 트랜잭션을 메모리로 검증한다. */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  checkMoodBookingAvailability,
  DEFAULT_MOOD_BOOKING_AVAILABILITY,
  MOOD_BOOKING_AVAILABILITY_MAX_EXCEPTION_DAYS,
  MOOD_BOOKING_AVAILABILITY_MAX_EXCEPTIONS,
  moodBookingAvailabilityFromSnapshot,
  normalizeMoodBookingAvailabilityException,
  normalizeMoodBookingAvailabilityRule,
} from '../../api/_shared/mood-booking-availability.js';
import { PRIMARY_MOOD_ADMIN_EMAIL } from '../../api/_shared/mood-allowlist.js';

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

const DAILY_RULE = {
  id: 'daily-sep-block',
  enabled: true,
  startDate: '2026-09-01',
  endDate: '2026-09-07',
  weekdays: [0, 1, 2, 3, 4, 5, 6],
  mode: 'full_day',
  startTime: null,
  reason: '9월 첫째 주 종일 차단',
};

const RANGE_EXCEPTION = {
  id: 'open-sep-3-to-5',
  enabled: true,
  startDate: '2026-09-03',
  endDate: '2026-09-05',
  ruleIds: [DAILY_RULE.id],
  reason: '3일부터 5일만 예약 허용',
};

beforeEach(() => {
  vi.clearAllMocks();
  store.clear();
  beforeTransaction = undefined;
  store.set('mood_config/allowlist', {
    emails: [PRIMARY_MOOD_ADMIN_EMAIL, 'staff@x.com'],
    admins: [PRIMARY_MOOD_ADMIN_EMAIL],
    clientId: 'MOOD',
  });
  verifyUserTokenMock.mockResolvedValue({
    ok: true,
    email: PRIMARY_MOOD_ADMIN_EMAIL,
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
    expect(availability).toEqual({ schemaVersion: 1, revision: 3, rules: [], exceptions: [] });
    expect(checkMoodBookingAvailability('2026-09-10', '18:00', availability)).toEqual({ ok: true });
  });

  it('schemaVersion 1 구문서에서 exceptions 누락은 빈 배열로 하위 호환한다', () => {
    const availability = moodBookingAvailabilityFromSnapshot({
      exists: true,
      data: () => ({ schemaVersion: 1, revision: 4, rules: [DAILY_RULE] }),
    });

    expect(availability.exceptions).toEqual([]);
    expect(checkMoodBookingAvailability('2026-09-04', '12:00', availability).ok).toBe(false);
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

  it('하루 예외와 3일~5일 양끝 포함 예외만 정확히 연다', () => {
    const oneDayAvailability = {
      schemaVersion: 1,
      revision: 1,
      rules: [DAILY_RULE],
      exceptions: [{ ...RANGE_EXCEPTION, id: 'open-sep-4', startDate: '2026-09-04', endDate: '2026-09-04' }],
    };
    expect(checkMoodBookingAvailability('2026-09-03', '12:00', oneDayAvailability).ok).toBe(false);
    expect(checkMoodBookingAvailability('2026-09-04', '12:00', oneDayAvailability)).toEqual({ ok: true });
    expect(checkMoodBookingAvailability('2026-09-05', '12:00', oneDayAvailability).ok).toBe(false);

    const rangeAvailability = {
      ...oneDayAvailability,
      exceptions: [RANGE_EXCEPTION],
    };
    expect(checkMoodBookingAvailability('2026-09-02', '12:00', rangeAvailability).ok).toBe(false);
    expect(checkMoodBookingAvailability('2026-09-03', '12:00', rangeAvailability)).toEqual({ ok: true });
    expect(checkMoodBookingAvailability('2026-09-05', '12:00', rangeAvailability)).toEqual({ ok: true });
    expect(checkMoodBookingAvailability('2026-09-06', '12:00', rangeAvailability).ok).toBe(false);
  });

  it('겹친 규칙과 나중에 추가한 긴급 규칙은 과거 예외로 우회되지 않는다', () => {
    const overlappingRule = { ...DAILY_RULE, id: 'overlapping-block', reason: '겹친 차단' };
    const emergencyRule = { ...DAILY_RULE, id: 'later-emergency-block', reason: '나중 긴급 차단' };
    const exception = { ...RANGE_EXCEPTION, ruleIds: [DAILY_RULE.id] };

    expect(checkMoodBookingAvailability('2026-09-04', '12:00', {
      schemaVersion: 1,
      revision: 1,
      rules: [DAILY_RULE, overlappingRule],
      exceptions: [exception],
    })).toMatchObject({ ok: false, ruleId: overlappingRule.id });

    expect(checkMoodBookingAvailability('2026-09-04', '12:00', {
      schemaVersion: 1,
      revision: 2,
      rules: [DAILY_RULE, emergencyRule],
      exceptions: [exception],
    })).toMatchObject({ ok: false, ruleId: emergencyRule.id });
  });

  it('손상된 예외는 fail-closed로 무시하고 저장 문서 파싱도 거부한다', () => {
    const invalidException = { ...RANGE_EXCEPTION, ruleIds: [DAILY_RULE.id, DAILY_RULE.id] };
    expect(normalizeMoodBookingAvailabilityException(invalidException)).toMatchObject({
      ok: false,
      error: 'INVALID_BOOKING_BLOCK_EXCEPTION_RULE_IDS',
    });
    expect(checkMoodBookingAvailability('2026-09-04', '12:00', {
      schemaVersion: 1,
      revision: 1,
      rules: [DAILY_RULE],
      exceptions: [invalidException],
    }).ok).toBe(false);
    expect(checkMoodBookingAvailability('2026-09-04', '12:00', {
      schemaVersion: 1,
      revision: 1,
      rules: [DAILY_RULE],
      exceptions: [RANGE_EXCEPTION, invalidException],
    }).ok).toBe(false);
    expect(() => moodBookingAvailabilityFromSnapshot({
      exists: true,
      data: () => ({
        schemaVersion: 1,
        revision: 1,
        rules: [DAILY_RULE],
        exceptions: [{ ...RANGE_EXCEPTION, ruleIds: ['unknown-rule'] }],
      }),
    })).toThrow();
  });

  it('예외 ID·기간·사유·ruleIds를 엄격히 제한한다', () => {
    expect(normalizeMoodBookingAvailabilityException(RANGE_EXCEPTION)).toMatchObject({ ok: true });
    expect(normalizeMoodBookingAvailabilityException({ ...RANGE_EXCEPTION, id: 'bad id' }).ok).toBe(false);
    expect(normalizeMoodBookingAvailabilityException({ ...RANGE_EXCEPTION, reason: '   ' }).ok).toBe(false);
    expect(normalizeMoodBookingAvailabilityException({ ...RANGE_EXCEPTION, ruleIds: [] }).ok).toBe(false);
    expect(normalizeMoodBookingAvailabilityException({ ...RANGE_EXCEPTION, ruleIds: [123] }).ok).toBe(false);

    const tooLongEnd = new Date(Date.UTC(2026, 8, 3 + MOOD_BOOKING_AVAILABILITY_MAX_EXCEPTION_DAYS))
      .toISOString()
      .slice(0, 10);
    expect(normalizeMoodBookingAvailabilityException({
      ...RANGE_EXCEPTION,
      endDate: tooLongEnd,
    })).toMatchObject({
      ok: false,
      error: 'INVALID_BOOKING_BLOCK_EXCEPTION_DATE_RANGE',
    });
    expect(() => moodBookingAvailabilityFromSnapshot({
      exists: true,
      data: () => ({
        schemaVersion: 1,
        revision: 1,
        rules: [DAILY_RULE],
        exceptions: Array.from(
          { length: MOOD_BOOKING_AVAILABILITY_MAX_EXCEPTIONS + 1 },
          () => RANGE_EXCEPTION,
        ),
      }),
    })).toThrow();
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
      actorEmail: PRIMARY_MOOD_ADMIN_EMAIL,
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
        emails: [PRIMARY_MOOD_ADMIN_EMAIL, 'staff@x.com'],
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

  it('admins 배열에 잘못 남은 비고정 직원도 예약 차단 정책을 수정하지 못한다', async () => {
    store.set('mood_config/allowlist', {
      emails: [PRIMARY_MOOD_ADMIN_EMAIL, 'legacy@x.com'],
      admins: [PRIMARY_MOOD_ADMIN_EMAIL, 'legacy@x.com'],
      clientId: 'MOOD',
    });
    verifyUserTokenMock.mockResolvedValue({
      ok: true,
      email: 'legacy@x.com',
      uid: 'legacy-1',
      emailVerified: true,
    });

    const result = await callApi('POST', {
      action: 'upsert', expectedRevision: 0, requestId: 'stray-admin-denied-001', rule: CUSTOM_RULE,
    });

    expect(result.res.statusCode).toBe(403);
    expect(result.json.error).toBe('ADMIN_REQUIRED');
    expect(store.get('mood_config/booking_availability')).toBeUndefined();
    expect(store.get('mood_booking_block_audit/stray-admin-denied-001')).toBeUndefined();
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

  it('기간 예외는 현재 범위에 실제로 걸리는 규칙 ID를 서버가 바인딩하고 멱등 재생한다', async () => {
    store.set('mood_config/booking_availability', {
      schemaVersion: 1,
      revision: 5,
      rules: [DAILY_RULE, CUSTOM_RULE],
    });
    const body = {
      action: 'upsert_exception',
      expectedRevision: 5,
      requestId: 'upsert-exception-001',
      exception: {
        id: RANGE_EXCEPTION.id,
        enabled: true,
        startDate: RANGE_EXCEPTION.startDate,
        endDate: RANGE_EXCEPTION.endDate,
        reason: RANGE_EXCEPTION.reason,
        ruleIds: [CUSTOM_RULE.id],
      },
    };

    const first = await callApi('POST', body);
    expect(first.res.statusCode).toBe(200);
    expect(first.json.data.bookingAvailability).toMatchObject({ revision: 6 });
    expect(first.json.data.bookingAvailability.exceptions).toEqual([RANGE_EXCEPTION]);
    expect(checkMoodBookingAvailability(
      '2026-09-04',
      '12:00',
      first.json.data.bookingAvailability,
    )).toEqual({ ok: true });
    expect(checkMoodBookingAvailability(
      '2026-09-02',
      '12:00',
      first.json.data.bookingAvailability,
    ).ok).toBe(false);
    expect(store.get('mood_booking_block_audit/upsert-exception-001')).toMatchObject({
      type: 'booking_block_exception_upserted',
      action: 'upsert_exception',
      exceptionId: RANGE_EXCEPTION.id,
      previousRevision: 5,
      revision: 6,
      before: { exceptions: [] },
      after: { exceptions: [RANGE_EXCEPTION] },
    });

    const replay = await callApi('POST', body);
    expect(replay.res.statusCode).toBe(200);
    expect(replay.json.data.bookingAvailability).toEqual(first.json.data.bookingAvailability);
    expect(store.get('mood_config/booking_availability')?.revision).toBe(6);

    const conflict = await callApi('POST', {
      ...body,
      exception: { ...body.exception, reason: '다른 해제 사유' },
    });
    expect(conflict.res.statusCode).toBe(409);
    expect(conflict.json.error).toBe('IDEMPOTENCY_CONFLICT');
  });

  it('예외 저장 뒤 추가한 긴급 규칙은 예외에 자동 편입되지 않아 계속 차단한다', async () => {
    store.set('mood_config/booking_availability', {
      schemaVersion: 1,
      revision: 2,
      rules: [DAILY_RULE],
      exceptions: [RANGE_EXCEPTION],
    });
    const emergencyRule = { ...DAILY_RULE, id: 'later-emergency-rule', reason: '새 긴급 차단' };

    const result = await callApi('POST', {
      action: 'upsert',
      expectedRevision: 2,
      requestId: 'later-emergency-001',
      rule: emergencyRule,
    });

    expect(result.res.statusCode).toBe(200);
    expect(result.json.data.bookingAvailability.exceptions).toEqual([RANGE_EXCEPTION]);
    expect(checkMoodBookingAvailability(
      '2026-09-04',
      '12:00',
      result.json.data.bookingAvailability,
    )).toMatchObject({ ok: false, ruleId: emergencyRule.id });
  });

  it('겹치는 규칙이 없는 예외 요청은 설정과 감사기록을 쓰지 않고 명확히 거부한다', async () => {
    store.set('mood_config/booking_availability', {
      schemaVersion: 1,
      revision: 3,
      rules: [DAILY_RULE],
      exceptions: [],
    });
    const result = await callApi('POST', {
      action: 'upsert_exception',
      expectedRevision: 3,
      requestId: 'no-match-exception-001',
      exception: {
        id: 'open-october',
        enabled: true,
        startDate: '2026-10-01',
        endDate: '2026-10-02',
        reason: '범위 밖 해제',
      },
    });

    expect(result.res.statusCode).toBe(409);
    expect(result.json.error).toBe('BOOKING_BLOCK_EXCEPTION_NO_MATCH');
    expect(store.get('mood_config/booking_availability')?.revision).toBe(3);
    expect(store.get('mood_booking_block_audit/no-match-exception-001')).toBeUndefined();
  });

  it('규칙 삭제는 예외의 해당 ruleId를 함께 지우고 빈 예외는 제거한다', async () => {
    const overlappingRule = { ...DAILY_RULE, id: 'overlap-for-delete', reason: '겹친 규칙' };
    store.set('mood_config/booking_availability', {
      schemaVersion: 1,
      revision: 7,
      rules: [DAILY_RULE, overlappingRule],
      exceptions: [
        { ...RANGE_EXCEPTION, id: 'both-rules', ruleIds: [DAILY_RULE.id, overlappingRule.id] },
        { ...RANGE_EXCEPTION, id: 'daily-only' },
        { ...RANGE_EXCEPTION, id: 'overlap-only', ruleIds: [overlappingRule.id] },
      ],
    });

    const result = await callApi('POST', {
      action: 'delete',
      expectedRevision: 7,
      requestId: 'delete-with-cleanup-001',
      ruleId: DAILY_RULE.id,
    });

    expect(result.res.statusCode).toBe(200);
    expect(result.json.data.bookingAvailability.rules.map((rule: any) => rule.id)).toEqual([
      overlappingRule.id,
    ]);
    expect(result.json.data.bookingAvailability.exceptions).toEqual([
      { ...RANGE_EXCEPTION, id: 'both-rules', ruleIds: [overlappingRule.id] },
      { ...RANGE_EXCEPTION, id: 'overlap-only', ruleIds: [overlappingRule.id] },
    ]);
  });

  it('delete_exception은 해당 예외만 지우고 재시도해도 revision을 한 번만 올린다', async () => {
    store.set('mood_config/booking_availability', {
      schemaVersion: 1,
      revision: 8,
      rules: [DAILY_RULE],
      exceptions: [RANGE_EXCEPTION],
    });
    const body = {
      action: 'delete_exception',
      expectedRevision: 8,
      requestId: 'delete-exception-001',
      exceptionId: RANGE_EXCEPTION.id,
    };

    const first = await callApi('POST', body);
    expect(first.res.statusCode).toBe(200);
    expect(first.json.data.bookingAvailability).toMatchObject({ revision: 9, exceptions: [] });
    expect(store.get('mood_booking_block_audit/delete-exception-001')).toMatchObject({
      type: 'booking_block_exception_deleted',
      exceptionId: RANGE_EXCEPTION.id,
    });

    const replay = await callApi('POST', body);
    expect(replay.res.statusCode).toBe(200);
    expect(replay.json.data.bookingAvailability.revision).toBe(9);
  });

  it('set_all_enabled는 모든 규칙만 한 트랜잭션으로 끄고 예외와 감사 전후값을 보존한다', async () => {
    store.set('mood_config/booking_availability', {
      schemaVersion: 1,
      revision: 11,
      rules: [DAILY_RULE, { ...CUSTOM_RULE, enabled: false }],
      exceptions: [RANGE_EXCEPTION],
    });
    const body = {
      action: 'set_all_enabled',
      expectedRevision: 11,
      requestId: 'disable-all-001',
      enabled: false,
    };

    const first = await callApi('POST', body);
    expect(first.res.statusCode).toBe(200);
    expect(first.json.data.bookingAvailability.revision).toBe(12);
    expect(first.json.data.bookingAvailability.rules.every((rule: any) => rule.enabled === false)).toBe(true);
    expect(first.json.data.bookingAvailability.exceptions).toEqual([RANGE_EXCEPTION]);
    expect(checkMoodBookingAvailability(
      '2026-09-02',
      '12:00',
      first.json.data.bookingAvailability,
    )).toEqual({ ok: true });
    expect(store.get('mood_booking_block_audit/disable-all-001')).toMatchObject({
      type: 'booking_blocks_enabled_changed',
      enabled: false,
      before: { revision: 11 },
      after: { revision: 12 },
    });

    const replay = await callApi('POST', body);
    expect(replay.res.statusCode).toBe(200);
    expect(replay.json.data.bookingAvailability.revision).toBe(12);

    const stale = await callApi('POST', {
      ...body,
      requestId: 'disable-all-stale-001',
      enabled: true,
    });
    expect(stale.res.statusCode).toBe(409);
    expect(stale.json.error).toBe('REVISION_CONFLICT');
    expect(stale.json.data.bookingAvailability).toEqual(first.json.data.bookingAvailability);
  });

  it('일반 직원은 전체 차단 상태도 바꾸지 못한다', async () => {
    verifyUserTokenMock.mockResolvedValue({
      ok: true,
      email: 'staff@x.com',
      uid: 'staff-1',
      emailVerified: true,
    });
    const result = await callApi('POST', {
      action: 'set_all_enabled',
      expectedRevision: 0,
      requestId: 'staff-disable-all-001',
      enabled: false,
    });

    expect(result.res.statusCode).toBe(403);
    expect(store.get('mood_config/booking_availability')).toBeUndefined();
    expect(store.get('mood_booking_block_audit/staff-disable-all-001')).toBeUndefined();
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

    store.set('mood_config/booking_availability', {
      schemaVersion: 1,
      revision: 12,
      rules: [DAILY_RULE],
      exceptions: Array.from(
        { length: MOOD_BOOKING_AVAILABILITY_MAX_EXCEPTIONS },
        (_, index) => ({ ...RANGE_EXCEPTION, id: `existing-exception-${index}` }),
      ),
    });
    const exceptionOverLimit = await callApi('POST', {
      action: 'upsert_exception',
      expectedRevision: 12,
      requestId: 'exception-over-limit-001',
      exception: {
        id: 'one-too-many-exception',
        enabled: true,
        startDate: '2026-09-03',
        endDate: '2026-09-05',
        reason: '한도 초과',
      },
    });
    expect(exceptionOverLimit.res.statusCode).toBe(409);
    expect(exceptionOverLimit.json.error).toBe('BOOKING_BLOCK_EXCEPTION_LIMIT');
    expect(store.get('mood_booking_block_audit/exception-over-limit-001')).toBeUndefined();
    expect(store.get('mood_config/booking_availability')?.revision).toBe(12);
  });
});
