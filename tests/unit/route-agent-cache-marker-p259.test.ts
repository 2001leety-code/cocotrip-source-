/**
 * P259 (2026-05-28): RouteAgent transit_from_prev cache marker 보존.
 *
 * 배경: 5/28 P258 직접 검증 (plan 14c7bac1) 시 raw 측정 = cache hit 0/11 → 보정 측정
 * (instruction_en "DB cached:" prefix) = 3/11 (27%). root cause = RouteAgent.js:1437-1452
 * 가 transit_from_prev 새 객체로 재구성하면서 transitCache.js:121-124 가 stamp 한
 * _fromCache + _cacheSource 마커를 명시적으로 누락 + source='odsay' 하드코딩.
 *
 * P259 fix:
 *   1. const isCacheHit = pt && pt._fromCache === true 변수 도출 (재사용)
 *   2. source 는 isCacheHit ? 'cache' : 'odsay' 분기
 *   3. spread 로 _fromCache + _cacheSource 마커 명시 보존 (cache hit 시만)
 *   4. walk 분기 (1452-1462) 도 같은 패턴 적용
 *
 * 회귀 시: 모든 측정 도구 false negative, prod cache hit rate 추적 불가, P195 explicit
 * caching 의사결정 baseline 손상.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(__dirname, '../..');

describe('P259 RouteAgent transit_from_prev cache marker 보존', () => {
  const routeAgentSrc = readFileSync(
    resolve(ROOT, 'api/_ai_core/agents/RouteAgent.js'),
    'utf8',
  );

  it('isCacheHit 변수 도출 (pt._fromCache === true)', () => {
    expect(routeAgentSrc).toMatch(
      /const\s+isCacheHit\s*=\s*pt\s*&&\s*pt\._fromCache\s*===\s*true/,
    );
  });

  it('subway/bus 분기 source 분기 (cache hit → "cache", miss → "odsay")', () => {
    // 정확히 "isCacheHit ? 'cache' : 'odsay'" 패턴 검증 (subway/bus + walk 두 곳)
    const matches = routeAgentSrc.match(/source:\s*isCacheHit\s*\?\s*['"]cache['"]\s*:\s*['"]odsay['"]/g) || [];
    expect(matches.length).toBeGreaterThanOrEqual(2);
  });

  it('cache hit 시 _fromCache + _cacheSource 마커 보존 (subway/bus 분기)', () => {
    // spread 안에 두 마커가 같이 들어가야 측정 false negative 차단
    expect(routeAgentSrc).toMatch(
      /isCacheHit\s*\?\s*\{\s*_fromCache:\s*true,\s*_cacheSource:\s*pt\._cacheSource\s*\|\|\s*['"]odsay_api['"]\s*\}\s*:\s*\{\s*\}/,
    );
  });

  it('walk 분기도 같은 마커 보존 패턴', () => {
    expect(routeAgentSrc).toMatch(
      /isCacheHit\s*\?\s*\{\s*_fromCache:\s*true,\s*_cacheSource:\s*pt\._cacheSource\s*\|\|\s*['"]zone_courses['"]\s*\}\s*:\s*\{\s*\}/,
    );
  });

  it('회귀 안전: source: \'odsay\' 하드코딩 제거 (subway/bus + walk 분기)', () => {
    // P259 이전 패턴 (source: 'odsay' 하드코딩) 가 P259 fix path 에서 잔존하면 회귀.
    // 단 fallback 분기 (1498+) 는 odsay null path → source: 'naver_fallback' 등 다른 값.
    // 두 reconstruction 블록 안에서만 정확히 차단.
    const block1437to1480 = routeAgentSrc.slice(
      routeAgentSrc.indexOf('const isCacheHit'),
      routeAgentSrc.indexOf('// ODsay 실패 → Gemini 원본 유지'),
    );
    expect(block1437to1480).not.toMatch(/source:\s*['"]odsay['"]\s*,/);
  });

  it('P259 주석 + 회귀 차단 의도 명시', () => {
    expect(routeAgentSrc).toMatch(
      /P259[^\n]*cache hit 마커 보존|P259[^\n]*cache marker 보존/,
    );
    expect(routeAgentSrc).toMatch(
      /P258 lesson|측정 false negative|측정 도구가 hit rate 0% misreport/,
    );
  });
});
