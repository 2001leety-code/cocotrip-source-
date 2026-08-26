/**
 * /api/mood-allowlist-admin — MOOD 포털 접근 이메일 관리 (운영자 전용)
 *
 * mood_config/allowlist 문서의 세 배열을 편집:
 *   - emails: 조회/예약 권한 (운영자 + 광고사 직원)
 *   - admins: 충전(topup) 권한 (운영자만)
 *   - settlementApproverEmails: MOOD 금액 확인 담당자(admins 와 겹치지 않음)
 *
 * 인증: Authorization: Bearer <Firebase ID token>.
 *   - 토큰 email 이 mood_config/allowlist.admins (운영자만) 에 없으면 403.
 *   - emailVerified=false 도 403 (defense-in-depth) — 권한 변경 = 민감 경계.
 *
 * GET:  현재 { emails, admins, settlementApproverEmails, clientId } 반환. (운영자 전용)
 * POST: { action: 'add'|'remove', list: 'emails'|'admins'|'settlementApproverEmails', email }.
 *   - 정규화 소문자 + 유효 이메일 형식 검증 + 중복 방지.
 *   - Firestore 트랜잭션 (동시 편집 안전 — read-modify-write).
 *   - 실제 권한 변경은 mood_access_audit 불변 감사 문서와 같이 기록.
 *   - ⚠️ 안전장치: admins 마지막 1인 제거는 거부 (잠금 방지 — admins 0개 금지).
 *   - clientId 는 이 API 로 안 건드림 (별도 관리).
 */
import { initAdminDb } from './_shared/firebase-admin.js';
import { verifyUserToken } from './_shared/user-auth.js';
import { captureError } from './_shared/sentry.js';
import { buildAdminJsonCors } from './_shared/cors.js';
import { getMoodAllowlist, isAdminEmail } from './_shared/mood-allowlist.js';

export const maxDuration = 15;
export const config = { runtime: 'nodejs' };

const CORS_METHODS = 'GET, POST, OPTIONS';
const ALLOWLIST_PATH = ['mood_config', 'allowlist'];

// 이메일 형식 검증 — 간단하지만 실무 충분 (공백/at 하나/도메인 dot).
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function normEmail(e) {
  return String(e || '').toLowerCase().trim();
}

function normalizedList(value) {
  const result = [];
  for (const entry of Array.isArray(value) ? value : []) {
    const email = normEmail(entry);
    if (email && !result.includes(email)) result.push(email);
  }
  return result;
}

export default async function handler(req, res) {
  const JSON_HEADERS = { 'Cache-Control': 'no-store', ...buildAdminJsonCors(req, { methods: CORS_METHODS, headers: 'Authorization, Content-Type' }) };

  if (req.method === 'OPTIONS') {
    res.writeHead(200, JSON_HEADERS);
    return res.end();
  }
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.writeHead(405, JSON_HEADERS);
    return res.end(JSON.stringify({ ok: false, error: 'GET or POST only' }));
  }

  const auth = await verifyUserToken(req);
  if (!auth.ok) {
    res.writeHead(auth.status, JSON_HEADERS);
    return res.end(JSON.stringify({ ok: false, error: auth.error }));
  }
  const email = auth.email;
  // 권한 변경 경계 — 미검증 이메일 토큰 차단 (defense-in-depth).
  if (!auth.emailVerified) {
    res.writeHead(403, JSON_HEADERS);
    return res.end(JSON.stringify({ ok: false, error: '이메일 미검증' }));
  }

  try {
    const db = initAdminDb('mood-allowlist-admin');
    if (!db) {
      res.writeHead(500, JSON_HEADERS);
      return res.end(JSON.stringify({ ok: false, error: 'Firestore unavailable' }));
    }

    // 운영자(admins) 만 이메일 관리 가능 — allowlist.emails 만으로는 부족.
    const allowlist = await getMoodAllowlist(db);
    if (!isAdminEmail(allowlist, email)) {
      res.writeHead(403, JSON_HEADERS);
      return res.end(JSON.stringify({ ok: false, error: '관리 권한 없음 (운영자 전용)' }));
    }

    // ---- GET: 현재 상태 반환 ----
    if (req.method === 'GET') {
      res.writeHead(200, JSON_HEADERS);
      return res.end(JSON.stringify({
        ok: true,
        data: {
          emails: allowlist.emails,
          admins: allowlist.admins,
          settlementApproverEmails: allowlist.settlementApproverEmails,
          clientId: allowlist.clientId,
        },
      }));
    }

    // ---- POST: add / remove ----
    let body = req.body || {};
    if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
    const action = body.action;
    const list = body.list;
    const targetEmail = normEmail(body.email);

    if (action !== 'add' && action !== 'remove') {
      res.writeHead(400, JSON_HEADERS);
      return res.end(JSON.stringify({ ok: false, error: "action 은 'add' 또는 'remove'" }));
    }
    if (list !== 'emails' && list !== 'admins' && list !== 'settlementApproverEmails') {
      res.writeHead(400, JSON_HEADERS);
      return res.end(JSON.stringify({ ok: false, error: '지원하지 않는 권한 목록' }));
    }
    if (!targetEmail || !EMAIL_RE.test(targetEmail)) {
      res.writeHead(400, JSON_HEADERS);
      return res.end(JSON.stringify({ ok: false, error: '유효한 email 형식 필요' }));
    }

    const docRef = db.collection(ALLOWLIST_PATH[0]).doc(ALLOWLIST_PATH[1]);
    const auditRef = db.collection('mood_access_audit').doc();
    const changedAt = Date.now();

    const txResult = await db.runTransaction(async (tx) => {
      const snap = await tx.get(docRef);
      const data = snap.exists ? (snap.data() || {}) : {};

      // 정규화 + 중복 제거해 현재 배열 재구성 (config 측 대문자/중복 방어).
      const current = normalizedList(data[list]);
      const emails = normalizedList(data.emails);
      const admins = normalizedList(data.admins);
      const approvers = normalizedList(data.settlementApproverEmails);

      const idx = current.indexOf(targetEmail);
      let next;

      if (action === 'add') {
        if (idx !== -1) {
          // 이미 존재 — 멱등 성공 (변경 없음).
          return { ok: true, changed: false, list, action, emails: current };
        }
        if (list === 'settlementApproverEmails' && !emails.includes(targetEmail)) {
          return { ok: false, status: 409, error: '먼저 조회·예약 권한에 이메일을 등록해 주세요.' };
        }
        if (list === 'admins' && !emails.includes(targetEmail)) {
          return { ok: false, status: 409, error: '먼저 조회·예약 권한에 이메일을 등록해 주세요.' };
        }
        if (list === 'settlementApproverEmails' && admins.includes(targetEmail)) {
          return { ok: false, status: 409, error: '금액 제안 운영자와 MOOD 확인 담당자는 같을 수 없습니다. 운영자 권한을 먼저 제거해 주세요.' };
        }
        if (list === 'admins' && approvers.includes(targetEmail)) {
          return { ok: false, status: 409, error: 'MOOD 확인 담당자 권한을 먼저 제거해 주세요.' };
        }
        next = [...current, targetEmail];
      } else {
        // remove
        if (idx === -1) {
          // 없는 걸 지움 — 멱등 성공 (변경 없음).
          return { ok: true, changed: false, list, action, emails: current };
        }
        // ⚠️ 잠금 방지 — admins 마지막 1인 제거 금지 (admins 0개 되면 아무도 관리 불가).
        if (list === 'admins' && current.length <= 1) {
          return { ok: false, status: 409, error: '마지막 운영자는 제거할 수 없습니다 (잠금 방지)' };
        }
        if (list === 'emails' && (approvers.includes(targetEmail) || admins.includes(targetEmail))) {
          return { ok: false, status: 409, error: '금액 제안 운영자·MOOD 확인 담당자 권한을 먼저 제거해 주세요.' };
        }
        next = current.filter((e) => e !== targetEmail);
      }

      // 정규화된 배열로 통째 write (기존 대문자/중복 잔재도 함께 청소).
      tx.set(docRef, { [list]: next }, { merge: true });
      tx.set(auditRef, {
        actorEmail: email,
        targetEmail,
        action,
        list,
        beforeIncluded: idx !== -1,
        afterIncluded: action === 'add',
        changedAt,
      });
      return { ok: true, changed: true, list, action, emails: next };
    });

    if (!txResult.ok) {
      res.writeHead(txResult.status || 400, JSON_HEADERS);
      return res.end(JSON.stringify({ ok: false, error: txResult.error }));
    }

    console.log('[mood-allowlist-admin]', email, '→', txResult.action, targetEmail, 'in', txResult.list, '| changed:', txResult.changed);

    res.writeHead(200, JSON_HEADERS);
    return res.end(JSON.stringify({
      ok: true,
      data: { list: txResult.list, action: txResult.action, changed: txResult.changed, emails: txResult.emails },
    }));
  } catch (err) {
    console.error('[mood-allowlist-admin] failed:', err.message);
    await captureError(err, { route: '/api/mood-allowlist-admin', email });
    res.writeHead(500, JSON_HEADERS);
    return res.end(JSON.stringify({ ok: false, error: '서버 오류' }));
  }
}
