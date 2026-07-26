// useUserProfile — 로그인 유저의 Firestore 프로필(users/{uid}) 1회 fetch. 예약 폼 prefill 용.
//
// 2026-06-11. getDoc 1회(onSnapshot 구독 아님 — 폼 기본값엔 일회성이 적합, useLoyalty 의 실시간 구독은 과함).
// useAuth 는 Firebase Auth 만(Firestore 필드 없음)이라 재사용 불가 → 신규 훅. AuthRequired L116-130 getDoc 패턴 복제.
// 🔴 graceful: 로그아웃/에러/빈 프로필 = profile:null (throw 금지 — 폼은 항상 동작). uid별 모듈 캐시로 중복 read 차단.
// invalidate export — 프로필을 갱신한 폼이 저장 직후 호출해 캐시를 무효화한다.
// 2026-07-26: needsOnboarding 캐시 분기 제거. PR#996 이 온보딩 페이지를 폐기한 뒤 그 필드를 쓰는 코드가 0이 됐다.
import { useState, useEffect } from 'react';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuth } from '@/hooks/useAuth';

export interface PrefillProfile {
  name?: string;      // Auth displayName (소셜 로그인) — 차터 customerName 1순위
  nickname?: string;  // 온보딩 필수 — name 없을 때 2순위
  phone?: string;     // 온보딩 선택
  countryCode?: string; // 온보딩 선택 (phone 보정용)
  email?: string;
}

const cache = new Map<string, PrefillProfile>();

/** 온보딩 저장 성공 시 호출 — stale 프로필 캐시 제거 (다음 폼 마운트가 새로 fetch). */
export function invalidateProfileCache(uid: string): void {
  cache.delete(uid);
}

export function useUserProfile(): { profile: PrefillProfile | null; loading: boolean } {
  const { user, loading: authLoading } = useAuth();
  const uid = user?.uid || null;
  const [profile, setProfile] = useState<PrefillProfile | null>(uid ? (cache.get(uid) || null) : null);
  // 로그인 유저인데 캐시 미스 OR auth 초기화 중이면 loading (비로그인 오판 방지).
  const [loading, setLoading] = useState<boolean>(authLoading || (!!uid && !cache.has(uid)));

  useEffect(() => {
    if (authLoading) { setLoading(true); return; }       // auth 초기화 중 — 판단 보류
    if (!uid) { setProfile(null); setLoading(false); return; } // 로그아웃 — 빈칸(현행)
    const cached = cache.get(uid);
    if (cached) { setProfile(cached); setLoading(false); return; }

    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const snap = await getDoc(doc(db, 'users', uid));
        if (cancelled) return;
        const data = snap.exists() ? (snap.data() as Record<string, unknown>) : null;
        const p: PrefillProfile = {
          name: (data?.name as string) || user?.displayName || undefined,
          nickname: (data?.nickname as string) || undefined,
          // phoneNumber = firestore.rules allowlist 에 있는 정식 키(useProfileContactSync 가 씀).
          // phone 은 폐기된 SignupOnboarding 시절 키 — 남아있는 문서를 위한 폴백.
          phone: (data?.phoneNumber as string) || (data?.phone as string) || undefined,
          countryCode: (data?.countryCode as string) || undefined,
          email: (data?.email as string) || user?.email || undefined,
        };
        cache.set(uid, p);
        setProfile(p);
      } catch (e) {
        if (!cancelled) setProfile(null); // graceful — 폼은 빈칸으로 정상 동작
        console.warn('[useUserProfile] fetch failed:', e);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [uid, authLoading, user?.displayName, user?.email]);

  return { profile, loading };
}
