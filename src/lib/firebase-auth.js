import { getAuth, GoogleAuthProvider, OAuthProvider, signInWithPopup, signInWithRedirect, getRedirectResult, signInWithPhoneNumber, RecaptchaVerifier } from 'firebase/auth';
import { app } from './firebase-app.js';

export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();
export const appleProvider = new OAuthProvider('apple.com');

// LINE OIDC provider (PR #396, 2026-05-13)
// 일본/대만/홍콩 사용자 LINE 로그인 지원. Firebase Identity Platform 업그레이드
// 필요 (50K MAU 무료, $0 비용). Firebase Console > Authentication > Sign-in
// method > Add new provider > OpenID Connect:
//   - Provider ID: oidc.line
//   - Client ID: <LINE Channel ID, 운영자 LINE Developers Console>
//   - Client Secret: <LINE Channel Secret, rotate 권장>
//   - Issuer URL: https://access.line.me
// LINE Developers Console > LINE Login > Callback URL:
//   - https://planning-with-ai-a0801.firebaseapp.com/__/auth/handler
export const lineProvider = new OAuthProvider('oidc.line');
lineProvider.addScope('openid');
lineProvider.addScope('profile');
lineProvider.addScope('email');

// UX: ensure Google account selection screen appears.
googleProvider.setCustomParameters({
  prompt: 'select_account',
});

// Request email and name from Apple.
appleProvider.addScope('email');
appleProvider.addScope('name');

async function saveUserAfterSignIn(user) {
  try {
    const { saveUserToFirestore } = await import('./firebase.js');
    await saveUserToFirestore(user);
  } catch (err) {
    console.warn('[firebase] Firestore save failed:', err.message);
  }
}

// Google 로그인: Popup 방식 → 실패 시 Redirect 폴백
const POPUP_FALLBACK_CODES = new Set([
  'auth/popup-blocked',
  'auth/popup-closed-by-user',
  'auth/cancelled-popup-request',
  'auth/operation-not-supported-in-this-environment', // 인앱브라우저
]);

export async function signInWithGoogle() {
  try {
    const result = await signInWithPopup(auth, googleProvider);
    await saveUserAfterSignIn(result.user);
    return result.user;
  } catch (err) {
    const errorCode = err?.code;
    const code = errorCode === null || errorCode === undefined ? '' : errorCode;
    // 팝업 불가 환경(인앱브라우저, 팝업 차단 등) → Redirect 폴백
    if (POPUP_FALLBACK_CODES.has(code)) {
      await signInWithRedirect(auth, googleProvider);
      return null; // redirect 후 페이지 이동 — handleRedirectResult()가 처리
    }
    const message = err instanceof Error ? err.message : 'Google sign-in failed.';
    throw new Error(message);
  }
}

// Apple 로그인: Popup 방식
export async function signInWithApple() {
  try {
    const result = await signInWithPopup(auth, appleProvider);
    await saveUserAfterSignIn(result.user);
    return result.user;
  } catch (err) {
    const errorCode = err?.code;
    const code = errorCode === null || errorCode === undefined ? '' : errorCode;
    if (code === 'auth/popup-blocked') {
      await signInWithRedirect(auth, appleProvider);
      return null;
    }
    const message = err instanceof Error ? err.message : 'Apple sign-in failed.';
    throw new Error(message);
  }
}

// LINE 로그인 (PR #396): Popup 방식 → 실패 시 Redirect 폴백.
// Identity Platform 업그레이드 + LINE OIDC provider 등록 후 작동.
// 미등록 상태 (현재 default) 에서 호출 시 auth/operation-not-allowed 에러 →
// AuthRequired 가 일반 에러 메시지 표시 (사용자 경험 정상).
export async function signInWithLine() {
  try {
    const result = await signInWithPopup(auth, lineProvider);
    await saveUserAfterSignIn(result.user);
    return result.user;
  } catch (err) {
    const errorCode = err?.code;
    const code = errorCode === null || errorCode === undefined ? '' : errorCode;
    if (POPUP_FALLBACK_CODES.has(code)) {
      await signInWithRedirect(auth, lineProvider);
      return null;
    }
    const message = err instanceof Error ? err.message : 'LINE sign-in failed.';
    throw new Error(message);
  }
}

// ── 전화번호 로그인 (PR #390, 2026-05-13) ──────────────────────────────
// Firebase Phone Auth — LINE OIDC 가 Identity Platform 업그레이드 필요해서 보류,
// Phone 만 기본 제공업체로 우선 활성. 일본/대만 LINE 사용자는 후속 PR.
//
// 흐름: setUpRecaptchaVerifier(containerId) → signInWithPhone(phone, verifier)
// → ConfirmationResult.confirm(code) 로 verify → saveUserToFirestore 자동 호출.
//
// reCAPTCHA: invisible 모드. 컴포넌트가 DOM 에 빈 div (id=containerId) 두면
// Firebase 가 그 안에 invisible widget 주입. modal close 시 verifier.clear() 호출.

/**
 * Invisible reCAPTCHA verifier 생성.
 * @param {string} containerId - 빈 div 의 DOM id (예: 'phone-recaptcha-container')
 * @returns {RecaptchaVerifier}
 */
export function setUpRecaptchaVerifier(containerId) {
  return new RecaptchaVerifier(auth, containerId, {
    size: 'invisible',
    // expired-callback 은 verifier 만료 시 재초기화 트리거. 사용자는 다음 클릭에서
    // 새 verifier 받게 됨 (modal 의 useEffect 가 처리).
  });
}

/**
 * Phone 으로 SMS 코드 전송 요청.
 * @param {string} phoneNumber - E.164 포맷 (예: '+821012345678')
 * @param {RecaptchaVerifier} appVerifier - setUpRecaptchaVerifier 결과
 * @returns {Promise<import('firebase/auth').ConfirmationResult>}
 */
export async function signInWithPhone(phoneNumber, appVerifier) {
  try {
    return await signInWithPhoneNumber(auth, phoneNumber, appVerifier);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Phone sign-in failed.';
    throw new Error(message);
  }
}

/**
 * SMS 코드 검증 + Firestore user 저장.
 * @param {import('firebase/auth').ConfirmationResult} confirmationResult
 * @param {string} code - 6자리 코드
 */
export async function verifyPhoneCode(confirmationResult, code) {
  try {
    const result = await confirmationResult.confirm(code);
    await saveUserAfterSignIn(result.user);
    return result.user;
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Code verification failed.';
    throw new Error(message);
  }
}

// 페이지 로드 시 Redirect 결과 처리 (App.tsx 등에서 호출)
export async function handleRedirectResult() {
  try {
    const result = await getRedirectResult(auth);
    if (result?.user) {
      await saveUserAfterSignIn(result.user);
      return result.user;
    }
    return null;
  } catch (err) {
    console.error('[firebase] Redirect result error:', err);
    return null;
  }
}

export async function signOutUser() {
  await auth.signOut();
}
