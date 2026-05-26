/**
 * P222 (2026-05-26): streaming early response ENV 토글 회귀 차단.
 *
 * Root cause: Vercel serverless 는 res.end() 후 instance freeze 허용. P169 의
 * "RouteEnrich/persistPlan 은 background fire-and-forget (await 가능)" 가정이
 * 잘못 — Sample 5 (planId 80cef046) status='streaming' 30분+ hang 재현.
 *
 * Fix: PLANNER_STREAMING_EARLY_RESPONSE ENV 토글
 *   - default false (또는 미설정) = early response 폐기 → routeEnrich + persistPlan
 *     완료 후 응답 전송 → status='ready' 100% 보장
 *   - true = P169 streaming 성능 유지 (Sample 5 같은 hang 재발 가능)
 *
 * 본 test 는 handlerCore.js 의 소스 텍스트를 직접 검증 — buildModel/runtime 의존성 없이
 * P200/P192/P214/P216 test 와 동일한 정적 grep 패턴.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

const __filename = fileURLToPath(import.meta.url);
const ROOT = path.resolve(__filename, '../../../');
const HANDLER_PATH = path.join(ROOT, 'api/_ai_core/handlerCore.js');
const handlerSrc = readFileSync(HANDLER_PATH, 'utf-8');

describe('P222 streaming early response ENV 토글 회귀 차단', () => {

  it('P222-A1: PLANNER_STREAMING_EARLY_RESPONSE ENV 읽기 코드 존재', () => {
    expect(handlerSrc).toMatch(/PLANNER_STREAMING_EARLY_RESPONSE/);
  });

  it('P222-A2: PLANNER_STREAMING_EARLY_RESPONSE ENV 가 sendStreamingEarlyResponse 호출 가드 조건에 포함', () => {
    // ENV 가 sendStreamingEarlyResponse 직전 인접 위치에 있어야 함 (nested paren 허용)
    // - if (... PLANNER_STREAMING_EARLY_RESPONSE ... ) { sendStreamingEarlyResponse(...) }
    const callRegex = /PLANNER_STREAMING_EARLY_RESPONSE[\s\S]{0,500}sendStreamingEarlyResponse/;
    expect(callRegex.test(handlerSrc)).toBe(true);
  });

  it('P222-A3: ENV default 가 false (env 미설정 = early response 폐기)', () => {
    // String(process.env.X || '').toLowerCase() === 'true' 패턴이어야 함
    // 즉 ENV 미설정 → '' → false (default = 폐기)
    const defaultFalseRegex = /String\s*\(\s*process\.env\.PLANNER_STREAMING_EARLY_RESPONSE\s*\|\|\s*['"]['"]\s*\)\.toLowerCase\s*\(\s*\)\s*===\s*['"]true['"]/;
    expect(defaultFalseRegex.test(handlerSrc)).toBe(true);
  });

  it('P222-A4: P222 코멘트 (root cause + Vercel docs 인용) 가 handlerCore.js 에 존재', () => {
    expect(handlerSrc).toMatch(/P222/);
    expect(handlerSrc).toMatch(/Vercel serverless/i);
    expect(handlerSrc).toMatch(/instance freeze|freeze/i);
  });

  it('P222-A5: streamingPlanId 분기는 유지 (skeleton 자체는 보존)', () => {
    // streaming skeleton 진입 (tryInitStreamingSkeleton 호출) 자체는 유지되어야 함
    // 본 fix 는 early response 만 폐기, skeleton 은 그대로
    expect(handlerSrc).toMatch(/streamingPlanId/);
  });
});
