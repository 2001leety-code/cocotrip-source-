import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import type { Language } from '@/i18n';
import { adminWebchatInboxCopy } from '@/lib/adminWebchatInboxCopy';
import { isWebchatDetail, isWebchatOverview, isWebchatReply, type WebchatDetail, type WebchatOverview } from '@/lib/adminWebchatInboxContract';

interface Props { language: Language; previewMode?: boolean; previewData?: WebchatOverview; previewDetails?: Record<string, WebchatDetail> }
type Account = { uid: string; getIdToken: () => Promise<string> } | null;
type ReplyRequest = { sessionId: string; requestId: string; text: string; expectedLastMessageAtMs: number };
const buttonClass = 'inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-xl border border-white/20 px-3 py-2 text-sm font-semibold text-slate-100 hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-300 disabled:opacity-50';

async function getToken(account: NonNullable<Account>, signal: AbortSignal) {
  if (signal.aborted) throw new Error('ABORTED');
  let abort = () => {};
  try {
    return await Promise.race([account.getIdToken(), new Promise<never>((_, reject) => {
      abort = () => reject(new Error('ABORTED'));
      signal.addEventListener('abort', abort, { once: true });
    })]);
  } finally { signal.removeEventListener('abort', abort); }
}

function WebchatContent({ language, previewMode = false, previewData, previewDetails, account }: Props & { account: Account }) {
  const copy = adminWebchatInboxCopy[language] || adminWebchatInboxCopy.en;
  const id = useId();
  const [previewAt] = useState(() => Date.now());
  const [loaded, setLoaded] = useState<WebchatOverview | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<WebchatDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailFailed, setDetailFailed] = useState(false);
  const [draft, setDraft] = useState('');
  const [review, setReview] = useState(false);
  const [sending, setSending] = useState(false);
  const [delivery, setDelivery] = useState<'idle' | 'saved' | 'uncertain' | 'stale' | 'conflict' | 'unavailable'>('idle');
  const [page, setPage] = useState(0);
  const pending = useRef<ReplyRequest | null>(null);
  const overviewRequest = useRef<AbortController | null>(null);
  const detailRequest = useRef<AbortController | null>(null);
  const replyRequest = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  const invalidPreview = previewMode && !!previewData && !isWebchatOverview(previewData);
  const data = previewMode ? invalidPreview ? null : previewData || { generatedAtMs: previewAt, sessions: [], possiblyTruncated: false } : loaded;
  const locked = sending || delivery === 'uncertain';
  const visiblePage = Math.min(page, Math.max(0, Math.ceil((data?.sessions.length || 0) / 5) - 1));
  const sessions = data?.sessions.slice(visiblePage * 5, visiblePage * 5 + 5) || [];
  const newer = !!detail && !!data?.sessions.some(item => item.sessionId === detail.session.sessionId && item.lastMessageAtMs !== detail.session.lastMessageAtMs);

  const loadOverview = useCallback(async () => {
    if (previewMode || !account || overviewRequest.current || pending.current) return;
    const controller = new AbortController();
    overviewRequest.current = controller;
    const timer = window.setTimeout(() => controller.abort(), 10_000);
    setLoading(true); setFailed(false);
    try {
      const token = await getToken(account, controller.signal);
      if (controller.signal.aborted) throw new Error('ABORTED');
      const response = await fetch('/api/admin-webchat-inbox', { headers: { Authorization: `Bearer ${token}` }, signal: controller.signal, cache: 'no-store' });
      const payload = await response.json();
      if (!response.ok || payload.ok !== true || !isWebchatOverview(payload.data)) throw new Error('CHAT_UNAVAILABLE');
      if (mounted.current && !controller.signal.aborted) setLoaded(payload.data);
    } catch {
      if (mounted.current && overviewRequest.current === controller) {
        setFailed(true); setLoaded(null); setDetail(null); setSelected(null); setReview(false);
        detailRequest.current?.abort();
      }
    } finally {
      window.clearTimeout(timer);
      if (overviewRequest.current === controller) overviewRequest.current = null;
      if (mounted.current) setLoading(false);
    }
  }, [account, previewMode]);

  useEffect(() => {
    mounted.current = true;
    const startup = window.setTimeout(() => void loadOverview(), 0);
    const interval = window.setInterval(() => { if (!document.hidden) void loadOverview(); }, 60_000);
    return () => {
      mounted.current = false; window.clearTimeout(startup); window.clearInterval(interval);
      overviewRequest.current?.abort(); detailRequest.current?.abort(); replyRequest.current?.abort();
    };
  }, [loadOverview]);

  useEffect(() => {
    if (!draft && !locked) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [draft, locked]);

  async function show(sessionId: string, refresh = false) {
    if (locked || (!refresh && draft && !window.confirm(copy.draftDiscardConfirm))) return;
    detailRequest.current?.abort();
    setSelected(sessionId); setDetail(null); setDetailFailed(false); setDetailLoading(true); setReview(false); setDelivery('idle');
    if (!refresh) setDraft('');
    if (previewMode) {
      const fixture = previewDetails?.[sessionId];
      if (fixture && isWebchatDetail(fixture)) setDetail(fixture); else setDetailFailed(true);
      setDetailLoading(false); return;
    }
    if (!account) { setDetailFailed(true); setDetailLoading(false); return; }
    const controller = new AbortController();
    detailRequest.current = controller;
    const timer = window.setTimeout(() => controller.abort(), 10_000);
    try {
      const token = await getToken(account, controller.signal);
      if (controller.signal.aborted) throw new Error('ABORTED');
      const response = await fetch(`/api/admin-webchat-inbox?sessionId=${encodeURIComponent(sessionId)}`, { headers: { Authorization: `Bearer ${token}` }, signal: controller.signal, cache: 'no-store' });
      const payload = await response.json();
      if (!response.ok || payload.ok !== true || !isWebchatDetail(payload.data) || payload.data.session.sessionId !== sessionId) throw new Error('CHAT_UNAVAILABLE');
      if (mounted.current && !controller.signal.aborted && detailRequest.current === controller) setDetail(payload.data);
    } catch { if (mounted.current && detailRequest.current === controller) setDetailFailed(true); }
    finally { window.clearTimeout(timer); if (mounted.current && detailRequest.current === controller) setDetailLoading(false); }
  }

  function close() {
    if (locked || (draft && !window.confirm(copy.draftDiscardConfirm))) return;
    detailRequest.current?.abort(); detailRequest.current = null;
    setSelected(null); setDetail(null); setDetailLoading(false); setDetailFailed(false); setDraft(''); setReview(false); setDelivery('idle');
  }

  async function sendReply() {
    if (previewMode || !account || !detail || sending || (!review && !pending.current)) return;
    if (!pending.current) {
      if (!draft.trim() || Array.from(draft).length > 4000 || newer || typeof crypto.randomUUID !== 'function') { setDelivery('unavailable'); return; }
      pending.current = { sessionId: detail.session.sessionId, requestId: crypto.randomUUID(), text: draft, expectedLastMessageAtMs: detail.session.lastMessageAtMs };
    }
    const attempt = pending.current;
    const controller = new AbortController();
    replyRequest.current = controller;
    overviewRequest.current?.abort(); overviewRequest.current = null;
    const timer = window.setTimeout(() => controller.abort(), 15_000);
    let requestStarted = false;
    setSending(true);
    try {
      const token = await getToken(account, controller.signal);
      if (controller.signal.aborted) throw new Error('ABORTED');
      requestStarted = true;
      const response = await fetch('/api/admin-webchat-inbox', { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(attempt), signal: controller.signal, cache: 'no-store' });
      const payload = await response.json();
      if (!mounted.current) return;
      if (controller.signal.aborted) throw new Error('ABORTED');
      if (response.ok && payload.ok === true && isWebchatReply(payload.data)
        && payload.data.requestId === attempt.requestId && payload.data.session.sessionId === attempt.sessionId && payload.data.message.text === attempt.text) {
        const saved = payload.data;
        pending.current = null; setDelivery('saved'); setDraft(''); setReview(false);
        setDetail(previous => previous ? { ...previous, generatedAtMs: Date.now(), session: saved.session,
          messages: [...previous.messages.filter(message => message.id !== saved.message.id), saved.message].slice(-50),
          messagesPossiblyTruncated: previous.messagesPossiblyTruncated || previous.messages.length >= 50 } : null);
        setLoaded(previous => previous ? { ...previous, sessions: previous.sessions.map(item => item.sessionId === attempt.sessionId ? saved.session : item) } : null);
      } else if (!response.ok && payload.ok === false && [400, 401, 403, 404, 409].includes(response.status)) {
        pending.current = null; setReview(false);
        setDelivery(payload.code === 'STALE_THREAD' ? 'stale' : payload.code === 'REQUEST_CONFLICT' ? 'conflict' : 'unavailable');
      } else { setDelivery('uncertain'); }
    } catch {
      if (mounted.current) {
        if (!requestStarted) { pending.current = null; setDelivery('unavailable'); } else setDelivery('uncertain');
      }
    } finally { window.clearTimeout(timer); if (mounted.current) setSending(false); }
  }

  const time = (ms: number) => new Date(ms).toLocaleString(copy.locale, { timeZone: 'Asia/Seoul', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) + ' KST';
  const sender = (value: string) => value === 'customer' || value === 'ai' || value === 'admin' ? copy.senderLabels[value] : copy.unknownSender;
  return <section aria-labelledby={`${id}-title`} className="min-w-0 rounded-2xl border border-white/10 bg-bg-card p-4 text-slate-100">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div><h2 id={`${id}-title`} className="text-base font-bold">{copy.title}</h2><p className="mt-1 text-sm leading-6 text-slate-300">{copy.subtitle}</p></div>
      <button type="button" className={buttonClass} disabled={loading || locked || previewMode || !account} onClick={() => { void loadOverview(); if (selected) void show(selected, true); }}>{copy.refresh}</button>
    </div>
    {loading && <p role="status" className="mt-3 text-sm">{copy.loading}</p>}
    {(failed || invalidPreview) && <p role="alert" className="mt-3 text-sm text-amber-100">{copy.failed}</p>}
    {previewMode && <p className="mt-3 text-xs leading-5 text-amber-100">{copy.readOnlyPreview}</p>}
    {data && <>
      {!data.sessions.length && <p className="mt-4 text-sm text-slate-300">{copy.empty}</p>}
      <ul className="mt-4 space-y-2">{sessions.map(item => <li key={item.sessionId} className="rounded-xl border border-white/10 p-3">
        <div className="flex flex-wrap items-center justify-between gap-2"><p className="text-sm font-semibold">{copy.customerLabel} · {item.language ? copy.languageLabels[item.language] : copy.unknownLanguage}</p><time className="text-xs text-slate-300" dateTime={new Date(item.lastMessageAtMs).toISOString()}>{time(item.lastMessageAtMs)}</time></div>
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2"><p className="text-xs text-slate-300">{copy.lastFromLabel}: {sender(item.lastMessageFrom)}</p><button type="button" className={buttonClass} disabled={locked} aria-expanded={selected === item.sessionId} aria-controls={`${id}-conversation`} onClick={() => { if (selected === item.sessionId) close(); else void show(item.sessionId); }}>{selected === item.sessionId ? copy.close : copy.show}</button></div>
      </li>)}</ul>
      {data.sessions.length > 5 && <div className="mt-3 flex items-center justify-between gap-2"><button type="button" className={buttonClass} disabled={visiblePage === 0 || locked || !!draft} onClick={() => { close(); setPage(visiblePage - 1); }}>{copy.previous}</button><span className="text-xs">{copy.pageLabel} {visiblePage + 1}/{Math.ceil(data.sessions.length / 5)}</span><button type="button" className={buttonClass} disabled={(visiblePage + 1) * 5 >= data.sessions.length || locked || !!draft} onClick={() => { close(); setPage(visiblePage + 1); }}>{copy.next}</button></div>}
      <p className="mt-3 text-xs leading-5 text-slate-300">{copy.olderLimited}</p>
    </>}
    {selected && <div id={`${id}-conversation`} className="mt-4 min-w-0 border-t border-white/10 pt-4">
      {detailLoading && <p role="status" className="text-sm">{copy.loading}</p>}
      {detailFailed && <p role="alert" className="text-sm text-amber-100">{copy.detailFailed}</p>}
      {detail && <>
        <ol className="max-h-[26rem] space-y-3 overflow-y-auto rounded-xl border border-white/10 p-3" aria-label={copy.customerLabel}>{detail.messages.map(message => <li key={message.id} className={`min-w-0 rounded-lg p-3 ${message.from === 'admin' ? 'bg-violet-500/10' : 'bg-white/5'}`}>
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-300"><span>{sender(message.from)}</span><time dateTime={new Date(message.ts).toISOString()}>{time(message.ts)}</time></div>
          <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-7 [overflow-wrap:anywhere]">{message.text}</p>{message.truncated && <p className="mt-2 text-xs text-amber-100">{copy.olderLimited}</p>}
        </li>)}</ol>
        {detail.messagesPossiblyTruncated && <p className="mt-2 text-xs text-amber-100">{copy.olderLimited}</p>}
        <form className="mt-4 space-y-3" onSubmit={event => { event.preventDefault(); if (draft.trim() && !locked && !newer && delivery !== 'stale') { setReview(true); setDelivery('idle'); } }}>
          <label htmlFor={`${id}-reply`} className="block text-sm font-semibold">{copy.replyLabel}</label>
          <textarea id={`${id}-reply`} aria-describedby={`${id}-hint`} value={draft} onChange={event => { setDraft(event.target.value); setReview(false); setDelivery(current => current === 'stale' ? current : 'idle'); }} disabled={locked} maxLength={4000} rows={4} className="min-h-[100px] w-full rounded-xl border border-white/20 bg-bg-card px-3 py-2 text-sm leading-7 text-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-300 disabled:opacity-50" placeholder={copy.replyPlaceholder} />
          <p id={`${id}-hint`} className="text-xs leading-5 text-slate-300">{copy.replyHint}</p>
          {(newer || delivery === 'stale') && <p role="alert" className="text-sm text-amber-100">{copy.stale}</p>}
          {delivery !== 'idle' && delivery !== 'stale' && <p role={delivery === 'saved' ? 'status' : 'alert'} className={`text-sm leading-6 ${delivery === 'saved' ? 'text-emerald-200' : 'text-amber-100'}`}>{copy[delivery]}</p>}
          {delivery === 'uncertain' ? <button type="button" className={buttonClass} disabled={sending} onClick={() => void sendReply()}>{sending ? copy.sending : copy.retrySame}</button>
            : <button type="submit" className={buttonClass} disabled={!draft.trim() || locked || newer || delivery === 'stale'}>{copy.review}</button>}
          {review && <div className="rounded-xl border border-violet-300/30 p-3" role="group" aria-labelledby={`${id}-confirm`}>
            <h3 id={`${id}-confirm`} className="text-sm font-semibold">{copy.confirmTitle}</h3><p className="mt-1 text-xs leading-5 text-slate-300">{copy.confirmHint}</p>
            <p className="mt-3 whitespace-pre-wrap break-words text-sm leading-7 [overflow-wrap:anywhere]">{draft}</p>
            <div className="mt-3 flex flex-wrap gap-2"><button type="button" className={`${buttonClass} bg-violet-500/20`} disabled={previewMode || !account || locked || newer} onClick={() => void sendReply()}>{sending ? copy.sending : copy.confirmSend}</button><button type="button" className={buttonClass} disabled={locked} onClick={() => setReview(false)}>{copy.cancel}</button></div>
          </div>}
        </form>
      </>}
    </div>}
  </section>;
}

export function AdminWebchatInbox(props: Props) {
  const { user } = useAuth();
  return <WebchatContent key={props.previewMode ? 'preview' : user?.uid || 'signed-out'} {...props} account={user || null} />;
}
