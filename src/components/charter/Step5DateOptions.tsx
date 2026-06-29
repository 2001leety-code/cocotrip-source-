// Step 5: 날짜 + 이름/연락처 + 공항/일정 필수 필드 · i18n
// 2026-05-09 (batch 9 fix B9-19): 운영자 결정 — Staria=6/Sprinter=10 cap 제거.
//   캐리어 카운터 무제한 (99). 7개 초과 시 amber 안내 "차량 N대 권장 — 운영자 견적".
// 2026-05-09 (batch 9 fix B9-1+B9-2): 픽업 시각 입력을 Step 3 select 에서
//   Step 5 날짜 아래 type="time" 자유 입력으로 이동. 30분 단위 제약 해제.
//   야간 할증 자동 계산도 여기 onChange 에서 처리.
// 2026-05-10 (B-5/B-8 prod 검증): 캐리어 → 차량 수 동적 룰 (calcVehicleCount).
//   1-7개=1대, 8+=2대, 14+=3대, +6/대 선형. "봉고차" 라벨 금지 → "스타리아".
import { useState } from 'react';
import type { WizardState, LodgingLocation, VehicleType } from './types';
import { EXTRA_CHARGES } from '@/data/charterPricing';
import { getWizardI18n } from './wizard-i18n';
import { calcVehicleCount } from '@/lib/luggageVehicle';

/**
 * batch 9 (B9-19) + B-5/B-8 (2026-05-10 prod 검증):
 * 차종별 캐리어 cap 제거 (모두 실질 무제한). 8개 이상부터 차량 수 동적:
 *   1-7개 → 1대 (Staria), 8+ → 2대, 14+ → 3대, +6 마다 +1대 (선형).
 * "봉고차" 라벨 금지 (외국인 픽업 부적절) → "스타리아 N대" 사용.
 * Bus/VIP 는 협의 안내, 그 외는 calcVehicleCount(total) 동적 표시.
 */
function vehicleLuggageNote(
  vehicle: VehicleType | undefined,
  total: number,
  lang: 'ko' | 'en' | 'ja' | 'zh',
): string {
  const vehicles = calcVehicleCount(total);
  // 8개 이상 (= 차량 2대 이상 권장) — 운영자 견적 별도 (가격 ×2 자동 X)
  if (vehicles >= 2) {
    if (lang === 'ko') return `캐리어 ${total}개 — 차량 ${vehicles}대 권장 (스타리아). 운영자 견적 후 별도 안내.`;
    if (lang === 'ja') return `荷物${total}個 — 車両${vehicles}台推奨 (スターリア)。運営者見積後に別途案内。`;
    if (lang === 'zh') return `${total}件行李 — 建议${vehicles}辆车 (Staria)。运营审核后另议。`;
    return `${total} suitcases — ${vehicles} vehicles recommended (Staria). Separate quote after operator review.`;
  }
  if (vehicle === 'bus' || vehicle === 'vip') {
    if (lang === 'ko') return '버스/의전 차량은 캐리어 적재 협의 가능합니다.';
    if (lang === 'ja') return 'バス／VIP車両は積載数を相談できます。';
    if (lang === 'zh') return '巴士／礼宾车的行李数量可协商。';
    return 'Bus/VIP vehicles: luggage count negotiable.';
  }
  // 일반 차량 — 7개 이하 안내 (Staria 1대 충분, 8+ 시 위 분기)
  if (lang === 'ko') return '캐리어는 기내 + 중형 + 대형을 합쳐서 입력해 주세요. 8개 이상이면 차량 2대를 권장합니다 (스타리아).';
  if (lang === 'ja') return '荷物は機内＋中型＋大型の合計で入力してください。8個以上の場合は2台の車両を推奨します (スターリア)。';
  if (lang === 'zh') return '请合计输入随身＋中型＋大型行李。8件以上建议使用2辆车 (Staria)。';
  return 'Enter total luggage (carry-on + medium + large). 8+ bags: 2 vehicles recommended (Staria).';
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
  const isTransfer = state.service === 'transfer';
  const isICN     = state.origin === 'ICN';

  // batch 9 fix (B9-1+B9-2): 픽업 시각은 Step 5 type="time" 직접 입력 (날짜 아래).
  // 야간 할증 (18:00 이후 또는 06:00 이전) 자동 계산은 onChange 에서 처리.
  const pickup = state.pickupTime ?? state.startTime ?? '';
  const hour = pickup ? Number(pickup.slice(0, 2)) : -1;
  const isNight = hour >= 18 || (hour >= 0 && hour < 6);

  const airport = state.airport ?? {};
  const lug = airport.luggage ?? {};
  const patchAirport = (p: Partial<NonNullable<WizardState['airport']>>) =>
    patch({ airport: { ...airport, ...p } });
  const patchLuggage = (p: Partial<NonNullable<NonNullable<WizardState['airport']>['luggage']>>) =>
    patchAirport({ luggage: { ...lug, ...p } });

  // 항공편명 → 인천공항 공공API 도착정보 자동조회 (data.go.kr, /api/flight-status)
  const [flightLoading, setFlightLoading] = useState(false);
  const [flightErr, setFlightErr] = useState('');
  const apiLang = ({ ko: 'K', en: 'E', ja: 'J', zh: 'C' } as const)[language] || 'E';
  const arr = airport.arrival;
  const lookupFlight = async () => {
    const fn = (airport.flightNumber ?? '').trim().toUpperCase().replace(/\s+/g, '');
    if (!fn) return;
    setFlightLoading(true);
    setFlightErr('');
    try {
      const r = await fetch(`/api/flight-status?flightId=${encodeURIComponent(fn)}&lang=${apiLang}`);
      const j = await r.json();
      if (j.ok && j.found && j.flight) {
        const f = j.flight;
        patchAirport({
          terminal: f.terminal === 'T2' ? 'T2' : 'T1',
          arrival: {
            scheduledTime: f.scheduledTime, estimatedTime: f.estimatedTime,
            gate: f.gate, origin: f.origin, status: f.status, lookedUp: true,
          },
        });
      } else {
        setFlightErr(i18n.flightLookupFail);
      }
    } catch {
      setFlightErr(i18n.flightLookupFail);
    }
    setFlightLoading(false);
  };

  // batch 9 (B9-19): 캐리어 합계 cap 제거 (vehicleLuggageMax = 99 통합).
  // 7개 초과 시 vehicleLuggageNote 가 amber 안내 — "차량 2대 권장 (운영자 견적)".
  // + 버튼은 항상 활성 (실질 무제한). luggageOverThreshold 는 amber 색상 토글용.
  const luggageTotal = (lug.small ?? 0) + (lug.medium ?? 0) + (lug.large ?? 0);
  const luggageOverThreshold = luggageTotal >= 7;
  const langCode: 'ko' | 'en' | 'ja' | 'zh' =
    language === 'ko' ? 'ko' : language === 'ja' ? 'ja' : language === 'zh' ? 'zh' : 'en';
  const luggageVehicleNote = vehicleLuggageNote(state.vehicle, luggageTotal, langCode);

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

      {/* 메신저 연락처 (선택) */}
      <div>
        <Label>{i18n.customerMessenger}</Label>
        <input
          type="text"
          value={state.customerMessenger != null ? state.customerMessenger : ''}
          onChange={e => patch({ customerMessenger: e.target.value })}
          placeholder={i18n.customerMessengerPlaceholder}
          className={inputCls}
          maxLength={60}
        />
      </div>
      {/* 날짜 */}
      <div>
        <Label>{i18n.date}</Label>
        <input type="date" min={today}
          value={state.startDate ?? ''}
          onChange={e => patch({ startDate: e.target.value })}
          className={inputCls}
          style={{ colorScheme: 'dark' }} />
      </div>

      {/* batch 9 fix (B9-1+B9-2): 픽업 시각 직접 입력 — Step 3 select 에서 이동.
          type="time" 으로 30분 단위 제약 없이 자유 입력. 야간 할증 자동 계산. */}
      <div>
        <Label>{i18n.bookingPickupTimeLabel}</Label>
        <input
          type="time"
          value={pickup}
          onChange={e => {
            const t = e.target.value;
            const h = t && /^\d{2}:\d{2}$/.test(t) ? Number(t.slice(0, 2)) : -1;
            const night = h >= 18 || (h >= 0 && h < 6);
            patch({ pickupTime: t, options: { ...state.options, night } });
          }}
          placeholder="HH:mm"
          className={inputCls}
          style={{ colorScheme: 'dark' }} />
        <p className="text-[11px] text-white/45 mt-2 px-1 leading-snug">{i18n.bookingCutoffNote}</p>
      </div>

      {/* 12h cutoff 임박 경고 — 날짜+픽업시각 선택 후 12h 이내이면 amber 배너 */}
      {isWithin12hCutoff(state.startDate ?? '', pickup) && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-200 flex items-start gap-2">
          <span className="text-base leading-none">⚠️</span>
          <span>{i18n.bookingClosedMessage}</span>
        </div>
      )}

      {isTransfer && (
        <div>
          <Label>{i18n.tripTypeLabel}</Label>
          <div className="grid grid-cols-2 gap-2">
            {(['oneway', 'roundtrip'] as const).map(tt => {
              const selected = (state.tripType ?? 'oneway') === tt;
              return (
                <button key={tt} type="button"
                  onClick={() => patch({ tripType: tt })}
                  className={`py-3 px-3 rounded-xl text-sm font-medium border transition-colors ${selected ? 'border-[#B668FC] bg-[#B668FC]/15 text-white' : 'border-white/10 bg-white/[0.03] text-white/70 hover:border-[#B668FC]/40'}`}>
                  {tt === 'oneway' ? i18n.tripOneway : i18n.tripRoundtrip}
                </button>
              );
            })}
          </div>
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
              <div className="flex gap-2">
                <input
                  type="text"
                  value={airport.flightNumber ?? ''}
                  onChange={e => { patchAirport({ flightNumber: e.target.value.toUpperCase(), arrival: undefined }); setFlightErr(''); }}
                  placeholder={i18n.flightPlaceholder}
                  className={inputCls}
                  maxLength={10}
                />
                <button type="button" onClick={lookupFlight}
                  disabled={flightLoading || !(airport.flightNumber ?? '').trim()}
                  className="shrink-0 px-4 rounded-xl text-sm font-bold border border-[#B668FC] bg-[#B668FC]/15 text-white disabled:opacity-40">
                  {flightLoading ? '…' : i18n.flightLookup}
                </button>
              </div>
              <p className="text-[11px] text-white/45 mt-1.5">{i18n.flightLookupHint}</p>
              {flightErr && <p className="text-[11px] text-amber-300 mt-1">{flightErr}</p>}
              {arr?.lookedUp && (
                <div className="mt-2 px-3 py-2 rounded-xl bg-[#B668FC]/10 border border-[#B668FC]/25 text-[12px] text-white/85">
                  ✈ {i18n.flightArrivalLabel} <b>{arr.estimatedTime || arr.scheduledTime}</b>
                  {arr.origin ? ` · ${arr.origin}` : ''}{arr.gate ? ` · Gate ${arr.gate}` : ''}
                  {arr.status ? ` · ${arr.status}` : ''}
                </div>
              )}
            </div>
          </div>

          <div>
            <Label>{i18n.luggage}</Label>
            <div className="grid grid-cols-3 gap-3">
              <LuggageCounter label={i18n.luggageSmall}  value={lug.small ?? 0}  onChange={v => patchLuggage({ small: v })} />
              <LuggageCounter label={i18n.luggageMedium} value={lug.medium ?? 0} onChange={v => patchLuggage({ medium: v })} />
              <LuggageCounter label={i18n.luggageLarge}  value={lug.large ?? 0}  onChange={v => patchLuggage({ large: v })} />
            </div>
            {/* batch 9 (B9-19): 7개 초과 시 amber 배너 — "차량 2대 권장 (운영자 견적)".
                Bus/VIP 는 협의 가능 안내. 그 외 7개 미만은 차분한 흰색 안내. */}
            <p className={`text-[11px] mt-2 px-1 leading-snug ${luggageOverThreshold ? 'text-amber-300' : 'text-white/45'}`}>
              {luggageOverThreshold ? '⚠ ' : ''}{luggageVehicleNote}
            </p>
          </div>
        </div>
      )}

      {/* 옵션 */}
      <div className="pt-4 border-t border-white/[0.06]">
        <Label>{i18n.addons}</Label>
        <div className="flex flex-wrap gap-2">
          {/* P1 #9 fix (2026-05-12): sprinter 는 guide_required 자동 가산 → licensedGuide 옵션 숨김.
              사용자가 두 번 가산되는 혼란 차단. 백엔드 (useQuoteCalculator) 도 dedup. */}
          {state.vehicle !== 'sprinter' && (
            <OptionPill label={i18n.licensedGuide} sub={`+₩${EXTRA_CHARGES.englishGuidePerDay.toLocaleString('ko-KR')}`}
              checked={!!state.options?.licensedGuide} onChange={v => patch({ options: { ...state.options, licensedGuide: v } })} />
          )}
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
  // batch 9 (B9-19): cap 제거 — + 버튼 항상 활성. - 만 0 에서 disabled.
  // 7개 초과 amber 안내는 부모(Step5DateOptions) 에서 처리.
  return (
    <div className="flex flex-col gap-2">
      <span className="text-xs text-white/55 truncate">{label}</span>
      <div className="flex items-center justify-between px-3 py-2 rounded-xl border border-white/10 bg-white/[0.03]">
        <button type="button" onClick={() => onChange(Math.max(0, value - 1))} className="text-white/70 hover:text-white w-11 h-11 text-base disabled:opacity-30" disabled={value === 0}>−</button>
        <span className="text-base font-bold text-white">{value}</span>
        <button
          type="button"
          onClick={() => onChange(Math.min(99, value + 1))}
          className="text-white/70 hover:text-white w-11 h-11 text-base"
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
