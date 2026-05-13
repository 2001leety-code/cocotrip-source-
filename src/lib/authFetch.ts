/**
 * authFetch — fetch() wrapper that attaches the current user's Firebase ID
 * token as `Authorization: Bearer <token>`.
 *
 * Why this exists: PR #418 (Audit P0 — Agent W Critical IDOR fix) tightened the
 * user-scoped endpoints (my-bookings / voucher / cancelBooking / modifyBooking /
 * reviews) to require a verified ID token instead of trusting a body/query
 * `userEmail` or `userId`. Every client caller for those endpoints must now
 * include the Authorization header.
 *
 * Behavior:
 *   - If a user is signed in, attaches `Authorization: Bearer <idToken>`.
 *   - If `forceRefresh` is true, requests a fresh token (handles 5-min token
 *     expiry without forcing a sign-out/sign-in round trip).
 *   - If no user is signed in, the request is sent without the header — the
 *     server will return 401 and the caller surfaces that to the user.
 *
 * Anti-pattern: do NOT add `headers: { Authorization: 'Bearer ...' }` ad hoc
 * in components. Use this helper so the bearer-attachment is in one place and
 * mistake-lint can catch raw `fetch('/api/...')` against the protected
 * endpoint allowlist (see scripts/check-mistake-lint.mjs P43 rule).
 */
import { auth } from '@/lib/firebase';

export async function authFetch(
  input: RequestInfo | URL,
  init: RequestInit = {},
  opts: { forceRefresh?: boolean } = {},
): Promise<Response> {
  const user = auth.currentUser;
  const headers = new Headers(init.headers || {});
  if (user) {
    try {
      const idToken = await user.getIdToken(opts.forceRefresh);
      headers.set('Authorization', `Bearer ${idToken}`);
    } catch (err) {
      // Token retrieval failed (offline, revoked, etc.). Continue without the
      // header — server will respond 401 and caller handles it.
      console.warn('[authFetch] getIdToken failed:', (err as Error)?.message);
    }
  }
  return fetch(input, { ...init, headers });
}

/**
 * authDownload — fetch a binary asset (PDF, image) over an authenticated
 * endpoint and save it via a hidden anchor. Used for the voucher PDF flow,
 * which previously relied on a plain <a href> + query-param email match.
 *
 * The server returns a binary stream with Content-Disposition; this helper
 * blobs the response and triggers a download with the suggested filename.
 *
 * Throws on non-2xx so callers can surface the error to the user instead of
 * downloading an empty/JSON-error PDF.
 */
export async function authDownload(
  url: string,
  filename: string,
  init: RequestInit = {},
): Promise<void> {
  const res = await authFetch(url, init);
  if (!res.ok) {
    let detail = '';
    try {
      const body = await res.json();
      detail = body?.error || body?.message || '';
    } catch { /* binary 200 path → ignored */ }
    throw new Error(detail || `Download failed (${res.status})`);
  }
  const blob = await res.blob();
  const objectUrl = URL.createObjectURL(blob);
  try {
    const a = document.createElement('a');
    a.href = objectUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
  } finally {
    // Defer revoke so Safari/iOS finishes the download.
    setTimeout(() => URL.revokeObjectURL(objectUrl), 4000);
  }
}
