// O5 (2026-06-01): design-audit.mjs 분류 로직 회귀 방지.
//
// impeccable findings → TRUE/BRAND/NOISE 분류가 2026-06-01 수동 트리아지와 일치하는지 검증.
// (메모리 project_cocotrip_design_deepsearch_2026_06_01: 200 findings → TRUE 7uniq / BRAND 89 / NOISE 99)
import { describe, it, expect } from 'vitest';
// @ts-ignore — .mjs 스크립트(타입 선언 없음), 순수 함수만 import.
import { categorize, isNoise, BRAND } from '../../scripts/design-audit.mjs';

const F = (antipattern: string, snippet: string) => ({ antipattern, snippet });

describe('design-audit categorize (O5)', () => {
  it('브랜드/방향 규칙은 BRAND 로 분류', () => {
    expect(BRAND.has('ai-color-palette')).toBe(true);
    expect(BRAND.has('dark-glow')).toBe(true);
    expect(BRAND.has('icon-tile-stack')).toBe(true);
  });

  it('둥근모서리 클리핑 + gradient/backdrop 흰-on-흰 = NOISE(FP)', () => {
    expect(isNoise(F('clipped-overflow-container', 'div.overflow-hidden clips a positioned child'))).toBe(true);
    expect(isNoise(F('low-contrast', '1.0:1 (need 4.5:1) — text #ffffff on #ffffff'))).toBe(true);
    expect(isNoise(F('low-contrast', 'pixel contrast 1.1:1 ... on backdrop filter "쿠키"'))).toBe(true);
  });

  it('flat 단색 contrast 실패 + overflow + bounce = TRUE (actionable, FP 아님)', () => {
    expect(isNoise(F('low-contrast', '2.7:1 (need 4.5:1) — text #ffffff on #ff6b9d'))).toBe(false);
    expect(isNoise(F('text-overflow', 'p.text-sm overflows its box by 126px'))).toBe(false);
    expect(isNoise(F('bounce-easing', 'cubic-bezier(0.34, 1.56, 0.64, 1)'))).toBe(false);
  });

  it('categorize: 대표 8건 → TRUE 3 / BRAND 3 / NOISE 2 정확 분리', () => {
    const findings = [
      F('ai-color-palette', 'Purple/violet neon text on dark background'),
      F('dark-glow', 'Colored glow (#7c5cfc) on dark background'),
      F('icon-tile-stack', '44x44px icon tile above h3'),
      F('clipped-overflow-container', 'div.overflow-hidden clips a positioned child'),
      F('low-contrast', '1.0:1 — text #ffffff on #ffffff'),
      F('low-contrast', '2.5:1 (need 3:1) — text #ffffff on #10b981'),
      F('text-overflow', 'h2 overflows its box by 32px'),
      F('bounce-easing', 'cubic-bezier(0.34, 1.56, 0.64, 1)'),
    ];
    const { TRUE, BRAND: brand, NOISE, trueUniq } = categorize(findings);
    expect(brand.length).toBe(3);
    expect(NOISE.length).toBe(2);
    expect(TRUE.length).toBe(3);
    expect(trueUniq.length).toBe(3);
  });
});
