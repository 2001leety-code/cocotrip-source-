// @vitest-environment jsdom

import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { OwnerControllerSetupPanel } from '../../src/components/OwnerControllerSetupPanel';

interface BeforeInstallPromptEvent {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

interface DeferredPromptWindow {
  __deferredInstallPrompt?: BeforeInstallPromptEvent | null;
}

function mockMatchMedia(matches = false) {
  vi.stubGlobal('matchMedia', vi.fn((query: string) => ({
    matches: query.includes('standalone') ? matches : false,
    media: query,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })));
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  sessionStorage.clear();
});

describe('OwnerControllerSetupPanel', () => {
  it('전역 프롬프트를 받아 설치하면 글로벌 포인터를 정리한다', async () => {
    mockMatchMedia(false);
    sessionStorage.setItem('pwa_launch_path', '/admin/ai-center');

    const deferred: BeforeInstallPromptEvent = {
      prompt: vi.fn().mockResolvedValue(undefined),
      userChoice: Promise.resolve({ outcome: 'accepted' }),
    };
    const windowState = window as unknown as DeferredPromptWindow;
    windowState.__deferredInstallPrompt = deferred;

    render(<OwnerControllerSetupPanel />);
    fireEvent.click(screen.getByTitle('CocoTrip Control 설치'));

    await waitFor(() => {
      expect(deferred.prompt).toHaveBeenCalledTimes(1);
      expect(windowState.__deferredInstallPrompt).toBeNull();
      expect(screen.getByText('Control 설치됨 · 최신 확인')).toBeInTheDocument();
      expect(screen.queryByText('오너 컨트롤러 설치')).not.toBeInTheDocument();
      expect(screen.queryByTitle('CocoTrip Control 설치')).not.toBeInTheDocument();
    });
  });

  it('오너 standalone에서는 상세 설치 설명과 설치 버튼 없이 한 줄 상태만 보인다', () => {
    mockMatchMedia(true);
    sessionStorage.setItem('pwa_launch_path', '/admin/ai-center');

    render(<OwnerControllerSetupPanel />);

    expect(screen.getByText('Control 설치됨 · 최신 확인')).toBeInTheDocument();
    expect(screen.queryByText('오너 컨트롤러 설치')).not.toBeInTheDocument();
    expect(screen.queryByText(/기기에서 바로 열리려면/)).not.toBeInTheDocument();
    expect(screen.queryByTitle('CocoTrip Control 설치')).not.toBeInTheDocument();
  });

  it('프롬프트가 없으면 수동 설치 안내를 보여준다', async () => {
    mockMatchMedia(false);
    sessionStorage.setItem('pwa_launch_path', '/admin/ai-center');

    render(<OwnerControllerSetupPanel />);
    fireEvent.click(screen.getByTitle('수동 설치 안내'));

    await waitFor(() => {
      expect(screen.getByText('브라우저 메뉴(⋮) > “홈 화면에 추가” 또는 “앱 설치”로 설치하세요.')).toBeInTheDocument();
    });
  });
});
