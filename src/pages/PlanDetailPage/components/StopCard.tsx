// Per-stop card: collapsed header + expandable details (address, tip, reservation,
// ODsay public-transit route, Naver Map link). Largest leaf of PlanDetailPage.
// Extracted verbatim from src/pages/PlanDetailPage.tsx (L879-1046) during P2 Lock release.
import { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { toast } from 'sonner';
import {
  MapPin, Clock, ChevronDown, Train, Bus, Footprints,
  ExternalLink, Accessibility, AlertTriangle, Heart, Share2, Navigation, Ticket,
} from 'lucide-react';
import { CAT_ICON, formatKRW, getCatColors } from '../constants';
import type { PlanStop } from '../types';
import { getPlanDetailUI } from '../types';
import { normalizeRecommendedItem } from '@/types/plan';
import { useLanguage } from '@/hooks/useLanguage';
import { sanitizeStopName } from '@/lib/sanitizeName';
import { track as posthogTrack } from '@/lib/posthog';
import { haptic } from '@/lib/haptic';
import { buildAttractionLink } from '@/config/affiliateLinks';
import { trackAffiliateClick } from '@/lib/affiliateTracking';
import { AffiliateCard } from '@/components/AffiliateCard';
import { Lightbox } from './Lightbox';

// Sprint 1 Step 5: Action UX — 즐겨찾기 / 공유 / 길찾기.
// localStorage 키: `cocotrip:fav:<planId>` → JSON Record<stopKey, true>.
// stopKey: order(숫자, 0 포함) 우선, 없으면 start_time → name → display_name 순.
const FAV_STORE_KEY = (planId: string) => `cocotrip:fav:${planId}`;

function makeStopKey(stop: PlanStop): string {
  // stop.order 는 0이 valid 값이라 `||` 폴백 못 쓰고, nullish coalescing 은 mojibake 가드 차단.
  if (stop.order !== undefined && stop.order !== null) return String(stop.order);
  return String(stop.start_time || stop.name || stop.display_name || '');
}

function readFavSet(planId: string): Record<string, true> {
  if (!planId || typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(FAV_STORE_KEY(planId));
    return raw ? (JSON.parse(raw) as Record<string, true>) : {};
  } catch {
    return {};
  }
}

function writeFavSet(planId: string, set: Record<string, true>) {
  if (!planId || typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(FAV_STORE_KEY(planId), JSON.stringify(set));
  } catch {
    // localStorage quota / private mode 등은 silent — 사용자 흐름 깨지 않게
  }
}

// batch 9 (2026-05-09): stop.address 에서 wizard cityKey 추론.
// buildAttractionLink 가 cityKey 로 도시명을 검색 키워드 prefix 에 추가 → 정확도 ↑.
// address 없거나 매칭 안 되면 undefined 반환 → buildAttractionLink 가 keyword 만으로 검색.
function inferCityKey(address: string | undefined): string | undefined {
  if (!address) return undefined;
  if (/서울특별시|서울시|Seoul/i.test(address)) return 'seoul';
  if (/부산광역시|부산시|Busan/i.test(address)) return 'busan';
  if (/제주특별자치도|제주시|Jeju/i.test(address)) return 'jeju';
  if (/경주시|Gyeongju/i.test(address)) return 'gyeongju';
  if (/전주시|Jeonju/i.test(address)) return 'jeonju';
  if (/강릉시|Gangneung/i.test(address)) return 'gangneung';
  if (/대구광역시|대구시|Daegu/i.test(address)) return 'daegu';
  if (/여수시|Yeosu/i.test(address)) return 'yeosu';
  if (/수원시|Suwon/i.test(address)) return 'suwon';
  if (/춘천시|Chuncheon/i.test(address)) return 'chuncheon';
  if (/단양군|Danyang/i.test(address)) return 'danyang';
  if (/인천광역시|인천시|Incheon/i.test(address)) return 'incheon';
  return undefined;
}

// batch 9: Trip.com Activities (입장권/체험) 검색 링크 노출 조건.
// - 입장료 있는 stop (entry_fee_krw > 0) → 입장권 검색 직결 (경복궁, 창덕궁 등)
// - 또는 culture/landmark/kpop/nature 카테고리 (무료여도 가이드 투어 가능)
// - food/cafe/shopping 은 명시 제외 (Trip.com Activities 와 무관)
const ATTRACTION_CATEGORIES = ['culture', 'landmark', 'kpop', 'nature'];
const ATTRACTION_SKIP_CATEGORIES = ['food', 'cafe', 'shopping'];

function shouldShowAttractionLink(stop: PlanStop): boolean {
  const category = (stop.category || '').toLowerCase();
  if (ATTRACTION_SKIP_CATEGORIES.includes(category)) return false;
  if ((stop.entry_fee_krw || 0) > 0) return true;
  return ATTRACTION_CATEGORIES.includes(category);
}

function buildNaverMapUrl(stop: PlanStop): string {
  if (stop.naverMapUrl) return stop.naverMapUrl;
  if (stop.lat && stop.lng) {
    const q = stop.name || stop.name_ko || stop.display_name || stop.name_en || '';
    return `https://map.naver.com/v5/search/${encodeURIComponent(q)}?c=${stop.lng},${stop.lat},15,0,0,0,dh`;
  }
  const nameKo = (stop.name || stop.name_ko || '').replace(/\s*\(.*\)\s*/g, '').trim();
  const addrMatch = (stop.address || '').match(/([가-힣]+구)/);
  const district = addrMatch ? addrMatch[1] : '';
  const q = district ? `${district} ${nameKo}` : (nameKo || stop.display_name || stop.name_en || '');
  return `https://map.naver.com/v5/search/${encodeURIComponent(q)}`;
}

/**
 * P116 (2026-05-20): 호텔 stop 이 매일 첫 + 마지막 stop 으로 노출되는 lodging
 * bookend 패턴이 사용자에게 "호텔 2번 표시 = 중복 버그" 로 보임 (plan 4792076e
 * 보고). lodgingRole 로 첫/마지막/중간 호텔 구분 표시:
 *   - 'checkout': city-change day 첫 stop 호텔 (다른 도시로 출발 전 체크아웃)
 *   - 'depart': 일반 day 첫 stop 호텔 (당일 출발)
 *   - 'checkin': day 중간의 신규 호텔 (city-change day 새 도시 도착 후)
 *   - 'return': day 마지막 stop 호텔 (취침)
 * undefined 면 기존 동작 (no badge). 비-lodging stop 도 영향 X.
 */
export type LodgingRole = 'checkout' | 'depart' | 'checkin' | 'return';

const LODGING_ROLE_LABEL: Record<LodgingRole, Record<string, string>> = {
  checkout: { ko: '🚪 체크아웃', en: '🚪 Check-out', ja: '🚪 チェックアウト', zh: '🚪 退房' },
  depart:   { ko: '🚪 출발',     en: '🚪 Depart',    ja: '🚪 出発',         zh: '🚪 出发' },
  checkin:  { ko: '🛏️ 체크인',  en: '🛏️ Check-in', ja: '🛏️ チェックイン', zh: '🛏️ 入住' },
  return:   { ko: '🌙 취침 복귀', en: '🌙 Return',    ja: '🌙 帰着',         zh: '🌙 归来' },
};

export function StopCard({ stop, lodgingRole, isOwner }: { stop: PlanStop; lodgingRole?: LodgingRole; isOwner?: boolean }) {
  const { t, language } = useLanguage();
  const ui = getPlanDetailUI(t);
  // 다국어 concat 누수 안전망 (사용자 PDF 보고). 백엔드 sanitize 누락 시 display-time fix.
  const lng = (language as 'ko'|'en'|'ja'|'zh') || 'ko';
  const _rawDisplayName = sanitizeStopName(stop.display_name || stop.name_en || stop.name || stop.name_ko || '', lng);
  // #16 fix: 모든 이름 필드가 빈 값이면 'Unnamed stop' 폴백 (4언어)
  const UNNAMED: Record<string, string> = { ko: '이름 없는 장소', en: 'Unnamed stop', ja: '名称不明', zh: '未命名地点' };
  const cleanDisplayName = _rawDisplayName || UNNAMED[lng] || 'Unnamed stop';
  const cleanKoName = sanitizeStopName(stop.name || stop.name_ko || '', 'ko');
  const lodgingLabel = lodgingRole
    ? (LODGING_ROLE_LABEL[lodgingRole][language] || LODGING_ROLE_LABEL[lodgingRole].en)
    : '';
  // Collapsed default — mobile users see more stops at a glance instead of
  // having one giant card fill the viewport (PR #76 mobile-first analysis).
  const [expanded, setExpanded] = useState(false);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [imageLoaded, setImageLoaded] = useState(false);
  const CatIcon = CAT_ICON[stop.category || ''] || MapPin;
  const cardRef = useRef<HTMLDivElement>(null);

  // Sprint 1 Step 5: 즐겨찾기 — 페이지 plan id + stop key로 localStorage 영속.
  const { planId } = useParams();
  const stopKey = makeStopKey(stop);
  const [isFav, setIsFav] = useState(false);
  useEffect(() => {
    if (!planId) return;
    const set = readFavSet(planId);
    setIsFav(!!set[stopKey]);
  }, [planId, stopKey]);

  const toggleFav: React.MouseEventHandler = (e) => {
    e.stopPropagation();
    if (!planId) return;
    const set = readFavSet(planId);
    if (set[stopKey]) {
      delete set[stopKey];
      setIsFav(false);
      toast(ui.favoriteRemoved || 'Removed from favorites');
    } else {
      set[stopKey] = true;
      setIsFav(true);
      toast.success(ui.favoriteAdded || 'Added to favorites');
    }
    writeFavSet(planId, set);
  };

  const handleShare: React.MouseEventHandler = async (e) => {
    e.stopPropagation();
    const shareUrl = planId ? `https://cocotripkr.com/my-plans/${planId}` : window.location.href;
    const shareText = `${cleanDisplayName} – CocoTrip`;
    const nav = navigator as Navigator & { share?: (data: ShareData) => Promise<void> };
    if (nav.share) {
      try {
        await nav.share({ title: shareText, url: shareUrl });
        return;
      } catch (err) {
        // user cancelled — silent
        if ((err as Error)?.name === 'AbortError') return;
      }
    }
    try {
      await navigator.clipboard.writeText(shareUrl);
      toast.success(ui.linkCopied || 'Link copied');
    } catch {
      toast.error(ui.shareFailed || 'Share unavailable');
    }
  };

  const handleDirections: React.MouseEventHandler = (e) => {
    e.stopPropagation();
    const url = buildNaverMapUrl(stop);
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  const toggle = () => {
    const next = !expanded;
    setExpanded(next);
    if (next && cardRef.current) {
      setTimeout(() => cardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 50);
    }
    // Sprint 2 #7: transit_clicked PostHog event — fire on expand only
    // (collapse is uninteresting). Captures the method/duration so we can
    // tell whether users actually consume transit details.
    if (next && stop.transit_from_prev) {
      void posthogTrack('transit_clicked', {
        method: stop.transit_from_prev.method,
        estMin: stop.transit_from_prev.est_min,
        source: stop.transit_from_prev.source,
      });
    }
  };

  // ODsay public-transit data (if available from RouteAgent)
  const publicTransit = stop.travelFromPrev?.transitOptions?.publicTransit;

  // Show an "Unverified" warning only for food stops that the DB matcher
  // explicitly failed to match. Non-food stops leave `verified` undefined
  // and must not display the badge.
  const isUnverifiedFood = stop.category === 'food' && stop.verified === false;
  // 먹는 곳은 입장료 개념이 없다 — 아래 요금 칩이 "무료" 대신 "식사비 별도"를 쓰게 한다.
  const isFoodStop = ['food', 'cafe', 'restaurant', 'dessert'].includes(
    (stop.category || '').toLowerCase(),
  );
  // Sprint 1 Step 1: 카테고리별 색 토큰 (UI 시각 차별화).
  const catColors = getCatColors(stop.category);

  return (
    <div
      ref={cardRef}
      role="button"
      tabIndex={0}
      aria-expanded={expanded}
      aria-label={`${cleanDisplayName || UNNAMED[lng] || 'Unnamed stop'}, ${stop.start_time}`}
      className="ec-card relative cursor-pointer overflow-hidden p-0 transition-colors hover:border-ec-line-3"
      onClick={toggle}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          toggle();
        }
      }}
    >
      {/* Left accent bar — 카테고리별 색 (Sprint 1 Step 1) */}
      <span aria-hidden className="absolute left-0 top-3 bottom-3 w-[3px] rounded-r"
        style={{ background: catColors.bar }} />

      {/* Collapsed header */}
      <div className="flex items-start gap-3 sm:gap-3.5 p-3.5 sm:p-4 pl-4 sm:pl-5">
        {/* Time + category — clearer hierarchy, time is the anchor */}
        <div className="text-center shrink-0">
          <p className="text-[14px] font-extrabold leading-none text-ec-brand sm:text-[15px]">{stop.start_time}</p>
          <div className={`mt-1.5 w-7 h-7 rounded-full ${catColors.bg} border ${catColors.ring} flex items-center justify-center mx-auto transition-colors`}>
            <CatIcon className={`w-3.5 h-3.5 ${catColors.icon}`} />
          </div>
        </div>

        {/* Title + meta */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <p className="text-[15px] font-bold leading-snug text-ec-ink sm:text-base">{cleanDisplayName}</p>
            {/* P116: lodging role badge — 호텔 카드가 매일 2번 노출되는 bookend
                패턴을 사용자가 "중복 버그" 로 오인하지 않게 명시 구분. */}
            {lodgingRole && (
              <span
                className="ec-chip ec-chip-brand shrink-0 px-2 py-0.5 text-[11px] font-bold"
                title={lodgingLabel}
              >
                {lodgingLabel}
              </span>
            )}
            {stop.local_tag && (() => {
              const tagConfig: Record<string, { bg: string; text: string; emoji: string }> = {
                'Local Pick': { bg: 'bg-ec-brand-wash border-ec-line', text: 'text-ec-brand', emoji: '\u{1F4CD}' },
                'Hidden Gem': { bg: 'bg-ec-sunken border-ec-line', text: 'text-ec-success', emoji: '\u{1F48E}' },
                'Bakery Pilgrimage': { bg: 'bg-ec-sunken border-ec-line', text: 'text-ec-notice', emoji: '\u{1F950}' },
                'Blue Ribbon': { bg: 'bg-ec-sunken border-ec-line', text: 'text-ec-brand', emoji: '\u{1F3C5}' },
              };
              const cfg = tagConfig[stop.local_tag];
              // [live MED] fix: tagConfig\uC5D0 \uC5C6\uB294 raw \uB0B4\uBD80\uD0A4(snake_case, \uD30C\uC774\uD504 \uAD6C\uBD84)\uB294 \uC228\uAE40.
              // zone_courses DB\uAC00 local_tag\uC5D0 "downtown_temple | lotus_lantern_festival" \uD615\uD0DC \uC800\uC7A5 \u2192 UI \uB178\uCD9C \uBC29\uC9C0.
              if (!cfg) return null;
              return <span className={`shrink-0 inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[11px] font-bold border ${cfg.bg} ${cfg.text}`}>{cfg.emoji} {stop.local_tag}</span>;
            })()}
            {isUnverifiedFood && (
              <span
                title={ui.unverifiedHint || 'Not in our verified DB — double-check before visiting.'}
                className="shrink-0 inline-flex items-center gap-0.5 rounded-full border border-ec-line bg-ec-sunken px-1.5 py-0.5 text-[11px] font-bold text-ec-notice"
              >
                <AlertTriangle className="w-2.5 h-2.5" /> {ui.unverifiedBadge || 'Unverified'}
              </span>
            )}
          </div>
          {/* Korean name as subtle subtitle (when display_name is in another language) */}
          {cleanKoName && cleanKoName !== cleanDisplayName && (
            <p className="mt-0.5 text-[13px] text-ec-ink-3">{cleanKoName}</p>
          )}
          {/* Meta chips — pill-style for scannability */}
          <div className="flex items-center gap-1.5 mt-2 flex-wrap">
            <span className="ec-chip px-1.5 py-0.5 text-[12px]">
              <Clock className="w-2.5 h-2.5" /> {stop.stay_min}{ui.minUnit || 'min'}
            </span>
            {/* 🔴 2026-07-28: 식당·카페에 초록 "무료" 칩이 붙던 것 수정.
                entry_fee_krw 는 **입장료**다. 식당은 입장료가 0이라 전부 "무료"로 보여
                손님이 공짜 식사로 오해했다. 먹는 곳은 입장료 개념이 없으므로 "식사비 별도"로
                표시하고, 무료 칩은 실제로 입장료가 없는 관광지에만 쓴다. */}
            {(stop.entry_fee_krw || 0) > 0 ? (
              <span className="ec-chip bg-ec-sunken px-1.5 py-0.5 text-[12px] font-semibold text-ec-notice">
                {formatKRW(stop.entry_fee_krw || 0)}
              </span>
            ) : isFoodStop ? (
              <span className="ec-chip bg-ec-sunken px-1.5 py-0.5 text-[12px] font-semibold text-ec-notice">
                {ui.mealCostLabel || 'Meal cost separate'}
              </span>
            ) : (
              <span className="ec-chip bg-ec-sunken px-1.5 py-0.5 text-[12px] font-semibold text-ec-success">
                {ui.free || 'Free'}
              </span>
            )}
          </div>
        </div>
        {isFav && (
          <Heart aria-hidden className="mt-1 h-3.5 w-3.5 shrink-0 fill-current text-ec-brand" />
        )}
        {/* 운영자: 화살표만으론 펼침 가능 여부를 모를 수 있어 밑에 "자세히" 텍스트(접힘 상태). */}
        <div className="flex flex-col items-center shrink-0 mt-1 gap-0.5">
          <ChevronDown className={`h-4 w-4 text-ec-ink-3 transition-transform duration-300 ${expanded ? 'rotate-180' : ''}`} />
          {!expanded && <span className="whitespace-nowrap text-[9px] leading-none text-ec-ink-4">{({ ko: '자세히', en: 'Details', ja: '詳細', zh: '详情' } as Record<string, string>)[lng] || '자세히'}</span>}
        </div>
      </div>

      {/* Expanded details — mobile: viewport-based 동적 cap (콘텐츠 잘림 방지).
          기존 480px 고정은 personalization_reasoning + tip + photos 다 있을 때 잘림 발생.
          calc(100dvh - 320px): header(56) + tabs(40) + slide progress(40) + collapsed card header(~140) + 여유(44).
          내부 div가 overflow-y-auto이므로 max-h를 넘으면 스크롤. */}
      <div className={`overflow-hidden transition-all duration-300 ease-out ${expanded ? 'max-h-[calc(100dvh-320px)] sm:max-h-[800px] opacity-100' : 'max-h-0 opacity-0'}`}>
        <div className="space-y-3 border-t border-ec-line px-3.5 pb-3.5 pt-3 sm:px-5 sm:pb-4 sm:pt-3.5" onClick={(e) => e.stopPropagation()}>
          {/* Sprint 1 Step 3: Photo preview (Google Places). photo_ref 있으면 thumbnail 렌더.
              expanded 상태에서만 fetch — collapsed 카드 다수 시 비용 절감.
              loading="lazy" + decoding="async" — 모바일 첫 렌더 우선순위 보호. */}
          {stop.photo_ref && (
            <button
              type="button"
              onClick={() => { haptic('tap'); setLightboxOpen(true); }}
              className="group block w-full rounded-ec-sm focus:outline-none"
              aria-label={(ui.openPhoto || 'Open photo of {{name}}').replace('{{name}}', cleanDisplayName)}
            >
              <div className="relative h-44 w-full overflow-hidden rounded-ec-sm border border-ec-line bg-ec-sunken sm:h-52">
                {/* Subtle shimmer placeholder while loading — fades out under the img. */}
                {!imageLoaded && (
                  <div className="absolute inset-0 animate-pulse bg-ec-sunken" />
                )}
                <img
                  src={`/api/place-photo?ref=${encodeURIComponent(stop.photo_ref)}&w=600`}
                  alt={cleanDisplayName}
                  loading="lazy"
                  decoding="async"
                  className={`h-full w-full rounded-ec-sm object-cover transition-opacity duration-300 ${imageLoaded ? 'opacity-100' : 'opacity-0'}`}
                  onLoad={() => setImageLoaded(true)}
                  onError={(e) => { (e.currentTarget.parentElement as HTMLElement).style.display = 'none'; }}
                />
              </div>
            </button>
          )}
          {lightboxOpen && stop.photo_ref && (
            <Lightbox
              src={`/api/place-photo?ref=${encodeURIComponent(stop.photo_ref)}&w=1600`}
              alt={cleanDisplayName}
              closeLabel={t.planDetail.reviews.closeImage}
              onClose={() => setLightboxOpen(false)}
            />
          )}
          {/* Korean subtitle moved to collapsed header to avoid duplication */}
          {stop.address && (
            <p className="flex items-start gap-1.5 text-[14px] leading-relaxed text-ec-ink-2">
              <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ec-brand" />
              <span>{stop.address}</span>
            </p>
          )}
          {stop.personalization_reasoning && (
            <div className="border-l-2 border-ec-line-2 bg-ec-brand-wash px-3 py-2.5">
              <p className="mb-1 text-[13px] font-bold uppercase tracking-wider text-ec-brand">{ui.whyChose || 'Why this for you'}</p>
              <p className="text-[14px] leading-relaxed text-ec-ink">{stop.personalization_reasoning}</p>
            </div>
          )}
          {(stop.tip || stop.tip_en) && (
            <div className="border-l-2 border-ec-notice bg-ec-sunken px-3 py-2.5">
              <p className="mb-1 text-[13px] font-bold uppercase tracking-wider text-ec-notice">{ui.tip || 'Tip'}</p>
              <p className="text-[14px] leading-relaxed text-ec-ink">{stop.tip || stop.tip_en}</p>
            </div>
          )}
          {isUnverifiedFood && (
            <p className="flex items-start gap-1.5 border-l-2 border-ec-notice bg-ec-sunken px-2.5 py-2 text-[12px] text-ec-notice">
              <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
              <span>{ui.unverifiedHint || 'Not in our verified DB — double-check the address before visiting.'}</span>
            </p>
          )}
          {stop.entry_fee_note && <p className="text-[13px] text-ec-ink-2">{stop.entry_fee_note}</p>}

          {/* Reservation info */}
          {stop.reservation_required && (
            <div className="border-l-2 border-ec-notice bg-ec-sunken px-3 py-2.5">
              <p className="text-[13px] font-semibold text-ec-notice">{ui.pdfReservationRequired || 'Reservation required'}</p>
              {stop.reservation_note && <p className="mt-0.5 text-[12px] text-ec-ink-2">{stop.reservation_note}</p>}
              <div className="flex flex-wrap gap-3 mt-1">
                {stop.reservation_phone && (
                  <a href={`tel:${stop.reservation_phone}`} className="inline-flex min-h-[44px] items-center text-[12px] text-ec-brand underline">{stop.reservation_phone}</a>
                )}
                {stop.reservation_url && (
                  <a href={stop.reservation_url} target="_blank" rel="noopener noreferrer" className="flex min-h-[44px] items-center gap-0.5 text-[12px] text-ec-brand underline">
                    <ExternalLink className="w-2.5 h-2.5" /> {ui.bookOnline || 'Book online'}
                  </a>
                )}
              </div>
            </div>
          )}

          {stop.accessibility_note && (
            <p className="flex items-center gap-1 text-[13px] text-ec-brand">
              <Accessibility className="w-3 h-3" /> {stop.accessibility_note}
            </p>
          )}

          {/* Recommended items */}
          {(stop.recommended_items?.length || 0) > 0 && (
            <div>
              <p className="mb-1.5 text-[13px] uppercase tracking-wider text-ec-ink-3">{ui.pdfRecommended || 'Recommended'}</p>
              <div className="space-y-1">
                {stop.recommended_items!.map((rawItem, i: number) => {
                  const item = normalizeRecommendedItem(rawItem);
                  if (!item.name) return null;
                  return (
                    <div key={i} className="flex items-center justify-between rounded-ec-sm bg-ec-sunken px-3 py-2">
                      <div className="flex-1 min-w-0">
                        <span className="text-[13px] text-ec-ink-2">{item.name}</span>
                        {item.note && <span className="ml-1.5 text-[13px] text-ec-ink-3">{'\u00B7'} {item.note}</span>}
                      </div>
                      {(item.price_krw || 0) > 0 && <span className="ml-2 shrink-0 text-[13px] font-bold text-ec-brand">{formatKRW(item.price_krw || 0)}</span>}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* ODsay public-transit route (real transit data) */}
          {publicTransit && publicTransit.method !== 'walk' && (
            <div className="rounded-ec-sm border border-ec-line bg-ec-sunken p-3">
              <div className="flex items-center gap-2 mb-2 flex-wrap">
                <Train className="h-3.5 w-3.5 text-ec-brand" aria-hidden />
                <p className="text-[13px] font-bold text-ec-brand">{ui.publicTransitRoute || 'Public transit route'}</p>
                <span className="ml-auto text-[12px] text-ec-ink-3">{publicTransit.duration}min {'\u00B7'} {formatKRW(publicTransit.fare)}</span>
              </div>
              {publicTransit.steps?.length > 0 && (
                <div className="space-y-1">
                  {publicTransit.steps.map((step: { mode?: string; description?: string }, i: number) => (
                    <div key={i} className="flex items-center gap-2 text-[12px]">
                      {step.mode === 'subway' && <Train className="h-3 w-3 shrink-0 text-ec-brand" aria-hidden />}
                      {step.mode === 'bus' && <Bus className="h-3 w-3 shrink-0 text-ec-success" aria-hidden />}
                      {step.mode === 'walk' && <Footprints className="h-3 w-3 shrink-0 text-ec-ink-3" />}
                      <span className={step.mode === 'walk' ? 'text-ec-ink-3' : 'text-ec-ink-2'}>{step.description}</span>
                    </div>
                  ))}
                </div>
              )}
              {publicTransit.transfers > 0 && (
                <p className="mt-1.5 text-[13px] text-ec-ink-3">{ui.transitTransfers || 'Transfers'}: {publicTransit.transfers}</p>
              )}
            </div>
          )}

          {/* Sprint 1 Step 5: Action row — favorite, share, directions */}
          <div className="flex items-center gap-2 pt-1">
            {/* Favorite/Share = plan 소유자 전용 — 공유/비소유자 뷰어한텐 숨김. */}
            {isOwner && (
              <button
                type="button"
                onClick={toggleFav}
                aria-pressed={isFav}
                aria-label={isFav ? (ui.favoriteRemove || 'Remove from favorites') : (ui.favoriteAdd || 'Add to favorites')}
                className={`flex-1 min-h-[44px] inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-[13px] font-semibold border transition-colors active:scale-[0.98]
                  ${isFav
                    ? 'border-ec-brand bg-ec-brand-wash text-ec-brand hover:border-ec-brand-hover'
                    : 'border-ec-line bg-ec-raised text-ec-ink-2 hover:border-ec-line-2 hover:text-ec-ink'}`}
              >
                <Heart className={`w-3.5 h-3.5 ${isFav ? 'fill-current' : ''}`} />
                {isFav ? (ui.favoriteSaved || 'Saved') : (ui.favoriteLabel || 'Favorite')}
              </button>
            )}
            {isOwner && (
              <button
                type="button"
                onClick={handleShare}
                aria-label={ui.shareLabel || 'Share'}
                className="ec-btn ec-btn-secondary min-h-[44px] flex-1 px-3 text-[13px]"
              >
                <Share2 className="w-3.5 h-3.5" />
                {ui.shareLabel || 'Share'}
              </button>
            )}
            <button
              type="button"
              onClick={handleDirections}
              aria-label={ui.directionsLabel || 'Directions'}
              className="ec-btn ec-btn-secondary min-h-[44px] flex-1 px-3 text-[13px] text-ec-success"
            >
              <Navigation className="w-3.5 h-3.5" />
              {ui.directionsLabel || 'Directions'}
            </button>
          </div>

          {/* batch 9 (2026-05-09): Trip.com Activities 입장권/체험 검색 링크.
              culture/landmark/kpop/nature 카테고리 또는 입장료 있는 stop 에 노출.
              cityKey 는 address 에서 자동 추론 — 다른 도시 동명 명소 매칭률 ↓. */}
          {shouldShowAttractionLink(stop) && (() => {
            const placeName = cleanDisplayName || cleanKoName;
            if (!placeName) return null;
            const cityKey = inferCityKey(stop.address);
            const url = buildAttractionLink(placeName, cityKey);
            // 🔴 linkKey 가 없으면 같은 도시의 장소 N개가 `aff_seen:attraction:plan_day_stop:-:seoul`
            //   하나로 합쳐져 노출이 세션당 1회로 접힌다(클릭은 장소마다 쌓임) → CTR 이 100% 를
            //   넘는 값이 나온다. 그래서 **클릭·노출 양쪽에 같은 linkKey** 를 넣는다.
            //   값은 order 우선이라 보통 짧은 숫자다. 폴백이 장소명까지 내려갈 수 있어 16자로
            //   자른다 — linkKey 는 "짧은 식별자" 규격이다(affiliateTracking.ts 주석).
            const affPayload = {
              product: 'attraction' as const, placement: 'plan_day_stop',
              language: lng, city: cityKey, linkKey: makeStopKey(stop).slice(0, 16),
            };
            return (
              // 부모가 `space-y-3` 블록이라 래퍼가 1개 늘어도 간격 규칙은 그대로 걸린다.
              // `flex` 를 주는 이유: 원래 `<a>` 가 inline-flex 라 line-box 스트럿 여백이 얹혀
              // 있었는데 블록 래퍼로 감싸면 그 여백이 사라져 간격이 미세하게 달라진다.
              // ⚠️ `display:contents` 금지 — 박스가 사라져 IntersectionObserver 교차 영역이 0 이
              //    되고 노출이 영구 0 이 된다(조용히 실패한다).
              <AffiliateCard className="flex" payload={affPayload}>
                <a
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer sponsored"
                  onClick={() => trackAffiliateClick(affPayload)}
                  className="ec-btn ec-btn-secondary inline-flex min-h-[44px] items-center gap-1.5 px-3 text-[13px] text-ec-brand"
                >
                  <Ticket className="w-3 h-3" /> {ui.searchTickets || 'Search tickets on Trip.com'}
                </a>
              </AffiliateCard>
            );
          })()}

          {/* Naver Map link - coordinate-based URL preferred for accuracy */}
          {(() => {
            // 1. RouteAgent-provided URL (most accurate)
            if (stop.naverMapUrl) {
              return (
                <a href={stop.naverMapUrl} target="_blank" rel="noopener noreferrer" className="ec-btn ec-btn-secondary inline-flex min-h-[44px] items-center gap-1.5 px-3 text-[13px] text-ec-success">
                  <ExternalLink className="w-3 h-3" /> {ui.openNaverMap || 'Open in Naver Map'}
                </a>
              );
            }
            // 2. lat/lng available -> build coordinate URL
            if (stop.lat && stop.lng) {
              const coordUrl = `https://map.naver.com/v5/search/${encodeURIComponent(stop.name || stop.name_ko || stop.display_name || stop.name_en || '')}?c=${stop.lng},${stop.lat},15,0,0,0,dh`;
              return (
                <a href={coordUrl} target="_blank" rel="noopener noreferrer" className="ec-btn ec-btn-secondary inline-flex min-h-[44px] items-center gap-1.5 px-3 text-[13px] text-ec-success">
                  <ExternalLink className="w-3 h-3" /> {ui.openNaverMap || 'Open in Naver Map'}
                </a>
              );
            }
            // 3. Fallback: district-prefixed name search (higher accuracy than name alone)
            const nameKo = (stop.name || stop.name_ko || '').replace(/\s*\(.*\)\s*/g, '').trim();
            // Extract district ("gu") from address, e.g. "Jongno-gu"
            const addrMatch = (stop.address || '').match(/([\uAC00-\uD7A3]+\uAD6C)/);
            const district = addrMatch ? addrMatch[1] : '';
            const searchQuery = district ? `${district} ${nameKo}` : (nameKo || stop.display_name || stop.name_en || '');
            const mapUrl = `https://map.naver.com/v5/search/${encodeURIComponent(searchQuery)}`;
            return (
              <a href={mapUrl} target="_blank" rel="noopener noreferrer" className="ec-btn ec-btn-secondary inline-flex min-h-[44px] items-center gap-1.5 px-3 text-[13px] text-ec-success">
                <ExternalLink className="w-3 h-3" /> {ui.openNaverMap || 'Open in Naver Map'}
              </a>
            );
          })()}

          {/* Google Maps 링크 — 무료 딥링크 URL(API 키 불필요). 외국인 선호. 좌표 우선, 없으면 이름 검색. */}
          {(() => {
            const q = (stop.lat && stop.lng)
              ? `${stop.lat},${stop.lng}`
              : (cleanKoName || cleanDisplayName || '');
            if (!q) return null;
            const gUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`;
            return (
              <a href={gUrl} target="_blank" rel="noopener noreferrer" className="ec-btn ec-btn-secondary inline-flex min-h-[44px] items-center gap-1.5 px-3 text-[13px] text-ec-brand">
                <ExternalLink className="w-3 h-3" /> {ui.openGoogleMap || 'Open in Google Maps'}
              </a>
            );
          })()}
        </div>
      </div>
    </div>
  );
}
