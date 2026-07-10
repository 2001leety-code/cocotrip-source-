// Codex 모바일 라이트 플래너 히어로 (2026-07-09 패스) — index.tsx 400줄 잠금으로 추출.
// 내용은 이동만 — 디자인·동작 무변경 (Codex 디자인 = SSOT, 재설계 금지).
import type { Language } from '@/i18n';
import {
  Sparkles, Bot, CloudSun, Heart, Hotel, Languages, Route,
  Ticket, UserRound, Zap, type LucideIcon,
} from 'lucide-react';

export function CocoIcon({ icon: Icon, active = false, size = 'md' }: { icon: LucideIcon; active?: boolean; size?: 'sm' | 'md' | 'lg' }) {
  const box = size === 'lg' ? 'h-12 w-12' : size === 'sm' ? 'h-9 w-9' : 'h-10 w-10';
  const iconSize = size === 'lg' ? 'h-6 w-6' : size === 'sm' ? 'h-4 w-4' : 'h-5 w-5';
  return (
    <span className={`coco-ai-icon ${active ? 'is-active' : ''} ${box}`}>
      <Icon className={iconSize} strokeWidth={2.2} />
    </span>
  );
}

export function MobilePlannerHero({
  language,
  onLanguageChange,
}: {
  language: Language;
  onLanguageChange: (lang: Language) => void;
}) {
  const langChips: { code: Language; label: string }[] = [
    { code: 'en', label: 'EN' },
    { code: 'ko', label: '한국어' },
    { code: 'ja', label: '日本語' },
    { code: 'zh', label: '中文' },
  ];

  const smartPicks = [
    { title: 'Namsan Tower', meta: 'Sunset view', image: '/hero-seoul-real.webp' },
    { title: 'Bukchon Hanok', meta: 'Slow morning', image: '/hero-hanok-real.webp' },
  ];

  return (
    <section className="planner-mobile-hero mx-auto max-w-[430px] px-4 pt-4 pb-2">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <p className="text-[13px] font-black text-[#12143a]">Hello, Traveler +</p>
          <p className="mt-0.5 text-[11px] font-semibold text-[#7b719f]">Where in Korea shall we explore today?</p>
        </div>
        <span className="grid h-10 w-10 place-items-center rounded-full bg-white shadow-[0_10px_24px_rgba(124,92,252,0.16)]">
          <UserRound className="h-[18px] w-[18px] text-[#7C5CFC]" />
        </span>
      </div>

      <div className="relative mb-4">
        <div className="relative overflow-hidden rounded-[22px] shadow-[0_20px_38px_rgba(51,42,116,0.18)]">
        <img src="/hero-seoul-real.webp" alt="Seoul night skyline" className="h-[176px] w-full object-cover" />
        <div className="absolute inset-0 bg-gradient-to-t from-[#15143d]/78 via-[#171647]/20 to-transparent" />
        <div className="absolute inset-0 bg-gradient-to-b from-[#080b20]/40 via-transparent to-transparent" />
        <div className="absolute left-4 right-4 top-4 flex items-start justify-between">
          <div>
            <p className="text-3xl font-black leading-none text-white drop-shadow-[0_2px_8px_rgba(0,0,0,0.55)]">Seoul</p>
            <p className="mt-1 text-[10px] font-extrabold uppercase tracking-[0.16em] text-white/90 drop-shadow-[0_2px_8px_rgba(0,0,0,0.45)]">South Korea</p>
          </div>
          <div className="rounded-2xl bg-white/22 px-3 py-2 text-right text-white backdrop-blur-md">
            <CloudSun className="ml-auto h-4 w-4" />
            <p className="mt-0.5 text-[12px] font-black">22°C</p>
            <p className="text-[9px] font-semibold text-white/75">Partly Cloudy</p>
          </div>
        </div>
        </div>
        <div
          className="relative z-10 mx-3 -mt-9 rounded-2xl p-3 shadow-[0_14px_30px_rgba(21,20,61,0.14)] backdrop-blur-xl"
          style={{ background: 'linear-gradient(135deg, rgba(255,255,255,0.96), rgba(248,242,255,0.94))' }}
        >
          <div className="mb-2 flex items-center gap-2">
            <CocoIcon icon={Sparkles} size="sm" active />
            <div className="min-w-0">
              <p className="text-[13px] font-black text-[#17163d]">AI Itinerary Suggestion</p>
              <p className="text-[10px] font-semibold text-[#7b719f]">Smart plan based on your preferences</p>
            </div>
          </div>
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-[17px] font-black text-[#7653F6]">Seoul Highlights</p>
              <p className="mt-0.5 text-[11px] font-semibold text-[#25234d]">Culture · Food · Night View</p>
            </div>
            <span className="rounded-full bg-[#f1ecff] px-2.5 py-1 text-[10px] font-black text-[#7653F6]">Best Match</span>
          </div>
        </div>
      </div>

      <div className="mt-3 grid grid-cols-[1.1fr_0.9fr] gap-3">
        <div className="planner-mobile-panel p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="inline-flex items-center gap-1 text-[11px] font-black text-[#6f4df5]">
              <CocoIcon icon={Ticket} size="sm" /> Smart Picks
            </span>
            <Heart className="h-4 w-4 text-[#8b79dc]" />
          </div>
          <div className="grid grid-cols-2 gap-2">
            {smartPicks.map((pick) => (
              <div key={pick.title} className="min-w-0">
                <img src={pick.image} alt="" className="h-14 w-full rounded-xl object-cover" />
                <p className="mt-1 truncate text-[11px] font-black text-[#17163d]">{pick.title}</p>
                <p className="truncate text-[9px] font-semibold text-[#7b719f]">{pick.meta}</p>
              </div>
            ))}
          </div>
        </div>
        <div className="planner-mobile-panel p-3">
          <span className="inline-flex items-center gap-1 text-[11px] font-black text-[#6f4df5]">
            <CocoIcon icon={Bot} size="sm" active /> AI Assistant
          </span>
          <p className="mt-2 text-[13px] font-black leading-tight text-[#17163d]">How can I help with your trip?</p>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {langChips.map((chip) => (
              <button
                key={chip.code}
                type="button"
                onClick={() => onLanguageChange(chip.code)}
                className={`rounded-full px-2.5 py-1 text-[10px] font-black transition ${
                  language === chip.code ? 'bg-[#7653F6] text-white shadow-[0_8px_18px_rgba(118,83,246,0.28)]' : 'bg-white text-[#655d86]'
                }`}
              >
                {chip.label}
              </button>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

export function MobilePlannerPrinciples() {
  return (
    <div className="planner-mobile-principles mx-auto max-w-[430px] px-4">
      {[
        { icon: Route, label: 'Personalized Routes' },
        { icon: Zap, label: 'Real-Time Optimization' },
        { icon: Languages, label: 'Multilingual Support' },
        { icon: Hotel, label: 'Smart Stay Suggestions' },
      ].map((item) => (
        <div key={item.label} className="planner-mobile-mini-card">
          <CocoIcon icon={item.icon} size="sm" />
          <span>{item.label}</span>
        </div>
      ))}
    </div>
  );
}
