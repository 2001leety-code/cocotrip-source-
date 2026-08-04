// @vitest-environment jsdom
/**
 * 잠금 (2026-08-04) — 위저드 스텝 힌트 배너의 펼침/접힘 판정.
 *
 * 예전엔 useEffect 로 열었다. 첫 렌더에서 무조건 접힌 채 그렸다가 effect 가 다시 열어
 * 매 스텝마다 렌더가 한 번 더 돌고 배너가 깜빡였다(react-hooks/set-state-in-effect 가
 * 잡던 자리). 지금은 useState 초기값으로 한 번에 정하고, 호출부가 `key={step}` 으로
 * 스텝마다 새로 마운트한다.
 *
 * 그래서 잠글 것은 "초기값 계산이 맞는가" 다 — 소스에 어떤 훅이 쓰였는지가 아니라
 * **실제로 렌더했을 때 무엇이 보이는가**.
 */
import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render } from '@testing-library/react';
import { WizardStepHint } from '../../src/components/WizardForm/WizardStepHint';

vi.mock('@/hooks/useLanguage', () => ({ useLanguage: () => ({ language: 'en' }) }));

const SEEN_PREFIX = 'COCO_WIZARD_HINT_';

beforeEach(() => {
  window.localStorage.clear();
});

describe('위저드 스텝 힌트 — 펼침/접힘', () => {
  it('안 본 스텝은 펼쳐진 상태로 첫 렌더된다', () => {
    const { container } = render(<WizardStepHint step={1} />);
    // 펼침 = 본문이 보인다. 접힘 = "?" 칩 하나만 있다.
    expect(container.textContent, '안 본 스텝인데 본문이 없다').not.toBe('');
    expect(container.querySelector('button')).toBeTruthy();
    // 접힘 상태의 마크업(오른쪽 정렬 칩 한 개)이 아니어야 한다.
    expect(container.querySelector('.flex.justify-end.mb-2')).toBeNull();
  });

  it('이미 본 스텝은 접힌 상태로 첫 렌더된다 (effect 로 뒤늦게 접지 않는다)', () => {
    window.localStorage.setItem(`${SEEN_PREFIX}2`, String(1));
    const { container } = render(<WizardStepHint step={2} />);
    expect(container.querySelector('.flex.justify-end.mb-2'), '본 스텝인데 펼쳐져 있다').toBeTruthy();
  });

  it('스텝마다 판정이 독립이다 (본 스텝 옆의 안 본 스텝)', () => {
    window.localStorage.setItem(`${SEEN_PREFIX}2`, String(1));
    const { container } = render(<WizardStepHint step={3} />);
    expect(container.querySelector('.flex.justify-end.mb-2'), 'step 3 은 본 적이 없다').toBeNull();
  });

  it('힌트가 없는 스텝은 아무것도 그리지 않는다', () => {
    const { container } = render(<WizardStepHint step={99} />);
    expect(container.innerHTML).toBe('');
  });

  it('localStorage 가 막혀 있어도(사생활 보호 모드) 터지지 않고 접힘으로 간다', () => {
    const spy = vi.spyOn(window.Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    const { container } = render(<WizardStepHint step={1} />);
    expect(container.querySelector('.flex.justify-end.mb-2')).toBeTruthy();
    spy.mockRestore();
  });

  it('닫기 버튼을 누르면 접히고 본 것으로 기록된다', async () => {
    const user = (await import('@testing-library/user-event')).default;
    const { container } = render(<WizardStepHint step={1} />);
    const closeBtn = container.querySelector('button');
    expect(closeBtn).toBeTruthy();
    await user.click(closeBtn as HTMLButtonElement);
    expect(window.localStorage.getItem(`${SEEN_PREFIX}1`)).toBeTruthy();
    expect(container.querySelector('.flex.justify-end.mb-2')).toBeTruthy();
  });
});
