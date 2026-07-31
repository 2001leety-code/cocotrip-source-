/**
 * 서버 원문의 noindex 와 진짜 404 (2026-07-30, P1-4).
 *
 * 🔴 운영 실측으로 잡힌 사고: `/community`, `/map`, 그리고 **존재하지도 않는 경로**가 전부
 *   HTTP 200 + 홈 HTML 이었다. 원문에는 `robots: index, follow` 와 `canonical: /` 가 박혀 있으니
 *   검색엔진에는 "존재하는 페이지가 무한히 많고 전부 홈과 같은 내용" 으로 보였다.
 *   원인은 `vercel.json` 의 폴백 한 줄 — `/((?!api/).*)` → `/index.html` 이 전부를 삼켰다.
 *   런타임 `<meta robots>` 는 JS 가 돈 뒤에야 붙으므로, 원문만 받는 크롤러에게는 없는 것과 같다.
 *
 * 이 파일은 **경로 매칭 규칙 자체**를 잠근다(배포 후 실측은 별도).
 *   - 색인 제외 경로 → X-Robots-Tag 헤더 대상
 *   - 앱에 실제로 있는 라우트 → index.html (SPA 깊은 링크 유지)
 *   - 그 외 → /api/not-found (진짜 404)
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { INDEXABLE_ROUTES, NOINDEX_ROUTES } from '../../src/lib/seoRoutes';
import guidesIndex from '../../src/content/guides/_index.json';

const vercel = JSON.parse(readFileSync(join(process.cwd(), 'vercel.json'), 'utf8'));
const appSrc = readFileSync(join(process.cwd(), 'src/App.tsx'), 'utf8');

/**
 * Vercel 의 `source` 는 path-to-regexp 문법이다. 여기서는 이 레포가 실제로 쓰는 형태
 * (`/(a|b)`, `/(a|b)(/.*)?`, `/:param`, `/((?!api/).*)`, 리터럴)만 정규식으로 옮긴다.
 */
function sourceToRegExp(source) {
  let out = '';
  let i = 0;
  while (i < source.length) {
    const ch = source[i];
    if (ch === '(') {
      // 괄호 그룹은 그대로 쓴다(내부가 이미 정규식). 짝 맞는 닫는 괄호까지.
      let depth = 0;
      let j = i;
      for (; j < source.length; j++) {
        if (source[j] === '(') depth++;
        else if (source[j] === ')') { depth--; if (depth === 0) break; }
      }
      let group = source.slice(i, j + 1);
      i = j + 1;
      if (source[i] === '?') { group += '?'; i++; }
      out += group;
      continue;
    }
    if (ch === ':') {
      // `/:name` → 한 세그먼트
      let j = i + 1;
      while (j < source.length && /[A-Za-z0-9_]/.test(source[j])) j++;
      out += '[^/]+';
      i = j;
      continue;
    }
    out += ch.replace(/[.+^${}|[\]\\]/g, '\\$&');
    i++;
  }
  return new RegExp(`^${out}$`);
}

function firstMatchingRewrite(pathname) {
  for (const r of vercel.rewrites) {
    if (sourceToRegExp(r.source).test(pathname)) return r;
  }
  return null;
}

function headerValueFor(pathname, key) {
  for (const h of vercel.headers) {
    if (!sourceToRegExp(h.source).test(pathname)) continue;
    const found = h.headers.find((x) => x.key.toLowerCase() === key.toLowerCase());
    if (found) return found.value;
  }
  return null;
}

/** `/tours/:slug` 같은 라우트 패턴을 실제 URL 하나로 바꾼다. */
function sampleUrl(routePattern) {
  return routePattern.replace(/:[A-Za-z0-9_]+/g, 'sample-value');
}

describe('색인 제외 경로 — 원문 헤더에 noindex, nofollow', () => {
  for (const route of NOINDEX_ROUTES) {
    it(`${route} 에 X-Robots-Tag 가 붙는다`, () => {
      expect(headerValueFor(route, 'X-Robots-Tag')).toBe('noindex, nofollow');
    });

    it(`${route} 하위 경로에도 붙는다`, () => {
      expect(headerValueFor(`${route}/anything/deep`, 'X-Robots-Tag')).toBe('noindex, nofollow');
    });
  }

  it('🔴 운영에서 잡힌 두 경로 — /community · /map', () => {
    expect(headerValueFor('/community', 'X-Robots-Tag')).toBe('noindex, nofollow');
    expect(headerValueFor('/map', 'X-Robots-Tag')).toBe('noindex, nofollow');
  });

  it('색인 허용 경로에는 noindex 가 붙지 않는다', () => {
    for (const route of INDEXABLE_ROUTES) {
      expect(headerValueFor(route, 'X-Robots-Tag'), `${route} 가 잘못 noindex 됐다`).toBeNull();
    }
  });

  it('런타임 메타도 같은 문구를 쓴다 (헤더와 어긋나면 신호가 충돌)', () => {
    expect(appSrc).toMatch(/'noindex, nofollow' : 'index, follow'/);
  });
});

describe('SPA 깊은 링크 — 앱에 있는 라우트는 전부 index.html', () => {
  const routePatterns = [...new Set(
    (appSrc.match(/path="([^"]+)"/g) || [])
      .map((m) => m.slice(6, -1))
      .filter((p) => p !== '*'),
  )];

  it('App.tsx 에서 라우트를 실제로 읽어 왔다 (파싱 실패 방지)', () => {
    expect(routePatterns.length).toBeGreaterThan(40);
    expect(routePatterns).toContain('/charter');
    expect(routePatterns).toContain('/tours/:slug');
  });

  for (const pattern of routePatterns) {
    it(`${pattern} → index.html`, () => {
      const url = sampleUrl(pattern);
      const hit = firstMatchingRewrite(url);
      expect(hit, `${url} 에 매칭되는 rewrite 가 없다`).not.toBeNull();
      expect(hit.destination, `${url} 이 404 로 떨어진다 — SPA 깊은 링크가 깨진다`).toBe('/index.html');
    });
  }

  it('색인 허용 경로 전부 index.html (프리렌더·sitemap 유지)', () => {
    // 기본 26 + 가이드(/guide + 글 수, 2026-08-01 blogspot 이식). 글 목록에서 파생 —
    // 새 글 동기화 때 이 숫자를 손으로 고치는 함정 방지.
    expect(INDEXABLE_ROUTES.length).toBe(26 + 1 + guidesIndex.length);
    for (const route of INDEXABLE_ROUTES) {
      expect(firstMatchingRewrite(route).destination, `${route}`).toBe('/index.html');
    }
  });
});

describe('존재하지 않는 경로 — 진짜 404', () => {
  const UNKNOWN = [
    '/this-page-does-not-exist',
    '/nope',
    '/tours-typo',
    '/charterr',
    '/wp-admin',
    '/index.php',
    '/aaa/bbb/ccc',
  ];

  for (const url of UNKNOWN) {
    it(`${url} → /api/not-found`, () => {
      const hit = firstMatchingRewrite(url);
      expect(hit).not.toBeNull();
      expect(hit.destination, `${url} 이 아직 홈 HTML 로 200 을 준다`).toBe('/api/not-found');
    });
  }

  it('/api/* 는 폴백에 걸리지 않는다 (기존 API 보존)', () => {
    const hit = firstMatchingRewrite('/api/createPaypalOrder');
    expect(hit).toBeNull();
  });

  it('404 핸들러가 실제로 404 + noindex 를 낸다', () => {
    const code = readFileSync(join(process.cwd(), 'api/not-found.js'), 'utf8');
    expect(code).toMatch(/res\.writeHead\(404,/);
    expect(code).toMatch(/'X-Robots-Tag': 'noindex, nofollow'/);
    expect(code).toMatch(/name="robots" content="noindex, nofollow"/);
  });

  it('🔴 옛 전면 폴백(모든 경로 → index.html)이 남아 있지 않다', () => {
    const catchAll = vercel.rewrites.find((r) => r.source === '/((?!api/).*)');
    expect(catchAll).toBeTruthy();
    expect(catchAll.destination, '전면 폴백이 되살아나면 soft 404 가 전부 재발한다')
      .toBe('/api/not-found');
  });
});
