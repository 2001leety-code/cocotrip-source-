// Shared types for PlanDetailPage module.

/** Firestore plan document — minimal typed shape for type-safe component props.
 *  Fields are optional because the document structure varies (legacy vs enriched plans). */
export interface PlanDocument {
  uid?: string;
  guestEmail?: string;
  accessToken?: string;
  isPublic?: boolean;
  edited?: boolean;
  lastEditedAt?: number;
  pricing?: Record<string, unknown>;
  input?: {
    language?: string;
    area?: string;
    startDate?: string;
    adults?: number;
    pax?: number;
    specialRequest?: string;
    hotel_address?: string;
    arrival_airport?: string;
    departure_airport?: string;
    [key: string]: unknown;
  };
  itinerary?: {
    tour_title?: string;
    t_money_recommended_load?: number;
    days?: PlanDay[];
    arrival_guide?: ArrivalGuideBlock;
    departure_guide?: DepartureGuideBlock;
    daily_budget_summary?: BudgetRow[];
    [key: string]: unknown;
  };
  customerSupport?: Record<string, unknown>;
  accommodation?: Record<string, unknown>;
  budgetSummary?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface PlanDay {
  day?: number;
  date?: string;
  theme?: string;
  stops?: PlanStop[];
  [key: string]: unknown;
}

export interface PlanStop {
  name?: string;
  name_ko?: string;
  name_en?: string;
  display_name?: string;
  address?: string;
  start_time?: string;
  stay_min?: number;
  category?: string;
  entry_fee_krw?: number;
  entry_fee_note?: string;
  tip?: string;
  tip_en?: string;
  order?: number;
  naverMapUrl?: string;
  lat?: number;
  lng?: number;
  reservation_required?: boolean;
  reservation_phone?: string;
  reservation_note?: string;
  reservation_url?: string;
  accessibility_note?: string;
  local_tag?: string;
  verified?: boolean;
  recommended_items?: { name: string; price_krw?: number; note?: string }[];
  transit_from_prev?: TransitSegment;
  travelFromPrev?: { transitOptions?: { publicTransit?: Record<string, any> } };
  _userAdded?: boolean;
  [key: string]: unknown;
}

export interface TransitSegment {
  method?: string;
  est_min?: number;
  est_fare_krw?: number;
  source?: string;
  step_by_step?: string[];
  _stale?: boolean;
  [key: string]: unknown;
}

export interface ArrivalGuideBlock {
  airport?: string;
  steps?: { step: number; title: string; description?: string; est_min?: number }[];
  [key: string]: unknown;
}

export interface BudgetRow {
  day?: number;
  transport_krw?: number;
  entry_fees_krw?: number;
  meals_krw?: number;
  total_krw?: number;
  [key: string]: unknown;
}

/** Departure guide block structure returned by AI planner. */
export interface DepartureGuideBlock {
  airport?: string;
  to_airport?: {
    method?: string;
    instruction?: string;
    duration_min?: number;
    cost_krw?: number;
  };
  luggage_storage?: { available?: boolean; location?: string };
  tax_refund?: { location?: string; threshold_krw?: number };
  last_minute_shopping?: string;
  // RouteAgent attaches a TransitFromPrev-shaped ODsay route here so the
  // departure UI can reuse the TransitArrow component for hotel→airport.
  // Loosely typed (Record) so DepartureGuide.tsx can cast to TransitFromPrev.
  route_to_airport?: Record<string, unknown>;
  [key: string]: unknown;
}

export type SetPlanFn = (updater: (prev: PlanDocument | null) => PlanDocument | null) => void;

/** Utility type for planDetail dict — loosened to unblock build.
 *  TODO: define strict interface when all planDetail keys are stabilized. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type PlanDetailDict = Record<string, any>;

/** Helper to extract planDetail dict from translations object. */
export function getPlanDetailDict(t: unknown): PlanDetailDict {
  return ((t as Record<string, unknown>).planDetail as PlanDetailDict) || {};
}

/** Helper to extract planDetail.ui dict from translations object. */
export function getPlanDetailUI(t: unknown): Record<string, string> {
  const pd = (t as Record<string, unknown>).planDetail as Record<string, unknown> | undefined;
  return (pd?.ui as Record<string, string>) || {};
}
