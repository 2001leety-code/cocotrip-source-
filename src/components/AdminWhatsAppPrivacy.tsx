import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import type { Language } from '@/i18n';
import { isWhatsAppPrivacyOverview, whatsappSupportCopy, type WhatsAppPrivacyAction, type WhatsAppPrivacyOverview } from '@/lib/whatsappSupportCopy';

interface Props { language: Language; previewMode?: boolean; previewData?: WhatsAppPrivacyOverview }
type Account = { uid: string; getIdToken: () => Promise<string> } | null;
const buttonClass = 'inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-xl border border-white/20 px-3 py-2 text-sm font-semibold text-slate-100 hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-300 disabled:opacity-50';

async function abortable<T>(signal: AbortSignal, work: () => Promise<T>): Promise<T> {
  if (signal.aborted) throw new Error('ABORTED');
  let abort = () => {};
  try {
    return await Promise.race([work(), new Promise<never>((_, reject) => {
      abort = () => reject(new Error('ABORTED'));
      signal.addEventListener('abort', abort, { once: true });
    })]);
  } finally { signal.removeEventListener('abort', abort); }
}

function PrivacyContent({ language, previewMode = false, previewData, account }: Props & { account: Account }) {
  const copy = whatsappSupportCopy[language].admin;
  const titleId = useId();
  const senderId = useId();
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<WhatsAppPrivacyOverview | null>(null);
  const [busy, setBusy] = useState<'load' | 'change' | null>(null);
  const [notice, setNotice] = useState<'failed' | 'unconfirmed' | 'saved' | 'invalidSender' | null>(null);
  const [sender, setSender] = useState('');
  const [page, setPage] = useState(0);
  const request = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  const noticeRef = useRef<HTMLParagraphElement | null>(null);
  const restoreFocus = useRef<{ trigger: HTMLElement | null } | null>(null);
  const current = previewMode ? isWhatsAppPrivacyOverview(previewData) ? previewData : null : data;
  const canChange = !previewMode && Boolean(account && current?.ready) && !busy;
  const visiblePage = Math.min(page, Math.max(0, Math.ceil((current?.sessions.length || 0) / 5) - 1));
  const sessions = current?.sessions.slice(visiblePage * 5, visiblePage * 5 + 5) || [];

  const serverRequest = useCallback(async (signal: AbortSignal, action?: WhatsAppPrivacyAction, target?: string) => {
    if (previewMode || !account) throw new Error('UNAVAILABLE');
    return abortable(signal, async () => {
      const token = await account.getIdToken();
      if (signal.aborted) throw new Error('ABORTED');
      const response = await fetch('/api/admin-whatsapp-privacy', {
        method: action ? 'POST' : 'GET', cache: 'no-store', signal,
        headers: { Authorization: `Bearer ${token}`, ...(action ? { 'Content-Type': 'application/json' } : {}) },
        ...(action ? { body: JSON.stringify({ action, sender: target }) } : {}),
      });
      const payload: unknown = await response.json();
      if (signal.aborted || !response.ok || !payload || typeof payload !== 'object' || (payload as { ok?: unknown }).ok !== true) throw new Error('UNAVAILABLE');
      return payload as { ok: true; data?: unknown };
    });
  }, [account, previewMode]);

  const read = useCallback(async (signal: AbortSignal) => {
    const payload = await serverRequest(signal);
    if (!isWhatsAppPrivacyOverview(payload.data)) throw new Error('INVALID_STATE');
    return payload.data;
  }, [serverRequest]);

  const load = useCallback(async () => {
    if (previewMode || !account || request.current) return;
    const controller = new AbortController(); request.current = controller;
    const timer = window.setTimeout(() => controller.abort(), 10_000);
    setBusy('load'); setNotice(null);
    try {
      const loaded = await read(controller.signal);
      if (mounted.current && request.current === controller && !controller.signal.aborted) setData(loaded);
    } catch {
      if (mounted.current && request.current === controller) { setData(null); setNotice('failed'); }
    } finally {
      window.clearTimeout(timer);
      if (mounted.current && request.current === controller) { request.current = null; setBusy(null); }
    }
  }, [account, previewMode, read]);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; request.current?.abort(); request.current = null; };
  }, []);
  useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timer);
  }, [load, open]);
  useEffect(() => {
    if (busy || !notice || !restoreFocus.current) return;
    const { trigger } = restoreFocus.current; restoreFocus.current = null;
    if (trigger?.isConnected && !trigger.hasAttribute('disabled')) trigger.focus();
    else noticeRef.current?.focus();
  }, [busy, notice]);

  async function change(action: WhatsAppPrivacyAction, target: string, trigger: HTMLElement | null) {
    if (!canChange || request.current) return;
    if (!/^[1-9]\d{0,19}$/.test(target)) { setNotice('invalidSender'); return; }
    const controller = new AbortController(); request.current = controller;
    const timer = window.setTimeout(() => controller.abort(), 10_000);
    setBusy('change'); setNotice(null);
    try {
      await serverRequest(controller.signal, action, target);
      const refreshed = await read(controller.signal);
      const session = refreshed.sessions.find(item => item.sender === target);
      const confirmed = refreshed.ready && (action === 'block' ? session?.status === 'blocked'
        : action === 'close' ? session?.status === 'closed' || session?.status === 'blocked'
          : session?.status === 'closed');
      if (!mounted.current || request.current !== controller || controller.signal.aborted) return;
      setData(refreshed);
      if (!confirmed) { setNotice('unconfirmed'); return; }
      setNotice('saved');
      if (action === 'block' && target === sender) setSender('');
    } catch {
      if (mounted.current && request.current === controller) { setData(null); setNotice('unconfirmed'); }
    } finally {
      window.clearTimeout(timer);
      if (mounted.current && request.current === controller) {
        request.current = null; restoreFocus.current = { trigger }; setBusy(null);
      }
    }
  }

  function time(ms: number | null) {
    return ms ? new Date(ms).toLocaleString(copy.locale, { timeZone: 'Asia/Seoul', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) + ' KST' : copy.noTime;
  }

  return <details className="mt-4 min-w-0 rounded-xl border border-white/15 bg-bg-card text-slate-100" onToggle={event => {
    const expanded = event.currentTarget.open; setOpen(expanded);
    if (!expanded) { request.current?.abort(); request.current = null; restoreFocus.current = null; setBusy(null); setData(null); setNotice(null); }
  }}>
    <summary id={titleId} className="min-h-[44px] cursor-pointer rounded-xl px-4 py-3 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-300">{copy.title}</summary>
    {open && <div role="region" aria-labelledby={titleId} className="border-t border-white/10 p-4">
      <p className="text-sm leading-6 text-slate-300">{copy.intro}</p>
      {previewMode && <p className="mt-3 text-sm leading-6 text-violet-200">{copy.preview}</p>}
      {!previewMode && !account && <p className="mt-3 text-sm leading-6 text-slate-300">{copy.signedOut}</p>}
      <button type="button" className={`${buttonClass} mt-3`} disabled={Boolean(busy) || previewMode || !account} onClick={() => { void load(); }}>{copy.refresh}</button>
      {busy && <p role="status" className="mt-3 text-sm text-slate-300">{busy === 'load' ? copy.loading : copy.changing}</p>}
      {notice && <p ref={noticeRef} tabIndex={-1} role={notice === 'saved' ? 'status' : 'alert'} className="mt-3 rounded-lg border border-white/20 p-3 text-sm leading-6 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-300">{copy[notice]}</p>}
      {current && <>
        <p className="mt-4 flex flex-wrap gap-x-3 gap-y-1 text-sm font-semibold"><span>{current.enabled ? copy.receivingOn : copy.receivingOff}</span><span className="text-violet-200">{current.ready ? copy.ready : copy.notReady}</span></p>
        {!current.enabled && current.ready && <p className="mt-2 text-xs leading-6 text-slate-300">{copy.offHelp}</p>}
        <form className="mt-4" onSubmit={event => { event.preventDefault(); void change('block', sender, event.currentTarget.querySelector('button')); }}>
          <label htmlFor={senderId} className="text-sm font-semibold">{copy.sender}</label>
          <p id={`${senderId}-help`} className="mt-1 text-xs leading-6 text-slate-300">{copy.senderHelp}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <input id={senderId} aria-describedby={`${senderId}-help`} type="tel" inputMode="numeric" autoComplete="off" maxLength={20} value={sender} onChange={event => setSender(event.target.value)} disabled={!canChange}
              className="min-h-[44px] min-w-0 flex-1 rounded-xl border border-white/20 bg-bg-card px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-300 disabled:opacity-50" />
            <button type="submit" className={buttonClass} disabled={!canChange || !sender}>{copy.block}</button>
          </div>
        </form>
        {current.sessions.length === 0 && <p className="mt-4 text-sm leading-6 text-slate-300">{copy.empty}</p>}
        <ul className="mt-4 space-y-3">{sessions.map(session => <li key={session.id} className="rounded-xl border border-white/10 p-3">
          <div className="flex flex-wrap justify-between gap-2 text-sm"><span className="font-semibold [overflow-wrap:anywhere]">{session.sender}</span><span className="text-violet-200">{copy[session.status]}</span></div>
          <p className="mt-2 text-xs leading-6 text-slate-300">{copy.expires}: {time(session.expiresAtMs)}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" className={buttonClass} disabled={!canChange || session.status !== 'active'} aria-label={`${copy.close}: ${session.sender}`} onClick={event => { void change('close', session.sender, event.currentTarget); }}>{copy.close}</button>
            <button type="button" className={buttonClass} disabled={!canChange} aria-label={`${session.status === 'blocked' ? copy.unblock : copy.block}: ${session.sender}`} onClick={event => { void change(session.status === 'blocked' ? 'unblock' : 'block', session.sender, event.currentTarget); }}>{session.status === 'blocked' ? copy.unblock : copy.block}</button>
          </div>
        </li>)}</ul>
        {current.sessions.length > 5 && <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-slate-300">{copy.range(visiblePage * 5 + 1, Math.min(visiblePage * 5 + 5, current.sessions.length), current.sessions.length)}</p>
          <div className="flex flex-wrap gap-2"><button type="button" className={buttonClass} disabled={Boolean(busy) || visiblePage === 0} onClick={() => setPage(visiblePage - 1)}>{copy.previous}</button><button type="button" className={buttonClass} disabled={Boolean(busy) || (visiblePage + 1) * 5 >= current.sessions.length} onClick={() => setPage(visiblePage + 1)}>{copy.next}</button></div>
        </div>}
        <p className="mt-3 text-xs leading-6 text-slate-300">{copy.limited}</p>
      </>}
      <p className="mt-3 text-xs leading-6 text-slate-300">{copy.scope}</p>
    </div>}
  </details>;
}

export function AdminWhatsAppPrivacy(props: Props) {
  const { user } = useAuth();
  return <PrivacyContent key={props.previewMode ? 'preview' : user?.uid || 'signed-out'} {...props} account={user || null} />;
}
