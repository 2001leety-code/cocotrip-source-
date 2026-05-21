/**
 * P138 (2026-05-22) regression — RouteAgent Phase 1 (Naver Geocoding) 병렬화.
 *
 * Root cause (운영자 alert 5/21 22:43):
 *   "ai-planner-full 4분30초 경과 — Vercel 5분 cap 임박, last step: routeEnrich (39초)"
 *
 *   Phase 1 의 per-place geocoding 이 sequential — `for (const place of places)`
 *   안에서 `await axios.get(geoUrl, ...)` 호출. 30 places × 200-5000ms × 3 query
 *   fallback = 최대 75s per day × 5 day = 6분+ → Vercel 5분 cap 초과 → plan 생성
 *   fail → 사용자 결제 후 plan 못 받음 (revenue loss).
 *
 * Fix:
 *   outer `for (const place of places)` → `Promise.all(places.map(async (place) => ...))`
 *   - place 간 독립 fetch (각 place 의 lat/lng/photo_ref 는 다른 place 영향 X)
 *   - 각 place 내부의 query fallback (address → name+region → display_name) 는
 *     sequential 유지 — 1순위 성공 시 break 의도 보존.
 *   - 각 fetch try/catch 격리 — 한 place 실패해도 Promise.all fail-fast 발동 X.
 *
 * Test scenarios (source-level invariant):
 *   A. Phase 1 의 outer loop = `Promise.all(places.map` 패턴.
 *   B. 이전 `for (const place of places) {` + 직후 axios.get(geoUrl) 패턴 부재.
 *   C. P138 marker 존재.
 *   D. Phase 2 (transit) 의 Promise.all transitPromises 패턴은 유지 (regression 안전망).
 *   E. inner query loop (`for (const query of queries)`) 는 보존 — 1순위 break 의도.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROUTE_AGENT = readFileSync(
  resolve(process.cwd(), 'api/_ai_core/agents/RouteAgent.js'),
  'utf8',
);

describe('P138 — RouteAgent Phase 1 (Naver Geocoding) 병렬화', () => {
  it('A. Phase 1 의 outer loop = Promise.all(places.map(async (place)...)) 패턴', () => {
    // P138 marker comment 직후에 Promise.all(places.map(async (place) 구문 나와야 함.
    expect(ROUTE_AGENT).toMatch(/Phase 1[\s\S]{0,2000}await Promise\.all\(places\.map\(async \(place\) =>/);
  });

  it('B. Phase 1 안에 `for (const place of places)` + axios.get(geoUrl) 회귀 패턴 부재', () => {
    // 이전 회귀 패턴: for (const place of places) 안에서 직접 axios.get(geoUrl, ...) sequential.
    // P138 fix 후에는 Promise.all 안의 map 콜백에서만 호출됨. for-of 안의 axios.get(geoUrl) 패턴이
    // 본 파일에 존재하지 않아야 함.
    const forOfWithGeocode = /for \(const place of places\)\s*\{[\s\S]{0,500}axios\.get\([^)]*geoUrl/;
    expect(ROUTE_AGENT).not.toMatch(forOfWithGeocode);
  });

  it('C. P138 marker comment 존재', () => {
    expect(ROUTE_AGENT).toMatch(/P138/);
    // multi-line context: P138 marker 와 Vercel 5분 cap 언급 둘 다 (별도 매칭).
    expect(ROUTE_AGENT).toMatch(/Vercel 5분 cap/);
  });

  it('D. Phase 2 (transit) 의 Promise.all transitPromises 패턴 보존', () => {
    // P138 이전부터 있던 Phase 2 의 transit 병렬 호출 (line 812-830). 회귀 안전망.
    expect(ROUTE_AGENT).toMatch(/const transitResults\s*=\s*await Promise\.all\(transitPromises\)/);
  });

  it('E. inner query fallback loop 보존 — 1순위 성공 시 break 의도', () => {
    // Promise.all(places.map(async (place)...)) 안에 for (const query of queries) 존재해야.
    // sequential fallback 의도 유지 (Naver address → name+region → display_name).
    expect(ROUTE_AGENT).toMatch(/Promise\.all\(places\.map\(async \(place\)[\s\S]+?for \(const query of queries\)/);
    // break 키워드 (성공 시 fallback loop 탈출) 도 안에 존재.
    expect(ROUTE_AGENT).toMatch(/lat = parseFloat\(res\.data\.addresses\[0\]\.y\);[\s\S]{0,100}break;/);
  });

  it('F. place mutation (lat/lng/_geocoded/naverMapUrl) 은 Promise.all 콜백 안에서', () => {
    // place 별 독립 mutation — 다른 place 와 cross-mutation 없음. Promise.all 안전.
    const sectionMatch = ROUTE_AGENT.match(/Promise\.all\(places\.map\(async \(place\) =>[\s\S]+?\}\)\);/);
    expect(sectionMatch).not.toBeNull();
    const section = sectionMatch![0];
    expect(section).toMatch(/place\.lat\s*=\s*lat/);
    expect(section).toMatch(/place\.lng\s*=\s*lng/);
    expect(section).toMatch(/place\._geocoded\s*=\s*lat !== null/);
    expect(section).toMatch(/place\.naverMapUrl\s*=/);
  });

  it('G. Phase 1 닫는 괄호 균형 — Promise.all 후 Phase 1.5 (TSP) 가 정상 시작', () => {
    // 닫는 `}));` 직후 Phase 1.5 (intra-day TSP) 가 나와야 함. 회귀 시 괄호 균형 깨지면
    // tsc -b 가 잡지만 본 테스트가 fast-fail.
    expect(ROUTE_AGENT).toMatch(/\}\)\);[\s\n]+\/\/[\s\S]{0,100}Phase 1\.5: Intra-day TSP/);
  });
});
