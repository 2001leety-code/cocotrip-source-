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
  it('이미지 인트로(코코트립/무드 콜라보) — webp 우선 + png 폴백', () => {
    // 2026-07-01 Codex: 텍스트 워드마크 → 이미지 기반 시작 인트로(intro-frame)로 개편.
    // 2026-07-03: base 경로 + .webp 우선(21~23KB 즉시 페인트), 미지원 브라우저만 .png 폴백.
    expect(html).toContain('intro-frame');
    expect(html).toContain('/images/pwa-intro/cocotrip-intro');
    expect(html).toContain('/images/pwa-intro/mood-collab-intro');
    expect(html).toContain(".webp");
    expect(html).toContain(".png"); // 폴백 유지
  });

  it('첫 비트 = manifest 아이콘 (OS 네이티브 스플래시→인트로 연속감, 이중 부팅감 제거)', () => {
    // 2026-07-03 smoothness handoff: 네이티브 스플래시(가운데 아이콘)와 동일한 아이콘 비트로
    // 시작해 인트로 이미지로 크로스페이드 — "로고 떴다가 다시 켜지는" 느낌 제거.
    // (#951/#953 "아이콘 2개"와 다름: 그건 아이콘이 두 '장면'으로 따로 뜬 문제,
    //  이건 같은 아이콘이 같은 자리에서 이어지는 연속 장면.)
    expect(html).toContain('intro-icon');
    expect(html).toContain('/icons/icon-512.png');
    expect(html).toContain('/icons/mood-512.png');
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
    // 2026-07-03: loading 가드 + 더블 rAF(페인트 후 신호) 패턴으로 변경 — smoothness handoff.
    expect(mood).toMatch(/if\s*\(loading\)\s*return/);
    expect(mood).toMatch(/requestAnimationFrame\([\s\S]{0,120}signalAppReady\(\)/);
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

  it('웹 탭(비-standalone): 알림 UI 없음 + 콜드스타트 조용한 갱신은 허용', () => {
    // 2026-07-03 정책 변경: prompt 모드에선 탭 사용자가 새로고침해도 옛 SW가 옛 번들을
    // 계속 서빙해 배포 후 영원히 stale(운영자 /admin "불러오는 중" 멈춤 재현) →
    // 콜드스타트 조용한 자동 갱신을 탭에도 확장. 토스트 UI는 여전히 설치앱 전용(6/14 결정 유지).
    const src = readFileSync(r('src/components/PWAUpdatePrompt.tsx'), 'utf8');
    expect(src).toContain("display-mode: standalone");
    expect(src).toMatch(/standaloneRef/);
    // 탭에선 토스트 렌더 안 함 (UI는 설치앱 전용)
    expect(src).toMatch(/if\s*\(!standaloneRef\.current\)\s*return null/);
    // 자동 갱신 effect에는 standalone early-return이 없어야 함 (탭도 콜드스타트 갱신)
    expect(src).not.toMatch(/if\s*\(!standaloneRef\.current\)\s*return;/);
    // 대신 안전 가드는 유지 — 상호작용/입력/결제 중이면 스킵
    expect(src).toMatch(/userInteractedRef\.current\s*\|\|\s*hasFocusedEditable\(\)\s*\|\|\s*isPaymentLikelyInProgress\(\)/);
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
