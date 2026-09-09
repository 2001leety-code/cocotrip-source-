import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  externalInboxChannelStatus, externalInboxConfigs, loadExternalInbox, loadExternalInboxDetail, publicExternalInboxMessage,
} from '../../api/_shared/adminExternalInboxRead.js';
import { prepareExternalInboxMessage } from '../../api/_shared/external-inbox-store.js';
import { nextInboxCaseOnMessage } from '../../api/_shared/external-inbox-retention.js';
import { sessionDocId } from '../../api/_shared/whatsapp-support-sessions.js';

const NOW = Date.parse('2026-09-08T06:00:00.000Z');
const START = NOW - 60_000;
const PRIVATE = 'FAKE_BODY_CURSOR_TOKEN_NOT_FOR_LIST';
type Row = Record<string, unknown>;
function env() {
  return { COMPANY_GMAIL_INBOX_ENABLED: 'true', COMPANY_GMAIL_INBOX_EMAIL: 'cocotripkr@gmail.com',
    COMPANY_GMAIL_INBOX_CLIENT_ID: 'fake-id', COMPANY_GMAIL_INBOX_CLIENT_SECRET: PRIVATE, COMPANY_GMAIL_INBOX_REFRESH_TOKEN: PRIVATE,
    COMPANY_GMAIL_INBOX_CAPTURE_START_AT: new Date(START).toISOString(), COMPANY_GMAIL_INBOX_RETENTION_DAYS: '30',
    WHATSAPP_INBOX_ENABLED: 'true', WHATSAPP_INBOX_WABA_ID: '123', WHATSAPP_INBOX_PHONE_NUMBER_ID: '456',
    WHATSAPP_INBOX_PRIVACY_MODE: 'explicit_sessions_v1',
    WHATSAPP_INBOX_APP_SECRET: PRIVATE, WHATSAPP_INBOX_VERIFY_TOKEN: PRIVATE,
    WHATSAPP_INBOX_CAPTURE_START_AT: new Date(START).toISOString(), WHATSAPP_INBOX_RETENTION_DAYS: '30' };
}
const configs = () => externalInboxConfigs(env(), NOW);
function prepared(channel = 'email', messageId = 'fake_message') {
  const result = prepareExternalInboxMessage({ channel, accountId: channel === 'email' ? 'cocotripkr@gmail.com' : '456',
    providerMessageId: messageId, providerThreadId: channel === 'email' ? 'fake_thread' : '15550001111', sourceAtMs: NOW - 10_000,
    sender: channel === 'email' ? 'Synthetic sender' : '15550001111', subject: 'Synthetic subject', text: PRIVATE, kind: channel === 'email' ? 'email' : 'text', truncated: true,
    ...(channel === 'whatsapp' ? { whatsappPolicyVersion: 1, whatsappSessionId: sessionDocId('456', '15550001111') } : {}) },
  { nowMs: NOW, retentionDays: 30 });
  return { ...result, data: { ...result.data, retentionPolicyVersion: undefined, caseId: undefined,
    expiresAtMs: NOW - 10_000 + 30 * 86_400_000, expiresAt: new Date(NOW - 10_000 + 30 * 86_400_000) } };
}
function secondaryEnv() {
  return { ...env(), SECONDARY_GMAIL_INBOX_ENABLED: 'true', SECONDARY_GMAIL_INBOX_EMAIL: '2001leety@gmail.com',
    SECONDARY_GMAIL_INBOX_CLIENT_ID: 'secondary-id', SECONDARY_GMAIL_INBOX_CLIENT_SECRET: PRIVATE,
    SECONDARY_GMAIL_INBOX_REFRESH_TOKEN: PRIVATE, SECONDARY_GMAIL_INBOX_CAPTURE_START_AT: new Date(START).toISOString(),
    SECONDARY_GMAIL_INBOX_RETENTION_DAYS: '30', SECONDARY_GMAIL_INBOX_LABEL_ID: 'Label_work_inquiries' };
}
function preparedV2(messageId = 'v2_message') {
  return prepareExternalInboxMessage({ channel: 'email', accountId: 'cocotripkr@gmail.com', providerMessageId: messageId,
    providerThreadId: 'v2_thread', sourceAtMs: NOW - 10_000, sender: 'Synthetic sender', subject: 'Synthetic subject',
    text: PRIVATE, kind: 'email', truncated: true }, { nowMs: NOW, retentionDays: 30 });
}
function goodState(channel = 'email', extra: Row = {}) {
  return { accountId: channel === 'email' ? 'cocotripkr@gmail.com' : '456', status: 'connected', captureStartAtMs: START,
    retentionDays: 30, lastSuccessAtMs: NOW - 1000, lastReceivedAtMs: channel === 'whatsapp' ? NOW - 1000 : null,
    cursorHistoryId: PRIVATE, leaseOwner: PRIVATE, lastErrorCode: PRIVATE, ...extra };
}
function fakeDb(rows: Record<string, Row> = {}) {
  const queries: { collection: string; fields: string[]; limit: number; where: [string, string, unknown][]; orders: string[] }[] = [];
  const docReads: string[] = [];
  const fail = new Set<string>();
  const hang = new Set<string>();
  const db = { collection: (name: string) => {
    const spec = { collection: name, fields: [] as string[], limit: 1000, where: [] as [string, string, unknown][], orders: [] as string[] };
    const query = {
      where: (key: string, operator: string, value: unknown) => { spec.where.push([key, operator, value]); return query; },
      select: (...fields: string[]) => { spec.fields = fields; return query; },
      limit: (maximum: number) => { spec.limit = maximum; return query; },
      orderBy: (field: string, order: string) => { spec.orders.push(`${field}:${order}`); return query; },
      doc: (id: string) => ({ get: async () => {
        docReads.push(`${name}/${id}`);
        if (fail.has(name)) throw new Error(PRIVATE);
        if (hang.has(name)) return new Promise<never>(() => {});
        return { id, exists: Boolean(rows[`${name}/${id}`]), data: () => rows[`${name}/${id}`] };
      } }),
      get: async () => {
        queries.push(spec);
        if (fail.has(name)) throw new Error(PRIVATE);
        if (hang.has(name)) return new Promise<never>(() => {});
        const selected = Object.entries(rows).filter(([path, row]) => path.startsWith(`${name}/`) && spec.where.every(([key, operator, value]) => {
          expect(operator).toBe('=='); return (key === '__name__' ? path.split('/')[1] : row[key]) === value;
        })).sort(([, a], [, b]) => spec.orders.length ? Number(b.receivedAtMs) - Number(a.receivedAtMs) : 0).slice(0, spec.limit);
        const selectedData = (row: Row) => {
          if (!spec.fields.length) return row;
          const result: Row = {};
          for (const field of spec.fields) {
            const parts = field.split('.'); let value: unknown = row;
            for (const part of parts) value = value && typeof value === 'object' ? (value as Row)[part] : undefined;
            if (value === undefined) continue;
            let target = result;
            for (const part of parts.slice(0, -1)) {
              if (!target[part] || typeof target[part] !== 'object') target[part] = {};
              target = target[part] as Row;
            }
            target[parts[parts.length - 1]] = value;
          }
          return result;
        };
        return { docs: selected.map(([path, row]) => ({ id: path.split('/')[1], data: () => selectedData(row) })) };
      },
    };
    return query;
  } };
  return { db, queries, docReads, fail, hang };
}
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe('safe channel configuration and connection status', () => {
  it('does not expose configured secrets or confuse ready with verified', () => {
    const result = configs(); expect(result.email.status).toBe('ready'); expect(result.whatsapp.status).toBe('ready');
    expect(JSON.stringify(result)).not.toContain(PRIVATE);
    expect(externalInboxChannelStatus('email', result.email, null, NOW).status).toBe('awaiting');
  });
  it('distinguishes disabled and incomplete configuration without source reads', async () => {
    const f = fakeDb(); const config = externalInboxConfigs({ WHATSAPP_INBOX_ENABLED: 'true' }, NOW);
    const result = await loadExternalInbox({ db: f.db, configs: config, nowMs: NOW });
    expect(result.channels).toMatchObject([{ channel: 'email', accountId: 'cocotripkr@gmail.com', status: 'disabled' },
      { channel: 'email', accountId: '2001leety@gmail.com', status: 'disabled' }, { channel: 'whatsapp', status: 'not_configured' }]);
    expect(result).toMatchObject({ messages: [], listStatus: 'not_connected', retentionMaintenance: { status: 'not_active' } }); expect(f.queries).toEqual([]);
  });
  it('never calls a failed state lookup zero inquiries or synchronized', () => {
    expect(externalInboxChannelStatus('email', configs().email, goodState(), NOW, true).status).toBe('unknown');
  });
  it.each(['accountId', 'captureStartAtMs', 'retentionDays'])('requires resynchronization for persisted %s mismatch', field => {
    const different = { ...goodState(), [field]: field === 'accountId' ? 'other@example.invalid' : 1 };
    expect(externalInboxChannelStatus('email', configs().email, different, NOW).status).toBe('resync_required');
  });
  it.each(['unexpected', '', null])('does not call malformed state %s synchronized', status => {
    expect(externalInboxChannelStatus('email', configs().email, goodState('email', { status }), NOW).status).toBe('unknown');
    expect(externalInboxChannelStatus('whatsapp', configs().whatsapp, goodState('whatsapp', { status }), NOW).status).toBe('unknown');
  });
  it.each(['error', 'resync_required'])('preserves explicit %s with previous successful timestamps', status => {
    expect(externalInboxChannelStatus('email', configs().email, goodState('email', { status }), NOW))
      .toMatchObject({ status, lastSuccessAtMs: NOW - 1000 });
  });
  it('separates recent sync, 20-minute delay and impossible future timestamps', () => {
    expect(externalInboxChannelStatus('email', configs().email, goodState(), NOW).status).toBe('synced');
    expect(externalInboxChannelStatus('email', configs().email, goodState('email', { lastSuccessAtMs: NOW - 20 * 60_000 }), NOW).status).toBe('synced');
    expect(externalInboxChannelStatus('email', configs().email, goodState('email', { lastSuccessAtMs: NOW - 20 * 60_000 - 1 }), NOW).status).toBe('delayed');
    expect(externalInboxChannelStatus('email', configs().email, goodState('email', { lastSuccessAtMs: NOW + 1 }), NOW))
      .toMatchObject({ status: 'awaiting', lastSuccessAtMs: null });
  });
  it('uses WhatsApp received evidence, not a claim that a continuous connection was checked', () => {
    expect(externalInboxChannelStatus('whatsapp', configs().whatsapp, goodState('whatsapp'), NOW).status).toBe('received');
    expect(externalInboxChannelStatus('whatsapp', configs().whatsapp, goodState('whatsapp', { lastReceivedAtMs: null }), NOW).status).toBe('awaiting');
  });
});

describe('retention maintenance summary', () => {
  const retention = (extra: Row = {}) => ({ ok: true, code: 'RETENTION_COMPLETED', checkedAtMs: NOW - 1000,
    copies: { purged: 2 }, drafts: { purged: 3 }, ...extra });
  it('publishes only a fresh successful maintenance summary from the selected retention state', async () => {
    const f = fakeDb({ 'external_inbox_state/retention': retention() });
    const result = await loadExternalInbox({ db: f.db, configs: configs(), nowMs: NOW });
    expect(result.retentionMaintenance).toEqual({ status: 'ok', checkedAtMs: NOW - 1000, copiesPurged: 2, draftsPurged: 3 });
    expect(JSON.stringify(result.retentionMaintenance)).not.toContain('RETENTION_COMPLETED');
    const query = f.queries.find(item => item.collection === 'external_inbox_state' && item.where.some(([, , value]) => value === 'retention'));
    expect(query?.fields).toEqual(['ok', 'code', 'checkedAtMs', 'copies.purged', 'drafts.purged']);
  });
  it('keeps a stale successful run distinct from an unknown maintenance state', async () => {
    const delayed = fakeDb({ 'external_inbox_state/retention': retention({ checkedAtMs: NOW - 2 * 60 * 60_000 - 1 }) });
    expect((await loadExternalInbox({ db: delayed.db, configs: configs(), nowMs: NOW })).retentionMaintenance).toMatchObject({ status: 'delayed' });
    const malformed = fakeDb({ 'external_inbox_state/retention': retention({ copies: { purged: -1 } }) });
    expect((await loadExternalInbox({ db: malformed.db, configs: configs(), nowMs: NOW })).retentionMaintenance).toMatchObject({ status: 'unknown', copiesPurged: null });
  });
  it('reports failed or review-required maintenance as attention without exposing its code', async () => {
    for (const row of [retention({ ok: false, code: 'RETENTION_SWEEP_UNAVAILABLE' }), retention({ ok: true, code: 'RETENTION_REVIEW_REQUIRED' })]) {
      const f = fakeDb({ 'external_inbox_state/retention': row });
      const result = await loadExternalInbox({ db: f.db, configs: configs(), nowMs: NOW });
      expect(result.retentionMaintenance).toMatchObject({ status: 'attention' });
      expect(JSON.stringify(result.retentionMaintenance)).not.toContain('RETENTION_');
    }
  });
  it('does not turn a mailbox list outage into a maintenance outage', async () => {
    const f = fakeDb({ 'external_inbox_state/retention': retention() }); f.fail.add('external_inbox_messages');
    const result = await loadExternalInbox({ db: f.db, configs: configs(), nowMs: NOW });
    expect(result).toMatchObject({ listStatus: 'unknown', retentionMaintenance: { status: 'ok', copiesPurged: 2 } });
  });
  it('keeps the fixed secondary mailbox separate in status and public read projections', async () => {
    const configuration = externalInboxConfigs(secondaryEnv(), NOW);
    const record = prepareExternalInboxMessage({ channel: 'email', accountId: '2001leety@gmail.com', providerMessageId: 'secondary_message',
      providerThreadId: 'secondary_thread', sourceAtMs: NOW - 10_000, sender: 'Synthetic sender', subject: 'Synthetic subject',
      text: PRIVATE, kind: 'email', truncated: true }, { nowMs: NOW, retentionDays: 30 });
    const inboxCase = nextInboxCaseOnMessage(null, record.data, NOW);
    const f = fakeDb({ [`external_inbox_messages/${record.docId}`]: record.data,
      [`external_inbox_cases/${record.data.caseId}`]: inboxCase,
      'external_inbox_state/company_gmail': goodState(),
      'external_inbox_state/secondary_gmail': { ...goodState(), accountId: '2001leety@gmail.com', workLabelId: 'Label_work_inquiries' },
      'external_inbox_state/whatsapp': goodState('whatsapp') });
    const result = await loadExternalInbox({ db: f.db, configs: configuration, nowMs: NOW });
    expect(result.channels.filter(channel => channel.channel === 'email')).toMatchObject([
      { accountId: 'cocotripkr@gmail.com', status: 'synced' }, { accountId: '2001leety@gmail.com', status: 'synced' },
    ]);
    expect(result.messages).toMatchObject([{ accountId: '2001leety@gmail.com', channel: 'email', replySupported: false }]);
    expect(publicExternalInboxMessage(record.docId, { ...record.data, accountId: 'cocotripkr@gmail.com' }, configuration, NOW, true, inboxCase)).toBeNull();
    expect(f.queries.some(query => query.where.some(([, , value]) => value === 'secondary_gmail'))).toBe(true);
  });
  it('shows a changed secondary work-label scope as requiring resynchronization', () => {
    const configuration = externalInboxConfigs(secondaryEnv(), NOW);
    const persisted = { ...goodState(), accountId: '2001leety@gmail.com', workLabelId: 'Label_previous_scope' };
    expect(externalInboxChannelStatus('secondaryEmail', configuration.secondaryEmail, persisted, NOW))
      .toMatchObject({ channel: 'email', accountId: '2001leety@gmail.com', status: 'resync_required' });
  });
});

describe('company/digest/cutover/retention gates on both list and detail', () => {
  it('requires a bounded matching v2 case and returns only the public case retention state', async () => {
    const record = preparedV2();
    const inboxCase = nextInboxCaseOnMessage(null, record.data, NOW);
    expect(publicExternalInboxMessage(record.docId, record.data, configs(), NOW, true, inboxCase))
      .toMatchObject({ text: PRIVATE, retention: { caseId: record.data.caseId, status: 'open', revision: 1 } });
    expect(publicExternalInboxMessage(record.docId, record.data, configs(), NOW, true)).toBeNull();
    expect(publicExternalInboxMessage(record.docId, { ...record.data, expiresAtMs: NOW + 1 }, configs(), NOW, true, inboxCase)).toBeNull();
    const f = fakeDb({ [`external_inbox_messages/${record.docId}`]: record.data,
      [`external_inbox_cases/${record.data.caseId}`]: inboxCase });
    const list = await loadExternalInbox({ db: f.db, configs: configs(), nowMs: NOW });
    expect(list.messages).toHaveLength(1);
    expect(list.messages[0]).not.toHaveProperty('providerThreadId');
    expect(f.docReads).toEqual([`external_inbox_cases/${record.data.caseId}`]);
    expect(await loadExternalInboxDetail({ db: f.db, id: record.docId, configs: configs(), nowMs: NOW }))
      .toMatchObject({ retention: { caseId: record.data.caseId } });
  });
  it('only exposes receipts written through the explicit WhatsApp session policy', () => {
    const record = prepared('whatsapp');
    expect(publicExternalInboxMessage(record.docId, record.data, configs(), NOW, true)).toMatchObject({ text: PRIVATE });
    for (const patch of [{ whatsappPolicyVersion: undefined }, { whatsappPolicyVersion: 2 }, { whatsappSessionId: '' },
      { whatsappSessionId: sessionDocId('456', '15550002222') }, { sender: '0' }]) {
      for (const detail of [false, true]) expect(publicExternalInboxMessage(record.docId, { ...record.data, ...patch }, configs(), NOW, detail)).toBeNull();
    }
  });
  it('projects a safe list and includes escaped-as-text content only for explicit detail', () => {
    const record = prepared(); const row = { ...record.data, accessToken: PRIVATE, cursorHistoryId: PRIVATE, html: PRIVATE };
    const summary = publicExternalInboxMessage(record.docId, row, configs(), NOW);
    expect(Object.keys(summary).sort()).toEqual(['id', 'channel', 'accountId', 'replySupported', 'sourceAtMs', 'receivedAtMs', 'sender', 'subject', 'kind', 'truncated'].sort());
    expect(JSON.stringify(summary)).not.toContain(PRIVATE);
    expect(publicExternalInboxMessage(record.docId, row, configs(), NOW, true)).toMatchObject({ text: PRIVATE });
    expect(publicExternalInboxMessage(record.docId, row, configs(), NOW, true)).not.toHaveProperty('html');
  });
  it.each([
    ['wrong company', { accountId: 'other@example.invalid' }], ['wrong channel', { channel: 'personal' }],
    ['different provider ID', { providerMessageId: 'other_message' }], ['control in ID', { providerMessageId: 'bad\u0000' }],
    ['overlong provider ID', { providerMessageId: 'x'.repeat(513) }], ['before cutover', { sourceAtMs: START - 1 }],
    ['future source', { sourceAtMs: NOW + 1 }], ['missing source', { sourceAtMs: null }],
    ['future receipt', { receivedAtMs: NOW + 1 }], ['expired', { expiresAtMs: NOW }],
    ['wrong retention duration', { expiresAtMs: NOW + 100 }],
  ])('hides %s in both list and direct-ID detail', (_label, bad) => {
    const record = prepared();
    for (const detail of [false, true]) expect(publicExternalInboxMessage(record.docId, { ...record.data, ...bad }, configs(), NOW, detail)).toBeNull();
  });
  it('rejects malformed document ID and unconfigured channel even if another channel is ready', () => {
    const record = prepared(); const configuration = configs(); configuration.email.ready = false;
    expect(publicExternalInboxMessage(record.docId, record.data, configuration, NOW, true)).toBeNull();
    for (const id of ['', '../traverse', 'a'.repeat(64), record.docId.toUpperCase()]) expect(publicExternalInboxMessage(id, record.data, configs(), NOW, true)).toBeNull();
  });
  it('applies exact cutover and active expiry boundary', () => {
    const record = prepared(); const row = { ...record.data, sourceAtMs: START, expiresAtMs: START + 30 * 86_400_000 };
    expect(publicExternalInboxMessage(record.docId, row, configs(), NOW, true)).not.toBeNull();
  });
  it('caps Unicode text, removes controls, and does not spread arbitrary fields', () => {
    const record = prepared(); const row = { ...record.data, sender: 'a'.repeat(321), subject: 'b'.repeat(257),
      text: '🙂'.repeat(4001) + '\u0000', accountSecret: PRIVATE, kind: '<script>' };
    const result = publicExternalInboxMessage(record.docId, row, configs(), NOW, true);
    expect(result.sender).toHaveLength(320); expect(result.subject).toHaveLength(256);
    expect(Array.from(result.text)).toHaveLength(4000); expect(result.kind).toBe('unknown'); expect(result).not.toHaveProperty('accountSecret');
  });
});

describe('bounded source reads and honest partial failure', () => {
  it('selects only safe summary and channel state fields; never fetches details in a list', async () => {
    const record = prepared(); const f = fakeDb({ [`external_inbox_messages/${record.docId}`]: { ...record.data, html: PRIVATE },
      'external_inbox_state/company_gmail': goodState(), 'external_inbox_state/whatsapp': goodState('whatsapp') });
    const result = await loadExternalInbox({ db: f.db, configs: configs(), nowMs: NOW });
    expect(result).toMatchObject({ listStatus: 'ok', possiblyTruncated: false }); expect(result.messages).toHaveLength(1);
    expect(JSON.stringify(result)).not.toContain(PRIVATE); expect(f.docReads).toEqual([]);
    const list = f.queries.find(query => query.collection === 'external_inbox_messages');
    expect(list).toMatchObject({ limit: 101, orders: ['receivedAtMs:desc'] });
    expect(list?.fields).toEqual(['channel', 'accountId', 'providerMessageId', 'providerThreadId', 'sourceAtMs', 'receivedAtMs', 'sender', 'subject', 'kind', 'truncated', 'expiresAtMs', 'whatsappPolicyVersion', 'whatsappSessionId', 'retentionPolicyVersion', 'caseId']);
    for (const query of f.queries.filter(query => query.collection === 'external_inbox_state'
      && query.where.some(([, , value]) => value !== 'retention'))) {
      expect(query.limit).toBe(1); expect(query.fields).toEqual(['accountId', 'status', 'captureStartAtMs', 'retentionDays', 'workLabelId', 'lastSuccessAtMs', 'lastReceivedAtMs']);
    }
  });
  it('keeps an actual empty list distinct from an unavailable list', async () => {
    const f = fakeDb(); expect(await loadExternalInbox({ db: f.db, configs: configs(), nowMs: NOW })).toMatchObject({ listStatus: 'ok', messages: [] });
    f.fail.add('external_inbox_messages');
    const result = await loadExternalInbox({ db: f.db, configs: configs(), nowMs: NOW });
    expect(result).toMatchObject({ listStatus: 'unknown', messages: [] }); expect(JSON.stringify(result)).not.toContain(PRIVATE);
  });
  it('preserves successful message reads while state source fails', async () => {
    const record = prepared(); const f = fakeDb({ [`external_inbox_messages/${record.docId}`]: record.data });
    f.fail.add('external_inbox_state');
    const result = await loadExternalInbox({ db: f.db, configs: configs(), nowMs: NOW });
    expect(result.messages).toHaveLength(1); expect(result.listStatus).toBe('ok');
    expect(result.channels.filter(channel => channel.accountId !== '2001leety@gmail.com').every(channel => channel.status === 'unknown')).toBe(true);
  });
  it('caps results at 100 and reports possible truncation', async () => {
    const rows: Record<string, Row> = {};
    for (let i = 0; i < 102; i++) { const record = prepared('email', `m${i}`); rows[`external_inbox_messages/${record.docId}`] = record.data; }
    const f = fakeDb(rows); const result = await loadExternalInbox({ db: f.db, configs: configs(), nowMs: NOW });
    expect(result.messages).toHaveLength(100); expect(result.possiblyTruncated).toBe(true);
  });
  it('bounds a stalled list and stalled state source without inventing zeros', async () => {
    vi.useFakeTimers(); const f = fakeDb(); f.hang.add('external_inbox_messages'); f.hang.add('external_inbox_state');
    const run = loadExternalInbox({ db: f.db, configs: configs(), nowMs: NOW, timeoutMs: 20 });
    await vi.advanceTimersByTimeAsync(41);
    expect(await run).toMatchObject({ listStatus: 'unknown', channels: [{ status: 'unknown' }, { status: 'disabled' }, { status: 'unknown' }] });
  });
  it('loads only the explicitly named detail and rechecks ownership before returning text', async () => {
    const record = prepared(); const f = fakeDb({ [`external_inbox_messages/${record.docId}`]: record.data });
    expect(await loadExternalInboxDetail({ db: f.db, id: record.docId, configs: configs(), nowMs: NOW })).toMatchObject({ text: PRIVATE });
    expect(f.docReads).toEqual([`external_inbox_messages/${record.docId}`]); expect(f.queries).toEqual([]);
    expect(await loadExternalInboxDetail({ db: f.db, id: 'a'.repeat(64), configs: configs(), nowMs: NOW })).toBeNull();
  });
  it('does not convert detail timeout into missing content success', async () => {
    vi.useFakeTimers(); const f = fakeDb(); f.hang.add('external_inbox_messages');
    const assertion = expect(loadExternalInboxDetail({ db: f.db, id: prepared().docId, configs: configs(), nowMs: NOW, timeoutMs: 20 }))
      .rejects.toThrow('INBOX_READ_TIMEOUT');
    await vi.advanceTimersByTimeAsync(21); await assertion;
  });
});
