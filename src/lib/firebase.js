import { initializeApp, getApps } from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  OAuthProvider,
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  signInWithPhoneNumber,
  signInAnonymously,
  RecaptchaVerifier,
} from 'firebase/auth';
import {
  getFirestore,
  serverTimestamp,
  doc,
  setDoc,
  collection,
  query,
  where,
  getDocs,
} from 'firebase/firestore';
import { getStorage } from 'firebase/storage';

const firebaseConfig = {
  apiKey: (import.meta.env.VITE_FIREBASE_API_KEY ?? '').trim(),
  // .trim() : Vercel 환경변수에 \r\n 이 붙어 %0D%0A iFrame 오류 방지
  authDomain: (import.meta.env.VITE_FIREBASE_AUTH_DOMAIN ?? '').trim(),
  projectId: (import.meta.env.VITE_FIREBASE_PROJECT_ID ?? '').trim(),
  storageBucket: (import.meta.env.VITE_FIREBASE_STORAGE_BUCKET ?? '').trim(),
  messagingSenderId: (import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID ?? '').trim(),
  appId: (import.meta.env.VITE_FIREBASE_APP_ID ?? '').trim(),
};

// Avoid duplicate app initialization during HMR / re-import.
const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);


export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);
export const googleProvider = new GoogleAuthProvider();
export const appleProvider = new OAuthProvider('apple.com');

/**
 * P1-②(여름 이벤트): 로그인 사용자의 AI 플랜 무료 쿠폰(미사용·미만료·일수 가능) 1장 조회.
 * 없으면 null. PurchaseSection 의 "무료 쿠폰 사용" 버튼 노출 + 0원 결제 판단용.
 * @param {string} uid
 * @param {number} durationDays - 플랜 일수 (쿠폰 maxDays 이하여야 사용 가능, 1~3일)
 * @returns {Promise<{code:string, maxDays:number}|null>}
 */
export async function getAvailableAiCoupon(uid, durationDays = 3) {
  if (!uid) return null;
  try {
    const q = query(
      collection(db, 'users', uid, 'coupons'),
      where('productScope', '==', 'ai-plan'),
      where('isUsed', '==', false),
    );
    const snap = await getDocs(q);
    const now = Date.now();
    for (const d of snap.docs) {
      const c = d.data();
      if (c.expiresAt && c.expiresAt < now) continue;       // 만료 제외
      if ((c.maxDays || 3) < durationDays) continue;        // 일수 초과 제외 (4일+ plan)
      return { code: c.code, maxDays: c.maxDays || 3 };
    }
    return null;
  } catch (e) {
    console.warn('[getAvailableAiCoupon] failed:', e && e.message);
    return null;
  }
}

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

// 공통 Firestore 저장 함수 — 신규 가입 시 등급 초기화 + 웰컴 쿠폰 + Guest 데이터 동기화
async function saveUserToFirestore(user) {
  if (!user?.uid) return;
  try {
    const userRef = doc(db, 'users', user.uid);

    // 1. 기존 유저인지 확인
    const { getDoc: firestoreGetDoc } = await import('firebase/firestore');
    const snap = await firestoreGetDoc(userRef);
    const isNewUser = !snap.exists();

    // 2. 유저 프로필 저장/업데이트
    await setDoc(
      userRef,
      {
        uid: user.uid,
        email: user.email ?? null,
        name: user.displayName ?? null,
        photoURL: user.photoURL ?? null,
        role: 'user',
        ...(isNewUser ? {
          tier: 'Bronze',
          tripCoins: 0,
          totalSpentUSD: 0,
          bookingCount: 0,
          createdAt: serverTimestamp(),
        } : {
          lastLoginAt: serverTimestamp(),
        }),
      },
      { merge: true }
    );

    // 3. 신규 유저 → 서버 endpoint 호출해 쿠폰 2장 발급 (Charter + Tour, 각 5%)
    //    멱등성은 서버에서 onboardingCouponsIssued flag 로 보장.
    //    클라이언트 직접 addDoc은 Firestore rules `users/{uid}/coupons write:false`
    //    로 거부되므로 절대 사용 금지.
    //    재시도: 최대 2회 (초기 1회 + 1회 retry, 1초 대기) — 네트워크 일시 장애 대비.
    if (isNewUser) {
      // GA4 sign_up — 신규 가입을 Google Ads 신규고객 전환으로 카운트(Smart Bidding 최적화).
      //   provider 도출(google.com→google). analytics 실패가 가입/쿠폰 흐름 막지 않게 try/catch.
      try {
        const provider = (user.providerData && user.providerData[0] && user.providerData[0].providerId) || 'unknown';
        const { trackSignUp } = await import('./analytics');
        trackSignUp(provider.replace('.com', ''));
      } catch { /* analytics 실패 무시 */ }
      const MAX_ATTEMPTS = 2;
      let lastErr = null;
      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        try {
          const idToken = await user.getIdToken(/* forceRefresh */ attempt > 1);
          // P1 (2026-07-11): 가입 유입 스냅샷(first/last UTM, PII 없음) 동봉 — 서버가
          // users/{uid}.attribution 에 최초 1회 저장. 실패해도 발급/가입 무영향.
          let attributionBody = {};
          try {
            const { getAttributionSnapshot } = await import('./analytics');
            const a = getAttributionSnapshot();
            if (a) attributionBody = { attribution: a };
          } catch { /* 추적 실패 무시 */ }
          const resp = await fetch('/api/onboarding-coupons', {
            method: 'POST',
            headers: { Authorization: `Bearer ${idToken}`, 'Content-Type': 'application/json' },
            body: JSON.stringify(attributionBody),
          });
          const json = await resp.json().catch(() => ({}));
          console.log(`[firebase] onboarding coupons attempt ${attempt}:`, json);

          if (json?.ok) {
            if (json.issued > 0) {
              // OnboardingCouponModal (App.tsx) 이 sessionStorage 를 감지해 모달 노출
              try {
                sessionStorage.setItem('COCO_ONBOARDING_COUPONS_JUST_ISSUED', String(json.issued));
              } catch { /* SSR / 시크릿 모드 등 silent */ }
              // P1: 발급 성공 이벤트 (GA4 퍼널 — 가입혜택 단계). 실패 무해.
              try {
                const { trackWelcomeCouponIssued } = await import('./analytics');
                trackWelcomeCouponIssued(json.issued);
              } catch { /* analytics 실패 무시 */ }
            }
            // ok=true 면 alreadyIssued 포함 모든 성공 케이스 → loop 종료
            lastErr = null;
            break;
          } else {
            lastErr = new Error(json?.error ?? `HTTP ${resp.status}`);
            if (attempt < MAX_ATTEMPTS) {
              await new Promise((r) => setTimeout(r, 1000));
            }
          }
        } catch (couponErr) {
          lastErr = couponErr;
          console.warn(`[firebase] onboarding coupon attempt ${attempt} failed:`, couponErr?.message);
          if (attempt < MAX_ATTEMPTS) {
            await new Promise((r) => setTimeout(r, 1000));
          }
        }
      }
      if (lastErr) {
        // 최종 실패 — sign-in 은 계속 진행하되 Sentry 에 수동 기록 가능
        console.error('[firebase] onboarding coupons FAILED after retries:', lastErr?.message);
        // 운영자 보정: api/admin-issue-onboarding-coupons 참고
      }
    }

    // 4. Guest → Login 동기화 (위시리스트 + 최근 본 상품)
    await syncGuestDataToFirestore(user.uid);

  } catch (e) {
    console.warn('[firebase] Firestore save failed:', e.message);
  }
}

// Guest localStorage → Firestore 동기화
async function syncGuestDataToFirestore(uid) {
  try {
    // 위시리스트 동기화
    const wishlistRaw = localStorage.getItem('COCO_WISHLIST');
    if (wishlistRaw) {
      let items = [];
      try { items = JSON.parse(wishlistRaw); } catch { items = []; }
      for (const item of items) {
        if (!item?.id) continue;
        await setDoc(
          doc(db, 'users', uid, 'wishlist', item.id),
          { ...item, serverAddedAt: serverTimestamp() },
          { merge: true }
        );
      }
      localStorage.removeItem('COCO_WISHLIST');
      console.log(`[firebase] 위시리스트 ${items.length}건 동기화 완료`);
    }

    // 최근 본 상품 동기화
    const recentRaw = localStorage.getItem('COCO_RECENTLY_VIEWED');
    if (recentRaw) {
      let items = [];
      try { items = JSON.parse(recentRaw); } catch { items = []; }
      for (const item of items) {
        if (!item?.id) continue;
        await setDoc(
          doc(db, 'users', uid, 'recentlyViewed', item.id),
          { ...item, serverViewedAt: serverTimestamp() },
          { merge: true }
        );
      }
      localStorage.removeItem('COCO_RECENTLY_VIEWED');
      console.log(`[firebase] 최근 본 ${items.length}건 동기화 완료`);
    }
  } catch (e) {
    console.warn('[firebase] Guest sync failed:', e.message);
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
    await saveUserToFirestore(result.user);
    return result.user;
  } catch (err) {
    const code = err?.code ?? '';
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
    await saveUserToFirestore(result.user);
    return result.user;
  } catch (err) {
    const code = err?.code ?? '';
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
    await saveUserToFirestore(result.user);
    return result.user;
  } catch (err) {
    const code = err?.code ?? '';
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
 * @param {string} code - 6자리 SMS 코드
 */
export async function verifyPhoneCode(confirmationResult, code) {
  try {
    const result = await confirmationResult.confirm(code);
    await saveUserToFirestore(result.user);
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
      await saveUserToFirestore(result.user);
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

// 게스트 전용 격리 Firebase 앱 — 메인 auth/useAuth 에 영향 0 (플랜 소유자 익명 read 전용).
let _guestApp = null, _guestAuth = null, _guestDb = null, _guestAnonPromise = null;
function getGuestApp() {
  if (_guestApp) return _guestApp;
  _guestApp = getApps().find((a) => a.name === 'guestReader') || initializeApp(firebaseConfig, 'guestReader');
  return _guestApp;
}
export function getGuestDb() {
  if (!_guestDb) _guestDb = getFirestore(getGuestApp());
  return _guestDb;
}
export function getGuestAuth() {
  if (!_guestAuth) _guestAuth = getAuth(getGuestApp());
  return _guestAuth;
}
/** 게스트 익명 로그인 보장(멱등). 성공 시 익명 user, 실패 시 null (graceful — 호출자가 폴백). */
export async function ensureGuestAnon() {
  const gAuth = getGuestAuth();
  if (gAuth.currentUser) return gAuth.currentUser;
  if (!_guestAnonPromise) {
    _guestAnonPromise = signInAnonymously(gAuth)
      .then((cred) => cred.user)
      .catch((e) => { console.warn('[guestAnon] sign-in failed:', e && e.message); _guestAnonPromise = null; return null; });
  }
  return _guestAnonPromise;
}
