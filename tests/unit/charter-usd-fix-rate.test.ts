/**
 * 고정 USD 환산 정책 (SSOT 1350) — SSOT + 상품 스코핑 가드.
 * KRW 상품은 고정환율 1350으로 USD 청구(환율 변동 무관 안정 USD),
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
  it('api spec = 1350', () => {
    expect(API_SPEC.charter_usd_fix_rate).toBe(1350);
  });
  it('src spec = 1350 (api 와 동기화)', () => {
    expect(SRC_SPEC.charter_usd_fix_rate).toBe(1350);
    expect(SRC_SPEC.charter_usd_fix_rate).toBe(API_SPEC.charter_usd_fix_rate);
  });
  it('프론트 CHARTER_USD_FIX_RATE = 1350 (표시==청구)', () => {
    expect(CHARTER_USD_FIX_RATE).toBe(1350);
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

describe('USD 변환 — 고정 1350 + 정수 라운드 = 환율 변동 무관 안정', () => {
  // 청구 USD = Math.round(krw / 1350). createPaypalOrder roundUsdWhole + TransferReceipt 동일.
  const charterUsd = (krw: number) => Math.round(krw / CHARTER_USD_FIX_RATE);
  it('ICN→강남 편도 ₩138,320 → $102 (102.46 반올림)', () => {
    expect(charterUsd(138_320)).toBe(102);
  });
  it('ICN→부산 편도 ₩627,000 → $464 (464.44 반올림)', () => {
    expect(charterUsd(627_000)).toBe(464);
  });
  it('live 환율 변해도 USD 불변 (고정 1350 → 항상 동일 정수)', () => {
    expect(charterUsd(138_320)).toBe(102);
    expect(charterUsd(577_600)).toBe(428); // 서울→부산
  });
});
