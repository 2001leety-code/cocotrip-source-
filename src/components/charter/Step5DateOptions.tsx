// Step 5: 날짜 + 일정(트립타입·멀티데이) + 옵션 + 트립닷컴식 예약정보(BookingInfoForm) · i18n
// 2026-06-29 (방법 A): 고객정보 입력 UI(이름/연락처/메신저/미팅장소/항공편/수하물/메모)를
//   BookingInfoForm 으로 교체. 결제·SMS·가격엔진 무수정 — 정보 UI 만 통합.
//   가격에 영향 주는 스케줄 필드(날짜·픽업시각·트립타입·멀티데이·옵션 핀)는 BookingInfoForm 위에 유지.
//   BookingInfoForm 은 hideCta(결제는 wizard nav/PaymentPanel 담당)·hideAddons·hideDiscount(차터 옵션은
//   아래 옵션 핀에서 가산)로 렌더하고, footerSlot 에 BookingConsent(SMS 인증+약관) 를 배치.
//   ⚠️ 표시가=청구가(P311): totalStr/usdStr/baseStr 은 quote.subtotalKRW 파생만, 재계산 금지.
//
// 2026-05-09 (batch 9 fix B9-19): 운영자 결정 — Staria=6/Sprinter=10 cap 제거.
//   캐리어 카운터 무제한 (99). 8개 이상 시 amber 안내 "차량 N대 권장 — 운영자 견적".
// 2026-05-09 (batch 9 fix B9-1+B9-2): 픽업 시각 입력을 Step 3 select 에서
//   Step 5 날짜 아래 type="time" 자유 입력으로 이동. 30분 단위 제약 해제.
//   야간 할증 자동 계산도 여기 onChange 에서 처리.
import type { ReactNode } from 'react';
import type { WizardState, LodgingLocation, VehicleType, QuoteBreakdown } from './types';
import { EXTRA_CHARGES, CHARTER_USD_FIX_RATE } from '@/data/charterPricing';
import { getWizardI18n } from './wizard-i18n';
import { calcVehicleCount } from '@/lib/luggageVehicle';
import { BookingInfoForm, type BookingFormData } from '@/components/booking/BookingInfoForm';

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

const formatKRW = (n: number) => `₩${Math.round(n).toLocaleString('ko-KR')}`;
// 차터 USD 표시 = 백 createPaypalOrder 청구와 동일 고정환율(CHARTER_USD_FIX_RATE 1400) → 표시가==청구가.
const formatCharterUSD = (krw: number) => `≈ $${Math.round(krw / CHARTER_USD_FIX_RATE).toLocaleString('en-US')} USD`;

interface Props {
  state: WizardState;
  patch: (p: Partial<WizardState>) => void;
  language?: 'ko' | 'en' | 'ja' | 'zh';
  // 2026-06-29 (방법 A) — 트립닷컴식 예약정보 통합:
  //   quote: 표시가(파생)·요약 표기용. footerSlot: BookingConsent(SMS+약관) — wizard 가 소유.
  //   termsAgreed: 약관 SSOT 단일 상태(wizard) — BookingInfoForm 의 단일 동의와 동기.
  quote?: QuoteBreakdown | null;
  footerSlot?: ReactNode;
  termsAgreed?: boolean;
  onTermsChange?: (agreed: boolean) => void;
}

const toISO = (d: Date) => d.toISOString().slice(0, 10);

export function Step5DateOptions({ state, patch, language = 'en', quote, footerSlot, termsAgreed, onTermsChange }: Props) {
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
  const patchAirport = (p: Partial<NonNullable<WizardState['airport']>>) =>
    patch({ airport: { ...airport, ...p } });
  const langCode: 'ko' | 'en' | 'ja' | 'zh' =
    language === 'ko' ? 'ko' : language === 'ja' ? 'ja' : language === 'zh' ? 'zh' : 'en';

  // ── BookingInfoForm 표시 텍스트 (가격은 quote.subtotalKRW 파생만 — P311 재계산 금지) ──────
  const subtotalKRW = quote && !quote.needsCustomQuote ? quote.subtotalKRW : 0;
  const baseChargeKRW = quote ? quote.vehicleChargeKRW : 0;
  const totalStr = subtotalKRW > 0 ? formatKRW(subtotalKRW) : '—';
  const usdStr = subtotalKRW > 0 ? formatCharterUSD(subtotalKRW) : '';
  const baseStr = baseChargeKRW > 0 ? formatKRW(baseChargeKRW) : '—';
  const meetingLabel = isAirport
    ? (language === 'ko' ? '미팅 장소' : language === 'ja' ? 'ミーティング場所' : language === 'zh' ? '会面地点' : 'Meeting point')
    : (language === 'ko' ? '픽업 장소' : language === 'ja' ? 'ピックアップ場所' : language === 'zh' ? '上车地点' : 'Pickup location');

  // BookingInfoForm 입력값 → WizardState patch (가격 무영향 필드만 매핑).
  //   영문 성·이름 → customerName 결합 / phone 은 onPhoneChange 로 별도 controlled /
  //   미팅장소·메모 → 매핑 / 메신저 → customerMessenger / 항공편·수하물 → state.airport (공항 서비스 시).
  // ⚠️ 비파괴(non-destructive): BookingInfoForm 은 마운트 시 빈 f 로 onFieldsChange 를 1회 emit 하므로
  //   값이 빈 필드를 그대로 patch 하면 프로필 prefill(customerName 등)을 덮어쓴다. → 입력값이 있을 때만 patch.
  const handleFieldsChange = (d: BookingFormData) => {
    const next: Partial<WizardState> = {};
    const fullName = `${d.lastName} ${d.firstName}`.trim();
    if (fullName) next.customerName = fullName;
    if (d.messengerId) next.customerMessenger = `${d.messenger}: ${d.messengerId}`;
    if (d.notes) next.notes = d.notes;
    if (isAirport) {
      const lugTotal = d.lugSmall + d.lugMedium + d.lugLarge;
      if (d.flightNo || lugTotal > 0) {
        next.airport = {
          ...airport,
          ...(d.flightNo ? { flightNumber: d.flightNo } : {}),
          ...(lugTotal > 0 ? { luggage: { small: d.lugSmall, medium: d.lugMedium, large: d.lugLarge } } : {}),
        };
      }
    }
    if (Object.keys(next).length > 0) patch(next);
  };

  return (
    <div className="space-y-6">
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

      {/* ICN 공항 터미널 선택 — canAdvance 게이트(origin==='ICN' 시 terminal 필수)용.
          BookingInfoForm 은 터미널 입력이 없으므로 여기서 유지. 편명·수하물은 BookingInfoForm 이 수집. */}
      {isAirport && isICN && (
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

      {/* 옵션 (가격 가산 — useQuoteCalculator 가 읽음. BookingInfoForm hideAddons 와 별개) */}
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
        {/* 공항 서비스 시 수하물 → 차량 수 권장 안내 (BookingInfoForm 캐리어 카운터 입력값 기준) */}
        {isAirport && (() => {
          const lug = state.airport?.luggage ?? {};
          const total = (lug.small ?? 0) + (lug.medium ?? 0) + (lug.large ?? 0);
          return (
            <p className={`text-[11px] mt-3 px-1 leading-snug ${total >= 7 ? 'text-amber-300' : 'text-white/45'}`}>
              {total >= 7 ? '⚠ ' : ''}{vehicleLuggageNote(state.vehicle, total, langCode)}
            </p>
          );
        })()}
      </div>

      {/* 트립닷컴식 예약정보 (방법 A) — 이름/연락처/메신저/미팅장소/항공편/수하물/메모 입력 UI.
          결제·SMS·가격·약관 게이트는 wizard 가 소유 — BookingInfoForm 은 입력 UI 만 제공.
          phone 은 state.customerPhone controlled, 약관은 termsAgreed SSOT 동기, addon/할인/CTA 숨김.
          footerSlot 에 BookingConsent(SMS) 렌더 (결제 버튼은 wizard nav 가 소유). */}
      <div className="pt-2 border-t border-white/[0.06]">
        <BookingInfoForm
          eyebrow={i18n.step5}
          title={state.destinationKey ?? state.destinationCustom ?? (state.origin ?? '')}
          dateText={`${state.startDate ?? '-'}${pickup ? ` ${pickup}` : ''}`}
          paxText={`${state.paxCount ?? '-'}${i18n.maxUnit}`}
          isAirport={isAirport}
          meetingLabel={meetingLabel}
          baseStr={baseStr}
          meetingStr=""
          childSeatStr=""
          totalStr={totalStr}
          usdStr={usdStr}
          ctaLabel={i18n.payProceed}
          phone={state.customerPhone ?? ''}
          onPhoneChange={(v) => patch({ customerPhone: v })}
          externalAgreeAll={termsAgreed}
          onAgreeAllChange={onTermsChange}
          onFieldsChange={handleFieldsChange}
          hideAddons
          hideDiscount
          hideCta
          onSubmit={() => { /* 결제는 wizard nav 의 결제 버튼이 담당 (PaymentPanel) */ }}
          footerSlot={footerSlot}
        />
      </div>
    </div>
  );
}

const inputCls = 'w-full px-4 py-3 rounded-xl border border-white/10 bg-white/[0.03] text-white/90 text-sm outline-none focus:border-[#B668FC]/50';

function Label({ children }: { children: React.ReactNode }) {
  return <p className="text-xs uppercase tracking-wider text-white/55 mb-2 font-semibold">{children}</p>;
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
