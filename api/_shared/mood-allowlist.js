/**
 * MOOD 포털 — allowlist 게이트 헬퍼
 *
 * Firestore `mood_config/allowlist` 문서:
 *   {
 *     emails:  string[]   // 운영자 + 광고사 직원 — 조회/예약 가능
 *     admins:  string[]   // 고정 운영자 1인의 활성화 스위치 — 충전(topup) 가능
 *     settlementApproverEmails: string[] // MOOD 금액 승인자 — 없으면 승인 불가(fail-closed)
 *     clientId: string    // v1 단일 client 가정 — 모든 예약/조회가 이 client 기준
 *   }
 *
 * 모든 이메일 비교는 lowercase trim 정규화 (verifyUserToken 이 이미 lowercase 로 반환하지만
 * config 측 데이터가 대문자일 수 있어 양쪽 정규화).
 *
 * 클라이언트 SDK 는 mood_config 직접 read 불가 (firestore.rules: allow read,write: if false).
 * → 이 헬퍼는 백엔드 (admin SDK) 에서만 호출.
 */

const ALLOWLIST_PATH = ['mood_config', 'allowlist'];

// MOOD 관리자 권한은 이 단일 계정에만 귀속된다. Firestore admins 배열은
// 긴급 차단 스위치 역할도 하므로, 이 이메일이 배열에서 빠지면 권한을 주지 않는다.
export const PRIMARY_MOOD_ADMIN_EMAIL = '2001leety@gmail.com';

function normEmail(e) {
  return String(e || '').toLowerCase().trim();
}

/**
 * mood_config/allowlist 문서를 읽어 정규화된 형태로 반환.
 * @param {FirebaseFirestore.Firestore} db - admin SDK Firestore
 * @returns {Promise<{ emails: string[], admins: string[], settlementApproverEmails: string[], clientId: string | null }>}
 */
export async function getMoodAllowlist(db) {
  const snap = await db.collection(ALLOWLIST_PATH[0]).doc(ALLOWLIST_PATH[1]).get();
  if (!snap.exists) {
    return { emails: [], admins: [], settlementApproverEmails: [], clientId: null };
  }
  const data = snap.data() || {};
  const emails = Array.isArray(data.emails) ? data.emails.map(normEmail).filter(Boolean) : [];
  const admins = Array.isArray(data.admins) ? data.admins.map(normEmail).filter(Boolean) : [];
  const settlementApproverEmails = Array.isArray(data.settlementApproverEmails)
    ? data.settlementApproverEmails.map(normEmail).filter(Boolean)
    : [];
  const clientId = typeof data.clientId === 'string' && data.clientId.trim() ? data.clientId.trim() : null;
  return { emails, admins, settlementApproverEmails, clientId };
}

/**
 * 인증된 email 이 포털 접근 (조회/예약) 권한이 있는지.
 * @returns {boolean}
 */
export function isAllowedEmail(allowlist, email) {
  return allowlist.emails.includes(normEmail(email));
}

/**
 * 인증된 email 이 충전(topup) 권한이 있는지 (운영자만).
 * @returns {boolean}
 */
export function isAdminEmail(allowlist, email) {
  const admins = Array.isArray(allowlist && allowlist.admins)
    ? allowlist.admins.map(normEmail).filter(Boolean)
    : [];
  return normEmail(email) === PRIMARY_MOOD_ADMIN_EMAIL
    && admins.includes(PRIMARY_MOOD_ADMIN_EMAIL);
}

/**
 * 인증된 email 이 MOOD 최종 정산 금액을 승인할 수 있는지.
 * 목록이 없거나 잘못된 경우 빈 배열로 정규화되므로 반드시 false(fail-closed)다.
 * 고정 관리자는 admins 설정이 빠져도 이 목록을 통해 확인자로 우회할 수 없다.
 */
export function isSettlementApproverEmail(allowlist, email) {
  const approvers = Array.isArray(allowlist && allowlist.settlementApproverEmails)
    ? allowlist.settlementApproverEmails.map(normEmail).filter(Boolean)
    : [];
  const normalizedEmail = normEmail(email);
  return normalizedEmail !== PRIMARY_MOOD_ADMIN_EMAIL
    && approvers.includes(normalizedEmail);
}
