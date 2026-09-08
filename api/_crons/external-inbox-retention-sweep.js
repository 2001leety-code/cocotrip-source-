import { externalInboxConfigs } from '../_shared/adminExternalInboxRead.js';
import { purgeExpiredExternalInboxCopies } from '../_shared/external-inbox-retention-sweep.js';
import { purgeExpiredExternalInboxDrafts } from '../_shared/external-inbox-draft-retention.js';

/** OFF channels/Preview never bootstrap the DB. Authentication is mandatory even when OFF. */
export async function externalInboxRetentionSweepTask({ env = process.env, now = Date.now, db = null } = {}) {
  try {
    const nowMs = now();
    if (!Number.isSafeInteger(nowMs) || nowMs <= 0) return { ok: false, code: 'RETENTION_CLOCK_INVALID' };
    const configs = externalInboxConfigs(env, nowMs);
    if (env.VERCEL_ENV !== 'production' || !Object.values(configs).some(config => config.ready)) {
      return { ok: true, code: 'RETENTION_NOT_ACTIVE', writes: 0 };
    }
    const database = db || (await import('../_shared/firebase-admin.js')).initAdminDb('external-inbox-retention');
    if (!database) return { ok: false, code: 'RETENTION_DB_UNAVAILABLE' };
    const copies = await purgeExpiredExternalInboxCopies({ db: database, configs, now });
    const drafts = await purgeExpiredExternalInboxDrafts({ db: database, configs, now: now(), limit: 30 });
    const result = { ok: copies.ok && drafts.ok, code: copies.ok && drafts.ok ? 'RETENTION_COMPLETED' : 'RETENTION_REVIEW_REQUIRED',
      copies: { examined: copies.examined, purged: copies.purged, blocked: copies.blocked },
      drafts: { selected: drafts.selected, purged: drafts.purged, skipped: drafts.skipped } };
    await database.collection('external_inbox_state').doc('retention').set({ ...result, checkedAtMs: now() });
    return result;
  } catch { return { ok: false, code: 'RETENTION_UNAVAILABLE' }; }
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const { verifyCronRequest } = await import('../_shared/cron-auth.js');
  const authorized = await verifyCronRequest(req);
  if (!authorized.ok) return res.status(401).json({ ok: false, code: 'AUTH_REQUIRED' });
  const result = await externalInboxRetentionSweepTask();
  return res.status(result.ok ? 200 : 503).json(result);
}
