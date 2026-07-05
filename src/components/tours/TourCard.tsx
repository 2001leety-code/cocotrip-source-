// ─────────────────────────────────────────────────────────────────────────────
// CocoTrip – TourCard 컴포넌트
// 기존 디자인 토큰(다크 네이비 + 퍼플/핑크 그라데이션) 재사용
// ─────────────────────────────────────────────────────────────────────────────
import { Link } from 'react-router-dom';
import { Clock, Users, ChevronRight, Star, Moon, Images, Languages } from 'lucide-react';
import type { Tour, I18nString, DriverLanguage } from '@/data/tours';
import { translations, type Language } from '@/i18n';
import { WishlistToggle } from '@/components/WishlistButton';
import { CALCULATOR_KRW_PER_USD } from '@/lib/calculator';
import { formatPrice } from '@/lib/exchange-rate';

const DRIVER_LANG_LABEL: Record<DriverLanguage, string> = { en: 'EN', ja: 'JA', zh: 'ZH' };

interface TourCardProps {
  tour: Tour;
  language: Language;
}

function txt(field: I18nString, lang: Language): string {
  return field[lang] ?? field.en;
}

const VEHICLE_LABEL: Record<Tour['vehicleType'], { label: string; pax: number }> = {
  Staria:     { label: 'Staria',       pax: 7  },
  Sprinter:   { label: 'Sprinter',     pax: 10 },
  SprinterMid:{ label: 'Sprinter Mid', pax: 7  },
  Bus:        { label: 'Bus',          pax: 30 },
};

const PER_PERSON_LABEL: Record<Language, string> = {
  ko: '/인',
  en: '/person',
  ja: '/人',
  zh: '/人',
};

const TAG_STYLE: Record<string, { bg: string; color: string }> = {
  Popular:     { bg: 'rgba(182,104,252,0.20)', color: '#D9A8FF' },
  'AI-Curated':{ bg: 'rgba(255,107,157,0.18)', color: '#FF9EC2' },
  'Best Value':{ bg: 'rgba(0,210,140,0.14)',   color: '#00D28C' },
  New:         { bg: 'rgba(255,200,80,0.15)',   color: '#FFD250' },
  'Multi-City':{ bg: 'rgba(124,92,252,0.18)',   color: '#A78BFF' },
  'Night Tour':{ bg: 'rgba(30,20,60,0.70)',     color: '#B8A0FF' },
  Nature:      { bg: 'rgba(0,180,100,0.15)',    color: '#00C878' },
  History:     { bg: 'rgba(200,160,80,0.18)',   color: '#E8C468' },
};

// ─────────────────────────────────────────────────────────────────────────────
export function TourCard({ tour, language }: TourCardProps) {
  const title   = txt(tour.title, language);
  const summary = txt(tour.summary, language);
  const vehicle = VEHICLE_LABEL[tour.vehicleType];

  // 기간 레이블
  const durationLabel = (() => {
    if (tour.durationDays === 1 && tour.durationHours) {
      if (language === 'ko') return `약 ${tour.durationHours}시간`;
      if (language === 'ja') return `約${tour.durationHours}時間`;
      if (language === 'zh') return `约${tour.durationHours}小时`;
      return `~${tour.durationHours}h`;
    }
    const d = tour.durationDays;
    const n = d - 1;
    if (d === 1) return language === 'ko' ? '당일' : language === 'ja' ? '日帰り' : language === 'zh' ? '当天' : '1 Day';
    if (language === 'ko') return `${d}일 ${n}박`;
    if (language === 'ja') return `${d}日${n}泊`;
    if (language === 'zh') return `${d}天${n}晚`;
    return `${d}D${n}N`;
  })();

  const fromLabel =
    language === 'ko' ? '최저' :
    language === 'ja' ? 'から' :
    language === 'zh' ? '起' : 'from';

  const detailLabel =
    language === 'ko' ? '자세히 보기' :
    language === 'ja' ? '詳しく見る' :
    language === 'zh' ? '查看详情' : 'View Details';

  // 첫 번째 태그만 카드에 노출 (공간 절약)
  const primaryTag = tour.tags[0];
  const tagStyle = TAG_STYLE[primaryTag] ?? { bg: 'rgba(255,255,255,0.10)', color: '#fff' };

  // 나이트 투어 오버레이
  const isNight = tour.isNightTour === true;

  return (
    <Link
      to={`/tours/${tour.slug}`}
      className="block rounded-[18px] sm:rounded-2xl overflow-hidden group"
      style={{
        background: 'rgba(255,255,255,0.02)',
        border: '1px solid rgba(255,255,255,0.07)',
        transition: 'border-color 0.25s ease, box-shadow 0.25s ease',
      }}
      onMouseEnter={e => {
        const el = e.currentTarget as HTMLElement;
        el.style.borderColor = 'rgba(182,104,252,0.35)';
        el.style.boxShadow = '0 0 24px rgba(182,104,252,0.12)';
      }}
      onMouseLeave={e => {
        const el = e.currentTarget as HTMLElement;
        el.style.borderColor = 'rgba(255,255,255,0.07)';
        el.style.boxShadow = 'none';
      }}
    >
      {/* ── 썸네일 ── */}
      <div className="relative w-full h-[136px] sm:h-[190px] overflow-hidden">

        {/* 실제 이미지 */}
        <img
          src={tour.thumbnail}
          alt={title}
          loading="lazy"
          decoding="async"
          className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
        />

        {/* 나이트 투어 — 어두운 오버레이 */}
        {isNight && (
          <div
            className="absolute inset-0"
            style={{ background: 'linear-gradient(180deg, rgba(5,3,20,0.35) 0%, rgba(5,3,20,0.10) 100%)' }}
          />
        )}

        {/* 하단 페이드 */}
        <div
          className="absolute bottom-0 left-0 right-0 h-20"
          style={{ background: 'linear-gradient(to top, rgba(8,4,18,0.80) 0%, transparent 100%)' }}
        />

        {/* 태그 (좌상단) */}
        <div className="absolute top-2.5 sm:top-3 left-2.5 sm:left-3 flex gap-1.5">
          {isNight && (
            <span
              className="flex items-center gap-1 text-[8.5px] sm:text-[9px] font-black tracking-[0.12em] px-2 py-0.5 sm:px-2.5 sm:py-1 rounded-full backdrop-blur-sm"
              style={{ background: 'rgba(10,5,40,0.80)', border: '1px solid rgba(184,160,255,0.30)', color: '#B8A0FF' }}
            >
              <Moon className="w-2.5 h-2.5" />
              NIGHT
            </span>
          )}
          <span
            className="text-[8.5px] sm:text-[9px] font-black tracking-[0.12em] px-2 py-0.5 sm:px-2.5 sm:py-1 rounded-full backdrop-blur-sm"
            style={{ background: tagStyle.bg, color: tagStyle.color, border: `1px solid ${tagStyle.color}22` }}
          >
            {primaryTag.toUpperCase()}
          </span>
        </div>

        {/* 이미지 갯수 표시 + 위시리스트 하트 (우상단) — 두 칩 가로 배치.
            WishlistToggle 자체가 e.stopPropagation 처리하므로 부모 Link 클릭 영향 없음. */}
        <div className="absolute top-2.5 sm:top-3 right-2.5 sm:right-3 flex items-center gap-1.5">
          {tour.images.length > 1 && (
            <div
              className="flex items-center gap-1 text-[10px] font-bold px-2 py-1 rounded-full backdrop-blur-sm"
              style={{ background: 'rgba(8,4,18,0.65)', border: '1px solid rgba(255,255,255,0.12)', color: 'rgba(255,255,255,0.70)' }}
            >
              <Images className="w-3 h-3" />
              {tour.images.length}
            </div>
          )}
          <div
            className="rounded-full backdrop-blur-sm"
            style={{ background: 'rgba(8,4,18,0.65)', border: '1px solid rgba(255,255,255,0.12)' }}
          >
            <WishlistToggle
              productId={tour.id}
              productType="tour"
              name={txt(tour.title, language)}
              priceUSD={tour.priceFrom}
              thumbnailUrl={tour.thumbnail}
              href={`/tours/${tour.slug}`}
              size={16}
            />
          </div>
        </div>

        {/* 가격 (우하단) USD + 근사 KRW 병기 */}
        <div className="absolute bottom-2.5 sm:bottom-3 right-2.5 sm:right-3">
          <div
            className="px-2.5 py-1.5 sm:px-3 rounded-xl backdrop-blur-sm"
            style={{ background: 'rgba(8,4,18,0.82)', border: '1px solid rgba(182,104,252,0.28)' }}
          >
            <p className="text-[9px] text-white/55 uppercase tracking-wider leading-none mb-0.5">{fromLabel}</p>
            <p className="text-[15px] sm:text-[17px] font-black text-white leading-none">
              ${tour.priceFrom.toLocaleString()}
              <span className="text-[10px] text-white/55 font-medium ml-0.5">USD</span>
              {tour.priceUnit === 'per_person' && (
                <span className="text-[10px] text-white/70 font-medium ml-0.5">{PER_PERSON_LABEL[language]}</span>
              )}
            </p>
            {/* 보조 통화 — 사용자 언어 기반 자동 환산 (en→USD 시엔 KRW 병기 유지) */}
            <p className="text-[9px] text-white/55 leading-none mt-0.5">
              ≈ {language === 'en'
                ? `₩${Math.round(tour.priceFrom * CALCULATOR_KRW_PER_USD).toLocaleString('ko-KR')}`
                : formatPrice(tour.priceFrom * CALCULATOR_KRW_PER_USD, language)}
              {tour.priceUnit === 'per_person' ? PER_PERSON_LABEL[language] : ''}
            </p>
          </div>
        </div>
      </div>

      {/* ── 정보 영역 ── */}
      <div className="px-3.5 py-3 sm:px-4 sm:py-3.5">

        {/* 제목 */}
        <h3 className="text-[14px] sm:text-[15px] font-bold text-white leading-snug mb-1 group-hover:text-purple-200 transition-colors duration-200 line-clamp-1">
          {title}
        </h3>

        {/* 요약 */}
        <p className="text-[11px] sm:text-[11.5px] text-white/42 leading-relaxed mb-2.5 sm:mb-3 line-clamp-2">
          {summary}
        </p>

        {/* 메타 */}
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 mb-2">
          <span className="flex items-center gap-1 text-[10.5px] sm:text-[11px] text-white/50">
            <Clock className="w-3 h-3 text-purple-400/60" />
            {durationLabel}
          </span>
          <span className="w-px h-3 bg-white/10" />
          <span className="flex items-center gap-1 text-[10.5px] sm:text-[11px] text-white/50">
            <Users className="w-3 h-3 text-pink-400/60" />
            {vehicle.label} · max {vehicle.pax}
          </span>
        </div>

        {/* 포함 뱃지 — CocoTrip "No Hidden Fees" 표시 */}
        <div className="flex flex-wrap gap-1 mb-2.5 sm:mb-3">
          {['Tolls', 'Parking', 'Tips'].map(item => (
            <span
              key={item}
              className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full"
              style={{ background: 'rgba(16,185,129,0.10)', color: 'rgba(110,231,183,0.85)', border: '1px solid rgba(16,185,129,0.20)' }}
            >
              ✓ {item}
            </span>
          ))}
        </div>

        {/* 구분선 */}
        <div className="h-px bg-white/[0.05] mb-2.5 sm:mb-3" />

        {/* 하단 행 */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            {tour.rating && tour.rating > 0 && (
              <div className="flex items-center gap-1">
                <Star className="w-3 h-3 fill-yellow-400 text-yellow-400" />
                <span className="text-[11px] text-white/50">{tour.rating.toFixed(1)}</span>
                {tour.reviewCount && tour.reviewCount > 0 && (
                  <span className="text-[11px] text-white/55">({tour.reviewCount})</span>
                )}
              </div>
            )}
            {(() => {
              const langs = (tour.driverLanguages && tour.driverLanguages.length > 0) ? tour.driverLanguages : (['en'] as DriverLanguage[]);
              return (
                <span
                  className="flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-full"
                  style={{ background: 'rgba(140,200,255,0.08)', border: '1px solid rgba(140,200,255,0.20)', color: '#A0CBFF' }}
                  title={translations[language].a11y?.driverLanguages ?? 'Driver languages'}
                >
                  <Languages className="w-2.5 h-2.5" />
                  {langs.map(l => DRIVER_LANG_LABEL[l]).join('·')}
                </span>
              );
            })()}
          </div>
          <div
            className="flex items-center gap-1 text-[11px] sm:text-[12px] font-bold px-3 py-1.5 sm:px-3.5 rounded-full shrink-0"
            style={{
              background: 'linear-gradient(135deg, rgba(182,104,252,0.15), rgba(255,107,157,0.10))',
              border: '1px solid rgba(182,104,252,0.22)',
              color: '#C99FFF',
            }}
          >
            {detailLabel}
            <ChevronRight className="w-3.5 h-3.5" />
          </div>
        </div>
      </div>
    </Link>
  );
}
