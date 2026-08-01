// @vitest-environment jsdom
/**
 * 차터 안내창은 **스스로 열리지 않는다** (2026-08-02).
 *
 * 왜 유닛으로 옮겼나: e2e 에서 "모달이 없다" 를 단언하면 그 시점에 없기만 하면 즉시 통과한다.
 * 앵커로 쓰던 버튼은 첫 렌더부터 보이므로 관찰 구간이 사실상 0 이었고, 누군가 예전처럼
 * `setTimeout(..., 350)` 자동 노출을 되살려도 검사가 먼저 끝나 놓칠 수 있었다(리뷰 지적).
 * 가짜 타이머로 시간을 강제로 흘려보내면 그 구멍이 사라진다.
 *
 * 지키는 것: 어떤 동의 상태에서도, 시간이 아무리 지나도, 사용자가 누르기 전에는 안 열린다.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, fireEvent } from '@testing-library/react';
import { CharterIntroModal } from '../../src/components/CharterIntroModal';
import { setConsent } from '../../src/lib/consent';

const dialog = () => document.querySelector('[role="dialog"][aria-labelledby="charter-intro-title"]');

beforeEach(() => {
  localStorage.clear();
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

/** 자동 노출 타이머가 있었다면 이미 터졌을 만큼 시간을 흘린다. */
function advance(ms: number) {
  act(() => { vi.advanceTimersByTime(ms); });
}

describe('자동 노출 없음', () => {
  it('동의 미결정 상태로 10초가 지나도 열리지 않는다', () => {
    render(<CharterIntroModal />);
    advance(10_000);
    expect(dialog()).toBeNull();
  });

  it('동의를 수락해도 열리지 않는다 (예전 구현은 여기서 350ms 뒤 열었다)', () => {
    render(<CharterIntroModal />);
    act(() => { setConsent('accepted'); });
    advance(10_000);
    expect(dialog()).toBeNull();
  });

  it('동의를 닫아도(dismissed) 열리지 않는다', () => {
    render(<CharterIntroModal />);
    act(() => { setConsent('dismissed'); });
    advance(10_000);
    expect(dialog()).toBeNull();
  });

  it('예전 "1회 노출" 저장키가 없어도 열리지 않는다 (플래그 부재가 트리거였다)', () => {
    localStorage.removeItem('COCO_CHARTER_INTRO_SEEN_v1');
    render(<CharterIntroModal />);
    act(() => { setConsent('accepted'); });
    advance(30_000);
    expect(dialog()).toBeNull();
  });
});

describe('사용자가 누르면 열린다', () => {
  it('버튼 클릭으로 열리고, 닫아도 버튼이 남는다', () => {
    render(<CharterIntroModal />);
    const trigger = screen.getByTestId('charter-how-it-works');
    expect(dialog()).toBeNull();

    act(() => { fireEvent.click(trigger); });
    expect(dialog()).not.toBeNull();

    const close = document.querySelector('[role="dialog"] button[aria-label="Close"]') as HTMLButtonElement;
    act(() => { fireEvent.click(close); });
    expect(dialog()).toBeNull();
    // 트리거가 사라지면 다시 열 수 없다.
    expect(screen.getByTestId('charter-how-it-works')).toBeTruthy();
  });

  it('다이얼로그는 body 로 포털된다 (모바일 밝은 셸의 색상 덮어쓰기 회피)', () => {
    const { container } = render(<CharterIntroModal />);
    act(() => { fireEvent.click(screen.getByTestId('charter-how-it-works')); });
    expect(container.querySelector('[role="dialog"]'), '셸 안에 있으면 글자가 안 보인다').toBeNull();
    expect(document.body.querySelector('[role="dialog"]')).not.toBeNull();
  });
});
