// eSIM recommendation section -- extracted verbatim from legacy PlannerPage.tsx L960-992.
import { Phone } from 'lucide-react';

export function EsimSection({ p, isMobile }: { p: PlannerDict; isMobile: boolean }) {
  const esimLinks = [
    { name: 'Airalo', url: 'https://www.airalo.com/south-korea', color: '#FF6B35' },
    { name: 'Yesim', url: 'https://yesim.app/', color: '#4CAF50' },
  ];
  return (
    <div className={`rounded-2xl overflow-hidden border mt-6 ${isMobile ? 'border-[#B668FC]/25' : 'border-cyan-500/25'}`}
      style={{ background: isMobile
        ? 'linear-gradient(135deg, rgba(182,104,252,0.08), rgba(255,107,157,0.05))'
        : 'linear-gradient(135deg, rgba(6,182,212,0.08), rgba(59,130,246,0.05))'
      }}>
      <div className="px-5 py-4 flex items-center gap-3">
        <div className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 ${isMobile ? 'bg-[#B668FC]/20 border border-[#B668FC]/30' : 'bg-cyan-500/20 border border-cyan-500/30'}`}>
          <Phone className={`w-5 h-5 ${isMobile ? 'text-[#B668FC]' : 'text-cyan-300'}`} />
        </div>
        <div className="flex-1">
          <p className="font-bold text-white text-base leading-tight">{p.esimTitle || 'Got your Korea eSIM ready?'}</p>
          <p className="text-xs text-white/50 mt-0.5">{p.esimDesc || 'Buy an eSIM before landing and stay connected.'}</p>
        </div>
      </div>
      <div className="px-5 pb-4 flex gap-2">
        {esimLinks.map((link) => (
          <a key={link.name} href={link.url} target="_blank" rel="noopener noreferrer"
            className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-bold text-white transition-all hover:opacity-90 hover:scale-[1.02] active:scale-95"
            style={{ background: link.color, boxShadow: `0 4px 16px ${link.color}40` }}>
            {link.name} →
          </a>
        ))}
      </div>
      <p className="text-[10px] text-white/20 text-center pb-3 px-5">{p.esimNote || 'Purchasing via these links helps support CocoTrip.'}</p>
    </div>
  );
}
