import { randomUUID } from 'node:crypto';
import {
  OWNER_SOURCES, eventFromSource, isOwnerSourceCandidate, isOwnerSourceId, openOwnerCursor, readOwnerNotificationConfig,
  sealOwnerCursor, sourceTime, timeAtMs, timeToMs, ownerHash,
} from '../_shared/owner-notification-policy.js';
import { companyGmailInboxConfigForAccount, readCompanyGmailInboxConfigs } from '../_shared/company-gmail-inbox-registry.js';
import { readWhatsAppInboxConfig } from '../_shared/whatsapp-inbox.js';
import { WHATSAPP_SESSIONS_COLLECTION, sessionDocId, validSupportSender } from '../_shared/whatsapp-support-sessions.js';
import { INBOX_CASES_COLLECTION, inboxCaseAllowsRead, inboxCaseId, validInboxCase } from '../_shared/external-inbox-retention.js';
import {
  OWNER_CONTROL_COLLECTION, OWNER_EVENT_COLLECTION, OWNER_LEASE_MS, deliverOwnerEvent,
  newOwnerEvent, ownerEventId, pruneExpiredOwnerEvents, readSelectedOwnerDevice,
} from '../_shared/owner-notification-delivery.js';

const PAGE_SIZE = 10;
const SEND_LIMIT = 3;
const RUN_BUDGET_MS = 40_000;
const SETTLE_MS = 30_000;
const OWNER_SOURCE_SCHEMA_VERSION = 2;

class OwnerSourceError extends Error {
  constructor(code) { super(code); this.code = code; }
}

async function readSource(query, code) {
  try { return await query.get(); }
  catch { throw new OwnerSourceError(code); }
}

async function loadServices() {
  const [{ initAdminDb }, { getAuth }, { FieldPath, Timestamp }] = await Promise.all([
    import('../_shared/firebase-admin.js'), import('firebase-admin/auth'), import('firebase-admin/firestore'),
  ]);
  const db = initAdminDb('owner-notification-sweep');
  if (!db) throw new Error('SERVICES_UNAVAILABLE');
  return { db, auth: getAuth(), documentId: FieldPath.documentId(),
    timestamp: (time) => new Timestamp(time.seconds, time.nanoseconds) };
}

function queryTime(time, services, spec) {
  return spec.numericTime ? time.ms : services.timestamp(time);
}

function initialCursor(now, spec, config) {
  return sealOwnerCursor({ time: timeAtMs(now, spec.numericTime), id: null }, config, spec.name);
}

function activeWhatsAppSession(session, accountId, sourceAtMs, nowMs) {
  return session && session.policyVersion === 1 && session.accountId === accountId && session.status === 'active'
    && Number.isSafeInteger(session.startedAtMs) && Number.isSafeInteger(session.expiresAtMs)
    && session.startedAtMs < sourceAtMs && sourceAtMs < session.expiresAtMs && nowMs < session.expiresAtMs;
}

/** No message text, sender, subject or contact record is returned or queued. */
async function externalInboxEventAllowed(db, id, data, nowMs, configs) {
  const config = data.channel === 'email'
    ? companyGmailInboxConfigForAccount(configs, data.accountId) : configs.whatsapp;
  if (!config?.ready || data.accountId !== config.accountId || data.sourceAtMs < config.captureStartAtMs
    || !Number.isSafeInteger(nowMs) || !Number.isSafeInteger(data.receivedAtMs)
    || data.sourceAtMs > data.receivedAtMs || data.receivedAtMs > nowMs) return false;
  if (data.retentionPolicyVersion === 2) {
    if (data.expiresAtMs !== 0 || data.expiresAt !== null
      || id !== ownerHash('external-inbox.v1', data.channel, data.accountId, data.providerMessageId)
      || data.caseId !== inboxCaseId(data)) return false;
    let record;
    try { record = await db.collection(INBOX_CASES_COLLECTION).doc(data.caseId).get(); }
    catch { throw new OwnerSourceError('INBOX_CASE_READ_FAILED'); }
    // Missing/corrupt case evidence is not permission to skip a new inquiry forever.
    if (!record.exists || !validInboxCase(record.data(), data.caseId) || record.data().updatedAtMs > nowMs) {
      throw new OwnerSourceError('INBOX_CASE_UNAVAILABLE');
    }
    if (!inboxCaseAllowsRead(record.data(), data.caseId, nowMs, data)) return false;
  } else if (data.retentionPolicyVersion !== undefined || data.expiresAtMs <= nowMs) return false;
  if (data.channel !== 'whatsapp') return data.channel === 'email';
  if (data.whatsappPolicyVersion !== 1 || typeof data.whatsappSessionId !== 'string') return false;
  if (data.retentionPolicyVersion === 2 && (!validSupportSender(data.providerThreadId)
    || data.whatsappSessionId !== sessionDocId(data.accountId, data.providerThreadId))) return false;
  try {
    const snap = await db.collection(WHATSAPP_SESSIONS_COLLECTION).doc(data.whatsappSessionId).get();
    return snap.exists && activeWhatsAppSession(snap.data(), config.accountId, data.sourceAtMs, nowMs);
  } catch { throw new OwnerSourceError('WHATSAPP_SESSION_READ_FAILED'); }
}

async function acquireControl(db, config, device, now, token) {
  const ref = db.collection(OWNER_CONTROL_COLLECTION).doc('v1');
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) {
      const cursors = Object.fromEntries(OWNER_SOURCES.map((spec) => [spec.name,
        initialCursor(now, spec, config)]));
      tx.create(ref, { version: 1, scope: config.scope, deviceHash: device.deviceHash,
        sourceSchemaVersion: OWNER_SOURCE_SCHEMA_VERSION, activatedAtMs: now, cursors,
        nextSource: 0, lockToken: token, lockUntilMs: now + OWNER_LEASE_MS });
      return { code: 'INITIALIZED', ref };
    }
    const state = snap.data();
    if (state.version !== 1 || state.scope !== config.scope || state.deviceHash !== device.deviceHash) return { code: 'CONFIGURATION_CHANGED' };
    const sourceSchemaVersion = state.sourceSchemaVersion === undefined ? 1 : state.sourceSchemaVersion;
    if (!Number.isInteger(sourceSchemaVersion) || sourceSchemaVersion < 1 || sourceSchemaVersion > OWNER_SOURCE_SCHEMA_VERSION
      || !Number.isSafeInteger(state.activatedAtMs) || !Number.isSafeInteger(state.lockUntilMs) || !Number.isInteger(state.nextSource)
      || state.nextSource < 0 || state.nextSource >= OWNER_SOURCES.length) return { code: 'CONTROL_INVALID' };
    // Validate all persisted cursors before taking a lock. Rotation/corruption never resets the cutover.
    const cursors = { ...(state.cursors || {}) };
    const added = {};
    for (const spec of OWNER_SOURCES) {
      if (typeof cursors[spec.name] !== 'string') {
        // Only versioned new metadata sources may start at upgrade time. A missing
        // legacy cursor is corruption and must never silently skip its backlog.
        if (!(spec.introducedVersion > sourceSchemaVersion)) return { code: 'CURSOR_INVALID' };
        cursors[spec.name] = initialCursor(now, spec, config);
        added[`cursors.${spec.name}`] = cursors[spec.name];
      }
      const cursor = openOwnerCursor(cursors[spec.name], config, spec.name);
      if (timeToMs(cursor.time) < state.activatedAtMs) return { code: 'CURSOR_INVALID' };
    }
    if (state.lockUntilMs > now) return { code: 'BUSY' };
    tx.update(ref, { lockToken: token, lockUntilMs: now + OWNER_LEASE_MS,
      sourceSchemaVersion: OWNER_SOURCE_SCHEMA_VERSION, ...added });
    return { ref, state: { ...state, cursors }, code: 'ACQUIRED' };
  });
}

async function advanceCursor(db, control, config, device, spec, cursor, event, now, token) {
  const eventRef = event ? db.collection(OWNER_EVENT_COLLECTION).doc(ownerEventId(event, config, device)) : null;
  const sealed = sealOwnerCursor(cursor, config, spec.name);
  await db.runTransaction(async (tx) => {
    const current = await tx.get(control.ref);
    const state = current.data();
    if (state?.lockToken !== token || state.lockUntilMs <= now) throw new Error('LEASE_LOST');
    const prior = eventRef ? await tx.get(eventRef) : null;
    if (eventRef && !prior.exists) tx.create(eventRef, newOwnerEvent(event, config, device, now));
    tx.update(control.ref, { [`cursors.${spec.name}`]: sealed });
  });
}

/** Metadata-only polling; never modifies booking, inquiry, payment or subscription documents. */
export async function ownerNotificationSweepTask(options = {}) {
  const config = readOwnerNotificationConfig(options.env || process.env);
  if (!config.enabled) return { ok: config.ok, code: config.code, enabled: false };
  const now = options.now || Date.now;
  const started = now();
  const token = randomUUID();
  let control;
  let services;
  const result = { ok: true, code: 'CHECKED', enabled: true, scanned: 0, accepted: 0, retryScheduled: 0,
    needsOperator: 0, removed: 0, sourceFailureCount: 0, sourceFailures: [] };
  try {
    services = await (options.loadServices || loadServices)();
    const { db } = services;
    const externalInboxConfigs = { ...readCompanyGmailInboxConfigs(options.env || process.env, started),
      whatsapp: readWhatsAppInboxConfig(options.env || process.env, started) };
    const device = await readSelectedOwnerDevice(services, config);
    if (!device) return { ok: false, enabled: true, code: 'OWNER_DEVICE_REQUIRED' };
    control = await acquireControl(db, config, device, started, token);
    if (control.code !== 'ACQUIRED') return { ok: ['INITIALIZED', 'BUSY'].includes(control.code), enabled: true, code: control.code };

    const upperMs = started - SETTLE_MS;
    if (upperMs >= control.state.activatedAtMs) {
      for (let offset = 0; offset < OWNER_SOURCES.length; offset++) {
        if (now() - started >= RUN_BUDGET_MS) break;
        const sourceIndex = (control.state.nextSource + offset) % OWNER_SOURCES.length;
        const spec = OWNER_SOURCES[sourceIndex];
        const cursor = openOwnerCursor(control.state.cursors[spec.name], config, spec.name);
        if (timeToMs(cursor.time) > upperMs) continue;
        let sourceFailure = null;
        try {
          let query = db.collection(spec.name).where(spec.timeField, '>=', queryTime(cursor.time, services, spec))
            .where(spec.timeField, '<=', queryTime(timeAtMs(upperMs, spec.numericTime), services, spec))
            .orderBy(spec.timeField, 'asc').orderBy(services.documentId, 'asc').select(...spec.fields);
          if (cursor.id !== null) query = query.startAfter(queryTime(cursor.time, services, spec), cursor.id);
          const snap = await readSource(query.limit(PAGE_SIZE), 'SOURCE_QUERY_FAILED');
          let completed = true;
          for (const doc of snap.docs) {
            if (now() - started >= RUN_BUDGET_MS) { completed = false; break; }
            // A Firestore-legal source ID may exceed this worker's cursor policy.
            // Isolate the source before sealing; this is not persisted-cursor corruption.
            if (!isOwnerSourceId(doc.id)) throw new OwnerSourceError('SOURCE_ID_INVALID');
            const data = doc.data();
            const time = sourceTime(data[spec.timeField], spec.numericTime);
            if (!time || timeToMs(time) < control.state.activatedAtMs || timeToMs(time) > upperMs) throw new OwnerSourceError('SOURCE_TIME_INVALID');
            let event = eventFromSource(spec.name, doc.id, data);
            if (event && spec.name === 'external_inbox_messages') {
              const allowed = await externalInboxEventAllowed(db, doc.id, data, now(), externalInboxConfigs);
              if (!allowed) event = null;
            }
            // A new confirmed mirror of a pre-activation pending booking is not a new reservation.
            if (isOwnerSourceCandidate(spec.name, data) && spec.name === 'bookings' && ['paypal-manual', 'paypal-webhook'].includes(data.provider)) {
              if (!event || typeof data.bookingRef !== 'string' || !data.bookingRef || data.bookingRef.includes('/')) throw new OwnerSourceError('SOURCE_LINK_INVALID');
              const pending = await readSource(db.collection('pending_bookings').where(services.documentId, '==', data.bookingRef)
                .select('createdAt').limit(1), 'SOURCE_LINK_UNAVAILABLE');
              const priorTime = sourceTime(pending.docs[0]?.data()?.createdAt);
              if (!priorTime) throw new OwnerSourceError('SOURCE_LINK_INVALID');
              if (timeToMs(priorTime) < control.state.activatedAtMs) event = null;
            }
            await advanceCursor(db, control, config, device, spec, { time, id: doc.id }, event, now(), token);
            result.scanned++;
          }
          // An incomplete/blocked page must never advance past the ambiguous record.
          if (completed && snap.docs.length < PAGE_SIZE) {
            await advanceCursor(db, control, config, device, spec,
              { time: timeAtMs(upperMs, spec.numericTime), id: null }, null, now(), token);
          }
        } catch (error) {
          // Only source read/validation failures are isolated. A broken control
          // transaction, lost lease or cursor authentication still stops this run.
          if (!(error instanceof OwnerSourceError)) throw error;
          sourceFailure = error.code;
          result.code = 'PARTIAL_SOURCE_FAILURE';
          result.sourceFailures.push({ source: spec.name, code: sourceFailure });
          result.sourceFailureCount++;
          result.needsOperator++;
        }
        await db.runTransaction(async (tx) => {
          const latest = await tx.get(control.ref);
          if (latest.data()?.lockToken !== token || latest.data()?.lockUntilMs <= now()) throw new Error('LEASE_LOST');
          const priorFailures = latest.data()?.sourceHealth?.[spec.name]?.consecutiveFailures;
          const consecutiveFailures = sourceFailure
            ? Math.min(1_000_000, (Number.isSafeInteger(priorFailures) && priorFailures > 0 ? priorFailures : 0) + 1) : 0;
          tx.update(control.ref, { nextSource: (sourceIndex + 1) % OWNER_SOURCES.length,
            [`sourceHealth.${spec.name}`]: { code: sourceFailure || 'CHECKED', checkedAtMs: now(), consecutiveFailures } });
        });
      }
    }
    if (now() - started < RUN_BUDGET_MS) {
      const due = await db.collection(OWNER_EVENT_COLLECTION).where('nextAttemptAtMs', '<=', now())
        .orderBy('nextAttemptAtMs', 'asc').limit(SEND_LIMIT).get();
      for (const doc of due.docs) {
        if (now() - started >= RUN_BUDGET_MS - 8000) break;
        const delivery = await deliverOwnerEvent(services, config, device, doc.id, { now, send: options.send });
        if (delivery.code === 'PROVIDER_ACCEPTED') result.accepted++;
        else if (delivery.code === 'RETRY_SCHEDULED') result.retryScheduled++;
        else if (['MANUAL_REQUIRED', 'OUTCOME_UNKNOWN', 'EVENT_INVALID'].includes(delivery.code)) result.needsOperator++;
      }
      result.removed = await pruneExpiredOwnerEvents(db, now(), 25, () => now() - started < RUN_BUDGET_MS);
    }
    return result;
  } catch {
    // Static code only: SDK errors can contain document paths, endpoint URLs or keys.
    return { ...result, ok: false, code: 'OWNER_SWEEP_FAILED' };
  } finally {
    if (control?.ref && services) {
      try {
        await services.db.runTransaction(async (tx) => {
          const snap = await tx.get(control.ref);
          if (snap.data()?.lockToken === token) tx.update(control.ref, { lockUntilMs: 0 });
        });
      } catch { /* Expiring lease remains recoverable; no raw error logging. */ }
    }
  }
}

export default async function handler(req, res) {
  const { verifyCronRequest } = await import('../_shared/cron-auth.js');
  const authorized = await verifyCronRequest(req);
  if (!authorized.ok) return res.status(401).json({ ok: false, code: 'AUTH_REQUIRED' });
  const result = await ownerNotificationSweepTask();
  return res.status(result.ok ? 200 : 503).json(result);
}
