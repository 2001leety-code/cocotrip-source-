// 미리 굽기(prerender)가 정적 HTML 에 박으면 안 되는 태그를 뺀다.
//
// 굽는 도구는 JS 가 실행된 뒤의 화면을 통째로 HTML 로 저장한다. 그래서 main.tsx 가 JS 로
// 넣은 <link rel="stylesheet"> 도 정적 HTML <head> 에 그대로 들어가고, 거기서는
// "그리기를 막는 스타일"이 된다(JS 로 넣은 링크는 막지 않는데, HTML 에 적힌 링크는 막는다).
// 2026-11-23 휴대폰 측정: Google 글꼴(Fraunces) 링크가 모든 쪽 첫 그림을 약 0.9초 늦췄다.
//
// 표시는 data-prerender-strip 속성 하나. 손님 브라우저에서는 main.tsx 가 다시 넣는다.
export const PRERENDER_STRIP_ATTR = 'data-prerender-strip';

const STRIP_TAG = /<link\b[^>]*\sdata-prerender-strip(?:=(?:""|''|"[^"]*"|'[^']*'))?(?=[\s/>])[^>]*>/gi;

export function stripPrerenderOnlyTags(html) {
  return typeof html === 'string' ? html.replace(STRIP_TAG, '') : html;
}
