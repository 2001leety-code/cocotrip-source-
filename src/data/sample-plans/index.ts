// Static "예시 (Example)" sample plans for the planner showcase.
//
// These are PRE-MADE, PII-FREE Day-1 itineraries (Seoul / Busan / Jeju) built
// offline by scripts/build-sample-plans.mjs from REAL verified data:
//   • landmarks   → src/data/zone_courses/*.json (verified places + coords)
//   • restaurants → api/_food_index.json (rating ≥ 4.4, real coords, ★)
//   • transit     → live ODsay searchTransitRoute (real subway/bus legs)
//   • photos      → real Google Places photo_reference (served via /api/place-photo)
//
// They contain NO customer data (synthetic inputs only). The showcase renders
// them with the EXISTING rich StopCard + TransitArrow components — ZERO API
// calls at view time ($0, instant, no abuse surface).
import seoul from './seoul.json';
import busan from './busan.json';
import jeju from './jeju.json';
import type { PlanStop, TransitSegment } from '@/pages/PlanDetailPage/types';

export type Lang = 'ko' | 'en' | 'ja' | 'zh';
type I18nStr = Partial<Record<Lang, string>> & { en?: string };

/** raw on-disk stop shape — names/tips may be i18n objects, transit is plain. */
interface RawSampleStop {
  order: number;
  start_time: string;
  name: string;
  display_name: string;
  display_name_i18n?: I18nStr;
  category: string;
  address?: string;
  lat?: number;
  lng?: number;
  stay_min: number;
  entry_fee_krw: number;
  verified?: boolean;
  tip?: I18nStr | string;
  rating?: number;
  review_count?: number;
  cuisine?: string;
  cuisine_en?: string;
  photo_ref?: string;
  recommended_items?: unknown[];
  transit_from_prev?: TransitSegment;
}

interface RawSampleDay {
  day: number;
  date: string;
  theme_i18n: I18nStr;
  city: string;
  lodgingLabel: I18nStr;
  lodging_to_first?: TransitSegment | null;
  stops: RawSampleStop[];
}

interface RawSamplePlan {
  id: string;
  isSample: true;
  city: string;
  cityLabel: I18nStr;
  tour_title_i18n: I18nStr;
  generated_by?: string;
  day: RawSampleDay;
}

/** Localized, render-ready sample plan (flat strings the components expect). */
export interface LocalizedSampleDay {
  day: number;
  date: string;
  theme: string;
  city: string;
  lodgingLabel: string;
  lodging_to_first?: TransitSegment | null;
  stops: PlanStop[];
}
export interface LocalizedSamplePlan {
  id: string;
  isSample: true;
  city: string;
  cityLabel: string;
  tour_title: string;
  day: LocalizedSampleDay;
}

const RAW: RawSamplePlan[] = [seoul, busan, jeju] as unknown as RawSamplePlan[];

function pick(v: I18nStr | string | undefined, lang: Lang): string {
  if (v == null) return '';
  if (typeof v === 'string') return v;
  return v[lang] || v.en || v.ko || '';
}

function localizeStop(s: RawSampleStop, lang: Lang): PlanStop {
  const display = s.display_name_i18n ? pick(s.display_name_i18n, lang) : s.display_name;
  const stop: PlanStop = {
    order: s.order,
    start_time: s.start_time,
    name: s.name,
    display_name: display || s.display_name || s.name,
    category: s.category,
    address: s.address,
    lat: s.lat,
    lng: s.lng,
    stay_min: s.stay_min,
    entry_fee_krw: s.entry_fee_krw,
    tip: pick(s.tip, lang) || undefined,
    verified: s.verified,
    photo_ref: s.photo_ref,
    recommended_items: (s.recommended_items as PlanStop['recommended_items']) || [],
    transit_from_prev: s.transit_from_prev,
  };
  return stop;
}

/** Resolve a single sample plan to the active UI language. */
export function localizeSample(raw: RawSamplePlan, lang: Lang): LocalizedSamplePlan {
  return {
    id: raw.id,
    isSample: true,
    city: raw.city,
    cityLabel: pick(raw.cityLabel, lang),
    tour_title: pick(raw.tour_title_i18n, lang),
    day: {
      day: raw.day.day,
      date: raw.day.date,
      theme: pick(raw.day.theme_i18n, lang),
      city: raw.day.city,
      lodgingLabel: pick(raw.day.lodgingLabel, lang),
      lodging_to_first: raw.day.lodging_to_first,
      stops: raw.day.stops.map((s) => localizeStop(s, lang)),
    },
  };
}

/** All sample plans, localized. */
export function getSamplePlans(lang: Lang): LocalizedSamplePlan[] {
  return RAW.map((r) => localizeSample(r, lang));
}
