/**
 * PWA 실행 스플래시(index.html 인라인) 페이드아웃 트리거.
 *
 * 설치 standalone 실행 시 index.html 이 즉시 스플래시를 그리고 `window.__appReady` 를 노출한다.
 * 첫 화면(홈/무드 포털)이 그려질 준비가 되면 이 함수를 호출 → 최소 표시시간 후 스플래시가 페이드.
 * (호출 전까지 스플래시가 유지되어 lazy 로딩/인증 중 "검정 갭" 을 가린다. 안전 캡 4.5s.)
 *
 * 일반 웹 방문(브라우저 탭)에선 __appReady 가 정의되지 않아 no-op.
 */
export function signalAppReady(): void {
  try {
    (window as unknown as { __appReady?: () => void }).__appReady?.();
  } catch {
    /* 비핵심 — 무시 */
  }
}
