// TourReceipt — 투어(시간제) 견적 영수증 (운영자 2026-06-02 "Vercel 영수증처럼 쿠폰 자동적용 총액").
// 기본 9h + 거리추가(자동) + 쿠폰 5% + VAT 10% = 총액. 오버타임(9h 초과)은 현장결제 안내만.
// 가격은 src/lib/tourQuote (백엔드 api/_shared/tour-price 와 1:1 일치). 플래그 ON + custom 목적지(km>0)에서만 노출.
import { calcTourQuote } from '@/lib/tourQuote';

type Lang = 'ko' | 'en' | 'ja' | 'zh';

const KRW = (n: number) => `₩${Math.round(n).toLocaleString('ko-KR')}`;

const L: Record<string, Record<Lang, string>> = {
  title:    { ko: '견적 영수증', en: 'Quote Receipt', ja: '見積書', zh: '报价单' },
  base:     { ko: '기본 9시간', en: 'Base (9 hrs)', ja: '基本9時間', zh: '基本9小时' },
  distance: { ko: '거리 추가', en: 'Distance add-on', ja: '距離追加', zh: '距离附加' },
  subtotal: { ko: '소계', en: 'Subtotal', ja: '小計', zh: '小计' },
  coupon:   { ko: '쿠폰', en: 'Coupon', ja: 'クーポン', zh: '优惠券' },
  vat:      { ko: '부가세', en: 'VAT', ja: '消費税', zh: '增值税' },
  total:    { ko: '총액', en: 'Total', ja: '合計', zh: '总额' },
  overtime: { ko: '9시간 초과 시 시간당 현장결제', en: 'Overtime billed on-site per hour', ja: '9時間超過分は現地払い', zh: '超9小时现场结算' },
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

export function TourReceipt({ km, vehicle, language = 'en' }: { km: number; vehicle: string; language?: Lang }) {
  const q = calcTourQuote({ km, vehicle });
  if (!q) return null;
  const lbl = (k: string) => L[k]?.[language] ?? L[k]?.en ?? k;
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-6">
      <p className="text-base font-bold text-white/85 mb-4">{lbl('title')}</p>
      <Row label={lbl('base')} value={KRW(q.base)} />
      {q.distance > 0 && <Row label={`${lbl('distance')} (${Math.round(km)}km)`} value={`+${KRW(q.distance)}`} />}
      <div className="border-t border-white/10 my-2" />
      <Row label={lbl('subtotal')} value={KRW(q.subtotal)} />
      <Row label={`${lbl('coupon')} ${q.couponPct}%`} value={`−${KRW(q.coupon)}`} accent="good" />
      <Row label={`${lbl('vat')} 10%`} value={`+${KRW(q.vat)}`} accent="muted" />
      <div className="border-t border-white/10 my-2" />
      <Row label={lbl('total')} value={KRW(q.total)} accent="bold" />
      <p className="mt-3 text-right text-xs text-amber-300/80">⚠ {lbl('overtime')}: {KRW(q.overtimeHourly)}/h</p>
    </div>
  );
}
