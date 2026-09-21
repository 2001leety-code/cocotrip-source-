// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const authFetchMock = vi.fn();
vi.mock('../../src/lib/authFetch', () => ({ authFetch: (...args: unknown[]) => authFetchMock(...args) }));

const { MoodTopupModal } = await import('../../src/components/admin/MoodTopupModal');

afterEach(cleanup);
beforeEach(() => authFetchMock.mockReset());

describe('MoodTopupModal lifecycle', () => {
  it('loads balance when opened, resets draft on reopen, and never submits while editing', async () => {
    authFetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ ok: true, data: { clientId: 'mood', client: { name: 'MOOD', balanceKRW: 1100000 } } }),
    });
    const onClose = vi.fn();
    const view = render(<MoodTopupModal open={false} onClose={onClose} />);

    expect(screen.queryByText('무드 선불 잔액 충전')).toBeNull();
    view.rerender(<MoodTopupModal open onClose={onClose} />);
    await waitFor(() => expect(screen.getByText('₩1,100,000')).toBeInTheDocument());

    const amount = screen.getByPlaceholderText('예: 1100000');
    fireEvent.change(amount, { target: { value: '50000' } });
    expect(amount).toHaveValue(50000);
    expect(screen.getByRole('button', { name: '충전하기' })).toBeEnabled();

    view.rerender(<MoodTopupModal open={false} onClose={onClose} />);
    view.rerender(<MoodTopupModal open onClose={onClose} />);
    await waitFor(() => expect((screen.getByPlaceholderText('예: 1100000') as HTMLInputElement).value).toBe(''));
    expect(authFetchMock).toHaveBeenCalledTimes(2);
    expect(authFetchMock).toHaveBeenCalledWith('/api/mood-data');
    expect(authFetchMock.mock.calls.every(([url]) => url === '/api/mood-data')).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: '닫기' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
