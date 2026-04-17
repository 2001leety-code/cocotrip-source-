import { useEffect, useState, useRef, useCallback } from 'react';
import { useParams, useSearchParams, Link } from 'react-router-dom';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuth } from '@/hooks/useAuth';
import { useLanguage } from '@/hooks/useLanguage';
import { useIsMobile } from '@/hooks/use-mobile';
import {
  MapPin, Clock, Calendar, Users, ChevronDown,
  Download, MessageCircle, Plane, Train, Bus, Car, Footprints,
  Landmark, UtensilsCrossed, ShoppingBag, Camera, Music2, Mountain,
  CreditCard, Wallet, ExternalLink, AlertCircle, Accessibility, Phone,
  RefreshCw, Sparkles,
} from 'lucide-react';
import { Header } from '@/sections/Header';
import { Footer } from '@/sections/Footer';
import { buildAccommodationLinks, buildFlightLink, buildCarLink, PICKUP_PRICES } from '@/config/affiliateLinks';
import { detectCharterRecommendation } from '@/data/charterPricing';
import { getCurrentSeason, SEASONAL_SPOTS } from '@/data/seasonalSpots';

/* ?�═?�═?�═?�═?�═?�═?�═?�═?�═?�═?�═?�═?�═?�═?�═?�═?�═?�═?�═?�═?�═?�═?�═?�═?�═?�═?�═??
   CONSTANTS
   ?�═?�═?�═?�═?�═?�═?�═?�═?�═?�═?�═?�═?�═?�═?�═?�═?�═?�═?�═?�═?�═?�═?�═?�═?�═?�═?�═??*/

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

/* ?�═?�═?�═?�═?�═?�═?�═?�═?�═?�═?�═?�═?�═?�═?�═?�═?�═?�═?�═?�═?�═?�═?�═?�═?�═?�═?�═??
   MAIN COMPONENT
   ?�═?�═?�═?�═?�═?�═?�═?�═?�═?�═?�═?�═?�═?�═?�═?�═?�═?�═?�═?�═?�═?�═?�═?�═?�═?�═?�═??*/

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

  // ?�?� Firestore listener ?�?�
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

  // ?�?� URL hash sync ??restore active day on load ?�?�
  useEffect(() => {
    const hash = window.location.hash;
    const match = hash.match(/^#day-(\d+)$/);
    if (match) {
      const idx = parseInt(match[1], 10) - 1;
      if (idx >= 0) setActiveDay(idx);
    }
  }, []);

  // ── Auto-translate plan when header language changes ──
  const originalItineraryRef = useRef<any>(null);
  const [isTranslating, setIsTranslating] = useState(false);
  useEffect(() => {
    if (!plan?.itinerary) return;
    // Store original itinerary on first load (never overwrite)
    if (!originalItineraryRef.current) {
      originalItineraryRef.current = JSON.parse(JSON.stringify(plan.itinerary));
    }
    const targetLang = language as string;
    // The plan's original language — restore when user switches back
    const originalLang = plan.input?.language || 'en';
    if (targetLang === originalLang) {
      // Restore original without API call
      if (originalItineraryRef.current) {
        setPlan((prev: any) => prev ? { ...prev, itinerary: originalItineraryRef.current } : prev);
      }
      return;
    }
    // Translate to target language
    const controller = new AbortController();
    setIsTranslating(true);
    (async () => {
      try {
        const resp = await fetch('/api/translate-plan', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ plan: originalItineraryRef.current || plan.itinerary, targetLang }),
          signal: controller.signal,
        });
        const data = await resp.json();
        if (data.translated) {
          setPlan((prev: any) => prev ? { ...prev, itinerary: data.translated } : prev);
        }
      } catch (e: any) {
        if (e.name !== 'AbortError') console.error('[translate] failed:', e);
      } finally {
        setIsTranslating(false);
      }
    })();
    return () => { controller.abort(); setIsTranslating(false); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [language]);

  // ?�?� Tab switch handler ?�?�
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

  // ?�?� PDF download ??light theme for reliable rendering ?�?�
  const [isPdfGenerating, setIsPdfGenerating] = useState(false);
  const handleDownloadPDF = useCallback(async () => {
    if (!plan) return;
    setIsPdfGenerating(true);
    const it = plan.itinerary || {};
    const days = it.days || [];
    const arrival = it.arrival_guide;
    const departure = it.departure_guide;
    const budget = it.daily_budget_summary || [];
    const input = plan.input || {};

    // create render container — MUST be on-screen & fully expanded for html2canvas
    // Overlay (z-index:99998) sits on top to hide the white container from the user
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;z-index:99998;background:#0a0e1a;display:flex;align-items:center;justify-content:center;color:white;font-size:18px;font-family:system-ui;';
    overlay.innerHTML = '<div style="text-align:center"><div style="width:40px;height:40px;border:3px solid #7C5CFC;border-top-color:transparent;border-radius:50%;animation:spin 1s linear infinite;margin:0 auto 16px"></div>Generating PDF...</div><style>@keyframes spin{to{transform:rotate(360deg)}}</style>';
    document.body.appendChild(overlay);

    const container = document.createElement('div');
    // position:absolute (not fixed) so container can expand beyond viewport height
    // left:0 (not -9999px) so html2canvas can actually render the content
    container.style.cssText = 'position:absolute;top:0;left:0;width:800px;background:#ffffff;color:#1a1a2e;padding:40px;font-family:"Segoe UI",system-ui,sans-serif;line-height:1.6;z-index:99997;';
    document.body.appendChild(container);

    // Color tokens for light PDF
    const C = {
      heading: '#1a1a2e',
      sub: '#555',
      muted: '#888',
      accent: '#7C5CFC',
      pink: '#EA537E',
      border: '#e0e0e0',
      cardBg: '#f8f9fc',
      transitBg: '#f0edff',
      budgetHead: '#7C5CFC',
    };

    // ?�?� Title
    let html = `<div style="text-align:center;margin-bottom:28px;padding-bottom:20px;border-bottom:2px solid ${C.accent};">
      <h1 style="font-size:26px;font-weight:800;color:${C.accent};margin:0 0 6px;">${it.tour_title || 'Your Korea Itinerary'}</h1>
      <p style="color:${C.muted};font-size:13px;margin:0;">
        ${input.startDate || ''} | ${input.adults ? `${input.adults} adults` : `${input.pax || '-'} pax`}
        ${it.t_money_recommended_load ? ` | T-money: ${formatKRW(it.t_money_recommended_load)}` : ''}
      </p>
      <p style="color:${C.muted};font-size:10px;margin:4px 0 0;">Generated by CocoTrip AI ??cocotripkr.com</p>
    </div>`;

    // ?�?� Arrival Guide
    if (arrival) {
      html += `<div style="background:${C.cardBg};border:1px solid ${C.border};border-radius:10px;padding:16px;margin-bottom:16px;">
        <h3 style="font-size:15px;font-weight:700;color:${C.heading};margin:0 0 10px;">?�️ Airport Arrival Guide ??${arrival.airport || ''}</h3>`;
      (arrival.steps || []).forEach((step: any) => {
        html += `<div style="margin:6px 0;padding:6px 0;border-bottom:1px solid ${C.border};">
          <p style="font-size:12px;color:${C.heading};margin:0;"><strong>Step ${step.step}: ${step.title}</strong></p>
          <p style="font-size:11px;color:${C.sub};margin:2px 0 0;">${step.description || ''}</p>
          ${step.est_min > 0 ? `<p style="font-size:10px;color:${C.accent};margin:2px 0 0;">~${step.est_min} min</p>` : ''}
        </div>`;
      });
      html += '</div>';
    }

    // ?�?� All days
    days.forEach((day: any, di: number) => {
      html += `<div style="margin-bottom:24px;page-break-inside:avoid;">
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:12px;">
          <div style="width:32px;height:32px;border-radius:50%;background:${C.accent};color:white;display:flex;align-items:center;justify-content:center;font-size:14px;font-weight:700;">${day.day || di + 1}</div>
          <div>
            <h2 style="font-size:16px;font-weight:700;color:${C.heading};margin:0;">${day.theme || `Day ${day.day || di + 1}`}</h2>
            ${day.date ? `<p style="font-size:10px;color:${C.muted};margin:0;">${day.date}</p>` : ''}
          </div>
        </div>`;

      (day.stops || []).forEach((stop: any) => {
        // Transit arrow
        if (stop.transit_from_prev) {
          const t = stop.transit_from_prev;
          html += `<div style="margin:4px 0 6px 16px;padding:6px 12px;background:${C.transitBg};border-left:3px solid ${C.accent};border-radius:4px;">
            <p style="font-size:10px;color:${C.accent};font-weight:700;margin:0;">?�� ${t.method} ??${t.est_min || '?'}min${t.est_fare_krw > 0 ? ` (${formatKRW(t.est_fare_krw)})` : ''}${t.source === 'odsay' ? ' [?�시�?' : ''}</p>
            ${t.step_by_step?.length ? t.step_by_step.map((s: string) => `<p style="font-size:9px;color:${C.sub};margin:1px 0 0 10px;">· ${s}</p>`).join('') : ''}
          </div>`;
        }

        // Stop card
        html += `<div style="background:${C.cardBg};border:1px solid ${C.border};border-radius:8px;padding:12px;margin-bottom:6px;">
          <div style="display:flex;justify-content:space-between;align-items:flex-start;">
            <div>
              <p style="font-size:13px;font-weight:700;color:${C.heading};margin:0;"><span style="color:${C.accent};font-size:12px;">${stop.start_time || ''}</span> ??${stop.display_name || stop.name_en || stop.name || stop.name_ko || ''}</p>
              ${(stop.name || stop.name_ko) && (stop.display_name || stop.name_en) && (stop.name || stop.name_ko) !== (stop.display_name || stop.name_en) ? `<p style="font-size:10px;color:${C.muted};margin:2px 0 0;">${stop.name || stop.name_ko}</p>` : ''}
            </div>
            <span style="font-size:10px;color:${stop.entry_fee_krw > 0 ? C.pink : '#22c55e'};font-weight:600;">${stop.entry_fee_krw > 0 ? formatKRW(stop.entry_fee_krw) : 'Free'}</span>
          </div>
          <p style="font-size:10px;color:${C.muted};margin:4px 0 0;">??${stop.stay_min || '?'}min${stop.address ? ` | ?�� ${stop.address}` : ''}</p>
          ${stop.naverMapUrl ? `<p style="font-size:10px;margin:3px 0 0;"><a href="${stop.naverMapUrl}" style="color:${C.accent};text-decoration:underline;">?�� Open in Naver Map</a></p>` : ''}
          ${(stop.tip || stop.tip_en) ? `<p style="font-size:10px;color:${C.sub};margin:4px 0 0;font-style:italic;">?�� ${stop.tip || stop.tip_en}</p>` : ''}
          ${stop.reservation_required ? `<p style="font-size:10px;color:#f97316;margin:4px 0 0;">?�️ Reservation required${stop.reservation_phone ? ` ??${stop.reservation_phone}` : ''}</p>` : ''}
          ${stop.recommended_items?.length ? `<p style="font-size:10px;color:${C.sub};margin:4px 0 0;">?�� ${stop.recommended_items.map((r: any) => `${r.name}${r.price_krw > 0 ? ` (${formatKRW(r.price_krw)})` : ''}`).join(', ')}</p>` : ''}
        </div>`;
      });
      html += '</div>';
    });

    // ?�?� Budget table
    if (budget.length > 0) {
      html += `<div style="margin-bottom:20px;page-break-inside:avoid;">
        <h3 style="font-size:15px;font-weight:700;color:${C.heading};margin:0 0 10px;">?�� Daily Budget Summary</h3>
        <table style="width:100%;font-size:11px;border-collapse:collapse;border:1px solid ${C.border};">
          <tr style="background:${C.accent};color:white;">
            <th style="text-align:left;padding:8px;">Day</th><th style="text-align:right;padding:8px;">Transport</th><th style="text-align:right;padding:8px;">Entry</th><th style="text-align:right;padding:8px;">Meals</th><th style="text-align:right;padding:8px;">Total</th>
          </tr>`;
      budget.forEach((row: any, i: number) => {
        html += `<tr style="background:${i % 2 === 0 ? '#fff' : C.cardBg};border-bottom:1px solid ${C.border};">
          <td style="padding:6px 8px;font-weight:600;">Day ${row.day}</td>
          <td style="text-align:right;padding:6px 8px;">${formatKRW(row.transport_krw)}</td>
          <td style="text-align:right;padding:6px 8px;">${formatKRW(row.entry_fees_krw)}</td>
          <td style="text-align:right;padding:6px 8px;">${formatKRW(row.meals_krw)}</td>
          <td style="text-align:right;padding:6px 8px;font-weight:700;color:${C.accent};">${formatKRW(row.total_krw)}</td>
        </tr>`;
      });
      const grandTotal = budget.reduce((s: number, r: any) => s + (r.total_krw || 0), 0);
      html += `<tr style="background:${C.accent};color:white;font-weight:700;">
        <td style="padding:8px;" colspan="4">Total</td>
        <td style="text-align:right;padding:8px;">${formatKRW(grandTotal)}</td>
      </tr>`;
      html += '</table></div>';
    }

    // ?�?� Departure Guide
    if (departure) {
      html += `<div style="background:${C.cardBg};border:1px solid ${C.border};border-radius:10px;padding:16px;margin-bottom:16px;">
        <h3 style="font-size:15px;font-weight:700;color:${C.heading};margin:0 0 10px;">?�� Departure Guide ??${departure.airport || ''}</h3>`;
      if (departure.to_airport) {
        html += `<p style="font-size:11px;color:${C.sub};margin:0;">${departure.to_airport.method} ??${departure.to_airport.instruction || ''} (${departure.to_airport.duration_min || '?'}min, ${formatKRW(departure.to_airport.cost_krw || 0)})</p>`;
      }
      if (departure.tax_refund) {
        html += `<p style="font-size:10px;color:${C.sub};margin:6px 0 0;">?�� Tax Refund: ${departure.tax_refund.location || ''} (Min. ${formatKRW(departure.tax_refund.threshold_krw || 30000)})</p>`;
      }
      if (departure.last_minute_shopping) {
        html += `<p style="font-size:10px;color:${C.sub};margin:6px 0 0;">?���?${departure.last_minute_shopping}</p>`;
      }
      html += '</div>';
    }

    // ?�?� Footer
    html += `<div style="text-align:center;border-top:1px solid ${C.border};padding-top:16px;margin-top:20px;">
      <p style="font-size:11px;color:${C.muted};margin:0;">?�� WhatsApp: +82-10-8714-0611 | ?�� cocotripkr.com</p>
      <p style="font-size:9px;color:#bbb;margin:4px 0 0;">© CocoTrip ??Korea Private Tour Specialist</p>
    </div>`;

    container.innerHTML = html;

    // Wait for browser to fully render the content (especially Korean fonts)
    // document.fonts.ready resolves when all font faces are loaded
    await Promise.race([
      document.fonts?.ready || Promise.resolve(),
      new Promise(resolve => setTimeout(resolve, 3000)),
    ]);
    // Additional settle time for layout recalculation
    await new Promise(resolve => setTimeout(resolve, 500));
    container.offsetHeight; // force reflow

    try {
      const html2pdf = (await import('html2pdf.js')).default;
      const titleSlug = (it.tour_title || 'korea-trip').replace(/[^a-zA-Z0-9\s-]/g, '').replace(/\s+/g, '-').slice(0, 40) || 'korea-trip';
      const dateStr = input.startDate || 'undated';
      const filename = `cocotrip-${titleSlug}-${dateStr}.pdf`;

      const worker = html2pdf().set({
        margin: [8, 8, 8, 8],
        filename,
        image: { type: 'jpeg', quality: 0.98 },
        html2canvas: { scale: 1.5, useCORS: true, logging: false, backgroundColor: '#ffffff', windowWidth: 800, scrollX: 0, scrollY: 0 },
        jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
        pagebreak: { mode: ['avoid-all', 'css', 'legacy'] },
      } as any).from(container);

      // iOS Safari: direct .save() often blocked ??open blob in new tab
      if (/iPhone|iPad|iPod/i.test(navigator.userAgent)) {
        const pdf = await worker.outputPdf('blob');
        const url = URL.createObjectURL(pdf);
        window.open(url, '_blank');
        setTimeout(() => URL.revokeObjectURL(url), 60000);
      } else {
        await worker.save();
      }
    } catch (err) {
      console.error('[PDF] generation failed:', err);
      alert('PDF generation failed. Please try again or contact us via WhatsApp.');
    } finally {
      document.body.removeChild(container);
      document.body.removeChild(overlay);
      setIsPdfGenerating(false);
    }
  }, [plan]);

  // ?�?� Loading / Error states ?�?�
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
          {/* ?�?� Title ?�?� */}
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

          {/* ?�?� Summary stats ?�?� */}
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

          {/* ?�?� Arrival Guide (accordion, default closed) ?�?� */}
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
                      {lk.label} &rarr;
                    </a>
                  ))}
                </div>
                <p className="text-[10px] text-white/20 text-center pb-3 px-5">Affiliate link &mdash; helps support CocoTrip.</p>
              </div>
            );
          })()}

          {/* ?�?� Day Tab Bar ?�?� */}
          {days.length > 1 && (
            <div
              ref={tabBarRef}
              className={`flex gap-2 mb-6 overflow-x-auto scrollbar-hide sticky top-16 z-20 backdrop-blur-sm py-3 -mx-4 px-4 sm:justify-center ${isMobile ? 'bg-[#0a0412]/95' : 'bg-[#0a0b14]/95'}`}
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

          {/* ?�?� Active Day Content ?�?� */}
          {days.length > 0 && (
            <div key={fadeKey} className="animate-fadeIn">
              <DayTimeline day={days[activeDay]} dayIndex={activeDay} />
            </div>
          )}

          {/* ?�?� Budget Table (accordion, default closed) ?�?� */}
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
                        <p className="text-xs text-cyan-300/70 mt-0.5">Skip public transit &mdash; ride in comfort</p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-lg font-bold text-cyan-300">&#8361;{pricing.priceKRW.toLocaleString()}</p>
                      <p className="text-xs text-white/40">{pricing.hours}hrs</p>
                    </div>
                  </div>
                </div>
                <div className="px-5 py-4">
                  <div className="flex flex-wrap gap-2 mb-4">
                    {['English driver', 'Door-to-door', 'Free WiFi', 'Luggage space'].map(f => (
                      <span key={f} className="text-[11px] text-cyan-200/70 bg-cyan-500/10 border border-cyan-500/20 px-2.5 py-1 rounded-full">&check; {f}</span>
                    ))}
                  </div>
                  <a href="https://wa.me/821087140611" target="_blank" rel="noopener noreferrer"
                    className="block w-full py-3.5 rounded-xl text-center text-sm font-bold text-white transition-all hover:opacity-90"
                    style={{ background: 'linear-gradient(135deg, #06b6d4, #3b82f6)', boxShadow: '0 4px 20px rgba(6,182,212,0.3)' }}>
                    Book via WhatsApp &rarr;
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
                  Book Airport Pickup &rarr;
                </a>
              </div>
            );
          })()}
        </div>

        {/* ═══ Seasonal Spots Banner ═══ */}
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
                      <p className="text-sm font-bold text-white">{{ ko: spot.name, en: spot.nameEn, ja: spot.nameEn, zh: spot.nameEn }[language] ?? spot.nameEn}</p>
                      <p className="text-[10px] text-white/40 mt-0.5">{{ ko: spot.location, en: spot.locationEn, ja: spot.locationEn, zh: spot.locationEn }[language] ?? spot.locationEn} · {{ ko: spot.period, en: spot.periodEn, ja: spot.periodEn, zh: spot.periodEn }[language] ?? spot.periodEn}</p>
                      <p className="text-xs text-white/60 mt-1">{{ ko: spot.tip, en: spot.tipEn, ja: spot.tipEn, zh: spot.tipEn }[language] ?? spot.tipEn}</p>
                    </div>
                  ))}
                </div>
                <p className="text-[10px] text-white/30 text-center mt-3">{sd.urgency[lk]}</p>
              </div>
            </div>
          );
        })()}

        {/* Revision / Regenerate Card */}
        {plan && (plan.revisionCredits ?? 0) > 0 && !_isRegenerating && (
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
                ?�� {plan.revisionCredits} Free Revision{plan.revisionCredits > 1 ? 's' : ''} remaining
              </p>
              <button
                onClick={() => {
                  // Navigate to planner with pre-filled input for regeneration
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

        {/* ?�?� Regeneration in progress ?�?� */}
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

        {/* ?�?� Action buttons ?�?� */}
        <div className="mt-8 space-y-3">
          <button onClick={handleDownloadPDF} disabled={isPdfGenerating} className="w-full py-4 rounded-2xl text-base font-bold text-white flex items-center justify-center gap-2 disabled:opacity-60" style={{ background: isMobile ? 'linear-gradient(135deg,#B668FC,#FF6B9D)' : 'linear-gradient(135deg,#7C5CFC,#EA537E)' }}>
            {isPdfGenerating ? (
              <><div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" /> Generating PDF...</>
            ) : (
              <><Download className="w-5 h-5" /> Download PDF</>
            )}
          </button>
          <a href="https://wa.me/821087140611" target="_blank" rel="noopener noreferrer" className="w-full py-4 rounded-2xl text-base font-bold text-white flex items-center justify-center gap-2 border border-green-500/30 bg-green-500/10 hover:bg-green-500/20 transition-colors">
            <MessageCircle className="w-5 h-5 text-green-400" /> WhatsApp Booking
          </a>
        </div>

        {/* ?�?� eSIM 추천 ?�?� */}
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
              Airalo ??
            </a>
            <a href="https://yesim.app/" target="_blank" rel="noopener noreferrer"
              className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-bold text-white transition-all hover:opacity-90 hover:scale-[1.02] active:scale-95"
              style={{ background: '#4CAF50', boxShadow: '0 4px 16px rgba(76,175,80,0.25)' }}>
              Yesim ??
            </a>
          </div>
          <p className="text-[10px] text-white/20 text-center pb-3 px-5">{t.planner?.esimNote || 'Purchasing via these links helps support CocoTrip.'}</p>
        </div>

        {/* ═══ Trip.com Car Rental ═══ */}
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
                  <p className="text-xs text-white/50 mt-0.5">Explore at your own pace — international license accepted</p>
                </div>
              </div>
              <div className="px-5 pb-4">
                <a href={carLink.url} target="_blank" rel="noopener noreferrer"
                  className="w-full flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-bold text-white transition-all hover:opacity-90 hover:scale-[1.02]"
                  style={{ background: '#0073E6', boxShadow: '0 4px 16px rgba(0,115,230,0.25)' }}>
                  {carLink.label} →
                </a>
              </div>
              <p className="text-[10px] text-white/20 text-center pb-3 px-5">Affiliate link — helps support CocoTrip.</p>
            </div>
          );
        })()}

        {/* ═══ Trip.com Flight Search ═══ */}
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
                  {link.label} →
                </a>
              </div>
              <p className="text-[10px] text-white/20 text-center pb-3 px-5">Affiliate link — helps support CocoTrip.</p>
            </div>
          );
        })()}

        <div className="mb-24" />
      </main>
      <Footer t={t} />
    </div>
  );
}

/* ?�═?�═?�═?�═?�═?�═?�═?�═?�═?�═?�═?�═?�═?�═?�═?�═?�═?�═?�═?�═?�═?�═?�═?�═?�═?�═?�═??
   SUB-COMPONENTS
   ?�═?�═?�═?�═?�═?�═?�═?�═?�═?�═?�═?�═?�═?�═?�═?�═?�═?�═?�═?�═?�═?�═?�═?�═?�═?�═?�═??*/

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
                      {Object.entries(step.transport_to_hotel).filter(([, val]) => val != null).map(([key, val]: [string, any]) => (
                        <div key={key} className="bg-white/[0.04] rounded-lg px-3 py-2">
                          <p className="text-[10px] text-white/40 uppercase">{key.replace(/_/g, ' ')}</p>
                          <p className="text-xs font-bold">{formatKRW(val?.price_krw || val?.est_price_krw || 0)}</p>
                          <p className="text-[10px] text-white/30">{val?.duration_min || '?'} min</p>
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
        {transit.from_label && <span className="text-[#7C5CFC] font-semibold">{transit.from_label} →</span>}
        <span>{transit.method} - {transit.est_min}min</span>
        {transit.est_fare_krw > 0 && <span className="text-[#7C5CFC]">{formatKRW(transit.est_fare_krw)}</span>}
        {transit.step_by_step?.length > 0 && <ChevronDown className={`w-3 h-3 transition-transform ${showSteps ? 'rotate-180' : ''}`} />}
      </button>
      {(transit.instruction_en || transit.instruction) && <p className="text-[10px] text-white/25 ml-6 mt-0.5">{transit.instruction_en || transit.instruction}</p>}
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
  const [expanded, setExpanded] = useState(true);
  const CatIcon = CAT_ICON[stop.category] || MapPin;
  const cardRef = useRef<HTMLDivElement>(null);

  const toggle = () => {
    const next = !expanded;
    setExpanded(next);
    if (next && cardRef.current) {
      setTimeout(() => cardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 50);
    }
  };

  // ODsay ?�중교???�이??추출
  const publicTransit = stop.travelFromPrev?.transitOptions?.publicTransit;

  return (
    <div
      ref={cardRef}
      className="bg-white/[0.04] border border-white/[0.08] rounded-xl hover:border-white/[0.15] transition-colors cursor-pointer"
      onClick={toggle}
    >
      {/* ?�?� Collapsed header (always visible) ?�?� */}
      <div className="flex items-center gap-3 p-4">
        <div className="text-center shrink-0">
          <p className="text-xs font-bold text-[#7C5CFC]">{stop.start_time}</p>
          <CatIcon className="w-4 h-4 text-white/30 mx-auto mt-1" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <p className="text-sm font-bold truncate">{stop.display_name || stop.name_en || stop.name || stop.name_ko}</p>
            {stop.local_tag && (() => {
              const tagConfig: Record<string, { bg: string; text: string; emoji: string }> = {
                'Local Pick': { bg: 'bg-purple-500/20 border-purple-500/30', text: 'text-purple-300', emoji: '📍' },
                'Hidden Gem': { bg: 'bg-emerald-500/20 border-emerald-500/30', text: 'text-emerald-300', emoji: '💎' },
                'Bakery Pilgrimage': { bg: 'bg-amber-500/20 border-amber-500/30', text: 'text-amber-300', emoji: '🥐' },
                'Blue Ribbon': { bg: 'bg-blue-500/20 border-blue-500/30', text: 'text-blue-300', emoji: '🏅' },
              };
              const cfg = tagConfig[stop.local_tag] || { bg: 'bg-white/10 border-white/20', text: 'text-white/60', emoji: '⭐' };
              return <span className={`shrink-0 inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[9px] font-bold border ${cfg.bg} ${cfg.text}`}>{cfg.emoji} {stop.local_tag}</span>;
            })()}
          </div>
          <div className="flex items-center gap-3 mt-0.5 text-[10px] text-white/40">
            <span><Clock className="w-3 h-3 inline -mt-0.5" /> {stop.stay_min}min</span>
            {stop.entry_fee_krw > 0 ? <span className="text-yellow-400/70">{formatKRW(stop.entry_fee_krw)}</span> : <span className="text-green-400/70">Free</span>}
          </div>
        </div>
        <ChevronDown className={`w-4 h-4 text-white/20 shrink-0 transition-transform duration-300 ${expanded ? 'rotate-180' : ''}`} />
      </div>

      {/* ?�?� Expanded details ?�?� */}
      <div className={`overflow-hidden transition-all duration-300 ease-out ${expanded ? 'max-h-[800px] opacity-100' : 'max-h-0 opacity-0'}`}>
        <div className="px-4 pb-4 pt-3 border-t border-white/[0.06] space-y-3" onClick={(e) => e.stopPropagation()}>
          {(stop.name || stop.name_ko) && (stop.display_name || stop.name_en) && (stop.name || stop.name_ko) !== (stop.display_name || stop.name_en) && <p className="text-[10px] text-white/30">{stop.name || stop.name_ko}</p>}
          {stop.address && (
            <p className="text-[11px] text-white/40 flex items-center gap-1.5">
              <MapPin className="w-3 h-3 shrink-0 text-white/25" />
              {stop.address}
            </p>
          )}
          {(stop.tip || stop.tip_en) && <p className="text-xs text-white/60 leading-relaxed">{stop.tip || stop.tip_en}</p>}
          {stop.entry_fee_note && <p className="text-[10px] text-yellow-400/60">{stop.entry_fee_note}</p>}

          {/* Reservation info */}
          {stop.reservation_required && (
            <div className="bg-orange-500/10 border border-orange-500/20 rounded-lg px-3 py-2">
              <p className="text-[11px] text-orange-400/80 font-semibold">Reservation required</p>
              {stop.reservation_note && <p className="text-[10px] text-orange-400/60 mt-0.5">{stop.reservation_note}</p>}
              <div className="flex gap-3 mt-1">
                {stop.reservation_phone && (
                  <a href={`tel:${stop.reservation_phone}`} className="text-[10px] text-orange-400/70 underline">{stop.reservation_phone}</a>
                )}
                {stop.reservation_url && (
                  <a href={stop.reservation_url} target="_blank" rel="noopener noreferrer" className="text-[10px] text-orange-400/70 underline flex items-center gap-0.5">
                    <ExternalLink className="w-2.5 h-2.5" /> Book online
                  </a>
                )}
              </div>
            </div>
          )}

          {stop.accessibility_note && (
            <p className="text-[10px] text-blue-400/70 flex items-center gap-1">
              <Accessibility className="w-3 h-3" /> {stop.accessibility_note}
            </p>
          )}

          {/* Recommended items */}
          {stop.recommended_items?.length > 0 && (
            <div>
              <p className="text-[10px] text-white/30 mb-1.5 uppercase tracking-wider">Recommended</p>
              <div className="space-y-1">
                {stop.recommended_items.map((item: any, i: number) => (
                  <div key={i} className="flex items-center justify-between bg-white/[0.04] rounded-lg px-3 py-2">
                    <div className="flex-1 min-w-0">
                      <span className="text-[11px] text-white/70">{item.name}</span>
                      {item.note && <span className="text-[9px] text-white/30 ml-1.5">??{item.note}</span>}
                    </div>
                    {item.price_krw > 0 && <span className="text-[11px] text-[#7C5CFC] font-bold shrink-0 ml-2">{formatKRW(item.price_krw)}</span>}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ?�?� ODsay ?�중교??경로 (Real Transit Data) ?�?� */}
          {publicTransit && publicTransit.method !== 'walk' && (
            <div className="bg-blue-500/8 border border-blue-500/15 rounded-xl p-3">
              <div className="flex items-center gap-2 mb-2">
                <Train className="w-3.5 h-3.5 text-blue-400" />
                <p className="text-[11px] font-bold text-blue-400">Public Transit Route</p>
                <span className="ml-auto text-[10px] text-white/40">{publicTransit.duration}min · {formatKRW(publicTransit.fare)}</span>
              </div>
              {publicTransit.steps?.length > 0 && (
                <div className="space-y-1">
                  {publicTransit.steps.map((step: any, i: number) => (
                    <div key={i} className="flex items-center gap-2 text-[10px]">
                      {step.mode === 'subway' && <Train className="w-3 h-3 text-blue-400/70 shrink-0" />}
                      {step.mode === 'bus' && <Bus className="w-3 h-3 text-green-400/70 shrink-0" />}
                      {step.mode === 'walk' && <Footprints className="w-3 h-3 text-white/30 shrink-0" />}
                      <span className={step.mode === 'walk' ? 'text-white/30' : 'text-white/60'}>{step.description}</span>
                    </div>
                  ))}
                </div>
              )}
              {publicTransit.transfers > 0 && (
                <p className="text-[9px] text-white/25 mt-1.5">Transfers: {publicTransit.transfers}</p>
              )}
            </div>
          )}

          {/* Naver Map link ??coordinate-based URL preferred for accuracy */}
          {(() => {
            // 1. RouteAgent가 ?�공??좌표 기반 URL ?�선 (가???�확)
            if (stop.naverMapUrl) {
              return (
                <a href={stop.naverMapUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-[11px] text-green-400/70 hover:text-green-400 bg-green-500/10 rounded-lg px-3 py-2">
                  <ExternalLink className="w-3 h-3" /> Open in Naver Map
                </a>
              );
            }
            // 2. lat/lng 좌표가 ?�으�?좌표 기반 URL ?�성
            if (stop.lat && stop.lng) {
              const coordUrl = `https://map.naver.com/v5/search/${encodeURIComponent(stop.name || stop.name_ko || stop.display_name || stop.name_en || '')}?c=${stop.lng},${stop.lat},15,0,0,0,dh`;
              return (
                <a href={coordUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-[11px] text-green-400/70 hover:text-green-400 bg-green-500/10 rounded-lg px-3 py-2">
                  <ExternalLink className="w-3 h-3" /> Open in Naver Map
                </a>
              );
            }
            // 3. Fallback: ?�소�?+ ??�??�름?�로 검??(?�확???�상)
            const nameKo = (stop.name || stop.name_ko || '').replace(/\s*\(.*\)\s*/g, '').trim();
            // 주소?�서 �???추출 (e.g. "?�울?�별??종로�??�직�?161" ??"종로�?)
            const addrMatch = (stop.address || '').match(/([\uAC00-\uD7A3]+\uAD6C)/); 
            const district = addrMatch ? addrMatch[1] : '';
            const searchQuery = district ? `${district} ${nameKo}` : (nameKo || stop.display_name || stop.name_en || '');
            const mapUrl = `https://map.naver.com/v5/search/${encodeURIComponent(searchQuery)}`;
            return (
              <a href={mapUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-[11px] text-green-400/70 hover:text-green-400 bg-green-500/10 rounded-lg px-3 py-2">
                <ExternalLink className="w-3 h-3" /> Open in Naver Map
              </a>
            );
          })()}
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
          {guide.last_minute_shopping && (
            <div className="bg-white/[0.03] border border-white/[0.06] rounded-xl p-4">
              <p className="text-sm font-semibold mb-1">?���?Last-Minute Shopping</p>
              <p className="text-xs text-white/50">{guide.last_minute_shopping}</p>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
