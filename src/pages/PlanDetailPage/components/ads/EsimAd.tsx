// eSIM affiliate banner (Airalo + Yesim).
// Extracted from PlanDetailPage/index.tsx L488-513.
//
// 2026-05-08: \uc5b4\ud544\ub9ac\uc5d0\uc774\ud2b8 ID env-based \ubcc0\uacbd.
//   - VITE_AIRALO_AFFILIATE_ID  \u2192 Airalo Affiliate Program \uac00\uc785 \ud6c4 \ubc1c\uae09\ubc1b\uc740 ref ID
//   - VITE_YESIM_AFFILIATE_ID   \u2192 Yesim Affiliate Program \uac00\uc785 \ud6c4 \ubc1c\uae09\ubc1b\uc740 ref ID
// env \ubbf8\uc124\uc815 \uc2dc fallback (\ub2e8\uc21c \ub9c1\ud06c) \u2014 \uc6b4\uc601\uc790 \ub4f1\ub85d \uc804\uc5d0\ub3c4 \uc791\ub3d9, \ub9e4\ucd9c\ub9cc 0.
//
// \uc6b4\uc601\uc790 \uc561\uc158 \ud544\uc694:
//   1. https://www.airalo.com/affiliate-program \uac00\uc785 \u2192 ID \ubc1c\uae09
//   2. https://yesim.app/ Affiliate \ubb38\uc758 \u2192 ID \ubc1c\uae09
//   3. Vercel Dashboard \u2192 Project Settings \u2192 Environment Variables \ub4f1\ub85d
//   4. \uc7ac\ubc30\ud3ec
import { Phone } from 'lucide-react';
import { useLanguage } from '@/hooks/useLanguage';

// Airalo: \ud45c\uc900 affiliate URL = https://www.airalo.com/?ref={id}
// \ud55c\uad6d \ud398\uc774\uc9c0 \ucee8\ud14d\uc2a4\ud2b8 \uc720\uc9c0 \uc704\ud574 destination \ucffc\ub9ac\ub3c4 \ud568\uaed8 \u2014 \ubbf8\uc124\uc815 \uc2dc fallback.
function buildAiraloUrl(): string {
  const id = (import.meta.env.VITE_AIRALO_AFFILIATE_ID as string | undefined)?.trim();
  if (id) {
    // Airalo \uacf5\uc2dd deep-link \ud328\ud134: ref + utm_source \ub3d9\uc2dc \uc804\uc1a1.
    return `https://www.airalo.com/south-korea?ref=${encodeURIComponent(id)}&utm_source=cocotripkr&utm_medium=affiliate`;
  }
  return 'https://www.airalo.com/south-korea';
}

// Yesim: \ud45c\uc900 ref \ud30c\ub77c\ubbf8\ud130 \u2014 \ubbf8\uc124\uc815 \uc2dc fallback.
function buildYesimUrl(): string {
  const id = (import.meta.env.VITE_YESIM_AFFILIATE_ID as string | undefined)?.trim();
  if (id) {
    return `https://yesim.app/?ref=${encodeURIComponent(id)}&utm_source=cocotripkr&utm_medium=affiliate`;
  }
  return 'https://yesim.app/';
}

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
        <a href={buildAiraloUrl()} target="_blank" rel="noopener noreferrer"
          className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-bold text-white transition-all hover:opacity-90 hover:scale-[1.02] active:scale-95"
          style={{ background: '#FF6B35', boxShadow: '0 4px 16px rgba(255,107,53,0.25)' }}>
          Airalo {'\u2192'}
        </a>
        <a href={buildYesimUrl()} target="_blank" rel="noopener noreferrer"
          className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-bold text-white transition-all hover:opacity-90 hover:scale-[1.02] active:scale-95"
          style={{ background: '#4CAF50', boxShadow: '0 4px 16px rgba(76,175,80,0.25)' }}>
          Yesim {'\u2192'}
        </a>
      </div>
      <p className="text-[10px] text-white/55 text-center pb-3 px-5">{t.planner?.esimNote || 'Purchasing via these links helps support CocoTrip.'}</p>
    </div>
  );
}
