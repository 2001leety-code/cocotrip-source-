/* eslint-disable @typescript-eslint/no-explicit-any -- query-chain test scaffold. */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  inquiryResponseSweepTask,
  strictAutomaticAckActivationAtMs,
} from '../../api/_crons/inquiry-response-sweep.js';

const ENV_KEYS = [
  'INQUIRY_RESPONSE_WORKER_ENABLED',
  'INQUIRY_RESPONSE_AUTO_ACK_ENABLED',
  'INQUIRY_RESPONSE_AUTO_ACK_NOT_BEFORE',
  'INQUIRY_RESPONSE_AUTO_ACK_MAX_AGE_MINUTES',
  'INQUIRY_RESPONSE_AUTO_ACK_DAILY_CAP',
];
const originalEnv = new Map<string, string | undefined>();

beforeEach(() => {
  for (const key of ENV_KEYS) {
    originalEnv.set(key, process.env[key]);
    delete process.env[key];
  }
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    const value = originalEnv.get(key);
    if (typeof value === 'string') process.env[key] = value;
    else delete process.env[key];
  }
  originalEnv.clear();
  vi.restoreAllMocks();
});

function emptyQuery() {
  const chain: Record<string, any> = {};
  chain.where = vi.fn(() => chain);
  chain.orderBy = vi.fn(() => chain);
  chain.limit = vi.fn(() => chain);
  chain.get = vi.fn(async () => ({ docs: [] }));
  return chain;
}

describe('inquiry response cron contract', () => {
  it('환경변수가 없어도 오래된 두 상태만 복구 조회하고 고객 발송은 하지 않는다', async () => {
    const query = emptyQuery();
    const collection = vi.fn(() => query);
    const send = vi.fn(() => { throw new Error('must not send'); });
    const result = await inquiryResponseSweepTask({ db: { collection }, send });
    expect(result).toEqual({
      ok: true,
      disabled: true,
      autoAckRequested: false,
      autoAckEnabled: false,
      autoAckRuntimeEnabled: false,
      autoAckConfigurationError: null,
      autoAckError: null,
      drafted: 0,
      autoAttempted: 0,
      autoSent: 0,
      autoDeferred: 0,
      autoSkipped: 0,
      needsOperator: 0,
      retried: 0,
      recovered: 0,
      autoRecovered: 0,
      failed: 0,
    });
    expect(collection).toHaveBeenCalledTimes(2);
    expect(query.where).toHaveBeenCalledWith('responseWorkflow.deliveryStatus', '==', 'sending');
    expect(query.where).toHaveBeenCalledWith('ackWorkflow.deliveryStatus', '==', 'sending');
    expect(send).not.toHaveBeenCalled();
  });

  it.each([
    ['2026-08-31', null],
    ['2026-08-31T06:00:00Z', null],
    ['2026-08-31T15:00:00.000+09:00', null],
    ['2026-08-31T06:00:00.000Z', Date.UTC(2026, 7, 31, 6, 0, 0, 0)],
  ])('UTC 밀리초 Z 형식만 활성시각으로 인정한다: %s', (value, expected) => {
    expect(strictAutomaticAckActivationAtMs(value)).toBe(expected);
  });

  it('숫자 뒤 문자가 붙은 시간창·일일상한은 추정하지 않고 전체 auto-ack을 끈다', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    process.env.INQUIRY_RESPONSE_WORKER_ENABLED = 'true';
    process.env.INQUIRY_RESPONSE_AUTO_ACK_ENABLED = 'true';
    process.env.INQUIRY_RESPONSE_AUTO_ACK_NOT_BEFORE = '2026-08-31T06:00:00.000Z';
    process.env.INQUIRY_RESPONSE_AUTO_ACK_MAX_AGE_MINUTES = '30분';
    process.env.INQUIRY_RESPONSE_AUTO_ACK_DAILY_CAP = '20oops';
    const query = emptyQuery();
    const db = { collection: vi.fn(() => query) };
    const send = vi.fn();
    const result = await inquiryResponseSweepTask({ db, send });
    expect(result.autoAckEnabled).toBe(false);
    expect(result.autoAckConfigurationError).toBe('AUTO_ACK_MAX_AGE_INVALID');
    expect(consoleError).toHaveBeenCalledWith('[inquiry-auto-ack]', 'AUTO_ACK_MAX_AGE_INVALID');
    expect(send).not.toHaveBeenCalled();
  });

  it('런타임 kill-switch 읽기 오류는 과거 true 캐시 없이 해당 sweep을 OFF로 만든다', async () => {
    process.env.INQUIRY_RESPONSE_WORKER_ENABLED = 'true';
    process.env.INQUIRY_RESPONSE_AUTO_ACK_ENABLED = 'true';
    process.env.INQUIRY_RESPONSE_AUTO_ACK_NOT_BEFORE = '2026-08-31T06:00:00.000Z';
    process.env.INQUIRY_RESPONSE_AUTO_ACK_MAX_AGE_MINUTES = '30';
    process.env.INQUIRY_RESPONSE_AUTO_ACK_DAILY_CAP = '20';
    const query = emptyQuery();
    const db = {
      collection: vi.fn((name: string) => name === 'admin_config'
        ? { doc: () => ({ get: async () => { throw new Error('Firestore read failed'); } }) }
        : query),
    };
    const send = vi.fn();
    const result = await inquiryResponseSweepTask({ db, send });
    expect(result).toMatchObject({ autoAckRequested: true, autoAckRuntimeEnabled: false, autoAckEnabled: false });
    expect(send).not.toHaveBeenCalled();
  });

  it('재시도 시각 숫자 필드는 Date가 아닌 같은 숫자형 밀리초로 조회한다', async () => {
    const now = Date.UTC(2026, 7, 31, 6, 10, 0, 0);
    process.env.INQUIRY_RESPONSE_WORKER_ENABLED = 'true';
    process.env.INQUIRY_RESPONSE_AUTO_ACK_ENABLED = 'true';
    process.env.INQUIRY_RESPONSE_AUTO_ACK_NOT_BEFORE = '2026-08-31T06:00:00.000Z';
    process.env.INQUIRY_RESPONSE_AUTO_ACK_MAX_AGE_MINUTES = '30';
    process.env.INQUIRY_RESPONSE_AUTO_ACK_DAILY_CAP = '20';
    const query = emptyQuery();
    const db = {
      collection: vi.fn((name: string) => name === 'admin_config'
        ? { doc: () => ({ get: async () => ({
          exists: true,
          data: () => ({ inquiry_auto_ack_enabled: true }),
        }) }) }
        : query),
    };

    const result = await inquiryResponseSweepTask({ db, now, send: vi.fn() });

    expect(result.autoAckEnabled).toBe(true);
    expect(query.where).toHaveBeenCalledWith('ackWorkflow.nextDeliveryAttemptAtMs', '<=', now);
    const retryDueCalls = query.where.mock.calls
      .filter((call: unknown[]) => String(call[0]).endsWith('nextDeliveryAttemptAtMs'));
    expect(retryDueCalls).toHaveLength(1);
    expect(retryDueCalls.every((call: unknown[]) => typeof call[2] === 'number')).toBe(true);
    expect(query.where).toHaveBeenCalledWith('autoAckCandidate', '==', true);
  });

  it('자동 접수 쿼리 장애를 격리하고 기존 최종답변 재시도 조회까지 계속 간다', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    process.env.INQUIRY_RESPONSE_WORKER_ENABLED = 'true';
    process.env.INQUIRY_RESPONSE_AUTO_ACK_ENABLED = 'true';
    process.env.INQUIRY_RESPONSE_AUTO_ACK_NOT_BEFORE = '2026-08-31T06:00:00.000Z';
    process.env.INQUIRY_RESPONSE_AUTO_ACK_MAX_AGE_MINUTES = '30';
    process.env.INQUIRY_RESPONSE_AUTO_ACK_DAILY_CAP = '20';
    let charterQueryCall = 0;
    let finalRetryQueryReached = false;
    const db = {
      collection: vi.fn((name: string) => {
        if (name === 'admin_config') {
          return { doc: () => ({ get: async () => ({
            exists: true,
            data: () => ({ inquiry_auto_ack_enabled: true }),
          }) }) };
        }
        charterQueryCall += 1;
        const query = emptyQuery();
        if (charterQueryCall === 4) {
          query.get = vi.fn(async () => { throw new Error('missing auto-ack index'); });
        } else if (charterQueryCall === 5) {
          query.get = vi.fn(async () => {
            finalRetryQueryReached = true;
            return { docs: [] };
          });
        }
        return query;
      }),
    };

    const result = await inquiryResponseSweepTask({ db, now: Date.UTC(2026, 7, 31, 6, 10), send: vi.fn() });

    expect(result).toMatchObject({
      ok: true,
      autoAckEnabled: true,
      autoAckError: 'AUTO_ACK_SWEEP_FAILED',
      failed: 1,
    });
    expect(consoleError).toHaveBeenCalledWith('[inquiry-auto-ack]', 'AUTO_ACK_SWEEP_FAILED');
    expect(finalRetryQueryReached).toBe(true);
  });

  it('자동 접수 sending 복구 조회가 실패해도 기존 최종답변 재시도까지 계속 간다', async () => {
    process.env.INQUIRY_RESPONSE_WORKER_ENABLED = 'true';
    let charterQueryCall = 0;
    let finalRetryQueryReached = false;
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const db = {
      collection: vi.fn(() => {
        charterQueryCall += 1;
        const query = emptyQuery();
        if (charterQueryCall === 2) {
          query.get = vi.fn(async () => { throw new Error('missing ack recovery index'); });
        } else if (charterQueryCall === 4) {
          query.get = vi.fn(async () => {
            finalRetryQueryReached = true;
            return { docs: [] };
          });
        }
        return query;
      }),
    };

    const result = await inquiryResponseSweepTask({ db, send: vi.fn() });

    expect(result).toMatchObject({
      ok: true,
      autoAckError: 'AUTO_ACK_RECOVERY_FAILED',
      failed: 1,
    });
    expect(consoleError).toHaveBeenCalledWith('[inquiry-auto-ack]', 'AUTO_ACK_RECOVERY_FAILED');
    expect(finalRetryQueryReached).toBe(true);
  });

  it('cron-runner 등록과 Vercel 5분 일정이 함께 존재한다', () => {
    const runner = readFileSync(resolve(process.cwd(), 'api/cron-runner.js'), 'utf8');
    const task = readFileSync(resolve(process.cwd(), 'api/_crons/inquiry-response-sweep.js'), 'utf8');
    const vercel = JSON.parse(readFileSync(resolve(process.cwd(), 'vercel.json'), 'utf8'));
    expect(runner).toMatch(/'inquiry-response-sweep'\s*:\s*inquiryResponseSweep/);
    expect(task).toMatch(/verifyCronRequest\(req\)/);
    expect(vercel.crons).toContainEqual({
      path: '/api/cron-runner?job=inquiry-response-sweep',
      schedule: '*/5 * * * *',
    });
  });
});
