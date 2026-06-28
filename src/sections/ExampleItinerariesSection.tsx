// 광고 랜딩용 "지역별 예시 플랜" 섹션 (2026-06-28).
// EXAMPLE_PLANS(정적·실재명소·4언어)를 ExampleTimelineCard 로 렌더.
//   운영자 지적: 기존 "시간|명소|팁" 3컬럼 표는 경쟁사 AI와 똑같이 평범.
//   → 실제 플랜처럼 번호핀 동선 + 구간별 교통(지하철 호선/버스/도보/차량 + 소요분)
//     + 실재 좌표 지도 링크를 보여주는 전용 타임라인 카드로 차별화.
//   - AI 호출 0 → 비용·지연 없음. 미리 만든 예시 노출.
//   - "예시" 배지 필수(운영자 지시) — 실제 예약 데이터 오인 방지.
import { useLanguage } from '@/hooks/useLanguage';
import { Sparkles } from 'lucide-react';
import { ExampleTimelineCard } from './ExampleTimelineCard';
import { EXAMPLE_PLANS, type ExamplePlanI18n } from '@/data/example-plans';

const LABELS: Record<'ko' | 'en' | 'ja' | 'zh', { title: string; subtitle: string; badge: string }> = {
  ko: { title: 'AI가 짜주는 일정, 이렇게 나와요', subtitle: '지역별 1일차 — 구간별 교통까지 담은 실제 생성 예시', badge: '예시' },
  en: { title: 'See What Your AI Plan Looks Like', subtitle: 'Day 1 by region — real samples with segment-by-segment transit', badge: 'SAMPLE' },
  ja: { title: 'AIが作る旅程はこんな感じ', subtitle: '地域別1日目 — 区間ごとの交通まで含む生成サンプル', badge: 'サンプル' },
  zh: { title: 'AI 行程长这样', subtitle: '各地区第1天 — 含逐段交通的真实生成示例', badge: '示例' },
};

export function ExampleItinerariesSection() {
  const { language } = useLanguage();
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
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5 items-stretch">
          {EXAMPLE_PLANS.map((plan) => (
            <div key={plan.region} className="relative">
              <span className="absolute top-3 right-3 z-10 px-2.5 py-1 text-[10px] font-bold rounded-full bg-[#B668FC]/25 text-[#D9B8FF] border border-[#B668FC]/40">
                {L.badge} · {plan.regionLabel[lang]}
              </span>
              <ExampleTimelineCard plan={plan} lang={lang} />
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
