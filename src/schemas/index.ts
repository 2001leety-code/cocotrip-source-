/**
 * Zod 스키마 — API 응답 검증 및 런타임 타입 안전성
 *
 * 사용처:
 *   - 프론트엔드: API 응답 파싱 시 .safeParse()
 *   - 테스트: 데이터 무결성 검증
 *   - 향후 FireCMS: 문서 스키마 정의 기반
 */
import { z } from 'zod';

// ── 기본 API 응답 스키마 ──────────────────────

/** 성공 응답 */
export const ApiSuccessSchema = z.object({
  ok: z.literal(true),
  data: z.unknown(),
});

/** 에러 응답 */
export const ApiErrorSchema = z.object({
  ok: z.literal(false),
  error: z.string(),
  code: z.string().optional(),
});

/** 표준 API 응답 (성공 | 에러) */
export const ApiResponseSchema = z.union([
  ApiSuccessSchema,
  ApiErrorSchema,
]);

export type ApiSuccess = z.infer<typeof ApiSuccessSchema>;
export type ApiError = z.infer<typeof ApiErrorSchema>;
export type ApiResponse = ApiSuccess | ApiError;

// ── 도메인 스키마 ─────────────────────────────

/** 추천 메뉴/아이템 */
export const RecommendedItemSchema = z.object({
  name: z.string(),
  price_krw: z.number(),
  note: z.string().optional(),
});

/** 장소(Stop) */
export const PlaceSchema = z.object({
  order: z.number(),
  start_time: z.string(),
  name: z.string(),
  display_name: z.string().optional(),
  category: z.string(),
  address: z.string().optional(),
  stay_min: z.number(),
  entry_fee_krw: z.number().default(0),
  tip: z.string().optional(),
  description: z.string().optional(),
  // Gemini는 문자열 배열 또는 객체 배열 둘 다 반환 — 둘 다 허용
  recommended_items: z.array(z.union([z.string(), RecommendedItemSchema])).optional(),
  verified: z.boolean().optional(),
  lat: z.number().optional(),
  lng: z.number().optional(),
  naverMapUrl: z.string().optional(),
});

/** 식사 */
export const MealSchema = z.object({
  name: z.string(),
  category: z.literal('food'),
  address: z.string().optional(),
  recommended_items: z.array(z.union([z.string(), RecommendedItemSchema])).optional(),
  tip: z.string().optional(),
});

/** 일별 일정 */
export const DaySchema = z.object({
  day: z.number(),
  date: z.string(),
  theme: z.string(),
  stops: z.array(PlaceSchema),
});

/** 일별 예산 */
export const DailyBudgetSchema = z.object({
  day: z.number(),
  transport_krw: z.number(),
  entry_fees_krw: z.number(),
  meals_krw: z.number(),
  activities_krw: z.number(),
  shopping_estimate_krw: z.number().optional(),
  total_krw: z.number(),
});

/** AI 플래너 전체 응답 */
export const PlannerResponseSchema = z.object({
  tour_title: z.string(),
  vehicle: z.string(),
  base_price_krw: z.number(),
  days: z.array(DaySchema),
  daily_budget_summary: z.array(DailyBudgetSchema).optional(),
  t_money_recommended_load: z.number().optional(),
});

/** 리뷰 */
export const ReviewSchema = z.object({
  userId: z.string(),
  userName: z.string(),
  rating: z.number().min(1).max(5),
  title: z.string(),
  content: z.string(),
  serviceType: z.string(),
  language: z.string(),
  createdAt: z.any(), // Firestore Timestamp
  status: z.enum(['pending', 'approved', 'rejected']).default('pending'),
  photos: z.array(z.string()).optional(),
});

// ── 유틸리티 ──────────────────────────────────

/** API 응답 파싱 유틸리티 */
export function parseApiResponse(data: unknown): ApiResponse {
  const result = ApiResponseSchema.safeParse(data);
  if (result.success) return result.data;
  return { ok: false, error: 'Invalid API response format', code: 'PARSE_ERROR' };
}