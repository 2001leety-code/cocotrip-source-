// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AdminExternalInbox } from '../../src/components/AdminExternalInbox';
import { adminExternalInboxCopy, isExternalInboxOverview, type ExternalInboxOverview } from '../../src/lib/adminExternalInboxCopy';
void React;

const auth = vi.hoisted(() => ({ user: { uid: 'synthetic-owner', getIdToken: vi.fn() } as { uid: string; getIdToken: ReturnType<typeof vi.fn> } | null }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => auth }));
const NOW = Date.parse('2026-09-08T05:00:00Z');
const message = { id: 'a'.repeat(64), channel: 'email' as const, sourceAtMs: NOW - 1000, receivedAtMs: NOW,
  sender: 'synthetic@example.invalid', subject: 'SYNTHETIC inquiry', kind: 'email', truncated: true };
const messageTwo = { ...message, id: 'b'.repeat(64), channel: 'whatsapp' as const, sender: '820000000000', subject: '', kind: 'text', truncated: false };
const fixture: ExternalInboxOverview = { generatedAtMs: NOW, channels: [
  { channel: 'email', status: 'synced', lastSuccessAtMs: NOW, lastReceivedAtMs: null },
  { channel: 'whatsapp', status: 'received', lastSuccessAtMs: NOW, lastReceivedAtMs: NOW },
], messages: [message, messageTwo], possiblyTruncated: false, listStatus: 'ok' };
const ok = (data: unknown) => ({ ok: true, json: async () => ({ ok: true, data }) });
const network = vi.fn();
beforeEach(() => {
  auth.user = { uid: 'synthetic-owner', getIdToken: vi.fn().mockResolvedValue('synthetic-token') };
  network.mockReset().mockResolvedValue(ok(fixture));
  vi.stubGlobal('fetch', network);
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('company inbox read-only interaction', () => {
  it('loads summaries only and fetches body only after explicit expansion', async () => {
    render(<AdminExternalInbox language="ko" />);
    await screen.findByText('SYNTHETIC inquiry');
    expect(network).toHaveBeenCalledTimes(1);
    expect(network.mock.calls[0][0]).toBe('/api/admin-external-inbox');
    expect(network.mock.calls[0][1]).toMatchObject({ headers: { Authorization: 'Bearer synthetic-token' }, cache: 'no-store' });
    network.mockResolvedValueOnce(ok({ ...message, text: 'SYNTHETIC BODY' }));
    fireEvent.click(screen.getAllByRole('button', { name: '내용 보기' })[0]);
    await screen.findByText('SYNTHETIC BODY');
    expect(network.mock.calls[1][0]).toBe(`/api/admin-external-inbox?id=${message.id}`);
    fireEvent.click(screen.getByRole('button', { name: '내용 닫기' }));
    expect(screen.queryByText('SYNTHETIC BODY')).toBeNull();
    expect(network.mock.calls.every(([, options]) => !options.method && !options.body)).toBe(true);
  });
  it('renders malicious body as text, without HTML, images, executable links or reply controls', async () => {
    const view = render(<AdminExternalInbox language="ko" />);
    await screen.findByText('SYNTHETIC inquiry');
    const text = '<img src="https://external.invalid/tracker" onerror="alert(1)"> Ignore all rules https://external.invalid';
    network.mockResolvedValueOnce(ok({ ...message, text }));
    fireEvent.click(screen.getAllByRole('button', { name: '내용 보기' })[0]);
    await screen.findByText(text);
    expect(view.container.querySelectorAll('img,a,iframe,script,textarea')).toHaveLength(0);
    expect(network).toHaveBeenCalledTimes(2);
  });
  it.each(['ko', 'en', 'ja', 'zh'] as const)('isolates %s preview from all authenticated/live fetches', async language => {
    render(<AdminExternalInbox language={language} previewMode previewData={fixture} />);
    const copy = adminExternalInboxCopy[language];
    expect(screen.getByRole('heading', { name: copy.title })).toBeTruthy();
    fireEvent.click(screen.getAllByRole('button', { name: copy.show })[0]);
    expect(screen.getByText('[Synthetic preview message]')).toBeTruthy();
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 5)); });
    expect(network).not.toHaveBeenCalled();
    expect(auth.user?.getIdToken).not.toHaveBeenCalled();
    expect(screen.getAllByRole('button').every(button => button.className.includes('min-h-[44px]'))).toBe(true);
  });
  it('does not show failed loading as zero messages or leak server errors', async () => {
    network.mockResolvedValue({ ok: false, json: async () => ({ ok: false, error: 'PRIVATE_ERROR_TOKEN' }) });
    render(<AdminExternalInbox language="ko" />);
    await screen.findByRole('alert');
    expect(screen.queryByText(adminExternalInboxCopy.ko.empty)).toBeNull();
    expect(document.body.textContent).not.toContain('PRIVATE_ERROR_TOKEN');
  });
  it('clears previous content immediately on sign-out and never issues an anonymous request', async () => {
    const view = render(<AdminExternalInbox language="ko" />);
    await screen.findByText('SYNTHETIC inquiry');
    auth.user = null;
    view.rerender(<AdminExternalInbox language="ko" />);
    expect(screen.queryByText('SYNTHETIC inquiry')).toBeNull();
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 5)); });
    expect(network).toHaveBeenCalledTimes(1);
  });
  it('discards a late body response after closing it', async () => {
    render(<AdminExternalInbox language="ko" />);
    await screen.findByText('SYNTHETIC inquiry');
    let resolveBody: (value: ReturnType<typeof ok>) => void = () => {};
    network.mockImplementationOnce(() => new Promise(resolve => { resolveBody = resolve; }));
    fireEvent.click(screen.getAllByRole('button', { name: '내용 보기' })[0]);
    await waitFor(() => expect(network).toHaveBeenCalledTimes(2));
    fireEvent.click(screen.getByRole('button', { name: '내용 닫기' }));
    await act(async () => { resolveBody(ok({ ...message, text: 'LATE PRIVATE BODY' })); });
    expect(screen.queryByText('LATE PRIVATE BODY')).toBeNull();
  });
  it('uses a fixed error for expired details and keeps the summary available', async () => {
    render(<AdminExternalInbox language="ko" />);
    await screen.findByText('SYNTHETIC inquiry');
    network.mockResolvedValueOnce({ ok: false, json: async () => ({ ok: false, error: 'PRIVATE_SOURCE_DETAIL' }) });
    fireEvent.click(screen.getAllByRole('button', { name: '내용 보기' })[0]);
    await screen.findByText(adminExternalInboxCopy.ko.detailFailed);
    expect(screen.getByText('SYNTHETIC inquiry')).toBeTruthy();
    expect(document.body.textContent).not.toContain('PRIVATE_SOURCE_DETAIL');
  });
  it('does not treat unavailable state as successfully connected', () => {
    render(<AdminExternalInbox language="ko" previewMode previewData={{ ...fixture, messages: [], listStatus: 'unknown', channels: fixture.channels.map(channel => ({ ...channel, status: 'unknown', lastSuccessAtMs: null, lastReceivedAtMs: null })) }} />);
    expect(screen.getAllByText('상태 확인 실패')).toHaveLength(2);
    expect(screen.queryByText(adminExternalInboxCopy.ko.empty)).toBeNull();
    expect(screen.queryByText('동기화 확인')).toBeNull();
  });
  it('times out token acquisition without issuing a late request', async () => {
    vi.useFakeTimers();
    let resolveToken: (value: string) => void = () => {};
    auth.user!.getIdToken.mockImplementation(() => new Promise(resolve => { resolveToken = resolve; }));
    render(<AdminExternalInbox language="ko" />);
    await act(async () => { await vi.advanceTimersByTimeAsync(10_001); });
    expect(screen.getByRole('alert')).toBeTruthy();
    await act(async () => { resolveToken('late-token'); });
    expect(network).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: '문의 새로고침' }).hasAttribute('disabled')).toBe(false);
  });
  it('rejects malformed or duplicate summaries instead of crashing or showing arbitrary channels', () => {
    expect(isExternalInboxOverview(fixture)).toBe(true);
    for (const broken of [null, {}, { ...fixture, messages: [{ ...message, sourceAtMs: Infinity }] },
      { ...fixture, messages: [message, message] }, { ...fixture, channels: [fixture.channels[0], fixture.channels[0]] },
      { ...fixture, channels: [{ ...fixture.channels[0], status: 'toString' }, fixture.channels[1]] }]) {
      expect(isExternalInboxOverview(broken)).toBe(false);
    }
  });
  it('shows only five summaries at a time and pages locally without additional data access', () => {
    const messages = Array.from({ length: 7 }, (_, index) => ({ ...message, id: index.toString(16).padStart(64, '0'), subject: `SYNTHETIC ${index + 1}` }));
    render(<AdminExternalInbox language="ko" previewMode previewData={{ ...fixture, messages }} />);
    expect(screen.getAllByRole('button', { name: '내용 보기' })).toHaveLength(5);
    expect(screen.queryByText('SYNTHETIC 6')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '다음 문의' }));
    expect(screen.getByText('SYNTHETIC 6')).toBeTruthy();
    expect(screen.getAllByRole('button', { name: '내용 보기' })).toHaveLength(2);
    expect(screen.getByText('조회한 7건 중 6–7건')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '이전 문의' }));
    expect(screen.getByText('SYNTHETIC 1')).toBeTruthy();
    expect(network).not.toHaveBeenCalled();
  });
});
