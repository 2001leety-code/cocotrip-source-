/**
 * 이메일 없는 회원(전화 가입·이메일 없는 LINE) 판정 + 구글 계정 연결 안내 호출.
 * 서버 쿠폰·예약 검증은 토큰 email 을 요구하므로, 이런 회원이 쿠폰을 쓰려 하면
 * API 를 부르지 않고 ConnectEmailPrompt(App 수준 1회 마운트)를 띄운다.
 */
export const CONNECT_EMAIL_EVENT = 'coco:connect-email-request';
/** 같은 User 객체의 프로필(email 등)이 바뀌었음 — useAuth 가 듣고 다시 그린다(onAuthStateChanged 는 안 울림). */
export const AUTH_PROFILE_EVENT = 'coco:auth-profile-updated';

interface MaybeUser { isAnonymous?: boolean; email?: string | null }

/** 로그인한 비익명 회원인데 email 이 비어 있으면 true. 익명·비로그인·이메일 보유 = false. */
export function needsEmailConnection(user: MaybeUser | null | undefined): boolean {
  if (!user || user.isAnonymous) return false;
  return !(typeof user.email === 'string' && user.email.trim() !== '');
}

/** 안내 배너를 (닫았더라도) 다시 띄운다. */
export function requestEmailConnection(): void {
  try { window.dispatchEvent(new CustomEvent(CONNECT_EMAIL_EVENT)); } catch { /* SSR */ }
}

/** 쿠폰 사용 직전 가드: 대상 회원이면 안내를 띄우고 true(= 호출 중단). */
export function blockCouponForMissingEmail(user: MaybeUser | null | undefined): boolean {
  if (!needsEmailConnection(user)) return false;
  requestEmailConnection();
  return true;
}
