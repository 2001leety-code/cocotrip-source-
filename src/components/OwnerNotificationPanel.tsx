import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { Bell, RefreshCw } from 'lucide-react';
import type { Language } from '@/i18n';
import {
  enrollOwnerDevice,
  pendingOwnerEnrollment,
  readOwnerNotificationState,
  type OwnerNotificationAdapter,
  type OwnerNotificationSnapshot,
} from '@/lib/ownerNotificationSetup';
import { ownerNotificationCopy } from './ownerNotificationCopy';

type Phase = 'checking' | 'ready' | 'enrolling' | 'check_failed' | 'enroll_failed';

/** No auth, Firebase or notification APIs here: the DEV harness supplies an in-memory adapter. */
export function OwnerNotificationPanel({ adapter, language = 'ko' }: {
  adapter: OwnerNotificationAdapter;
  language?: Language;
}) {
  const copy = ownerNotificationCopy[language];
  const [snapshot, setSnapshot] = useState<OwnerNotificationSnapshot | null>(null);
  const [phase, setPhase] = useState<Phase>('checking');
  const [longWait, setLongWait] = useState(false);
  const generation = useRef(0);
  const mounted = useRef(false);
  const recoveryId = useId();

  const check = useCallback(async () => {
    if (pendingOwnerEnrollment(adapter.key)) return;
    const request = ++generation.current;
    setPhase('checking');
    try {
      const next = await readOwnerNotificationState(adapter);
      if (!mounted.current || request !== generation.current) return;
      setSnapshot(next);
      setPhase('ready');
    } catch {
      if (mounted.current && request === generation.current) setPhase('check_failed');
    }
  }, [adapter]);

  const observeEnrollment = useCallback(async (operation: Promise<boolean>) => {
    const request = ++generation.current;
    setPhase('enrolling');
    setLongWait(false);
    let succeeded = false;
    try { succeeded = await operation; } catch { /* Show the bounded, non-sensitive failure below. */ }
    if (!mounted.current || request !== generation.current) return;
    if (!succeeded) {
      // Refresh permission after a blocked/dismissed browser dialog, without claiming registration.
      try {
        const next = await readOwnerNotificationState(adapter);
        if (!mounted.current || request !== generation.current) return;
        setSnapshot(next);
        setPhase(next.permission === 'denied' ? 'ready' : 'enroll_failed');
      } catch {
        if (mounted.current && request === generation.current) setPhase('enroll_failed');
      }
      return;
    }
    // Enrollment success is not proof of delivery; verify the current server subscription too.
    await check();
  }, [adapter, check]);

  useEffect(() => {
    mounted.current = true;
    let active = true;
    queueMicrotask(() => {
      if (!active) return;
      const pending = pendingOwnerEnrollment(adapter.key);
      if (pending) void observeEnrollment(pending);
      else void check();
    });
    const onForeground = () => {
      if (!document.hidden) void check();
    };
    window.addEventListener('focus', onForeground);
    document.addEventListener('visibilitychange', onForeground);
    return () => {
      active = false;
      mounted.current = false;
      generation.current += 1;
      window.removeEventListener('focus', onForeground);
      document.removeEventListener('visibilitychange', onForeground);
    };
  }, [adapter, check, observeEnrollment]);

  useEffect(() => {
    if (phase !== 'enrolling') return;
    const timer = window.setTimeout(() => setLongWait(true), 12_000);
    return () => window.clearTimeout(timer);
  }, [phase]);

  const signedIn = snapshot?.account === 'signed_in';
  const supported = snapshot?.permission !== 'unsupported';
  const denied = snapshot?.permission === 'denied';
  const busy = phase === 'checking' || phase === 'enrolling' || snapshot?.account === 'loading';
  const canEnroll = !busy && phase !== 'check_failed' && signedIn && snapshot?.configured
    && supported && !denied && !snapshot?.registered;
  let label = copy.checking;
  let detail = copy.checkFailedDetail;
  if (phase === 'enrolling') { label = copy.enrolling; detail = copy.pendingDetail; }
  else if (phase === 'check_failed') { label = copy.checkFailed; detail = copy.checkFailedDetail; }
  else if (phase === 'enroll_failed') { label = copy.enrollFailed; detail = copy.enrollFailedDetail; }
  else if (phase === 'ready' && snapshot) {
    if (snapshot.account === 'loading') { label = copy.loading; detail = copy.loginDetail; }
    else if (!signedIn) { label = copy.login; detail = copy.loginDetail; }
    else if (!supported) { label = copy.unavailable; detail = copy.unavailableDetail; }
    else if (!snapshot.configured) { label = copy.notConfigured; detail = copy.notConfiguredDetail; }
    else if (denied) { label = copy.denied; detail = copy.deniedDetail; }
    else if (snapshot.registered) { label = copy.registered; detail = copy.registeredDetail; }
    else { label = copy.unregistered; detail = copy.unregisteredDetail; }
  }
  const showRecovery = phase === 'check_failed' || phase === 'enroll_failed'
    || (phase === 'ready' && snapshot && snapshot.account !== 'loading'
      && (!signedIn || !supported || !snapshot.configured || denied));

  return (
    <section aria-label={copy.title} className="rounded-2xl border border-white/10 bg-white/[0.03] px-3 py-2.5">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <div className="min-w-0">
          <h3 className="flex items-center gap-2 text-sm font-bold text-slate-100">
            <Bell className="h-4 w-4 shrink-0 text-violet-200" aria-hidden="true" />{copy.title}
          </h3>
          <p role="status" aria-live="polite" className="mt-1 text-xs text-slate-300">{label}</p>
        </div>
        <button
          type="button"
          disabled={busy}
          aria-describedby={showRecovery ? recoveryId : undefined}
          onClick={() => {
            if (canEnroll) void observeEnrollment(enrollOwnerDevice(adapter));
            else void check();
          }}
          className="inline-flex min-h-[44px] min-w-[44px] shrink-0 items-center justify-center gap-1.5 rounded-lg border border-violet-200/30 px-3 text-xs font-bold text-violet-100 hover:bg-violet-300/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-200 disabled:opacity-50"
        >
          {!canEnroll && <RefreshCw className={`h-3.5 w-3.5 ${busy ? 'animate-spin' : ''}`} aria-hidden="true" />}
          {phase === 'enrolling' ? copy.enrolling : canEnroll ? (phase === 'enroll_failed' ? copy.retry : copy.enable) : copy.check}
        </button>
      </div>
      <p className="mt-2 text-xs leading-5 text-amber-100">{copy.dispatch}</p>
      {showRecovery && <p id={recoveryId} className="mt-2 text-xs leading-5 text-slate-200">{detail}</p>}
      {longWait && phase === 'enrolling' && <p className="mt-2 text-xs leading-5 text-slate-300">{copy.pendingDetail}</p>}
      <details className="mt-1 text-xs text-slate-300">
        <summary className="min-h-[44px] cursor-pointer content-center rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-200">{copy.details}</summary>
        {snapshot && <p className="mb-1">{copy.permission}: {copy.permissions[snapshot.permission]}</p>}
        {!showRecovery && <p className="pb-1 leading-5">{detail}</p>}
      </details>
    </section>
  );
}
