// saveIfUnchanged.js — generic optimistic-concurrency merge (ESM)
export async function saveIfUnchanged(db, ref, originalUpdateTime, payload) {
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const unchanged =
      snap.exists && snap.updateTime && originalUpdateTime &&
      snap.updateTime.isEqual(originalUpdateTime);
    if (!unchanged) return { conflict: true }; // no writes on conflict
    tx.set(ref, payload, { merge: true });     // nested merge semantics preserved
    return { conflict: false };
  });
}