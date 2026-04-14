// ─────────────────────────────────────────────────────────────────────────────
// CocoTrip – Tours 상품 리스트 페이지
// 디자인: 다크 네이비 배경 + 퍼플/핑크 그라데이션 (기존 토큰 재사용)
// 통합 시: App.tsx 라우터에 <Route path="/tours" element={<ToursPage />} /> 추가
// ─────────────────────────────────────────────────────────────────────────────
import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Package, ShieldCheck, CreditCard, Phone,
  Star, ExternalLink, ChevronRight,
} from 'lucide-react';
import { useLanguage } from '@/hooks/useLanguage';
import { useIsMobile } from '@/hooks/use-mobile';
import { usePageMeta } from '@/hooks/usePageMeta';
import { Header } from '@/sections/Header';
import { TourCard } from '@/components/tours/TourCard';
import { TOUR_REGIONS, getToursByRegion } from '@/data/tours';
import { HOTELS } from '@/data/hotels';
import type { TourRegion } from '@/data/tours';
import type { Language } from '@/i18n';

// ── 로컬 i18n ─────────────────────────────────────────────────────────────────
// 통합 시 이 객체를 src/i18n/index.ts 의 translations.*.tours 로 이전하고
// useLanguage()의 t.tours 로 교체
const TL = {
  ko: {
    pageTitle: '투어 상품',
    pageSubtitle: '코코트립이 엄선한 한국 프라이빗 투어 패키지',
    filterLabel: '지역 필터',
    hotelTitle: '추천 숙소',
    hotelSubtitle: '투어와 함께 예약하면 더 편리해요',
    hotelFrom: '최저',
    hotelNight: '/ 박',
    hotelScore: '점',
    hotelBtn: 'Expedia에서 보기',
    hotelCommission: '* 예약 완료 시 코코트립에 수수료가 지급됩니다',
    inquireTitle: '맞춤 투어가 필요하신가요?',
    inquireSub: '전세차량 페이지에서 1:1 견적 문의',
    inquireBtn: '문의하기',
    seoTitle: 'CocoTrip 투어 — 한국 프라이빗 투어',
    seoDesc: '서울·부산·제주 전세차량 투어. 팁·톨비·주차비 포함, PayPal 안심결제.',
    noResults: '해당 지역 투어 상품이 없습니다',
  },
  en: {
    pageTitle: 'Tours',
    pageSubtitle: 'Handpicked Korea private tour packages by CocoTrip',
    filterLabel: 'Filter by region',
    hotelTitle: 'Recommended Stays',
    hotelSubtitle: 'Book with your tour for a seamless trip',
    hotelFrom: 'from',
    hotelNight: '/ night',
    hotelScore: '/10',
    hotelBtn: 'View on Expedia',
    hotelCommission: '* CocoTrip earns a commission on completed bookings',
    inquireTitle: 'Need a custom tour?',
    inquireSub: 'Get a 1-on-1 quote on the Charter page',
    inquireBtn: 'Inquire Now',
    seoTitle: 'CocoTrip Tours — Korea Private Tours',
    seoDesc: 'Seoul, Busan & Jeju private van tours. Tips, tolls & parking included. PayPal secure.',
    noResults: 'No tours available for this region',
  },
  ja: {
    pageTitle: 'ツアー',
    pageSubtitle: 'CocoTripが厳選した韓国プライベートツアーパッケージ',
    filterLabel: '地域フィルター',
    hotelTitle: 'おすすめ宿泊施設',
    hotelSubtitle: 'ツアーと一緒に予約してスムーズな旅を',
    hotelFrom: 'から',
    hotelNight: '/ 泊',
    hotelScore: '/10',
    hotelBtn: 'Expediaで見る',
    hotelCommission: '* 予約完了時にCocoTripに手数料が支払われます',
    inquireTitle: 'カスタムツアーが必要ですか？',
    inquireSub: 'チャーターページで1対1の見積もりを',
    inquireBtn: 'お問い合わせ',
    seoTitle: 'CocoTrip ツアー — 韓国プライベートツアー',
    seoDesc: 'ソウル・釜山・済州の専用バンツアー。チップ・料金所・駐車場込み。PayPal安全決済。',
    noResults: 'このエリアのツアーはありません',
  },
  zh: {
    pageTitle: '旅游产品',
    pageSubtitle: 'CocoTrip精选韩国私人旅游套餐',
    filterLabel: '按地区筛选',
    hotelTitle: '推荐住宿',
    hotelSubtitle: '与旅游同时预订，出行更便捷',
    hotelFrom: '起',
    hotelNight: '/ 晚',
    hotelScore: '/10',
    hotelBtn: '在Expedia查看',
    hotelCommission: '* 预订完成后CocoTrip将获得佣金',
    inquireTitle: '需要定制旅游？',
    inquireSub: '在包车页面获取一对一报价',
    inquireBtn: '立即咨询',
    seoTitle: 'CocoTrip 旅游 — 韩国私人包车游',
    seoDesc: '首尔、釜山和济州私人包车游览，含小费·过路费·停车费，PayPal安全支付。',
    noResults: '该地区暂无旅游产品',
  },
} satisfies Record<Language, Record<string, string>>;

// ─────────────────────────────────────────────────────────────────────────────
export default function ToursPage() {
  const { language, t, changeLanguage } = useLanguage();
  const isMobile = useIsMobile();
  const tl = TL[language] ?? TL.en;

  const [activeRegion, setActiveRegion] = useState<TourRegion | 'All'>('All');
  const visibleTours = getToursByRegion(activeRegion);

  // 호텔: 선택 지역 기준 / All이면 서울 기본
  const visibleHotels = HOTELS.filter(h =>
    activeRegion === 'All' ? true : h.region === activeRegion
  ).slice(0, 3);

  usePageMeta({
    title: tl.seoTitle,
    description: tl.seoDesc,
  });

  const TRUST_BADGES = [
    {
      icon: ShieldCheck,
      color: '#B668FC',
      label: 'No Hidden Fees',
      sub: language === 'ko' ? '팁·톨비·주차 포함' :
           language === 'ja' ? 'チップ·料金所·駐車込み' :
           language === 'zh' ? '含小费·过路费·停车费' :
           'Tips · Tolls · Parking incl.',
    },
    {
      icon: CreditCard,
      color: '#FF6B9D',
      label: 'PayPal',
      sub: language === 'ko' ? 'PayPal 안심결제' :
           language === 'ja' ? 'PayPal 安全決済' :
           language === 'zh' ? 'PayPal 安全支付' :
           'Secure Payment',
    },
    {
      icon: Phone,
      color: '#C850C0',
      label: '24/7',
      sub: language === 'ko' ? '영어 지원' :
           language === 'ja' ? '英語サポート' :
           language === 'zh' ? '英语客服' :
           'English Support',
    },
  ];

  return (
    <div
      className="min-h-screen pb-28"
      style={{ background: 'linear-gradient(180deg, #0a0412 0%, #0d0618 50%, #080210 100%)' }}
    >
      <style>{`
        @keyframes shimmer {
          0%   { background-position: -200% 0; }
          100% { background-position:  200% 0; }
        }
        .tours-shimmer {
          background: linear-gradient(90deg, #B668FC 0%, #FF6B9D 40%, #B668FC 80%);
          background-size: 200% auto;
          -webkit-background-clip: text;
          background-clip: text;
          -webkit-text-fill-color: transparent;
          animation: shimmer 3s linear infinite;
        }
        .tour-chip { transition: all 0.22s cubic-bezier(0.34, 1.56, 0.64, 1); }
        .tour-chip:active { transform: scale(0.93); }
        .hotel-card-hover { transition: border-color 0.22s ease, box-shadow 0.22s ease; }
        .hotel-card-hover:hover {
          border-color: rgba(182,104,252,0.30) !important;
          box-shadow: 0 0 20px rgba(182,104,252,0.10);
        }
      `}</style>

      {/* ── 헤더 ── */}
      <Header language={language} t={t} onLanguageChange={changeLanguage} />

      {/* ── 페이지 헤더 ── */}
      <header className={`px-4 pb-5 ${isMobile ? 'pt-20' : 'pt-24'}`}>
        <div className="flex items-center gap-3 mb-2">
          <div
            className="w-10 h-10 rounded-2xl flex items-center justify-center shrink-0"
            style={{ background: 'linear-gradient(135deg, #B668FC, #FF6B9D)' }}
          >
            <Package className="w-5 h-5 text-white" />
          </div>
          <h1 className="text-[28px] font-black leading-none tours-shimmer">
            {tl.pageTitle}
          </h1>
        </div>
        <p className="text-[13px] text-white/35 ml-[52px] leading-relaxed">
          {tl.pageSubtitle}
        </p>
      </header>

      {/* ── 신뢰 배지 ── */}
      <div className="px-4 mb-5">
        <div className="flex gap-2 overflow-x-auto pb-1" style={{ scrollbarWidth: 'none' }}>
          {TRUST_BADGES.map(({ icon: Icon, color, label, sub }) => (
            <div
              key={label}
              className="shrink-0 flex items-center gap-2 px-3.5 py-2.5 rounded-2xl"
              style={{
                background: `${color}0d`,
                border: `1px solid ${color}28`,
              }}
            >
              <Icon className="w-4 h-4 shrink-0" style={{ color }} />
              <div>
                <p className="text-[11px] font-black text-white leading-none">{label}</p>
                <p className="text-[10px] mt-0.5" style={{ color: `${color}99` }}>{sub}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ── 구분선 ── */}
      <div className="mx-4 h-px bg-white/[0.06] mb-5" />

      {/* ── 지역 필터 칩 ── */}
      <div className="px-4 mb-6">
        <p className="text-[10px] uppercase tracking-[0.1em] text-white/25 font-semibold mb-2.5">
          {tl.filterLabel}
        </p>
        <div className="flex gap-2 overflow-x-auto pb-1" style={{ scrollbarWidth: 'none' }}>
          {TOUR_REGIONS.map(({ key, label }) => {
            const isActive = activeRegion === key;
            const chipLabel = label[language] ?? label.en;
            return (
              <button
                key={key}
                onClick={() => setActiveRegion(key)}
                className="tour-chip shrink-0 text-[12px] font-bold px-4 py-2 rounded-full"
                style={
                  isActive
                    ? {
                        background: 'linear-gradient(135deg, rgba(182,104,252,0.18), rgba(255,107,157,0.12))',
                        border: '1px solid rgba(182,104,252,0.45)',
                        color: '#D0A8FF',
                        boxShadow: '0 0 12px rgba(182,104,252,0.18)',
                      }
                    : {
                        background: 'rgba(255,255,255,0.03)',
                        border: '1px solid rgba(255,255,255,0.08)',
                        color: 'rgba(255,255,255,0.45)',
                      }
                }
              >
                {chipLabel}
              </button>
            );
          })}
        </div>
      </div>

      {/* ── 투어 카드 리스트 ── */}
      <section className="px-4 space-y-4 mb-10">
        {visibleTours.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <div
              className="w-16 h-16 rounded-3xl flex items-center justify-center mb-4"
              style={{ background: 'rgba(182,104,252,0.08)', border: '1px solid rgba(182,104,252,0.15)' }}
            >
              <Package className="w-7 h-7" style={{ color: 'rgba(182,104,252,0.5)' }} />
            </div>
            <p className="text-[14px] text-white/30">{tl.noResults}</p>
          </div>
        ) : (
          visibleTours.map(tour => (
            <TourCard key={tour.id} tour={tour} language={language} />
          ))
        )}
      </section>

      {/* ════════════════════════════════════════════════════════════════════
          추천 숙소 섹션 — Expedia 어필리에이트
          경쟁사(Klook) 방식: 투어 카드 인라인이 아닌 별도 섹션으로 분리
      ════════════════════════════════════════════════════════════════════ */}
      {visibleHotels.length > 0 && (
        <section className="px-4 mb-8">
          {/* 섹션 헤더 */}
          <div className="flex items-center justify-between mb-3">
            <div>
              <h2 className="text-[15px] font-black text-white">{tl.hotelTitle}</h2>
              <p className="text-[11px] text-white/30 mt-0.5">{tl.hotelSubtitle}</p>
            </div>
            <span
              className="text-[10px] font-bold px-2.5 py-1 rounded-full"
              style={{
                background: 'rgba(0,168,107,0.12)',
                border: '1px solid rgba(0,168,107,0.25)',
                color: '#00c47e',
              }}
            >
              Booking.com
            </span>
          </div>

          {/* 호텔 카드 가로 스크롤 */}
          <div className="flex gap-3 overflow-x-auto pb-2" style={{ scrollbarWidth: 'none' }}>
            {visibleHotels.map(hotel => {
              const loc = hotel.location[language] ?? hotel.location.en;
              const stars = Array.from({ length: hotel.stars }, (_, i) => i);
              return (
                <a
                  key={hotel.id}
                  href={hotel.affiliateUrl}
                  target="_blank"
                  rel="noopener noreferrer sponsored"
                  className="hotel-card-hover shrink-0 w-[200px] rounded-2xl overflow-hidden flex flex-col"
                  style={{
                    background: 'rgba(255,255,255,0.025)',
                    border: '1px solid rgba(255,255,255,0.07)',
                  }}
                >
                  {/* 호텔 이미지 */}
                  <div className="relative w-full h-[110px] overflow-hidden bg-white/[0.04]">
                    <img
                      src={hotel.thumbnail}
                      alt={hotel.name}
                      className="w-full h-full object-cover"
                      onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
                    />
                    {/* 플레이스홀더 */}
                    <div
                      className="absolute inset-0 flex items-center justify-center"
                      style={{ background: 'linear-gradient(135deg, #111827 0%, #0d0618 100%)' }}
                      aria-hidden="true"
                    >
                      <p
                        className="text-[11px] font-black text-center px-2 leading-snug"
                        style={{ color: 'rgba(182,104,252,0.35)' }}
                      >
                        {hotel.region}
                      </p>
                    </div>
                    {/* 별점 배지 */}
                    {hotel.badge && (
                      <div
                        className="absolute bottom-2 left-2 text-[9px] font-bold px-2 py-0.5 rounded-full"
                        style={{
                          background: 'rgba(8,11,20,0.85)',
                          border: '1px solid rgba(182,104,252,0.25)',
                          color: '#C99FFF',
                        }}
                      >
                        {hotel.badge[language] ?? hotel.badge.en}
                      </div>
                    )}
                    {/* 하단 페이드 */}
                    <div
                      className="absolute bottom-0 left-0 right-0 h-8"
                      style={{ background: 'linear-gradient(to top, rgba(8,11,20,0.5) 0%, transparent 100%)' }}
                    />
                  </div>

                  {/* 호텔 정보 */}
                  <div className="p-3 flex flex-col gap-1.5 flex-1">
                    <p className="text-[12px] font-bold text-white leading-tight line-clamp-2">
                      {hotel.name}
                    </p>
                    <p className="text-[10px] text-white/35">{loc}</p>

                    {/* 별 등급 */}
                    <div className="flex gap-0.5">
                      {stars.map(i => (
                        <Star key={i} className="w-2.5 h-2.5 fill-yellow-400 text-yellow-400" />
                      ))}
                    </div>

                    {/* 평점 */}
                    <div className="flex items-center gap-1">
                      <span
                        className="text-[11px] font-black px-1.5 py-0.5 rounded-md"
                        style={{ background: '#1d3d6e', color: '#fff' }}
                      >
                        {hotel.rating.toFixed(1)}
                      </span>
                      <span className="text-[10px] text-white/30">
                        {tl.hotelScore} · {hotel.reviewCount.toLocaleString()}
                      </span>
                    </div>

                    {/* 가격 */}
                    <div className="mt-auto pt-1.5 border-t border-white/[0.05]">
                      <p className="text-[10px] text-white/30">{tl.hotelFrom}</p>
                      <p className="text-[14px] font-black text-white">
                        ${hotel.priceFrom}
                        <span className="text-[10px] text-white/30 font-normal ml-0.5">{tl.hotelNight}</span>
                      </p>
                    </div>

                    {/* CTA */}
                    <div
                      className="flex items-center justify-center gap-1 py-2 rounded-xl text-[10px] font-bold"
                      style={{
                        background: '#1d3d6e',
                        color: '#fff',
                      }}
                    >
                      <ExternalLink className="w-3 h-3" />
                      {tl.hotelBtn}
                    </div>
                  </div>
                </a>
              );
            })}
          </div>

          {/* 어필리에이트 공시 */}
          <p className="text-[9px] text-white/20 mt-2 text-center">{tl.hotelCommission}</p>
        </section>
      )}

      {/* ── 맞춤 투어 문의 배너 ── */}
      <div className="mx-4 mt-2 mb-6">
        <Link
          to="/charter"
          className="flex items-center gap-3 px-5 py-4 rounded-2xl"
          style={{
            background: 'linear-gradient(135deg, rgba(182,104,252,0.10), rgba(255,107,157,0.07))',
            border: '1px solid rgba(182,104,252,0.18)',
          }}
        >
          <div
            className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
            style={{ background: 'linear-gradient(135deg, #B668FC, #FF6B9D)' }}
          >
            <Package className="w-5 h-5 text-white" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[13px] font-bold text-white">{tl.inquireTitle}</p>
            <p className="text-[11px] text-white/30 mt-0.5">{tl.inquireSub}</p>
          </div>
          <span
            className="flex items-center gap-1 text-[12px] font-bold px-3.5 py-1.5 rounded-full shrink-0"
            style={{ background: 'linear-gradient(135deg, #B668FC, #FF6B9D)', color: '#fff' }}
          >
            {tl.inquireBtn}
            <ChevronRight className="w-3.5 h-3.5" />
          </span>
        </Link>
      </div>
    </div>
  );
}
