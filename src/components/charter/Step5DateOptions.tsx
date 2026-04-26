// Step 5: 날짜·시간(직접 입력) + 이름/연락처 + 공항/일정 필수 필드 · i18n
import type { WizardState, LodgingLocation } from './types';
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

  // 시간 직접 입력 — HTML5 type="time" + 야간 자동 계산
  const handleTimeChange = (t: string) => {
    if (!t) {
      patch({ startTime: undefined, options: { ...state.options, night: false } });
      return;
    }
    const h = Number(t.slice(0, 2));
    patch({ startTime: t, options: { ...state.options, night: h >= 18 || h < 6 } });
  };

  return (
    <div className="space-y-6">
      {/* 이름 */}
      <div>
        <Label>{i18n.customerName}</Label>
        <input
          type="text"
          value={state.customerName ?? ''}
          onChange={e => patch({ customerName: e.target.value })}
          placeholder={i18n.customerNamePlaceholder}
          className={inputCls}
          maxLength={40}
        />
      </div>

      {/* 연락처 */}
      <div>
        <Label>{i18n.customerPhone}</Label>
        <input
          type="tel"
          value={state.customerPhone ?? ''}
          onChange={e => patch({ customerPhone: e.target.value })}
          placeholder={i18n.customerPhonePlaceholder}
          className={inputCls}
          maxLength={24}
        />
      </div>

      {/* 날짜 + 시간 (50/50) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <Label>{i18n.date}</Label>
          <input type="date" min={today}
            value={state.startDate ?? ''}
            onChange={e => patch({ startDate: e.target.value })}
            className={inputCls} />
        </div>
        <div>
          <Label>{i18n.time}</Label>
          <input
            type="time"
            value={state.startTime ?? ''}
            onChange={e => handleTimeChange(e.target.value)}
            className={inputCls}
            step={300}
          />
        </div>
      </div>

      {isMulti && (
        <>
          <div>
            <Label>{i18n.returnDate}</Label>
            <input type="date" min={state.startDate ?? today}
              value={state.endDate ?? ''}
              onChange={e => patch({ endDate: e.target.value })}
              className={inputCls} />
          </div>

          {/* multi_day 숙소 위치 */}
          <div>
            <Label>{i18n.lodgingLabel}</Label>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              {(['seoul', 'local', 'daily_return'] as LodgingLocation[]).map(loc => {
                const selected = state.lodgingLocation === loc;
                const text = loc === 'seoul' ? i18n.lodgingSeoul : loc === 'local' ? i18n.lodgingLocal : i18n.lodgingDailyReturn;
                return (
                  <button key={loc} type="button"
                    onClick={() => patch({ lodgingLocation: loc })}
                    className={`py-3 px-3 rounded-xl text-sm font-medium border transition-colors ${selected ? 'border-[#B668FC] bg-[#B668FC]/15 text-white' : 'border-white/10 bg-white/[0.03] text-white/70 hover:border-[#B668FC]/40'}`}>
                    {text}
                  </button>
                );
              })}
            </div>
            <p className="text-xs text-white/55 mt-2">{i18n.lodgingNote}</p>
          </div>
        </>
      )}

      {/* 공항 전용 필수 섹션 */}
      {isAirport && (
        <div className="pt-4 border-t border-white/[0.06] space-y-4">
          <p className="text-xs uppercase tracking-wider text-[#B668FC] font-bold">{i18n.airportDetails}</p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {isICN && (
              <div>
                <Label>{i18n.terminal}</Label>
                <div className="grid grid-cols-2 gap-2">
                  {(['T1', 'T2'] as const).map(t => (
                    <button key={t} type="button"
                      onClick={() => patchAirport({ terminal: t })}
                      className={`py-3 rounded-xl text-sm font-bold border ${airport.terminal === t ? 'border-[#B668FC] bg-[#B668FC]/15 text-white' : 'border-white/10 bg-white/[0.03] text-white/60'}`}>
                      {t}
                    </button>
                  ))}
                </div>
              </div>
            )}
            <div className={isICN ? '' : 'sm:col-span-2'}>
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
            <div className="grid grid-cols-3 gap-3">
              <LuggageCounter label={i18n.luggageSmall}  value={lug.small ?? 0}  onChange={v => patchLuggage({ small: v })} />
              <LuggageCounter label={i18n.luggageMedium} value={lug.medium ?? 0} onChange={v => patchLuggage({ medium: v })} />
              <LuggageCounter label={i18n.luggageLarge}  value={lug.large ?? 0}  onChange={v => patchLuggage({ large: v })} />
            </div>
          </div>
        </div>
      )}

      {/* 옵션 */}
      <div className="pt-4 border-t border-white/[0.06]">
        <Label>{i18n.addons}</Label>
        <div className="flex flex-wrap gap-2">
          <OptionPill label={i18n.licensedGuide} sub={`+₩${EXTRA_CHARGES.englishGuidePerDay.toLocaleString('ko-KR')}`}
            checked={!!state.options?.licensedGuide} onChange={v => patch({ options: { ...state.options, licensedGuide: v } })} />
          <OptionPill label={i18n.picket} sub={`+₩${EXTRA_CHARGES.airportPicketService.toLocaleString('ko-KR')}`}
            checked={!!state.options?.airportPicket} onChange={v => patch({ options: { ...state.options, airportPicket: v } })} />
          <OptionPill label={i18n.childSeat} sub={`+₩${EXTRA_CHARGES.childSeatPerTrip.toLocaleString('ko-KR')}`}
            checked={!!state.options?.childSeat} onChange={v => patch({ options: { ...state.options, childSeat: v } })} />
        </div>
        {isNight && (
          <p className="text-xs text-amber-300 mt-3">⚠ {i18n.nightWarn(EXTRA_CHARGES.nightSurchargePercent)}</p>
        )}
      </div>

      {/* 메모 */}
      <div>
        <Label>{i18n.notes}</Label>
        <textarea
          value={state.notes ?? ''}
          onChange={e => patch({ notes: e.target.value })}
          rows={2}
          className={`${inputCls} resize-none`}
          placeholder={i18n.notesPlaceholder}
        />
      </div>
    </div>
  );
}

const inputCls = 'w-full px-4 py-3 rounded-xl border border-white/10 bg-white/[0.03] text-white/90 text-sm outline-none focus:border-[#B668FC]/50';

function Label({ children }: { children: React.ReactNode }) {
  return <p className="text-xs uppercase tracking-wider text-white/55 mb-2 font-semibold">{children}</p>;
}

function LuggageCounter({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <div className="flex flex-col gap-2">
      <span className="text-xs text-white/55 truncate">{label}</span>
      <div className="flex items-center justify-between px-3 py-2 rounded-xl border border-white/10 bg-white/[0.03]">
        <button type="button" onClick={() => onChange(Math.max(0, value - 1))} className="text-white/70 hover:text-white w-6 h-6 text-base">−</button>
        <span className="text-base font-bold text-white">{value}</span>
        <button type="button" onClick={() => onChange(Math.min(20, value + 1))} className="text-white/70 hover:text-white w-6 h-6 text-base">+</button>
      </div>
    </div>
  );
}

function OptionPill({ label, sub, checked, onChange }: { label: string; sub: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className={`flex items-center gap-2 px-4 py-2.5 rounded-full text-sm font-medium border transition-colors ${
        checked ? 'border-[#B668FC] bg-[#B668FC]/15 text-white' : 'border-white/10 bg-white/[0.03] text-white/70 hover:border-[#B668FC]/40'
      }`}
    >
      <span className={`w-4 h-4 rounded border ${checked ? 'border-[#B668FC] bg-[#B668FC]' : 'border-white/30'} flex items-center justify-center shrink-0`}>
        {checked && <span className="w-1.5 h-1.5 rounded-sm bg-white" />}
      </span>
      <span>{label}</span>
      <span className="text-white/55 text-xs">{sub}</span>
    </button>
  );
}
