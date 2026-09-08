import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import type { Language } from '@/i18n';
import { adminOperationalChecksCopy, isOperationalChecksData, type OperationalChecksData } from '@/lib/adminOperationalChecks';

interface Props { language: Language; previewMode?: boolean; previewData?: OperationalChecksData }
type Account = { uid: string; getIdToken: () => Promise<string> } | null;
const buttonClass = 'inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-xl border border-white/20 px-3 py-2 text-sm font-semibold hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-300 disabled:opacity-50';

function ChecksContent({ language, previewMode = false, previewData, account }: Props & { account: Account }) {
  const copy = adminOperationalChecksCopy[language] || adminOperationalChecksCopy.en;
  const id = useId();
  const [loaded, setLoaded] = useState<OperationalChecksData | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState(false);
  const mounted = useRef(true);
  const active = useRef<AbortController | null>(null);
  const lastAttempt = useRef(0);
  const invalidPreview = previewMode && !!previewData && !isOperationalChecksData(previewData);
  const data = previewMode ? invalidPreview ? null : previewData || null : loaded;
  const load = useCallback(async () => {
    if (previewMode || !account || active.current || Date.now() - lastAttempt.current < 1000) return;
    const controller = new AbortController(); active.current = controller; lastAttempt.current = Date.now();
    const timer = window.setTimeout(() => controller.abort(), 12_000);
    const aborted = new Promise<never>((_, reject) => controller.signal.addEventListener('abort', () => reject(new Error('ABORTED')), { once: true }));
    setLoading(true); setFailed(false);
    try {
      const token = await Promise.race([account.getIdToken(), aborted]);
      if (controller.signal.aborted) throw new Error('ABORTED');
      const response = await Promise.race([fetch('/api/admin-operational-checks', { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store', signal: controller.signal }), aborted]);
      const payload = await Promise.race([response.json(), aborted]);
      if (!response.ok || payload.ok !== true || !isOperationalChecksData(payload.data)) throw new Error('CHECKS_UNAVAILABLE');
      if (mounted.current && !controller.signal.aborted) setLoaded(payload.data);
    } catch { if (mounted.current) { setLoaded(null); setFailed(true); } }
    finally { window.clearTimeout(timer); if (active.current === controller) active.current = null; if (mounted.current) setLoading(false); }
  }, [account, previewMode]);
  useEffect(() => {
    mounted.current = true;
    const timer = window.setTimeout(() => void load(), 0);
    const interval = window.setInterval(() => { if (!document.hidden) void load(); }, 5 * 60_000);
    return () => { mounted.current = false; window.clearTimeout(timer); window.clearInterval(interval); active.current?.abort(); };
  }, [load]);

  const time = (ms: number | null) => ms ? new Date(ms).toLocaleString(copy.locale, { timeZone: 'Asia/Seoul', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) + ' KST' : copy.unknown;
  const attention = data?.checks.filter(check => check.runHealth !== 'ok' || check.freshness !== 'fresh').length;
  return <section aria-labelledby={`${id}-title`} className="min-w-0 rounded-2xl border border-white/10 bg-bg-card p-4 text-slate-100">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div><h2 id={`${id}-title`} className="text-base font-bold">{copy.title}</h2><p className="mt-1 text-sm text-slate-300">{copy.summary}</p></div>
      <button type="button" className={buttonClass} disabled={loading || previewMode || !account} onClick={() => void load()}>{copy.refresh}</button>
    </div>
    {previewMode && <p className="mt-3 text-xs leading-5 text-amber-100">{copy.synthetic}</p>}
    {loading && <p role="status" className="mt-3 text-sm">{copy.loading}</p>}
    {(failed || invalidPreview) && <p role="alert" className="mt-3 text-sm text-amber-100">{copy.unknown}</p>}
    <button type="button" className={`${buttonClass} mt-3 w-full justify-between gap-3`} aria-expanded={open} aria-controls={`${id}-checks`} onClick={() => setOpen(value => !value)}>
      <span>{open ? copy.collapse : copy.expand}</span><span className="text-xs">{typeof attention === 'number' ? `${copy.states.failed} ${attention}/6` : copy.unknown}</span>
    </button>
    {open && <div id={`${id}-checks`} className="mt-3 space-y-3">
      {!data && !loading && <p className="text-sm text-slate-300">{copy.unknown}</p>}
      {data && <dl className="grid min-w-0 gap-3 md:grid-cols-2">{data.checks.map(check => <div key={check.key} className="min-w-0 rounded-xl border border-white/10 p-3">
        <div className="flex flex-wrap items-center justify-between gap-2"><dt className="text-sm font-semibold">{copy.workflowLabels[check.workflow]}</dt><dd className={`text-xs ${check.runHealth === 'ok' && check.freshness === 'fresh' ? 'text-emerald-200' : 'text-amber-100'}`}>{copy.states[check.runHealth]}</dd></div>
        {check.freshness === 'stale' && <dd className="mt-2 text-xs leading-5 text-amber-100">{copy.stale}</dd>}
        {check.freshness === 'unknown' && <dd className="mt-2 text-xs text-amber-100">{copy.unknown}</dd>}
        <dd className="mt-2 text-xs leading-6 text-slate-300">{copy.latest}: {time(check.latestRun?.updatedAtMs || null)}</dd>
        <dd className="text-xs leading-6 text-slate-300">{copy.lastSuccess}: {check.lastSuccessfulRun ? time(check.lastSuccessfulRun.updatedAtMs) : copy.noSuccess}</dd>
        <dd className="text-xs leading-6 text-slate-300">{copy.updated}: {time(check.checkedAtMs)}</dd>
        {check.latestRun && <dd><a className={`${buttonClass} mt-2`} href={check.latestRun.url} target="_blank" rel="noopener noreferrer">{copy.openRun}</a></dd>}
      </div>)}</dl>}
      <p className="text-xs leading-5 text-slate-300">{copy.scope}</p><p className="text-xs leading-5 text-slate-300">{copy.costCaveat}</p>
      <details className="rounded-xl border border-white/10 p-3"><summary className="flex min-h-[44px] cursor-pointer items-center text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-300">{copy.notificationCaveat}</summary><p className="mt-2 text-xs leading-6 text-slate-300">{copy.ageCaveat}</p></details>
    </div>}
  </section>;
}
export function AdminOperationalChecks(props: Props) {
  const { user } = useAuth();
  return <ChecksContent key={props.previewMode ? 'preview' : user?.uid || 'signed-out'} {...props} account={user || null} />;
}
