/**
 * Zod 스키마 검증 테스트
 * - API 응답 파싱 유틸리티 검증
 * - 각 도메인 스키마 유효/무효 데이터 검증
 */
import { describe, it, expect } from 'vitest';
import {
  parseApiResponse,
  PlannerResponseSchema,
  ReviewSchema,
  PlaceSchema,
  MealSchema,
  ApiResponseSchema,
} from '../../src/schemas';

// ══════════════════════════════════════════════
// API 응답 파싱
// ══════════════════════════════════════════════
describe('parseApiResponse', () => {
  it('성공 응답을 올바르게 파싱한다', () => {
    const result = parseApiResponse({ ok: true, data: { message: 'hello' } });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data).toEqual({ message: 'hello' });
  });

  it('에러 응답을 올바르게 파싱한다', () => {
    const result = parseApiResponse({ ok: false, error: 'bad request', code: 'BAD_REQ' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe('bad request');
      expect(result.code).toBe('BAD_REQ');
    }
  });

  it('잘못된 형식은 PARSE_ERROR를 반환한다', () => {
    const result = parseApiResponse({ status: 'ok' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('PARSE_ERROR');
  });

  it('null/undefined 입력도 안전하게 처리한다', () => {
    expect(parseApiResponse(null).ok).toBe(false);
    expect(parseApiResponse(undefined).ok).toBe(false);
  });
});

// ══════════════════════════════════════════════
// PlaceSchema
// ══════════════════════════════════════════════
describe('PlaceSchema', () => {
  it('유효한 장소 데이터를 파싱한다', () => {
    const place = {
      order: 1,
      start_time: '09:00',
      name: '경복궁',
      display_name: 'Gyeongbokgung Palace',
      category: 'culture',
      stay_min: 60,
      entry_fee_krw: 3000,
    };
    const result = PlaceSchema.safeParse(place);
    expect(result.success).toBe(true);
  });

  it('필수 필드 누락 시 실패한다', () => {
    const result = PlaceSchema.safeParse({ order: 1 });
    expect(result.success).toBe(false);
  });
});

// ══════════════════════════════════════════════
// ReviewSchema
// ══════════════════════════════════════════════
describe('ReviewSchema', () => {
  it('유효한 리뷰를 파싱한다', () => {
    const review = {
      userId: 'user123',
      userName: 'Test User',
      rating: 5,
      title: 'Amazing tour',
      content: 'Best experience ever!',
      serviceType: 'private_tour',
      language: 'en',
      createdAt: new Date(),
    };
    const result = ReviewSchema.safeParse(review);
    expect(result.success).toBe(true);
  });

  it('평점 범위 검증 (1-5)', () => {
    const review = {
      userId: 'u1', userName: 'T', rating: 6,
      title: 't', content: 'c', serviceType: 's', language: 'ko',
      createdAt: new Date(),
    };
    const result = ReviewSchema.safeParse(review);
    expect(result.success).toBe(false);
  });
});

// ══════════════════════════════════════════════
// PlannerResponseSchema
// ══════════════════════════════════════════════
describe('PlannerResponseSchema', () => {
  it('유효한 플래너 응답을 파싱한다', () => {
    const plan = {
      tour_title: '서울 3일 투어',
      vehicle: 'staria_8',
      base_price_krw: 350000,
      days: [{
        day: 1,
        date: '2026-05-01',
        theme: '고궁 투어',
        stops: [{
          order: 1,
          start_time: '09:00',
          name: '경복궁',
          category: 'culture',
          stay_min: 60,
          entry_fee_krw: 3000,
        }],
      }],
    };
    const result = PlannerResponseSchema.safeParse(plan);
    expect(result.success).toBe(true);
  });
});