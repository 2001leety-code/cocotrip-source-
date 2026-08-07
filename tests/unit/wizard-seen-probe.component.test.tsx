// @vitest-environment jsdom
//
// `wizard_seen` 계측 잠금 (2026-08-06).
//
// 왜 이 신호가 있나: 6월 광고 코호트 109명이 `/planner` 에 도착해 플랜 생성 0, 체류 시간
// 중앙값 10초로 이탈했다. 오류는 0건이었다. 그때 우리는 **"보고도 안 썼다" 와 "아예 못 봤다"
// 를 구분할 수단이 없었다** — 둘은 처방이 정반대다(위저드를 고칠 것 vs 위로 올릴 것).
//
// 그래서 여기서 잠그는 것은 "track 을 부른다"가 아니라 **부르는 조건과 횟수**다:
//   - 화면에 안 보이면 안 보낸다 (안 그러면 도착 수와 똑같아져 신호가 죽는다)
//   - 보이면 1회만 보낸다 (스크롤로 들락날락할 때마다 보내면 분자가 부풀어 비율이 거짓이 된다)
//   - 언마운트 시 observer 를 끊는다 (누수)
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';

const trackMock = vi.fn(() => Promise.resolve());
vi.mock('@/lib/posthog', () => ({ track: (...a: unknown[]) => trackMock(...a) }));

import { WizardSeenProbe } from '../../src/pages/PlannerPage/components/WizardSeenProbe';

void React;

/** 관찰 콜백을 테스트가 직접 쥘 수 있는 IntersectionObserver 대역. */
let triggers: Array<(entries: { isIntersecting: boolean }[]) => void>;
let disconnectCalls: number;

beforeEach(() => {
  trackMock.mockClear();
  triggers = [];
  disconnectCalls = 0;
  class FakeIO {
    constructor(cb: (entries: { isIntersecting: boolean }[]) => void) { triggers.push(cb); }
    observe() { /* noop */ }
    disconnect() { disconnectCalls += 1; }
    unobserve() { /* noop */ }
  }
  (globalThis as unknown as { IntersectionObserver: unknown }).IntersectionObserver = FakeIO;
});

afterEach(() => cleanup());

describe('WizardSeenProbe — wizard_seen 발화 조건', () => {
  it('화면에 보이기 전에는 보내지 않는다', () => {
    render(<WizardSeenProbe><div>wizard</div></WizardSeenProbe>);
    expect(triggers.length).toBe(1);
    triggers[0]([{ isIntersecting: false }]);
    expect(trackMock).not.toHaveBeenCalled();
  });

  it('보이면 1회 보내고, 다시 보여도 더 보내지 않는다', () => {
    render(<WizardSeenProbe><div>wizard</div></WizardSeenProbe>);
    triggers[0]([{ isIntersecting: true }]);
    triggers[0]([{ isIntersecting: true }]);
    triggers[0]([{ isIntersecting: true }]);
    expect(trackMock).toHaveBeenCalledTimes(1);
    expect(trackMock.mock.calls[0][0]).toBe('wizard_seen');
  });

  it('처음 보인 시점의 스크롤 위치를 함께 보낸다 (첫 화면이었는지 판정용)', () => {
    Object.defineProperty(window, 'scrollY', { value: 1310, configurable: true });
    render(<WizardSeenProbe><div>wizard</div></WizardSeenProbe>);
    triggers[0]([{ isIntersecting: true }]);
    const props = trackMock.mock.calls[0][1] as Record<string, number>;
    expect(props.scroll_y).toBe(1310);
    expect(props.viewport_h).toBeGreaterThan(0);
  });

  it('보내는 속성 전부가 허용목록을 실제로 통과한다 (#1244, 2026-08-07)', async () => {
    // 🔴 잠근 사고: 위 테스트는 track() mock 에 **넘겼는지**만 봤다. 실제 전송 계층
    //   (sanitizeCaptureProperties → stripUnsafeProps)은 기본-거부 허용목록이라
    //   ALLOWED_PROP_KEYS 에 없는 scroll_y·viewport_h 를 조용히 버렸고, wizard_seen 은
    //   도착하는데 속성이 빈 객체였다 — "못 봤다 vs 보고도 안 썼다" 판독 계획이 무력해졌다.
    //   여기서는 mock 이 받은 속성을 **실제 허용목록 코드**에 통과시켜 살아남는지 본다.
    //   프로브에 새 속성을 추가하면 이 테스트가 허용목록 등록을 강제한다.
    const { sanitizeCaptureProperties } = await import('../../src/lib/analyticsProps');
    Object.defineProperty(window, 'scrollY', { value: 1310, configurable: true });
    render(<WizardSeenProbe><div>wizard</div></WizardSeenProbe>);
    triggers[0]([{ isIntersecting: true }]);
    const sentProps = trackMock.mock.calls[0][1] as Record<string, unknown>;
    const survived = sanitizeCaptureProperties(sentProps);
    for (const key of Object.keys(sentProps)) {
      expect(survived, `프로브 속성 "${key}" 가 허용목록(ALLOWED_PROP_KEYS)에서 버려진다`).toHaveProperty(key);
    }
    expect(survived.scroll_y).toBe(1310);
    expect(typeof survived.viewport_h).toBe('number');
  });

  it('보인 뒤 observer 를 끊는다 (재발화·누수 방지)', () => {
    render(<WizardSeenProbe><div>wizard</div></WizardSeenProbe>);
    triggers[0]([{ isIntersecting: true }]);
    expect(disconnectCalls).toBeGreaterThan(0);
  });

  it('IntersectionObserver 가 없는 환경에서도 렌더를 깨지 않는다 (프리렌더·구형 브라우저)', () => {
    delete (globalThis as unknown as Record<string, unknown>).IntersectionObserver;
    const { container } = render(<WizardSeenProbe><div>wizard</div></WizardSeenProbe>);
    expect(container.textContent).toContain('wizard');
    expect(trackMock).not.toHaveBeenCalled();
  });

  it('자식이 차지하는 실제 박스를 관찰한다 — display:contents 면 영원히 발화하지 않는다', () => {
    const { container } = render(<WizardSeenProbe className="x"><div>wizard</div></WizardSeenProbe>);
    const wrapper = container.firstElementChild as HTMLElement;
    expect(wrapper.tagName).toBe('DIV');
    expect(wrapper.className).toBe('x');
  });
});
