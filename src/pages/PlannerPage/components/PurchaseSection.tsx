// Purchase section -- single primary CTA (Klook pattern), Option B as a
// small "already booked flight + hotel?" upsell toggle so it doesn't compete
// with the paid CTA for attention.
// LOCKED region -- PayPalBookingButton lifted verbatim from legacy PlannerPage.tsx L1705-1993.
import type { MutableRefObject } from 'react';
import {
  Briefcase, UtensilsCrossed, Camera, Train,
  Plane, Hotel, Search, Check, Gift, ChevronDown,
} from 'lucide-react';
import { PayPalBookingButton } from '@/components/PayPalBookingButton';
import { buildAccommodationLinks } from '@/config/affiliateLinks';
import type { PlannerFormValues } from '@/components/PlannerForm';
import type { PlannerDict } from '../types';

interface QuickPreviewData {
  themes?: string[];
  marketingNarrative?: string | Record<string, unknown>;
  day1MarkdownTable?: string | Record<string, unknown>;
}

interface PurchaseSectionProps {
  p: PlannerDict; isMobile: boolean; language: string;
  userEmail: string; setUserEmail: (v: string) => void;
  selectedOption: 'A' | 'B'; setSelectedOption: (v: 'A' | 'B') => void;
  optionBStep: 1 | 2 | 3; setOptionBStep: (v: 1 | 2 | 3) => void;
  isGeneratingPlan: boolean; planError: string | null;
  resultQuick: QuickPreviewData;
  lastValues: MutableRefObject<PlannerFormValues | null>;
  revisionMode: boolean; revisionPlanId: string | null; revisionToken: string | null;
  onPaymentSuccess: (orderId: string) => void;
  onRevisionRegenerate: (values: PlannerFormValues, planId: string, token: string | null) => void;
}

export function PurchaseSection({
  p, isMobile, language, userEmail, setUserEmail,
  selectedOption, setSelectedOption, optionBStep, setOptionBStep,
  isGeneratingPlan, planError, resultQuick, lastValues,
  revisionMode, revisionPlanId, revisionToken,
  onPaymentSuccess, onRevisionRegenerate,
}: PurchaseSectionProps) {
  return (
    <div className={isMobile
      ? 'm-card m-appear p-6 text-center relative overflow-hidden'
      : 'bg-gradient-to-br from-[#0f111a] to-[#1a0f18] rounded-2xl p-8 border border-[#7C5CFC]/20 text-center shadow-xl relative overflow-hidden'
    }
      style={isMobile ? { background: 'linear-gradient(135deg, rgba(182,104,252,0.06), rgba(255,107,157,0.03), rgba(10,4,18,0.95))' } : undefined}
    >
      {/* Decorative glow */}
      <div className={`absolute top-0 left-1/2 -translate-x-1/2 w-64 h-32 rounded-full blur-3xl ${isMobile ? 'bg-[#B668FC]/10' : 'bg-[#7C5CFC]/10'}`} />

      {/* Price display */}
      <div className="relative text-center py-4 mb-4">
        <div className="text-white/40 text-sm mb-1">
          <span className="line-through">$19.90</span>
          <span className="ml-2 text-[10px] uppercase tracking-wider">{p.originalPrice}</span>
        </div>
        <div className="flex items-baseline justify-center gap-2 mb-2">
          <span className="text-5xl font-black text-white" style={{ textShadow: isMobile ? '0 0 20px rgba(182,104,252,0.3)' : '0 0 20px rgba(124,92,252,0.3)' }}>$9.90</span>
          <span className="text-white/35 text-sm">/ {'\u20A9'}13,300</span>
        </div>
        <div className={`inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full border ${isMobile ? 'bg-gradient-to-r from-[#FF6B9D]/15 to-[#B668FC]/15 border-[#FF6B9D]/40' : 'bg-gradient-to-r from-[#EA537E]/15 to-[#7C5CFC]/15 border-[#EA537E]/40'}`}>
          <span className={`text-xs font-bold ${isMobile ? 'text-[#FF6B9D]' : 'text-[#EA537E]'}`}>50% OFF</span>
          <span className="text-white/20">{'\u00B7'}</span>
          <span className="text-white/60 text-xs">{p.launchPrice}</span>
        </div>
        <p className="text-amber-400/80 text-[11px] mt-3 font-medium">{p.limitedTimeOffer}</p>
      </div>

      <h3 className="text-xl font-bold text-white mb-2 relative">{p.fullPlanTitle}</h3>
      <p className="text-white/50 text-sm mb-5 max-w-lg mx-auto leading-relaxed">{p.fullPlanDesc}</p>

      {/* Feature checklist */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-w-md mx-auto mb-6 text-left">
        {([
          { icon: <Briefcase className={`w-4 h-4 ${isMobile ? 'text-[#B668FC]' : 'text-[#7C5CFC]'}`} />, text: p.featureItinerary },
          { icon: <UtensilsCrossed className={`w-4 h-4 ${isMobile ? 'text-[#B668FC]' : 'text-[#7C5CFC]'}`} />, text: p.featureRestaurant },
          { icon: <Camera className={`w-4 h-4 ${isMobile ? 'text-[#B668FC]' : 'text-[#7C5CFC]'}`} />, text: p.featurePhoto },
          { icon: <Train className={`w-4 h-4 ${isMobile ? 'text-[#B668FC]' : 'text-[#7C5CFC]'}`} />, text: p.featureTransit },
        ] as { icon: React.ReactNode; text: string }[]).map((item, i) => (
          <div key={i} className="flex items-center gap-2 text-sm text-white/70 py-1.5">
            {item.icon}
            <span>{item.text}</span>
          </div>
        ))}
      </div>

      {/* PRIMARY CTA — paid plan (Klook pattern: single primary action) */}
      <div className="max-w-md mx-auto flex flex-col gap-3">
        {/* Email input — required for both flows */}
        <input type="email" value={userEmail} onChange={e => setUserEmail(e.target.value)}
          placeholder={p.emailPlaceholder}
          className={`w-full px-4 py-3 rounded-xl bg-white/5 border border-white/20 text-white placeholder-white/40 transition-all outline-none ${isMobile ? 'focus:border-[#B668FC] focus:ring-1 focus:ring-[#B668FC]' : 'focus:border-[#7C5CFC] focus:ring-1 focus:ring-[#7C5CFC]'}`}
          required />

        {/* Feature recap (compact, was the OptionAButton list) */}
        <ul className="text-white/55 text-[11px] space-y-0.5 text-left bg-white/[0.03] border border-white/[0.06] rounded-xl px-3.5 py-2.5">
          <li className="flex gap-1.5"><Check className="w-3 h-3 text-[#7C5CFC] mt-0.5 shrink-0" /><span>{p.optionAfeature1}</span></li>
          <li className="flex gap-1.5"><Check className="w-3 h-3 text-[#7C5CFC] mt-0.5 shrink-0" /><span>{p.optionAfeature2}</span></li>
          <li className="flex gap-1.5"><Check className="w-3 h-3 text-[#7C5CFC] mt-0.5 shrink-0" /><span>{p.optionAfeature3}</span></li>
          <li className={`flex gap-1.5 font-semibold ${isMobile ? 'text-[#FF6B9D]' : 'text-[#EA537E]'}`}><Check className="w-3 h-3 mt-0.5 shrink-0" /><span>{p.optionAfeatureRevision || '1 Free Revision included'}</span></li>
        </ul>

        {/* Primary action — paid PayPal flow */}
        {selectedOption !== 'B' && (
          <>
            {isGeneratingPlan ? (
              <div className="text-center py-6">
                <div className="animate-spin h-10 w-10 border-4 border-purple-500 border-t-transparent rounded-full mx-auto mb-3" />
                <p className="text-white font-semibold">{p.creatingItinerary || 'Creating your itinerary...'}</p>
                <p className="text-white/40 text-sm mt-1">{p.takesAbout15Sec || 'Takes about 15 seconds'}</p>
              </div>
            ) : revisionMode && revisionPlanId ? (
              <button
                onClick={() => { const v = lastValues.current; if (v) onRevisionRegenerate(v, revisionPlanId, revisionToken); }}
                disabled={!lastValues.current}
                className="w-full py-4 rounded-2xl text-base font-bold text-white flex items-center justify-center gap-2 transition-all hover:scale-[1.02] active:scale-95 disabled:opacity-50"
                style={{ background: 'linear-gradient(135deg, #f59e0b, #B668FC)', boxShadow: '0 4px 20px rgba(245,158,11,0.3)' }}>
                Free Regeneration {'\u2014'} Create New Plan
              </button>
            ) : (
              <PayPalBookingButton
                productType="ai-planner-full" passengers={1} dateStart="" dateEnd=""
                priceKRW={13300} p={p} lang={language}
                memo={`Full itinerary for: ${userEmail}`}
                itineraryData={resultQuick}
                onPaymentSuccess={onPaymentSuccess}
                userEmail={userEmail}
              />
            )}
          </>
        )}

        {planError && (
          <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-xl">
            <p className="text-red-400 text-sm mb-1">{planError}</p>
            <a href="https://wa.me/821087140611" target="_blank" rel="noopener noreferrer" className="text-purple-400 text-xs underline">
              {p.contactWhatsApp || 'Contact us on WhatsApp'}
            </a>
          </div>
        )}

        {/* SECONDARY: "Already booked? Get it FREE" toggle — Klook upsell pattern */}
        <FreeBundleToggle
          p={p} isMobile={isMobile}
          isOpen={selectedOption === 'B'}
          onToggle={(open) => setSelectedOption(open ? 'B' : 'A')}
          optionBStep={optionBStep} setOptionBStep={setOptionBStep}
          lastValues={lastValues} userEmail={userEmail} setUserEmail={setUserEmail}
        />

        {/* Satisfaction guarantee */}
        <div className="flex items-center justify-center gap-2 text-[11px] text-white/30 mt-1">
          <Check className="w-3 h-3" />
          <span>{p.upgradeNotice}</span>
        </div>
      </div>
    </div>
  );
}

// Klook-style "got a bundle?" upsell — collapsed by default, doesn't compete
// with the primary $9.90 CTA, but keeps the free path discoverable.
function FreeBundleToggle({
  p, isMobile, isOpen, onToggle, optionBStep, setOptionBStep, lastValues, userEmail, setUserEmail,
}: {
  p: PlannerDict; isMobile: boolean; isOpen: boolean; onToggle: (open: boolean) => void;
  optionBStep: 1 | 2 | 3; setOptionBStep: (v: 1 | 2 | 3) => void;
  lastValues: MutableRefObject<PlannerFormValues | null>;
  userEmail: string; setUserEmail: (v: string) => void;
}) {
  return (
    <div className="rounded-xl border border-emerald-400/20 bg-emerald-400/[0.04] overflow-hidden">
      <button
        onClick={() => onToggle(!isOpen)}
        className="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-left min-h-[44px]"
      >
        <Gift className="w-4 h-4 text-emerald-400 shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-[12px] font-semibold text-emerald-300">{p.bundleToggleTitle || 'Already booked flight + hotel? Get this plan FREE'}</p>
        </div>
        <ChevronDown className={`w-4 h-4 text-emerald-400/70 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </button>
      {isOpen && (
        <div className="px-3.5 pb-3.5 pt-1 border-t border-emerald-400/15">
          <OptionBFlow
            p={p} isMobile={isMobile}
            optionBStep={optionBStep} setOptionBStep={setOptionBStep}
            lastValues={lastValues} userEmail={userEmail} setUserEmail={setUserEmail}
          />
        </div>
      )}
    </div>
  );
}

// OptionAButton + OptionBButton removed in Klook-pattern redesign — single
// primary CTA + collapsible bundle upsell instead. PayPal-side flow lives in
// the main render; bundle-side flow lives in OptionBFlow below.

function OptionBFlow({ p, isMobile, optionBStep, setOptionBStep, lastValues, userEmail, setUserEmail }: {
  p: PlannerDict; isMobile: boolean;
  optionBStep: 1 | 2 | 3; setOptionBStep: (v: 1 | 2 | 3) => void;
  lastValues: MutableRefObject<PlannerFormValues | null>;
  userEmail: string; setUserEmail: (v: string) => void;
}) {
  return (
    <div className="space-y-5 pt-2">
      {/* Step indicator */}
      <div className="flex items-center justify-center gap-3 mb-4">
        {[1, 2, 3].map(s => (
          <div key={s} className={`flex items-center gap-2 ${s <= optionBStep ? 'opacity-100' : 'opacity-30'}`}>
            <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold ${
              s < optionBStep ? (isMobile ? 'bg-[#B668FC] text-white' : 'bg-[#7C5CFC] text-white')
                : s === optionBStep ? 'border-2 border-white/60 text-white' : 'border border-white/20 text-white/30'
            }`}>{s < optionBStep ? '\u2713' : s}</div>
            {s < 3 && <div className={`w-8 h-0.5 ${s < optionBStep ? (isMobile ? 'bg-[#B668FC]/60' : 'bg-[#7C5CFC]/60') : 'bg-white/10'}`} />}
          </div>
        ))}
      </div>

      {optionBStep === 1 && (
        <div className="animate-fadeIn">
          <p className="text-white font-bold text-sm mb-4 flex items-center gap-2"><Plane className="w-4 h-4" /> {p.optionBFlightTitle || 'Step 1: Book your flight'}</p>
          <div className="bg-white/[0.03] border border-white/[0.08] rounded-2xl p-5">
            <p className="text-xs font-semibold text-white/30 uppercase tracking-widest mb-1 flex items-center gap-1"><Plane className="w-3.5 h-3.5" /> {p.flight_section_title}</p>
            <p className="text-[11px] text-white/35 mb-4">{p.flight_section_desc}</p>
            <a href={`https://www.trip.com/flights/?dcity=&acity=${encodeURIComponent(lastValues.current?.regions?.[0] || 'Seoul')}&Allianceid=4831212&SID=76964637&trip_sub1=cocotrip`}
              target="_blank" rel="noopener noreferrer"
              className="flex items-center justify-center gap-2 w-full py-3.5 rounded-xl text-sm font-bold transition-all hover:opacity-90 active:scale-95"
              style={{ background: '#0073E6', color: '#fff' }}>
              <Search className="w-4 h-4" /> Trip.com Flights {'\u2192'}
            </a>
            <p className="text-[10px] text-white/20 mt-2 text-center">{p.affiliate_note}</p>
          </div>
          <button onClick={() => setOptionBStep(2)}
            className="w-full mt-4 py-3.5 rounded-xl border border-white/15 text-white/60 text-sm font-medium hover:bg-white/5 transition-all">
            {p.alreadyBookedFlight || 'Already booked \u2192 Skip to hotel'}
          </button>
        </div>
      )}

      {optionBStep === 2 && (
        <div className="animate-fadeIn">
          <p className="text-white font-bold text-sm mb-3 flex items-center gap-2"><Hotel className="w-4 h-4" /> {p.optionBHotelTitle || 'Step 2: Book your hotel'}</p>
          {(() => {
            const region = (lastValues.current?.regions?.[0]) || 'Seoul';
            const links = buildAccommodationLinks(region, region);
            return (
              <div className="bg-white/[0.03] border border-white/[0.08] rounded-2xl p-5">
                <p className="text-xs font-semibold text-white/30 uppercase tracking-widest mb-1 flex items-center gap-1"><Hotel className="w-3.5 h-3.5" /> {p.slimHotelLowest}</p>
                <p className="text-[11px] text-white/35 mb-4">{p.optionBHotelDesc || 'Find the best hotel deals for your trip'}</p>
                <div className="flex flex-wrap gap-2">
                  {links.map((lk: { provider: string; label: string; url: string; color?: string }) => (
                    <a key={lk.provider} href={lk.url} target="_blank" rel="noopener noreferrer"
                      className="flex-1 min-w-[100px] text-center py-3 rounded-xl text-sm font-bold text-white transition-all hover:opacity-90 active:scale-95"
                      style={{ background: lk.color || '#0073E6', color: '#fff' }}>{lk.label} {'\u2192'}</a>
                  ))}
                </div>
                <p className="text-[10px] text-white/20 mt-2 text-center">{p.affiliate_note}</p>
              </div>
            );
          })()}
          <button onClick={() => setOptionBStep(3)} className="w-full mt-3 py-3 rounded-xl border border-white/15 text-white/60 text-sm font-medium hover:bg-white/5 transition-all">
            {p.alreadyBookedHotel || 'Already booked \u2192 Get free plan'}
          </button>
          <button onClick={() => setOptionBStep(1)} className="w-full mt-1 text-white/30 text-xs hover:text-white/50">{'\u2190'} {p.planner_prev}</button>
        </div>
      )}

      {optionBStep === 3 && (
        <div className="animate-fadeIn text-center">
          <div className={`w-14 h-14 rounded-full flex items-center justify-center mx-auto mb-3 ${isMobile ? 'bg-[#B668FC]/20' : 'bg-[#7C5CFC]/20'}`}>
            <Check className="w-7 h-7 text-emerald-400" />
          </div>
          <p className="text-white font-bold text-base mb-2">{p.optionBClaimTitle || 'Almost there!'}</p>
          <p className="text-white/50 text-sm mb-4 max-w-xs mx-auto">{p.optionBClaimDesc || 'Send us your booking confirmations via WhatsApp and we\'ll unlock your full plan for free.'}</p>
          <a href={`https://wa.me/821087140611?text=${encodeURIComponent('Hi! I booked my flight and hotel through CocoTrip. Please send me my free AI plan. Email: ' + userEmail)}`}
            target="_blank" rel="noopener noreferrer"
            className={`inline-flex items-center justify-center gap-2 w-full py-4 rounded-2xl text-white font-bold text-[15px] transition-all hover:scale-[1.02] bg-gradient-to-r from-[#25D366] to-[#128C7E] shadow-[0_4px_20px_rgba(37,211,102,0.25)]`}>
            <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/><path d="M12 0C5.373 0 0 5.373 0 12c0 2.625.846 5.059 2.284 7.034L.789 23.492l4.637-1.467A11.932 11.932 0 0012 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm0 21.818c-2.168 0-4.183-.655-5.863-1.776l-.42-.265-2.754.872.878-2.69-.288-.44A9.776 9.776 0 012.182 12c0-5.414 4.404-9.818 9.818-9.818S21.818 6.586 21.818 12 17.414 21.818 12 21.818z"/></svg>
            {p.optionBWhatsAppCta || 'Send booking proof via WhatsApp'}
          </a>
          <input type="email" value={userEmail} onChange={e => setUserEmail(e.target.value)} placeholder={p.emailPlaceholder}
            className={`w-full mt-3 px-4 py-3 rounded-xl bg-white/5 border border-white/20 text-white placeholder-white/40 transition-all outline-none ${isMobile ? 'focus:border-[#B668FC] focus:ring-1 focus:ring-[#B668FC]' : 'focus:border-[#7C5CFC] focus:ring-1 focus:ring-[#7C5CFC]'}`} />
          <button onClick={() => setOptionBStep(2)} className="w-full mt-2 text-white/30 text-xs hover:text-white/50">{'\u2190'} {p.planner_prev}</button>
        </div>
      )}
    </div>
  );
}
