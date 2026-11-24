/**
 * 기본 스타일 파일을 다 받을 때까지 기다린다 (2026-11-24).
 *
 * 굽기 HTML 은 첫 화면 스타일만 품고, 기본 스타일 파일을 막지 않고 받는다(scripts/lib/critical-css.mjs).
 * 앱이 그 파일보다 먼저 화면을 그리면, 굽기 HTML 에 없던 요소(쿠키 배너·채팅 단추 등)가 모양 없이 떴다가 밀린다.
 * 보통은 스타일 파일(45KB)이 자바스크립트보다 먼저 온다.
 * 자바스크립트만 캐시에 있는 경우(스타일만 바꾼 배포 직후 재방문)를 위해 앱이 여기서 기다린다.
 *
 * - 대상 = beasties 가 바꾼 `<link rel="preload" as="style" onload>` 중 아직 preload 인 것.
 *   굽기 HTML 이 아니면(개발·굽는 중) 없다 → 바로 끝.
 * - 받음 = load(onload 가 rel 을 stylesheet 로 바꾼다. 받은 바이트는 이미 메모리에 있다) 또는 error.
 * - 상한 시간이 지나면 아직 preload 인 링크를 stylesheet 로 직접 바꾸고 그린다.
 *   preload 를 안 따르는 브라우저·설정에서도 기본 스타일은 결국 붙는다. 화면을 영영 막지 않는다.
 * - 링크 하나는 한 번만 센다(load 뒤에 error 가 또 와도 다른 링크를 안 기다리고 끝내지 않게).
 */
export function whenFullCssLoaded(doc: Document = document, maxWaitMs = 4000): Promise<void> {
  const pending = Array.from(doc.querySelectorAll<HTMLLinkElement>('link[rel="preload"][as="style"][onload]'));
  if (pending.length === 0) return Promise.resolve();

  return new Promise((resolve) => {
    const settled = new Set<HTMLLinkElement>();
    const timer = setTimeout(() => {
      for (const link of pending) if (link.rel === 'preload') link.rel = 'stylesheet';
      resolve();
    }, maxWaitMs);
    const settle = (link: HTMLLinkElement) => {
      settled.add(link);
      if (settled.size < pending.length) return;
      clearTimeout(timer);
      resolve();
    };
    for (const link of pending) {
      link.addEventListener('load', () => settle(link), { once: true });
      link.addEventListener('error', () => settle(link), { once: true });
    }
  });
}
