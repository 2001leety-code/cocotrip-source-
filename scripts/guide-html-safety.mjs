import createDOMPurify from 'dompurify';
import { JSDOM } from 'jsdom';
import { sanitizeGuideHtmlWith } from '../src/lib/guideHtmlPolicy.mjs';

const window = new JSDOM('<!doctype html><html><body></body></html>').window;
const purifier = createDOMPurify(window);

/** Node-side audit used before any Blogger/Brain HTML can become a guide JSON file. */
export function auditGuideHtml(rawHtml) {
  return sanitizeGuideHtmlWith(purifier, rawHtml);
}
