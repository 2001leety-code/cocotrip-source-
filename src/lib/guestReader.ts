// 게스트(비로그인) 플랜 보호용 순수 헬퍼.
//
// 배경 (feat/guest-anon-auth-pii, 2026-06-15):
//   게스트 PII 를 Firestore rule 레벨에서 막으려면 게스트도 Firebase 신원이 필요하다.
//   하지만 메인 auth 를 익명 로그인하면 앱 전체(69파일 user 사용)가 게스트를 "로그인됨"
//   으로 오인한다. 그래서 별도 Firebase 앱 인스턴스('guestReader', src/lib/firebase.js)
//   로 익명 로그인 → 메인 auth/useAuth 영향 0. 그 인스턴스 db 로 onSnapshot 하면 룰
//   owner-read 를 익명 uid 가 통과한다.
//
// 모든 신규 동작은 VITE_FEATURE_GUEST_ANON_AUTH === 'true' 플래그 뒤에 둔다.
// 플래그 OFF(기본) = 기존 동작과 100% 동일 (아래 함수들이 전부 "기존 경로" 값을 반환).
//
// 이 모듈은 부수효과 없는 순수 로직만 담는다 (단위 테스트 용이). Firebase 호출/헤더
// 조립은 호출처(usePlannerHandlers / PlanDetailPage)가 이 결정값을 보고 수행한다.

/** 빌드타임 플래그 — 게스트 익명 read 기능 켜짐 여부.
 *  2026-06-19: 운영자가 VITE_FEATURE_GUEST_ANON_AUTH 를 Production 스코프로 활성화 →
 *  이 커밋의 fresh 배포로 prod 번들에 'true' 반영(Redeploy 는 옛 env 스냅샷이라 미반영). */
export function isGuestAnonEnabled(): boolean {
  return import.meta.env.VITE_FEATURE_GUEST_ANON_AUTH === 'true';
}

export interface ReaderContextInput {
  /** 로그인 사용자 uid (없으면 null/빈값 = 게스트). */
  loggedInUid: string | null | undefined;
  /** isGuestAnonEnabled() 결과 (테스트 위해 명시 주입). */
  flagOn: boolean;
}

export interface ReaderContextDecision {
  /** true = 게스트 익명 인스턴스(getGuestDb/getGuestAuth) 사용, false = 기존 메인 db/uid. */
  useGuestReader: boolean;
}

/**
 * onSnapshot 읽기에 어느 Firebase 인스턴스를 쓸지 결정.
 *
 * - 플래그 OFF → 항상 기존 메인 경로(useGuestReader=false). 기존 동작 동일.
 * - 플래그 ON + 로그인 사용자 → 메인 경로(로그인은 기존 db/uid 그대로).
 * - 플래그 ON + 비로그인 게스트 → 게스트 익명 인스턴스(useGuestReader=true).
 */
export function chooseReaderContext({ loggedInUid, flagOn }: ReaderContextInput): ReaderContextDecision {
  if (!flagOn) return { useGuestReader: false };
  const isGuest = !loggedInUid;
  return { useGuestReader: isGuest };
}

/**
 * 플래너 호출에 게스트 익명 토큰 헤더를 붙일지 결정 (순수).
 *
 * 결제용 Authorization 헤더는 절대 건드리지 않는다. 비로그인 게스트 + 플래그 ON 일
 * 때만 별도 x-guest-anon-token 헤더를 추가한다. (Authorization 이 이미 있으면 = 로그인
 * 사용자이므로 익명 토큰 불필요.)
 *
 * @param hasAuthorization authHeaders.Authorization 존재 여부
 * @param flagOn isGuestAnonEnabled() 결과
 */
export function shouldAttachGuestAnonToken(hasAuthorization: boolean, flagOn: boolean): boolean {
  if (!flagOn) return false;
  return !hasAuthorization;
}
