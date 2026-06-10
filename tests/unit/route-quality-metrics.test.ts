import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
// @ts-expect-error — ESM .js in api/, no type decls
import { computeDayRouteMetrics, isExcessiveDayRoute, haversineKm } from '../../api/_ai_core/routeQuality.js';

// 2026-06-10 운영자 검증 요청 → 실 5일 plan(550fb532) 진단:
// Day2(서울) 26.4km / Day3(서울) 24.9km X자 횡단 발견. Day1 4.9km·Day4(부산) 1.5km 는 정상.
// 본 테스트는 그 실제 좌표로 measure 함수가 zigzag day 만 정확히 flag 하는지 잠근다.
// (측정만 — stop 재정렬/시각 변경은 식사 시각 고정 때문에 위험이라 안 함. 근본 개선은 프롬프트.)

const PLAN_550 = {
  day1_seoul_ok: [
    { name: '명동 신라스테이', category: 'lodging' }, // NOGEO
    { name: '경복궁', lat: 37.5788, lng: 126.977 },
    { name: '하남돼지집 동대문점', lat: 37.5668, lng: 127.0068 },
    { name: '인사동', lat: 37.5717, lng: 126.986 },
    { name: '명동 신라스테이', category: 'lodging' }, // NOGEO
  ],
  day2_seoul_zigzag: [
    { name: '명동 신라스테이', category: 'lodging' },
    { name: '조계사', lat: 37.5745, lng: 126.982 },
    { name: '브릭샌드 명동점', lat: 37.5634, lng: 126.9841 },
    { name: '봉은사', lat: 37.5149, lng: 127.0577 }, // 강남 — 도심에서 8km
    { name: '이태리국시 한남', lat: 37.5357, lng: 126.9996 },
    { name: '서울공예박물관', lat: 37.5766, lng: 126.9834 }, // 종로 복귀
    { name: '홍대 맛집 깃뜰', lat: 37.5504, lng: 126.9198 }, // 서북 6km
    { name: '명동 신라스테이', category: 'lodging' },
  ],
  day4_busan_tight: [
    { name: '해운대 파라다이스 호텔', category: 'lodging' },
    { name: '자갈치시장', lat: 35.0966, lng: 129.0306 },
    { name: '국제시장', lat: 35.1015, lng: 129.0284 },
    { name: 'BIFF 광장', lat: 35.0982, lng: 129.0292 },
    { name: 'meat반달고깃', lat: 35.102, lng: 129.0261 },
    { name: '해운대 파라다이스 호텔', category: 'lodging' },
  ],
};

describe('routeQuality — 동선 측정', () => {
  it('haversineKm: 좌표 누락 시 null', () => {
    expect(haversineKm({ lat: 1, lng: 1 }, null)).toBeNull();
    expect(haversineKm({ lat: 37.5, lng: 127 }, { lat: 37.5, lng: 127 })).toBeCloseTo(0, 3);
    // 경복궁↔봉은사 대략 8km
    expect(haversineKm({ lat: 37.5788, lng: 126.977 }, { lat: 37.5149, lng: 127.0577 })).toBeGreaterThan(7);
  });

  it('Day2 서울 = zigzag 로 정확히 flag (path ~26km)', () => {
    const m = computeDayRouteMetrics(PLAN_550.day2_seoul_zigzag);
    expect(m.coordCount).toBe(6); // lodging 2개 NOGEO 제외
    expect(m.pathKm).toBeGreaterThan(20);
    expect(isExcessiveDayRoute(m)).toBe(true);
  });

  it('Day4 부산 = 도보권 밀집 → flag 안 됨 (path <3km)', () => {
    const m = computeDayRouteMetrics(PLAN_550.day4_busan_tight);
    expect(m.coordCount).toBe(4);
    expect(m.pathKm).toBeLessThan(3);
    expect(isExcessiveDayRoute(m)).toBe(false);
  });

  it('Day1 서울 = 양호 (4-6km) → flag 안 됨', () => {
    const m = computeDayRouteMetrics(PLAN_550.day1_seoul_ok);
    expect(m.coordCount).toBe(3);
    expect(m.pathKm).toBeLessThan(8);
    expect(isExcessiveDayRoute(m)).toBe(false);
  });

  it('coordCount<3 (밤도착 lodging-only 등) 은 판정 제외', () => {
    const m = computeDayRouteMetrics([{ name: 'hotel', category: 'lodging' }]);
    expect(m.coordCount).toBe(0);
    expect(isExcessiveDayRoute(m)).toBe(false);
    expect(computeDayRouteMetrics(null).pathKm).toBe(0);
  });
});

// buildPrompt ZONE CLUSTERING STRICT 룰 회귀 락 — 프롬프트에서 zone 강제 지시가
// 사라지면(soft 로 회귀) Day2 26km zigzag 가 재발한다. 마커 + BAD 예시 존재 잠금.
const BUILD_PROMPT_SRC = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '../../api/_ai_core/buildPrompt.js'),
  'utf8',
);

describe('buildPrompt ZONE CLUSTERING STRICT 락', () => {
  it('zone 클러스터링 STRICT 룰 존재', () => {
    expect(BUILD_PROMPT_SRC).toContain('ZONE CLUSTERING');
    expect(BUILD_PROMPT_SRC).toMatch(/비인접 zone/);
  });
  it('실패 사례(봉은사 강남 횡단) BAD 예시 + 식당 same-zone 룰 존재', () => {
    expect(BUILD_PROMPT_SRC).toMatch(/BAD[^]*봉은사/);
    expect(BUILD_PROMPT_SRC).toMatch(/식당.*그날 zone|그날 zone.*식당/);
  });
});
