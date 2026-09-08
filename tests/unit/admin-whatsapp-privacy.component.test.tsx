// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AdminWhatsAppPrivacy } from '../../src/components/AdminWhatsAppPrivacy';
import { isWhatsAppPrivacyOverview, whatsappSupportCopy, type WhatsAppPrivacyOverview } from '../../src/lib/whatsappSupportCopy';
void React;

const auth = vi.hoisted(() => ({ user: { uid: 'synthetic-owner', getIdToken: vi.fn() } as { uid: string; getIdToken: ReturnType<typeof vi.fn> } | null }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => auth }));
const NOW = Date.parse('2026-09-08T05:00:00Z');
const session = { id: 'a'.repeat(64), sender: '820000000001', status: 'active' as const, startedAtMs: NOW - 1000, expiresAtMs: NOW + 7199000, updatedAtMs: NOW };
const fixture: WhatsAppPrivacyOverview = { generatedAtMs: NOW, enabled: false, ready: true, sessions: [session], possiblyTruncated: false };
const copy = whatsappSupportCopy.ko.admin;
const ok = (data?: unknown) => ({ ok: true, json: async () => ({ ok: true, ...(data ? { data } : {}) }) });
const network = vi.fn();
const pause = () => act(async () => { await new Promise(resolve => setTimeout(resolve, 5)); });
function toggle(open: boolean) {
  const details = document.querySelector('details')!;
  details.open = open;
  fireEvent(details, new Event('toggle'));
}
async function loaded() {
  toggle(true);
  await screen.findByText(session.sender);
}
beforeEach(() => {
  auth.user = { uid: 'synthetic-owner', getIdToken: vi.fn().mockResolvedValue('synthetic-token') };
  network.mockReset().mockResolvedValue(ok(fixture));
  vi.stubGlobal('fetch', network);
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('owner WhatsApp privacy boundaries', () => {
  it('does not read before expansion and uses a fresh authenticated no-store GET', async () => {
    render(<AdminWhatsAppPrivacy language="ko" />);
    await pause();
    expect(network).not.toHaveBeenCalled();
    expect(auth.user?.getIdToken).not.toHaveBeenCalled();
    await loaded();
    expect(network).toHaveBeenCalledTimes(1);
    expect(network.mock.calls[0]).toEqual(['/api/admin-whatsapp-privacy', expect.objectContaining({ method: 'GET', cache: 'no-store', headers: { Authorization: 'Bearer synthetic-token' }, signal: expect.any(AbortSignal) })]);
    expect(screen.getByText(copy.receivingOff)).toBeTruthy();
    expect(screen.getByText(copy.ready)).toBeTruthy();
    expect(screen.queryByText(copy.receivingOn)).toBeNull();
    expect(screen.getByRole('button', { name: `${copy.close}: ${session.sender}` }).hasAttribute('disabled')).toBe(false);
  });
  it.each(['ko', 'en', 'ja', 'zh'] as const)('isolates %s preview from tokens and reads/writes', async language => {
    render(<AdminWhatsAppPrivacy language={language} previewMode previewData={fixture} />);
    toggle(true);
    await pause();
    expect(screen.getByText(whatsappSupportCopy[language].admin.preview)).toBeTruthy();
    for (const button of screen.getAllByRole('button')) {
      expect(button.hasAttribute('disabled')).toBe(true);
      expect(button.className).toContain('min-h-[44px]');
      expect(button.className).toContain('min-w-[44px]');
      fireEvent.click(button);
    }
    expect(network).not.toHaveBeenCalled();
    expect(auth.user?.getIdToken).not.toHaveBeenCalled();
  });
  it('supports exclusion before receiving is enabled, without optimistic completion or duplicate writes', async () => {
    render(<AdminWhatsAppPrivacy language="ko" />);
    await loaded();
    let finishPost: (value: ReturnType<typeof ok>) => void = () => {};
    let finishGet: (value: ReturnType<typeof ok>) => void = () => {};
    network.mockImplementationOnce(() => new Promise(resolve => { finishPost = resolve; }))
      .mockImplementationOnce(() => new Promise(resolve => { finishGet = resolve; }));
    const button = screen.getByRole('button', { name: `${copy.block}: ${session.sender}` });
    fireEvent.click(button); fireEvent.click(button);
    await waitFor(() => expect(network).toHaveBeenCalledTimes(2));
    expect(network.mock.calls[1][1]).toMatchObject({ method: 'POST', cache: 'no-store', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer synthetic-token' }, body: JSON.stringify({ action: 'block', sender: session.sender }) });
    expect(button.hasAttribute('disabled')).toBe(true);
    expect(screen.queryByText(copy.saved)).toBeNull();
    expect(screen.getByText(copy.active)).toBeTruthy();
    await act(async () => { finishPost(ok()); });
    await waitFor(() => expect(network).toHaveBeenCalledTimes(3));
    expect(screen.queryByText(copy.saved)).toBeNull();
    await act(async () => { finishGet(ok({ ...fixture, sessions: [{ ...session, status: 'blocked' }] })); });
    expect(screen.getByText(copy.saved)).toBeTruthy();
    expect(screen.getByText(copy.blocked)).toBeTruthy();
    await waitFor(() => expect(document.activeElement).toBe(button));
  });
  it.each(['close', 'unblock'] as const)('confirms %s only after a matching closed state is read', async action => {
    network.mockResolvedValueOnce(ok({ ...fixture, sessions: [{ ...session, status: action === 'unblock' ? 'blocked' : 'active' }] }));
    render(<AdminWhatsAppPrivacy language="ko" />);
    await loaded();
    network.mockResolvedValueOnce(ok()).mockResolvedValueOnce(ok({ ...fixture, sessions: [{ ...session, status: 'closed' }] }));
    fireEvent.click(screen.getByRole('button', { name: `${copy[action]}: ${session.sender}` }));
    await screen.findByText(copy.saved);
    expect(screen.getByText(copy.closed)).toBeTruthy();
    expect(network.mock.calls[1][1].body).toBe(JSON.stringify({ action, sender: session.sender }));
    expect(screen.queryByText(copy.active)).toBeNull();
    if (action === 'close') expect(document.activeElement).toBe(screen.getByText(copy.saved));
    else expect(document.activeElement).toBe(screen.getByRole('button', { name: `${copy.block}: ${session.sender}` }));
  });
  it.each(['post-error', 'refresh-error', 'unchanged', 'malformed', 'truncated-missing'] as const)('does not claim completion after %s', async failure => {
    render(<AdminWhatsAppPrivacy language="ko" />);
    await loaded();
    const bad = { ok: false, json: async () => ({ ok: false, error: 'PRIVATE_SERVER_ERROR' }) };
    network.mockResolvedValueOnce(failure === 'post-error' ? bad : ok());
    if (failure !== 'post-error') network.mockResolvedValueOnce(failure === 'refresh-error' ? bad
      : failure === 'malformed' ? ok({ ...fixture, ready: 'yes' })
        : failure === 'truncated-missing' ? ok({ ...fixture, sessions: [], possiblyTruncated: true }) : ok(fixture));
    fireEvent.click(screen.getByRole('button', { name: `${copy.block}: ${session.sender}` }));
    await screen.findByText(copy.unconfirmed);
    expect(screen.queryByText(copy.saved)).toBeNull();
    expect(document.body.textContent).not.toContain('PRIVATE_SERVER_ERROR');
    expect(network).toHaveBeenCalledTimes(failure === 'post-error' ? 2 : 3);
  });
  it('does not confirm unblock from a missing row even when the list is not truncated', async () => {
    network.mockResolvedValueOnce(ok({ ...fixture, sessions: [{ ...session, status: 'blocked' }] }));
    render(<AdminWhatsAppPrivacy language="ko" />); await loaded();
    network.mockResolvedValueOnce(ok()).mockResolvedValueOnce(ok({ ...fixture, sessions: [], possiblyTruncated: false }));
    fireEvent.click(screen.getByRole('button', { name: `${copy.unblock}: ${session.sender}` }));
    await screen.findByText(copy.unconfirmed);
    expect(screen.queryByText(copy.saved)).toBeNull();
  });
  it('disables actions only when privacy scope is not ready', async () => {
    network.mockResolvedValue(ok({ ...fixture, enabled: true, ready: false, sessions: [] }));
    render(<AdminWhatsAppPrivacy language="ko" />); toggle(true);
    await screen.findByText(copy.notReady);
    expect(screen.getByLabelText(copy.sender).hasAttribute('disabled')).toBe(true);
    expect(screen.getByRole('button', { name: copy.block }).hasAttribute('disabled')).toBe(true);
    expect(network).toHaveBeenCalledTimes(1);
  });
  it.each(['0123', '+821234', '82 1234', '<script>', '1'.repeat(21)])('rejects invalid manual number %s without writing', async value => {
    render(<AdminWhatsAppPrivacy language="ko" />); await loaded();
    fireEvent.change(screen.getByLabelText(copy.sender), { target: { value } });
    fireEvent.submit(screen.getByLabelText(copy.sender).closest('form')!);
    expect(screen.getByText(copy.invalidSender)).toBeTruthy();
    expect(network).toHaveBeenCalledTimes(1);
  });
  it('can exclude a manually entered number and clears it only after confirmation', async () => {
    render(<AdminWhatsAppPrivacy language="ko" />); await loaded();
    const sender = '820000000002';
    network.mockResolvedValueOnce(ok()).mockResolvedValueOnce(ok({ ...fixture, sessions: [session, { ...session, id: 'b'.repeat(64), sender, status: 'blocked' }] }));
    const input = screen.getByLabelText(copy.sender) as HTMLInputElement;
    fireEvent.change(input, { target: { value: sender } });
    fireEvent.submit(input.closest('form')!);
    await screen.findByText(copy.saved);
    expect(input.value).toBe('');
    expect(network.mock.calls[1][1].body).toBe(JSON.stringify({ action: 'block', sender }));
  });
  it('clears the old account immediately and ignores late responses after account remount', async () => {
    const view = render(<AdminWhatsAppPrivacy language="ko" />); await loaded();
    let finish: (value: ReturnType<typeof ok>) => void = () => {};
    network.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    fireEvent.click(screen.getByRole('button', { name: copy.refresh }));
    await waitFor(() => expect(network).toHaveBeenCalledTimes(2));
    const signal = network.mock.calls[1][1].signal;
    auth.user = { uid: 'other-synthetic-owner', getIdToken: vi.fn().mockResolvedValue('other-token') };
    view.rerender(<AdminWhatsAppPrivacy language="ko" />);
    expect(signal.aborted).toBe(true);
    expect(screen.queryByText(session.sender)).toBeNull();
    await act(async () => { finish(ok(fixture)); });
    expect(screen.queryByText(session.sender)).toBeNull();
    expect(auth.user.getIdToken).not.toHaveBeenCalled();
    auth.user = null; view.rerender(<AdminWhatsAppPrivacy language="ko" />); toggle(true);
    expect(screen.getByText(copy.signedOut)).toBeTruthy();
    await pause(); expect(network).toHaveBeenCalledTimes(2);
  });
  it('aborts on close and never shows a late POST result as success', async () => {
    render(<AdminWhatsAppPrivacy language="ko" />); await loaded();
    let finish: (value: ReturnType<typeof ok>) => void = () => {};
    network.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    fireEvent.click(screen.getByRole('button', { name: `${copy.close}: ${session.sender}` }));
    await waitFor(() => expect(network).toHaveBeenCalledTimes(2));
    const signal = network.mock.calls[1][1].signal;
    toggle(false);
    expect(signal.aborted).toBe(true);
    await act(async () => { finish(ok()); });
    expect(screen.queryByText(copy.saved)).toBeNull();
    expect(screen.queryByText(session.sender)).toBeNull();
    expect(network).toHaveBeenCalledTimes(2);
  });
  it('times out an unresolved token and never sends a late request', async () => {
    vi.useFakeTimers();
    let finish: (value: string) => void = () => {};
    auth.user!.getIdToken.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    render(<AdminWhatsAppPrivacy language="ko" />); toggle(true);
    await act(async () => { await vi.advanceTimersByTimeAsync(10_001); });
    expect(screen.getByText(copy.failed)).toBeTruthy();
    await act(async () => { finish('late-token'); });
    expect(network).not.toHaveBeenCalled();
  });
  it('times out change token acquisition without sending a late POST', async () => {
    render(<AdminWhatsAppPrivacy language="ko" />); await loaded();
    vi.useFakeTimers();
    let finish: (value: string) => void = () => {};
    auth.user!.getIdToken.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    fireEvent.click(screen.getByRole('button', { name: `${copy.close}: ${session.sender}` }));
    await act(async () => { await vi.advanceTimersByTimeAsync(10_001); });
    expect(screen.getByText(copy.unconfirmed)).toBeTruthy();
    await act(async () => { finish('late-token'); });
    expect(network).toHaveBeenCalledTimes(1);
  });
  it('pages five sessions locally without reading or writing again', async () => {
    const sessions = Array.from({ length: 7 }, (_, index) => ({ ...session, id: index.toString(16).padStart(64, '0'), sender: `82000000000${index}` }));
    network.mockResolvedValue(ok({ ...fixture, sessions }));
    render(<AdminWhatsAppPrivacy language="ko" />); toggle(true);
    await screen.findByText(sessions[0].sender);
    expect(screen.getAllByRole('listitem')).toHaveLength(5);
    fireEvent.click(screen.getByRole('button', { name: copy.next }));
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
    expect(screen.getByText(copy.range(6, 7, 7))).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: copy.previous }));
    expect(screen.getAllByRole('listitem')).toHaveLength(5);
    expect(network).toHaveBeenCalledTimes(1);
  });
  it('validates bounded, unique, correctly typed public session data', () => {
    expect(isWhatsAppPrivacyOverview(fixture)).toBe(true);
    for (const value of [null, {}, { ...fixture, generatedAtMs: Infinity }, { ...fixture, ready: 'true' },
      { ...fixture, sessions: [session, session] }, { ...fixture, sessions: [{ ...session, sender: '0123' }] },
      { ...fixture, sessions: [{ ...session, status: 'toString' }] }, { ...fixture, sessions: [{ ...session, id: '<script>' }] },
      { ...fixture, sessions: [{ ...session, expiresAtMs: 0 }] }, { ...fixture, sessions: [{ ...session, updatedAtMs: NOW + 1 }] },
      { ...fixture, sessions: [{ ...session, startedAtMs: NOW + 1 }] }, { ...fixture, ready: false },
      { ...fixture, sessions: Array.from({ length: 101 }, () => session) }]) expect(isWhatsAppPrivacyOverview(value)).toBe(false);
  });
});
