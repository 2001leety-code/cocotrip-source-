/**
 * P165 (2026-05-23): ai-planner-full.js maxDuration 300 → 600 회귀 방지.
 *
 * 배경 (P138 telegram alert): prod plan 4분30초 = Vercel 5분 cap 의 90%. retry
 * 발동 시 5분 초과 → AbortError → 사용자 plan fail. 단축 효과 0 이지만 fail
 * 위험 차단 안전망. Vercel Fluid Compute (2025-04-23 default) 로 800s 까지 OK.
 *
 * 운영자 액션: Vercel Dashboard → Settings → Functions → Fluid Compute 활성화 토글.
 */
import { describe, it, expect } from 'vitest';
import { maxDuration } from '../../api/ai-planner-full.js';

describe('P165 ai-planner-full maxDuration cap', () => {
  it('maxDuration >= 600 (P165 — 300 회귀 차단, Vercel Pro 800s 까지 OK)', () => {
    expect(typeof maxDuration).toBe('number');
    expect(maxDuration).toBeGreaterThanOrEqual(600);
    expect(maxDuration).toBeLessThanOrEqual(800); // Vercel Pro Fluid Compute 한계
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Source-level assertion — export const maxDuration = N 형태 유지.
// `maxDuration: 300` 같은 object 키로 회귀 시 본 test fail.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const sourcePath = resolve(__dirname, '../../api/ai-planner-full.js');

describe('P165 ai-planner-full.js source — maxDuration export', () => {
  it('export const maxDuration = N 형태 + N >= 600', () => {
    const src = readFileSync(sourcePath, 'utf8');
    const m = src.match(/export\s+const\s+maxDuration\s*=\s*(\d+)/);
    expect(m).not.toBeNull();
    const v = parseInt(m![1], 10);
    expect(v).toBeGreaterThanOrEqual(600);
  });
});
