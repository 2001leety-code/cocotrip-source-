// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import AdminTourAvailability from '../../src/pages/AdminTourAvailability';
import TelegramLogs from '../../src/components/admin/TelegramLogs';
import type { AvailabilityEntry } from '../../src/lib/tour-availability-store';

const state = vi.hoisted(() => ({
  fetchMonth: vi.fn(), save: vi.fn(), unsubscribe: vi.fn(),
  receive: null as null | ((snapshot: { forEach: (visit: (doc: { id: string; data: () => Record<string, unknown> }) => void) => void }) => void),
}));
vi.mock('@/sections/Header', () => ({ Header: () => <header /> }));
vi.mock('@/lib/firebase', () => ({ db: {} }));
vi.mock('@/lib/tour-availability-store', () => ({ fetchMonthAvailability: state.fetchMonth, setAvailability: state.save }));
vi.mock('firebase/firestore', () => ({
  collection: vi.fn(), query: vi.fn(), orderBy: vi.fn(), limit: vi.fn(),
  onSnapshot: (_query: unknown, receive: typeof state.receive) => { state.receive = receive; return state.unsubscribe; },
}));
beforeEach(() => { vi.clearAllMocks(); state.receive = null; });
afterEach(cleanup);

describe('admin read-only request lifecycle', () => {
  it('ignores an old month response after navigating to the next month', async () => {
    const pending: Array<{ month: string; finish: (map: Map<string, AvailabilityEntry>) => void }> = [];
    state.fetchMonth.mockImplementation((_tour: string, month: string) => new Promise<Map<string, AvailabilityEntry>>(finish => { pending.push({ month, finish }); }));
    render(<MemoryRouter><AdminTourAvailability /></MemoryRouter>);
    fireEvent.click(screen.getByRole('button', { name: '→' }));
    const latest = pending[1];
    await act(async () => { latest.finish(new Map([[`${latest.month}-01`, { tourId: 'synthetic', date: `${latest.month}-01`, status: 'blackout' }]])); });
    expect(screen.getByRole('button', { name: '1 휴업' })).toBeInTheDocument();
    await act(async () => { pending[0].finish(new Map()); });
    expect(screen.getByRole('button', { name: '1 휴업' })).toBeInTheDocument();
    expect(state.save).not.toHaveBeenCalled();
  });

  it('renders the subscription result and releases the log listener on unmount', async () => {
    const view = render(<TelegramLogs />);
    expect(state.receive).toBeTypeOf('function');
    await act(async () => { state.receive?.({ forEach: visit => visit({ id: 'log-1', data: () => ({ driverName: 'Synthetic driver', orderID: 'LOCAL-1', status: 'accepted' }) }) }); });
    expect(screen.getAllByText('Synthetic driver').length).toBeGreaterThan(0);
    expect(screen.getByText('LOCAL-1')).toBeInTheDocument();
    view.unmount();
    expect(state.unsubscribe).toHaveBeenCalledOnce();
  });
});
