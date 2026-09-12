// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OwnerDeviceTestPanel } from '@/components/OwnerDeviceTestPanel';
import { createOwnerDeviceTestAdapter } from '@/lib/ownerDeviceTest';
import { ownerDeviceTestCopy } from '@/components/ownerDeviceTestCopy';

const endpoint = 'https://fcm.googleapis.com/fcm/send/fake-own-device';
const account = { uid: 'fake-owner', getIdToken: vi.fn(async () => 'fake-token-not-real') };
const fetcher = vi.fn();
const getSubscription = vi.fn();
const response = (data: object, ok = true) => ({ ok, json: async () => data });
beforeEach(() => {
  fetcher.mockReset(); account.getIdToken.mockClear();
  getSubscription.mockReset().mockResolvedValue({ endpoint });
  vi.stubGlobal('fetch', fetcher);
  vi.stubGlobal('Notification', { permission: 'granted', requestPermission: vi.fn() });
  vi.stubGlobal('navigator', { serviceWorker: { getRegistration: vi.fn(async () => ({ pushManager: { getSubscription } })) } });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('this-device test transport', () => {
  it('does not request permission, register, authenticate or send until an explicit action', () => {
    createOwnerDeviceTestAdapter(account);
    expect(account.getIdToken).not.toHaveBeenCalled(); expect(fetcher).not.toHaveBeenCalled();
  });
  it('checks only current subscription, then sends to the same device with a stable request id', async () => {
    fetcher.mockResolvedValueOnce(response({ ok: true, data: { ready: true, code: 'READY' } }))
      .mockResolvedValue(response({ ok: true, data: { code: 'PROVIDER_ACCEPTED', providerAccepted: true, deliveryVerified: true } }));
    const adapter = createOwnerDeviceTestAdapter(account);
    expect((await adapter.check()).ready).toBe(true);
    expect((await adapter.send()).deliveryVerified).toBe(false);
    await adapter.send();
    const requests = fetcher.mock.calls.map(call => JSON.parse(call[1].body));
    expect(requests[0]).toEqual({ action: 'check', subscriptionId: `${account.uid}_${btoa(endpoint).slice(-32)}` });
    expect(requests[1]).toEqual({ ...requests[0], action: 'send', requestId: expect.any(String), confirmed: true });
    expect(requests[2].requestId).toBe(requests[1].requestId);
    expect(fetcher.mock.calls.every(call => call[0] === '/api/admin-owner-notification-test')).toBe(true);
    expect(JSON.stringify(requests)).not.toContain(endpoint);
    expect(Notification.requestPermission).not.toHaveBeenCalled();
  });
  it('never sends when permission is absent or the device changed after checking', async () => {
    const adapter = createOwnerDeviceTestAdapter(account);
    expect((await adapter.send()).code).toBe('DEVICE_CHANGED');
    expect(fetcher).not.toHaveBeenCalled();
    fetcher.mockResolvedValue(response({ ok: true, data: { ready: true, code: 'READY' } }));
    await adapter.check(); getSubscription.mockResolvedValue({ endpoint: `${endpoint}-changed` });
    expect((await adapter.send()).code).toBe('DEVICE_CHANGED');
    expect(fetcher).toHaveBeenCalledTimes(1);
    vi.stubGlobal('Notification', { permission: 'denied' });
    expect((await adapter.check()).code).toBe('DEVICE_NOT_READY');
  });
  it('does not treat a contradictory ready flag or non-OK response as ready', async () => {
    fetcher.mockResolvedValue(response({ ok: true, data: { ready: true, code: 'DISABLED' } }));
    const adapter = createOwnerDeviceTestAdapter(account);
    expect((await adapter.check()).ready).toBe(false);
    expect((await adapter.send()).code).toBe('DEVICE_CHANGED');
    fetcher.mockResolvedValue(response({ ok: false, code: 'ADMIN_REQUIRED' }, false));
    expect((await adapter.check()).ready).toBe(false);
  });
  it('classifies a lost send response as unknown, never prints raw errors', async () => {
    fetcher.mockResolvedValueOnce(response({ ok: true, data: { ready: true, code: 'READY' } }));
    const adapter = createOwnerDeviceTestAdapter(account); await adapter.check();
    fetcher.mockRejectedValue(new Error('private-provider-payload'));
    expect(await adapter.send()).toEqual({ code: 'OUTCOME_UNKNOWN' });
  });
  it('bounds slow authentication and cannot send later after the timeout', async () => {
    vi.useFakeTimers();
    let finish: (token: string) => void = () => {};
    const delayed = { uid: account.uid, getIdToken: () => new Promise<string>(resolve => { finish = resolve; }) };
    const operation = createOwnerDeviceTestAdapter(delayed).check();
    await vi.advanceTimersByTimeAsync(10_001);
    expect(await operation).toEqual({ code: 'CHECK_FAILED' });
    finish('fake-late-token'); await vi.advanceTimersByTimeAsync(1);
    expect(fetcher).not.toHaveBeenCalled();
  });
});

describe('this-device test controls', () => {
  it('checks explicitly, sends once, and never labels provider acceptance as actual receipt', async () => {
    const adapter = { check: vi.fn(async () => ({ ready: true, code: 'READY' })),
      send: vi.fn(async () => ({ code: 'PROVIDER_ACCEPTED' })) };
    render(<OwnerDeviceTestPanel adapter={adapter} />);
    expect(adapter.check).not.toHaveBeenCalled(); expect(adapter.send).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: ownerDeviceTestCopy.ko.send })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: ownerDeviceTestCopy.ko.check }));
    const sendButton = await screen.findByRole('button', { name: ownerDeviceTestCopy.ko.send });
    fireEvent.click(sendButton); fireEvent.click(sendButton);
    await screen.findByText(ownerDeviceTestCopy.ko.accepted);
    expect(adapter.send).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: ownerDeviceTestCopy.ko.check }));
    await waitFor(() => expect(adapter.check).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole('button', { name: ownerDeviceTestCopy.ko.send })).not.toBeInTheDocument();
    expect(screen.getByText(ownerDeviceTestCopy.ko.accepted)).toBeInTheDocument();
  });
  it.each(['DISABLED', 'DEVICE_NOT_SELECTED', 'OUTCOME_UNKNOWN'])('blocks sending for %s', async code => {
    const adapter = { check: vi.fn(async () => ({ ready: false, code })), send: vi.fn() };
    render(<OwnerDeviceTestPanel adapter={adapter} />);
    fireEvent.click(screen.getByRole('button', { name: ownerDeviceTestCopy.ko.check }));
    await waitFor(() => expect(screen.getByRole('button', { name: ownerDeviceTestCopy.ko.check })).not.toBeDisabled());
    expect(screen.queryByRole('button', { name: ownerDeviceTestCopy.ko.send })).not.toBeInTheDocument();
    expect(adapter.send).not.toHaveBeenCalled();
  });
  it('quarantines failed send responses even after another successful check', async () => {
    const adapter = { check: vi.fn(async () => ({ ready: true, code: 'READY' })), send: vi.fn(async () => { throw new Error('offline'); }) };
    render(<OwnerDeviceTestPanel adapter={adapter} />);
    fireEvent.click(screen.getByRole('button', { name: ownerDeviceTestCopy.ko.check }));
    fireEvent.click(await screen.findByRole('button', { name: ownerDeviceTestCopy.ko.send }));
    await screen.findByText(ownerDeviceTestCopy.ko.unknown);
    expect(screen.queryByRole('button', { name: ownerDeviceTestCopy.ko.send })).not.toBeInTheDocument();
  });
  it.each(['ko', 'en', 'ja', 'zh'] as const)('keeps all %s labels usable', language => {
    expect(Object.keys(ownerDeviceTestCopy[language])).toEqual(Object.keys(ownerDeviceTestCopy.ko));
    render(<OwnerDeviceTestPanel language={language} adapter={{ check: vi.fn(), send: vi.fn() }} />);
    expect(screen.getByRole('button', { name: ownerDeviceTestCopy[language].check })).toBeInTheDocument();
  });
});
