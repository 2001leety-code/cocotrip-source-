/**
 * PromoBanner + 기본 언어 영어 (운영자 2026-06-07) — source 회귀 가드.
 * 배너 4언어 + 닫기 / 언어 기본 영어(한국어 자동감지 제외, 일/중/영은 유지).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const bannerSrc = readFileSync(resolve(process.cwd(), 'src/components/PromoBanner.tsx'), 'utf8');
const langSrc = readFileSync(resolve(process.cwd(), 'src/hooks/useLanguage.ts'), 'utf8');

describe('PromoBanner — 다국어 + 닫기', () => {
  it('4언어 COPY (en/ko/ja/zh)', () => {
    expect(bannerSrc).toMatch(/\ben:/);
    expect(bannerSrc).toMatch(/\bko:/);
    expect(bannerSrc).toMatch(/\bja:/);
    expect(bannerSrc).toMatch(/\bzh:/);
  });
  it('닫기 = localStorage 유지', () => {
    expect(bannerSrc).toMatch(/localStorage\.setItem/);
    expect(bannerSrc).toMatch(/dismissed/);
  });
});

describe('useLanguage — 기본 언어 영어 (운영자 정책)', () => {
  it('한국어 브라우저 자동감지 제외 (startsWith ko 없음 → en 폴백)', () => {
    expect(langSrc).not.toMatch(/startsWith\('ko'\)/);
  });
  it('일/중/영 관광객 자동감지는 유지', () => {
    expect(langSrc).toMatch(/startsWith\('ja'\)/);
    expect(langSrc).toMatch(/startsWith\('zh'\)/);
    expect(langSrc).toMatch(/startsWith\('en'\)/);
  });
  it('폴백 = en', () => {
    expect(langSrc).toMatch(/return 'en';/);
  });
});
