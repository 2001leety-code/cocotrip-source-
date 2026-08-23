// @vitest-environment jsdom

import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, waitFor } from '@testing-library/react';

const usePageMetaMock = vi.hoisted(() => vi.fn());
const useJsonLdMock = vi.hoisted(() => vi.fn());
const sanitizeGuideHtmlMock = vi.hoisted(() => vi.fn((html: string) => html));
const guideArticleBodyMock = vi.hoisted(() => vi.fn());
const routeParams = vi.hoisted(() => ({ slug: 'best-seoul-street-food-markets-2026' }));

vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return { ...actual, useParams: () => routeParams };
});
vi.mock('@/hooks/useLanguage', () => ({
  useLanguage: () => ({ language: 'en', t: (key: string) => key, changeLanguage: vi.fn() }),
}));
vi.mock('@/hooks/usePageMeta', () => ({ usePageMeta: usePageMetaMock }));
vi.mock('@/hooks/useJsonLd', () => ({ useJsonLd: useJsonLdMock }));
vi.mock('@/lib/sanitizeGuideHtml', () => ({ sanitizeGuideHtml: sanitizeGuideHtmlMock }));
vi.mock('@/sections/Header', () => ({ Header: () => null }));
vi.mock('@/sections/Footer', () => ({ Footer: () => null }));
vi.mock('@/sections/guide/GuideIndexBody', () => ({ GuideIndexBody: () => null }));
vi.mock('@/sections/guide/GuideArticleBody', () => ({
  GuideArticleBody: (props: unknown) => {
    guideArticleBodyMock(props);
    return null;
  },
}));

import GuideIndexPage, { GuideDetailPage } from '../../src/pages/GuidePage';

describe('가이드 대표 원문 메타 배선', () => {
  beforeEach(() => {
    usePageMetaMock.mockClear();
    useJsonLdMock.mockClear();
    sanitizeGuideHtmlMock.mockClear();
    sanitizeGuideHtmlMock.mockImplementation((html: string) => html);
    guideArticleBodyMock.mockClear();
    routeParams.slug = 'best-seoul-street-food-markets-2026';
  });

  it('/guide 목록은 자기 URL을 canonical/og:url 로 쓴다', () => {
    render(<GuideIndexPage />);
    expect(usePageMetaMock).toHaveBeenCalledWith(expect.objectContaining({
      ogUrl: 'https://cocotripkr.com/guide',
    }));
  });

  it('상세는 같은 cocotripkr.com URL을 canonical과 Article @id에 쓴다', async () => {
    const canonical = 'https://cocotripkr.com/guide/best-seoul-street-food-markets-2026';
    render(<GuideDetailPage />);

    await waitFor(() => {
      expect(usePageMetaMock).toHaveBeenCalledWith(expect.objectContaining({
        ogUrl: canonical,
        contentSha256: undefined,
        robots: 'index, follow',
      }));
    });
    await waitFor(() => {
      expect(useJsonLdMock).toHaveBeenCalledWith(
        'guide-article',
        expect.objectContaining({
          mainEntityOfPage: expect.objectContaining({ '@id': canonical }),
          dateModified: '2026-08-23',
        }),
      );
    });
  });

  it('known detail 로딩은 목록 canonical로 바꾸지 않고 self-canonical + noindex를 쓴다', () => {
    const canonical = 'https://cocotripkr.com/guide/best-seoul-street-food-markets-2026';
    render(<GuideDetailPage />);
    expect(usePageMetaMock.mock.calls[0][0]).toEqual(expect.objectContaining({
      title: 'Seoul Night Markets & Street Food 2026: Gwangjang, Myeongdong, Mangwon',
      ogUrl: canonical,
      contentSha256: undefined,
      robots: 'noindex, nofollow',
    }));
    expect(useJsonLdMock).toHaveBeenCalledWith('guide-article', null);
  });

  it('sanitizer 결과가 비면 error UI로 닫고 정상 글 SEO/hash를 내지 않는다', async () => {
    sanitizeGuideHtmlMock.mockReturnValue('   ');
    const canonical = 'https://cocotripkr.com/guide/best-seoul-street-food-markets-2026';
    render(<GuideDetailPage />);

    await waitFor(() => {
      expect(guideArticleBodyMock).toHaveBeenLastCalledWith(expect.objectContaining({
        status: 'error',
        doc: null,
      }));
    });
    expect(usePageMetaMock).toHaveBeenLastCalledWith(expect.objectContaining({
      ogUrl: canonical,
      contentSha256: undefined,
      robots: 'noindex, nofollow',
    }));
    const articleCalls = useJsonLdMock.mock.calls.filter(([id]) => id === 'guide-article');
    expect(articleCalls.at(-1)?.[1]).toBeNull();
  });
});
