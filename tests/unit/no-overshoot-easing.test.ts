// S6 (2026-06-01): overshoot/spring easing 금지 회귀 방지.
//
// DESIGN.md 모션 규칙 = overshoot/스프링 easing 금지 (일관된 리듬 + impeccable 'bounce-easing' slop 회피).
// cubic-bezier(x1, y1, x2, y2) 에서 y1(2번째) 가 1 초과면 목표를 지나쳤다 돌아오는 바운스가 됨.
// 실측(impeccable detect, 2026-06-01): cubic-bezier(0.34, 1.56, 0.64, 1) 5개소 → 표준 easing 으로 교체.
//
// 소스를 fs 로 읽어 패턴만 검사 (firebase-free, R_Phase1_testNoFirebaseClientImport 준수).
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../');
const FILES = [
  'src/index.css',
  'src/sections/MobileHome.tsx',
  'src/pages/ToursPage.tsx',
  'src/components/ChatWidget.tsx',
];

// cubic-bezier 의 y1(2번째 파라미터) > 1 = overshoot(스프링/바운스).
const OVERSHOOT = /cubic-bezier\(\s*[\d.]+\s*,\s*(?:1\.[1-9]\d*|[2-9])/;

describe('overshoot/spring easing 금지 (S6, DESIGN.md)', () => {
  for (const rel of FILES) {
    it(`${rel} 에 overshoot easing 없음`, () => {
      const src = readFileSync(path.join(ROOT, rel), 'utf8');
      expect(src).not.toMatch(OVERSHOOT);
    });
  }

  it('OVERSHOOT 패턴 자체가 바운스 값을 잡고 표준 값은 통과 (sanity)', () => {
    expect('cubic-bezier(0.34, 1.56, 0.64, 1)').toMatch(OVERSHOOT);
    expect('cubic-bezier(0.4, 0, 0.2, 1)').not.toMatch(OVERSHOOT);
  });
});
