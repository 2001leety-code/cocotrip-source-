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
  it('아이콘 2종(코코트립·무드) + 무드 매니페스트', () => {
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

describe('매끄러운 브랜드 스플래시 복원 (2026-06-14 운영자 선택)', () => {
  // 운영자 선택: "매끄러운 브랜드 스플래시". OS 아이콘 스플래시와 배경색을 이어받아(깜빡임 0)
  // 워드마크(로고)+태그라인으로 전환 → "아이콘 2개" 회귀(#951/#953) 방지. standalone 전용.
  const html = readFileSync(r('index.html'), 'utf8');
  it('index.html 에 인라인 스플래시 오버레이(#app-splash) + __appReady 배선', () => {
    expect(html).toContain('id="app-splash"');
    expect(html).toContain('window.__appReady');
  });
  it('배경색 = manifest background_color 동일 (seamless): cocotrip #0a0b14 / mood #0a0412', () => {
    expect(html).toContain('background:#0a0b14');
    expect(html).toContain('#0a0412');
  });
  it('아이콘 중복 없이 이미지 인트로(코코트립/무드 콜라보) — "아이콘 2개" 회귀 방지', () => {
    // 2026-07-01 Codex: 텍스트 워드마크 → 이미지 기반 시작 인트로(intro-frame)로 개편.
    // CocoTrip 단독/MOOD 콜라보 이미지 2종이 standalone 기동 시 배경으로 깔림.
    expect(html).toContain('intro-frame');
    expect(html).toContain('/images/pwa-intro/cocotrip-intro.png');
    expect(html).toContain('/images/pwa-intro/mood-collab-intro.png');
    // 별도 아이콘(icon-192)을 splash 에서 또 그리지 않음
    expect(html).not.toMatch(/app-splash[\s\S]{0,400}icon-192\.png/);
  });
  it('standalone(설치 앱) 전용 — 일반 웹 탭에선 안 뜸', () => {
    expect(html).toContain("display-mode: standalone");
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

describe('PWA 업데이트 토스트 — 무드 포함 전역(운영자 요청)', () => {
  const app = readFileSync(r('src/App.tsx'), 'utf8');
  it('PWAUpdatePrompt 는 App 레벨에서 1회 렌더 (GlobalWidgets 밖 = /mood 에서도 노출)', () => {
    const occurrences = app.match(/<PWAUpdatePrompt\s*\/>/g) || [];
    expect(occurrences.length).toBe(1);
    // App 레벨(=GlobalWidgets 보다 먼저) 에 위치해야 /mood 에서도 뜸
    const promptIdx = app.indexOf('<PWAUpdatePrompt');
    const globalIdx = app.indexOf('<GlobalWidgets');
    expect(promptIdx).toBeGreaterThan(0);
    expect(promptIdx).toBeLessThan(globalIdx);
  });

  it('진입(콜드 스타트) 자동 업데이트 + 세션 중엔 토스트 (#pwa-prompt 보호 유지)', () => {
    const src = readFileSync(r('src/components/PWAUpdatePrompt.tsx'), 'utf8');
    expect(src).toContain('AUTO_UPDATE_WINDOW_MS');
    // 진입 창 안에서 자동 적용 (skipWaiting+reload)
    expect(src).toMatch(/updateServiceWorker\(true\)/);
    expect(src).toMatch(/loadedAtRef/);
    // 페이지당 1회 가드
    expect(src).toMatch(/autoUpdatedRef/);
  });

  it('PC/모바일 웹 탭(비-standalone)에선 알림·자동리로드 안 뜸 — 설치 앱에서만', () => {
    const src = readFileSync(r('src/components/PWAUpdatePrompt.tsx'), 'utf8');
    expect(src).toContain("display-mode: standalone");
    expect(src).toMatch(/standaloneRef/);
    // 비-standalone 이면 렌더 null + 자동업데이트 effect early-return
    expect(src).toMatch(/if\s*\(!standaloneRef\.current\)\s*return null/);
    expect(src).toMatch(/if\s*\(!standaloneRef\.current\)\s*return;/);
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
