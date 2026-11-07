/**
 * P292 (2026-05-29): plan-streaming-sweep cron 회귀 차단.
 *
 * 5/29 P287 cycle lesson: plan stuck (status='streaming' 1h30m+) = SAFETY-CRITICAL
 *   (사용자 결제 후 plan 안 받음). P292 cron 자동 정리 = error 처리 + 운영자 alert.
 *
 * 박제 의무 (5/29 P287 lesson):
 *   - silent throw 금지 (alert 의무)
 *   - retry trigger 없음 (P280 v1 무한 loop 회피 — 1회 처리 후 status='error' 종료)
 *   - threshold 30분 (Vercel maxDuration 800s 의 2.25배)
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { createFakeFirestore } from '../helpers/fake-firestore.js';

const mock = vi.hoisted(() => ({ init: vi.fn(), notify: vi.fn() }));
vi.mock('../../api/_shared/firebase-admin.js', () => ({ initAdminDb: mock.init }));
vi.mock('../../api/_shared/notify.js', () => ({ notify: mock.notify }));
vi.mock('../../api/_ai_core/paymentGate.js', () => ({ restoreAiPlanCoupon: vi.fn() }));
vi.mock('../../api/_shared/telegram-throttle.js', () => ({ throttledTelegramAlert: vi.fn() }));
vi.mock('../../api/_shared/sentry.js', () => ({ captureError: vi.fn() }));
const { default: sweep } = await import('../../api/_crons/plan-streaming-sweep.js');
const { closeStreamingPlanOnFailure } = await import('../../api/_ai_core/planCloseout.js');
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('P292 plan-streaming-sweep cron', () => {
  const cronPath = resolve(__dirname, '../../api/_crons/plan-streaming-sweep.js');
  const cronSrc = readFileSync(cronPath, 'utf8');

  const runnerPath = resolve(__dirname, '../../api/cron-runner.js');
  const runnerSrc = readFileSync(runnerPath, 'utf8');

  const vercelPath = resolve(__dirname, '../../vercel.json');
  const vercelJson = JSON.parse(readFileSync(vercelPath, 'utf8'));

  it('source — P292 cron handler 정의 (default export)', () => {
    expect(cronSrc).toContain('P292');
    expect(cronSrc).toMatch(/export default async function handler/);
  });

  it('source — STUCK_THRESHOLD_MS = 30분 (Vercel max 800s × 2.25 안전마진)', () => {
    expect(cronSrc).toMatch(/STUCK_THRESHOLD_MS\s*=\s*30\s*\*\s*60\s*\*\s*1000/);
  });

  it('source — plans where status=streaming + cutoff filter', () => {
    expect(cronSrc).toMatch(/\.collection\(\s*['"]plans['"]\s*\)/);
    expect(cronSrc).toMatch(/\.where\(\s*['"]status['"]\s*,\s*['"]==['"]\s*,\s*['"]streaming['"]\s*\)/);
    expect(cronSrc).toContain('_streaming_started_at');
    expect(cronSrc).toContain('createdAtMs');  // fallback
  });

  it('source — 처리 패턴 (planPersister.js:1001 동일)', () => {
    expect(cronSrc).toMatch(/status:\s*['"]error['"]/);
    expect(cronSrc).toMatch(/_streaming_in_progress:\s*false/);
    expect(cronSrc).toMatch(/_streaming_error:\s*['"]streaming_timeout_sweep_p292['"]/);
    expect(cronSrc).toContain('_swept_at');
  });

  it('source — Telegram alert (운영자 환불 안내 의무, SAFETY)', () => {
    expect(cronSrc).toMatch(/notify\(\s*['"]booking['"]/);
    expect(cronSrc).toContain('환불 안내');
  });

  it('source — retry trigger 없음 (P280 v1 무한 loop 회피 박제)', () => {
    // retry / re-dispatch / triggerAiPlanner / pending_ai_planner_retries 호출 X
    expect(cronSrc).not.toMatch(/triggerAiPlanner|pending_ai_planner_retries/);
    expect(cronSrc).not.toMatch(/retry.{0,30}attempts/i);
  });

  it('source — MAX_BATCH cap (sweep 폭주 방지)', () => {
    expect(cronSrc).toMatch(/MAX_BATCH\s*=\s*10/);
  });

  it('cron-runner.js — P292 job 등록', () => {
    expect(runnerSrc).toMatch(/import\s+planStreamingSweep\s+from\s+['"]\.\/_crons\/plan-streaming-sweep\.js['"]/);
    expect(runnerSrc).toMatch(/['"]plan-streaming-sweep['"]:\s*planStreamingSweep/);
  });

  it('vercel.json — P292 cron schedule */5 * * * * 등록', () => {
    const cron = vercelJson.crons.find((c: { path: string }) =>
      c.path.includes('plan-streaming-sweep'),
    );
    expect(cron).toBeDefined();
    expect(cron.schedule).toBe('*/5 * * * *');
  });

  // Auth — cron-runner.js 가 verifyCronRequest 통과 의무. 본 cron 자체는 dispatcher 뒤.
  it('cron-runner.js — auth gate (PR #419 패턴 유지)', () => {
    expect(runnerSrc).toMatch(/verifyCronRequest/);
  });
});


describe('streaming failure recovery (offline Firestore)', () => {
  const now = 1_800_000_000_000;
  const path = 'plans/failed-plan';
  const stale = { status: 'streaming', _streaming_in_progress: true, _streaming_started_at: now - 31 * 60_000 };
  afterEach(() => vi.restoreAllMocks());

  async function run(db: ReturnType<typeof createFakeFirestore>) {
    vi.spyOn(Date, 'now').mockReturnValue(now);
    mock.init.mockReturnValue(db);
    mock.notify.mockResolvedValue(undefined);
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
    await sweep({}, res);
    return res;
  }

  it('failed closeout leaves streaming, then a recovered database lets the sweep close it', async () => {
    const db = createFakeFirestore({ [path]: stale });
    vi.spyOn(db, 'runTransaction').mockRejectedValueOnce(new Error('14 UNAVAILABLE'));
    await expect(closeStreamingPlanOnFailure({ adminDb: db, planId: 'failed-plan', error: new Error('generation failed'), stage: 'finalGate' }))
      .resolves.toMatchObject({ closed: false, reason: 'error' });
    expect(db.__get(path)).toEqual(stale);
    const res = await run(db);
    expect(db.__get(path)).toMatchObject({ status: 'error', _streaming_in_progress: false });
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ ok: true, swept: 1 }));
  });

  it.each([
    ['ready', { status: 'ready', _streaming_in_progress: false }],
    ['new attempt', { _streaming_started_at: now - 60_000 }],
    ['already failed', { status: 'error', _streaming_error: 'handler_catch' }],
  ])('does not overwrite %s after the candidate query', async (_name, patch) => {
    const db = createFakeFirestore({ [path]: stale });
    const originalCollection = db.collection;
    db.collection = (name) => {
      const collection = originalCollection(name);
      return { ...collection, where: (...args) => {
        const query = collection.where(...args);
        return { ...query, limit: (n) => {
          const limited = query.limit(n);
          return { ...limited, get: async () => {
            const snapshot = await limited.get();
            db.__patch(path, patch);
            return snapshot;
          } };
        } };
      } };
    };
    const res = await run(db);
    expect(db.__get(path)).toEqual({ ...stale, ...patch });
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ ok: true, swept: 0 }));
  });

  it('leaves a recent streaming document alone until the threshold', async () => {
    const recent = { ...stale, _streaming_started_at: now - 29 * 60_000 };
    const db = createFakeFirestore({ [path]: recent });
    const res = await run(db);
    expect(db.__get(path)).toEqual(recent);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ swept: 0 }));
  });

  it('retains the legacy createdAtMs fallback for stale documents', async () => {
    const db = createFakeFirestore({ [path]: { status: 'streaming', createdAtMs: stale._streaming_started_at } });
    const res = await run(db);
    expect(db.__get(path).status).toBe('error');
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ swept: 1 }));
  });

  it('reports a failed sweep write and leaves the document for a later run', async () => {
    const db = createFakeFirestore({ [path]: stale });
    vi.spyOn(db, 'runTransaction').mockRejectedValueOnce(new Error('14 UNAVAILABLE'));
    const res = await run(db);
    expect(db.__get(path)).toEqual(stale);
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ ok: false, error: '14 UNAVAILABLE' });
  });

  it('does not recreate a document removed before the transaction read', async () => {
    const db = createFakeFirestore({ [path]: stale });
    const transaction = db.runTransaction;
    vi.spyOn(db, 'runTransaction').mockImplementation(async (...args) => {
      db.__delete(path);
      return transaction(...args);
    });
    const res = await run(db);
    expect(db.__get(path)).toBeUndefined();
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ swept: 0 }));
  });

  it('rechecks ready on a transaction conflict', async () => {
    const db = createFakeFirestore({ [path]: stale });
    db.__beforeCommit = ({ attempt }) => {
      if (attempt === 1) db.__patch(path, { status: 'ready', _streaming_in_progress: false });
    };
    const res = await run(db);
    expect(db.__get(path).status).toBe('ready');
    expect(db.__stats.retries).toBe(1);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ swept: 0 }));
  });
});
