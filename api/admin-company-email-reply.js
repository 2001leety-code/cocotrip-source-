import { createAdminExternalInboxReplyHandler, validExternalInboxReplyAction } from './_shared/admin-external-inbox-reply.js';
import { readCompanyGmailInboxConfig } from './_shared/company-gmail-inbox.js';
import { createCompanyGmailReplyResolver } from './_shared/company-gmail-reply-source.js';
import { createCompanyGmailSender, readCompanyGmailReplyConfig } from './_shared/company-gmail-reply-sender.js';

export const maxDuration = 30;
export const config = { runtime: 'nodejs' };
export const validCompanyEmailReplyAction = input => validExternalInboxReplyAction(input, 'email');

export function createAdminCompanyEmailReplyHandler(options = {}) {
  return createAdminExternalInboxReplyHandler({ resolverFactory: createCompanyGmailReplyResolver,
    senderFactory: createCompanyGmailSender, ...options, channel: 'email',
    readInboxConfig: readCompanyGmailInboxConfig, readReplyConfig: readCompanyGmailReplyConfig });
}

export default createAdminCompanyEmailReplyHandler();
