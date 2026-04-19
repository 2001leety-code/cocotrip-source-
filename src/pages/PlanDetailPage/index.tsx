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
import { Header } from '@/sections/Header';
import { Footer } from '@/sections/Footer';
import { useIsMobile } from '@/hooks/use-mobile';
import {
  MapPin, Calendar, Users, Download, MessageCircle, Car,
  CreditCard, AlertCircle, RefreshCw,
} from 'lucide-react';

import { formatKRW } from './constants';
import { useAutoTranslate } from './useAutoTranslate';
import { generatePDF } from './pdfGenerator';
import { ArrivalGuide } from './components/ArrivalGuide';
import { DayTimeline } from './components/DayTimeline';
import { BudgetTable } from './components/BudgetTable';
import { DepartureGuide } from './components/DepartureGuide';
import { EditModeToggle } from './components/EditModeToggle';
import { AddStopModal } from './components/AddStopModal';
import { HotelAd } from './components/ads/HotelAd';
import { CharterBanner } from './components/ads/CharterBanner';
import { AirportPickupAd } from './components/ads/AirportPickupAd';
import { EsimAd } from './components/ads/EsimAd';
import { CarRentalAd } from './components/ads/CarRentalAd';
import { FlightAd } from './components/ads/FlightAd';
import { SeasonalBanner } from './components/SeasonalBanner';
import { RevisionCard } from './components/RevisionCard';
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
          <HotelAd region={input.destination || input.regions?.[0] || 'Seoul'} />

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
          <CharterBanner days={days} />

          {departure && <DepartureGuide guide={departure} />}

          {/* Airport Pickup Card */}
          <AirportPickupAd arrivalAirport={input.arrival_airport || 'ICN'} />
        </div>

        {/* Seasonal Spots Banner */}
        <SeasonalBanner />

        {/* Revision Card */}
        {!_isRegenerating && <RevisionCard plan={plan} planId={planId || ''} token={token} />}

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
        <EsimAd />

        {/* Car Rental */}
        <CarRentalAd region={input.destination || input.regions?.[0] || 'Seoul'} />

        {/* Flight Search */}
        <FlightAd arrivalAirport={input.arrival_airport || 'ICN'} />

        <div className="mb-24" />
      </main>
      <Footer t={t} />
    </div>
  );
}
