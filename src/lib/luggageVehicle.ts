// Luggage count → vehicle count rule (single source of truth).
//
// 2026-05-10 prod 검증 (운영자 확정):
//   1-7개 → 1대 (Staria)
//   8개 이상 → 2대 (Staria + Staria 또는 Sprinter)
//   14개 이상 → 3대
//   +6 마다 +1대 (선형 증분)
//
// 함수: vehicleCount = total <= 7 ? 1 : Math.ceil((total - 7) / 6) + 1
//   7 → 1대, 8 → 2대, 13 → 2대, 14 → 3대, 19 → 3대, 20 → 4대, 25 → 4대, 26 → 5대
//
// "봉고차" 라벨 금지 — 봉고는 1톤 화물차 이미지로 외국인 픽업 부적절.
// 차터 차종: Staria / Sprinter / Bus / VIP. 일반 외국인 픽업 기본 = Staria.

export function calcVehicleCount(luggageTotal: number): number {
  if (!Number.isFinite(luggageTotal) || luggageTotal <= 0) return 1;
  if (luggageTotal <= 7) return 1;
  return Math.ceil((luggageTotal - 7) / 6) + 1;
}
