import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const transport = vi.hoisted(() => ({ sendNotification: vi.fn() }));
vi.mock('web-push', () => ({ default: transport }));

import { sendSingleOwnerPush } from '../../api/_shared/owner-notification-delivery.js';

const RAW_PROVIDER_TEXT = 'untrusted-provider-response-must-not-be-logged';
const subscription = { endpoint: 'https://push.example.invalid/owner-device', keys: { p256dh: 'key', auth: 'auth' } };
const payload = { title: 'Owner event', body: 'Test notification' };
const config = { subject: 'mailto:owner@example.invalid', publicKey: 'public-test-key', privateKey: 'private-test-key' };
let warn: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  transport.sendNotification.mockReset();
  warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => vi.restoreAllMocks());

describe('owner push delivery diagnostics', () => {
  it.each([
    [403, 'rejected'],
    [410, 'rejected'],
    [429, 'retryable'],
    [503, 'retryable'],
  ])('logs allowlisted provider HTTP %s without provider text', async (statusCode, outcome) => {
    transport.sendNotification.mockRejectedValue({
      statusCode,
      message: RAW_PROVIDER_TEXT,
      body: RAW_PROVIDER_TEXT,
      headers: { authorization: RAW_PROVIDER_TEXT },
      endpoint: RAW_PROVIDER_TEXT,
    });

    await expect(sendSingleOwnerPush(subscription, payload, config)).resolves.toEqual({ outcome });
    expect(warn).toHaveBeenCalledWith('[owner-push-delivery]', { phase: 'PROVIDER', outcome, status: statusCode });
    expect(JSON.stringify(warn.mock.calls)).not.toContain(RAW_PROVIDER_TEXT);
  });

  it('logs a network failure as unknown without a provider status', async () => {
    transport.sendNotification.mockRejectedValue(new Error(RAW_PROVIDER_TEXT));

    await expect(sendSingleOwnerPush(subscription, payload, config)).resolves.toEqual({ outcome: 'unknown' });
    expect(warn).toHaveBeenCalledWith('[owner-push-delivery]', { phase: 'UNKNOWN', outcome: 'unknown', status: null });
    expect(JSON.stringify(warn.mock.calls)).not.toContain(RAW_PROVIDER_TEXT);
  });

  it('does not treat a string status as a provider status', async () => {
    transport.sendNotification.mockRejectedValue({ statusCode: '503', message: RAW_PROVIDER_TEXT });

    await expect(sendSingleOwnerPush(subscription, payload, config)).resolves.toEqual({ outcome: 'unknown' });
    expect(warn).toHaveBeenCalledWith('[owner-push-delivery]', { phase: 'UNKNOWN', outcome: 'unknown', status: null });
    expect(JSON.stringify(warn.mock.calls)).not.toContain(RAW_PROVIDER_TEXT);
  });

  it('does not log a successful provider response', async () => {
    transport.sendNotification.mockResolvedValue({ statusCode: 201 });

    await expect(sendSingleOwnerPush(subscription, payload, config)).resolves.toEqual({ outcome: 'accepted' });
    expect(warn).not.toHaveBeenCalled();
  });
});
