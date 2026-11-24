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

// 2026-11-24: 굽기 HTML 이 어느 주소의 화면인지 <html> 에 적는다.
// 굽지 않은 주소(/mypage, /my-plans/…, /booking/manage 등)는 Vercel 이 홈 HTML(index.html)을 내려보내서
// 앱이 뜰 때까지 홈 화면이 보였다. index.html 의 짧은 스크립트가 이 표시와 주소를 비교해 다르면 본문을 숨긴다.
// 🔴 표시가 틀리면 그 굽기 화면이 앱이 뜰 때까지 안 보인다 → 굽기 감사(audit-prerender-artifacts.mjs)가 산출물마다 대조한다.
export const PRERENDER_ROUTE_ATTR = 'data-prerender-route';

/** 끝의 / 를 뗀 주소('/' 는 그대로). 스크립트(index.html)와 같은 규칙. */
export const normalizeRoutePath = (path) => String(path || '/').replace(/\/index\.html$/, '/').replace(/(.)\/+$/, '$1');

export function stampPrerenderRoute(html, route) {
  // 주소를 모르면 적지 않는다 — 표시 없음 = 숨기지 않음(안전한 쪽). 모르는 채 '/' 로 적으면 모든 굽기 화면이 숨는다.
  if (typeof html !== 'string' || typeof route !== 'string' || !route) return html;
  const value = normalizeRoutePath(route).replace(/[&"<>]/g, (c) => `&#${c.charCodeAt(0)};`);
  return html.replace(/<html\b/i, () => `<html ${PRERENDER_ROUTE_ATTR}="${value}"`);
}
