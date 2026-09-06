/**
 * `vite.config.ts` 의 `define` 이 박아 넣는 빌드 상수.
 * PRERENDER=1 빌드에서만 true — 일반 prod 번들에서는 false 로 접혀 준비 판정 코드가
 * 통째로 tree-shake 된다(손님 브라우저는 폴링을 돌지 않는다).
 */
declare const __PRERENDER_BUILD__: boolean;

/** Vercel/GitHub 커밋 SHA에서 만든 공개 빌드 진단 식별자. */
declare const __COCOTRIP_BUILD__: string;
