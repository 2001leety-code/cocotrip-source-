/**
 * 2026-10-24 (O6-r2 P3) — 비교 하네스 무료 채점(--judge-plan/--dump-prompts)은 검증기(repairAndParseJSON 등)를 그대로
 * 돌리므로, 운영 키가 있는 셸에서 손상 JSON 을 채점하면 외부 알림이 나갈 수 있었다. 하네스가 LLM_COMPARE_OFFLINE=1 을
 * api 모듈 import 전에 세우고, throttledTelegramAlert 는 그 플래그면 로그만 남긴다.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const h = vi.hoisted(() => ({ notify: vi.fn(async () => ({ ok: true })), initAdminDb: vi.fn(() => null) }));
vi.mock('../../api/_shared/notify.js', () => ({ notify: h.notify }));
vi.mock('../../api/_shared/firebase-admin.js', () => ({ initAdminDb: h.initAdminDb }));

import { throttledTelegramAlert } from '../../api/_shared/telegram-throttle.js';
import { repairAndParseJSON } from '../../api/_ai_core/responseValidator.js';

afterEach(() => { vi.unstubAllEnvs(); h.notify.mockClear(); h.initAdminDb.mockClear(); });

describe('LLM_COMPARE_OFFLINE — alerts are logged, never sent', () => {
  it('throttledTelegramAlert returns suppressed without touching notify or Firestore', async () => {
    vi.stubEnv('LLM_COMPARE_OFFLINE', '1');
    const out = await throttledTelegramAlert({ key: 'repair-dropped-guides:x', message: 'm', channel: 'admin', severity: 'high' });
    expect(out).toEqual({ ok: true, alerted: false, suppressed: true });
    expect(h.notify).not.toHaveBeenCalled();
    expect(h.initAdminDb).not.toHaveBeenCalled();
  });

  it('a damaged plan JSON through repairAndParseJSON reaches the alert path, which only logs offline', async () => {
    vi.stubEnv('LLM_COMPARE_OFFLINE', '1');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    // 잘린 JSON → departure_guide 소실 → repair-dropped-guides 알림 경로
    repairAndParseJSON('{"days":[{"day":1,"stops":[{"name":"A","category":"culture","start_time":"10:00"}]}],"arrival_guide":{"airport":"ICN"');
    await new Promise((r) => setTimeout(r, 0));
    const suppressed = warn.mock.calls.map((c) => String(c[0])).filter((l) => l.includes('LLM_COMPARE_OFFLINE — alert suppressed'));
    warn.mockRestore();
    expect(suppressed).toEqual([expect.stringContaining('repair-dropped-guides:departure_guide')]);
    expect(h.notify).not.toHaveBeenCalled();
  });

  it('the harness sets the flag for free modes before any api/ import', () => {
    const src = readFileSync(resolve(process.cwd(), 'scripts/llm-compare-providers.mjs'), 'utf8');
    const flagAt = src.indexOf("if (FREE_MODE) process.env.LLM_COMPARE_OFFLINE = '1';");
    expect(flagAt).toBeGreaterThan(-1);
    expect(flagAt).toBeLessThan(src.indexOf("await import('../api/"));
  });
});
