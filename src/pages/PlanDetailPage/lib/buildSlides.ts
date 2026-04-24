// Pure function: plan data -> slide[] with context-aware ad placement.
//
// P2 (2026-04-24): swap legacy "static priority round-robin" for a context
// schedule that puts each ad where it's actually useful in the journey:
//   - eSIM right after Intro (user reads this on the plane / at boarding gate)
//   - Charter / car-rental in mid-trip gaps (transport decisions made daily)
//   - Hotel SKIPPED if user already provided hotel_address
//   - Flight SKIPPED if startDate is past or near (booked already)
//   - airportPickup just before Outro (departure prep)

export type SlideType = 'intro' | 'day' | 'ad' | 'outro';
export type AdCategory = 'flight' | 'hotel' | 'charter' | 'esim' | 'carRental' | 'airportPickup';

export interface Slide {
  type: SlideType;
  dayIndex?: number;
  adType?: AdCategory;
}

import type { PlanDocument } from '../types';

// Whether an ad should run at all for this plan's context.
function adApplies(category: AdCategory, plan: PlanDocument): boolean {
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
  return true;
}

export function buildSlides(plan: PlanDocument): Slide[] {
  const days = (plan && plan.itinerary && plan.itinerary.days) || [];
  const slides: Slide[] = [];

  slides.push({ type: 'intro' });

  // 1) Pre-trip prep ads — between Intro and Day 1.
  //    eSIM first (read on plane), then flight if still relevant.
  const preTripAds: AdCategory[] = (['esim', 'flight'] as AdCategory[])
    .filter(c => adApplies(c, plan));
  preTripAds.forEach(c => slides.push({ type: 'ad', adType: c }));

  // 2) Mid-trip ads — interleaved between days, but only ads that fit
  //    "during the trip" context: hotel (if not booked) on day 1 gap,
  //    charter/carRental on later gaps for transport decisions.
  const midTripPool: AdCategory[] = (['hotel', 'charter', 'carRental'] as AdCategory[])
    .filter(c => adApplies(c, plan));

  let midIdx = 0;
  for (let i = 0; i < days.length; i++) {
    slides.push({ type: 'day', dayIndex: i });
    // Insert one mid-trip ad between days (skip after the last day — that's Outro prep).
    if (i < days.length - 1 && midIdx < midTripPool.length) {
      slides.push({ type: 'ad', adType: midTripPool[midIdx] });
      midIdx++;
    }
  }

  // 3) Pre-departure ad — between last Day and Outro.
  //    airportPickup is the actionable item right before they head home.
  if (adApplies('airportPickup', plan)) {
    slides.push({ type: 'ad', adType: 'airportPickup' });
  }

  slides.push({ type: 'outro' });
  return slides;
}

// Helper: find the slide index for a given day number (1-based)
export function getDaySlideIndex(slides: Slide[], dayNumber: number): number {
  const dayIdx = dayNumber - 1;
  return slides.findIndex(s => s.type === 'day' && s.dayIndex === dayIdx);
}
