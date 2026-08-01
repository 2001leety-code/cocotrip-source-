/**
 * 분석 도구 동의 게이트 (2026-07-30).
 *
 * 🔴 고친 문제 1 (#1191): `main.tsx` 가 부팅하자마자 `initGA()` 와 `bootPostHog()` 를 무조건
 *   실행했다. 쿠키 배너는 localStorage 에 값만 쓰고 아무것도 막지 않아서, 사용자가
 *   **닫기(dismiss)** 를 눌러도 GA4·PostHog 는 계속 돌았다.
 *
 * 🔴 고친 문제 2 (#1192): 게이트를 부팅 경로에만 뒀더니 `ensureInit()` lazy-init 으로 새어나갔다.
 *
 * 🔴 고친 문제 3 (이번 라운드): 저장이 막힌 브라우저(사파리 시크릿 등)에서 동의가 **소실**됐다.
 *   `setConsent` 는 `localStorage.setItem` 실패를 삼키고 이벤트만 쐈는데, 구독자 핸들러가
 *   이벤트의 `detail` 을 무시하고 `readConsent()`(=저장소 재읽기)를 하는 바람에 항상 'unset'
 *   이 나왔다. 즉 **수락을 눌러도 이번 세션 내내 분석이 안 켜졌다**. 저장은 다음 방문을 위한
 *   편의이고, 이번 세션의 진실은 메모리 상태다 → 메모리 우선 + 이벤트 detail 사용.
 *
 * 상태별 계약 (분석 도구 구현의 기준):
 *   - `unset`     아직 선택 안 함 → 켜지 않는다.
 *   - `dismissed` 닫기 = 거부로 본다(더 안전한 쪽) → 켜지 않는다.
 *   - `revoked`   수락 뒤 철회 → 켜지 않는다 + 이미 켜졌으면 전송 중단(opt-out)·식별 초기화.
 *   - `accepted`  정확히 한 번 초기화하고 정상 전송.
 *
 * 결제·보안에 필요한 필수 동작은 이 게이트와 무관하다 — 여기서 막는 것은 분석뿐이다.
 */

const STORAGE_KEY = 'cocotrip_cookie_consent';
/** 같은 탭 안에서 배너 선택을 즉시 반영하기 위한 이벤트(스토리지 이벤트는 다른 탭에서만 뜬다). */
const CHANGE_EVENT = 'cocotrip:consent-change';

export type ConsentState = 'accepted' | 'dismissed' | 'revoked' | 'unset';

/** 저장 가능한 선택값. `unset` 은 "아직 선택 없음" 이므로 저장 대상이 아니다. */
export type ConsentChoice = 'accepted' | 'dismissed' | 'revoked';

function isConsentState(v: unknown): v is ConsentState {
  return v === 'accepted' || v === 'dismissed' || v === 'revoked' || v === 'unset';
}

/**
 * 이번 세션에서 확정된 상태. localStorage 쓰기·읽기가 막혀도 여기 남는다.
 * 다른 탭에서 바뀐 경우는 'storage' 이벤트에서 이 값을 저장소 값으로 다시 맞춘다.
 */
let memoryState: ConsentState | null = null;

/**
 * 동의 상태가 바뀔 때마다 1 증가하는 **세대값**.
 *
 * 왜 필요한가: `track()`/`identify()` 는 SDK 를 기다리는 `await` 가 있다. 그 사이에 사용자가
 * 철회하면, 깨어난 코드는 "허가받은 시점의 세계" 를 그대로 믿고 전송한다(TOCTOU).
 * 호출부는 await **전후로** 이 값을 비교해, 달라졌으면 전송을 포기한다.
 * (`hasAnalyticsConsent()` 재확인만으로는 accepted→revoked→accepted 같은 왕복을 못 잡는다.)
 */
let generation = 0;

/** 현재 동의 세대. 값 자체에 의미는 없고 **변했는지**만 본다. */
export function consentGeneration(): number {
  return generation;
}

/** 저장소만 읽는다. 접근 자체가 막히면(예외) 'unset'. */
function readStored(): ConsentState {
  try {
    const v = window.localStorage.getItem(STORAGE_KEY);
    return isConsentState(v) ? v : 'unset';
  } catch {
    return 'unset';
  }
}

export function readConsent(): ConsentState {
  if (typeof window === 'undefined') return 'unset';
  // 메모리 우선: 저장이 막힌 브라우저에서도 이번 세션의 선택이 유지된다.
  if (memoryState !== null) return memoryState;
  return readStored();
}

/** 분석 도구를 켜도 되는가. `accepted` 만 true. */
export function hasAnalyticsConsent(): boolean {
  return readConsent() === 'accepted';
}

/** 배너가 선택을 저장한 뒤 호출한다. 같은 탭의 구독자에게 즉시 알린다. */
export function setConsent(state: ConsentChoice): void {
  if (typeof window === 'undefined') return;
  memoryState = state;
  generation += 1;
  try {
    window.localStorage.setItem(STORAGE_KEY, state);
  } catch {
    // 저장이 막혀도 이번 세션은 memoryState + 아래 이벤트로 정상 동작한다.
  }
  window.dispatchEvent(new CustomEvent<ConsentState>(CHANGE_EVENT, { detail: state }));
}

/** 동의 상태가 바뀔 때 콜백. 정리 함수를 돌려준다. */
export function onConsentChange(fn: (state: ConsentState) => void): () => void {
  // addEventListener 가 없는 축소된 window(테스트 스텁·일부 임베드 환경)에서도 import 시점에
  // 터지지 않게 한다 — 분석 모듈이 앱 부팅을 깨면 안 된다.
  if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') return () => {};
  const sameTab = (e: Event) => {
    // 저장이 막힌 환경에서도 동작하도록 이벤트가 실어 온 값을 먼저 쓴다.
    const detail = (e as CustomEvent<unknown>).detail;
    if (isConsentState(detail)) {
      memoryState = detail;
      fn(detail);
      return;
    }
    fn(readConsent());
  };
  const otherTab = () => {
    // 다른 탭의 변경이 진실 — 메모리를 저장소 값으로 다시 맞춘다.
    // 세대 증가는 여기서 하지 않는다. 아래 모듈 리스너가 storage 이벤트당 정확히 1회 올린다.
    memoryState = readStored();
    fn(memoryState);
  };
  window.addEventListener(CHANGE_EVENT, sameTab);
  window.addEventListener('storage', otherTab);
  return () => {
    window.removeEventListener(CHANGE_EVENT, sameTab);
    window.removeEventListener('storage', otherTab);
  };
}

/**
 * 🔴 다른 탭의 변경에 대한 **세대 증가는 모듈에서 딱 한 번** 한다 (2026-08-02 리뷰 지적).
 *
 * 예전에는 `onConsentChange` 가 등록하는 리스너마다 `generation += 1` 을 했다. 구독이 2개면
 * storage 이벤트 하나에 세대가 2 올라간다. 그러면 **첫 구독이 시작시킨 전송이 두 번째 구독의
 * 증가 때문에 폐기된다** — `track()` 은 await 전후의 세대를 비교하는데, 그 사이에 값이
 * 또 바뀌어 버리기 때문이다(같은 컴포넌트가 구독 2개를 걸자 실제로 재현됐다: 다른 탭에서
 * 수락 시 `charter_quote_complete` 만 남고 시작·단계 이벤트가 사라짐).
 *
 * 이 리스너는 consent 모듈 로드 시점에 등록되므로 어떤 구독자보다 먼저 실행된다 →
 * 대기 중이던 전송을 무효화한다는 원래 목적은 그대로 지키면서, 증가는 이벤트당 1회가 된다.
 */
if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
  window.addEventListener('storage', (e) => {
    if (e instanceof StorageEvent && e.key && e.key !== STORAGE_KEY) return;
    generation += 1;
  });
}
