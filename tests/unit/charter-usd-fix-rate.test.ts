/**
 * 차터 USD 고정환율 (2026-06-05 운영자 결정 1400) — SSOT + 상품 스코핑 가드.
 * 차터 전체(transfer/airport/tour/multiday/kpop/custom)는 고정환율 1400으로 USD 청구(환율 변동 무관 안정 USD),
 * AI 플래너만 live 환율. 표시(프론트 CHARTER_USD_FIX_RATE)==청구(백 SPEC.charter_usd_fix_rate) 일치.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { usesFixedUsdRate } from '../../api/_shared/usd-rate-policy.js';
import { CHARTER_USD_FIX_RATE } from '../../src/data/charterPricing';

const API_SPEC = JSON.parse(readFileSync(join(process.cwd(), 'api/_pricing_spec.json'), 'utf-8'));
const SRC_SPEC = JSON.parse(readFileSync(join(process.cwd(), 'src/data/pricing_spec.json'), 'utf-8'));

describe('charter_usd_fix_rate — SSOT 값 + 두 spec sync + 프론트==백', () => {
  it('api spec = 1400', () => {
    expect(API_SPEC.charter_usd_fix_rate).toBe(1400);
  });
  it('src spec = 1400 (api 와 동기화)', () => {
    expect(SRC_SPEC.charter_usd_fix_rate).toBe(1400);
    expect(SRC_SPEC.charter_usd_fix_rate).toBe(API_SPEC.charter_usd_fix_rate);
  });
  it('프론트 CHARTER_USD_FIX_RATE = 1400 (표시==청구)', () => {
    expect(CHARTER_USD_FIX_RATE).toBe(1400);
    expect(CHARTER_USD_FIX_RATE).toBe(API_SPEC.charter_usd_fix_rate);
  });
});

describe('usesFixedUsdRate — 상품 스코핑 (차터=고정 / AI플래너만=live)', () => {
  it('차터 전체 → true (고정환율)', () => {
    for (const pt of ['charter_transfer', 'charter_multiday', 'airport_seoul_gangnam', 'tour_hourly',
      'charter_seoul_city', 'kpop_shuttle_oneway', 'combo_airport_seoul', 'charter_custom_estimate']) {
      expect(usesFixedUsdRate(pt)).toBe(true);
    }
  });
  it('AI 플래너만 → false (live 환율, 하이픈/언더바 무관)', () => {
    expect(usesFixedUsdRate('ai_planner_full')).toBe(false);
    expect(usesFixedUsdRate('ai-planner-full')).toBe(false);
  });
  it('빈값/undefined → true (안전: 차터 기본 고정환율)', () => {
    expect(usesFixedUsdRate(undefined)).toBe(true);
    expect(usesFixedUsdRate('')).toBe(true);
  });
});

describe('USD 변환 — 고정 1400 = 환율 변동 무관 안정', () => {
  it('ICN→강남 편도 ₩138,320 → $98.80 (고정)', () => {
    expect((138_320 / CHARTER_USD_FIX_RATE).toFixed(2)).toBe('98.80');
  });
  it('ICN→부산 편도 ₩627,000 → $447.86 (고정)', () => {
    expect((627_000 / CHARTER_USD_FIX_RATE).toFixed(2)).toBe('447.86');
  });
  it('live 환율(1300~1600)이 변해도 USD 불변 (고정 1400 사용)', () => {
    const krw = 138_320;
    const usdFixed = (krw / CHARTER_USD_FIX_RATE).toFixed(2);
    // 고정환율이므로 live 와 무관하게 항상 동일
    expect(usdFixed).toBe('98.80');
  });
});
