import DOMPurify from 'dompurify';
import { sanitizeGuideHtmlWith } from './guideHtmlPolicy.mjs';

type Purifier = {
  sanitize: (...args: unknown[]) => unknown;
  addHook: (name: string, hook: (...args: unknown[]) => void) => void;
};

function browserPurifier(): Purifier | null {
  const candidate = DOMPurify as unknown as Purifier & ((window: Window) => Purifier);
  if (typeof candidate.sanitize === 'function') return candidate;
  if (typeof window === 'undefined' || typeof candidate !== 'function') return null;
  return candidate(window);
}

/** No DOM/purifier means empty HTML: rendering unreviewed markup is never the fallback. */
export function sanitizeGuideHtml(rawHtml: string): string {
  return sanitizeGuideHtmlWith(browserPurifier(), rawHtml).html;
}
