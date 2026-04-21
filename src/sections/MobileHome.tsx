import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { collection, query, where, getDocs } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import {
  Car, Sparkles, Music2, Wand2, ChevronRight, Star,
  ArrowRight, Clock, Users, Shield, Crown, Gift,
  CloudSun, Thermometer, Timer, FileText,
} from 'lucide-react';
import type { Translations } from '@/i18n';

interface MobileHomeProps {
  t: Translations;
}

export function MobileHome({ t: _t }: MobileHomeProps) {
  const { user } = useAuth();
  const [promoIdx, setPromoIdx] = useState(0);
  const [touchStartX, setTouchStartX] = useState(0);
  const [nextTrip, setNextTrip] = useState<{ title: string; dday: number; date: string } | null>(null);
  const [weather, setWeather] = useState<{ temp: string; desc: string; icon: string } | null>(null);

  const m = _t.mobileHome || {};

  const PROMO_SLIDES = [
    {
      gradient: 'linear-gradient(135deg, #B668FC 0%, #FF6B9D 50%, #C850C0 100%)',
      badge: 'AI PLANNER', title: m.promoAiTitle || 'AI Custom Itinerary',
      subtitle: m.promoAiSubtitle || 'Your perfect Korea trip plan in 15 sec',
      price: '$9.90', cta: m.promoAiCta || 'Plan My Trip', link: '/planner',
    },
    {
      gradient: 'linear-gradient(135deg, #0f0f1a 0%, #1a0a2e 50%, #2d1b69 100%)',
      badge: 'PRIVATE CHARTER', title: m.promoCharterTitle || 'Private Vehicle',
      subtitle: m.promoCharterSubtitle || 'English driver · Tips/Tolls all inclusive',
      price: '$90~', cta: m.promoCharterCta || 'Get Quote', link: '/charter',
    },
    {
      gradient: 'linear-gradient(135deg, #FF6B9D 0%, #C850C0 50%, #4158D0 100%)',
      badge: 'K-POP SHUTTLE', title: m.promoKpopTitle || 'K-pop Concert Shuttle',
      subtitle: m.promoKpopSubtitle || 'Hotel ↔ Venue round-trip shuttle',
      price: '$25~', cta: m.promoKpopCta || 'Book Shuttle', link: '/charter',
    },
    {
      gradient: 'linear-gradient(135deg, #1a0a2e 0%, #B668FC 100%)',
      badge: 'TOURS',
      title: m.promoToursTitle || 'Korea Private Tours',
      subtitle: m.promoToursSubtitle || 'Seoul · Busan · Gyeongju · Danyang — all inclusive',
      price: '$208~',
      cta: m.promoToursCta || 'View Tours',
      link: '/tours',
    },
  ];

  const [paused, setPaused] = useState(false);

  const nextSlide = useCallback(() => setPromoIdx(p => (p + 1) % PROMO_SLIDES.length), [PROMO_SLIDES.length]);
  useEffect(() => { if (paused) return; const t = setInterval(nextSlide, 7000); return () => clearInterval(t); }, [nextSlide, paused]);
  const handleTouchStart = (e: React.TouchEvent) => setTouchStartX(e.touches[0].clientX);
  const handleTouchEnd = (e: React.TouchEvent) => {
    const diff = touchStartX - e.changedTouches[0].clientX;
    if (Math.abs(diff) > 50) {
      setPromoIdx(p => diff > 0 ? (p + 1) % PROMO_SLIDES.length : (p - 1 + PROMO_SLIDES.length) % PROMO_SLIDES.length);
      setPaused(true);
      setTimeout(() => setPaused(false), 10000);
    }
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
    { icon: Car, label: m.svcCharter || 'Charter', sub: m.svcCharterSub || 'Vehicle', link: '/charter', color: '#B668FC', d: 0 },
    { icon: Sparkles, label: m.svcPlanner || 'AI Planner', sub: m.svcPlannerSub || 'Itinerary', link: '/planner', color: '#FF6B9D', d: 0.5 },
    { icon: Music2, label: m.svcKpop || 'K-pop', sub: m.svcKpopSub || 'Shuttle', link: '/charter', color: '#C850C0', d: 1 },
  ];

  const trustBadges = [
    { icon: Shield, label: m.trustPaypal || 'PayPal\nSecure Pay', color: '#B668FC' },
    { icon: Clock, label: m.trustSupport || '24/7\nSupport', color: '#FF6B9D' },
    { icon: Users, label: m.trustLicense || 'Licensed\nOperator', color: '#C850C0' },
  ];

  return (
    <div className="min-h-screen pb-24" style={{ background: 'linear-gradient(180deg, #0a0412 0%, #0d0618 50%, #080210 100%)' }}>
      <style>{`
        @keyframes shimmer { 0% { background-position: -200% 0; } 100% { background-position: 200% 0; } }
        @keyframes float { 0%, 100% { transform: translateY(0px); } 50% { transform: translateY(-4px); } }
        @keyframes pulse-pink { 0%, 100% { box-shadow: 0 0 0 0 rgba(200, 80, 192, 0.4); } 50% { box-shadow: 0 0 20px 4px rgba(200, 80, 192, 0.15); } }
        .m-btn { transition: all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1); }
        .m-btn:active { transform: scale(0.93); }
        .m-shimmer { background: linear-gradient(90deg, #B668FC 0%, #FF6B9D 40%, #B668FC 80%); background-size: 200% auto; -webkit-background-clip: text; background-clip: text; -webkit-text-fill-color: transparent; animation: shimmer 3s linear infinite; }
        .m-glow { animation: pulse-pink 3s ease-in-out infinite; }
        .m-float { animation: float 3s ease-in-out infinite; }
      `}</style>

      {/* PROMO */}
      <section className="relative mx-3 mt-3 h-[185px] rounded-2xl overflow-hidden" onTouchStart={handleTouchStart} onTouchEnd={handleTouchEnd}>
        {PROMO_SLIDES.map((s, i) => (
          <Link key={i} to={s.link} className={`absolute inset-0 p-5 flex flex-col justify-between transition-all duration-[600ms] ease-out ${i === promoIdx ? 'opacity-100 scale-100' : 'opacity-0 scale-95 pointer-events-none'}`} style={{ background: s.gradient }}>
            <div className="absolute top-4 right-4 w-20 h-20 rounded-full bg-white/[0.06] blur-xl" />
            <div className="relative z-10">
              <span className="inline-block text-[9px] font-black tracking-[0.15em] text-white/90 bg-white/15 px-3 py-1 rounded-full backdrop-blur-sm border border-white/10">{s.badge}</span>
              <h2 className="text-[22px] font-black text-white mt-2 leading-tight drop-shadow-lg">{s.title}</h2>
              <p className="text-[12px] text-white/60 mt-1">{s.subtitle}</p>
            </div>
            <div className="relative z-10 flex items-end justify-between">
              <div><p className="text-[10px] text-white/40 uppercase tracking-wider">from</p><p className="text-[28px] font-black text-white leading-none">{s.price}</p></div>
              <span className="text-[12px] font-bold text-white bg-white/20 px-4 py-2 rounded-full backdrop-blur-sm border border-white/10 m-btn">{s.cta} →</span>
            </div>
          </Link>
        ))}
        <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex gap-1.5 z-10">
          {PROMO_SLIDES.map((_, i) => (<button key={i} onClick={() => setPromoIdx(i)} className={`rounded-full transition-all duration-[400ms] ${i === promoIdx ? 'w-6 h-[5px] bg-pink-400 shadow-[0_0_10px_rgba(255,107,157,0.6)]' : 'w-[5px] h-[5px] bg-white/20'}`} />))}
        </div>
      </section>

      {/* SERVICE BUTTONS */}
      <section className="grid grid-cols-3 gap-3 px-4 mt-5">
        {svcButtons.map((svc) => {
          const Icon = svc.icon;
          return (
            <Link key={svc.label} to={svc.link} className="flex flex-col items-center gap-2.5 py-5 rounded-2xl border border-white/[0.06] bg-white/[0.02] m-btn m-glow relative overflow-hidden group">
              <div className="w-12 h-12 rounded-2xl flex items-center justify-center m-float" style={{ background: `linear-gradient(135deg, ${svc.color}20, ${svc.color}08)`, border: `1px solid ${svc.color}30`, animationDelay: `${svc.d}s` }}>
                <Icon className="w-5 h-5" style={{ color: svc.color }} />
              </div>
              <div className="text-center"><p className="text-[13px] font-bold text-white">{svc.label}</p><p className="text-[10px] text-white/25 mt-0.5">{svc.sub}</p></div>
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
              <span className="text-[11px] text-white/25">{weather.desc}</span>
            </div>
            <Thermometer className="w-3.5 h-3.5 text-white/10 shrink-0" />
          </div>
        )}
        <Link to="/planner" className="flex items-center gap-3 px-4 py-4 rounded-2xl m-btn relative overflow-hidden" style={{ background: 'linear-gradient(135deg, rgba(182,104,252,0.12), rgba(255,107,157,0.08))', border: '1px solid rgba(182,104,252,0.15)' }}>
          <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: 'linear-gradient(135deg, #B668FC, #FF6B9D)' }}><Wand2 className="w-5 h-5 text-white" /></div>
          <div className="flex-1 min-w-0"><p className="text-[13px] font-bold text-white">{m.aiBannerTitle || 'AI Itinerary Generator'}</p><p className="text-[10px] text-white/35 mt-0.5">{m.aiBannerSubtitle || 'Enter city & dates → Get minute-by-minute plan'}</p></div>
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
            <div className="flex-1 min-w-0"><p className="text-[13px] font-bold text-white truncate">{nextTrip.title}</p><p className="text-[10px] text-white/25 mt-0.5">{nextTrip.date}</p></div>
            <ChevronRight className="w-4 h-4 text-pink-400/20 shrink-0" />
          </Link>
        </section>
      )}

      {/* MY TRIP / MEMBER */}
      <section className="mx-3 mt-5 space-y-2.5">
        {user ? (<>
          <Link to="/mypage" className="flex items-center gap-3 px-4 py-3.5 rounded-2xl border border-white/[0.05] bg-white/[0.02] m-btn">
            <div className="w-10 h-10 rounded-full flex items-center justify-center" style={{ background: 'linear-gradient(135deg, #B668FC, #FF6B9D)' }}><Crown className="w-4 h-4 text-white" /></div>
            <div className="flex-1 min-w-0"><p className="text-[13px] font-bold text-white truncate">{user.displayName || user.email?.split('@')[0] || 'Member'}</p><p className="text-[10px] text-white/25 mt-0.5">{m.memberGrade || 'Tier · Coupons · Trip Coins'}</p></div>
            <ChevronRight className="w-4 h-4 text-white/10 shrink-0" />
          </Link>
          <Link to="/my-plans" className="flex items-center gap-3 px-4 py-3.5 rounded-2xl border border-white/[0.05] bg-white/[0.02] m-btn">
            <div className="w-10 h-10 rounded-xl bg-purple-500/10 border border-purple-500/15 flex items-center justify-center"><FileText className="w-4 h-4 text-purple-400/70" /></div>
            <div className="flex-1 min-w-0"><p className="text-[13px] font-bold text-white">{m.myPlans || 'My Travel Plans'}</p><p className="text-[10px] text-white/25 mt-0.5">{m.myPlansSub || 'Saved itineraries · PDF download'}</p></div>
            <ChevronRight className="w-4 h-4 text-white/10 shrink-0" />
          </Link>
        </>) : (
          <Link to="/planner" className="flex items-center gap-3 px-4 py-4 rounded-2xl border border-pink-500/15 m-btn" style={{ background: 'linear-gradient(135deg, rgba(182,104,252,0.06), rgba(255,107,157,0.04))' }}>
            <div className="w-10 h-10 rounded-full flex items-center justify-center" style={{ background: 'linear-gradient(135deg, #C850C0, #FF6B9D)' }}><Gift className="w-4 h-4 text-white" /></div>
            <div className="flex-1"><p className="text-[13px] font-bold text-white">{m.loginCta || 'Sign in with Google'}</p><p className="text-[10px] text-white/35 mt-0.5">{(m.loginBenefit || '{n}% off first booking + Trip Coins').replace('{n}', '5')}</p></div>
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
            const I = b.icon; return (<div key={b.label} className="flex flex-col items-center gap-1.5 py-3 rounded-xl bg-white/[0.02] border border-white/[0.04]"><I className="w-4 h-4" style={{ color: b.color }} /><p className="text-[10px] text-white/25 text-center whitespace-pre-line leading-tight font-medium">{b.label}</p></div>);
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
