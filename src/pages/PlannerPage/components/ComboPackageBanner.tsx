import type { PlannerDict } from '../types';
// Premium combo discount CTA -- extracted verbatim from legacy PlannerPage.tsx L1052-1096.
import { Ticket, Check, Ban } from 'lucide-react';

export function ComboPackageBanner({ p }: { p: PlannerDict }) {
  return (
    <div className="bg-gradient-to-r from-amber-500/10 to-orange-500/5 border border-amber-500/30 rounded-2xl p-6 mt-6 relative overflow-hidden">
      <div className="absolute top-0 right-0 bg-red-500 text-white text-[10px] font-bold px-3 py-1 rounded-bl-lg shadow-lg">{p.comboSaveBadge}</div>
      <div className="flex items-center gap-3 mb-4">
        <div className="w-10 h-10 rounded-full bg-amber-500/20 flex items-center justify-center shrink-0">
          <Ticket className="w-5 h-5 text-amber-400" />
        </div>
        <div>
          <h3 className="font-bold text-white text-base">{p.comboTitle}</h3>
          <p className="text-xs text-amber-200/80 mt-0.5">{p.comboSubtitle}</p>
        </div>
      </div>
      
      <div className="bg-black/30 rounded-xl p-4 mb-4 border border-white/5">
        <div className="flex justify-between text-xs text-white/50 mb-2">
          <span>{p.comboCompareLabel}</span>
          <span className="line-through">{'\u20A9'}450,000</span>
        </div>
        <div className="flex justify-between items-center">
          <span className="text-sm font-semibold text-white">{p.comboDirectLabel}</span>
          <span className="text-lg font-bold text-amber-400">{'\u20A9'}380,000</span>
        </div>
      </div>
      
      <div className="flex flex-col gap-2">
        <a href="https://wa.me/821087140611?text=Hi!%20I'm%20interested%20in%20the%20Premium%20Combo%20Package.%20Please%20send%20me%20details." target="_blank" rel="noopener noreferrer"
          className="flex flex-col items-center justify-center gap-0.5 w-full py-3.5 rounded-xl text-sm font-bold shadow-2xl transition-all hover:scale-[1.02] cursor-pointer no-underline"
          style={{ background: '#FFC439', color: '#003087', boxShadow: '0 8px 30px rgba(255,196,57,0.3)' }}>
          <span className="flex items-center gap-2">{p.comboCta}</span>
        </a>
        <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 mt-1 text-[11px] text-white/70 font-medium">
          <span className="flex items-center gap-1"><Check className="w-3 h-3 text-emerald-400" /> {p.checkoutSafe}</span>
          <span className="flex items-center gap-1"><Check className="w-3 h-3 text-emerald-400" /> {p.checkoutTip1}</span>
          <span className="flex items-center gap-1"><Ban className="w-3 h-3 text-red-400" /> {p.checkoutTip2}</span>
        </div>
        <div className="text-center mt-3">
          <a href="https://wa.me/821087140611" target="_blank" rel="noopener noreferrer" className="text-[11px] text-white/55 hover:text-white/50 transition-colors underline">
            {p.comboHelp}
          </a>
        </div>
      </div>
    </div>
  );
}
