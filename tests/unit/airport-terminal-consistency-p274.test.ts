/**
 * P274 (2026-05-29): SAFETY-CRITICAL — arrival/departure airport terminal consistency 회귀 차단.
 *
 * 사용자 신고 prod plan 696b273d 등 4건 자가 모순 (input='ICN' → Gemini hallucinate 'ICN T1' +
 * ODsay 가 임의로 '인천공항2터미널' station 추천 → 사용자 비행기 놓침 risk).
 *
 * Fix 3-layer:
 *   1. RouteAgent._normalizeAirportKey: 'ICN' (generic) → 'ICN' 유지 (이전 T1 hardcode 제거)
 *   2. postResponsePipeline: arrival_guide.airport / departure_guide.airport mismatch 시 input 으로 override
 *   3. buildPrompt: TERMINAL CONSISTENCY rule (Gemini 가 input 그대로 echo)
 *
 * 회귀 시: 같은 자가 모순 (input terminal vs Gemini output terminal) 회귀 → SAFETY-CRITICAL.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { AIRPORT_COORDS } from '../../api/_ai_core/constants.js';

describe('P274 airport terminal consistency (input echo + mismatch auto-fix)', () => {
  const routeAgentPath = resolve(__dirname, '../../api/_ai_core/agents/RouteAgent.js');
  const postPipelinePath = resolve(__dirname, '../../api/_ai_core/postResponsePipeline.js');
  const buildPromptPath = resolve(__dirname, '../../api/_ai_core/buildPrompt.js');
  const routeAgentSrc = readFileSync(routeAgentPath, 'utf8');
  const postPipelineSrc = readFileSync(postPipelinePath, 'utf8');
  const buildPromptSrc = readFileSync(buildPromptPath, 'utf8');

  // ── Layer 1: RouteAgent _normalizeAirportKey ─────────────────────────────────

  it('RouteAgent._normalizeAirportKey — ICN (generic) → ICN (T1 hardcode 제거)', () => {
    // 이전: if (k.startsWith('ICN') || k === 'INCHEON') return 'ICN_T1';
    // 현재: if (k.startsWith('ICN') || k === 'INCHEON') return 'ICN';
    expect(routeAgentSrc).toMatch(/if\s*\(k\.startsWith\('ICN'\)\s*\|\|\s*k\s*===\s*'INCHEON'\)\s*return\s+'ICN'\s*;/);
    // 회귀 차단: T1 hardcode 코드 직접 검사
    expect(routeAgentSrc).not.toMatch(/if\s*\(k\.startsWith\('ICN'\)\s*\|\|\s*k\s*===\s*'INCHEON'\)\s*return\s+'ICN_T1'\s*;/);
  });

  it('RouteAgent._normalizeAirportKey — ICN_T1 / ICN_T2 명시 시 정확 매칭 유지', () => {
    expect(routeAgentSrc).toMatch(/if\s*\(k\.startsWith\('ICN_T1'\)[^)]*\)\s*return\s+'ICN_T1'\s*;/);
    expect(routeAgentSrc).toMatch(/if\s*\(k\.startsWith\('ICN_T2'\)[^)]*\)\s*return\s+'ICN_T2'\s*;/);
  });

  it('RouteAgent — P274 reference + SAFETY-CRITICAL 명시', () => {
    expect(routeAgentSrc).toMatch(/P274/);
    expect(routeAgentSrc).toMatch(/SAFETY-CRITICAL/);
    expect(routeAgentSrc).toMatch(/696b273d/);  // 사용자 신고 plan ID
  });

  // ── Layer 2: postResponsePipeline airport mismatch auto-fix ─────────────────

  it('postResponsePipeline — arrival_guide.airport mismatch 시 input override (P274)', () => {
    // arrival_guide override 패턴
    expect(postPipelineSrc).toMatch(/itinerary\.arrival_guide\.airport\s*=\s*arrival_airport/);
    // mismatch 검사 + 정규화 (trim + toUpperCase + whitespace→underscore)
    expect(postPipelineSrc).toMatch(/String\(arrival_airport\)\.trim\(\)\.toUpperCase\(\)\.replace\(\/\\s\+\/g,\s*'_'\)/);
    // quality_warnings 박제
    expect(postPipelineSrc).toMatch(/arrival_airport_overridden/);
  });

  it('postResponsePipeline — departure_guide.airport mismatch 시 input override (P274)', () => {
    expect(postPipelineSrc).toMatch(/itinerary\.departure_guide\.airport\s*=\s*departure_airport/);
    expect(postPipelineSrc).toMatch(/String\(departure_airport\)\.trim\(\)\.toUpperCase\(\)\.replace\(\/\\s\+\/g,\s*'_'\)/);
    expect(postPipelineSrc).toMatch(/departure_airport_overridden/);
  });

  it('postResponsePipeline — P274 reference + 운영자 신고 plan 696b273d 명시', () => {
    expect(postPipelineSrc).toMatch(/P274/);
    expect(postPipelineSrc).toMatch(/696b273d/);
    expect(postPipelineSrc).toMatch(/SAFETY-CRITICAL/);
  });

  // ── Layer 3: buildPrompt TERMINAL CONSISTENCY rule ───────────────────────────

  it('buildPrompt — P274 TERMINAL CONSISTENCY 섹션 존재', () => {
    expect(buildPromptSrc).toMatch(/P274.*TERMINAL CONSISTENCY/);
    expect(buildPromptSrc).toMatch(/arrival.*airport.*input.*정확.*echo/);
  });

  it('buildPrompt — BAD/GOOD 예시 + hallucinate 차단 명시', () => {
    // P274 섹션 내 핵심 substring 존재
    expect(buildPromptSrc).toContain('P274');
    expect(buildPromptSrc).toContain('TERMINAL CONSISTENCY');
    expect(buildPromptSrc).toContain("'ICN T2'");
    expect(buildPromptSrc).toContain("'ICN T1'");
    expect(buildPromptSrc).toContain('hallucinate');
    expect(buildPromptSrc).toContain('BAD');
    expect(buildPromptSrc).toContain('GOOD');
    // 사용자 신고 plan 696b273d 명시
    expect(buildPromptSrc).toContain('696b273d');
  });

  it('buildPrompt — Day N 마지막 stop name terminal 일치 규칙 명시', () => {
    expect(buildPromptSrc).toContain('인천국제공항 T1');
    expect(buildPromptSrc).toContain('인천국제공항 T2');
    // input 'ICN' (generic) → terminal 표기 X
    expect(buildPromptSrc).toContain('terminal 표기');
  });

  // ── Layer 0: AIRPORT_COORDS sanity ──────────────────────────────────────────

  it('constants AIRPORT_COORDS — ICN (generic) entry 존재 (T1 hardcode default 회피)', () => {
    expect(AIRPORT_COORDS['ICN_T1']).toBeDefined();
    expect(AIRPORT_COORDS['ICN_T2']).toBeDefined();
    expect(AIRPORT_COORDS['ICN']).toBeDefined();
    // ICN generic 좌표 = T1 좌표 또는 중간 (둘 다 valid)
    expect(typeof AIRPORT_COORDS['ICN'].lat).toBe('number');
    expect(typeof AIRPORT_COORDS['ICN'].lng).toBe('number');
  });

  it('constants AIRPORT_COORDS — T1 vs T2 좌표 다름 (terminal 구분)', () => {
    expect(AIRPORT_COORDS['ICN_T1'].lat).not.toBe(AIRPORT_COORDS['ICN_T2'].lat);
    expect(AIRPORT_COORDS['ICN_T1'].lng).not.toBe(AIRPORT_COORDS['ICN_T2'].lng);
  });
});
