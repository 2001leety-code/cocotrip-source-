// TransferReceipt — 도시간/공항 차터 transfer 편도/왕복 영수증.
// 2026-06-05 통일: 4-tier(톨 포함) ‖ 매트릭스 priceKRW × 차종 × 편도5%/왕복(×2)10%. 거리·VAT 별도행 폐기(curatedKRW 내장).
// 가격은 src/lib/transferQuote (백엔드 charter-transfer-price.js 와 1:1). 표시가 == 결제가 (P311).
import { calcTransferQuote, curatedStariaKRW } from '@/lib/transferQuote';
import type { TripType } from '@/lib/transferQuote';
import { CHARTER_USD_FIX_RATE } from '@/data/charterPricing';

type Lang = 'ko' | 'en' | 'ja' | 'zh';

const KRW = (n: number) => `₩${Math.round(n).toLocaleString('ko-KR')}`;

const L: Record<string, Record<Lang, string>> = {
  title:    { ko: '차터 견적 영수증', en: 'Transfer Receipt', ja: '送迎見積書', zh: '包车报价单' },
  oneway:   { ko: '편도 이동', en: 'One-way transfer', ja: '片道送迎', zh: '单程接送' },
  roundtrip:{ ko: '왕복 이동', en: 'Round-trip transfer', ja: '往復送迎', zh: '往返接送' },
  base:     { ko: '차량 요금 (통행료·세금 포함)', en: 'Vehicle fare (tolls & tax incl.)', ja: '車両料金（通行料・税込）', zh: '车辆费用（含过路费·税）' },
  coupon:   { ko: '쿠폰', en: 'Coupon', ja: 'クーポン', zh: '优惠券' },
  total:    { ko: '총액 (원화)', en: 'Total (KRW)', ja: '合計 (KRW)', zh: '总额 (KRW)' },
  pay_usd:  { ko: '결제 금액 (USD 고정)', en: 'Payment (USD, fixed)', ja: 'お支払い (USD固定)', zh: '支付金额 (USD固定)' },
  note:     { ko: '출발 3일 전 전담 기사 배차 안내', en: 'Dedicated driver assigned 3 days before departure', ja: '出発3日前に専任ドライバーをご案内', zh: '出发前3天安排专属司机' },
};

function Row({ label, value, accent }: { label: string; value: string; accent?: 'good' | 'muted' | 'bold' }) {
  const valCls = accent === 'good' ? 'text-emerald-300' : accent === 'bold' ? 'text-white text-lg font-bold' : accent === 'muted' ? 'text-white/55' : 'text-white/85';
  return (
    <div className="flex items-center justify-between py-1.5">
      <span className={accent === 'bold' ? 'text-base text-white/70' : 'text-sm text-white/65'}>{label}</span>
      <span className={`text-sm ${valCls}`}>{value}</span>
    </div>
  );
}

export function TransferReceipt({ originKey, destKey, tripType = 'oneway', vehicle, language = 'en' }: {
  originKey: string;
  destKey: string;
  tripType?: TripType;
  vehicle: string;
  language?: Lang;
}) {
  const curatedKRW = curatedStariaKRW(originKey, destKey);
  const q = curatedKRW != null ? calcTransferQuote({ curatedKRW, tripType, vehicle }) : null;
  if (!q) return null;
  const lbl = (k: string): string => L[k]?.[language] ?? L[k]?.en ?? k;
  const modeLabel = tripType === 'roundtrip' ? lbl('roundtrip') : lbl('oneway');
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-6 space-y-1">
      <p className="text-base font-bold text-white/85 mb-1">{lbl('title')}</p>
      <p className="text-xs text-white/45 mb-3">{modeLabel}</p>
      <Row label={lbl('base')} value={KRW(q.tripBase)} />
      <div className="border-t border-white/10 my-2" />
      <Row label={`${lbl('coupon')} ${q.couponPct}%`} value={`−${KRW(q.coupon)}`} accent="good" />
      <div className="border-t border-white/10 my-2" />
      <Row label={lbl('total')} value={KRW(q.total)} accent="muted" />
      <Row label={lbl('pay_usd')} value={`$${Math.round(q.total / CHARTER_USD_FIX_RATE).toLocaleString('en-US')}`} accent="bold" />
      <p className="mt-3 text-xs text-white/45">ℹ️ {lbl('note')}</p>
    </div>
  );
}
