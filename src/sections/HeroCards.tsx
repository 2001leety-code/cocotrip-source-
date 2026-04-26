import { Link } from 'react-router-dom';
import { ArrowRight, Bot, Car, Hotel, Plane, Map } from 'lucide-react';
import type { Translations } from '@/i18n';

interface HeroCardsProps {
  t: Translations;
}

export function HeroCards({ t }: HeroCardsProps) {
  const hc = t.heroCards || {};

  return (
    <section className="bg-[#faf9f6] py-16 lg:py-24 px-4">
      <div className="max-w-6xl mx-auto">
        {/* Heading */}
        <div className="text-center mb-10">
          <h2 className="text-2xl sm:text-3xl lg:text-4xl font-bold text-[#1a1a2e] leading-tight">
            {hc.heading || 'How can we help with your Korea trip?'}
          </h2>
          <p className="text-gray-500 text-sm sm:text-base mt-2">
            {hc.subheading || '원하는 서비스를 선택하세요'}
          </p>
        </div>

        {/* ── Row 1: 3 Cards — Hotel / Flight / Charter ── */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 lg:gap-6 mb-4 lg:mb-6">
          {/* Hotel */}
          <a
            href="https://www.booking.com/index.html?aid=8133498"
            target="_blank"
            rel="noopener noreferrer"
            className="group relative bg-gradient-to-br from-[#1a365d] to-[#2d3748] rounded-2xl p-6 shadow-lg hover:shadow-2xl transition-all duration-300 hover:-translate-y-1 overflow-hidden flex flex-col"
          >
            <div className="absolute inset-0 bg-gradient-to-br from-white/5 to-transparent pointer-events-none" />
            <div className="absolute bottom-0 right-0 w-32 h-32 bg-blue-400/10 rounded-full blur-3xl pointer-events-none" />
            <div className="w-11 h-11 rounded-xl bg-blue-500/20 border border-blue-400/30 flex items-center justify-center mb-4">
              <Hotel className="w-5 h-5 text-blue-300" />
            </div>
            <h3 className="text-lg font-bold text-white mb-1">{hc.hotelTitle || '호텔 예약'}</h3>
            <p className="text-white/50 text-xs leading-relaxed mb-0.5">{hc.hotelLine1 || '최저가 보장 · 무료 취소'}</p>
            <p className="text-blue-300 text-xs font-medium mb-4">{hc.hotelLine2 || '인기 호텔 즉시 비교'}</p>
            <div className="mt-auto flex items-center gap-2 text-blue-300 font-semibold text-xs group-hover:gap-3 transition-all duration-300">
              <span>{hc.hotelCta || '호텔 검색하기'}</span>
              <ArrowRight className="w-3.5 h-3.5 transition-transform duration-300 group-hover:translate-x-1" />
            </div>
          </a>

          {/* Flight */}
          <a
            href="https://www.skyscanner.co.kr/"
            target="_blank"
            rel="noopener noreferrer"
            className="group relative bg-gradient-to-br from-[#1e3a5f] to-[#0c4a6e] rounded-2xl p-6 shadow-lg hover:shadow-2xl transition-all duration-300 hover:-translate-y-1 overflow-hidden flex flex-col"
          >
            <div className="absolute inset-0 bg-gradient-to-br from-white/5 to-transparent pointer-events-none" />
            <div className="absolute bottom-0 right-0 w-32 h-32 bg-cyan-400/10 rounded-full blur-3xl pointer-events-none" />
            <div className="w-11 h-11 rounded-xl bg-cyan-500/20 border border-cyan-400/30 flex items-center justify-center mb-4">
              <Plane className="w-5 h-5 text-cyan-300" />
            </div>
            <h3 className="text-lg font-bold text-white mb-1">{hc.flightTitle || '항공권 예약'}</h3>
            <p className="text-white/50 text-xs leading-relaxed mb-0.5">{hc.flightLine1 || '스카이스캐너 제휴'}</p>
            <p className="text-cyan-300 text-xs font-medium mb-4">{hc.flightLine2 || '최저가 항공권 비교'}</p>
            <div className="mt-auto flex items-center gap-2 text-cyan-300 font-semibold text-xs group-hover:gap-3 transition-all duration-300">
              <span>{hc.flightCta || '항공권 검색'}</span>
              <ArrowRight className="w-3.5 h-3.5 transition-transform duration-300 group-hover:translate-x-1" />
            </div>
          </a>

          {/* Charter */}
          <Link
            to="/charter"
            className="group relative bg-[#0f3460] rounded-2xl p-6 shadow-lg hover:shadow-2xl transition-all duration-300 hover:-translate-y-1 overflow-hidden flex flex-col"
          >
            <div className="absolute inset-0 bg-gradient-to-br from-white/5 to-transparent pointer-events-none" />
            <div className="absolute bottom-0 right-0 w-32 h-32 bg-[#c0b283]/10 rounded-full blur-3xl pointer-events-none" />
            <div className="w-11 h-11 rounded-xl bg-[#c0b283]/20 border border-[#c0b283]/30 flex items-center justify-center mb-4">
              <Car className="w-5 h-5 text-[#c0b283]" />
            </div>
            <h3 className="text-lg font-bold text-white mb-1">{hc.charterTitle || '전세차량 예약'}</h3>
            <p className="text-white/50 text-xs leading-relaxed mb-0.5">{hc.charterLine1 || '공항 픽업 · 일일 투어 · K-pop 셔틀'}</p>
            <p className="text-[#c0b283] text-xs font-medium mb-4">{hc.charterLine2 || '전용 차량 즉시 견적'}</p>
            <div className="mt-auto flex items-center gap-2 text-[#c0b283] font-semibold text-xs group-hover:gap-3 transition-all duration-300">
              <span>{hc.charterCta || '견적 요청하기'}</span>
              <ArrowRight className="w-3.5 h-3.5 transition-transform duration-300 group-hover:translate-x-1" />
            </div>
          </Link>
        </div>

        {/* ── Row 2: 2 Cards — Tours / AI Planner ── */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 lg:gap-6">
          {/* Tours */}
          <Link
            to="/tours"
            className="group relative bg-white rounded-2xl p-7 shadow-lg hover:shadow-2xl transition-all duration-300 hover:-translate-y-1 overflow-hidden flex flex-col border border-gray-100"
          >
            <div className="absolute inset-0 bg-gradient-to-br from-amber-50/60 to-transparent pointer-events-none" />
            <div className="absolute bottom-0 right-0 w-36 h-36 bg-amber-200/20 rounded-full blur-3xl pointer-events-none" />
            <div className="w-12 h-12 rounded-2xl bg-amber-100 border border-amber-200/60 flex items-center justify-center mb-5">
              <Map className="w-6 h-6 text-amber-600" />
            </div>
            <h3 className="text-xl font-bold text-[#1a1a2e] mb-2">{hc.tourTitle || '투어 예약'}</h3>
            <p className="text-gray-500 text-sm leading-relaxed mb-1">{hc.tourLine1 || '프라이빗 · 단체 · 패키지'}</p>
            <p className="text-amber-600 text-sm font-medium mb-6">{hc.tourLine2 || '전문 가이드와 함께'}</p>
            <div className="mt-auto flex items-center gap-2 text-amber-600 font-semibold text-sm group-hover:gap-3 transition-all duration-300">
              <span>{hc.tourCta || '투어 보기'}</span>
              <ArrowRight className="w-4 h-4 transition-transform duration-300 group-hover:translate-x-1" />
            </div>
          </Link>

          {/* AI Planner */}
          <Link
            to="/planner"
            className="group relative bg-white rounded-2xl p-7 shadow-lg hover:shadow-2xl transition-all duration-300 hover:-translate-y-1 overflow-hidden flex flex-col border border-gray-100"
          >
            <div className="absolute inset-0 bg-gradient-to-br from-emerald-50/60 to-transparent pointer-events-none" />
            <div className="absolute bottom-0 right-0 w-36 h-36 bg-emerald-200/20 rounded-full blur-3xl pointer-events-none" />
            <div className="w-12 h-12 rounded-2xl bg-emerald-100 border border-emerald-200/60 flex items-center justify-center mb-5">
              <Bot className="w-6 h-6 text-emerald-600" />
            </div>
            <h3 className="text-xl font-bold text-[#1a1a2e] mb-2">{hc.plannerTitle || 'AI 여행 플래너'}</h3>
            <p className="text-gray-500 text-sm leading-relaxed mb-1">{hc.plannerLine1 || 'AI가 맞춤 일정을 자동으로 생성'}</p>
            <p className="text-emerald-600 text-sm font-medium mb-6">{hc.plannerLine2 || '무료 · 즉시 · 4개 언어 지원'}</p>
            <div className="mt-auto flex items-center gap-2 text-emerald-600 font-semibold text-sm group-hover:gap-3 transition-all duration-300">
              <span>{hc.plannerCta || '일정 만들기'}</span>
              <ArrowRight className="w-4 h-4 transition-transform duration-300 group-hover:translate-x-1" />
            </div>
          </Link>
        </div>
      </div>
    </section>
  );
}
