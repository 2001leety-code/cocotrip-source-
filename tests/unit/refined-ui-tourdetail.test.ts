// 정제 퍼플·핑크 — 투어 상세(TourDetailPage) + 공통 .refined-page 스코프 회귀 방지. firebase-free.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const read = (rel: string) => readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), rel), 'utf8');
const TD = read('../../src/pages/TourDetailPage.tsx');
const CSS = read('../../src/index.css');

describe('투어 상세 + 공통 페이지 정제 (.refined-page)', () => {
  it('TourDetailPage: REFINED 플래그 + refined-page 스코프', () => {
    expect(TD).toMatch(/const REFINED\s*=/);
    expect(TD).toMatch(/VITE_FEATURE_REFINED_UI\s*===\s*'true'/);
    expect(TD).toMatch(/REFINED\s*\?\s*'refined-page'\s*:\s*''/);
  });

  it('공통 .refined-page cascade: 세리프 + 다중 shimmer 소프트 + 글로우 제거', () => {
    expect(CSS).toMatch(/\.refined-page h1, \.refined-page h2\s*\{[^}]*Fraunces/);
    expect(CSS).toMatch(/\.refined-page \.m-shimmer-text, \.refined-page \.tours-shimmer[^{]*\{[^}]*caa9ff/);
    expect(CSS).toMatch(/\.refined-page[^{]*shadow-glow[^{]*\{[^}]*box-shadow:\s*none/);
  });
});
