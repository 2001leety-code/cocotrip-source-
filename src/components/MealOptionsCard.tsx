import * as React from 'react';
import { describeDietaryEvidence } from '../../api/_shared/dietary-trust.js';
import { mealOptionMessages, type MealOptionLanguage } from '../lib/mealOptionMessages';

export type MealOption = {
  openingStatus?: 'unknown' | 'verified_open';
  openingSourceUrl?: string | null;
  openingCheckedAt?: string | null;
  id: string;
  name: string;
  verificationStatus: string;
  sourceUrl?: string | null;
  checkedAt?: string | null;
  repeatReason?: string | null;
  startMin?: number | null;
  endMin?: number | null;
  inboundMin?: number | null;
  outboundMin?: number | null;
};

export type MealOptionsStatus = 'feasible' | 'no_match' | 'information_unknown' | 'route_failed' | 'confirmation_required';

export type MealOptionsCardProps = {
  options: MealOption[];
  referenceOptions?: MealOption[];
  baselineId: string | null;
  baselineInvalid?: boolean;
  selectedId: string | null;
  busy: boolean;
  readOnly?: boolean;
  onSelect: (id: string) => void;
  status: MealOptionsStatus;
  lang: MealOptionLanguage;
};

function clockTime(value: number | null | undefined): string | null {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value >= 1440) return null;
  return `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`;
}

function safeSourceUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : null;
  } catch {
    return null;
  }
}

export function MealOptionsCard({ options, referenceOptions = [], baselineId, baselineInvalid = false, selectedId, busy, readOnly, onSelect, status, lang }: MealOptionsCardProps) {
  const titleId = React.useId();
  const text = mealOptionMessages[lang] || mealOptionMessages.en;
  const disabled = busy || readOnly || status !== 'feasible';
  return (
    <section aria-labelledby={titleId} className="rounded-xl border border-white/10 bg-slate-900 p-3 text-white">
      <h3 id={titleId} className="text-sm font-semibold">{text.title}</h3>
      {baselineInvalid && <p role="alert" className="mt-1 text-xs text-white/80">{text.baselineInvalid}</p>}
      {baselineId && <p className="mt-1 text-xs text-white/80">{text.baselineNote}</p>}
      {options.length > 0 && <p className="mt-1 text-xs text-white/80">{text.timing}</p>}
      <p className="mt-2 text-xs text-white/80" role="status">{busy ? text.busy : text[status]}</p>
      {selectedId === null && <p className="mt-1 text-xs text-white/80">{text.notSelected}</p>}
      <ul className="mt-2 space-y-2">
        {options.slice(0, 3).map((option) => {
          const source = safeSourceUrl(option.sourceUrl);
          const selected = selectedId === option.id;
          const start = clockTime(option.startMin);
          const end = clockTime(option.endMin);
          const inbound = typeof option.inboundMin === 'number' && Number.isFinite(option.inboundMin) && option.inboundMin >= 0 ? option.inboundMin : null;
          const outbound = typeof option.outboundMin === 'number' && Number.isFinite(option.outboundMin) && option.outboundMin >= 0 ? option.outboundMin : null;
          return (
            <li key={option.id} className="rounded-lg border border-white/10 bg-white/5 p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="break-words text-sm font-medium">{option.name}</p>
                  {option.id === baselineId && <p className="mt-1 text-xs text-purple-200">{text.baseline}</p>}
                </div>
                <button type="button" disabled={disabled} aria-pressed={selected} onClick={() => onSelect(option.id)}
                  className="min-h-[44px] min-w-[44px] shrink-0 rounded-lg border border-purple-300/40 px-3 text-sm font-medium text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-purple-300 disabled:cursor-not-allowed disabled:opacity-50">
                  {selected ? text.selected : text.select}
                </button>
              </div>
              {option.openingStatus === 'unknown' && <p className="mt-1 text-xs font-medium text-white">{text.referenceOpening}</p>}
              {start && <p className="mt-1 text-xs text-white/80">{text.start}: {start}</p>}
              {end && <p className="mt-1 text-xs text-white/80">{text.end}: {end}</p>}
              {inbound !== null && <p className="mt-1 text-xs text-white/80">{text.inbound}: {inbound} {text.minutes}</p>}
              {outbound !== null && <p className="mt-1 text-xs text-white/80">{text.outbound}: {outbound} {text.minutes}</p>}
              <p className="mt-1 break-words text-xs text-white/80">{text.verification}: {option.verificationStatus}</p>
              {option.verificationStatus.split(',').map((status) => {
                const note = describeDietaryEvidence(status.trim(), lang);
                return note ? <p key={status} className="mt-1 text-xs text-white/80">{note}</p> : null;
              })}
              {option.checkedAt && <p className="mt-1 text-xs text-white/80">{text.checked}: {option.checkedAt}</p>}
              {option.repeatReason === 'verified_repeat' && <p className="mt-1 break-words text-xs text-white/80">{text.repeat}: {text.verifiedRepeat}</p>}
              {source && <a href={source} target="_blank" rel="noopener noreferrer" className="mt-1 inline-flex min-h-[44px] items-center text-xs text-purple-200 underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-purple-300">{text.source}</a>}
            </li>
          );
        })}
      </ul>
      {referenceOptions.length > 0 && <ul className="mt-2 space-y-2">
        {referenceOptions.slice(0, 3).map((option) => {
          const start = clockTime(option.startMin);
          const end = clockTime(option.endMin);
          const inbound = typeof option.inboundMin === 'number' && Number.isFinite(option.inboundMin) && option.inboundMin >= 0 ? option.inboundMin : null;
          const outbound = typeof option.outboundMin === 'number' && Number.isFinite(option.outboundMin) && option.outboundMin >= 0 ? option.outboundMin : null;
          return <li key={option.id} className="rounded-lg border border-white/10 bg-white/5 p-3">
            <p className="break-words text-sm font-medium">{option.name}</p>
            <p className="mt-1 text-xs font-medium text-white">{option.openingStatus === 'verified_open' ? text.referenceSchedule : text.referenceOpening}</p>
            {start && <p className="mt-1 text-xs text-white/80">{text.start}: {start}</p>}
            {end && <p className="mt-1 text-xs text-white/80">{text.end}: {end}</p>}
            {inbound !== null && <p className="mt-1 text-xs text-white/80">{text.inbound}: {inbound} {text.minutes}</p>}
            {outbound !== null && <p className="mt-1 text-xs text-white/80">{text.outbound}: {outbound} {text.minutes}</p>}
          </li>;
        })}
      </ul>}
    </section>
  );
}
