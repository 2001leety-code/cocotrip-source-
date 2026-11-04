import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const effects = vi.hoisted(() => ({ read: vi.fn(() => { throw new Error('Unexpected job execution'); }), send: vi.fn(), admin: vi.fn(async () => ({ ok: false })) }));
vi.mock('../../api/_google-sheets.js', () => ({ getYesterdayBookings: effects.read, getTodayTours: effects.read, getWeekSummary: effects.read }));
vi.mock('../../api/_telegram.js', () => ({ sendLongMessage: effects.send, sendErrorAlert: effects.send }));
vi.mock('../../api/_shared/telegram-throttle.js', () => ({ throttledTelegramAlert: effects.send }));
vi.mock('../../api/_shared/admin-auth.js', () => ({ verifyAdminToken: effects.admin }));
import handler from '../../api/_crons/daily-report.js';
beforeEach(() => {
  vi.clearAllMocks(); effects.admin.mockResolvedValue({ ok: false });
  vi.stubEnv('VERCEL_ENV', 'preview'); vi.stubEnv('PREVIEW_OPERATOR_NOTIFICATIONS_SUPPRESS', 'true');
  vi.stubEnv('CRON_SECRET', 'fixture-cron-secret');
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Unexpected network'); }));
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
async function invoke(headers = {}, query = {}) {
  const output: { code: number; body: Record<string, unknown> } = { code: 0, body: {} };
  const res = { status(code) { output.code = code; return this; }, json(body) { output.body = body; return this; }, end() { return this; } };
  await handler({ method: 'GET', headers, query }, res);
  expect(effects.read).not.toHaveBeenCalled(); expect(effects.send).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
  return output;
}
it.each([{}, { 'x-vercel-cron': 'true' }, { 'x-cron-token': 'fixture-cron-secret' }, { authorization: 'Bearer wrong-fixture-token' }])('rejects unauthenticated or spoofed requests before the job: %j', async headers => {
  const result = await invoke(headers, { token: 'fixture-cron-secret' });
  expect(result.code).toBe(401); expect(result.body).toMatchObject({ ok: false, code: 'AUTH_REQUIRED' });
});
it('accepts the scheduled Bearer then returns an explicit non-delivery receipt', async () => {
  const result = await invoke({ authorization: 'Bearer fixture-cron-secret' });
  expect(result.code).toBe(200); expect(result.body.body).toMatchObject({ ok: false, status: 'suppressed', delivery: 'not_attempted' });
});
it('preserves an authenticated administrator caller', async () => {
  effects.admin.mockResolvedValueOnce({ ok: true });
  const result = await invoke({ authorization: 'Bearer fixture-admin-id-token' });
  expect(effects.admin).toHaveBeenCalledTimes(1); expect(result.code).toBe(200);
  expect(result.body.body).toMatchObject({ status: 'suppressed' });
});
