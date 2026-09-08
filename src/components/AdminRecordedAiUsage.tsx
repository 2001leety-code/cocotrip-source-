import { useId } from 'react';
import type { Language } from '@/i18n';
import { adminRecordedAiUsageCopy } from './adminRecordedAiUsageCopy';

/** Read-only aggregate of existing estimates, never provider billing or a calculator. */
export interface RecordedAiUsage {
  source: 'api_usage';
  service: 'gemini';
  currency: 'USD';
  basis: 'stored-estimate';
  coverage: 'best-effort-records-only';
  actualBillConnected: false;
  status: 'ok' | 'partial' | 'empty' | 'unknown';
  generatedAt: string;
  monthStart: string;
  todayStart: string;
  queryLimit: number;
  recordedCostUsd: number | null;
  todayRecordedCostUsd: number | null;
  recordCount: number | null;
  todayRecordCount: number | null;
  excludedCount: number | null;
  limitReached: boolean;
  latestRecordAt: string | null;
}

export function AdminRecordedAiUsage({ data, language }: { data?: RecordedAiUsage | null; language: Language }) {
  const copy = adminRecordedAiUsageCopy[language];
  const titleId = useId();
  const status = data?.status || 'unknown';
  const unknown = !data || status === 'unknown';
  const statusLabel = unknown ? copy.unknown : status === 'partial' ? copy.partial : status === 'empty' ? copy.empty : copy.recorded;
  const numberFormat = new Intl.NumberFormat(copy.locale, {
    style: 'currency', currency: 'USD', currencyDisplay: 'code', minimumFractionDigits: 2, maximumFractionDigits: 9,
  });
  const timeFormat = new Intl.DateTimeFormat(copy.locale, {
    timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  });
  const time = (value: string | null | undefined) => {
    const ms = value ? Date.parse(value) : NaN;
    return Number.isFinite(ms) ? timeFormat.format(ms) : copy.unknown;
  };
  const periods = [
    { label: copy.today, value: data?.todayRecordedCostUsd, count: data?.todayRecordCount },
    { label: copy.month, value: data?.recordedCostUsd, count: data?.recordCount },
  ];
  const note = !data ? copy.missing : unknown ? copy.failed : status === 'empty' ? copy.emptyDetail : status === 'partial' ? copy.partialDetail : null;

  return (
    <section className="min-w-0 rounded-2xl border border-white/10 bg-bg-card p-4 sm:p-5" aria-labelledby={titleId}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id={titleId} className="text-sm font-bold text-slate-100">{copy.title}</h2>
        <span className={`rounded-md border px-2 py-1 text-xs font-semibold ${unknown || status === 'partial' ? 'border-amber-300/25 bg-amber-300/10 text-amber-100' : 'border-white/10 text-slate-300'}`}>
          {statusLabel}
        </span>
      </div>
      <p className="mt-2 text-xs leading-5 text-slate-300">{copy.basis}</p>
      <dl className="mt-3 grid grid-cols-2 gap-2">
        {periods.map((period) => {
          const hasRecords = !unknown && status !== 'empty'
            && typeof period.count === 'number' && Number.isSafeInteger(period.count) && period.count > 0;
          const hasValue = hasRecords && typeof period.value === 'number' && Number.isFinite(period.value) && period.value >= 0;
          return (
            <div key={period.label} className="min-w-0 rounded-xl border border-white/[0.08] bg-white/[0.025] p-3">
              <dt className="text-xs font-semibold text-slate-300">{period.label}</dt>
              <dd className="mt-1 break-words text-sm font-bold leading-6 text-white [overflow-wrap:anywhere] sm:text-base">
                {unknown || (hasRecords && !hasValue) ? copy.unknown : hasValue ? numberFormat.format(period.value as number) : copy.empty}
              </dd>
              {hasRecords && <dd className="mt-1 text-xs text-slate-300">{copy.records(period.count as number)}</dd>}
            </div>
          );
        })}
      </dl>
      {note && <p className="mt-3 text-xs leading-5 text-slate-300">{note}</p>}
      <details className="mt-3 border-t border-white/10 pt-1">
        <summary className="flex min-h-[44px] min-w-[44px] cursor-pointer items-center rounded-lg text-xs font-bold text-violet-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-300">
          {copy.details}
        </summary>
        <div className="space-y-2 pb-1 text-xs leading-5 text-slate-300 [overflow-wrap:anywhere]">
          <p>{copy.coverage}</p>
          <p>{copy.timeZone}</p>
          {data && <dl className="space-y-2">
            {[
              [copy.todayWindow, `${time(data.todayStart)} — ${time(data.generatedAt)}`],
              [copy.monthWindow, `${time(data.monthStart)} — ${time(data.generatedAt)}`],
              [copy.refreshed, time(data.generatedAt)],
              [copy.latest, data.latestRecordAt ? time(data.latestRecordAt) : unknown ? copy.unknown : copy.noLatest],
            ].map(([label, value]) => <div key={label}><dt className="font-semibold text-slate-200">{label}</dt><dd>{value}</dd></div>)}
          </dl>}
          {data && Number.isSafeInteger(data.queryLimit) && data.queryLimit > 0 && <p>{copy.limit(data.queryLimit)}</p>}
          {!unknown && data?.limitReached && <p className="text-amber-100">{copy.limitReached}</p>}
          {!unknown && typeof data?.excludedCount === 'number' && data.excludedCount > 0 && <p>{copy.excluded(data.excludedCount)}</p>}
        </div>
      </details>
    </section>
  );
}
