/**
 * P326 (2026-05-31): transit 경로 품질 2 fix 회귀 슈트 (운영자 직관 입증 → 2 agent 정밀).
 *
 * #1 cache 지리 오적용 (RouteAgent.js): block_mode transit cache(P228) 는 stop order 만 key.
 *    food placeholder 치환(matchFoodPlaceholder)으로 venue 좌표가 바뀌면 같은 order 에 옛
 *    거리/시간이 붙어 "6km 를 23분/3959m" + subway→car 강등 같은 틀린 transit 노출.
 *    fix: cache hit 후 haversine(prev,curr) 실거리 vs cached 거리 ±50% 벗어나면 cache 폐기
 *    → ODsay 실측. 핵심 판정 = pure helper isCacheGeoConsistent(actualKm, cached) 로 추출.
 *
 * #2 intercity KTX 누락 (routeEnrichment.js): block_mode 다도시는 RouteAgent
 *    _enrichMultiCityDays 가 KTX(STANDARD_INTERCITY['Seoul-Busan']) 생성하나, merge-back
 *    루프가 stops/lodging 만 원본 복사하고 intercity_transit 누락 → 생성됐다 손실(서울→부산
 *    KTX 0건). fix: 머지백 상단(enrichedStops>0 가드 **밖** — 도시전환일 stops 0 가능)에서
 *    itinerary.days[i].intercity_transit = enrichedDay.intercity_transit 복사.
 *
 * 회귀 시: #1 = 잘못된 거리/교통수단 사용자 노출, #2 = 다도시 도시간 이동 안내 공백.
 * enrichItineraryWithRoute 는 ODsay/Naver 의존이라 e2e mock 어려움 → #1 은 추출 helper
 * 행동 검증, #2 는 source-grep 배치 불변식 가드 (P259/P138/P139 동일 convention).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { isCacheGeoConsistent } from '../../api/_ai_core/agents/RouteAgent.js';

const ROOT = resolve(__dirname, '../..');
const routeAgentSrc = readFileSync(resolve(ROOT, 'api/_ai_core/agents/RouteAgent.js'), 'utf8');
const routeEnrichSrc = readFileSync(resolve(ROOT, 'api/_ai_core/routeEnrichment.js'), 'utf8');

// ─────────────────────────────────────────────────────────
// #1 — isCacheGeoConsistent 행동 검증 (±50% 경계)
// ─────────────────────────────────────────────────────────

describe('P326 #1 — isCacheGeoConsistent (cache 지리 정합)', () => {
  it('실거리 ≈ cache 거리 → true (cache 유지)', () => {
    expect(isCacheGeoConsistent(4.0, { distanceKm: 4.0 })).toBe(true);
    expect(isCacheGeoConsistent(4.3, { distanceKm: 4.0 })).toBe(true);
  });

  it('운영자 신고 케이스: 실거리 6km vs cache 3.96km(3959m) → false (cache 폐기)', () => {
    // 6 / 3.959 = 1.515 > 1.5 → venue 치환 의심 → ODsay 실측으로 fall-through.
    expect(isCacheGeoConsistent(6.0, { distanceKm: 3.959 })).toBe(false);
  });

  it('상한 경계: 실거리 = cache×1.5 → true / 초과 → false', () => {
    expect(isCacheGeoConsistent(6.0, { distanceKm: 4.0 })).toBe(true); // 4×1.5=6.0 (포함)
    expect(isCacheGeoConsistent(6.01, { distanceKm: 4.0 })).toBe(false); // 6.0 초과
  });

  it('하한 경계: 실거리 = cache×0.5 → true / 미만 → false', () => {
    expect(isCacheGeoConsistent(2.0, { distanceKm: 4.0 })).toBe(true); // 4×0.5=2.0 (포함)
    expect(isCacheGeoConsistent(1.99, { distanceKm: 4.0 })).toBe(false); // 2.0 미만
  });

  it('distanceKm 없으면 distance_m/1000 로 환산', () => {
    expect(isCacheGeoConsistent(6.5, { distance_m: 4000 })).toBe(false); // 4km → 6.5>6.0
    expect(isCacheGeoConsistent(4.5, { distance_m: 4000 })).toBe(true); // 4km → 4.5 in band
  });

  it('검증 불가(거리 0/null/누락) → 보수적으로 cache 신뢰(true)', () => {
    expect(isCacheGeoConsistent(6.0, { distanceKm: 0 })).toBe(true); // cache 거리 0
    expect(isCacheGeoConsistent(6.0, { distanceKm: null })).toBe(true); // cache 거리 null
    expect(isCacheGeoConsistent(6.0, {})).toBe(true); // 거리 필드 없음
    expect(isCacheGeoConsistent(0, { distanceKm: 4.0 })).toBe(true); // 실거리 0 (좌표 미상)
    expect(isCacheGeoConsistent(6.0, null as unknown as object)).toBe(true); // cached null 안전
  });
});

describe('P326 #1 — fix site 가 helper 사용 (wiring 가드)', () => {
  it('lookupTransitCache hit 후 isCacheGeoConsistent 게이트로 cache 반환', () => {
    expect(routeAgentSrc).toMatch(/isCacheGeoConsistent\(\s*actualKm\s*,\s*cached\s*\)/);
    expect(routeAgentSrc).toMatch(
      /if\s*\(\s*isCacheGeoConsistent\([^)]*\)\s*\)\s*\{[\s\S]{0,240}return\s*\{\s*index:\s*i\s*,\s*\.\.\.cached\s*\}/,
    );
  });

  it('지리 mismatch 시 _getTransitData(ODsay 실측) fall-through 유지', () => {
    expect(routeAgentSrc).toMatch(/return\s+this\._getTransitData\(\s*prev\s*,\s*curr/);
  });

  it('P326 #1 의도 주석 명시 (회귀 차단 의도)', () => {
    expect(routeAgentSrc).toMatch(/P326[^\n]*(cache 지리|지리 검증|지리 정합)/);
  });
});

// ─────────────────────────────────────────────────────────
// #2 — routeEnrichment intercity_transit merge-back 배치 불변식
// ─────────────────────────────────────────────────────────

describe('P326 #2 — intercity_transit merge-back (routeEnrichment)', () => {
  it('enrichedDay.intercity_transit 를 원본 itinerary.days 로 복사', () => {
    expect(routeEnrichSrc).toMatch(
      /itinerary\.days\[i\]\.intercity_transit\s*=\s*enrichedDay\.intercity_transit/,
    );
  });

  it('undefined day 방어 가드 동반 (itinerary.days[i] && enrichedDay.intercity_transit)', () => {
    expect(routeEnrichSrc).toMatch(
      /if\s*\(\s*itinerary\.days\[i\]\s*&&\s*enrichedDay\.intercity_transit\s*\)/,
    );
  });

  it('🔴 stops>0 가드 밖(const enrichedStops 선언 앞)에서 복사 — 도시전환일 stops 0 손실 방지', () => {
    // 핵심 root cause 불변식: 복사문이 enrichedStops 선언/가드보다 위에 있어야
    // stops 가 0 인 도시전환일에도 intercity_transit 가 살아남는다. 누가 이 줄을
    // `if (... enrichedStops.length > 0) {` 블록 안으로 옮기면 #2 회귀.
    const copyIdx = routeEnrichSrc.search(
      /itinerary\.days\[i\]\.intercity_transit\s*=\s*enrichedDay\.intercity_transit/,
    );
    const stopsGuardIdx = routeEnrichSrc.search(/const\s+enrichedStops\s*=\s*enrichedDay\.stops/);
    expect(copyIdx).toBeGreaterThan(0);
    expect(stopsGuardIdx).toBeGreaterThan(0);
    expect(copyIdx).toBeLessThan(stopsGuardIdx);
  });

  it('P326 #2 의도 주석 명시 (회귀 차단 의도)', () => {
    expect(routeEnrichSrc).toMatch(/P326[^\n]*intercity/);
  });
});
