// 광고 랜딩용 "지역별 예시 플랜" 섹션 (2026-06-28).
// EXAMPLE_PLANS(정적·실재명소·4언어)를 QuickPreviewCard(타임라인 카드)로 렌더.
//   - AI 호출 0 → 비용·지연 없음. 매번 생성 안 하고 미리 만든 예시 노출.
//   - "예시" 배지 필수(운영자 지시) — 실제 예약 데이터 오인 방지.
//   - QuickPreviewCard 그대로 재사용(타임라인·지도링크 동일 UX).
import { useLanguage } from '@/hooks/useLanguage';
import { useIsMobile } from '@/hooks/use-mobile';
import { Sparkles } from 'lucide-react';
import { QuickPreviewCard } from '@/pages/PlannerPage/components/QuickPreviewCard';
import { EXAMPLE_PLANS, type ExamplePlanI18n } from '@/data/example-plans';

const LABELS: Record<'ko' | 'en' | 'ja' | 'zh', { title: string; subtitle: string; badge: string }> = {
  ko: { title: 'AI가 짜주는 일정, 이렇게 나와요', subtitle: '지역별 1일차 하이라이트 — 실제 생성 예시', badge: '예시' },
  en: { title: 'See What Your AI Plan Looks Like', subtitle: 'Day 1 highlights by region — real generation samples', badge: 'SAMPLE' },
  ja: { title: 'AIが作る旅程はこんな感じ', subtitle: '地域別1日目ハイライト — 生成サンプル', badge: 'サンプル' },
  zh: { title: 'AI 行程长这样', subtitle: '各地区第1天亮点 — 生成示例', badge: '示例' },
};

export function ExampleItinerariesSection() {
  const { language, t } = useLanguage();
  const isMobile = useIsMobile();
  const p = t.planner;
  const lang = (['ko', 'en', 'ja', 'zh'].includes(language) ? language : 'en') as keyof ExamplePlanI18n;
  const L = LABELS[lang];

  return (
    <section className="py-14 px-4" style={{ background: 'linear-gradient(180deg, #0a1628 0%, #0c1220 100%)' }}>
      <div className="max-w-6xl mx-auto">
        <div className="text-center mb-8">
          <h2 className="text-2xl md:text-3xl font-bold text-white flex items-center justify-center gap-2">
            <Sparkles className="w-6 h-6 text-[#B668FC]" aria-hidden /> {L.title}
          </h2>
          <p className="text-sm text-white/55 mt-2">{L.subtitle}</p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {EXAMPLE_PLANS.map((plan) => (
            <div key={plan.region} className="relative">
              <span className="absolute top-3 right-3 z-10 px-2.5 py-1 text-[10px] font-bold rounded-full bg-[#B668FC]/25 text-[#D9B8FF] border border-[#B668FC]/40">
                {L.badge} · {plan.regionLabel[lang]}
              </span>
              <QuickPreviewCard
                resultQuick={{
                  themes: plan.themes[lang],
                  marketingNarrative: plan.narrative[lang],
                  day1MarkdownTable: plan.day1Table[lang],
                }}
                p={p}
                isMobile={isMobile}
              />
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
