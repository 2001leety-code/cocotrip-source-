function hasOwnErrorLike(value) {
  return Object.hasOwn(value, 'error') || Object.hasOwn(value, 'errors');
}
function isPlainObject(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value)
    && [Object.prototype, null].includes(Object.getPrototypeOf(value)));
}
function hasIllegalControlChars(value) {
  for (let i = 0; i < value.length; i++) {
    const c = value.charCodeAt(i);
    if ((c < 32 && c !== 9 && c !== 10) || c === 127) return true;
  }
  return false;
}
function isValidRecipient(recipient) {
  return typeof recipient === 'string' && /^[1-9]\d{0,19}$/.test(recipient);
}
function isValidProviderMessageId(value) {
  return typeof value === 'string' && value.length <= 512 && /^wamid\.[A-Za-z0-9_+=./-]+$/.test(value);
}
function isValidText(text) {
  return typeof text === 'string' && text.trim().length > 0 && text.length <= 4000 && !hasIllegalControlChars(text);
}

/** Syntax only. Never grants consent, approval or send authority. */
export function buildWhatsAppReplyPayload({ recipient, providerMessageId, text } = {}) {
  if (!isValidRecipient(recipient) || !isValidProviderMessageId(providerMessageId) || !isValidText(text)) {
    throw new Error('REPLY_CONTENT_INVALID');
  }
  return { messaging_product: 'whatsapp', recipient_type: 'individual', to: recipient,
    context: { message_id: providerMessageId }, type: 'text', text: { preview_url: false, body: text } };
}

/** A matched Graph API response proves acceptance, NOT delivery to the customer's phone. */
export function normalizeWhatsAppSendReceipt({ httpStatus, data, expectedRecipient } = {}) {
  const unknown = () => ({ status: 'outcome_unknown' });
  if (!isValidRecipient(expectedRecipient) || !Number.isInteger(httpStatus) || httpStatus < 200 || httpStatus > 299) return unknown();
  if (!isPlainObject(data) || data.messaging_product !== 'whatsapp' || hasOwnErrorLike(data)) return unknown();
  if (Object.hasOwn(data, 'message_status') && data.message_status !== 'accepted') return unknown();
  if (!Array.isArray(data.contacts) || data.contacts.length !== 1
    || !Array.isArray(data.messages) || data.messages.length !== 1) return unknown();
  const contact = data.contacts[0];
  const message = data.messages[0];
  if (!isPlainObject(contact) || !isPlainObject(message) || hasOwnErrorLike(contact) || hasOwnErrorLike(message)) return unknown();
  if (contact.input !== expectedRecipient || contact.wa_id !== expectedRecipient || !isValidProviderMessageId(message.id)) return unknown();
  if (Object.hasOwn(message, 'message_status') && message.message_status !== 'accepted') return unknown();
  return { status: 'provider_accepted', receiptVerified: true, providerMessageId: message.id };
}
