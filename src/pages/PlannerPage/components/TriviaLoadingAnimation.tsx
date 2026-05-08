import type { PlannerDict } from '../types';
// Trivia loading animation with 4-step progress indicator + Korea travel tips slideshow.
// 2026-05-08: honest time display (1–2 min), step labels with tech hints,
//             10-tip slideshow for en/ja/zh; ko users see existing Korean tips.
import { useState, useEffect } from 'react';
import { Globe, Check, Lightbulb } from 'lucide-react';

interface TriviaLoadingAnimationProps {
  p: PlannerDict;
  streamStep?: number;
  /** Current user language — ko keeps Korean tips, others get travel tips. */
  lang?: string;
}

export function TriviaLoadingAnimation({ p, streamStep, lang = 'en' }: TriviaLoadingAnimationProps) {
  const tips: string[]   = p.loading_tips ?? [];
  const phases: string[] = [p.loading_step1, p.loading_step2, p.loading_step3, p.loading_step4];
  const [tipIdx,   setTipIdx]   = useState(0);
  const [phaseIdx, setPhaseIdx] = useState(0);
  const [visible,  setVisible]  = useState(true);

  useEffect(() => {
    if (!tips.length) return;
    const tipsLen   = tips.length;
    const phasesLen = phases.length;
    const tipTimer  = setInterval(() => {
      setVisible(false);
      setTimeout(() => { setTipIdx(i => (i + 1) % tipsLen); setVisible(true); }, 400);
    }, 3400);
    const phaseTimer = setInterval(() => {
      setPhaseIdx(i => Math.min(i + 1, phasesLen - 1));
    }, 4000);
    return () => { clearInterval(tipTimer); clearInterval(phaseTimer); };
  }, [tips.length, phases.length]);

  const progressPercent = streamStep
    ? Math.round((streamStep / 6) * 100)
    : Math.round(((phaseIdx + 1) / phases.length) * 100);

  // "1~2분" honest time label — pull from locale if available, fallback per lang
  const timeLabel: string = (p.takesAbout15Sec as string | undefined)
    ?? (lang === 'ko' ? '보통 1~2분 정도 걸려요'
      : lang === 'ja' ? '通常1〜2分かかります'
      : lang === 'zh' ? '通常需要 1~2 分钟'
      : 'Usually takes 1–2 minutes');

  const analyzingLabel: string = (p.planReadyEmailAnalyzing as string | undefined)
    ?? (lang === 'ko' ? '더 좋은 일정을 위해 데이터를 분석 중입니다'
      : lang === 'ja' ? 'より良い日程のためにデータを分析しています'
      : lang === 'zh' ? '正在分析数据，为您打造最优行程'
      : 'Analyzing data for the best possible itinerary');

  // Whether to show the tip section (always true — ko has its own tips, others get travel tips)
  const showTips = tips.length > 0;

  return (
    <div className="rounded-2xl border border-white/10 overflow-hidden"
      style={{ background: 'linear-gradient(160deg, #0c1220 0%, #0f2244 100%)' }}>

      {/* Progress bar */}
      <div className="relative h-1.5 bg-white/8 overflow-hidden">
        <div className="absolute h-full rounded-full transition-all duration-1000 ease-out"
          style={{ width: `${progressPercent}%`, background: 'linear-gradient(90deg, #7C5CFC, #EA537E)' }} />
      </div>

      <div className="flex flex-col items-center py-8 px-6 gap-5">

        {/* Globe icon with pulse rings */}
        <div className="relative w-14 h-14 flex items-center justify-center">
          {[0, 1].map((i) => (
            <div key={i} className="absolute inset-0 rounded-full border border-[#7C5CFC]/30"
              style={{ animation: 'pulse-ring 2s ease-out infinite', animationDelay: `${i * 0.8}s` }} />
          ))}
          <Globe className="w-7 h-7 text-[#7C5CFC]" />
        </div>

        {/* Honest time label */}
        <div className="text-center space-y-1">
          <p className="text-white/80 text-sm font-semibold">{timeLabel}</p>
          <p className="text-white/45 text-[11px] leading-relaxed">{analyzingLabel}</p>
        </div>

        {/* 4-Step Progress Indicator */}
        <div className="w-full max-w-xs space-y-2">
          {phases.map((phase, idx) => {
            const done   = idx < phaseIdx;
            const active = idx === phaseIdx;
            return (
              <div key={idx} className={`flex items-center gap-3 px-3 py-2 rounded-xl transition-all duration-500 ${
                active ? 'bg-[#7C5CFC]/10 border border-[#7C5CFC]/25'
                       : done ? 'bg-emerald-500/5 border border-emerald-500/15'
                               : 'border border-transparent'
              }`}>
                <div className={`w-6 h-6 rounded-full flex items-center justify-center shrink-0 transition-all duration-500 ${
                  done   ? 'bg-emerald-500/20 text-emerald-400'
                         : active ? 'bg-[#7C5CFC]/20 text-[#7C5CFC]'
                                  : 'bg-white/5 text-white/55'
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
                  done ? 'text-emerald-400/70' : active ? 'text-white/80' : 'text-white/55'
                }`}>{phase}</span>
              </div>
            );
          })}
        </div>

        {/* Tips slideshow */}
        {showTips && (
          <div className="w-full max-w-xs">
            <div className="flex items-center gap-1.5 mb-2 justify-center">
              <Lightbulb className="w-3 h-3 text-amber-400/70" />
              <span className="text-[10px] text-white/40 uppercase tracking-wider font-semibold">
                {lang === 'ko' ? '알고 계셨나요?' : lang === 'ja' ? 'ご存知ですか？' : lang === 'zh' ? '小知识' : 'Travel Tip'}
              </span>
            </div>
            <div className="text-center min-h-[44px] flex items-center justify-center
              px-3 py-2.5 rounded-xl border border-white/[0.07]"
              style={{ background: 'rgba(255,255,255,0.03)' }}>
              <p className="text-[11px] text-white/60 leading-relaxed max-w-xs"
                style={{
                  opacity: visible ? 1 : 0,
                  transform: visible ? 'translateY(0)' : 'translateY(6px)',
                  transition: 'opacity 0.35s ease, transform 0.35s ease',
                }}>
                {tips[tipIdx]}
              </p>
            </div>
            {/* Dot indicator */}
            <div className="flex justify-center gap-1 mt-2">
              {tips.slice(0, 10).map((_, i) => (
                <div key={i} className={`h-1 rounded-full transition-all duration-500 ${
                  i === tipIdx % tips.length
                    ? 'w-4 bg-[#7C5CFC]/70'
                    : 'w-1 bg-white/15'
                }`} />
              ))}
            </div>
          </div>
        )}

        {streamStep != null && (
          <p className="text-[10px] text-white/55">
            {(p.streamStepStatus as string | undefined || '').replace('{step}', String(streamStep))}
          </p>
        )}
      </div>
    </div>
  );
}
