import { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { useLanguage } from '@/hooks/useLanguage';
import { collection, query, where, getDocs } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import {
  Car, Sparkles, Music2, Wand2, ChevronRight, Star,
  ArrowRight, Clock, Users, Shield, Crown, Gift,
  CloudSun, Thermometer, Timer, FileText, ShieldCheck,
} from 'lucide-react';
import { haptic } from '@/lib/haptic';
import { TOURS, getTourPriceKRW } from '@/data/tours';
import { formatPrice } from '@/lib/exchange-rate';
import type { Translations } from '@/i18n';

interface MobileHomeProps {
  t: Translations;
}

export function MobileHome({ t: _t }: MobileHomeProps) {
  const { user } = useAuth();
  const { language } = useLanguage();
  const [nextTrip, setNextTrip] = useState<{ title: string; dday: number; date: string } | null>(null);
  const [weather, setWeather] = useState<{ temp: string; desc: string; icon: string } | null>(null);

  const m = _t.mobileHome || {};

  // 정제 퍼플·핑크 디자인 (운영자 2026-06-01 채택). 플래그 OFF = 현재와 byte-identical.
  // 활성: Vercel env VITE_FEATURE_REFINED_UI=true, 또는 ?refined 쿼리(검증용).
  const REFINED = import.meta.env.VITE_FEATURE_REFINED_UI === 'true'
    || (typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('refined'));

  // Tour marquee — show 8 featured tours (alternating regions for visual variety).
  // Memoized to keep the duplicated array stable across rerenders so the CSS
  // animation doesn't reset every time React rerenders the parent.
  const featuredTours = TOURS.slice(0, 8);
  // Duplicate the list so the css translateX(-50%) loop is seamless.
  const marqueeItems = [...featuredTours, ...featuredTours];
  const [marqueePaused, setMarqueePaused] = useState(false);
  const marqueeRef = useRef<HTMLDivElement | null>(null);
  // 사용자 언어 기반 자동 환산. ko 는 KRW 만원 단위 축약 유지 (기존 UX), 그 외는 formatPrice (USD/JPY/CNY).
  // 본 PR (feat/price-multi-currency, 2026-05-13) 전: 모든 외국인이 ₩123k 형태로 강제 표시 → 가격 인식 어려움.
  const formatPriceKRW = (priceKRW: number) => {
    if (language === 'ko') {
      if (priceKRW >= 10000) return `${Math.round(priceKRW / 10000)}만원~`;
      return `₩${priceKRW.toLocaleString()}~`;
    }
    return formatPrice(priceKRW, language, { approximate: true });
  };

  useEffect(() => {
    if (!user) return;
    (async () => {
      try {
        const q = query(collection(db, 'plans'), where('uid', '==', user.uid));
        const snap = await getDocs(q);
        const now = Date.now();
        let nearest: { title: string; dday: number; date: string } | null = null;
        snap.forEach((d) => {
          const data = d.data(); const sd = data.input?.startDate; if (!sd) return;
          const diff = Math.ceil((new Date(sd).getTime() - now) / 86400000);
          if (diff >= 0 && (!nearest || diff < nearest.dday)) nearest = { title: data.itinerary?.tour_title || 'Korea Trip', dday: diff, date: sd };
        });
        setNextTrip(nearest);
      } catch { /* silent */ }
    })();
  }, [user]);

  const [weatherCity, setWeatherCity] = useState('Seoul');

  useEffect(() => {
    try {
      const saved = localStorage.getItem('cocotrip_last_region');
      if (saved) setWeatherCity(saved);
    } catch { /* silent */ }
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`https://wttr.in/${encodeURIComponent(weatherCity)}?format=j1`);
        const data = await res.json();
        const cur = data.current_condition?.[0];
        if (cur) setWeather({ temp: cur.temp_C + '\u00b0C', desc: cur.weatherDesc?.[0]?.value || '', icon: Number(cur.temp_C) > 20 ? '\u2600\ufe0f' : Number(cur.temp_C) > 10 ? '\u26c5' : '\u2744\ufe0f' });
      } catch { /* silent */ }
    })();
  }, [weatherCity]);

  const svcButtons = [
    { icon: Car, label: m.svcCharter || 'Charter', sub: m.svcCharterSub || 'Vehicle', link: '/charter', color: '#B668FC' },
    { icon: Sparkles, label: m.svcPlanner || 'AI Planner', sub: m.svcPlannerSub || 'Itinerary', link: '/planner', color: '#FF6B9D' },
    { icon: Music2, label: m.svcKpop || 'K-pop', sub: m.svcKpopSub || 'Shuttle', link: '/charter', color: '#C850C0' },
  ];

  const trustBadges = [
    { icon: Shield, label: m.trustPaypal || 'PayPal\nSecure Pay', color: '#B668FC' },
    { icon: Clock, label: m.trustSupport || '24/7\nSupport', color: '#FF6B9D' },
    { icon: Users, label: m.trustLicense || 'Licensed\nOperator', color: '#C850C0' },
  ];

  return (
    <div className="min-h-screen pb-24" style={{ background: 'linear-gradient(180deg, #0a0412 0%, #0d0618 50%, #080210 100%)' }}>
      <style>{`
        /* 정제 퍼플·핑크 (2026-06-01 채택) — REFINED 플래그 ON 일 때만 적용 */
        .m-hero-serif { font-family: 'Fraunces', Georgia, 'Noto Serif KR', serif; font-weight: 600; letter-spacing: -0.01em; }
        .m-accent-soft { background: linear-gradient(100deg,#caa9ff,#f4a9cf); -webkit-background-clip: text; background-clip: text; color: transparent; }
        .m-cta-refined { background: linear-gradient(100deg,#caa9ff,#f4a9cf) !important; color: #1a0f1e !important; box-shadow: none !important; }
        @keyframes shimmer { 0% { background-position: -200% 0; } 100% { background-position: 200% 0; } }
        @keyframes hero-orb { 0%, 100% { transform: translate(0, 0) scale(1); opacity: 0.55; } 50% { transform: translate(8px, -10px) scale(1.05); opacity: 0.7; } }
        @keyframes hero-orb-2 { 0%, 100% { transform: translate(0, 0) scale(1); opacity: 0.45; } 50% { transform: translate(-10px, 8px) scale(1.08); opacity: 0.6; } }
        @keyframes hero-fade { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes marquee { 0% { transform: translateX(0); } 100% { transform: translateX(-50%); } }
        .m-btn { transition: all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1); }
        .m-btn:active { transform: scale(0.93); }
        .m-shimmer { background: linear-gradient(90deg, #B668FC 0%, #FF6B9D 40%, #B668FC 80%); background-size: 200% auto; -webkit-background-clip: text; background-clip: text; -webkit-text-fill-color: transparent; animation: shimmer 3s linear infinite; }
        .m-hero-fade { animation: hero-fade 0.5s ease-out forwards; opacity: 0; }
        @media (prefers-reduced-motion: reduce) {
          .m-shimmer, [style*="hero-orb"], [style*="marquee"] { animation: none !important; }
        }
      `}</style>

      {/* HERO — Claude.ai-inspired confident headline + single primary CTA.
          Aurora orbs for warmth, restrained accents, generous whitespace.
          Above-the-fold target: ≤320px tall on a 380×740 viewport. */}
      <section className="relative px-5 pt-7 pb-7 overflow-hidden">
        {/* Aurora orbs — soft purple/pink, behind text. */}
        <div aria-hidden className="absolute -top-10 -left-10 w-56 h-56 rounded-full blur-3xl"
          style={{ background: 'radial-gradient(circle, rgba(182,104,252,0.45) 0%, rgba(182,104,252,0) 70%)', animation: 'hero-orb 9s ease-in-out infinite' }} />
        <div aria-hidden className="absolute top-10 -right-12 w-48 h-48 rounded-full blur-3xl"
          style={{ background: 'radial-gradient(circle, rgba(255,107,157,0.4) 0%, rgba(255,107,157,0) 70%)', animation: 'hero-orb-2 11s ease-in-out infinite' }} />

        <div className="relative">
          <span className="m-hero-fade inline-block text-[10px] font-bold tracking-[0.2em] text-white/55 px-2.5 py-1 rounded-full border border-white/[0.08] bg-white/[0.03]">
            {m.heroBadge || 'PREMIUM KOREA TRAVEL'}
          </span>
          <h1 className={`m-hero-fade mt-3 text-[28px] sm:text-[32px] leading-[1.15] text-white ${REFINED ? 'm-hero-serif' : 'font-black'}`} style={{ animationDelay: '0.05s' }}>
            {m.heroHeadline1 || 'Your Korea trip,'}
            <br />
            <span className={REFINED ? 'm-accent-soft' : 'm-shimmer'}>{m.heroHeadline2 || 'planned in 60 seconds'}</span>
          </h1>
          <p className="m-hero-fade mt-2.5 text-[13px] text-white/55 leading-relaxed" style={{ animationDelay: '0.1s' }}>
            {m.heroSubtitle || 'AI plans the days. Private chauffeur + 24/7 English support included.'}
          </p>
          <Link
            to="/planner"
            onClick={() => haptic('select')}
            className={`m-hero-fade m-btn mt-5 flex items-center justify-center gap-2 w-full py-3.5 rounded-2xl text-[14px] font-bold ${REFINED ? 'm-cta-refined' : 'text-white shadow-lg'}`}
            style={REFINED
              ? { animationDelay: '0.18s' }
              : {
                  background: 'linear-gradient(135deg, #B668FC 0%, #FF6B9D 100%)',
                  boxShadow: '0 10px 32px rgba(182,104,252,0.35)',
                  animationDelay: '0.18s',
                }}
          >
            <Wand2 className="w-4 h-4" />
            {m.heroCta || 'Get Started'}
            <ArrowRight className="w-4 h-4" />
          </Link>
          <div className="m-hero-fade mt-3.5 flex items-center justify-center gap-3 text-[10.5px] text-white/45" style={{ animationDelay: '0.25s' }}>
            <span className="flex items-center gap-1"><Star className="w-3 h-3 fill-yellow-400 text-yellow-400" />{m.heroProofReviews || '5.0 Google'}</span>
            <span className="text-white/15">·</span>
            <span className="flex items-center gap-1"><Clock className="w-3 h-3" />{m.heroProofSupport || '24/7 English'}</span>
            <span className="text-white/15">·</span>
            <span className="flex items-center gap-1"><ShieldCheck className="w-3 h-3" />{m.heroProofLicensed || 'Licensed Operator'}</span>
          </div>
        </div>
      </section>

      {/* TOUR MARQUEE — replaces the old promo carousel. Tour photos drift
          left→right at a slow walking pace (40s for one full loop). Touch
          on the strip pauses the animation so users can read; lifting the
          finger resumes after a beat. Each card is a Link to the tour
          detail with haptic feedback. */}
      <section className="relative">
        <div className="flex items-center justify-between px-5 mb-2.5">
          <p className="text-[12px] font-semibold text-white/65">
            {m.tourMarqueeTitle || 'Featured Tours'}
          </p>
          <Link to="/tours" onClick={() => haptic('tap')} className="text-[11px] text-[#B668FC] font-semibold flex items-center gap-0.5">
            {m.tourMarqueeMore || 'View all'}
            <ChevronRight className="w-3 h-3" />
          </Link>
        </div>
        <div
          ref={marqueeRef}
          className="overflow-hidden"
          onTouchStart={() => setMarqueePaused(true)}
          onTouchEnd={() => setTimeout(() => setMarqueePaused(false), 1500)}
        >
          <div
            className="flex gap-3 will-change-transform"
            style={{
              animation: 'marquee 40s linear infinite',
              animationPlayState: marqueePaused ? 'paused' : 'running',
              width: 'max-content',
            }}
          >
            {marqueeItems.map((tour, i) => {
              const title = tour.title[language] || tour.title.en;
              const priceKRW = getTourPriceKRW(tour.id, tour.priceFrom, tour.priceUnit);
              return (
                <Link
                  key={`${tour.id}-${i}`}
                  to={`/tours/${tour.slug}`}
                  onClick={() => haptic('tap')}
                  className="m-btn shrink-0 w-[140px] h-[185px] rounded-2xl overflow-hidden relative bg-white/[0.04] border border-white/[0.06] block"
                  aria-label={title}
                >
                  <img
                    src={tour.thumbnail}
                    alt={title}
                    loading="lazy"
                    decoding="async"
                    className="absolute inset-0 w-full h-full object-cover"
                    onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
                  />
                  {/* Bottom gradient + price chip + title */}
                  <div className="absolute inset-x-0 bottom-0 h-3/5 bg-gradient-to-t from-black/85 via-black/50 to-transparent" />
                  <div className="absolute top-2 right-2 px-2 py-0.5 rounded-full bg-white/15 backdrop-blur-sm border border-white/10">
                    <span className="text-[9.5px] font-bold text-white">{formatPriceKRW(priceKRW)}</span>
                  </div>
                  <div className="absolute inset-x-0 bottom-0 px-2.5 pb-2.5">
                    <p className="text-[12px] font-bold text-white leading-tight line-clamp-2 drop-shadow-md">
                      {title}
                    </p>
                  </div>
                </Link>
              );
            })}
          </div>
        </div>
      </section>

      {/* SERVICE BUTTONS — taller cards, calmer (no float/glow), better
          touch target. Hover-only subtle border highlight. */}
      <section className="grid grid-cols-3 gap-3 px-4 mt-5">
        {svcButtons.map((svc) => {
          const Icon = svc.icon;
          return (
            <Link
              key={svc.label}
              to={svc.link}
              onClick={() => haptic('tap')}
              className="flex flex-col items-center gap-2.5 py-5 rounded-2xl border border-white/[0.06] bg-white/[0.02] m-btn relative overflow-hidden hover:border-white/[0.12] hover:bg-white/[0.04]"
            >
              <div className="w-12 h-12 rounded-2xl flex items-center justify-center" style={{ background: `linear-gradient(135deg, ${svc.color}20, ${svc.color}08)`, border: `1px solid ${svc.color}30` }}>
                <Icon className="w-5 h-5" style={{ color: svc.color }} />
              </div>
              <div className="text-center"><p className="text-[13px] font-bold text-white">{svc.label}</p><p className="text-[10px] text-white/55 mt-0.5">{svc.sub}</p></div>
            </Link>
          );
        })}
      </section>

      {/* WEATHER + AI BANNER */}
      <section className="mx-3 mt-5 space-y-2.5">
        {weather && (
          <div className="flex items-center gap-3 px-4 py-3 rounded-2xl border border-purple-500/10 bg-purple-500/[0.03]">
            <CloudSun className="w-5 h-5 text-purple-300/60 shrink-0" />
            <div className="flex items-center gap-1.5 flex-1">
              <span className="text-[13px] font-bold text-white">{weatherCity}</span>
              <span className="text-[12px] font-black text-pink-400">{weather.temp}</span>
              <span className="text-[13px]">{weather.icon}</span>
              <span className="text-[11px] text-white/55">{weather.desc}</span>
            </div>
            <Thermometer className="w-3.5 h-3.5 text-white/10 shrink-0" />
          </div>
        )}
        <Link to="/planner" className="flex items-center gap-3 px-4 py-4 rounded-2xl m-btn relative overflow-hidden" style={{ background: 'linear-gradient(135deg, rgba(182,104,252,0.12), rgba(255,107,157,0.08))', border: '1px solid rgba(182,104,252,0.15)' }}>
          <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: 'linear-gradient(135deg, #B668FC, #FF6B9D)' }}><Wand2 className="w-5 h-5 text-white" /></div>
          <div className="flex-1 min-w-0"><p className="text-[13px] font-bold text-white">{m.aiBannerTitle || 'AI Itinerary Generator'}</p><p className="text-[10px] text-white/55 mt-0.5">{m.aiBannerSubtitle || 'Enter city & dates → Get minute-by-minute plan'}</p></div>
          <span className="text-[13px] font-black text-pink-400 shrink-0 animate-pulse">$9.90</span>
          <ChevronRight className="w-4 h-4 text-purple-400/30 shrink-0" />
        </Link>
      </section>

      {/* D-DAY */}
      {nextTrip && (
        <section className="mx-3 mt-5">
          <Link to="/my-plans" className="flex items-center gap-3 px-4 py-3.5 rounded-2xl border border-pink-500/15 m-btn" style={{ background: 'linear-gradient(135deg, rgba(255,107,157,0.08), rgba(182,104,252,0.04))' }}>
            <div className="w-12 h-12 rounded-xl flex flex-col items-center justify-center" style={{ background: 'linear-gradient(135deg, #FF6B9D, #C850C0)' }}>
              <Timer className="w-3.5 h-3.5 text-white mb-0.5" /><span className="text-[14px] font-black text-white leading-none">{nextTrip.dday === 0 ? 'D-0' : `D-${nextTrip.dday}`}</span>
            </div>
            <div className="flex-1 min-w-0"><p className="text-[13px] font-bold text-white truncate">{nextTrip.title}</p><p className="text-[10px] text-white/55 mt-0.5">{nextTrip.date}</p></div>
            <ChevronRight className="w-4 h-4 text-pink-400/20 shrink-0" />
          </Link>
        </section>
      )}

      {/* MY TRIP / MEMBER */}
      <section className="mx-3 mt-5 space-y-2.5">
        {user ? (<>
          <Link to="/mypage" className="flex items-center gap-3 px-4 py-3.5 rounded-2xl border border-white/[0.05] bg-white/[0.02] m-btn">
            <div className="w-10 h-10 rounded-full flex items-center justify-center" style={{ background: 'linear-gradient(135deg, #B668FC, #FF6B9D)' }}><Crown className="w-4 h-4 text-white" /></div>
            <div className="flex-1 min-w-0"><p className="text-[13px] font-bold text-white truncate">{user.displayName || user.email?.split('@')[0] || 'Member'}</p><p className="text-[10px] text-white/55 mt-0.5">{m.memberGrade || 'Tier · Coupons · Trip Coins'}</p></div>
            <ChevronRight className="w-4 h-4 text-white/10 shrink-0" />
          </Link>
          <Link to="/my-plans" className="flex items-center gap-3 px-4 py-3.5 rounded-2xl border border-white/[0.05] bg-white/[0.02] m-btn">
            <div className="w-10 h-10 rounded-xl bg-purple-500/10 border border-purple-500/15 flex items-center justify-center"><FileText className="w-4 h-4 text-purple-400/70" /></div>
            <div className="flex-1 min-w-0"><p className="text-[13px] font-bold text-white">{m.myPlans || 'My Travel Plans'}</p><p className="text-[10px] text-white/55 mt-0.5">{m.myPlansSub || 'Saved itineraries · PDF download'}</p></div>
            <ChevronRight className="w-4 h-4 text-white/10 shrink-0" />
          </Link>
        </>) : (
          <Link to="/planner" className="flex items-center gap-3 px-4 py-4 rounded-2xl border border-pink-500/15 m-btn" style={{ background: 'linear-gradient(135deg, rgba(182,104,252,0.06), rgba(255,107,157,0.04))' }}>
            <div className="w-10 h-10 rounded-full flex items-center justify-center" style={{ background: 'linear-gradient(135deg, #C850C0, #FF6B9D)' }}><Gift className="w-4 h-4 text-white" /></div>
            <div className="flex-1"><p className="text-[13px] font-bold text-white">{m.loginCta || 'Sign in with Google'}</p><p className="text-[10px] text-white/55 mt-0.5">{(m.loginBenefit || '{n}% off first booking + Trip Coins').replace('{n}', '5')}</p></div>
            <ArrowRight className="w-4 h-4 text-pink-400/30 shrink-0" />
          </Link>
        )}
        <div className="flex items-center gap-3 px-4 py-3 rounded-2xl border border-white/[0.05] bg-white/[0.02]">
          <Star className="w-5 h-5 text-yellow-400/70 shrink-0" />
          <div className="flex items-center gap-1.5 flex-1">
            <span className="text-[13px] font-bold text-white">{m.googleReview || 'Google Reviews'}</span>
            <span className="text-[12px] font-black text-yellow-400">5.0</span>
            <div className="flex">{[...Array(5)].map((_, i) => (<Star key={i} className="w-2.5 h-2.5 text-yellow-400 fill-yellow-400" />))}</div>
          </div>
          <ChevronRight className="w-4 h-4 text-white/10 shrink-0" />
        </div>
      </section>

      {/* TRUST + BRAND */}
      <section className="mx-3 mt-7">
        <div className="grid grid-cols-3 gap-2 mb-6">
          {trustBadges.map((b) => {
            const I = b.icon; return (<div key={b.label} className="flex flex-col items-center gap-1.5 py-3 rounded-xl bg-white/[0.02] border border-white/[0.04]"><I className="w-4 h-4" style={{ color: b.color }} /><p className="text-[10px] text-white/55 text-center whitespace-pre-line leading-tight font-medium">{b.label}</p></div>);
          })}
        </div>
        <div className="text-center pb-4">
          <p className="text-[20px] font-black m-shimmer">CocoTrip</p>
          <p className="text-[10px] text-white/15 mt-1">{m.brandSlogan || 'Premium Korea Travel — cocotripkr.com'}</p>
          <p className="text-[9px] text-white/10 mt-0.5">{_t.footer?.tourNo || 'Tour Operator No.: 2024-0000012'}</p>
        </div>
      </section>
    </div>
  );
}
