// Seasonal spots banner.
// Extracted from PlanDetailPage/index.tsx L386-422.
// 2026-05-08: 사용자 main city 기반 region 필터 추가 — 무관 추천 (서울 사용자에게
// 황매산 철쭉제 290km 등) 제거.
import { getCurrentSeason, SEASONAL_SPOTS, regionToCityKey, filterSpotsByCity } from '@/data/seasonalSpots';
import { useLanguage } from '@/hooks/useLanguage';
import type { PlanDocument } from '../types';

interface SeasonalBannerProps {
  /** 사용자 main city 식별용. 미전달 시 모든 spot 노출 (legacy/fallback). */
  plan?: PlanDocument;
}

export function SeasonalBanner({ plan }: SeasonalBannerProps = {}) {
  const { language } = useLanguage();
  const season = getCurrentSeason();
  const sd = SEASONAL_SPOTS[season];
  const lk = (language === 'ko' || language === 'en' || language === 'ja' || language === 'zh') ? language : 'en';

  // 사용자 main city 추출 — input.area / input.destination / input.regions[0] 순.
  const input = plan?.input || {};
  const rawRegion =
    (input.area as string) ||
    (input.destination as string) ||
    ((input.regions as string[] | undefined)?.[0]) ||
    '';
  const cityKey = regionToCityKey(rawRegion);
  const filteredSpots = plan ? filterSpotsByCity(sd.spots, cityKey) : sd.spots;
  const visibleSpots = filteredSpots.slice(0, 3);
  if (visibleSpots.length === 0) return null;

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
          {visibleSpots.map((spot, i) => (
            <div key={i} className="bg-white/[0.06] rounded-xl px-4 py-3 border border-white/[0.06]">
              {/* ja/zh fall back to Korean original (hanja-recognizable to Asian readers, more useful at the venue) rather than English transliteration. */}
              <p className="text-sm font-bold text-white">{pickLang({ ko: spot.name, en: spot.nameEn, ja: spot.name, zh: spot.name })}</p>
              <p className="text-[10px] text-white/55 mt-0.5">{pickLang({ ko: spot.location, en: spot.locationEn, ja: spot.location, zh: spot.location })} {'\u00B7'} {pickLang({ ko: spot.period, en: spot.periodEn, ja: spot.period, zh: spot.period })}</p>
              <p className="text-xs text-white/60 mt-1">{pickLang({ ko: spot.tip, en: spot.tipEn, ja: spot.tip, zh: spot.tip })}</p>
            </div>
          ))}
        </div>
        <p className="text-[10px] text-white/55 text-center mt-3">{sd.urgency[lk]}</p>
      </div>
    </div>
  );
}
