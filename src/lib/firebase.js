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
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  // Firebase Hosting 도메인 필수 - 이 도메인에서 /__/auth/ 경로가 서빙됨
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN, // planning-with-ai-a0801.firebaseapp.com
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
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

// 공통 Firestore 저장 함수
async function saveUserToFirestore(user) {
  if (!user?.uid) return;
  try {
    await setDoc(
      doc(db, 'users', user.uid),
      {
        uid: user.uid,
        email: user.email ?? null,
        name: user.displayName ?? null,
        role: 'user',
        createdAt: serverTimestamp(),
      },
      { merge: true }
    );
  } catch (e) {
    // Firestore 저장 실패해도 로그인 자체는 유지
    console.warn('[firebase] Firestore save failed:', e.message);
  }
}

// Google 로그인: Redirect 방식 (팝업 차단/검은화면 문제 방지)
export async function signInWithGoogle() {
  try {
    await signInWithRedirect(auth, googleProvider);
    return null; // redirect 중 — 페이지 복귀 후 handleRedirectResult()가 처리
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Google sign-in failed.';
    throw new Error(message);
  }
}

// Apple 로그인: Redirect 방식
export async function signInWithApple() {
  try {
    await signInWithRedirect(auth, appleProvider);
    return null;
  } catch (err) {
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
