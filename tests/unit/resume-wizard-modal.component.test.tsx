// @vitest-environment jsdom
/**
 * ResumeWizardModal — Korea Editorial Concierge 전환 잠금 (2026-08-11).
 *
 * 1. closed(open=false) 시 렌더 안 함.
 * 2. title/desc({summary} 치환 포함)/summary 없을 때 문구, 두 콜백(onContinue/onRestart) 호출.
 * 3. 44px 최소 높이(ec-btn) + 편집형 토큰(ec-btn-primary/secondary, ec-h3 등) 사용, dark
 *    gradient/glass/inline hex 부재.
 * 4. dialog aria 관계(role/aria-modal/aria-labelledby/aria-describedby)가 실제 h2/p id 와 일치.
 * 5. open 시 primary 버튼(Continue)으로 초점 이동, 닫힐 때 열기 전 초점으로 복원.
 * 6. open 동안 Tab/Shift+Tab 이 Continue ↔ Start over 사이에서만 순환(포커스 트랩), 배경
 *    요소로 탈출하지 않음. body 배경 스크롤 잠금 + 닫힐 때 이전 값 그대로 복원.
 */
import React from 'react';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, afterEach } from 'vitest';

import { ResumeWizardModal } from '../../src/components/ResumeWizardModal';

afterEach(cleanup);

describe('ResumeWizardModal', () => {
  it('open=false 면 렌더 안 함', () => {
    const { container } = render(
      <ResumeWizardModal open={false} onContinue={() => {}} onRestart={() => {}} />,
    );
    expect(container.innerHTML).toBe('');
  });

  it('summary 있으면 desc 에 치환, title/두 버튼 라벨 렌더', () => {
    render(
      <ResumeWizardModal
        open
        summary="Seoul · 4박 5일 · 2명"
        onContinue={() => {}}
        onRestart={() => {}}
      />,
    );
    expect(screen.getByText('Continue where you left off?')).toBeTruthy();
    expect(screen.getByText(/You filled out: Seoul · 4박 5일 · 2명/)).toBeTruthy();
    expect(screen.getByRole('button', { name: /Continue/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Start over/ })).toBeTruthy();
  });

  it('summary 없으면 descNoSummary 문구로 폴백', () => {
    render(<ResumeWizardModal open onContinue={() => {}} onRestart={() => {}} />);
    expect(screen.getByText('Your previous progress was saved.')).toBeTruthy();
    expect(screen.queryByText(/You filled out:/)).toBeNull();
  });

  it('Continue 클릭 시 onContinue, Start over 클릭 시 onRestart 호출', async () => {
    const user = userEvent.setup();
    const onContinue = () => { calls.push('continue'); };
    const onRestart = () => { calls.push('restart'); };
    const calls: string[] = [];

    render(
      <ResumeWizardModal open summary="Busan" onContinue={onContinue} onRestart={onRestart} />,
    );
    await user.click(screen.getByRole('button', { name: /Continue/ }));
    await user.click(screen.getByRole('button', { name: /Start over/ }));
    expect(calls).toEqual(['continue', 'restart']);
  });

  it('버튼 44px 최소 높이(ec-btn) + 편집형 토큰 클래스, dark gradient/glass 부재', () => {
    render(<ResumeWizardModal open onContinue={() => {}} onRestart={() => {}} />);
    const continueBtn = screen.getByRole('button', { name: /Continue/ });
    const restartBtn = screen.getByRole('button', { name: /Start over/ });

    expect(continueBtn.className).toContain('ec-btn');
    expect(continueBtn.className).toContain('ec-btn-primary');
    expect(restartBtn.className).toContain('ec-btn');
    expect(restartBtn.className).toContain('ec-btn-secondary');

    const card = screen.getByRole('dialog').firstElementChild as HTMLElement;
    expect(card.className).toContain('bg-ec-raised');
    expect(card.className).toContain('border-ec-line');
    expect(card.className).toContain('shadow-ec-overlay');

    // 구 다크 gradient/glass/보라 하드코딩 흔적이 전혀 없어야 한다.
    const html = document.body.innerHTML;
    expect(html).not.toMatch(/linear-gradient/);
    expect(html).not.toMatch(/backdropFilter|backdrop-filter/);
    expect(html).not.toMatch(/#1a1b2e|#16213e|#0f3460|#7c5cfc|#6d28d9|#a78bfa/i);
  });

  it('role=dialog + aria-modal + aria-labelledby/aria-describedby 가 실제 title/desc id 와 일치', () => {
    render(
      <ResumeWizardModal open summary="Jeju" onContinue={() => {}} onRestart={() => {}} />,
    );
    const dialog = screen.getByRole('dialog');
    expect(dialog.getAttribute('aria-modal')).toBe('true');

    const labelledbyId = dialog.getAttribute('aria-labelledby');
    const describedbyId = dialog.getAttribute('aria-describedby');
    expect(labelledbyId).toBeTruthy();
    expect(describedbyId).toBeTruthy();

    const titleEl = document.getElementById(labelledbyId as string);
    const descEl = document.getElementById(describedbyId as string);
    expect(titleEl?.textContent).toBe('Continue where you left off?');
    expect(descEl?.textContent).toMatch(/Jeju/);
  });

  it('open 시 Continue 버튼으로 초점 이동, 닫힐 때 열기 전 초점으로 복원', () => {
    function Harness({ open }: { open: boolean }) {
      return (
        <div>
          <button type="button">outside trigger</button>
          <ResumeWizardModal open={open} summary="Seoul" onContinue={() => {}} onRestart={() => {}} />
        </div>
      );
    }

    const { rerender } = render(<Harness open={false} />);
    const trigger = screen.getByRole('button', { name: 'outside trigger' });
    trigger.focus();
    expect(document.activeElement).toBe(trigger);

    rerender(<Harness open />);
    expect(document.activeElement).toBe(screen.getByRole('button', { name: /Continue/ }));

    rerender(<Harness open={false} />);
    expect(document.activeElement).toBe(trigger);
  });

  it('Tab 이 Continue → Start over → Continue 로 순환(포커스 트랩)', async () => {
    const user = userEvent.setup();
    render(
      <ResumeWizardModal open summary="Seoul" onContinue={() => {}} onRestart={() => {}} />,
    );
    const continueBtn = screen.getByRole('button', { name: /Continue/ });
    const restartBtn = screen.getByRole('button', { name: /Start over/ });

    expect(document.activeElement).toBe(continueBtn);
    await user.tab();
    expect(document.activeElement).toBe(restartBtn);
    await user.tab();
    expect(document.activeElement).toBe(continueBtn);
  });

  it('Continue 에서 Shift+Tab 이면 Start over 로 순환', async () => {
    const user = userEvent.setup();
    render(
      <ResumeWizardModal open summary="Seoul" onContinue={() => {}} onRestart={() => {}} />,
    );
    const continueBtn = screen.getByRole('button', { name: /Continue/ });
    const restartBtn = screen.getByRole('button', { name: /Start over/ });

    expect(document.activeElement).toBe(continueBtn);
    await user.tab({ shift: true });
    expect(document.activeElement).toBe(restartBtn);
  });

  it('modal 마지막 요소에서 Tab 해도 DOM 상 뒤에 있는 배경 요소로 탈출하지 않고 Continue 로 순환', async () => {
    // 이 컴포넌트는 portal 없이 트리 안에 그대로 렌더되므로, 배경 트리거가 modal 뒤에
    // 오면(실제 페이지에서 흔한 배치) 트랩 없이는 네이티브 Tab 순서가 그대로 새어나간다.
    const user = userEvent.setup();
    function Harness() {
      return (
        <div>
          <ResumeWizardModal open summary="Seoul" onContinue={() => {}} onRestart={() => {}} />
          <button type="button">outside trigger</button>
        </div>
      );
    }
    render(<Harness />);
    const trigger = screen.getByRole('button', { name: 'outside trigger' });
    const continueBtn = screen.getByRole('button', { name: /Continue/ });
    const restartBtn = screen.getByRole('button', { name: /Start over/ });

    restartBtn.focus();
    expect(document.activeElement).toBe(restartBtn);

    await user.tab();
    expect(document.activeElement).not.toBe(trigger);
    expect(document.activeElement).toBe(continueBtn);
  });

  it('open 동안 body 스크롤 잠금, 닫히면 이전 overflow 값 그대로 복원', () => {
    document.body.style.overflow = 'scroll'; // 다른 코드가 이미 설정해 둔 값이 있는 상황을 재현
    const { rerender } = render(
      <ResumeWizardModal open={false} onContinue={() => {}} onRestart={() => {}} />,
    );
    expect(document.body.style.overflow).toBe('scroll');

    rerender(<ResumeWizardModal open onContinue={() => {}} onRestart={() => {}} />);
    expect(document.body.style.overflow).toBe('hidden');

    rerender(<ResumeWizardModal open={false} onContinue={() => {}} onRestart={() => {}} />);
    expect(document.body.style.overflow).toBe('scroll');

    document.body.style.overflow = '';
  });
});
