/**
 * 2026-11-22 운영자 결정: ADMIN-BYPASS- 를 관리자 아닌 계정이 보내면 거절 응답 글에 관리자 허용 이메일 목록을 넣지 않는다.
 * 판정(403 FORBIDDEN / 관리자 통과)은 그대로.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { enforcePaymentAndRevision } from '../../api/_ai_core/paymentGate.js';

const ORDER = 'ADMIN-BYPASS-20261122-test';
type Gate = { rejection?: { statusCode: number; code: string; details?: string }; isAdminBypass?: boolean };

describe('paymentGate — ADMIN-BYPASS 거절 응답', () => {
  afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

  it('관리자 아닌 계정: 403 FORBIDDEN 그대로, 응답·기록에 허용 목록 이메일 없음', async () => {
    vi.stubEnv('ADMIN_BYPASS_EMAILS', 'ops-a@example.test,ops-b@example.test');
    vi.stubEnv('ADMIN_EMAIL', 'ops-c@example.test');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const r = await enforcePaymentAndRevision({ paypalOrderId: ORDER }, null, 'guest@example.test') as Gate;
    expect(r.rejection).toMatchObject({ statusCode: 403, code: 'FORBIDDEN' });
    const sent = JSON.stringify(r);
    for (const admin of ['ops-a@example.test', 'ops-b@example.test', 'ops-c@example.test', '2001leety@gmail.com']) {
      expect(sent).not.toContain(admin);
      expect(JSON.stringify(warn.mock.calls)).not.toContain(admin);
    }
    expect(sent).not.toContain('Allowed:');
  });

  it('관리자 계정: 그대로 통과(isAdminBypass)', async () => {
    vi.stubEnv('ADMIN_BYPASS_EMAILS', 'ops-a@example.test,ops-b@example.test');
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const r = await enforcePaymentAndRevision({ paypalOrderId: ORDER }, null, 'ops-b@example.test') as Gate;
    expect(r.rejection).toBeUndefined();
    expect(r.isAdminBypass).toBe(true);
  });

  it('로그인 이메일 없음: 403 그대로', async () => {
    const r = await enforcePaymentAndRevision({ paypalOrderId: ORDER }, null, '') as Gate;
    expect(r.rejection).toMatchObject({ statusCode: 403, code: 'FORBIDDEN' });
  });
});
