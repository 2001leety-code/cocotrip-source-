import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import type { Language } from '@/i18n';
import { adminExternalInboxCopy, isExternalInboxDetail, isExternalInboxOverview, type ExternalInboxMessage, type ExternalInboxOverview } from '@/lib/adminExternalInboxCopy';

interface Props { language: Language; previewMode?: boolean; previewData?: ExternalInboxOverview; refreshKey?: number | null }
type Account = { uid: string; getIdToken: () => Promise<string> } | null;
const buttonClass = 'inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-xl border border-white/20 px-3 py-2 text-sm font-semibold text-slate-100 hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-300 disabled:opacity-50';
const EMPTY_PREVIEW: ExternalInboxOverview = { generatedAtMs: 0, channels: [
  { channel: 'email', status: 'disabled', lastSuccessAtMs: null, lastReceivedAtMs: null },
  { channel: 'whatsapp', status: 'disabled', lastSuccessAtMs: null, lastReceivedAtMs: null },
], messages: [], possiblyTruncated: false, listStatus: 'not_connected' };

async function accountToken(account: NonNullable<Account>, signal: AbortSignal) {
  if (signal.aborted) throw new Error('ABORTED');
  let onAbort = () => {};
  try {
    return await Promise.race([account.getIdToken(), new Promise<never>((_, reject) => {
      onAbort = () => reject(new Error('ABORTED'));
      signal.addEventListener('abort', onAbort, { once: true });
    })]);
  } finally { signal.removeEventListener('abort', onAbort); }
}

function InboxContent({ language, previewMode = false, previewData, refreshKey, account }: Props & { account: Account }) {
  const copy = adminExternalInboxCopy[language] || adminExternalInboxCopy.en;
  const titleId = useId();
  const [loaded, setLoaded] = useState<ExternalInboxOverview | null>(null);
  const data = previewMode ? previewData || EMPTY_PREVIEW : loaded;
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<(ExternalInboxMessage & { text: string }) | null>(null);
  const [detailFailed, setDetailFailed] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [page, setPage] = useState(0);
  const visiblePage = Math.min(page, Math.max(0, Math.ceil((data?.messages.length || 0) / 5) - 1));
  const visibleMessages = data?.messages.slice(visiblePage * 5, visiblePage * 5 + 5) || [];
  const overviewRequest = useRef<AbortController | null>(null);
  const detailRequest = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  const lastStart = useRef(0);

  const load = useCallback(async () => {
    if (previewMode || !account || overviewRequest.current) return;
    const controller = new AbortController();
    overviewRequest.current = controller;
    lastStart.current = Date.now();
    setLoading(true);
    setFailed(false);
    const timeout = window.setTimeout(() => controller.abort(), 10_000);
    try {
      const token = await accountToken(account, controller.signal);
      if (controller.signal.aborted) throw new Error('ABORTED');
      const response = await fetch('/api/admin-external-inbox', { headers: { Authorization: `Bearer ${token}` }, signal: controller.signal, cache: 'no-store' });
      const payload = await response.json();
      if (!response.ok || !payload.ok || !isExternalInboxOverview(payload.data)) throw new Error('INBOX_UNAVAILABLE');
      if (mounted.current && !controller.signal.aborted) setLoaded(payload.data);
    } catch {
      if (mounted.current) { setFailed(true); setLoaded(null); setSelected(null); setDetail(null); detailRequest.current?.abort(); }
    } finally {
      window.clearTimeout(timeout);
      if (overviewRequest.current === controller) overviewRequest.current = null;
      if (mounted.current) setLoading(false);
    }
  }, [account, previewMode]);

  useEffect(() => {
    mounted.current = true;
    const timer = window.setTimeout(() => { void load(); }, 0);
    const foreground = () => { if (!document.hidden && Date.now() - lastStart.current >= 1000) void load(); };
    const interval = window.setInterval(() => { if (!document.hidden) void load(); }, 60_000);
    window.addEventListener('focus', foreground);
    document.addEventListener('visibilitychange', foreground);
    return () => {
      mounted.current = false;
      window.clearTimeout(timer); window.clearInterval(interval);
      window.removeEventListener('focus', foreground); document.removeEventListener('visibilitychange', foreground);
      overviewRequest.current?.abort(); detailRequest.current?.abort();
    };
  }, [load]);

  useEffect(() => {
    const timer = window.setTimeout(() => { if (Date.now() - lastStart.current >= 1000) void load(); }, 0);
    return () => window.clearTimeout(timer);
  }, [load, refreshKey]);

  async function show(message: ExternalInboxMessage) {
    detailRequest.current?.abort();
    setSelected(message.id); setDetail(null); setDetailFailed(false); setDetailLoading(true);
    if (previewMode) { setDetail({ ...message, text: '[Synthetic preview message]' }); setDetailLoading(false); return; }
    if (!account) { setDetailLoading(false); setDetailFailed(true); return; }
    const controller = new AbortController();
    detailRequest.current = controller;
    const timeout = window.setTimeout(() => controller.abort(), 10_000);
    try {
      const token = await accountToken(account, controller.signal);
      if (controller.signal.aborted) throw new Error('ABORTED');
      const response = await fetch(`/api/admin-external-inbox?id=${encodeURIComponent(message.id)}`, { headers: { Authorization: `Bearer ${token}` }, signal: controller.signal, cache: 'no-store' });
      const payload = await response.json();
      if (!response.ok || !payload.ok || !isExternalInboxDetail(payload.data) || payload.data.id !== message.id) throw new Error('MESSAGE_NOT_AVAILABLE');
      if (mounted.current && !controller.signal.aborted && detailRequest.current === controller) setDetail(payload.data);
    } catch { if (mounted.current && detailRequest.current === controller) setDetailFailed(true); }
    finally { window.clearTimeout(timeout); if (mounted.current && detailRequest.current === controller) setDetailLoading(false); }
  }

  function close() { detailRequest.current?.abort(); detailRequest.current = null; setSelected(null); setDetail(null); setDetailFailed(false); setDetailLoading(false); }
  function time(ms: number | null) { return ms && Number.isFinite(ms) ? new Date(ms).toLocaleString(copy.locale, { timeZone: 'Asia/Seoul', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) + ' KST' : copy.noTime; }

  return <section aria-labelledby={titleId} className="min-w-0 rounded-2xl border border-white/10 bg-bg-card p-4 text-slate-100">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="min-w-0"><h2 id={titleId} className="text-base font-bold">{copy.title}</h2><p className="mt-1 text-sm leading-6 text-slate-300">{copy.subtitle}</p></div>
      <button type="button" className={buttonClass} disabled={loading || previewMode || !account} onClick={() => { void load(); }}>{copy.refresh}</button>
    </div>
    {loading && <p role="status" className="mt-3 text-sm text-slate-300">{copy.loading}</p>}
    {(failed || data?.listStatus === 'unknown') && <p role="alert" className="mt-3 rounded-xl border border-amber-300/30 p-3 text-sm leading-6 text-amber-100">{copy.failed}</p>}
    {data && <>
      <dl className="mt-4 grid gap-3 sm:grid-cols-2">{data.channels.map(channel => <div key={channel.channel} className="min-w-0 rounded-xl border border-white/10 p-3">
        <dt className="text-sm font-bold">{copy[channel.channel]}</dt>
        <dd className="mt-1 text-sm text-violet-200">{copy.statuses[channel.status] || copy.statuses.unknown}</dd>
        <dd className="mt-2 text-xs leading-5 text-slate-300">{channel.channel === 'email' ? copy.lastSync : copy.lastReceived}: {time(channel.channel === 'email' ? channel.lastSuccessAtMs : channel.lastReceivedAtMs)}</dd>
      </div>)}</dl>
      {data.listStatus !== 'unknown' && data.messages.length === 0 && <p className="mt-4 text-sm leading-6 text-slate-300">{data.listStatus === 'not_connected' ? copy.disconnected : copy.empty}</p>}
      {data.messages.length > 0 && <ul className="mt-4 space-y-3">{visibleMessages.map(message => <li key={message.id} className="min-w-0 rounded-xl border border-white/10 p-3">
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-300"><span>{copy[message.channel]}</span><time dateTime={new Date(message.sourceAtMs).toISOString()}>{time(message.sourceAtMs)}</time></div>
        <p className="mt-2 break-words text-sm font-semibold [overflow-wrap:anywhere]">{message.channel === 'email' ? message.subject || copy.noSubject : message.sender || copy.noSender}</p>
        {message.channel === 'email' && <p className="mt-1 break-words text-xs leading-5 text-slate-300 [overflow-wrap:anywhere]">{message.sender || copy.noSender}</p>}
        <button type="button" className={`${buttonClass} mt-3`} aria-expanded={selected === message.id} aria-controls={`${titleId}-${message.id}`} onClick={() => { if (selected === message.id) close(); else void show(message); }}>{selected === message.id ? copy.close : copy.show}</button>
        {selected === message.id && <div id={`${titleId}-${message.id}`} className="mt-3 border-t border-white/10 pt-3">
          {detailLoading && <p role="status" className="text-sm text-slate-300">{copy.loading}</p>}
          {detailFailed && <p role="alert" className="text-sm leading-6 text-amber-100">{copy.detailFailed}</p>}
          {detail && <><p className="whitespace-pre-wrap break-words text-sm leading-7 text-slate-100 [overflow-wrap:anywhere]">{detail.text || copy.emptyText}</p>{(detail.truncated || detail.channel === 'email') && <p className="mt-3 text-xs leading-5 text-slate-300">{copy.clipped}</p>}</>}
        </div>}
      </li>)}</ul>}
      {data.messages.length > 5 && <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-slate-300" role="status">{copy.range(visiblePage * 5 + 1, Math.min(visiblePage * 5 + 5, data.messages.length), data.messages.length)}</p>
        <div className="flex flex-wrap gap-2">
          <button type="button" className={buttonClass} disabled={visiblePage === 0} onClick={() => { close(); setPage(visiblePage - 1); }}>{copy.previous}</button>
          <button type="button" className={buttonClass} disabled={(visiblePage + 1) * 5 >= data.messages.length} onClick={() => { close(); setPage(visiblePage + 1); }}>{copy.next}</button>
        </div>
      </div>}
      <p className="mt-4 text-xs leading-5 text-slate-300">{copy.limited}</p>
    </>}
    <p className="mt-3 text-xs leading-5 text-slate-300">{copy.scope}</p>
  </section>;
}

/** Account changes remount the entire state so prior-company content cannot flash after sign-out. */
export function AdminExternalInbox(props: Props) {
  const { user } = useAuth();
  return <InboxContent key={props.previewMode ? 'preview' : user?.uid || 'signed-out'} {...props} account={user || null} />;
}
