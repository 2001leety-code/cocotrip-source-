import { describe, expect, it, vi } from 'vitest';

vi.mock('../../api/_shared/admin-auth.js', () => ({
  verifyAdminToken: vi.fn(async (req: { headers?: Record<string, string> }) =>
    req.headers?.authorization === 'Bearer good' ? { ok: true } : { ok: false, status: 401, error: 'required' }),
}));
vi.mock('../../api/_shared/operational-checks.js', () => ({
  getOperationalChecks: vi.fn(async () => ({ generatedAtMs: 1, checks: [], source: 'github-actions', readOnly: true })),
}));

import handler from '../../api/admin-operational-checks.js';
import { verifyAdminToken } from '../../api/_shared/admin-auth.js';

function res() {
  return { writeHead: vi.fn(), end: vi.fn() } as unknown as { writeHead: ReturnType<typeof vi.fn>; end: ReturnType<typeof vi.fn> };
}

describe('admin operational checks endpoint', () => {
  it('rejects non-GET and unauthenticated GET without running helper', async () => {
    const postRes = res();
    await handler({ method: 'POST', headers: {} } as never, postRes as never);
    expect(postRes.writeHead).toHaveBeenCalledWith(405, expect.objectContaining({ 'Cache-Control': 'no-store' }));
    const getRes = res();
    await handler({ method: 'GET', headers: {} } as never, getRes as never);
    expect(getRes.writeHead).toHaveBeenCalledWith(401, expect.objectContaining({ 'Cache-Control': 'no-store' }));
  });

  it('authenticates GET and returns no-store read-only data', async () => {
    const output = res();
    await handler({ method: 'GET', headers: { authorization: 'Bearer good', origin: 'https://cocotripkr.com' } } as never, output as never);
    expect(output.writeHead).toHaveBeenCalledWith(200, expect.objectContaining({ 'Cache-Control': 'no-store', 'Content-Type': 'application/json' }));
    expect(output.end).toHaveBeenCalledWith(expect.stringContaining('github-actions'));
  });

  it('keeps authentication setup errors and thrown auth failures generic', async () => {
    vi.mocked(verifyAdminToken).mockRejectedValueOnce(new Error('SYNTHETIC_PRIVATE_AUTH_ERROR'));
    const thrown = res();
    await handler({ method: 'GET', headers: { authorization: 'Bearer good' } } as never, thrown as never);
    expect(thrown.writeHead).toHaveBeenCalledWith(502, expect.any(Object));
    expect(thrown.end).toHaveBeenCalledWith(expect.not.stringContaining('SYNTHETIC_PRIVATE_AUTH_ERROR'));

    vi.mocked(verifyAdminToken).mockResolvedValueOnce({ ok: false, status: 500, error: 'SYNTHETIC_PRIVATE_ENV_ERROR' } as never);
    const unavailable = res();
    await handler({ method: 'GET', headers: { authorization: 'Bearer good' } } as never, unavailable as never);
    expect(unavailable.writeHead).toHaveBeenCalledWith(502, expect.any(Object));
    expect(unavailable.end).toHaveBeenCalledWith(expect.stringContaining('AUTH_UNAVAILABLE'));
    expect(unavailable.end).toHaveBeenCalledWith(expect.not.stringContaining('SYNTHETIC_PRIVATE_ENV_ERROR'));
  });
});
