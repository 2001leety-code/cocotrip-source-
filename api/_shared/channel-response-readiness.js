import { readCompanyGmailInboxConfig } from './company-gmail-inbox.js';
import { readWhatsAppInboxConfig } from './whatsapp-inbox.js';
import { readOwnerDispatchReadiness } from './ownerDispatchReadiness.js';

function enabled(env, key) {
  return String(env[key] || '').toLowerCase() === 'true';
}

function strictIsoMs(value) {
  const raw = String(value || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(raw)) return null;
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === raw ? parsed : null;
}

function boundedInteger(value, minimum, maximum) {
  const raw = String(value || '').trim();
  const parsed = /^\d+$/.test(raw) ? Number(raw) : Number.NaN;
  return Number.isSafeInteger(parsed) && parsed >= minimum && parsed <= maximum ? parsed : null;
}

function configuredString(env, key) {
  return typeof env[key] === 'string' && env[key].length > 0;
}

/** Mirrors the cron's environment gate without reading a credential or touching Firestore. */
export function readInquiryAutoAckEnvGate(env = {}) {
  if (!enabled(env, 'INQUIRY_RESPONSE_AUTO_ACK_ENABLED')) return { ready: false, reason: 'DISABLED' };
  if (!strictIsoMs(env.INQUIRY_RESPONSE_AUTO_ACK_NOT_BEFORE)) return { ready: false, reason: 'ACTIVATION_REQUIRED' };
  if (!boundedInteger(env.INQUIRY_RESPONSE_AUTO_ACK_MAX_AGE_MINUTES, 5, 1440)) return { ready: false, reason: 'MAX_AGE_REQUIRED' };
  if (!boundedInteger(env.INQUIRY_RESPONSE_AUTO_ACK_DAILY_CAP, 1, 100)) return { ready: false, reason: 'DAILY_CAP_REQUIRED' };
  return { ready: true, reason: 'CONFIGURED' };
}

function inboxReadiness(config) {
  return {
    ready: config.ready === true,
    reason: config.ready === true ? 'CONFIGURED' : config.reason || 'CONFIGURATION_REQUIRED',
    delivery: 'not-verified',
  };
}

function channel({ channel, implementation, supported, intake, autoAck, ownerPush }) {
  return { channel, implementation, supported, intake, autoAck, ownerPush };
}

/**
 * Public, read-only capability metadata for the operations center. It deliberately
 * reports configuration/readiness only: it never claims an external message or
 * notification was delivered.
 */
export function readChannelResponseReadiness({ env = process.env, runtimeAutoAckKnown = false, runtimeAutoAckEnabled = false, nowMs = Date.now() } = {}) {
  const autoAckGate = readInquiryAutoAckEnvGate(env);
  const smtpReady = configuredString(env, 'GMAIL_USER') && configuredString(env, 'GMAIL_APP_PASSWORD');
  const cronReady = typeof env.CRON_SECRET === 'string' && env.CRON_SECRET.trim().length > 0;
  const autoAckReady = runtimeAutoAckKnown && runtimeAutoAckEnabled === true && autoAckGate.ready && smtpReady && cronReady;
  const autoAckReason = !runtimeAutoAckKnown ? 'RUNTIME_FLAG_UNKNOWN'
    : !runtimeAutoAckEnabled ? 'RUNTIME_FLAG_OFF'
      : !autoAckGate.ready ? autoAckGate.reason
        : !smtpReady ? 'DELIVERY_CREDENTIALS_REQUIRED'
          : !cronReady ? 'CRON_AUTH_REQUIRED' : 'CONFIGURED';
  const owner = readOwnerDispatchReadiness(env);
  const ownerPush = { ready: owner.state === 'configured', reason: owner.state, delivery: 'not-verified' };
  const email = readCompanyGmailInboxConfig(env, nowMs);
  const whatsapp = readWhatsAppInboxConfig(env, nowMs);
  const noAutoAck = { ready: false, reason: 'NOT_SUPPORTED', delivery: 'not-verified' };
  const noOwnerPush = { ready: false, reason: 'NOT_IMPLEMENTED', delivery: 'not-verified' };

  return {
    autoAck: { ready: autoAckReady, reason: autoAckReason, delivery: 'not-verified' },
    channels: [
      channel({ channel: 'webform', implementation: 'inquiry-submit', supported: true,
        intake: { status: 'implemented', detail: 'server-validated-form' },
        autoAck: { ready: autoAckReady, reason: autoAckReason, delivery: 'not-verified' }, ownerPush }),
      channel({ channel: 'webchat', implementation: 'chat_sessions', supported: true,
        intake: { status: 'implemented', detail: 'browser-chat-session' }, autoAck: noAutoAck, ownerPush }),
      channel({ channel: 'email', implementation: 'company-gmail-readonly', supported: true,
        intake: { status: email.ready ? 'configured' : 'not_ready', detail: inboxReadiness(email).reason }, autoAck: noAutoAck,
        ownerPush: { ...ownerPush, inbox: inboxReadiness(email) } }),
      channel({ channel: 'whatsapp', implementation: 'explicit-session-webhook', supported: true,
        intake: { status: whatsapp.ready ? 'configured' : 'not_ready', detail: inboxReadiness(whatsapp).reason }, autoAck: noAutoAck,
        ownerPush: { ...ownerPush, inbox: inboxReadiness(whatsapp) } }),
      channel({ channel: 'instagram', implementation: 'not-implemented', supported: false,
        intake: { status: 'not_implemented', detail: 'dm-intake-not-implemented' }, autoAck: noAutoAck, ownerPush: noOwnerPush }),
      channel({ channel: 'tiktok', implementation: 'not-implemented', supported: false,
        intake: { status: 'not_implemented', detail: 'dm-intake-not-implemented' }, autoAck: noAutoAck, ownerPush: noOwnerPush }),
    ],
  };
}
