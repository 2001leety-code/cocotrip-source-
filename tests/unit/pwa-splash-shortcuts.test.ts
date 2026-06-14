/**
 * PWA 바로가기 2종 + 실행 스플래시 — 자산 + 인라인 스플래시(index.html) 배선/안전 소스가드.
 *
 * 코코트립 바로가기(아이콘 C+비행기, /) / 무드 바로가기(아이콘 C×M, /mood).
 * 설치 PWA(standalone) 실행 시 OS 스플래시와 동일한 아이콘+태그라인을 인라인으로 즉시 그려
 * 매끄럽게 이어받고, 앱 준비될 때까지 유지(검정 갭 방지) 후 페이드. 일반 웹 방문 땐 안 뜸.
 * (2026-06-14 회귀 수정: React AppSplash 늦은 마운트 → 인라인으로 교체.)
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

const r = (p: string) => resolve(process.cwd(), p);

describe('PWA 자산 존재', () => {
  it('아이콘 2종(코코트립·무드, 패딩본) + 무드 매니페스트', () => {
    for (const f of [
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

describe('index.html 인라인 스플래시 — standalone·경로별·검정갭 방지', () => {
  const html = readFileSync(r('index.html'), 'utf8');
  it('설치 PWA(standalone)에서만 — display-mode standalone 체크', () => {
    expect(html).toContain('#app-splash');
    expect(html).toContain("display-mode: standalone");
    expect(html).toMatch(/if\s*\(!standalone\)\s*return/); // 일반 웹 방문이면 미표시
  });
  it('진입 경로 /mood → 무드 아이콘 / 그 외 → 코코트립 + 태그라인', () => {
    expect(html).toMatch(/location\.pathname\.indexOf\('\/mood'\)\s*===\s*0/);
    expect(html).toContain('/icons/mood-192.png');
    expect(html).toContain('/icons/icon-192.png');
    expect(html).toContain('60 seconds');
  });
  it('앱 준비 신호까지 유지(검정 갭 방지) + 안전 캡', () => {
    expect(html).toContain('window.__appReady');
    expect(html).toMatch(/MIN\s*=\s*1400/);
    expect(html).toMatch(/setTimeout\(hide,\s*MAX\)/); // 신호 없어도 사라짐
  });
});

describe('App / 진입 페이지 — 스플래시 배선', () => {
  it('App 은 ManifestSwitcher 렌더 (AppSplash 컴포넌트는 제거됨)', () => {
    const app = readFileSync(r('src/App.tsx'), 'utf8');
    expect(app).toMatch(/<ManifestSwitcher\s*\/>/);
    expect(app).not.toContain('AppSplash');
  });
  it('signalAppReady 헬퍼 존재 + __appReady 호출', () => {
    const lib = readFileSync(r('src/lib/appReady.ts'), 'utf8');
    expect(lib).toContain('__appReady');
  });
  it('홈(MobileHomeV2) + 무드 포털이 signalAppReady 호출', () => {
    expect(readFileSync(r('src/pages/MobileHomeV2.tsx'), 'utf8')).toContain('signalAppReady');
    const mood = readFileSync(r('src/pages/MoodPortal.tsx'), 'utf8');
    expect(mood).toContain('signalAppReady');
    expect(mood).toMatch(/if\s*\(!loading\)\s*signalAppReady\(\)/);
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
