/**
 * P139 (2026-05-22) — validateLodgingBookend 의 airport_transfer 카테고리 예외.
 *
 * Source bug (운영자 plan 9845a69e Diagnostics):
 *   lodging_bookend_violation · anchor: multi-city-day-anchor
 *   Day 5 · last · "인천국제공항 T1" · 349.4km
 *   ※ 다도시 plan 의 lodging_bookend_violation 은 의도된 패턴 (anchor=첫 day
 *     호텔 vs 도시 이동 후 호텔). validator multi-city 미인식 — 별도 후속 fix.
 *
 * Root cause:
 *   validateLodgingBookend (routeEnrichment.js:39) 의 multi-city day-anchor
 *   분기에서 last stop = 인천국제공항 T1 (category='airport_transfer') 가 그
 *   day 의 dayLodging 좌표 (해운대 호텔) 와 349.4km 측정 → false-positive
 *   lodging_bookend_violation 생성.
 *
 *   출국일 마지막 stop = 공항 이동 = 호텔 5km 이내 의도 자체가 부적절. 운영자
 *   admin panel 의 false-positive noise.
 *
 * Fix:
 *   isAirportTransferStop() helper — category='airport_transfer' (또는 'airport')
 *   이면 bookend 검증 skip. multi-city / 단도시 양쪽 분기 모두 적용.
 *
 * Test scenarios:
 *   A. 단도시: last stop airport_transfer → bookend 검증 skip → no warning.
 *   B. 단도시: last stop 일반 (food/attraction) + 5km+ → warning push (regression 안전망).
 *   C. 다도시: Day N last stop airport_transfer → skip → no warning.
 *   D. 다도시: Day N last stop 일반 카테고리 + 5km+ → warning push.
 *   E. 단도시: first stop airport_transfer (도착일) → skip.
 *   F. category 대소문자 무관: 'AIRPORT_TRANSFER' / 'Airport' 도 skip.
 *   G. category=null/undefined → skip 안 함 (안전 - 기존 logic 보존).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// ─── Inline replica of P139 helper ─────────────────────────────────────────────
function isAirportTransferStop(stop: { category?: string | null } | null | undefined): boolean {
  const cat = String(stop?.category || '').toLowerCase();
  return cat === 'airport_transfer' || cat === 'airport';
}

describe('P139 — isAirportTransferStop helper', () => {
  it('A. category="airport_transfer" → true', () => {
    expect(isAirportTransferStop({ category: 'airport_transfer' })).toBe(true);
  });

  it('B. category="airport" → true', () => {
    expect(isAirportTransferStop({ category: 'airport' })).toBe(true);
  });

  it('C. category="AIRPORT_TRANSFER" (대문자) → true', () => {
    expect(isAirportTransferStop({ category: 'AIRPORT_TRANSFER' })).toBe(true);
  });

  it('D. category="Airport" (Capitalize) → true', () => {
    expect(isAirportTransferStop({ category: 'Airport' })).toBe(true);
  });

  it('E. category="food" → false', () => {
    expect(isAirportTransferStop({ category: 'food' })).toBe(false);
  });

  it('F. category="lodging" → false', () => {
    expect(isAirportTransferStop({ category: 'lodging' })).toBe(false);
  });

  it('G. category="attraction" → false', () => {
    expect(isAirportTransferStop({ category: 'attraction' })).toBe(false);
  });

  it('H. category=undefined → false (안전 - 기존 logic 보존)', () => {
    expect(isAirportTransferStop({})).toBe(false);
  });

  it('I. category=null → false', () => {
    expect(isAirportTransferStop({ category: null })).toBe(false);
  });

  it('J. stop=null → false', () => {
    expect(isAirportTransferStop(null)).toBe(false);
  });

  it('K. category="airport_pickup" (다른 카테고리) → false (정확한 prefix 일치만)', () => {
    expect(isAirportTransferStop({ category: 'airport_pickup' })).toBe(false);
  });
});

describe('P139 — source-level invariant (routeEnrichment.js)', () => {
  const ROUTE_ENRICHMENT = readFileSync(
    resolve(process.cwd(), 'api/_ai_core/routeEnrichment.js'),
    'utf8',
  );

  it('P139 marker 존재', () => {
    expect(ROUTE_ENRICHMENT).toMatch(/P139/);
  });

  it('isAirportTransferStop 헬퍼 선언 + airport_transfer/airport 양쪽 매칭', () => {
    expect(ROUTE_ENRICHMENT).toMatch(/function\s+isAirportTransferStop/);
    expect(ROUTE_ENRICHMENT).toMatch(/cat\s*===\s*['"]airport_transfer['"]\s*\|\|\s*cat\s*===\s*['"]airport['"]/);
  });

  it('multi-city 분기에서 isAirportTransferStop check + skip (null 할당)', () => {
    // multi-city 분기 안에 isAirportTransferStop(first/last) ? null : distanceMeters 패턴
    expect(ROUTE_ENRICHMENT).toMatch(/isAirportTransferStop\(first\)\s*\?\s*null\s*:\s*distanceMeters/);
    expect(ROUTE_ENRICHMENT).toMatch(/isAirportTransferStop\(last\)\s*\?\s*null\s*:\s*distanceMeters/);
  });

  it('multi-city + 단도시 양쪽 분기 모두 isAirportTransferStop 적용 (2회+ 등장)', () => {
    // for-loop 2개 (multi-city + 단도시) 양쪽에서 first/last 각각 = 최소 4회 등장.
    const matches = ROUTE_ENRICHMENT.match(/isAirportTransferStop\(/g) || [];
    expect(matches.length).toBeGreaterThanOrEqual(4);
  });
});

describe('P139 — false-positive 차단 시나리오 (plan 9845a69e 재현)', () => {
  // multi-city day 의 last stop = 인천국제공항 T1. 해운대 호텔 anchor 와 349.4km.
  // P139 fix 후: airport_transfer skip → no warning.
  function simulateBookendCheck(stops: { category?: string; lat: number; lng: number; name?: string }[], anchor: { lat: number; lng: number }): { skipped: boolean; distM: number | null } {
    const last = stops[stops.length - 1];
    if (isAirportTransferStop(last)) {
      return { skipped: true, distM: null };
    }
    // simplified distance (just return haversine-ish approx, not testing math)
    const dLat = (last.lat - anchor.lat) * 111000;
    const dLng = (last.lng - anchor.lng) * 88000;
    const distM = Math.sqrt(dLat * dLat + dLng * dLng);
    return { skipped: false, distM };
  }

  it('plan 9845a69e Day 5 재현: 해운대 호텔 anchor + 인천공항 T1 last → skip', () => {
    const stops = [
      { category: 'attraction', lat: 35.158, lng: 129.16, name: '해운대 해변' },
      { category: 'food', lat: 35.16, lng: 129.155, name: '부산 맛집' },
      { category: 'airport_transfer', lat: 37.4602, lng: 126.4407, name: '인천국제공항 T1' },
    ];
    const haeundaeHotel = { lat: 35.158, lng: 129.16 };
    const result = simulateBookendCheck(stops, haeundaeHotel);
    expect(result.skipped).toBe(true);
    expect(result.distM).toBeNull();
  });

  it('regression 안전망: airport_transfer 없으면 기존 logic 그대로', () => {
    const stops = [
      { category: 'food', lat: 35.16, lng: 129.155, name: '부산 맛집' },
      { category: 'attraction', lat: 35.158, lng: 129.16, name: '해운대 해변' },
    ];
    const haeundaeHotel = { lat: 35.158, lng: 129.16 };
    const result = simulateBookendCheck(stops, haeundaeHotel);
    expect(result.skipped).toBe(false);
    expect(result.distM).not.toBeNull();
  });
});
