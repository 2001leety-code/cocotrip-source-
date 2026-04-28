// "꼭 가보면 좋은 곳" — DB-derived top-rated restaurants near the plan stops.
// Backend (api/ai-planner-full.js) attaches up to 10 entries via
// `pickRecommendedRestaurants` (rating × log10(reviews), within 5km, tag=general,
// excluded if already in plan). Frontend just renders them.
//
// Why a discovery section vs. inline:
//   - users have already paid + see the AI's curated stops; this is a
//     "discover more" widget that broadens beyond their selected diet
//   - Keeping it below the day timeline avoids competing with the main flow
import { ExternalLink, Star, MapPin } from 'lucide-react';

type RecRestaurant = {
  name: string;
  nameEn?: string;
  address?: string;
  lat?: number;
  lng?: number;
  rating?: number;
  reviewCount?: number;
  cuisine?: string;
  cuisineKo?: string;
  priceLabel?: string;
  priceLabelKo?: string;
  placeId?: string;
  googleMapsUrl?: string;
  dong?: string;
  dongEn?: string;
  district?: string;
  nearestStopKm?: number;
};

interface Props {
  items: RecRestaurant[];
  language: 'ko' | 'en' | 'ja' | 'zh';
  // i18n
  labelTitle?: string;
  labelSubtitle?: string;
  labelReviews?: string;
  labelOpenMap?: string;
  labelKmAway?: string;
}

export function RecommendedRestaurants({
  items,
  language,
  labelTitle,
  labelSubtitle,
  labelReviews,
  labelOpenMap,
  labelKmAway,
}: Props) {
  if (!items || items.length === 0) return null;

  const isKo = language === 'ko';

  return (
    <section className="mb-6 sm:mb-8">
      <div className="mb-3 px-1">
        <h2 className="text-[16px] sm:text-lg font-bold text-white leading-tight">
          {labelTitle || 'Must-visit restaurants nearby'}
        </h2>
        <p className="text-[12px] text-white/55 mt-1 leading-snug">
          {labelSubtitle || 'Top-rated spots within 5 km of your stops — discover beyond your itinerary.'}
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
        {items.map((r, i) => {
          const displayName = isKo ? r.name : (r.nameEn || r.name);
          const cuisine = isKo ? (r.cuisineKo || r.cuisine) : (r.cuisine || r.cuisineKo);
          const district = isKo ? (r.dong || '') : (r.dongEn || r.dong || '');
          return (
            <article
              key={r.placeId || `${r.name}-${i}`}
              className="bg-white/[0.04] border border-white/[0.08] rounded-xl p-3.5 hover:bg-white/[0.07] hover:border-[#7C5CFC]/40 transition-colors"
            >
              <div className="flex items-start justify-between gap-2 mb-1.5">
                <div className="min-w-0 flex-1">
                  <h3 className="text-[14px] font-bold text-white leading-tight">{displayName}</h3>
                  {!isKo && r.name !== displayName && (
                    <p className="text-[11px] text-white/55 mt-0.5">{r.name}</p>
                  )}
                </div>
                <div className="shrink-0 inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-md bg-yellow-400/15 border border-yellow-400/30">
                  <Star className="w-3 h-3 text-yellow-300 fill-current" />
                  <span className="text-[11px] font-bold text-yellow-200">{r.rating?.toFixed(1)}</span>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
                {cuisine && (
                  <span className="text-[10px] text-white/65 bg-white/[0.06] border border-white/[0.08] rounded px-1.5 py-0.5">
                    {cuisine}
                  </span>
                )}
                {district && (
                  <span className="text-[10px] text-white/55">
                    <MapPin className="w-2.5 h-2.5 inline mr-0.5" />{district}
                  </span>
                )}
                {r.reviewCount !== undefined && (
                  <span className="text-[10px] text-white/45">
                    {r.reviewCount.toLocaleString()} {labelReviews || 'reviews'}
                  </span>
                )}
              </div>

              {(r.address || r.nearestStopKm !== undefined) && (
                <p className="text-[10px] text-white/45 mt-1.5 leading-snug">
                  {r.address}
                  {r.nearestStopKm !== undefined && (
                    <span className="ml-1 text-[#B9A4FF]">
                      · {r.nearestStopKm}{labelKmAway || 'km away'}
                    </span>
                  )}
                </p>
              )}

              {r.googleMapsUrl && (
                <a
                  href={r.googleMapsUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 mt-2 text-[11px] text-emerald-300/80 hover:text-emerald-300"
                >
                  <ExternalLink className="w-3 h-3" />
                  {labelOpenMap || 'Open in Maps'}
                </a>
              )}
            </article>
          );
        })}
      </div>
    </section>
  );
}
