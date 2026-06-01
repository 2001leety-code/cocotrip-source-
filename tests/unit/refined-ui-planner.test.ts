// 정제 퍼플·핑크 — 위저드(PlannerPage) 회귀 방지.
// 시각만(스코프 클래스 + index.css cascade) — 위저드 로직/state/payload 무관. firebase-free 소스 assertion.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const read = (rel: string) => readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), rel), 'utf8');
const PP = read('../../src/pages/PlannerPage/index.tsx');
const CSS = read('../../src/index.css');

describe('위저드 정제 플래그 (PlannerPage)', () => {
  it('REFINED 플래그 + refined-planner 스코프 클래스 (위저드 로직 무관)', () => {
    expect(PP).toMatch(/const REFINED\s*=/);
    expect(PP).toMatch(/VITE_FEATURE_REFINED_UI\s*===\s*'true'/);
    expect(PP).toMatch(/REFINED\s*\?\s*'refined-planner'\s*:\s*''/);
  });

  it('cascade(index.css): 세리프 제목 + m-shimmer-text 소프트 + 글로우 제거', () => {
    expect(CSS).toMatch(/\.refined-planner h1, \.refined-planner h2\s*\{[^}]*Fraunces/);
    expect(CSS).toMatch(/\.refined-planner \.m-shimmer-text\s*\{[^}]*caa9ff/);
    expect(CSS).toMatch(/\.refined-planner[^{]*shadow-glow[^{]*\{[^}]*box-shadow:\s*none/);
  });
});
