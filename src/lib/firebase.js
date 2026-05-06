import { initializeApp, getApps } from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  OAuthProvider,
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
} from 'firebase/auth';
import {
  getFirestore,
  serverTimestamp,
  doc,
  setDoc,
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

// LINE Login (OIDC). 외국인 VIP 타겟 — 일본·대만·태국·인도네시아 사용자 대상.
// Firebase Console: Authentication → Sign-in method → Add new provider →
// OpenID Connect → Provider ID 는 반드시 `oidc.line` (소문자, prefix 'oidc.' 강제)
// → Client ID = LINE Channel ID, Client Secret = LINE Channel Secret
// → Issuer URL = https://access.line.me
// LINE Developers Console (https://developers.line.biz):
// Provider 생성 → "LINE Login" channel 발급 → Callback URL 에
// `https://<firebase-auth-domain>/__/auth/handler` 추가.
// scopes: openid email profile (LINE 정책상 email scope 는 채널 검토 후 활성)
export const lineProvider = new OAuthProvider('oidc.line');
lineProvider.addScope('openid');
lineProvider.addScope('email');
lineProvider.addScope('profile');

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
    if (isNewUser) {
      try {
        const idToken = await user.getIdToken();
        const resp = await fetch('/api/onboarding-coupons', {
          method: 'POST',
          headers: { Authorization: `Bearer ${idToken}` },
        });
        const json = await resp.json().catch(() => ({}));
        if (json?.ok && json.issued > 0) {
          // MyPage / Header 가 sessionStorage 를 감지해 환영 토스트 노출
          try {
            sessionStorage.setItem('COCO_ONBOARDING_COUPONS_JUST_ISSUED', String(json.issued));
          } catch { /* SSR / 시크릿 모드 등 silent */ }
        }
        console.log('[firebase] onboarding coupons response:', json);
      } catch (couponErr) {
        console.warn('[firebase] onboarding coupon request failed:', couponErr?.message);
        // 쿠폰 발급 실패해도 sign-in 은 계속 진행 — 사용자가 첫 결제에서만 영향.
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

// LINE 로그인: Popup 방식 (Firebase OIDC custom provider).
// Firebase Console 에 Provider ID `oidc.line` 등록되지 않았으면
// `auth/operation-not-allowed` 발생 — UI 에서 graceful 메시지로 안내.
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
