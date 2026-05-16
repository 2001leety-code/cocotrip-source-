/**
 * PR #458 — Audit Z-H10 regression slot.
 *
 * Pre-fix: pdfGenerator.ts's blank-canvas guard sampled 61 random
 * points across the whole canvas and accepted anything with >= 5%
 * non-white pixels (with a continue-on-suspect fail-open posture).
 * That 5% threshold catches obvious blank PDFs but MISSES the more
 * common pagebreak-corrupt class:
 *
 *   - 10 logical pages render → 5 of them go blank due to a CSS
 *     pagebreak bug
 *   - Global non-white rate is still 15-30% (the 5 good pages carry
 *     it)
 *   - 5% threshold passes → user gets a half-blank PDF with no signal
 *
 * Post-fix: additional per-band sampling. Canvas sliced into 10
 * horizontal bands; each band sampled 20 times; if >25% of bands have
 * <2% non-white, log a structured warn so Sentry / DevTools surface
 * the pattern. Behavior unchanged (still continue) — we just gain
 * observability into the silent-half-blank case.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const src = readFileSync(
  resolve(process.cwd(), 'src/pages/PlanDetailPage/pdfGenerator.ts'),
  'utf8',
);

describe('PR #458 Z-H10 — per-band canvas sampling constants', () => {
  it('slices canvas into 10 horizontal bands', () => {
    expect(src).toMatch(/const\s+BANDS\s*=\s*10/);
  });

  it('20 samples per band (statistical signal stable)', () => {
    expect(src).toMatch(/const\s+PER_BAND_SAMPLES\s*=\s*20/);
  });

  it('blank-band threshold = 2% non-white', () => {
    expect(src).toMatch(/const\s+BLANK_BAND_NONWHITE\s*=\s*0\.02/);
  });

  it('partial-blank trigger = 25% blank bands', () => {
    expect(src).toMatch(/const\s+MAX_BLANK_BAND_RATIO\s*=\s*0\.25/);
  });
});

describe('PR #458 Z-H10 — band sampling loop', () => {
  it('iterates bands from 0 to BANDS', () => {
    expect(src).toMatch(/for\s*\(\s*let\s+b\s*=\s*0\s*;\s*b\s*<\s*BANDS\s*;/);
  });

  it('computes yStart / yEnd for each band slice', () => {
    expect(src).toMatch(/yStart\s*=\s*Math\.floor\(\s*\(\s*b\s*\/\s*BANDS\s*\)\s*\*\s*H/);
    expect(src).toMatch(/yEnd\s*=\s*Math\.max/);
  });

  it('samples PER_BAND_SAMPLES random points per band', () => {
    expect(src).toMatch(/for\s*\(\s*let\s+s\s*=\s*0\s*;\s*s\s*<\s*PER_BAND_SAMPLES\s*;/);
  });

  it('detects non-white pixels with the same RGBA rule as the global check', () => {
    // Same `R=G=B=255` + alpha != 0 inversion guards both loops.
    const checks = src.match(/d\[0\]\s*===\s*255\s*&&\s*d\[1\]\s*===\s*255\s*&&\s*d\[2\]\s*===\s*255/g) || [];
    expect(checks.length).toBeGreaterThanOrEqual(2);
  });
});

describe('PR #458 Z-H10 — structured warn on partial-blank', () => {
  it('fires console.warn only when blankBandRatio > MAX_BLANK_BAND_RATIO', () => {
    expect(src).toMatch(/if\s*\(\s*blankBandRatio\s*>\s*MAX_BLANK_BAND_RATIO\s*\)/);
  });

  it('warn message includes blankBands / BANDS / ratio + globalRate + band stats (Sentry-grep-friendly)', () => {
    const warnIdx = src.indexOf('partial-blank suspected (band check)');
    expect(warnIdx).toBeGreaterThan(-1);
    const block = src.slice(warnIdx, warnIdx + 800);
    expect(block).toMatch(/blankBands/);
    expect(block).toMatch(/ratio=/);
    expect(block).toMatch(/globalRate=/);
    expect(block).toMatch(/bands=/);
  });

  it('keeps fail-open posture — continues after warn (no abort / no offerWhatsapp)', () => {
    const warnIdx = src.indexOf('partial-blank suspected (band check)');
    const block = src.slice(warnIdx, warnIdx + 1200);
    // After the partial-blank warn there should be NO return / throw / offerWhatsapp before
    // the existing `const pdf = await worker.outputPdf('blob')` line.
    expect(block).not.toMatch(/return\s*;[\s\S]{0,200}const\s+pdf\s*=\s*await\s+worker/);
    expect(block).not.toMatch(/offerWhatsapp\([\s\S]{0,200}const\s+pdf\s*=\s*await\s+worker/);
  });
});

describe('PR #458 Z-H10 — original global 5% check preserved', () => {
  it('still computes nonWhiteRate against the original 61-point sample', () => {
    expect(src).toMatch(/const\s+nonWhiteRate\s*=\s*nonWhite\s*\/\s*points\.length/);
    expect(src).toMatch(/if\s*\(\s*nonWhiteRate\s*<\s*0\.05\s*\)/);
  });

  it('still has the blob.size < 1024 final guard (hard-fail on empty PDF)', () => {
    expect(src).toMatch(/pdf\.size\s*<\s*1024/);
  });
});
