/**
 * P194 regression: buildPrompt.js 압축 -30% (input token 비용 절감 + latency 단축)
 *
 * 5/25 sweep 발견: buildSystemPrompt() 결과 45,410 chars (~15K tokens) → 28K 이하 목표.
 * 이 테스트는 다음 6가지를 보장한다:
 *
 *   1. buildSystemPrompt() 결과 길이 ≤ 44,000 chars (현재 45K 대비 -3%+ — 회귀 차단)
 *   2. SAFETY-CRITICAL 키워드 보존: food_allergies / VERIFIED ATTRACTIONS DATABASE /
 *      Trekking / Hallasan / LODGING BOOKEND / B-13 모두 존재
 *   3. MULTI-CITY HANDLING 섹션 존재 (다도시 plan 작동 보장)
 *   4. MEAL PLANNING 섹션 존재 + B-MEAL 3-tier 규칙
 *   5. STYLE-DRIVEN PLANNING 섹션 존재
 *   6. JSON output format 예시 ≥ 1 (Gemini 학습용 — days 배열 포함)
 */

import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect, beforeAll } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../../');

describe('P194: buildSystemPrompt 압축 — SAFETY 보존 + 크기 제한', () => {
  let prompt: string;

  // 공유 setup: 한 번만 buildSystemPrompt 호출
  beforeAll(async () => {
    const { buildSystemPrompt } = await import(
      resolve(ROOT, 'api/_ai_core/buildPrompt.js')
    );
    prompt = buildSystemPrompt('en');
  });

  // ─── 1. 크기 제한 ────────────────────────────────────────────────────────
  it('P194-1: buildSystemPrompt() 결과 ≤ 44,000 chars (회귀 차단)', () => {
    expect(prompt.length).toBeLessThanOrEqual(44000);
    console.log('[P194] prompt length:', prompt.length, 'chars,', Math.ceil(prompt.length / 3), 'est tokens');
  });

  // ─── 2. SAFETY-CRITICAL 키워드 보존 ─────────────────────────────────────
  it('P194-2: food_allergies 섹션 보존 (식이제한 SAFETY)', () => {
    expect(prompt).toContain('food_allergies');
  });

  it('P194-2: VERIFIED ATTRACTIONS DATABASE 보존 (P190 attraction 주입)', () => {
    expect(prompt).toContain('VERIFIED ATTRACTIONS DATABASE');
  });

  it('P194-2: Trekking 보존 (P191 산악 SAFETY)', () => {
    expect(prompt).toContain('Trekking');
  });

  it('P194-2: Hallasan 보존 (P191 한라산 SAFETY)', () => {
    expect(prompt).toContain('Hallasan');
  });

  it('P194-2: LODGING BOOKEND 보존 (핵심 동선 anchor 규칙)', () => {
    expect(prompt).toContain('LODGING BOOKEND');
  });

  it('P194-2: B-13 보존 (다도시 lodging city 매칭 validator)', () => {
    expect(prompt).toContain('B-13');
  });

  // ─── 3. MULTI-CITY HANDLING ─────────────────────────────────────────────
  it('P194-3: MULTI-CITY HANDLING 섹션 존재 (다도시 plan 작동)', () => {
    expect(prompt).toContain('MULTI-CITY HANDLING');
  });

  // ─── 4. MEAL PLANNING + B-MEAL ──────────────────────────────────────────
  it('P194-4: MEAL PLANNING 섹션 존재', () => {
    expect(prompt).toContain('MEAL PLANNING');
  });

  it('P194-4: B-MEAL validator 기준 존재 (departure day 3-tier)', () => {
    expect(prompt).toContain('B-MEAL');
  });

  // ─── 5. STYLE-DRIVEN PLANNING ───────────────────────────────────────────
  it('P194-5: STYLE-DRIVEN PLANNING 섹션 존재', () => {
    expect(prompt).toContain('STYLE-DRIVEN PLANNING');
  });

  // ─── 6. JSON output format 예시 ─────────────────────────────────────────
  it('P194-6: JSON output format 예시 ≥1 (days 배열 포함)', () => {
    // "days" 배열 예시가 prompt 내에 있는지 확인
    expect(prompt).toContain('"days"');
  });
});
