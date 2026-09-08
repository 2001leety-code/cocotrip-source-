import type { Language } from '@/i18n';
import { ownerDispatchReadinessCopy } from './ownerDispatchReadinessCopy';

type DispatchState = 'off' | 'configuration_required' | 'configured' | 'unknown';
export type OwnerDispatchReadinessSnapshot = { state: DispatchState; deliveryVerified: false };

/** Presentation only. Registration and actual delivery are deliberately separate. */
export function OwnerDispatchReadiness({ readiness, language = 'ko', loading = false }: {
  readiness?: OwnerDispatchReadinessSnapshot | null;
  language?: Language;
  loading?: boolean;
}) {
  const copy = ownerDispatchReadinessCopy[language];
  const reported = readiness?.state;
  const state: DispatchState = reported === 'off' || reported === 'configuration_required' || reported === 'configured'
    ? reported : 'unknown';

  return (
    <section aria-label={copy.title} className="rounded-2xl border border-white/10 bg-white/[0.03] px-3 py-2.5">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <h3 className="text-sm font-bold text-slate-100">{copy.title}</h3>
        <p role="status" aria-live="polite" className="text-xs font-bold text-amber-100">
          {loading ? copy.checking : copy.labels[state]}
        </p>
      </div>
      {!loading && <p className="mt-2 text-xs leading-5 text-slate-200">{copy.descriptions[state]}</p>}
      <p className="mt-2 text-xs leading-5 text-amber-100">{copy.delivery}</p>
      <p className="mt-1 text-xs leading-5 text-slate-300">{copy.unavailable}</p>
      <details className="mt-1 text-xs text-slate-300">
        <summary className="min-h-[44px] cursor-pointer content-center rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-200">{copy.details}</summary>
        <p className="pb-1 leading-5">{copy.setup}</p>
      </details>
    </section>
  );
}
