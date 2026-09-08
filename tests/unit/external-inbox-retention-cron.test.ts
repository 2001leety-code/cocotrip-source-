import { beforeEach, describe, expect, it, vi } from 'vitest';
const fake = vi.hoisted(() => ({ configs: vi.fn(), copies: vi.fn(), drafts: vi.fn(), init: vi.fn(), auth: vi.fn() }));
vi.mock('../../api/_shared/adminExternalInboxRead.js', () => ({ externalInboxConfigs: fake.configs }));
vi.mock('../../api/_shared/external-inbox-retention-sweep.js', () => ({ purgeExpiredExternalInboxCopies: fake.copies }));
vi.mock('../../api/_shared/external-inbox-draft-retention.js', () => ({ purgeExpiredExternalInboxDrafts: fake.drafts }));
vi.mock('../../api/_shared/firebase-admin.js', () => ({ initAdminDb: fake.init }));
vi.mock('../../api/_shared/cron-auth.js', () => ({ verifyCronRequest: fake.auth }));
import handler, { externalInboxRetentionSweepTask } from '../../api/_crons/external-inbox-retention-sweep.js';
const NOW = 1_800_000_000_000;
const env = { VERCEL_ENV: 'production' };
beforeEach(() => {
  vi.resetAllMocks();
  fake.configs.mockReturnValue({ email: { ready: false }, whatsapp: { ready: false } });
  fake.copies.mockResolvedValue({ ok: true, examined: 3, purged: 2, blocked: 0 });
  fake.drafts.mockResolvedValue({ ok: true, selected: 4, purged: 4, skipped: 0 });
  fake.auth.mockResolvedValue({ ok: false });
});
describe('external inbox retention schedule', () => {
  it.each([undefined, 'preview', 'development', 'production'])('does no DB or purge I/O when channels are off (%s)', async target => {
    expect(await externalInboxRetentionSweepTask({ env: { VERCEL_ENV: target }, now: () => NOW }))
      .toEqual({ ok: true, code: 'RETENTION_NOT_ACTIVE', writes: 0 });
    expect(fake.init).not.toHaveBeenCalled(); expect(fake.copies).not.toHaveBeenCalled(); expect(fake.drafts).not.toHaveBeenCalled();
  });
  it('does no work on Preview even with complete-looking channel configuration', async () => {
    fake.configs.mockReturnValue({ email: { ready: true } });
    expect((await externalInboxRetentionSweepTask({ env: { VERCEL_ENV: 'preview' }, now: () => NOW })).code).toBe('RETENTION_NOT_ACTIVE');
    expect(fake.init).not.toHaveBeenCalled();
  });
  it.each([0, -1, NaN, Infinity])('rejects invalid time %s before importing the database', async invalid => {
    expect((await externalInboxRetentionSweepTask({ env, now: () => invalid })).code).toBe('RETENTION_CLOCK_INVALID');
    expect(fake.init).not.toHaveBeenCalled();
  });
  it('runs only the scoped workers and persists a count-only result', async () => {
    const set = vi.fn(); const doc = vi.fn(() => ({ set })); const collection = vi.fn(() => ({ doc }));
    const db = { collection }; fake.configs.mockReturnValue({ email: { ready: true } });
    const result = await externalInboxRetentionSweepTask({ env, now: () => NOW, db });
    expect(result).toEqual({ ok: true, code: 'RETENTION_COMPLETED', copies: { examined: 3, purged: 2, blocked: 0 },
      drafts: { selected: 4, purged: 4, skipped: 0 } });
    expect(collection).toHaveBeenCalledWith('external_inbox_state'); expect(doc).toHaveBeenCalledWith('retention');
    expect(set).toHaveBeenCalledWith({ ...result, checkedAtMs: NOW });
    expect(fake.drafts).toHaveBeenCalledWith({ db, configs: { email: { ready: true } }, now: NOW, limit: 30 }); expect(fake.init).not.toHaveBeenCalled();
  });
  it('keeps partial failures visible and never returns raw provider/error fields', async () => {
    fake.configs.mockReturnValue({ email: { ready: true } });
    fake.copies.mockResolvedValue({ ok: false, examined: 3, purged: 1, blocked: 2, raw: 'PRIVATE_BODY' });
    const result = await externalInboxRetentionSweepTask({ env, now: () => NOW, db: { collection: () => ({ doc: () => ({ set: vi.fn() }) }) } });
    expect(result.ok).toBe(false); expect(result.code).toBe('RETENTION_REVIEW_REQUIRED');
    expect(JSON.stringify(result)).not.toContain('PRIVATE_BODY');
  });
  it('fails closed on database or clock exceptions', async () => {
    fake.configs.mockReturnValue({ email: { ready: true } }); fake.init.mockImplementation(() => { throw new Error('PRIVATE_KEY_URL'); });
    expect(await externalInboxRetentionSweepTask({ env, now: () => NOW })).toEqual({ ok: false, code: 'RETENTION_UNAVAILABLE' });
    expect(await externalInboxRetentionSweepTask({ env, now: () => { throw new Error('PRIVATE_CLOCK'); } }))
      .toEqual({ ok: false, code: 'RETENTION_UNAVAILABLE' });
  });
  it('requires cron authentication even before the off-state result', async () => {
    const json = vi.fn(); const status = vi.fn(() => ({ json })); const setHeader = vi.fn();
    await handler({ method: 'GET' }, { status, setHeader });
    expect(status).toHaveBeenCalledWith(401); expect(json).toHaveBeenCalledWith({ ok: false, code: 'AUTH_REQUIRED' });
    expect(setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store'); expect(fake.configs).not.toHaveBeenCalled();
  });
});
