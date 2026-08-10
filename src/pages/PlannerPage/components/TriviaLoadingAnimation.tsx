import type { PlannerDict } from '../types';
// Loading state — 4-step progress + Korea travel tips slideshow.
// 2026-05-08: honest time display (1–2 min), step labels with tech hints,
//             10-tip slideshow for en/ja/zh; ko users see existing Korean tips.
// 2026-08-10 (Korea Editorial Concierge): converted from the dark card with
//   pulse rings and a gradient bar to a working document — a rule that fills,
//   phases as a checklist, the tip set below a hairline. Three real gaps closed
//   at the same time:
//     · it was not announced at all, so a screen-reader user heard nothing
//       between pressing generate and the plan arriving (role=status + live region);
//     · past the honest ETA it kept saying the same ETA, with no acknowledgement
//       that it was running long (`slowNote`);
//     · the tip crossfade used a hardcoded 0.35s, so `prefers-reduced-motion`
//       did not reach it. It rides the duration token now.
//   The phase labels still name the real engine — that is transparency about
//   mechanism, which the design system keeps; it is the marketing surfaces that
//   lead with the itinerary instead.
import { useState, useEffect } from 'react';
import { Check } from 'lucide-react';
import { pickPlannerCopy } from '../plannerCopy';

interface TriviaLoadingAnimationProps {
  p: PlannerDict;
  streamStep?: number;
  /** Current user language — ko keeps Korean tips, others get travel tips. */
  lang?: string;
  /** P163 (2026-05-23): 일수 → 동적 ETA. 없으면 기본 1~2분 라벨 유지. */
  durationDays?: number;
  /**
   * 2026-08-10 follow-up — this screen serves two different runs.
   *
   * Paid (`PurchaseSection`): the six-agent full pipeline. The ETA, the four
   * phases and the "n / 6 agents" counter all describe it accurately, and the
   * slow note can offer the emailed plan because the plan is emailed.
   *
   * Free (`/api/ai-planner-quick`, wizard submit): one call that returns day one.
   * Quoting a several-minute ETA, a route-calculation phase list and an email
   * that is never sent describes work that is not happening. In preview mode
   * this component states what it is writing and drops every claim it cannot
   * stand behind.
   */
  preview?: boolean;
}

/** When the wait passes this, say so rather than repeating the same estimate. */
const SLOW_AFTER_MS = 75_000;

export function TriviaLoadingAnimation({ p, streamStep, lang = 'en', durationDays, preview = false }: TriviaLoadingAnimationProps) {
  const c = pickPlannerCopy(lang);
  const tips: string[]   = p.loading_tips || [];
  const phases: string[] = [p.loading_step1, p.loading_step2, p.loading_step3, p.loading_step4];
  const [tipIdx,   setTipIdx]   = useState(0);
  const [phaseIdx, setPhaseIdx] = useState(0);
  const [visible,  setVisible]  = useState(true);
  const [isSlow,   setIsSlow]   = useState(false);

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

  // Runs regardless of whether tips exist — the acknowledgement is about the
  // wait, not about the slideshow.
  useEffect(() => {
    const id = setTimeout(() => setIsSlow(true), SLOW_AFTER_MS);
    return () => clearTimeout(id);
  }, []);

  const progressPercent = streamStep
    ? Math.round((streamStep / 6) * 100)
    : Math.round(((phaseIdx + 1) / phases.length) * 100);

  // "1~2분" honest time label — pull from locale if available, fallback per lang.
  // P163 (2026-05-23): durationDays 있으면 동적 ETA (3일 2~3분 / 5일 3~4분 / 7일 4~5분).
  const _etaMin = !durationDays || durationDays <= 0
    ? '1~2'
    : durationDays <= 2 ? '1~2'
    : durationDays <= 3 ? '2~3'
    : durationDays <= 5 ? '3~4'
    : durationDays <= 7 ? '4~5'
    : '5';
  const timeLabel: string = durationDays
    ? (lang === 'ko' ? `${durationDays}일 플랜 — 약 ${_etaMin}분 예상`
      : lang === 'ja' ? `${durationDays}日プラン — 約 ${_etaMin}分`
      : lang === 'zh' ? `${durationDays}天行程 — 约 ${_etaMin}分钟`
      : `${durationDays}-day plan — ~${_etaMin} min`)
    : ((p.takesAbout15Sec as string | undefined)
      || (lang === 'ko' ? '보통 1~2분 정도 걸려요'
        : lang === 'ja' ? '通常1〜2分かかります'
        : lang === 'zh' ? '通常需要 1~2 分钟'
        : 'Usually takes 1–2 minutes'));

  const analyzingLabel: string = (p.planReadyEmailAnalyzing as string | undefined)
    || (lang === 'ko' ? '더 좋은 일정을 위해 데이터를 분석 중입니다'
      : lang === 'ja' ? 'より良い日程のためにデータを分析しています'
      : lang === 'zh' ? '正在分析数据，为您打造最优行程'
      : 'Analyzing data for the best possible itinerary');

  // Whether to show the tip section (always true — ko has its own tips, others get travel tips)
  const showTips = tips.length > 0;

  return (
    <section
      role="status"
      aria-live="polite"
      aria-busy="true"
      className="ec-panel"
    >
      <div className="flex items-baseline justify-between gap-3">
        <p className="ec-eyebrow">{preview ? c.loading.previewEyebrow : c.loading.eyebrow}</p>
        {/* The percentage is derived from the paid pipeline's phase clock. On a
            free preview it would be a number measuring nothing, and it reaches
            100% while the request is still open. */}
        {!preview && <p className="ec-figure text-[13px] text-ec-ink-3">{progressPercent}%</p>}
      </div>
      <h2 className="ec-h3 mt-2">{preview ? c.loading.previewHeading : c.loading.heading}</h2>

      {!preview && (
        <div className="ec-steprail mt-3" aria-hidden>
          <span className="ec-steprail-fill" style={{ width: `${progressPercent}%` }} />
        </div>
      )}

      {!preview && <p className="ec-body-sm mt-3 text-ec-ink">{timeLabel}</p>}
      <p className={`ec-body-sm text-ec-ink-3 ${preview ? 'mt-3' : ''}`}>{analyzingLabel}</p>

      {/* Running long. Said once, plainly, with the way out — for the paid run
          the plan is also emailed, so closing the tab is not losing it. The free
          preview is not emailed anywhere, so it says the one thing that is true
          of it instead: nothing has been charged. */}
      {isSlow && (
        <p className="ec-error-note mt-3 border-ec-notice text-ec-notice">
          {preview ? c.loading.previewSlowNote : c.loading.slowNote}
        </p>
      )}

      {/* Phases — a checklist, not four glowing rows. Done items keep their
          label so the traveller can see what has already happened. They name the
          paid pipeline's stages (DB matching, Naver/ODsay routing, saving), so
          the free preview does not borrow them. */}
      {!preview && (
      <ol className="mt-5 border-t border-ec-line">
        {phases.map((phase, idx) => {
          const done   = idx < phaseIdx;
          const active = idx === phaseIdx;
          return (
            <li
              key={idx}
              className="flex items-center gap-2.5 border-b border-ec-line py-2.5"
              aria-current={active ? 'step' : undefined}
            >
              <span className="grid h-5 w-5 shrink-0 place-items-center" aria-hidden>
                {done
                  ? <Check className="h-4 w-4 text-ec-success" />
                  : <span className={`ec-figure text-[11px] ${active ? 'text-ec-brand' : 'text-ec-ink-4'}`}>{idx + 1}</span>}
              </span>
              <span className={`text-[13px] ${active ? 'font-semibold text-ec-ink' : done ? 'text-ec-ink-3' : 'text-ec-ink-3'}`}>
                {phase}
              </span>
            </li>
          );
        })}
      </ol>
      )}

      {/* Tips slideshow */}
      {showTips && (
        <div className="mt-5">
          <p className="ec-eyebrow">{c.loading.tipLabel}</p>
          <div className="ec-panel-quiet mt-2 min-h-[68px]">
            <p
              className="ec-body-sm text-ec-ink-2"
              style={{
                opacity: visible ? 1 : 0,
                transition: 'opacity var(--ec-duration-slow) var(--ec-ease-standard)',
              }}
            >
              {tips[tipIdx]}
            </p>
          </div>
        </div>
      )}

      {/* "n / 6 agents running" counts the paid pipeline's agents. The free
          preview is a single call, so it does not claim six. */}
      {!preview && streamStep != null && (
        <p className="ec-body-sm mt-3 text-ec-ink-4">
          {(p.streamStepStatus as string | undefined || '').replace('{step}', String(streamStep))}
        </p>
      )}
    </section>
  );
}
