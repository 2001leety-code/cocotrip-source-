// Step 5: 날짜 + 일정(트립타입·멀티데이) + 옵션 + 트립닷컴식 예약정보(BookingInfoForm) · i18n
// 2026-06-29 (방법 A): 고객정보 입력 UI(이름/연락처/메신저/미팅장소/항공편/수하물/메모)를
//   BookingInfoForm 으로 교체. 결제·SMS·가격엔진 무수정 — 정보 UI 만 통합.
//   가격에 영향 주는 스케줄 필드(날짜·픽업시각·트립타입·멀티데이·옵션 핀)는 BookingInfoForm 위에 유지.
//   BookingInfoForm 은 hideCta(결제는 wizard nav/PaymentPanel 담당)·hideAddons·hideDiscount(차터 옵션은
//   아래 옵션 핀에서 가산)로 렌더. SMS 본인인증(BookingConsent)은 제거 (2026-06-30 운영자) — footerSlot 미사용.
//   ⚠️ 표시가=청구가(P311): totalStr/usdStr/baseStr 은 quote.subtotalKRW 파생만, 재계산 금지.
//   ⚠️ #1012 항공편 자동조회(/api/flight-status) 보존: BookingInfoForm 항공편 필드 아래 flightLookupSlot 으로
//     "조회" 버튼 + 도착정보 표시를 렌더. 편명은 BookingInfoForm → state.airport.flightNumber 동기.
//
// 2026-05-09 (batch 9 fix B9-19): 운영자 결정 — Staria=6/Sprinter=10 cap 제거.
//   캐리어 카운터 무제한 (99). 8개 이상 시 amber 안내 "차량 N대 권장 — 운영자 견적".
// 2026-05-09 (batch 9 fix B9-1+B9-2): 픽업 시각 입력을 Step 3 select 에서
//   Step 5 날짜 아래 type="time" 자유 입력으로 이동. 30분 단위 제약 해제.
//   야간 할증 자동 계산도 여기 onChange 에서 처리.
import { useState } from 'react';
import type { ReactNode } from 'react';
import type { WizardState, LodgingLocation, VehicleType, QuoteBreakdown } from './types';
import { EXTRA_CHARGES } from '@/data/charterPricing';
import { charterUsdFromKrw } from '@/lib/charterUsd';
import { getWizardI18n } from './wizard-i18n';
import { calcVehicleCount } from '@/lib/luggageVehicle';
import { BookingInfoForm, type BookingFormData } from '@/components/booking/BookingInfoForm';
import { resolveProductType } from './resolveProductType';
import {
  getCutoffHours, isPastCutoff, earliestPickupTimeToday, todayKstISO,
} from '@/lib/bookingCutoff';

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
  if (vehicle === 'bus') {
    if (lang === 'ko') return '버스는 캐리어 적재 협의 가능합니다.';
    if (lang === 'ja') return 'バスは積載数を相談できます。';
    if (lang === 'zh') return '巴士的行李数量可协商。';
    return 'Bus: luggage count negotiable.';
  }
  // 일반 차량 — 7개 이하 안내 (Staria 1대 충분, 8+ 시 위 분기)
  if (lang === 'ko') return '캐리어는 기내 + 중형 + 대형을 합쳐서 입력해 주세요. 8개 이상이면 차량 2대를 권장합니다 (스타리아).';
  if (lang === 'ja') return '荷物は機内＋中型＋大型の合計で入力してください。8個以上の場合は2台の車両を推奨します (スターリア)。';
  if (lang === 'zh') return '请合计输入随身＋中型＋大型行李。8件以上建议使用2辆车 (Staria)。';
  return 'Enter total luggage (carry-on + medium + large). 8+ bags: 2 vehicles recommended (Staria).';
}

/**
 * "YYYY-MM-DD" 다음 날. 오늘이 통째로 마감됐을 때 date input 의 min 을 미는 데 쓴다.
 * ⚠️ 여기서 다루는 날짜는 전부 **inclusive** 다 — startDate/endDate 모두 여행에 포함되는
 * 날이고(1박2일 = start~end 2일), 이 함수도 "선택 가능한 첫 날"을 그대로 돌려준다.
 * 숙박수 계산(exclusive)과 섞지 말 것 — multidayQuote 가 별도로 처리한다.
 */
function nextDayISO(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

const formatKRW = (n: number) => `₩${Math.round(n).toLocaleString('ko-KR')}`;
// 차터 USD = 청구 공식 SSOT(lib/charterUsd) → 표시가==청구가.
const formatCharterUSD = (krw: number) => `≈ $${charterUsdFromKrw(krw).toLocaleString('en-US')} USD`;

interface Props {
  state: WizardState;
  patch: (p: Partial<WizardState>) => void;
  language?: 'ko' | 'en' | 'ja' | 'zh';
  // 2026-06-29 (방법 A) — 트립닷컴식 예약정보 통합:
  //   quote: 표시가(파생)·요약 표기용. termsAgreed: 약관 SSOT 단일 상태(wizard) — BookingInfoForm 단일 동의와 동기.
  //   footerSlot: optional — SMS 본인인증 제거(2026-06-30) 후 wizard 는 미전달. BookingInfoForm 하단 slot 으로 통과.
  quote?: QuoteBreakdown | null;
  footerSlot?: ReactNode;
  termsAgreed?: boolean;
  onTermsChange?: (agreed: boolean) => void;
  // 2026-06-29 마케팅(선택) 동의 emit — BookingInfoForm 의 마케팅 토글을 wizard 상태로 전달.
  //   약관(onTermsChange)과 독립. 결제 게이트 무관(미배선이면 BookingInfoForm 내부 state 로만 유지).
  onMarketingChange?: (agreed: boolean) => void;
}

export function Step5DateOptions({ state, patch, language = 'en', quote, footerSlot, termsAgreed, onTermsChange, onMarketingChange }: Props) {
  const i18n = getWizardI18n(language);
  // KST 기준 오늘 — toISOString()(UTC)을 쓰면 00~09시 KST 구간에 "어제"가 min 으로 깔려
  // 지난 날짜가 선택 가능해진다.
  const today = todayKstISO();
  const isAirport = state.service === 'airport_transfer';
  const isMulti   = state.service === 'multi_day';
  const isTransfer = state.service === 'transfer';
  const isICN     = state.origin === 'ICN';

  // batch 9 fix (B9-1+B9-2): 픽업 시각은 Step 5 type="time" 직접 입력 (날짜 아래).
  // 야간 할증 (18:00 이후 또는 06:00 이전) 자동 계산은 onChange 에서 처리.
  const pickup = state.pickupTime ?? state.startTime ?? '';
  const hour = pickup ? Number(pickup.slice(0, 2)) : -1;
  const isNight = hour >= 18 || (hour >= 0 && hour < 6);

  // ── 예약 마감 (2026-07-28) ────────────────────────────────────────────────
  // 상품군에 따라 마감이 다르다(전세차량 1h / 투어 8h). 같은 위저드 안에서도
  // 공항 픽업 = 차량, 패키지 당일투어 = 투어라 **productType 으로** 판정해야 맞다.
  // 값은 서버(api/_shared/booking-cutoff.js)와 미러인 lib/bookingCutoff 에서만 온다.
  const productType = resolveProductType(state).productType;
  const cutoffHours = getCutoffHours(productType);
  const startDate = state.startDate ?? '';
  // 오늘 날짜를 골랐다면 이미 마감선을 넘긴 시각은 아예 못 고르게 한다
  // (7/28 오전 7시가 지났는데도 선택되던 문제 — min 을 날짜에만 걸어서 생겼다).
  const minPickupToday = earliestPickupTimeToday(productType);
  const isToday = !!startDate && startDate === today;
  // 오늘 안에 남은 시각이 없으면 오늘 자체가 선택 불가 → 최소 날짜를 내일로 민다.
  const minDate = minPickupToday ? today : nextDayISO(today);
  const pastCutoff = !!startDate && isPastCutoff(productType, startDate, pickup);

  const airport = state.airport ?? {};
  const patchAirport = (p: Partial<NonNullable<WizardState['airport']>>) =>
    patch({ airport: { ...airport, ...p } });

  // 항공편명 → 인천공항 공공API 도착정보 자동조회 (data.go.kr, /api/flight-status) — #1012 보존.
  //   편명은 BookingInfoForm 항공편 입력 → handleFieldsChange → state.airport.flightNumber 동기.
  //   조회 버튼·결과는 BookingInfoForm 의 flightLookupSlot 으로 항공편 필드 바로 아래 렌더.
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
      // 🔧 2026-07-18: 예약일(state.startDate) 전달 — 공공API 조회창(오늘~6일)이 있어서 서버가
      //   예약일 기준으로 창 밖(beyond_window)·과거(past_date)를 정직하게 구분해 준다.
      //   이전엔 날짜 미전달이라 매일 운항편은 '오늘' 도착정보가 미래 예약에 잘못 채워졌고,
      //   1주+ 전 예약은 무조건 "편명 없음"으로 표시됐다.
      const dateParam = state.startDate ? `&date=${encodeURIComponent(state.startDate)}` : '';
      const r = await fetch(`/api/flight-status?flightId=${encodeURIComponent(fn)}&lang=${apiLang}${dateParam}`);
      const j = await r.json().catch(() => null);
      if (r.ok && j && j.ok && j.found && j.flight) {
        const f = j.flight;
        patchAirport({
          terminal: f.terminal === 'T2' ? 'T2' : 'T1',
          arrival: {
            scheduledTime: f.scheduledTime, estimatedTime: f.estimatedTime,
            gate: f.gate, origin: f.origin, status: f.status, lookedUp: true,
          },
        });
      } else if (j && (j.reason === 'beyond_window' || j.reason === 'past_date')) {
        // 조회창 밖 — 편명이 틀린 게 아니라 아직/이미 조회 불가. 직접 입력 안내.
        setFlightErr(i18n.flightLookupWindow);
      } else if (!r.ok || !j || !j.ok) {
        // 서버 키미설정(500)·공공API 장애/쿼터초과(502) — "편명 없음"과 구분(사용자 입력 탓 아님).
        setFlightErr(i18n.flightLookupError);
      } else {
        setFlightErr(i18n.flightLookupFail);
      }
    } catch {
      setFlightErr(i18n.flightLookupError);
    }
    setFlightLoading(false);
  };

  const langCode: 'ko' | 'en' | 'ja' | 'zh' =
    language === 'ko' ? 'ko' : language === 'ja' ? 'ja' : language === 'zh' ? 'zh' : 'en';

  // ── BookingInfoForm 표시 텍스트 (가격은 quote.subtotalKRW 파생만 — P311 재계산 금지) ──────
  const subtotalKRW = quote && !quote.needsCustomQuote ? quote.subtotalKRW : 0;
  const baseChargeKRW = quote ? quote.vehicleChargeKRW : 0;
  const totalStr = subtotalKRW > 0 ? formatKRW(subtotalKRW) : '—';
  const usdStr = subtotalKRW > 0 ? formatCharterUSD(subtotalKRW) : '';
  const baseStr = baseChargeKRW > 0 ? formatKRW(baseChargeKRW) : '—';

  // 🔧 2026-07-18: 결제 정보 카드 내역 행 — 이전엔 기본요금 1줄+총액만 렌더돼 옵션(면허가이드
  //   ₩300,000 등)·야간할증·멀티데이 할인이 총액에 숨은 채 "₩124,800 인데 총액 ₩424,800" 처럼
  //   설명 없는 차액으로 보였다. quote 파생 표시 전용 (P311 재계산 금지).
  //   라벨 4언어 — 키셋은 useQuoteCalculator addons 와 동일(licensed_guide/guide_required/
  //   airport_picket/child_seat). (돈버그 PR 의 charterExtras.ADDON_LABELS 와 동일 문구 유지.)
  const addonLabel = (key: string, fallback: string): string => {
    const M: Record<string, Record<'ko' | 'en' | 'ja' | 'zh', string>> = {
      licensed_guide: { ko: '면허 가이드 (영/일/중)', en: 'Licensed guide (EN/JA/ZH)', ja: '有資格ガイド（英/日/中）', zh: '持证导游（英/日/中）' },
      guide_required: { ko: '면허 가이드 동행 (법적 필수)', en: 'Licensed guide (legally required)', ja: '有資格ガイド同行（法定必須）', zh: '持证导游随行（法定必须）' },
      airport_picket: { ko: '공항 픽켓 서비스', en: 'Airport pickup sign', ja: '空港ピケットサービス', zh: '机场举牌服务' },
      child_seat: { ko: '카시트', en: 'Child seat', ja: 'チャイルドシート', zh: '儿童安全座椅' },
    };
    const e = M[key];
    return e ? e[langCode] : fallback;
  };
  const nightLabel = { ko: '야간 할증', en: 'Night surcharge', ja: '夜間割増', zh: '夜间附加费' }[langCode];
  const mdDiscountLabel = { ko: '멀티데이 할인', en: 'Multi-day discount', ja: '複数日割引', zh: '多日折扣' }[langCode];
  const extraRows = quote && !quote.needsCustomQuote
    ? [
        ...quote.addons.map((a) => ({ key: a.key, label: `+ ${addonLabel(a.key, a.label)}`, value: formatKRW(a.amountKRW) })),
        ...(quote.surchargeKRW > 0
          ? [{ key: 'night', label: `+ ${nightLabel} ${quote.surchargePercent}%`, value: formatKRW(quote.surchargeKRW) }]
          : []),
        ...(quote.multiDayDiscountKRW > 0
          ? [{ key: 'md_discount', label: `− ${mdDiscountLabel} ${quote.multiDayDiscountPercent}%`, value: `−${formatKRW(quote.multiDayDiscountKRW)}`, negative: true }]
          : []),
      ]
    : [];
  const meetingLabel = isAirport
    ? (language === 'ko' ? '미팅 장소' : language === 'ja' ? 'ミーティング場所' : language === 'zh' ? '会面地点' : 'Meeting point')
    : (language === 'ko' ? '픽업 장소' : language === 'ja' ? 'ピックアップ場所' : language === 'zh' ? '上车地点' : 'Pickup location');

  // BookingInfoForm 입력값 → WizardState patch (가격 무영향 필드만 매핑).
  //   영문 성·이름 → customerName 결합 / phone 은 onPhoneChange 로 별도 controlled /
  //   미팅장소·메모 → 매핑 / 메신저 → customerMessenger / 항공편·수하물 → state.airport (공항 서비스 시).
  // ⚠️ 비파괴(non-destructive): BookingInfoForm 은 마운트 시 빈 f 로 onFieldsChange 를 1회 emit 하므로
  //   값이 빈 필드를 그대로 patch 하면 프로필 prefill(customerName 등)을 덮어쓴다. → 입력값이 있을 때만 patch.
  //   항공편(flightNumber)은 입력값으로 동기하되, #1012 조회결과(arrival)는 lookupFlight 가 별도 patch 하므로
  //   여기서 flightNumber 만 갱신 시 arrival 은 건드리지 않는다(조회 도착정보 보존).
  const handleFieldsChange = (d: BookingFormData) => {
    const next: Partial<WizardState> = {};
    const fullName = `${d.lastName} ${d.firstName}`.trim();
    if (fullName) next.customerName = fullName;
    if (d.messengerId) next.customerMessenger = `${d.messenger}: ${d.messengerId}`;
    if (d.notes) next.notes = d.notes;
    // MEDIUM fix (2026-06-29): email·meetingPlace silent drop 방지 (BookingInfoForm 필수 수집분).
    if (d.email) next.customerEmail = d.email;
    if (d.meetingPlace) next.meetingPlace = d.meetingPlace;
    if (isAirport) {
      const lugTotal = d.lugSmall + d.lugMedium + d.lugLarge;
      const flightChanged = d.flightNo && d.flightNo !== (airport.flightNumber ?? '');
      if (d.flightNo || lugTotal > 0) {
        next.airport = {
          ...airport,
          ...(d.flightNo ? { flightNumber: d.flightNo } : {}),
          // 편명이 바뀌면 이전 조회결과 무효화 (사용자가 다시 조회하도록). #1012 동작과 동일.
          ...(flightChanged ? { arrival: undefined } : {}),
          ...(lugTotal > 0 ? { luggage: { small: d.lugSmall, medium: d.lugMedium, large: d.lugLarge } } : {}),
        };
      }
    }
    if (Object.keys(next).length > 0) patch(next);
  };

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2">
        {/* 날짜 */}
        <div className="rounded-2xl border border-white/10 bg-white/[0.025] p-4">
          <Label>{i18n.date}</Label>
          <input type="date" min={minDate}
            value={state.startDate ?? ''}
            onChange={e => patch({ startDate: e.target.value })}
            className={inputCls}
            style={{ colorScheme: 'dark' }} />
        </div>

        {/* batch 9 fix (B9-1+B9-2): 픽업 시각 직접 입력 — Step 3 select 에서 이동.
            type="time" 으로 30분 단위 제약 없이 자유 입력. 야간 할증 자동 계산. */}
        <div className="rounded-2xl border border-white/10 bg-white/[0.025] p-4">
          <Label>{i18n.bookingPickupTimeLabel}</Label>
          <input
            type="time"
            // 오늘을 골랐으면 마감선 이전 시각은 브라우저 단에서도 못 고르게 한다.
            min={isToday && minPickupToday ? minPickupToday : undefined}
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
          <p className="text-[11px] text-white/45 mt-2 px-1 leading-snug">
            {i18n.bookingCutoffNote(cutoffHours)}
          </p>
        </div>
      </div>

      {/* 마감 초과 — 배너만 띄우고 통과시키던 것을 실제 차단으로 (canAdvance 게이트와 연동).
          input min 은 브라우저가 무시할 수 있어(수기 입력·자동완성) 여기서 한 번 더 잡는다. */}
      {pastCutoff && (
        <div className="rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-200 flex items-start gap-2">
          <span className="text-base leading-none">⛔</span>
          <span>{i18n.bookingClosedMessage(cutoffHours)}</span>
        </div>
      )}

      {/* 배차 실패 시 자동취소 고지 — 결제 전에 반드시 보이게 (운영자 2026-07-28). */}
      <div className="rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 text-[13px] text-white/60 flex items-start gap-2">
        <span className="text-base leading-none">🚐</span>
        <span>{i18n.dispatchFailAutoCancelNote}</span>
      </div>

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
          BookingInfoForm 은 터미널 입력이 없으므로 여기서 유지. 편명·수하물은 BookingInfoForm 이 수집.
          #1012 항공편 조회 시 도착 터미널 자동 선택도 여기 버튼에 반영됨. */}
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
      <div className="rounded-2xl border border-white/10 bg-white/[0.025] p-4">
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
          결제·가격·약관 게이트는 wizard 가 소유 — BookingInfoForm 은 입력 UI 만 제공.
          phone 은 state.customerPhone controlled, 약관은 termsAgreed SSOT 동기, addon/할인/CTA 숨김.
          SMS 본인인증(BookingConsent)은 제거 (2026-06-30 운영자) — footerSlot 미전달 (결제 버튼은 wizard nav 가 소유).
          flightLookupSlot 에 #1012 /api/flight-status 조회 버튼 + 도착정보 표시.
          phone placeholder: placeholderPhone 미전달 → 기본값 '+82 10 1234 5678'(국가코드 포함) 사용.
            wizard i18n.customerPhonePlaceholder ko='010-1234-5678'(국가코드 無)는 외국인이 +82 칸 믿고
            국내번호 입력 → SMS 오발송하는 바로 그 문제를 재유발하므로 의도적으로 안 씀. */}
      <div className="rounded-[24px] border border-white/10 bg-white/[0.025] p-3 sm:p-4">
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
          lang={langCode}
          phone={state.customerPhone ?? ''}
          onPhoneChange={(v) => patch({ customerPhone: v })}
          externalAgreeAll={termsAgreed}
          onAgreeAllChange={onTermsChange}
          onMarketingChange={onMarketingChange}
          onFieldsChange={handleFieldsChange}
          // 🔧 2026-07-18: 옵션·야간할증·할인 내역 행 (표시 전용, quote 파생 — 총액 차액 설명).
          extraRows={extraRows}
          hideAddons
          hideDiscount
          hideCta
          onSubmit={() => { /* 결제는 wizard nav 의 결제 버튼이 담당 (PaymentPanel) */ }}
          footerSlot={footerSlot}
          // 🔧 2026-07-18: 조회 버튼은 인천공항(ICN)만 — 백엔드(B551177)가 인천공항 데이터 전용이라
          //   김포/부산/제주/대구 출발에선 100% 실패하던 버튼을 숨김(편명 수동 입력은 그대로 가능).
          flightLookupSlot={isAirport && isICN ? (
            <div>
              <button type="button" onClick={lookupFlight}
                disabled={flightLoading || !(airport.flightNumber ?? '').trim()}
                className="w-full px-4 py-2.5 rounded-xl text-sm font-bold border border-[#B668FC] bg-[#B668FC]/15 text-white disabled:opacity-40">
                {flightLoading ? '…' : i18n.flightLookup}
              </button>
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
          ) : undefined}
          externalArrivalTime={isAirport ? (arr?.estimatedTime || arr?.scheduledTime) : undefined}
        />
      </div>
    </div>
  );
}

const inputCls = 'w-full px-4 py-3.5 rounded-2xl border border-white/10 bg-black/15 text-white/90 text-sm outline-none transition-colors focus:border-[#B668FC]/55 focus:bg-black/20';

function Label({ children }: { children: React.ReactNode }) {
  return <p className="text-xs uppercase tracking-wider text-white/55 mb-2 font-semibold">{children}</p>;
}

function OptionPill({ label, sub, checked, onChange }: { label: string; sub: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className={`flex min-h-[46px] items-center gap-2 rounded-2xl border px-4 py-2.5 text-sm font-medium transition-colors ${
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
