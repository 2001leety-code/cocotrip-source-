// Charter vehicle full-page banner (distinct from per-day CharterCTA inside DayTimeline).
// Extracted from PlanDetailPage/index.tsx L310-347 (zero behavior change).
//
// P4 audit (2026-04-27): 두 개의 CharterBanner 분리 유지 결정 — 의도적 분리.
// • PlanDetailPage 변종(이 파일): plan 상세에서 WhatsApp 문의 modal — 컨시어지 견적 funnel
// • PlannerPage 변종(pages/PlannerPage/components/CharterBanner.tsx):
//   결과 페이지에서 PayPal 직결제 — 차터 단독 구매 funnel
//
// P3-A (2026-04-24): WhatsApp prefill now carries planId + recommended tour
// type + day-by-day theme summary so the operator answering on WhatsApp has
// the context to quote without having to ask back.
import { useState } from 'react';
import { Car } from 'lucide-react';
import { detectCharterRecommendation, AIRPORT_TRANSFER_PRICES } from '@/data/charterPricing';
import { useLanguage } from '@/hooks/useLanguage';
import type { PlanDay, PlanDocument } from '../../types';
import { CharterInquireModal } from './CharterInquireModal';

interface CharterBannerProps {
  days: PlanDay[];
  plan?: PlanDocument;
}

function getPlanIdFromUrl(): string {
  if (typeof window === 'undefined') return '';
  return window.location.pathname.match(/my-plans\/([^/?#]+)/)?.[1] || '';
}

function buildWhatsappPrefill(opts: {
  planId: string;
  tourLabel: string;
  pricing: { priceKRW: number; hours: number };
  days: PlanDay[];
  plan?: PlanDocument;
}): string {
  const { planId, tourLabel, pricing, days, plan } = opts;
  const input = plan?.input || {};
  const startDate = input.startDate || '';
  const pax = input.adults || input.pax || '';
  const dayCount = days.length;

  // Per-day theme summary keeps it short — operator sees what trip looks like
  // without needing to open the plan link.
  const dayLines = days.slice(0, 7).map((d, i) => {
    const stops = d.stops || [];
    const themeText = d.theme || `Day ${d.day || i + 1}`;
    const sampleStops = stops.slice(0, 3)
      .map(s => s.display_name || s.name_en || s.name || s.name_ko || '')
      .filter(Boolean)
      .join(', ');
    return `Day ${d.day || i + 1}: ${themeText}${sampleStops ? ` (${sampleStops})` : ''}`;
  }).join('\n');

  const planUrl = planId
    ? `https://cocotripkr.com/my-plans/${planId}`
    : '';

  // Cross-reference recommended airport transfer if we know arrival airport.
  // Picks the seoul-central baseline if region unknown.
  const transferKey = (input.area as string)?.toLowerCase().includes('gangnam')
    ? 'seoul-gangnam'
    : 'seoul-central';
  const transferPrice = AIRPORT_TRANSFER_PRICES[transferKey];

  const lines = [
    `Hi CocoTrip! I'd like to book a private charter.`,
    ``,
    `▸ Plan: ${planId || '(in-app)'}${startDate ? ` · Start ${startDate}` : ''}${pax ? ` · ${pax} pax` : ''}`,
    `▸ Recommended vehicle: Hyundai Staria (8-seat) — ${tourLabel}`,
    `▸ Quoted: ₩${pricing.priceKRW.toLocaleString()} for ${pricing.hours}h${transferPrice ? ` (+ airport transfer ₩${transferPrice.priceKRW.toLocaleString()})` : ''}`,
    ``,
    `Itinerary (${dayCount} day${dayCount === 1 ? '' : 's'}):`,
    dayLines || '(see plan link)',
  ];
  if (planUrl) lines.push('', `Plan: ${planUrl}`);

  return lines.join('\n');
}

export function CharterBanner({ days, plan }: CharterBannerProps) {
  const { t } = useLanguage();
  const p = (t.planner as unknown as Record<string, string | undefined>) || {};
  const allStops = days.flatMap((d: PlanDay) => d.stops || []);
  const detection = detectCharterRecommendation(allStops as any);
  if (!detection.recommended || !detection.pricing) return null;
  const { pricing } = detection;

  const tourLabel = detection.tourType ? pricing.en || pricing.ko || detection.tourType : 'private charter';
  const planId = getPlanIdFromUrl();
  const prefillText = buildWhatsappPrefill({ planId, tourLabel, pricing, days, plan });
  const waUrl = `https://wa.me/821087140611?text=${encodeURIComponent(prefillText)}`;
  const [inquireOpen, setInquireOpen] = useState(false);

  return (
    <div className="mb-6 rounded-2xl overflow-hidden border border-cyan-500/25" style={{ background: 'linear-gradient(135deg, rgba(6,182,212,0.08), rgba(59,130,246,0.05))' }}>
      <div className="px-5 py-4 border-b border-cyan-500/20">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Car className="w-6 h-6 text-cyan-300" />
            <div>
              <p className="font-bold text-white text-base">{p.adCharterTitle || 'Private Charter Vehicle'}</p>
              <p className="text-xs text-cyan-300/70 mt-0.5">{p.adCharterSub || 'Skip public transit \u2014 ride in comfort'}</p>
            </div>
          </div>
          <div className="text-right">
            <p className="text-lg font-bold text-cyan-300">{'\u20A9'}{pricing.priceKRW.toLocaleString()}</p>
            <p className="text-xs text-white/55">{pricing.hours}hrs</p>
          </div>
        </div>
      </div>
      <div className="px-5 py-4">
        <div className="flex flex-wrap gap-2 mb-4">
          {[
            p.adCharterFeatEnglish || 'English driver',
            p.adCharterFeatDoor || 'Door-to-door',
            p.adCharterFeatWifi || 'Free WiFi',
            p.adCharterFeatLuggage || 'Luggage space',
          ].map(f => (
            <span key={f} className="text-[11px] text-cyan-200/70 bg-cyan-500/10 border border-cyan-500/20 px-2.5 py-1 rounded-full">{'\u2713'} {f}</span>
          ))}
        </div>
        <button
          type="button" onClick={() => setInquireOpen(true)}
          className="block w-full py-3.5 rounded-xl text-center text-sm font-bold text-white transition-all hover:opacity-90"
          style={{ background: 'linear-gradient(135deg, #06b6d4, #3b82f6)', boxShadow: '0 4px 20px rgba(6,182,212,0.3)' }}>
          {p.adCharterCtaInApp || 'Request quote in-app'} {'\u2192'}
        </button>
        <a href={waUrl} target="_blank" rel="noopener noreferrer"
          className="block w-full mt-2 py-2 text-center text-[11px] text-cyan-300/70 hover:text-cyan-200 underline">
          {p.adCharterCtaWa || 'Or send via WhatsApp instead'}
        </a>
      </div>
      <CharterInquireModal
        open={inquireOpen} onClose={() => setInquireOpen(false)}
        plan={plan} days={days}
        recommendedTour={tourLabel}
        quotedKRW={pricing.priceKRW}
        hours={pricing.hours}
        planId={planId}
      />
    </div>
  );
}
