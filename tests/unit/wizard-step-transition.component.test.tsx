// @vitest-environment jsdom
//
// 위자드 step 전환 회귀 잠금 (2026-08-02).
//
// 잠근 버그: step 전환부가 framer-motion `AnimatePresence mode="wait"` 였을 때,
//   다음 step 의 mount 가 "이전 step 의 exit 애니메이션 완료" 에 묶여 있었다. 그 완료 신호는
//   requestAnimationFrame 으로만 온다 → 백그라운드/비가시 탭에서는 rAF 가 안 돌아
//   step 값만 바뀌고 화면은 이전 step 에 영원히 멈춘다(에러 없음).
//   같은 원인의 라우트 전환 사고: PR #1198 (tests/unit/route-transition.component.test.tsx).
//
// 그래서 이 테스트는 rAF 를 죽인 상태(= 백그라운드 탭)로 렌더한다.
// vi.hoisted 로 import 보다 먼저 죽인다 — 애니메이션 라이브러리가 모듈 로드 시점에
// 전역 rAF 를 캡처하는 경우까지 덮기 위해(누가 mode="wait" 를 되살려도 잡히게).
//
// 🔴 되돌리면 실제로 깨지는 지점 두 곳:
//   1) 클릭한 그 커밋에서 이전 step 이 사라지는가 (mode="wait" 면 안 사라진다)
//   2) 들어온 step 요소에 인라인 opacity 가 안 남는가 (framer 는 opacity:0 을 인라인으로
//      찍고 rAF 로만 1 로 올린다 → 죽은 rAF 에서는 0 에 갇힌다)
import React from 'react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, cleanup } from '@testing-library/react';

vi.hoisted(() => {
  (globalThis as unknown as { requestAnimationFrame: unknown }).requestAnimationFrame = () => 0;
  (globalThis as unknown as { cancelAnimationFrame: unknown }).cancelAnimationFrame = () => {};
});

// 사전을 쓰는 곳이 많아 키 이름을 그대로 돌려주는 프록시로 대신한다.
const dict = new Proxy({}, { get: (_t, k) => (typeof k === 'string' ? k : '') });
vi.mock('@/hooks/useLanguage', () => ({
  useLanguage: () => ({ t: { planner: dict }, language: 'en' }),
}));
// useAuth·persistence·notify 는 firebase/localStorage 를 끌고 온다 — 전환 동작과 무관하므로 mock.
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: null }) }));
vi.mock('@/lib/notify', () => ({ requestNotifyPermission: vi.fn() }));
vi.mock('@/lib/haptic', () => ({ haptic: vi.fn() }));
vi.mock('@/lib/posthog', () => ({ track: vi.fn() }));
vi.mock('@/lib/analytics', () => ({ trackEvent: vi.fn() }));
vi.mock('@/hooks/useWizardPersistence', () => ({
  useWizardPersistence: () => ({ clear: vi.fn() }),
  loadFreshestWizardSnapshot: () => null,
  clearWizardSnapshot: vi.fn(),
  clearPlannerWizardSnapshot: vi.fn(),
  markWizardDirtyExit: vi.fn(),
  PLANNER_WIZARD_NS: 'planner',
  PLANNER_WIZARD_PAUSED_NS: 'planner_paused',
}));
vi.mock('@/components/ResumeWizardModal', () => ({ ResumeWizardModal: () => null }));
vi.mock('../../src/components/WizardForm/WizardStepHint', () => ({ WizardStepHint: () => null }));

// step 컴포넌트는 각자 표식과 이동 버튼만 가진 스텁으로 바꾼다 —
// 전환 자체(어느 step 이 언제 DOM 에 있는가)만 보기 위해서다.
function stub(name: string) {
  return ({ onNext, onPrev }: { onNext?: () => void; onPrev?: () => void }) => (
    <div>
      <p>{name} 화면</p>
      {onNext && <button type="button" onClick={onNext}>{name} 다음</button>}
      {onPrev && <button type="button" onClick={onPrev}>{name} 이전</button>}
    </div>
  );
}
vi.mock('../../src/components/WizardForm/WizardStep0Reservation', () => ({ WizardStep0Reservation: stub('예약') }));
vi.mock('../../src/components/WizardForm/WizardStep0Destination', () => ({ WizardStep0Destination: stub('도시') }));
vi.mock('../../src/components/WizardForm/WizardStep1Food', () => ({ WizardStep1Food: stub('음식') }));
vi.mock('../../src/components/WizardForm/WizardStep2Details', () => ({ WizardStep2Details: stub('상세') }));
vi.mock('../../src/components/WizardForm/WizardStep3Review', () => ({ WizardStep3Review: stub('검토') }));

const { WizardForm } = await import('../../src/components/WizardForm');

void React;

/** 지금 화면에 그려진 step 래퍼(전환 클래스가 붙는 요소). */
function stepWrapper(container: HTMLElement): HTMLElement {
  const viewport = container.querySelector('.wizard-step-viewport');
  expect(viewport).toBeTruthy();
  return viewport!.firstElementChild as HTMLElement;
}

/** lazy step chunk 가 resolve 되는 마이크로태스크만 흘려보낸다(rAF 아님). */
async function flushLazy() {
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
}

beforeEach(() => { vi.useFakeTimers({ shouldAdvanceTime: true }); });
afterEach(() => { vi.useRealTimers(); cleanup(); });

function renderWizard() {
  return render(<WizardForm onSubmit={async () => ({ ok: true })} isLoading={false} />);
}

describe('위자드 step 전환은 애니메이션 프레임에 의존하지 않는다 (rAF 죽은 백그라운드 탭)', () => {
  it('다음 버튼을 누른 그 커밋에서 이전 step 이 사라진다', async () => {
    const { container } = renderWizard();
    await flushLazy();
    expect(screen.getByText('예약 화면')).toBeTruthy();

    fireEvent.click(screen.getByText('예약 다음'));

    // 🔴 기다리지 않는다. exit 애니메이션 완료를 기다리는 구현이면 여기서 터진다.
    expect(container.textContent).not.toContain('예약 화면');

    // 새 step 은 lazy chunk 한 틱 뒤 (rAF 아님).
    await flushLazy();
    expect(screen.getByText('도시 화면')).toBeTruthy();
  });

  it('한 번에 한 step 만 DOM 에 있다 (두 step 동시 렌더로 인한 깜빡임 방지)', async () => {
    const { container } = renderWizard();
    await flushLazy();
    fireEvent.click(screen.getByText('예약 다음'));
    await flushLazy();

    const shown = ['예약', '도시', '음식', '상세', '검토'].filter((n) => container.textContent?.includes(`${n} 화면`));
    expect(shown).toEqual(['도시']);
  });

  it('들어온 step 에 인라인 opacity 가 남지 않는다 (rAF 없이도 결국 보인다)', async () => {
    const { container } = renderWizard();
    await flushLazy();
    fireEvent.click(screen.getByText('예약 다음'));
    await flushLazy();

    const el = stepWrapper(container);
    // framer 는 initial 값을 인라인 style 로 찍고 rAF 로만 1 로 올린다 → 죽은 rAF 에서 0 에 갇힌다.
    expect(el.style.opacity).toBe('');
    expect(el.style.transform).toBe('');
    // 진입 슬라이드는 CSS 클래스로만 건다.
    expect(el.className).toContain('wizard-step-enter');

    // 안전 시간이 지나면 클래스도 걷힌다 → 요소 기본 상태(opacity 1)로 확정.
    await act(async () => { vi.advanceTimersByTime(600); });
    expect(stepWrapper(container).className).not.toContain('wizard-step-enter');
  });

  it('첫 렌더에는 진입 애니메이션을 걸지 않는다 (프리렌더 깜빡임 방지)', async () => {
    const { container } = renderWizard();
    await flushLazy();
    expect(stepWrapper(container).className || '').not.toContain('wizard-step-enter');
  });

  it('뒤로 갈 때도 그 커밋에서 즉시 교체된다', async () => {
    const { container } = renderWizard();
    await flushLazy();
    fireEvent.click(screen.getByText('예약 다음'));
    await flushLazy();

    fireEvent.click(screen.getByText('도시 이전'));
    expect(container.textContent).not.toContain('도시 화면');
    await flushLazy();
    expect(screen.getByText('예약 화면')).toBeTruthy();
  });
});

describe('전환 CSS 는 멈춘 애니메이션에 갇히지 않는다', () => {
  // routeFade 와 같은 규칙 — to/100% 나 fill-mode 가 있으면 애니메이션이 안 도는 환경에서
  // 요소가 첫 프레임(opacity 0)에 갇힌다.
  const css = readFileSync(resolve(__dirname, '../../src/index.css'), 'utf8');

  it('@keyframes wizardStepEnter 는 from 만 가진다', () => {
    const block = css.match(/@keyframes\s+wizardStepEnter\s*\{[\s\S]*?\n\}/);
    expect(block).toBeTruthy();
    expect(block![0]).toContain('from');
    expect(block![0]).not.toMatch(/\bto\b|100%/);
  });

  it('.wizard-step-enter 는 animation-fill-mode 를 쓰지 않는다', () => {
    const block = css.match(/\.wizard-step-enter\s*\{[\s\S]*?\n\}/);
    expect(block).toBeTruthy();
    expect(block![0]).not.toMatch(/fill-mode|forwards|both/);
  });

  it('진입 이동(translateX)이 가로 스크롤을 만들지 않게 뷰포트가 잘라낸다', () => {
    const block = css.match(/\.wizard-step-viewport\s*\{[\s\S]*?\n\}/);
    expect(block).toBeTruthy();
    expect(block![0]).toMatch(/overflow-x:\s*clip/);
  });
});

describe('step preload 는 그대로 유지된다', () => {
  const src = readFileSync(resolve(__dirname, '../../src/components/WizardForm/index.tsx'), 'utf8');

  it('STEP_IMPORTS + idle preload 존재 (첫 전환 지연 방지)', () => {
    expect(src).toMatch(/STEP_IMPORTS/);
    expect(src).toMatch(/requestIdleCallback/);
  });

  it('framer-motion AnimatePresence 로 되돌아가지 않았다', () => {
    // 경고 주석에는 이름이 남아 있으므로 **실제 사용**(JSX 태그·import)만 본다.
    expect(src).not.toMatch(/<AnimatePresence/);
    expect(src).not.toMatch(/<motion\./);
    expect(src).not.toMatch(/from\s+['"]framer-motion['"]/);
  });
});
