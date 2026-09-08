import { describe, expect, it } from 'vitest';
import { readChannelResponseReadiness, readInquiryAutoAckEnvGate } from '../../api/_shared/channel-response-readiness.js';

const NOW = Date.parse('2026-09-08T12:00:00.000Z');
const env = () => ({
  VERCEL_ENV: 'production',
  INQUIRY_RESPONSE_AUTO_ACK_ENABLED: 'true',
  INQUIRY_RESPONSE_AUTO_ACK_NOT_BEFORE: '2026-09-08T11:00:00.000Z',
  INQUIRY_RESPONSE_AUTO_ACK_MAX_AGE_MINUTES: '30',
  INQUIRY_RESPONSE_AUTO_ACK_DAILY_CAP: '10',
  GMAIL_USER: 'sender@example.invalid', GMAIL_APP_PASSWORD: 'not-a-real-secret',
  CRON_SECRET: 'not-a-real-secret',
});

describe('channel response readiness', () => {
  it('requires the exact cron auto-ack environment gate before a DB flag can be ready', () => {
    expect(readInquiryAutoAckEnvGate(env())).toEqual({ ready: true, reason: 'CONFIGURED' });
    expect(readInquiryAutoAckEnvGate({ ...env(), INQUIRY_RESPONSE_AUTO_ACK_MAX_AGE_MINUTES: '30 minutes' }))
      .toEqual({ ready: false, reason: 'MAX_AGE_REQUIRED' });
    expect(readChannelResponseReadiness({ env: { ...env(), GMAIL_APP_PASSWORD: '' }, runtimeAutoAckKnown: true, runtimeAutoAckEnabled: true, nowMs: NOW }).autoAck)
      .toEqual({ ready: false, reason: 'DELIVERY_CREDENTIALS_REQUIRED', delivery: 'not-verified' });
    expect(readChannelResponseReadiness({ env: env(), runtimeAutoAckKnown: true, runtimeAutoAckEnabled: false, nowMs: NOW }).autoAck)
      .toEqual({ ready: false, reason: 'RUNTIME_FLAG_OFF', delivery: 'not-verified' });
  });

  it('reports channel implementation separately from configuration and never claims delivery', () => {
    const readiness = readChannelResponseReadiness({ env: env(), runtimeAutoAckKnown: true, runtimeAutoAckEnabled: true, nowMs: NOW });
    expect(readiness.autoAck).toEqual({ ready: true, reason: 'CONFIGURED', delivery: 'not-verified' });
    expect(readiness.channels.map((entry) => entry.channel)).toEqual(['webform', 'webchat', 'email', 'whatsapp', 'instagram', 'tiktok']);
    expect(readiness.channels.find((entry) => entry.channel === 'webform')).toMatchObject({ implementation: 'inquiry-submit', intake: { status: 'implemented' } });
    expect(readiness.channels.find((entry) => entry.channel === 'webchat')).toMatchObject({ implementation: 'chat_sessions', intake: { status: 'implemented' } });
    expect(readiness.channels.find((entry) => entry.channel === 'instagram')).toMatchObject({ supported: false, intake: { status: 'not_implemented' } });
    expect(JSON.stringify(readiness)).not.toContain('not-a-real-secret');
    expect(JSON.stringify(readiness)).not.toContain('sender@example.invalid');
  });
});
