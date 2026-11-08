export type AiPlanNotice = { uid: string; orderId: string; attemptId: string; createdAt: number; planId?: string; persisted: boolean };
type DoneRecord = { uid: string; orderId: string; planId: string; settledAt: number };
const PREFIX = "cocotrip:ai-issuance-notice:v1:";
const PENDING = PREFIX + "pending:";
const DONE = PREFIX + "done:";
const MAX_ID_LEN = 200;
const PLAN_RE = /^[A-Za-z0-9_-]{1,160}$/;
const pendingMem = new Map<string, AiPlanNotice>();
const doneMem = new Map<string, DoneRecord>();
const listeners = new Set<() => void>();
let storageUnstable = false;
let tabConfirmationHold = false;
/** No account/order attribution. Survives component remount, not reload or another tab. */
export function holdAiCheckoutInThisTab(): void {
  if (tabConfirmationHold) return;
  tabConfirmationHold = true;
  emit();
}
export function isAiCheckoutHeldInThisTab(): boolean { return tabConfirmationHold; }
export function hasCompletedAiPlanNotice(uid: string, orderId: string): boolean {
  return isSafeId(uid) && isSafeId(orderId) && isDone(uid, orderId);
}
function isSafeId(v: unknown): v is string {
  if (typeof v !== "string" || v.length === 0 || v.length > MAX_ID_LEN || Array.from(v).some(ch => ch.charCodeAt(0) < 32 || ch.charCodeAt(0) === 127)) return false;
  try { encodeURIComponent(v); return true; } catch { return false; }
}
function isPlanId(v: unknown): v is string {
  return typeof v === "string" && PLAN_RE.test(v);
}
function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}
function enc(s: string): string {
  return encodeURIComponent(s);
}
function pendingKey(uid: string, orderId: string, attemptId: string): string {
  return PENDING + enc(uid) + ":" + enc(orderId) + ":" + enc(attemptId);
}
function doneKey(uid: string, orderId: string): string {
  return DONE + enc(uid) + ":" + enc(orderId);
}
function getStorage(): Storage | null {
  try {
    if (typeof window === "undefined" || !window.localStorage) return null;
    return window.localStorage;
  } catch {
    return null;
  }
}
function readRaw(key: string): { raw: string | null; ok: boolean } {
  const s = getStorage();
  if (!s) return { raw: null, ok: false };
  try {
    return { raw: s.getItem(key), ok: true };
  } catch {
    return { raw: null, ok: false };
  }
}
function writeRaw(key: string, value: string): boolean {
  const s = getStorage();
  if (!s) return false;
  try {
    s.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}
function listKeys(prefix: string): { keys: string[]; ok: boolean } {
  const s = getStorage();
  const keys: string[] = [];
  if (!s) return { keys, ok: false };
  try {
    const n = s.length;
    for (let i = 0; i < n; i++) {
      const k = s.key(i);
      if (typeof k === "string" && k.indexOf(prefix) === 0) keys.push(k);
    }
    return { keys, ok: true };
  } catch {
    return { keys, ok: false };
  }
}
function parsePending(raw: string | null, key: string): AiPlanNotice | null {
  if (typeof raw !== "string") return null;
  try {
    const j: unknown = JSON.parse(raw);
    if (!isObj(j) || j.version !== 1) return null;
    if (!isSafeId(j.uid) || !isSafeId(j.orderId) || !isSafeId(j.attemptId)) return null;
    if (pendingKey(j.uid, j.orderId, j.attemptId) !== key) return null;
    if (typeof j.createdAt !== "number" || !Number.isFinite(j.createdAt)) return null;
    const out: AiPlanNotice = { uid: j.uid, orderId: j.orderId, attemptId: j.attemptId, createdAt: j.createdAt, persisted: true };
    if (isPlanId(j.planId)) out.planId = j.planId;
    return out;
  } catch {
    return null;
  }
}
function parseDone(raw: string | null, key: string): DoneRecord | null {
  if (typeof raw !== "string") return null;
  try {
    const j: unknown = JSON.parse(raw);
    if (!isObj(j) || j.version !== 1) return null;
    if (!isSafeId(j.uid) || !isSafeId(j.orderId) || !isPlanId(j.planId)) return null;
    if (doneKey(j.uid, j.orderId) !== key) return null;
    const settledAt = typeof j.settledAt === "number" && Number.isFinite(j.settledAt) ? j.settledAt : 0;
    return { uid: j.uid, orderId: j.orderId, planId: j.planId, settledAt };
  } catch {
    return null;
  }
}
function serializePending(n: AiPlanNotice): string {
  const body: Record<string, unknown> = { version: 1, uid: n.uid, orderId: n.orderId, attemptId: n.attemptId, createdAt: n.createdAt };
  if (n.planId) body.planId = n.planId;
  return JSON.stringify(body);
}
function isDone(uid: string, orderId: string): boolean {
  const key = doneKey(uid, orderId);
  if (doneMem.has(key)) return true;
  const r = readRaw(key);
  if (!r.ok) storageUnstable = true;
  const done = parseDone(r.raw, key);
  if (done) doneMem.set(key, done);
  return done !== null;
}
function mergeNotice(a: AiPlanNotice | null, b: AiPlanNotice | null): AiPlanNotice | null {
  if (!a) return b;
  if (!b) return a;
  const out: AiPlanNotice = { ...a, persisted: a.persisted || b.persisted };
  if (!out.planId && b.planId) out.planId = b.planId;
  return out;
}
function findPending(uid: string, orderId: string, attemptId: string): AiPlanNotice | null {
  const key = pendingKey(uid, orderId, attemptId);
  const mem = pendingMem.get(key) || null;
  const r = readRaw(key);
  return mergeNotice(mem, parsePending(r.raw, key));
}
function emit(): void {
  const snapshot = Array.from(listeners);
  for (const l of snapshot) {
    try { l(); } catch { /* listener errors must not break issuance flow */ }
  }
}
export function beginAiPlanNotice(uid: string | null | undefined, orderId: string, attemptId: string): AiPlanNotice | null {
  if (!isSafeId(uid) || !isSafeId(orderId) || !isSafeId(attemptId)) return null;
  if (isDone(uid, orderId)) return null;
  const key = pendingKey(uid, orderId, attemptId);
  const existing = findPending(uid, orderId, attemptId);
  if (existing) {
    pendingMem.set(key, existing);
    return existing;
  }
  const notice: AiPlanNotice = { uid, orderId, attemptId, createdAt: Date.now(), persisted: false };
  if (writeRaw(key, serializePending(notice))) notice.persisted = true;
  else storageUnstable = true;
  pendingMem.set(key, notice);
  emit();
  return notice;
}
export function linkAiPlanNotice(uid: string, orderId: string, attemptId: string, planId: unknown): void {
  if (!isSafeId(uid) || !isSafeId(orderId) || !isSafeId(attemptId) || !isPlanId(planId)) return;
  if (isDone(uid, orderId)) return;
  const existing = findPending(uid, orderId, attemptId);
  if (!existing) return;
  if (existing.planId) return;
  const key = pendingKey(uid, orderId, attemptId);
  const next: AiPlanNotice = { ...existing, planId };
  if (writeRaw(key, serializePending(next))) next.persisted = true;
  else { next.persisted = false; storageUnstable = true; }
  pendingMem.set(key, next);
  emit();
}
export function readAiPlanNotices(uid: string | null | undefined): { notices: AiPlanNotice[]; storageUnavailable: boolean } {
  if (!isSafeId(uid)) return { notices: [], storageUnavailable: storageUnstable };
  let unavailable = storageUnstable;
  const merged = new Map<string, AiPlanNotice>();
  pendingMem.forEach((n, k) => { if (n.uid === uid) merged.set(k, n); });
  const pk = listKeys(PENDING + enc(uid) + ":");
  if (!pk.ok) unavailable = true;
  for (const k of pk.keys) {
    const r = readRaw(k);
    if (!r.ok) { unavailable = true; continue; }
    const n = parsePending(r.raw, k);
    if (!n || n.uid !== uid) continue;
    const m = mergeNotice(merged.get(k) || null, n);
    if (m) { merged.set(k, m); pendingMem.set(k, m); }
  }
  const doneKeys = new Set<string>();
  doneMem.forEach((d, k) => { if (d.uid === uid) doneKeys.add(k); });
  const dk = listKeys(DONE + enc(uid) + ":");
  if (!dk.ok) unavailable = true;
  for (const k of dk.keys) {
    const r = readRaw(k);
    if (!r.ok) { unavailable = true; continue; }
    const done = parseDone(r.raw, k);
    if (done) { doneKeys.add(k); doneMem.set(k, done); }
  }
  const notices: AiPlanNotice[] = [];
  merged.forEach((n) => { if (!doneKeys.has(doneKey(n.uid, n.orderId))) notices.push(n); });
  notices.sort((a, b) => a.createdAt - b.createdAt);
  return { notices, storageUnavailable: unavailable };
}
export function subscribeAiPlanNotices(listener: () => void): () => void {
  listeners.add(listener);
  if (typeof window === "undefined") return () => { listeners.delete(listener); };
  const onStorage = (e: StorageEvent) => {
    if (e.key === null || (typeof e.key === "string" && e.key.indexOf(PREFIX) === 0)) listener();
  };
  const onPageShow = () => { listener(); };
  window.addEventListener("storage", onStorage);
  window.addEventListener("pageshow", onPageShow);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
    window.removeEventListener("pageshow", onPageShow);
  };
}
export function settleAiPlanNoticesFromOwnerRead(input: { currentUid: string | null | undefined; viewerUid: string | null | undefined; planId: string; fromCache: boolean; hasPendingWrites: boolean; data: unknown }): void {
  const { currentUid, viewerUid, planId, data } = input;
  if (input.fromCache !== false || input.hasPendingWrites !== false) return;
  if (!isSafeId(currentUid) || !isSafeId(viewerUid) || currentUid !== viewerUid) return;
  if (!isPlanId(planId) || !isObj(data)) return;
  if (data.uid !== currentUid) return;
  if (data.status !== "ready" || data._streaming_in_progress === true || data._p231_stub === true) return;
  if (data.planId !== planId || !isObj(data.input)) return;
  const orderId = data.input.paypalOrderId;
  if (!isSafeId(orderId)) return;
  const uid = currentUid;
  const matched: string[] = [];
  const prefix = PENDING + enc(uid) + ":" + enc(orderId) + ":";
  let bad = false;
  const accept = (n: AiPlanNotice | null, k: string): boolean => {
    if (!n || n.uid !== uid || n.orderId !== orderId) return false;
    if (pendingKey(n.uid, n.orderId, n.attemptId) !== k) return false;
    if (n.planId !== undefined && n.planId !== planId) return false; // known-but-different → conflict
    return true; // unknown planId or exact match
  };
  pendingMem.forEach((n, k) => {
    if (k.indexOf(prefix) !== 0) return;
    if (!accept(n, k)) { bad = true; return; }
    if (matched.indexOf(k) < 0) matched.push(k);
  });
  if (bad) return;
  const pk = listKeys(prefix);
  if (!pk.ok) { storageUnstable = true; return; }
  for (const k of pk.keys) {
    if (k.indexOf(prefix) !== 0) return;
    const r = readRaw(k);
    if (!r.ok) { storageUnstable = true; return; }
    if (r.raw === null) return;
    let j: unknown;
    try { j = JSON.parse(r.raw); } catch { return; }
    if (!isObj(j)) return;
    const rawPlan = (j as Record<string, unknown>).planId;
    if (rawPlan !== undefined && !isPlanId(rawPlan)) return; // malformed planId → hold, no release
    const n = parsePending(r.raw, k);
    if (!n || n.planId !== rawPlan) return;
    if (!accept(n, k)) return;
    if (matched.indexOf(k) < 0) matched.push(k);
  }
  if (matched.length === 0) return;
  const dKey = doneKey(uid, orderId);
  const done: DoneRecord = { uid, orderId, planId, settledAt: Date.now() };
  const wrote = writeRaw(dKey, JSON.stringify({ version: 1, ...done }));
  doneMem.set(dKey, done);
  if (!wrote) { storageUnstable = true; emit(); return; }
  const s = getStorage();
  for (const k of matched) {
    pendingMem.delete(k);
    if (s) { try { s.removeItem(k); } catch { storageUnstable = true; } }
  }
  emit();
}
