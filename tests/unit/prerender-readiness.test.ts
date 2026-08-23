// @vitest-environment node
/**
 * 프리렌더 fail-closed (2026-08-23).
 *
 * 🔴 고친 결함: 캡처 시점이 `setTimeout(signal, 2500)` 고정 타이머였다. 2.5초는 "다 됐다"
 *    의 증거가 아니라 짐작이고, 청크가 늦거나 실패한 라우트는 **빈 껍데기가 정적 HTML 로
 *    구워져 배포**됐다 — 빌드는 초록이었다.
 *
 * 잠그는 것
 *   1) 판정 규칙이 내용 기반이다: 본문 · canonical 1개 자기참조 · index,follow.
 *      가이드 상세는 추가로 본문 도착 신호 + 유효한 Article JSON-LD.
 *   2) 신호가 준비 전에 나가지 않는다. 끝내 준비 안 되면 **표시를 남기고** 나간다.
 *   3) 산출물 감사가 그 표시를 실패로 바꾼다.
 *   4) INDEXABLE_ROUTES 전부가 감사 대상이다 — 산출물 경로 매핑에 구멍이 없다.
 *   5) dist 에 프리렌더 산출물이 실제로 있으면 전 경로를 그 자리에서 감사한다.
 */
import { afterAll, describe, it, expect, vi } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { JSDOM } from 'jsdom';

import { INDEXABLE_ROUTES, SITE_ORIGIN as ROUTES_ORIGIN } from '../../src/lib/seoRoutes';
import {
  SITE_ORIGIN,
  MIN_MAIN_TEXT_CHARS,
  INCOMPLETE_ATTR,
  checkPrerenderReady,
  expectedCanonical,
  isGuideDetailPath,
  normalizePath,
  startPrerenderReadySignal,
} from '../../src/lib/prerenderReady.mjs';
import {
  artifactPathFor,
  auditArtifactHtml,
  auditArtifacts,
  formatAuditReport,
  prerenderAuditPlugin,
  routesFromSitemap,
  runPrerenderAudit,
} from '../../scripts/audit-prerender-artifacts.mjs';

const ROOT = process.cwd();
const read = (...p: string[]) => readFileSync(path.join(ROOT, ...p), 'utf8');

const BODY_TEXT = 'Seoul itinerary detail. '.repeat(40); // > MIN_MAIN_TEXT_CHARS

function page(opts: {
  route: string;
  main?: string;
  canonical?: string | string[] | null;
  robots?: string | null;
  guideArticle?: boolean;
  jsonLd?: string[];
  incomplete?: string;
}): string {
  const canonicals = opts.canonical === null
    ? []
    : Array.isArray(opts.canonical)
      ? opts.canonical
      : [opts.canonical || expectedCanonical(opts.route)];
  const robots = opts.robots === null ? '' : `<meta name="robots" content="${opts.robots || 'index, follow'}">`;
  const article = opts.guideArticle ? '<article data-testid="guide-article">body</article>' : '';
  const scripts = (opts.jsonLd || []).map((s) => `<script type="application/ld+json">${s}</script>`).join('');
  const flag = opts.incomplete ? ` ${INCOMPLETE_ATTR}="${opts.incomplete}"` : '';
  return `<!doctype html><html${flag}><head>
    ${canonicals.map((href) => `<link rel="canonical" href="${href}">`).join('')}
    ${robots}${scripts}
  </head><body><main>${article}${opts.main === undefined ? BODY_TEXT : opts.main}</main></body></html>`;
}

function docOf(html: string): Document {
  return new JSDOM(html).window.document as unknown as Document;
}

const articleJsonLd = (route: string, over: Record<string, unknown> = {}) => JSON.stringify({
  '@context': 'https://schema.org',
  '@type': 'Article',
  headline: 'Seoul Cafe Guide 2026',
  datePublished: '2026-07-14',
  mainEntityOfPage: { '@type': 'WebPage', '@id': expectedCanonical(route) },
  ...over,
});

const check = (html: string, route: string) => checkPrerenderReady(docOf(html), route);

describe('prerenderReady — 원천 정합', () => {
  it('SITE_ORIGIN 이 seoRoutes 와 같은 값이다', () => {
    expect(SITE_ORIGIN).toBe(ROUTES_ORIGIN);
  });

  it('경로 정규화·canonical 파생', () => {
    expect(normalizePath('')).toBe('/');
    expect(normalizePath('/tours/')).toBe('/tours');
    expect(normalizePath('/tours?a=1#b')).toBe('/tours');
    expect(expectedCanonical('/')).toBe(`${SITE_ORIGIN}/`);
    expect(expectedCanonical('/tours/')).toBe(`${SITE_ORIGIN}/tours`);
  });

  it('가이드 상세만 상세로 본다 (목록은 아니다)', () => {
    expect(isGuideDetailPath('/guide')).toBe(false);
    expect(isGuideDetailPath('/guide/')).toBe(false);
    expect(isGuideDetailPath('/guide/seoul-cafe-guide-2026-best')).toBe(true);
  });
});

describe('prerenderReady — 모든 색인 페이지 공통 규칙', () => {
  it('본문·canonical·robots 가 갖춰지면 통과', () => {
    expect(check(page({ route: '/tours' }), '/tours')).toEqual({ ok: true, reasons: [] });
  });

  it('main 이 없으면 실패', () => {
    const html = page({ route: '/tours' }).replace('<main>', '<div>').replace('</main>', '</div>');
    const result = check(html, '/tours');
    expect(result.ok).toBe(false);
    expect(result.reasons.join(' ')).toContain('no <main>');
  });

  it('본문이 비었거나 로딩 껍데기면 실패', () => {
    const result = check(page({ route: '/tours', main: 'Loading this guide' }), '/tours');
    expect(result.ok).toBe(false);
    expect(result.reasons.join(' ')).toContain('main text too short');
  });

  it('문턱은 실제 상수를 쓴다 — 상수를 낮추면 이 테스트가 같이 움직인다', () => {
    const justUnder = 'x'.repeat(MIN_MAIN_TEXT_CHARS - 1);
    const justOver = 'x'.repeat(MIN_MAIN_TEXT_CHARS);
    expect(check(page({ route: '/tours', main: justUnder }), '/tours').ok).toBe(false);
    expect(check(page({ route: '/tours', main: justOver }), '/tours').ok).toBe(true);
  });

  it('canonical 이 없거나 둘 이상이면 실패', () => {
    expect(check(page({ route: '/tours', canonical: null }), '/tours').reasons.join(' '))
      .toContain('expected exactly 1 canonical');
    expect(check(page({
      route: '/tours',
      canonical: [expectedCanonical('/tours'), `${SITE_ORIGIN}/`],
    }), '/tours').reasons.join(' ')).toContain('expected exactly 1 canonical');
  });

  it('canonical 이 남의 주소를 가리키면 실패', () => {
    const result = check(page({ route: '/tours', canonical: `${SITE_ORIGIN}/` }), '/tours');
    expect(result.ok).toBe(false);
    expect(result.reasons.join(' ')).toContain('canonical');
  });

  it('canonical 끝 슬래시 차이는 통과 (같은 주소다)', () => {
    expect(check(page({ route: '/tours', canonical: `${SITE_ORIGIN}/tours/` }), '/tours').ok).toBe(true);
  });

  it('noindex 를 구워 배포하면 실패', () => {
    const result = check(page({ route: '/tours', robots: 'noindex, nofollow' }), '/tours');
    expect(result.ok).toBe(false);
    expect(result.reasons.join(' ')).toContain('robots');
  });

  it('robots meta 자체가 없으면 실패', () => {
    expect(check(page({ route: '/tours', robots: null }), '/tours').reasons.join(' '))
      .toContain('no robots meta');
  });
});

describe('prerenderReady — 가이드 상세 추가 규칙', () => {
  const route = '/guide/seoul-cafe-guide-2026-best';

  it('본문 + 유효한 Article 스키마가 있으면 통과', () => {
    const html = page({ route, guideArticle: true, jsonLd: [articleJsonLd(route)] });
    expect(check(html, route)).toEqual({ ok: true, reasons: [] });
  });

  it('본문 도착 신호가 없으면 실패 (로딩 껍데기를 굽지 않는다)', () => {
    const html = page({ route, guideArticle: false, jsonLd: [articleJsonLd(route)] });
    expect(check(html, route).reasons.join(' ')).toContain('guide article body not rendered');
  });

  it('Article JSON-LD 가 없으면 실패', () => {
    const html = page({ route, guideArticle: true, jsonLd: [] });
    expect(check(html, route).reasons.join(' ')).toContain('no Article JSON-LD');
  });

  it('깨진 JSON-LD 를 실패로 본다 (조용히 무시하지 않는다)', () => {
    const html = page({ route, guideArticle: true, jsonLd: ['{not json'] });
    expect(check(html, route).reasons.join(' ')).toContain('invalid JSON-LD');
  });

  it('headline·datePublished 가 비면 실패', () => {
    const noHeadline = page({ route, guideArticle: true, jsonLd: [articleJsonLd(route, { headline: '' })] });
    expect(check(noHeadline, route).reasons.join(' ')).toContain('headline');
    const noDate = page({ route, guideArticle: true, jsonLd: [articleJsonLd(route, { datePublished: '' })] });
    expect(check(noDate, route).reasons.join(' ')).toContain('datePublished');
  });

  it('Article 이 다른 페이지를 가리키면 실패 (이전 라우트 스키마 잔류)', () => {
    const stale = page({
      route,
      guideArticle: true,
      jsonLd: [articleJsonLd(route, { mainEntityOfPage: { '@type': 'WebPage', '@id': `${SITE_ORIGIN}/guide/other` } })],
    });
    expect(check(stale, route).reasons.join(' ')).toContain('mainEntityOfPage');
  });

  it('가이드 목록(/guide)에는 Article 을 요구하지 않는다', () => {
    expect(check(page({ route: '/guide' }), '/guide').ok).toBe(true);
  });
});

describe('캡처 신호', () => {
  function harness(html: string, route: string) {
    const dom = new JSDOM(html);
    const doc = dom.window.document;
    let fired = 0;
    doc.addEventListener('prerender-ready', () => { fired += 1; });
    const queue: Array<() => void> = [];
    let clock = 0;
    const stop = startPrerenderReadySignal(doc, {
      pathname: route,
      intervalMs: 100,
      timeoutMs: 1000,
      now: () => clock,
      setTimer: (fn: () => void) => { queue.push(fn); return queue.length; },
      clearTimer: () => {},
    });
    const advance = (ms: number) => {
      clock += ms;
      const pending = queue.splice(0, queue.length);
      pending.forEach((fn) => fn());
    };
    return { doc, advance, stop, fired: () => fired };
  }

  it('내용이 준비돼 있으면 곧바로 쏜다', () => {
    const h = harness(page({ route: '/tours' }), '/tours');
    expect(h.fired()).toBe(1);
    expect(h.doc.documentElement.getAttribute(INCOMPLETE_ATTR)).toBeNull();
  });

  it('준비되지 않았으면 쏘지 않고 기다린다', () => {
    const h = harness(page({ route: '/tours', main: 'still loading' }), '/tours');
    expect(h.fired()).toBe(0);
    h.advance(100);
    expect(h.fired()).toBe(0);
    h.stop();
  });

  it('기다리는 사이에 본문이 오면 그때 쏜다', () => {
    const h = harness(page({ route: '/tours', main: 'still loading' }), '/tours');
    expect(h.fired()).toBe(0);
    h.doc.querySelector('main')!.textContent = BODY_TEXT;
    h.advance(100);
    expect(h.fired()).toBe(1);
    expect(h.doc.documentElement.getAttribute(INCOMPLETE_ATTR)).toBeNull();
  });

  it('끝내 준비 안 되면 이유를 표시로 남기고 쏜다 (60초 굶기지 않는다)', () => {
    const h = harness(page({ route: '/tours', main: 'still loading' }), '/tours');
    h.advance(1000);
    expect(h.fired()).toBe(1);
    expect(h.doc.documentElement.getAttribute(INCOMPLETE_ATTR)).toContain('main text too short');
  });
});

describe('산출물 감사', () => {
  it('경로 → 산출물 파일 매핑', () => {
    expect(artifactPathFor('/')).toBe('index.html');
    expect(artifactPathFor('/tours')).toBe('tours/index.html');
    expect(artifactPathFor('/guide/seoul-cafe-guide-2026-best')).toBe('guide/seoul-cafe-guide-2026-best/index.html');
  });

  it('INDEXABLE_ROUTES 전부가 서로 다른 산출물로 매핑된다 — 감사에서 빠지는 경로가 없다', () => {
    const files = INDEXABLE_ROUTES.map(artifactPathFor);
    expect(files.length).toBe(INDEXABLE_ROUTES.length);
    expect(new Set(files).size).toBe(files.length);
    expect(files.every((f) => f.endsWith('index.html'))).toBe(true);
  });

  it('sitemap 에서 읽은 경로 목록 == INDEXABLE_ROUTES (감사 대상이 색인 대상이다)', () => {
    const routes = routesFromSitemap(read('public', 'sitemap.xml'));
    expect([...routes].sort()).toEqual([...INDEXABLE_ROUTES].sort());
  });

  it('대표 도메인 밖 URL 이 sitemap 에 있으면 던진다 (조용히 건너뛰지 않는다)', () => {
    expect(() => routesFromSitemap('<loc>https://example.com/x</loc>')).toThrow();
  });

  it('준비 실패 표시가 달린 산출물을 실패로 본다', () => {
    const html = page({ route: '/tours', incomplete: 'main text too short (12 &lt; 400)' });
    const result = auditArtifactHtml(html, '/tours');
    expect(result.ok).toBe(false);
    expect(result.reasons.join(' ')).toContain('prerender incomplete');
  });

  it('멀쩡한 산출물은 통과한다', () => {
    expect(auditArtifactHtml(page({ route: '/tours' }), '/tours').ok).toBe(true);
  });

  it('산출물이 없으면 통과가 아니라 실패다', () => {
    const results = auditArtifacts(path.join(ROOT, 'tests', '__no_such_dist__'), ['/tours']);
    expect(results[0].ok).toBe(false);
    expect(results[0].reasons.join(' ')).toContain('missing artifact');
  });

  it('dist 에 프리렌더 산출물이 있으면 색인 경로 전부를 감사한다', () => {
    const dist = path.join(ROOT, 'dist');
    // 프리렌더는 PRERENDER=1 빌드에서만 나온다. 산출물이 없는 일반 빌드에서는 감사할
    // 대상이 없다 — 그 경우의 게이트는 `npm run build:prerender` 쪽이다.
    if (!existsSync(path.join(dist, 'tours', 'index.html'))) return;
    const failed = auditArtifacts(dist, [...INDEXABLE_ROUTES]).filter((r) => !r.ok);
    expect(failed.map((f) => `${f.route}: ${f.reasons.join(', ')}`)).toEqual([]);
  });
});

describe('빌드 배선', () => {
  it('main.tsx 가 더 이상 고정 2.5초 타이머로 캡처 시점을 정하지 않는다', () => {
    const main = read('src', 'main.tsx');
    // 주석은 걷어내고 본다 — 왜 없앴는지 설명하는 주석이 옛 코드를 그대로 인용한다.
    const code = main.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(code).not.toMatch(/setTimeout\(/);
    expect(main).toContain('startPrerenderReadySignal');
    expect(main).toContain('__PRERENDER_BUILD__');
  });

  it('vite.config 이 PRERENDER 빌드에서만 준비 판정을 켠다', () => {
    const config = read('vite.config.ts');
    expect(config).toMatch(/__PRERENDER_BUILD__:\s*JSON\.stringify\(process\.env\.PRERENDER === '1'\)/);
  });

  it('프리렌더 빌드 명령이 일반 빌드로 위임한다 (게이트는 빌드 안에 있다)', () => {
    const pkg = JSON.parse(read('package.json')) as { scripts: Record<string, string> };
    expect(pkg.scripts['seo:audit-prerender']).toContain('audit-prerender-artifacts');
    expect(pkg.scripts['build:prerender']).toContain('build-prerender');
    // 배포가 쓰는 명령은 이것이다. 셸 의존 문법(`PRERENDER=1 ...`)을 끼워 넣지 않는다.
    expect(pkg.scripts.build).toBe('tsc -b && vite build');
  });
});

/**
 * 🔴 검토에서 잡힌 P1 (2026-08-23): 감사가 `npm run build:prerender` 라는 별도 스크립트로만
 *    닿았다. 배포는 `npm run build` 를 PRERENDER=1 로 돌리고 레포에 buildCommand 재정의도
 *    없으니, **배포 경로는 감사를 한 번도 지나가지 않았다** — 미완성 산출물이 구워져도
 *    빌드는 0으로 끝났다. 그래서 게이트를 빌드 수명주기(`closeBundle`) 안으로 옮겼다.
 *
 * 여기서 증명하는 것
 *   1) PRERENDER 꺼짐 → 플러그인 자체가 없다(일반 빌드가 라우트별 산출물을 요구하지 않음).
 *   2) PRERENDER 켜짐 → 빌드가 감사를 돌리고, 실패는 throw 로 전파된다(빌드 exit != 0).
 *   3) 조용한 통과가 없다 — 목록이 비었거나 dist 가 없으면 그것도 실패다.
 *   4) 감사는 프로세스당 정확히 한 번.
 */
describe('프로덕션 게이트 배선 (PRERENDER=1 npm run build)', () => {
  const ROUTES = ['/', '/tours'];

  function fixtureDist(files: Record<string, string>): string {
    const dir = mkdtempSync(path.join(tmpdir(), 'prerender-audit-'));
    for (const [rel, html] of Object.entries(files)) {
      const file = path.join(dir, rel);
      mkdirSync(path.dirname(file), { recursive: true });
      writeFileSync(file, html);
    }
    tempDirs.push(dir);
    return dir;
  }

  const completeDist = () => fixtureDist({
    'index.html': page({ route: '/' }),
    'tours/index.html': page({ route: '/tours' }),
  });

  const tempDirs: string[] = [];
  afterAll(() => {
    for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
  });

  it('PRERENDER 가 꺼져 있으면 플러그인을 만들지 않는다', () => {
    expect(prerenderAuditPlugin({ enabled: false })).toBeNull();
    expect(prerenderAuditPlugin({})).toBeNull();
  });

  it('vite.config 가 PRERENDER 환경변수로만 게이트를 켠다', () => {
    const config = read('vite.config.ts');
    expect(config).toContain('prerenderAuditPlugin');
    expect(config).toMatch(/prerenderAuditPlugin\(\{\s*enabled:\s*process\.env\.PRERENDER === '1'\s*\}\)/);
    // 플러그인 배열 안에 있어야 빌드 수명주기를 탄다 — 주석이나 죽은 코드가 아니다.
    const plugins = config.slice(config.indexOf('plugins: ['), config.indexOf('resolve: {'));
    expect(plugins).toContain('prerenderAuditPlugin({ enabled: process.env.PRERENDER === \'1\' })');
  });

  it('켜지면 빌드 전용 플러그인이 나온다', () => {
    const plugin = prerenderAuditPlugin({ enabled: true, routes: ROUTES, distDir: completeDist() });
    expect(plugin).not.toBeNull();
    expect(plugin.apply).toBe('build');
    expect(typeof plugin.closeBundle).toBe('function');
  });

  it('산출물이 멀쩡하면 빌드를 통과시킨다', () => {
    const plugin = prerenderAuditPlugin({ enabled: true, routes: ROUTES, distDir: completeDist() });
    expect(() => plugin.closeBundle()).not.toThrow();
  });

  it('산출물이 없으면 빌드를 세운다 (조용한 0 종료 없음)', () => {
    const dist = fixtureDist({ 'index.html': page({ route: '/' }) }); // /tours 누락
    const plugin = prerenderAuditPlugin({ enabled: true, routes: ROUTES, distDir: dist });
    expect(() => plugin.closeBundle()).toThrowError(/prerender artifact audit failed[\s\S]*missing artifact/);
  });

  it('미완성 표시가 붙은 산출물이면 빌드를 세운다', () => {
    const dist = fixtureDist({
      'index.html': page({ route: '/' }),
      'tours/index.html': page({ route: '/tours', incomplete: 'main text too short' }),
    });
    const plugin = prerenderAuditPlugin({ enabled: true, routes: ROUTES, distDir: dist });
    expect(() => plugin.closeBundle()).toThrowError(/prerender incomplete/);
  });

  it('빈 껍데기가 구워졌으면 빌드를 세운다', () => {
    const dist = fixtureDist({
      'index.html': page({ route: '/' }),
      'tours/index.html': page({ route: '/tours', main: '' }),
    });
    const plugin = prerenderAuditPlugin({ enabled: true, routes: ROUTES, distDir: dist });
    expect(() => plugin.closeBundle()).toThrowError(/main text too short/);
  });

  it('프로세스당 정확히 한 번만 감사한다', () => {
    const dist = completeDist();
    const plugin = prerenderAuditPlugin({ enabled: true, routes: ROUTES, distDir: dist });
    plugin.closeBundle();
    // 첫 감사 뒤 산출물을 부숴도 두 번째 호출은 아무것도 하지 않는다 = 한 번만 돌았다.
    rmSync(path.join(dist, 'tours'), { recursive: true, force: true });
    expect(() => plugin.closeBundle()).not.toThrow();
  });

  it('입력이 비면 통과가 아니라 실패다', () => {
    expect(runPrerenderAudit({ routes: [], distDir: completeDist() }).ok).toBe(false);
    expect(runPrerenderAudit({ routes: ROUTES, distDir: path.join(ROOT, '__no_dist__') }))
      .toMatchObject({ ok: false, results: [] });
    expect(runPrerenderAudit({ routes: null, sitemapFile: path.join(ROOT, '__no_sitemap__.xml') }).ok)
      .toBe(false);
  });

  /**
   * 위 항목들이 "플러그인이 throw 한다" 까지 증명한다면, 이건 마지막 한 칸 —
   * **그 throw 가 실제 vite 빌드를 실패로 끝내는가** 를 진짜 빌드로 확인한다.
   * (작은 임시 프로젝트라 1~2초. 프리렌더는 돌리지 않는다.)
   */
  it('closeBundle 의 throw 가 실제 vite 빌드를 실패시킨다', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'prerender-gate-build-'));
    tempDirs.push(root);
    writeFileSync(path.join(root, 'main.js'), 'export const entry = 1;');
    const outDir = path.join(root, 'dist');
    mkdirSync(outDir, { recursive: true });

    const { build } = await import('vite');
    await expect(build({
      root,
      logLevel: 'silent',
      build: {
        outDir,
        emptyOutDir: false,
        rollupOptions: { input: path.join(root, 'main.js') },
      },
      // 산출물이 하나도 없는 dist → 감사 실패 → 빌드 실패여야 한다.
      plugins: [prerenderAuditPlugin({ enabled: true, routes: ['/tours'], distDir: outDir })],
    })).rejects.toThrow(/prerender artifact audit failed/);
  }, 60000);

  it('감사 보고가 실패 라우트와 이유를 남긴다 (조용히 죽지 않는다)', () => {
    const dist = fixtureDist({ 'index.html': page({ route: '/' }) });
    const report = formatAuditReport(runPrerenderAudit({ routes: ROUTES, distDir: dist }));
    expect(report).toContain('FAIL /tours');
    expect(report).toContain('1/2 routes passed');
  });

  it('CLI 진입점과 빌드 플러그인이 같은 판정을 쓴다', () => {
    const src = read('scripts', 'audit-prerender-artifacts.mjs');
    expect((src.match(/runPrerenderAudit\(/g) || []).length).toBeGreaterThanOrEqual(3);
  });

  it('build:prerender 래퍼가 감사를 두 번 돌리지 않고 자기를 다시 부르지 않는다', () => {
    const wrapper = read('scripts', 'build-prerender.mjs');
    expect(wrapper).not.toContain('seo:audit-prerender');
    expect(wrapper).not.toContain('build:prerender');
    expect((wrapper.match(/run\(\[/g) || []).length).toBe(1);
  });
});

/**
 * 위 블록이 소스를 읽어 배선을 확인한다면, 여기서는 **실제 vite 설정을 그대로 불러**
 * 플러그인 목록을 본다 — 문자열 대조가 아니라 `npm run build` 가 받게 될 바로 그 배열이다.
 * 두 상태를 봐야 하므로 모듈 캐시를 비우고 두 번 부른다.
 */
describe('vite 설정이 내놓는 실제 플러그인 목록', () => {
  const before = process.env.PRERENDER;
  afterAll(() => {
    if (before === undefined) delete process.env.PRERENDER;
    else process.env.PRERENDER = before;
  });

  async function pluginNames(prerender: string | undefined): Promise<string[]> {
    vi.resetModules();
    if (prerender === undefined) delete process.env.PRERENDER;
    else process.env.PRERENDER = prerender;
    const mod = await import('../../vite.config.ts') as { default: unknown };
    const config = (typeof mod.default === 'function'
      ? await (mod.default as (env: unknown) => unknown)({ command: 'build', mode: 'production' })
      : mod.default) as { plugins: unknown[] };
    return config.plugins
      .flat(10)
      .filter(Boolean)
      .map((p) => (p as { name?: string }).name)
      .filter((n): n is string => typeof n === 'string');
  }

  it('PRERENDER=1 이면 빌드가 감사 플러그인을 받는다', async () => {
    const names = await pluginNames('1');
    expect(names).toContain('Prerender Plugin');
    expect(names).toContain('cocotrip-prerender-artifact-audit');
    // 정확히 한 번만 등록된다 — 두 번 들어가면 47라우트를 두 번 읽는다.
    expect(names.filter((n) => n === 'cocotrip-prerender-artifact-audit')).toHaveLength(1);
  });

  it('PRERENDER 가 꺼져 있으면 일반 빌드에는 감사 플러그인이 없다', async () => {
    const names = await pluginNames(undefined);
    expect(names).not.toContain('Prerender Plugin');
    expect(names).not.toContain('cocotrip-prerender-artifact-audit');
  });
});
