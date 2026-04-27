// Web Push 발송 헬퍼.
// VAPID 키는 Vercel 환경변수에서 주입 (VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY).
// 프론트의 push_subscriptions Firestore collection에 저장된 endpoint들로 발송.
import webpush from 'web-push';

const VAPID_PUBLIC = process.env.VAPID_PUBLIC_KEY;
const VAPID_PRIVATE = process.env.VAPID_PRIVATE_KEY;
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || 'mailto:help@cocotripkr.com';

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
 * @returns {Promise<{ok: boolean, statusCode?: number, expired?: boolean}>}
 */
export async function sendPush(subscription, payload) {
  ensureConfigured();
  try {
    await webpush.sendNotification(subscription, JSON.stringify(payload));
    return { ok: true };
  } catch (err) {
    // 410 Gone / 404 Not Found = subscription 만료. 호출자가 Firestore에서 삭제해야 함.
    const expired = err.statusCode === 410 || err.statusCode === 404;
    console.error('[push] send failed', err.statusCode, err.body);
    return { ok: false, statusCode: err.statusCode, expired };
  }
}

/**
 * 한 사용자의 모든 디바이스에 push 발송 (Firestore push_subscriptions 조회).
 * @param {string} uid
 * @param {{title: string, body: string, url?: string, tag?: string}} payload
 * @param {object} firestore — admin Firestore 인스턴스
 */
export async function sendPushToUser(firestore, uid, payload) {
  const snap = await firestore.collection('push_subscriptions').where('uid', '==', uid).get();
  const results = [];
  const expiredDocs = [];
  for (const docRef of snap.docs) {
    const data = docRef.data();
    const sub = { endpoint: data.endpoint, keys: data.keys || {} };
    const r = await sendPush(sub, payload);
    results.push(r);
    if (r.expired) expiredDocs.push(docRef.ref);
  }
  // 만료된 subscription은 정리
  for (const ref of expiredDocs) {
    try { await ref.delete(); } catch (_) { /* ignore */ }
  }
  return { sent: results.filter(r => r.ok).length, total: results.length, expired: expiredDocs.length };
}

export default { sendPush, sendPushToUser };
