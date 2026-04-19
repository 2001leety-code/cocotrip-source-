// Budget summary card -- extracted verbatim from legacy PlannerPage.tsx L723-747.
import { Bus as BusIcon, UtensilsCrossed, Ticket, Hotel, CreditCard } from 'lucide-react';
import type { BudgetSummary } from '../types';

export function BudgetCard({ budget, p }: { budget: BudgetSummary; p: any }) {
  const items = [
    { label: p.budgetTransport,     value: budget.transport,     icon: <BusIcon className="w-4 h-4" /> },
    { label: p.budgetFood,          value: budget.food,          icon: <UtensilsCrossed className="w-4 h-4" /> },
    { label: p.budgetAdmission,     value: budget.admission,     icon: <Ticket className="w-4 h-4" /> },
    { label: p.budgetAccommodation, value: budget.accommodation, icon: <Hotel className="w-4 h-4" /> },
  ];
  return (
    <div className="bg-white/5 border border-white/10 rounded-2xl p-5 mt-6">
      <p className="text-xs font-semibold text-white/30 uppercase tracking-widest mb-4 flex items-center gap-1"><CreditCard className="w-3.5 h-3.5" /> {p.budgetLabel}</p>
      <div className="grid grid-cols-2 gap-2 mb-4">
        {items.map((item) => (
          <div key={item.label} className="bg-white/[0.04] border border-white/[0.08] rounded-xl px-3 py-2.5">
            <p className="text-xs text-white/40 mb-1">{item.icon} {item.label}</p>
            <p className="text-sm font-semibold text-white">{item.value}</p>
          </div>
        ))}
      </div>
      <div className="bg-gradient-to-r from-blue-500/15 to-cyan-400/10 border border-cyan-400/25 rounded-xl px-4 py-3 flex items-center justify-between">
        <span className="text-sm font-semibold text-white/70">{p.budgetTotal}</span>
        <span className="text-base font-bold text-cyan-300">{budget.total}</span>
      </div>
    </div>
  );
}
