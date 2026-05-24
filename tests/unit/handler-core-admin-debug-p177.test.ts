/**
 * P177 (2026-05-24): handlerCore.js 의 _ok response 에 admin-bypass 한정 _debug
 * 정보 노출. measure script + 자율 검증이 model + plannerMode 자동 식별. 일반
 * 사용자 영향 0 — gate.isAdminBypass 조건부 (보안 — _debug 가 일반 user 응답에
 * 들어가면 정보 노출).
 *
 * 추출: debugInfo.js#buildAdminDebug (handlerCore.js cap 500 line 압박 — P170
 * 메타 lesson 의 "추가 모듈 추출" 권장).
 *
 * 회귀 시: _debug 가 admin 조건 없이 무조건 노출되면 일반 user 도 model 정보
 * 알게 됨 → security leak (model A/B test 정보 / Pro vs Flash 정착 시점 노출).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('P177 handlerCore.js + debugInfo.js admin-bypass debug', () => {
  const handlerCorePath = resolve(__dirname, '../../api/_ai_core/handlerCore.js');
  const debugInfoPath = resolve(__dirname, '../../api/_ai_core/debugInfo.js');
  const handlerSrc = readFileSync(handlerCorePath, 'utf8');
  const debugSrc = readFileSync(debugInfoPath, 'utf8');

  it('handlerCore.js — buildAdminDebug import 존재', () => {
    expect(handlerSrc).toMatch(/import\s+\{[^}]*\bbuildAdminDebug\b[^}]*\}\s+from\s+['"]\.\/debugInfo\.js['"]/);
  });

  it('handlerCore.js — buildAdminDebug 호출에 gate + abDecision + identifierForBucketing 전달', () => {
    expect(handlerSrc).toMatch(/buildAdminDebug\s*\(\s*\{[^}]*\bgate\b[^}]*\babDecision\b[^}]*\bidentifierForBucketing\b/);
  });

  it('handlerCore.js — _ok response 에 spread (debug 있을 때만 _debug 키 포함)', () => {
    expect(handlerSrc).toMatch(/\.\.\.\(debug\s*\?\s*\{\s*_debug:\s*debug\s*\}\s*:\s*\{\}\)/);
  });

  it('debugInfo.js — buildAdminDebug export + gate.isAdminBypass 조건부', () => {
    expect(debugSrc).toMatch(/export\s+function\s+buildAdminDebug/);
    // !gate.isAdminBypass 일 때 undefined 반환 — 일반 user 정보 노출 차단
    expect(debugSrc).toMatch(/if\s*\(\s*!gate[^)]*isAdminBypass\s*\)\s*return\s+undefined/);
  });

  it('debugInfo.js — modelMain via resolveGeminiModel + plannerMode + abReason 포함', () => {
    expect(debugSrc).toMatch(/import\s+\{[^}]*\bresolveGeminiModel\b[^}]*\}\s+from\s+['"]\.\/geminiModelResolver\.js['"]/);
    expect(debugSrc).toMatch(/modelMain:\s*resolveGeminiModel\s*\(\s*['"]main['"]/);
    expect(debugSrc).toMatch(/plannerMode/);
    expect(debugSrc).toMatch(/abReason:\s*abDecision/);
  });
});
