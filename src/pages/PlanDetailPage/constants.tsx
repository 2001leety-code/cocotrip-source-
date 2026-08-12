// Shared constants + helpers for PlanDetailPage.
// Extracted from src/pages/PlanDetailPage.tsx (L25-36) during P2 Lock release.
import type { LucideIcon } from 'lucide-react';
import {
  Train, Bus, Car, Footprints,
  Landmark, UtensilsCrossed, ShoppingBag, Camera, Music2, Mountain,
} from 'lucide-react';

export const CAT_ICON: Record<string, LucideIcon> = {
  culture: Landmark, food: UtensilsCrossed, shopping: ShoppingBag,
  nature: Mountain, landmark: Camera, kpop: Music2,
};

/**
 * 카테고리별 색 토큰 — Sprint 1 Step 1 (사용자 신고 "UI 개선 심각").
 * 모든 stop 카드가 동일한 보라색 강조선 → 시각 구분 약함.
 * 카테고리별 차별화로 한눈에 식당/문화/쇼핑 구분 + 시각 다양성.
 *
 * 각 토큰:
 *   - bar: 좌측 accent bar 단색
 *   - icon: 흰 종이 바탕에서도 읽히는 아이콘 색
 *   - bg: 카드 hover/expanded 시 미세한 tint (선택적)
 */
export const CAT_COLORS: Record<string, { bar: string; icon: string; bg: string; ring: string }> = {
  food:     { bar: '#B45309', icon: 'text-amber-700',   bg: 'bg-amber-50',   ring: 'border-amber-200' },
  culture:  { bar: '#4338CA', icon: 'text-indigo-700',  bg: 'bg-indigo-50',  ring: 'border-indigo-200' },
  shopping: { bar: '#BE185D', icon: 'text-pink-700',    bg: 'bg-pink-50',    ring: 'border-pink-200' },
  nature:   { bar: '#047857', icon: 'text-emerald-700', bg: 'bg-emerald-50', ring: 'border-emerald-200' },
  landmark: { bar: '#0369A1', icon: 'text-sky-700',     bg: 'bg-sky-50',     ring: 'border-sky-200' },
  kpop:     { bar: '#A21CAF', icon: 'text-fuchsia-700', bg: 'bg-fuchsia-50', ring: 'border-fuchsia-200' },
  default:  { bar: 'var(--ec-brand)', icon: 'text-ec-brand', bg: 'bg-ec-brand-wash', ring: 'border-ec-line-2' },
};

export function getCatColors(category: string | undefined) {
  return CAT_COLORS[category || 'default'] || CAT_COLORS.default;
}

export const TRANSIT_ICON: Record<string, LucideIcon> = {
  subway: Train, taxi: Car, walk: Footprints, bus: Bus, car: Car,
  'subway+bus': Train,
};

export function formatKRW(n: number) {
  if (!n || isNaN(n)) return '';
  return '\u20A9' + new Intl.NumberFormat('ko-KR').format(n);
}
