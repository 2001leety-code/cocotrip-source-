// Step 6: 최종 견적 — 차량비·할증·할인·VAT 표기 + 공항/일정 요약 + needsCustomQuote 분기
import type { QuoteBreakdown, WizardState } from './types';
import { getWizardI18n } from './wizard-i18n';

interface Props {
  quote: QuoteBreakdown | null;
  state?: WizardState;
  language?: 'ko' | 'en' | 'ja' | 'zh';
}

const KRW = (n: number) => `₩${Math.round(n).toLocaleString('ko-KR')}`;

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

      {/* 선결제 박스 */}
      <div className="rounded-2xl border border-[#B668FC]/30 bg-gradient-to-br from-[#B668FC]/10 to-transparent p-6">
        <p className="text-xs uppercase tracking-wider text-white/55 mb-4 font-semibold">{i18n.payBlock}</p>
        <div className="space-y-2.5 text-sm">
          <Row label={i18n.payVehicleLine} value={KRW(quote.vehicleChargeKRW)} />
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
        <div className="mt-5 pt-5 border-t border-white/10 flex items-center justify-between">
          <span className="text-base text-white/70">{i18n.paySubtotal}</span>
          <span className="text-2xl font-bold text-white">{KRW(quote.subtotalKRW)}</span>
        </div>
        {quote.vatExcluded && (
          <p className="mt-3 text-right text-xs text-amber-300/80">⚠ {i18n.vatExcluded(quote.vatPercent)}</p>
        )}
      </div>

      {/* 별도 고지 박스 (항상 보여주되 해당 모드만) */}
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
