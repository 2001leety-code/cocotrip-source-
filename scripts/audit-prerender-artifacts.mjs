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

/**
 * 감사 1회분. CLI 도 Vite 플러그인도 이 함수 하나를 쓴다 — 두 진입점이 서로 다른 판정을
 * 하면 안 된다.
 *
 * 입력이 깨진 경우(sitemap 없음·목록 0건·산출물 디렉토리 없음)는 **통과가 아니라 실패**다.
 * "볼 게 없으니 초록" 은 게이트처럼 보이는 초록불이고, 이 파일이 존재하는 이유가 그것이다.
 *
 * @returns {{ ok: boolean, fatal: string|null, results: Array<{route:string,ok:boolean,reasons:string[]}> }}
 */
export function runPrerenderAudit(options = {}) {
  const distDir = options.distDir || 'dist';
  const sitemapFile = options.sitemapFile || path.join('public', 'sitemap.xml');
  const fail = (fatal) => ({ ok: false, fatal, results: [] });

  let routes = options.routes || null;
  if (!routes) {
    if (!existsSync(sitemapFile)) return fail(`no ${sitemapFile}`);
    try {
      routes = routesFromSitemap(readFileSync(sitemapFile, 'utf8'));
    } catch (err) {
      return fail(err.message);
    }
  }
  if (routes.length === 0) return fail('route list is empty — refusing to pass on an empty set');
  if (!existsSync(distDir)) return fail(`no build output at ${distDir}`);

  const results = auditArtifacts(distDir, routes);
  return { ok: results.every((r) => r.ok), fatal: null, results };
}

/** 감사 결과를 사람이 읽을 줄로. CLI·플러그인이 같은 문장을 낸다. */
export function formatAuditReport(audit) {
  const lines = [];
  if (audit.fatal) lines.push(`[prerender-audit] ${audit.fatal}`);
  for (const result of audit.results.filter((r) => !r.ok)) {
    lines.push(`[prerender-audit] FAIL ${result.route}`);
    for (const reason of result.reasons) lines.push(`    · ${reason}`);
  }
  if (audit.results.length > 0) {
    const passed = audit.results.filter((r) => r.ok).length;
    lines.push(`[prerender-audit] ${passed}/${audit.results.length} routes passed`);
  }
  return lines.join('\n');
}

/**
 * 🔴 이 플러그인이 **실제 프로덕션 게이트**다 (2026-08-23 검토 지적 반영).
 *
 * 처음에는 감사를 `npm run build:prerender` 라는 별도 npm 스크립트에만 걸어 두었다.
 * 그런데 배포는 `npm run build` 를 PRERENDER=1 로 돌린다 — 레포에 buildCommand 재정의도
 * 없다. 즉 **배포 경로가 감사를 한 번도 지나가지 않았고**, 타임아웃·미완성 산출물이
 * 그대로 구워져도 빌드는 0으로 끝났다. 게이트가 있다고 적어 놓은 게이트가 없었던 것이다.
 *
 * 그래서 감사를 빌드 수명주기 안으로 옮긴다:
 *   · `closeBundle` = 번들이 디스크에 다 쓰인 뒤. 프리렌더 플러그인은 `generateBundle`
 *     (order: 'post') 에서 HTML 을 번들에 emit 하므로, 이 시점엔 파일이 이미 있다.
 *   · 실패하면 그냥 throw — Vite 빌드가 0 이 아닌 코드로 죽는다.
 *   · PRERENDER 가 꺼져 있으면 플러그인 자체를 만들지 않는다(`null`). 일반 빌드는
 *     라우트별 산출물을 요구받지 않는다.
 *   · `ranOnce` 로 프로세스당 한 번만. 같은 빌드에서 SW/환경별로 `closeBundle` 이
 *     여러 번 불릴 수 있는데, 감사를 47라우트씩 두 번 돌릴 이유가 없다.
 *
 * @returns {import('vite').Plugin | null}
 */
export function prerenderAuditPlugin(options = {}) {
  if (!options.enabled) return null;
  let ranOnce = false;
  let outDir = options.distDir || null;

  return {
    name: 'cocotrip-prerender-artifact-audit',
    apply: 'build',
    enforce: 'post',
    configResolved(config) {
      if (!options.distDir) outDir = config?.build?.outDir || 'dist';
    },
    closeBundle() {
      if (ranOnce) return;
      ranOnce = true;
      const audit = runPrerenderAudit({ ...options, distDir: outDir || 'dist' });
      const report = formatAuditReport(audit);
      if (audit.ok) {
        if (report) console.log(report);
        return;
      }
      throw new Error(`prerender artifact audit failed\n${report}`);
    },
  };
}

export function main(argv = []) {
  const audit = runPrerenderAudit({ distDir: argv[2] || 'dist' });
  const report = formatAuditReport(audit);
  if (audit.ok) {
    if (report) console.log(report);
    return 0;
  }
  console.error(report);
  return audit.fatal ? 2 : 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  process.exit(main(process.argv));
}
