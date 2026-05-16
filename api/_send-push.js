// Web Push 발송 헬퍼.
// VAPID 키는 Vercel 환경변수에서 주입 (VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY).
// 프론트의 push_subscriptions Firestore collection에 저장된 endpoint들로 발송.
//
// PR #442 (Audit Z-H15 — 2026-05-16): VAPID rotate / 권한 취소 시 401/403 응답을
// 받는 죽은 subscription 들이 "silent retry forever" 됐다. 410/404 만 expired
// 처리해서 401/403 은 매 send 마다 같은 dead subscription 재시도. 이제:
//   - 401/403 은 별도 `authFailed` 플래그로 노출
//   - sendPushToUser 가 subscription 도큐먼트에 failedAttempts 카운터 증가
//   - 5회 연속 auth-failed → subscription 삭제 (mass-cleanup 회피)
//   - throttled operator alert (1시간당 1회) — VAPID 회전 misconfig 감지
import webpush from 'web-push';
import { throttledTelegramAlert } from './_shared/telegram-throttle.js';

const VAPID_PUBLIC = process.env.VAPID_PUBLIC_KEY;
const VAPID_PRIVATE = process.env.VAPID_PRIVATE_KEY;
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || 'mailto:help@cocotripkr.com';

const AUTH_FAILED_STATUS = new Set([401, 403]);
const PERMANENT_GONE_STATUS = new Set([404, 410]);
const MAX_AUTH_FAILED_ATTEMPTS = 5;

let configured = false;
function ensureConfigured() {
  if (configured) return;
  if (!VAPID_PUBLIC || !VAPID_PRIVATE) {
    throw new Error('[push] VAPID keys not set in env (VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY)');
  }
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE);
  configured = true;
}

/**
 * 단일 subscription에 push 발송.
 * @param {{endpoint: string, keys: {p256dh: string, auth: string}}} subscription
 * @param {{title: string, body: string, url?: string, tag?: string, icon?: string}} payload
 * @returns {Promise<{ok: boolean, statusCode?: number, expired?: boolean, authFailed?: boolean}>}
 */
export async function sendPush(subscription, payload) {
  ensureConfigured();
  try {
    await webpush.sendNotification(subscription, JSON.stringify(payload));
    return { ok: true };
  } catch (err) {
    const statusCode = err.statusCode;
    // 410 Gone / 404 Not Found = subscription 만료. 즉시 삭제 대상.
    const expired = PERMANENT_GONE_STATUS.has(statusCode);
    // 401 / 403 = VAPID 키 mismatch or browser 권한 취소. 별도 분기 —
    // 즉시 삭제하면 VAPID 회전 misconfig 시 모든 subscription 손실 →
    // 호출자가 failedAttempts 카운터 누적 후 N회 도달 시 삭제.
    const authFailed = AUTH_FAILED_STATUS.has(statusCode);
    console.error('[push] send failed', statusCode, err.body);
    return { ok: false, statusCode, expired, authFailed };
  }
}

/**
 * 한 사용자의 모든 디바이스에 push 발송 (Firestore push_subscriptions 조회).
 *
 * PR #442 (Z-H15): 401/403 받은 subscription 은 `failedAttempts` 카운터 증가.
 * MAX_AUTH_FAILED_ATTEMPTS (5) 도달 시 삭제. 매 401/403 발생마다 throttled
 * operator alert (key='push-vapid-auth-failed', 1시간 dedup) — VAPID 회전
 * misconfig 시 한 시간 내 한 번만 알림 → 운영자가 키 점검 가능.
 *
 * @param {object} firestore — admin Firestore 인스턴스
 * @param {string} uid
 * @param {{title: string, body: string, url?: string, tag?: string}} payload
 */
export async function sendPushToUser(firestore, uid, payload) {
  const snap = await firestore.collection('push_subscriptions').where('uid', '==', uid).get();
  const results = [];
  const expiredDocs = [];      // 410/404 — 즉시 삭제
  const authFailedDocs = [];   // 401/403 — failedAttempts 카운터 누적, MAX 도달 시 삭제
  for (const docRef of snap.docs) {
    const data = docRef.data();
    const sub = { endpoint: data.endpoint, keys: data.keys || {} };
    const r = await sendPush(sub, payload);
    results.push(r);
    if (r.expired) {
      expiredDocs.push(docRef.ref);
    } else if (r.authFailed) {
      authFailedDocs.push({ ref: docRef.ref, currentAttempts: Number(data.failedAttempts || 0) });
    }
  }

  // 410/404 = 즉시 삭제
  for (const ref of expiredDocs) {
    try { await ref.delete(); } catch (_) { /* ignore */ }
  }

  // 401/403 = 카운터 누적 + 한계 도달 시 삭제 + operator alert (throttled)
  let authFailedDeleted = 0;
  for (const { ref, currentAttempts } of authFailedDocs) {
    const nextAttempts = currentAttempts + 1;
    if (nextAttempts >= MAX_AUTH_FAILED_ATTEMPTS) {
      try { await ref.delete(); authFailedDeleted++; } catch (_) { /* ignore */ }
    } else {
      try {
        const { FieldValue } = await import('firebase-admin/firestore');
        await ref.update({
          failedAttempts: nextAttempts,
          lastFailureAt: FieldValue.serverTimestamp(),
          lastFailureReason: 'vapid-auth-failed',
        });
      } catch (_) { /* ignore — counter is best-effort */ }
    }
  }

  // VAPID 회전 misconfig 감지 — 401/403 발생 시 throttled alert (1시간 1회).
  if (authFailedDocs.length > 0) {
    throttledTelegramAlert({
      key: 'push-vapid-auth-failed',
      channel: 'admin',
      severity: 'high',
      message: [
        '🚨 <b>Web Push 401/403 — VAPID rotate / 권한 취소 의심</b>',
        '',
        `<b>최근 호출:</b> uid=${String(uid).slice(0, 16)}, ${authFailedDocs.length}건 auth-failed`,
        `<b>자동 삭제:</b> ${authFailedDeleted}건 (${MAX_AUTH_FAILED_ATTEMPTS}회 누적)`,
        '',
        '→ VAPID 키 점검: VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY env 변경됐는지 확인',
        '→ Firestore push_subscriptions.failedAttempts 점검',
      ].join('\n'),
      context: { uid, authFailedCount: authFailedDocs.length, deleted: authFailedDeleted },
    }).catch(() => {});
  }

  return {
    sent: results.filter(r => r.ok).length,
    total: results.length,
    expired: expiredDocs.length,
    authFailed: authFailedDocs.length,
    authFailedDeleted,
  };
}

export default { sendPush, sendPushToUser };
