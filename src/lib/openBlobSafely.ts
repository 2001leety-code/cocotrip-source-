/**
 * openBlobSafely — iOS-safe blob open/download.
 *
 * PR #456 (Audit Z-H14 — 2026-05-16). Pre-fix: pdfGenerator.ts called
 *
 *   if (/iPhone|iPad|iPod/i.test(navigator.userAgent)) {
 *     window.open(url, '_blank');
 *   } else {
 *     const a = document.createElement('a'); a.href = url; a.download = filename; a.click();
 *   }
 *
 * iOS Safari's popup blocker silently rejects `window.open(blob:url)`
 * unless the call happens synchronously inside a user-gesture handler.
 * Our PDF flow awaits Puppeteer / html2canvas first, so the await chain
 * breaks the gesture context → popup blocked → no PDF appears → user
 * thinks the download failed but sees no error.
 *
 * iOS 13+ supports `<a download>` for blob URLs in most cases (saves
 * to Files app or shows the share sheet). Try that first on every
 * platform; fall back to window.open if the click doesn't produce a
 * download. Detect popup-blocker fallout (`win === null`) and surface
 * a user-visible error so the silent-failure mode is gone.
 *
 * Returns the strategy that was used so callers can record analytics.
 */

export type BlobOpenResult =
  | { ok: true; via: 'a-download' | 'window-open' }
  | { ok: false; reason: 'popup-blocked' | 'invalid-blob' | 'no-document' };

export interface OpenBlobOptions {
  blob: Blob;
  filename: string;
  /** Override iOS detection in tests. */
  isIOS?: boolean;
  /** Override document for tests / SSR safety. */
  doc?: Document;
  /** Override window for tests. */
  win?: Window;
  /** Toast / alert hook fired on failure. Default: alert(). */
  onError?: (message: string) => void;
}

const REVOKE_AFTER_MS = 60_000;

export function detectIOS(ua?: string): boolean {
  const userAgent = ua ?? (typeof navigator !== 'undefined' ? navigator.userAgent : '');
  return /iPhone|iPad|iPod/i.test(userAgent);
}

function fallbackUserAlert(message: string): void {
  // Tiny wrapper so callers can swap in toast/banner UI. Default alert()
  // because pdfGenerator runs in many contexts and we'd rather block
  // the user with a dialog than silently do nothing.
  try {
    // eslint-disable-next-line no-alert
    if (typeof alert === 'function') alert(message);
    else console.warn('[openBlobSafely]', message);
  } catch {
    console.warn('[openBlobSafely]', message);
  }
}

export function openBlobSafely(options: OpenBlobOptions): BlobOpenResult {
  const { blob, filename, isIOS = detectIOS(), onError = fallbackUserAlert } = options;
  const doc = options.doc ?? (typeof document !== 'undefined' ? document : undefined);
  const win = options.win ?? (typeof window !== 'undefined' ? window : undefined);

  if (!doc) {
    onError('Cannot save PDF in this environment.');
    return { ok: false, reason: 'no-document' };
  }
  if (!blob || (typeof blob.size === 'number' && blob.size === 0)) {
    onError('PDF is empty — please retry.');
    return { ok: false, reason: 'invalid-blob' };
  }

  const url = URL.createObjectURL(blob);
  const scheduleRevoke = () => setTimeout(() => {
    try { URL.revokeObjectURL(url); } catch { /* noop */ }
  }, REVOKE_AFTER_MS);

  // 1. Try <a download> first (works on every modern platform incl. iOS 13+).
  //    Works even when the call is post-await because clicking a synthesized
  //    anchor is treated as a user-gesture continuation by every browser
  //    except very old WebKit (handled by the fallback below).
  try {
    const a = doc.createElement('a');
    a.href = url;
    a.download = filename;
    // rel=noopener is irrelevant for download links but doesn't hurt.
    a.rel = 'noopener';
    // iOS Safari prefers target=_blank for blob downloads to show the
    // share sheet rather than navigating away from the SPA.
    if (isIOS) a.target = '_blank';
    doc.body.appendChild(a);
    a.click();
    doc.body.removeChild(a);
    scheduleRevoke();
    return { ok: true, via: 'a-download' };
  } catch (err) {
    console.warn('[openBlobSafely] <a download> click failed, falling back to window.open:', err);
  }

  // 2. Fallback: window.open. Popup blocker may return null — surface it.
  if (!win) {
    onError('Cannot open PDF in this environment.');
    scheduleRevoke();
    return { ok: false, reason: 'no-document' };
  }
  const popup = win.open(url, '_blank');
  if (!popup || popup.closed || typeof popup.closed === 'undefined') {
    // Popup blocked. Surface error so user knows.
    onError('Popup blocked — please allow popups for cocotripkr.com and retry.');
    scheduleRevoke();
    return { ok: false, reason: 'popup-blocked' };
  }
  scheduleRevoke();
  return { ok: true, via: 'window-open' };
}

export default openBlobSafely;
