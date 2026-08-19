// TourCancellationSection — 투어 상세 페이지 취소·환불 정책 섹션 (MRT 벤치마킹 P1).
// RefundPolicyModal(하단 CTA 바)과 같은 refundPolicyData.ts 의 COL_HEADERS/ROWS/HEADING/NOTES
// 를 그대로 재사용 — 표 값을 두 파일에 각각 적으면 SSOT 가 둘로 쪼개진다
// (값은 api/_refund-policy.js 24h 바이너리).
// 배차 실패 자동취소 안내는 TourBookingDialog.autoCancelNote 와 의미를 맞춘 섹션 전용 문구.
import { ShieldCheck } from 'lucide-react';
import type { Language } from '@/i18n';
import { COL_HEADERS, ROWS, HEADING, NOTES } from './refundPolicyData';

const DISPATCH_NOTE: Record<Language, string> = {
  ko: '차량·기사 배정에 실패하면 예약은 자동으로 취소되고 전액 환불됩니다.',
  en: 'If a vehicle or driver cannot be assigned, the booking is cancelled automatically and refunded in full.',
  ja: '車両またはドライバーの手配に失敗した場合、予約は自動的にキャンセルされ全額返金されます。',
  zh: '如车辆或司机安排失败，订单将自动取消并全额退款。',
};

export function TourCancellationSection({ language }: { language: Language }) {
  const headers = COL_HEADERS[language] || COL_HEADERS.en;
  const rows = ROWS[language] || ROWS.en;
  const heading = HEADING[language] || HEADING.en;
  const notes = NOTES[language] || NOTES.en;
  const dispatchNote = DISPATCH_NOTE[language] || DISPATCH_NOTE.en;

  return (
    <section id="cancellation" className="tour-detail-section" data-testid="tour-detail-cancellation">
      <h2 className="ec-h2 tour-detail-section-heading flex items-center gap-2">
        <ShieldCheck className="h-5 w-5 text-ec-brand" />
        {heading}
      </h2>
      <div className="tour-detail-include-card p-5">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-ec-line text-ec-ink-3">
              <th className="py-2 text-left font-semibold">{headers.period}</th>
              <th className="py-2 text-right font-semibold">{headers.refund}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(([label, pct], i) => (
              <tr key={i} className="border-b border-ec-line last:border-0">
                <td className="py-2.5 text-ec-ink-2">{label}</td>
                <td className={`py-2.5 text-right font-bold tabular-nums ${pct === '100%' ? 'text-ec-success' : 'text-ec-notice'}`}>
                  {pct}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <ul className="mt-3 space-y-1 text-xs text-ec-ink-3">
          {notes.map((n, i) => (
            <li key={i} className="leading-relaxed">· {n}</li>
          ))}
          <li className="leading-relaxed" data-testid="tour-detail-cancellation-dispatch-note">🚐 {dispatchNote}</li>
        </ul>
      </div>
    </section>
  );
}
