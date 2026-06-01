// 정제 퍼플·핑크 — 공용 헤더 전역 스코프 회귀 방지.
// main.tsx 가 REFINED 시 <html>.refined 부여 → index.css 가 헤더 인라인 글로우 제거. firebase-free 소스 assertion.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const read = (rel: string) => readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), rel), 'utf8');
const MAIN = read('../../src/main.tsx');
const CSS = read('../../src/index.css');

describe('공용 헤더 정제 (전역 .refined)', () => {
  it('main.tsx: REFINED 시 <html> 에 refined 클래스', () => {
    expect(MAIN).toMatch(/VITE_FEATURE_REFINED_UI\s*===\s*'true'/);
    expect(MAIN).toMatch(/classList\.add\('refined'\)/);
  });

  it('index.css: 헤더 인라인 글로우 제거 (.refined header [style*="box-shadow"])', () => {
    expect(CSS).toMatch(/\.refined header \[style\*="box-shadow"\]\s*\{[^}]*box-shadow:\s*none/);
  });
});
