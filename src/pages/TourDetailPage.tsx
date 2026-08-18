// ─────────────────────────────────────────────────────────────────────────────
// CocoTrip – 공개 투어 상세 편집형 안내서
// ─────────────────────────────────────────────────────────────────────────────
import { useParams, Link } from 'react-router-dom';
import { useState, useEffect, type ReactNode } from 'react';
import { trackViewItem, trackBookNow } from '@/lib/analytics';
import { trackAffiliateClick } from '@/lib/affiliateTracking';
import { AffiliateCard } from '@/components/AffiliateCard';
import { buildTourJsonLd } from './buildTourJsonLd';
import { useJsonLd } from '@/hooks/useJsonLd';
import { buildBreadcrumbJsonLd } from '@/lib/jsonLd';
import { buildGallerySlides } from './buildGallerySlides';
import {
  ArrowLeft, Clock, Users, Star, CheckCircle2,
  CalendarCheck, Package, ChevronRight, Languages,
  ShieldCheck, CreditCard, ExternalLink, ChevronLeft, Moon,
  ChevronDown, AlertTriangle,
} from 'lucide-react';
import { useLanguage } from '@/hooks/useLanguage';
import { usePageMeta } from '@/hooks/usePageMeta';
import { TOUR_CUTOFF_HOURS } from '@/lib/bookingCutoff';
import { Header } from '@/sections/Header';
import { getRecommendedHotels } from '@/data/hotels';
import { ReviewList } from '@/components/ReviewList';
import { TourStopList } from '@/components/tours/TourStopList';
import { TourStopMap } from '@/components/tours/TourStopMap';
import { TourBookingDialog } from '@/components/tours/TourBookingDialog';
import { RefundPolicyModal } from '@/components/tours/RefundPolicyModal';
import { IncludedExcluded } from '@/components/tours/IncludedExcluded';
import { MeetingPointCard } from '@/components/tours/MeetingPointCard';
import { TourFAQ } from '@/components/tours/TourFAQ';
import { SuitabilityChips } from '@/components/tours/SuitabilityChips';
import { useTourRating } from '@/hooks/useTourRating';
import { useTourRatingAggregates } from '@/hooks/useTourRatingAggregates';
import { useTour } from '@/hooks/useTour';
import { EcEmpty, EcError, EcLoading } from '@/components/ui/states';
import { pickTourDetailEditorialCopy } from './tourDetailEditorialCopy';
import { TOUR_REGIONS } from '@/data/tours';
import type { I18nString, DriverLanguage, TourPhoto } from '@/data/tours';
import type { Language, Translations } from '@/i18n';
import '@/styles/editorial-tour-detail.css';

function TourDetailShell({
  language,
  t,
  onLanguageChange,
  children,
}: {
  language: Language;
  t: Translations;
  onLanguageChange: (language: Language) => void;
  children: ReactNode;
}) {
  return (
    <div className="tour-detail-editorial" data-testid="tour-detail-shell">
      <div className="ec-root"><Header language={language} t={t} onLanguageChange={onLanguageChange} /></div>
      {children}
    </div>
  );
}

const DRIVER_LANG_LABEL: Record<DriverLanguage, string> = {
  en: 'EN',
  ja: 'JA',
  zh: 'ZH',
};

function txt(field: I18nString, lang: Language): string {
  return field[lang] || field.en;
}

const VEHICLE_KEY: Record<string, 'staria' | 'sprinter' | 'sprinterMid' | 'bus'> = {
  Staria:     'staria',
  Sprinter:   'sprinter',
  SprinterMid:'sprinterMid',
  Bus:        'bus',
};

const VEHICLE_FALLBACK: Record<string, string> = {
  Staria:     'Staria (max 7 pax)',
  Sprinter:   'Sprinter (max 10 pax)',
  SprinterMid:'Sprinter Mid (max 7 pax)',
  Bus:        'Bus (max 30 pax)',
};

// ─────────────────────────────────────────────────────────────────────────────
// buildTourJsonLd → src/pages/buildTourJsonLd.ts 로 분리 (firebase-free 순수 모듈, PR-B CI fix:
//   테스트가 TourDetailPage 전체 import 시 firebase getAuth() CI throw → 순수 모듈 격리).

// ─────────────────────────────────────────────────────────────────────────────
export default function TourDetailPage() {
  const { slug } = useParams<{ slug: string }>();
  const { language, t, changeLanguage } = useLanguage();
  const copy = pickTourDetailEditorialCopy(language);

  // Phase 1 (2026-05-19): Firestore 우선 + 정적 폴백. tour 가 있으면 즉시 paint.
  const { tour, loading, error, source, retry } = useTour(slug);
  const hotels = tour ? getRecommendedHotels(tour.region, 3) : [];

  // 별점 소스 우선순위: Google(키 있으면) > 내부 실후기 집계(published) > static.
  // 내부 published 리뷰 집계(count>0)면 그걸 fallback 으로 → 실 고객 별점이 배지에 반영.
  const ratingAgg = useTourRatingAggregates()[slug || ''];
  const hasInternal = !!ratingAgg && ratingAgg.count > 0;
  const resolvedRating = useTourRating(tour?.id || '', {
    rating: hasInternal ? ratingAgg.rating : tour?.rating,
    reviewCount: hasInternal ? ratingAgg.count : tour?.reviewCount,
    reviewSource: hasInternal ? 'internal' : tour?.reviewSource,
  });

  const backLabel =
    language === 'ko' ? '투어 목록' :
    language === 'ja' ? 'ツアー一覧' :
    language === 'zh' ? '旅游列表' : 'Tours';

  const permissionDenied = Boolean(error && (
    (error as Error & { code?: string }).code === 'permission-denied'
    || (error as Error & { code?: string }).code === 'firestore/permission-denied'
  ));
  const fallbackMetaTitle = loading
    ? copy.loadingTitle
    : permissionDenied
      ? copy.permissionTitle
      : error
        ? copy.errorTitle
        : copy.notFoundTitle;
  const fallbackMetaDescription = loading
    ? copy.loadingTitle
    : permissionDenied
      ? copy.permissionBody
      : error
        ? copy.errorBody
        : copy.notFoundBody;

  // SEO (404일 때도 usePageMeta 호출 — hook 순서 고정)
  // usePageMeta 가 '| CocoTrip' 을 붙이므로 여기선 안 붙임 ('X | CocoTrip Tours | CocoTrip' 중복 방지).
  usePageMeta({
    title: tour
      ? `${txt(tour.title, language)} — CocoTrip Tours`
      : fallbackMetaTitle,
    description: tour
      ? txt(tour.summary, language)
      : fallbackMetaDescription,
    // 투어 공유(카톡·페북·X) 미리보기에 투어 사진 노출 — 미전달 시 홈 og-image 로 고정됨.
    ogImage: tour?.images?.[0],
    ogUrl: slug ? `https://cocotripkr.com/tours/${slug}` : undefined,
  });

  // GA4: view_item
  useEffect(() => {
    if (tour && slug) {
      trackViewItem(slug, txt(tour.title, language), tour.priceFrom);
    }
  }, [slug]); // eslint-disable-line react-hooks/exhaustive-deps

  // Schema.org Product JSON-LD (inject/cleanup)
  useEffect(() => {
    if (!tour || !slug) return;
    const featureFlag = import.meta.env.VITE_FEATURE_REAL_TOUR_RATINGS === 'true';
    const script = document.createElement('script');
    script.type = 'application/ld+json';
    script.id = 'tour-jsonld';
    script.textContent = JSON.stringify(buildTourJsonLd({
      slug,
      tourTitle: txt(tour.title, 'en'),
      tourSummary: txt(tour.summary, 'en'),
      tourImage: tour.images[0] || 'https://cocotripkr.com/og-image.png',
      tourPrice: tour.priceFrom,
      rating: resolvedRating.rating,
      reviewCount: resolvedRating.reviewCount,
      // 내부 실후기(published)면 온페이지 배지와 동일하게 JSON-LD 도 aggregateRating 노출(실데이터).
      featureFlag: resolvedRating.reviewSource === 'internal' || featureFlag,
    }));
    // Remove old if exists
    document.getElementById('tour-jsonld')?.remove();
    document.head.appendChild(script);
    return () => { script.remove(); };
  }, [slug, tour, resolvedRating]);

  // 빵부스러기 — Product 와 달리 위치 정보라 영어 고정(전역 스키마·URL 과 같은 축).
  useJsonLd('tour-breadcrumb', tour && slug
    ? buildBreadcrumbJsonLd([['CocoTrip', '/'], ['Tours', '/tours'], [txt(tour.title, 'en'), `/tours/${slug}`]])
    : null);

  if (!tour && loading) {
    return (
      <TourDetailShell language={language} t={t} onLanguageChange={changeLanguage}>
        <main className="ec-root ec-container tour-detail-state" data-testid="tour-detail-nonpayment">
          <div className="tour-detail-state-panel tour-detail-loading-grid" data-testid="tour-detail-loading">
            <div className="tour-detail-loading-media animate-pulse bg-ec-sunken" aria-hidden />
            <div className="self-center p-2">
              <h1 className="ec-h3 mb-4">{copy.loadingTitle}</h1>
              <EcLoading label={copy.loadingTitle} lines={5} />
            </div>
          </div>
        </main>
      </TourDetailShell>
    );
  }

  if (!tour && error) {
    const title = permissionDenied ? copy.permissionTitle : copy.errorTitle;
    const body = permissionDenied ? copy.permissionBody : copy.errorBody;
    const testId = permissionDenied ? 'tour-detail-permission' : 'tour-detail-error';
    return (
      <TourDetailShell language={language} t={t} onLanguageChange={changeLanguage}>
        <main className="ec-root ec-container tour-detail-state" data-testid="tour-detail-nonpayment">
          <div className="tour-detail-state-panel" data-testid={testId}>
            <EcError
              title={title}
              body={body}
              retryLabel={permissionDenied ? undefined : copy.retry}
              onRetry={permissionDenied ? undefined : retry}
              secondary={<Link to="/tours" className="ec-btn ec-btn-secondary">{copy.browseTours}</Link>}
            />
          </div>
        </main>
      </TourDetailShell>
    );
  }

  // ── 404 ──────────────────────────────────────────────────────────────────
  if (!tour) {
    return (
      <TourDetailShell language={language} t={t} onLanguageChange={changeLanguage}>
        <main className="ec-root ec-container tour-detail-state" data-testid="tour-detail-nonpayment">
          <div className="tour-detail-state-panel" data-testid="tour-detail-not-found">
            <EcError
              title={copy.notFoundTitle}
              body={copy.notFoundBody}
              secondary={<Link to="/tours" className="ec-btn ec-btn-secondary">{copy.browseTours}</Link>}
            />
          </div>
        </main>
      </TourDetailShell>
    );
  }

  // ── 번역 ─────────────────────────────────────────────────────────────────
  const title       = txt(tour.title, language);
  const summary     = txt(tour.summary, language);
  const description = txt(tour.description, language);
  const regionLabel = TOUR_REGIONS.find((region) => region.key === tour.region);
  const region = regionLabel ? txt(regionLabel.label, language) : tour.region;

  const durationLabel = (() => {
    const d = tour.durationDays;
    const n = d - 1;
    if (d === 1) {
      return language === 'ko' ? '당일' : language === 'ja' ? '日帰り' : language === 'zh' ? '当天' : '1 Day';
    }
    if (language === 'ko') return `${d}일 ${n}박`;
    if (language === 'ja') return `${d}日${n}泊`;
    if (language === 'zh') return `${d}天${n}晚`;
    return `${d}D${n}N`;
  })();

  const fromLabel = language === 'ko' ? '최저가' : language === 'ja' ? '最低価格' : language === 'zh' ? '起价' : 'From';
  const bookLabel = language === 'ko' ? '지금 예약하기' : language === 'ja' ? '今すぐ予約' : language === 'zh' ? '立即预订' : 'Book Now';
  const highlightTitle = copy.highlightsLabel;
  const overviewTitle  = copy.overviewLabel;
  const itineraryTitle = copy.itineraryLabel;
  const hotelTitle     = language === 'ko' ? '추천 숙소' : language === 'ja' ? 'おすすめ宿泊施設' : language === 'zh' ? '推荐住宿' : 'Recommended Stays';
  const hotelSub       = language === 'ko' ? '투어와 함께 예약하면 더 편리해요' : language === 'ja' ? 'ツアーと一緒に予約してスムーズに' : language === 'zh' ? '与旅游同时预订，出行更便捷' : 'Book together for a seamless trip';
  const hotelFrom      = language === 'ko' ? '최저' : language === 'ja' ? 'から' : language === 'zh' ? '起' : 'from';
  const hotelNight     = language === 'ko' ? '/ 박' : language === 'ja' ? '/ 泊' : language === 'zh' ? '/ 晚' : '/ night';
  const hotelBtn       = language === 'ko' ? 'Trip.com에서 보기' : language === 'ja' ? 'Trip.comで見る' : language === 'zh' ? '在Trip.com查看' : 'View on Trip.com';
  const hotelDiscl     = language === 'ko' ? '* 예약 완료 시 코코트립에 수수료가 지급됩니다' : language === 'ja' ? '* 予約完了時にCocoTripに手数料が支払われます' : language === 'zh' ? '* 预订完成后CocoTrip将获得佣金' : '* CocoTrip earns a commission on completed bookings';
  const noHiddenFees   = language === 'ko' ? '톨비·주차 포함' : language === 'ja' ? '通行料·駐車込み' : language === 'zh' ? '含过路费·停车费' : 'Tolls · Parking incl.';
  const paypalLabel    = language === 'ko' ? 'PayPal 안심결제' : language === 'ja' ? 'PayPal 安全決済' : language === 'zh' ? 'PayPal 安全支付' : 'PayPal Secure Pay';
  // 예약 마감 정책 안내 (가격 카드 옆).
  // 🔴 2026-07-30: "전 상품 12h 통일" 이라는 옛 주석과 문구가 그대로 남아 있었다. 실제 서버
  //   SSOT(api/_shared/booking-cutoff.js = lib/bookingCutoff)는 **투어 8h · 전세차량 1h** 다.
  //   이 페이지는 투어 상세이므로 투어 값에서 파생한다 — 숫자를 손으로 적지 않는다.
  const cutoffNote     = language === 'ko' ? `예약 마감: 출발 ${TOUR_CUTOFF_HOURS}시간 전`
                       : language === 'ja' ? `予約締切: 出発${TOUR_CUTOFF_HOURS}時間前`
                       : language === 'zh' ? `预订截止：出发前${TOUR_CUTOFF_HOURS}小时`
                       : `Booking closes ${TOUR_CUTOFF_HOURS}h before departure`;

  return (
    <TourDetailShell language={language} t={t} onLanguageChange={changeLanguage}>
      <main className="ec-root tour-detail-nonpayment" data-testid="tour-detail-nonpayment">
        <div className="ec-container-wide">
          <nav className="tour-detail-breadcrumb" aria-label={copy.documentLabel}>
            <Link to="/tours"><ArrowLeft className="h-4 w-4" />{backLabel}</Link>
            <ChevronRight className="h-4 w-4" aria-hidden />
            <span className="tour-detail-breadcrumb-current">{title}</span>
          </nav>

          <header className="tour-detail-masthead" data-testid="tour-detail-ready">
            <div className="tour-detail-masthead-copy">
              <p className="ec-eyebrow">{copy.documentLabel} · {region}</p>
              <h1 className="ec-display mt-4" data-testid="tour-detail-heading">{title}</h1>
              <p className="ec-body tour-detail-masthead-summary">{summary}</p>
            </div>
            {tour.suitability && <SuitabilityChips suitability={tour.suitability} language={language} />}
          </header>

          {source === 'static' && error && (
            <div className="tour-detail-partial" data-testid="tour-detail-partial" role="status">
              <AlertTriangle className="h-5 w-5" aria-hidden />
              <div><strong className="text-ec-ink">{copy.partialTitle}</strong><p className="ec-body-sm mt-1">{copy.partialBody}</p></div>
            </div>
          )}

          <section className="tour-detail-stage" aria-label={copy.factsLabel}>
            <ImageGallery
              key={tour.slug}
              images={tour.images}
              photos={tour.photos}
              title={title}
              isNight={tour.isNightTour}
              language={language}
              emptyLabel={copy.imageUnavailable}
              nightLabel={copy.nightTourLabel}
            />
            <aside className="tour-detail-facts">
              <p className="ec-eyebrow">{copy.factsLabel}</p>
              <div className="tour-detail-facts-list">
                <div className="tour-detail-fact"><Clock className="h-5 w-5" /><strong>{durationLabel}</strong></div>
                <div className="tour-detail-fact"><Users className="h-5 w-5" /><strong>{t.vehicle?.[VEHICLE_KEY[tour.vehicleType]] || VEHICLE_FALLBACK[tour.vehicleType]}</strong></div>
                <div className="tour-detail-fact"><Languages className="h-5 w-5" /><span><strong>{copy.driverLanguagesLabel}</strong><br />{((tour.driverLanguages && tour.driverLanguages.length > 0) ? tour.driverLanguages : (['en'] as DriverLanguage[])).map((driverLanguage) => DRIVER_LANG_LABEL[driverLanguage]).join(' · ')}</span></div>
                {(resolvedRating.reviewSource === 'internal' || import.meta.env.VITE_FEATURE_REAL_TOUR_RATINGS === 'true') && resolvedRating.rating && resolvedRating.rating > 0 && (
                  <div className="tour-detail-fact"><Star className="h-5 w-5" /><strong>{resolvedRating.rating.toFixed(1)}{resolvedRating.reviewCount ? ` (${resolvedRating.reviewCount})` : ''}</strong></div>
                )}
              </div>
            </aside>
          </section>

          <div className="tour-detail-content-grid">
            <article className="tour-detail-article">
              <section className="tour-detail-section">
                <h2 className="ec-h2 tour-detail-section-heading">{highlightTitle}</h2>
                <ul className="tour-detail-highlights">
                  {tour.highlights.map((highlight, index) => (
                    <li key={index} className="tour-detail-highlight"><CheckCircle2 className="h-5 w-5 shrink-0" /><span>{txt(highlight.text, language)}</span></li>
                  ))}
                </ul>
              </section>

              <section className="tour-detail-section">
                <h2 className="ec-h2 tour-detail-section-heading">{overviewTitle}</h2>
                <p className="ec-body ec-measure">{description}</p>
              </section>

              {tour.video_embed_url && (
                <section className="tour-detail-section">
                  <iframe src={tour.video_embed_url} className="tour-detail-video" title={title} allow="accelerometer; clipboard-write; encrypted-media; picture-in-picture" allowFullScreen loading="lazy" />
                </section>
              )}

              <section className="tour-detail-section">
                <IncludedExcluded language={language} includedExtra={tour.included} excludedExtra={tour.excluded} excludedExtraKeys={tour.durationDays === 1 ? ['tourDetail.airportPickup'] : []} />
              </section>

              <section className="tour-detail-section">
                <h2 className="ec-h2 tour-detail-section-heading">{itineraryTitle}</h2>
                {tour.stops && tour.stops.length > 0 ? (
                  <><TourStopMap stops={tour.stops} language={language} title={itineraryTitle} /><TourStopList stops={tour.stops} language={language} /></>
                ) : (
                  <div className="tour-detail-empty-itinerary" data-testid="tour-itinerary-empty">
                    <EcEmpty title={copy.itineraryEmptyTitle} body={copy.itineraryEmptyBody} />
                  </div>
                )}
              </section>

              {tour.meeting_point && <MeetingPointCard meeting_point={tour.meeting_point} language={language} />}
              <TourExtraInfo whatToBring={tour.what_to_bring} importantInfo={tour.important_info} suitabilityNotes={tour.suitability?.notes} language={language} />
              {tour.faqs && tour.faqs.length > 0 && <TourFAQ faqs={tour.faqs} language={language} />}
            </article>

            {hotels.length > 0 && (
              <section className="tour-detail-section tour-detail-hotel-section">
                <div className="tour-detail-hotel-heading">
                  <div><h2 className="ec-h2">{hotelTitle}</h2><p className="ec-body-sm mt-2">{hotelSub}</p></div>
                  <span className="ec-chip">Trip.com</span>
                </div>
                <div className="tour-detail-hotel-grid">
                  {hotels.map((hotel) => {
                    const location = hotel.location[language] || hotel.location.en;
                    return (
                      <AffiliateCard key={hotel.id} payload={{ product: 'hotel', placement: 'tour_detail_hotels', language, city: String(hotel.region || '').toLowerCase(), linkKey: hotel.id }}>
                        <a href={hotel.affiliateUrl} target="_blank" rel="noopener noreferrer sponsored" onClick={() => trackAffiliateClick({ product: 'hotel', placement: 'tour_detail_hotels', language, city: String(hotel.region || '').toLowerCase(), linkKey: hotel.id })} className="tour-detail-hotel-card">
                          <div className="tour-detail-hotel-media"><div className="tour-detail-hotel-fallback" aria-hidden>{hotel.region}</div><img src={hotel.tripImage || hotel.thumbnail} alt={hotel.name} loading="lazy" decoding="async" data-image-source={hotel.tripImage ? 'trip' : 'local'} onError={(event) => { const img = event.currentTarget; if (hotel.tripImage && img.dataset.imageSource === 'trip') { img.src = hotel.thumbnail; img.dataset.imageSource = 'local'; return; } img.style.display = 'none'; }} />{hotel.badge && <span className="ec-chip tour-detail-hotel-badge">{hotel.badge[language] || hotel.badge.en}</span>}</div>
                          <div className="tour-detail-hotel-body">
                            <h3 className="text-base font-bold leading-snug text-ec-ink">{hotel.name}</h3><p className="text-sm text-ec-ink-3">{location}</p>
                            <div className="tour-detail-hotel-rating"><Star className="h-4 w-4 text-ec-notice" /><strong>{hotel.rating.toFixed(1)}</strong><span>/10 · {hotel.reviewCount.toLocaleString()}</span></div>
                            <div className="tour-detail-hotel-price"><p className="text-xs text-ec-ink-3">{hotelFrom}</p><p className="ec-figure text-lg">${hotel.priceFrom}<span className="ml-1 text-xs font-normal text-ec-ink-3">{hotelNight}</span></p></div>
                            <span className="tour-detail-hotel-action"><ExternalLink className="h-4 w-4" />{hotelBtn}</span>
                          </div>
                        </a>
                      </AffiliateCard>
                    );
                  })}
                </div>
                <p className="mt-3 text-center text-xs text-ec-ink-3">{hotelDiscl}</p>
              </section>
            )}
          </div>

          <section className="tour-detail-reviews">
            {resolvedRating.rating && resolvedRating.reviewCount && (
              <div className="tour-detail-rating-summary">
                <Star className="h-6 w-6" /><div><div className="flex flex-wrap items-center gap-2"><strong className="ec-figure text-xl">{resolvedRating.rating.toFixed(1)}</strong><span className="ec-body-sm">{language === 'ko' ? `${resolvedRating.reviewCount}개 리뷰` : language === 'ja' ? `${resolvedRating.reviewCount}件のレビュー` : language === 'zh' ? `${resolvedRating.reviewCount}条评论` : `${resolvedRating.reviewCount} reviews`}</span>{resolvedRating.externalUrl ? <a href={resolvedRating.externalUrl} target="_blank" rel="noopener noreferrer" className="tour-detail-rating-source">Google ↗</a> : <span className="tour-detail-rating-source">{resolvedRating.reviewSource === 'google' ? 'Google' : language === 'ko' ? '자체 집계' : language === 'ja' ? '自社集計' : language === 'zh' ? '内部统计' : 'Internal'}</span>}</div></div>
              </div>
            )}
            <ReviewList targetType="tour" targetId={slug || ''} surface="paper" />
          </section>
        </div>
      </main>

      {/* ── 하단 고정 CTA 바 ── */}
      <div
        className="fixed bottom-14 md:bottom-0 left-0 right-0 z-50 px-4 pb-4 md:pb-6 pt-3"
        style={{
          background: 'linear-gradient(to top, rgba(8,11,20,0.98) 0%, rgba(8,11,20,0.90) 60%, transparent 100%)',
          backdropFilter: 'blur(12px)',
        }}
      >
        <div className="tour-detail-booking-meta mb-2.5" data-testid="tour-detail-booking-meta">
          {/* No Hidden Fees + PayPal 배지 */}
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5">
              <ShieldCheck className="w-3.5 h-3.5" style={{ color: '#B668FC' }} />
              <span data-testid="tour-detail-trust-fees" className="text-[10px] font-bold" style={{ color: '#B668FC' }}>
                {noHiddenFees}
              </span>
            </div>
            <span className="w-px h-3 bg-white/10" />
            <div className="flex items-center gap-1.5">
              <CreditCard className="w-3.5 h-3.5" style={{ color: '#FF6B9D' }} />
              <span data-testid="tour-detail-trust-paypal" className="text-[10px] font-bold" style={{ color: 'rgba(255,107,157,0.80)' }}>
                {paypalLabel}
              </span>
            </div>
          </div>

          {/* PR-R (2026-05-08): 예약 마감 정책 안내 — 가격 카드 위에 한 줄 */}
          <p data-testid="tour-detail-cutoff-note" className="mt-1.5 text-[10px] text-white/55">📅 {cutoffNote}</p>
        </div>

        {/* 가격 + 예약 버튼 */}
        <div className="flex items-center gap-3">
          <div
            className="flex-1 px-4 py-3 rounded-2xl"
            style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)' }}
          >
            <p className="text-[10px] text-white/55 uppercase tracking-wider mb-0.5">{fromLabel}</p>
            <p className="text-[20px] font-black text-white leading-none">
              ${tour.priceFrom.toLocaleString()}
              <span className="text-[11px] text-white/55 font-medium ml-1">USD</span>
              {tour.priceUnit === 'per_person' && (
                <span className="text-[11px] text-white/70 font-medium ml-1">
                  {language === 'ko' ? '/인' : language === 'ja' ? '/人' : language === 'zh' ? '/人' : '/person'}
                </span>
              )}
            </p>
            <RefundPolicyModal
              language={language}
              trigger={
                <button className="text-[10px] text-white/55 hover:text-white/70 underline-offset-2 hover:underline mt-1 text-left">
                  {language === 'ko' ? '취소·환불 정책' : language === 'ja' ? 'キャンセル・返金' : language === 'zh' ? '取消政策' : 'Cancellation policy'}
                </button>
              }
            />
          </div>
          <TourBookingDialog
            tour={tour}
            language={language}
            trigger={
              <button
                type="button"
                className="flex items-center gap-2 px-5 py-4 rounded-2xl font-bold text-[14px] text-white"
                style={{ background: 'linear-gradient(135deg, #B668FC, #FF6B9D)' }}
                onClick={() => trackBookNow('tour')}
              >
                <CalendarCheck className="w-4 h-4" />
                {bookLabel}
              </button>
            }
          />
        </div>
      </div>
    </TourDetailShell>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 이미지 갤러리 컴포넌트 (터치/클릭 슬라이더)
// ─────────────────────────────────────────────────────────────────────────────
interface ImageGalleryProps {
  images: string[];
  /** 어드민 투어 photos[] (webp variants 보유) — 있으면 images 대신 srcset 렌더 */
  photos?: TourPhoto[];
  title: string;
  isNight?: boolean;
  language: Language;
  emptyLabel: string;
  nightLabel: string;
}

function ImageGallery({ images, photos, title, isNight, language, emptyLabel, nightLabel }: ImageGalleryProps) {
  const { t } = useLanguage();
  const [current, setCurrent] = useState(0);
  const [touchStartX, setTouchStartX] = useState(0);
  const slides = buildGallerySlides(images, photos);
  const total = slides.length;

  const prev = () => {
    if (total < 2) return;
    setCurrent((currentIndex) => (currentIndex - 1 + total) % total);
  };
  const next = () => {
    if (total < 2) return;
    setCurrent((currentIndex) => (currentIndex + 1) % total);
  };

  const handleTouchStart = (e: React.TouchEvent) => setTouchStartX(e.touches[0].clientX);
  const handleTouchEnd = (e: React.TouchEvent) => {
    const diff = touchStartX - e.changedTouches[0].clientX;
    if (Math.abs(diff) <= 40) return;
    if (diff > 0) next();
    else prev();
  };

  return (
    <div
      className="tour-detail-gallery"
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
      role="region"
      aria-label={title}
      aria-roledescription={language === 'ko' ? '이미지 슬라이드' : language === 'ja' ? '画像スライド' : language === 'zh' ? '图片轮播' : 'image carousel'}
    >
      {/* 슬라이드 이미지들 — srcSet 은 variants 있는 photos[] 일 때만 (없으면 omit) */}
      {slides.length === 0 && <div className="tour-detail-gallery-empty"><Package className="h-5 w-5" />{emptyLabel}</div>}
      {slides.map((slide, i) => (
        <div
          key={i}
          className="tour-detail-gallery-slide"
          style={{ opacity: i === current ? 1 : 0, pointerEvents: i === current ? 'auto' : 'none' }}
          aria-hidden={i !== current}
        >
          <img
            src={slide.src}
            srcSet={slide.srcSet}
            sizes={slide.srcSet ? '100vw' : undefined}
            alt={`${title} ${i + 1}`}
            loading={i === 0 ? 'eager' : 'lazy'}
          />
        </div>
      ))}

      {/* 나이트투어 뱃지 */}
      {isNight && (
        <div className="tour-detail-gallery-badge">
          <Moon className="h-4 w-4 text-ec-brand" />
          <span>{nightLabel}</span>
        </div>
      )}

      {/* 좌우 화살표 (이미지 2장 이상일 때만) */}
      {total > 1 && (
        <>
          <button
            type="button"
            onClick={prev}
            className="tour-detail-gallery-control tour-detail-gallery-control-prev"
            aria-label={t.a11y?.previousImage || 'Previous image'}
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
          <button
            type="button"
            onClick={next}
            className="tour-detail-gallery-control tour-detail-gallery-control-next"
            aria-label={t.a11y?.nextImage || 'Next image'}
          >
            <ChevronRight className="h-5 w-5" />
          </button>

          {/* 하단 인디케이터 점 — slides 기준(2026-07-17: photos[] 만 있는 admin 투어에서 images 기준이면 점 0개/개수 불일치) */}
          <div className="tour-detail-gallery-dots">
            {slides.map((_, i) => (
              <button
                key={i}
                type="button"
                onClick={() => setCurrent(i)}
                className="tour-detail-gallery-dot"
                aria-current={i === current}
                aria-label={`${t.a11y?.goToImage || 'Go to image'} ${i + 1}`}
              ><span className="tour-detail-gallery-dot-mark" aria-hidden /></button>
            ))}
          </div>

          {/* 카운터 (우상단) */}
          <div className="tour-detail-gallery-count">
            {current + 1} / {total}
          </div>
        </>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// TourExtraInfo — 준비물 / 중요 정보 / 적합성 안내 accordion
// (Phase 1, 2026-05-19) — 데이터 있는 항목만 렌더
// ─────────────────────────────────────────────────────────────────────────────
function TourExtraInfo({
  whatToBring, importantInfo, suitabilityNotes, language,
}: {
  whatToBring?: I18nString;
  importantInfo?: I18nString;
  suitabilityNotes?: I18nString;
  language: Language;
}) {
  const items: Array<{ key: string; icon: string; titleByLang: Record<Language, string>; content: string }> = [];

  const getText = (f: I18nString | undefined): string => f ? (f[language] || f.en || f.ko || '') : '';

  const importantTxt = getText(importantInfo);
  if (importantTxt) {
    items.push({
      key: 'important',
      icon: '⚠️',
      titleByLang: { ko: '중요 안내', en: 'Important info', ja: '重要なお知らせ', zh: '重要信息' },
      content: importantTxt,
    });
  }

  const whatToBringTxt = getText(whatToBring);
  if (whatToBringTxt) {
    items.push({
      key: 'what-to-bring',
      icon: '🎒',
      titleByLang: { ko: '준비물', en: 'What to bring', ja: '持ち物', zh: '携带物品' },
      content: whatToBringTxt,
    });
  }

  const suitNotesTxt = getText(suitabilityNotes);
  if (suitNotesTxt) {
    items.push({
      key: 'suitability',
      icon: '🧭',
      titleByLang: { ko: '적합성 안내', en: 'Suitability notes', ja: '適性に関するご案内', zh: '适合人群说明' },
      content: suitNotesTxt,
    });
  }

  if (items.length === 0) return null;

  return (
    <section className="tour-detail-section">
      <div className="space-y-2">
        {items.map((item) => (
          <ExtraInfoItem key={item.key} item={item} language={language} />
        ))}
      </div>
    </section>
  );
}

function ExtraInfoItem({
  item, language,
}: {
  item: { key: string; icon: string; titleByLang: Record<Language, string>; content: string };
  language: Language;
}) {
  const [open, setOpen] = useState(false);
  const title = item.titleByLang[language] || item.titleByLang.en;

  return (
    <div className="tour-detail-extra-card overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="tour-detail-accordion-button"
        aria-expanded={open}
      >
        <span className="flex items-center gap-2 text-sm font-semibold text-ec-ink">
          <span aria-hidden>{item.icon}</span>
          {title}
        </span>
        <ChevronDown
          className={`h-4 w-4 shrink-0 text-ec-ink-3 transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>
      {open && (
        <div className="border-t border-ec-line px-4 pb-4 pt-3">
          <p className="whitespace-pre-line text-sm leading-relaxed text-ec-ink-2">
            {item.content}
          </p>
        </div>
      )}
    </div>
  );
}
