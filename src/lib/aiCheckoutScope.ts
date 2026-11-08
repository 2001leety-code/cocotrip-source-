// src/lib/aiCheckoutScope.ts
// UI-only metadata for AI checkout: which signed-in UID (or null) started a PayPal order for an attempt.
// NOT authorization evidence and NOT payment evidence — server still owns ownership/capture claims.
// Stored per orderId under its own prefix; refuses to overwrite a different scope; per-tab memory fallback.
// Never stores anything beyond the three bounded IDs (no PII, URLs, tokens).
export type AiCheckoutScope = { uid: string | null; attemptId: string; orderId: string };
const PREFIX = 'cocotrip:ai-checkout-scope:v1:';
const ID_MAX = 128;
const RAW_MAX = 1024;
const ID_RE = /^[A-Za-z0-9_-]+$/;
const memory = new Map<string, AiCheckoutScope>();
function isBoundId(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0 && v.length <= ID_MAX && ID_RE.test(v);
}
function isScope(v: unknown): v is AiCheckoutScope {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return false;
  const keys = Object.keys(v);
  if (keys.length !== 3 || !keys.includes('uid') || !keys.includes('attemptId') || !keys.includes('orderId')) return false;
  const s = v as Record<string, unknown>;
  const uidOk = s.uid === null || isBoundId(s.uid);
  return uidOk && isBoundId(s.attemptId) && isBoundId(s.orderId);
}
function sameScope(a: AiCheckoutScope, b: AiCheckoutScope): boolean {
  return a.uid === b.uid && a.attemptId === b.attemptId && a.orderId === b.orderId;
}
function storageOf(): Storage | null {
  try { return typeof window === 'undefined' ? null : window.localStorage; } catch { return null; }
}
type Stored = { state: 'absent' } | { state: 'unavailable' } | { state: 'malformed' } | { state: 'ok'; scope: AiCheckoutScope };
/** Own-key check: the payload's orderId must equal the key suffix, otherwise it is treated as malformed. */
function readStored(orderId: string): Stored {
  const st = storageOf();
  if (!st) return { state: 'unavailable' };
  let raw: string | null = null;
  try { raw = st.getItem(PREFIX + orderId); } catch { return { state: 'unavailable' }; }
  if (raw === null) return { state: 'absent' };
  if (raw.length > RAW_MAX) return { state: 'malformed' };
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return { state: 'malformed' }; }
  if (!isScope(parsed) || parsed.orderId !== orderId) return { state: 'malformed' };
  return { state: 'ok', scope: parsed };
}
/** Persists the scope once per orderId. A different existing scope (or an unreadable entry) is never overwritten. */
export function rememberAiCheckoutScope(scope: AiCheckoutScope): void {
  if (!isScope(scope)) return;
  const copy: AiCheckoutScope = { uid: scope.uid, attemptId: scope.attemptId, orderId: scope.orderId };
  const inMem = memory.get(copy.orderId);
  if (inMem && !sameScope(inMem, copy)) return;
  const stored = readStored(copy.orderId);
  if (stored.state === 'unavailable') return; // Cannot prove absence; never overwrite an unreadable scope.
  if (stored.state === 'malformed') return;
  if (stored.state === 'ok') {
    if (!sameScope(stored.scope, copy)) return;
    memory.set(copy.orderId, copy);
    return;
  }
  const st = storageOf();
  if (st) {
    try {
      st.setItem(PREFIX + copy.orderId, JSON.stringify(copy));
      const back = readStored(copy.orderId);
      if (back.state === 'ok' && sameScope(back.scope, copy)) { memory.set(copy.orderId, copy); return; }
    } catch { /* storage unavailable or quota: fall through to tab memory */ }
  }
  memory.set(copy.orderId, copy);
}
/** Returns a copy of the scope for this orderId, or null when absent/malformed. Null is not "no account". */
export function readAiCheckoutScope(orderId: string): AiCheckoutScope | null {
  if (!isBoundId(orderId)) return null;
  const stored = readStored(orderId);
  if (stored.state === 'ok') {
    const existing = memory.get(orderId);
    if (existing && !sameScope(existing, stored.scope)) return null;
    memory.set(orderId, stored.scope);
    return { ...stored.scope };
  }
  if (stored.state === 'malformed') return null;
  const inMem = memory.get(orderId);
  return inMem ? { uid: inMem.uid, attemptId: inMem.attemptId, orderId: inMem.orderId } : null;
}
/** Fresh attempt id from a secure RNG only; throws when none exists (never falls back to Math.random). */
export function newAiCheckoutAttemptId(): string {
  const c = typeof globalThis !== 'undefined' ? (globalThis as { crypto?: Crypto }).crypto : undefined;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  if (c && typeof c.getRandomValues === 'function') {
    const bytes = new Uint8Array(16);
    c.getRandomValues(bytes);
    return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  }
  throw new Error('secure random unavailable');
}
