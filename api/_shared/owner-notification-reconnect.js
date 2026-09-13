import { OWNER_SOURCES, isOwnerAdmin, openOwnerCursor, ownerHash, sealOwnerCursor, timeToMs,
  validateOwnerSubscription } from './owner-notification-policy.js';
import { OWNER_CONTROL_COLLECTION, OWNER_EVENT_COLLECTION, ownerEventId, validateOwnerStoredEvent } from './owner-notification-delivery.js';
import { UUID_V4, ownerNotificationTestControlId, readOwnerTestAttempts } from './owner-notification-test.js';
import { inspectVapidPair } from './owner-vapid-diagnostics.js';

const MAX_PRESERVED_EVENTS = 25;
const EVENT_FIELDS = new Set(['version', 'kind', 'eventKey', 'scope', 'deviceHash', 'queuedAtMs', 'expiresAtMs',
  'status', 'attempts', 'nextAttemptAtMs', 'leaseUntilMs', 'outcomeCode', 'attemptToken']);
function preservableEvent(row, id, config, device, now) {
  return validateOwnerStoredEvent(row, id, config, device)
    && Object.keys(row).every(key => EVENT_FIELDS.has(key))
    && Number.isSafeInteger(row.queuedAtMs) && row.queuedAtMs > 0 && row.queuedAtMs <= now
    && row.expiresAtMs === row.queuedAtMs + config.retentionDays * 86_400_000
    && (row.attemptToken === undefined || (typeof row.attemptToken === 'string' && UUID_V4.test(row.attemptToken)))
    && row.nextAttemptAtMs === Number.MAX_SAFE_INTEGER && row.leaseUntilMs === 0
    && ((row.status === 'accepted' && row.outcomeCode === 'PROVIDER_ACCEPTED' && row.attempts > 0)
      || (row.status === 'manual_required' && ['MANUAL_REQUIRED', 'ATTEMPTS_OR_AGE_LIMIT'].includes(row.outcomeCode)));
}

/** Explicit, one-time device cutover only. Never resets progress, sends, or edits subscriptions. */
export async function reconnectOwnerNotificationDevice({ db, auth }, config, previousId, now) {
  const previous = typeof previousId === 'string' ? previousId.trim() : '';
  if (!config?.enabled || !previous || previous === config.subscriptionId || previous.length > 512
    || !previous.startsWith(`${config.uid}_`) || /[\s/\u0000-\u001f\u007f]/.test(previous)
    || !Number.isSafeInteger(now) || now <= 0) return { code: 'RECONNECT_NOT_AUTHORIZED' };
  if (!inspectVapidPair(config.publicKey, config.privateKey).pairMatches) return { code: 'RECONNECT_KEYS_INVALID' };
  try {
    if (!isOwnerAdmin(await auth.getUser(config.uid), config)) return { code: 'OWNER_DEVICE_REQUIRED' };
    const prior = { ...config, subscriptionId: previous,
      scope: ownerHash('owner-notifications-v1', config.uid, previous, config.language, config.retentionDays) };
    const control = db.collection(OWNER_CONTROL_COLLECTION).doc('v1');
    const oldTest = db.collection(OWNER_CONTROL_COLLECTION).doc(ownerNotificationTestControlId(prior));
    const newTest = db.collection(OWNER_CONTROL_COLLECTION).doc(ownerNotificationTestControlId(config));
    return await db.runTransaction(async tx => {
      // Read everything before writing, including both live device records and test claims.
      const stateSnap = await tx.get(control);
      const oldDeviceSnap = await tx.get(db.collection('push_subscriptions').doc(previous));
      const newDeviceSnap = await tx.get(db.collection('push_subscriptions').doc(config.subscriptionId));
      const oldTestSnap = await tx.get(oldTest);
      const newTestSnap = await tx.get(newTest);
      // Preserve only a bounded, entirely terminal ledger. Nothing ambiguous may be resent.
      const events = await tx.get(db.collection(OWNER_EVENT_COLLECTION).limit(MAX_PRESERVED_EVENTS + 1));
      const oldDevice = oldDeviceSnap.exists && validateOwnerSubscription(previous, oldDeviceSnap.data(), prior);
      const newDevice = newDeviceSnap.exists && validateOwnerSubscription(config.subscriptionId, newDeviceSnap.data(), config);
      if (!oldDevice || !newDevice || newDeviceSnap.data().vapidPublicKey !== config.publicKey) return { code: 'OWNER_DEVICE_REQUIRED' };
      const state = stateSnap.exists && stateSnap.data();
      if (!state || state.version !== 1 || state.scope !== prior.scope || state.deviceHash !== oldDevice.deviceHash
        || state.sourceSchemaVersion !== 2 || state.deviceMigration
        || !Number.isSafeInteger(state.activatedAtMs) || state.activatedAtMs <= 0 || state.activatedAtMs > now
        || !Number.isSafeInteger(state.lockUntilMs) || state.lockUntilMs < 0
        || !Number.isInteger(state.nextSource) || state.nextSource < 0 || state.nextSource >= OWNER_SOURCES.length) {
        return { code: 'RECONNECT_CONTROL_MISMATCH' };
      }
      if (state.lockUntilMs > now) return { code: 'BUSY' };
      if (!Array.isArray(events.docs) || events.docs.length > MAX_PRESERVED_EVENTS || newTestSnap.exists) return { code: 'RECONNECT_HISTORY_REQUIRES_REVIEW' };
      const attempts = readOwnerTestAttempts(oldTestSnap, prior, now);
      if (!attempts || attempts.some(item => ['SENDING', 'OUTCOME_UNKNOWN'].includes(item.outcome))) {
        return { code: 'RECONNECT_HISTORY_REQUIRES_REVIEW' };
      }
      const preserved = [];
      for (const event of events.docs) {
        const row = event.data();
        if (!preservableEvent(row, event.id, prior, oldDevice, now)) return { code: 'RECONNECT_HISTORY_REQUIRES_REVIEW' };
        const nextRef = db.collection(OWNER_EVENT_COLLECTION).doc(ownerEventId(row, config, newDevice));
        if ((await tx.get(nextRef)).exists) return { code: 'RECONNECT_HISTORY_REQUIRES_REVIEW' };
        preserved.push({ ref: nextRef, row: { ...row, scope: config.scope, deviceHash: newDevice.deviceHash } });
      }
      const cursors = {};
      for (const spec of OWNER_SOURCES) {
        const cursor = openOwnerCursor(state.cursors?.[spec.name], prior, spec.name);
        if (timeToMs(cursor.time) < state.activatedAtMs || timeToMs(cursor.time) > now) return { code: 'CURSOR_INVALID' };
        cursors[spec.name] = sealOwnerCursor(cursor, config, spec.name);
      }
      // Only the recipient binding and encryption context change. Preserve cutover and all progress.
      tx.update(control, { scope: config.scope, deviceHash: newDevice.deviceHash, cursors,
        lockUntilMs: 0, lockToken: '', deviceMigration: { version: 1, fromScope: prior.scope, completedAtMs: now } });
      if (attempts.length) tx.create(newTest, { version: 1, scope: config.scope, attempts });
      for (const event of preserved) tx.create(event.ref, event.row);
      return { code: 'DEVICE_RECONNECTED', preservedSources: OWNER_SOURCES.length,
        preservedTests: attempts.length, preservedEvents: preserved.length };
    });
  } catch {
    // Includes failed authentication/decryption/transactions. Never expose keys or reset cursors.
    return { code: 'RECONNECT_UNAVAILABLE' };
  }
}
