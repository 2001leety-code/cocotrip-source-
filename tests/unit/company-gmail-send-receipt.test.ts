import { describe, it, expect } from 'vitest';
import { normalizeGmailSendReceipt } from '../../api/_shared/company-gmail-reply-sender.js';

type ReceiptInput = {
  httpStatus: unknown;
  data: unknown;
  expectedThreadId: unknown;
};

type ValidReceipt = {
  status: 'provider_accepted';
  receiptVerified: true;
  providerMessageId: string;
};

type InvalidReceipt = {
  status: 'outcome_unknown';
};

type ReceiptResult = ValidReceipt | InvalidReceipt;

const msgId = 'msg-123';
const threadId = 'thread-456';

type Case = {
  name: string;
  input: ReceiptInput;
  expectValid: boolean;
};

const cases: Case[] = [
  {
    name: 'returns provider_accepted for 200 with matching thread and valid ids',
    input: { httpStatus: 200, data: { id: msgId, threadId }, expectedThreadId: threadId },
    expectValid: true,
  },
  {
    name: 'returns provider_accepted for 202 with matching thread and valid ids',
    input: { httpStatus: 202, data: { id: msgId, threadId }, expectedThreadId: threadId },
    expectValid: true,
  },
  { name: 'returns outcome_unknown for httpStatus 400', input: { httpStatus: 400, data: { id: msgId, threadId }, expectedThreadId: threadId }, expectValid: false },
  { name: 'returns outcome_unknown for httpStatus 500', input: { httpStatus: 500, data: { id: msgId, threadId }, expectedThreadId: threadId }, expectValid: false },
  { name: 'returns outcome_unknown for httpStatus 199', input: { httpStatus: 199, data: { id: msgId, threadId }, expectedThreadId: threadId }, expectValid: false },
  { name: 'returns outcome_unknown for httpStatus 300', input: { httpStatus: 300, data: { id: msgId, threadId }, expectedThreadId: threadId }, expectValid: false },
  { name: 'returns outcome_unknown for string status', input: { httpStatus: '200', data: { id: msgId, threadId }, expectedThreadId: threadId }, expectValid: false },
  { name: 'returns outcome_unknown when data.id is missing', input: { httpStatus: 200, data: { threadId }, expectedThreadId: threadId }, expectValid: false },
  { name: 'returns outcome_unknown when data.id has newline', input: { httpStatus: 200, data: { id: 'msg\n123', threadId }, expectedThreadId: threadId }, expectValid: false },
  { name: 'returns outcome_unknown when data.threadId does not match expectedThreadId', input: { httpStatus: 200, data: { id: msgId, threadId: 'thread-999' }, expectedThreadId: threadId }, expectValid: false },
  { name: 'returns outcome_unknown when data.threadId is missing', input: { httpStatus: 200, data: { id: msgId }, expectedThreadId: threadId }, expectValid: false },
  { name: 'returns outcome_unknown when data is null', input: { httpStatus: 200, data: null, expectedThreadId: threadId }, expectValid: false },
  { name: 'returns outcome_unknown when data is array', input: { httpStatus: 200, data: [], expectedThreadId: threadId }, expectValid: false },
];

describe('normalizeGmailSendReceipt', () => {
  it.each(cases)('$name', ({ input, expectValid }) => {
    const result = normalizeGmailSendReceipt(input) as ReceiptResult;

    if (expectValid) {
      expect(result).toEqual({
        status: 'provider_accepted',
        receiptVerified: true,
        providerMessageId: msgId,
      });
      expect(result).not.toHaveProperty('deliveryVerified', true);
      expect(result).not.toHaveProperty('readVerified', true);
      return;
    }

    expect(result).toEqual({ status: 'outcome_unknown' } as InvalidReceipt);
    expect(result).not.toHaveProperty('deliveryVerified', true);
    expect(result).not.toHaveProperty('readVerified', true);
  });
});
