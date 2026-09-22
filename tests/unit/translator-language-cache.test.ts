import { afterEach, describe, expect, it, vi } from 'vitest';

const generateContent = vi.fn(async () => ({ response: { text: () => 'en' } }));
vi.mock('@google/generative-ai', () => ({
  GoogleGenerativeAI: class {
    getGenerativeModel() { return { generateContent }; }
  },
}));

// @ts-expect-error — ESM .js, no type decls
import { _cacheSize, _clearCache, detectAndTranslate, detectLanguage } from '../../api/_shared/translator.js';

describe('translator language detection cache', () => {
  afterEach(() => { vi.unstubAllEnvs(); });

  it('reuses successful long-text detection', async () => {
    vi.stubEnv('GEMINI_API_KEY', 'test');
    _clearCache();
    generateContent.mockClear();
    const text = 'A'.repeat(240);

    await expect(detectLanguage(text)).resolves.toBe('en');
    await expect(detectLanguage(text)).resolves.toBe('en');

    expect(generateContent).toHaveBeenCalledTimes(1);
  });

  it('shares detection across detectAndTranslate calls and does not cache invalid output', async () => {
    vi.stubEnv('GEMINI_API_KEY', 'test');
    _clearCache();
    generateContent.mockClear();
    const text = 'B'.repeat(240);
    await detectAndTranslate(text, 'ko');
    await detectAndTranslate(text, 'ko');
    expect(generateContent).toHaveBeenCalledTimes(2);

    _clearCache();
    generateContent.mockReset();
    generateContent.mockResolvedValue({ response: { text: () => 'invalid' } });
    await detectLanguage(text);
    await detectLanguage(text);
    expect(generateContent).toHaveBeenCalledTimes(2);
  });

  it('keeps short and CJK detection free', async () => {
    vi.stubEnv('GEMINI_API_KEY', 'test');
    _clearCache();
    generateContent.mockClear();
    await expect(detectLanguage('short text')).resolves.toBe('en');
    await expect(detectLanguage('中文'.repeat(200))).resolves.toBe('zh');
    expect(generateContent).not.toHaveBeenCalled();
  });

  it('retries failed detection and keeps the existing cache bounded', async () => {
    vi.stubEnv('GEMINI_API_KEY', 'test');
    _clearCache();
    generateContent.mockReset();
    generateContent.mockRejectedValueOnce(new Error('synthetic unavailable'));
    generateContent.mockResolvedValue({ response: { text: () => 'other' } });
    const text = 'C'.repeat(240);
    await expect(detectLanguage(text)).resolves.toBe('en');
    await expect(detectLanguage(text)).resolves.toBe('other');
    expect(generateContent).toHaveBeenCalledTimes(2);
    for (let i = 0; i < 101; i++) await detectLanguage(`${text}${i}`);
    expect(_cacheSize()).toBe(100);
  });
});
