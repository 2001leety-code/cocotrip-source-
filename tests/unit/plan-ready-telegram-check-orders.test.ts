import { beforeEach, describe, expect, it, vi } from 'vitest';

const sendMessage = vi.hoisted(() => vi.fn(async () => ({ ok: true })));
vi.mock('../../api/_telegram.js', () => ({ sendMessage }));
vi.mock('../../api/_send-push.js', () => ({ sendPushToUser: vi.fn() }));

describe('plan-created Telegram operator alert', () => {
  beforeEach(() => sendMessage.mockClear());

  it('suppresses only automated health-check orders', async () => {
    const { sendPlanCreatedTelegram } = await import('../../api/_plan-ready-push.js');

    for (const orderId of [
      'ADMIN-BYPASS-VALIDATE-123',
      'ADMIN-BYPASS-E2E-123',
      'ADMIN-BYPASS-REGRESSION-123',
    ]) {
      await sendPlanCreatedTelegram({ orderId, planId: 'plan-test' });
    }
    expect(sendMessage).not.toHaveBeenCalled();

    await sendPlanCreatedTelegram({ orderId: 'PAYPAL-123', planId: 'real-plan' });
    await sendPlanCreatedTelegram({ orderId: 'ADMIN-BYPASS-MANUAL-123', planId: 'manual-plan' });
    expect(sendMessage).toHaveBeenCalledTimes(2);
  });
});
