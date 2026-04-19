// Charter vehicle CTA with pricing + PayPal booking.
// LOCKED region -- PayPalBookingButton lifted verbatim from legacy PlannerPage.tsx L568-718.
import { useState } from 'react';
import { detectCharterRecommendation, EXTRA_CHARGES } from '@/data/charterPricing';
import { PayPalBookingButton } from '@/components/PayPalBookingButton';
import {
  Car, Bus as BusIcon, Check, AlertTriangle, Moon, RefreshCw, Star as StarIcon,
  MessageSquare, Baby, RectangleHorizontal, Navigation,
} from 'lucide-react';
import type { PlannerResponse } from '../types';

export function CharterBanner({ result, p, lang, vehicleType }: { result: PlannerResponse; p: any; lang: string; vehicleType?: string }) {
  const [expanded, setExpanded] = useState(false);

  const allPlaces = result.itinerary.flatMap((d) => d.places);
  const detection = detectCharterRecommendation(allPlaces);

  if (!detection.recommended || !detection.pricing) return null;

  const { pricing } = detection;
  const days = result.itinerary.length;
  const isBus = vehicleType === 'bus';
  const needsGuide = vehicleType === 'sprinter' || vehicleType === 'bus';
  const guideFeeTotal = needsGuide ? 300000 * days : 0;
  const totalKRW = isBus ? null : pricing.priceKRW + guideFeeTotal;
  const perPersonKRW = totalKRW ? Math.round(totalKRW / 4) : null;
  const perPersonUSD = Math.round(pricing.priceUSD / 4);
  const warning = detection.tourType === 'seoul-city' ? p.charterWarningSeoul : p.charterWarningSuburb;

  return (
    <div className="mt-6 rounded-2xl overflow-hidden border border-blue-500/30"
      style={{ background: 'linear-gradient(135deg, rgba(59,130,246,0.12), rgba(6,182,212,0.08))' }}>

      <div className="px-5 py-4 border-b border-blue-500/20">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Car className="w-6 h-6 text-blue-300" />
            <div>
              <p className="font-bold text-white text-base">{p.charterTitle}</p>
              <p className="text-xs text-blue-300/70 mt-0.5">{p.charterSubtitle}</p>
            </div>
          </div>
          <div className="text-right">
            <p className="text-lg font-bold text-cyan-300">{'\u20A9'}{pricing.priceKRW.toLocaleString()}</p>
            <p className="text-xs text-white/40">(≈ ${pricing.priceUSD} USD)</p>
          </div>
        </div>
      </div>

      <div className="px-5 py-3 bg-amber-500/10 border-b border-amber-500/20">
        <p className="text-xs text-amber-200/90 flex items-start gap-1.5">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5 text-amber-400" />
          {warning}
        </p>
      </div>

      <div className="px-5 py-4">
        {needsGuide && (
          <div className="px-5 py-2.5 bg-amber-500/10 border-b border-amber-500/20">
            <p className="text-xs text-amber-200/80">
              <AlertTriangle className="w-3 h-3 inline text-amber-400" /> {p.vehicleGuideNote}
            </p>
          </div>
        )}

        <div className="grid grid-cols-3 gap-3 mb-4">
          <div className="bg-white/5 rounded-xl p-3 text-center">
            <p className="text-xs text-white/40 mb-1">{p.charterBasePrice}</p>
            {isBus ? (
              <p className="text-sm font-bold text-white">{p.vehicleCustomQuote}</p>
            ) : (
              <>
                <p className="text-sm font-bold text-white">{'\u20A9'}{pricing.priceKRW.toLocaleString()}</p>
                {needsGuide && <p className="text-[10px] text-amber-300/70">+{'\u20A9'}{guideFeeTotal.toLocaleString()} {p.vehicleGuideRequired}</p>}
              </>
            )}
            <p className="text-[10px] text-white/30">{pricing.hours}{p.charterHourUnit}</p>
          </div>
          <div className="bg-white/5 rounded-xl p-3 text-center">
            <p className="text-xs text-white/40 mb-1">{p.charterPerPerson}</p>
            {isBus ? (
              <p className="text-sm font-bold text-white">-</p>
            ) : (
              <>
                <p className="text-sm font-bold text-cyan-300">{'\u20A9'}{perPersonKRW!.toLocaleString()}</p>
                <p className="text-[10px] text-white/30">≈ ${perPersonUSD}</p>
              </>
            )}
          </div>
          <div className="bg-white/5 rounded-xl p-3 text-center">
            <p className="text-xs text-white/40 mb-1">{p.charterOvertime}</p>
            <p className="text-sm font-bold text-white">{'\u20A9'}{EXTRA_CHARGES.overtimePerHour.toLocaleString()}</p>
            <p className="text-[10px] text-white/30">{p.charterOvertimeUnit}</p>
          </div>
        </div>

        <div className="flex flex-wrap gap-2 mb-4">
          {[p.charterFeat1, p.charterFeat2, p.charterFeat3, p.charterFeat4].map((feat: string) => (
            <span key={feat} className="text-[11px] text-blue-200/70 bg-blue-500/10 border border-blue-500/20 px-2.5 py-1 rounded-full">
              <Check className="w-3 h-3 inline" /> {feat}
            </span>
          ))}
        </div>

        <button
          onClick={() => setExpanded(!expanded)}
          className="text-xs text-white/40 hover:text-cyan-400 transition-colors flex items-center gap-1 mb-3">
          {expanded ? p.charterExtraToggleOpen : p.charterExtraToggleClose}
        </button>

        {expanded && (
          <div className="bg-white/[0.04] rounded-xl p-3 mb-4 space-y-1.5 text-xs text-white/50">
            <p className="flex items-center gap-1"><Moon className="w-3.5 h-3.5" /> {p.charterNight}</p>
            <p className="flex items-center gap-1"><RefreshCw className="w-3.5 h-3.5" /> {p.charterRoundTrip}</p>
            <p className="flex items-center gap-1"><StarIcon className="w-3.5 h-3.5" /> {p.charterPeakSeason}</p>
            <p className="flex items-center gap-1"><MessageSquare className="w-3.5 h-3.5" /> {p.charterGuide}</p>
            <p className="flex items-center gap-1"><RectangleHorizontal className="w-3.5 h-3.5" /> {p.charterPicket}</p>
            <p className="flex items-center gap-1"><Baby className="w-3.5 h-3.5" /> {p.charterChildSeat}</p>
            <p className="flex items-center gap-1"><Navigation className="w-3.5 h-3.5" /> {p.charterToll}</p>
          </div>
        )}

        {isBus ? (
          <a
            href="https://wa.me/821099339020"
            target="_blank"
            rel="noopener noreferrer"
            className="block w-full py-3.5 rounded-xl text-center text-sm font-bold text-white transition-all duration-300 hover:opacity-90 hover:scale-[1.01]"
            style={{ background: 'linear-gradient(135deg, #3b82f6, #06b6d4)', boxShadow: '0 4px 20px rgba(59,130,246,0.35)' }}>
            <BusIcon className="w-4 h-4 inline" /> {p.vehicleCustomQuote}
          </a>
        ) : (
          <PayPalBookingButton
            productType={(() => {
              const map: Record<string, string> = {
                'seoul-city':      'charter_seoul_city',
                'seoul-suburb':    'charter_seoul_suburb',
                'dmz':             'charter_dmz',
                'gangwon':         'charter_gangwon',
                'ski-resort':      'charter_ski',
                'gyeongju-jeonju': 'charter_gyeongju',
                'busan-day':       'charter_busan',
              };
              return map[detection.tourType ?? ''] ?? 'charter_seoul_suburb';
            })()}
            passengers={1}
            dateStart={result.itinerary[0]?.date ?? ''}
            dateEnd={result.itinerary[result.itinerary.length - 1]?.date ?? ''}
            priceKRW={totalKRW ?? (detection.pricing?.priceKRW ?? 330000)}
            p={p}
            lang={lang}
            pickupLocation={result.meta?.regions?.[0] ?? ''}
            dropoffLocation={detection.pricing?.ko ?? detection.tourType ?? ''}
            vehicleType={vehicleType ?? 'staria'}
            memo={`AI Planner: ${result.meta?.regions?.join(', ') ?? ''}`}
            itineraryData={result.itinerary}
          />
        )}
      </div>
    </div>
  );
}
