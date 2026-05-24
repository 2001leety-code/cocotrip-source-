/**
 * P172 (2026-05-24): Flash PCT bucketing — 옵션 B.
 *
 * resolveGeminiModel('main', { identifierForBucketing, isAdminBypass })
 *   - PLANNER_FLASH_PCT (0-100) env 로 일반 사용자 일부 Flash A/B
 *   - plannerMode.bucketFor 재사용 (deterministic per-user)
 *   - env default 0 = 영향 0 (기존 동작 100% backward-compat)
 *   - admin (P171) > PCT (P172) > role > default 우선순위
 *
 * 운영자 의도: P171 옵션 C (admin Test 5-10 plan 직접 비교) 검증 후 → 본 P172 활성
 *   → 10% 사용자 prod A/B → 50% → 100% 단계적 rollout.
 *
 * 회귀 시: env GEMINI_ADMIN_BYPASS_MODEL / PLANNER_FLASH_PCT 비우면 즉시 Pro 100%.
 */
import { describe, it, expect } from 'vitest';
// @ts-expect-error — JS module
import { resolveGeminiModel, _GEMINI_MODEL_DEFAULTS } from '../../api/_ai_core/geminiModelResolver.js';
// @ts-expect-error — JS module
import { bucketFor } from '../../api/_ai_core/plannerMode.js';

describe('P172 Flash PCT bucketing — main role', () => {
  it('PLANNER_FLASH_PCT=0 (default) + identifier → Pro (skip)', () => {
    const model = resolveGeminiModel('main', {
      identifierForBucketing: 'user-001',
      _env: {},
    });
    expect(model).toBe(_GEMINI_MODEL_DEFAULTS.main); // Pro
  });

  it('PLANNER_FLASH_PCT=100 + identifier → Flash (모든 bucket)', () => {
    const model = resolveGeminiModel('main', {
      identifierForBucketing: 'user-001',
      _env: { PLANNER_FLASH_PCT: '100' },
    });
    expect(model).toBe('gemini-3.5-flash');
  });

  it('PCT=10 + identifier bucket<10 → Flash', () => {
    // 특정 identifier 의 bucket 을 계산 후 PCT 보다 작은 케이스 보장
    const id = 'a'; // bucket 계산: SHA-256 → first 8 hex → mod 100
    const bucket = bucketFor(id);
    if (bucket >= 10) {
      // 다른 id 로 bucket<10 찾기
      for (let i = 0; i < 200; i++) {
        const tryId = `low-${i}`;
        if (bucketFor(tryId) < 10) {
          const model = resolveGeminiModel('main', {
            identifierForBucketing: tryId,
            _env: { PLANNER_FLASH_PCT: '10' },
          });
          expect(model).toBe('gemini-3.5-flash');
          return;
        }
      }
      throw new Error('bucket<10 identifier 못 찾음');
    }
    const model = resolveGeminiModel('main', {
      identifierForBucketing: id,
      _env: { PLANNER_FLASH_PCT: '10' },
    });
    expect(model).toBe('gemini-3.5-flash');
  });

  it('PCT=10 + identifier bucket>=10 → Pro', () => {
    // bucket>=10 인 identifier 보장
    for (let i = 0; i < 200; i++) {
      const tryId = `high-${i}`;
      if (bucketFor(tryId) >= 10) {
        const model = resolveGeminiModel('main', {
          identifierForBucketing: tryId,
          _env: { PLANNER_FLASH_PCT: '10' },
        });
        expect(model).toBe(_GEMINI_MODEL_DEFAULTS.main); // Pro
        return;
      }
    }
    throw new Error('bucket>=10 identifier 못 찾음');
  });

  it('PCT=10 + identifier 미제공 → Pro (fallback 안전)', () => {
    const model = resolveGeminiModel('main', {
      _env: { PLANNER_FLASH_PCT: '10' },
    });
    expect(model).toBe(_GEMINI_MODEL_DEFAULTS.main);
  });

  it('동일 identifier → 동일 bucket (deterministic, 100회 반복)', () => {
    const id = 'user-deterministic';
    const expectedBucket = bucketFor(id);
    for (let i = 0; i < 100; i++) {
      expect(bucketFor(id)).toBe(expectedBucket);
    }
  });

  it('PCT 분포 균등 — 1000 random identifier + PCT=10 → 5~15% Flash bucket', () => {
    let flashCount = 0;
    for (let i = 0; i < 1000; i++) {
      const id = `dist-${i}-${Math.random().toString(36).slice(2)}`;
      if (bucketFor(id) < 10) flashCount++;
    }
    // uniform 기대: 약 100 ± 30 (10±3% range)
    expect(flashCount).toBeGreaterThan(50);
    expect(flashCount).toBeLessThan(150);
  });

  it('GEMINI_MODEL_OVERRIDE 전역 → PCT 무시 (안전 우위)', () => {
    const model = resolveGeminiModel('main', {
      identifierForBucketing: 'bucket-low',
      _env: {
        GEMINI_MODEL_OVERRIDE: 'gemini-2.5-pro',
        PLANNER_FLASH_PCT: '100',
      },
    });
    expect(model).toBe('gemini-2.5-pro'); // 전역 override 우선
  });

  it('isAdminBypass=true + PCT=100 → admin model 우선 (P171 > P172)', () => {
    const model = resolveGeminiModel('main', {
      isAdminBypass: true,
      identifierForBucketing: 'any-bucket',
      _env: {
        GEMINI_ADMIN_BYPASS_MODEL: 'gemini-3.5-flash',
        PLANNER_FLASH_PCT: '100',
      },
    });
    expect(model).toBe('gemini-3.5-flash'); // admin 분기 결과 (P171 우선)
  });

  it('GEMINI_FLASH_BUCKET_MODEL 커스텀 → 그 모델 반환', () => {
    // bucket<100 보장 (PCT=100)
    const model = resolveGeminiModel('main', {
      identifierForBucketing: 'any-user',
      _env: {
        PLANNER_FLASH_PCT: '100',
        GEMINI_FLASH_BUCKET_MODEL: 'gemini-2.5-flash',
      },
    });
    expect(model).toBe('gemini-2.5-flash');
  });

  it('role=block (main 외) + PCT=100 → bucketing skip (main 한정)', () => {
    // P172 design: PCT bucketing 은 role='main' 만 적용. block/classifier/translate 영향 0.
    const model = resolveGeminiModel('block', {
      identifierForBucketing: 'any-user',
      _env: { PLANNER_FLASH_PCT: '100' },
    });
    expect(model).toBe(_GEMINI_MODEL_DEFAULTS.block); // 'gemini-3.5-flash' (이미 Flash default)
  });

  it('opts 미지정 (backward-compat) + env default 0 → 기존 동작 (Pro)', () => {
    const model = resolveGeminiModel('main');
    expect(model).toBe(_GEMINI_MODEL_DEFAULTS.main);
  });
});
