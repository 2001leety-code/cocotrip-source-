import { initializeApp, getApps } from 'firebase/app';
import { getAuth, GoogleAuthProvider, OAuthProvider, signInWithPopup } from 'firebase/auth';
import {
  getFirestore,
  serverTimestamp,
  doc,
  setDoc,
} from 'firebase/firestore';

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
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

// Google 로그인 성공 시 Firestore `users/{uid}`에 자동 저장.
export async function signInWithGoogle() {
  try {
    const result = await signInWithPopup(auth, googleProvider);
    const user = result.user;

    if (!user?.uid) {
      throw new Error('Google sign-in did not return a user uid.');
    }

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

    return user;
  } catch (err) {
    const message =
      err instanceof Error ? err.message : 'Google sign-in failed.';
    throw new Error(message);
  }
}

// Apple 로그인 성공 시 Firestore `users/{uid}`에 자동 저장.
export async function signInWithApple() {
  try {
    const result = await signInWithPopup(auth, appleProvider);
    const user = result.user;

    if (!user?.uid) {
      throw new Error('Apple sign-in did not return a user uid.');
    }

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

    return user;
  } catch (err) {
    const message =
      err instanceof Error ? err.message : 'Apple sign-in failed.';
    throw new Error(message);
  }
}

export async function signOutUser() {
  await auth.signOut();
}

