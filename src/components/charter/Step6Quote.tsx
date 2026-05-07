// Step 6: 최종 견적 — 영수증 스타일 가격 카드 (PR-F).
// 정책 (2026-05-08 사용자 확정):
//   - formula 견적: 기본료 / 거리 요금 (km만 표기, 단가 X) / 톨비 (약) / 합계 (부가세 포함)
//   - package/matrix priceKRW 견적: 단일 패키지 행 + 톨비 안내 + 배차 안내 박스
//   - 항상 하단에 "예약 후 출발 3일 전에 전담 기사가 배차됩니다" 박스
import type { QuoteBreakdown, WizardState } from './types';
import { getWizardI18n } from './wizard-i18n';
import { CALCULATOR_KRW_PER_USD } from '@/lib/calculator';

interface Props {
  quote: QuoteBreakdown | null;
  state?: WizardState;
  language?: 'ko' | 'en' | 'ja' | 'zh';
}

const KRW = (n: number) => `₩${Math.round(n).toLocaleString('ko-KR')}`;
const USD = (krw: number) => `≈ $${Math.round(krw / CALCULATOR_KRW_PER_USD).toLocaleString('en-US')}`;

export function Step6Quote({ quote, state, language = 'en' }: Props) {
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
      <div className="rounded-2xl border border-amber-500/40 bg-amber-500/10 p-7 text-center">
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
          {state?.startDate && <span>{state.startDate} {state.startTime ?? ''}</span>}
        </div>
      )}

      {/* 영수증 카드 — 항상 노출. */}
      <div className="rounded-2xl border border-[#B668FC]/30 bg-gradient-to-br from-[#B668FC]/10 to-transparent p-6">
        <p className="text-xs uppercase tracking-wider text-white/55 mb-1 font-semibold">{i18n.payBlock}</p>
        <p className="text-base font-bold text-white/85 mb-4">{i18n.receiptTitle}</p>

        <div className="space-y-2.5 text-sm border-t border-white/10 pt-3">
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

          {/* 옵션/할증/할인 */}
          {quote.addons.map(a => (
            <Row key={a.key} label={`+ ${a.label}`} value={KRW(a.amountKRW)} muted />
          ))}
          {quote.surchargeKRW > 0 && (
            <Row label={i18n.nightSurcharge(quote.surchargePercent)} value={KRW(quote.surchargeKRW)} warn />
          )}
          {quote.multiDayDiscountKRW > 0 && (
            <Row label={i18n.multiDayDiscount(quote.multiDayDiscountPercent)} value={`-${KRW(quote.multiDayDiscountKRW)}`} good />
          )}
        </div>

        {/* 합계 행 */}
        <div className="mt-5 pt-5 border-t border-white/10 flex items-end justify-between">
          <span className="text-base text-white/70">{i18n.receiptTotal}</span>
          <div className="text-right">
            <div className="text-2xl font-bold text-white">{KRW(quote.subtotalKRW)}</div>
            <div className="text-xs text-white/55 mt-1">{USD(quote.subtotalKRW)}</div>
          </div>
        </div>

        {quote.vatExcluded && (
          <p className="mt-3 text-right text-xs text-amber-300/80">⚠ {i18n.vatExcluded(quote.vatPercent)}</p>
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
        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-6">
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

      {quote.warnings.length > 0 && (
        <div className="text-sm text-amber-300">⚠ {quote.warnings.join(' · ')}</div>
      )}

      {quote.distanceKm && (
        <p className="text-xs text-white/55">
          {i18n.onewayLabel}: {quote.distanceKm}km · ~{quote.durationHours}h · source: {quote.source}
        </p>
      )}
    </div>
  );
}

function Row({ label, value, muted, warn, good }: { label: string; value: string; muted?: boolean; warn?: boolean; good?: boolean }) {
  const cls = warn ? 'text-amber-300' : good ? 'text-emerald-300' : muted ? 'text-white/50' : 'text-white/80';
  return (
    <div className={`flex justify-between ${cls}`}>
      <span>{label}</span>
      <span>{value}</span>
    </div>
  );
}

// PR-R (2026-05-08): 예약 마감 안내 컴포넌트.
// - always-on note 줄: "예약 마감: 출발 24h 전 (멀티데이 48h)"
// - 임박 시 (출발까지 cutoffHours 미만 + 0보다 큰 경우) amber 배너로 강조
function CutoffNotice({ state, i18n }: { state?: WizardState; i18n: ReturnType<typeof getWizardI18n> }) {
  if (!state?.startDate) {
    return (
      <p className="text-[11px] text-white/45 px-1">📅 {i18n.bookingCutoffNote}</p>
    );
  }
  // multi_day → 48h, 외 → 24h
  const cutoffHours = state.service === 'multi_day' ? 48 : 24;
  const pickupTime = state.pickupTime ?? '09:00';
  const departureMs = new Date(`${state.startDate}T${pickupTime}:00+09:00`).getTime();
  if (isNaN(departureMs)) {
    return <p className="text-[11px] text-white/45 px-1">📅 {i18n.bookingCutoffNote}</p>;
  }
  const hoursLeft = (departureMs - Date.now()) / 3600000;
  const remainingUntilCutoff = hoursLeft - cutoffHours;
  // 출발까지 cutoff 보다 적게 남음 + 출발 자체는 미래 → 임박 배너.
  const imminent = hoursLeft > 0 && remainingUntilCutoff < 0;
  // 마감 지남 — 별도 처리 (PayPal 시도 시 차단됨)
  const closed = hoursLeft <= 0 || remainingUntilCutoff <= -cutoffHours;

  if (closed) {
    return (
      <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200 flex items-start gap-2">
        <span className="text-base leading-none">⛔</span>
        <span>{i18n.bookingClosedMessage}</span>
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
  return <p className="text-[11px] text-white/45 px-1">📅 {i18n.bookingCutoffNote}</p>;
}
