// 정제 퍼플·핑크 — 플랜 결과 페이지(PlanDetailPage) 회귀 방지.
// 시각만(글로우 제거 + 소프트 액센트). PDF/로직 무관 — pdfGenerator 는 document.body 에 별도 DOM(자체 Noto 폰트).
// PDF 한글 폰트 안전 위해 세리프는 의도적으로 생략. firebase-free 소스 assertion.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const read = (rel: string) => readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), rel), 'utf8');
const PD = read('../../src/pages/PlanDetailPage/index.tsx');
const CSS = read('../../src/index.css');

describe('플랜 결과 정제 플래그 (PlanDetailPage)', () => {
  it('REFINED 플래그 + refined-plandetail 스코프 클래스', () => {
    expect(PD).toMatch(/const REFINED\s*=/);
    expect(PD).toMatch(/VITE_FEATURE_REFINED_UI\s*===\s*'true'/);
    expect(PD).toMatch(/REFINED\s*\?\s*'refined-plandetail'\s*:\s*''/);
  });

  it('cascade(index.css): 글로우 제거 + 소프트 액센트', () => {
    expect(CSS).toMatch(/\.refined-plandetail[^{]*shadow-glow[^{]*\{[^}]*box-shadow:\s*none/);
    expect(CSS).toMatch(/\.refined-plandetail \.m-shimmer[^{]*\{[^}]*caa9ff/);
  });

  it('PDF 안전: 플랜 결과엔 세리프 cascade 없음 (한글 PDF 폰트 위험 회피)', () => {
    expect(CSS).not.toMatch(/\.refined-plandetail h1[^}]*Fraunces/);
  });
});
