import { createCipheriv, createDecipheriv, createHash, hkdfSync, randomBytes } from 'node:crypto';

export const OWNER_PUSH_URL = '/admin/ai-center';
const SOURCE_BASE_FIELDS = ['createdAt', 'status', 'isTest', 'testMode'];
export const OWNER_SOURCES = Object.freeze([
  { name: 'pending_bookings', timeField: 'createdAt', numericTime: false, fields: [...SOURCE_BASE_FIELDS, 'bookingRef'] },
  { name: 'bookings', timeField: 'createdAt', numericTime: false, fields: [...SOURCE_BASE_FIELDS, 'paypalEnvironment', 'parentOrderID', 'bookingRef', 'provider'] },
  { name: 'mood_bookings', timeField: 'createdAt', numericTime: true, fields: SOURCE_BASE_FIELDS },
  { name: 'charter_inquiries', timeField: 'createdAt', numericTime: false, fields: SOURCE_BASE_FIELDS },
  { name: 'cs_tickets', timeField: 'createdAt', numericTime: false, fields: SOURCE_BASE_FIELDS },
  // Inbox rows are selected without sender, subject or body. The worker rechecks
  // the active WhatsApp session before it can enqueue a generic owner event.
  { name: 'external_inbox_messages', timeField: 'receivedAtMs', numericTime: true, introducedVersion: 2,
    fields: ['receivedAtMs', 'sourceAtMs', 'expiresAtMs', 'channel', 'accountId', 'whatsappPolicyVersion', 'whatsappSessionId'] },
  // A new customer-chat marker is written separately from chat text. Old sessions
  // lack this marker and are intentionally never backfilled into owner push.
  { name: 'chat_sessions', timeField: 'ownerNotificationAt', numericTime: false, introducedVersion: 2,
    fields: ['ownerNotificationAt', 'ownerNotificationEligible'] },
]);
export const OWNER_SOURCE_FIELDS = Object.freeze([...new Set(OWNER_SOURCES.flatMap((spec) => spec.fields))]);
const COPY = Object.freeze({
  ko: { title: 'CocoTrip 운영 알림', booking: '새 예약이 접수되었습니다. 운영센터에서 확인하세요.', inquiry: '새 문의가 접수되었습니다. 운영센터에서 확인하세요.' },
  en: { title: 'CocoTrip operations', booking: 'A new reservation was received. Check the operations center.', inquiry: 'A new inquiry was received. Check the operations center.' },
  ja: { title: 'CocoTrip 運営通知', booking: '新しい予約を受け付けました。運営センターでご確認ください。', inquiry: '新しいお問い合わせを受け付けました。運営センターでご確認ください。' },
  zh: { title: 'CocoTrip 运营通知', booking: '收到新预约，请在运营中心查看。', inquiry: '收到新咨询，请在运营中心查看。' },
});
const HEX = /^[a-f0-9]{64}$/;
const value = (input) => typeof input === 'string' ? input.trim() : '';
export const ownerHash = (...parts) => createHash('sha256').update(JSON.stringify(parts)).digest('hex');

function validId(input, max = 512) {
  return typeof input === 'string' && input.length > 0 && input.length <= max
    && input.trim() === input && !input.includes('/')
    && ![...input].some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)
    && input !== '.' && input !== '..';
}

export function isOwnerSourceId(input) { return validId(input); }

function validBase64Key(input, bytes) {
  return typeof input === 'string' && /^[A-Za-z0-9_-]+={0,2}$/.test(input)
    && Buffer.from(input, 'base64url').length === bytes;
}

/** No SDK initialization, database access or dispatch before every opt-in is valid. */
export function readOwnerNotificationConfig(env = {}) {
  if (env.OWNER_EVENT_PUSH_ENABLED !== 'true') return { ok: true, enabled: false, code: 'DISABLED' };
  if (env.VERCEL_ENV !== 'production') return { ok: false, enabled: false, code: 'PRODUCTION_REQUIRED' };
  const uid = value(env.OWNER_NOTIFICATION_UID);
  const subscriptionId = value(env.OWNER_NOTIFICATION_SUBSCRIPTION_ID);
  const adminEmail = value(env.ADMIN_EMAIL || env.VITE_ADMIN_EMAIL).toLowerCase();
  const language = value(env.OWNER_NOTIFICATION_LANGUAGE);
  const retentionRaw = value(env.OWNER_NOTIFICATION_RETENTION_DAYS);
  const retentionDays = /^\d+$/.test(retentionRaw) ? Number(retentionRaw) : 0;
  const cursorSecret = value(env.CRON_SECRET);
  const publicKey = value(env.VAPID_PUBLIC_KEY);
  const privateKey = value(env.VAPID_PRIVATE_KEY);
  const subject = value(env.VAPID_SUBJECT) || 'mailto:help@cocotripkr.com';
  if (!validId(uid, 128) || !validId(subscriptionId) || !subscriptionId.startsWith(`${uid}_`)
    || !adminEmail || !Object.hasOwn(COPY, language)
    || !Number.isSafeInteger(retentionDays) || retentionDays < 1 || retentionDays > 90
    || Buffer.byteLength(cursorSecret) < 32
    || !validBase64Key(publicKey, 65) || !validBase64Key(privateKey, 32)
    || publicKey !== value(env.VITE_VAPID_PUBLIC_KEY)
    || !/^mailto:[^\s<>]+@[^\s<>]+$/.test(subject)) {
    return { ok: false, enabled: false, code: 'CONFIGURATION_REQUIRED' };
  }
  // The stable control document rejects changes to this scope; it never silently
  // initializes a new backlog when a recipient, language or retention is changed.
  const scope = ownerHash('owner-notifications-v1', uid, subscriptionId, language, retentionDays);
  return { ok: true, enabled: true, code: 'CONFIGURED', uid, subscriptionId, adminEmail,
    language, retentionDays, cursorSecret, publicKey, privateKey, subject, scope };
}

/** Firebase Auth UserRecord, not a caller-supplied token/UID. Mirrors admin-auth.js. */
export function isOwnerAdmin(user, config) {
  const email = value(user?.email).toLowerCase();
  return Boolean(user && user.uid === config.uid && user.disabled !== true && user.emailVerified === true
    && email && config.adminEmail && (email === config.adminEmail || user.customClaims?.admin === true));
}

/** Android controller only: prevent an editable subscription from becoming SSRF. */
export function validateOwnerSubscription(id, record, config) {
  if (!record || record.uid !== config.uid || id !== config.subscriptionId) return null;
  const endpoint = record.endpoint;
  if (typeof endpoint !== 'string' || endpoint.length > 4096 || /[\s\\]/.test(endpoint)) return null;
  let url;
  try { url = new URL(endpoint); } catch { return null; }
  if (url.protocol !== 'https:' || url.hostname !== 'fcm.googleapis.com' || url.port
    || url.username || url.password || url.search || url.hash
    || !/^\/(?:fcm\/send|wp)\/[A-Za-z0-9_:-]+$/.test(url.pathname) || url.href !== endpoint) return null;
  const expectedId = `${config.uid}_${Buffer.from(endpoint, 'binary').toString('base64').slice(-32)}`;
  if (id !== expectedId || !validBase64Key(record.keys?.p256dh, 65) || !validBase64Key(record.keys?.auth, 16)) return null;
  return { subscription: { endpoint, keys: { p256dh: record.keys.p256dh, auth: record.keys.auth } },
    deviceHash: ownerHash('device', endpoint, record.keys.p256dh, record.keys.auth) };
}

export function sourceTime(input, numeric = false) {
  if (numeric) return Number.isSafeInteger(input) && input >= 0 ? { ms: input } : null;
  const seconds = input?.seconds;
  const nanoseconds = input?.nanoseconds;
  return Number.isSafeInteger(seconds) && seconds >= 0 && Number.isInteger(nanoseconds)
    && nanoseconds >= 0 && nanoseconds < 1e9 ? { seconds, nanoseconds } : null;
}
export function timeAtMs(ms, numeric = false) {
  return numeric ? { ms } : { seconds: Math.floor(ms / 1000), nanoseconds: (ms % 1000) * 1e6 };
}
export function timeToMs(time) {
  return Object.hasOwn(time, 'ms') ? time.ms : time.seconds * 1000 + time.nanoseconds / 1e6;
}

export function isOwnerSourceCandidate(source, data) {
  if (!OWNER_SOURCES.some((entry) => entry.name === source) || !data) return false;
  if (source === 'external_inbox_messages') {
    return ['email', 'whatsapp'].includes(data.channel)
      && Number.isSafeInteger(data.sourceAtMs) && data.sourceAtMs > 0
      && Number.isSafeInteger(data.expiresAtMs) && data.expiresAtMs > data.sourceAtMs
      && validId(data.accountId, 128)
      && (data.channel !== 'whatsapp' || (data.whatsappPolicyVersion === 1 && HEX.test(data.whatsappSessionId)));
  }
  if (source === 'chat_sessions') return data.ownerNotificationEligible === true;
  if (data.isTest === true || data.testMode === true || data.paypalEnvironment === 'sandbox') return false;
  const status = value(data.status).toLowerCase();
  return source === 'charter_inquiries' || source === 'cs_tickets'
    ? ['new', 'pending', 'open', 'in_progress'].includes(status)
    : ['confirmed', 'awaiting_verification', 'pending'].includes(status);
}

export function eventFromSource(source, id, data) {
  if (!isOwnerSourceId(id) || !isOwnerSourceCandidate(source, data)) return null;
  if (['charter_inquiries', 'cs_tickets', 'external_inbox_messages', 'chat_sessions'].includes(source)) {
    return { kind: 'inquiry', eventKey: ownerHash('inquiry', source, id) };
  }
  const canonical = source === 'bookings' ? data.parentOrderID || data.bookingRef || id : data.bookingRef || id;
  if (!validId(canonical)) return null;
  return { kind: 'booking', eventKey: ownerHash('booking', source === 'mood_bookings' ? 'mood' : 'web', canonical) };
}

export function ownerPayload(kind, eventKey, language) {
  if (!['booking', 'inquiry'].includes(kind) || !HEX.test(eventKey) || !Object.hasOwn(COPY, language)) return null;
  const copy = COPY[language];
  return { title: copy.title, body: copy[kind], url: OWNER_PUSH_URL, tag: `owner-${eventKey}` };
}

function cursorKey(secret) {
  return Buffer.from(hkdfSync('sha256', secret, 'cocotrip-owner-notification-v1', 'resume-cursor/aes-256-gcm', 32));
}
function cursorAad(scope, source) {
  if (!HEX.test(scope) || !OWNER_SOURCES.some((entry) => entry.name === source)) throw new Error('CURSOR_INVALID');
  return Buffer.from(`owner-notification-cursor:v1:${scope}:${source}`);
}
function validateCursor(cursor, source) {
  const spec = OWNER_SOURCES.find((entry) => entry.name === source);
  if (!spec || !cursor || !sourceTime(spec.numericTime ? cursor.time?.ms : cursor.time, spec.numericTime)
    || !(cursor.id === null || isOwnerSourceId(cursor.id))) throw new Error('CURSOR_INVALID');
  return { time: cursor.time, id: cursor.id };
}
export function sealOwnerCursor(cursor, { cursorSecret, scope }, source) {
  validateCursor(cursor, source);
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', cursorKey(cursorSecret), iv);
  cipher.setAAD(cursorAad(scope, source));
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(cursor), 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString('base64url');
}
export function openOwnerCursor(sealed, { cursorSecret, scope }, source) {
  try {
    if (typeof sealed !== 'string' || sealed.length > 4096 || !/^[\w-]+$/.test(sealed)) throw new Error();
    const bytes = Buffer.from(sealed, 'base64url');
    if (bytes.length < 29) throw new Error();
    const decipher = createDecipheriv('aes-256-gcm', cursorKey(cursorSecret), bytes.subarray(0, 12));
    decipher.setAAD(cursorAad(scope, source));
    decipher.setAuthTag(bytes.subarray(12, 28));
    const decoded = Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString('utf8');
    return validateCursor(JSON.parse(decoded), source);
  } catch { throw new Error('CURSOR_INVALID'); }
}
