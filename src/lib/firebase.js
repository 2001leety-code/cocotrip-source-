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
import { needsAiCouponReview } from './aiCouponPresentation';

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

/**
 * Read one explicitly requested code from this user's collection. Never substitutes a different coupon.
 * UI eligibility is not server authorization; retained binding/root integrity is checked by the server.
 * @param {string} uid
 * @param {string} code
 * @param {number} durationDays
 * @returns {Promise<import('./aiCouponPresentation').RequestedAiCouponResult>}
 */
export async function getRequestedAiCoupon(uid, code, durationDays = 3) {
  if (!uid || typeof code !== 'string' || !code.trim() || !Number.isInteger(durationDays) || durationDays < 1) {
    return { state: 'unavailable' };
  }
  try {
    const snap = await getDocs(query(collection(db, 'users', uid, 'coupons'), where('code', '==', code)));
    // Duplicate or missing codes are ambiguous, not permission to pick the first record.
    if (snap.docs.length !== 1) return { state: 'unavailable' };
    const record = snap.docs[0];
    const c = record.data();
    if (!c || c.code !== code || c.productScope !== 'ai-plan' || c.type !== 'free' || c.isUsed !== false
      || (c.isRevoked !== undefined && c.isRevoked !== false)) return { state: 'unavailable' };
    const maxDays = c.maxDays === undefined || c.maxDays === null ? 3 : c.maxDays;
    const expiresAt = c.expiresAt === undefined || c.expiresAt === null ? null : c.expiresAt;
    if (!Number.isInteger(maxDays) || maxDays < durationDays
      || (expiresAt !== null && (typeof expiresAt !== 'number' || !Number.isFinite(expiresAt) || expiresAt <= Date.now()))) {
      return { state: 'unavailable' };
    }
    if (needsAiCouponReview(c)) return { state: 'review' };
    if ((c.pendingCapture !== undefined && c.pendingCapture !== false)
      || (c.usedOrderID !== undefined && c.usedOrderID !== null && c.usedOrderID !== '')
      || (c.consumptionId !== undefined && c.consumptionId !== null)) return { state: 'unavailable' };
    const binding = c.aiPlanBinding;
    if (binding !== undefined && binding !== null) {
      // Only recognize the supported metadata shape, never infer that a plan exists or is recoverable.
      // Cryptographic identity, same-request and reciprocal persistence checks remain server-only.
      if (typeof binding !== 'object' || Array.isArray(binding) || binding.version !== 1
        || c.aiPlanBindingState !== 'restored' || binding.consumerUid !== uid || binding.couponDocId !== record.id
        || typeof binding.consumptionId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(binding.consumptionId)
        || typeof binding.planId !== 'string' || !/^aicp_[a-f0-9]{40}$/.test(binding.planId)
        || binding.requestFingerprintVersion !== 1 || typeof binding.requestFingerprintHash !== 'string'
        || !/^[a-f0-9]{64}$/.test(binding.requestFingerprintHash)
        || !(binding.planOwnerUid === null || (typeof binding.planOwnerUid === 'string' && binding.planOwnerUid.length > 0))
        || !(binding.verifiedHistoryUid === null || (typeof binding.verifiedHistoryUid === 'string' && binding.verifiedHistoryUid.length > 0))
        || typeof binding.forceGuestToken !== 'boolean') return { state: 'unavailable' };
    } else if (c.aiPlanBindingState !== undefined) return { state: 'unavailable' };
    return { state: 'available', coupon: { code, maxDays, expiresAt } };
  } catch {
    // A denied/offline read is distinct from no coupon; callers must not fall through to paid checkout.
    return { state: 'error' };
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
    const couponsIssued = !isNewUser && (snap.data() || {}).onboardingCouponsIssued === true;

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

    // 3. 가입 쿠폰: 신규는 기존과 동일(대기). 기존 회원인데 미발급이면 1회만, 로그인 흐름을 기다리게 하지 않는다.
    if (isNewUser) {
      await ensureOnboardingCoupons(user, { isNewUser: true });
    } else if (!couponsIssued) {
      void ensureOnboardingCoupons(user).catch(() => { /* 로그인 흐름 무영향 */ });
    }

    // 4. Guest → Login 동기화 (위시리스트 + 최근 본 상품)
    await syncGuestDataToFirestore(user.uid);

  } catch (e) {
    console.warn('[firebase] Firestore save failed:', e.message);
  }
}

// 기존 회원 자가 복구는 uid 당 세션 1회 (sessionStorage 가 막혀도 이 탭 안에서는 1회).
const ONBOARDING_RETRY_KEY_PREFIX = 'COCO_ONBOARDING_RETRY_TRIED:';
const onboardingRetryTried = new Set();

/** 구글 연결 직후 재발급을 막지 않도록 이 uid 의 세션 1회 표시를 지운다(연결 전엔 email 없어 403 이었을 수 있음). */
export function clearOnboardingRetryMark(uid) {
  if (!uid) return;
  onboardingRetryTried.delete(uid);
  try { sessionStorage.removeItem(ONBOARDING_RETRY_KEY_PREFIX + uid); } catch { /* silent */ }
}

/**
 * 가입 쿠폰 발급 요청 (서버 /api/onboarding-coupons — 트랜잭션 멱등 + 프로모 창 게이트).
 * - isNewUser: GA sign_up + 최대 2회(1초 대기, 두 번째는 토큰 강제 갱신) + 유입 스냅샷 동봉 — 종전과 동일.
 * - 기존 회원(users/{uid}.onboardingCouponsIssued !== true): 세션당 1회, 재시도·대기·GA sign_up 없음.
 *   첫 로그인 때 403·프로모 닫힘·네트워크로 실패한 회원이 다시 받을 길이 없던 문제(운영 10명 중 3명) 복구.
 * 익명 사용자는 호출하지 않는다. 예외를 던지지 않는다.
 * 클라이언트 직접 addDoc은 Firestore rules `users/{uid}/coupons write:false` 로 거부되므로 절대 사용 금지.
 */
export async function ensureOnboardingCoupons(user, { isNewUser = false } = {}) {
  if (!user || !user.uid || user.isAnonymous) return;
  // 신규 가입도 표시를 남겨, 같은 세션에서 회원 문서 구독(useLoyalty)이 또 부르지 않게 한다.
  const key = ONBOARDING_RETRY_KEY_PREFIX + user.uid;
  if (!isNewUser && onboardingRetryTried.has(user.uid)) return;
  onboardingRetryTried.add(user.uid);
  try {
    if (!isNewUser && sessionStorage.getItem(key)) return;
    sessionStorage.setItem(key, '1');
  } catch { /* 시크릿 모드 등 — 위 Set 으로 탭 안 1회 */ }
    if (isNewUser) {
      // GA4 sign_up — 신규 가입을 Google Ads 신규고객 전환으로 카운트(Smart Bidding 최적화).
      //   provider 도출(google.com→google). analytics 실패가 가입/쿠폰 흐름 막지 않게 try/catch.
      //   기존 회원 복구에서는 쏘지 않는다(가입 전환 중복 집계 금지).
      try {
        const provider = (user.providerData && user.providerData[0] && user.providerData[0].providerId) || 'unknown';
        const { trackSignUp } = await import('./analytics');
        trackSignUp(provider.replace('.com', ''));
      } catch { /* analytics 실패 무시 */ }
    }
    const MAX_ATTEMPTS = isNewUser ? 2 : 1;
    let lastErr = null;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        try {
          const idToken = await user.getIdToken(/* forceRefresh */ attempt > 1);
          // P1 (2026-07-11): 가입 유입 스냅샷(first/last UTM, PII 없음) 동봉 — 서버가
          // users/{uid}.attribution 에 최초 1회 저장. 실패해도 발급/가입 무영향.
          // 기존 회원 복구는 지금 세션의 유입을 "가입 유입"으로 남기지 않도록 보내지 않는다.
          let attributionBody = {};
          if (isNewUser) {
            try {
              const { getAttributionSnapshot } = await import('./analytics');
              const a = getAttributionSnapshot();
              if (a) attributionBody = { attribution: a };
            } catch { /* 추적 실패 무시 */ }
          }
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
