import type { PlanDocument, PlanDay } from '../types';

export type PlanDocumentStatus = 'ready' | 'partial' | 'building';

export function getPlanDocumentStatus(plan: PlanDocument, isStreaming: boolean): PlanDocumentStatus {
  if (isStreaming) return 'building';
  if (plan.__truncated === true || Number(plan.itinerary?._truncated_days || 0) > 0) return 'partial';
  return 'ready';
}

export function countVisibleStops(days: PlanDay[]): number {
  return days.reduce(
    (total, day) => total + (day.stops || []).filter(
      (stop) => String(stop.category || '').toLowerCase() !== 'lodging',
    ).length,
    0,
  );
}
