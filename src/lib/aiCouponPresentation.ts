/** Presentation hints only. The server remains the authority for coupon use and saved plans. */
export interface AiCouponDisplayMetadata {
  productScope?: unknown;
  isUsed?: unknown;
  restoredAt?: unknown;
  aiPlanBinding?: unknown;
}

/** A present timestamp includes 0. A retained (even malformed) binding is not a legacy restore. */
export function needsAiCouponReview(coupon: AiCouponDisplayMetadata): boolean {
  return coupon.productScope === 'ai-plan'
    && coupon.isUsed === false
    && coupon.restoredAt !== null && coupon.restoredAt !== undefined
    && (coupon.aiPlanBinding === null || coupon.aiPlanBinding === undefined);
}

export interface RequestedAiCoupon {
  code: string;
  maxDays: number;
  expiresAt: number | null;
}

export type RequestedAiCouponResult =
  | { state: 'available'; coupon: RequestedAiCoupon }
  | { state: 'review' }
  | { state: 'unavailable' }
  | { state: 'error' };

export type AiCouponPresentation = RequestedAiCouponResult | { state: 'none' } | { state: 'loading' };
