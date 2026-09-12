import { ownerHash } from './owner-notification-policy.js';
import { readSelectedOwnerDevice, sendSingleOwnerPush } from './owner-notification-delivery.js';

export const OWNER_NOTIFICATION_TEST_CONTROL = 'owner_notification_control';
const UUID_V4 = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const MAX_ATTEMPTS = 8;
const MIN_INTERVAL_MS = 60_000;
const HASH = /^[a-f0-9]{64}$/;
const validTime = at => Number.isSafeInteger(at) && at > 0 && at <= 8_640_000_000_000_000;

export function parseOwnerNotificationTestBody(req) {
  const type = req.headers?.['content-type'] || req.headers?.['Content-Type'] || '';
  const length = req.headers?.['content-length'] || req.headers?.['Content-Length'];
  if (!/^application\/json(?:\s*;|$)/i.test(String(type))) return null;
  if (length !== undefined && (!/^\d+$/.test(String(length)) || Number(length) > 2048)) return null;
  try {
    const raw = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : req.body;
    if (Buffer.byteLength(typeof raw === 'string' ? raw : JSON.stringify(raw), 'utf8') > 2048) return null;
    const input = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!input || typeof input !== 'object' || Array.isArray(input)
      || ![Object.prototype, null].includes(Object.getPrototypeOf(input))
      || typeof input.subscriptionId !== 'string' || !input.subscriptionId.length || input.subscriptionId.length > 512
      || input.subscriptionId.trim() !== input.subscriptionId || /[\s/\u0000-\u001f\u007f]/.test(input.subscriptionId)) return null;
    const keys = Object.keys(input);
    if (input.action === 'check') {
      return keys.length === 2 && keys.includes('action') && keys.includes('subscriptionId')
        && typeof input.subscriptionId === 'string' ? input : null;
    }
    if (input.action === 'send') {
      return keys.length === 4 && ['action', 'subscriptionId', 'requestId', 'confirmed'].every(k => keys.includes(k))
        && typeof input.subscriptionId === 'string' && typeof input.requestId === 'string'
        && UUID_V4.test(input.requestId) && input.confirmed === true ? input : null;
    }
    return null;
  } catch { return null; }
}

function controlId(config) { return `owner-notification-test-${ownerHash('owner-notification-test-v1', config.scope)}`; }
function controlRef(db, config) { return db.collection(OWNER_NOTIFICATION_TEST_CONTROL).doc(controlId(config)); }
function fixedPayload(config, requestId) {
  const eventKey = ownerHash('owner-notification-test', requestId);
  const copy = {
    ko: ['CocoTrip 운영 알림 테스트', '본인 휴대폰 단일 기기 테스트 알림입니다.'],
    en: ['CocoTrip notification test', 'This is a single-device owner notification test.'],
    ja: ['CocoTrip 通知テスト', '本人の端末1台だけに送る通知テストです。'],
    zh: ['CocoTrip 通知测试', '这是仅发送到本人一台设备的通知测试。'],
  }[config.language];
  return { title: copy[0], body: copy[1], url: '/admin/ai-center', tag: `owner-test-${eventKey}` };
}
function result(code, providerAccepted = false) {
  return { ok: true, data: { code, providerAccepted, deliveryVerified: false } };
}

function attemptsFromSnapshot(snap, config, at) {
  if (!snap.exists) return [];
  const row = snap.data();
  if (!row || row.version !== 1 || row.scope !== config.scope || Object.keys(row).some(key => !['version', 'scope', 'attempts'].includes(key))
    || !Array.isArray(row.attempts) || row.attempts.length < 1 || row.attempts.length > MAX_ATTEMPTS) return null;
  const ids = new Set();
  let previous = 0;
  for (const item of row.attempts) {
    if (!item || Object.keys(item).length !== 4 || typeof item.requestId !== 'string' || !UUID_V4.test(item.requestId)
      || ids.has(item.requestId) || !validTime(item.atMs) || item.atMs > at || item.atMs < previous
      || typeof item.deviceHash !== 'string' || !HASH.test(item.deviceHash)
      || !['SENDING', 'PROVIDER_ACCEPTED', 'OUTCOME_UNKNOWN', 'SEND_REJECTED'].includes(item.outcome)) return null;
    ids.add(item.requestId); previous = item.atMs;
  }
  return row.attempts.map(item => ({ ...item }));
}
function blockedCode(attempts, at) {
  if (!attempts) return 'CONTROL_INVALID';
  if (attempts.some(item => ['SENDING', 'OUTCOME_UNKNOWN'].includes(item.outcome))) return 'OUTCOME_UNKNOWN';
  if (attempts.length >= MAX_ATTEMPTS) return 'MAX_TESTS_REACHED';
  const last = attempts.at(-1);
  return last && at - last.atMs < MIN_INTERVAL_MS ? 'RATE_LIMITED' : '';
}

export async function ownerNotificationTestTask({ db, auth, config, input, now = Date.now, send = sendSingleOwnerPush, timeoutMs = 6500 }) {
  if (!config?.enabled) return result('SEND_REJECTED');
  if (!input || !['check', 'send'].includes(input.action)) return { ok: false, code: 'INVALID_REQUEST' };
  if (input.subscriptionId !== config.subscriptionId) return { ok: false, code: 'DEVICE_NOT_SELECTED' };
  if (!validTime(now())) return { ok: false, code: 'OWNER_TEST_UNAVAILABLE' };
  let device;
  try { device = await readSelectedOwnerDevice({ db, auth }, config); }
  catch { return { ok: false, code: 'OWNER_TEST_UNAVAILABLE' }; }
  if (!device) return { ok: false, code: 'OWNER_DEVICE_REQUIRED' };
  const ref = controlRef(db, config);
  if (input.action === 'check') {
    try {
      const snap = await ref.get();
      const at = now();
      if (!validTime(at)) return { ok: false, code: 'OWNER_TEST_UNAVAILABLE' };
      const blocked = blockedCode(attemptsFromSnapshot(snap, config, at), at);
      if (blocked) return { ok: true, data: { ready: false, code: blocked } };
      return { ok: true, data: { ready: true, code: 'READY' } };
    } catch { return { ok: false, code: 'OWNER_TEST_UNAVAILABLE' }; }
  }
  let claim;
  try {
    claim = await db.runTransaction(async tx => {
      const snap = await tx.get(ref);
      const at = now();
      if (!validTime(at)) return { code: 'CONTROL_INVALID' };
      const attempts = attemptsFromSnapshot(snap, config, at);
      if (!attempts) return { code: 'CONTROL_INVALID' };
      if (attempts.some(item => item?.requestId === input.requestId)) return { code: 'ALREADY_HANDLED' };
      const blocked = blockedCode(attempts, at);
      if (blocked) return { code: blocked };
      const attempt = { requestId: input.requestId, atMs: at, deviceHash: device.deviceHash, outcome: 'SENDING' };
      attempts.push(attempt);
      tx.set(ref, { version: 1, scope: config.scope, attempts });
      return { code: 'CLAIMED', attempt };
    });
  } catch { return { ok: false, code: 'OWNER_TEST_UNAVAILABLE' }; }
  if (claim.code !== 'CLAIMED') return result(claim.code);

  let outcome = 'unknown';
  let timer;
  try {
    const fresh = await readSelectedOwnerDevice({ db, auth }, config);
    if (!fresh || fresh.deviceHash !== device.deviceHash || !validTime(now()) || now() - claim.attempt.atMs > 30_000) outcome = 'rejected';
    else {
      const sent = await Promise.race([
        Promise.resolve().then(() => send(fresh.subscription, fixedPayload(config, input.requestId), config)),
        new Promise(resolve => { timer = setTimeout(() => resolve({ outcome: 'unknown' }), timeoutMs); }),
      ]);
      clearTimeout(timer);
      outcome = ['accepted', 'rejected', 'retryable', 'unknown'].includes(sent?.outcome) ? sent.outcome : 'unknown';
    }
  } catch { outcome = 'unknown'; }
  finally { clearTimeout(timer); }
  const code = outcome === 'accepted' ? 'PROVIDER_ACCEPTED' : outcome === 'unknown' ? 'OUTCOME_UNKNOWN' : 'SEND_REJECTED';
  try {
    await db.runTransaction(async tx => {
      const snap = await tx.get(ref);
      const attempts = attemptsFromSnapshot(snap, config, now());
      if (!attempts) throw new Error('CONTROL_INVALID');
      const index = attempts.findIndex(item => item?.requestId === input.requestId);
      if (index !== attempts.length - 1 || index < 0 || attempts[index].outcome !== 'SENDING'
        || attempts[index].deviceHash !== device.deviceHash || attempts[index].atMs !== claim.attempt.atMs) throw new Error('CONTROL_INVALID');
      attempts[index] = { ...attempts[index], outcome: code };
      tx.set(ref, { version: 1, scope: config.scope, attempts });
    });
  } catch { return result('OUTCOME_UNKNOWN'); }
  return result(code, code === 'PROVIDER_ACCEPTED');
}

export { UUID_V4 };
