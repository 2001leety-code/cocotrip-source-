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
  // Sprint 1 Step 1: 카테고리별 색 토큰 (UI 시각 차별화).
  const catColors = getCatColors(stop.category);

  return (
    <div
      ref={cardRef}
      role="button"
      tabIndex={0}
      aria-expanded={expanded}
      aria-label={`${cleanDisplayName || UNNAMED[lng] || 'Unnamed stop'}, ${stop.start_time}`}
      className="relative bg-white/[0.04] border border-white/[0.08] rounded-xl shadow-[0_2px_12px_rgba(0,0,0,0.28)] hover:border-[#7C5CFC]/50 hover:bg-white/[0.07] hover:shadow-lg hover:shadow-[#7C5CFC]/10 active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7C5CFC] focus-visible:ring-offset-2 focus-visible:ring-offset-[#0a0412] transition-[border-color,background-color,box-shadow,transform] duration-200 cursor-pointer overflow-hidden"
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
          <p className="text-[14px] sm:text-[15px] font-extrabold text-[#B9A4FF] leading-none">{stop.start_time}</p>
          <div className={`mt-1.5 w-7 h-7 rounded-full ${catColors.bg} border ${catColors.ring} flex items-center justify-center mx-auto transition-colors`}>
            <CatIcon className={`w-3.5 h-3.5 ${catColors.icon}`} />
          </div>
        </div>

        {/* Title + meta */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <p className="text-[15px] sm:text-base font-bold text-white leading-snug">{cleanDisplayName}</p>
            {/* P116: lodging role badge — 호텔 카드가 매일 2번 노출되는 bookend
                패턴을 사용자가 "중복 버그" 로 오인하지 않게 명시 구분. */}
            {lodgingRole && (
              <span
                className="shrink-0 inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[11px] font-bold border bg-[#7C5CFC]/15 border-[#7C5CFC]/30 text-[#B9A4FF]"
                title={`Lodging ${lodgingRole}`}
              >
                {LODGING_ROLE_LABEL[lodgingRole][language] || LODGING_ROLE_LABEL[lodgingRole].en}
              </span>
            )}
            {stop.local_tag && (() => {
              const tagConfig: Record<string, { bg: string; text: string; emoji: string }> = {
                'Local Pick': { bg: 'bg-purple-500/20 border-purple-500/30', text: 'text-purple-300', emoji: '\u{1F4CD}' },
                'Hidden Gem': { bg: 'bg-emerald-500/20 border-emerald-500/30', text: 'text-emerald-300', emoji: '\u{1F48E}' },
                'Bakery Pilgrimage': { bg: 'bg-amber-500/20 border-amber-500/30', text: 'text-amber-300', emoji: '\u{1F950}' },
                'Blue Ribbon': { bg: 'bg-blue-500/20 border-blue-500/30', text: 'text-blue-300', emoji: '\u{1F3C5}' },
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
                className="shrink-0 inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[11px] font-bold border bg-amber-500/15 border-amber-500/35 text-amber-300"
              >
                <AlertTriangle className="w-2.5 h-2.5" /> {ui.unverifiedBadge || 'Unverified'}
              </span>
            )}
          </div>
          {/* Korean name as subtle subtitle (when display_name is in another language) */}
          {cleanKoName && cleanKoName !== cleanDisplayName && (
            <p className="text-[13px] text-white/65 mt-0.5">{cleanKoName}</p>
          )}
          {/* Meta chips — pill-style for scannability */}
          <div className="flex items-center gap-1.5 mt-2 flex-wrap">
            <span className="inline-flex items-center gap-1 bg-white/[0.05] border border-white/[0.08] rounded-md px-1.5 py-0.5 text-[12px] text-white/70">
              <Clock className="w-2.5 h-2.5" /> {stop.stay_min}{ui.minUnit || 'min'}
            </span>
            {(stop.entry_fee_krw || 0) > 0 ? (
              <span className="inline-flex items-center gap-1 bg-yellow-400/10 border border-yellow-400/25 rounded-md px-1.5 py-0.5 text-[12px] text-yellow-200 font-semibold">
                {formatKRW(stop.entry_fee_krw || 0)}
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 bg-emerald-400/10 border border-emerald-400/25 rounded-md px-1.5 py-0.5 text-[12px] text-emerald-200 font-semibold">
                {ui.free || 'Free'}
              </span>
            )}
          </div>
        </div>
        {isFav && (
          <Heart aria-hidden className="w-3.5 h-3.5 text-pink-400 fill-current shrink-0 mt-1" />
        )}
        <ChevronDown className={`w-4 h-4 text-white/55 shrink-0 mt-1 transition-transform duration-300 ${expanded ? 'rotate-180' : ''}`} />
      </div>

      {/* Expanded details — mobile: viewport-based 동적 cap (콘텐츠 잘림 방지).
          기존 480px 고정은 personalization_reasoning + tip + photos 다 있을 때 잘림 발생.
          calc(100dvh - 320px): header(56) + tabs(40) + slide progress(40) + collapsed card header(~140) + 여유(44).
          내부 div가 overflow-y-auto이므로 max-h를 넘으면 스크롤. */}
      <div className={`overflow-hidden transition-all duration-300 ease-out ${expanded ? 'max-h-[calc(100dvh-320px)] sm:max-h-[800px] opacity-100' : 'max-h-0 opacity-0'}`}>
        <div className="px-3.5 pb-3.5 pt-3 sm:px-5 sm:pb-4 sm:pt-3.5 border-t border-white/[0.06] space-y-3" onClick={(e) => e.stopPropagation()}>
          {/* Sprint 1 Step 3: Photo preview (Google Places). photo_ref 있으면 thumbnail 렌더.
              expanded 상태에서만 fetch — collapsed 카드 다수 시 비용 절감.
              loading="lazy" + decoding="async" — 모바일 첫 렌더 우선순위 보호. */}
          {stop.photo_ref && (
            <button
              type="button"
              onClick={() => { haptic('tap'); setLightboxOpen(true); }}
              className="w-full block group focus:outline-none focus:ring-2 focus:ring-[#7C5CFC]/60 rounded-lg"
              aria-label={`Open ${cleanDisplayName} photo`}
            >
              <div className="relative w-full h-44 sm:h-52 rounded-lg overflow-hidden border border-white/[0.06] bg-white/[0.04]">
                {/* Subtle shimmer placeholder while loading — fades out under the img. */}
                {!imageLoaded && (
                  <div
                    className="absolute inset-0 animate-pulse"
                    style={{ background: 'linear-gradient(90deg, rgba(255,255,255,0.04) 0%, rgba(255,255,255,0.08) 50%, rgba(255,255,255,0.04) 100%)' }}
                  />
                )}
                <img
                  src={`/api/place-photo?ref=${encodeURIComponent(stop.photo_ref)}&w=600`}
                  alt={cleanDisplayName}
                  loading="lazy"
                  decoding="async"
                  className={`w-full h-full rounded-lg object-cover transition-opacity duration-300 group-hover:scale-[1.02] group-active:scale-[0.99] ${imageLoaded ? 'opacity-100' : 'opacity-0'}`}
                  style={{ transitionProperty: 'opacity, transform' }}
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
              onClose={() => setLightboxOpen(false)}
            />
          )}
          {/* Korean subtitle moved to collapsed header to avoid duplication */}
          {stop.address && (
            <p className="text-[14px] text-white/65 flex items-start gap-1.5 leading-relaxed">
              <MapPin className="w-3.5 h-3.5 shrink-0 text-[#7C5CFC]/70 mt-0.5" />
              <span>{stop.address}</span>
            </p>
          )}
          {stop.personalization_reasoning && (
            <div className="bg-[#7C5CFC]/[0.08] border border-[#7C5CFC]/25 rounded-lg px-3 py-2.5">
              <p className="text-[13px] font-bold text-[#B668FC] uppercase tracking-wider mb-1">{ui.whyChose || 'Why this for you'}</p>
              <p className="text-[14px] text-white/85 leading-relaxed">{stop.personalization_reasoning}</p>
            </div>
          )}
          {(stop.tip || stop.tip_en) && (
            <div className="bg-amber-400/[0.06] border border-amber-400/20 rounded-lg px-3 py-2.5">
              <p className="text-[13px] font-bold text-amber-300 uppercase tracking-wider mb-1">{ui.tip || 'Tip'}</p>
              <p className="text-[14px] text-white/85 leading-relaxed">{stop.tip || stop.tip_en}</p>
            </div>
          )}
          {isUnverifiedFood && (
            <p className="text-[12px] text-amber-300/80 flex items-start gap-1.5 bg-amber-500/5 border border-amber-500/15 rounded-lg px-2.5 py-2">
              <AlertTriangle className="w-3 h-3 shrink-0 mt-0.5" />
              <span>{ui.unverifiedHint || 'Not in our verified DB — double-check the address before visiting.'}</span>
            </p>
          )}
          {stop.entry_fee_note && <p className="text-[13px] text-yellow-400/70">{stop.entry_fee_note}</p>}

          {/* Reservation info */}
          {stop.reservation_required && (
            <div className="bg-orange-500/10 border border-orange-500/20 rounded-lg px-3 py-2">
              <p className="text-[13px] text-orange-400/80 font-semibold">Reservation required</p>
              {stop.reservation_note && <p className="text-[12px] text-orange-400/70 mt-0.5">{stop.reservation_note}</p>}
              <div className="flex flex-wrap gap-3 mt-1">
                {stop.reservation_phone && (
                  <a href={`tel:${stop.reservation_phone}`} className="text-[12px] text-orange-400/70 underline min-h-[44px] inline-flex items-center">{stop.reservation_phone}</a>
                )}
                {stop.reservation_url && (
                  <a href={stop.reservation_url} target="_blank" rel="noopener noreferrer" className="text-[12px] text-orange-400/70 underline min-h-[44px] flex items-center gap-0.5">
                    <ExternalLink className="w-2.5 h-2.5" /> Book online
                  </a>
                )}
              </div>
            </div>
          )}

          {stop.accessibility_note && (
            <p className="text-[13px] text-blue-400/80 flex items-center gap-1">
              <Accessibility className="w-3 h-3" /> {stop.accessibility_note}
            </p>
          )}

          {/* Recommended items */}
          {(stop.recommended_items?.length || 0) > 0 && (
            <div>
              <p className="text-[13px] text-white/65 mb-1.5 uppercase tracking-wider">Recommended</p>
              <div className="space-y-1">
                {stop.recommended_items!.map((rawItem, i: number) => {
                  const item = normalizeRecommendedItem(rawItem);
                  if (!item.name) return null;
                  return (
                    <div key={i} className="flex items-center justify-between bg-white/[0.04] rounded-lg px-3 py-2">
                      <div className="flex-1 min-w-0">
                        <span className="text-[13px] text-white/75">{item.name}</span>
                        {item.note && <span className="text-[13px] text-white/60 ml-1.5">{'\u00B7'} {item.note}</span>}
                      </div>
                      {(item.price_krw || 0) > 0 && <span className="text-[13px] text-[#7C5CFC] font-bold shrink-0 ml-2">{formatKRW(item.price_krw || 0)}</span>}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* ODsay public-transit route (real transit data) */}
          {publicTransit && publicTransit.method !== 'walk' && (
            <div className="bg-blue-500/8 border border-blue-500/15 rounded-xl p-3">
              <div className="flex items-center gap-2 mb-2 flex-wrap">
                <Train className="w-3.5 h-3.5 text-blue-400" />
                <p className="text-[13px] font-bold text-blue-400">Public Transit Route</p>
                <span className="ml-auto text-[12px] text-white/65">{publicTransit.duration}min {'\u00B7'} {formatKRW(publicTransit.fare)}</span>
              </div>
              {publicTransit.steps?.length > 0 && (
                <div className="space-y-1">
                  {publicTransit.steps.map((step: { mode?: string; description?: string }, i: number) => (
                    <div key={i} className="flex items-center gap-2 text-[12px]">
                      {step.mode === 'subway' && <Train className="w-3 h-3 text-blue-400/70 shrink-0" />}
                      {step.mode === 'bus' && <Bus className="w-3 h-3 text-green-400/70 shrink-0" />}
                      {step.mode === 'walk' && <Footprints className="w-3 h-3 text-white/55 shrink-0" />}
                      <span className={step.mode === 'walk' ? 'text-white/65' : 'text-white/70'}>{step.description}</span>
                    </div>
                  ))}
                </div>
              )}
              {publicTransit.transfers > 0 && (
                <p className="text-[13px] text-white/65 mt-1.5">Transfers: {publicTransit.transfers}</p>
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
                    ? 'bg-pink-500/15 border-pink-500/40 text-pink-300 hover:bg-pink-500/20'
                    : 'bg-white/[0.04] border-white/10 text-white/65 hover:bg-white/[0.07] hover:text-white/85'}`}
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
                className="flex-1 min-h-[44px] inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-[13px] font-semibold border bg-white/[0.04] border-white/10 text-white/65 hover:bg-white/[0.07] hover:text-white/85 transition-colors active:scale-[0.98]"
              >
                <Share2 className="w-3.5 h-3.5" />
                {ui.shareLabel || 'Share'}
              </button>
            )}
            <button
              type="button"
              onClick={handleDirections}
              aria-label={ui.directionsLabel || 'Directions'}
              className="flex-1 min-h-[44px] inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-[13px] font-semibold border bg-emerald-500/10 border-emerald-500/30 text-emerald-300 hover:bg-emerald-500/15 transition-colors active:scale-[0.98]"
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
            return (
              <a
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center min-h-[44px] gap-1.5 text-[13px] text-blue-300/80 hover:text-blue-300 bg-blue-500/10 hover:bg-blue-500/15 border border-blue-500/20 rounded-lg px-3 py-2 transition-colors"
              >
                <Ticket className="w-3 h-3" /> {ui.searchTickets || 'Search tickets on Trip.com'}
              </a>
            );
          })()}

          {/* Naver Map link - coordinate-based URL preferred for accuracy */}
          {(() => {
            // 1. RouteAgent-provided URL (most accurate)
            if (stop.naverMapUrl) {
              return (
                <a href={stop.naverMapUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center min-h-[44px] gap-1.5 text-[13px] text-green-400/70 hover:text-green-400 bg-green-500/10 rounded-lg px-3 py-2">
                  <ExternalLink className="w-3 h-3" /> {ui.openNaverMap || 'Open in Naver Map'}
                </a>
              );
            }
            // 2. lat/lng available -> build coordinate URL
            if (stop.lat && stop.lng) {
              const coordUrl = `https://map.naver.com/v5/search/${encodeURIComponent(stop.name || stop.name_ko || stop.display_name || stop.name_en || '')}?c=${stop.lng},${stop.lat},15,0,0,0,dh`;
              return (
                <a href={coordUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center min-h-[44px] gap-1.5 text-[13px] text-green-400/70 hover:text-green-400 bg-green-500/10 rounded-lg px-3 py-2">
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
              <a href={mapUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center min-h-[44px] gap-1.5 text-[13px] text-green-400/70 hover:text-green-400 bg-green-500/10 rounded-lg px-3 py-2">
                <ExternalLink className="w-3 h-3" /> {ui.openNaverMap || 'Open in Naver Map'}
              </a>
            );
          })()}
        </div>
      </div>
    </div>
  );
}
