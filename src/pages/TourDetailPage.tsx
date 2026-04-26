// ─────────────────────────────────────────────────────────────────────────────
// CocoTrip – Tour 상세 페이지 (스켈레톤 + 추천 숙소 어필리에이트)
// 세부 일정 본문 채우기는 다음 세션에서 처리
// 통합 시: App.tsx 라우터에 <Route path="/tours/:slug" element={<TourDetailPage />} /> 추가
// ─────────────────────────────────────────────────────────────────────────────
import { useParams, Link } from 'react-router-dom';
import { useState, useEffect } from 'react';
import { trackViewItem } from '@/lib/analytics';
import {
  ArrowLeft, Clock, Users, Star, CheckCircle2,
  MessageSquare, Package, ChevronRight, Languages,
  ShieldCheck, CreditCard, ExternalLink, ChevronLeft, Moon,
} from 'lucide-react';
import { useLanguage } from '@/hooks/useLanguage';
import { useIsMobile } from '@/hooks/use-mobile';
import { usePageMeta } from '@/hooks/usePageMeta';
import { Header } from '@/sections/Header';
import { getTourBySlug } from '@/data/tours';
import { getRecommendedHotels } from '@/data/hotels';
import { ReviewList } from '@/components/ReviewList';
import { TourStopList } from '@/components/tours/TourStopList';
import { TourBookingDialog } from '@/components/tours/TourBookingDialog';
import { RefundPolicyModal } from '@/components/tours/RefundPolicyModal';
import { IncludedExcluded } from '@/components/tours/IncludedExcluded';
import { useTourRating } from '@/hooks/useTourRating';
import type { I18nString, DriverLanguage } from '@/data/tours';
import type { Language } from '@/i18n';

const DRIVER_LANG_LABEL: Record<DriverLanguage, string> = {
  en: 'EN',
  ja: 'JA',
  zh: 'ZH',
};

function txt(field: I18nString, lang: Language): string {
  return field[lang] ?? field.en;
}

const VEHICLE_LABEL: Record<string, string> = {
  Staria:     'Staria (max 8 pax)',
  Sprinter:   'Sprinter (max 10 pax)',
  SprinterMid:'Sprinter Mid (max 8 pax)',
  Bus:        'Bus (max 30 pax)',
};

// ─────────────────────────────────────────────────────────────────────────────
export default function TourDetailPage() {
  const { slug } = useParams<{ slug: string }>();
  const { language, t, changeLanguage } = useLanguage();
  const isMobile = useIsMobile();

  const tour = slug ? getTourBySlug(slug) : undefined;
  const hotels = tour ? getRecommendedHotels(tour.region, 3) : [];

  // P2-B: 외부 리뷰 fetch (env 키 있으면 Google Places, 없으면 internal fallback)
  const resolvedRating = useTourRating(tour?.id || '', {
    rating: tour?.rating,
    reviewCount: tour?.reviewCount,
    reviewSource: tour?.reviewSource,
  });

  const backLabel =
    language === 'ko' ? '투어 목록' :
    language === 'ja' ? 'ツアー一覧' :
    language === 'zh' ? '旅游列表' : 'Tours';

  // SEO (404일 때도 usePageMeta 호출 — hook 순서 고정)
  usePageMeta({
    title: tour
      ? `${txt(tour.title, language)} | CocoTrip Tours`
      : 'Tour Not Found | CocoTrip',
    description: tour
      ? txt(tour.summary, language)
      : 'This tour could not be found.',
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
    const script = document.createElement('script');
    script.type = 'application/ld+json';
    script.id = 'tour-jsonld';
    script.textContent = JSON.stringify({
      '@context': 'https://schema.org',
      '@type': 'Product',
      name: txt(tour.title, 'en'),
      description: txt(tour.summary, 'en'),
      image: tour.images[0] || 'https://cocotripkr.com/og-image.png',
      brand: { '@type': 'Brand', name: 'CocoTrip' },
      offers: {
        '@type': 'Offer',
        url: `https://cocotripkr.com/tours/${slug}`,
        priceCurrency: 'USD',
        price: tour.priceFrom,
        availability: 'https://schema.org/InStock',
      },
      aggregateRating: {
        '@type': 'AggregateRating',
        ratingValue: '4.9',
        reviewCount: '32',
      },
    });
    // Remove old if exists
    document.getElementById('tour-jsonld')?.remove();
    document.head.appendChild(script);
    return () => { script.remove(); };
  }, [slug, tour]);

  // ── 404 ──────────────────────────────────────────────────────────────────
  if (!tour) {
    return (
      <div
        className="min-h-screen"
        style={{ background: 'linear-gradient(180deg, #0a0412 0%, #0d0618 50%, #080210 100%)' }}
      >
        <Header language={language} t={t} onLanguageChange={changeLanguage} />
        <div className={`flex flex-col items-center justify-center gap-6 px-4 ${isMobile ? 'pt-24' : 'pt-32'}`}>
          <div
            className="w-16 h-16 rounded-3xl flex items-center justify-center"
            style={{ background: 'rgba(182,104,252,0.08)', border: '1px solid rgba(182,104,252,0.15)' }}
          >
            <Package className="w-7 h-7" style={{ color: 'rgba(182,104,252,0.45)' }} />
          </div>
          <p className="text-[16px] font-bold text-white/60 text-center">
            {language === 'ko' ? '상품을 찾을 수 없습니다' :
             language === 'ja' ? 'ツアーが見つかりません' :
             language === 'zh' ? '找不到该旅游产品' :
             'Tour not found'}
          </p>
          <Link
            to="/tours"
            className="flex items-center gap-2 text-[13px] font-bold px-5 py-2.5 rounded-full text-white"
            style={{ background: 'linear-gradient(135deg, #B668FC, #FF6B9D)' }}
          >
            <ArrowLeft className="w-4 h-4" />
            {backLabel}
          </Link>
        </div>
      </div>
    );
  }

  // ── 번역 ─────────────────────────────────────────────────────────────────
  const title       = txt(tour.title, language);
  const summary     = txt(tour.summary, language);
  const description = txt(tour.description, language);

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
  const bookLabel = language === 'ko' ? '문의 / 예약하기' : language === 'ja' ? 'お問い合わせ・予約' : language === 'zh' ? '咨询/预订' : 'Inquire & Book';
  const highlightTitle = language === 'ko' ? '포함 사항' : language === 'ja' ? '含まれるもの' : language === 'zh' ? '包含内容' : 'Highlights';
  const overviewTitle  = language === 'ko' ? '상품 설명' : language === 'ja' ? '商品説明' : language === 'zh' ? '产品说明' : 'Overview';
  const itineraryTitle = language === 'ko' ? '세부 일정' : language === 'ja' ? '詳細スケジュール' : language === 'zh' ? '详细行程' : 'Itinerary';
  const comingSoon     = language === 'ko' ? '다음 단계에서 추가됩니다' : language === 'ja' ? '次のセッションで追加予定' : language === 'zh' ? '将在下一阶段添加' : 'Full itinerary coming soon';
  const hotelTitle     = language === 'ko' ? '추천 숙소' : language === 'ja' ? 'おすすめ宿泊施設' : language === 'zh' ? '推荐住宿' : 'Recommended Stays';
  const hotelSub       = language === 'ko' ? '투어와 함께 예약하면 더 편리해요' : language === 'ja' ? 'ツアーと一緒に予約してスムーズに' : language === 'zh' ? '与旅游同时预订，出行更便捷' : 'Book together for a seamless trip';
  const hotelFrom      = language === 'ko' ? '최저' : language === 'ja' ? 'から' : language === 'zh' ? '起' : 'from';
  const hotelNight     = language === 'ko' ? '/ 박' : language === 'ja' ? '/ 泊' : language === 'zh' ? '/ 晚' : '/ night';
  const hotelBtn       = language === 'ko' ? 'Trip.com에서 보기' : language === 'ja' ? 'Trip.comで見る' : language === 'zh' ? '在Trip.com查看' : 'View on Trip.com';
  const hotelDiscl     = language === 'ko' ? '* 예약 완료 시 코코트립에 수수료가 지급됩니다' : language === 'ja' ? '* 予約完了時にCocoTripに手数料が支払われます' : language === 'zh' ? '* 预订完成后CocoTrip将获得佣金' : '* CocoTrip earns a commission on completed bookings';
  const noHiddenFees   = language === 'ko' ? '팁·톨비·주차 포함' : language === 'ja' ? 'チップ·料金所·駐車込み' : language === 'zh' ? '含小费·过路费·停车费' : 'Tips · Tolls · Parking incl.';
  const paypalLabel    = language === 'ko' ? 'PayPal 안심결제' : language === 'ja' ? 'PayPal 安全決済' : language === 'zh' ? 'PayPal 安全支付' : 'PayPal Secure Pay';

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div
      className="min-h-screen pb-36"
      style={{ background: 'linear-gradient(180deg, #0a0412 0%, #0d0618 50%, #080210 100%)' }}
    >
      <style>{`
        @keyframes shimmer {
          0%   { background-position: -200% 0; }
          100% { background-position:  200% 0; }
        }
        .detail-shimmer {
          background: linear-gradient(90deg, #B668FC 0%, #FF6B9D 40%, #B668FC 80%);
          background-size: 200% auto;
          -webkit-background-clip: text;
          background-clip: text;
          -webkit-text-fill-color: transparent;
          animation: shimmer 3s linear infinite;
        }
        .hotel-hover { transition: border-color 0.2s ease, box-shadow 0.2s ease; }
        .hotel-hover:hover {
          border-color: rgba(182,104,252,0.30) !important;
          box-shadow: 0 0 18px rgba(182,104,252,0.10);
        }
      `}</style>

      {/* ── 헤더 ── */}
      <Header language={language} t={t} onLanguageChange={changeLanguage} />

      {/* ── 뒤로가기 브레드크럼 ── */}
      <div className={`max-w-4xl mx-auto flex items-center gap-2 px-4 sm:px-6 pb-3 ${isMobile ? 'pt-20' : 'pt-24'}`}>
        <Link
          to="/tours"
          className="flex items-center gap-1.5 text-[12px] text-white/40 hover:text-white/70 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          {backLabel}
        </Link>
        <ChevronRight className="w-3 h-3 text-white/20" />
        <span className="text-[12px] text-white/20 truncate max-w-[160px]">{title}</span>
      </div>

      {/* ── 이미지 갤러리 슬라이더 ── */}
      <ImageGallery images={tour.images} title={title} region={tour.region} isNight={tour.isNightTour} />

      {/* ── 본문 ── */}
      <div className="max-w-4xl mx-auto px-4 sm:px-6 -mt-4 relative z-10">

        {/* 제목 */}
        <h1 className="text-[22px] font-black text-white leading-tight mb-1.5">{title}</h1>
        <p className="text-[13px] text-white/40 mb-4 leading-relaxed">{summary}</p>

        {/* 메타 칩 */}
        <div className="flex flex-wrap gap-2 mb-5">
          <span
            className="flex items-center gap-1.5 text-[11px] font-semibold px-3 py-1.5 rounded-full"
            style={{ background: 'rgba(182,104,252,0.10)', border: '1px solid rgba(182,104,252,0.20)', color: '#C99FFF' }}
          >
            <Clock className="w-3 h-3" />{durationLabel}
          </span>
          <span
            className="flex items-center gap-1.5 text-[11px] font-semibold px-3 py-1.5 rounded-full"
            style={{ background: 'rgba(255,107,157,0.08)', border: '1px solid rgba(255,107,157,0.20)', color: '#FF9EC2' }}
          >
            <Users className="w-3 h-3" />{VEHICLE_LABEL[tour.vehicleType]}
          </span>
          {resolvedRating.rating && resolvedRating.rating > 0 && (
            <span
              className="flex items-center gap-1.5 text-[11px] font-semibold px-3 py-1.5 rounded-full"
              style={{ background: 'rgba(255,200,80,0.08)', border: '1px solid rgba(255,200,80,0.20)', color: '#FFD250' }}
            >
              <Star className="w-3 h-3 fill-yellow-400 text-yellow-400" />
              {resolvedRating.rating.toFixed(1)}
              {resolvedRating.reviewCount && resolvedRating.reviewCount > 0 && (
                <span className="text-[10px] opacity-60">({resolvedRating.reviewCount})</span>
              )}
            </span>
          )}
          {(() => {
            const langs = (tour.driverLanguages && tour.driverLanguages.length > 0)
              ? tour.driverLanguages
              : (['en'] as DriverLanguage[]);
            return (
              <span
                className="flex items-center gap-1.5 text-[11px] font-semibold px-3 py-1.5 rounded-full"
                style={{ background: 'rgba(140,200,255,0.08)', border: '1px solid rgba(140,200,255,0.20)', color: '#A0CBFF' }}
                title={language === 'ko' ? '기사 가능 언어' : language === 'ja' ? 'ドライバー対応言語' : language === 'zh' ? '司机语言' : 'Driver languages'}
              >
                <Languages className="w-3 h-3" />
                {langs.map(l => DRIVER_LANG_LABEL[l]).join(' · ')}
              </span>
            );
          })()}
        </div>

        <div className="h-px bg-white/[0.06] mb-5" />

        {/* 포함 사항 */}
        <section className="mb-5">
          <h2 className="text-[13px] font-black uppercase tracking-[0.08em] text-white/30 mb-3">{highlightTitle}</h2>
          <ul className="space-y-2.5">
            {tour.highlights.map((h, i) => (
              <li key={i} className="flex items-start gap-2.5">
                <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" style={{ color: '#B668FC' }} />
                <span className="text-[13px] text-white/65 leading-snug">{txt(h.text, language)}</span>
              </li>
            ))}
          </ul>
        </section>

        <div className="h-px bg-white/[0.06] mb-5" />

        {/* 상품 설명 */}
        <section className="mb-5">
          <h2 className="text-[13px] font-black uppercase tracking-[0.08em] text-white/30 mb-3">{overviewTitle}</h2>
          <p className="text-[13px] text-white/55 leading-relaxed">{description}</p>
        </section>

        <div className="h-px bg-white/[0.06] mb-5" />

        {/* 포함 / 별도 (Included / Not included) */}
        <section className="mb-5">
          <IncludedExcluded language={language} includedExtra={tour.included} excludedExtra={tour.excluded} />
        </section>

        <div className="h-px bg-white/[0.06] mb-5" />

        {/* 세부 일정 — stops 데이터 있으면 timeline, 없으면 폴백 placeholder */}
        <section className="mb-8">
          <h2 className="text-[13px] font-black uppercase tracking-[0.08em] text-white/30 mb-3">{itineraryTitle}</h2>
          {tour.stops && tour.stops.length > 0 ? (
            <TourStopList stops={tour.stops} language={language} />
          ) : (
            <div
              className="flex items-center gap-3 px-4 py-4 rounded-2xl"
              style={{
                background: 'rgba(182,104,252,0.04)',
                border: '1px dashed rgba(182,104,252,0.18)',
              }}
            >
              <div
                className="w-8 h-8 rounded-xl flex items-center justify-center shrink-0"
                style={{ background: 'rgba(182,104,252,0.10)', border: '1px solid rgba(182,104,252,0.20)' }}
              >
                <Package className="w-4 h-4" style={{ color: 'rgba(182,104,252,0.6)' }} />
              </div>
              <p className="text-[12px] text-white/25 italic">{comingSoon}</p>
            </div>
          )}
        </section>

        {/* ══════════════════════════════════════════════════════════════════
            추천 숙소 — Booking.com 어필리에이트
        ══════════════════════════════════════════════════════════════════ */}
        {hotels.length > 0 && (
          <section className="mb-8">
            <div className="flex items-center justify-between mb-3">
              <div>
                <h2 className="text-[15px] font-black text-white">{hotelTitle}</h2>
                <p className="text-[11px] text-white/30 mt-0.5">{hotelSub}</p>
              </div>
              <span
                className="text-[10px] font-bold px-2.5 py-1 rounded-full"
                style={{ background: 'rgba(0,115,230,0.12)', border: '1px solid rgba(0,115,230,0.25)', color: '#2979FF' }}
              >
                Trip.com
              </span>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              {hotels.map(hotel => {
                const loc = hotel.location[language] ?? hotel.location.en;
                const stars = Array.from({ length: hotel.stars });
                return (
                  <a
                    key={hotel.id}
                    href={hotel.affiliateUrl}
                    target="_blank"
                    rel="noopener noreferrer sponsored"
                    className="hotel-hover rounded-2xl overflow-hidden flex flex-col"
                    style={{ background: 'rgba(255,255,255,0.025)', border: '1px solid rgba(255,255,255,0.07)' }}
                  >
                    {/* 이미지 */}
                    <div className="relative w-full h-[105px] overflow-hidden bg-white/[0.04]">
                      <img
                        src={hotel.thumbnail}
                        alt={hotel.name}
                        className="w-full h-full object-cover"
                        onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
                      />
                      <div
                        className="absolute inset-0 flex items-center justify-center"
                        style={{ background: 'linear-gradient(135deg, #111827, #0d0618)' }}
                        aria-hidden="true"
                      >
                        <p className="text-[10px] font-black" style={{ color: 'rgba(182,104,252,0.35)' }}>
                          {hotel.region}
                        </p>
                      </div>
                      {hotel.badge && (
                        <div
                          className="absolute bottom-2 left-2 text-[9px] font-bold px-2 py-0.5 rounded-full"
                          style={{ background: 'rgba(8,11,20,0.85)', border: '1px solid rgba(182,104,252,0.25)', color: '#C99FFF' }}
                        >
                          {hotel.badge[language] ?? hotel.badge.en}
                        </div>
                      )}
                    </div>

                    {/* 정보 */}
                    <div className="p-3 flex flex-col gap-1.5 flex-1">
                      <p className="text-[11px] font-bold text-white leading-tight line-clamp-2">{hotel.name}</p>
                      <p className="text-[10px] text-white/35">{loc}</p>
                      <div className="flex gap-0.5">
                        {stars.map((_, i) => (
                          <Star key={i} className="w-2.5 h-2.5 fill-yellow-400 text-yellow-400" />
                        ))}
                      </div>
                      <div className="flex items-center gap-1">
                        <span
                          className="text-[11px] font-black px-1.5 py-0.5 rounded-md"
                          style={{ background: '#0073E6', color: '#fff' }}
                        >
                          {hotel.rating.toFixed(1)}
                        </span>
                        <span className="text-[10px] text-white/25">
                          /10 · {hotel.reviewCount.toLocaleString()}
                        </span>
                      </div>
                      <div className="mt-auto pt-1.5 border-t border-white/[0.05]">
                        <p className="text-[10px] text-white/30">{hotelFrom}</p>
                        <p className="text-[13px] font-black text-white">
                          ${hotel.priceFrom}
                          <span className="text-[10px] text-white/30 font-normal ml-0.5">{hotelNight}</span>
                        </p>
                      </div>
                      <div
                        className="flex items-center justify-center gap-1 py-1.5 rounded-xl text-[10px] font-bold"
                        style={{ background: '#0073E6', color: '#fff' }}
                      >
                        <ExternalLink className="w-3 h-3" />
                        {hotelBtn}
                      </div>
                    </div>
                  </a>
                );
              })}
            </div>
            <p className="text-[9px] text-white/20 mt-2 text-center">{hotelDiscl}</p>
          </section>
        )}
      </div>

        {/* ── Reviews ── */}
        <div className="max-w-4xl mx-auto px-4 sm:px-6 mb-8">
          {resolvedRating.rating && resolvedRating.reviewCount && (
            <div
              className="rounded-2xl p-4 mb-4 flex items-center gap-3"
              style={{ background: 'rgba(255,200,80,0.04)', border: '1px solid rgba(255,200,80,0.15)' }}
            >
              <Star className="w-5 h-5 fill-yellow-400 text-yellow-400 shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="flex items-baseline gap-2 flex-wrap">
                  <span className="text-[18px] font-black text-white">{resolvedRating.rating.toFixed(1)}</span>
                  <span className="text-[12px] text-white/45">
                    {language === 'ko' ? `${resolvedRating.reviewCount}개 리뷰` :
                     language === 'ja' ? `${resolvedRating.reviewCount}件のレビュー` :
                     language === 'zh' ? `${resolvedRating.reviewCount}条评论` :
                     `${resolvedRating.reviewCount} reviews`}
                  </span>
                  {resolvedRating.externalUrl ? (
                    <a
                      href={resolvedRating.externalUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[10px] font-bold uppercase px-2 py-0.5 rounded-full underline-offset-2 hover:underline"
                      style={{
                        background: resolvedRating.reviewSource === 'google' ? 'rgba(66,133,244,0.15)' : 'rgba(255,255,255,0.06)',
                        color: resolvedRating.reviewSource === 'google' ? '#8AB4F8' : 'rgba(255,255,255,0.55)',
                        border: resolvedRating.reviewSource === 'google' ? '1px solid rgba(138,180,248,0.30)' : '1px solid rgba(255,255,255,0.12)',
                      }}
                    >
                      Google ↗
                    </a>
                  ) : (
                    <span
                      className="text-[10px] font-bold uppercase px-2 py-0.5 rounded-full"
                      style={{
                        background: resolvedRating.reviewSource === 'google' ? 'rgba(66,133,244,0.15)' : 'rgba(255,255,255,0.06)',
                        color: resolvedRating.reviewSource === 'google' ? '#8AB4F8' : 'rgba(255,255,255,0.55)',
                        border: resolvedRating.reviewSource === 'google' ? '1px solid rgba(138,180,248,0.30)' : '1px solid rgba(255,255,255,0.12)',
                      }}
                    >
                      {resolvedRating.reviewSource === 'google' ? 'Google'
                        : (language === 'ko' ? '자체 집계' : language === 'ja' ? '自社集計' : language === 'zh' ? '内部统计' : 'Internal')}
                    </span>
                  )}
                </div>
                <p className="text-[10px] text-white/30 mt-1">
                  {resolvedRating.reviewSource === 'internal' || !resolvedRating.reviewSource
                    ? (language === 'ko' ? '결제 완료 고객의 후기 기반 · Google 검증 연동 예정' :
                       language === 'ja' ? '決済完了顧客のレビューに基づく · Google検証は今後対応' :
                       language === 'zh' ? '基于已付款客户的评价 · Google 验证后续接入' :
                       'Based on completed-booking reviews · Google verification coming soon')
                    : (language === 'ko' ? '외부 검증된 평점' :
                       language === 'ja' ? '外部認証評価' :
                       language === 'zh' ? '外部验证评分' :
                       'Externally verified rating')}
                </p>
              </div>
            </div>
          )}
          <ReviewList targetType="tour" targetId={slug || ''} />
        </div>

      {/* ── 하단 고정 CTA 바 ── */}
      <div
        className="fixed bottom-14 md:bottom-0 left-0 right-0 z-50 px-4 pb-4 md:pb-6 pt-3"
        style={{
          background: 'linear-gradient(to top, rgba(8,11,20,0.98) 0%, rgba(8,11,20,0.90) 60%, transparent 100%)',
          backdropFilter: 'blur(12px)',
        }}
      >
        {/* No Hidden Fees + PayPal 배지 */}
        <div className="flex items-center gap-3 mb-2.5">
          <div className="flex items-center gap-1.5">
            <ShieldCheck className="w-3.5 h-3.5" style={{ color: '#B668FC' }} />
            <span className="text-[10px] font-bold" style={{ color: 'rgba(182,104,252,0.80)' }}>
              {noHiddenFees}
            </span>
          </div>
          <span className="w-px h-3 bg-white/10" />
          <div className="flex items-center gap-1.5">
            <CreditCard className="w-3.5 h-3.5" style={{ color: '#FF6B9D' }} />
            <span className="text-[10px] font-bold" style={{ color: 'rgba(255,107,157,0.80)' }}>
              {paypalLabel}
            </span>
          </div>
        </div>

        {/* 가격 + 예약 버튼 */}
        <div className="flex items-center gap-3">
          <div
            className="flex-1 px-4 py-3 rounded-2xl"
            style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)' }}
          >
            <p className="text-[10px] text-white/30 uppercase tracking-wider mb-0.5">{fromLabel}</p>
            <p className="text-[20px] font-black text-white leading-none">
              ${tour.priceFrom.toLocaleString()}
              <span className="text-[11px] text-white/35 font-medium ml-1">USD</span>
            </p>
            <RefundPolicyModal
              language={language}
              trigger={
                <button className="text-[10px] text-white/40 hover:text-white/70 underline-offset-2 hover:underline mt-1 text-left">
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
              >
                <MessageSquare className="w-4 h-4" />
                {bookLabel}
              </button>
            }
          />
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 이미지 갤러리 컴포넌트 (터치/클릭 슬라이더)
// ─────────────────────────────────────────────────────────────────────────────
interface ImageGalleryProps {
  images: string[];
  title: string;
  region: string;
  isNight?: boolean;
}

function ImageGallery({ images, title, isNight }: ImageGalleryProps) {
  const { t } = useLanguage();
  const [current, setCurrent] = useState(0);
  const [touchStartX, setTouchStartX] = useState(0);
  const total = images.length;

  const prev = () => setCurrent(c => (c - 1 + total) % total);
  const next = () => setCurrent(c => (c + 1) % total);

  const handleTouchStart = (e: React.TouchEvent) => setTouchStartX(e.touches[0].clientX);
  const handleTouchEnd = (e: React.TouchEvent) => {
    const diff = touchStartX - e.changedTouches[0].clientX;
    if (Math.abs(diff) > 40) diff > 0 ? next() : prev();
  };

  return (
    <div
      className="relative w-full h-[300px] md:h-[380px] lg:h-[440px] overflow-hidden"
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
    >
      {/* 슬라이드 이미지들 */}
      {images.map((src, i) => (
        <div
          key={i}
          className="absolute inset-0 transition-opacity duration-400"
          style={{ opacity: i === current ? 1 : 0, pointerEvents: i === current ? 'auto' : 'none' }}
        >
          <img
            src={src}
            alt={`${title} ${i + 1}`}
            className="w-full h-full object-cover"
            loading={i === 0 ? 'eager' : 'lazy'}
          />
        </div>
      ))}

      {/* 나이트 오버레이 */}
      {isNight && (
        <div
          className="absolute inset-0 pointer-events-none"
          style={{ background: 'rgba(5,3,20,0.30)' }}
        />
      )}

      {/* 하단 그라데이션 */}
      <div
        className="absolute bottom-0 left-0 right-0 h-28 pointer-events-none"
        style={{ background: 'linear-gradient(to top, #0a0412 0%, transparent 100%)' }}
      />

      {/* 나이트투어 뱃지 */}
      {isNight && (
        <div
          className="absolute top-4 left-4 flex items-center gap-1.5 px-3 py-1.5 rounded-full"
          style={{ background: 'rgba(10,5,40,0.82)', border: '1px solid rgba(184,160,255,0.30)' }}
        >
          <Moon className="w-3 h-3" style={{ color: '#B8A0FF' }} />
          <span className="text-[10px] font-black tracking-[0.12em]" style={{ color: '#B8A0FF' }}>NIGHT TOUR</span>
        </div>
      )}

      {/* 좌우 화살표 (이미지 2장 이상일 때만) */}
      {total > 1 && (
        <>
          <button
            onClick={prev}
            className="absolute left-3 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full flex items-center justify-center"
            style={{ background: 'rgba(8,4,18,0.70)', border: '1px solid rgba(255,255,255,0.15)' }}
            aria-label={t.a11y?.previousImage ?? 'Previous image'}
          >
            <ChevronLeft className="w-4 h-4 text-white/80" />
          </button>
          <button
            onClick={next}
            className="absolute right-3 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full flex items-center justify-center"
            style={{ background: 'rgba(8,4,18,0.70)', border: '1px solid rgba(255,255,255,0.15)' }}
            aria-label={t.a11y?.nextImage ?? 'Next image'}
          >
            <ChevronRight className="w-4 h-4 text-white/80" />
          </button>

          {/* 하단 인디케이터 점 */}
          <div className="absolute bottom-5 left-1/2 -translate-x-1/2 flex gap-1.5">
            {images.map((_, i) => (
              <button
                key={i}
                onClick={() => setCurrent(i)}
                className="rounded-full transition-all duration-300"
                style={{
                  width: i === current ? '20px' : '6px',
                  height: '5px',
                  background: i === current
                    ? 'linear-gradient(90deg, #B668FC, #FF6B9D)'
                    : 'rgba(255,255,255,0.25)',
                }}
                aria-label={`${t.a11y?.goToImage ?? 'Go to image'} ${i + 1}`}
              />
            ))}
          </div>

          {/* 카운터 (우상단) */}
          <div
            className="absolute top-4 right-4 text-[10px] font-bold px-2.5 py-1 rounded-full"
            style={{ background: 'rgba(8,4,18,0.72)', border: '1px solid rgba(255,255,255,0.12)', color: 'rgba(255,255,255,0.65)' }}
          >
            {current + 1} / {total}
          </div>
        </>
      )}
    </div>
  );
}
