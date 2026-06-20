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
//
// 2026-05-11 (B-3 fix): multi-city section split.
//   - 5/10 prod — 서울+부산 plan 의 추천 식당이 서울만 노출 (부산 0건). backend
//     pickRecommendedRestaurantsByStyle 가 이제 도시별로 5+5 분배 + region tag 부착.
//   - UI: tag bucket 안에서 region 별로 sub-section 분리 ("서울 추천 / 부산 추천").
//   - 단도시 plan (region 필드 없음) 은 기존 단일 grid 유지 (regression 0).
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
  // 2026-05-11 (B-3): backend 가 다도시 plan 시 부착하는 city 태그.
  // e.g. 'seoul' | 'busan' | 'jeju'. 단도시 plan 은 미부착 (undefined).
  region?: string;
};

// City label translations — UI 도시별 sub-section 헤더.
// Backend region tag (lowercase city key) 를 4-lang 라벨로 변환.
const CITY_LABEL: Record<string, Record<'ko'|'en'|'ja'|'zh', string>> = {
  seoul:     { ko: '서울',   en: 'Seoul',     ja: 'ソウル',   zh: '首尔' },
  busan:     { ko: '부산',   en: 'Busan',     ja: '釜山',     zh: '釜山' },
  jeju:      { ko: '제주',   en: 'Jeju',      ja: '済州',     zh: '济州' },
  gyeongju:  { ko: '경주',   en: 'Gyeongju',  ja: '慶州',     zh: '庆州' },
  jeonju:    { ko: '전주',   en: 'Jeonju',    ja: '全州',     zh: '全州' },
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
  // 2026-05-11 (B-3): multi-city sub-section header (e.g. "Seoul picks").
  // {city} placeholder 자동 교체. 단도시 plan 에서는 미사용.
  labelCitySubSection?: string;
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
  labelCitySubSection,
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
        <p className="text-[14px] text-white/55 mt-1 leading-snug">
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
              <p className="text-[14px] text-white/45 px-1">
                {labelEmptyBucket || 'No matching spots in our verified database for this diet in this area yet.'}
              </p>
            </div>
          );
        }

        // 2026-05-11 (B-3): backend 가 region 태그 부착했으면 도시별 sub-section 분리.
        // region 필드 없는 entry 가 1개라도 있으면 단일 grid (legacy 단도시 plan 호환).
        const hasRegionTags = list.some((r) => !!r.region);
        const groups: { region?: string; list: RecRestaurant[] }[] = (() => {
          if (!hasRegionTags) return [{ region: undefined, list }];
          // 순서 유지 — backend 가 entry city 부터 push 했으므로 그 순서 그대로.
          const map = new Map<string, RecRestaurant[]>();
          for (const r of list) {
            const k = r.region || '__nogroup__';
            if (!map.has(k)) map.set(k, []);
            map.get(k)!.push(r);
          }
          return Array.from(map.entries()).map(([region, regionList]) => ({
            region: region === '__nogroup__' ? undefined : region,
            list: regionList,
          }));
        })();

        const isMultiCity = groups.length > 1;
        const citySubSectionTpl = labelCitySubSection || '{city} picks';
        const cityLabelFor = (regionKey: string | undefined): string => {
          if (!regionKey) return '';
          const meta = CITY_LABEL[regionKey];
          const cityName = meta ? meta[language] || meta.en : regionKey;
          return citySubSectionTpl.replace('{city}', cityName);
        };

        return (
          <div key={tag} className="mb-5 last:mb-0">
            <h3 className="text-[14px] font-semibold text-white/85 mb-2 px-1">
              {sectionLabelFor(tag)}
            </h3>
            {groups.map(({ region, list: groupList }) => (
              <div key={region || '__nogroup__'} className={isMultiCity ? 'mb-3 last:mb-0' : ''}>
                {isMultiCity && region && (
                  <h4 className="text-[14px] font-semibold text-[#B9A4FF] mb-2 px-1 flex items-center gap-1">
                    <MapPin className="w-3 h-3" />
                    {cityLabelFor(region)}
                  </h4>
                )}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  {groupList.map((r, i) => {
                    const displayName = isKo ? r.name : (r.nameEn || r.name);
                    const cuisine = isKo ? (r.cuisineKo || r.cuisine) : (r.cuisine || r.cuisineKo);
                    const district = isKo ? (r.dong || '') : (r.dongEn || r.dong || '');
                    return (
                      <article
                        key={r.placeId || `${tag}-${region || 'n'}-${r.name}-${i}`}
                        className="bg-white/[0.04] border border-white/[0.08] rounded-xl p-3.5 hover:bg-white/[0.07] hover:border-[#7C5CFC]/40 transition-colors"
                      >
                        <div className="flex items-start justify-between gap-2 mb-1.5">
                          <div className="min-w-0 flex-1">
                            <h4 className="text-[14px] font-bold text-white leading-tight">{displayName}</h4>
                            {!isKo && r.name !== displayName && (
                              <p className="text-[13px] text-white/55 mt-0.5">{r.name}</p>
                            )}
                          </div>
                          {/* #15 fix: rating null(네이버 수집 미기재) 이면 배지 전체 숨김 */}
                          {r.rating != null && (
                            <div className="shrink-0 inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-md bg-yellow-400/15 border border-yellow-400/30">
                              <Star className="w-3 h-3 text-yellow-300 fill-current" />
                              <span className="text-[13px] font-bold text-yellow-200">{r.rating.toFixed(1)}</span>
                            </div>
                          )}
                        </div>

                        <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
                          {cuisine && (
                            <span className="text-[12px] text-white/65 bg-white/[0.06] border border-white/[0.08] rounded px-1.5 py-0.5">
                              {cuisine}
                            </span>
                          )}
                          {district && (
                            <span className="text-[12px] text-white/55">
                              <MapPin className="w-2.5 h-2.5 inline mr-0.5" />{district}
                            </span>
                          )}
                          {r.reviewCount !== undefined && (
                            <span className="text-[12px] text-white/45">
                              {r.reviewCount.toLocaleString()} {labelReviews || 'reviews'}
                            </span>
                          )}
                        </div>

                        {(r.address || r.nearestStopKm !== undefined) && (
                          <p className="text-[12px] text-white/45 mt-1.5 leading-snug">
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
                            className="inline-flex items-center gap-1 mt-2 text-[13px] text-emerald-300/80 hover:text-emerald-300 min-h-[44px]"
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
            ))}
          </div>
        );
      })}
    </section>
  );
}
