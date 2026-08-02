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

// 판촉 한도(PLAN_PROMOTION_LIMITS)와 노출 조건(adApplies)은
// src/config/promotionRules.ts 한 곳에만 둔다. 여기서 다시 export 하지 않는다 —
// import 경로가 둘이 되는 순간 "단일 기준" 이라는 말이 사실이 아니게 된다.
export type SlideType = 'preTrip' | 'intro' | 'day' | 'ad' | 'activityGuide' | 'outro';

export interface Slide {
  type: SlideType;
  dayIndex?: number;
  adType?: AdCategory;
}

import type { PlanDocument } from '../types';
import { hasActivityGuide } from '@/lib/activityGuides';
import { adApplies, type AdCategory } from '@/config/promotionRules';

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
