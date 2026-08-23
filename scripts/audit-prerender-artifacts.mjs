/**
 * 프리렌더 산출물 감사 — 색인 대상 경로 **전부** (2026-08-23).
 *
 * 🔴 왜 필요한가: 캡처 시점이 고정 2.5초 타이머였을 때, 청크가 늦거나 실패한 라우트는
 *    **빈 껍데기가 정적 HTML 로 구워져 그대로 배포**됐다. 빌드는 초록이고 아무도 몰랐다.
 *    준비 판정을 내용 기반으로 바꾼 지금도(src/lib/prerenderReady.mjs) 그것만으로는
 *    부족하다 — 판정이 끝내 통과하지 못한 라우트는 `data-prerender-incomplete` 표시를
 *    달고 캡처되기 때문이다. **그 표시를 실패로 바꿔 주는 것이 이 감사다.**
 *
 * 규칙은 브라우저 쪽 판정과 같은 모듈 한 벌을 쓴다(JSDOM 으로 같은 함수에 먹인다).
 * 두 벌로 갈라 두면 반드시 어긋나고, 어긋난 쪽은 언제나 조용한 쪽이다.
 *
 * 경로 목록은 `public/sitemap.xml` 에서 읽는다 — 이 파일은 `src/lib/seoRoutes.ts` 의
 * INDEXABLE_ROUTES 와 정확히 일치하도록 `tests/unit/sitemap-canonical-consistency.test.ts`
 * 가 강제한다. (이 스크립트는 순수 Node 라 TS 를 직접 못 읽는다.)
 *
 * 사용: node scripts/audit-prerender-artifacts.mjs [distDir]
 * exit 0 = 전부 통과 / 1 = 하나라도 실패·누락 / 2 = 입력 파손(안전 방향 실패)
 */
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';
import {
  checkPrerenderReady,
  normalizePath,
  INCOMPLETE_ATTR,
  SITE_ORIGIN,
} from '../src/lib/prerenderReady.mjs';

/** `@prerenderer` 가 그 경로를 어디에 쓰는가. `/` 만 루트 index.html 이다. */
export function artifactPathFor(route) {
  const p = normalizePath(route);
  return p === '/' ? 'index.html' : `${p.replace(/^\//, '')}/index.html`;
}

/** sitemap 의 `<loc>` 을 경로로. 대표 도메인이 아닌 URL 은 버리지 않고 그대로 실패시킨다. */
export function routesFromSitemap(xml) {
  const locs = [...String(xml).matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1].trim());
  return locs.map((loc) => {
    if (!loc.startsWith(SITE_ORIGIN)) throw new Error(`sitemap loc outside ${SITE_ORIGIN}: ${loc}`);
    return normalizePath(loc.slice(SITE_ORIGIN.length) || '/');
  });
}

/**
 * 한 산출물 HTML 을 판정한다.
 * @returns {{ route: string, ok: boolean, reasons: string[] }}
 */
export function auditArtifactHtml(html, route) {
  const dom = new JSDOM(html);
  const doc = dom.window.document;
  const reasons = [];

  // 준비 판정이 끝내 통과하지 못한 채 캡처된 문서. 이유가 표시에 그대로 들어 있다.
  const incomplete = doc.documentElement.getAttribute(INCOMPLETE_ATTR);
  if (incomplete) reasons.push(`prerender incomplete: ${incomplete}`);

  reasons.push(...checkPrerenderReady(doc, route).reasons);
  dom.window.close();
  return { route, ok: reasons.length === 0, reasons };
}

/**
 * dist 안의 모든 색인 대상 산출물을 감사한다. 파일이 없으면 그 자체가 실패다 —
 * "없으면 건너뛴다" 는 게이트가 아니라 게이트처럼 보이는 초록불이다.
 */
export function auditArtifacts(distDir, routes) {
  return routes.map((route) => {
    const file = path.join(distDir, artifactPathFor(route));
    if (!existsSync(file)) return { route, ok: false, reasons: [`missing artifact ${artifactPathFor(route)}`] };
    return auditArtifactHtml(readFileSync(file, 'utf8'), route);
  });
}

function main(argv) {
  const distDir = argv[2] || 'dist';
  const sitemapFile = path.join('public', 'sitemap.xml');
  if (!existsSync(sitemapFile)) {
    console.error(`[prerender-audit] no ${sitemapFile}`);
    return 2;
  }
  if (!existsSync(distDir)) {
    console.error(`[prerender-audit] no build output at ${distDir} — run a PRERENDER=1 build first`);
    return 2;
  }

  let routes;
  try {
    routes = routesFromSitemap(readFileSync(sitemapFile, 'utf8'));
  } catch (err) {
    console.error(`[prerender-audit] ${err.message}`);
    return 2;
  }
  if (routes.length === 0) {
    console.error('[prerender-audit] sitemap has no URLs — refusing to pass on an empty set');
    return 2;
  }

  const results = auditArtifacts(distDir, routes);
  const failed = results.filter((r) => !r.ok);
  for (const result of failed) {
    console.error(`[prerender-audit] FAIL ${result.route}`);
    for (const reason of result.reasons) console.error(`    · ${reason}`);
  }
  console.log(`[prerender-audit] ${results.length - failed.length}/${results.length} routes passed`);
  return failed.length > 0 ? 1 : 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  process.exit(main(process.argv));
}
