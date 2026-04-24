// Daily-budget summary table + T-money recommended load.
// Extracted verbatim from src/pages/PlanDetailPage.tsx (L1048-1093) during P2 Lock release.
import { useState } from 'react';
import { Wallet, ChevronDown } from 'lucide-react';
import { formatKRW } from '../constants';
import { useLanguage } from '@/hooks/useLanguage';
import { getPlanDetailUI } from '../types';

interface BudgetRow {
  day: number;
  transport_krw: number;
  entry_fees_krw: number;
  meals_krw: number;
  total_krw: number;
}

export function BudgetTable({ budget, tMoney }: { budget: BudgetRow[]; tMoney: number }) {
  const { t } = useLanguage();
  const ui = getPlanDetailUI(t);
  const [open, setOpen] = useState(false);
  return (
    <section className="mb-5 sm:mb-6">
      <button onClick={() => setOpen(!open)} className="w-full flex items-center justify-between bg-white/[0.04] border border-white/[0.08] rounded-2xl px-4 py-3 sm:px-5 sm:py-4">
        <div className="flex items-center gap-2.5 sm:gap-3">
          <Wallet className="w-[18px] h-[18px] sm:w-5 sm:h-5 text-[#7C5CFC]" />
          <p className="text-[13px] sm:text-sm font-bold">{ui.budgetSummary || 'Daily Budget Summary'}</p>
        </div>
        <ChevronDown className={`w-4 h-4 text-white/30 transition-transform duration-300 ${open ? 'rotate-180' : ''}`} />
      </button>
      <div className={`overflow-hidden transition-all duration-300 ease-out ${open ? 'max-h-[1000px] opacity-100 mt-3' : 'max-h-0 opacity-0'}`}>
        {/* 포함/별도 뱃지 — CocoTrip "No Hidden Fees" 명시 */}
        <div className="flex flex-wrap gap-1.5 mb-2.5 text-[10px]">
          <span className="px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-300 border border-emerald-500/20">✓ Transport = 차량비 (톨·주차·팁 포함)</span>
          <span className="px-2 py-0.5 rounded-full bg-white/[0.03] text-white/40 border border-white/10">× Entry/Meals = 별도 현장 결제</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-[11px] sm:text-xs">
            <thead>
              <tr className="text-white/30 border-b border-white/[0.08]">
                <th className="text-left py-1.5 px-1.5 sm:py-2 sm:px-2">{ui.budgetDay || 'Day'}</th>
                <th className="text-right py-1.5 px-1.5 sm:py-2 sm:px-2">{ui.budgetTransport || 'Transport'}</th>
                <th className="text-right py-1.5 px-1.5 sm:py-2 sm:px-2">{ui.budgetEntry || 'Entry'}</th>
                <th className="text-right py-1.5 px-1.5 sm:py-2 sm:px-2">{ui.budgetMeals || 'Meals'}</th>
                <th className="text-right py-1.5 px-1.5 sm:py-2 sm:px-2">{ui.budgetTotal || 'Total'}</th>
              </tr>
            </thead>
            <tbody>
              {budget.map((row: BudgetRow, i: number) => (
                <tr key={i} className="border-b border-white/[0.04]">
                  <td className="py-1.5 px-1.5 sm:py-2 sm:px-2 font-semibold">{ui.budgetDay || 'Day'} {row.day}</td>
                  <td className="text-right py-1.5 px-1.5 sm:py-2 sm:px-2 text-white/50">{formatKRW(row.transport_krw)}</td>
                  <td className="text-right py-1.5 px-1.5 sm:py-2 sm:px-2 text-white/50">{formatKRW(row.entry_fees_krw)}</td>
                  <td className="text-right py-1.5 px-1.5 sm:py-2 sm:px-2 text-white/50">{formatKRW(row.meals_krw)}</td>
                  <td className="text-right py-1.5 px-1.5 sm:py-2 sm:px-2 font-bold text-[#7C5CFC]">{formatKRW(row.total_krw)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {tMoney > 0 && (
          <div className="mt-2.5 sm:mt-3 bg-[#7C5CFC]/10 border border-[#7C5CFC]/20 rounded-xl px-3.5 py-2.5 sm:px-4 sm:py-3 flex items-center justify-between">
            <span className="text-[11px] sm:text-xs text-white/60">{ui.tmoneyRecommended || 'Recommended T-money load'}</span>
            <span className="text-[13px] sm:text-sm font-bold text-[#7C5CFC]">{formatKRW(tMoney)}</span>
          </div>
        )}
      </div>
    </section>
  );
}
