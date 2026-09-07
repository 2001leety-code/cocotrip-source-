// @vitest-environment jsdom

import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { OwnerControllerSetupPanel } from '../../src/components/OwnerControllerSetupPanel';
import { ownerControllerSetupCopy } from '../../src/components/ownerControllerSetupCopy';
import type { Language } from '@/i18n';

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
  (window as unknown as DeferredPromptWindow).__deferredInstallPrompt = null;
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
      expect(screen.getByText(ownerControllerSetupCopy.ko.installAccepted)).toBeInTheDocument();
      expect(screen.queryByText('Control 설치됨')).not.toBeInTheDocument();
      expect(screen.queryByText('오너 컨트롤러 설치')).not.toBeInTheDocument();
      expect(screen.queryByTitle('CocoTrip Control 설치')).not.toBeInTheDocument();
    });
  });

  it('오너 standalone에서는 상세 설치 설명과 설치 버튼 없이 한 줄 상태만 보인다', () => {
    mockMatchMedia(true);
    sessionStorage.setItem('pwa_launch_path', '/admin/ai-center');

    render(<OwnerControllerSetupPanel />);

    expect(screen.getByText(ownerControllerSetupCopy.ko.installed)).toBeInTheDocument();
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

  it.each([false, true])('설치 상태=%s에서도 알림 설정 영역을 숨기지 않는다', (standalone) => {
    mockMatchMedia(standalone);
    sessionStorage.setItem('pwa_launch_path', '/admin/ai-center');
    render(<OwnerControllerSetupPanel><button type="button">기기 알림 설정</button></OwnerControllerSetupPanel>);
    expect(screen.getByRole('button', { name: '기기 알림 설정' })).toBeInTheDocument();
    expect(screen.queryByText(/최신 확인/)).not.toBeInTheDocument();
  });

  it('설치 확인 중 연속 클릭은 한 번만 요청하고 새로고침도 잠근다', async () => {
    mockMatchMedia(false);
    let resolveChoice: (choice: { outcome: 'accepted' | 'dismissed' }) => void = () => {};
    const deferred = {
      prompt: vi.fn().mockResolvedValue(undefined),
      userChoice: new Promise<{ outcome: 'accepted' | 'dismissed' }>((resolve) => { resolveChoice = resolve; }),
    };
    (window as unknown as DeferredPromptWindow).__deferredInstallPrompt = deferred;
    render(<OwnerControllerSetupPanel />);
    const install = screen.getByRole('button', { name: ownerControllerSetupCopy.ko.install });
    fireEvent.click(install);
    fireEvent.click(install);
    expect(deferred.prompt).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: ownerControllerSetupCopy.ko.installing })).toBeDisabled();
    expect(screen.getByRole('button', { name: ownerControllerSetupCopy.ko.manualRefresh })).toBeDisabled();
    expect((window as unknown as DeferredPromptWindow).__deferredInstallPrompt).toBeNull();
    await act(async () => { resolveChoice({ outcome: 'accepted' }); });
    expect(screen.getByText(ownerControllerSetupCopy.ko.installAccepted)).toBeInTheDocument();
  });

  it('설치 취소 뒤 수동 설치 안내를 바로 보여주고 완료를 주장하지 않는다', async () => {
    mockMatchMedia(false);
    (window as unknown as DeferredPromptWindow).__deferredInstallPrompt = {
      prompt: vi.fn().mockResolvedValue(undefined), userChoice: Promise.resolve({ outcome: 'dismissed' }),
    };
    render(<OwnerControllerSetupPanel />);
    fireEvent.click(screen.getByRole('button', { name: ownerControllerSetupCopy.ko.install }));
    await screen.findByText(ownerControllerSetupCopy.ko.declined);
    expect(screen.getByText(ownerControllerSetupCopy.ko.browserManual)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: ownerControllerSetupCopy.ko.showGuide })).toBeEnabled();
    expect(screen.queryByText(ownerControllerSetupCopy.ko.installAccepted)).not.toBeInTheDocument();
    expect(screen.queryByText(ownerControllerSetupCopy.ko.installed)).not.toBeInTheDocument();
  });

  it('브라우저 설치 호출이 실패하면 오류 내용을 노출하지 않고 복구 안내를 보여준다', async () => {
    mockMatchMedia(false);
    (window as unknown as DeferredPromptWindow).__deferredInstallPrompt = {
      prompt: vi.fn().mockRejectedValue(new Error('private browser detail')),
      userChoice: Promise.resolve({ outcome: 'dismissed' }),
    };
    render(<OwnerControllerSetupPanel />);
    fireEvent.click(screen.getByRole('button', { name: ownerControllerSetupCopy.ko.install }));
    expect(await screen.findByRole('alert')).toHaveTextContent(ownerControllerSetupCopy.ko.failed);
    expect(screen.getByText(ownerControllerSetupCopy.ko.browserManual)).toBeInTheDocument();
    expect(screen.queryByText(/private browser detail/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: ownerControllerSetupCopy.ko.showGuide })).toBeEnabled();
  });

  it('설치 선택 응답이 실패해도 진행 중 잠금을 해제한다', async () => {
    mockMatchMedia(false);
    let rejectChoice: (error: Error) => void = () => {};
    (window as unknown as DeferredPromptWindow).__deferredInstallPrompt = {
      prompt: vi.fn().mockResolvedValue(undefined),
      userChoice: new Promise((_resolve, reject) => { rejectChoice = reject; }),
    };
    render(<OwnerControllerSetupPanel />);
    fireEvent.click(screen.getByRole('button', { name: ownerControllerSetupCopy.ko.install }));
    await act(async () => { rejectChoice(new Error('choice unavailable')); });
    expect(screen.getByRole('alert')).toHaveTextContent(ownerControllerSetupCopy.ko.failed);
    expect(screen.getByRole('button', { name: ownerControllerSetupCopy.ko.manualRefresh })).toBeEnabled();
  });

  it.each(['ko', 'en', 'ja', 'zh'] as Language[])('%s 설치·업데이트·수동 복구 문구와 44px/포커스 표시를 함께 제공한다', async (language) => {
    mockMatchMedia(false);
    render(<OwnerControllerSetupPanel language={language} />);
    const copy = ownerControllerSetupCopy[language];
    expect(screen.getByRole('heading', { name: copy.title })).toBeInTheDocument();
    expect(screen.getByText(copy.updateLine)).toBeInTheDocument();
    const guide = screen.getByRole('button', { name: copy.showGuide });
    expect(guide).toHaveClass('min-h-[44px]', 'focus-visible:ring-2');
    fireEvent.click(guide);
    expect(await screen.findByText(copy.browserManual)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: copy.manualRefresh })).toHaveClass('min-h-[44px]', 'focus-visible:ring-2');
    if (language !== 'ko') expect(screen.queryByText(ownerControllerSetupCopy.ko.title)).not.toBeInTheDocument();
  });

  it.each(['ko', 'en', 'ja', 'zh'] as Language[])('%s standalone 상태를 APK 설치 완료로 표현하지 않는다', (language) => {
    mockMatchMedia(true);
    sessionStorage.setItem('pwa_launch_path', '/admin/ai-center');
    render(<OwnerControllerSetupPanel language={language} />);
    expect(screen.getByRole('status')).toHaveTextContent(ownerControllerSetupCopy[language].installed);
    expect(screen.queryByText(ownerControllerSetupCopy[language].installAccepted)).not.toBeInTheDocument();
  });
});
