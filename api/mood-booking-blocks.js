/**
 * GET/POST /api/mood-booking-blocks — MOOD 예약 차단 규칙 조회·관리.
 *
 * GET: 검증된 MOOD allowlist 사용자.
 * POST: 검증된 allowlist.admin 전용. 단일 rule upsert/delete를 revision CAS와
 * requestId 멱등성으로 처리하고 같은 트랜잭션에 감사기록을 남긴다.
 */
import { createHash } from 'node:crypto';
import { initAdminDb } from './_shared/firebase-admin.js';
import { verifyUserToken } from './_shared/user-auth.js';
import { captureError } from './_shared/sentry.js';
import { buildAdminJsonCors } from './_shared/cors.js';
import { getMoodAllowlist, isAllowedEmail, isAdminEmail } from './_shared/mood-allowlist.js';
import {
  getMoodBookingAvailability,
  isValidMoodBookingRuleId,
  moodBookingAvailabilityFromSnapshot,
  moodBookingAvailabilityRef,
  MOOD_BOOKING_AVAILABILITY_MAX_RULES,
  MOOD_BOOKING_AVAILABILITY_SCHEMA_VERSION,
  normalizeMoodBookingAvailabilityRule,
} from './_shared/mood-booking-availability.js';

export const maxDuration = 15;
export const config = { runtime: 'nodejs' };

const CORS_METHODS = 'GET, POST, OPTIONS';
const REQUEST_ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{7,127}$/;

function sendJson(res, status, headers, body) {
  res.writeHead(status, headers);
  return res.end(JSON.stringify(body));
}

function parseBody(req) {
  let body = req.body || {};
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { body = {}; }
  }
  return body && typeof body === 'object' && !Array.isArray(body) ? body : {};
}

function normalizedMutation(body) {
  const action = body.action;
  const requestId = typeof body.requestId === 'string' ? body.requestId.trim() : '';
  const expectedRevision = body.expectedRevision;
  if (action !== 'upsert' && action !== 'delete') {
    return { ok: false, error: 'INVALID_BOOKING_BLOCK_ACTION' };
  }
  if (!REQUEST_ID_RE.test(requestId)) {
    return { ok: false, error: 'INVALID_REQUEST_ID' };
  }
  if (!Number.isInteger(expectedRevision) || expectedRevision < 0) {
    return { ok: false, error: 'INVALID_EXPECTED_REVISION' };
  }

  if (action === 'upsert') {
    const normalized = normalizeMoodBookingAvailabilityRule(body.rule);
    if (!normalized.ok) return normalized;
    return { ok: true, action, requestId, expectedRevision, rule: normalized.value };
  }

  const ruleId = typeof body.ruleId === 'string' ? body.ruleId.trim() : '';
  if (!isValidMoodBookingRuleId(ruleId)) {
    return { ok: false, error: 'INVALID_BOOKING_BLOCK_RULE_ID' };
  }
  return { ok: true, action, requestId, expectedRevision, ruleId };
}

function payloadHash(mutation) {
  const payload = mutation.action === 'upsert'
    ? {
      action: mutation.action,
      expectedRevision: mutation.expectedRevision,
      requestId: mutation.requestId,
      rule: mutation.rule,
    }
    : {
      action: mutation.action,
      expectedRevision: mutation.expectedRevision,
      requestId: mutation.requestId,
      ruleId: mutation.ruleId,
    };
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

export default async function handler(req, res) {
  const JSON_HEADERS = {
    'Cache-Control': 'no-store',
    ...buildAdminJsonCors(req, { methods: CORS_METHODS, headers: 'Authorization, Content-Type' }),
  };

  if (req.method === 'OPTIONS') {
    res.writeHead(200, JSON_HEADERS);
    return res.end();
  }
  if (req.method !== 'GET' && req.method !== 'POST') {
    return sendJson(res, 405, JSON_HEADERS, { ok: false, error: 'GET or POST only' });
  }

  const auth = await verifyUserToken(req);
  if (!auth.ok) return sendJson(res, auth.status, JSON_HEADERS, { ok: false, error: auth.error });
  if (!auth.emailVerified) {
    return sendJson(res, 403, JSON_HEADERS, { ok: false, error: 'EMAIL_NOT_VERIFIED' });
  }
  const email = auth.email;

  try {
    const db = initAdminDb('mood-booking-blocks');
    if (!db) return sendJson(res, 500, JSON_HEADERS, { ok: false, error: 'FIRESTORE_UNAVAILABLE' });

    const allowlist = await getMoodAllowlist(db);
    if (req.method === 'GET') {
      if (!isAllowedEmail(allowlist, email) && !isAdminEmail(allowlist, email)) {
        return sendJson(res, 403, JSON_HEADERS, { ok: false, error: 'ACCESS_DENIED' });
      }
      const bookingAvailability = await getMoodBookingAvailability(db);
      return sendJson(res, 200, JSON_HEADERS, { ok: true, data: { bookingAvailability } });
    }
    if (!isAdminEmail(allowlist, email)) {
      return sendJson(res, 403, JSON_HEADERS, { ok: false, error: 'ADMIN_REQUIRED' });
    }

    const mutation = normalizedMutation(parseBody(req));
    if (!mutation.ok) return sendJson(res, 400, JSON_HEADERS, { ok: false, error: mutation.error });

    const configRef = moodBookingAvailabilityRef(db);
    const allowlistRef = db.collection('mood_config').doc('allowlist');
    const auditRef = db.collection('mood_booking_block_audit').doc(mutation.requestId);
    const requestPayloadHash = payloadHash(mutation);
    const result = await db.runTransaction(async (tx) => {
      const [auditSnap, configSnap, allowlistSnap] = await Promise.all([
        tx.get(auditRef),
        tx.get(configRef),
        tx.get(allowlistRef),
      ]);

      // 권한 회수와 설정 commit 사이 TOCTOU 차단. 바깥 검사는 빠른 실패용이고,
      // 실제 쓰기 권한은 같은 트랜잭션에서 읽은 최신 admins 목록으로 확정한다.
      const transactionAllowlistData = allowlistSnap.exists ? (allowlistSnap.data() || {}) : {};
      const transactionAdmins = Array.isArray(transactionAllowlistData.admins)
        ? transactionAllowlistData.admins.map((value) => String(value || '').toLowerCase().trim()).filter(Boolean)
        : [];
      if (!isAdminEmail({ admins: transactionAdmins }, email)) {
        return { ok: false, status: 403, error: 'ADMIN_REQUIRED' };
      }

      if (auditSnap.exists) {
        const audit = auditSnap.data() || {};
        if (audit.payloadHash !== requestPayloadHash || audit.actorEmail !== email) {
          return { ok: false, status: 409, error: 'IDEMPOTENCY_CONFLICT' };
        }
        if (!audit.bookingAvailability || typeof audit.bookingAvailability !== 'object') {
          return { ok: false, status: 409, error: 'IDEMPOTENCY_RESPONSE_MISSING' };
        }
        const bookingAvailability = moodBookingAvailabilityFromSnapshot({
          exists: true,
          data: () => audit.bookingAvailability,
        });
        return { ok: true, replayed: true, bookingAvailability };
      }

      const current = moodBookingAvailabilityFromSnapshot(configSnap);
      if (current.revision !== mutation.expectedRevision) {
        return {
          ok: false,
          status: 409,
          error: 'REVISION_CONFLICT',
          bookingAvailability: current,
        };
      }

      let nextRules;
      let ruleId;
      if (mutation.action === 'upsert') {
        ruleId = mutation.rule.id;
        const existingIndex = current.rules.findIndex((rule) => rule.id === ruleId);
        if (existingIndex === -1 && current.rules.length >= MOOD_BOOKING_AVAILABILITY_MAX_RULES) {
          return { ok: false, status: 409, error: 'BOOKING_BLOCK_RULE_LIMIT' };
        }
        nextRules = current.rules.map((rule) => ({ ...rule, weekdays: [...rule.weekdays] }));
        if (existingIndex === -1) nextRules.push(mutation.rule);
        else nextRules[existingIndex] = mutation.rule;
      } else {
        ruleId = mutation.ruleId;
        if (!current.rules.some((rule) => rule.id === ruleId)) {
          return { ok: false, status: 404, error: 'BOOKING_BLOCK_RULE_NOT_FOUND' };
        }
        nextRules = current.rules.filter((rule) => rule.id !== ruleId);
      }

      const now = Date.now();
      const bookingAvailability = {
        schemaVersion: MOOD_BOOKING_AVAILABILITY_SCHEMA_VERSION,
        revision: current.revision + 1,
        rules: nextRules,
      };
      tx.set(configRef, {
        ...bookingAvailability,
        updatedAt: now,
        updatedByEmail: email,
      });
      tx.set(auditRef, {
        type: mutation.action === 'upsert' ? 'booking_block_upserted' : 'booking_block_deleted',
        action: mutation.action,
        requestId: mutation.requestId,
        payloadHash: requestPayloadHash,
        actorEmail: email,
        ruleId,
        expectedRevision: mutation.expectedRevision,
        previousRevision: current.revision,
        revision: bookingAvailability.revision,
        before: current,
        bookingAvailability,
        createdAt: now,
      });
      return { ok: true, replayed: false, bookingAvailability };
    });

    if (!result.ok) {
      return sendJson(res, result.status || 409, JSON_HEADERS, {
        ok: false,
        error: result.error || 'BOOKING_BLOCK_UPDATE_FAILED',
        ...(result.bookingAvailability ? { data: { bookingAvailability: result.bookingAvailability } } : {}),
      });
    }
    return sendJson(res, 200, JSON_HEADERS, {
      ok: true,
      data: { bookingAvailability: result.bookingAvailability },
    });
  } catch (err) {
    if (err && err.code === 'INVALID_BOOKING_AVAILABILITY_CONFIG') {
      return sendJson(res, 409, JSON_HEADERS, { ok: false, error: err.code, detail: err.detail });
    }
    console.error('[mood-booking-blocks] failed:', err.message);
    await captureError(err, { route: '/api/mood-booking-blocks', email });
    return sendJson(res, 500, JSON_HEADERS, { ok: false, error: '서버 오류' });
  }
}
