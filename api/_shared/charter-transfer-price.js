/**
 * 도시간/공항 차터 transfer(편도/왕복 1회 이동) 가격 backend 재계산 — 운영자 2026-06-05 (4-tier 통일).
 *
 * 결제 금액은 client priceKRW/km 불신 — backend 가 matrix 직접 조회(P311). 멀티데이 #764 패턴.
 *
 * ── 2026-06-05 가격 공식 통일 (운영자 결정) ──────────────────────────────────────────
 * 옛 `km × 1500` 단순공식 폐기 (톨비 누락 + flat 이라 단거리 과소·장거리 과다청구). 경쟁사 염탐:
 *   - 단거리 공항: 외국인 OTA 밴 $100~125 (우리 옛 km×1500 ₩102K = 너무 쌈).
 *   - 장거리 편도: 현지 대형콜밴 부산↔ICN ₩590~636K (우리 옛 km×1500 ₩705K = 과다 → 시장가로 ↓ 필요).
 * → 운영자 **공식 4-tier(airport_transfer_pricing_formula, include_toll:true)** 로 통일. airport 픽업과 동일 기반.
 *
 * 공식:
 *   curatedKRW = matrix.priceKRW (큐레이션 zone, 톨+VAT 포함) ‖ 4-tier(km) + tollEstimate(km)  ← staria 기준, VAT 내장
 *   vehicleBase = curatedKRW × MULT[vehicle]   (staria 1.0 / sprinter 2.0)
 *   편도: tripBase = vehicleBase,      쿠폰 5%
 *   왕복: tripBase = vehicleBase × 2,  쿠폰 10%
 *   total = round(tripBase × (1 - couponPct/100))   ← VAT 별도 가산 없음 (curatedKRW 에 이미 포함)
 *   예: ICN→강남(65km, priceKRW 145,600) 편도 ₩138,320 / 왕복 ₩262,080. ICN→부산(450km) 편도 ₩627,000.
 */
import { lookupMatrixKm } from './charter-multiday-price.js';

const VEHICLE_MULT = { staria: 1.0, sprinter: 2.0 }; // bus/vip = inquiry(결제 불가)

/** 톨비 추정 (프론트 src/lib/calculator.ts tollEstimate 와 byte-identical). <50km 0 / 50~200 ₩100·km / 200+ ₩150·km. */
export function tollEstimate(km) {
  const safeKm = Number.isFinite(km) && km > 0 ? km : 0;
  if (safeKm < 50) return 0;
  if (safeKm < 200) return Math.round(safeKm * 100);
  return Math.round(safeKm * 150);
}

/**
 * 4-tier staria 거리요금 + 톨 (VAT 내장) — SSOT airport_transfer_pricing_formula.staria.
 * 프론트 useQuoteCalculator.calcPickupTransferFormula 와 동일 산식. 매트릭스 priceKRW 없는 경로용.
 */
export function fourTierStariaKRW(spec, km) {
  const f = spec && spec.airport_transfer_pricing_formula && spec.airport_transfer_pricing_formula.staria;
  if (!f) return null;
  const safeKm = Number.isFinite(km) && km > 0 ? km : 0;
  if (safeKm === 0) return null;
  let priceKRW;
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
  const toll = (f.include_toll ? tollEstimate(safeKm) : 0);
  return Math.round(priceKRW) + toll;
}

/**
 * 경로의 staria curated 가격 (톨+VAT 포함). matrix.priceKRW 우선, 없으면 4-tier(km).
 * @returns {number|null} staria 기준가, 또는 경로 미존재 시 null(결제 불가→협의).
 */
export function curatedStariaKRW(spec, originKey, destKey) {
  if (!spec || !spec.distance_matrix) return null;
  const m = spec.distance_matrix;
  const o = String(originKey || '').trim();
  const d = String(destKey || '').trim();
  const entry = m[`${o}→${d}`] || m[`${d}→${o}`];
  if (!entry) return null; // matrix 미존재 → 협의
  if (typeof entry.priceKRW === 'number' && entry.priceKRW > 0) return entry.priceKRW; // 큐레이션 zone
  const km = lookupMatrixKm(spec, o, d);
  if (km == null) return null;
  return fourTierStariaKRW(spec, km); // 4-tier + 톨
}

/**
 * transfer 영수증 breakdown. curatedKRW(staria, VAT 내장) → 차종배수 → 편도5%/왕복(×2)10% 할인.
 * @param {{curatedKRW:number, tripType:'oneway'|'roundtrip', vehicle:string}} args
 */
export function calcTransferQuote({ curatedKRW = 0, tripType = 'oneway', vehicle } = {}) {
  const mult = VEHICLE_MULT[vehicle];
  if (!mult) return null;
  if (!Number.isFinite(curatedKRW) || curatedKRW <= 0) return null;
  const isRound = tripType === 'roundtrip';
  const vehicleBase = Math.round(curatedKRW * mult);
  const tripBase = isRound ? vehicleBase * 2 : vehicleBase;
  const couponPct = isRound ? 10 : 5;
  const coupon = Math.round((tripBase * couponPct) / 100);
  const total = tripBase - coupon; // VAT 는 curatedKRW 에 이미 포함 (별도 가산 X)
  return { curatedKRW, vehicleBase, tripType, tripBase, couponPct, coupon, total };
}

/**
 * transfer 추정 원가 (최소마진 가드용) — spec.transfer_margin_guard.cost_model 기반.
 * 편도: 적재 km + 공차복귀(deadhead_factor). 왕복: 양방향 적재(복귀=fare, deadhead 없음).
 * staria 기준(스프린터는 가격 2배 ≫ 원가라 항상 통과). cost_model 미설정 시 null(가드 skip).
 * ⚠️ 기본 cost_model 은 추정치 — 운영자 실 기사일당/연료로 교체 권장.
 * @returns {number|null} 추정 원가 KRW, 또는 산정 불가 시 null
 */
export function estimateTransferCostKrw(spec, km, tripType) {
  const cm = spec && spec.transfer_margin_guard && spec.transfer_margin_guard.cost_model;
  if (!cm || !Number.isFinite(km) || km <= 0) return null;
  const isRound = tripType === 'roundtrip';
  const dh = cm.deadhead_factor || 1.8;
  const distance = isRound ? km * 2 : km * dh;
  const fuel = distance * (cm.fuel_krw_per_km || 170);
  const hours = distance / (cm.avg_speed_kmh || 60) + (cm.overhead_hours || 1);
  const driver = hours * (cm.driver_krw_per_hour || 25000);
  const toll = tollEstimate(km) * (isRound ? 2 : dh);
  return Math.round(fuel + driver + toll);
}

/**
 * 결제 핸들러 게이트 — 플래그 + matrix curated 가격 + total 재계산 (+ 선택적 최소마진 가드).
 * client 는 originKey/destKey/tripType/vehicle 만 전달(priceKRW/km 무시 = 변조 차단).
 * 마진가드 enabled: opts.marginGuardEnabled(어드민 조종석 런타임 토글) 우선, 없으면 spec.transfer_margin_guard.enabled.
 * enabled 시 total < 추정원가×margin_multiple 이면 결제 차단(→협의/null).
 * @param {{marginGuardEnabled?:boolean}} [opts] - 런타임 override (admin-runtime-flags)
 * @returns {number|null} 결제 총액, 또는 비활성/미존재/마진미달 시 null
 */
export function resolveTransferCheckoutKrw(spec, body, featureEnabled, opts = {}) {
  if (!featureEnabled || !body) return null;
  const o = String(body.originKey || '').trim();
  const d = String(body.destKey || '').trim();
  const curatedKRW = curatedStariaKRW(spec, o, d);
  if (curatedKRW == null) return null; // 경로 미존재 → 결제 불가(협의)
  const q = calcTransferQuote({ curatedKRW, tripType: body.tripType, vehicle: String(body.vehicle || '').trim() });
  if (!q) return null;
  const guard = spec && spec.transfer_margin_guard;
  // 2026-06-06 어드민 조종석: 런타임 토글(opts.marginGuardEnabled) 우선, 미지정 시 spec 기본값.
  const guardEnabled = typeof opts.marginGuardEnabled === 'boolean' ? opts.marginGuardEnabled : (guard && guard.enabled);
  if (guard && guardEnabled) {
    const km = lookupMatrixKm(spec, o, d);
    const cost = km != null ? estimateTransferCostKrw(spec, km, body.tripType) : null;
    if (cost != null && q.total < cost * (guard.margin_multiple || 1.2)) return null; // 마진 미달 → 협의
  }
  return q.total;
}

export { VEHICLE_MULT as TRANSFER_VEHICLE_MULT };
