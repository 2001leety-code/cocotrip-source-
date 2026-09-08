// PDF-only web fonts. Importing this module performs no network or DOM work.
// The fixed URL never includes document text, customer fields, or credentials.
export const PDF_FONT_STYLESHEET_URL = 'https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@400;700&family=Noto+Sans+JP:wght@400;700&family=Noto+Sans+SC:wght@400;700&display=block';
export const PDF_FONT_TIMEOUT_MS = 8000;
const PDF_FONT_FAMILIES = ['Noto Sans KR', 'Noto Sans JP', 'Noto Sans SC'];
const stylesheetLoads = new WeakMap<Document, Promise<void>>();

function loadStylesheet(doc: Document): Promise<void> {
  const existing = stylesheetLoads.get(doc);
  if (existing) return existing;

  const link = doc.createElement('link');
  link.rel = 'stylesheet';
  link.href = PDF_FONT_STYLESHEET_URL;
  link.dataset.cocotripPdfFonts = 'true';
  link.referrerPolicy = 'no-referrer';
  const loading = new Promise<void>((resolve, reject) => {
    const finish = (loaded: boolean) => {
      clearTimeout(timer);
      link.onload = null;
      link.onerror = null;
      if (loaded) resolve();
      else {
        link.remove();
        reject(new Error('PDF_FONT_STYLESHEET_UNAVAILABLE'));
      }
    };
    const timer = setTimeout(() => finish(false), PDF_FONT_TIMEOUT_MS);
    link.onload = () => finish(true);
    link.onerror = () => finish(false);
    doc.head.appendChild(link);
  });
  stylesheetLoads.set(doc, loading);
  void loading.catch(() => {
    if (stylesheetLoads.get(doc) === loading) stylesheetLoads.delete(doc);
  });
  return loading;
}

async function withinFontDeadline<T>(work: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error('PDF_FONT_LOAD_TIMEOUT')), PDF_FONT_TIMEOUT_MS);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/** Prepare both weights and the actual document's Unicode subsets before capture.
 * FontFaceSet.load's second argument stays inside the browser, never in a URL.
 * Missing Font Loading API, failed CSS/fonts, empty faces or timeout are not ready.
 */
export async function preparePdfFonts(text: string, doc: Document = document): Promise<boolean> {
  const fonts = doc.fonts;
  if (!fonts || typeof fonts.load !== 'function' || typeof fonts.check !== 'function') return false;
  try {
    await loadStylesheet(doc);
    const characters = [...new Set(`Aa 한글 テスト 中文 ${text}`)].join('');
    const requests = PDF_FONT_FAMILIES.flatMap((family) => [400, 700].map((weight) => `${weight} 14px "${family}"`));
    return await withinFontDeadline((async () => {
      const loaded = await Promise.all(requests.map((font) => fonts.load(font, characters)));
      if (loaded.some((faces) => faces.length === 0)) return false;
      // Explicit loads must happen first: document.fonts.ready alone may resolve
      // before any CJK face has been requested. Wait for layout completion too.
      await fonts.ready;
      return requests.every((font) => fonts.check(font, characters));
    })());
  } catch {
    return false;
  }
}
