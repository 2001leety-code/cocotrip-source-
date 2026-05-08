// Step 5: 날짜 + 이름/연락처 + 공항/일정 필수 필드 · i18n
// 2026-05-08 (PR-W4 이슈 35): 픽업 시각 입력은 Step 3 (pickupTime select) 에서만 받는다.
// Step 5의 type="time" 입력은 Step 3과 중복 → 제거. 야간 할증 계산도 pickupTime 기준.
// 2026-05-08 (PR-W4 이슈 36): 차종(staria/sprinter/bus/vip)별 캐리어 합계 캡 적용.
//   Staria 6 (LPG 트렁크) / Sprinter 10 / Bus·VIP 무제한.
import type { WizardState, LodgingLocation, VehicleType } from './types';
import { EXTRA_CHARGES } from '@/data/charterPricing';
import { getWizardI18n } from './wizard-i18n';

/**
 * 차종별 캐리어 합계 최대치. Bus/VIP 는 협의 — 99 (사실상 무제한).
 * Staria LPG 트렁크 한계로 6개. Sprinter 는 좌석 뒤 + 트렁크 합쳐 10개.
 */
function vehicleLuggageMax(vehicle: VehicleType | undefined): number {
  switch (vehicle) {
    case 'staria': return 6;
    case 'sprinter': return 10;
    case 'bus':
    case 'vip':
    default: return 99;
  }
}

/** 차종별 안내 문구 i18n. luggageVehicleMax 키 (ko/en/ja/zh) — vehicleLuggageMax 값으로 치환. */
function vehicleLuggageNote(vehicle: VehicleType | undefined, max: number, lang: 'ko' | 'en' | 'ja' | 'zh'): string {
  if (vehicle === 'bus' || vehicle === 'vip') {
    if (lang === 'ko') return '버스/의전 차량은 캐리어 적재 협의 가능합니다.';
    if (lang === 'ja') return 'バス／VIP車両は積載数を相談できます。';
    if (lang === 'zh') return '巴士／礼宾车的行李数量可协商。';
    return 'Bus/VIP vehicles: luggage count negotiable.';
  }
  const vlabel =
    vehicle === 'staria' ? 'Staria' :
    vehicle === 'sprinter' ? 'Sprinter' : '';
  if (lang === 'ko') return `${vlabel}는 캐리어 최대 ${max}개까지 실을 수 있습니다 (기내 + 중형 + 대형 합계).`;
  if (lang === 'ja') return `${vlabel}は荷物最大${max}個まで（機内＋中型＋大型の合計）。`;
  if (lang === 'zh') return `${vlabel}最多可载行李${max}件（随身＋中型＋大型合计）。`;
  return `${vlabel} fits up to ${max} bags total (carry-on + medium + large).`;
}

/** 날짜+픽업시각이 12h cutoff 이내인지 클라이언트에서 검사 (KST +09:00 기준). */
function isWithin12hCutoff(date: string, time: string): boolean {
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const t = time && /^\d{2}:\d{2}$/.test(time) ? time : '09:00';
  const departure = new Date(`${date}T${t}:00+09:00`);
  if (isNaN(departure.getTime())) return false;
  const hoursLeft = (departure.getTime() - Date.now()) / 3_600_000;
  return hoursLeft <= 12 && hoursLeft > -1; // -1 은 이미 지난 경우 (서버에서 차단)
}

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

  // 픽업 시각은 Step 3 select 에서 입력 (pickupTime). Step 5에는 입력 없음.
  // 야간 할증 (18:00 이후 또는 06:00 이전) 표시도 pickupTime 기준.
  const pickup = state.pickupTime ?? state.startTime ?? '';
  const hour = pickup ? Number(pickup.slice(0, 2)) : -1;
  const isNight = hour >= 18 || (hour >= 0 && hour < 6);

  const airport = state.airport ?? {};
  const lug = airport.luggage ?? {};
  const patchAirport = (p: Partial<NonNullable<WizardState['airport']>>) =>
    patch({ airport: { ...airport, ...p } });
  const patchLuggage = (p: Partial<NonNullable<NonNullable<WizardState['airport']>['luggage']>>) =>
    patchAirport({ luggage: { ...lug, ...p } });

  // PR-W4 이슈 36: 차종별 캐리어 합계 캡. + 버튼 disabled + amber 안내.
  const luggageTotal = (lug.small ?? 0) + (lug.medium ?? 0) + (lug.large ?? 0);
  const luggageCap = vehicleLuggageMax(state.vehicle);
  const luggageMaxReached = luggageTotal >= luggageCap;
  const langCode: 'ko' | 'en' | 'ja' | 'zh' =
    language === 'ko' ? 'ko' : language === 'ja' ? 'ja' : language === 'zh' ? 'zh' : 'en';
  const luggageVehicleNote = vehicleLuggageNote(state.vehicle, luggageCap, langCode);
  const isInquiryVehicle = state.vehicle === 'bus' || state.vehicle === 'vip';

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

      {/* 날짜 (시간은 Step 3 픽업 시각 select 에서 단일 입력) */}
      <div>
        <Label>{i18n.date}</Label>
        <input type="date" min={today}
          value={state.startDate ?? ''}
          onChange={e => patch({ startDate: e.target.value })}
          className={inputCls} />
        {pickup && (
          <p className="text-[11px] text-white/45 mt-2 px-1">
            {i18n.bookingPickupTimeLabel}: <span className="text-white/70">{pickup}</span>
          </p>
        )}
      </div>

      {/* 12h cutoff 임박 경고 — 날짜+픽업시각 선택 후 12h 이내이면 amber 배너 */}
      {isWithin12hCutoff(state.startDate ?? '', pickup) && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-200 flex items-start gap-2">
          <span className="text-base leading-none">⚠️</span>
          <span>{i18n.bookingClosedMessage}</span>
        </div>
      )}

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
              <LuggageCounter label={i18n.luggageSmall}  value={lug.small ?? 0}  onChange={v => patchLuggage({ small: v })}  maxReached={luggageMaxReached} />
              <LuggageCounter label={i18n.luggageMedium} value={lug.medium ?? 0} onChange={v => patchLuggage({ medium: v })} maxReached={luggageMaxReached} />
              <LuggageCounter label={i18n.luggageLarge}  value={lug.large ?? 0}  onChange={v => patchLuggage({ large: v })}  maxReached={luggageMaxReached} />
            </div>
            {/* 차종별 캐리어 한계 안내 — Bus/VIP 는 무제한 협의, 그 외는 cap 도달 시 amber */}
            {!isInquiryVehicle && (
              <p className={`text-[11px] mt-2 px-1 leading-snug ${luggageMaxReached ? 'text-amber-300' : 'text-white/45'}`}>
                {luggageMaxReached ? '⚠ ' : ''}{luggageVehicleNote}
              </p>
            )}
            {isInquiryVehicle && (
              <p className="text-[11px] text-white/45 mt-2 px-1 leading-snug">{luggageVehicleNote}</p>
            )}
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

function LuggageCounter({ label, value, onChange, maxReached }: { label: string; value: number; onChange: (v: number) => void; maxReached?: boolean }) {
  // PR-W4 이슈 36: 합계 cap 도달 시 + 버튼 disabled (- 는 항상 활성).
  const plusDisabled = !!maxReached;
  return (
    <div className="flex flex-col gap-2">
      <span className="text-xs text-white/55 truncate">{label}</span>
      <div className="flex items-center justify-between px-3 py-2 rounded-xl border border-white/10 bg-white/[0.03]">
        <button type="button" onClick={() => onChange(Math.max(0, value - 1))} className="text-white/70 hover:text-white w-6 h-6 text-base disabled:opacity-30" disabled={value === 0}>−</button>
        <span className="text-base font-bold text-white">{value}</span>
        <button
          type="button"
          onClick={() => { if (!plusDisabled) onChange(Math.min(20, value + 1)); }}
          disabled={plusDisabled}
          className="text-white/70 hover:text-white w-6 h-6 text-base disabled:opacity-30 disabled:cursor-not-allowed"
        >+</button>
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
