/**
 * Quick-preview text resolution — runtime lock (2026-08-11).
 *
 * `/api/ai-planner-quick` is a model response, so `marketingNarrative` and
 * `day1MarkdownTable` arrive as a string on a good day and as an object, a
 * JSON-encoded string, or a truncated one on a bad day. `QuickPreviewCard`
 * carried that whole ladder inline as two IIFEs typed with `as any` and two
 * empty `catch {}` blocks — six ESLint errors, and no test could reach any of
 * it because importing the card pulls the planner's React tree.
 *
 * The ladder now lives in `PlannerPage/lib/quickPreviewText.ts`, which imports
 * nothing (no React, no firebase), so these are real runtime assertions on the
 * real functions rather than a regex over source text.
 *
 * The behaviour pinned here is the behaviour that shipped — extraction must not
 * quietly change what a traveller sees. The malformed-JSON cases are the point:
 * a parse failure must never swallow the text, because the text is all the
 * preview has.
 */
import { describe, it, expect } from 'vitest';
import { resolveNarrative, resolveMarkdownTable } from '../../src/pages/PlannerPage/lib/quickPreviewText';

const FB = 'FALLBACK COPY';

describe('resolveNarrative', () => {
  it('falls back when there is nothing to render', () => {
    expect(resolveNarrative(undefined, FB)).toBe(FB);
    expect(resolveNarrative(null, FB)).toBe(FB);
    expect(resolveNarrative('', FB)).toBe(FB);
  });

  it('returns a plain string unchanged', () => {
    expect(resolveNarrative('Three days in Seoul, hubbed on Jung-gu.', FB))
      .toBe('Three days in Seoul, hubbed on Jung-gu.');
  });

  it('reads an object in the order full_narrative → text → content → summary', () => {
    expect(resolveNarrative({ full_narrative: 'A', text: 'B', content: 'C', summary: 'D' }, FB)).toBe('A');
    expect(resolveNarrative({ text: 'B', content: 'C', summary: 'D' }, FB)).toBe('B');
    expect(resolveNarrative({ content: 'C', summary: 'D' }, FB)).toBe('C');
    expect(resolveNarrative({ summary: 'D' }, FB)).toBe('D');
    // An empty value is not an answer — the ladder keeps walking.
    expect(resolveNarrative({ full_narrative: '', text: 'B' }, FB)).toBe('B');
  });

  it('falls to the first string value longer than twenty characters', () => {
    const long = 'x'.repeat(21);
    expect(resolveNarrative({ note: long }, FB)).toBe(long);
  });

  it('treats twenty characters as too short — the rule is > 20, not >= 20', () => {
    const twenty = 'x'.repeat(20);
    expect(resolveNarrative({ note: twenty }, FB)).toBe(`note:${twenty}`);
  });

  it('unwraps a JSON-encoded narrative', () => {
    expect(resolveNarrative('{"full_narrative":"Busan, three days, seafood-heavy."}', FB))
      .toBe('Busan, three days, seafood-heavy.');
  });

  it('keeps the text of malformed JSON instead of dropping it', () => {
    const truncated = '{"full_narrative": "Seoul day one, cut off mid-stream';
    const out = resolveNarrative(truncated, FB);
    expect(out).toContain('Seoul day one, cut off mid-stream');
    expect(out).not.toBe(FB);
  });

  it('caps the output at 500 characters', () => {
    expect(resolveNarrative('a'.repeat(600), FB)).toHaveLength(500);
  });
});

describe('resolveMarkdownTable', () => {
  const TABLE = '| Time | Stop |\n| 09:00 | Gyeongbokgung |';

  it('returns null when there is nothing to render', () => {
    expect(resolveMarkdownTable(undefined)).toBeNull();
    expect(resolveMarkdownTable(null)).toBeNull();
    expect(resolveMarkdownTable('')).toBeNull();
  });

  it('returns null for a stub too short to be a table', () => {
    expect(resolveMarkdownTable('| a |')).toBeNull();
  });

  it('returns a markdown table unchanged', () => {
    expect(resolveMarkdownTable(TABLE)).toBe(TABLE);
  });

  it('turns literal backslash-n into real newlines', () => {
    expect(resolveMarkdownTable('| Time | Stop |\\n| 09:00 | Gyeongbokgung |')).toBe(TABLE);
  });

  it('reads an object in the order content → table, then stringifies', () => {
    expect(resolveMarkdownTable({ content: TABLE, table: 'other' })).toBe(TABLE);
    expect(resolveMarkdownTable({ table: TABLE })).toBe(TABLE);
    expect(resolveMarkdownTable({ day: 1, stops: 4 })).toBe(JSON.stringify({ day: 1, stops: 4 }, null, 2));
  });

  it('unwraps a JSON-encoded table', () => {
    expect(resolveMarkdownTable('{"content":"| Time | Stop |"}')).toBe('| Time | Stop |');
  });

  it('keeps malformed JSON verbatim instead of dropping it', () => {
    const truncated = '{"content": "| Time | Stop |\\n| 09:00 | Gyeongbokgung';
    expect(resolveMarkdownTable(truncated)).toBe(truncated.replace(/\\n/g, '\n'));
  });

  it('keeps a JSON envelope whose rows were escaped, rather than dropping the rows', () => {
    // Shipped order: `\n` is unescaped *before* `JSON.parse`, so an envelope
    // carrying a multi-row table can never re-parse — a raw newline inside a
    // JSON string is invalid JSON. The rows survive as text and the card
    // renders them in its <pre> branch. Pinned, not fixed: changing the order
    // changes what today's travellers see, which is a separate decision.
    const envelope = '{"content":"| Time | Stop |\\n| 09:00 | Gyeongbokgung |"}';
    const out = resolveMarkdownTable(envelope);
    expect(out).toContain('Gyeongbokgung');
    expect(out).toBe(envelope.replace(/\\n/g, '\n'));
  });
});
