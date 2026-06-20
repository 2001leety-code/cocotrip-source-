// 활동 가이드 슬라이드 (2026-06-03) — plan 의 따릉이/러닝/트레킹에 대한 6살용 how-to.
// 마지막 Day 와 Wrap-up 사이 탭. 콘텐츠는 src/lib/activityGuides.ts (4개국어).
// flag VITE_FEATURE_ACTIVITY_GUIDE 로 노출 제어 (buildSlides 에서 게이트).
import { Bike, PersonStanding, Mountain, ExternalLink, AlertTriangle } from 'lucide-react';
import type { Language } from '@/i18n';
import { detectActivities, ACTIVITY_GUIDES, buildMapLink, type ActivityKind } from '@/lib/activityGuides';
import type { PlanDocument } from '../types';

const ICONS: Record<ActivityKind, typeof Bike> = {
  bike: Bike,
  running: PersonStanding,
  trekking: Mountain,
};

const HEADING: Record<Language, { title: string; subtitle: string }> = {
  ko: { title: '활동 가이드', subtitle: '고른 활동을 6살도 따라할 만큼 쉽게 알려드려요' },
  en: { title: 'Activity Guide', subtitle: 'Your chosen activities, explained simply enough for a 6-year-old' },
  ja: { title: 'アクティビティガイド', subtitle: '選んだアクティビティを、6歳でも分かるほど簡単に' },
  zh: { title: '活动指南', subtitle: '把你选的活动讲得连6岁孩子都能照做' },
};

export function ActivityGuideSlide({ plan, language }: { plan: PlanDocument; language: Language }) {
  const activities = detectActivities(plan);
  if (activities.length === 0) return null;

  // 종류당 1개 가이드 (같은 활동이 여러 day 면 첫 day 기준).
  const seen = new Set<ActivityKind>();
  const unique = activities.filter((a) => (seen.has(a.kind) ? false : (seen.add(a.kind), true)));

  const h = HEADING[language] || HEADING.en;

  return (
    <div className="py-4">
      <div className="mb-5 text-center">
        <h2 className="text-3xl font-black tracking-tight leading-tight text-white">{h.title}</h2>
        <p className="text-sm text-white/55 mt-1">{h.subtitle}</p>
      </div>

      <div className="space-y-5">
        {unique.map((act) => {
          const g = ACTIVITY_GUIDES[act.kind][language] || ACTIVITY_GUIDES[act.kind].en;
          const Icon = ICONS[act.kind];
          return (
            <div key={act.kind} className="bg-white/[0.04] border border-white/[0.10] rounded-2xl p-5">
              <div className="flex items-center gap-3 mb-2">
                <div className="p-2 rounded-xl bg-[#7C5CFC]/15 text-[#B668FC]">
                  <Icon className="w-5 h-5" />
                </div>
                <h3 className="text-lg font-bold text-white">{g.title}</h3>
              </div>
              <p className="text-sm text-white/60 mb-4">{g.intro}</p>

              <ol className="space-y-2 mb-4">
                {g.steps.map((s, i) => (
                  <li key={i} className="flex gap-3 text-sm text-white/85">
                    <span className="shrink-0 w-6 h-6 rounded-full bg-[#7C5CFC]/20 text-[#B668FC] text-xs font-bold flex items-center justify-center">{i + 1}</span>
                    <span className="pt-0.5">{s}</span>
                  </li>
                ))}
              </ol>

              {g.warnings.length > 0 && (
                <div className="space-y-2 mb-4">
                  {g.warnings.map((w, i) => (
                    <div key={i} className="flex gap-2 text-[13px] text-amber-200/90 bg-amber-400/10 border border-amber-400/20 rounded-lg px-3 py-2">
                      <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-amber-400" />
                      <span>{w}</span>
                    </div>
                  ))}
                </div>
              )}

              <a
                href={buildMapLink(act.startName)}
                target="_blank"
                rel="noreferrer noopener"
                className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-[#B668FC] hover:text-white transition-colors"
              >
                <ExternalLink className="w-4 h-4" />
                {g.mapLabel}
              </a>
            </div>
          );
        })}
      </div>
    </div>
  );
}
