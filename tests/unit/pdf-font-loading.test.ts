// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PDF_FONT_STYLESHEET_URL, PDF_FONT_TIMEOUT_MS, preparePdfFonts } from '../../src/lib/pdfFonts';

function setupFonts(options: { ready?: Promise<unknown> } = {}) {
  const doc = document.implementation.createHTMLDocument('PDF font fixture');
  const load = vi.fn().mockResolvedValue([{ status: 'loaded' }]);
  const check = vi.fn().mockReturnValue(true);
  Object.defineProperty(doc, 'fonts', { value: { load, check, ready: options.ready || Promise.resolve() }, configurable: true });
  return { doc, load, check };
}

function stylesheet(doc: Document): HTMLLinkElement {
  const link = doc.querySelector<HTMLLinkElement>('link[data-cocotrip-pdf-fonts]');
  expect(link).not.toBeNull();
  return link!;
}

afterEach(() => {
  vi.useRealTimers();
});

describe('PDF-only CJK font preparation (fake Font Loading API; no external requests)', () => {
  it('does not request fonts at module import or block the public HTML', () => {
    expect(document.querySelector('[data-cocotrip-pdf-fonts]')).toBeNull();
    const html = readFileSync(resolve(process.cwd(), 'index.html'), 'utf8');
    expect(html).not.toMatch(/<link[^>]+fonts\.(googleapis|gstatic)\.com/);
    expect(html).not.toContain('family=Noto');
  });

  it.each(['한국어 여행 경복궁', 'English trip Seoul', '日本語の旅行 浅草', '中文旅行 景福宫', ''])(
    'awaits CSS, both weights and actual text subsets for %j', async (text) => {
      const { doc, load, check } = setupFonts();
      const prepared = preparePdfFonts(text, doc);
      expect(load).not.toHaveBeenCalled();
      const link = stylesheet(doc);
      expect(link.href).toBe(PDF_FONT_STYLESHEET_URL);
      expect(link.referrerPolicy).toBe('no-referrer');
      expect(link.href).not.toContain('text=');
      link.dispatchEvent(new Event('load'));
      expect(await prepared).toBe(true);
      expect(load).toHaveBeenCalledTimes(6);
      for (const family of ['KR', 'JP', 'SC']) {
        for (const weight of [400, 700]) {
          expect(load).toHaveBeenCalledWith(`${weight} 14px "Noto Sans ${family}"`, expect.any(String));
        }
      }
      const requestedText = load.mock.calls[0][1];
      for (const char of new Set(text)) expect(requestedText).toContain(char);
      for (const char of 'Aa 한글 テスト 中文') expect(requestedText).toContain(char);
      expect(new Set(requestedText).size).toBe(requestedText.length);
      expect(check).toHaveBeenCalledTimes(6);
    },
  );

  it('shares one in-flight stylesheet, but prepares each export text separately', async () => {
    const { doc, load } = setupFonts();
    const first = preparePdfFonts('첫 문서', doc);
    const second = preparePdfFonts('二つ目の文書', doc);
    expect(doc.querySelectorAll('link')).toHaveLength(1);
    stylesheet(doc).dispatchEvent(new Event('load'));
    expect(await Promise.all([first, second])).toEqual([true, true]);
    expect(load).toHaveBeenCalledTimes(12);
    expect(await preparePdfFonts('Third document', doc)).toBe(true);
    expect(doc.querySelectorAll('link')).toHaveLength(1);
    expect(load).toHaveBeenCalledTimes(18);
  });

  it('does not declare ready before document font/layout readiness', async () => {
    let markReady: () => void = () => {};
    const ready = new Promise<void>((resolveReady) => { markReady = resolveReady; });
    const { doc, check } = setupFonts({ ready });
    const prepared = preparePdfFonts('한글', doc);
    stylesheet(doc).dispatchEvent(new Event('load'));
    await Promise.resolve();
    await Promise.resolve();
    expect(check).not.toHaveBeenCalled();
    markReady();
    expect(await prepared).toBe(true);
  });

  it('rejects unsupported Font Loading API without adding a stylesheet', async () => {
    const doc = document.implementation.createHTMLDocument('Unsupported fixture');
    expect(await preparePdfFonts('한글', doc)).toBe(false);
    expect(doc.querySelectorAll('link')).toHaveLength(0);
  });

  it('removes a failed stylesheet and lets the next export retry', async () => {
    const { doc, load } = setupFonts();
    const first = preparePdfFonts('한글', doc);
    const failedLink = stylesheet(doc);
    failedLink.dispatchEvent(new Event('error'));
    expect(await first).toBe(false);
    expect(load).not.toHaveBeenCalled();
    expect(failedLink.isConnected).toBe(false);
    const retry = preparePdfFonts('日本語', doc);
    expect(stylesheet(doc)).not.toBe(failedLink);
    stylesheet(doc).dispatchEvent(new Event('load'));
    expect(await retry).toBe(true);
  });

  it('bounds a stalled stylesheet and ignores its late load after a retry starts', async () => {
    vi.useFakeTimers();
    const { doc, load } = setupFonts();
    const first = preparePdfFonts('한글', doc);
    const oldLink = stylesheet(doc);
    await vi.advanceTimersByTimeAsync(PDF_FONT_TIMEOUT_MS);
    expect(await first).toBe(false);
    expect(oldLink.isConnected).toBe(false);
    const retry = preparePdfFonts('中文', doc);
    oldLink.dispatchEvent(new Event('load'));
    expect(load).not.toHaveBeenCalled();
    stylesheet(doc).dispatchEvent(new Event('load'));
    expect(await retry).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(['rejected', 'empty', 'unchecked'])('rejects %s font faces even when stylesheet loaded', async (failure) => {
    const { doc, load, check } = setupFonts();
    if (failure === 'rejected') load.mockRejectedValue(new Error('fake font request failure'));
    if (failure === 'empty') load.mockResolvedValue([]);
    if (failure === 'unchecked') check.mockReturnValue(false);
    const prepared = preparePdfFonts('한글', doc);
    stylesheet(doc).dispatchEvent(new Event('load'));
    expect(await prepared).toBe(false);
    load.mockResolvedValue([{ status: 'loaded' }]);
    check.mockReturnValue(true);
    expect(await preparePdfFonts('한글', doc)).toBe(true);
  });

  it('bounds hanging font loads and allows a later retry without a second stylesheet', async () => {
    vi.useFakeTimers();
    const { doc, load } = setupFonts();
    load.mockReturnValue(new Promise(() => {}));
    const prepared = preparePdfFonts('한글', doc);
    stylesheet(doc).dispatchEvent(new Event('load'));
    await vi.advanceTimersByTimeAsync(PDF_FONT_TIMEOUT_MS);
    expect(await prepared).toBe(false);
    load.mockResolvedValue([{ status: 'loaded' }]);
    expect(await preparePdfFonts('中文', doc)).toBe(true);
    expect(doc.querySelectorAll('link')).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('bounds document.fonts.ready rather than waiting forever after face loads', async () => {
    vi.useFakeTimers();
    const { doc } = setupFonts({ ready: new Promise(() => {}) });
    const prepared = preparePdfFonts('한글', doc);
    stylesheet(doc).dispatchEvent(new Event('load'));
    await vi.advanceTimersByTimeAsync(PDF_FONT_TIMEOUT_MS);
    expect(await prepared).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('gates capture on preparation and preserves the existing CJK/onscreen/measurement guards', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/pages/PlanDetailPage/pdfGenerator.ts'), 'utf8');
    expect(source).toContain("await preparePdfFonts(container.textContent || '')");
    expect(source).toContain('if (!fontsPrepared || fontTest.offsetWidth === 0)');
    expect(source.indexOf('await preparePdfFonts(')).toBeLessThan(source.indexOf('await worker.toCanvas()'));
    expect(source).toContain('position:absolute;top:0;left:0;width:800px');
    expect(source).toContain('"Noto Sans KR","Noto Sans JP","Noto Sans SC"');
    expect(source).toContain('toast.error(toastStr.fontFail');
    expect(source).toContain('CJK font preparation failed');
    expect(source).not.toContain('after 3 retries');
    expect(source).not.toContain('font-display:block;');
  });
});
