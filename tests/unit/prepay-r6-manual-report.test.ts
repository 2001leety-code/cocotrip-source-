// r6: manual reports use a mocked Firestore and notifications; no network calls.
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
// In-memory Firestore with optimistic-concurrency transactions (read versions checked at commit, retry up to 5x),
// tx.create = ALREADY_EXISTS (code 6) at commit, per-op latency so concurrent calls interleave. Fault injection hook.
type Dict = Record<string, unknown>;
type Ref = { __path: string };
type Transaction = { get: (r: Ref) => Promise<Dict>; set: (r: Ref, d: Dict, o?: Dict) => Transaction; create: (r: Ref, d: Dict) => Transaction; update: (r: Ref, d: Dict) => Transaction; delete: (r: Ref) => Transaction };
type Pending = Dict & { prepayCheckFailed?: { code?: string }; prepayFingerprint?: unknown };
function occDb(seed: Record<string, Dict> = {}, opts: { lat?: number; fail?: (kind: string, paths: string[]) => Error | null } = {}) {
  const store = new Map<string, { d: Dict; v: number }>();
  let ver = 1;
  for (const [k, v] of Object.entries(seed)) store.set(k, { d: structuredClone(v), v: ver++ });
  const lat = opts.lat || 1;
  const tick = () => new Promise((r) => setTimeout(r, lat));
  const put = (p: string, d: Dict) => store.set(p, { d, v: ver++ });
  const snap = (p: string): Dict => { const e = store.get(p); return { exists: !!e, data: () => (e ? structuredClone(e.d) : undefined), ref: docRef(p), id: p.split("/").pop() }; };
  const docRef = (p: string): Dict => ({ __path: p, id: p.split("/").pop(),
    get: async () => { await tick(); return snap(p); },
    set: async (d: Dict, o?: Dict) => { await tick(); put(p, o && o.merge ? { ...(store.get(p)?.d || {}), ...d } : { ...d }); },
    update: async (d: Dict) => { await tick(); if (!store.has(p)) throw Object.assign(new Error("NOT_FOUND"), { code: 5 }); put(p, { ...store.get(p)!.d, ...d }); },
    create: async (d: Dict) => { await tick(); if (store.has(p)) throw Object.assign(new Error("6 ALREADY_EXISTS"), { code: 6 }); put(p, { ...d }); },
    delete: async () => { await tick(); store.delete(p); }, collection: (n: string) => col(p + "/" + n) });
  const col = (b: string): Dict => ({
    doc: (id?: string) => docRef(b + "/" + (id || "auto" + ver)),
    add: async (d: Dict) => { put(b + "/auto" + ver, d); return { id: "a" }; },
    where: (f: string, _op: string, v: unknown) => ({ limit: () => ({ get: async () => {
      await tick();
      const docs = [...store.entries()].filter(([k, e]) => k.startsWith(b + "/") && k.split("/").length === b.split("/").length + 1 && e.d[f] === v).map(([k]) => snap(k));
      return { empty: docs.length === 0, docs, size: docs.length };
    } }), orderBy: () => col(b), get: async () => ({ empty: true, docs: [], size: 0 }) }),
    orderBy: () => col(b), limit: () => col(b), get: async () => ({ empty: true, docs: [], size: 0 }),
  });
  const stats = { txRetries: 0 };
  const runTransaction = async (fn: (tx: Transaction) => Promise<unknown>) => {
    for (let attempt = 0; attempt < 5; attempt++) {
      await tick();
      const reads = new Map<string, number>();
      const staged: { kind: string; p: string; d?: Dict; o?: Dict }[] = [];
      const tx: Transaction = {
        get: async (r: Ref) => { await tick(); const e = store.get(r.__path); reads.set(r.__path, e ? e.v : 0); return snap(r.__path); },
        set: (r: Ref, d: Dict, o?: Dict) => { staged.push({ kind: "set", p: r.__path, d, o }); return tx; },
        create: (r: Ref, d: Dict) => { staged.push({ kind: "create", p: r.__path, d }); return tx; },
        update: (r: Ref, d: Dict) => { staged.push({ kind: "update", p: r.__path, d }); return tx; },
        delete: (r: Ref) => { staged.push({ kind: "delete", p: r.__path }); return tx; },
      };
      const out = await fn(tx);
      await tick();
      const inj = opts.fail ? opts.fail("commit", staged.map((s) => s.p)) : null;
      if (inj) throw inj;
      const conflict = [...reads.entries()].some(([p, v]) => (store.get(p)?.v || 0) !== v);
      if (conflict) { stats.txRetries++; continue; }
      for (const s of staged) if (s.kind === "create" && store.has(s.p)) throw Object.assign(new Error("6 ALREADY_EXISTS: Document already exists"), { code: 6 });
      for (const s of staged) {
        if (s.kind === "delete") store.delete(s.p);
        else if (s.kind === "update") { const cur: Dict = { ...(store.get(s.p)?.d || {}) }; for (const [k, v] of Object.entries(s.d!)) cur[k] = v && typeof v === "object" && "__inc" in (v as Dict) ? (Number(cur[k]) || 0) + Number((v as Dict).__inc) : v; put(s.p, cur); }
        else put(s.p, s.kind === "set" && s.o && s.o.merge ? { ...(store.get(s.p)?.d || {}), ...s.d } : { ...s.d });
      }
      return out;
    }
    throw Object.assign(new Error("10 ABORTED: too much contention"), { code: 10 });
  };
  return { _store: store, _stats: stats, collection: (n: string) => col(n), runTransaction,
    batch: () => ({ set() {}, update() {}, delete() {}, commit: async () => {} }),
    peek: (p: string) => store.get(p)?.d as Pending };
}

const h = vi.hoisted(() => ({ db: null as unknown as ReturnType<typeof occDb>, now: 0, alerts: [] as string[] }));
vi.mock("../../api/_shared/firebase-admin.js", () => ({ initAdminDb: () => h.db }));
vi.mock("../../api/_shared/notify.js", () => ({ notify: async (_ch: string, msg: string) => { h.alerts.push(msg); } }));
vi.mock("../../api/_shared/sentry.js", () => ({ captureError: async () => {} }));
vi.mock("../../api/_shared/booking-confirm.js", () => ({ confirmBookingAsPaid: async () => ({ ok: true }) }));
vi.mock("../../api/_shared/ip-rate-limit.js", () => ({ checkIpRateLimit: async () => ({ ok: true }), getClientIp: () => "1.2.3.4" }));
vi.mock("../../api/_shared/telegram-throttle.js", () => ({ throttledTelegramAlert: async () => {} }));
vi.mock("firebase-admin/firestore", () => ({ FieldValue: { serverTimestamp: () => "TS", increment: (n: number) => ({ __inc: n }), delete: () => ({ __del: true }) } }));
const dateSpy = vi.spyOn(Date, "now").mockImplementation(() => h.now);
afterAll(() => dateSpy.mockRestore());
beforeEach(() => { h.alerts.length = 0; vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('OFFLINE fetch'); })); });

const { default: manualHandler } = await import("../../api/manual-payment-request.js");
const { enforcePaymentAndRevision } = await import("../../api/_ai_core/paymentGate.js");
const { checkStartDateTooSoon } = await import("../../api/_ai_core/validateStartDate.js");

function mockRes() { const out: Dict = {}; return { _out: out, setHeader() {}, writeHead(s: number) { out.status = s; return this; }, end(b?: string) { out.body = b ? JSON.parse(b) : undefined; return this; } }; }
const post = async (body: Dict) => { const r = mockRes(); await manualHandler({ method: "POST", headers: {}, body: structuredClone(body) } as Parameters<typeof manualHandler>[0], r as Parameters<typeof manualHandler>[1]); return r._out; };

describe("QR report right after KST midnight", () => {
  it("date rollover after QR display does not mark the report as failed", async () => {
    h.db = occDb({});
    const plannerInput = { regions: ["Seoul"], dietaryRestrictions: [], startDate: "2026-11-02", durationDays: 1 };
    h.now = Date.UTC(2026, 10, 1, 14, 59, 50); // KST 2026-11-01 23:59:50
    const check = await post({ checkOnly: true, productType: "ai-planner-full", plannerInput });
    h.now = Date.UTC(2026, 10, 1, 15, 0, 5); // KST 2026-11-02 00:00:05 — customer paid and reports now
    const report = await post({ bookingRef: "CT-20261101-123", productType: "ai-planner-full", passengers: 1, priceKRW: 14000, customerEmail: "u@e.x", paymentMethod: "paypal-me-qr", language: "en", plannerInput });
    const pending = h.db.peek("pending_bookings/CT-20261101-123");
    // operator verified the deposit
    h.db._store.set("pending_bookings/CT-20261101-123", { d: { ...pending, status: "CONFIRMED" }, v: 999 });
    const body = { paypalOrderId: "MANUAL-CT-20261101-123", language: "en", ...plannerInput, dietPrefs: [] };
    const gate = await enforcePaymentAndRevision(body, h.db, "u@e.x", "uid1", { loadFoodIndex: async () => [] });
    const handlerDateCheck = checkStartDateTooSoon(body, gate.isRevision || gate.prepayVerified === true || gate.isFreeAiCoupon === true);
    expect(check.status).toBe(200);
    expect(report.status).toBe(200);
    expect(pending.prepayCheckFailed).toBeUndefined();
    expect(pending.prepayFingerprint).toBeTruthy();
    expect(h.alerts.some((m) => m.includes("자동 생성 불가"))).toBe(false);
    expect(gate.rejection).toBeUndefined();
    expect(gate.prepayVerified).toBe(true);
    expect(handlerDateCheck).toBeNull();
  });
  it("legacy report without plannerInput gives guidance consistent with the generation gate", async () => {
    h.db = occDb({}); h.alerts.length = 0;
    h.now = Date.UTC(2026, 10, 1, 3, 0, 0); // KST 2026-11-01 12:00
    const report = await post({ bookingRef: "CT-20261101-124", productType: "ai-planner-full", passengers: 1, priceKRW: 14000, customerEmail: "u@e.x", paymentMethod: "paypal-me-qr", language: "en" });
    const pending = h.db.peek("pending_bookings/CT-20261101-124");
    h.db._store.set("pending_bookings/CT-20261101-124", { d: { ...pending, status: "CONFIRMED" }, v: 998 });
    const body = { paypalOrderId: "MANUAL-CT-20261101-124", language: "en", regions: ["Seoul"], dietaryRestrictions: [], dietPrefs: [], startDate: "2026-11-05", durationDays: 2 };
    const gate = await enforcePaymentAndRevision(body, h.db, "u@e.x", "uid1", { loadFoodIndex: async () => [] });
    const out = { report: report.status, prepayCheckFailed: pending.prepayCheckFailed || null, alertSaysNoAutoGen: h.alerts.some((m) => m.includes("자동 생성 불가")), gateRejection: gate.rejection || null, prepayVerified: gate.prepayVerified === true };
    expect(pending.prepayCheckFailed?.code).toBe("PREPAY_INPUT_MISSING");
    expect(out.alertSaysNoAutoGen).toBe(false);
    expect(h.alerts.some((m) => m.includes("환불 검토"))).toBe(false);
    expect(gate.rejection).toBeUndefined();
  });
});
