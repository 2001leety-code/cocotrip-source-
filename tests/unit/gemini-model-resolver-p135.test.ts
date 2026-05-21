/**
 * P135 (2026-05-21): Gemini 2.5 → 3.5 Flash 마이그 helper unit test.
 * resolveGeminiModel(role) 의 3-tier 우선순위 검증:
 *   1. GEMINI_MODEL_OVERRIDE (일괄)
 *   2. GEMINI_{ROLE}_MODEL (모듈별)
 *   3. DEFAULTS (3.5 series)
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';

// dynamic import — ENV 변경 후 모듈 fresh evaluation 위해.
async function freshResolver() {
  // ESM cache bust — module spec 에 `?` 쿼리 붙임 (Node ESM 캐시 회피)
  // 단, ESM 환경에서 query param 캐시 무효화는 보장 안 됨 — fallback 으로
  // 각 test 가 ENV cleanup 후 동일 instance 호출.
  const mod = await import('../../api/_ai_core/geminiModelResolver.js' as string);
  return mod;
}

describe('P135 resolveGeminiModel', () => {
  const ENV_KEYS = [
    'GEMINI_MODEL_OVERRIDE',
    'GEMINI_MAIN_MODEL',
    'GEMINI_BLOCK_MODEL',
    'GEMINI_CLASSIFIER_MODEL',
    'GEMINI_TRANSLATE_MODEL',
  ];

  beforeEach(() => {
    for (const k of ENV_KEYS) delete process.env[k];
  });

  afterEach(() => {
    for (const k of ENV_KEYS) delete process.env[k];
  });

  it('default — main role 은 2.5 Pro 유지 (Flash 다운그레이드 시 schema/B-MEAL 회귀 위험)', async () => {
    const { resolveGeminiModel, _GEMINI_MODEL_DEFAULTS } = await freshResolver();
    expect(resolveGeminiModel('main')).toBe(_GEMINI_MODEL_DEFAULTS.main);
    expect(_GEMINI_MODEL_DEFAULTS.main).toBe('gemini-2.5-pro');
  });

  it('default — block role 은 3.5 Flash', async () => {
    const { resolveGeminiModel } = await freshResolver();
    expect(resolveGeminiModel('block')).toBe('gemini-3.5-flash');
  });

  it('default — classifier role 은 3.5 Flash Lite 유지', async () => {
    const { resolveGeminiModel } = await freshResolver();
    expect(resolveGeminiModel('classifier')).toBe('gemini-3.5-flash-lite');
  });

  it('default — translate role 은 3.5 Flash (2.0 → 3.5 업그레이드)', async () => {
    const { resolveGeminiModel } = await freshResolver();
    expect(resolveGeminiModel('translate')).toBe('gemini-3.5-flash');
  });

  it('GEMINI_MODEL_OVERRIDE — 모든 role 일괄 override (운영자 emergency rollback)', async () => {
    process.env.GEMINI_MODEL_OVERRIDE = 'gemini-2.5-pro';
    const { resolveGeminiModel } = await freshResolver();
    expect(resolveGeminiModel('main')).toBe('gemini-2.5-pro');
    expect(resolveGeminiModel('block')).toBe('gemini-2.5-pro');
    expect(resolveGeminiModel('classifier')).toBe('gemini-2.5-pro');
    expect(resolveGeminiModel('translate')).toBe('gemini-2.5-pro');
  });

  it('GEMINI_{ROLE}_MODEL — 모듈별 미세 control', async () => {
    process.env.GEMINI_MAIN_MODEL = 'gemini-3.5-pro';
    process.env.GEMINI_BLOCK_MODEL = 'gemini-2.5-flash';
    const { resolveGeminiModel } = await freshResolver();
    expect(resolveGeminiModel('main')).toBe('gemini-3.5-pro');
    expect(resolveGeminiModel('block')).toBe('gemini-2.5-flash');
    // 미설정 role 은 default
    expect(resolveGeminiModel('classifier')).toBe('gemini-3.5-flash-lite');
  });

  it('GEMINI_MODEL_OVERRIDE 가 GEMINI_{ROLE}_MODEL 보다 우선 (emergency 최우선)', async () => {
    process.env.GEMINI_MODEL_OVERRIDE = 'gemini-2.5-pro';
    process.env.GEMINI_MAIN_MODEL = 'gemini-3.5-flash';
    const { resolveGeminiModel } = await freshResolver();
    expect(resolveGeminiModel('main')).toBe('gemini-2.5-pro');
  });

  it('ENV value 의 보이지 않는 \\n 자동 trim (CLAUDE.md I 룰)', async () => {
    process.env.GEMINI_MODEL_OVERRIDE = '  gemini-2.5-pro\n';
    const { resolveGeminiModel } = await freshResolver();
    expect(resolveGeminiModel('main')).toBe('gemini-2.5-pro');
  });

  it('ENV value 가 빈 문자열 또는 whitespace 만이면 무시 (default 사용)', async () => {
    process.env.GEMINI_MODEL_OVERRIDE = '   ';
    process.env.GEMINI_MAIN_MODEL = '\n\t';
    const { resolveGeminiModel } = await freshResolver();
    expect(resolveGeminiModel('main')).toBe('gemini-2.5-pro');
  });

  it('invalid role 은 TypeError throw', async () => {
    const { resolveGeminiModel } = await freshResolver();
    expect(() => resolveGeminiModel('unknown' as never)).toThrow(TypeError);
    expect(() => resolveGeminiModel('' as never)).toThrow(TypeError);
  });
});
