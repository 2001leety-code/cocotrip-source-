/**
 * Global promo code policy (shared by applyPromoCode + capturePaypalOrder).
 *
 * PR #434 (Audit Y-H11 — 2026-05-16): cap was enforced only at the
 * applyPromoCode read-only gate, so N concurrent users could all see
 * usedCount < maxUses and all pass. capturePaypalOrder's transaction
 * incremented atomically but didn't re-check the cap — so 60 users
 * could redeem EARLY50 (limit 50) → 10 unauthorized 20% discounts.
 *
 * The fix moves the cap check INSIDE a Firestore transaction at
 * capture time (see incrementGlobalPromoUsage). The applyPromoCode
 * gate stays as a UX soft-check (no point sending a user to PayPal
 * if we already know they'll be blocked at capture).
 *
 * Hard defaults (limit) match what applyPromoCode.js historically had
 * inline — keep them in sync if you ever change either side. The lint
 * rule P58 cross-checks both files.
 */

/**
 * Hardcoded defaults — env var (GLOBAL_PROMO_LIMIT_<CODE>) and
 * admin/global_promo_limits doc override. See resolveGlobalPromoLimit.
 */
export const GLOBAL_PROMO_DEFAULTS = Object.freeze({
  EARLY50: { discount: 0.20, label: 'Early Bird 20% OFF', limit: 50,   stackable: false },
  COCO5:   { discount: 0.05, label: 'Base 5% OFF',        limit: 9999, stackable: true  },
  COCO10:  { discount: 0.10, label: '10% OFF',            limit: 9999, stackable: false },
});

/** Known global codes — capturePaypalOrder uses this to decide whether to enter the tx path. */
export const KNOWN_GLOBAL_PROMO_CODES = Object.freeze(Object.keys(GLOBAL_PROMO_DEFAULTS));

/**
 * Resolve maxUses for a code: env > admin/global_promo_limits doc > hardcoded default > 9999.
 * Used by applyPromoCode (outside-tx). Inside a transaction, pass `limitDocSnap` from `tx.get`.
 *
 * @param {object} opts
 * @param {FirebaseFirestore.Firestore | null} [opts.db]                Optional — for admin doc read outside tx.
 * @param {string} opts.code
 * @param {FirebaseFirestore.DocumentSnapshot} [opts.limitDocSnap]      Optional — if reading inside a transaction, pass tx.get(adminDoc) result.
 * @returns {Promise<number>}
 */
export async function resolveGlobalPromoLimit({ db, code, limitDocSnap } = {}) {
  const upper = String(code || '').toUpperCase();
  if (!upper) return 9999;

  const envVal = process.env[`GLOBAL_PROMO_LIMIT_${upper}`];
  if (envVal && Number.isFinite(Number(envVal))) return Number(envVal);

  // Inside-tx path — caller already did tx.get(adminDoc).
  if (limitDocSnap) {
    const v = limitDocSnap.exists ? limitDocSnap.data()?.[upper] : undefined;
    if (Number.isFinite(Number(v))) return Number(v);
    return GLOBAL_PROMO_DEFAULTS[upper]?.limit ?? 9999;
  }

  // Outside-tx path — async read of the admin doc.
  if (db) {
    try {
      const doc = await db.collection('admin').doc('global_promo_limits').get();
      if (doc.exists) {
        const v = doc.data()?.[upper];
        if (Number.isFinite(Number(v))) return Number(v);
      }
    } catch (err) {
      console.warn('[global-promo] admin/global_promo_limits read failed:', err.message);
    }
  }

  return GLOBAL_PROMO_DEFAULTS[upper]?.limit ?? 9999;
}

/**
 * Atomic check-and-increment of global_promo_usage/{code}.usedCount.
 *
 * Runs in a Firestore transaction:
 *   1. tx.get(usageDoc) + tx.get(adminLimitDoc)
 *   2. Resolve maxUses (env > admin doc > default)
 *   3. If usedCount >= maxUses → throw PROMO_LIMIT_EXCEEDED
 *   4. tx.set usedCount = usedCount + 1
 *
 * On PROMO_LIMIT_EXCEEDED the caller is responsible for refunding the
 * PayPal capture (we are post-capture at this point — the cap race
 * lost). The error message is exactly `PROMO_LIMIT_EXCEEDED` for stable
 * string-matching in the caller.
 *
 * @param {object} args
 * @param {FirebaseFirestore.Firestore} args.db
 * @param {string} args.code
 * @param {string} [args.orderID]   Logged for audit trail.
 * @returns {Promise<{ok: true, usedCount: number, maxUses: number} | {ok: false, code: 'PROMO_LIMIT_EXCEEDED', usedCount: number, maxUses: number}>}
 */
export async function incrementGlobalPromoUsage({ db, code, orderID = '' }) {
  if (!db) throw new Error('Firestore required for incrementGlobalPromoUsage');
  const upper = String(code || '').toUpperCase();
  if (!upper) throw new Error('code required');

  const { FieldValue } = await import('firebase-admin/firestore');
  const usageRef = db.collection('global_promo_usage').doc(upper);
  const limitRef = db.collection('admin').doc('global_promo_limits');

  try {
    const result = await db.runTransaction(async (tx) => {
      const [usageSnap, limitSnap] = await Promise.all([tx.get(usageRef), tx.get(limitRef)]);
      const cur = usageSnap.exists ? Number(usageSnap.data()?.usedCount || 0) : 0;
      const maxUses = await resolveGlobalPromoLimit({ code: upper, limitDocSnap: limitSnap });
      if (cur >= maxUses) {
        const e = new Error('PROMO_LIMIT_EXCEEDED');
        // attach metadata for the caller's refund + notify path
        e.cur = cur;
        e.maxUses = maxUses;
        throw e;
      }
      tx.set(
        usageRef,
        {
          usedCount: cur + 1,
          lastUsedAt: FieldValue.serverTimestamp(),
          lastOrderID: orderID || null,
        },
        { merge: true },
      );
      return { ok: true, usedCount: cur + 1, maxUses };
    });
    return result;
  } catch (e) {
    if (e.message === 'PROMO_LIMIT_EXCEEDED') {
      return { ok: false, code: 'PROMO_LIMIT_EXCEEDED', usedCount: e.cur, maxUses: e.maxUses };
    }
    throw e;
  }
}

export default incrementGlobalPromoUsage;
