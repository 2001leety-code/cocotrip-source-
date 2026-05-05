// "꼭 가보면 좋은 곳" — DB-derived top-rated restaurants near the plan stops.
// Backend (api/ai-planner-full.js) attaches up to 10 entries per tag-bucket via
// `pickRecommendedRestaurantsByStyle` (rating × log10(reviews), within 5km,
// excluded if already in plan). Frontend renders one section per bucket.
//
// Why per-tag sections (2026-05-05 regression fix):
//   - earlier the backend only emitted `general` even when user picked vegan/halal,
//     so dietary users saw 0 of their style. Now each style gets its own 10-list.
//   - SAFETY-CRITICAL (CLAUDE.md J): we never mix tags inside a section.
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

// Either a flat array (legacy plans) or per-style map (2026-05-05+).
type ItemsInput =
  | RecRestaurant[]
  | Record<string, RecRestaurant[] | undefined>;

interface Props {
  items: ItemsInput;
  language: 'ko' | 'en' | 'ja' | 'zh';
  // i18n
  labelTitle?: string;
  labelSubtitle?: string;
  labelReviews?: string;
  labelOpenMap?: string;
  labelKmAway?: string;
  // Per-style section headers (2026-05-05). Optional — if missing falls back
  // to the labelTitle for the general bucket and a tag name for others.
  labelGeneralSection?: string;
  labelVeganSection?: string;
  labelHalalSection?: string;
  labelEmptyBucket?: string;
}

function isMap(items: ItemsInput): items is Record<string, RecRestaurant[] | undefined> {
  return !Array.isArray(items) && typeof items === 'object' && items !== null;
}

// Display order for buckets — general first, then dietary.
const BUCKET_ORDER = ['general', 'vegan', 'halal'];

export function RecommendedRestaurants({
  items,
  language,
  labelTitle,
  labelSubtitle,
  labelReviews,
  labelOpenMap,
  labelKmAway,
  labelGeneralSection,
  labelVeganSection,
  labelHalalSection,
  labelEmptyBucket,
}: Props) {
  // Normalize input to a [tag, list][] array, preserving general-first order.
  let buckets: { tag: string; list: RecRestaurant[] }[];
  if (isMap(items)) {
    const knownOrdered = BUCKET_ORDER
      .filter((t) => Array.isArray(items[t]))
      .map((t) => ({ tag: t, list: items[t] as RecRestaurant[] }));
    const extras = Object.keys(items)
      .filter((t) => !BUCKET_ORDER.includes(t) && Array.isArray(items[t]))
      .map((t) => ({ tag: t, list: items[t] as RecRestaurant[] }));
    buckets = [...knownOrdered, ...extras];
  } else {
    buckets = [{ tag: 'general', list: items || [] }];
  }

  // If every bucket is empty, render nothing (matches old null-return behaviour).
  const hasAny = buckets.some((b) => b.list && b.list.length > 0);
  if (!hasAny) return null;

  const isKo = language === 'ko';
  const sectionLabelFor = (tag: string): string => {
    if (tag === 'general') return labelGeneralSection || labelTitle || 'Recommended';
    if (tag === 'vegan') return labelVeganSection || 'Vegan picks';
    if (tag === 'halal') return labelHalalSection || 'Halal picks';
    // Unknown tag — capitalize first letter as fallback header.
    return tag.charAt(0).toUpperCase() + tag.slice(1);
  };

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

      {buckets.map(({ tag, list }) => {
        // Hide bucket entirely if list is empty AND it's `general` (avoid noise).
        // For dietary buckets we DO show an empty-state hint — user explicitly
        // selected the diet so silence would be confusing (CLAUDE.md F: 제주
        // vegan 0건 케이스).
        if (!list || list.length === 0) {
          if (tag === 'general') return null;
          return (
            <div key={tag} className="mb-4">
              <h3 className="text-[14px] font-semibold text-white/85 mb-2 px-1">
                {sectionLabelFor(tag)}
              </h3>
              <p className="text-[12px] text-white/45 px-1">
                {labelEmptyBucket || 'No matching spots in our verified database for this diet in this area yet.'}
              </p>
            </div>
          );
        }

        return (
          <div key={tag} className="mb-5 last:mb-0">
            <h3 className="text-[14px] font-semibold text-white/85 mb-2 px-1">
              {sectionLabelFor(tag)}
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              {list.map((r, i) => {
                const displayName = isKo ? r.name : (r.nameEn || r.name);
                const cuisine = isKo ? (r.cuisineKo || r.cuisine) : (r.cuisine || r.cuisineKo);
                const district = isKo ? (r.dong || '') : (r.dongEn || r.dong || '');
                return (
                  <article
                    key={r.placeId || `${tag}-${r.name}-${i}`}
                    className="bg-white/[0.04] border border-white/[0.08] rounded-xl p-3.5 hover:bg-white/[0.07] hover:border-[#7C5CFC]/40 transition-colors"
                  >
                    <div className="flex items-start justify-between gap-2 mb-1.5">
                      <div className="min-w-0 flex-1">
                        <h4 className="text-[14px] font-bold text-white leading-tight">{displayName}</h4>
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
          </div>
        );
      })}
    </section>
  );
}
