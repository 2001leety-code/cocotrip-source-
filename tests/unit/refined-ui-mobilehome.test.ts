// 정제 퍼플·핑크 디자인 step1 (2026-06-01) — MobileHome hero 회귀 방지.
//
// REFINED 플래그 OFF(prod 기본) = 현재와 byte-identical, ON = 세리프 헤드라인 + 소프트 그라데 + 글로우 제거.
// MobileHome 은 firebase(db) import → 렌더 테스트 시 CI getAuth/getFirestore throw → 소스 텍스트 assertion
// (firebase-free, R_Phase1_testNoFirebaseClientImport 준수).
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const SRC = readFileSync(
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src/sections/MobileHome.tsx'),
  'utf8',
);

describe('MobileHome 정제 디자인 플래그 (step1)', () => {
  it('REFINED 플래그 = env VITE_FEATURE_REFINED_UI || ?refined 쿼리', () => {
    expect(SRC).toMatch(/const REFINED\s*=/);
    expect(SRC).toMatch(/VITE_FEATURE_REFINED_UI\s*===\s*'true'/);
    expect(SRC).toMatch(/URLSearchParams\([^)]*\)\.has\('refined'\)/);
  });

  it('정제 클래스(serif/accent/cta)는 REFINED 분기로만 적용', () => {
    expect(SRC).toMatch(/REFINED\s*\?\s*'m-hero-serif'\s*:\s*'font-black'/);
    expect(SRC).toMatch(/REFINED\s*\?\s*'m-accent-soft'\s*:\s*'m-shimmer'/);
    expect(SRC).toMatch(/REFINED\s*\?\s*'m-cta-refined'\s*:\s*'text-white shadow-lg'/);
  });

  it('OFF 경로 = 기존 마크업 보존 (기존 보라핑크 그라데 + 글로우)', () => {
    expect(SRC).toMatch(/linear-gradient\(135deg, #B668FC 0%, #FF6B9D 100%\)/);
    expect(SRC).toMatch(/boxShadow:\s*'0 10px 32px rgba\(182,104,252,0\.35\)'/);
  });

  it('정제 CTA = 글로우 제거 + 다크 텍스트', () => {
    expect(SRC).toMatch(/\.m-cta-refined\s*\{[^}]*box-shadow:\s*none/);
    expect(SRC).toMatch(/\.m-cta-refined\s*\{[^}]*color:\s*#1a0f1e/);
  });
});
