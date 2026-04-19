// PlanDetailPage container: Firestore listener + tab state + render JSX.
// Split from src/pages/PlanDetailPage.tsx (1144L) during P2 Lock release.
// LOCKED regions moved out:
//   - auto-translate useEffect  -> ./useAutoTranslate.ts
//   - handleDownloadPDF body    -> ./pdfGenerator.ts
// L662 PDF button keeps `disabled={isPdfGenerating || isTranslating}` exactly as before.
import { useEffect, useState, useRef, useCallback } from 'react';
import { useParams, useSearchParams, Link } from 'react-router-dom';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuth } from '@/hooks/useAuth';
import { useLanguage } from '@/hooks/useLanguage';
import { useIsMobile } from '@/hooks/use-mobile';
import {
  MapPin, Calendar, Users, Download, MessageCircle, Plane, Car,
  CreditCard, ExternalLink, AlertCircle, Phone, RefreshCw, Sparkles,
} from 'lucide-react';
import { Header } from '@/sections/Header';
import { Footer } from '@/sections/Footer';
import { buildAccommodationLinks, buildFlightLink, buildCarLink, PICKUP_PRICES } from '@/config/affiliateLinks';
import { detectCharterRecommendation } from '@/data/charterPricing';
import { getCurrentSeason, SEASONAL_SPOTS } from '@/data/seasonalSpots';

import { formatKRW } from './constants';
import { useAutoTranslate } from './useAutoTranslate';
import { generatePDF } from './pdfGenerator';
import { ArrivalGuide } from './components/ArrivalGuide';
import { DayTimeline } from './components/DayTimeline';
import { BudgetTable } from './components/BudgetTable';
import { DepartureGuide } from './components/DepartureGuide';
import { EditModeToggle } from './components/EditModeToggle';
import { AddStopModal } from './components/AddStopModal';
import { usePlanEditor } from './hooks/usePlanEditor';
import { DndContext, closestCenter, PointerSensor, TouchSensor, useSensor, useSensors } from '@dnd-kit/core';
import type { DragEndEvent } from '@dnd-kit/core';

export default function PlanDetailPage() {
  const { planId } = useParams();
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token');
  const { user, loading: authLoading } = useAuth();
  const { language, t, changeLanguage } = useLanguage();
  const isMobile = useIsMobile();
  const [plan, setPlan] = useState<any>(null);
  const [error, setError] = useState<'notfound' | 'unauthorized' | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeDay, setActiveDay] = useState(0);
  const [fadeKey, setFadeKey] = useState(0);
  const tabBarRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [_isRegenerating] = useState(false);
  const [_regenError] = useState<string | null>(null);
  const [editMode, setEditMode] = useState(false);
  const [addStopDay, setAddStopDay] = useState<number | null>(null);

  // Plan editor (optimistic Firestore updates)
  const editor = usePlanEditor(planId || '', plan, setPlan);

  // Drag sensors with distance constraint for mobile scroll compatibility
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 5 } }),
  );

  // Firestore listener
  useEffect(() => {
    if (!planId) { setError('notfound'); setLoading(false); return; }
    if (authLoading) return;
    setError(null);
    setLoading(true);
    const unsub = onSnapshot(doc(db, 'plans', planId), (snap) => {
      if (!snap.exists()) { setError('notfound'); setLoading(false); return; }
      const data = snap.data();
      const isOwner = user && data.uid === user.uid;
      const hasToken = data.accessToken && data.accessToken === token;
      const isGuestPlan = !data.uid;
      if (!isOwner && !hasToken && !isGuestPlan) { setError('unauthorized'); setLoading(false); return; }
      setPlan(data);
      setLoading(false);
    }, (err) => {
      console.error('[PlanDetail] Firestore read error:', err);
      setError('notfound');
      setLoading(false);
    });
    return () => unsub();
  }, [planId, token, user, authLoading]);

  // URL hash sync - restore active day on load
  useEffect(() => {
    const hash = window.location.hash;
    const match = hash.match(/^#day-(\d+)$/);
    if (match) {
      const idx = parseInt(match[1], 10) - 1;
      if (idx >= 0) setActiveDay(idx);
    }
  }, []);

  // Auto-translate (locked hook - see useAutoTranslate.ts for invariants)
  const { isTranslating } = useAutoTranslate(plan, setPlan, language);

  // Tab switch handler
  const handleTabSwitch = useCallback((idx: number) => {
    setActiveDay(idx);
    setFadeKey((k) => k + 1);
    window.history.replaceState(null, '', `#day-${idx + 1}`);
    if (tabBarRef.current) {
      const btn = tabBarRef.current.children[idx] as HTMLElement;
      btn?.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
    }
  }, []);

  // PDF download (locked module - see pdfGenerator.ts for invariants)
  const [isPdfGenerating, setIsPdfGenerating] = useState(false);
  const handleDownloadPDF = useCallback(async () => {
    if (!plan) return;
    setIsPdfGenerating(true);
    try {
      await generatePDF(plan);
    } finally {
      setIsPdfGenerating(false);
    }
  }, [plan]);

  // Loading / Error states
  if (loading) return (
    <div className="min-h-screen bg-[#0a0b14] text-white flex items-center justify-center">
      <div className="text-center">
        <div className="w-10 h-10 border-2 border-[#7C5CFC] border-t-transparent rounded-full animate-spin mx-auto mb-4" />
        <p className="text-white/40 text-sm">Loading your plan...</p>
      </div>
    </div>
  );

  if (error === 'notfound') return (
    <div className="min-h-screen bg-[#0a0b14] text-white">
      <Header language={language} t={t} onLanguageChange={changeLanguage} />
      <div className="flex flex-col items-center justify-center min-h-[60vh] px-4">
        <AlertCircle className="w-16 h-16 text-red-400/40 mb-4" />
        <h1 className="text-xl font-bold mb-2">Plan Not Found</h1>
        <p className="text-white/40 text-sm mb-6">This plan may have been deleted or the link is invalid.</p>
        <Link to="/planner" className="px-6 py-3 rounded-xl text-sm font-bold text-white" style={{ background: 'linear-gradient(135deg,#7C5CFC,#EA537E)' }}>Create New Plan</Link>
      </div>
    </div>
  );

  if (error === 'unauthorized') return (
    <div className="min-h-screen bg-[#0a0b14] text-white">
      <Header language={language} t={t} onLanguageChange={changeLanguage} />
      <div className="flex flex-col items-center justify-center min-h-[60vh] px-4">
        <AlertCircle className="w-16 h-16 text-yellow-400/40 mb-4" />
        <h1 className="text-xl font-bold mb-2">Access Denied</h1>
        <p className="text-white/40 text-sm mb-6">You don't have permission to view this plan.</p>
      </div>
    </div>
  );

  if (!plan) return null;

  const it = plan.itinerary || {};
  const days = it.days || [];
  const arrival = it.arrival_guide;
  const departure = it.departure_guide;
  const budget = it.daily_budget_summary || [];
  const input = plan.input || {};

  return (
    <div className={`min-h-screen text-white ${isMobile ? 'bg-[#0a0412]' : 'bg-[#0a0b14]'}`}>
      <Header language={language} t={t} onLanguageChange={changeLanguage} />
      <main className="max-w-3xl mx-auto px-4 py-8 pt-24">
        <div ref={contentRef} id="plan-detail-content">
          {/* Title */}
          <div className="text-center mb-8">
            {isTranslating && (
              <div className="inline-flex items-center gap-2 bg-[#7C5CFC]/20 border border-[#7C5CFC]/30 rounded-full px-4 py-1.5 mb-3 text-xs text-[#7C5CFC]">
                <RefreshCw className="w-3 h-3 animate-spin" />
                Translating...
              </div>
            )}
            <h1 className="text-2xl sm:text-3xl font-bold bg-clip-text text-transparent" style={{ backgroundImage: isMobile ? 'linear-gradient(135deg,#B668FC,#FF6B9D)' : 'linear-gradient(135deg,#a78bfa,#ec4899)' }}>
              {it.tour_title || 'Your Korea Itinerary'}
            </h1>
            <p className="text-white/40 text-sm mt-2">
              {input.startDate} | {input.adults ? `${input.adults} adults` : `${input.pax} pax`}
              {input.children > 0 && ` + ${input.children} children`}
              {(plan.pricing?.vehicleLabel || plan.pricing?.vehicle) && ` | ${plan.pricing.vehicleLabel || plan.pricing.vehicle}`}
            </p>
          </div>

          {/* Summary stats */}
          <div className="grid grid-cols-4 gap-2 mb-6">
            {[
              { icon: <Calendar className="w-4 h-4" />, label: 'Days', value: String(days.length || '-') },
              { icon: <MapPin className="w-4 h-4" />, label: 'Stops', value: String(days.reduce((s: number, d: any) => s + (d.stops?.length || 0), 0)) },
              { icon: <Users className="w-4 h-4" />, label: 'Pax', value: String(input.adults ? (input.adults + (input.children || 0)) : input.pax) },
              { icon: <CreditCard className="w-4 h-4" />, label: 'T-money', value: formatKRW(it.t_money_recommended_load || 0) },
            ].map((item, i) => (
              <div key={i} className="bg-white/[0.04] border border-white/[0.08] rounded-xl p-3 text-center">
                <span className="text-white/30 flex justify-center mb-1">{item.icon}</span>
                <p className="text-xs text-white/40">{item.label}</p>
                <p className="text-sm font-bold">{item.value}</p>
              </div>
            ))}
          </div>

          {/* Arrival Guide */}
          {arrival && <ArrivalGuide guide={arrival} />}

          {/* Hotel Booking Banner */}
          {(() => {
            const region = input.destination || input.regions?.[0] || 'Seoul';
            const links = buildAccommodationLinks(region + ' Hotel', region);
            if (!links.length) return null;
            return (
              <div className="mb-6 rounded-2xl overflow-hidden border border-blue-500/20" style={{ background: 'linear-gradient(135deg, rgba(59,130,246,0.08), rgba(6,182,212,0.05))' }}>
                <div className="px-5 py-4 flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full flex items-center justify-center shrink-0 bg-blue-500/20 border border-blue-500/30">
                    <MapPin className="w-5 h-5 text-blue-400" />
                  </div>
                  <div className="flex-1">
                    <p className="font-bold text-white text-base leading-tight">Find Your Perfect Hotel</p>
                    <p className="text-xs text-white/50 mt-0.5">Best rates for {region} hotels</p>
                  </div>
                </div>
                <div className="px-5 pb-4">
                  {links.map((lk: any) => (
                    <a key={lk.provider} href={lk.url} target="_blank" rel="noopener noreferrer"
                      className="w-full flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-bold text-white transition-all hover:opacity-90 hover:scale-[1.02]"
                      style={{ background: lk.color || '#0073E6', boxShadow: '0 4px 16px rgba(0,115,230,0.25)' }}>
                      {lk.label} {'\u2192'}
                    </a>
                  ))}
                </div>
                <p className="text-[10px] text-white/20 text-center pb-3 px-5">Affiliate link {'\u2014'} helps support CocoTrip.</p>
              </div>
            );
          })()}

          {/* Day Tab Bar + Edit Toggle */}
          <div className="flex items-center gap-2 mb-6 sticky top-16 z-20 backdrop-blur-sm py-3 -mx-4 px-4" style={{ background: isMobile ? 'rgba(10,4,18,0.95)' : 'rgba(10,11,20,0.95)' }}>
            {days.length > 1 && (
              <div
                ref={tabBarRef}
                className="flex gap-2 overflow-x-auto scrollbar-hide flex-1 sm:justify-center"
              >
                {days.map((_: any, i: number) => (
                  <button
                    key={i}
                    onClick={() => handleTabSwitch(i)}
                    className={`shrink-0 px-5 py-2.5 rounded-xl text-sm font-bold transition-all duration-200 ${
                      activeDay === i
                        ? `text-white shadow-lg ${isMobile ? 'shadow-[#B668FC]/20' : 'shadow-[#7C5CFC]/20'}`
                        : 'bg-white/[0.04] text-white/60 hover:bg-white/[0.08] hover:text-white/80'
                    }`}
                    style={activeDay === i ? { background: isMobile ? 'linear-gradient(135deg,#B668FC,#FF6B9D)' : 'linear-gradient(135deg,#7C5CFC,#EA537E)' } : undefined}
                  >
                    Day {i + 1}
                  </button>
                ))}
              </div>
            )}
            <EditModeToggle editMode={editMode} onToggle={() => setEditMode(!editMode)} />
          </div>

          {/* Active Day Content */}
          {days.length > 0 && (
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={(event: DragEndEvent) => {
                const { active, over } = event;
                if (!over || active.id === over.id) return;
                // Parse day-{dayIdx}-stop-{stopIdx} format
                const activeMatch = String(active.id).match(/^day-(\d+)-stop-(\d+)$/);
                const overMatch = String(over.id).match(/^day-(\d+)-stop-(\d+)$/);
                if (activeMatch && overMatch && activeMatch[1] === overMatch[1]) {
                  const dayIdx = parseInt(activeMatch[1], 10);
                  const oldIdx = parseInt(activeMatch[2], 10);
                  const newIdx = parseInt(overMatch[2], 10);
                  editor.reorderStops(dayIdx, oldIdx, newIdx);
                }
              }}
            >
              <div key={fadeKey} className="animate-fadeIn">
                <DayTimeline
                  day={days[activeDay]}
                  dayIndex={activeDay}
                  editMode={editMode}
                  onDeleteStop={(dayIdx, stopIdx) => editor.deleteStop(dayIdx, stopIdx)}
                  onAddStop={(dayIdx) => setAddStopDay(dayIdx)}
                />
              </div>
            </DndContext>
          )}

          {/* Add Stop Modal */}
          <AddStopModal
            open={addStopDay !== null}
            onClose={() => setAddStopDay(null)}
            onAdd={(stopData) => {
              if (addStopDay !== null) {
                editor.addStop(addStopDay, stopData);
                setAddStopDay(null);
              }
            }}
          />

          {/* Budget Table */}
          {budget.length > 0 && <BudgetTable budget={budget} tMoney={it.t_money_recommended_load} />}

          {/* Charter Vehicle Banner */}
          {(() => {
            const allStops = days.flatMap((d: any) => d.stops || []);
            const detection = detectCharterRecommendation(allStops);
            if (!detection.recommended || !detection.pricing) return null;
            const { pricing } = detection;
            return (
              <div className="mb-6 rounded-2xl overflow-hidden border border-cyan-500/25" style={{ background: 'linear-gradient(135deg, rgba(6,182,212,0.08), rgba(59,130,246,0.05))' }}>
                <div className="px-5 py-4 border-b border-cyan-500/20">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <Car className="w-6 h-6 text-cyan-300" />
                      <div>
                        <p className="font-bold text-white text-base">Private Charter Vehicle</p>
                        <p className="text-xs text-cyan-300/70 mt-0.5">Skip public transit {'\u2014'} ride in comfort</p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-lg font-bold text-cyan-300">{'\u20A9'}{pricing.priceKRW.toLocaleString()}</p>
                      <p className="text-xs text-white/40">{pricing.hours}hrs</p>
                    </div>
                  </div>
                </div>
                <div className="px-5 py-4">
                  <div className="flex flex-wrap gap-2 mb-4">
                    {['English driver', 'Door-to-door', 'Free WiFi', 'Luggage space'].map(f => (
                      <span key={f} className="text-[11px] text-cyan-200/70 bg-cyan-500/10 border border-cyan-500/20 px-2.5 py-1 rounded-full">{'\u2713'} {f}</span>
                    ))}
                  </div>
                  <a href="https://wa.me/821087140611" target="_blank" rel="noopener noreferrer"
                    className="block w-full py-3.5 rounded-xl text-center text-sm font-bold text-white transition-all hover:opacity-90"
                    style={{ background: 'linear-gradient(135deg, #06b6d4, #3b82f6)', boxShadow: '0 4px 20px rgba(6,182,212,0.3)' }}>
                    Book via WhatsApp {'\u2192'}
                  </a>
                </div>
              </div>
            );
          })()}

          {departure && <DepartureGuide guide={departure} />}

          {/* Airport Pickup Card */}
          {(() => {
            const airportCode = (input.arrival_airport || 'ICN').replace(/_T[12]$/, '');
            const prices = PICKUP_PRICES[airportCode] || PICKUP_PRICES['ICN'];
            if (!prices?.length) return null;
            return (
              <div className="mb-6 rounded-2xl border border-amber-500/25 p-5" style={{ background: 'linear-gradient(135deg, rgba(245,158,11,0.06), rgba(10,16,32,0.95))' }}>
                <div className="flex items-start gap-3 mb-4">
                  <div className="w-10 h-10 rounded-xl bg-amber-500/15 border border-amber-500/30 flex items-center justify-center shrink-0">
                    <Plane className="w-6 h-6 text-amber-400" />
                  </div>
                  <div className="flex-1">
                    <p className="font-bold text-white text-base leading-tight mb-0.5">Airport Pickup Service</p>
                    <p className="text-xs text-amber-300/80">English-speaking driver at arrivals</p>
                  </div>
                  <span className="shrink-0 text-[10px] text-amber-400 border border-amber-500/35 rounded-full px-2.5 py-1 font-semibold">{airportCode}</span>
                </div>
                <div className="space-y-2 mb-4">
                  {prices.map((row: any, i: number) => (
                    <div key={i} className="flex items-center justify-between bg-white/[0.04] border border-white/[0.08] rounded-xl px-4 py-3">
                      <span className="text-sm text-white/60">{row.destination}</span>
                      <span className="text-sm font-bold text-amber-300">{row.price}</span>
                    </div>
                  ))}
                </div>
                <a href="https://wa.me/821087140611" target="_blank" rel="noopener noreferrer"
                  className="block w-full py-3.5 rounded-xl text-center text-sm font-bold text-white transition-all hover:opacity-90"
                  style={{ background: 'linear-gradient(135deg, #f59e0b, #d97706)', boxShadow: '0 4px 20px rgba(245,158,11,0.25)' }}>
                  Book Airport Pickup {'\u2192'}
                </a>
              </div>
            );
          })()}
        </div>

        {/* Seasonal Spots Banner */}
        {(() => {
          const season = getCurrentSeason();
          const sd = SEASONAL_SPOTS[season];
          const lk = (language === 'ko' || language === 'en' || language === 'ja' || language === 'zh') ? language : 'en';
          const SEASON_GRADIENT: Record<string, string> = {
            spring: 'linear-gradient(135deg, rgba(248,180,217,0.15), rgba(192,132,252,0.1))',
            summer: 'linear-gradient(135deg, rgba(96,165,250,0.15), rgba(16,185,129,0.1))',
            autumn: 'linear-gradient(135deg, rgba(249,115,22,0.15), rgba(239,68,68,0.1))',
            winter: 'linear-gradient(135deg, rgba(124,92,252,0.15), rgba(6,182,212,0.1))',
          };
          const SEASON_BORDER: Record<string, string> = {
            spring: 'border-pink-400/20', summer: 'border-cyan-400/20', autumn: 'border-orange-400/20', winter: 'border-purple-400/20',
          };
          const pickLang = <T,>(m: { ko: T; en: T; ja: T; zh: T }): T => m[language as 'ko' | 'en' | 'ja' | 'zh'] || m.en;
          return (
            <div className={`mt-8 rounded-2xl overflow-hidden border ${SEASON_BORDER[season]}`} style={{ background: SEASON_GRADIENT[season] }}>
              <div className="px-5 py-5">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-lg">{sd.emoji}</span>
                  <p className="font-bold text-white text-base">{sd.title[lk]}</p>
                </div>
                <p className="text-xs text-white/50 mb-3">{sd.subtitle[lk]}</p>
                <div className="space-y-2">
                  {sd.spots.slice(0, 3).map((spot, i) => (
                    <div key={i} className="bg-white/[0.06] rounded-xl px-4 py-3 border border-white/[0.06]">
                      <p className="text-sm font-bold text-white">{pickLang({ ko: spot.name, en: spot.nameEn, ja: spot.nameEn, zh: spot.nameEn })}</p>
                      <p className="text-[10px] text-white/40 mt-0.5">{pickLang({ ko: spot.location, en: spot.locationEn, ja: spot.locationEn, zh: spot.locationEn })} {'\u00B7'} {pickLang({ ko: spot.period, en: spot.periodEn, ja: spot.periodEn, zh: spot.periodEn })}</p>
                      <p className="text-xs text-white/60 mt-1">{pickLang({ ko: spot.tip, en: spot.tipEn, ja: spot.tipEn, zh: spot.tipEn })}</p>
                    </div>
                  ))}
                </div>
                <p className="text-[10px] text-white/30 text-center mt-3">{sd.urgency[lk]}</p>
              </div>
            </div>
          );
        })()}

        {/* Revision / Regenerate Card */}
        {plan && (plan.revisionCredits || 0) > 0 && !_isRegenerating && (
          <div className="mt-8 rounded-2xl overflow-hidden border border-amber-500/20"
            style={{ background: 'linear-gradient(135deg, rgba(251,191,36,0.06), rgba(182,104,252,0.04))' }}>
            <div className="px-5 py-5 text-center">
              <div className="flex items-center justify-center gap-2 mb-2">
                <Sparkles className="w-5 h-5 text-amber-400" />
                <h3 className="text-lg font-bold text-white">Want a different vibe?</h3>
              </div>
              <p className="text-white/50 text-sm mb-1">
                Not 100% satisfied? Tweak your preferences and get a brand new itinerary.
              </p>
              <p className="text-amber-400/80 text-xs font-semibold mb-4">
                {plan.revisionCredits} Free Revision{plan.revisionCredits > 1 ? 's' : ''} remaining
              </p>
              <button
                onClick={() => {
                  const params = new URLSearchParams({
                    revision: 'true',
                    planId: planId || '',
                    ...(token ? { token } : {}),
                  });
                  window.location.href = `/planner?${params.toString()}`;
                }}
                className="w-full py-3.5 rounded-xl text-sm font-bold text-white flex items-center justify-center gap-2 transition-all hover:scale-[1.02] active:scale-95"
                style={{ background: 'linear-gradient(135deg, #f59e0b, #B668FC)', boxShadow: '0 4px 20px rgba(245,158,11,0.25)' }}
              >
                <RefreshCw className="w-4 h-4" />
                Edit Preferences & Regenerate
              </button>
            </div>
          </div>
        )}

        {_isRegenerating && (
          <div className="mt-8 text-center py-10">
            <div className="w-12 h-12 border-4 border-amber-400 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
            <p className="text-white font-semibold">Regenerating your plan...</p>
            <p className="text-white/40 text-sm mt-1">This may take up to 30 seconds</p>
          </div>
        )}

        {_regenError && (
          <div className="mt-4 p-3 bg-red-500/10 border border-red-500/30 rounded-xl">
            <p className="text-red-400 text-sm">{_regenError}</p>
          </div>
        )}

        {/* Action buttons - LOCKED: PDF button disabled condition must stay exact */}
        <div className="mt-8 space-y-3">
          <button onClick={handleDownloadPDF} disabled={isPdfGenerating || isTranslating} className="w-full py-4 rounded-2xl text-base font-bold text-white flex items-center justify-center gap-2 disabled:opacity-60" style={{ background: isMobile ? 'linear-gradient(135deg,#B668FC,#FF6B9D)' : 'linear-gradient(135deg,#7C5CFC,#EA537E)' }}>
            {isPdfGenerating ? (
              <><div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" /> Generating PDF...</>
            ) : isTranslating ? (
              <><div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" /> Translating... please wait</>
            ) : (
              <><Download className="w-5 h-5" /> Download PDF</>
            )}
          </button>
          <a href="https://wa.me/821087140611" target="_blank" rel="noopener noreferrer" className="w-full py-4 rounded-2xl text-base font-bold text-white flex items-center justify-center gap-2 border border-green-500/30 bg-green-500/10 hover:bg-green-500/20 transition-colors">
            <MessageCircle className="w-5 h-5 text-green-400" /> WhatsApp Booking
          </a>
        </div>

        {/* eSIM */}
        <div className="rounded-2xl overflow-hidden border border-[#B668FC]/25 mt-6"
          style={{ background: 'linear-gradient(135deg, rgba(182,104,252,0.08), rgba(255,107,157,0.05))' }}>
          <div className="px-5 py-4 flex items-center gap-3">
            <div className="w-10 h-10 rounded-full flex items-center justify-center shrink-0 bg-[#B668FC]/20 border border-[#B668FC]/30">
              <Phone className="w-5 h-5 text-[#B668FC]" />
            </div>
            <div className="flex-1">
              <p className="font-bold text-white text-base leading-tight">{t.planner?.esimTitle || 'Got your Korea eSIM ready?'}</p>
              <p className="text-xs text-white/50 mt-0.5">{t.planner?.esimDesc || 'Buy an eSIM before landing and stay connected.'}</p>
            </div>
          </div>
          <div className="px-5 pb-4 flex gap-2">
            <a href="https://www.airalo.com/south-korea" target="_blank" rel="noopener noreferrer"
              className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-bold text-white transition-all hover:opacity-90 hover:scale-[1.02] active:scale-95"
              style={{ background: '#FF6B35', boxShadow: '0 4px 16px rgba(255,107,53,0.25)' }}>
              Airalo {'\u2192'}
            </a>
            <a href="https://yesim.app/" target="_blank" rel="noopener noreferrer"
              className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-bold text-white transition-all hover:opacity-90 hover:scale-[1.02] active:scale-95"
              style={{ background: '#4CAF50', boxShadow: '0 4px 16px rgba(76,175,80,0.25)' }}>
              Yesim {'\u2192'}
            </a>
          </div>
          <p className="text-[10px] text-white/20 text-center pb-3 px-5">{t.planner?.esimNote || 'Purchasing via these links helps support CocoTrip.'}</p>
        </div>

        {/* Trip.com Car Rental */}
        {(() => {
          const region = input.destination || input.regions?.[0] || 'Seoul';
          const carLink = buildCarLink(region);
          return (
            <div className="rounded-2xl overflow-hidden border border-emerald-500/20 mt-6" style={{ background: 'linear-gradient(135deg, rgba(16,185,129,0.08), rgba(6,182,212,0.05))' }}>
              <div className="px-5 py-4 flex items-center gap-3">
                <div className="w-10 h-10 rounded-full flex items-center justify-center shrink-0 bg-emerald-500/20 border border-emerald-500/30">
                  <Car className="w-5 h-5 text-emerald-400" />
                </div>
                <div className="flex-1">
                  <p className="font-bold text-white text-base leading-tight">Rent a Car in Korea</p>
                  <p className="text-xs text-white/50 mt-0.5">Explore at your own pace {'\u2014'} international license accepted</p>
                </div>
              </div>
              <div className="px-5 pb-4">
                <a href={carLink.url} target="_blank" rel="noopener noreferrer"
                  className="w-full flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-bold text-white transition-all hover:opacity-90 hover:scale-[1.02]"
                  style={{ background: '#0073E6', boxShadow: '0 4px 16px rgba(0,115,230,0.25)' }}>
                  {carLink.label} {'\u2192'}
                </a>
              </div>
              <p className="text-[10px] text-white/20 text-center pb-3 px-5">Affiliate link {'\u2014'} helps support CocoTrip.</p>
            </div>
          );
        })()}

        {/* Trip.com Flight Search */}
        {(() => {
          const airportCode = input.arrival_airport || 'ICN';
          const link = buildFlightLink(airportCode);
          if (!link) return null;
          return (
            <div className="rounded-2xl overflow-hidden border border-indigo-500/20 mt-6" style={{ background: 'linear-gradient(135deg, rgba(99,102,241,0.08), rgba(139,92,246,0.05))' }}>
              <div className="px-5 py-4 flex items-center gap-3">
                <div className="w-10 h-10 rounded-full flex items-center justify-center shrink-0 bg-indigo-500/20 border border-indigo-500/30">
                  <Plane className="w-5 h-5 text-indigo-400" />
                </div>
                <div className="flex-1">
                  <p className="font-bold text-white text-base leading-tight">Search Flights to Korea</p>
                  <p className="text-xs text-white/50 mt-0.5">Compare prices across airlines</p>
                </div>
              </div>
              <div className="px-5 pb-4">
                <a href={link.url} target="_blank" rel="noopener noreferrer"
                  className="w-full flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-bold text-white transition-all hover:opacity-90 hover:scale-[1.02]"
                  style={{ background: '#0073E6', boxShadow: '0 4px 16px rgba(0,115,230,0.25)' }}>
                  {link.label} {'\u2192'}
                </a>
              </div>
              <p className="text-[10px] text-white/20 text-center pb-3 px-5">Affiliate link {'\u2014'} helps support CocoTrip.</p>
            </div>
          );
        })()}

        <div className="mb-24" />
      </main>
      <Footer t={t} />
    </div>
  );
}
