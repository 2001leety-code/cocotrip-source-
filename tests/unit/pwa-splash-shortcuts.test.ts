/**
 * PWA 바로가기 2종 + 2초 스플래시 — 자산 존재 + 배선/안전 소스가드 (2026-06-14).
 *
 * 코코트립 바로가기(스플래시 C+비행기, /) / 무드 바로가기(스플래시 C×M, /mood).
 * 설치 PWA(standalone) 실행 시 진입 경로별 2초 스플래시 → 페이지. 일반 웹 방문 땐 안 뜸.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

const r = (p: string) => resolve(process.cwd(), p);

describe('PWA 자산 존재', () => {
  it('스플래시 2종 + 무드 아이콘 + 무드 매니페스트', () => {
    for (const f of [
      'public/splash-cocotrip.png',
      'public/splash-mood.png',
      'public/icons/icon-192.png',
      'public/icons/icon-512.png',
      'public/icons/mood-192.png',
      'public/icons/mood-512.png',
      'public/manifest-mood.webmanifest',
    ]) {
      expect(existsSync(r(f)), `${f} 존재`).toBe(true);
      expect(statSync(r(f)).size, `${f} 비어있지 않음`).toBeGreaterThan(100);
    }
  });

  it('무드 매니페스트 = MOOD 아이콘 + start_url /mood', () => {
    const m = JSON.parse(readFileSync(r('public/manifest-mood.webmanifest'), 'utf8'));
    expect(m.start_url).toBe('/mood');
    expect(m.scope).toBe('/mood');
    expect(JSON.stringify(m.icons)).toContain('/icons/mood-512.png');
  });
});

describe('AppSplash — standalone·경로별·안전 (소스가드)', () => {
  const src = readFileSync(r('src/components/AppSplash.tsx'), 'utf8');
  it('설치 PWA(standalone)에서만 — display-mode standalone 체크', () => {
    expect(src).toContain("display-mode: standalone");
    expect(src).toMatch(/useState\(\(\)\s*=>\s*isStandalone\(\)\)/);
  });
  it('진입 경로 /mood → 무드 스플래시 / 그 외 → 코코트립', () => {
    expect(src).toMatch(/launchPath\.current\.startsWith\('\/mood'\)/);
    expect(src).toContain('/splash-mood.png');
    expect(src).toContain('/splash-cocotrip.png');
  });
  it('2초 후 제거 (2000ms) + 훅 early-return 위', () => {
    expect(src).toMatch(/setShow\(false\)[\s\S]{0,20}2000/);
    const ret = src.indexOf('if (!show) return null');
    const eff = src.indexOf('useEffect(');
    expect(eff).toBeGreaterThan(0);
    expect(eff).toBeLessThan(ret);
  });
});

describe('ManifestSwitcher — /mood 매니페스트 교체', () => {
  const src = readFileSync(r('src/components/ManifestSwitcher.tsx'), 'utf8');
  it('/mood 진입 시 manifest-mood 로 swap', () => {
    expect(src).toMatch(/startsWith\('\/mood'\)/);
    expect(src).toContain('/manifest-mood.webmanifest');
    expect(src).toContain('/icons/mood-192.png');
  });
});

describe('App — 스플래시·스위처 배선', () => {
  const app = readFileSync(r('src/App.tsx'), 'utf8');
  it('AppSplash + ManifestSwitcher 렌더', () => {
    expect(app).toMatch(/<AppSplash\s*\/>/);
    expect(app).toMatch(/<ManifestSwitcher\s*\/>/);
  });
});
