/**
 * cart-types 단위 테스트 — 플래그 게이트(isCartEnabled) + AI플래너 제외 가드.
 * 플래그 OFF 가 기본 = 현행 무영향의 핵심 안전장치 → 엄격 검증.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { isCartEnabled, isAiPlannerProduct, stripUndefined } from '@/lib/cart-types';

describe('cart-types — isCartEnabled 플래그 게이트', () => {
  afterEach(() => { vi.unstubAllEnvs(); });

  it('VITE_FEATURE_CART 미설정/빈값 = false (OFF 기본)', () => {
    vi.stubEnv('VITE_FEATURE_CART', '');
    expect(isCartEnabled()).toBe(false);
  });

  it("VITE_FEATURE_CART='true' = true (활성)", () => {
    vi.stubEnv('VITE_FEATURE_CART', 'true');
    expect(isCartEnabled()).toBe(true);
  });

  it("'1'/'false'/'TRUE' 등 정확히 'true' 아니면 false (엄격)", () => {
    vi.stubEnv('VITE_FEATURE_CART', '1');
    expect(isCartEnabled()).toBe(false);
    vi.stubEnv('VITE_FEATURE_CART', 'false');
    expect(isCartEnabled()).toBe(false);
    vi.stubEnv('VITE_FEATURE_CART', 'TRUE');
    expect(isCartEnabled()).toBe(false);
  });
});

describe('cart-types — isAiPlannerProduct (cart 제외 가드)', () => {
  it('ai_planner_full = true (하이픈 정규화 포함)', () => {
    expect(isAiPlannerProduct('ai_planner_full')).toBe(true);
    expect(isAiPlannerProduct('ai-planner-full')).toBe(true);
  });

  it('물리상품/빈값 = false', () => {
    expect(isAiPlannerProduct('tour')).toBe(false);
    expect(isAiPlannerProduct('charter_transfer')).toBe(false);
    expect(isAiPlannerProduct('charter_multiday')).toBe(false);
    expect(isAiPlannerProduct('')).toBe(false);
  });
});

describe('stripUndefined — Firestore undefined 거부 방어 (2026-06-11 cart 담기 사고)', () => {
  it('top-level + 중첩(booking) undefined 제거', () => {
    const r = stripUndefined({
      id: 'x', priceUSD: undefined,
      booking: { productType: 'airport_seoul-central', originKey: undefined, tripType: undefined, passengers: 4 },
    });
    expect(r).toEqual({ id: 'x', booking: { productType: 'airport_seoul-central', passengers: 4 } });
  });
  it('null 은 보존 (Firestore 허용), 0/빈문자열/false 도 보존', () => {
    expect(stripUndefined({ a: null, b: undefined })).toEqual({ a: null });
    expect(stripUndefined({ a: 0, b: '', c: false, d: undefined })).toEqual({ a: 0, b: '', c: false });
  });
});
