// eSIM affiliate banner (Airalo + Yesim).
// Extracted from PlanDetailPage/index.tsx L488-513 (zero behavior change).
import { Phone } from 'lucide-react';
import { useLanguage } from '@/hooks/useLanguage';

export function EsimAd() {
  const { t } = useLanguage();

  return (
    <div className="rounded-2xl overflow-hidden border border-[#B668FC]/25 mt-6"
      style={{ background: 'linear-gradient(135deg, rgba(182,104,252,0.08), rgba(255,107,157,0.05))' }}>
      <div className="px-5 py-4 flex items-center gap-3">
        <div className="w-10 h-10 rounded-full flex items-center justify-center shrink-0 bg-[#B668FC]/20 border border-[#B668FC]/30">
          <Phone className="w-5 h-5 text-[#B668FC]" />
        </div>
        <div className="flex-1">
          <p className="font-bold text-white text-base leading-tight">{t.planner?.esimTitle || 'Got your Korea eSIM ready?'}</p>
          <p className="text-xs text-white/50 mt-0.5">{t.planner?.esimDesc || 'Buy an eSIM before landing and stay connected.'}</p>
        </div>
      </div>
      <div className="px-5 pb-4 flex gap-2">
        <a href="https://www.airalo.com/south-korea" target="_blank" rel="noopener noreferrer"
          className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-bold text-white transition-all hover:opacity-90 hover:scale-[1.02] active:scale-95"
          style={{ background: '#FF6B35', boxShadow: '0 4px 16px rgba(255,107,53,0.25)' }}>
          Airalo {'\u2192'}
        </a>
        <a href="https://yesim.app/" target="_blank" rel="noopener noreferrer"
          className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-bold text-white transition-all hover:opacity-90 hover:scale-[1.02] active:scale-95"
          style={{ background: '#4CAF50', boxShadow: '0 4px 16px rgba(76,175,80,0.25)' }}>
          Yesim {'\u2192'}
        </a>
      </div>
      <p className="text-[10px] text-white/55 text-center pb-3 px-5">{t.planner?.esimNote || 'Purchasing via these links helps support CocoTrip.'}</p>
    </div>
  );
}
