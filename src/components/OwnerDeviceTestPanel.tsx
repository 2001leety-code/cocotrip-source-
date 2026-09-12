import { useRef, useState } from 'react';
import type { Language } from '@/i18n';
import type { OwnerDeviceTestAdapter, OwnerDeviceTestResult } from '@/lib/ownerDeviceTest';
import { ownerDeviceTestCopy } from './ownerDeviceTestCopy';

/** Explicit actions only. The isolated DEV harness provides a memory-only adapter. */
export function OwnerDeviceTestPanel({ adapter, language = 'ko' }: { adapter: OwnerDeviceTestAdapter; language?: Language }) {
  const copy = ownerDeviceTestCopy[language];
  const [result, setResult] = useState<OwnerDeviceTestResult | null>(null);
  const [phase, setPhase] = useState<'idle' | 'check' | 'send'>('idle');
  const lock = useRef(false);
  const attempted = useRef(false);
  const [hasAttempted, setHasAttempted] = useState(false);
  const [sendResult, setSendResult] = useState<OwnerDeviceTestResult | null>(null);
  const button = 'min-h-[44px] rounded-lg border border-violet-200/30 px-3 text-xs font-bold text-violet-100 hover:bg-violet-300/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-200 disabled:opacity-50';
  async function run(action: 'check' | 'send') {
    if (lock.current || (action === 'send' && (attempted.current || result?.ready !== true))) return;
    lock.current = true;
    if (action === 'send') { attempted.current = true; setHasAttempted(true); }
    setPhase(action);
    try {
      const next = await adapter[action]();
      if (action === 'send') setSendResult(next);
      setResult(next);
    } catch {
      const next = { code: action === 'send' ? 'OUTCOME_UNKNOWN' : 'CHECK_FAILED' };
      if (action === 'send') setSendResult(next);
      setResult(next);
    } finally { lock.current = false; setPhase('idle'); }
  }
  const shown = sendResult || result;
  const code = shown?.code || '';
  const detail = phase === 'send' ? copy.sending : phase === 'check' ? copy.checking
    : code === 'PROVIDER_ACCEPTED' ? copy.accepted : code === 'OUTCOME_UNKNOWN' ? copy.unknown
    : code === 'SEND_REJECTED' ? copy.rejected : ['BUSY', 'RATE_LIMITED'].includes(code) ? copy.busy
    : code === 'ALREADY_HANDLED' ? copy.alreadyHandled
    : ['CONTROL_INVALID', 'MAX_TESTS_REACHED'].includes(code) ? copy.review
    : ['DISABLED', 'CONFIGURATION_REQUIRED', 'PRODUCTION_REQUIRED'].includes(code) ? copy.disabled
    : ['DEVICE_NOT_SELECTED', 'DEVICE_CHANGED', 'OWNER_MISMATCH'].includes(code) ? copy.notSelected
    : shown?.ready ? copy.ready : shown ? copy.notReady : copy.initial;
  return <section aria-label={copy.title} className="mt-3 rounded-2xl border border-white/10 bg-white/[0.03] px-3 py-3">
    <h3 className="text-sm font-bold text-slate-100">{copy.title}</h3>
    <p role="status" aria-live="polite" className="mt-2 text-xs leading-5 text-slate-200">{detail}</p>
    <div className="mt-2 flex flex-wrap gap-2">
      <button type="button" className={button} disabled={phase !== 'idle'} onClick={() => void run('check')}>{copy.check}</button>
      {result?.ready && !hasAttempted && <button type="button" className={button} disabled={phase !== 'idle'} onClick={() => void run('send')}>{copy.send}</button>}
    </div>
  </section>;
}
