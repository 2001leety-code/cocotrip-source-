import type { PlannerDict } from '../types';
// Trivia loading animation with 4-step progress indicator.
// Extracted verbatim from legacy PlannerPage.tsx L183-261.
import { useState, useEffect } from 'react';
import { Globe, Check } from 'lucide-react';

export function TriviaLoadingAnimation({ p, streamStep }: { p: PlannerDict; streamStep?: number }) {
  const tips: string[]   = p.loading_tips ?? [];
  const phases: string[] = [p.loading_step1, p.loading_step2, p.loading_step3, p.loading_step4];
  const [tipIdx,   setTipIdx]   = useState(0);
  const [phaseIdx, setPhaseIdx] = useState(0);
  const [visible,  setVisible]  = useState(true);

  useEffect(() => {
    if (!tips.length) return;
    const tipTimer = setInterval(() => {
      setVisible(false);
      setTimeout(() => { setTipIdx(i => (i + 1) % tips.length); setVisible(true); }, 400);
    }, 3400);
    const phaseTimer = setInterval(() => {
      setPhaseIdx(i => Math.min(i + 1, phases.length - 1));
    }, 4000);
    return () => { clearInterval(tipTimer); clearInterval(phaseTimer); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const progressPercent = streamStep ? Math.round((streamStep / 6) * 100) : Math.round(((phaseIdx + 1) / phases.length) * 100);

  return (
    <div className="rounded-2xl border border-white/10 overflow-hidden"
      style={{ background: 'linear-gradient(160deg, #0c1220 0%, #0f2244 100%)' }}>
      <div className="relative h-1.5 bg-white/8 overflow-hidden">
        <div className="absolute h-full rounded-full transition-all duration-1000 ease-out"
          style={{ width: `${progressPercent}%`, background: 'linear-gradient(90deg, #7C5CFC, #EA537E)' }} />
      </div>
      <div className="flex flex-col items-center py-8 px-6 gap-5">
        <div className="relative w-14 h-14 flex items-center justify-center">
          {[0, 1].map((i) => (
            <div key={i} className="absolute inset-0 rounded-full border border-[#7C5CFC]/30"
              style={{ animation: 'pulse-ring 2s ease-out infinite', animationDelay: `${i * 0.8}s` }} />
          ))}
          <Globe className="w-7 h-7 text-[#7C5CFC]" />
        </div>

        {/* 4-Step Progress Indicator */}
        <div className="w-full max-w-xs space-y-2">
          {phases.map((phase, idx) => {
            const done = idx < phaseIdx;
            const active = idx === phaseIdx;
            return (
              <div key={idx} className={`flex items-center gap-3 px-3 py-2 rounded-xl transition-all duration-500 ${
                active ? 'bg-[#7C5CFC]/10 border border-[#7C5CFC]/25' : done ? 'bg-emerald-500/5 border border-emerald-500/15' : 'border border-transparent'
              }`}>
                <div className={`w-6 h-6 rounded-full flex items-center justify-center shrink-0 transition-all duration-500 ${
                  done ? 'bg-emerald-500/20 text-emerald-400' : active ? 'bg-[#7C5CFC]/20 text-[#7C5CFC]' : 'bg-white/5 text-white/20'
                }`}>
                  {done ? (
                    <Check className="w-3.5 h-3.5" />
                  ) : active ? (
                    <div className="w-2 h-2 rounded-full bg-[#7C5CFC] animate-pulse" />
                  ) : (
                    <span className="text-[10px] font-bold">{idx + 1}</span>
                  )}
                </div>
                <span className={`text-xs font-medium transition-all duration-500 ${
                  done ? 'text-emerald-400/70' : active ? 'text-white/80' : 'text-white/25'
                }`}>{phase}</span>
              </div>
            );
          })}
        </div>

        {/* Trivia Tip */}
        <div className="text-center min-h-[40px] flex items-center mt-1">
          <p className="text-[11px] text-white/45 leading-relaxed max-w-xs"
            style={{ opacity: visible ? 1 : 0, transform: visible ? 'translateY(0)' : 'translateY(6px)', transition: 'opacity 0.35s ease, transform 0.35s ease' }}>
            {tips[tipIdx]}
          </p>
        </div>

        {streamStep && <p className="text-[10px] text-white/30">{(p.streamStepStatus || '').replace('{step}', String(streamStep))}</p>}
      </div>
    </div>
  );
}
