// 정제 퍼플·핑크 — 차터(전세차량) 페이지 회귀 방지. 시각만(견적 로직 무관), PDF 없음 → 세리프 OK.
// /charter 는 auth-gated 라 unauthed 시각검증 불가 — 패턴은 home/위저드에서 검증된 것 재사용. firebase-free.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const read = (rel: string) => readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), rel), 'utf8');
const CH = read('../../src/pages/CharterPage.tsx');
const CSS = read('../../src/index.css');

describe('차터 페이지 정제 플래그 (CharterPage)', () => {
  it('REFINED 플래그 + refined-charter 스코프 클래스', () => {
    expect(CH).toMatch(/const REFINED\s*=/);
    expect(CH).toMatch(/VITE_FEATURE_REFINED_UI\s*===\s*'true'/);
    expect(CH).toMatch(/REFINED\s*\?\s*'refined-charter'\s*:\s*''/);
  });

  it('cascade(index.css): 세리프 제목 + m-shimmer-text 소프트 + 글로우 제거', () => {
    expect(CSS).toMatch(/\.refined-charter h1, \.refined-charter h2\s*\{[^}]*Fraunces/);
    expect(CSS).toMatch(/\.refined-charter \.m-shimmer-text\s*\{[^}]*caa9ff/);
    expect(CSS).toMatch(/\.refined-charter[^{]*shadow-glow[^{]*\{[^}]*box-shadow:\s*none/);
  });
});
