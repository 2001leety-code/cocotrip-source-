// Pure function: plan data -> slide[] with context-aware ad placement.
//
// P-Quality D-option (2026-04-24): reduced from "ad-per-day-gap" (5+ ad
// slides on a 4-day plan = 41% of slides were ads) to a strict 2-slide max:
//   - eSIM right after Intro (read on plane / at boarding gate)
//   - airportPickup right before Outro (departure prep)
// All OTHER ads (hotel/flight/charter/carRental) move into Outro as a
// "Trip Extras" card grid so they're still discoverable but don't
// interrupt the day-by-day flow. `getOutroExtras()` exposes the list to
// the OutroSlide renderer.
//
// Earlier P2 (2026-04-24, same day) version interleaved mid-trip ads
// between Day slides — superseded.

export type SlideType = 'preTrip' | 'intro' | 'day' | 'ad' | 'activityGuide' | 'outro';
export type AdCategory = 'flight' | 'hotel' | 'charter' | 'esim' | 'carRental' | 'airportPickup' | 'train';

export interface Slide {
  type: SlideType;
  dayIndex?: number;
  adType?: AdCategory;
}

import type { PlanDocument } from '../types';
import { hasActivityGuide } from '@/lib/activityGuides';

// Whether an ad should run at all for this plan's context.
export function adApplies(category: AdCategory, plan: PlanDocument): boolean {
  const input = plan?.input || {};
  if (category === 'hotel') {
    // Already booked → don't pitch hotel.
    return !input.hotel_address;
  }
  if (category === 'flight') {
    // Trip starts within 7 days → flight booking is too late.
    const startDate = input.startDate as string | undefined;
    if (!startDate) return true;
    const start = Date.parse(startDate);
    if (Number.isNaN(start)) return true;
    const daysUntil = (start - Date.now()) / (1000 * 60 * 60 * 24);
    return daysUntil > 7;
  }
  if (category === 'charter') {
    // P2 audit (2026-04-27): 차터 이미 예약/문의한 사용자에겐 광고 스킵.
    // input.charter_booked = true (예: 차터 PayPal 결제 후 백엔드 set)
    // 또는 charter_inquiry_id 있으면 (CharterInquireModal 제출 후 set)
    // → 둘 중 하나라도 있으면 광고 스킵.
    if (input.charter_booked === true || input.charter_inquiry_id) return false;
  }
  if (category === 'train') {
    // batch 9 (2026-05-09): 다도시 plan(서울→부산 등)에서 KTX/SRT 추천.
    // 1개 도시 plan 에 광고하면 노이즈 — regions ≥ 2 일 때만 노출.
    const regions = (input.regions as unknown as string[]) || [];
    return Array.isArray(regions) && regions.length >= 2;
  }
  return true;
}

export function buildSlides(plan: PlanDocument): Slide[] {
  const rawDays = (plan && plan.itinerary && plan.itinerary.days) || [];
  // P224: filter out null/undefined entries that can appear during streaming
  // progressive updates — only count days that are actual objects.
  const days = rawDays.filter((d): d is NonNullable<typeof d> => d != null);
  const slides: Slide[] = [];

  // 2026-06-16 (공유 제안서化): 첫 화면 = 플랜 요약(Intro). 광고(PreTrip = eSIM·공항픽업·
  //   hotel/flight)는 일정 본 뒤 Outro 직전 보조 섹션으로 이동. 이전엔 첫 슬라이드가 PreTrip
  //   광고 모음이라 외국인 고객에게 "내 여행 제안서"가 아닌 "앱/광고"처럼 보였음.

  // Slide 1: Intro (플랜 요약 — 첫 화면)
  slides.push({ type: 'intro' });

  // Day slides — one tab per actual day object (dynamic, never static count)
  for (let i = 0; i < days.length; i++) {
    slides.push({ type: 'day', dayIndex: i });
  }

  // 활동 가이드 탭 (따릉이/러닝/트레킹 how-to). flag OFF 기본(VITE_FEATURE_ACTIVITY_GUIDE), 활동 day 있을 때만.
  const activityGuideOn = String(import.meta.env.VITE_FEATURE_ACTIVITY_GUIDE || '').trim() === 'true';
  if (activityGuideOn && hasActivityGuide(plan)) {
    slides.push({ type: 'activityGuide' });
  }

  // PreTrip Essentials (eSIM·공항픽업·hotel/flight 광고) — 일정 뒤, Outro 직전 보조 섹션.
  slides.push({ type: 'preTrip' });

  // Outro (share, PDF, revision card, Trip Extras)
  slides.push({ type: 'outro' });
  return slides;
}

// D-option: ads that did NOT make the slide cut go into Outro as cards.
// Honours the same context rules (hotel skip / flight skip).
export function getOutroExtras(plan: PlanDocument): AdCategory[] {
  return (['hotel', 'flight', 'charter', 'carRental'] as AdCategory[])
    .filter(c => adApplies(c, plan));
}

// Helper: find the slide index for a given day number (1-based)
export function getDaySlideIndex(slides: Slide[], dayNumber: number): number {
  const dayIdx = dayNumber - 1;
  return slides.findIndex(s => s.type === 'day' && s.dayIndex === dayIdx);
}
