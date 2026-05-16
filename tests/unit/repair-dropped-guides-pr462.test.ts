/**
 * PR #462 — Audit X-H3 regression slot.
 *
 * Pre-fix: api/_ai_core/responseValidator.js's repairAndParseJSON
 * handled truncated Gemini output by walking backward to a safe
 * cut point and closing any open brackets/braces. When Gemini
 * emitted `arrival_guide` / `departure_guide` AFTER the long
 * `days[]` array (Gemini's preferred order most of the time), a
 * truncation that cut inside `days[]` silently dropped those
 * top-level critical fields. The downstream `validatePatternStructure`
 * caught the missing guide and triggered a retry — so the user
 * eventually got a valid plan — but each silent loss burned an extra
 * Gemini Pro call (now amplified less by PR #461's deterministic
 * retry model). Worse, operators had no visibility: "is Gemini
 * skipping guides?" vs "is the repair eating them?" was unanswerable.
 *
 * Post-fix:
 *  1. `detectDroppedKeys(rawText, repaired)` — exported helper that
 *     checks whether the canonical top-level critical keys appeared in
 *     the raw text but vanished from the repaired object. Returns the
 *     list (empty if none lost).
 *  2. After successful repair, the function annotates the result with
 *     `__repair_dropped_keys` so downstream code / debugger can see
 *     what was lost, AND fires an admin `throttledTelegramAlert`
 *     dedup'd by the sorted-dropped-key combo so repeat occurrences
 *     surface as a single signal per window.
 *  3. Direct-parse path (most common, no truncation) is UNCHANGED —
 *     the new logic only runs after the cut-and-close repair succeeds.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const src = readFileSync(
  resolve(process.cwd(), 'api/_ai_core/responseValidator.js'),
  'utf8',
);

const alertCalls: any[] = [];
vi.mock('../../api/_shared/telegram-throttle.js', () => ({
  throttledTelegramAlert: vi.fn(async (args: any) => {
    alertCalls.push(args);
    return { ok: true, alerted: true };
  }),
}));

import {
  detectDroppedKeys,
  classifyMissingKeys,
  repairAndParseJSON,
} from '../../api/_ai_core/responseValidator.js';

describe('PR #462 X-H3 — detectDroppedKeys helper', () => {
  it('no missing keys when both guides are present in result', () => {
    const raw = '{"days":[],"arrival_guide":{"airport":"ICN"},"departure_guide":{"airport":"GMP"}}';
    const repaired = JSON.parse(raw);
    expect(detectDroppedKeys(raw, repaired)).toEqual([]);
  });

  it('detects departure_guide missing from result', () => {
    const raw = '{"days":[],"arrival_guide":{"airport":"ICN"},"departure_guide":{"airport":"GMP"}}';
    const repaired = { days: [], arrival_guide: { airport: 'ICN' } };
    expect(detectDroppedKeys(raw, repaired)).toEqual(['departure_guide']);
  });

  it('detects arrival_guide missing from result', () => {
    const raw = '{"days":[],"arrival_guide":{"airport":"ICN"},"departure_guide":{"airport":"GMP"}}';
    const repaired = { days: [], departure_guide: { airport: 'GMP' } };
    expect(detectDroppedKeys(raw, repaired)).toEqual(['arrival_guide']);
  });

  it('detects BOTH missing', () => {
    const repaired = { days: [1, 2, 3] };
    expect(detectDroppedKeys('', repaired).sort()).toEqual(['arrival_guide', 'departure_guide']);
  });

  it('defensive: null / undefined repaired returns empty (never throws)', () => {
    expect(detectDroppedKeys(null as any, null as any)).toEqual([]);
    expect(detectDroppedKeys('', null as any)).toEqual([]);
    expect(detectDroppedKeys('{"arrival_guide":{}}', undefined as any)).toEqual([]);
  });
});

describe('PR #462 X-H3 — classifyMissingKeys helper', () => {
  it('lost-after-emit: key in raw but missing from result', () => {
    const raw = '{"arrival_guide":{"airport":"ICN"},"days":[1]}';
    const c = classifyMissingKeys(raw, ['arrival_guide', 'departure_guide']);
    expect(c.emitted).toEqual(['arrival_guide']);
    expect(c.notEmitted).toEqual(['departure_guide']);
  });

  it('never-emitted: key never in raw (truncation before emit)', () => {
    const raw = '{"days":[1,2,3'; // truncated before any guide
    const c = classifyMissingKeys(raw, ['arrival_guide', 'departure_guide']);
    expect(c.emitted).toEqual([]);
    expect(c.notEmitted.sort()).toEqual(['arrival_guide', 'departure_guide']);
  });

  it('matches the quoted-key form, not unquoted substrings (in a stop note)', () => {
    const raw = '{"days":[{"note":"arrival_guide note"}]}';
    const c = classifyMissingKeys(raw, ['arrival_guide']);
    expect(c.emitted).toEqual([]);
    expect(c.notEmitted).toEqual(['arrival_guide']);
  });

  it('defensive: empty / non-string rawText puts all keys in notEmitted', () => {
    expect(classifyMissingKeys('', ['arrival_guide']).notEmitted).toEqual(['arrival_guide']);
    expect(classifyMissingKeys(null as any, ['arrival_guide']).notEmitted).toEqual(['arrival_guide']);
  });
});

describe('PR #462 X-H3 — repairAndParseJSON behavior', () => {
  beforeEach(() => {
    alertCalls.length = 0;
  });

  it('direct-parse path: clean JSON → no flag, no alert', () => {
    const raw = '{"days":[1],"arrival_guide":{"airport":"ICN"},"departure_guide":{"airport":"GMP"}}';
    const r = repairAndParseJSON(raw);
    expect(r.__repair_dropped_keys).toBeUndefined();
    expect(alertCalls.length).toBe(0);
  });

  it('repair path that preserves guides: no flag, no alert', () => {
    // Wrap valid JSON in markdown fence — the strip path returns the same
    // structure with both guides intact.
    const raw = '```json\n{"days":[1],"arrival_guide":{"airport":"ICN"},"departure_guide":{"airport":"GMP"}}\n```';
    const r = repairAndParseJSON(raw);
    expect(r.__repair_dropped_keys).toBeUndefined();
    expect(alertCalls.length).toBe(0);
  });

  it('repair path with NEVER-EMITTED guides (cut inside days[] before reaching them) → flag + alert', () => {
    // Realistic Gemini output: guides come AFTER days[]. Truncation
    // at a safe boundary (after `}` of last full stop) means the days
    // array is recoverable but guides are absent entirely.
    const truncated = '{"days":[{"name":"A"},{"name":"B"}';
    const r = repairAndParseJSON(truncated);
    expect(r.days).toBeTruthy();
    expect(r.__repair_dropped_keys).toBeTruthy();
    expect(r.__repair_dropped_keys.sort()).toEqual(['arrival_guide', 'departure_guide']);
    expect(alertCalls.length).toBe(1);
    expect(alertCalls[0].key).toBe('repair-dropped-guides:arrival_guide+departure_guide');
    expect(alertCalls[0].channel).toBe('admin');
    expect(alertCalls[0].severity).toBe('high');
    expect(alertCalls[0].message).toMatch(/lost critical top-level keys/);
    expect(alertCalls[0].message).toMatch(/never-emitted/);
    expect(alertCalls[0].message).toMatch(/arrival_guide/);
  });

  it('repair path that PRESERVES guides emitted early → no flag', () => {
    // Guides emitted before days[]; truncation at a safe `}` boundary
    // inside days[]. Repair recovers everything including early guides.
    const truncated =
      '{"arrival_guide":{"airport":"ICN"},"departure_guide":{"airport":"GMP"},"days":[{"name":"A"},{"name":"B"}';
    const r = repairAndParseJSON(truncated);
    expect(r.arrival_guide).toBeTruthy();
    expect(r.departure_guide).toBeTruthy();
    expect(r.__repair_dropped_keys).toBeUndefined();
    expect(alertCalls.length).toBe(0);
  });

  it('repair path with LOST-AFTER-EMIT (raw has arrival_guide but repair drops it) → flag + correct classification', () => {
    // Construct a case where arrival_guide is mentioned in the raw text
    // (so classify says "emitted") but cut+close doesn't recover it.
    // Achieved by hiding the substring inside an earlier stop description,
    // then truncating after days[].
    const truncated =
      '{"days":[{"name":"A","note":"see arrival_guide later"},{"name":"B"}';
    const r = repairAndParseJSON(truncated);
    // arrival_guide quoted string is in note value, so classify considers
    // it "emitted" — but it never appeared as a real key, so result lacks it.
    expect(r.__repair_dropped_keys).toBeTruthy();
    expect(alertCalls.length).toBe(1);
    expect(alertCalls[0].message).toMatch(/lost-after-emit/);
  });

  it('throws when repair itself fails (path unchanged)', () => {
    expect(() => repairAndParseJSON('{{{not json at all')).toThrow(/invalid JSON/i);
    expect(alertCalls.length).toBe(0);
  });
});

describe('PR #462 X-H3 — source-level invariants', () => {
  it('imports throttledTelegramAlert from the shared helper', () => {
    expect(src).toMatch(/from\s+['"]\.\.\/_shared\/telegram-throttle\.js['"]/);
    expect(src).toMatch(/import\s+\{\s*throttledTelegramAlert\s*\}/);
  });

  it('declares CRITICAL_TOP_LEVEL_KEYS with both guides', () => {
    expect(src).toMatch(/CRITICAL_TOP_LEVEL_KEYS\s*=\s*\[\s*['"]arrival_guide['"]\s*,\s*['"]departure_guide['"]\s*\]/);
  });

  it('detectDroppedKeys and classifyMissingKeys are exported', () => {
    expect(src).toMatch(/export\s+function\s+detectDroppedKeys\s*\(/);
    expect(src).toMatch(/export\s+function\s+classifyMissingKeys\s*\(/);
  });

  it('repair success path annotates result with __repair_dropped_keys', () => {
    expect(src).toMatch(/result\.__repair_dropped_keys\s*=\s*droppedKeys/);
  });

  it('alert key dedup is sorted+joined per the canonical form', () => {
    expect(src).toMatch(/repair-dropped-guides:\$\{droppedKey\}/);
    expect(src).toMatch(/droppedKeys\.slice\(\)\.sort\(\)\.join\(['"]\+['"]\)/);
  });

  it('alert is fire-and-forget (.catch swallow) — no parse latency impact', () => {
    expect(src).toMatch(/throttledTelegramAlert\(\{[\s\S]*?repair-dropped-guides[\s\S]*?\}\)\.catch\(\(\)\s*=>\s*\{\s*\}\)/);
  });

  it('alert channel is admin with severity high', () => {
    const block = src.slice(src.indexOf('repair-dropped-guides'), src.indexOf('repair-dropped-guides') + 1500);
    expect(block).toMatch(/channel:\s*['"]admin['"]/);
    expect(block).toMatch(/severity:\s*['"]high['"]/);
  });
});
