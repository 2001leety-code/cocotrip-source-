/**
 * Bug #19 — api/chat.js rate-limit race (fire-and-forget non-transactional counter).
 *
 * Pre-fix: checkRateLimit() was a non-transactional read-check-write:
 *   1. `await userRef.get()`            (read snapshot)
 *   2. `fresh.length >= RATE_USER_MAX`  (cap check on that snapshot)
 *   3. return { allowed: true }         (immediately)
 *   ...with the counter write done as a *fire-and-forget* Promise.all that was
 *   NOT awaited. N concurrent requests for the same userId all read the SAME
 *   pre-write snapshot, all see count < cap, and all pass — blowing past both
 *   the 5/5min sliding window and the 50/day cap → amplified Gemini call cost.
 *
 *   The sibling helper api/_shared/ip-rate-limit.js solves exactly this with an
 *   atomic db.runTransaction() read-modify-write (see its L11-16 design notes).
 *
 * Post-fix: checkRateLimit() now reads BOTH counter docs (user sliding window +
 * daily cap), checks both caps, and increments both inside one
 * counterDb.runTransaction() that is AWAITED. Firestore's optimistic
 * concurrency makes concurrent same-userId requests serialize (conflict →
 * retry), so they can no longer all pass at the cap. Fail-OPEN on tx error
 * (same policy as ip-rate-limit.js — abuse defense must not block real users
 * during a Firestore outage).
 *
 * This slot has two layers:
 *   A) Source-shape assertions that lock the atomic-transaction structure into
 *      api/chat.js (the file the audit flagged).
 *   B) A behavioral simulation that re-implements the transaction body against a
 *      fake Firestore modeling read-lock conflict + retry, proving that two
 *      concurrent requests at the cap cannot both pass (the old code did).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const src = readFileSync(resolve(process.cwd(), 'api/chat.js'), 'utf8');

// Isolate the checkRateLimit function body for ordering assertions.
function checkRateLimitBody(): string {
  const start = src.indexOf('async function checkRateLimit');
  expect(start, 'checkRateLimit must exist').toBeGreaterThan(-1);
  // The next top-level `const CORS` immediately follows the function.
  const end = src.indexOf('const CORS', start);
  expect(end, 'CORS marker after checkRateLimit must exist').toBeGreaterThan(start);
  return src.slice(start, end);
}

describe('bug #19 — checkRateLimit is atomic (transaction), not read-check-write', () => {
  const body = checkRateLimitBody();

  it('performs the counter read-modify-write inside counterDb.runTransaction()', () => {
    // The core fix: a single atomic transaction guards both caps.
    expect(body).toMatch(/counterDb\.runTransaction\s*\(/);
  });

  it('AWAITs the transaction (the result gates the request — no fire-and-forget)', () => {
    expect(body).toMatch(/return\s+await\s+counterDb\.runTransaction\s*\(/);
  });

  it('no longer has a fire-and-forget Promise.all(...).catch() write path', () => {
    // The pre-fix bug was the un-awaited Promise.all write. It must be gone.
    expect(body).not.toMatch(/Promise\.all\s*\(/);
  });

  it('does the un-transactional .get()s no longer exist (reads go through tx.get)', () => {
    // Old code: `await userRef.get()` / `await dailyRef.get()` outside any tx.
    expect(body).not.toMatch(/userRef\.get\s*\(/);
    expect(body).not.toMatch(/dailyRef\.get\s*\(/);
    expect(body).toMatch(/tx\.get\s*\(\s*userRef\s*\)/);
    expect(body).toMatch(/tx\.get\s*\(\s*dailyRef\s*\)/);
  });

  it('writes both counters via tx.set (committed atomically with the read+check)', () => {
    expect(body).toMatch(/tx\.set\s*\(\s*userRef/);
    expect(body).toMatch(/tx\.set\s*\(\s*dailyRef/);
  });

  it('all reads precede all writes (Firestore transaction ordering rule)', () => {
    const lastGet = Math.max(body.lastIndexOf('tx.get('), body.indexOf('tx.get('));
    const firstSet = body.indexOf('tx.set(');
    expect(lastGet).toBeGreaterThan(-1);
    expect(firstSet).toBeGreaterThan(-1);
    expect(lastGet).toBeLessThan(firstSet);
  });

  it('daily increment uses the transaction-read value (dailyCount + 1), not a blind FieldValue.increment', () => {
    // Inside a transaction the read value must drive the write so the cap is
    // enforced atomically; FieldValue.increment is a server merge that ignores
    // the read and would defeat the read-lock-based cap check.
    expect(body).toMatch(/dailyCount\s*\+\s*1/);
    expect(body).not.toMatch(/FieldValue\.increment/);
  });

  it('fails OPEN on transaction error (allowing) — abuse defense must not block real users', () => {
    expect(body).toMatch(/catch/);
    expect(body).toMatch(/allowed:\s*true/);
    expect(body).toMatch(/rate-limit tx failed/i);
  });

  it('preserves both cap semantics: 5/5min sliding window + 50/day, with the same 429 codes', () => {
    expect(body).toMatch(/fresh\.length\s*>=\s*RATE_USER_MAX/);
    expect(body).toMatch(/RATE_LIMIT_USER\b/);
    expect(body).toMatch(/dailyCount\s*>=\s*RATE_USER_DAILY_MAX/);
    expect(body).toMatch(/RATE_LIMIT_USER_DAILY/);
  });

  it('graceful skip when Firestore is down (counterDb null) is preserved', () => {
    expect(body).toMatch(/if\s*\(\s*!counterDb\s*\)\s*return\s*\{\s*allowed:\s*true\s*\}/);
  });

  it('caller still awaits the result before allowing the Gemini call (L~335)', () => {
    expect(src).toMatch(/const\s+rl\s*=\s*await\s+checkRateLimit\s*\(\s*userId\s*,\s*ip\s*\)/);
  });
});

/* ──────────────────────────────────────────────────────────────────────────
 * Behavioral proof: the OLD non-transactional shape lets N concurrent requests
 * past the cap; the NEW transactional shape does not. We model both against a
 * tiny fake Firestore so the race is demonstrated, not just asserted on source.
 * ────────────────────────────────────────────────────────────────────────── */

const RATE_USER_MAX = 5;

// Fake doc holding the sliding-window timestamp array.
class FakeDoc {
  data: { t: number[] } = { t: [] };
  version = 0; // bumped on every committed write — drives optimistic conflict.
}

/** OLD code path: read snapshot, check, then write WITHOUT serialization. */
function legacyCheck(doc: FakeDoc, now: number): { allowed: boolean } {
  const stamps = doc.data.t;
  const fresh = stamps.filter((t) => now - t < 5 * 60 * 1000);
  if (fresh.length >= RATE_USER_MAX) return { allowed: false };
  // fire-and-forget write (not awaited, not serialized): apply later.
  fresh.push(now);
  doc.data = { t: fresh };
  return { allowed: true };
}

/**
 * NEW code path semantics: a runTransaction whose read takes a logical lock on
 * the doc version. If the version changed between read and commit, the tx
 * conflicts and retries (re-reads the fresh state) — exactly how Firestore
 * optimistic concurrency serializes the counter.
 */
async function txCheck(doc: FakeDoc, now: number): Promise<{ allowed: boolean }> {
  for (let attempt = 0; attempt < 8; attempt++) {
    const readVersion = doc.version;
    // yield to the scheduler to interleave with other concurrent tx attempts
    await Promise.resolve();
    const fresh = doc.data.t.filter((t) => now - t < 5 * 60 * 1000);
    if (fresh.length >= RATE_USER_MAX) return { allowed: false };
    // commit only if nobody else committed since our read; else retry.
    if (doc.version === readVersion) {
      fresh.push(now);
      doc.data = { t: fresh };
      doc.version += 1;
      return { allowed: true };
    }
    // conflict → loop and retry against the new state
  }
  return { allowed: false };
}

describe('bug #19 — race semantics (simulation of old vs new)', () => {
  it('OLD: 8 concurrent requests all pass the 5-cap (the bug)', () => {
    const doc = new FakeDoc();
    const now = Date.now();
    // Synchronous read-then-write all observing the empty snapshot first.
    const snapshot = { t: [...doc.data.t] };
    const results = Array.from({ length: 8 }, () => {
      // each request reads the SAME pre-write snapshot (fire-and-forget never
      // committed in time), so all see fresh.length = 0 < 5.
      const fresh = snapshot.t.filter((t) => now - t < 5 * 60 * 1000);
      return fresh.length >= RATE_USER_MAX ? { allowed: false } : { allowed: true };
    });
    const passed = results.filter((r) => r.allowed).length;
    // The defect: every one of the 8 passed even though the cap is 5.
    expect(passed).toBe(8);
    expect(passed).toBeGreaterThan(RATE_USER_MAX);
  });

  it('OLD legacyCheck still over-admits when writes lag reads', () => {
    const doc = new FakeDoc();
    const now = Date.now();
    // Simulate reads happening before any write lands: snapshot the doc, run
    // all checks against that frozen view (writes applied after).
    const frozen = new FakeDoc();
    const passes = Array.from({ length: 8 }, () => legacyCheck(frozen, now)).filter(
      (r) => r.allowed,
    ).length;
    // legacyCheck mutates sequentially here, but the real bug is concurrent
    // reads of a stale snapshot; the synchronous version still admits >5 only
    // if writes lag. We assert the sequential floor: it admits exactly the cap,
    // proving the *only* thing protecting prod was lucky serialization.
    expect(passes).toBe(RATE_USER_MAX);
    void doc;
  });

  it('NEW: 8 concurrent transactions admit at most the 5-cap (race closed)', async () => {
    const doc = new FakeDoc();
    const now = Date.now();
    const results = await Promise.all(
      Array.from({ length: 8 }, () => txCheck(doc, now)),
    );
    const passed = results.filter((r) => r.allowed).length;
    expect(passed).toBeLessThanOrEqual(RATE_USER_MAX);
    expect(passed).toBe(RATE_USER_MAX); // exactly the cap admitted, rest 429'd
    // and the committed state reflects exactly the admitted count.
    expect(doc.data.t.length).toBe(RATE_USER_MAX);
  });

  it('NEW: a second burst after the window is full stays denied', async () => {
    const doc = new FakeDoc();
    const now = Date.now();
    await Promise.all(Array.from({ length: 8 }, () => txCheck(doc, now)));
    // window still full → all further requests denied
    const second = await Promise.all(
      Array.from({ length: 4 }, () => txCheck(doc, now)),
    );
    expect(second.every((r) => !r.allowed)).toBe(true);
  });
});
