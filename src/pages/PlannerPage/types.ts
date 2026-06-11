// Type definitions for PlannerPage -- extracted verbatim from legacy PlannerPage.tsx.
import type { ActivityMeta } from '@/types/plan';

/** i18n planner dictionary — replaces `p: any` across all planner components */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type PlannerDict = Record<string, any>;

export interface TransportToNext {
  method: string;
  detail: string;
  durationMin: number;
  costKRW: string;
  fatigueComment?: string;
  charterRecommended?: string;
  charterReason?: string;
  charterCostEstimate?: string;
}

export interface Place {
  order: number; name: string; nameEn: string; category: string;
  address: string; coordinates: { lat: number; lng: number };
  duration?: string; admissionFee?: string;
  tips: string; rainyAlternative?: string;
  transportToNext?: TransportToNext;
  openingHours?: string;
  closedDays?: string;
  naverMapUrl?: string;
  reservationRequired?: string;
  cashOnly?: string;
  crowdedTimes?: string;
}

export interface Meal {
  type: string;
  restaurantName: string;
  cuisine: string;
  costPerPerson: string;
  reservationRequired: string;
  waitTime?: string;
  address?: string;
  tip?: string;
  naverMapUrl?: string;
}

export interface DayItinerary {
  day: number; date: string;
  dailyTips?: string[];
  places: Place[];
  meals?: Meal[];
  /** PR-E SAFETY: 트레킹/러닝 활동 블록 day 의 난이도·위험·부적합 메타.
   *  backend buildActivityMeta(blockMode.js)가 채움 (FEATURE_ACTIVITY_BLOCKS ON + 활동 블록).
   *  flag OFF / city_day = undefined → UI falsy guard (미렌더). */
  activity_meta?: ActivityMeta | null;
}

export interface Accommodation {
  name: string; area: string; reason: string;
  priceRange: string; address: string;
}

export interface BudgetSummary {
  transport: string; food: string;
  admission: string; accommodation: string; total: string;
}

export interface CustomerSupport {
  greetingMessage: string;
  paymentPolicy: string;
  cancellationPolicy: string;
  contactInfo: string;
  chatbotResponses?: {
    welcome: string;
    faqs: { q: string; a: string }[];
  };
}

export interface PlannerResponse {
  meta: { categories: string[]; regions: string[]; startDate: string; endDate: string; generatedAt: string; estimatedBudget?: BudgetSummary | string };
  accommodation?: Accommodation;
  budgetSummary?: BudgetSummary;
  itinerary: DayItinerary[];
  currentSeason?: 'spring' | 'summer' | 'autumn' | 'winter';
  enriched?: boolean;
  customerSupport?: CustomerSupport;
}
