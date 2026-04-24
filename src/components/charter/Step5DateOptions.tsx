// Step 5: 날짜·시간 + 공항/일정 필수 필드 (컴팩트 · i18n)
import type { WizardState } from './types';
import { EXTRA_CHARGES } from '@/data/charterPricing';
import { getWizardI18n } from './wizard-i18n';

interface Props {
  state: WizardState;
  patch: (p: Partial<WizardState>) => void;
  language?: 'ko' | 'en' | 'ja' | 'zh';
}

const toISO = (d: Date) => d.toISOString().slice(0, 10);

export function Step5DateOptions({ state, patch, language = 'en' }: Props) {
  const i18n = getWizardI18n(language);
  const today = toISO(new Date());
  const isAirport = state.service === 'airport_transfer';
  const isMulti   = state.service === 'multi_day';
  const isICN     = state.origin === 'ICN';

  const hour = state.startTime ? Number(state.startTime.slice(0, 2)) : -1;
  const isNight = hour >= 18 || (hour >= 0 && hour < 6);

  const airport = state.airport ?? {};
  const lug = airport.luggage ?? {};
  const patchAirport = (p: Partial<NonNullable<WizardState['airport']>>) =>
    patch({ airport: { ...airport, ...p } });
  const patchLuggage = (p: Partial<NonNullable<NonNullable<WizardState['airport']>['luggage']>>) =>
    patchAirport({ luggage: { ...lug, ...p } });

  return (
    <div className="space-y-3 text-sm">
      {/* 날짜 + 시간 한 줄 */}
      <div className="grid grid-cols-5 gap-2 items-end">
        <div className="col-span-2">
          <Label>{i18n.date}</Label>
          <input type="date" min={today}
            value={state.startDate ?? ''}
            onChange={e => patch({ startDate: e.target.value })}
            className={inputCls} />
        </div>
        <div className="col-span-3">
          <Label>{i18n.time}</Label>
          <div className="grid grid-cols-4 gap-1">
            {['08:00', '10:00', '14:00', '18:00'].map(t => (
              <button key={t} type="button"
                onClick={() => patch({ startTime: t, options: { ...state.options, night: Number(t.slice(0,2)) >= 18 || Number(t.slice(0,2)) < 6 } })}
                className={`py-2 rounded-lg text-[11px] font-medium border ${state.startTime === t ? 'border-[#B668FC] bg-[#B668FC]/15 text-white' : 'border-white/10 bg-white/[0.03] text-white/60'}`}>
                {t}
              </button>
            ))}
          </div>
        </div>
      </div>

      {isMulti && (
        <div>
          <Label>{i18n.returnDate}</Label>
          <input type="date" min={state.startDate ?? today}
            value={state.endDate ?? ''}
            onChange={e => patch({ endDate: e.target.value })}
            className={inputCls} />
        </div>
      )}

      {/* 공항 전용 필수 섹션 */}
      {isAirport && (
        <div className="pt-2 mt-1 border-t border-white/[0.06] space-y-2.5">
          <p className="text-[10px] uppercase tracking-wider text-[#B668FC] font-bold">{i18n.airportDetails}</p>

          <div className="grid grid-cols-2 gap-2">
            {isICN && (
              <div>
                <Label>{i18n.terminal}</Label>
                <div className="grid grid-cols-2 gap-1">
                  {(['T1', 'T2'] as const).map(t => (
                    <button key={t} type="button"
                      onClick={() => patchAirport({ terminal: t })}
                      className={`py-2 rounded-lg text-xs font-bold border ${airport.terminal === t ? 'border-[#B668FC] bg-[#B668FC]/15 text-white' : 'border-white/10 bg-white/[0.03] text-white/60'}`}>
                      {t}
                    </button>
                  ))}
                </div>
              </div>
            )}
            <div className={isICN ? '' : 'col-span-2'}>
              <Label>{i18n.flightNo}</Label>
              <input
                type="text"
                value={airport.flightNumber ?? ''}
                onChange={e => patchAirport({ flightNumber: e.target.value.toUpperCase() })}
                placeholder={i18n.flightPlaceholder}
                className={inputCls}
                maxLength={10}
              />
            </div>
          </div>

          <div>
            <Label>{i18n.luggage}</Label>
            <div className="grid grid-cols-3 gap-2">
              <LuggageCounter label={i18n.luggageSmall}  value={lug.small ?? 0}  onChange={v => patchLuggage({ small: v })} />
              <LuggageCounter label={i18n.luggageMedium} value={lug.medium ?? 0} onChange={v => patchLuggage({ medium: v })} />
              <LuggageCounter label={i18n.luggageLarge}  value={lug.large ?? 0}  onChange={v => patchLuggage({ large: v })} />
            </div>
          </div>
        </div>
      )}

      {/* 옵션 pill */}
      <div className="pt-2 border-t border-white/[0.06]">
        <Label>{i18n.addons}</Label>
        <div className="flex flex-wrap gap-1.5">
          <OptionPill label={i18n.englishGuide} sub={`+₩${EXTRA_CHARGES.englishGuidePerDay.toLocaleString('ko-KR')}`}
            checked={!!state.options?.englishGuide} onChange={v => patch({ options: { ...state.options, englishGuide: v } })} />
          <OptionPill label={i18n.picket} sub={`+₩${EXTRA_CHARGES.airportPicketService.toLocaleString('ko-KR')}`}
            checked={!!state.options?.airportPicket} onChange={v => patch({ options: { ...state.options, airportPicket: v } })} />
          <OptionPill label={i18n.childSeat} sub={`+₩${EXTRA_CHARGES.childSeatPerTrip.toLocaleString('ko-KR')}`}
            checked={!!state.options?.childSeat} onChange={v => patch({ options: { ...state.options, childSeat: v } })} />
        </div>
        {isNight && (
          <p className="text-[10px] text-amber-300 mt-1.5">⚠ {i18n.nightWarn(EXTRA_CHARGES.nightSurchargePercent)}</p>
        )}
      </div>

      <textarea
        value={state.notes ?? ''}
        onChange={e => patch({ notes: e.target.value })}
        rows={1}
        className={`${inputCls} resize-none`}
        placeholder={i18n.notesPlaceholder}
      />
    </div>
  );
}

const inputCls = 'w-full px-3 py-2 rounded-lg border border-white/10 bg-white/[0.03] text-white/85 text-xs outline-none focus:border-[#B668FC]/50';

function Label({ children }: { children: React.ReactNode }) {
  return <p className="text-[10px] uppercase tracking-wider text-white/40 mb-1 font-semibold">{children}</p>;
}

function LuggageCounter({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[10px] text-white/45 truncate">{label}</span>
      <div className="flex items-center justify-between px-2 py-1.5 rounded-lg border border-white/10 bg-white/[0.03]">
        <button type="button" onClick={() => onChange(Math.max(0, value - 1))} className="text-white/60 hover:text-white w-5 h-5">−</button>
        <span className="text-sm font-bold text-white">{value}</span>
        <button type="button" onClick={() => onChange(Math.min(20, value + 1))} className="text-white/60 hover:text-white w-5 h-5">+</button>
      </div>
    </div>
  );
}

function OptionPill({ label, sub, checked, onChange }: { label: string; sub: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-full text-[11px] font-medium border transition-colors ${
        checked ? 'border-[#B668FC] bg-[#B668FC]/15 text-white' : 'border-white/10 bg-white/[0.03] text-white/55'
      }`}
    >
      <span className={`w-3 h-3 rounded border ${checked ? 'border-[#B668FC] bg-[#B668FC]' : 'border-white/30'} flex items-center justify-center`}>
        {checked && <span className="w-1 h-1 rounded-sm bg-white" />}
      </span>
      <span>{label}</span>
      <span className="text-white/35 text-[10px]">{sub}</span>
    </button>
  );
}
