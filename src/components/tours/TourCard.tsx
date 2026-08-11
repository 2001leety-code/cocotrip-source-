// ─────────────────────────────────────────────────────────────────────────────
// CocoTrip – TourCard 컴포넌트
// 기존 디자인 토큰(다크 네이비 + 퍼플/핑크 그라데이션) 재사용
// ─────────────────────────────────────────────────────────────────────────────
import { Link } from 'react-router-dom';
import { Clock, Users, ChevronRight, Star, Moon, Images, Languages } from 'lucide-react';
import { publicBadgeTag } from '@/data/tours';
import type { Tour, I18nString, DriverLanguage, TourTag } from '@/data/tours';
import { translations, type Language } from '@/i18n';
import { WishlistToggle } from '@/components/WishlistButton';
import { CALCULATOR_KRW_PER_USD } from '@/lib/calculator';
import { formatPrice } from '@/lib/exchange-rate';
import { getSeasonalTip } from '@/data/tourSeasons';
import { useTourRatingAggregates } from '@/hooks/useTourRatingAggregates';

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

// 근거 없는 태그(Popular/Best Value/AI-Curated)는 `publicBadgeTag` 가 걸러낸다 — SSOT 는
// src/data/tours.ts. 걸러지는 태그의 스타일은 여기 둘 필요가 없다(렌더될 수 없음).
// 실제 집계 별점은 useTourRatingAggregates 로 이미 따로 표시된다.
const TAG_STYLE: Record<string, { bg: string; color: string }> = {
  New:         { bg: 'rgba(255,200,80,0.15)',   color: '#FFD250' },
  'Multi-City':{ bg: 'rgba(124,92,252,0.18)',   color: '#A78BFF' },
  'Night Tour':{ bg: 'rgba(30,20,60,0.70)',     color: '#B8A0FF' },
  Nature:      { bg: 'rgba(0,180,100,0.15)',    color: '#00C878' },
  History:     { bg: 'rgba(200,160,80,0.18)',   color: '#E8C468' },
};

// ── 카드 전용(route-local) 4언어 사전 ─────────────────────────────────────────
// 공용 `src/i18n/locales/*.json` 은 건드리지 않는다. 여기 값들은 이 카드에서만 찍히는
// 표시 문구라 공용 번들에 키를 늘릴 이유가 없고, 한 파일 안에서 4언어가 동시에 보여야
// 한 언어만 빠지는 사고를 막는다.
//
// 타입이 `Record<Language, string>` 이라 **부분 번역이 컴파일되지 않는다** — 영어
// 폴백이라는 개념 자체가 없다. 사전에 없는 태그는 배지를 렌더하지 않는다(원문 영어 노출 금지).

/** 공개 카드가 배지로 낼 수 있는 태그 = 근거 없는 3개를 뺀 나머지(`publicBadgeTag` 와 같은 집합).
 *  `TourTag` 에 태그가 추가되면 이 Record 가 컴파일 에러로 번역 누락을 알린다. */
type PublicTourTag = Exclude<TourTag, 'Popular' | 'AI-Curated' | 'Best Value'>;

const TAG_LABEL: Record<PublicTourTag, Record<Language, string>> = {
  New:          { ko: '신규',      en: 'NEW',        ja: '新着',       zh: '新品' },
  'Multi-City': { ko: '다도시',    en: 'MULTI-CITY', ja: '複数都市',   zh: '多城市' },
  'Night Tour': { ko: '야경 투어', en: 'NIGHT TOUR', ja: '夜景ツアー', zh: '夜景游' },
  Nature:       { ko: '자연',      en: 'NATURE',     ja: '自然',       zh: '自然' },
  History:      { ko: '역사·문화', en: 'HISTORY',    ja: '歴史・文化', zh: '历史文化' },
};

/** 사전에 있는 태그만 문구를 돌려준다. 없으면 null = 배지 미렌더(영어 원문이 새지 않게). */
function tagLabel(tag: string, lang: Language): string | null {
  const entry = (TAG_LABEL as Record<string, Record<Language, string> | undefined>)[tag];
  return entry ? entry[lang] : null;
}

const NIGHT_LABEL: Record<Language, string> = { ko: '야경', en: 'NIGHT', ja: '夜景', zh: '夜景' };

/** 포함 항목 배지. 값은 `GLOBAL_INCLUDED`(연료비·톨비·주차비) 와 팁 정책 그대로 — 의미 불변, 표기만 현지화. */
const INCLUDED_LABELS: ReadonlyArray<Record<Language, string>> = [
  { ko: '톨비',    en: 'Tolls',   ja: '通行料',  zh: '过路费' },
  { ko: '주차비',  en: 'Parking', ja: '駐車場',  zh: '停车费' },
  { ko: '기사 팁', en: 'Tips',    ja: 'チップ',  zh: '小费' },
];

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

  // 첫 번째 태그만 카드에 노출 (공간 절약). 근거 없는 태그는 publicBadgeTag 가 건너뛴다.
  const primaryTag = publicBadgeTag(tour.tags);
  const tagStyle = primaryTag ? (TAG_STYLE[primaryTag] || { bg: 'rgba(255,255,255,0.10)', color: '#fff' }) : null;

  // 나이트 투어 오버레이
  const isNight = tour.isNightTour === true;

  // 배지 문구는 사전에서만 온다. isNight 배지가 이미 야경을 말하므로 'Night Tour' 태그
  // 배지는 겹쳐 내지 않는다 — 현지화하면 ko 에서 '야경' + '야경 투어' 로 같은 말이 두 번 찍힌다.
  const badgeLabel = primaryTag && !(isNight && primaryTag === 'Night Tour')
    ? tagLabel(primaryTag, language)
    : null;

  // 계절 적합도 칩 (운영자 아이디어) — 현재 월 기준. 데이터 없으면 null(미표시).
  const seasonalTip = getSeasonalTip(tour.id, new Date().getMonth() + 1, language);

  // 별점 = 실 후기 우선. 내부 published 리뷰 집계(count>0)면 무조건 노출(실데이터=가짜 아님).
  //   없으면 static+플래그 경로(REAL_TOUR_RATINGS) 폴백. targetId = slug.
  const ratingAgg = useTourRatingAggregates()[tour.slug];
  const flagStatic = import.meta.env.VITE_FEATURE_REAL_TOUR_RATINGS === 'true' && !!tour.rating && tour.rating > 0;
  const displayRating = ratingAgg && ratingAgg.count > 0 ? ratingAgg.rating : (flagStatic ? tour.rating : null);
  const displayCount = ratingAgg && ratingAgg.count > 0 ? ratingAgg.count : (flagStatic ? tour.reviewCount : undefined);

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
      <div className="tour-card-media relative w-full h-[136px] sm:h-[190px] overflow-hidden">

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
              {NIGHT_LABEL[language]}
            </span>
          )}
          {badgeLabel && tagStyle && (
            <span
              className="text-[8.5px] sm:text-[9px] font-black tracking-[0.12em] px-2 py-0.5 sm:px-2.5 sm:py-1 rounded-full backdrop-blur-sm"
              style={{ background: tagStyle.bg, color: tagStyle.color, border: `1px solid ${tagStyle.color}22` }}
            >
              {badgeLabel}
            </span>
          )}
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
          {/* 44×44 — WishlistToggle 은 공용 컴포넌트(p-2 + size16 = 32×32)라 손대면 상세·홈까지
              같이 바뀐다. 래퍼만 키우면 커지는 건 배경뿐이고 실제 누를 수 있는 <button> 은
              그대로 32px 다(실측). 그래서 자식 선택자로 이 카드 안의 버튼만 터치 최소치로 키운다. */}
          <div
            className="inline-flex rounded-full backdrop-blur-sm [&>button]:inline-flex [&>button]:items-center [&>button]:justify-center [&>button]:w-11 [&>button]:h-11"
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

        {/* 계절 적합도 칩 (좌하단) — best=그린 긍정 / caution=앰버 여름주의. 데이터 있는 투어만. */}
        {seasonalTip && (
          <div className="absolute bottom-2.5 sm:bottom-3 left-2.5 sm:left-3">
            <span
              className="flex items-center gap-1 text-[9px] sm:text-[10px] font-bold px-2 py-0.5 sm:py-1 rounded-full backdrop-blur-sm"
              style={seasonalTip.tone === 'best'
                ? { background: 'rgba(12,64,40,0.74)', border: '1px solid rgba(80,220,150,0.40)', color: '#7DF0B8' }
                : { background: 'rgba(84,56,10,0.74)', border: '1px solid rgba(255,200,80,0.42)', color: '#FFD37A' }}
            >
              <span aria-hidden>{seasonalTip.emoji}</span>{seasonalTip.label}
            </span>
          </div>
        )}

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

        {/* 제목 — 최대 2줄.
            line-clamp-1 은 '한국 멀티시티 3일 2박 (서울·경주·부산)' / 'Korea Multi-City 3D2N
            (Seoul · Gyeongju · Busan)' 처럼 카드 폭보다 긴 제목을 390/768/1440 어디서나 잘라
            상품을 식별할 수 없게 만들었다. 2줄로 열되, `min-h` 로 1줄 제목도 2줄 자리를 차지하게
            해서 그리드 한 줄 안의 카드들이 같은 높이로 정렬된다(제목 길이에 따라 아래 메타·CTA
            줄이 어긋나지 않게). 2.75em = leading-snug(1.375) × 2줄 — 폰트 크기가 14/15px 로
            달라져도 em 이라 같이 따라간다. */}
        <h3 className="text-[14px] sm:text-[15px] font-bold text-white leading-snug mb-1 group-hover:text-purple-200 transition-colors duration-200 line-clamp-2 min-h-[2.75em] break-words">
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

        {/* 포함 뱃지 — 실제로 포함되는 3가지만. "숨은 비용 없음" 은 사실이 아니다(식사·입장료 별도, #1276). */}
        <div className="flex flex-wrap gap-1 mb-2.5 sm:mb-3">
          {INCLUDED_LABELS.map(item => (
            <span
              key={item.en}
              className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full"
              style={{ background: 'rgba(16,185,129,0.10)', color: 'rgba(110,231,183,0.85)', border: '1px solid rgba(16,185,129,0.20)' }}
            >
              ✓ {item[language]}
            </span>
          ))}
        </div>

        {/* 구분선 */}
        <div className="h-px bg-white/[0.05] mb-2.5 sm:mb-3" />

        {/* 하단 행 */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            {/* 별점 = 실 후기(내부 published 집계) 우선, 없으면 static+플래그 폴백. 가짜 없음. */}
            {displayRating && displayRating > 0 && (
              <div className="flex items-center gap-1">
                <Star className="w-3 h-3 fill-yellow-400 text-yellow-400" />
                <span className="text-[11px] text-white/50">{displayRating.toFixed(1)}</span>
                {displayCount && displayCount > 0 && (
                  <span className="text-[11px] text-white/55">({displayCount})</span>
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
          {/* 2026-07-19 가이드 p.7: 고스트 필 → 풀 그라데이션 CTA (m-cta = 셸 흰글자·active 보정) */}
          <div
            className="m-cta flex items-center gap-1 text-[11px] sm:text-[12px] font-bold px-3 py-1.5 sm:px-3.5 rounded-full shrink-0 text-white"
            style={{ background: 'var(--coco-cta-gradient)', boxShadow: '0 6px 16px rgba(124,92,255,0.25)' }}
          >
            {detailLabel}
            <ChevronRight className="w-3.5 h-3.5" />
          </div>
        </div>
      </div>
    </Link>
  );
}
