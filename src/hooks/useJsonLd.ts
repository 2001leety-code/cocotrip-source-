import { useEffect } from 'react';

/**
 * JSON-LD 는 live DOM 에 textContent 로 넣을 때는 안전해도, 프리렌더가 HTML 로 다시
 * 직렬화하면 값 속 `</script>`가 실제 script 종료 태그로 재해석될 수 있다.
 * JSON 의미는 보존하면서 HTML 파서에 특별한 문자만 유니코드 escape 한다.
 */
export function serializeJsonLd(data: Record<string, unknown>): string {
  return JSON.stringify(data)
    .replace(/&/g, '\\u0026')
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

/**
 * 페이지 고유 JSON-LD 를 <head> 에 넣고, 라우트를 떠나면 지운다 (2026-08-01, 유입 묶음 D).
 *
 * TourDetailPage 가 하던 inject/cleanup 패턴을 그대로 옮겨 담은 것 — 같은 코드를
 * 가이드·차터·투어 세 곳에 복붙하지 않기 위해서다. 지우지 않으면 SPA 내비 후
 * 이전 페이지의 스키마가 남아 **다른 페이지의 구조화 데이터로 읽힌다**.
 *
 * `data` 가 null 이면 아무것도 넣지 않는다(로딩 중·해당 없음).
 * 프리렌더(무JS HTML)에도 이 스크립트가 실린다 — 이미 /tours/* Product 로 실증된 경로.
 */
export function useJsonLd(id: string, data: Record<string, unknown> | null): void {
  const serialized = data ? serializeJsonLd(data) : null;
  useEffect(() => {
    if (!serialized) return;
    document.getElementById(id)?.remove();
    const script = document.createElement('script');
    script.type = 'application/ld+json';
    script.id = id;
    script.textContent = serialized;
    document.head.appendChild(script);
    return () => { script.remove(); };
  }, [id, serialized]);
}
