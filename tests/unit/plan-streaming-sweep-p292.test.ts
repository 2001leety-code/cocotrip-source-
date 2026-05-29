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
import { describe, it, expect } from 'vitest';
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
