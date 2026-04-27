// Full itinerary result view: hero, day tabs, paywall overlay, navigation.
// Extracted verbatim from legacy PlannerPage.tsx L1105-1296.
import { useState, type ReactNode } from 'react';
import {
  Calendar, Globe, Target, Lock,
} from 'lucide-react';
import { useIsMobile } from '@/hooks/use-mobile';
import { CAT_ICON } from '../constants';
import { formatDate } from '../lib/formatters';
import type { PlannerResponse, PlannerDict } from '../types';
import { EnrichingBanner } from './EnrichingBanner';
import { DailyTipsSection } from './DailyTipsSection';
import { TimelineCard } from './TimelineCard';
import { TransportBadge } from './TransportBadge';
import { RainyDaySection } from './RainyDaySection';
import { MealsSection } from './MealsSection';
import { AccommodationCard } from './AccommodationCard';
import { BudgetCard } from './BudgetCard';
import { SeasonalSpotsBanner } from './SeasonalSpotsBanner';
import { TourRecommendationsSection } from './TourRecommendationsSection';
import { FlightSearchSection } from './FlightSearchSection';
import { EsimSection } from './EsimSection';
import { CustomerSupportSection } from './CustomerSupportSection';
import { ComboPackageBanner } from './ComboPackageBanner';
import { CharterBanner } from './CharterBanner';
import { AirportPickupCard } from './AirportPickupCard';

export function ItineraryResult({ result, onReset, p, lang, transport, enriching, arrivalAirport }: {
  result: PlannerResponse; onReset: () => void; p: PlannerDict; lang: string; transport?: string; enriching?: boolean; arrivalAirport?: string;
}) {
  const isMobile = useIsMobile();
  const [activeDay, setActiveDay] = useState(0);
  const current = result.itinerary[activeDay];

  const nights = Math.round(
    (new Date(result.meta.endDate).getTime() - new Date(result.meta.startDate).getTime()) / 86400000
  );
  const tripTitle = (p.tripTitleFormat || '')
    .replace('{nights}', String(nights))
    .replace('{days}', String(nights + 1))
    .replace('{regions}', result.meta.regions.join('\u00B7'));

  return (
    <div style={{ animation: 'fade-slide-up 0.5s ease forwards' }}>
      {/* Hero area */}
      <div className={`rounded-2xl border p-6 mb-5 relative overflow-hidden ${isMobile ? 'border-[#B668FC]/20 m-appear' : 'border-white/10'}`}
        style={{ background: isMobile
          ? 'linear-gradient(135deg, rgba(182,104,252,0.10) 0%, rgba(10,4,18,0.95) 60%)'
          : 'linear-gradient(135deg, rgba(196,149,106,0.10) 0%, rgba(12,18,32,0.95) 60%)' }}>
        <div className="absolute top-0 left-0 right-0 h-0.5 rounded-t-2xl"
          style={{ background: isMobile ? 'linear-gradient(90deg, #B668FC, #FF6B9D)' : 'linear-gradient(90deg, #C4956A, #D4915C)' }} />
        <div className="flex items-start justify-between gap-4 mb-3">
          <h2 className={`font-bold text-xl leading-tight ${isMobile ? 'm-shimmer-text' : 'text-white'}`}>{tripTitle}</h2>
          <button onClick={onReset}
            className={`shrink-0 text-xs transition-colors border rounded-lg px-3 py-1.5 ${isMobile ? 'text-white/55 hover:text-[#B668FC] border-white/12 hover:border-[#B668FC]/40' : 'text-white/55 hover:text-[#C4956A] border-white/12 hover:border-[rgba(196,149,106,.4)]'}`}>
            {p.resetBtn}
          </button>
        </div>
        <div className="flex flex-wrap gap-2">
          {([
            { icon: <Calendar className="w-3.5 h-3.5" />, text: `${formatDate(result.meta.startDate, lang)} \u2013 ${formatDate(result.meta.endDate, lang)}` },
            { icon: <Globe className="w-3.5 h-3.5" />, text: result.meta.regions.join(' \u00B7 ') },
            ...result.meta.categories.map(c => ({ icon: CAT_ICON[c] ?? <Target className="w-3.5 h-3.5" />, text: c })),
          ] as { icon: ReactNode; text: string }[]).map((chip, i) => (
            <span key={i} className="inline-flex items-center gap-1 text-xs text-white/50 bg-white/[0.06] border border-white/[0.08] px-2.5 py-1 rounded-full">
              {chip.icon} {chip.text}
            </span>
          ))}
        </div>
      </div>

      {/* Enriching banner */}
      <EnrichingBanner visible={!!enriching} p={p} />

      {/* Day tabs */}
      <div className="flex gap-1.5 mb-5 overflow-x-auto pb-1 -mx-1 px-1 scrollbar-hide" style={{ scrollbarWidth: 'none' }}>
        {result.itinerary.map((day, idx) => (
          <button key={day.day} onClick={() => setActiveDay(idx)}
            className={`shrink-0 flex flex-col items-center px-4 py-2.5 rounded-2xl border text-sm font-semibold transition-all duration-300 min-w-[72px] ${
              activeDay === idx
                ? (isMobile ? 'border-[#B668FC]/50 text-[#B668FC]' : 'border-[rgba(196,149,106,.5)] text-[#D4A574]')
                : 'border-white/10 bg-white/[0.04] text-white/55 hover:border-white/22 hover:text-white/60'
            }`}
            style={activeDay === idx ? (isMobile
              ? { background: 'rgba(182,104,252,0.10)', boxShadow: '0 0 16px rgba(182,104,252,.2)' }
              : { background: 'rgba(196,149,106,0.10)', boxShadow: '0 0 16px rgba(196,149,106,.2)' }
            ) : {}}>
            <span className="text-xs font-bold">{p.dayLabel ?? 'Day'} {day.day}</span>
            <span className="text-[10px] font-normal opacity-70 mt-0.5">{day.date?.slice(5)}</span>
          </button>
        ))}
      </div>

      {/* Current day content */}
      {current && (
        <div key={activeDay} className="relative" style={{ animation: 'day-fade-in 0.3s ease forwards' }}>
          <div className={`transition-all duration-500 ${activeDay > 0 ? 'blur-md pointer-events-none opacity-40' : ''}`}>
            <p className="text-sm text-white/55 mb-4 flex items-center gap-2">
              <span>{formatDate(current.date, lang)}</span>
              <span className="text-white/15">{'\u00B7'}</span>
              <span>{current.places.length} {p.placesUnit}</span>
            </p>
            <DailyTipsSection tips={current.dailyTips} p={p} />
            <div className="space-y-0.5 mb-2">
              {current.places.map((place, idx) => (
                <div key={idx}>
                  <TimelineCard place={place} index={idx} p={p} />
                  {idx < current.places.length - 1 && place.transportToNext && (
                    <TransportBadge transport={place.transportToNext} p={p} />
                  )}
                </div>
              ))}
            </div>
            <RainyDaySection places={current.places} p={p} />
            <MealsSection meals={current.meals} p={p} enriching={enriching} />
          </div>

          {/* Paywall overlay */}
          {activeDay > 0 && (
            <div className="absolute inset-0 flex flex-col items-center pt-24 text-center z-10 px-4">
              <div className={`rounded-3xl p-6 sm:p-8 max-w-sm backdrop-blur-xl w-full ${isMobile ? 'bg-[#0a0412]/95 border border-[#B668FC]/40 shadow-[0_0_40px_rgba(182,104,252,0.15)]' : 'bg-[#121826]/95 border border-[#C4956A]/40 shadow-[0_0_40px_rgba(196,149,106,0.15)]'}`}>
                <div className={`w-14 h-14 mx-auto rounded-full flex items-center justify-center mb-5 shadow-lg ${isMobile ? 'bg-gradient-to-br from-[#B668FC] to-[#FF6B9D] shadow-[#B668FC]/20' : 'bg-gradient-to-br from-[#C4956A] to-[#D4A574] shadow-[#C4956A]/20'}`}>
                  <Lock className="w-7 h-7 text-white" />
                </div>
                <h3 className="text-[17px] font-bold text-white mb-2 leading-tight">{p.paywallTitle}</h3>
                <p className="text-[13px] text-white/70 mb-5 leading-relaxed">
                  {p.paywallDesc}<br/>
                  <b>{p.paywallOffer}</b><br/>
                  <span className={`font-medium mt-1.5 block ${isMobile ? 'text-[#B668FC]' : 'text-[#C4956A]'}`}>{p.paywallGuarantee}</span>
                </p>
                <div className="flex flex-col gap-2.5">
                  <button onClick={() => document.getElementById('airport-pickup-section')?.scrollIntoView({ behavior: 'smooth' })}
                    className="w-full py-3 rounded-xl bg-gradient-to-r from-amber-500 to-orange-400 text-black text-[13px] font-extrabold shadow-lg hover:scale-[1.02] transition-transform">
                    {p.paywallComboBtn}
                  </button>
                  <button onClick={() => document.getElementById('charter-banner-section')?.scrollIntoView({ behavior: 'smooth' })}
                    className="w-full py-3 rounded-xl bg-white/10 border border-white/20 text-white text-[13px] font-bold hover:bg-white/20 transition-all">
                    {p.paywallSingleBtn}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Prev / Next */}
          <div className="flex gap-3 mt-7">
            <button onClick={() => setActiveDay(d => Math.max(0, d - 1))} disabled={activeDay === 0}
              className="flex-1 py-3 rounded-xl border border-white/12 text-sm font-medium text-white/50 hover:border-white/25 hover:bg-white/[0.04] disabled:opacity-20 disabled:cursor-not-allowed transition-all min-h-[44px]">
              {p.prevDay}
            </button>
            <button onClick={() => setActiveDay(d => Math.min(result.itinerary.length - 1, d + 1))} disabled={activeDay === result.itinerary.length - 1}
              className="flex-1 py-3 rounded-xl border border-white/12 text-sm font-medium text-white/50 hover:border-white/25 hover:bg-white/[0.04] disabled:opacity-20 disabled:cursor-not-allowed transition-all min-h-[44px]">
              {p.nextDay}
            </button>
          </div>
        </div>
      )}

      {/* Accommodation card */}
      {result.accommodation
        ? <AccommodationCard acc={result.accommodation} p={p} region={result.meta.regions[0]} />
        : enriching && (
          <div className="bg-white/[0.04] border border-white/8 rounded-2xl p-5 mt-6 animate-pulse">
            <div className="h-3 bg-white/10 rounded w-28 mb-4" />
            <div className="flex items-start gap-3">
              <div className="w-9 h-9 rounded-full bg-white/10 shrink-0" />
              <div className="flex-1 space-y-2.5">
                <div className="h-4 bg-white/10 rounded w-40" />
                <div className="h-3 bg-white/6 rounded w-52" />
                <div className="h-12 bg-white/6 rounded" />
              </div>
            </div>
          </div>
        )
      }

      {/* Budget summary */}
      {result.budgetSummary
        ? <BudgetCard budget={result.budgetSummary} p={p} />
        : enriching && (
          <div className="bg-white/[0.04] border border-white/8 rounded-2xl p-5 mt-6 animate-pulse">
            <div className="h-3 bg-white/10 rounded w-24 mb-4" />
            <div className="grid grid-cols-2 gap-2 mb-4">
              {[1,2,3,4].map(i => <div key={i} className="h-12 bg-white/6 rounded-xl" />)}
            </div>
            <div className="h-12 bg-white/8 rounded-xl" />
          </div>
        )
      }

      {/* 광고 노출 순서 (2026-04-27): 정보 → 자체 상품 → 외부 어필리에이트 → 마지막 안전망.
          자체 수익(차터·공항픽업·투어·콤보)을 외부 어필리(Trip.com·eSIM)보다 우선 노출. */}
      <SeasonalSpotsBanner result={result} lang={lang} p={p} />
      <TourRecommendationsSection result={result} p={p} />
      {!enriching && <div id="charter-banner-section"><CharterBanner result={result} p={p} lang={lang} vehicleType={transport} /></div>}
      <div id="airport-pickup-section"><AirportPickupCard arrivalAirport={arrivalAirport} p={p} lang={lang} /></div>
      <FlightSearchSection arrivalAirport={arrivalAirport} p={p} lang={lang} />
      <EsimSection p={p} isMobile={isMobile} />
      {!enriching && <ComboPackageBanner p={p} />}
      {!enriching && <CustomerSupportSection cs={result.customerSupport} p={p} />}
    </div>
  );
}
