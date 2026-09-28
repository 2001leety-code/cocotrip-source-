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
import { getAuth, signInAnonymously } from 'firebase/auth';
import { app, getGuestApp } from './firebase-app.js';

export {
  auth,
  googleProvider,
  appleProvider,
  lineProvider,
  signInWithGoogle,
  signInWithApple,
  signInWithLine,
  setUpRecaptchaVerifier,
  signInWithPhone,
  verifyPhoneCode,
  handleRedirectResult,
  signOutUser,
} from './firebase-auth.js';

export const db = getFirestore(app);
export const storage = getStorage(app);

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

// 공통 Firestore 저장 함수 — 신규 가입 시 등급 초기화 + 웰컴 쿠폰 + Guest 데이터 동기화
export async function saveUserToFirestore(user) {
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
  } catch (e) {
    console.warn('[firebase] Guest sync failed:', e.message);
  }
}

// 게스트 전용 격리 Firebase 앱 — 메인 auth/useAuth 에 영향 0 (플랜 소유자 익명 read 전용).
let _guestAuth = null, _guestDb = null, _guestAnonPromise = null;
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
