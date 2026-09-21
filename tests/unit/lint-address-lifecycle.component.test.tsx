// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AddressAutocomplete } from '../../src/components/charter/AddressAutocomplete';

const place = { name: 'Seoul Station', address: 'Seoul', lat: 37.55, lng: 126.97 };
const props = { label: 'Address', id: 'address', language: 'en' as const, onChange: vi.fn() };

async function search(query: string) {
  fireEvent.change(screen.getByRole('textbox'), { target: { value: query } });
  await act(async () => { await vi.advanceTimersByTimeAsync(400); });
}

beforeEach(() => {
  vi.useFakeTimers();
  props.onChange.mockClear();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('address search lifecycle', () => {
  it('does not restore old results when a pending search resolves after clearing input', async () => {
    let finish!: (response: Response) => void;
    const fetchMock = vi.fn(() => new Promise<Response>(resolve => { finish = resolve; }));
    vi.stubGlobal('fetch', fetchMock);
    render(<AddressAutocomplete {...props} />);
    await search('Seoul');
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '' } });
    await act(async () => { finish(new Response(JSON.stringify({ items: [place] }))); });
    expect(screen.queryByRole('button', { name: /Seoul Station/ })).not.toBeInTheDocument();
    fireEvent.focus(screen.getByRole('textbox'));
    expect(screen.queryByRole('button', { name: /Seoul Station/ })).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('keeps the newer response when two searches finish out of order', async () => {
    const finish: Array<(response: Response) => void> = [];
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(resolve => { finish.push(resolve); })));
    render(<AddressAutocomplete {...props} />);
    await search('Seoul');
    await search('Busan');
    await act(async () => { finish[1](new Response(JSON.stringify({ items: [{ ...place, name: 'Busan Station' }] }))); });
    await act(async () => { finish[0](new Response(JSON.stringify({ items: [place] }))); });
    expect(screen.getByRole('button', { name: /Busan Station/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Seoul Station/ })).not.toBeInTheDocument();
  });

  it('confirms selected coordinates and resets after the parent clears its value', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ items: [place] }))));
    const view = render(<AddressAutocomplete {...props} />);
    await search('Seoul');
    fireEvent.click(screen.getByRole('button', { name: /Seoul Station/ }));
    await act(async () => {});
    expect(screen.getByText('Mini map unavailable')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Yes' }));
    expect(props.onChange).toHaveBeenCalledWith({ ...place, category: undefined, originalName: place.name, originalAddress: place.address });
    view.rerender(<AddressAutocomplete {...props} value={place} />);
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    view.rerender(<AddressAutocomplete {...props} />);
    expect(screen.getByRole('textbox')).toHaveValue('');
    expect(screen.queryByText('Is this the right address?')).not.toBeInTheDocument();
  });

  it('shows a server error and accepts a new search after it', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(new Response('{}', { status: 500 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ items: [place] }))));
    render(<AddressAutocomplete {...props} />);
    await search('bad');
    expect(screen.getByText('Search failed. Please try again.')).toBeInTheDocument();
    await search('Seoul');
    expect(screen.getByRole('button', { name: /Seoul Station/ })).toBeInTheDocument();
    expect(screen.queryByText('Search failed. Please try again.')).not.toBeInTheDocument();
  });
});
