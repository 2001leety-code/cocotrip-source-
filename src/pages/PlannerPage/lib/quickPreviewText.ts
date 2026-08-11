/**
 * Quick-preview text resolution (2026-08-11).
 *
 * `/api/ai-planner-quick` returns model output, so `marketingNarrative` and
 * `day1MarkdownTable` are a plain string on a good day and an object, a
 * JSON-encoded string, or a truncated one on a bad day. This module owns that
 * ladder so `QuickPreviewCard` can stay a render.
 *
 * It imports nothing on purpose — no React, no firebase — so
 * `tests/unit/planner-quick-preview-text.test.ts` can call the real functions
 * instead of grepping the card's source. The card previously carried both
 * ladders inline as IIFEs typed with `as any` and closed by empty `catch {}`
 * blocks, which is untestable and was six ESLint errors.
 *
 * Behaviour is the behaviour that shipped, extraction only. The rule that
 * matters: **a parse failure must never swallow the text.** A truncated
 * response is the case where the preview has least to show, so dropping to the
 * fallback there would hide the only content that arrived.
 */

/** What the quick endpoint can put in one of these fields. */
export type QuickPreviewField = string | Record<string, unknown> | null | undefined;

/** `JSON.parse` that answers `undefined` rather than throwing. */
function parseOrUndefined(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

/** First truthy value among `keys` — truthy, not "is a string", so a number survives. */
function firstTruthy(o: Record<string, unknown>, keys: readonly string[]): unknown {
  return keys.map((k) => o[k]).find(Boolean);
}

/**
 * The narrative paragraph under the preview heading.
 *
 * Object → `full_narrative` / `text` / `content` / `summary`, then the first
 * string value longer than 20 characters (short values are field noise like
 * `"ko"` or a theme name, not prose), then the whole object serialised.
 * A JSON-encoded string is unwrapped; a malformed one keeps its text. Braces
 * and quotes are then stripped so a leaked envelope reads as words, and the
 * result is capped at 500 characters — this is a teaser, not the plan.
 */
export function resolveNarrative(raw: QuickPreviewField, fallback: string): string {
  if (!raw) return fallback;

  let narrative: unknown = raw;

  if (typeof narrative === 'object') {
    const obj = narrative as Record<string, unknown>;
    narrative =
      firstTruthy(obj, ['full_narrative', 'text', 'content', 'summary'])
      || Object.values(obj).find((v) => typeof v === 'string' && v.length > 20)
      || JSON.stringify(obj);
  }

  if (typeof narrative === 'string' && narrative.trim().startsWith('{')) {
    const parsed = parseOrUndefined(narrative);
    if (parsed && typeof parsed === 'object') {
      narrative = firstTruthy(parsed as Record<string, unknown>, ['full_narrative', 'text', 'content']) || narrative;
    }
  }

  if (typeof narrative === 'string') {
    narrative = narrative
      .replace(/^\{[^}]*"(themes|marketingNarrative)"[^}]*$/g, '')
      .replace(/[{}"[\]]/g, '')
      .replace(/\s*,\s*/g, ', ')
      .trim();
  }

  return String(narrative || fallback).slice(0, 500);
}

/**
 * The day-one markdown table, or `null` when there is nothing worth rendering.
 *
 * Object → `content` / `table`, else the object serialised. Literal `\n` is
 * unescaped first, which is why a JSON envelope carrying a multi-row table can
 * no longer re-parse (a raw newline inside a JSON string is invalid JSON) — the
 * rows still survive as text and the card renders them in its `<pre>` branch.
 * That ordering shipped; it is pinned by the test rather than changed here.
 * Anything under 10 characters is a stub, not a table.
 */
export function resolveMarkdownTable(raw: QuickPreviewField): string | null {
  if (!raw) return null;

  let table: unknown = raw;

  if (typeof table === 'object') {
    const obj = table as Record<string, unknown>;
    table = obj.content || obj.table || JSON.stringify(obj, null, 2);
  }

  if (typeof table === 'string') {
    const unescaped = table.replace(/\\n/g, '\n');
    table = unescaped;
    if (unescaped.trim().startsWith('{') || unescaped.trim().startsWith('[')) {
      const parsed = parseOrUndefined(unescaped);
      if (parsed && typeof parsed === 'object') {
        table = firstTruthy(parsed as Record<string, unknown>, ['content', 'table']) || JSON.stringify(parsed, null, 2);
      }
    }
  }

  if (!table || (typeof table === 'string' && table.trim().length < 10)) return null;
  return String(table);
}
