/**
 * P186 (2026-05-25): streaming early response 에도 admin-bypass _debug 주입.
 *
 * 회귀 컨텍스트: 5/25 P138 close-out 측정에서 ADMIN-BYPASS- orderId 로 plan 생성
 * 성공 (HTTP 200, 102.7s) 했으나 응답의 `_debug` 가 empty 로 관찰. 원인 = P169
 * streaming 모드가 handlerCore.js:407 `if (!streamingResponseSent)` 의 _debug 주입
 * 분기를 SKIP. measure script 가 model / plannerMode / abReason / blockMode /
 * streaming 자동 식별 불가 → 향후 측정 cycle 마다 운영자 수동 Vercel ENV 확인 필요.
 *
 * Fix: handlerCore.js streaming 분기 (L354) 에서도 buildAdminDebug 호출 +
 * sendStreamingEarlyResponse 시그니처에 `debug` 옵션 추가. 일반 user 는 buildAdminDebug
 * 가 undefined 반환 → `...(debug ? { _debug: debug } : {})` spread 시 미포함 →
 * 정보 leak 차단 유지 (P177 보안 가드 그대로).
 *
 * 회귀 시 (lint 가 잡지 못한 경우): streaming 모드 plan 의 _debug 가 다시 empty
 * → measure 자동화 회귀 + 운영자 ENV 직접 확인 부담 재발생.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('P186 streaming early response — admin-bypass _debug 주입', () => {
  const handlerCorePath = resolve(__dirname, '../../api/_ai_core/handlerCore.js');
  const bgPipelinesPath = resolve(__dirname, '../../api/_ai_core/backgroundPipelines.js');
  const handlerSrc = readFileSync(handlerCorePath, 'utf8');
  const bgSrc = readFileSync(bgPipelinesPath, 'utf8');

  it('handlerCore.js — streaming 분기에서 buildAdminDebug 호출 (earlyDebug 변수)', () => {
    // streaming 분기 (L354 부근) 에서 buildAdminDebug 호출이 있어야 함.
    // 비-streaming 분기 (L407 부근) 외에 streaming 직전에도 호출 필요.
    const buildAdminDebugCalls = handlerSrc.match(/buildAdminDebug\s*\(/g) || [];
    expect(buildAdminDebugCalls.length).toBeGreaterThanOrEqual(2);
  });

  it('handlerCore.js — sendStreamingEarlyResponse 호출에 debug 매개변수 전달', () => {
    // sendStreamingEarlyResponse({ ..., debug: earlyDebug }) 형태로 전달되어야 함.
    expect(handlerSrc).toMatch(/sendStreamingEarlyResponse\s*\(\s*\{[^}]*\bdebug\s*:/);
  });

  it('backgroundPipelines.js — sendStreamingEarlyResponse 시그니처에 debug 매개변수 존재', () => {
    expect(bgSrc).toMatch(/export\s+function\s+sendStreamingEarlyResponse\s*\(\s*\{[^}]*\bdebug\b/);
  });

  it('backgroundPipelines.js — _debug spread (debug 있을 때만 _debug 키 포함)', () => {
    // 일반 user (debug=undefined) 시 _debug 키 미포함 — 보안 가드.
    expect(bgSrc).toMatch(/\.\.\.\(debug\s*\?\s*\{\s*_debug:\s*debug\s*\}\s*:\s*\{\}\)/);
  });
});
