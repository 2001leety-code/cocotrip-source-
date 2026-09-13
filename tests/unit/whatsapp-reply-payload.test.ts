import { describe, it, expect } from 'vitest';
import { buildWhatsAppReplyPayload, normalizeWhatsAppSendReceipt } from '../../api/_shared/whatsapp-reply-payload.js';

const RECIPIENT = '821012345678';
const PROVIDER_ID = 'wamid.test_ABC-123=';
const input = { recipient: RECIPIENT, providerMessageId: PROVIDER_ID, text: ' Hello\nworld\tfrom test ' };
const receipt = { messaging_product: 'whatsapp', contacts: [{ input: RECIPIENT, wa_id: RECIPIENT }], messages: [{ id: PROVIDER_ID }] };
const normalized = (data = receipt, httpStatus = 200, expectedRecipient = RECIPIENT) =>
  normalizeWhatsAppSendReceipt({ data, httpStatus, expectedRecipient });

describe('buildWhatsAppReplyPayload', () => {
  it('builds exact request, preserving text and disabling URL previews', () => {
    expect(buildWhatsAppReplyPayload(input)).toEqual({ messaging_product: 'whatsapp', recipient_type: 'individual',
      to: RECIPIENT, context: { message_id: PROVIDER_ID }, type: 'text', text: { preview_url: false, body: input.text } });
  });
  it.each(['0821012345678', '+821012345678', '821012345678 ', '', '1'.repeat(21)])('rejects recipient %j', recipient => {
    expect(() => buildWhatsAppReplyPayload({ ...input, recipient })).toThrow('REPLY_CONTENT_INVALID');
  });
  it.each(['bad id', 'wamid.', 'wamid.x\n', 'wamid.' + 'x'.repeat(507)])('rejects context %j', providerMessageId => {
    expect(() => buildWhatsAppReplyPayload({ ...input, providerMessageId })).toThrow('REPLY_CONTENT_INVALID');
  });
  it.each(['', ' ', 'bad\u0001text', 'bad\rtext', 'bad\u007ftext', 'x'.repeat(4001)])('rejects text %#', text => {
    expect(() => buildWhatsAppReplyPayload({ ...input, text })).toThrow('REPLY_CONTENT_INVALID');
  });
});

describe('normalizeWhatsAppSendReceipt', () => {
  it('accepts only provider acceptance and never claims delivery', () => {
    expect(normalized()).toEqual({ status: 'provider_accepted', receiptVerified: true, providerMessageId: PROVIDER_ID });
    expect(normalized()).not.toHaveProperty('deliveryVerified');
  });
  it.each([0, 199, 300, 400, 429, 503, 200.1])('rejects non-2xx integer status %s', status => {
    expect(normalized(receipt, status)).toEqual({ status: 'outcome_unknown' });
  });
  it.each([
    { ...receipt, contacts: { input: RECIPIENT, wa_id: RECIPIENT } },
    { ...receipt, contacts: [] },
    { ...receipt, contacts: [{ input: RECIPIENT, wa_id: RECIPIENT + ' ' }] },
    { ...receipt, contacts: [{ input: '821012345679', wa_id: RECIPIENT }] },
    { ...receipt, messages: [{ id: PROVIDER_ID }, { id: PROVIDER_ID }] },
    { ...receipt, messages: [{ id: '' }] },
    { ...receipt, messages: [{ id: PROVIDER_ID, errors: [] }] },
    { ...receipt, messages: [{ id: PROVIDER_ID, message_status: 'held_for_quality_assessment' }] },
    { ...receipt, error: { message: 'synthetic' } },
    { ...receipt, message_status: 'held' },
    { ...receipt, messaging_product: 'sms' },
    [], null,
  ])('rejects malformed, mismatched or mixed receipt %#', data => {
    expect(normalizeWhatsAppSendReceipt({ data, httpStatus: 200, expectedRecipient: RECIPIENT })).toEqual({ status: 'outcome_unknown' });
  });
  it('rejects missing or invalid expected identity', () => {
    expect(normalizeWhatsAppSendReceipt()).toEqual({ status: 'outcome_unknown' });
    expect(normalized(receipt, 200, '')).toEqual({ status: 'outcome_unknown' });
  });
});
