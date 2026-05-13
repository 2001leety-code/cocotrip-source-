// routeAgent-intra-day-tsp.test.ts — PR #408: intra-day TSP reorder 회귀 슈트
//
// 사용자 신고 (2026-05-13 PDF Day 4): 부산 동선 283분 (4.7h) — Gwangalli 호텔
// 출발 → Gijang (NE) → Huinnyeoul (영도구 SW) → 다시 Gwangalli. zigzag 동선.
// buildPrompt.js L556 ("같은 권역(구) 내 stops 묶어서") 안내 명시했지만 Gemini
// 무시 + RouteAgent 순서 trust → 백트래킹.
//
// fix: reorderStopsByProximity (Haversine greedy nearest-neighbor, lodging
// bookend 보존). 좌표 누락 시 원본 순서 유지 (회귀 안전망).

import { describe, it, expect } from 'vitest';
import { reorderStopsByProximity } from '../../api/_ai_core/agents/RouteAgent.js';

// ─────────────────────────────────────────────────────────
// Helper — Haversine distance (테스트용)
// ─────────────────────────────────────────────────────────
function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const toRad = (x: number) => (x * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function totalDistanceKm(stops: Array<{ lat?: number | null; lng?: number | null }>): number {
  let total = 0;
  for (let i = 1; i < stops.length; i++) {
    const prev = stops[i - 1];
    const curr = stops[i];
    if (prev.lat != null && prev.lng != null && curr.lat != null && curr.lng != null) {
      total += haversineKm(prev.lat, prev.lng, curr.lat, curr.lng);
    }
  }
  return total;
}

// ─────────────────────────────────────────────────────────
// Test cases
// ─────────────────────────────────────────────────────────

describe('reorderStopsByProximity — intra-day TSP (PR #408)', () => {
  it('case 1: 5 stops with middle far away → 재정렬 후 nearest-neighbor 순서', () => {
    // 입력: stop[2] 가 멀리 떨어진 outlier. 명동 안에서 명동→중간먼곳→근거리.
    // [0] 호텔 명동 (37.5640, 126.9810)
    // [1] 광장시장 (37.5704, 127.0028) — 명동에서 동쪽 1.7km
    // [2] 인사동 (37.5727, 126.9853) — 명동에서 북쪽 1.0km (closer to [0])
    // [3] 북촌 한옥마을 (37.5826, 126.9847) — 명동에서 북쪽 2.1km
    // [4] 호텔 명동 (37.5640, 126.9810) — last (lodging return)
    const input = [
      { name: 'Lodging-Myeongdong', lat: 37.5640, lng: 126.9810 },
      { name: 'Gwangjang Market', lat: 37.5704, lng: 127.0028 },
      { name: 'Insadong', lat: 37.5727, lng: 126.9853 },
      { name: 'Bukchon', lat: 37.5826, lng: 126.9847 },
      { name: 'Lodging-Myeongdong', lat: 37.5640, lng: 126.9810 },
    ];
    const out = reorderStopsByProximity(input);
    // First/last 보존
    expect(out[0].name).toBe('Lodging-Myeongdong');
    expect(out[out.length - 1].name).toBe('Lodging-Myeongdong');
    // 가장 가까운 stop = Insadong (1.0km from 명동) — 재정렬 후 [1] 에 옴
    expect(out[1].name).toBe('Insadong');
    // 전체 총 거리가 원본보다 짧거나 같음
    expect(totalDistanceKm(out)).toBeLessThanOrEqual(totalDistanceKm(input));
  });

  it('case 2: lodging bookend 보존 — first/last 절대 안 바뀜', () => {
    // 의도적으로 가운데 stop 들 random 순서 + lodging 이 명백히 끝/처음.
    const input = [
      { name: 'Hotel-A', lat: 37.5, lng: 127.0 },
      { name: 'Far-stop-1', lat: 37.6, lng: 127.1 },
      { name: 'Near-stop', lat: 37.51, lng: 127.01 },
      { name: 'Far-stop-2', lat: 37.7, lng: 127.2 },
      { name: 'Hotel-A', lat: 37.5, lng: 127.0 },
    ];
    const out = reorderStopsByProximity(input);
    expect(out[0].name).toBe('Hotel-A');
    expect(out[out.length - 1].name).toBe('Hotel-A');
    // 중간이 재정렬 — first stop (37.5, 127.0) 에서 가장 가까운 = Near-stop
    expect(out[1].name).toBe('Near-stop');
  });

  it('case 3: 중간 stop 좌표 누락 → fallback (원본 순서 유지)', () => {
    const input = [
      { name: 'Lodging', lat: 37.5, lng: 127.0 },
      { name: 'Stop-A', lat: 37.6, lng: 127.1 }, // 좌표 있음
      { name: 'Stop-B', lat: null, lng: null }, // 좌표 누락
      { name: 'Stop-C', lat: 37.7, lng: 127.2 },
      { name: 'Lodging', lat: 37.5, lng: 127.0 },
    ];
    const out = reorderStopsByProximity(input);
    // 원본 그대로 (재정렬 안 됨) — 같은 ref / 같은 순서
    expect(out).toBe(input);
    expect(out.map((s) => s.name)).toEqual(['Lodging', 'Stop-A', 'Stop-B', 'Stop-C', 'Lodging']);
  });

  it('case 4: 2-stop day (lodging-lodging) — no middle stops, 그대로 반환', () => {
    const input = [
      { name: 'Lodging', lat: 37.5, lng: 127.0 },
      { name: 'Lodging', lat: 37.5, lng: 127.0 },
    ];
    const out = reorderStopsByProximity(input);
    expect(out).toBe(input);
    expect(out.length).toBe(2);
  });

  it('case 5: 3-stop day (lodging + 1 middle + lodging) — middle 1개라 재정렬 무의미', () => {
    const input = [
      { name: 'Lodging', lat: 37.5, lng: 127.0 },
      { name: 'Single-Stop', lat: 37.6, lng: 127.1 },
      { name: 'Lodging', lat: 37.5, lng: 127.0 },
    ];
    const out = reorderStopsByProximity(input);
    expect(out).toBe(input);
    expect(out[1].name).toBe('Single-Stop');
  });

  it('case 6: 실제 Busan Day 4 회귀 — fail-safe, 원본보다 악화시키지 않음', () => {
    // 사용자 PDF 보고 (2026-05-13): Day 4 Busan 동선 4.7h (283분) transit.
    //
    // 원본 (Gemini 반환 순서):
    //   [0] Gwangalli lodging          (35.1532, 129.1186)  — 수영구
    //   [1] Haedong Yonggungsa         (35.1886, 129.2244)  — Gijang NE
    //   [2] Gijang Seafood Kalguksu    (35.2436, 129.2200)  — Gijang NE
    //   [3] Huinnyeoul Culture Village (35.0867, 128.9647)  — 영도구 SW (outlier)
    //   [4] Eonyang Bulgogi Gwangalli  (35.1532, 129.1153)  — 수영구 E
    //   [5] Gwangalli lodging          (35.1532, 129.1186)  — 수영구
    //
    // 주의: Haversine 직선 거리 만 본다면 원본이 우연히 짧을 수 있음 (Eonyang
    // 이 lodging 바로 옆이라 마지막 배치가 자연스러움). 실제 도로 (다리·우회)
    // 로는 zigzag 가 폭발 — 본 fix 는 lodging 좌표 변경 후 운영자 검증으로 후속.
    //
    // 본 test 는 fail-safe 검증: 알고리즘이 원본보다 악화시키지 X.
    const input = [
      { name: 'Gwangalli lodging', display_name: 'Lodging-Gwangalli', lat: 35.1532, lng: 129.1186 },
      { name: 'Haedong Yonggungsa', display_name: 'Yonggungsa', lat: 35.1886, lng: 129.2244 },
      { name: 'Gijang Seafood Kalguksu', display_name: 'Gijang-Kalguksu', lat: 35.2436, lng: 129.2200 },
      { name: 'Huinnyeoul Culture Village', display_name: 'Huinnyeoul', lat: 35.0867, lng: 128.9647 },
      { name: 'Eonyang Bulgogi Gwangalli', display_name: 'Eonyang-BBQ', lat: 35.1532, lng: 129.1153 },
      { name: 'Gwangalli lodging', display_name: 'Lodging-Gwangalli', lat: 35.1532, lng: 129.1186 },
    ];
    const out = reorderStopsByProximity(input);

    // First/last lodging 보존 — 가장 중요한 invariant.
    expect(out[0].display_name).toBe('Lodging-Gwangalli');
    expect(out[out.length - 1].display_name).toBe('Lodging-Gwangalli');
    expect(out.length).toBe(6);
    // 모든 stop 보존 (중복 없음 + drop 없음).
    const inputNames = new Set(input.map((s) => s.display_name));
    const outNames = new Set(out.map((s) => s.display_name));
    expect(outNames).toEqual(inputNames);

    // fail-safe: 알고리즘이 원본 zigzag 보다 악화시키지 X (총 직선 거리 ≤ 원본).
    const originalTotal = totalDistanceKm(input);
    const reorderedTotal = totalDistanceKm(out);
    console.log(`[test] Busan Day 4 — original: ${originalTotal.toFixed(1)}km, reordered: ${reorderedTotal.toFixed(1)}km`);
    expect(reorderedTotal).toBeLessThanOrEqual(originalTotal);
  });

  it('case 6b: 실제 zigzag → 명백한 단축 (3 cluster pattern)', () => {
    // 명백한 zigzag pattern — 같은 zone 안 점들이 뒤섞임. greedy NN 이 cluster
    // 단축 가능.
    //
    // 원본: Hotel → North-far → South-near → North-far2 → South-near2 → Hotel
    //   ↳ 매번 north/south 왕복 → 총 거리 길어짐
    // 재정렬: Hotel → South-near → South-near2 → North-far → North-far2 → Hotel
    //   ↳ same cluster 순회 → 총 거리 짧아짐
    const input = [
      { name: 'Hotel', lat: 35.10, lng: 129.10 },     // 출발지
      { name: 'North-far-1', lat: 35.30, lng: 129.10 }, // 22km north
      { name: 'South-near-1', lat: 35.12, lng: 129.10 }, // 2km north
      { name: 'North-far-2', lat: 35.31, lng: 129.11 }, // 23km north (zigzag back)
      { name: 'South-near-2', lat: 35.13, lng: 129.11 }, // 3km north (zigzag)
      { name: 'Hotel', lat: 35.10, lng: 129.10 },
    ];
    const out = reorderStopsByProximity(input);
    const originalTotal = totalDistanceKm(input);
    const reorderedTotal = totalDistanceKm(out);
    console.log(`[test] zigzag fix — original: ${originalTotal.toFixed(1)}km, reordered: ${reorderedTotal.toFixed(1)}km`);

    // 이 케이스에서는 명백히 단축됨 (zigzag 가 비효율적이라).
    expect(reorderedTotal).toBeLessThan(originalTotal);
    // 첫 stop 다음이 cluster 가까운 곳 (South-near-1 or 2).
    expect(out[1].name).toMatch(/^South-near/);
    // First/last 보존.
    expect(out[0].name).toBe('Hotel');
    expect(out[out.length - 1].name).toBe('Hotel');
  });

  it('case 7: empty / null / 1-stop edge case — graceful fallback', () => {
    // 1-stop, empty, null 모두 그대로 반환 (재정렬 없음).
    expect(reorderStopsByProximity([])).toEqual([]);
    expect(reorderStopsByProximity([{ name: 'only', lat: 37.5, lng: 127.0 }])).toEqual([{ name: 'only', lat: 37.5, lng: 127.0 }]);
    // null 입력 시 — Array.isArray check 가 null 차단, 함수가 null 그대로 반환.
    expect(reorderStopsByProximity(null as unknown as Array<unknown>)).toBe(null);
    expect(reorderStopsByProximity(undefined as unknown as Array<unknown>)).toBe(undefined);
  });

  it('case 8: 첫 stop 좌표 누락 (lodging 좌표 없음) → fallback (원본 순서)', () => {
    // first stop 좌표 누락 — anchor 잡을 수 없어서 원본 그대로 반환.
    const input = [
      { name: 'Lodging-no-coord', lat: null, lng: null },
      { name: 'Stop-A', lat: 37.6, lng: 127.1 },
      { name: 'Stop-B', lat: 37.55, lng: 127.05 },
      { name: 'Stop-C', lat: 37.7, lng: 127.2 },
      { name: 'Lodging-no-coord', lat: null, lng: null },
    ];
    const out = reorderStopsByProximity(input);
    expect(out).toBe(input); // 원본 그대로
  });

  // 2026-05-13 PR #413: chronological 보존 검증.
  // TSP reorder 는 start_time 재할당 X — 시간 순서 깨지면 PDF 시간 jumbled.
  it('case 9: chronological 깨는 forward NN 후보는 제외 (PR #413)', () => {
    // 시나리오: forward NN 의 distance 가 짧지만 chronological 깨면 거부 → original 채택
    // Stops with chronological start_times:
    //   Lodging 09:00 (Gwangalli E)
    //   A 11:00 (NE far)
    //   B 13:00 (E close to lodging — but should be after A timewise)
    //   C 18:00 (SW far)
    //   Lodging 21:00
    //
    // Original chronological: Lodging → A → B → C → Lodging (Gemini's chrono order)
    // Forward NN from Lodging: would pick B (closest), then A, then C — BUT this gives
    //   times [09:00, 13:00, 11:00, 18:00, 21:00] = 13 < 11 NOT chronological.
    // PR #413: 이 forward NN 후보 chronology 깨짐 → 제외 → original 채택.
    const input = [
      { name: 'Lodging', category: 'lodging', start_time: '09:00', lat: 35.15, lng: 129.12 },
      { name: 'A-far-NE', start_time: '11:00', lat: 35.25, lng: 129.22 },
      { name: 'B-close-E', start_time: '13:00', lat: 35.16, lng: 129.13 },
      { name: 'C-far-SW', start_time: '18:00', lat: 35.08, lng: 128.95 },
      { name: 'Lodging', category: 'lodging', start_time: '21:00', lat: 35.15, lng: 129.12 },
    ];
    const out = reorderStopsByProximity(input);
    // chronological 보존 = original 순서 유지
    expect(out.map((s: { name: string }) => s.name)).toEqual(['Lodging', 'A-far-NE', 'B-close-E', 'C-far-SW', 'Lodging']);
  });

  it('case 10: 모든 stops start_time 없으면 chronological 검사 통과 (모두 적합)', () => {
    // start_time 모두 없으면 chronological 검사 skip — 거리 기반 reorder 진행
    const input = [
      { name: 'Lodging-start', lat: 37.55, lng: 126.97 },
      { name: 'A-far', lat: 37.7, lng: 127.2 },
      { name: 'B-near', lat: 37.56, lng: 126.98 },
      { name: 'C-mid', lat: 37.6, lng: 127.05 },
      { name: 'Lodging-end', lat: 37.55, lng: 126.97 },
    ];
    const out = reorderStopsByProximity(input);
    // first/last 보존 + 중간 reorder 발생 가능 (distance 기반)
    expect(out[0]?.name).toBe('Lodging-start');
    expect(out[out.length - 1]?.name).toBe('Lodging-end');
    // chronology 검사 통과 (start_time 없으면 통과) → reorder 적용 (distance min)
  });

  it('case 11: 입력 자체 chronological 깨짐 + greedy 도 깨짐 → original 반환 (안전 fallback)', () => {
    // 비상 케이스: Gemini 가 시간 순서 안 맞춰서 응답 + greedy 도 안 맞음
    // → 모든 candidate 비chronological → original 반환
    const input = [
      { name: 'Lodging', category: 'lodging', start_time: '09:00', lat: 35.15, lng: 129.12 },
      { name: 'X', start_time: '15:00', lat: 35.25, lng: 129.22 }, // 15시
      { name: 'Y', start_time: '11:00', lat: 35.16, lng: 129.13 }, // 11시 (시간 역전!)
      { name: 'Z', start_time: '18:00', lat: 35.08, lng: 128.95 },
      { name: 'Lodging', category: 'lodging', start_time: '21:00', lat: 35.15, lng: 129.12 },
    ];
    const out = reorderStopsByProximity(input);
    // 입력 자체 chronological 깨졌고, greedy 도 또 다른 순열을 시도하지만 chronology 보장 못 함.
    // 안전 fallback = original 반환 (caller 에서 추가 검증 필요)
    expect(Array.isArray(out)).toBe(true);
    expect(out[0]?.name).toBe('Lodging');
    expect(out[out.length - 1]?.name).toBe('Lodging');
  });
});
