// calculatorDistance.ts — 출발/목적지 자유 입력 → km 해석.
// 1차: 차터 매트릭스 lookup (pricing_spec.json, 사실상 즉시).
// 2차: /api/calculator-distance (Naver Geocoding + Haversine × 1.3).
// 둘 다 실패 시 null — 호출 측에서 manual 입력 fallback 노출.

import {
  DISTANCE_MATRIX,
  // 매트릭스는 spec 그대로 — getMatrixKeyAlternatives는 destinationKeyMap에서 따로 import.
} from '@/data/charterPricing';
import {
  normalizeDestinationToMatrixKey,
  getMatrixKeyAlternatives,
} from '@/components/charter/destinationKeyMap';

export type DistanceSource = 'matrix' | 'geocoding' | null;

export interface ResolvedDistance {
  km: number;
  source: Exclude<DistanceSource, null>;
}

// 매트릭스는 출발지를 영문 키로 받음. 사용자 자유 입력을 매트릭스 origin 키 후보로 매핑.
// 매트릭스 origin 키: ICN, GMP, PUS, CJU, TAE, CJJ, SEL_METRO, SEL_GANGNAM, BUS_METRO, ...
// destinationKeyMap에서 origin도 같은 normalize 로직으로 시도 가능.
function tryResolveOriginKey(input: string): string | null {
  // destinationKeyMap은 destination용이지만 도시명 매핑은 동일하게 활용 가능.
  // 단, 공항 코드(ICN/GMP/PUS/CJU/TAE/CJJ)는 별도로 매핑.
  const cleaned = input.trim().toLowerCase();
  if (!cleaned) return null;

  // 공항 코드 직접 입력 — IATA 우선
  const airportMap: Record<string, string> = {
    icn: 'ICN', '인천공항': 'ICN', '인천국제공항': 'ICN', 'incheon': 'ICN', 'incheon airport': 'ICN',
    gmp: 'GMP', '김포공항': 'GMP', 'gimpo': 'GMP', 'gimpo airport': 'GMP',
    pus: 'PUS', '김해공항': 'PUS', 'gimhae airport': 'PUS', 'busan airport': 'PUS',
    cju: 'CJU', '제주공항': 'CJU', 'jeju airport': 'CJU',
    tae: 'TAE', '대구공항': 'TAE', 'daegu airport': 'TAE',
    cjj: 'CJJ', '청주공항': 'CJJ', 'cheongju airport': 'CJJ',
  };
  if (airportMap[cleaned]) return airportMap[cleaned];
  // includes 매칭 (예: "icn 1터미널" → ICN)
  for (const [k, v] of Object.entries(airportMap)) {
    if (cleaned.includes(k)) return v;
  }

  // 공항이 아니면 destinationKeyMap의 도시명 매핑 재사용 (서울/부산/제주 등)
  const matrixKey = normalizeDestinationToMatrixKey(input);
  return matrixKey;
}

// 매트릭스에서 origin→destination 룩업. METRO ↔ city 키 fallback 포함.
function matrixLookup(originKey: string, destKey: string): number | null {
  const destCandidates = getMatrixKeyAlternatives(destKey);
  const originCandidates = getMatrixKeyAlternatives(originKey);
  for (const o of originCandidates) {
    for (const d of destCandidates) {
      if (o === d) continue;
      const key = `${o}→${d}`;
      const entry = (DISTANCE_MATRIX as unknown as Record<string, { km?: number }>)[key];
      if (entry && typeof entry.km === 'number') return entry.km;
      // 역방향 — 편도 거리는 대칭 가정 (실제 도로 비대칭은 ~5% 이내, 빠른 견적 용도이므로 허용).
      const rev = `${d}→${o}`;
      const revEntry = (DISTANCE_MATRIX as unknown as Record<string, { km?: number }>)[rev];
      if (revEntry && typeof revEntry.km === 'number') return revEntry.km;
    }
  }
  return null;
}

/**
 * 좌표 기반 즉시 산출 — AddressAutocomplete 가 두 좌표를 모두 확보한 경우 호출.
 * Geocoding 호출 우회. Haversine × 1.3 (한국 평균 직선:도로 비율).
 */
export function resolveKmFromCoords(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): { km: number; source: 'coords' } | null {
  if (
    !Number.isFinite(lat1) || !Number.isFinite(lng1) ||
    !Number.isFinite(lat2) || !Number.isFinite(lng2)
  ) return null;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const R = 6371; // Earth radius km
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const straightKm = R * c;
  // 도로 보정 ×1.3 — calculator-distance.js 와 동일.
  const km = Math.round(straightKm * 1.3 * 10) / 10;
  if (km <= 0) return null;
  return { km, source: 'coords' };
}

export async function resolveKm(
  origin: string,
  destination: string,
): Promise<{ km: number; source: 'matrix' | 'geocoding' } | null> {
  if (!origin || !destination) return null;

  // 1차: 매트릭스
  const oKey = tryResolveOriginKey(origin);
  const dKey = normalizeDestinationToMatrixKey(destination);
  if (oKey && dKey) {
    const km = matrixLookup(oKey, dKey);
    if (km !== null && km > 0) {
      return { km, source: 'matrix' };
    }
  }

  // 2차: Geocoding API fallback
  try {
    const url = `/api/calculator-distance?origin=${encodeURIComponent(origin)}&destination=${encodeURIComponent(destination)}`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    if (typeof data?.km === 'number' && data.km > 0) {
      return { km: data.km, source: 'geocoding' };
    }
  } catch {
    // silent — 호출 측에서 manual 입력 fallback 노출.
  }
  return null;
}
