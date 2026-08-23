/**
 * 구조화 데이터 빌더 (2026-08-01, 유입 묶음 D).
 *
 * 지키려는 것 — 구글에 **화면에 없는 것**이나 **빈 껍데기**를 보내지 않기:
 *   · 항목 0개인 FAQPage 를 내보내지 않는다(스팸 신호).
 *   · 상대경로 이미지·URL 은 절대 URL 로 바꾼다(크롤러가 상대경로를 못 푼다).
 *   · Article 의 dateModified 는 모르면 datePublished 로 — 빌드 시각을 박지 않는다.
 */
import { describe, it, expect } from 'vitest';
import { buildArticleJsonLd, buildFaqJsonLd, buildBreadcrumbJsonLd } from '../../src/lib/jsonLd';
import { guideCanonicalUrl } from '../../src/lib/seoRoutes';

describe('buildArticleJsonLd', () => {
  const base = {
    path: '/guide/best-seoul-street-food-markets-2026',
    title: 'Best Seoul Street Food Markets 2026',
    description: 'Gwangjang, Myeongdong and Mangwon.',
    published: '2026-07-29',
  };

  it('상대경로 image·@id 를 절대 URL 로 만든다', () => {
    const a = buildArticleJsonLd({ ...base, image: '/blog-images/2026/x.webp' });
    expect(a.image).toBe('https://cocotripkr.com/blog-images/2026/x.webp');
    expect((a.mainEntityOfPage as Record<string, string>)['@id'])
      .toBe('https://cocotripkr.com/guide/best-seoul-street-food-markets-2026');
  });

  it('이미 절대 URL 인 image 는 건드리지 않는다', () => {
    const a = buildArticleJsonLd({ ...base, image: 'https://cocotripkr.com/a.webp' });
    expect(a.image).toBe('https://cocotripkr.com/a.webp');
  });

  it('가이드 canonical 절대 URL 을 Article mainEntityOfPage 에 그대로 쓴다', () => {
    const canonical = guideCanonicalUrl('best-seoul-street-food-markets-2026');
    const article = buildArticleJsonLd({ ...base, path: canonical });
    expect((article.mainEntityOfPage as Record<string, string>)['@id']).toBe(canonical);
  });

  it('Brain projection hash가 있으면 운영 URL에서 확인할 수 있는 identifier로 보존한다', () => {
    const hash = 'a'.repeat(64);
    expect(buildArticleJsonLd({ ...base, contentSha256: hash }).identifier).toBe(`urn:sha256:${hash}`);
    expect(buildArticleJsonLd({ ...base, contentSha256: 'not-a-hash' })).not.toHaveProperty('identifier');
  });

  it('image 가 없으면 image 키 자체를 넣지 않는다 (빈 값 송출 금지)', () => {
    expect(buildArticleJsonLd(base)).not.toHaveProperty('image');
  });

  it('updated 미상이면 dateModified = datePublished (빌드 시각 금지)', () => {
    expect(buildArticleJsonLd(base).dateModified).toBe('2026-07-29');
    expect(buildArticleJsonLd({ ...base, updated: '2026-07-31' }).dateModified).toBe('2026-07-31');
  });

  it('가짜 평점을 만들지 않는다 (#898)', () => {
    expect(buildArticleJsonLd(base)).not.toHaveProperty('aggregateRating');
  });
});

describe('buildFaqJsonLd', () => {
  it('질문·답을 그대로 Question/Answer 로 옮긴다', () => {
    const faq = buildFaqJsonLd([['Can I cancel?', '24 hours or more before: full refund.']]);
    const first = (faq!.mainEntity as Array<Record<string, unknown>>)[0];
    expect(first.name).toBe('Can I cancel?');
    expect((first.acceptedAnswer as Record<string, string>).text)
      .toBe('24 hours or more before: full refund.');
  });

  it('항목이 없으면 null — 빈 FAQPage 를 내보내지 않는다', () => {
    expect(buildFaqJsonLd([])).toBeNull();
    expect(buildFaqJsonLd([['', ''], ['  ', 'answer']])).toBeNull();
  });

  it('빈 항목이 섞여 있으면 그것만 버린다', () => {
    const faq = buildFaqJsonLd([['Q1', 'A1'], ['', 'A2']]);
    expect((faq!.mainEntity as unknown[]).length).toBe(1);
  });
});

describe('buildBreadcrumbJsonLd', () => {
  it('position 은 1부터, item 은 절대 URL', () => {
    const bc = buildBreadcrumbJsonLd([['CocoTrip', '/'], ['Tours', '/tours'], ['Seoul', '/tours/seoul-city-full-day']]);
    const list = bc!.itemListElement as Array<Record<string, unknown>>;
    expect(list.map((x) => x.position)).toEqual([1, 2, 3]);
    expect(list[0].item).toBe('https://cocotripkr.com/');
    expect(list[2].item).toBe('https://cocotripkr.com/tours/seoul-city-full-day');
  });

  it('단계가 2개 미만이면 null (빵부스러기가 아니다)', () => {
    expect(buildBreadcrumbJsonLd([['CocoTrip', '/']])).toBeNull();
  });
});

describe('차터 FAQ 마크업은 화면 문구에서 파생한다', () => {
  it('CharterSeoInfo 가 FAQ 배열을 한 번만 만들어 렌더·JSON-LD 에 함께 쓴다', async () => {
    // 문구를 JSON-LD 쪽에 따로 적어두면 정책 개정 때 화면과 구글이 달라진다.
    // 렌더가 `faqEntries` 를 쓰고, 같은 변수를 buildFaqJsonLd 에 넘기는지 소스로 고정.
    const fs = await import('node:fs/promises');
    const src = await fs.readFile('src/components/charter/CharterSeoInfo.tsx', 'utf8');
    expect(src).toContain('const faqEntries = c.faq({');
    expect(src).toContain('buildFaqJsonLd(faqEntries)');
    expect(src).toContain('{faqEntries.map(([q, a]) => (');
    // c.faq( 호출은 파생 지점 단 한 곳이어야 한다.
    expect(src.match(/c\.faq\(/g)?.length).toBe(1);
  });
});
