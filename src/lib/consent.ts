/**
 * 분석 도구 동의 게이트 (2026-07-30).
 *
 * 🔴 고친 문제: `main.tsx` 가 부팅하자마자 `initGA()` 와 `bootPostHog()` 를 무조건 실행했다.
 *   쿠키 배너는 localStorage 에 값만 쓰고 아무것도 막지 않아서, 사용자가 **닫기(dismiss)**
 *   를 눌러도 GA4·PostHog 는 계속 돌았다. 배너에 "동의하면" 이라고 써 놓고 실제로는
 *   선택 전부터 이미 추적하고 있었던 것이다.
 *
 * 규칙
 *   - `accepted` 일 때만 분석 도구를 켠다.
 *   - 아직 선택 안 함(값 없음) → 켜지 않는다. 나중에 수락하면 그때 켠다.
 *   - `dismissed` → 켜지 않는다. 닫기는 거부로 본다(더 안전한 쪽).
 *
 * 결제·보안에 필요한 필수 동작은 이 게이트와 무관하다 — 여기서 막는 것은 분석뿐이다.
 */

const STORAGE_KEY = 'cocotrip_cookie_consent';
/** 같은 탭 안에서 배너 선택을 즉시 반영하기 위한 이벤트(스토리지 이벤트는 다른 탭에서만 뜬다). */
const CHANGE_EVENT = 'cocotrip:consent-change';

export type ConsentState = 'accepted' | 'dismissed' | 'unset';

export function readConsent(): ConsentState {
  if (typeof window === 'undefined') return 'unset';
  try {
    const v = window.localStorage.getItem(STORAGE_KEY);
    if (v === 'accepted') return 'accepted';
    if (v === 'dismissed') return 'dismissed';
    return 'unset';
  } catch {
    return 'unset';
  }
}

/** 분석 도구를 켜도 되는가. `accepted` 만 true. */
export function hasAnalyticsConsent(): boolean {
  return readConsent() === 'accepted';
}

/** 배너가 선택을 저장한 뒤 호출한다. 같은 탭의 구독자에게 즉시 알린다. */
export function setConsent(state: 'accepted' | 'dismissed'): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, state);
  } catch {
    // 저장이 막혀도 이번 세션 동안은 아래 이벤트로 반영된다.
  }
  window.dispatchEvent(new CustomEvent(CHANGE_EVENT, { detail: state }));
}

/** 동의 상태가 바뀔 때 콜백. 정리 함수를 돌려준다. */
export function onConsentChange(fn: (state: ConsentState) => void): () => void {
  if (typeof window === 'undefined') return () => {};
  const handler = () => fn(readConsent());
  window.addEventListener(CHANGE_EVENT, handler);
  window.addEventListener('storage', handler);   // 다른 탭에서 바꾼 경우
  return () => {
    window.removeEventListener(CHANGE_EVENT, handler);
    window.removeEventListener('storage', handler);
  };
}
