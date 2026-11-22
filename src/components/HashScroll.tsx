/**
 * HashScroll — 다른 페이지에서 `/privacy#article-6` 처럼 주소 끝 #조각을 달고 들어오면 그 칸까지 내려 준다(2026-11-22).
 * 브라우저 기본 이동은 페이지를 처음 열 때 한 번만 찾는데, 화면이 늦게(lazy) 그려지면 그 칸이 아직 없어서 놓친다.
 * 그래서 페이지(pathname)가 바뀔 때 그 id 가 생길 때까지 잠깐(최대 3초) 기다렸다 내린다.
 * - 같은 페이지 안의 #이동(처리방침 목차, 플랜 슬라이드 #slide-N 등)은 건드리지 않는다 — pathname 이 같으면 다시 돌지 않는다.
 * - id 가 없는 #조각(#t=…, #course=… 같은 값 전달)은 칸을 못 찾아 아무것도 안 한다.
 * - 머리글에 가리지 않는 여백은 그 칸의 scroll-mt-* 가 맡는다.
 */
import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';

const WAIT_MS = 3000;

export function HashScroll() {
  const { pathname, hash } = useLocation();
  useEffect(() => {
    let id = '';
    try { id = decodeURIComponent(hash.slice(1)); } catch { return undefined; }
    if (!id) return undefined;
    const started = Date.now();
    let frame = 0;
    const tick = () => {
      const el = document.getElementById(id);
      if (el) { el.scrollIntoView({ block: 'start' }); return; }
      if (Date.now() - started < WAIT_MS) frame = window.requestAnimationFrame(tick);
    };
    tick();
    return () => window.cancelAnimationFrame(frame);
    // hash 는 일부러 뺐다 — 같은 페이지 안의 #이동은 브라우저·그 페이지가 맡는다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);
  return null;
}
