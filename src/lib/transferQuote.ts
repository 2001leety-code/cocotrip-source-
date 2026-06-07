/**
 * 도시간/공항 차터 transfer 견적 — 프론트. api/_shared/charter-transfer-price.js 와 **1:1 동일 공식**.
 * (멀티데이 #764 / 투어 #770 패턴 + transfer-price.test.ts 가 프론트==백 가드.)
 *
 * 2026-06-05 통일: 옛 km×1500 폐기 → 운영자 4-tier(톨 포함) + 매트릭스 priceKRW. airport 픽업과 동일 기반.
 *   curatedKRW = matrix.priceKRW(큐레이션, 톨+VAT) ‖ 4-tier(km)+tollEstimate(km)  (staria, VAT 내장)
 *   vehicleBase = curatedKRW × MULT(staria1.0/sprinter2.0)
 *   편도: tripBase=vehicleBase 쿠폰5% / 왕복: tripBase=vehicleBase×2 쿠폰10% / total=tripBase×(1-쿠폰)
 *   ICN→강남(65km, priceKRW145,600) 편도 ₩138,320 / 왕복 ₩262,080.
 */
import { AIRPORT_TRANSFER_PRICING_FORMULA, DISTANCE_MATRIX } from '@/data/charterPricing';
import { tollEstimate } from '@/lib/calculator';

const VEHICLE_MULT: Record<string, number> = { staria: 1.0, sprinter: 2.0 };
// FEATURE_DISCOUNT_V2 (운영자 2026-06-07): 왕복 할인 10→5%. oneway 5% 유지. 백엔드 charter-transfer-price.js 와 byte-identical.
const TRANSFER_DISCOUNT_V2_ROUNDTRIP_PCT = 5;

export type TripType = 'oneway' | 'roundtrip';

/** 4-tier staria 거리요금 + 톨 (VAT 내장). 백엔드 fourTierStariaKRW 와 동일. */
export function fourTierStariaKRW(km: number): number | null {
  const f = AIRPORT_TRANSFER_PRICING_FORMULA.staria;
  if (!f) return null;
  const safeKm = Number.isFinite(km) && km > 0 ? km : 0;
  if (safeKm === 0) return null;
  let priceKRW: number;
  if (safeKm <= f.tier1_flat_km) {
    priceKRW = f.tier1_price_krw;
  } else if (safeKm <= f.tier2_max_km) {
    priceKRW = f.tier1_price_krw + (safeKm - f.tier1_flat_km) * f.tier2_per_km_krw;
  } else if (safeKm <= f.tier3_max_km) {
    const tier2Cap = (f.tier2_max_km - f.tier1_flat_km) * f.tier2_per_km_krw;
    priceKRW = f.tier1_price_krw + tier2Cap + (safeKm - f.tier2_max_km) * f.tier3_per_km_krw;
  } else {
    const tier2Cap = (f.tier2_max_km - f.tier1_flat_km) * f.tier2_per_km_krw;
    const tier3Cap = (f.tier3_max_km - f.tier2_max_km) * f.tier3_per_km_krw;
    priceKRW = f.tier1_price_krw + tier2Cap + tier3Cap + (safeKm - f.tier3_max_km) * f.tier4_per_km_krw;
  }
  const toll = f.include_toll ? tollEstimate(safeKm) : 0;
  return Math.round(priceKRW) + toll;
}

/** 경로 staria curated 가격 (톨+VAT). matrix.priceKRW 우선, 없으면 4-tier(km). 미존재 시 null(협의). */
export function curatedStariaKRW(originKey: string, destKey: string): number | null {
  const m = DISTANCE_MATRIX as Record<string, { km?: number; priceKRW?: number } | undefined>;
  const o = String(originKey || '').trim();
  const d = String(destKey || '').trim();
  const entry = m[`${o}→${d}`] || m[`${d}→${o}`];
  if (!entry) return null;
  if (typeof entry.priceKRW === 'number' && entry.priceKRW > 0) return entry.priceKRW;
  if (typeof entry.km === 'number') return fourTierStariaKRW(entry.km);
  return null;
}

export interface TransferQuote {
  curatedKRW: number;
  vehicleBase: number;
  tripType: TripType;
  tripBase: number;
  couponPct: number;
  coupon: number;
  total: number;
}

export interface TransferQuoteOpts {
  discountV2?: boolean;   // FEATURE_DISCOUNT_V2: true=왕복5%, false/undefined=현행10%
}

/** transfer 영수증 breakdown. curatedKRW(staria, VAT 내장) → 차종배수 → 편도5%/왕복(×2)10%(v1)/5%(v2). 백엔드와 byte-identical. */
export function calcTransferQuote(
  { curatedKRW = 0, tripType = 'oneway', vehicle }: { curatedKRW?: number; tripType?: TripType; vehicle: string },
  opts: TransferQuoteOpts = {},
): TransferQuote | null {
  const mult = VEHICLE_MULT[vehicle];
  if (!mult) return null;
  if (!Number.isFinite(curatedKRW) || curatedKRW <= 0) return null;
  const isRound = tripType === 'roundtrip';
  const vehicleBase = Math.round(curatedKRW * mult);
  const tripBase = isRound ? vehicleBase * 2 : vehicleBase;
  // v2: 왕복 10→5% (편도 5% 유지). 플래그 OFF(기본)=현행 10%.
  const couponPct = isRound ? (opts.discountV2 ? TRANSFER_DISCOUNT_V2_ROUNDTRIP_PCT : 10) : 5;
  const coupon = Math.round((tripBase * couponPct) / 100);
  const total = tripBase - coupon; // VAT 는 curatedKRW 에 이미 포함
  return { curatedKRW, vehicleBase, tripType, tripBase, couponPct, coupon, total };
}
