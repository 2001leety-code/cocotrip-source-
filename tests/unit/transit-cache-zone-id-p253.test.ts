/**
 * P253 (2026-05-27): transit cache zone_id 추출 진짜 root cause fix 검증.
 *
 * P251 은 handlerCore 에서 itinerary?.zone_id 를 읽었으나 해당 필드가 itinerary 에
 * 존재하지 않음 → zone_id 항상 null → transitCache.lookupTransitCache() 항상 miss.
 *
 * P253 fix:
 *   1. handlerCore: zone_id = blockModeUsed ? (blocksUsed[0] || null) : null
 *   2. postResponsePipeline: zone_id ctx 에서 추출 + enrichItineraryWithRoute 에 전달
 *   3. routeEnrichment: zone_id 를 wrapped 객체에 포함 → RouteAgent data.zone_id 에 도달
 *
 * 회귀 시: ODsay 호출 0% cache hit → quota 낭비 + latency 증가.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(__dirname, '../..');

describe('P253 transit cache zone_id 추출 fix', () => {
  const handlerCoreSrc = readFileSync(resolve(ROOT, 'api/_ai_core/handlerCore.js'), 'utf8');
  const pipelineSrc = readFileSync(resolve(ROOT, 'api/_ai_core/postResponsePipeline.js'), 'utf8');
  const routeEnrichSrc = readFileSync(resolve(ROOT, 'api/_ai_core/routeEnrichment.js'), 'utf8');
  const routeAgentSrc = readFileSync(resolve(ROOT, 'api/_ai_core/agents/RouteAgent.js'), 'utf8');

  it('handlerCore: zone_id = blocksUsed[0] (itinerary?.zone_id 읽기 없음)', () => {
    // P253 fix: blocksUsed[0] 로 zone_id 추출
    expect(handlerCoreSrc).toMatch(/zone_id:\s*blockModeUsed\s*\?\s*\(blocksUsed\[0\]\s*\|\|\s*null\)\s*:\s*null/);
  });

  it('handlerCore: itinerary?.zone_id 읽기 금지 (P251 회귀 방지)', () => {
    // P251 은 itinerary?.zone_id 를 읽었으나 해당 필드가 없음 — 재도입 금지
    expect(handlerCoreSrc).not.toMatch(/itinerary\?\.zone_id/);
  });

  it('handlerCore: 500줄 cap 준수 (split 기준)', () => {
    // 기존 P129/P170 test 와 동일 측정 방식 (split /\\r?\\n/).length ≤ 500)
    const lines = handlerCoreSrc.split(/\r?\n/).length;
    expect(lines).toBeLessThanOrEqual(500);
  });

  it('postResponsePipeline: runRouteEnrichment ctx 에서 zone_id 추출', () => {
    // destructuring 에 zone_id 포함
    expect(pipelineSrc).toMatch(/zone_id,?\s*\n?\s*\}\s*=\s*ctx/);
  });

  it('postResponsePipeline: enrichItineraryWithRoute 호출 시 zone_id 전달', () => {
    expect(pipelineSrc).toMatch(/zone_id,?\s*\n?\s*\}\s*\)/);
    // enrichItineraryWithRoute 호출 블록 안에 zone_id 가 있어야 함
    expect(pipelineSrc).toMatch(/enrichItineraryWithRoute\(itinerary,\s*\{/);
    // zone_id: 포함 확인
    const enrichBlock = pipelineSrc.match(/enrichItineraryWithRoute\(itinerary,\s*\{[^}]+\}/s);
    expect(enrichBlock).not.toBeNull();
    if (enrichBlock) {
      expect(enrichBlock[0]).toContain('zone_id');
    }
  });

  it('routeEnrichment: enrichItineraryWithRoute 함수 시그니처에 zone_id 포함', () => {
    expect(routeEnrichSrc).toMatch(/enrichItineraryWithRoute\s*\(\s*itinerary,\s*\{[^}]*zone_id[^}]*\}/);
  });

  it('routeEnrichment: wrapped 객체에 zone_id 포함', () => {
    // RouteAgent 가 data.zone_id 로 읽는 위치 — wrapped 에 포함되어야 함
    expect(routeEnrichSrc).toMatch(/zone_id:\s*zone_id\s*\|\|\s*null/);
  });

  it('RouteAgent: data.zone_id 로 zoneId 추출 (P228 원본 로직 유지)', () => {
    // RouteAgent 가 data.zone_id 를 읽는 코드 존재 확인 (P228 원본)
    expect(routeAgentSrc).toMatch(/const\s+zoneId\s*=\s*data\.zone_id\s*\|\|\s*null/);
  });

  it('RouteAgent: dayZoneId 는 trip-level zoneId 우선 + day-level source_block_id 폴백', () => {
    // 다도시 지원: day.source_block_id 폴백 (P253 건드리지 않음)
    expect(routeAgentSrc).toMatch(/dayZoneId\s*=\s*zoneId\s*\|\|\s*dayPlan\.source_block_id\s*\|\|\s*null/);
  });

  it('transitCache: zoneId null 이면 lookupTransitCache 즉시 null 반환', () => {
    const cacheSrc = readFileSync(resolve(ROOT, 'api/_ai_core/transitCache.js'), 'utf8');
    // lookupTransitCache 내 !zoneId guard 확인
    expect(cacheSrc).toMatch(/if\s*\(!zoneId\)\s*return\s*null/);
  });
});
