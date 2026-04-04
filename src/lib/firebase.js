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
export const googleProvider = new GoogleAuthProvider();
export const appleProvider = new OAuthProvider('apple.com');

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

    // 3. 신규 유저 → WELCOME5 쿠폰 (5% 가입 할인) 자동 발급
    if (isNewUser) {
      const { collection: firestoreCollection, addDoc } = await import('firebase/firestore');
      const couponRef = firestoreCollection(db, 'users', user.uid, 'coupons');
      await addDoc(couponRef, {
        code: 'WELCOME5',
        type: 'percent',
        value: 5,
        currency: 'USD',
        label: 'Welcome 5% OFF (Sign-up Bonus)',
        minOrderUSD: 0,
        isUsed: false,
        expiresAt: Date.now() + 90 * 24 * 60 * 60 * 1000, // 90일 유효
        createdAt: Date.now(),
      });
      console.log('[firebase] 웰컴 쿠폰 WELCOME5 발급:', user.uid);
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
