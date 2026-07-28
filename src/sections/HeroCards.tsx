import { Link } from 'react-router-dom';
import { ArrowRight, Bot, Car, Hotel, Plane, Map } from 'lucide-react';
import type { Translations } from '@/i18n';
import { buildAccommodationLinks, buildFlightLink } from '@/config/affiliateLinks';
import { MotionSection } from '@/components/MotionSection';
import { fillPrice } from '@/lib/aiPlannerPrice';
import { useLanguage } from '@/hooks/useLanguage';

interface HeroCardsProps {
  t: Translations;
}

// D1 unified card pattern — moblie brand tone (purple #B668FC + pink #FF6B9D)
const CARD_BASE = 'group relative bg-white/[0.04] backdrop-blur-md rounded-2xl p-6 shadow-lg hover:shadow-2xl transition-all duration-300 hover:-translate-y-1 overflow-hidden flex flex-col border border-white/[0.08] hover:border-[#B668FC]/30';
const ICON_WRAP = 'w-11 h-11 rounded-xl bg-[#B668FC]/15 border border-[#B668FC]/30 flex items-center justify-center mb-4';
const ICON_CLS = 'w-5 h-5 text-[#B668FC]';
const TITLE_CLS = 'text-lg font-bold text-white mb-1';
const LINE1_CLS = 'text-white/50 text-xs leading-relaxed mb-0.5';
const LINE2_CLS = 'text-[#FF6B9D] text-xs font-medium mb-4';
const CTA_CLS = 'mt-auto flex items-center gap-2 text-[#B668FC] font-semibold text-xs group-hover:gap-3 group-hover:text-[#FF6B9D] transition-all duration-300';
const BLUR_BLOB = 'absolute bottom-0 right-0 w-32 h-32 bg-[#B668FC]/15 rounded-full blur-3xl pointer-events-none';
const OVERLAY = 'absolute inset-0 bg-gradient-to-br from-white/5 to-transparent pointer-events-none';

export function HeroCards({ t }: HeroCardsProps) {
  const { language } = useLanguage();
  const hc = t.heroCards || {};
  const hotelLink = buildAccommodationLinks('Seoul Hotel', 'Seoul')[0]?.url || 'https://www.trip.com/hotels/list';
  const flightLink = buildFlightLink('ICN').url;

  return (
    <MotionSection className="py-16 lg:py-24 px-4">
      <div className="max-w-6xl mx-auto">
        <div className="text-center mb-10">
          <h2 className="text-2xl sm:text-3xl lg:text-4xl font-bold text-white leading-tight">
            {hc.heading || 'How can we help with your Korea trip?'}
          </h2>
          <p className="text-white/60 text-sm sm:text-base mt-2">
            {hc.subheading || '원하는 서비스를 선택하세요'}
          </p>
        </div>

        {/* Row 1: Hotel / Flight / Charter */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 lg:gap-6 mb-4 lg:mb-6">
          <a href={hotelLink} target="_blank" rel="noopener noreferrer sponsored" className={CARD_BASE}>
            <div className={OVERLAY} />
            <div className={BLUR_BLOB} />
            <div className={ICON_WRAP}><Hotel className={ICON_CLS} /></div>
            <h3 className={TITLE_CLS}>{hc.hotelTitle || '호텔 예약'}</h3>
            <p className={LINE1_CLS}>{hc.hotelLine1 || '최저가 보장 · 무료 취소'}</p>
            <p className={LINE2_CLS}>{hc.hotelLine2 || '인기 호텔 즉시 비교'}</p>
            <div className={CTA_CLS}>
              <span>{hc.hotelCta || '호텔 검색하기'}</span>
              <ArrowRight className="w-3.5 h-3.5 transition-transform duration-300 group-hover:translate-x-1" />
            </div>
          </a>

          <a href={flightLink} target="_blank" rel="noopener noreferrer sponsored" className={CARD_BASE}>
            <div className={OVERLAY} />
            <div className={BLUR_BLOB} />
            <div className={ICON_WRAP}><Plane className={ICON_CLS} /></div>
            <h3 className={TITLE_CLS}>{hc.flightTitle || '항공권 예약'}</h3>
            <p className={LINE1_CLS}>{hc.flightLine1 || '스카이스캐너 제휴'}</p>
            <p className={LINE2_CLS}>{hc.flightLine2 || '최저가 항공권 비교'}</p>
            <div className={CTA_CLS}>
              <span>{hc.flightCta || '항공권 검색'}</span>
              <ArrowRight className="w-3.5 h-3.5 transition-transform duration-300 group-hover:translate-x-1" />
            </div>
          </a>

          <Link to="/charter" className={CARD_BASE}>
            <div className={OVERLAY} />
            <div className={BLUR_BLOB} />
            <div className={ICON_WRAP}><Car className={ICON_CLS} /></div>
            <h3 className={TITLE_CLS}>{hc.charterTitle || '전세차량 예약'}</h3>
            <p className={LINE1_CLS}>{hc.charterLine1 || '공항 픽업 · 일일 투어 · K-pop 셔틀'}</p>
            <p className={LINE2_CLS}>{hc.charterLine2 || '전용 차량 즉시 견적'}</p>
            <div className={CTA_CLS}>
              <span>{hc.charterCta || '견적 요청하기'}</span>
              <ArrowRight className="w-3.5 h-3.5 transition-transform duration-300 group-hover:translate-x-1" />
            </div>
          </Link>
        </div>

        {/* Row 2: Tours / AI Planner */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 lg:gap-6">
          <Link to="/tours" className={CARD_BASE + ' p-7'}>
            <div className={OVERLAY} />
            <div className="absolute bottom-0 right-0 w-36 h-36 bg-[#B668FC]/15 rounded-full blur-3xl pointer-events-none" />
            <div className="w-12 h-12 rounded-2xl bg-[#B668FC]/15 border border-[#B668FC]/30 flex items-center justify-center mb-5">
              <Map className="w-6 h-6 text-[#B668FC]" />
            </div>
            <h3 className="text-xl font-bold text-white mb-2">{hc.tourTitle || '투어 예약'}</h3>
            <p className="text-white/50 text-sm leading-relaxed mb-1">{hc.tourLine1 || '프라이빗 · 단체 · 패키지'}</p>
            <p className="text-[#FF6B9D] text-sm font-medium mb-6">{hc.tourLine2 || '전문 가이드와 함께'}</p>
            <div className="mt-auto flex items-center gap-2 text-[#B668FC] font-semibold text-sm group-hover:gap-3 group-hover:text-[#FF6B9D] transition-all duration-300">
              <span>{hc.tourCta || '투어 보기'}</span>
              <ArrowRight className="w-4 h-4 transition-transform duration-300 group-hover:translate-x-1" />
            </div>
          </Link>

          <Link to="/planner" className={CARD_BASE + ' p-7'}>
            <div className={OVERLAY} />
            <div className="absolute bottom-0 right-0 w-36 h-36 bg-[#FF6B9D]/15 rounded-full blur-3xl pointer-events-none" />
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-[#B668FC]/20 to-[#FF6B9D]/20 border border-[#B668FC]/30 flex items-center justify-center mb-5">
              <Bot className="w-6 h-6 text-white" />
            </div>
            <h3 className="text-xl font-bold text-white mb-2">{hc.plannerTitle || 'AI 여행 플래너'}</h3>
            <p className="text-white/50 text-sm leading-relaxed mb-1">{hc.plannerLine1 || 'AI가 맞춤 일정을 자동으로 생성'}</p>
            <p className="text-[#FF6B9D] text-sm font-medium mb-6">{fillPrice(hc.plannerLine2 || '{price} · 즉시 · 4개 언어 지원', language)}</p>
            <div className="mt-auto flex items-center gap-2 text-[#B668FC] font-semibold text-sm group-hover:gap-3 group-hover:text-[#FF6B9D] transition-all duration-300">
              <span>{hc.plannerCta || '일정 만들기'}</span>
              <ArrowRight className="w-4 h-4 transition-transform duration-300 group-hover:translate-x-1" />
            </div>
          </Link>
        </div>
      </div>
    </MotionSection>
  );
}
