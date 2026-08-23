// @vitest-environment jsdom
/**
 * 가이드 상세 → 다른 가이드 (2026-08-23).
 *
 * 실측한 결함: 상세 20편에 글끼리 잇는 링크가 **0개**였다. 목록에서 들어온 크롤러는
 * 글 하나만 읽고 나가고, 사람도 그 글에서 멈춘다.
 *
 * 잠그는 것
 *   1) 20편 전부 주제표에 있다 — 새 글이 들어오면 여기서 빨개진다(조용한 빈 섹션 금지).
 *   2) 모든 글이 2~3편을 받는다. 자기 자신·중복·주제 안 겹치는 글은 나오지 않는다.
 *   3) 순서가 결정론이다 — 같은 입력이면 항상 같은 출력(무작위·시간 의존 없음).
 *   4) 화면에는 평범한 `<a href="/guide/...">` 로 나온다(프리렌더 HTML 에 실려야 한다).
 *   5) 4개 언어 모두 섹션 제목 문구를 갖는다.
 */
import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

import { GuideArticleBody } from '../../src/sections/guide/GuideArticleBody';
import { GUIDE_COPY, type GuideDoc, type GuideMeta } from '../../src/sections/guide/guideCopy';
import {
  GUIDE_TOPICS,
  RELATED_LIMIT,
  pickRelatedGuides,
} from '../../src/sections/guide/relatedGuides';
import guidesIndexRaw from '../../src/content/guides/_index.json';

void React;

const GUIDES = guidesIndexRaw as GuideMeta[];
const LANGS = ['en', 'ko', 'ja', 'zh'] as const;

describe('관련 가이드 선정', () => {
  it('목록의 모든 글이 주제표에 있다', () => {
    const missing = GUIDES.filter((g) => !GUIDE_TOPICS[g.slug]).map((g) => g.slug);
    expect(missing, `주제 미분류: ${missing.join(', ')}`).toEqual([]);
  });

  it('주제표에 목록에 없는 slug 가 없다 (지운 글이 유령으로 남지 않게)', () => {
    const known = new Set(GUIDES.map((g) => g.slug));
    const orphan = Object.keys(GUIDE_TOPICS).filter((slug) => !known.has(slug));
    expect(orphan, `유령 slug: ${orphan.join(', ')}`).toEqual([]);
  });

  it('모든 글이 2~3편을 받는다', () => {
    for (const guide of GUIDES) {
      const related = pickRelatedGuides(guide.slug, GUIDES);
      expect(related.length, `${guide.slug} related count`).toBeGreaterThanOrEqual(2);
      expect(related.length, `${guide.slug} related count`).toBeLessThanOrEqual(RELATED_LIMIT);
    }
  });

  it('자기 자신·중복이 없고, 주제를 하나 이상 공유한다', () => {
    for (const guide of GUIDES) {
      const related = pickRelatedGuides(guide.slug, GUIDES);
      const slugs = related.map((r) => r.slug);
      expect(slugs, `${guide.slug} self link`).not.toContain(guide.slug);
      expect(new Set(slugs).size, `${guide.slug} duplicate`).toBe(slugs.length);
      const own = new Set(GUIDE_TOPICS[guide.slug]);
      for (const r of related) {
        const shared = GUIDE_TOPICS[r.slug].filter((topic) => own.has(topic));
        expect(shared.length, `${guide.slug} → ${r.slug} shared topics`).toBeGreaterThan(0);
      }
    }
  });

  it('순서가 결정론이다 — 입력 순서를 뒤집어도 같은 결과', () => {
    for (const guide of GUIDES) {
      const forward = pickRelatedGuides(guide.slug, GUIDES).map((r) => r.slug);
      const reversed = pickRelatedGuides(guide.slug, [...GUIDES].reverse()).map((r) => r.slug);
      expect(reversed, `${guide.slug} order`).toEqual(forward);
    }
  });

  it('입력에 같은 글이 두 번 있어도 한 번만 나온다', () => {
    const slug = GUIDES[0].slug;
    const doubled = pickRelatedGuides(slug, [...GUIDES, ...GUIDES]).map((r) => r.slug);
    expect(new Set(doubled).size).toBe(doubled.length);
  });

  it('주제표에 없는 slug 는 빈 배열 — 채우려고 지어내지 않는다', () => {
    expect(pickRelatedGuides('no-such-guide', GUIDES)).toEqual([]);
    expect(pickRelatedGuides(undefined, GUIDES)).toEqual([]);
  });

  it('네 언어 모두 섹션 제목이 있다', () => {
    for (const lang of LANGS) {
      expect(GUIDE_COPY[lang].article.related.trim().length, `${lang} related label`).toBeGreaterThan(0);
    }
  });
});

const doc = (over: Partial<GuideDoc> = {}): GuideDoc => ({
  slug: 'seoul-cafe-guide-2026-best',
  title: 'Seoul Cafe Guide 2026',
  description: 'Where to drink coffee in Seoul, by neighbourhood.',
  published: '2026-07-14',
  updated: '2026-07-26',
  labels: ['Seoul Cafes'],
  words: 981,
  html: '<p>Body text.</p>',
  ...over,
});

describe('관련 가이드 렌더', () => {
  it('평범한 앵커로 그린다 — href 가 /guide/<slug>', () => {
    const related = pickRelatedGuides('seoul-cafe-guide-2026-best', GUIDES);
    render(
      <MemoryRouter>
        <GuideArticleBody copy={GUIDE_COPY.en} status="ready" doc={doc()} related={related} />
      </MemoryRouter>,
    );
    const nav = screen.getByRole('navigation', { name: GUIDE_COPY.en.article.related });
    const links = within(nav).getAllByRole('link');
    expect(links.length).toBe(related.length);
    links.forEach((link, i) => {
      expect(link.getAttribute('href')).toBe(`/guide/${related[i].slug}`);
      expect(link.textContent).toContain(related[i].title);
    });
  });

  it('관련 글이 없으면 섹션 자체를 그리지 않는다', () => {
    render(
      <MemoryRouter>
        <GuideArticleBody copy={GUIDE_COPY.en} status="ready" doc={doc()} related={[]} />
      </MemoryRouter>,
    );
    expect(screen.queryByRole('navigation', { name: GUIDE_COPY.en.article.related })).toBeNull();
  });

  it('본문이 아직 없는 상태에서는 관련 글도 그리지 않는다', () => {
    render(
      <MemoryRouter>
        <GuideArticleBody
          copy={GUIDE_COPY.en}
          status="loading"
          doc={null}
          related={pickRelatedGuides('seoul-cafe-guide-2026-best', GUIDES)}
        />
      </MemoryRouter>,
    );
    expect(screen.queryByRole('navigation', { name: GUIDE_COPY.en.article.related })).toBeNull();
  });
});
