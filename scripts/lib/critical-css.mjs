/**
 * 굽기 HTML 에 "첫 화면에 쓰는 스타일만" 넣고, 기본 스타일 파일은 막지 않게 받는다 (2026-11-24).
 *
 * 왜: 기본 스타일 파일(index-*.css, 압축 약 45KB)이 첫 그림을 막고 있었다.
 *   - 휴대폰(느린 4G)에서는 같은 순간 자바스크립트 25개와 망을 나눠 쓴다.
 *   - 그래서 이 파일 하나가 1.7초 걸려 받아졌다. 운영에서는 3.1초였다.
 *   - 첫 글자는 그 뒤에야 떴다.
 *
 * 무엇을: 굽기가 만든 라우트 HTML 마다 beasties 를 돌린다.
 *   - 그 HTML 에 실제로 있는 요소에 걸리는 규칙만 <style> 로 넣는다.
 *   - 원래 <link rel="stylesheet"> 는 preload + onload 로 바꾼다.
 *   - 자바스크립트가 꺼진 경우를 위해 <noscript> 안에 원래 링크를 남긴다.
 *
 * 🔴 preload 'media'(media="print" 요령)를 쓰지 말 것.
 *   - 크롬은 print 스타일을 가장 낮은 순서로 받는다.
 *   - 실측(11/24): 기본 스타일이 자바스크립트보다 늦게(5.7초) 와서 화면 전체가 밀렸다(CLS 0.33).
 *   - 'swap' = rel=preload as=style 이라 지금처럼 높은 순서로 받는다.
 * 🔴 앱이 다 받기 전에 화면을 그리지 않게 src/lib/fullCssReady.ts 가 기다린다.
 *   - 자바스크립트는 캐시에 있고 스타일만 새로 받는 경우를 막는다(스타일만 바꾼 배포 직후 재방문).
 *
 * 원본 스타일 파일은 그대로 둔다(pruneSource: false). 다른 라우트와 자바스크립트가 그리는 화면이 쓴다.
 * 이미 HTML 안에 있는 <style> 은 건드리지 않는다(reduceInlineStyles: false).
 */
import Beasties from 'beasties';
import { artifactPathFor } from '../audit-prerender-artifacts.mjs';

export const CRITICAL_CSS_OPTIONS = Object.freeze({
  preload: 'swap',
  pruneSource: false,
  reduceInlineStyles: false,
  inlineFonts: false,
  preloadFonts: false,
  compress: true,
  // 파일마다 첫 화면 스타일을 그 파일 링크 바로 앞에 둔다. 합치면 뒤 파일 규칙이 첫 파일보다 앞에 놓여
  // 기본 스타일이 먼저 도착한 순간 같은 세기 규칙의 승패가 뒤집힌다(파일 순서에 기대는 곳이 있다, src/main.tsx 머리말).
  mergeStylesheets: false,
  logLevel: 'warn',
});

/** 번들(아직 디스크에 안 쓰인 산출물)에서 스타일 파일을 읽는 beasties. */
class BundleBeasties extends Beasties {
  constructor(bundle) {
    super({ ...CRITICAL_CSS_OPTIONS, path: '/', publicPath: '/' });
    this.bundle = bundle;
  }

  // 외부 주소(구글 글꼴 등)와 번들에 없는 파일은 undefined → beasties 가 그 링크를 그대로 둔다.
  getCssAsset(href) {
    if (/^(https?:)?\/\//.test(href)) return undefined;
    const asset = this.bundle[href.replace(/^\//, '').split(/[?#]/)[0]];
    return asset && asset.type === 'asset' ? String(asset.source) : undefined;
  }
}

/** HTML 하나를 처리한다. `bundle` = Rollup 번들(파일 이름 → { type: 'asset', source }). */
export async function inlineCriticalCss(html, bundle) {
  return hoistHighPriorityImagePreloads(await new BundleBeasties(bundle).process(html));
}

const HIGH_IMAGE_PRELOAD = /<link\b(?=[^>]*\brel="preload")(?=[^>]*\bas="image")(?=[^>]*\bfetchpriority="high")[^>]*>/g;

/**
 * 높은 순서 그림 미리 받기(SkyLayer 의 하늘 그림 = 홈 LCP)를 <head> 맨 앞(charset 바로 뒤)으로 옮긴다.
 * React 는 이 줄을 자바스크립트 미리 받기 20여 개 뒤에 넣는다. 그 자리면 망을 나눠 쓰느라 17KB 그림이 4초 걸렸다.
 * 실측(11/24, 느린 4G): 홈 LCP 4.75 → 1.74초.
 */
export function hoistHighPriorityImagePreloads(html) {
  const tags = html.match(HIGH_IMAGE_PRELOAD);
  if (!tags) return html;
  const rest = html.replace(HIGH_IMAGE_PRELOAD, '');
  const anchor = /<meta\b[^>]*\bcharset=[^>]*>/i.exec(rest) || /<head\b[^>]*>/i.exec(rest);
  if (!anchor) return html;
  const at = anchor.index + anchor[0].length;
  return rest.slice(0, at) + tags.join('') + rest.slice(at);
}

/**
 * Vite 플러그인. 굽기 플러그인(generateBundle, order: 'post') 뒤에 놓아야 한다.
 * 같은 order 끼리는 plugins 배열 순서대로 돈다. 그래서 굽기가 내보낸 라우트 HTML 이 이때 번들에 있다.
 * 디스크에 쓰기 전에 바꾸므로 서비스워커 미리 저장 목록과 굽기 감사도 바뀐 HTML 을 본다.
 *
 * @param {{ enabled: boolean, routes: string[] }} options
 * @returns {import('vite').Plugin | null}
 */
export function criticalCssPlugin({ enabled, routes }) {
  if (!enabled) return null;
  return {
    name: 'cocotrip-critical-css',
    apply: 'build',
    generateBundle: {
      order: 'post',
      async handler(_output, bundle) {
        // 굽기 플러그인은 path.join 으로 파일 이름을 만든다 → 윈도에서는 'planner\index.html'.
        // 리눅스(Vercel)는 'planner/index.html'. 둘 다 '/' 로 맞춰서 찾는다.
        const byName = new Map(Object.values(bundle).map((f) => [f.fileName.replace(/\\/g, '/'), f]));
        for (const route of routes) {
          const file = byName.get(artifactPathFor(route));
          if (!file || file.type !== 'asset') continue; // 없는 산출물은 굽기 감사가 실패시킨다
          file.source = await inlineCriticalCss(String(file.source), bundle);
        }
      },
    },
  };
}
