// @vitest-environment jsdom
//
// Shared state primitives (src/components/ui/states.tsx) — Korea Editorial
// Concierge (2026-08-10).
//
// These are small on purpose, but the parts that matter are invisible: an
// error that never reaches a screen reader, an empty screen that dead-ends
// with no action, a loading region that does not announce itself. Those are
// exactly the things a visual review misses, so they get the test.
//
// Nothing here is wired into payment/refund/booking screens — that is a
// separate PR with a money-safety review.
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { EcSkeleton, EcLoading, EcEmpty, EcError, EcDone } from '../../src/components/ui/states';

void React;

describe('EcLoading', () => {
  it('busy 상태를 polite 로 알리고, 라벨은 스크린리더 전용', () => {
    render(<EcLoading label="Loading your plans" />);
    const region = screen.getByRole('status');
    expect(region).toHaveAttribute('aria-busy', 'true');
    expect(region).toHaveAttribute('aria-live', 'polite');
    expect(screen.getByText('Loading your plans')).toBeInTheDocument();
  });

  it('lines 만큼 스켈레톤 줄을 그린다 (제목 1줄 + 본문 n줄)', () => {
    const { container } = render(<EcLoading label="Loading" lines={4} />);
    expect(container.querySelectorAll('span.animate-pulse')).toHaveLength(5);
  });

  it('스켈레톤은 장식이라 접근성 트리에서 빠진다', () => {
    const { container } = render(<EcSkeleton className="h-4 w-full" />);
    const bar = container.firstElementChild!;
    expect(bar).toHaveAttribute('aria-hidden');
    expect(bar.className).toContain('h-4 w-full');
  });
});

describe('EcEmpty', () => {
  it('제목·본문·행동을 그린다 — 빈 화면은 막다른 길이 아니다', () => {
    render(<EcEmpty title="No saved plans yet" body="Your first itinerary lands here." action={<a href="/planner">Start</a>} />);
    expect(screen.getByRole('heading', { name: 'No saved plans yet' })).toBeInTheDocument();
    expect(screen.getByText('Your first itinerary lands here.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Start' })).toHaveAttribute('href', '/planner');
  });

  it('빈 상태는 announce 하지 않는다 (사용자가 유발한 결과가 아님)', () => {
    render(<EcEmpty title="Nothing here" />);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
});

describe('EcError', () => {
  it('assertive 로 알린다 — 실패는 사용자가 즉시 알아야 한다', () => {
    render(<EcError title="Could not load your plan" body="The connection dropped." />);
    const region = screen.getByRole('status');
    expect(region).toHaveAttribute('aria-live', 'assertive');
    expect(screen.getByRole('heading', { name: 'Could not load your plan' })).toBeInTheDocument();
  });

  it('retry 라벨과 핸들러가 둘 다 있을 때만 버튼이 나오고, 눌리면 호출된다', async () => {
    const onRetry = vi.fn();
    const { rerender } = render(<EcError title="Failed" retryLabel="Try again" onRetry={onRetry} />);
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(onRetry).toHaveBeenCalledTimes(1);

    // Half a contract is a button that does nothing — render neither.
    rerender(<EcError title="Failed" onRetry={onRetry} />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('버튼 type 은 submit 이 아니다 (폼 안에서 의도치 않은 제출 방지)', () => {
    render(<EcError title="Failed" retryLabel="Retry" onRetry={() => {}} />);
    expect(screen.getByRole('button', { name: 'Retry' })).toHaveAttribute('type', 'button');
  });
});

describe('EcDone', () => {
  it('완료는 polite 로 알린다 (작업을 방해하지 않음)', () => {
    render(<EcDone title="Published" body="Your plan is shared." action={<a href="/my-plans">Open</a>} />);
    const region = screen.getByRole('status');
    expect(region).toHaveAttribute('aria-live', 'polite');
    expect(screen.getByRole('link', { name: 'Open' })).toBeInTheDocument();
  });
});

describe('네 상태 공통', () => {
  it('본문이 없으면 빈 문단을 남기지 않는다', () => {
    const { container } = render(<EcEmpty title="Only a title" />);
    expect(container.querySelectorAll('p')).toHaveLength(0);
  });

  it('토큰 서피스(.ec-root) 위에 그려진다 — 페이지 색을 상속하지 않는다', () => {
    const { container } = render(<EcDone title="Done" />);
    expect(container.querySelector('.ec-root')).toBeTruthy();
  });
});
