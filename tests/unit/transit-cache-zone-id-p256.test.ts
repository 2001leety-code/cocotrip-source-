/**
 * P256 (2026-05-28): transit cache hit 0% round 3 — Inngest worker layer 4 fix.
 *
 * P253 (PR #654) 가 sync path 의 3 layer 를 fix 했으나 block_mode plan 의 90%+ 가
 * Inngest worker 를 경유 (handlerCore.js L350 tryBlockModeInngestPath → dispatchOrInline
 * → buildPlanAiCompletePayload → processPlanAfterAI.js worker) → ctx 에 zone_id 가
 * 없어서 worker 의 runRouteEnrichment 호출 시 zone_id=undefined → cache 0% 유지.
 *
 * 운영자 검증: PR #654 머지 (4cc88736, 2026-05-27T15:05Z) 후 10분 뒤 생성된 plan
 *   b9903ae5 의 cache hit = 0/11 (모두 ODsay 호출). 5/5 sample 동일.
 *
 * P256 fix (2 layer):
 *   1. inngestDispatch.buildPlanAiCompletePayload — blocksUsed[0] 로 zone_id 도출 +
 *      ctx 에 포함.
 *   2. processPlanAfterAI.js (Inngest worker) — runRouteEnrichment 호출 시
 *      zone_id: ctx.zone_id || null 전달.
 *
 * 회귀 시: ODsay quota 낭비 (192/1000 시드 후 80% 만 자연 traffic 가용) + latency 증가.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(__dirname, '../..');

describe('P256 Inngest worker zone_id 4번째 layer fix', () => {
  const inngestDispatchSrc = readFileSync(
    resolve(ROOT, 'api/_ai_core/inngestDispatch.js'),
    'utf8',
  );
  const workerSrc = readFileSync(
    resolve(ROOT, 'api/_inngest/functions/processPlanAfterAI.js'),
    'utf8',
  );

  it('inngestDispatch: zone_id = blocksUsed[0] 도출 (block_mode 만)', () => {
    // P256 fix: blocksUsed[0] 추출
    expect(inngestDispatchSrc).toMatch(
      /zone_id\s*=\s*\(plannerMode\s*===\s*['"]block_mode['"]\s*&&\s*Array\.isArray\(blocksUsed\)\s*&&\s*blocksUsed\.length\s*>\s*0\)\s*\?\s*blocksUsed\[0\]\s*:\s*null/,
    );
  });

  it('inngestDispatch: ctx 에 zone_id 포함', () => {
    // buildPlanAiCompletePayload 의 return ctx 안에 zone_id 가 있어야 함
    const ctxBlock = inngestDispatchSrc.match(
      /ctx:\s*\{[\s\S]+?\n\s*\},?\s*\n\s*\};\s*\n\}/,
    );
    expect(ctxBlock).not.toBeNull();
    if (ctxBlock) {
      expect(ctxBlock[0]).toMatch(/zone_id/);
    }
  });

  it('Inngest worker: runRouteEnrichment 호출 시 zone_id 전달', () => {
    // processPlanAfterAI.js 의 step.run('routeEnrich', ...) 블록 안에 zone_id 가 있어야 함
    const routeEnrichBlock = workerSrc.match(
      /runRouteEnrichment\(itinerary,\s*\{[\s\S]+?\}\)/,
    );
    expect(routeEnrichBlock).not.toBeNull();
    if (routeEnrichBlock) {
      expect(routeEnrichBlock[0]).toMatch(/zone_id:\s*ctx\.zone_id\s*\|\|\s*null/);
    }
  });

  it('Inngest worker: ctx.zone_id || null 패턴 (회귀 방지)', () => {
    expect(workerSrc).toMatch(/zone_id:\s*ctx\.zone_id\s*\|\|\s*null/);
  });

  it('inngestDispatch: P256 주석 포함 (역사 추적)', () => {
    expect(inngestDispatchSrc).toMatch(/P256/);
  });

  it('Inngest worker: P256 주석 포함', () => {
    expect(workerSrc).toMatch(/P256/);
  });

  it('회귀 방지: ctx 에 plannerMode 와 blocksUsed 도 같이 유지 (zone_id 도출 의존)', () => {
    // P256 의 zone_id 도출 함수가 plannerMode 와 blocksUsed 를 입력으로 사용 — 둘 다 ctx 에 보존되어야 함
    const ctxBlock = inngestDispatchSrc.match(
      /ctx:\s*\{[\s\S]+?\n\s*\},?\s*\n\s*\};\s*\n\}/,
    );
    expect(ctxBlock).not.toBeNull();
    if (ctxBlock) {
      expect(ctxBlock[0]).toMatch(/plannerMode/);
      expect(ctxBlock[0]).toMatch(/blocksUsed/);
    }
  });
});
