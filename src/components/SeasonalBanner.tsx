import { useMemo } from 'react';
import { ArrowRight, Flower2, Sun, Leaf, Snowflake } from 'lucide-react';
import { getCurrentSeason, SEASONAL_SPOTS, type Season } from '@/data/seasonalSpots';
import { useLanguage } from '@/hooks/useLanguage';
import { useNavigate } from 'react-router-dom';

const SEASON_ICON: Record<Season, React.ReactNode> = {
  spring: <Flower2 className="w-5 h-5" />,
  summer: <Sun className="w-5 h-5" />,
  autumn: <Leaf className="w-5 h-5" />,
  winter: <Snowflake className="w-5 h-5" />,
};

const SEASON_GRADIENT: Record<Season, string> = {
  spring: 'linear-gradient(135deg, #f8b4d9, #c084fc)',
  summer: 'linear-gradient(135deg, #60a5fa, #10b981)',
  autumn: 'linear-gradient(135deg, #f97316, #ef4444)',
  winter: 'linear-gradient(135deg, #7C5CFC, #06b6d4)',
};

export function SeasonalBanner() {
  const { language } = useLanguage();
  const navigate = useNavigate();
  const season = useMemo(() => getCurrentSeason(), []);
  const data = SEASONAL_SPOTS[season];
  const lk = (language === 'ko' || language === 'en' || language === 'ja' || language === 'zh') ? language : 'en';

  const title = data.title[lk];
  const subtitle = data.subtitle[lk];
  const urgency = data.urgency[lk];
  const topSpot = data.spots[0];
  const spotName = language === 'ko' ? topSpot.name : topSpot.nameEn;
  const spotHighlight = language === 'ko' ? topSpot.highlight : topSpot.highlightEn;

  return (
    <section className="py-12 lg:py-16">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div
          className="relative overflow-hidden rounded-3xl p-8 lg:p-12 text-white"
          style={{ background: SEASON_GRADIENT[season] }}
        >
          {/* Decorative dots */}
          <div className="absolute top-0 right-0 w-64 h-64 bg-white/10 rounded-full -translate-y-1/3 translate-x-1/3 blur-2xl" />
          <div className="absolute bottom-0 left-0 w-48 h-48 bg-white/5 rounded-full translate-y-1/2 -translate-x-1/3 blur-xl" />

          <div className="relative z-10 grid lg:grid-cols-2 gap-8 items-center">
            {/* Left */}
            <div>
              <div className="inline-flex items-center gap-2 px-3 py-1.5 bg-white/20 backdrop-blur-sm rounded-full text-xs font-bold mb-4">
                {SEASON_ICON[season]}
                <span>{urgency}</span>
              </div>
              <h2 className="text-2xl sm:text-3xl lg:text-4xl font-bold mb-3 leading-tight">
                {title}
              </h2>
              <p className="text-white/80 text-lg mb-6">{subtitle}</p>
              <button
                onClick={() => navigate('/planner')}
                className="inline-flex items-center gap-2 px-6 py-3 bg-white text-gray-900 rounded-full font-bold hover:bg-white/90 transition-all active:scale-95"
              >
                {language === 'ko' ? '이 시즌 AI 일정 만들기' : 'Plan this season with AI'}
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>

            {/* Right — Featured Spot */}
            <div className="bg-white/15 backdrop-blur-sm rounded-2xl p-6 border border-white/20">
              <div className="text-sm font-medium text-white/60 mb-2">
                {language === 'ko' ? '🔥 추천 명소' : '🔥 Featured Spot'}
              </div>
              <h3 className="text-xl font-bold mb-2">{spotName}</h3>
              <p className="text-white/75 text-sm leading-relaxed mb-3">
                {spotHighlight}
              </p>
              <div className="text-xs text-white/50">
                {language === 'ko' ? topSpot.period : topSpot.periodEn}
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
