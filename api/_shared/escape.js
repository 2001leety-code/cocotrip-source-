/**
 * HTML / Telegram-HTML escaping helpers.
 *
 * Audit CZ2 fix (PR #421, 2026-05-13): API endpoints that template
 * user-controlled strings into HTML (confirmation emails, Telegram alerts,
 * generated PDFs) interpolated those strings raw. A booking with
 * `customerName = '<img src=x onerror=alert(1)>'` would render in Gmail
 * with the tag executed in any client that doesn't strip script-equivalents,
 * and at minimum corrupts layout / enables phishing payloads.
 *
 * Two existing local copies of `escapeHtml` existed (api/_shared/telegram-
 * throttle.js + api/pdf/generate.js) — this module consolidates them and
 * gives callers the strictest variant by default.
 *
 * Variants:
 *   - escapeHtml(s)  — for text inside element content. Replaces `& < > " '`.
 *                      Safe for `<div>${escapeHtml(name)}</div>`.
 *   - escapeAttr(s)  — alias of escapeHtml. Explicit choice for attribute
 *                      contexts (`href="${escapeAttr(url)}"`). Helps grep.
 *   - escapeTelegram(s) — Telegram Bot API HTML parse_mode only respects
 *                      `< > &` + a whitelist of tags (b/i/u/s/a/code/pre).
 *                      Use this when sending parse_mode=HTML messages.
 *
 * All variants coerce `null` / `undefined` → empty string so a missing
 * field can't blow up template rendering.
 */

/**
 * Escape characters that can break out of HTML content or attribute context.
 * Safe default for templating user input into email/voucher HTML.
 *
 * @param {unknown} s
 * @returns {string}
 */
export function escapeHtml(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Explicit alias for attribute-context escaping. Same output as escapeHtml
 * but makes the intent legible at the call site.
 */
export function escapeAttr(s) {
  return escapeHtml(s);
}

/**
 * Telegram Bot API parse_mode=HTML only requires escaping `< > &`
 * (no quotes, since attributes aren't part of the parse). Using the
 * broader escapeHtml() works but produces visible `&quot;` in plain text.
 *
 * @param {unknown} s
 * @returns {string}
 */
export function escapeTelegram(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export default escapeHtml;
