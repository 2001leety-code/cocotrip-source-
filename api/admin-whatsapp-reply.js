import { createAdminExternalInboxReplyHandler, validExternalInboxReplyAction } from './_shared/admin-external-inbox-reply.js';
import { readWhatsAppInboxConfig } from './_shared/whatsapp-inbox.js';
import { createWhatsAppReplyResolver } from './_shared/whatsapp-reply-source.js';
import { createWhatsAppReplySender, readWhatsAppReplyConfig } from './_shared/whatsapp-reply-sender.js';

export const maxDuration = 30;
export const config = { runtime: 'nodejs' };
export const validWhatsAppReplyAction = input => validExternalInboxReplyAction(input, 'whatsapp');

/** Explicit human approval only. No templates, bulk messages or automatic acknowledgements. */
export function createAdminWhatsAppReplyHandler(options = {}) {
  return createAdminExternalInboxReplyHandler({ resolverFactory: createWhatsAppReplyResolver,
    senderFactory: createWhatsAppReplySender, ...options, channel: 'whatsapp',
    readInboxConfig: readWhatsAppInboxConfig, readReplyConfig: readWhatsAppReplyConfig });
}

export default createAdminWhatsAppReplyHandler();
