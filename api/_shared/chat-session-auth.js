/**
 * AI 채팅 세션 소유권 계약.
 *
 * 로그인 사용자는 Firebase ID token의 uid, 게스트는 HttpOnly 서명 쿠키가
 * sessionId 소유권을 증명한다. body.userId와 sessionId 문자열 자체는 권한으로 쓰지 않는다.
 * CHAT_SESSION_SIGNING_SECRET은 선택 환경변수이며, 없으면 이미 배선된 Firebase
 * 서버 자격증명으로 서명한다. 값을 로그나 응답에 노출하지 않는다.
 */
import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';
import { verifyFirebaseIdentityToken } from './user-auth.js';

export const CHAT_SESSION_COOKIE = 'ct_chat_session_v1';
export const CHAT_SESSION_MAX_AGE_SEC = 7 * 24 * 60 * 60;

const SESSION_ID_RE = /^sess_[A-Za-z0-9_-]{24,120}$/;

function signingSecret() {
  const secret = process.env.CHAT_SESSION_SIGNING_SECRET
    || process.env.GOOGLE_SERVICE_ACCOUNT_KEY
    || process.env.FIREBASE_PRIVATE_KEY
    || '';
  if (secret.length < 32) throw new Error('chat session signing secret unavailable');
  return secret;
}

function sign(encodedPayload) {
  return createHmac('sha256', signingSecret()).update(encodedPayload, 'utf8').digest('base64url');
}

function safeEqual(left, right) {
  const a = Buffer.from(String(left || ''), 'utf8');
  const b = Buffer.from(String(right || ''), 'utf8');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function createSessionId() {
  return `sess_${randomBytes(24).toString('base64url')}`;
}

/** @returns {{token: string, sessionId: string, expiresAtMs: number}} */
export function createChatSessionToken({
  ownerType,
  ownerId,
  sessionId,
  nowMs = Date.now(),
  maxAgeSec = CHAT_SESSION_MAX_AGE_SEC,
} = {}) {
  if (!['user', 'guest'].includes(ownerType)) throw new Error('invalid chat owner type');
  if (!ownerId || typeof ownerId !== 'string') throw new Error('invalid chat owner id');
  const sid = SESSION_ID_RE.test(String(sessionId || '')) ? String(sessionId) : createSessionId();
  const expiresAtMs = nowMs + maxAgeSec * 1000;
  const payload = {
    v: 1,
    sid,
    typ: ownerType,
    sub: ownerId,
    iat: nowMs,
    exp: expiresAtMs,
  };
  const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  return { token: `${encoded}.${sign(encoded)}`, sessionId: sid, expiresAtMs };
}

/**
 * @returns {{ok: true, sessionId: string, ownerType: 'user'|'guest', ownerId: string, expiresAtMs: number} | {ok: false}}
 */
export function parseChatSessionToken(token, nowMs = Date.now()) {
  try {
    const parts = String(token || '').split('.');
    if (parts.length !== 2 || !safeEqual(sign(parts[0]), parts[1])) return { ok: false };
    const data = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
    if (data.v !== 1 || !SESSION_ID_RE.test(String(data.sid || ''))) return { ok: false };
    if (!['user', 'guest'].includes(data.typ) || typeof data.sub !== 'string' || !data.sub) return { ok: false };
    if (!Number.isFinite(data.exp) || data.exp <= nowMs) return { ok: false };
    if (!Number.isFinite(data.iat) || data.iat > nowMs + 60_000) return { ok: false };
    return {
      ok: true,
      sessionId: data.sid,
      ownerType: data.typ,
      ownerId: data.sub,
      expiresAtMs: data.exp,
    };
  } catch {
    return { ok: false };
  }
}

export function readCookie(req, name) {
  const raw = req.headers?.cookie || req.headers?.Cookie || '';
  for (const item of String(raw).split(';')) {
    const idx = item.indexOf('=');
    if (idx < 0) continue;
    const key = item.slice(0, idx).trim();
    if (key !== name) continue;
    try {
      return decodeURIComponent(item.slice(idx + 1).trim());
    } catch {
      return '';
    }
  }
  return '';
}

function writeSessionCookie(res, token, maxAgeSec = CHAT_SESSION_MAX_AGE_SEC) {
  if (!res || typeof res.setHeader !== 'function') return;
  const secure = process.env.VERCEL || process.env.NODE_ENV === 'production' ? '; Secure' : '';
  res.setHeader(
    'Set-Cookie',
    `${CHAT_SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/api; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSec}${secure}`,
  );
}

async function optionalFirebaseIdentity(req) {
  const header = req.headers?.authorization || req.headers?.Authorization || '';
  if (!String(header).trim()) return { ok: true, authenticated: false, uid: null };
  const auth = await verifyFirebaseIdentityToken(req);
  if (!auth.ok) return auth;
  return { ok: true, authenticated: true, uid: auth.uid };
}

function signedCookie(req) {
  return parseChatSessionToken(readCookie(req, CHAT_SESSION_COOKIE));
}

function ownerFingerprint(value) {
  return createHash('sha256').update(`chat:${String(value || '')}`).digest('hex').slice(0, 32);
}

function resolvedPayload(issued, ownerType, ownerId, uid) {
  return {
    ok: true,
    sessionId: issued.sessionId,
    ownerType,
    ownerId,
    uid: uid || null,
    rateKey: ownerType === 'user' ? `user:${uid}` : `guest:${ownerFingerprint(ownerId)}`,
    ownerFields: ownerType === 'user'
      ? { ownerType: 'user', ownerUid: uid }
      : { ownerType: 'guest', ownerFingerprint: ownerFingerprint(ownerId) },
  };
}

/** POST /api/chat: 유효한 기존 소유권을 재사용하고, 없으면 서버가 새 세션을 발급한다. */
export async function resolveChatSessionForPost(req, res) {
  const identity = await optionalFirebaseIdentity(req);
  if (!identity.ok) return identity;
  const existing = signedCookie(req);

  if (identity.authenticated) {
    const canReuseUser = existing.ok
      && existing.ownerType === 'user'
      && existing.ownerId === identity.uid;
    const canClaimGuest = existing.ok && existing.ownerType === 'guest';
    const sid = canReuseUser || canClaimGuest ? existing.sessionId : '';
    const issued = createChatSessionToken({ ownerType: 'user', ownerId: identity.uid, sessionId: sid });
    if (!canReuseUser || existing.expiresAtMs - Date.now() < 24 * 60 * 60 * 1000) {
      writeSessionCookie(res, issued.token);
    }
    return resolvedPayload(issued, 'user', identity.uid, identity.uid);
  }

  if (existing.ok && existing.ownerType === 'guest') {
    return resolvedPayload(
      { sessionId: existing.sessionId },
      'guest',
      existing.ownerId,
      null,
    );
  }

  const guestId = randomBytes(24).toString('base64url');
  const issued = createChatSessionToken({ ownerType: 'guest', ownerId: guestId });
  writeSessionCookie(res, issued.token);
  return resolvedPayload(issued, 'guest', guestId, null);
}

/** GET /api/chat-poll: sessionId만 아는 요청은 거부하고 Firebase/서명 소유권을 대조한다. */
export async function authorizeChatSessionRead(req, res, requestedSessionId) {
  if (!SESSION_ID_RE.test(String(requestedSessionId || ''))) {
    return { ok: false, status: 400, error: 'Invalid sessionId', code: 'INVALID_SESSION' };
  }
  const identity = await optionalFirebaseIdentity(req);
  if (!identity.ok) return { ...identity, code: 'AUTH_INVALID' };
  const existing = signedCookie(req);
  if (!existing.ok) {
    return { ok: false, status: 401, error: 'Chat session proof required', code: 'SESSION_PROOF_REQUIRED' };
  }
  if (existing.sessionId !== requestedSessionId) {
    return { ok: false, status: 403, error: 'Chat session ownership mismatch', code: 'SESSION_FORBIDDEN' };
  }

  if (identity.authenticated) {
    if (existing.ownerType === 'user' && existing.ownerId !== identity.uid) {
      return { ok: false, status: 403, error: 'Chat session ownership mismatch', code: 'SESSION_FORBIDDEN' };
    }
    if (existing.ownerType === 'guest') {
      const migrated = createChatSessionToken({
        ownerType: 'user',
        ownerId: identity.uid,
        sessionId: existing.sessionId,
      });
      writeSessionCookie(res, migrated.token);
      return resolvedPayload(migrated, 'user', identity.uid, identity.uid);
    }
    return resolvedPayload(
      { sessionId: existing.sessionId },
      'user',
      identity.uid,
      identity.uid,
    );
  }

  if (existing.ownerType !== 'guest') {
    return { ok: false, status: 401, error: 'Firebase login required for this chat session', code: 'AUTH_REQUIRED' };
  }
  return resolvedPayload(
    { sessionId: existing.sessionId },
    'guest',
    existing.ownerId,
    null,
  );
}

/** 세션 소유자별 1분 폴링 상한. Firestore 장애 시 읽기 권한 검증은 유지하고 카운터만 완화한다. */
export async function checkChatPollRateLimit(db, rateKey, nowMs = Date.now()) {
  if (!db || !rateKey) return { ok: true, degraded: true };
  const docId = ownerFingerprint(rateKey);
  const ref = db.collection('chat_poll_rate_limits').doc(docId);
  const windowMs = 60 * 1000;
  const maxRequests = 30;
  try {
    return await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const data = snap.exists ? (snap.data() || {}) : {};
      const oldStart = Number(data.windowStartedAtMs || 0);
      const inWindow = oldStart > 0 && nowMs - oldStart < windowMs;
      const start = inWindow ? oldStart : nowMs;
      const count = inWindow ? Number(data.count || 0) : 0;
      if (count >= maxRequests) {
        return {
          ok: false,
          status: 429,
          retryAfterSec: Math.max(1, Math.ceil((start + windowMs - nowMs) / 1000)),
        };
      }
      tx.set(ref, { count: count + 1, windowStartedAtMs: start, lastSeenAtMs: nowMs });
      return { ok: true };
    });
  } catch (error) {
    return { ok: true, degraded: true, error: error.message };
  }
}
