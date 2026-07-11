// RefundPolicyModal — 취소·환불 정책 표 (api/_refund-policy.js 동기화).
// CTA 옆에 "환불 정책 보기" 링크로 호출. 4언어.
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { ShieldCheck } from 'lucide-react';
import type { Language } from '@/i18n';

const TIER_HEADERS: Record<Language, { col0: string; gen: string; gold: string; pla: string }> = {
  ko: { col0: '잔여 시간',  gen: 'Bronze·Silver', gold: 'Gold', pla: 'Platinum' },
  en: { col0: 'Hours left', gen: 'Bronze/Silver',  gold: 'Gold', pla: 'Platinum' },
  ja: { col0: '残り時間',   gen: 'Bronze/Silver',  gold: 'Gold', pla: 'Platinum' },
  zh: { col0: '剩余时间',   gen: 'Bronze/Silver',  gold: 'Gold', pla: 'Platinum' },
};

const ROW_LABEL: Record<Language, string[]> = {
  ko: ['72시간 이상 전', '48~72시간 전', '24~48시간 전', '12~24시간 전', '12시간 미만 / 노쇼'],
  en: ['72+ hours before', '48-72 hours before', '24-48 hours before', '12-24 hours before', '<12 hours / no-show'],
  ja: ['72時間以上前', '48~72時間前', '24~48時間前', '12~24時間前', '12時間未満／ノーショー'],
  zh: ['72小时以上前', '48~72小时前', '24~48小时前', '12~24小时前', '12小时内 / 未出席'],
};

const REFUND_TABLE = [
  ['100%', '100%', '100%'],
  ['80%',  '100%', '100%'],
  ['50%',  '80%',  '100%'],
  ['0%',   '50%',  '80%'],
  ['0%',   '0%',   '0%'],
];

const HEADING: Record<Language, string> = {
  ko: '취소·환불 정책',
  en: 'Cancellation & Refund Policy',
  ja: 'キャンセル・返金ポリシー',
  zh: '取消和退款政策',
};

const NOTES: Record<Language, string[]> = {
  ko: [
    '투어 시작 시각(KST 기준) 대비 잔여 시간으로 산정합니다.',
    '결제 시 적용된 회원 등급에 따라 환불율이 달라집니다.',
    '환불은 PayPal 원결제 수단으로 7~10영업일 내 처리됩니다.',
  ],
  en: [
    'Hours are counted from the tour start time (KST).',
    'Refund rate depends on the loyalty tier active at booking.',
    'Refunds are processed to the original PayPal account within 7-10 business days.',
  ],
  ja: [
    'ツアー開始時刻（KST）からの残り時間で計算されます。',
    '予約時の会員ランクに応じて返金率が異なります。',
    'PayPal原決済手段に7~10営業日以内に返金されます。',
  ],
  zh: [
    '按照旅游开始时间（韩国时间）计算剩余时间。',
    '退款比例根据预订时的会员等级而定。',
    '退款将在7-10个工作日内退至原PayPal账户。',
  ],
};

export function RefundPolicyModal({ language, trigger }: { language: Language; trigger: React.ReactNode }) {
  const headers = TIER_HEADERS[language] || TIER_HEADERS.en;
  const rowLabels = ROW_LABEL[language] || ROW_LABEL.en;
  const heading = HEADING[language] || HEADING.en;
  const notes = NOTES[language] || NOTES.en;

  return (
    <Dialog>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent
        className="cocotrip-mobile-refund-modal max-w-md mx-auto"
        style={{
          background: 'linear-gradient(180deg, #0f0820 0%, #0a0512 100%)',
          border: '1px solid rgba(182,104,252,0.20)',
          color: 'white',
        }}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-[15px] font-black">
            <ShieldCheck className="w-4 h-4" style={{ color: '#B668FC' }} />
            {heading}
          </DialogTitle>
        </DialogHeader>

        <table className="w-full text-[11px] mt-2">
          <thead>
            <tr className="text-white/55 border-b border-white/[0.08]">
              <th className="text-left py-2 font-semibold">{headers.col0}</th>
              <th className="text-center py-2 font-semibold">{headers.gen}</th>
              <th className="text-center py-2 font-semibold">{headers.gold}</th>
              <th className="text-center py-2 font-semibold">{headers.pla}</th>
            </tr>
          </thead>
          <tbody>
            {REFUND_TABLE.map((row, i) => (
              <tr key={i} className="border-b border-white/[0.04]">
                <td className="py-2 text-white/55">{rowLabels[i]}</td>
                {row.map((cell, j) => (
                  <td key={j} className="text-center py-2 font-bold tabular-nums" style={{ color: cell === '100%' ? '#7ee29c' : cell === '0%' ? '#f97373' : '#FFD250' }}>
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>

        <ul className="mt-3 space-y-1 text-[10px] text-white/55">
          {notes.map((n, i) => (
            <li key={i} className="leading-relaxed">· {n}</li>
          ))}
        </ul>
      </DialogContent>
    </Dialog>
  );
}
