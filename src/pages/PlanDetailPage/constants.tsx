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
 * 모든 stop 카드가 동일 purple gradient → 시각 구분 약함.
 * 카테고리별 차별화로 한눈에 식당/문화/쇼핑 구분 + 시각 다양성.
 *
 * 각 토큰:
 *   - bar: 좌측 accent bar gradient (기존 BRAND.gradient.primaryVertical 대체)
 *   - icon: 아이콘 색 (기존 text-white/55 대체)
 *   - bg: 카드 hover/expanded 시 미세한 tint (선택적)
 */
export const CAT_COLORS: Record<string, { bar: string; icon: string; bg: string; ring: string }> = {
  food:     { bar: 'linear-gradient(180deg, #F59E0B, #EA580C)', icon: 'text-amber-300',   bg: 'bg-amber-500/[0.04]',   ring: 'border-amber-500/30' },
  culture:  { bar: 'linear-gradient(180deg, #818CF8, #6366F1)', icon: 'text-indigo-300',  bg: 'bg-indigo-500/[0.04]',  ring: 'border-indigo-500/30' },
  shopping: { bar: 'linear-gradient(180deg, #F472B6, #EC4899)', icon: 'text-pink-300',    bg: 'bg-pink-500/[0.04]',    ring: 'border-pink-500/30' },
  nature:   { bar: 'linear-gradient(180deg, #34D399, #059669)', icon: 'text-emerald-300', bg: 'bg-emerald-500/[0.04]', ring: 'border-emerald-500/30' },
  landmark: { bar: 'linear-gradient(180deg, #60A5FA, #3B82F6)', icon: 'text-sky-300',     bg: 'bg-sky-500/[0.04]',     ring: 'border-sky-500/30' },
  kpop:     { bar: 'linear-gradient(180deg, #E879F9, #C026D3)', icon: 'text-fuchsia-300', bg: 'bg-fuchsia-500/[0.04]', ring: 'border-fuchsia-500/30' },
  // Default: 기존 brand purple
  default:  { bar: 'linear-gradient(180deg, #B668FC, #7C5CFC)', icon: 'text-white/55',    bg: 'bg-white/[0.04]',       ring: 'border-white/[0.08]' },
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
