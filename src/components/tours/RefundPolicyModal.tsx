// RefundPolicyModal — 취소·환불 정책 (api/_refund-policy.js 동기화).
// 2026-07-14 운영자 확정: 24시간 바이너리(24h 이상=100% / 24h 미만=0%), 등급 차등 폐지.
// CTA 옆에 "환불 정책 보기" 링크로 호출. 4언어.
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { ShieldCheck } from 'lucide-react';
import type { Language } from '@/i18n';
import { COL_HEADERS, ROWS, HEADING, NOTES } from './refundPolicyData';

export function RefundPolicyModal({ language, trigger }: { language: Language; trigger: React.ReactNode }) {
  const headers = COL_HEADERS[language] || COL_HEADERS.en;
  const rows = ROWS[language] || ROWS.en;
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

        <table className="w-full text-[12px] mt-2">
          <thead>
            <tr className="text-white/55 border-b border-white/[0.08]">
              <th className="text-left py-2 font-semibold">{headers.period}</th>
              <th className="text-right py-2 font-semibold">{headers.refund}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(([label, pct], i) => (
              <tr key={i} className="border-b border-white/[0.04]">
                <td className="py-2.5 text-white/70">{label}</td>
                <td className="text-right py-2.5 font-bold tabular-nums" style={{ color: pct === '100%' ? '#7ee29c' : '#f97373' }}>
                  {pct}
                </td>
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
