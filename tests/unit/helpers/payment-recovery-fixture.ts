/**
 * Offline fixtures for the payment recovery handler tests. No network, no real Firestore, no PayPal.
 * The memory store mimics the Firestore admin surface the handlers use: collection/doc get/set/update/
 * delete, nested collections, and runTransaction with reads-before-writes + atomic commit + injectable
 * write failures (first write matching a path prefix fails, as a Firestore commit would).
 */
import { expect, vi } from 'vitest';

export type Row = Record<string, unknown>;
type SetOptions = { merge?: boolean };
export type Snapshot = { exists: boolean; id: string | undefined; data: () => Row | undefined };
/** The Firestore admin document surface the handlers use. */
export type DocRef = {
  path: string;
  id: string | undefined;
  get: () => Promise<Snapshot>;
  set: (value: Row, options?: SetOptions) => Promise<void>;
  update: (value: Row) => Promise<void>;
  delete: () => Promise<void>;
  collection: (name: string) => { doc: (id: string) => DocRef };
};
export type Tx = {
  get: (ref: DocRef) => Promise<Snapshot>;
  set: (ref: DocRef, value: Row, options?: SetOptions) => void;
  update: (ref: DocRef, value: Row) => void;
  delete: (ref: DocRef) => void;
};
export type MemoryDb = {
  collection: (name: string) => { doc: (id: string) => DocRef };
  doc: (path: string) => DocRef;
  runTransaction: <T>(callback: (tx: Tx) => Promise<T>) => Promise<T>;
};

export class OfflineSentinel { readonly kind = 'serverTimestamp'; }
export const TS = new OfflineSentinel();

type FailureRule = string | ((path: string, value: Row | undefined) => boolean);
export function memoryDb(failPaths: string[] = []) {
  const rows = new Map<string, Row>();
  const pendingFailures: FailureRule[] = [...failPaths];
  const check = (path: string, value?: Row) => {
    const index = pendingFailures.findIndex((rule) => (typeof rule === 'string' ? path.startsWith(rule) : rule(path, value)));
    if (index >= 0) { pendingFailures.splice(index, 1); throw new Error(`OFFLINE_INJECTED_WRITE_FAILURE:${path}`); }
  };
  const apply = (path: string, value: Row, merge: boolean) => rows.set(path, merge ? deepMerge(rows.get(path) || {}, value) : { ...value });
  const docRef = (path: string): DocRef => ({
    path, id: path.split('/').pop(),
    get: async () => ({ exists: rows.has(path), id: path.split('/').pop(), data: () => (rows.has(path) ? { ...rows.get(path) } : undefined) }),
    set: async (v: Row, o?: SetOptions) => { check(path, v); apply(path, v, !!o?.merge); },
    update: async (v: Row) => { check(path, v); apply(path, v, true); },
    delete: async () => { check(path); rows.delete(path); },
    collection: (name: string) => ({ doc: (id: string) => docRef(`${path}/${name}/${id}`) }),
  });
  const db: MemoryDb = {
    collection: (name: string) => ({ doc: (id: string) => docRef(`${name}/${id}`) }),
    doc: (path: string) => docRef(path),
    runTransaction: async <T>(cb: (tx: Tx) => Promise<T>): Promise<T> => {
      const writes: { path: string; value?: Row; merge?: boolean; del?: boolean }[] = [];
      const tx: Tx = {
        get: async (ref) => { expect(writes, 'transaction reads must precede writes').toHaveLength(0); return ref.get(); },
        set: (ref, value, o) => writes.push({ path: ref.path, value, merge: !!o?.merge }),
        update: (ref, value) => writes.push({ path: ref.path, value, merge: true }),
        delete: (ref) => writes.push({ path: ref.path, del: true }),
      };
      const result = await cb(tx);
      for (const w of writes) check(w.path, w.value);
      for (const w of writes) { if (w.del) rows.delete(w.path); else apply(w.path, w.value!, !!w.merge); }
      return result;
    },
  };
  return {
    db, rows,
    failNext: (prefix: string) => pendingFailures.push(prefix),
    /** Fails the next committed write whose path/value satisfies the predicate (e.g. only the release write). */
    failNextMatching: (rule: (path: string, value: Row | undefined) => boolean) => pendingFailures.push(rule),
  };
}

function isPlain(v: unknown): v is Row {
  return !!v && typeof v === 'object' && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype;
}
function deepMerge(base: Row, patch: Row): Row {
  const out: Row = { ...base };
  for (const [k, v] of Object.entries(patch)) {
    const current = out[k];
    out[k] = isPlain(v) && isPlain(current) ? deepMerge(current, v) : v;
  }
  return out;
}

export function fakeRes() {
  // Handlers always answer with a JSON object body.
  const state: { status: number; headers: Record<string, string>; body: Row | null } = { status: 0, headers: {}, body: null };
  return {
    state,
    writeHead: (status: number, headers?: Record<string, string>) => { state.status = status; state.headers = headers || {}; },
    end: (text?: string) => { state.body = text ? (JSON.parse(text) as Row) : null; },
  };
}

export type ProviderScript = { method: 'POST' | 'GET'; reply?: { status: number; body?: unknown; text?: string }; throwName?: string };
/** fetch stub driven by a queue of scripted provider replies; records every call. */
export function providerFetch(script: ProviderScript[]) {
  const calls: { method: string; url: string; headers: Record<string, string> }[] = [];
  const queue = [...script];
  const impl = vi.fn(async (url: string, init?: RequestInit) => {
    const method = ((init && init.method) || 'GET').toUpperCase();
    calls.push({ method, url: String(url), headers: ((init && init.headers) || {}) as Record<string, string> });
    const next = queue.shift();
    if (!next) throw new Error(`OFFLINE: unexpected provider call ${method} ${url}`);
    expect(method, `provider call order: ${url}`).toBe(next.method);
    if (next.throwName) { const err = new Error('offline'); err.name = next.throwName; throw err; }
    const reply = next.reply || { status: 200, body: {} };
    const text = reply.text !== undefined ? reply.text : JSON.stringify(reply.body);
    return { ok: reply.status >= 200 && reply.status < 300, status: reply.status, text: async () => text, json: async () => JSON.parse(text) };
  });
  return { impl, calls, push: (...items: ProviderScript[]) => queue.push(...items) };
}

export function completedOrder(orderID: string, value: string, captureID = 'CAP-1', captureStatus = 'COMPLETED') {
  return {
    id: orderID, status: 'COMPLETED',
    payer: { email_address: 'payer@example.invalid', name: { given_name: 'Pay', surname: 'Er' } },
    purchase_units: [{ payments: { captures: [{ id: captureID, status: captureStatus, amount: { currency_code: 'USD', value }, create_time: '2026-10-10T00:00:00Z' }] } }],
  };
}

export const COOKIE_RE = /^cocotrip_checkout_(single|cart)=([A-Za-z0-9_-]+)\.([a-f0-9]{64});/;
