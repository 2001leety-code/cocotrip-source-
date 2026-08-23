/**
 * 가이드 본문 내부 링크 — 존재하지 않는 라우트로 나가는 앵커 잠금 (2026-08-23).
 *
 * 실측한 결함: 본문 20편 안에 우리 도메인으로 가는 죽은 링크가 5개 있었다.
 *   /halal-korea ×2 · /dining · /restaurants?dietary=halal&city=seoul · /transit
 * 다섯 곳 모두 라우터에 없는 경로다(App.tsx). 읽는 사람은 404 를 받고, 크롤러는
 * 색인 대상 페이지에서 막다른 링크를 본다 — 가이드가 유입 자산이 아니라 손실이 된다.
 *
 * 🔴 정규식이 큰따옴표만 봤다면 5개 중 4개를 놓친다. 본문은 Blogger 에서 온 HTML 이라
 *    `href='...'` 작은따옴표 변형이 섞여 있다. 두 형태를 모두 스캔한다.
 *
 * 잠그는 것
 *   1) 내부 링크는 전부 INDEXABLE_ROUTES 안에 있다 (없는 경로 = 실패).
 *   2) 쿼리·해시 변형 금지 — `/restaurants?dietary=halal` 처럼 "있는 것처럼 보이는"
 *      경로가 다시 새지 않게 경로 부분만이 아니라 원문 그대로를 본다.
 *   3) cocotripkr.com 절대 URL 도 같은 규칙을 받는다 (도메인만 다른 같은 링크다).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { INDEXABLE_ROUTES, SITE_ORIGIN } from '../../src/lib/seoRoutes';

const GUIDE_DIR = path.join(process.cwd(), 'src', 'content', 'guides');

type GuideDoc = { slug: string; html: string };

const docs: GuideDoc[] = readdirSync(GUIDE_DIR)
  .filter((f) => f.endsWith('.json') && f !== '_index.json')
  .map((f) => JSON.parse(readFileSync(path.join(GUIDE_DIR, f), 'utf8')) as GuideDoc);

/** 큰따옴표·작은따옴표 양쪽 모두. 값은 따옴표를 벗겨서 원문 그대로 돌려준다. */
function hrefsOf(html: string): string[] {
  return [...html.matchAll(/href=("[^"]*"|'[^']*')/g)].map((m) => m[1].slice(1, -1));
}

/** 우리 사이트로 가는 링크인가 (루트 상대 경로 또는 대표 도메인 절대 URL). */
function isInternal(href: string): boolean {
  return href.startsWith('/') || href.startsWith(SITE_ORIGIN);
}

/** 절대 URL 이면 도메인을 벗긴다. 그 밖에는 손대지 않는다 — 쿼리·해시가 그대로 남아야 잡힌다. */
function toRoute(href: string): string {
  return href.startsWith(SITE_ORIGIN) ? href.slice(SITE_ORIGIN.length) || '/' : href;
}

const internalLinks = docs.flatMap((doc) =>
  hrefsOf(doc.html).filter(isInternal).map((href) => ({ slug: doc.slug, href })),
);

describe('가이드 본문 내부 링크', () => {
  it('스캔 대상이 실제로 존재한다 (빈 스캔이 초록으로 보이지 않게)', () => {
    expect(docs.length).toBeGreaterThan(0);
    expect(internalLinks.length).toBeGreaterThan(0);
  });

  it('모든 내부 링크가 색인 대상 경로다 — 없는 라우트로 나가지 않는다', () => {
    const dead = internalLinks.filter(({ href }) => !INDEXABLE_ROUTES.includes(toRoute(href)));
    expect(dead, `dead internal links: ${JSON.stringify(dead)}`).toEqual([]);
  });

  it('쿼리·해시가 붙은 내부 링크가 없다 (없는 필터 화면을 만들어내지 않는다)', () => {
    const withQuery = internalLinks.filter(({ href }) => /[?#]/.test(href));
    expect(withQuery, `query/hash internal links: ${JSON.stringify(withQuery)}`).toEqual([]);
  });

  it('죽었던 다섯 경로가 본문 어디에도 남아 있지 않다', () => {
    const removed = ['/halal-korea', '/dining', '/restaurants', '/transit'];
    const still = internalLinks.filter(({ href }) => removed.some((r) => toRoute(href).startsWith(r)));
    expect(still, `resurrected dead route: ${JSON.stringify(still)}`).toEqual([]);
  });

  it('가이드 → 가이드 링크는 실제 글 slug 를 가리킨다', () => {
    const slugs = new Set(docs.map((d) => d.slug));
    const bad = internalLinks
      .map(({ slug, href }) => ({ slug, href, route: toRoute(href) }))
      .filter((l) => l.route.startsWith('/guide/'))
      .filter((l) => !slugs.has(l.route.slice('/guide/'.length)));
    expect(bad, `unknown guide slug: ${JSON.stringify(bad)}`).toEqual([]);
  });

  it('자기 자신을 가리키는 본문 링크가 없다', () => {
    const self = internalLinks.filter(({ slug, href }) => toRoute(href) === `/guide/${slug}`);
    expect(self, `self link: ${JSON.stringify(self)}`).toEqual([]);
  });
});
