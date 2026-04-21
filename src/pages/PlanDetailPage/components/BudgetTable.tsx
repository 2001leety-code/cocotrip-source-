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
    <section className="mb-6">
      <button onClick={() => setOpen(!open)} className="w-full flex items-center justify-between bg-white/[0.04] border border-white/[0.08] rounded-2xl px-5 py-4">
        <div className="flex items-center gap-3">
          <Wallet className="w-5 h-5 text-[#7C5CFC]" />
          <p className="text-sm font-bold">{ui.budgetSummary || 'Daily Budget Summary'}</p>
        </div>
        <ChevronDown className={`w-4 h-4 text-white/30 transition-transform duration-300 ${open ? 'rotate-180' : ''}`} />
      </button>
      <div className={`overflow-hidden transition-all duration-300 ease-out ${open ? 'max-h-[1000px] opacity-100 mt-3' : 'max-h-0 opacity-0'}`}>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-white/30 border-b border-white/[0.08]">
                <th className="text-left py-2 px-2">{ui.budgetDay || 'Day'}</th>
                <th className="text-right py-2 px-2">{ui.budgetTransport || 'Transport'}</th>
                <th className="text-right py-2 px-2">{ui.budgetEntry || 'Entry'}</th>
                <th className="text-right py-2 px-2">{ui.budgetMeals || 'Meals'}</th>
                <th className="text-right py-2 px-2">{ui.budgetTotal || 'Total'}</th>
              </tr>
            </thead>
            <tbody>
              {budget.map((row: BudgetRow, i: number) => (
                <tr key={i} className="border-b border-white/[0.04]">
                  <td className="py-2 px-2 font-semibold">{ui.budgetDay || 'Day'} {row.day}</td>
                  <td className="text-right py-2 px-2 text-white/50">{formatKRW(row.transport_krw)}</td>
                  <td className="text-right py-2 px-2 text-white/50">{formatKRW(row.entry_fees_krw)}</td>
                  <td className="text-right py-2 px-2 text-white/50">{formatKRW(row.meals_krw)}</td>
                  <td className="text-right py-2 px-2 font-bold text-[#7C5CFC]">{formatKRW(row.total_krw)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {tMoney > 0 && (
          <div className="mt-3 bg-[#7C5CFC]/10 border border-[#7C5CFC]/20 rounded-xl px-4 py-3 flex items-center justify-between">
            <span className="text-xs text-white/60">{ui.tmoneyRecommended || 'Recommended T-money load'}</span>
            <span className="text-sm font-bold text-[#7C5CFC]">{formatKRW(tMoney)}</span>
          </div>
        )}
      </div>
    </section>
  );
}
