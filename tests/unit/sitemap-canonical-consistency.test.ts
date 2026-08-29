/**
 * 색인 경로 정합 — sitemap ↔ prerender ↔ 런타임 robots 메타 (2026-06-04 → 2026-07-30 전면 수정).
 *
 * 원래 이 파일은 "`/charter` 는 `<AuthRequired>` 로그인벽이므로 sitemap 에서 제외" 를 **강제**했다.
 * 🔴 그 전제가 사실이 아니었다. App.tsx 의 `/charter` 에는 AuthRequired 가 없고(로그인벽은
 *   `/charter-legacy`), 로그인 없이 6단계 견적까지 진행된다. 즉 테스트가 낡은 계약을 고정해
 *   자체 마진이 가장 큰 상품을 검색에서 빼 놓고 있었다. 이제 반대 방향으로 잠근다:
 *   `/charter` 는 색인 대상이며, 다시 로그인벽 뒤로 들어가면 이 테스트가 깨진다.
 *
 * 잠그는 것
 *   1) canonical 도메인 정합 (non-www)
 *   2) sitemap 목록 == src/lib/seoRoutes.ts (INDEXABLE_ROUTES) — 양방향 정확 일치
 *   3) prerender 대상이 같은 manifest 에서 파생 (목록 복사 금지)
 *   4) 색인 목록이 실제 투어 slug·지역 id 를 빠뜨리지 않음
 *   5) 개인화·인증·얇은 페이지는 noindex, 모르는 경로도 noindex(기본 거부)
 *   6) /community 는 색인 보류 (공개 글 0건)
 */
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  INDEXABLE_ROUTES,
  NOINDEX_ROUTES,
  isNoindexPath,
  sitemapUrls,
  guideCanonicalUrl,
} from '../../src/lib/seoRoutes';
import guidesIndex from '../../src/content/guides/_index.json';

const root = process.cwd();
const read = (...p: string[]) => readFileSync(join(root, ...p), 'utf8');

const sitemap = read('public', 'sitemap.xml');
const indexHtml = read('index.html');
const viteConfig = read('vite.config.ts');
const appTsx = read('src', 'App.tsx');
const toursTs = read('src', 'data', 'tours.ts');
const regionsTsx = read('src', 'sections', 'Regions.tsx');
const vercelConfig = JSON.parse(read('vercel.json')) as {
  redirects: { source: string; destination: string; permanent: boolean }[];
};
const legacyLedger = JSON.parse(read('config', 'legacy-blogger-guide-import-ledger.json')) as {
  reviews: {
    slug: string;
    decision: string;
    contentSha256: string;
    redirectTo?: string;
  }[];
};

const locs = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
const lastmods = [...sitemap.matchAll(/<url><loc>([^<]+)<\/loc><lastmod>([^<]+)<\/lastmod><\/url>/g)]
  .map((match) => [match[1], match[2]] as const);

describe('sitemap canonical 도메인 정합', () => {
  it('canonical 은 non-www (cocotripkr.com)', () => {
    expect(indexHtml).toMatch(/rel="canonical"\s+href="https:\/\/cocotripkr\.com/);
  });

  it('index.html 기본 robots 는 index (noindex 는 라우트별로 App.tsx 가 덮는다)', () => {
    expect(indexHtml).toMatch(/name="robots"\s+content="index/);
    expect(appTsx).toContain('isNoindexPath');
    expect(appTsx).toContain('pageMetaRobotsOverride');
  });

  it('모든 <loc> 이 non-www 도메인 (canonical 과 동일) — www 재유입 방지', () => {
    for (const loc of locs) {
      expect(loc, `${loc} 가 www 또는 다른 도메인`).toMatch(/^https:\/\/cocotripkr\.com(\/|$)/);
      expect(loc).not.toMatch(/www\./);
    }
  });

  it('모든 가이드의 대표 원문은 cocotripkr.com/guide 이고 sitemap 에 있다', () => {
    expect(locs).toContain(guideCanonicalUrl());
    for (const guide of guidesIndex) {
      const canonical = guideCanonicalUrl(guide.slug);
      expect(canonical).toMatch(/^https:\/\/cocotripkr\.com\/guide\/[a-z0-9-]+$/);
      expect(locs).toContain(canonical);
    }
  });
});

describe('sitemap ↔ 색인 manifest 일치', () => {
  it('sitemap 목록과 INDEXABLE_ROUTES 가 정확히 같다 (누락·잉여 0)', () => {
    expect([...locs].sort()).toEqual([...sitemapUrls()].sort());
  });

  it('중복 <loc> 없음', () => {
    expect(new Set(locs).size).toBe(locs.length);
  });

  it('lastmod 는 2026-08-29에 본문을 크게 고친 18개에만 정확히 둔다', () => {
    const changed = [
      '/guide/how-weak-won-makes-korea-cheaper-for',
      '/guide/best-temple-stays-in-korea-2026-guide',
      '/guide/korea-sim-card-vs-esim-vs-pocket-wifi',
      '/guide/seoul-k-beauty-shopping-2026-olive',
      '/guide/incheon-to-seoul-late-night-arex-bus-t',
      '/tours',
      '/tours/seoul-city-full-day',
      '/tours/incheon-ganghwa-tour',
      '/tours/dmz-paju-tour',
      '/tours/gyeongju-day-tour',
      '/tours/busan-day-tour',
      '/region/paju',
      '/region/ganghwa',
      '/region/busan',
      '/region/danyang',
      '/region/incheon',
      '/region/gyeongju',
      '/region/jeonju',
    ].map((path) => `https://cocotripkr.com${path}`);

    expect(lastmods).toEqual(changed.map((url) => [url, '2026-08-29']));
  });

  it('changefreq·priority 는 쓰지 않는다 (구글이 무시 — 조치했다는 착시 방지)', () => {
    expect(sitemap).not.toContain('<changefreq>');
    expect(sitemap).not.toContain('<priority>');
  });
});

describe('중복 서울 카페 guide URL 신호 통합', () => {
  const retired = '4-seoul-cafe-neighborhoods-worth-your';
  const survivor = 'seoul-cafe-guide-2026-best';
  const retiredPath = `/guide/${retired}`;

  it('옛 URL은 파일·검색 목록·sitemap에서 빠지고 생존 URL은 그대로 남는다', () => {
    expect(existsSync(join(root, 'src', 'content', 'guides', `${retired}.json`))).toBe(false);
    expect(guidesIndex.some((guide) => guide.slug === retired)).toBe(false);
    expect(INDEXABLE_ROUTES).not.toContain(retiredPath);
    expect(locs).not.toContain(guideCanonicalUrl(retired));
    expect(guidesIndex.some((guide) => guide.slug === survivor)).toBe(true);
    expect(locs).toContain(guideCanonicalUrl(survivor));
  });

  it('Vercel permanent redirect와 legacy 재수입 거부 ledger가 같은 생존 URL을 가리킨다', () => {
    expect(vercelConfig.redirects).toContainEqual({
      source: retiredPath,
      destination: guideCanonicalUrl(survivor),
      permanent: true,
    });
    const review = legacyLedger.reviews.find((entry) => entry.slug === retired);
    expect(review).toMatchObject({
      decision: 'rejected',
      contentSha256: '126753c24691afef663d3e8d8e470f479b6fdcdce75a98e1593b450337af7a0b',
      redirectTo: guideCanonicalUrl(survivor),
    });
  });
});

describe('prerender ↔ 같은 manifest', () => {
  it('vite.config 가 manifest 를 import 해서 프리렌더 경로로 쓴다', () => {
    expect(viteConfig).toMatch(/import\s+\{\s*INDEXABLE_ROUTES\s*\}\s+from\s+["']\.\/src\/lib\/seoRoutes["']/);
    expect(viteConfig).toContain('const PRERENDER_ROUTES = [...INDEXABLE_ROUTES]');
  });

  it('vite.config 에 경로 목록을 다시 적어 두지 않는다', () => {
    // '/tours/...' 같은 라우트 리터럴이 config 에 직접 있으면 두 벌 관리로 되돌아간 것.
    expect(viteConfig).not.toMatch(/'\/tours\//);
    expect(viteConfig).not.toMatch(/'\/region\//);
  });
});

describe('/charter — 공개 라우트이므로 색인 대상', () => {
  it('sitemap 에 /charter 가 있다', () => {
    expect(locs).toContain('https://cocotripkr.com/charter');
  });

  it('/charter 는 noindex 가 아니다', () => {
    expect(isNoindexPath('/charter')).toBe(false);
  });

  it('App.tsx 의 /charter 라우트에 AuthRequired 가 없다 (로그인벽 회귀 차단)', () => {
    // path="/charter" 블록만 잘라서 확인 — 뒤따르는 /charter-legacy 는 AuthRequired 가 정상.
    const idx = appTsx.indexOf('path="/charter"');
    expect(idx).toBeGreaterThan(-1);
    const block = appTsx.slice(idx, appTsx.indexOf('path="/charter-new"'));
    expect(block).not.toContain('AuthRequired');
  });

  it('/charter 무JS 본문용 공개 정보 섹션이 페이지에 마운트돼 있다', () => {
    const page = read('src', 'pages', 'CharterNewPage.tsx');
    expect(page).toContain('<CharterSeoInfo');
  });

  it('공개 정보 섹션은 h1 을 만들지 않는다 (페이지 h1 은 1개 유지)', () => {
    const seo = read('src', 'components', 'charter', 'CharterSeoInfo.tsx');
    expect(seo).not.toMatch(/<h1[\s>]/);
    expect(seo).toMatch(/<h2/);
  });

  it('숨은 텍스트·키워드 나열용 스타일이 없다', () => {
    const seo = read('src', 'components', 'charter', 'CharterSeoInfo.tsx');
    expect(seo).not.toMatch(/display:\s*['"]?none/);
    expect(seo).not.toMatch(/visibility:\s*['"]?hidden/);
    expect(seo).not.toMatch(/sr-only/);
  });
});

describe('색인 목록이 실제 공개 콘텐츠를 빠뜨리지 않는다', () => {
  it('tours.ts 의 모든 slug 가 색인 대상', () => {
    const slugs = [...toursTs.matchAll(/slug:\s*'([a-z0-9-]+)'/g)].map((m) => m[1]);
    expect(slugs.length).toBeGreaterThan(0);
    for (const s of slugs) {
      expect(INDEXABLE_ROUTES, `/tours/${s} 누락`).toContain(`/tours/${s}`);
    }
  });

  it('Regions.tsx 의 모든 지역 id 가 색인 대상', () => {
    const ids = [...regionsTsx.matchAll(/\{\s*id:\s*'([a-z-]+)',\s*image:/g)].map((m) => m[1]);
    expect(ids.length).toBeGreaterThan(0);
    for (const id of ids) {
      expect(INDEXABLE_ROUTES, `/region/${id} 누락`).toContain(`/region/${id}`);
    }
  });
});

describe('noindex 계약', () => {
  it('색인 목록의 경로는 전부 index', () => {
    for (const r of INDEXABLE_ROUTES) {
      expect(isNoindexPath(r), `${r} 가 noindex 로 잡힌다`).toBe(false);
    }
  });

  it('개인화·인증·도구성 경로는 noindex (하위 경로 포함)', () => {
    for (const r of NOINDEX_ROUTES) {
      expect(isNoindexPath(r), `${r}`).toBe(true);
      expect(isNoindexPath(`${r}/anything`), `${r}/anything`).toBe(true);
    }
  });

  it('명시 요구 경로 확인 — /map · /mypage · /my-plans · /mood · /community/new', () => {
    for (const r of ['/map', '/mypage', '/my-plans', '/mood', '/community/new']) {
      expect(isNoindexPath(r), r).toBe(true);
    }
  });

  it('모르는 경로(404 포함)는 noindex — 기본 거부', () => {
    expect(isNoindexPath('/no-such-page')).toBe(true);
    expect(isNoindexPath('/tours/not-a-real-slug')).toBe(true);
    expect(isNoindexPath('/region/atlantis')).toBe(true);
  });

  it('끝 슬래시·쿼리스트링이 판정을 바꾸지 않는다', () => {
    expect(isNoindexPath('/charter/')).toBe(false);
    expect(isNoindexPath('/charter?origin=ICN')).toBe(false);
    expect(isNoindexPath('/mypage/')).toBe(true);
  });
});

describe('/community — 색인 보류', () => {
  it('sitemap 에 /community 계열이 없다', () => {
    expect(locs.some((l) => /\/community(\/|$)/.test(l))).toBe(false);
  });

  it('/community 와 하위 경로는 noindex', () => {
    expect(isNoindexPath('/community')).toBe(true);
    expect(isNoindexPath('/community/post/abc123')).toBe(true);
    expect(isNoindexPath('/community/new')).toBe(true);
  });
});

describe('hreflang — 언어별 URL 이 없으므로 넣지 않는다', () => {
  it('sitemap·index.html 에 hreflang 태그가 없다 (주석의 설명 텍스트는 무관)', () => {
    expect(sitemap).not.toMatch(/hreflang=/);
    expect(indexHtml).not.toMatch(/<link[^>]*hreflang=/);
  });
});
