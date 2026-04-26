// Step 3: 목적지 선택 — Step1(출발)+Step2(서비스)에 따라 동적 옵션 · i18n
import { useMemo } from 'react';
import {
  AIRPORT_TRANSFER_PRICES,
  DAILY_TOUR_PRICES,
  KPOP_SHUTTLE,
  DISTANCE_MATRIX,
} from '@/data/charterPricing';
import type { WizardState } from './types';
import { getWizardI18n } from './wizard-i18n';
import { normalizeDestinationToMatrixKey } from './destinationKeyMap';

interface DestinationOption {
  key: string;
  title: string;
  sub?: string;
}

interface Props {
  state: WizardState;
  patch: (p: Partial<WizardState>) => void;
  language?: 'ko' | 'en' | 'ja' | 'zh';
}

export function Step3Destination({ state, patch, language = 'en' }: Props) {
  const lang: 'ko' | 'en' = language === 'ko' ? 'ko' : 'en';
  const i18n = getWizardI18n(language);

  const options: DestinationOption[] = useMemo(() => {
    const list: DestinationOption[] = [];

    if (state.service === 'airport_transfer') {
      if (state.origin === 'ICN') {
        for (const [key, dest] of Object.entries(AIRPORT_TRANSFER_PRICES)) {
          const d = dest as { ko: string; en: string; priceKRW: number; durationMin: number };
          list.push({
            key,
            title: lang === 'ko' ? d.ko : d.en,
            sub: `₩${d.priceKRW.toLocaleString('ko-KR')} · ~${d.durationMin}${i18n.minutesUnit}`,
          });
        }
      } else if (state.origin) {
        const matrix = DISTANCE_MATRIX as Record<string, { km?: number; hours?: number; priceKRW?: number }>;
        for (const k of Object.keys(matrix)) {
          if (k === 'comment') continue;
          if (!k.startsWith(`${state.origin}→`)) continue;
          const v = matrix[k];
          const destKey = k.split('→')[1];
          list.push({
            key: destKey,
            title: destKey,
            sub: v.priceKRW ? `₩${v.priceKRW.toLocaleString('ko-KR')} · ${v.km}km` : `${v.km}km · ~${v.hours}h`,
          });
        }
      }
    } else if (state.service === 'day_tour') {
      for (const [key, tour] of Object.entries(DAILY_TOUR_PRICES)) {
        const t = tour as { ko: string; en: string; priceKRW: number; hours: number };
        list.push({ key, title: lang === 'ko' ? t.ko : t.en, sub: `₩${t.priceKRW.toLocaleString('ko-KR')} · ${t.hours}h` });
      }
    } else if (state.service === 'multi_day') {
      const matrix = DISTANCE_MATRIX as Record<string, { km?: number; hours?: number; priceKRW?: number }>;
      for (const k of Object.keys(matrix)) {
        if (k === 'comment') continue;
        if (!k.startsWith(`${state.origin ?? 'SEL_METRO'}→`)) continue;
        const v = matrix[k];
        if ((v.km ?? 0) < 100) continue;
        const destKey = k.split('→')[1];
        list.push({ key: destKey, title: destKey, sub: `${v.km}km · ~${v.hours}h` });
      }
    } else if (state.service === 'kpop_shuttle') {
      for (const venue of KPOP_SHUTTLE.venues) {
        list.push({ key: venue.name, title: lang === 'ko' ? venue.name : venue.nameEn, sub: lang === 'ko' ? venue.location : venue.locationEn });
      }
    }
    return list;
  }, [state.service, state.origin, lang, i18n.minutesUnit]);

  return (
    <div className="space-y-5">
      {options.length === 0 && (
        <p className="text-sm text-white/55 py-4">{i18n.selectOriginFirst}</p>
      )}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {options.map(opt => {
          const selected = state.destinationKey === opt.key;
          return (
            <button
              key={opt.key}
              type="button"
              onClick={() => patch({ destinationKey: opt.key, destinationCustom: undefined })}
              className={`p-4 rounded-xl border text-left transition-all ${
                selected ? 'border-[#B668FC] bg-[#B668FC]/10' : 'border-white/10 bg-white/[0.03] hover:border-[#B668FC]/40'
              }`}
            >
              <p className="text-sm text-white/90 font-medium truncate">{opt.title}</p>
              {opt.sub && <p className="text-xs text-white/55 mt-1">{opt.sub}</p>}
            </button>
          );
        })}
      </div>

      <div className="pt-4 border-t border-white/[0.06]">
        <label className="block text-xs uppercase tracking-wider text-white/55 mb-2 font-semibold">{i18n.destCustomLabel}</label>
        <input
          type="text"
          value={state.destinationCustom ?? ''}
          onChange={e => patch({ destinationKey: undefined, destinationCustom: e.target.value })}
          placeholder={i18n.destCustomPlaceholder}
          className="w-full px-4 py-3 rounded-xl border border-white/12 bg-white/[0.03] text-white/85 text-sm placeholder:text-white/55 outline-none focus:border-[#B668FC]/40"
        />
        {state.destinationCustom && state.destinationCustom.length >= 2 && (
          (() => {
            const matched = normalizeDestinationToMatrixKey(state.destinationCustom);
            if (matched) {
              return (
                <p className="mt-3 text-xs text-emerald-300">
                  ✓ {i18n.destCustomMatched(matched)}
                </p>
              );
            }
            return (
              <p className="mt-3 text-xs text-amber-300">
                ⚠ {i18n.destCustomUnmatched}
              </p>
            );
          })()
        )}
      </div>
    </div>
  );
}
