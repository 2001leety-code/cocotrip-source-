// @vitest-environment jsdom
/**
 * PwaInstallButton 앱 분리 판정 잠금 (2026-07-05).
 *
 * 같은 origin 에 PWA 2개(코코트립 '/'·MOOD '/mood') — "standalone = 무조건 숨김"이던
 * 기존 판정이 코코트립 앱 안에서 /mood 를 볼 때 MOOD 설치 버튼까지 숨기던 회귀 방지:
 *   1. 코코트립 앱 안(launch '/') + MOOD 버튼(appScope '/mood') → 버튼 노출 + 브라우저 안내
 *   2. MOOD 앱 실행(launch '/mood') + MOOD 버튼 → 숨김 (자기 앱)
 *   3. 코코트립 앱 실행 + 기본 버튼(Header) → 숨김 (기존 동작 보존)
 *   4. 브라우저 탭(비-standalone) → 버튼 노출 (기존 동작)
 */
import React from 'react';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@/hooks/usePushSubscription', () => ({
  usePushSubscription: () => ({ state: 'unsupported', busy: false, isEnabled: async () => false, enable: async () => false, disable: async () => false }),
}));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: null, loading: false }) }));

import { PwaInstallButton } from '../../src/components/PwaInstallButton';
import { getLocaleSync } from '../../src/i18n';

function mockStandalone(matches: boolean) {
  vi.stubGlobal('matchMedia', vi.fn((q: string) => ({
    matches: q.includes('standalone') ? matches : false,
    media: q, addListener: vi.fn(), removeListener: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn(), dispatchEvent: vi.fn(),
  })));
}

const t = getLocaleSync('en');
const HINT = '지금은 코코트립 앱 안이에요 — 크롬으로 여세요.';

beforeEach(() => sessionStorage.clear());
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('PwaInstallButton 앱 분리 판정', () => {
  it('코코트립 앱 안에서 MOOD 버튼 → 노출 + 클릭 시 브라우저 열기 안내', () => {
    mockStandalone(true);
    sessionStorage.setItem('pwa_launch_path', '/');
    render(<PwaInstallButton t={t} appScope="/mood" browserOpenHint={HINT} />);
    const btn = screen.getByTitle(/Add|Shortcut|홈/i);
    expect(btn).toBeTruthy();
    fireEvent.click(btn);
    expect(screen.getByText(HINT)).toBeTruthy();
    // 자동 설치 버튼(Add to Home Screen CTA)은 없어야 — standalone 안이라 프롬프트 불가
    expect(screen.queryByText(t.pwaInstall?.addBtn || 'Add to Home Screen')).toBeNull();
  });

  it('MOOD 앱으로 실행 중 + MOOD 버튼 → 숨김', () => {
    mockStandalone(true);
    sessionStorage.setItem('pwa_launch_path', '/mood');
    const { container } = render(<PwaInstallButton t={t} appScope="/mood" />);
    expect(container.querySelector('button')).toBeNull();
  });

  it('코코트립 앱으로 실행 중 + 기본 버튼(Header) → 숨김 (기존 동작 보존)', () => {
    mockStandalone(true);
    sessionStorage.setItem('pwa_launch_path', '/');
    const { container } = render(<PwaInstallButton t={t} />);
    expect(container.querySelector('button')).toBeNull();
  });

  it('브라우저 탭(비-standalone) → 버튼 노출 (기존 동작)', () => {
    mockStandalone(false);
    render(<PwaInstallButton t={t} appScope="/mood" />);
    expect(screen.getByTitle(/Add|Shortcut|홈/i)).toBeTruthy();
  });
});
