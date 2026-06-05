// calculator.ts — 자유입력 destination 단순 거리 견적 공식 (차터 wizard 전용 fallback)
// 정책: matrix miss → Geocoding hit 시 차량별 단순 공식 적용. Bus/VIP는 협의(상담 폼).
//
// Staria   : 50,000 + km × 2,000 (부가세 포함, 톨비 추정 포함)
// Sprinter : 100,000 + km × 4,000 (부가세 포함, 톨비 추정 포함)
// Bus/VIP  : 협의 (null 반환 — wizard에서 InquiryForm 노출)
//
// 톨비 정책 B (2026-05-08 사용자 확정):
//   km <  50  → 0 (시내 한정)
//   50–199 km → km × 100 KRW (도시간 단거리)
//   km >= 200 → km × 150 KRW (장거리 고속도로)

import type { VehicleType } from '@/components/charter/types';
import spec from '@/data/pricing_spec.json';

// 2026-06-05: 차터 전체 USD 청구 = charter_usd_fix_rate(1400) 고정 (운영자 결정) → UI 표시 estimate 도 동일 rate = 표시==청구.
// 우선순위: Vercel env (VITE_KRW_PER_USD) > charter_usd_fix_rate (1400) > policy_krw_per_usd (1430) > 1430.
// 실제 결제: 차터 = 이 고정 rate(createPaypalOrder), AI 플래너 = backend live rate (api/_exchange-rate.js).
const _specRates = spec as { charter_usd_fix_rate?: number; policy_krw_per_usd?: number };
const POLICY_RATE = typeof _specRates.charter_usd_fix_rate === 'number' ? _specRates.charter_usd_fix_rate
  : (typeof _specRates.policy_krw_per_usd === 'number' ? _specRates.policy_krw_per_usd : 1430);
const _envRate = import.meta.env.VITE_KRW_PER_USD;
const KRW_PER_USD = Number(_envRate === undefined || _envRate === null ? POLICY_RATE : _envRate);

interface VehicleFormula {
  base: number;
  perKm: number;
}

// Staria/Sprinter만 자동 견적. Bus/VIP는 사용자 정책상 항상 상담 폼.
const VEHICLE_FORMULAS: Partial<Record<VehicleType, VehicleFormula>> = {
  staria:   { base: 50_000,  perKm: 2_000 },
  sprinter: { base: 100_000, perKm: 4_000 },
};

export interface SimplePrice {
  // 합계 (부가세 + 톨비 포함). UI 영수증의 "Total" 행에 노출.
  krw: number;
  usd: number;
  // 톨비 추정 — UI 영수증에 별행으로 표시. base+perKm 와 별도.
  toll: number;
  // 합계 (krw 와 동일하지만 의미 명시) — 영수증 행과 1:1.
  total: number;
  breakdown: {
    base: number;
    perKm: number;
    perKmRate: number;
  };
}

/**
 * 거리 기반 톨비 추정. 정책 B (2026-05-08 사용자 확정).
 * 영수증 표기상 "(약)" 라벨 필수 — 실제 톨비는 ±20% 변동 가능.
 */
export function tollEstimate(km: number): number {
  const safeKm = Number.isFinite(km) && km > 0 ? km : 0;
  if (safeKm < 50) return 0;
  if (safeKm < 200) return Math.round(safeKm * 100);
  return Math.round(safeKm * 150);
}

// 음수/NaN km은 0 처리. Bus/VIP는 null (협의 신호).
export function calcSimpleByVehicle(vehicle: VehicleType, km: number): SimplePrice | null {
  const formula = VEHICLE_FORMULAS[vehicle];
  if (!formula) return null;
  const safeKm = Number.isFinite(km) && km > 0 ? km : 0;
  const perKm = Math.round(safeKm * formula.perKm);
  const toll = tollEstimate(safeKm);
  const total = formula.base + perKm + toll;
  const usd = Math.round((total / KRW_PER_USD) * 100) / 100;
  return {
    krw: total,
    usd,
    toll,
    total,
    breakdown: {
      base: formula.base,
      perKm,
      perKmRate: formula.perKm,
    },
  };
}

export const CALCULATOR_KRW_PER_USD = KRW_PER_USD;
