/**
 * P171 (2026-05-23): admin Test Mode Flash 분기 — 옵션 C.
 *
 * resolveGeminiModel('main', { isAdminBypass: true }) 가 env GEMINI_ADMIN_BYPASS_MODEL
 * 우선 적용. 일반 사용자 (isAdminBypass=false 또는 미지정) 영향 0 — backward-compat.
 *
 * 운영자 의도: TEST- prefix orderId 로 5-10 plan 생성 → Pro vs Flash 품질 직접 비교
 * → 옵션 B (PLANNER_FLASH_PCT bucketing) 또는 옵션 A (mode 별) 결정 근거 확보.
 *
 * 회귀 시: env GEMINI_ADMIN_BYPASS_MODEL 비우면 즉시 Pro 복귀 (안전망).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
// @ts-expect-error — JS module
import { resolveGeminiModel, _GEMINI_MODEL_DEFAULTS } from '../../api/_ai_core/geminiModelResolver.js';

describe('P171 resolveGeminiModel admin bypass', () => {
  const ORIGINAL_ENV = { ...process.env };

  beforeEach(() => {
    // env 초기화 (각 시나리오 독립)
    delete process.env.GEMINI_MODEL_OVERRIDE;
    delete process.env.GEMINI_MAIN_MODEL;
    delete process.env.GEMINI_ADMIN_BYPASS_MODEL;
  });

  afterEach(() => {
    // 원본 env 복원
    process.env = { ...ORIGINAL_ENV };
  });

  it('isAdminBypass=true + GEMINI_ADMIN_BYPASS_MODEL=gemini-3.5-flash → Flash 반환', () => {
    process.env.GEMINI_ADMIN_BYPASS_MODEL = 'gemini-3.5-flash';
    const model = resolveGeminiModel('main', { isAdminBypass: true });
    expect(model).toBe('gemini-3.5-flash');
  });

  it('isAdminBypass=true + env 미설정 → 기존 분기 (Pro default)', () => {
    const model = resolveGeminiModel('main', { isAdminBypass: true });
    expect(model).toBe(_GEMINI_MODEL_DEFAULTS.main); // 'gemini-2.5-pro'
  });

  it('isAdminBypass=false + env 설정 → 무시 (Pro default — 일반 사용자 영향 0)', () => {
    process.env.GEMINI_ADMIN_BYPASS_MODEL = 'gemini-3.5-flash';
    const model = resolveGeminiModel('main', { isAdminBypass: false });
    expect(model).toBe(_GEMINI_MODEL_DEFAULTS.main); // 'gemini-2.5-pro' — Flash 미적용
  });

  it('opts 미지정 (backward-compat) → 기존 동작 (Pro default)', () => {
    process.env.GEMINI_ADMIN_BYPASS_MODEL = 'gemini-3.5-flash';
    const model = resolveGeminiModel('main');
    expect(model).toBe(_GEMINI_MODEL_DEFAULTS.main); // 'gemini-2.5-pro' — opts 없으면 admin 분기 X
  });

  it('GEMINI_MODEL_OVERRIDE (전역 emergency) → admin bypass 보다 우선', () => {
    process.env.GEMINI_MODEL_OVERRIDE = 'gemini-2.5-pro';
    process.env.GEMINI_ADMIN_BYPASS_MODEL = 'gemini-3.5-flash';
    const model = resolveGeminiModel('main', { isAdminBypass: true });
    expect(model).toBe('gemini-2.5-pro'); // 전역 override 가 admin 보다 안전 우위
  });

  it('isAdminBypass=true + role=block (main 외) → admin bypass 적용 (모든 role)', () => {
    // P171 design: admin bypass 는 role 무관하게 적용 (운영자가 모든 호출을 Flash 로 비교 가능)
    process.env.GEMINI_ADMIN_BYPASS_MODEL = 'gemini-3.5-flash';
    const model = resolveGeminiModel('block', { isAdminBypass: true });
    expect(model).toBe('gemini-3.5-flash');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// buildModel 시그니처 backward-compat 검증
import { buildModel } from '../../api/_ai_core/geminiPipeline.js';

describe('P171 buildModel signature backward-compat', () => {
  it('buildModel(apiKey) — opts 미지정, 동작 정상 (backward-compat)', () => {
    const m = buildModel('fake-key');
    expect(m).toBeDefined();
  });

  it('buildModel(apiKey, 0.1) — temperatureOverride 만, 동작 정상', () => {
    const m = buildModel('fake-key', 0.1);
    expect(m).toBeDefined();
  });

  it('buildModel(apiKey, undefined, { isAdminBypass: true }) — P171 admin 분기 호출', () => {
    const m = buildModel('fake-key', undefined, { isAdminBypass: true });
    expect(m).toBeDefined();
  });

  it('buildModel(apiKey, 0.1, { isAdminBypass: true }) — retry + admin (combined)', () => {
    const m = buildModel('fake-key', 0.1, { isAdminBypass: true });
    expect(m).toBeDefined();
  });
});
