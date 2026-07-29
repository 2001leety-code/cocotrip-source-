// Step 6: 최종 견적 — 영수증 스타일 가격 카드 (PR-F).
// 정책 (2026-05-08 사용자 확정):
//   - formula 견적: 기본료 / 거리 요금 (km만 표기, 단가 X) / 톨비 (약) / 합계 (부가세 포함)
//   - package/matrix priceKRW 견적: 단일 패키지 행 + 톨비 안내 + 배차 안내 박스
//   - 항상 하단에 "예약 후 출발 3일 전에 전담 기사가 배차됩니다" 박스
import type { QuoteBreakdown, WizardState } from './types';
import { TourReceipt } from './TourReceipt';
import { TransferReceipt } from './TransferReceipt';
import { MultiDayReceipt } from './MultiDayReceipt';
import { resolveProductType } from './resolveProductType';
import { getWizardI18n } from './wizard-i18n';
import { charterAddonLabel, withDerivedNight } from '@/lib/charterExtras';
import { getCutoffHours, hoursUntilDeparture } from '@/lib/bookingCutoff';
import { CHARTER_USD_FIX_RATE } from '@/data/charterPricing';

interface Props {
  quote: QuoteBreakdown | null;
  state?: WizardState;
  // FEATURE_CHARTER_WAYPOINTS: 경유지 경로 km — 견적 표시==청구가 위해 resolveProductType/영수증에 주입.
  routeKm?: number | null;
  language?: 'ko' | 'en' | 'ja' | 'zh';
}

const KRW = (n: number) => `₩${Math.round(n).toLocaleString('ko-KR')}`;
// 차터 USD 표시 = 백 createPaypalOrder 청구와 동일 고정환율(CHARTER_USD_FIX_RATE 1400) → 표시가==청구가.
const USD = (krw: number) => `≈ $${Math.round(krw / CHARTER_USD_FIX_RATE).toLocaleString('en-US')}`;

export function Step6Quote({ quote, state, routeKm, language = 'en' }: Props) {
  const i18n = getWizardI18n(language);
  if (!quote) {
    return (
      <div className="text-white/55 text-sm">
        {language === 'ko' ? '이전 단계 정보가 부족합니다.'
          : language === 'ja' ? '前のステップが未完了です。'
          : language === 'zh' ? '上一步信息不完整。'
          : 'Previous steps incomplete.'}
      </div>
    );
  }

  // 자유입력 + 매트릭스 미매칭 — 별도견적 안내로 분기
  if (quote.needsCustomQuote) {
    return (
      <div className="rounded-xl p-4 sm:rounded-2xl sm:p-7 border border-amber-500/40 bg-amber-500/10 text-center">
        <p className="text-lg text-amber-100 font-bold mb-3">{i18n.customQuoteTitle}</p>
        <p className="text-sm text-white/70 mb-4 leading-relaxed">{i18n.customQuoteBody}</p>
        <p className="text-xs text-white/55">{i18n.customQuoteSub}</p>
      </div>
    );
  }

  // 공항 전용 요약 (있을 때만)
  const ap = state?.airport;
  const lug = ap?.luggage;
  const lugTotal = (lug?.small ?? 0) + (lug?.medium ?? 0) + (lug?.large ?? 0);
  const hasAirportInfo = quote.mode === 'airport_transfer' && (ap?.flightNumber || ap?.terminal || lugTotal > 0);
  const unitPcs = language === 'ko' ? '개' : language === 'ja' ? '個' : language === 'zh' ? '件' : 'pcs';

  // 영수증 분해 — formula 견적이면 base/distance/toll 노출, 그 외 단일 패키지 행
  const r = quote.receipt;
  const useFormulaRows = !!r && r.baseFeeKRW != null && r.distanceFeeKRW != null && !r.isPackage;
  const km = quote.distanceKm ?? 0;

  // 투어 시간제 영수증 (2026-06-02, VITE_FEATURE_TOUR_HOURLY): day_tour + custom 목적지(km>0) +
  // staria/sprinter. 플래그 OFF 기본 = 기존 견적 유지(prod 무영향). 권역(묶음, km 없음)은 미적용(별도 정책).
  const tourHourlyOn = import.meta.env.VITE_FEATURE_TOUR_HOURLY === 'true';
  const tourVehicle = state?.vehicle;
  if (tourHourlyOn && quote.mode === 'day_tour' && km > 0 && (tourVehicle === 'staria' || tourVehicle === 'sprinter')) {
    return <TourReceipt km={km} vehicle={tourVehicle} options={withDerivedNight(state?.options, state?.pickupTime)} language={language} />;
  }

  // 멀티데이(1박+) 차터 영수증 (2026-06-02, VITE_FEATURE_MULTIDAY_CHECKOUT): resolveProductType 가
  // charter_multiday 로 판정하면(매트릭스+staria/sprinter+1박+, 플래그 ON) backend 와 동일한 base 가격 영수증 표시.
  // transfer 보다 먼저 — 멀티데이(1박+)가 우선. 표시가 == 결제가 (P311).
  if (state) {
    const md = resolveProductType(state, { routeKm });
    if (md.productType === 'charter_multiday' && md.payable) {
      return <MultiDayReceipt originKey={md.originKey} destKey={md.destKey} vehicle={tourVehicle ?? 'staria'} durationDays={md.durationDays ?? 1} routeKm={routeKm} options={withDerivedNight(state.options, state.pickupTime)} language={language} />;
    }
  }

  // 도시간 transfer 영수증 (VITE_FEATURE_TRANSFER_CHECKOUT): resolveProductType=charter_transfer 판정 시
  // backend 와 동일하게 originKey/destKey 로 curatedKRW 재계산 (4-tier ‖ 매트릭스 priceKRW). 표시가==결제가 (P311).
  if (state) {
    const tf = resolveProductType(state, { routeKm });
    if (tf.productType === 'charter_transfer' && tf.payable && tf.originKey && tf.destKey) {
      return <TransferReceipt originKey={tf.originKey} destKey={tf.destKey} tripType={tf.tripType ?? 'oneway'} vehicle={tourVehicle ?? 'staria'} routeKm={routeKm} options={withDerivedNight(state.options, state.pickupTime)} language={language} />;
    }
  }

  return (
    <div className="space-y-5">
      {hasAirportInfo && (
        <div className="rounded-xl border border-[#B668FC]/25 bg-[#B668FC]/5 px-4 py-3 text-xs text-white/70 flex flex-wrap gap-x-4 gap-y-1.5">
          {ap?.terminal && <span>✈ {i18n.terminal} <b className="text-white">{ap.terminal}</b></span>}
          {ap?.flightNumber && <span>{i18n.flightNo} <b className="text-white">{ap.flightNumber}</b></span>}
          {lugTotal > 0 && (
            <span>{i18n.luggage.replace(/\s*\([^)]*\)/, '')} <b className="text-white">{lugTotal}{unitPcs}</b>
              <span className="text-white/55 ml-1">(S{lug?.small ?? 0}·M{lug?.medium ?? 0}·L{lug?.large ?? 0})</span>
            </span>
          )}
          {state?.startDate && <span>{state.startDate} {state.pickupTime ?? state.startTime ?? ''}</span>}
        </div>
      )}

      {/* 영수증 카드 — 항상 노출. */}
      <div className="overflow-hidden rounded-[26px] border border-[#B668FC]/30 bg-gradient-to-br from-[#B668FC]/12 via-white/[0.035] to-transparent shadow-[0_22px_70px_rgba(0,0,0,0.24)]">
        <div className="border-b border-white/10 px-5 py-4 sm:px-6">
          <p className="text-xs uppercase tracking-wider text-white/55 mb-1 font-semibold">{i18n.payBlock}</p>
          <p className="text-lg font-black text-white">{i18n.receiptTitle}</p>
        </div>

        <div className="space-y-3 px-5 py-4 text-sm sm:px-6">
          {useFormulaRows ? (
            <>
              <Row label={i18n.receiptBaseFee}              value={KRW(r!.baseFeeKRW!)} />
              <Row label={i18n.receiptDistance(Math.round(km))} value={KRW(r!.distanceFeeKRW!)} />
              {r?.tollFeeKRW != null && r.tollFeeKRW > 0 && (
                <Row label={i18n.receiptToll} value={KRW(r.tollFeeKRW)} muted />
              )}
            </>
          ) : (
            <Row label={i18n.packageRowLabel} value={KRW(quote.vehicleChargeKRW)} />
          )}

          {/* 옵션/할증/할인 — 라벨은 4언어 사전(charterAddonLabel). 이전 a.label(한국어 하드코딩)은
              sprinter 필수가이드 행 등이 en/ja/zh 고객에게 한국어로 노출됐다 (2026-07-18 재점검). */}
          {quote.addons.map(a => (
            <Row key={a.key} label={`+ ${charterAddonLabel(a.key, language)}`} value={KRW(a.amountKRW)} muted />
          ))}
          {quote.surchargeKRW > 0 && (
            <Row label={i18n.nightSurcharge(quote.surchargePercent)} value={KRW(quote.surchargeKRW)} warn />
          )}
          {quote.multiDayDiscountKRW > 0 && (
            <Row label={i18n.multiDayDiscount(quote.multiDayDiscountPercent)} value={`-${KRW(quote.multiDayDiscountKRW)}`} good />
          )}
        </div>

        {/* 합계 행 */}
        <div className="flex items-end justify-between gap-4 border-t border-white/10 bg-black/10 px-5 py-5 sm:px-6">
          <span className="text-base font-bold text-white/70">{i18n.receiptTotal}</span>
          <div className="text-right">
            <div className="text-3xl font-black leading-tight text-white">{KRW(quote.subtotalKRW)}</div>
            <div className="text-xs text-white/55 mt-1">{USD(quote.subtotalKRW)}</div>
          </div>
        </div>

        {quote.vatExcluded ? (
          <p className="px-5 pb-4 text-right text-xs text-amber-300/80 sm:px-6">⚠ {i18n.vatExcluded(quote.vatPercent)}</p>
        ) : (
          /* batch 9 fix (B9-9, 2026-05-09): 부가세 포함 명시 — vatExcluded 가 false 일 때 작은 안내. */
          <p className="px-5 pb-4 text-right text-[11px] text-white/50 sm:px-6">{i18n.vatIncludedNote}</p>
        )}
      </div>

      {/* 배차 안내 박스 — 영수증 하단 항상 노출 */}
      <div className="rounded-xl border border-emerald-500/25 bg-emerald-500/5 px-4 py-3 text-sm text-emerald-100/85 flex items-start gap-2">
        <span className="text-base leading-none">ℹ️</span>
        <span>{i18n.driverDispatchNote}</span>
      </div>

      {/* PR-R (2026-05-08): 예약 마감 정책 안내 + 임박 시 amber 배너 */}
      <CutoffNotice state={state} i18n={i18n} />


      {/* 별도 고지 박스 (always render for relevant modes) */}
      {(quote.showMeals || quote.showAttractions) && (
        <div className="rounded-xl p-3.5 sm:rounded-2xl sm:p-6 border border-white/10 bg-white/[0.03]">
          <p className="text-xs uppercase tracking-wider text-white/55 mb-4 font-semibold">{i18n.separateBlock}</p>
          <div className="space-y-2.5 text-sm text-white/65">
            {quote.showMeals && <Row label={i18n.estMeals} value={KRW(quote.estimatedMealsKRW)} muted />}
            {quote.showAttractions && <Row label={i18n.estAttractions} value={KRW(quote.estimatedAttractionsKRW)} muted />}
          </div>
        </div>
      )}

      {/* 포함/제외 뱃지 */}
      <div className="flex flex-wrap gap-2 text-xs">
        {quote.includes.map(i => (
          <span key={i} className="px-3 py-1.5 rounded-full bg-emerald-500/10 text-emerald-300 border border-emerald-500/20">✓ {i}</span>
        ))}
        {quote.excludes.map(e => (
          <span key={e} className="px-3 py-1.5 rounded-full bg-white/[0.03] text-white/55 border border-white/10">× {e}</span>
        ))}
      </div>

      {/* UIUX P6 가치 4배지 — 차터 서비스 실약속(static, 가격·로직 무관). 견적은 위에 사전 표시. */}
      <div className="grid grid-cols-2 gap-2">
        {([
          { ko: '사전 확정 견적', en: 'Upfront Quote',       ja: '事前確定見積り',   zh: '预先确定报价' },
          { ko: '전문 기사',      en: 'Professional Driver', ja: 'プロドライバー',   zh: '专业司机' },
          { ko: '유연한 경유',    en: 'Flexible Stops',      ja: '柔軟な立ち寄り',   zh: '灵活停靠' },
          { ko: '다국어 지원',    en: 'Multilingual',        ja: '多言語対応',       zh: '多语言支持' },
        ] as const).map((b, i) => (
          <div key={i} className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-xs font-medium text-white/70">
            <span className="text-emerald-400 shrink-0">✓</span>{b[language] || b.en}
          </div>
        ))}
      </div>

      {quote.warnings.length > 0 && (
        <div className="text-sm text-amber-300">⚠ {quote.warnings.join(' · ')}</div>
      )}

      {quote.distanceKm && (
        <p className="text-xs text-white/55">
          {i18n.onewayLabel}: {quote.distanceKm}km · ~{quote.durationHours}h · source: {quote.source}
        </p>
      )}

      {/* FEATURE_CHARTER_WAYPOINTS: 경유지 반영 경로 안내 — routeKm 이 있으면 실제 도로 경로 기반 견적임을 표기. */}
      {routeKm != null && routeKm > 0 && (state?.waypoints?.length ?? 0) > 0 && (
        <p className="text-xs text-emerald-300/85">
          {language === 'ko' ? `경유 ${state!.waypoints!.length}곳 반영 · 실제 도로 경로 ${routeKm}km 기준`
            : language === 'ja' ? `経由${state!.waypoints!.length}ヶ所 · 実際の道路経路${routeKm}km基準`
            : language === 'zh' ? `含${state!.waypoints!.length}个经停 · 按实际道路${routeKm}km计`
            : `${state!.waypoints!.length} stop${state!.waypoints!.length > 1 ? 's' : ''} via actual road route (${routeKm}km)`}
        </p>
      )}
    </div>
  );
}

function Row({ label, value, muted, warn, good }: { label: string; value: string; muted?: boolean; warn?: boolean; good?: boolean }) {
  const cls = warn ? 'text-amber-300' : good ? 'text-emerald-300' : muted ? 'text-white/50' : 'text-white/80';
  return (
    <div className={`grid grid-cols-[minmax(0,1fr)_auto] items-start gap-4 ${cls}`}>
      <span className="min-w-0 leading-relaxed">{label}</span>
      <span className="whitespace-nowrap font-semibold">{value}</span>
    </div>
  );
}

// PR-R (2026-05-08): 예약 마감 안내 컴포넌트.
// 2026-07-28: 12h 하드코딩 제거 — 상품군별 마감(전세차량 1h / 투어 8h)을 서버 미러
//   lib/bookingCutoff 에서 파생한다. 이전 `closed` 식(remainingUntilCutoff <= -cutoffHours)은
//   마감 후 한 사이클을 더 지나야 참이 돼, 마감 직후 구간을 "임박"으로만 표시했다.
function CutoffNotice({ state, i18n }: { state?: WizardState; i18n: ReturnType<typeof getWizardI18n> }) {
  const productType = state ? resolveProductType(state).productType : null;
  const cutoffHours = getCutoffHours(productType);
  if (!state?.startDate) {
    return (
      <p className="text-[11px] text-white/45 px-1">📅 {i18n.bookingCutoffNote(cutoffHours)}</p>
    );
  }
  const pickupTime = state.pickupTime ?? state.startTime ?? '09:00';
  const hoursLeft = hoursUntilDeparture(state.startDate, pickupTime);
  if (!Number.isFinite(hoursLeft)) {
    return <p className="text-[11px] text-white/45 px-1">📅 {i18n.bookingCutoffNote(cutoffHours)}</p>;
  }
  const closed = hoursLeft <= cutoffHours;
  // 마감까지 6시간 이내로 남았으면 임박 경고 (마감 자체는 아직 안 지남).
  const imminent = !closed && hoursLeft - cutoffHours <= 6;

  if (closed) {
    return (
      <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200 flex items-start gap-2">
        <span className="text-base leading-none">⛔</span>
        <span>{i18n.bookingClosedMessage(cutoffHours)}</span>
      </div>
    );
  }
  if (imminent) {
    const left = Math.max(1, Math.round(hoursLeft));
    return (
      <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-200 flex items-start gap-2">
        <span className="text-base leading-none">⚠️</span>
        <span>{i18n.bookingCutoffImminent(left)}</span>
      </div>
    );
  }
  return <p className="text-[11px] text-white/45 px-1">📅 {i18n.bookingCutoffNote(cutoffHours)}</p>;
}
