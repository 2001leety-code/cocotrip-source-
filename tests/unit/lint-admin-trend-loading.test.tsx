// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PainpointsTab } from '@/components/admin/ZoneCourseEditor/PainpointsTab';
import { TrendHintsTab } from '@/components/admin/ZoneCourseEditor/TrendHintsTab';

const state = vi.hoisted(() => ({ fetchHints: vi.fn(), toastError: vi.fn() }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: { uid: 'synthetic-admin' } }) }));
vi.mock('@/lib/zone-courses-trend', () => ({ fetchTrendHints: state.fetchHints }));
vi.mock('sonner', () => ({ toast: { error: state.toastError, success: vi.fn() } }));

function deferred<T>() {
  let finish!: (value: T) => void;
  let fail!: (reason: unknown) => void;
  return { promise: new Promise<T>((resolve, reject) => { finish = resolve; fail = reject; }), finish, fail };
}

beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

describe('admin trend automatic and manual loading', () => {
  it('keeps painpoint auto-load one-shot while manual refresh retries failures', async () => {
    const first = deferred<{ painpoints: Array<Record<string, unknown>>; notices: string[] }>();
    const failed = deferred<{ painpoints: Array<Record<string, unknown>>; notices: string[] }>();
    const retry = deferred<{ painpoints: Array<Record<string, unknown>>; notices: string[] }>();
    state.fetchHints.mockReturnValueOnce(first.promise).mockReturnValueOnce(failed.promise).mockReturnValueOnce(retry.promise);
    const view = render(<PainpointsTab draft={{ city: 'seoul', zone: 'jongno' }} />);
    expect(screen.getByText('불러오는 중...')).toBeTruthy();
    await act(async () => { first.finish({ painpoints: [{ reddit_post_id: 'p1', title: '첫 painpoint', subreddit: 'koreatravel', score: 1, comments_count: 0 }], notices: [] }); });
    expect(state.fetchHints).toHaveBeenCalledTimes(1);

    view.rerender(<PainpointsTab draft={{ city: 'busan', zone: 'haeundae' }} />);
    expect(state.fetchHints).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: '새로고침' }));
    await act(async () => { failed.fail(new Error('synthetic failure')); });
    fireEvent.click(screen.getByRole('button', { name: '새로고침' }));
    await act(async () => { retry.finish({ painpoints: [{ reddit_post_id: 'p2', title: '재시도 painpoint', subreddit: 'koreatravel', score: 2, comments_count: 0 }], notices: [] }); });
    expect(state.fetchHints).toHaveBeenCalledTimes(3);
    expect(screen.getByText('재시도 painpoint')).toBeTruthy();
  });

  it('keeps rising-spot auto-load one-shot while manual refresh retries failures', async () => {
    const first = deferred<{ rising: Array<Record<string, unknown>>; notices: string[] }>();
    const failed = deferred<{ rising: Array<Record<string, unknown>>; notices: string[] }>();
    const retry = deferred<{ rising: Array<Record<string, unknown>>; notices: string[] }>();
    state.fetchHints.mockReturnValueOnce(first.promise).mockReturnValueOnce(failed.promise).mockReturnValueOnce(retry.promise);
    const view = render(<TrendHintsTab draft={{ city: 'seoul', zone: 'jongno' }} onChange={vi.fn()} />);
    expect(screen.getByText('불러오는 중...')).toBeTruthy();
    await act(async () => { first.finish({ rising: [{ spotId: 's1', name: '첫 spot', address: '', query: '' }], notices: [] }); });
    expect(state.fetchHints).toHaveBeenCalledTimes(1);

    view.rerender(<TrendHintsTab draft={{ city: 'busan', zone: 'haeundae' }} onChange={vi.fn()} />);
    expect(state.fetchHints).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: '새로고침' }));
    await act(async () => { failed.fail(new Error('synthetic failure')); });
    fireEvent.click(screen.getByRole('button', { name: '새로고침' }));
    await act(async () => { retry.finish({ rising: [{ spotId: 's2', name: '재시도 spot', address: '', query: '' }], notices: [] }); });
    expect(state.fetchHints).toHaveBeenCalledTimes(3);
    expect(screen.getByText('재시도 spot')).toBeTruthy();
  });
});
