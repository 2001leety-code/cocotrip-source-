import { Link } from 'react-router-dom';
import { ChevronRight, Clock, Images, Languages, Moon, Star, Users } from 'lucide-react';
import { WishlistToggle } from '@/components/WishlistButton';
import { getSeasonalTip } from '@/data/tourSeasons';
import { publicBadgeTag } from '@/data/tours';
import type { DriverLanguage, I18nString, Tour, TourTag } from '@/data/tours';
import { useTourRatingAggregates } from '@/hooks/useTourRatingAggregates';
import { translations, type Language } from '@/i18n';
import { CALCULATOR_KRW_PER_USD } from '@/lib/calculator';
import { formatPrice } from '@/lib/exchange-rate';

const DRIVER_LANG_LABEL: Record<DriverLanguage, string> = { en: 'EN', ja: 'JA', zh: 'ZH' };

interface TourCardProps {
  tour: Tour;
  language: Language;
}

function txt(field: I18nString, language: Language): string {
  return field[language] || field.en;
}

const VEHICLE_LABEL: Record<Tour['vehicleType'], { label: string; pax: number }> = {
  Staria: { label: 'Staria', pax: 7 },
  Sprinter: { label: 'Sprinter', pax: 10 },
  SprinterMid: { label: 'Sprinter Mid', pax: 7 },
  Bus: { label: 'Bus', pax: 30 },
};

const PER_PERSON_LABEL: Record<Language, string> = {
  ko: '/인',
  en: '/person',
  ja: '/人',
  zh: '/人',
};

type PublicTourTag = Exclude<TourTag, 'Popular' | 'AI-Curated' | 'Best Value'>;

const TAG_LABEL: Record<PublicTourTag, Record<Language, string>> = {
  New: { ko: '신규', en: 'NEW', ja: '新着', zh: '新品' },
  'Multi-City': { ko: '다도시', en: 'MULTI-CITY', ja: '複数都市', zh: '多城市' },
  'Night Tour': { ko: '야경 투어', en: 'NIGHT TOUR', ja: '夜景ツアー', zh: '夜景游' },
  Nature: { ko: '자연', en: 'NATURE', ja: '自然', zh: '自然' },
  History: { ko: '역사·문화', en: 'HISTORY', ja: '歴史・文化', zh: '历史文化' },
};

function tagLabel(tag: string, language: Language): string | null {
  const entry = (TAG_LABEL as Record<string, Record<Language, string> | undefined>)[tag];
  return entry ? entry[language] : null;
}

const NIGHT_LABEL: Record<Language, string> = {
  ko: '야경',
  en: 'NIGHT',
  ja: '夜景',
  zh: '夜景',
};

const INCLUDED_LABELS: ReadonlyArray<Record<Language, string>> = [
  { ko: '연료비', en: 'Fuel', ja: '燃料費', zh: '燃油费' },
  { ko: '톨비', en: 'Tolls', ja: '通行料', zh: '过路费' },
  { ko: '주차비', en: 'Parking', ja: '駐車場', zh: '停车费' },
];

const FACT_LABELS: Record<Language, { duration: string; vehicle: string }> = {
  ko: { duration: '소요 시간', vehicle: '차량 및 정원' },
  en: { duration: 'Duration', vehicle: 'Vehicle and capacity' },
  ja: { duration: '所要時間', vehicle: '車両・定員' },
  zh: { duration: '行程时长', vehicle: '车辆及人数' },
};

function imageCountLabel(count: number, language: Language): string {
  if (language === 'ko') return `이미지 ${count}장`;
  if (language === 'ja') return `画像${count}枚`;
  if (language === 'zh') return `${count}张图片`;
  return `${count} images`;
}

export function TourCard({ tour, language }: TourCardProps) {
  const title = txt(tour.title, language);
  const summary = txt(tour.summary, language);
  const vehicle = VEHICLE_LABEL[tour.vehicleType];
  const durationLabel = (() => {
    if (tour.durationDays === 1 && tour.durationHours) {
      if (language === 'ko') return `약 ${tour.durationHours}시간`;
      if (language === 'ja') return `約${tour.durationHours}時間`;
      if (language === 'zh') return `约${tour.durationHours}小时`;
      return `~${tour.durationHours}h`;
    }
    const days = tour.durationDays;
    const nights = days - 1;
    if (days === 1) return language === 'ko' ? '당일' : language === 'ja' ? '日帰り' : language === 'zh' ? '当天' : '1 Day';
    if (language === 'ko') return `${days}일 ${nights}박`;
    if (language === 'ja') return `${days}日${nights}泊`;
    if (language === 'zh') return `${days}天${nights}晚`;
    return `${days}D${nights}N`;
  })();

  const fromLabel = language === 'ko' ? '최저' : language === 'ja' ? 'から' : language === 'zh' ? '起' : 'from';
  const detailLabel = language === 'ko' ? '자세히 보기' : language === 'ja' ? '詳しく見る' : language === 'zh' ? '查看详情' : 'View Details';
  const primaryTag = publicBadgeTag(tour.tags);
  const isNight = tour.isNightTour === true;
  const badgeLabel = primaryTag && !(isNight && primaryTag === 'Night Tour')
    ? tagLabel(primaryTag, language)
    : null;
  const seasonalTip = getSeasonalTip(tour.id, new Date().getMonth() + 1, language);
  const ratingAggregate = useTourRatingAggregates()[tour.slug];
  const staticRatingEnabled = import.meta.env.VITE_FEATURE_REAL_TOUR_RATINGS === 'true'
    && !!tour.rating
    && tour.rating > 0;
  const displayRating = ratingAggregate && ratingAggregate.count > 0
    ? ratingAggregate.rating
    : staticRatingEnabled ? tour.rating : null;
  const displayCount = ratingAggregate && ratingAggregate.count > 0
    ? ratingAggregate.count
    : staticRatingEnabled ? tour.reviewCount : undefined;
  const driverLanguages = tour.driverLanguages && tour.driverLanguages.length > 0
    ? tour.driverLanguages
    : (['en'] as DriverLanguage[]);

  return (
    <article className="tour-catalog-card group">
      <Link to={`/tours/${tour.slug}`} className="tour-catalog-card-link">
        <div className="tour-card-media tour-catalog-card-media">
        <img src={tour.thumbnail} alt={title} loading="lazy" decoding="async" />

        <div className="tour-catalog-card-badges">
          {isNight && (
            <span className="tour-catalog-card-badge">
              <Moon aria-hidden />
              {NIGHT_LABEL[language]}
            </span>
          )}
          {badgeLabel && <span className="tour-catalog-card-badge">{badgeLabel}</span>}
        </div>

          <div className="tour-catalog-card-tools">
            {tour.images.length > 1 && (
              <span className="tour-catalog-card-image-count" aria-label={imageCountLabel(tour.images.length, language)}>
                <Images aria-hidden />
                {tour.images.length}
              </span>
            )}
          </div>
        </div>

        <div className="tour-catalog-card-body">
        <div className="tour-catalog-card-heading">
          <div>
            <h3 className="line-clamp-2 min-h-[2.75em] break-words">{title}</h3>
            <p className="tour-catalog-card-summary line-clamp-2">{summary}</p>
          </div>
          <div className="tour-catalog-card-price">
            <span>{fromLabel}</span>
            <strong>
              ${tour.priceFrom.toLocaleString()}
              <small>USD</small>
              {tour.priceUnit === 'per_person' && <small>{PER_PERSON_LABEL[language]}</small>}
            </strong>
            <small>
              ≈ {language === 'en'
                ? `₩${Math.round(tour.priceFrom * CALCULATOR_KRW_PER_USD).toLocaleString('ko-KR')}`
                : formatPrice(tour.priceFrom * CALCULATOR_KRW_PER_USD, language)}
              {tour.priceUnit === 'per_person' ? PER_PERSON_LABEL[language] : ''}
            </small>
          </div>
        </div>

        <dl className="tour-catalog-card-facts">
          <div>
            <dt><span className="sr-only">{FACT_LABELS[language].duration}</span><Clock aria-hidden /></dt>
            <dd>{durationLabel}</dd>
          </div>
          <div>
            <dt><span className="sr-only">{FACT_LABELS[language].vehicle}</span><Users aria-hidden /></dt>
            <dd>{vehicle.label} · max {vehicle.pax}</dd>
          </div>
        </dl>

        {seasonalTip && (
          <p className="tour-catalog-card-season" data-tone={seasonalTip.tone}>
            <span aria-hidden>{seasonalTip.emoji}</span>
            {seasonalTip.label}
          </p>
        )}

        <ul className="tour-catalog-card-included" aria-label={language === 'ko' ? '포함 항목' : language === 'ja' ? '含まれる項目' : language === 'zh' ? '包含项目' : 'Included'}>
          {INCLUDED_LABELS.map((item) => <li key={item.en}>✓ {item[language]}</li>)}
        </ul>

        <div className="tour-catalog-card-footer">
          <div className="tour-catalog-card-evidence">
            {displayRating && displayRating > 0 && (
              <span className="tour-catalog-card-rating">
                <Star aria-hidden />
                {displayRating.toFixed(1)}
                {displayCount && displayCount > 0 && <small>({displayCount})</small>}
              </span>
            )}
            <span
              className="tour-catalog-card-languages"
              title={translations[language].a11y?.driverLanguages || 'Driver languages'}
            >
              <Languages aria-hidden />
              {driverLanguages.map((driverLanguage) => DRIVER_LANG_LABEL[driverLanguage]).join('·')}
            </span>
          </div>
          <span className="tour-catalog-card-detail">
            {detailLabel}
            <ChevronRight aria-hidden />
          </span>
        </div>
        </div>
      </Link>
      <span className="tour-catalog-card-wishlist [&>button]:inline-flex [&>button]:items-center [&>button]:justify-center [&>button]:w-11 [&>button]:h-11">
        <WishlistToggle
          productId={tour.id}
          productType="tour"
          name={title}
          priceUSD={tour.priceFrom}
          thumbnailUrl={tour.thumbnail}
          href={`/tours/${tour.slug}`}
          size={16}
        />
      </span>
    </article>
  );
}
