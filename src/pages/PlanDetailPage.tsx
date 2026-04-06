import { useEffect, useState, useRef, useCallback } from 'react';
import { useParams, useSearchParams, Link } from 'react-router-dom';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuth } from '@/hooks/useAuth';
import { useLanguage } from '@/hooks/useLanguage';
import {
  MapPin, Clock, Calendar, Users, ChevronDown,
  Download, MessageCircle, Plane, Train, Bus, Car, Footprints,
  Landmark, UtensilsCrossed, ShoppingBag, Camera, Music2, Mountain,
  CreditCard, Wallet, ExternalLink, AlertCircle, Accessibility,
} from 'lucide-react';
import { Header } from '@/sections/Header';
import { Footer } from '@/sections/Footer';

/* ═══════════════════════════════════════════════════════
   CONSTANTS
   ═══════════════════════════════════════════════════════ */

const CAT_ICON: Record<string, any> = {
  culture: Landmark, food: UtensilsCrossed, shopping: ShoppingBag,
  nature: Mountain, landmark: Camera, kpop: Music2,
};
const TRANSIT_ICON: Record<string, any> = {
  subway: Train, taxi: Car, walk: Footprints, bus: Bus, car: Car,
};

function formatKRW(n: number) {
  if (!n || isNaN(n)) return '';
  return '\u20A9' + new Intl.NumberFormat('ko-KR').format(n);
}

/* ═══════════════════════════════════════════════════════
   MAIN COMPONENT
   ═══════════════════════════════════════════════════════ */

export default function PlanDetailPage() {
  const { planId } = useParams();
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token');
  const { user, loading: authLoading } = useAuth();
  const { language, t, changeLanguage } = useLanguage();
  const [plan, setPlan] = useState<any>(null);
  const [error, setError] = useState<'notfound' | 'unauthorized' | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeDay, setActiveDay] = useState(0);
  const [fadeKey, setFadeKey] = useState(0);
  const tabBarRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  // ── Firestore listener ──
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

  // ── URL hash sync — restore active day on load ──
  useEffect(() => {
    const hash = window.location.hash;
    const match = hash.match(/^#day-(\d+)$/);
    if (match) {
      const idx = parseInt(match[1], 10) - 1;
      if (idx >= 0) setActiveDay(idx);
    }
  }, []);

  // ── Tab switch handler ──
  const handleTabSwitch = useCallback((idx: number) => {
    setActiveDay(idx);
    setFadeKey((k) => k + 1);
    window.history.replaceState(null, '', `#day-${idx + 1}`);
    // scroll active tab into view on mobile
    if (tabBarRef.current) {
      const btn = tabBarRef.current.children[idx] as HTMLElement;
      btn?.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
    }
  }, []);

  // ── PDF download — hidden container approach ──
  const handleDownloadPDF = useCallback(async () => {
    if (!plan) return;
    const it = plan.itinerary || {};
    const days = it.days || [];
    const arrival = it.arrival_guide;
    const departure = it.departure_guide;
    const budget = it.daily_budget_summary || [];
    const input = plan.input || {};

    // create hidden render container
    const container = document.createElement('div');
    container.style.cssText = 'position:absolute;left:-9999px;top:0;width:800px;visibility:visible;background:#0a0b14;color:white;padding:32px;font-family:system-ui,sans-serif;';
    document.body.appendChild(container);

    // build HTML content
    let html = `<div style="text-align:center;margin-bottom:24px;">
      <h1 style="font-size:24px;font-weight:bold;background:linear-gradient(135deg,#a78bfa,#ec4899);-webkit-background-clip:text;-webkit-text-fill-color:transparent;">
        ${it.tour_title || 'Your Korea Itinerary'}
      </h1>
      <p style="color:rgba(255,255,255,0.4);font-size:12px;margin-top:8px;">${input.startDate || ''} | ${input.pax || input.adults || '-'} pax</p>
    </div>`;

    // arrival guide
    if (arrival) {
      html += `<div style="background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);border-radius:12px;padding:16px;margin-bottom:16px;">
        <h3 style="font-size:14px;font-weight:bold;margin-bottom:8px;">Airport Arrival Guide — ${arrival.airport || ''}</h3>`;
      (arrival.steps || []).forEach((step: any) => {
        html += `<p style="font-size:11px;color:rgba(255,255,255,0.6);margin:4px 0;"><strong>Step ${step.step}:</strong> ${step.title} — ${step.description || ''}</p>`;
      });
      html += '</div>';
    }

    // all days, all stops expanded
    days.forEach((day: any, di: number) => {
      html += `<div style="margin-bottom:20px;">
        <h2 style="font-size:16px;font-weight:bold;margin-bottom:8px;">Day ${day.day || di + 1}: ${day.theme || ''}</h2>`;
      (day.stops || []).forEach((stop: any) => {
        html += `<div style="background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);border-radius:10px;padding:12px;margin-bottom:8px;">
          <p style="font-size:13px;font-weight:bold;">${stop.start_time || ''} — ${stop.name_en || stop.name_ko || ''}</p>
          <p style="font-size:10px;color:rgba(255,255,255,0.4);">Stay: ${stop.stay_min || '?'}min | ${stop.entry_fee_krw > 0 ? formatKRW(stop.entry_fee_krw) : 'Free'}</p>
          ${stop.tip_en ? `<p style="font-size:10px;color:rgba(255,255,255,0.5);margin-top:4px;">${stop.tip_en}</p>` : ''}
          ${stop.recommended_items?.length ? `<p style="font-size:10px;color:rgba(255,255,255,0.4);margin-top:4px;">Recommended: ${stop.recommended_items.map((r: any) => `${r.name}${r.price_krw > 0 ? ` (${formatKRW(r.price_krw)})` : ''}`).join(', ')}</p>` : ''}
        </div>`;
        if (stop.transit_from_prev) {
          html += `<p style="font-size:9px;color:rgba(124,92,252,0.7);margin:2px 0 6px 12px;">${stop.transit_from_prev.method} — ${stop.transit_from_prev.est_min}min${stop.transit_from_prev.est_fare_krw > 0 ? ` (${formatKRW(stop.transit_from_prev.est_fare_krw)})` : ''}</p>`;
        }
      });
      html += '</div>';
    });

    // budget table
    if (budget.length > 0) {
      html += `<div style="margin-bottom:16px;">
        <h3 style="font-size:14px;font-weight:bold;margin-bottom:8px;">Daily Budget Summary</h3>
        <table style="width:100%;font-size:10px;border-collapse:collapse;">
          <tr style="color:rgba(255,255,255,0.3);border-bottom:1px solid rgba(255,255,255,0.08);">
            <th style="text-align:left;padding:4px;">Day</th><th style="text-align:right;padding:4px;">Transport</th><th style="text-align:right;padding:4px;">Entry</th><th style="text-align:right;padding:4px;">Meals</th><th style="text-align:right;padding:4px;">Total</th>
          </tr>`;
      budget.forEach((row: any) => {
        html += `<tr style="border-bottom:1px solid rgba(255,255,255,0.04);">
          <td style="padding:4px;">Day ${row.day}</td>
          <td style="text-align:right;padding:4px;">${formatKRW(row.transport_krw)}</td>
          <td style="text-align:right;padding:4px;">${formatKRW(row.entry_fees_krw)}</td>
          <td style="text-align:right;padding:4px;">${formatKRW(row.meals_krw)}</td>
          <td style="text-align:right;padding:4px;font-weight:bold;color:#7C5CFC;">${formatKRW(row.total_krw)}</td>
        </tr>`;
      });
      html += '</table></div>';
    }

    // departure guide
    if (departure) {
      html += `<div style="background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);border-radius:12px;padding:16px;margin-bottom:16px;">
        <h3 style="font-size:14px;font-weight:bold;margin-bottom:8px;">Departure Guide — ${departure.airport || ''}</h3>`;
      if (departure.to_airport) {
        html += `<p style="font-size:11px;color:rgba(255,255,255,0.6);">${departure.to_airport.method} — ${departure.to_airport.instruction || ''} (${departure.to_airport.duration_min}min, ${formatKRW(departure.to_airport.cost_krw)})</p>`;
      }
      html += '</div>';
    }

    container.innerHTML = html;

    try {
      const html2pdf = (await import('html2pdf.js')).default;
      const titleSlug = (it.tour_title || 'korea-trip').replace(/[^a-zA-Z0-9\s-]/g, '').replace(/\s+/g, '-').slice(0, 40) || 'korea-trip';
      const dateStr = input.startDate || 'undated';
      await html2pdf().set({
        margin: [10, 10, 10, 10],
        filename: `cocotrip-${titleSlug}-${dateStr}.pdf`,
        image: { type: 'jpeg', quality: 0.95 },
        html2canvas: { scale: 2, useCORS: true, logging: false, backgroundColor: '#0a0b14' },
        jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
      } as any).from(container).save();
    } catch (err) {
      console.error('[PDF] generation failed:', err);
    } finally {
      document.body.removeChild(container);
    }
  }, [plan]);

  // ── Loading / Error states ──
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
    <div className="min-h-screen bg-[#0a0b14] text-white">
      <Header language={language} t={t} onLanguageChange={changeLanguage} />
      <main className="max-w-3xl mx-auto px-4 py-8 pt-24">
        <div ref={contentRef} id="plan-detail-content">
          {/* ── Title ── */}
          <div className="text-center mb-8">
            <h1 className="text-2xl sm:text-3xl font-bold bg-clip-text text-transparent" style={{ backgroundImage: 'linear-gradient(135deg,#a78bfa,#ec4899)' }}>
              {it.tour_title || 'Your Korea Itinerary'}
            </h1>
            <p className="text-white/40 text-sm mt-2">
              {input.startDate} | {input.adults ? `${input.adults} adults` : `${input.pax} pax`}
              {input.children > 0 && ` + ${input.children} children`}
              {(plan.pricing?.vehicleLabel || plan.pricing?.vehicle) && ` | ${plan.pricing.vehicleLabel || plan.pricing.vehicle}`}
            </p>
          </div>

          {/* ── Summary stats ── */}
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

          {/* ── Arrival Guide (accordion, default closed) ── */}
          {arrival && <ArrivalGuide guide={arrival} />}

          {/* ── Day Tab Bar ── */}
          {days.length > 1 && (
            <div
              ref={tabBarRef}
              className="flex gap-2 mb-6 overflow-x-auto scrollbar-hide sticky top-16 z-20 bg-[#0a0b14]/95 backdrop-blur-sm py-3 -mx-4 px-4 sm:justify-center"
            >
              {days.map((_: any, i: number) => (
                <button
                  key={i}
                  onClick={() => handleTabSwitch(i)}
                  className={`shrink-0 px-5 py-2.5 rounded-xl text-sm font-bold transition-all duration-200 ${
                    activeDay === i
                      ? 'text-white shadow-lg shadow-[#7C5CFC]/20'
                      : 'bg-white/[0.04] text-white/60 hover:bg-white/[0.08] hover:text-white/80'
                  }`}
                  style={activeDay === i ? { background: 'linear-gradient(135deg,#7C5CFC,#EA537E)' } : undefined}
                >
                  Day {i + 1}
                </button>
              ))}
            </div>
          )}

          {/* ── Active Day Content ── */}
          {days.length > 0 && (
            <div key={fadeKey} className="animate-fadeIn">
              <DayTimeline day={days[activeDay]} dayIndex={activeDay} />
            </div>
          )}

          {/* ── Budget Table (accordion, default closed) ── */}
          {budget.length > 0 && <BudgetTable budget={budget} tMoney={it.t_money_recommended_load} />}

          {/* ── Departure Guide (accordion, default closed) ── */}
          {departure && <DepartureGuide guide={departure} />}
        </div>

        {/* ── Action buttons ── */}
        <div className="mt-8 space-y-3 mb-24">
          <button onClick={handleDownloadPDF} className="w-full py-4 rounded-2xl text-base font-bold text-white flex items-center justify-center gap-2" style={{ background: 'linear-gradient(135deg,#7C5CFC,#EA537E)' }}>
            <Download className="w-5 h-5" /> Download PDF
          </button>
          <a href="https://wa.me/821087140611" target="_blank" rel="noopener noreferrer" className="w-full py-4 rounded-2xl text-base font-bold text-white flex items-center justify-center gap-2 border border-green-500/30 bg-green-500/10 hover:bg-green-500/20 transition-colors">
            <MessageCircle className="w-5 h-5 text-green-400" /> WhatsApp Booking
          </a>
        </div>
      </main>
      <Footer t={t} />
    </div>
  );
}

/* ═══════════════════════════════════════════════════════
   SUB-COMPONENTS
   ═══════════════════════════════════════════════════════ */

function ArrivalGuide({ guide }: { guide: any }) {
  const [open, setOpen] = useState(false);
  return (
    <section className="mb-6">
      <button onClick={() => setOpen(!open)} className="w-full flex items-center justify-between bg-white/[0.04] border border-white/[0.08] rounded-2xl px-5 py-4">
        <div className="flex items-center gap-3">
          <Plane className="w-5 h-5 text-[#7C5CFC]" />
          <div className="text-left">
            <p className="text-sm font-bold">Airport Arrival Guide</p>
            <p className="text-xs text-white/40">{guide.airport}</p>
          </div>
        </div>
        <ChevronDown className={`w-4 h-4 text-white/30 transition-transform duration-300 ${open ? 'rotate-180' : ''}`} />
      </button>
      <div className={`overflow-hidden transition-all duration-300 ease-out ${open ? 'max-h-[2000px] opacity-100 mt-3' : 'max-h-0 opacity-0'}`}>
        <div className="space-y-3 pl-2">
          {(guide.steps || []).map((step: any, i: number) => (
            <div key={i} className="bg-white/[0.03] border border-white/[0.06] rounded-xl p-4">
              <div className="flex items-start gap-3">
                <span className="w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-bold shrink-0" style={{ background: 'linear-gradient(135deg,#7C5CFC,#EA537E)' }}>{step.step}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold">{step.title}</p>
                  <p className="text-xs text-white/50 mt-1">{step.description}</p>
                  {step.est_min > 0 && <p className="text-[10px] text-[#7C5CFC] mt-1">~{step.est_min} min</p>}
                  {step.options && (
                    <div className="mt-2 space-y-1">
                      {step.options.map((opt: any, j: number) => (
                        <div key={j} className="flex items-center justify-between bg-white/[0.04] rounded-lg px-3 py-2">
                          <span className="text-xs text-white/70">{opt.name}</span>
                          <span className="text-xs font-bold text-[#7C5CFC]">{formatKRW(opt.price_krw)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                  {step.transport_to_hotel && (
                    <div className="mt-2 grid grid-cols-2 gap-1.5">
                      {Object.entries(step.transport_to_hotel).map(([key, val]: [string, any]) => (
                        <div key={key} className="bg-white/[0.04] rounded-lg px-3 py-2">
                          <p className="text-[10px] text-white/40 uppercase">{key.replace(/_/g, ' ')}</p>
                          <p className="text-xs font-bold">{formatKRW(val.price_krw || val.est_price_krw)}</p>
                          <p className="text-[10px] text-white/30">{val.duration_min} min</p>
                        </div>
                      ))}
                    </div>
                  )}
                  {step.t_money_recommended_load_krw > 0 && (
                    <div className="mt-2 inline-flex items-center gap-1 bg-[#7C5CFC]/15 rounded-full px-3 py-1">
                      <Wallet className="w-3 h-3 text-[#7C5CFC]" />
                      <span className="text-xs font-bold text-[#7C5CFC]">Load {formatKRW(step.t_money_recommended_load_krw)}</span>
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function DayTimeline({ day, dayIndex }: { day: any; dayIndex: number }) {
  return (
    <section className="mb-8">
      <div className="flex items-center gap-3 mb-4">
        <span className="w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold" style={{ background: 'linear-gradient(135deg,#7C5CFC,#EA537E)' }}>
          {day.day || dayIndex + 1}
        </span>
        <div>
          <p className="text-sm font-bold">{day.theme || `Day ${day.day || dayIndex + 1}`}</p>
          {day.date && <p className="text-[10px] text-white/30">{day.date}</p>}
        </div>
      </div>
      <div className="space-y-1">
        {(day.stops || []).map((stop: any, si: number) => (
          <div key={si}>
            {stop.transit_from_prev && <TransitArrow transit={stop.transit_from_prev} />}
            <StopCard stop={stop} />
          </div>
        ))}
      </div>
    </section>
  );
}

function TransitArrow({ transit }: { transit: any }) {
  const Icon = TRANSIT_ICON[transit.method] || Car;
  const [showSteps, setShowSteps] = useState(false);
  return (
    <div className="ml-4 my-1">
      <button onClick={() => transit.step_by_step?.length && setShowSteps(!showSteps)} className="flex items-center gap-2 text-[11px] text-white/40 hover:text-white/60 transition-colors">
        <div className="w-0.5 h-4 bg-[#7C5CFC]/30" />
        <Icon className="w-3.5 h-3.5 text-[#7C5CFC]" />
        <span>{transit.method} - {transit.est_min}min</span>
        {transit.est_fare_krw > 0 && <span className="text-[#7C5CFC]">{formatKRW(transit.est_fare_krw)}</span>}
        {transit.step_by_step?.length > 0 && <ChevronDown className={`w-3 h-3 transition-transform ${showSteps ? 'rotate-180' : ''}`} />}
      </button>
      {transit.instruction_en && <p className="text-[10px] text-white/25 ml-6 mt-0.5">{transit.instruction_en}</p>}
      {showSteps && transit.step_by_step && (
        <div className="ml-6 mt-1 space-y-0.5">
          {transit.step_by_step.map((s: string, i: number) => (
            <p key={i} className="text-[10px] text-white/35">{i + 1}. {s}</p>
          ))}
        </div>
      )}
    </div>
  );
}

function StopCard({ stop }: { stop: any }) {
  const [expanded, setExpanded] = useState(false);
  const CatIcon = CAT_ICON[stop.category] || MapPin;
  const cardRef = useRef<HTMLDivElement>(null);

  const toggle = () => {
    const next = !expanded;
    setExpanded(next);
    if (next && cardRef.current) {
      setTimeout(() => cardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 50);
    }
  };

  return (
    <div
      ref={cardRef}
      className="bg-white/[0.04] border border-white/[0.08] rounded-xl hover:border-white/[0.15] transition-colors cursor-pointer"
      onClick={toggle}
    >
      {/* ── Collapsed header (always visible) ── */}
      <div className="flex items-center gap-3 p-4">
        <div className="text-center shrink-0">
          <p className="text-xs font-bold text-[#7C5CFC]">{stop.start_time}</p>
          <CatIcon className="w-4 h-4 text-white/30 mx-auto mt-1" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold truncate">{stop.name_en || stop.name_ko}</p>
          <div className="flex items-center gap-3 mt-0.5 text-[10px] text-white/40">
            <span><Clock className="w-3 h-3 inline -mt-0.5" /> {stop.stay_min}min</span>
            {stop.entry_fee_krw > 0 ? <span className="text-yellow-400/70">{formatKRW(stop.entry_fee_krw)}</span> : <span className="text-green-400/70">Free</span>}
          </div>
        </div>
        <ChevronDown className={`w-4 h-4 text-white/20 shrink-0 transition-transform duration-300 ${expanded ? 'rotate-180' : ''}`} />
      </div>

      {/* ── Expanded details ── */}
      <div className={`overflow-hidden transition-all duration-300 ease-out ${expanded ? 'max-h-[800px] opacity-100' : 'max-h-0 opacity-0'}`}>
        <div className="px-4 pb-4 pt-0 border-t border-white/[0.06]" onClick={(e) => e.stopPropagation()}>
          {stop.name_ko && stop.name_en && <p className="text-[10px] text-white/30 mb-2">{stop.name_ko}</p>}
          {stop.tip_en && <p className="text-xs text-white/50 mb-3">{stop.tip_en}</p>}
          {stop.reservation_required && <p className="text-[10px] text-orange-400/70 mb-2">Reservation required</p>}
          {stop.accessibility_note && <p className="text-[10px] text-blue-400/70 mb-2 flex items-center gap-1"><Accessibility className="w-3 h-3" /> {stop.accessibility_note}</p>}
          {stop.recommended_items?.length > 0 && (
            <div className="mb-3">
              <p className="text-[10px] text-white/30 mb-1.5 uppercase tracking-wider">Recommended</p>
              <div className="flex flex-wrap gap-1.5">
                {stop.recommended_items.map((item: any, i: number) => (
                  <span key={i} className="inline-flex items-center gap-1 bg-white/[0.06] rounded-lg px-2.5 py-1 text-[10px]">
                    <span className="text-white/70">{item.name}</span>
                    {item.price_krw > 0 && <span className="text-[#7C5CFC] font-bold">{formatKRW(item.price_krw)}</span>}
                  </span>
                ))}
              </div>
            </div>
          )}
          {stop.naverMapUrl && (
            <a href={stop.naverMapUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-[10px] text-green-400/70 hover:text-green-400">
              <ExternalLink className="w-3 h-3" /> Open in Naver Map
            </a>
          )}
        </div>
      </div>
    </div>
  );
}

function BudgetTable({ budget, tMoney }: { budget: any[]; tMoney: number }) {
  const [open, setOpen] = useState(false);
  return (
    <section className="mb-6">
      <button onClick={() => setOpen(!open)} className="w-full flex items-center justify-between bg-white/[0.04] border border-white/[0.08] rounded-2xl px-5 py-4">
        <div className="flex items-center gap-3">
          <Wallet className="w-5 h-5 text-[#7C5CFC]" />
          <p className="text-sm font-bold">Daily Budget Summary</p>
        </div>
        <ChevronDown className={`w-4 h-4 text-white/30 transition-transform duration-300 ${open ? 'rotate-180' : ''}`} />
      </button>
      <div className={`overflow-hidden transition-all duration-300 ease-out ${open ? 'max-h-[1000px] opacity-100 mt-3' : 'max-h-0 opacity-0'}`}>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-white/30 border-b border-white/[0.08]">
                <th className="text-left py-2 px-2">Day</th>
                <th className="text-right py-2 px-2">Transport</th>
                <th className="text-right py-2 px-2">Entry</th>
                <th className="text-right py-2 px-2">Meals</th>
                <th className="text-right py-2 px-2">Total</th>
              </tr>
            </thead>
            <tbody>
              {budget.map((row: any, i: number) => (
                <tr key={i} className="border-b border-white/[0.04]">
                  <td className="py-2 px-2 font-semibold">Day {row.day}</td>
                  <td className="text-right py-2 px-2 text-white/50">{formatKRW(row.transport_krw)}</td>
                  <td className="text-right py-2 px-2 text-white/50">{formatKRW(row.entry_fees_krw)}</td>
                  <td className="text-right py-2 px-2 text-white/50">{formatKRW(row.meals_krw)}</td>
                  <td className="text-right py-2 px-2 font-bold text-[#7C5CFC]">{formatKRW(row.total_krw)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {tMoney > 0 && (
          <div className="mt-3 bg-[#7C5CFC]/10 border border-[#7C5CFC]/20 rounded-xl px-4 py-3 flex items-center justify-between">
            <span className="text-xs text-white/60">Recommended T-money load</span>
            <span className="text-sm font-bold text-[#7C5CFC]">{formatKRW(tMoney)}</span>
          </div>
        )}
      </div>
    </section>
  );
}

function DepartureGuide({ guide }: { guide: any }) {
  const [open, setOpen] = useState(false);
  return (
    <section className="mb-6">
      <button onClick={() => setOpen(!open)} className="w-full flex items-center justify-between bg-white/[0.04] border border-white/[0.08] rounded-2xl px-5 py-4">
        <div className="flex items-center gap-3">
          <Plane className="w-5 h-5 text-pink-400 rotate-45" />
          <div className="text-left">
            <p className="text-sm font-bold">Departure Guide</p>
            <p className="text-xs text-white/40">{guide.airport}</p>
          </div>
        </div>
        <ChevronDown className={`w-4 h-4 text-white/30 transition-transform duration-300 ${open ? 'rotate-180' : ''}`} />
      </button>
      <div className={`overflow-hidden transition-all duration-300 ease-out ${open ? 'max-h-[1000px] opacity-100 mt-3' : 'max-h-0 opacity-0'}`}>
        <div className="space-y-3 pl-2">
          {guide.to_airport && (
            <div className="bg-white/[0.03] border border-white/[0.06] rounded-xl p-4">
              <p className="text-sm font-semibold mb-1">To Airport</p>
              <p className="text-xs text-white/50">{guide.to_airport.method} - {guide.to_airport.instruction}</p>
              <div className="flex gap-4 mt-2 text-[10px] text-white/40">
                <span>{guide.to_airport.duration_min} min</span>
                <span className="text-[#7C5CFC] font-bold">{formatKRW(guide.to_airport.cost_krw)}</span>
              </div>
            </div>
          )}
          {guide.luggage_storage?.available && (
            <div className="bg-white/[0.03] border border-white/[0.06] rounded-xl p-4">
              <p className="text-sm font-semibold mb-1">Luggage Storage</p>
              <p className="text-xs text-white/50">{guide.luggage_storage.location}</p>
            </div>
          )}
          {guide.tax_refund && (
            <div className="bg-white/[0.03] border border-white/[0.06] rounded-xl p-4">
              <p className="text-sm font-semibold mb-1">Tax Refund</p>
              <p className="text-xs text-white/50">{guide.tax_refund.location}</p>
              <p className="text-[10px] text-[#7C5CFC] mt-1">Min. purchase: {formatKRW(guide.tax_refund.threshold_krw)}</p>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
