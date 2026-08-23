// Guide HTML allowlist shared by the browser renderer and the Node import audit.
// Keep this module dependency-free so both sides execute exactly the same policy.

export const GUIDE_HTML_ALLOWED_TAGS = Object.freeze([
  'p', 'br', 'hr',
  'h2', 'h3', 'h4',
  'strong', 'b', 'em', 'i', 'u', 's', 'small',
  'ul', 'ol', 'li', 'blockquote',
  'a', 'img', 'figure', 'figcaption',
  'div', 'span',
  'table', 'thead', 'tbody', 'tr', 'th', 'td',
  'pre', 'code',
]);

export const GUIDE_HTML_ALLOWED_ATTR = Object.freeze([
  'href', 'src', 'alt', 'title',
  'width', 'height', 'loading',
  'class', 'colspan', 'rowspan',
]);

const URL_ATTRS = new Set(['href', 'src']);
const NUMERIC_ATTRS = new Set(['width', 'height', 'colspan', 'rowspan']);
const configuredPurifiers = new WeakSet();

export function isSafeGuideUrl(rawValue) {
  if (typeof rawValue !== 'string') return false;
  const value = rawValue.trim();
  if (!value || /[\u0000-\u001f\u007f]/.test(value)) return false;

  // Explicit web URLs and same-site/root/fragment/query-relative links only.
  if (/^https?:\/\//i.test(value)) return true;
  if (/^\/(?!\/)/.test(value) || value.startsWith('#') || value.startsWith('?')) return true;
  if (/^(?:\.\/|\.\.\/)/.test(value)) return true;

  // A plain relative path is safe only when it cannot be parsed as a scheme.
  return !/^[a-z][a-z0-9+.-]*:/i.test(value) && !value.startsWith('//');
}

function configurePurifier(purifier) {
  if (configuredPurifiers.has(purifier)) return;
  purifier.addHook('uponSanitizeAttribute', (node, data) => {
    const name = String(data.attrName || '').toLowerCase();
    const value = String(data.attrValue || '');
    const tag = String(node.nodeName || '').toLowerCase();

    if (URL_ATTRS.has(name)) {
      const correctPair = (tag === 'a' && name === 'href') || (tag === 'img' && name === 'src');
      if (!correctPair || !isSafeGuideUrl(value)) data.keepAttr = false;
      return;
    }

    if (name === 'class') {
      const kept = value.split(/\s+/).filter((token) => token === 'post-summary');
      if (kept.length === 0) data.keepAttr = false;
      else data.attrValue = kept.join(' ');
      return;
    }

    if (NUMERIC_ATTRS.has(name) && !/^\d{1,4}$/.test(value)) {
      data.keepAttr = false;
      return;
    }

    if (name === 'loading' && value !== 'lazy' && value !== 'eager') data.keepAttr = false;
  });
  configuredPurifiers.add(purifier);
}

export function sanitizeGuideHtmlWith(purifier, rawHtml) {
  if (!purifier || typeof purifier.sanitize !== 'function' || typeof purifier.addHook !== 'function') {
    return { html: '', changed: true };
  }
  configurePurifier(purifier);
  const source = typeof rawHtml === 'string' ? rawHtml : '';
  const html = purifier.sanitize(source, {
    ALLOWED_TAGS: GUIDE_HTML_ALLOWED_TAGS,
    ALLOWED_ATTR: GUIDE_HTML_ALLOWED_ATTR,
    ALLOW_DATA_ATTR: false,
    ALLOW_ARIA_ATTR: false,
    FORBID_TAGS: ['script', 'style', 'iframe', 'object', 'embed', 'form', 'input', 'button', 'textarea', 'select', 'option', 'meta', 'link', 'base', 'svg', 'math', 'template'],
    FORBID_ATTR: ['style', 'id', 'srcdoc', 'srcset', 'formaction', 'action', 'poster'],
    KEEP_CONTENT: true,
    RETURN_TRUSTED_TYPE: false,
  });
  return { html: String(html), changed: String(html) !== source };
}
