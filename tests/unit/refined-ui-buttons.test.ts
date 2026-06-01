// 정제 퍼플·핑크 — 버튼 마이크로 인터랙션 (2026 best practice) 회귀 방지.
// 절제(scale 0.98) · 빠름(0.15s) · transform/opacity GPU · 포커스 가시성 · 모바일 터치타겟 44px.
// 전부 .refined 스코프(OFF 무효). firebase-free 소스 assertion.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const CSS = readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src/index.css'), 'utf8');

describe('정제 버튼 마이크로 인터랙션', () => {
  it('transition = transform/opacity (all 아님) + 빠른 0.15s', () => {
    expect(CSS).toMatch(/\.refined \.m-btn[^{]*\{[^}]*transition:\s*transform \.15s/);
  });

  it('press = scale 0.98 (절제, 0.93 아님)', () => {
    expect(CSS).toMatch(/\.refined \.m-btn:active[^{]*\{[^}]*scale\(\.98\)/);
  });

  it('키보드 포커스 가시성 (보라 링, 접근성)', () => {
    expect(CSS).toMatch(/\.refined [^{]*:focus-visible\s*\{[^}]*box-shadow:[^}]*202, 169, 255/);
  });

  it('모바일 CTA 터치타겟 ≥44px (데스크탑 크기는 불변)', () => {
    expect(CSS).toMatch(/max-width:\s*767px[\s\S]{0,160}min-height:\s*44px/);
  });
});
