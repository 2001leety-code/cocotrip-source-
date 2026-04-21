import { Link } from 'react-router-dom';
import { ArrowRight, Bot, Car } from 'lucide-react';
import type { Translations } from '@/i18n';

interface HeroCardsProps {
  t: Translations;
}

export function HeroCards({ t }: HeroCardsProps) {
  const hc = t.heroCards ?? {};

  return (
    <section className="bg-[#faf9f6] py-16 lg:py-24 px-4">
      <div className="max-w-5xl mx-auto">
        {/* Heading */}
        <div className="text-center mb-10">
          <h2 className="text-2xl sm:text-3xl lg:text-4xl font-bold text-[#1a1a2e] leading-tight">
            {hc.heading ?? '한국 여행, 어떻게 도와드릴까요?'}
          </h2>
          <p className="text-gray-500 text-sm sm:text-base mt-2">
            {hc.subheading ?? '원하는 서비스를 선택하세요'}
          </p>
        </div>

        {/* 2 Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-5 lg:gap-8">
          {/* ── 전세차량 예약 (왼쪽) ── */}
          <Link
            to="/charter"
            className="group relative bg-[#0f3460] rounded-3xl p-8 shadow-lg hover:shadow-2xl transition-all duration-300 hover:-translate-y-2 overflow-hidden flex flex-col"
          >
            {/* Glow */}
            <div className="absolute inset-0 bg-gradient-to-br from-white/5 to-transparent pointer-events-none" />
            <div className="absolute bottom-0 right-0 w-40 h-40 bg-[#c0b283]/10 rounded-full blur-3xl pointer-events-none" />

            {/* Icon */}
            <div className="w-14 h-14 rounded-2xl bg-[#c0b283]/20 border border-[#c0b283]/30 flex items-center justify-center mb-6">
              <Car className="w-7 h-7 text-[#c0b283]" />
            </div>

            {/* Content */}
            <h3 className="text-xl font-bold text-white mb-2">
              {hc.charterTitle ?? '전세차량 예약'}
            </h3>
            <p className="text-white/60 text-sm leading-relaxed mb-1">
              {hc.charterLine1 ?? '공항 픽업 · 일일 투어 · K-pop 셔틀'}
            </p>
            <p className="text-[#c0b283] text-sm font-medium mb-6">
              {hc.charterLine2 ?? '전용 차량 즉시 견적'}
            </p>

            {/* CTA */}
            <div className="mt-auto flex items-center gap-2 text-[#c0b283] font-semibold text-sm group-hover:gap-3 transition-all duration-300">
              <span>{hc.charterCta ?? '견적 요청하기'}</span>
              <ArrowRight className="w-4 h-4 transition-transform duration-300 group-hover:translate-x-1" />
            </div>
          </Link>

          {/* ── AI 여행 플래너 (오른쪽) ── */}
          <Link
            to="/planner"
            className="group relative bg-white rounded-3xl p-8 shadow-lg hover:shadow-2xl transition-all duration-300 hover:-translate-y-2 overflow-hidden flex flex-col border border-gray-100"
          >
            {/* Glow */}
            <div className="absolute inset-0 bg-gradient-to-br from-emerald-50/60 to-transparent pointer-events-none" />
            <div className="absolute bottom-0 right-0 w-40 h-40 bg-emerald-200/20 rounded-full blur-3xl pointer-events-none" />

            {/* Icon */}
            <div className="w-14 h-14 rounded-2xl bg-emerald-100 border border-emerald-200/60 flex items-center justify-center mb-6">
              <Bot className="w-7 h-7 text-emerald-600" />
            </div>

            {/* Content */}
            <h3 className="text-xl font-bold text-[#1a1a2e] mb-2">
              {hc.plannerTitle ?? 'AI 여행 플래너'}
            </h3>
            <p className="text-gray-500 text-sm leading-relaxed mb-1">
              {hc.plannerLine1 ?? 'AI가 맞춤 일정을 자동으로 생성'}
            </p>
            <p className="text-emerald-600 text-sm font-medium mb-6">
              {hc.plannerLine2 ?? '무료 · 즉시 · 4개 언어 지원'}
            </p>

            {/* CTA */}
            <div className="mt-auto flex items-center gap-2 text-emerald-600 font-semibold text-sm group-hover:gap-3 transition-all duration-300">
              <span>{hc.plannerCta ?? '일정 만들기'}</span>
              <ArrowRight className="w-4 h-4 transition-transform duration-300 group-hover:translate-x-1" />
            </div>
          </Link>
        </div>
      </div>
    </section>
  );
}
