import { describe, expect, it } from 'vitest';
import { selectInboxMessages } from '../../src/lib/selectInboxMessages';

const rows = Object.freeze([
  Object.freeze({ id: 'a', channel: 'email' as const, sourceAtMs: 20, sender: 'Guest@Example.invalid', subject: '서울 일정', text: 'BODY_ONLY' }),
  Object.freeze({ id: 'b', channel: 'whatsapp' as const, sourceAtMs: 10, sender: '820000000000', subject: '' }),
  Object.freeze({ id: 'c', channel: 'email' as const, sourceAtMs: 20, sender: '', subject: 'Literal [.*] café' }),
]);
const defaults = { channel: 'all' as const, query: '', order: 'newest' as const };

describe('loaded inbox summary selection without AI or network', () => {
  it('sorts newest first, preserves ties and never mutates input', () => {
    const selected = selectInboxMessages(rows, defaults);
    expect(selected.map(row => row.id)).toEqual(['a', 'c', 'b']);
    expect(selected[0]).toBe(rows[0]);
    expect(rows.map(row => row.id)).toEqual(['a', 'b', 'c']);
    expect(selected).not.toBe(rows);
  });
  it('sorts oldest first and filters channels', () => {
    expect(selectInboxMessages(rows, { ...defaults, order: 'oldest' }).map(row => row.id)).toEqual(['b', 'a', 'c']);
    expect(selectInboxMessages(rows, { ...defaults, channel: 'whatsapp' })).toEqual([rows[1]]);
  });
  it.each([' guest@EXAMPLE ', '서울', '서울'])('matches trimmed, case-insensitive, normalized query %s', query => {
    expect(selectInboxMessages(rows, { ...defaults, query })).toEqual([rows[0]]);
  });
  it('treats patterns literally and searches no message bodies', () => {
    expect(selectInboxMessages(rows, { ...defaults, query: '[.*]' })).toEqual([rows[2]]);
    expect(selectInboxMessages(rows, { ...defaults, query: 'BODY_ONLY' })).toEqual([]);
    expect(selectInboxMessages(rows, { ...defaults, query: 'cafe\u0301' })).toEqual([rows[2]]);
  });
  it('combines channel with query, handles whitespace and caps query length', () => {
    expect(selectInboxMessages(rows, { ...defaults, channel: 'whatsapp', query: '서울' })).toEqual([]);
    expect(selectInboxMessages(rows, { ...defaults, query: '  ' })).toHaveLength(3);
    const long = { ...rows[0], subject: 'x'.repeat(160) };
    expect(selectInboxMessages([long], { ...defaults, query: 'x'.repeat(160) + 'ignored' })).toEqual([long]);
    expect(selectInboxMessages([], defaults)).toEqual([]);
  });
});
