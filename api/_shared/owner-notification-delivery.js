import { randomUUID } from 'node:crypto';
import { isOwnerAdmin, ownerHash, ownerPayload, validateOwnerSubscription } from './owner-notification-policy.js';

export const OWNER_EVENT_COLLECTION = 'owner_notification_events';
export const OWNER_CONTROL_COLLECTION = 'owner_notification_control';
export const OWNER_LEASE_MS = 120_000;
export const OWNER_ATTEMPT_LIMIT = 3;
const NEVER = Number.MAX_SAFE_INTEGER;
const RETRY_CODES = new Set([429, 500, 502, 503, 504]);

/** No customer sender reuse: its legacy error logging includes the response body. */
export async function sendSingleOwnerPush(subscription, payload, config) {
  try {
    const { default: webpush } = await import('web-push');
    const response = await webpush.sendNotification(subscription, JSON.stringify(payload), {
      vapidDetails: { subject: config.subject, publicKey: config.publicKey, privateKey: config.privateKey },
      timeout: 5000, TTL: 300,
    });
    return response?.statusCode >= 200 && response.statusCode < 300 ? { outcome: 'accepted' } : { outcome: 'unknown' };
  } catch (error) {
    const status = error?.statusCode;
    if (RETRY_CODES.has(status)) return { outcome: 'retryable' };
    if ([400, 401, 403, 404, 410, 413].includes(status)) return { outcome: 'rejected' };
    // A timeout/reset may be after provider acceptance. Never automatically retry it.
    return { outcome: 'unknown' };
  }
}

export async function readSelectedOwnerDevice({ db, auth }, config) {
  if (!isOwnerAdmin(await auth.getUser(config.uid), config)) return null;
  const snap = await db.collection('push_subscriptions').doc(config.subscriptionId).get();
  return snap.exists ? validateOwnerSubscription(snap.id, snap.data(), config) : null;
}

export function ownerEventId(event, config, device) {
  return ownerHash('delivery-v1', config.scope, device.deviceHash, event.eventKey);
}

/** Call only inside the transaction that advances the encrypted source cursor. */
export function newOwnerEvent(event, config, device, now) {
  return {
    version: 1, kind: event.kind, eventKey: event.eventKey, scope: config.scope, deviceHash: device.deviceHash,
    queuedAtMs: now, expiresAtMs: now + config.retentionDays * 86_400_000,
    status: 'pending', attempts: 0, nextAttemptAtMs: now, leaseUntilMs: 0,
    outcomeCode: 'PENDING',
  };
}

function validStoredEvent(row, id, config, device) {
  return row && row.version === 1 && row.scope === config.scope && row.deviceHash === device.deviceHash
    && ownerPayload(row.kind, row.eventKey, config.language)
    && id === ownerEventId(row, config, device)
    && Number.isInteger(row.attempts) && row.attempts >= 0 && row.attempts <= OWNER_ATTEMPT_LIMIT
    && Number.isSafeInteger(row.expiresAtMs) && Number.isSafeInteger(row.nextAttemptAtMs);
}

/** Each event targets exactly one pinned subscription fingerprint. */
export async function deliverOwnerEvent(services, config, device, id, {
  now = Date.now, send = sendSingleOwnerPush, token = randomUUID(), timeoutMs = 6500,
} = {}) {
  const { db } = services;
  const ref = db.collection(OWNER_EVENT_COLLECTION).doc(id);
  const claimed = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const row = snap.exists ? snap.data() : null;
    const at = now();
    if (!validStoredEvent(row, id, config, device)) return { code: 'EVENT_INVALID' };
    if (row.status === 'sending') {
      if (row.leaseUntilMs > at) return { code: 'BUSY' };
      tx.update(ref, { status: 'unknown', nextAttemptAtMs: NEVER, leaseUntilMs: 0, outcomeCode: 'OUTCOME_UNKNOWN' });
      return { code: 'OUTCOME_UNKNOWN' };
    }
    if (!['pending', 'retryable'].includes(row.status)) return { code: 'ALREADY_HANDLED' };
    if (row.expiresAtMs <= at || row.attempts >= OWNER_ATTEMPT_LIMIT) {
      tx.update(ref, { status: 'manual_required', nextAttemptAtMs: NEVER, outcomeCode: 'ATTEMPTS_OR_AGE_LIMIT' });
      return { code: 'MANUAL_REQUIRED' };
    }
    if (row.nextAttemptAtMs > at) return { code: 'NOT_DUE' };
    tx.update(ref, { status: 'sending', attempts: row.attempts + 1, attemptToken: token,
      leaseUntilMs: at + OWNER_LEASE_MS, nextAttemptAtMs: at + OWNER_LEASE_MS, outcomeCode: 'SENDING' });
    return { row, attempt: row.attempts + 1, leaseUntilMs: at + OWNER_LEASE_MS };
  });
  if (!claimed.row) return { code: claimed.code };

  let outcome = 'unknown';
  let timer;
  try {
    // Fresh account and subscription check immediately before sending, not just at sweep startup.
    const fresh = await readSelectedOwnerDevice(services, config);
    if (!fresh || fresh.deviceHash !== device.deviceHash || now() >= claimed.leaseUntilMs) outcome = 'rejected';
    else {
      const sent = await Promise.race([
        Promise.resolve().then(() => send(fresh.subscription, ownerPayload(claimed.row.kind, claimed.row.eventKey, config.language), config)),
        new Promise((resolve) => { timer = setTimeout(() => resolve({ outcome: 'unknown' }), timeoutMs); }),
      ]);
      if (['accepted', 'retryable', 'rejected', 'unknown'].includes(sent?.outcome)) outcome = sent.outcome;
    }
  } catch { /* No provider text, endpoints, customer IDs, account details or keys in logs. */ }
  finally { clearTimeout(timer); }

  const code = outcome === 'accepted' ? 'PROVIDER_ACCEPTED' : outcome === 'unknown' ? 'OUTCOME_UNKNOWN'
    : outcome === 'retryable' && claimed.attempt < OWNER_ATTEMPT_LIMIT ? 'RETRY_SCHEDULED' : 'MANUAL_REQUIRED';
  const status = { PROVIDER_ACCEPTED: 'accepted', OUTCOME_UNKNOWN: 'unknown', RETRY_SCHEDULED: 'retryable', MANUAL_REQUIRED: 'manual_required' }[code];
  // If this write fails, the stale sending lease is later quarantined as unknown.
  // A database failure must never cause an accepted notification to be retried.
  await db.runTransaction(async (tx) => {
    const latest = await tx.get(ref);
    if (latest.data()?.status !== 'sending' || latest.data()?.attemptToken !== token) return;
    tx.update(ref, { status, outcomeCode: code, leaseUntilMs: 0,
      nextAttemptAtMs: status === 'retryable' ? now() + claimed.attempt * 300_000 : NEVER });
  });
  return { code };
}

/** Bounded cleanup of this worker's ledger only. Source/customer/subscription records are never deleted. */
export async function pruneExpiredOwnerEvents(db, at, limit = 25, shouldContinue = () => true) {
  const snap = await db.collection(OWNER_EVENT_COLLECTION).where('expiresAtMs', '<=', at)
    .orderBy('expiresAtMs', 'asc').limit(limit).get();
  let removed = 0;
  for (const doc of snap.docs) {
    if (!shouldContinue()) break;
    const deleted = await db.runTransaction(async (tx) => {
      const current = await tx.get(doc.ref);
      const row = current.data();
      if (row?.version === 1 && row.expiresAtMs <= at && !(row.status === 'sending' && row.leaseUntilMs > at)) {
        tx.delete(doc.ref);
        return true;
      }
      return false;
    });
    if (deleted) removed++;
  }
  return removed;
}
