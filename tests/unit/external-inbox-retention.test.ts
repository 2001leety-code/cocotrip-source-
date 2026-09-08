import { describe, it, expect } from 'vitest'
import {
  inboxCaseId,
  validInboxCase,
  nextInboxCaseOnMessage,
  inboxCaseAllowsRead,
  publicInboxCase,
  transitionInboxCase,
  validInboxRetentionRequest,
} from '../../api/_shared/external-inbox-retention.js'

const NOW = 1800000000000
const DAY = 86_400_000

const baseData = {
  channel: 'email' as const,
  accountId: 'ops@example.invalid',
  providerThreadId: 'thread-1',
  sourceAtMs: NOW,
  receivedAtMs: NOW,
}

function newCaseAt(timeMs: number, data = baseData) {
  return nextInboxCaseOnMessage(null, { ...data, sourceAtMs: timeMs, receivedAtMs: timeMs }, timeMs)
}

type CaseRecord = ReturnType<typeof newCaseAt>
function closeCase(caseRecord: CaseRecord, nowMs: number) {
  return transitionInboxCase(caseRecord, {
    action: 'close',
    expectedRevision: caseRecord.revision,
    confirmation: 'ordinary_no_evidence',
    nowMs,
  })
}

describe('inbox case helpers', () => {
  it('creates a new case with exact baseline fields', () => {
    const item = newCaseAt(NOW)

    expect(item.policyVersion).toBe(2)
    expect(item.caseId).toBeTypeOf('string')
    expect(item.status).toBe('open')
    expect(item.revision).toBe(1)
    expect(item.createdAtMs).toBe(NOW)
    expect(item.lastActivityAtMs).toBe(NOW)
    expect(item.updatedAtMs).toBe(NOW)
    expect(item.reviewAfterMs).toBe(NOW + 30 * DAY)
    expect(item.closedAtMs).toBe(0)
    expect(item.deleteAfterMs).toBe(0)
    expect(item.expiredThroughMs).toBe(0)
    expect(item.cleanupDueAtMs).toBe(0)
    expect(item.cleanupCursor).toBe('')
    expect(item.closureBasis).toBe('')
  })

  it('generates deterministic case ids for identical data', () => {
    const first = inboxCaseId(baseData)
    const second = inboxCaseId(baseData)
    expect(first).toBe(second)
  })

  it.each([
    [{ ...baseData, accountId: 'other@example.invalid' }],
    [{ ...baseData, providerThreadId: 'thread-2' }],
  ])('changes case id when input differs (%j)', (altData) => {
    expect(inboxCaseId(baseData)).not.toBe(inboxCaseId(altData))
  })

  it('validates matching case id as true', () => {
    const item = newCaseAt(NOW)
    expect(validInboxCase(item, item.caseId)).toBe(true)
  })

  it('returns false for mismatched case id', () => {
    const item = newCaseAt(NOW)
    const another = inboxCaseId({ ...baseData, accountId: 'another@example.invalid' })
    expect(validInboxCase(item, another)).toBe(false)
  })

  it('throws for invalid inboxCaseId input', () => {
    expect(() => inboxCaseId(null as unknown)).toThrow()
    expect(() => inboxCaseId({ ...baseData, channel: '' as unknown as 'email' })).toThrow()
  })

  it('throws when nextInboxCaseOnMessage receives invalid data', () => {
    expect(() =>
      nextInboxCaseOnMessage(null, { ...baseData, channel: 'invalid' as unknown as 'email', sourceAtMs: NOW, receivedAtMs: NOW }, NOW),
    ).toThrow()
    expect(() =>
      nextInboxCaseOnMessage(null, { ...baseData, sourceAtMs: NOW + 1, receivedAtMs: NOW }, NOW),
    ).toThrow()
  })

  it('computes public summary with only allowed fields', () => {
    const item = newCaseAt(NOW)
    const pub = publicInboxCase(item, NOW)

    expect(pub).toEqual({
      caseId: item.caseId,
      status: item.status,
      revision: item.revision,
      closedAtMs: item.closedAtMs,
      deleteAfterMs: item.deleteAfterMs,
      reviewRequired: false,
    })
    expect(Object.keys(pub).sort()).toEqual([
      'caseId',
      'closedAtMs',
      'deleteAfterMs',
      'revision',
      'reviewRequired',
      'status',
    ].sort())
  })

  it('marks reviewRequired when open case reaches reviewAfterMs', () => {
    const item = newCaseAt(NOW)
    const beforeReview = publicInboxCase(item, item.reviewAfterMs - 1)
    const atReview = publicInboxCase(item, item.reviewAfterMs)
    const protectedCase = transitionInboxCase({ ...item, caseId: item.caseId }, {
      action: 'protect',
      expectedRevision: item.revision,
      nowMs: NOW + 1,
    })
    const protectedAtReview = publicInboxCase(protectedCase, protectedCase.reviewAfterMs)

    expect(beforeReview.reviewRequired).toBe(false)
    expect(atReview.reviewRequired).toBe(true)
    expect(protectedAtReview.reviewRequired).toBe(true)
  })

  it('returns closed case with reviewRequired false', () => {
    const item = newCaseAt(NOW)
    const closed = closeCase(item, NOW + DAY)
    const pub = publicInboxCase(closed, closed.deleteAfterMs)
    expect(pub.status).toBe('closed')
    expect(pub.reviewRequired).toBe(false)
  })

  it('requires confirmation for close and applies deletion deadline', () => {
    const item = newCaseAt(NOW)
    const closeTime = NOW + DAY
    const closed = transitionInboxCase(item, {
      action: 'close',
      expectedRevision: item.revision,
      confirmation: 'ordinary_no_evidence',
      nowMs: closeTime,
    })

    expect(closed.status).toBe('closed')
    expect(closed.closedAtMs).toBe(closeTime)
    expect(closed.deleteAfterMs).toBe(closeTime + 30 * DAY)
    expect(closed.revision).toBe(item.revision + 1)
  })

  it('throws on stale revision and missing confirmation for close', () => {
    const item = newCaseAt(NOW)

    expect(() =>
      transitionInboxCase(item, {
        action: 'close',
        expectedRevision: item.revision + 5,
        confirmation: 'ordinary_no_evidence',
        nowMs: NOW + DAY,
      }),
    ).toThrow()

    expect(() =>
      transitionInboxCase(item, {
        action: 'close',
        expectedRevision: item.revision,
        nowMs: NOW + DAY,
      } as unknown as Parameters<typeof transitionInboxCase>[1]),
    ).toThrow()
  })

  it('disallows confirmation on non-close actions', () => {
    const item = newCaseAt(NOW)

    expect(() =>
      transitionInboxCase(item, {
        action: 'protect',
        expectedRevision: item.revision,
        confirmation: 'ordinary_no_evidence',
        nowMs: NOW + 1,
      } as unknown as Parameters<typeof transitionInboxCase>[1]),
    ).toThrow()
  })

  it('allows reopen before close deadline but not after', () => {
    const item = newCaseAt(NOW)
    const closed = closeCase(item, NOW + DAY)
    const reopened = transitionInboxCase(closed, {
      action: 'reopen',
      expectedRevision: closed.revision,
      nowMs: closed.closedAtMs + DAY,
    })

    expect(reopened.status).toBe('open')
    expect(reopened.revision).toBe(closed.revision + 1)

    expect(() =>
      transitionInboxCase(closed, {
        action: 'reopen',
        expectedRevision: closed.revision,
        nowMs: closed.deleteAfterMs,
      }),
    ).toThrow()
  })

  it('prevents reopen after case is expired', () => {
    const item = newCaseAt(NOW)
    const closed = closeCase(item, NOW + DAY)

    expect(() =>
      transitionInboxCase(closed, {
        action: 'reopen',
        expectedRevision: closed.revision,
        nowMs: NOW + 40 * DAY,
      }),
    ).toThrow()
  })

  it('keeps protected case from close or reopen transitions', () => {
    const item = newCaseAt(NOW)
    const protectedCase = transitionInboxCase(item, {
      action: 'protect',
      expectedRevision: item.revision,
      nowMs: NOW + DAY,
    })

    expect(protectedCase.status).toBe('protected')

    expect(() =>
      transitionInboxCase(protectedCase, {
        action: 'close',
        expectedRevision: protectedCase.revision,
        confirmation: 'ordinary_no_evidence',
        nowMs: NOW + 2 * DAY,
      }),
    ).toThrow()

    expect(() =>
      transitionInboxCase(protectedCase, {
        action: 'reopen',
        expectedRevision: protectedCase.revision,
        nowMs: NOW + 2 * DAY,
      }),
    ).toThrow()
  })

  it('reopens automatically from new incoming message at/after old deadline and records expiredThroughMs', () => {
    const item = newCaseAt(NOW)
    const closed = closeCase(item, NOW + DAY)
    const reopenMessage = {
      ...baseData,
      sourceAtMs: closed.deleteAfterMs,
      receivedAtMs: closed.deleteAfterMs,
    }
    const reopened = nextInboxCaseOnMessage(closed, reopenMessage, closed.deleteAfterMs)

    expect(reopened.status).toBe('open')
    expect(reopened.expiredThroughMs).toBe(closed.closedAtMs)
  })

  it('denies reads for messages older than expiredThroughMs even after reopen, but allows newer', () => {
    const item = newCaseAt(NOW)
    const closed = closeCase(item, NOW + DAY)
    const reopened = nextInboxCaseOnMessage(closed, {
      ...baseData,
      sourceAtMs: closed.deleteAfterMs,
      receivedAtMs: closed.deleteAfterMs,
    }, closed.deleteAfterMs)

    expect(inboxCaseAllowsRead(reopened, reopened.caseId, reopened.updatedAtMs + DAY, {
      receivedAtMs: reopened.expiredThroughMs,
    })).toBe(false)

    expect(inboxCaseAllowsRead(reopened, reopened.caseId, reopened.updatedAtMs + DAY, {
      receivedAtMs: reopened.expiredThroughMs + 1,
    })).toBe(true)
  })

  it('prevents reads at delete deadline and allows reads just before', () => {
    const item = newCaseAt(NOW)
    const closed = closeCase(item, NOW + DAY)
    const deadline = closed.deleteAfterMs

    expect(
      inboxCaseAllowsRead(closed, closed.caseId, deadline - 1, {
        receivedAtMs: NOW,
      }),
    ).toBe(true)

    expect(
      inboxCaseAllowsRead(closed, closed.caseId, deadline, {
        receivedAtMs: NOW,
      }),
    ).toBe(false)
  })

  it('keeps a protected case protected when a fresh message arrives', () => {
    const item = newCaseAt(NOW)
    const protectedCase = transitionInboxCase(item, {
      action: 'protect',
      expectedRevision: item.revision,
      nowMs: NOW + DAY,
    })
    const after = nextInboxCaseOnMessage(protectedCase, {
      ...baseData,
      sourceAtMs: NOW + 2 * DAY,
      receivedAtMs: NOW + 2 * DAY,
    }, NOW + 2 * DAY)

    expect(after.status).toBe('protected')
    expect(after.revision).toBe(protectedCase.revision + 1)
  })

  it.each([
    [{ action: 'close' as const, expectedRevision: 1, confirmation: 'ordinary_no_evidence' }, true],
    [{ action: 'reopen' as const, expectedRevision: 2 }, true],
    [{ action: 'protect' as const, expectedRevision: 1 }, true],
  ])('validInboxRetentionRequest accepts exactly %s', (input, ok) => {
    const baseRequest = {
      messageId: 'a'.repeat(64),
      expectedRevision: 1,
      action: 'close',
      confirmation: 'ordinary_no_evidence',
    }
    const payload =
      input.action === 'close'
        ? {
            ...baseRequest,
            action: input.action,
            expectedRevision: input.expectedRevision,
            confirmation: input.confirmation,
          }
        : {
            messageId: 'a'.repeat(64),
            expectedRevision: input.expectedRevision,
            action: input.action,
          }

    expect(validInboxRetentionRequest(payload)).toBe(ok)
  })

  it.each([
    { messageId: 'g'.repeat(64), expectedRevision: 1, action: 'close', confirmation: 'ordinary_no_evidence' },
    { messageId: 'a'.repeat(63), expectedRevision: 1, action: 'close', confirmation: 'ordinary_no_evidence' },
    { messageId: 'A'.repeat(64), expectedRevision: 1, action: 'close', confirmation: 'ordinary_no_evidence' },
    { messageId: 'a'.repeat(64), expectedRevision: 0, action: 'close', confirmation: 'ordinary_no_evidence' },
    { messageId: 'a'.repeat(64), expectedRevision: 1, action: 'close' as unknown as 'reopen' },
    { messageId: 'a'.repeat(64), expectedRevision: 1, action: 'close', confirmation: 'wrong_value' },
    { messageId: 'a'.repeat(64), expectedRevision: '1' as unknown as number, action: 'close', confirmation: 'ordinary_no_evidence' },
    { messageId: 'a'.repeat(64), expectedRevision: true as unknown as number, action: 'reopen' },
    { messageId: 'a'.repeat(64), expectedRevision: 2, action: 'close', confirmation: 'ordinary_no_evidence', extra: 'nope' },
  ])('validInboxRetentionRequest rejects bad payload: %j', (payload) => {
    expect(validInboxRetentionRequest(payload as unknown)).toBe(false)
  })
})
