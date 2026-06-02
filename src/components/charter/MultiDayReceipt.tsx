// MultiDayReceipt — 멀티데이(1박+) 차터 견적 영수증 (2026-06-02). TransferReceipt 패턴 복제.
// 거리 운행 + 일일 운영비×일수 + 숙박 기사비×박수 = 총액 (할인 전 = 백엔드 결제 SSOT).
// 가격은 src/lib/multidayQuote (백엔드 charter-multiday-price 와 1:1). 표시가 == 결제가 (P311).
// ⚠️ 멀티데이 −10% 견적 할인 / 가이드·카시트 옵션 / 야간할증은 온라인 즉시결제 base 에 미포함 (운영자 정책 확인 대상).
import { lookupMatrixKm, calcMultiDayQuote } from '@/lib/multidayQuote';

type Lang = 'ko' | 'en' | 'ja' | 'zh';

const KRW = (n: number) => `₩${Math.round(n).toLocaleString('ko-KR')}`;

const L: Record<string, Record<Lang, string>> = {
  title:     { ko: '멀티데이 견적 영수증', en: 'Multi-day Charter Receipt', ja: '複数日チャーター見積', zh: '多日包车报价单' },
  distance:  { ko: '거리 운행', en: 'Distance', ja: '距離運行', zh: '行驶距离' },
  daily:     { ko: '일일 운영비', en: 'Daily service', ja: '日次運営費', zh: '每日服务费' },
  overnight: { ko: '숙박 기사비', en: 'Overnight driver', ja: '宿泊運転手費', zh: '司机住宿费' },
  total:     { ko: '총액', en: 'Total', ja: '合計', zh: '总额' },
  note:      {
    ko: '출발 3일 전 전담 기사 배차. 식사·입장료·고객 숙박은 별도.',
    en: 'Dedicated driver assigned 3 days before departure. Meals/admission/your lodging excluded.',
    ja: '出発3日前に専任ドライバーをご案内。食事・入場料・お客様の宿泊は別途。',
    zh: '出发前3天安排专属司机。餐食·门票·客人住宿另计。',
  },
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

export function MultiDayReceipt({ originKey, destKey, vehicle, durationDays, language = 'en' }: {
  originKey?: string | null;
  destKey?: string | null;
  vehicle: string;
  durationDays: number;
  language?: Lang;
}) {
  const km = originKey && destKey ? lookupMatrixKm(originKey, destKey) : null;
  const q = km != null ? calcMultiDayQuote({ vehicle, km, durationDays }) : null;
  if (!q) return null;
  const lbl = (k: string): string => L[k]?.[language] ?? L[k]?.en ?? k;
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-6 space-y-1">
      <p className="text-base font-bold text-white/85 mb-4">{lbl('title')}</p>
      <Row label={`${lbl('distance')} (${km}km)`} value={KRW(q.distancePart)} />
      <Row label={`${lbl('daily')} × ${q.days}`} value={KRW(q.dailyFee * q.days)} accent="muted" />
      {q.nights > 0 && <Row label={`${lbl('overnight')} × ${q.nights}`} value={KRW(q.overnightFee * q.nights)} accent="muted" />}
      <div className="border-t border-white/10 my-2" />
      <Row label={lbl('total')} value={KRW(q.total)} accent="bold" />
      <p className="mt-3 text-xs text-white/45">ℹ️ {lbl('note')}</p>
    </div>
  );
}
