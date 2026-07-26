// useProfileContactSync — 예약 폼이 받은 연락처를 users/{uid}.phoneNumber 에 저장한다.
//
// 배경(2026-07-26 미사용 감사): useUserProfile 은 예약 폼 prefill 용으로 phone 을 읽는데,
// 그 필드를 **쓰는 코드가 레포에 하나도 없었다**. 유일한 작성자였던 SignupOnboarding 은
// PR#996 에서 폐기됐고(게다가 firestore.rules allowlist 밖이라 애초에 저장 불가였다).
// 결과: 재방문 고객이 예약할 때마다 전화번호를 처음부터 다시 입력했다.
//
// 설계 결정:
//  - 저장 필드는 `phoneNumber` — firestore.rules users/{uid} update allowlist 에 **이미 있는**
//    키다. 새 키(`phone`)를 열면 룰 배포가 선행돼야 하고, 그 배포를 잊으면 조용히 실패한다.
//    읽는 쪽(useUserProfile)이 phoneNumber 우선 + phone 폴백으로 흡수한다.
//  - 결제 콜백이 아니라 **폼 입력 시점**에 저장한다. PayPalBookingButton 의 결제 블록은
//    수정 금지 영역이고, prefill 은 결제 성사 여부와 무관한 편의 기능이다.
//  - 🔴 graceful: 실패해도 절대 throw 하지 않는다. 예약 폼은 항상 정상 동작해야 한다.
import { useEffect, useRef } from 'react';
import { doc, setDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuth } from '@/hooks/useAuth';
import { invalidateProfileCache } from '@/hooks/useUserProfile';
// 저장 판단은 firebase-free 모듈에 둔다 — 이 훅은 lib/firebase 를 끌어와서
// CI(FIREBASE_* env 없음)에서 import 하는 순간 테스트가 수집 단계에서 죽는다.
import { nextPhoneToPersist } from '@/lib/profilePrefill';

/**
 * 유효한 국제 형식 전화번호가 들어오면 프로필에 1회 저장한다(값이 바뀌면 다시 1회).
 * 비로그인·미입력·형식 미달·중복이면 아무 것도 하지 않는다.
 */
export function useProfileContactSync(phone: string | null | undefined): void {
  const { user } = useAuth();
  const uid = user?.uid || null;
  const savedRef = useRef<string | null>(null);

  // 계정이 바뀌면 "이미 저장함" 기록을 리셋한다(다른 유저에게 이월 금지).
  useEffect(() => { savedRef.current = null; }, [uid]);

  useEffect(() => {
    if (!uid) return;
    const next = nextPhoneToPersist(phone, savedRef.current);
    if (!next) return;

    savedRef.current = next; // 낙관적 — 실패해도 재시도 폭주보다 조용한 스킵이 낫다
    setDoc(doc(db, 'users', uid), { phoneNumber: next }, { merge: true })
      .then(() => invalidateProfileCache(uid)) // 다음 폼 마운트가 새 값으로 prefill
      .catch((e) => {
        savedRef.current = null; // 다음 변경 때 다시 시도
        console.warn('[useProfileContactSync] save failed:', e);
      });
  }, [uid, phone]);
}
