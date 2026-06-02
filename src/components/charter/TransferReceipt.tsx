// TransferReceipt — 도시간 차터 transfer 편도/왕복 영수증 (운영자 2026-06-02).
// TourReceipt.tsx 패턴 복제. 편도 km×1500 / 왕복 ×2 + 쿠폰(편도5%/왕복10%) + VAT 10%.
// 가격은 src/lib/transferQuote (백엔드 1:1 일치). 플래그 ON + charter_transfer 시 Step6Quote 표시.
import { calcTransferQuote } from '@/lib/transferQuote';
import type { TripType } from '@/lib/transferQuote';

type Lang = 'ko' | 'en' | 'ja' | 'zh';

const KRW = (n: number) => `₩${Math.round(n).toLocaleString('ko-KR')}`;

const L: Record<string, Record<Lang, string>> = {
  title:    { ko: '차터 견적 영수증', en: 'Transfer Receipt', ja: '送迎見積書', zh: '包车报价单' },
  oneway:   { ko: '편도 이동', en: 'One-way transfer', ja: '片道送迎', zh: '单程接送' },
  roundtrip:{ ko: '왕복 이동', en: 'Round-trip transfer', ja: '往復送迎', zh: '往返接送' },
  distance: { ko: '이동거리', en: 'Distance', ja: '移動距離', zh: '行驶距离' },
  coupon:   { ko: '쿠폰', en: 'Coupon', ja: 'クーポン', zh: '优惠券' },
  vat:      { ko: '부가세', en: 'VAT', ja: '消費税', zh: '增值税' },
  total:    { ko: '총액', en: 'Total', ja: '合計', zh: '总额' },
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

export function TransferReceipt({ km, tripType = 'oneway', vehicle, language = 'en' }: {
  km: number;
  tripType?: TripType;
  vehicle: string;
  language?: Lang;
}) {
  const q = calcTransferQuote({ km, tripType, vehicle });
  if (!q) return null;
  const lbl = (k: string): string => L[k]?.[language] ?? L[k]?.en ?? k;
  const modeLabel = tripType === 'roundtrip' ? lbl('roundtrip') : lbl('oneway');
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-6 space-y-1">
      <p className="text-base font-bold text-white/85 mb-4">{lbl('title')}</p>
      <Row label={modeLabel} value={`${q.km}km`} />
      <Row label={`${lbl('distance')} (${q.distanceKm}km × ₩1,500)`} value={KRW(q.base)} />
      <div className="border-t border-white/10 my-2" />
      <Row label={`${lbl('coupon')} ${q.couponPct}%`} value={`−${KRW(q.coupon)}`} accent="good" />
      <Row label={`${lbl('vat')} 10%`} value={`+${KRW(q.vat)}`} accent="muted" />
      <div className="border-t border-white/10 my-2" />
      <Row label={lbl('total')} value={KRW(q.total)} accent="bold" />
      <p className="mt-3 text-xs text-white/45">ℹ️ {lbl('note')}</p>
    </div>
  );
}
