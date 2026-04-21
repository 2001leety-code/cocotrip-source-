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

export const TRANSIT_ICON: Record<string, LucideIcon> = {
  subway: Train, taxi: Car, walk: Footprints, bus: Bus, car: Car,
};

export function formatKRW(n: number) {
  if (!n || isNaN(n)) return '';
  return '\u20A9' + new Intl.NumberFormat('ko-KR').format(n);
}
