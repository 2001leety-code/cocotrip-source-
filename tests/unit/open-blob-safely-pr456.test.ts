/**
 * PR #456 — Audit Z-H14 regression slot.
 *
 * Pre-fix: src/pages/PlanDetailPage/pdfGenerator.ts split blob open by
 * UA: iOS got window.open(blob:url), other platforms got an <a download>
 * click. iOS Safari's popup blocker rejects window.open(blob:url) when
 * the call happens after an await (the PDF gen flow awaits Puppeteer /
 * html2canvas first, breaking the user-gesture context) → popup blocked
 * → user sees no PDF, no error.
 *
 * Post-fix: src/lib/openBlobSafely.ts unifies both platforms. <a download>
 * works on iOS 13+ for blob URLs and bypasses the popup blocker. The
 * helper tries that first; only falls back to window.open if the anchor
 * click throws, and detects popup-blocked (win === null) to surface a
 * user-visible alert instead of silent failure.
 *
 * Asserts:
 *   1. helper picks <a download> as first strategy
 *   2. helper sets target=_blank on iOS (Safari share sheet)
 *   3. popup-blocker fallback surfaces an error toast
 *   4. invalid blob is rejected loudly
 *   5. pdfGenerator wire-up no longer carries the conditional UA branch
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { openBlobSafely, detectIOS } from '../../src/lib/openBlobSafely.ts';

const pdfGenSrc = readFileSync(
  resolve(process.cwd(), 'src/pages/PlanDetailPage/pdfGenerator.ts'),
  'utf8',
);
const helperSrc = readFileSync(
  resolve(process.cwd(), 'src/lib/openBlobSafely.ts'),
  'utf8',
);

// Polyfill URL.createObjectURL / revokeObjectURL — vitest/jsdom doesn't
// always wire them up consistently.
beforeEach(() => {
  if (typeof URL.createObjectURL !== 'function') {
    (URL as unknown as { createObjectURL: (b: Blob) => string }).createObjectURL = vi.fn(() => 'blob:fake');
  }
  if (typeof URL.revokeObjectURL !== 'function') {
    (URL as unknown as { revokeObjectURL: (u: string) => void }).revokeObjectURL = vi.fn();
  }
});

afterEach(() => {
  vi.restoreAllMocks();
});

function makeDocStub() {
  const clicks: HTMLAnchorElement[] = [];
  const body = {
    appendChild: vi.fn((node: HTMLAnchorElement) => { clicks.push(node); return node; }),
    removeChild: vi.fn(),
  };
  const doc = {
    createElement: vi.fn((tag: string) => {
      const el: any = { tagName: tag.toUpperCase(), click: vi.fn(), rel: '', target: '' };
      return el;
    }),
    body,
  } as unknown as Document;
  return { doc, clicks };
}

describe('PR #456 Z-H14 — detectIOS', () => {
  it('matches iPhone / iPad / iPod user-agents', () => {
    expect(detectIOS('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)')).toBe(true);
    expect(detectIOS('Mozilla/5.0 (iPad; CPU OS 16_0)')).toBe(true);
    expect(detectIOS('iPod something')).toBe(true);
  });

  it('does NOT match desktop Chrome / Android', () => {
    expect(detectIOS('Mozilla/5.0 (Windows NT 10) Chrome/120')).toBe(false);
    expect(detectIOS('Mozilla/5.0 (Linux; Android 14)')).toBe(false);
  });
});

describe('PR #456 Z-H14 — openBlobSafely tries <a download> first', () => {
  it('non-iOS: appends anchor, clicks, removes — returns ok:true via=a-download', () => {
    const { doc, clicks } = makeDocStub();
    const blob = new Blob(['x'], { type: 'application/pdf' });
    const r = openBlobSafely({
      blob, filename: 'test.pdf',
      isIOS: false,
      doc,
      win: { open: vi.fn() } as unknown as Window,
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.via).toBe('a-download');
    expect(doc.createElement).toHaveBeenCalledWith('a');
    expect(clicks).toHaveLength(1);
    expect(clicks[0].click).toHaveBeenCalledOnce();
  });

  it('iOS: sets target="_blank" so Safari shows the share sheet', () => {
    const { doc, clicks } = makeDocStub();
    const blob = new Blob(['x'], { type: 'application/pdf' });
    const r = openBlobSafely({
      blob, filename: 'test.pdf',
      isIOS: true,
      doc,
      win: { open: vi.fn() } as unknown as Window,
    });
    expect(r.ok).toBe(true);
    expect(clicks[0].target).toBe('_blank');
  });

  it('sets rel="noopener" on the anchor', () => {
    const { doc, clicks } = makeDocStub();
    const blob = new Blob(['x'], { type: 'application/pdf' });
    openBlobSafely({
      blob, filename: 'test.pdf',
      isIOS: false,
      doc,
      win: { open: vi.fn() } as unknown as Window,
    });
    expect(clicks[0].rel).toBe('noopener');
  });
});

describe('PR #456 Z-H14 — fallback when <a download> throws', () => {
  it('falls back to window.open + reports via=window-open on success', () => {
    const blob = new Blob(['x'], { type: 'application/pdf' });
    const doc = {
      createElement: vi.fn(() => { throw new Error('synth click failed'); }),
      body: { appendChild: vi.fn(), removeChild: vi.fn() },
    } as unknown as Document;
    const win = { open: vi.fn(() => ({ closed: false } as Window)) } as unknown as Window;
    const r = openBlobSafely({ blob, filename: 'test.pdf', isIOS: false, doc, win });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.via).toBe('window-open');
    expect(win.open).toHaveBeenCalledOnce();
  });

  it('popup blocker (win.open returns null) → ok:false popup-blocked + onError fires', () => {
    const blob = new Blob(['x'], { type: 'application/pdf' });
    const doc = {
      createElement: vi.fn(() => { throw new Error('a-click failed'); }),
      body: { appendChild: vi.fn(), removeChild: vi.fn() },
    } as unknown as Document;
    const win = { open: vi.fn(() => null) } as unknown as Window;
    const onError = vi.fn();
    const r = openBlobSafely({ blob, filename: 'test.pdf', isIOS: true, doc, win, onError });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('popup-blocked');
    expect(onError).toHaveBeenCalledWith(expect.stringContaining('Popup blocked'));
  });
});

describe('PR #456 Z-H14 — defensive rejections', () => {
  it('invalid (zero-size) blob → invalid-blob + onError fires', () => {
    const { doc } = makeDocStub();
    const onError = vi.fn();
    const r = openBlobSafely({
      blob: new Blob([], { type: 'application/pdf' }),
      filename: 'x.pdf',
      onError,
      doc,
      win: { open: vi.fn() } as unknown as Window,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('invalid-blob');
    expect(onError).toHaveBeenCalled();
  });

  it('no document (SSR) → no-document + onError fires', () => {
    const blob = new Blob(['x'], { type: 'application/pdf' });
    const onError = vi.fn();
    const r = openBlobSafely({
      blob, filename: 'x.pdf', onError,
      doc: undefined as unknown as Document,
      win: undefined as unknown as Window,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('no-document');
    expect(onError).toHaveBeenCalled();
  });
});

describe('PR #456 Z-H14 — pdfGenerator wire-up', () => {
  it('imports openBlobSafely', () => {
    expect(pdfGenSrc).toMatch(/import\s*\{[^}]*openBlobSafely[^}]*\}\s*from\s*['"]@\/lib\/openBlobSafely['"]/);
  });

  it('calls openBlobSafely (NOT raw window.open / <a> conditional UA branch)', () => {
    expect(pdfGenSrc).toMatch(/openBlobSafely\(\s*\{/);
    // Regression guard: no more `if (/iPhone|iPad|iPod/i.test(navigator.userAgent))` branch
    // followed by window.open / a.click in pdfGenerator. (Both PDF callsites must use the helper.)
    const oldIosBranch = /if\s*\(\/iPhone\|iPad\|iPod\/i\.test\(navigator\.userAgent\)\)\s*\{[\s\S]{0,200}?window\.open\(\s*url\s*,/;
    expect(pdfGenSrc).not.toMatch(oldIosBranch);
  });
});

describe('PR #456 Z-H14 — helper source-level invariants', () => {
  it('exports openBlobSafely + detectIOS', () => {
    expect(helperSrc).toMatch(/export\s+function\s+openBlobSafely/);
    expect(helperSrc).toMatch(/export\s+function\s+detectIOS/);
  });

  it('schedules URL.revokeObjectURL with a 60s timer (memory hygiene)', () => {
    expect(helperSrc).toMatch(/REVOKE_AFTER_MS\s*=\s*60_?000/);
    expect(helperSrc).toMatch(/URL\.revokeObjectURL\(\s*url\s*\)/);
  });

  it('iOS branch picks target=_blank for Safari share sheet', () => {
    expect(helperSrc).toMatch(/if\s*\(\s*isIOS\s*\)\s*a\.target\s*=\s*['"]_blank['"]/);
  });
});
