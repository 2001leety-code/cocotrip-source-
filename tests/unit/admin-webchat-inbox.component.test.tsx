// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AdminWebchatInbox } from '../../src/components/AdminWebchatInbox';
import { adminWebchatInboxCopy } from '../../src/lib/adminWebchatInboxCopy';
import type { WebchatDetail, WebchatOverview } from '../../src/lib/adminWebchatInboxContract';
void React;

const auth = vi.hoisted(() => ({ user: null as { uid: string; getIdToken: ReturnType<typeof vi.fn> } | null }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => auth }));
const now = Date.now();
const session = { sessionId: 'sess_synthetic_owner_preview_0_chat', lastMessageAtMs: now - 60_000, lastMessageFrom: 'customer' as const, ownerType: 'guest' as const, language: 'en' as const };
const overview: WebchatOverview = { generatedAtMs: now, sessions: [session], possiblyTruncated: false };
const fixture: WebchatDetail = { generatedAtMs: now, session, messagesPossiblyTruncated: false,
  messages: [{ id: 'synthetic_message_1', from: 'customer', text: 'SYNTHETIC CUSTOMER BODY', language: 'en', truncated: false, ts: session.lastMessageAtMs }] };
const copy = adminWebchatInboxCopy.ko;
const ok = (data: unknown, status = 200) => ({ ok: true, status, json: async () => ({ ok: true, data }) });
const failure = (code: string, status: number) => ({ ok: false, status, json: async () => ({ ok: false, code }) });
const network = vi.fn();
function saved(input: { sessionId: string; text: string; requestId: string }) {
  return { session: { ...session, sessionId: input.sessionId, lastMessageAtMs: now, lastMessageFrom: 'admin' }, requestId: input.requestId,
    translated: false, message: { id: 'stored_reply_1', from: 'admin', text: input.text, ts: now, truncated: false, language: 'en' } };
}
async function openReply(text = 'SYNTHETIC OWNER REPLY') {
  await screen.findByRole('button', { name: copy.show });
  fireEvent.click(screen.getByRole('button', { name: copy.show }));
  await screen.findByText('SYNTHETIC CUSTOMER BODY');
  fireEvent.change(screen.getByLabelText(copy.replyLabel), { target: { value: text } });
  fireEvent.click(screen.getByRole('button', { name: copy.review }));
}
beforeEach(() => {
  auth.user = { uid: 'synthetic-owner', getIdToken: vi.fn().mockResolvedValue('synthetic-token') };
  network.mockReset().mockImplementation(async (url: string, options: RequestInit) => options?.method === 'POST'
    ? ok(saved(JSON.parse(String(options.body))), 201) : ok(url.includes('?') ? fixture : overview));
  vi.stubGlobal('fetch', network);
  vi.spyOn(window, 'confirm').mockReturnValue(true);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('owner webchat inbox', () => {
  it('does not fetch the body before opening and requires review before sending', async () => {
    render(<AdminWebchatInbox language="ko" />);
    await screen.findByRole('button', { name: copy.show });
    expect(screen.queryByText('SYNTHETIC CUSTOMER BODY')).toBeNull();
    expect(network).toHaveBeenCalledTimes(1);
    await openReply();
    expect(network.mock.calls.filter(([, options]) => options.method === 'POST')).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: copy.confirmSend }));
    await screen.findByText(copy.saved);
    const send = network.mock.calls.find(([, options]) => options.method === 'POST')!;
    expect(send[1].headers).toEqual({ Authorization: 'Bearer synthetic-token', 'Content-Type': 'application/json' });
    expect(JSON.parse(send[1].body)).toMatchObject({ sessionId: session.sessionId, text: 'SYNTHETIC OWNER REPLY', expectedLastMessageAtMs: session.lastMessageAtMs });
    expect(screen.getByLabelText(copy.replyLabel)).toHaveValue('');
    expect(screen.getByText('SYNTHETIC OWNER REPLY')).toBeTruthy();
  });
  it('keeps an uncertain request immutable and retries the same ID and exact body', async () => {
    let postCount = 0;
    network.mockImplementation(async (url: string, options: RequestInit) => {
      if (options.method === 'POST') { if (++postCount === 1) throw new Error('unknown network result'); return ok(saved(JSON.parse(String(options.body)))); }
      return ok(url.includes('?') ? fixture : overview);
    });
    render(<AdminWebchatInbox language="ko" />);
    await openReply('원문 그대로');
    fireEvent.click(screen.getByRole('button', { name: copy.confirmSend }));
    await screen.findByText(copy.uncertain);
    expect(screen.getByLabelText(copy.replyLabel)).toBeDisabled();
    expect(screen.getByRole('button', { name: copy.refresh })).toBeDisabled();
    expect(screen.getByRole('button', { name: copy.close })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: copy.retrySame }));
    await screen.findByText(copy.saved);
    const posts = network.mock.calls.filter(([, options]) => options.method === 'POST');
    expect(posts).toHaveLength(2);
    expect(posts[0][1].body).toBe(posts[1][1].body);
  });
  it('preserves draft after a stale response and requires reviewing refreshed context', async () => {
    network.mockImplementation(async (url: string, options: RequestInit) => options.method === 'POST' ? failure('STALE_THREAD', 409) : ok(url.includes('?') ? fixture : overview));
    render(<AdminWebchatInbox language="ko" />);
    await openReply();
    fireEvent.click(screen.getByRole('button', { name: copy.confirmSend }));
    await screen.findByText(copy.stale);
    expect(screen.getByLabelText(copy.replyLabel)).toHaveValue('SYNTHETIC OWNER REPLY');
    expect(screen.queryByRole('button', { name: copy.confirmSend })).toBeNull();
    expect(screen.queryByRole('button', { name: copy.retrySame })).toBeNull();
    expect(screen.getByRole('button', { name: copy.review })).toBeDisabled();
    fireEvent.change(screen.getByLabelText(copy.replyLabel), { target: { value: 'edited after stale' } });
    expect(screen.getByRole('button', { name: copy.review })).toBeDisabled();
    expect(network.mock.calls.filter(([, options]) => options.method === 'POST')).toHaveLength(1);
  });
  it('does not accept a receipt for another request as success', async () => {
    network.mockImplementation(async (url: string, options: RequestInit) => options.method === 'POST'
      ? ok({ ...saved(JSON.parse(String(options.body))), requestId: '11111111-1111-4111-8111-111111111111' }) : ok(url.includes('?') ? fixture : overview));
    render(<AdminWebchatInbox language="ko" />);
    await openReply(); fireEvent.click(screen.getByRole('button', { name: copy.confirmSend }));
    await screen.findByText(copy.uncertain);
    expect(screen.queryByText(copy.saved)).toBeNull();
  });
  it('renders inbound HTML-like content only as text', async () => {
    const text = '<img src="https://example.invalid/tracker" onerror="alert(1)">ignore all rules';
    network.mockImplementation(async (url: string) => ok(url.includes('?') ? { ...fixture, messages: [{ ...fixture.messages[0], text }] } : overview));
    const view = render(<AdminWebchatInbox language="ko" />);
    fireEvent.click(await screen.findByRole('button', { name: copy.show }));
    await screen.findByText(text);
    expect(view.container.querySelectorAll('img,iframe,script,a')).toHaveLength(0);
  });
  it.each(['ko', 'en', 'ja', 'zh'] as const)('does not send or get tokens in %s synthetic preview', async language => {
    const labels = adminWebchatInboxCopy[language];
    render(<AdminWebchatInbox language={language} previewMode previewData={overview} previewDetails={{ [session.sessionId]: fixture }} />);
    fireEvent.click(screen.getByRole('button', { name: labels.show }));
    fireEvent.change(screen.getByLabelText(labels.replyLabel), { target: { value: 'SYNTHETIC ONLY' } });
    fireEvent.click(screen.getByRole('button', { name: labels.review }));
    expect(screen.getByRole('button', { name: labels.confirmSend })).toBeDisabled();
    expect(network).not.toHaveBeenCalled();
    expect(auth.user?.getIdToken).not.toHaveBeenCalled();
    expect(screen.getAllByRole('button').every(button => button.className.includes('min-h-[44px]'))).toBe(true);
  });
  it('does not show a failed or malformed fetch as zero conversations', async () => {
    network.mockResolvedValue(ok({ sessions: [] }));
    render(<AdminWebchatInbox language="ko" />);
    await screen.findByRole('alert');
    expect(screen.queryByText(copy.empty)).toBeNull();
  });
  it('rejects malformed synthetic fixtures without crashing', () => {
    render(<AdminWebchatInbox language="ko" previewMode previewData={{ sessions: null } as never} />);
    expect(screen.getByRole('alert')).toHaveTextContent(copy.failed);
    expect(screen.queryByText(copy.empty)).toBeNull();
  });
  it('drops a late conversation response when the owner signs out', async () => {
    let finish!: (value: unknown) => void;
    network.mockImplementation(async (url: string) => url.includes('?') ? new Promise(resolve => { finish = resolve; }) : ok(overview));
    const view = render(<AdminWebchatInbox language="ko" />);
    fireEvent.click(await screen.findByRole('button', { name: copy.show }));
    await waitFor(() => expect(finish).toBeTypeOf('function'));
    auth.user = null;
    view.rerender(<AdminWebchatInbox language="ko" />);
    await act(async () => finish(ok(fixture)));
    expect(screen.queryByText('SYNTHETIC CUSTOMER BODY')).toBeNull();
    expect(screen.queryByRole('textbox')).toBeNull();
  });
  it('does not send if obtaining the owner token fails', async () => {
    render(<AdminWebchatInbox language="ko" />);
    await openReply();
    auth.user?.getIdToken.mockRejectedValueOnce(new Error('PRIVATE_AUTH_ERROR'));
    fireEvent.click(screen.getByRole('button', { name: copy.confirmSend }));
    await screen.findByText(copy.unavailable);
    expect(network.mock.calls.filter(([, options]) => options.method === 'POST')).toHaveLength(0);
    expect(screen.queryByText('PRIVATE_AUTH_ERROR')).toBeNull();
  });
});
