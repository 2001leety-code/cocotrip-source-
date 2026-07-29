/**
 * Record one paid AI Planner entitlement per PayPal order.
 *
 * The per-order document makes activation idempotent and gives the refund
 * transaction a trustworthy record to reverse. Legacy users who were already
 * unlocked before this ledger existed retain one baseline entitlement.
 */
export async function activateAiPlannerPurchase({ db, FieldValue, uid, orderID }) {
  if (!db || !uid || !orderID) return { activated: false, reason: 'invalid-args' };

  const userRef = db.collection('users').doc(String(uid));
  const purchaseRef = userRef.collection('aiPlannerPurchases').doc(String(orderID));
  const bookingRef = db.collection('bookings').doc(String(orderID));

  return db.runTransaction(async (tx) => {
    const bookingSnap = await tx.get(bookingRef);
    if (!bookingSnap.exists) throw new Error('AI purchase booking not found');
    const booking = bookingSnap.data() || {};
    if (booking.paymentVerified !== true) throw new Error('AI purchase payment not verified');
    if (String(booking.uid || '') !== String(uid)) throw new Error('AI purchase user mismatch');
    if (booking.status === 'REFUNDED' || booking.status === 'CANCELED') {
      return { activated: false, reason: 'booking-refunded-or-canceled' };
    }

    const purchaseSnap = await tx.get(purchaseRef);
    if (purchaseSnap.exists && purchaseSnap.data().status === 'active') {
      return { activated: false, alreadyActive: true };
    }

    const userSnap = await tx.get(userRef);
    if (!userSnap.exists) throw new Error('AI purchase user not found');
    const user = userSnap.data() || {};
    const hasTrackedCount = Number.isFinite(Number(user.activeAiPlannerPurchaseCount));
    const baseline = hasTrackedCount
      ? Math.max(0, Number(user.activeAiPlannerPurchaseCount) || 0)
      : (user.aiFeaturesUnlocked === true ? 1 : 0);
    const nextCount = baseline + 1;

    tx.set(purchaseRef, {
      orderID: String(orderID),
      status: 'active',
      activatedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    tx.set(userRef, {
      activeAiPlannerPurchaseCount: nextCount,
      aiFeaturesUnlocked: true,
      aiFeaturesUnlockedAt: FieldValue.serverTimestamp(),
    }, { merge: true });

    return { activated: true, activeCount: nextCount };
  });
}
