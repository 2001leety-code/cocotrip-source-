// Pure function: plan data -> slide[] with Option D interleave.
// Ad placement: one ad per gap (N+1 gaps for N days).
// Layout: Intro -> Ad -> Day1 -> Ad -> Day2 -> Ad -> ... -> DayN -> Ad -> Outro
// TODO: Future enhancement -- use detectCharterRecommendation(), isJeju,
// adultsCount to weight ad priority per plan context. For now, static priority.

export type SlideType = 'intro' | 'day' | 'ad' | 'outro';
export type AdCategory = 'flight' | 'hotel' | 'charter' | 'esim' | 'carRental' | 'airportPickup';

export interface Slide {
  type: SlideType;
  dayIndex?: number;
  adType?: AdCategory;
}

// Priority order: travel preparation sequence (book flight -> hotel -> transport -> connectivity)
const AD_POOL: AdCategory[] = ['flight', 'hotel', 'charter', 'esim', 'carRental', 'airportPickup'];
import type { PlanDocument } from '../types';

export function buildSlides(plan: PlanDocument): Slide[] {
  const days = (plan && plan.itinerary && plan.itinerary.days) || [];
  const slides: Slide[] = [];

  slides.push({ type: 'intro' });

  // Option D: N+1 gaps -- one before each day + one after last day
  let adIdx = 0;
  for (let i = 0; i < days.length; i++) {
    // Ad before this day
    if (adIdx < AD_POOL.length) {
      slides.push({ type: 'ad', adType: AD_POOL[adIdx] });
      adIdx++;
    }
    slides.push({ type: 'day', dayIndex: i });
  }
  // Ad after last day
  if (adIdx < AD_POOL.length) {
    slides.push({ type: 'ad', adType: AD_POOL[adIdx] });
  }

  slides.push({ type: 'outro' });
  return slides;
}

// Helper: find the slide index for a given day number (1-based)
export function getDaySlideIndex(slides: Slide[], dayNumber: number): number {
  const dayIdx = dayNumber - 1;
  return slides.findIndex(s => s.type === 'day' && s.dayIndex === dayIdx);
}
