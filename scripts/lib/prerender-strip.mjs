// 미리 굽기(prerender)가 정적 HTML 에 박으면 안 되는 태그를 뺀다.
//
// 굽는 도구는 페이지가 다 뜬(load) 뒤의 화면을 통째로 HTML 로 저장한다. 홈 하늘 영상
// (SkyLayer)은 "다 뜬 뒤에 붙인다"는 장치가 굽는 순간 이미 켜져 있으므로,
// <video autoplay preload="auto"> 가 정적 HTML 에 박히면 손님 브라우저는 JS 보다 먼저
// 3.5MB 영상을 받는다(절약 모드·움직임 줄이기도 무시). 2026-11-23 휴대폰 측정.
//
// 표시는 data-prerender-strip 속성 하나. 손님 브라우저에서는 JS 가 제때 다시 넣는다.
// 다른 태그에 표시를 달면 빠지지 않고, 굽기 감사(audit-prerender-artifacts.mjs)가 실패시킨다.
export const PRERENDER_STRIP_ATTR = 'data-prerender-strip';

// 안에 같은 태그가 다시 들어가지 않는 태그만 받는다(비탐욕 매칭이 첫 닫는 태그에서 멈춘다).
const STRIP_TAG = /<(video|button)\b[^>]*\sdata-prerender-strip(?:=(?:""|''|"[^"]*"|'[^']*'))?(?=[\s/>])[^>]*>[\s\S]*?<\/\1\s*>/gi;

export function stripPrerenderOnlyTags(html) {
  return typeof html === 'string' ? html.replace(STRIP_TAG, '') : html;
}
