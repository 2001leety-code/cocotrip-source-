import { companyGmailInboxSweepTask, secondaryGmailInboxSweepTask } from '../_shared/company-gmail-inbox.js';

export { companyGmailInboxSweepTask, secondaryGmailInboxSweepTask };

/** Both fixed inboxes share one cron window; they are bounded independently and never run serially. */
export async function companyGmailInboxSweepsTask(options = {}) {
  const [primary, secondary] = await Promise.all([companyGmailInboxSweepTask(options), secondaryGmailInboxSweepTask(options)]);
  return { ok: primary.ok && secondary.ok, primary, secondary };
}

export default async function handler(req, res) {
  const { verifyCronRequest } = await import('../_shared/cron-auth.js');
  const authorized = await verifyCronRequest(req);
  if (!authorized.ok) return res.status(401).json({ ok: false, code: 'AUTH_REQUIRED' });
  const result = await companyGmailInboxSweepsTask();
  res.setHeader('Cache-Control', 'no-store');
  return res.status(result.ok ? 200 : 503).json(result);
}
