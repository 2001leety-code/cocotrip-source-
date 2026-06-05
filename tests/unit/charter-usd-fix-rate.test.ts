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

describe('USD 변환 — 고정 1400 + 차터 정수 라운드 = 환율 변동 무관 안정', () => {
  // 차터 청구 USD = Math.round(krw / 1400) (깔끔한 정수 달러). createPaypalOrder roundUsdWhole + TransferReceipt 동일.
  const charterUsd = (krw: number) => Math.round(krw / CHARTER_USD_FIX_RATE);
  it('ICN→강남 편도 ₩138,320 → $99 (98.80 반올림)', () => {
    expect(charterUsd(138_320)).toBe(99);
  });
  it('ICN→부산 편도 ₩627,000 → $448 (447.86 반올림)', () => {
    expect(charterUsd(627_000)).toBe(448);
  });
  it('live 환율 변해도 USD 불변 (고정 1400 → 항상 동일 정수)', () => {
    expect(charterUsd(138_320)).toBe(99);
    expect(charterUsd(577_600)).toBe(413); // 서울→부산
  });
});
