import { companyGmailInboxSweepTask } from '../_shared/company-gmail-inbox.js';

export { companyGmailInboxSweepTask };

export default async function handler(req, res) {
  const { verifyCronRequest } = await import('../_shared/cron-auth.js');
  const authorized = await verifyCronRequest(req);
  if (!authorized.ok) return res.status(401).json({ ok: false, code: 'AUTH_REQUIRED' });
  const result = await companyGmailInboxSweepTask();
  res.setHeader('Cache-Control', 'no-store');
  return res.status(result.ok ? 200 : 503).json(result);
}
