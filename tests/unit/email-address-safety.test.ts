import { describe, expect, it } from 'vitest';
import { maskEmailForLog } from '../../api/_send-email.js';
import { validInquiryResponseEmail } from '../../api/_shared/inquiry-email.js';

describe('customer email address safety', () => {
  it.each([
    'victim@example.com,other@example.com',
    'Name<a@example.com>',
    'a@b.com\r\nBcc:x@y.com',
    'a@@b.com',
    'a@b.com;other@x.com',
  ])('rejects multiple or header-like recipients: %s', (value) => {
    expect(validInquiryResponseEmail(value)).toBeNull();
  });

  it('normalizes one valid mailbox', () => {
    expect(validInquiryResponseEmail(' Stored.User+Trip@Example.COM '))
      .toBe('stored.user+trip@example.com');
  });

  it('does not expose the full local part in delivery logs', () => {
    const masked = maskEmailForLog('stored.user@example.com');
    expect(masked).toBe('s***@example.com');
    expect(masked).not.toContain('stored.user');
    expect(maskEmailForLog('invalid')).toBe('[redacted-recipient]');
  });
});
