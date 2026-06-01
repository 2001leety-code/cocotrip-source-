// 정제 퍼플·핑크 — 투어 목록(ToursPage) 회귀 방지. 시각만, PDF 없음 → 세리프 OK. firebase-free.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const read = (rel: string) => readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), rel), 'utf8');
const TP = read('../../src/pages/ToursPage.tsx');
const CSS = read('../../src/index.css');

describe('투어 목록 정제 플래그 (ToursPage)', () => {
  it('REFINED 플래그 + refined-tours 스코프 클래스', () => {
    expect(TP).toMatch(/const REFINED\s*=/);
    expect(TP).toMatch(/VITE_FEATURE_REFINED_UI\s*===\s*'true'/);
    expect(TP).toMatch(/REFINED\s*\?\s*'refined-tours'\s*:\s*''/);
  });

  it('cascade(index.css): 세리프 제목 + tours-shimmer 소프트 + 글로우 제거', () => {
    expect(CSS).toMatch(/\.refined-tours h1, \.refined-tours h2\s*\{[^}]*Fraunces/);
    expect(CSS).toMatch(/\.refined-tours \.tours-shimmer\s*\{[^}]*caa9ff/);
    expect(CSS).toMatch(/\.refined-tours[^{]*shadow-glow[^{]*\{[^}]*box-shadow:\s*none/);
  });
});
