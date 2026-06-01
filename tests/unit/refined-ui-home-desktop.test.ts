// 정제 퍼플·핑크 — 데스크탑 홈(App.tsx HomePage) 회귀 방지.
// REFINED OFF = 현재 그대로, ON = .refined-home cascade(세리프 제목 + 글로우 제거 + 소프트 그라데 텍스트).
// App.tsx 는 firebase 의존 다수 import → 소스 텍스트 assertion (firebase-free).
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const SRC = readFileSync(
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src/App.tsx'),
  'utf8',
);

describe('데스크탑 홈 정제 플래그 (App.tsx)', () => {
  it('REFINED 플래그(env/?refined) + refined-home 스코프 클래스', () => {
    expect(SRC).toMatch(/const REFINED\s*=/);
    expect(SRC).toMatch(/VITE_FEATURE_REFINED_UI\s*===\s*'true'/);
    expect(SRC).toMatch(/REFINED\s*\?\s*'refined-home'\s*:\s*''/);
  });

  it('cascade(index.css): 세리프 제목 + 글로우 제거 + 소프트 그라데 텍스트', () => {
    const CSS = readFileSync(
      path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src/index.css'),
      'utf8',
    );
    expect(CSS).toMatch(/\.refined-home h1, \.refined-home h2\s*\{[^}]*Fraunces/);
    expect(CSS).toMatch(/\.refined-home[^{]*shadow-glow[^{]*\{[^}]*box-shadow:\s*none/);
    expect(CSS).toMatch(/\.refined-home \.bg-clip-text\.text-transparent\s*\{[^}]*caa9ff/);
  });
});
