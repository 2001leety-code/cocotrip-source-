// @vitest-environment jsdom
/**
 * /guide 목록 · /guide/:slug 상세 — 렌더 계약 (2026-08-11).
 *
 * 전환 전 실측한 것 중 눈으로는 잘 안 보이는 것들만 여기서 잡는다:
 *   · 상세는 청크가 오는 동안 빈 화면이었다 — 스크린리더에도 아무 신호가 없었다.
 *   · 청크 로드 실패가 "글 없음" 으로 흘러 재시도 경로 자체가 없었다.
 *   · 목록이 비면 빈 그리드만 남았다 (막다른 길).
 *   · 없는 값(사진·주제·낱말 수)이 있는 척 그려지면 안 된다 — 빈칸/0분/undefined 금지.
 *
 * 본문(sections/guide/*)은 firebase·라우팅·데이터 로딩을 모르는 순수 컴포넌트라
 * 목킹 없이 그대로 렌더한다. 로딩·에러 분기는 GuidePage 가 상태로 넘긴다.
 */
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

import { GuideIndexBody } from '../../src/sections/guide/GuideIndexBody';
import { GuideArticleBody } from '../../src/sections/guide/GuideArticleBody';
import { GUIDE_COPY, readingMinutes, type GuideMeta, type GuideDoc } from '../../src/sections/guide/guideCopy';

void React;

const copy = GUIDE_COPY.en;

const meta = (over: Partial<GuideMeta> = {}): GuideMeta => ({
  slug: 'seoul-cafe-guide-2026-best',
  title: 'Seoul Cafe Guide 2026',
  description: 'Where to drink coffee in Seoul, by neighbourhood.',
  published: '2026-07-14',
  updated: '2026-07-26',
  labels: ['Seoul Cafes', 'Korea Coffee Culture', 'Travel Korea 2026', 'Extra Topic'],
  image: 'https://cocotripkr.com/blog-images/2026/seoul-cafe-guide-1.webp',
  words: 1140,
  ...over,
});

const doc = (over: Partial<GuideDoc> = {}): GuideDoc => ({
  ...meta(),
  html: '<p class="post-summary"><em>Lead paragraph.</em></p><h2>Seongsu</h2><p>Body text.</p>',
  ...over,
});

const renderIndex = (guides: GuideMeta[]) =>
  render(
    <MemoryRouter>
      <GuideIndexBody copy={copy} guides={guides} />
    </MemoryRouter>,
  );

const renderArticle = (props: Partial<React.ComponentProps<typeof GuideArticleBody>> = {}) =>
  render(
    <MemoryRouter>
      <GuideArticleBody copy={copy} status="ready" doc={doc()} {...props} />
    </MemoryRouter>,
  );

describe('/guide 목록', () => {
  it('제목은 h1 하나, 각 글은 /guide/<slug> 로 간다', () => {
    renderIndex([meta(), meta({ slug: 'second', title: 'Second Guide' })]);
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByRole('link', { name: /Seoul Cafe Guide 2026/ })).toHaveAttribute(
      'href',
      '/guide/seoul-cafe-guide-2026-best',
    );
    expect(screen.getByRole('link', { name: /Second Guide/ })).toHaveAttribute('href', '/guide/second');
  });

  it('개수와 최신 갱신일은 실제 데이터에서 나온다 (박제 금지)', () => {
    renderIndex([meta(), meta({ slug: 'b', title: 'B', updated: '2026-08-06' })]);
    const count = copy.index.count.replace('{n}', '2').replace('{date}', '2026-08-06');
    expect(screen.getByText(count)).toBeInTheDocument();
  });

  // 동일 카드 반복이 아니라 리드 1편 + 목록. 리드는 더 큰 표제(h2)와 큰 사진을 갖는다.
  it('첫 글은 리드 모듈, 나머지는 행 목록 — 같은 카드 반복이 아니다', () => {
    const { container } = renderIndex([meta(), meta({ slug: 'b', title: 'B' }), meta({ slug: 'c', title: 'C' })]);
    const lead = container.querySelector('[data-guide-lead]');
    expect(lead).toBeTruthy();
    expect(within(lead as HTMLElement).getByRole('heading', { level: 2 })).toHaveTextContent('Seoul Cafe Guide 2026');
    expect(container.querySelectorAll('[data-guide-row]')).toHaveLength(2);
  });

  it('사진은 장식이라 접근성 트리에서 빠진다 (제목이 링크 이름을 만든다)', () => {
    const { container } = renderIndex([meta()]);
    const img = container.querySelector('img')!;
    expect(img).toHaveAttribute('alt', '');
    expect(img).toHaveAttribute('loading', 'lazy');
    expect(img.getAttribute('src')).toBe(meta().image);
  });

  it('빈 목록은 막다른 길이 아니라 갈 곳을 준다', () => {
    renderIndex([]);
    expect(screen.getByText(copy.index.empty.title)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: copy.index.empty.cta })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Seoul Cafe Guide/ })).toBeNull();
  });

  it('없는 값은 그리지 않는다 — 사진·주제·읽는 시간 부분 결손', () => {
    const { container } = renderIndex([meta({ image: undefined, labels: [], words: undefined })]);
    expect(container.querySelector('img')).toBeNull();
    expect(container.textContent).not.toMatch(/undefined|NaN/);
    // "0 min read" 같은 빈 껍데기가 남으면 안 된다.
    expect(container.textContent).not.toMatch(/\b0\s*(min|분)/);
  });

  it('주제 칩은 최대 3개까지만 — 라벨 10개짜리 글이 행을 무너뜨리지 않는다', () => {
    const { container } = renderIndex([meta()]);
    expect(container.querySelectorAll('[data-guide-topic]')).toHaveLength(3);
  });
});

describe('/guide/:slug 상태', () => {
  it('로딩: 스크린리더에 진행 중이라고 말한다 (전환 전에는 완전한 빈 화면)', () => {
    renderArticle({ status: 'loading', doc: null });
    const region = screen.getByRole('status');
    expect(region).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByText(copy.article.loading)).toBeInTheDocument();
    // 껍데기에 글 제목을 미리 그리지 않는다. 대신 h1 은 섹션 이름을 들고 있어야
    // 문서에 최상위 제목 없이 h2 만 뜨는 상태가 안 된다.
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(copy.index.title);
  });

  it('오류: 재시도 버튼이 실제로 다시 부른다 + 목록으로 나갈 길', async () => {
    const onRetry = vi.fn();
    renderArticle({ status: 'error', doc: null, onRetry });
    expect(screen.getByText(copy.article.error.title)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: copy.article.error.retry }));
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(screen.getAllByRole('link', { name: copy.article.back }).length).toBeGreaterThan(0);
  });

  it('글 없음: 재시도가 아니라 목록으로 — 다시 불러봐야 없다', () => {
    renderArticle({ status: 'missing', doc: null, onRetry: () => {} });
    expect(screen.getByText(copy.article.notFound.title)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: copy.article.error.retry })).toBeNull();
  });
});

describe('/guide/:slug 본문', () => {
  it('제목은 h1, 본문 HTML 은 .ec-prose 안에 들어간다', () => {
    const { container } = renderArticle();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Seoul Cafe Guide 2026');
    const prose = container.querySelector('.ec-prose')!;
    expect(prose.innerHTML).toContain('<h2>Seongsu</h2>');
  });

  it('본문이 영어라는 사실을 UI 언어로 말한다', () => {
    renderArticle();
    expect(screen.getByText(copy.article.bodyLanguage)).toBeInTheDocument();
  });

  it('갱신일·읽는 시간은 실제 값에서 — {date}/{n} 자리표시자가 화면에 새지 않는다', () => {
    const { container } = renderArticle({ words: 1140 });
    expect(screen.getByText(copy.article.updated.replace('{date}', '2026-07-26'))).toBeInTheDocument();
    expect(
      screen.getByText(copy.readTime.replace('{n}', String(readingMinutes(1140)))),
    ).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/\{date\}|\{n\}/);
  });

  // 가격·운행시간은 우리가 실시간으로 알 수 없다. 지어낸 출처 대신 "언제 기준인지" 를 말한다.
  it('갱신 확인 안내가 그 글의 실제 갱신일을 달고 나간다', () => {
    renderArticle();
    expect(screen.getByText(copy.article.freshness.replace('{date}', '2026-07-26'))).toBeInTheDocument();
  });

  it('부분 결손: 주제·갱신일·낱말 수가 없으면 그 줄 자체를 그리지 않는다', () => {
    const { container } = renderArticle({
      doc: doc({ labels: [], updated: '' }),
      words: undefined,
    });
    expect(container.textContent).not.toMatch(/undefined|NaN|\{date\}|\{n\}/);
    expect(screen.queryByText(new RegExp(copy.article.freshness.split('{date}')[0].trim()))).toBeNull();
    expect(screen.queryByText(new RegExp(copy.readTime.split('{n}')[1].trim()))).toBeNull();
  });
});
