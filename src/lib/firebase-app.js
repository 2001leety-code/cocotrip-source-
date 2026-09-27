import { initializeApp, getApps } from 'firebase/app';

export const firebaseConfig = {
  apiKey: (import.meta.env.VITE_FIREBASE_API_KEY || '').trim(),
  // .trim() : Vercel 환경변수에 \r\n 이 붙어 %0D%0A iFrame 오류 방지
  authDomain: (import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || '').trim(),
  projectId: (import.meta.env.VITE_FIREBASE_PROJECT_ID || '').trim(),
  storageBucket: (import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || '').trim(),
  messagingSenderId: (import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || '').trim(),
  appId: (import.meta.env.VITE_FIREBASE_APP_ID || '').trim(),
};

// Avoid duplicate app initialization during HMR / re-import.
export const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);

let guestApp = null;
export function getGuestApp() {
  if (guestApp) return guestApp;
  guestApp = getApps().find((existingApp) => existingApp.name === 'guestReader') || initializeApp(firebaseConfig, 'guestReader');
  return guestApp;
}
