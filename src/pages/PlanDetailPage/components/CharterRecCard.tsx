// CocoTrip charter HERO card — shared by the arrival and departure guides (2026-11-19: dawn and group
// legs recommend the charter on both ends of the trip).
import { Link } from 'react-router-dom';
import { Sparkles, Car, ArrowRight } from 'lucide-react';
import { formatKRW } from '../constants';
import { useLanguage } from '@/hooks/useLanguage';
import { getPlanDetailUI } from '../types';
import { BRAND } from '@/lib/design-tokens';

export interface CharterRecommendation {
  key: string;
  reason_ko?: string;
  reason_en?: string;
  reason_ja?: string;
  reason_zh?: string;
  cta_link?: string;
  /** Dawn pick (leaving 23:00–04:59) — daytime-only options next to it are hidden. */
  dawn?: boolean;
  // PR-C (2026-06-01, FEATURE_CHARTER_HERO_PRICE backend flag): price + leg, filled by RouteAgent only
  // when the flag is on. Price comes from the airport-pickup price table only — null/missing hides the line.
  est_price_krw?: number;
  from?: string;
  to?: string;
  est_min?: number;
}

export function recReasonFor(rec: CharterRecommendation | undefined, language: string): string {
  if (!rec) return '';
  return (language === 'ko' && rec.reason_ko) || (language === 'ja' && rec.reason_ja) || (language === 'zh' && rec.reason_zh) || rec.reason_en || '';
}

export function CharterRecCard({ rec }: { rec: CharterRecommendation }) {
  const { t, language } = useLanguage();
  const ui = getPlanDetailUI(t);
  const recReason = recReasonFor(rec, language);
  return (
    <div className="mb-4 rounded-2xl overflow-hidden"
      style={{ background: 'linear-gradient(135deg, rgba(234,83,126,0.18), rgba(124,92,252,0.12))', border: '1px solid rgba(234,83,126,0.40)' }}>
      <div className="p-4">
        <div className="flex items-center gap-2 mb-2.5">
          <Sparkles className="w-3.5 h-3.5 text-[#FBBC05]" />
          <span className="text-[12px] font-bold uppercase tracking-wider text-[#FBBC05]">{ui.recommended || 'Recommended'}</span>
        </div>
        <div className="flex items-center gap-3 mb-2">
          <div className="w-11 h-11 rounded-xl flex items-center justify-center shrink-0 shadow-lg"
            style={{ background: BRAND.gradient.primary }}>
            <Car className="w-6 h-6 text-white" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[16px] font-bold text-white">{ui.charterRecTitle || 'CocoTrip Private Charter'}</p>
            <p className="text-[13px] text-white/70">{ui.charterRecSub || 'Door-to-door · driver loads all luggage · English-speaking'}</p>
          </div>
        </div>
        {/* from→to · est_min · ₩price — each part only when present, price only when positive. */}
        {(rec.from || rec.to || (rec.est_min || 0) > 0 || (rec.est_price_krw || 0) > 0) && (
          <div className="rounded-lg bg-white/[0.05] border border-white/[0.08] px-3 py-2 mb-3">
            <p className="text-[14px] font-semibold text-white/90 leading-relaxed">
              {[
                rec.from && rec.to ? `${rec.from} → ${rec.to}` : (rec.from || rec.to || ''),
                (rec.est_min || 0) > 0 ? `${rec.est_min}${ui.minUnit || 'min'}` : '',
                (rec.est_price_krw || 0) > 0 ? formatKRW(rec.est_price_krw || 0) : '',
              ].filter(Boolean).join(' · ')}
            </p>
          </div>
        )}
        {recReason && (
          <div className="rounded-lg bg-white/[0.05] border border-white/[0.08] px-3 py-2 mb-3">
            <p className="text-[14px] text-white/85 leading-relaxed">⚠️ {recReason}</p>
          </div>
        )}
        <Link
          to={rec.cta_link || '/charter'}
          className="flex items-center justify-center gap-2 w-full py-2.5 rounded-xl text-[13px] font-bold text-white transition-all hover:scale-[1.01] min-h-[44px]"
          style={{ background: BRAND.gradient.primary, boxShadow: '0 4px 16px rgba(124,92,252,0.35)' }}
        >
          {ui.bookCharter || 'Book Charter'} <ArrowRight className="w-4 h-4" />
        </Link>
      </div>
    </div>
  );
}
