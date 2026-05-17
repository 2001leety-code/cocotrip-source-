/**
 * PR #471 / P91 regression slot.
 *
 * Pre-fix: api/_ai_core/buildPrompt.js:550 had a pair of unescaped
 * backticks inside the `buildSystemPrompt` template literal. ESM module
 * load threw `SyntaxError: Unexpected identifier 'duration_days'` →
 * ai-planner-full HTTP 500 FUNCTION_INVOCATION_FAILED.
 *
 * The bug was latent for 4 days because no existing unit test imported
 * + INVOKED buildSystemPrompt — they only imported it implicitly via
 * other modules whose own load wasn't triggered. This test fixes that
 * gap by actually calling the function. If the template literal has
 * unescaped backticks anywhere, this import will throw at module-load
 * time and the test file fails fast.
 *
 * Additional guard: explicit assertion that the canonical "DAY COUNT"
 * line uses the escaped form. Even if some new edit re-introduces raw
 * backticks elsewhere, this acts as a sentinel against regression of
 * the exact line PR #417 originally broke.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  buildSystemPrompt,
  buildRevisionInstruction,
  logPromptMetrics,
} from '../../api/_ai_core/buildPrompt.js';

const src = readFileSync(
  resolve(process.cwd(), 'api/_ai_core/buildPrompt.js'),
  'utf8',
);

describe('PR #471 P91 — buildPrompt.js module load + invocation', () => {
  it('exports are callable (import alone proves ESM parse OK)', () => {
    expect(typeof buildSystemPrompt).toBe('function');
    expect(typeof buildRevisionInstruction).toBe('function');
    expect(typeof logPromptMetrics).toBe('function');
  });

  it('buildSystemPrompt(en) runs without throwing + returns non-empty string', () => {
    const out = buildSystemPrompt('en');
    expect(typeof out).toBe('string');
    expect(out.length).toBeGreaterThan(1000);
  });

  it('buildSystemPrompt covers all supported langs (ko/en/ja/zh)', () => {
    for (const lang of ['ko', 'en', 'ja', 'zh']) {
      const out = buildSystemPrompt(lang);
      expect(typeof out).toBe('string');
      expect(out.length).toBeGreaterThan(1000);
    }
  });
});

describe('PR #471 P91 — source-level invariants (sentinel against PR #417 regression)', () => {
  it('the DAY COUNT line uses escaped backticks around duration_days', () => {
    // Sentinel: the EXACT line PR #417 broke must keep the escape.
    expect(src).toMatch(/Output EXACTLY \\`duration_days\\` day objects/);
  });

  it('raw (unescaped) backtick count in the file is even', () => {
    // Even count = template literal open/close pairs match. Odd = unterminated.
    // We count raw `\`` while skipping any `\\\``-escaped occurrences.
    let count = 0;
    for (let i = 0; i < src.length; i++) {
      const c = src[i];
      if (c === '\\') { i++; continue; }
      if (c === '`') count++;
    }
    expect(count % 2).toBe(0);
  });

  it('NO raw `duration_days` (unescaped backtick wrapping it) anywhere', () => {
    // Negative: must NOT contain the broken pattern. The escape \\` is required.
    // We deliberately phrase the regex to match the BROKEN form so it fails
    // loudly if the regression returns.
    const broken = /(?<!\\)`duration_days(?<!\\)`/;
    expect(broken.test(src)).toBe(false);
  });
});
