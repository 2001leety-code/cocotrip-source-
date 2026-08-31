import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { inquiryResponseSweepTask } from '../../api/_crons/inquiry-response-sweep.js';

const originalWorkerFlag = process.env.INQUIRY_RESPONSE_WORKER_ENABLED;

beforeEach(() => {
  delete process.env.INQUIRY_RESPONSE_WORKER_ENABLED;
});

afterEach(() => {
  if (originalWorkerFlag === undefined) delete process.env.INQUIRY_RESPONSE_WORKER_ENABLED;
  else process.env.INQUIRY_RESPONSE_WORKER_ENABLED = originalWorkerFlag;
});

describe('inquiry response cron contract', () => {
  it('환경변수가 없어도 오래된 상태만 조회하고 고객 발송은 하지 않는다', async () => {
    const where = vi.fn(() => ({
      limit: () => ({ get: async () => ({ docs: [] }) }),
    }));
    const collection = vi.fn(() => ({ where }));
    const send = vi.fn(() => { throw new Error('must not send'); });
    const result = await inquiryResponseSweepTask({
      db: { collection },
      send,
    });
    expect(result).toEqual({
      ok: true, disabled: true, drafted: 0, retried: 0, recovered: 0, failed: 0,
    });
    expect(collection).toHaveBeenCalledOnce();
    expect(where).toHaveBeenCalledWith('responseWorkflow.deliveryStatus', '==', 'sending');
    expect(send).not.toHaveBeenCalled();
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
