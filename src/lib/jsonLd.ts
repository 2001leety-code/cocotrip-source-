/**
 * 페이지별 JSON-LD 빌더 — 순수함수 (firebase/React 의존 0 → CI 테스트에서 직접 import 가능.
 * `pages/buildTourJsonLd.ts` 와 같은 이유·같은 규약이다).
 *
 * 왜 만드는가 (2026-08-01, 유입 묶음 D): 전 페이지가 index.html 의 전역 스키마
 * (WebSite·TravelAgency) 6종만 내보내고 **페이지 고유 스키마가 0** 이었다. 유일한 예외가
 * `/tours/*` 의 Product 뿐. GSC URL Inspection 실측에서 홈만 색인되고 나머지 43 URL 은
 * "Discovered - currently not indexed"(/charter 는 "URL is unknown to Google") 였고,
 * robots·프리렌더·본문 길이·canonical 은 전부 정상이라 남은 레버가 구조화·외부신호였다.
 *
 * 원칙
 *   - **화면에 실제로 있는 것만 마크업한다.** FAQ 항목은 렌더에 쓰는 바로 그 배열에서 파생시켜
 *     넘긴다(문구를 여기 다시 적으면 개정 때 한쪽만 바뀌어 구글에 거짓을 보낸다).
 *   - 가짜 평점 금지(#898) — AggregateRating 은 여기서 만들지 않는다.
 */

const SITE = 'https://cocotripkr.com';

/**
 * 회사 로고 (2026-08-06).
 *
 * 파비콘(64x64)을 쓰고 있었다. 파비콘은 브라우저 탭용이고, 구글이 회사 정보를 표시할 때
 * 쓰는 로고와는 용도가 다르다 — 구글 권장은 최소 112px 이고 64 는 그 아래다.
 * 8/5 에 만든 정식 마크(1024x1024, `public/brand/`)가 쓰이지 않고 있어서 그걸로 바꾼다.
 *
 * ⚠️ `icon-1024.png`(앱 아이콘)가 아니라 `logo-mark-1024.png`(투명 배경)를 쓴다.
 *    앱 아이콘은 어두운 둥근 사각 배경이 붙어 있어서, 흰 검색 화면에 얹으면 검은 네모가 뜬다.
 * ⚠️ 파비콘 자체는 그대로 둔다 — 탭의 작은 자리엔 64px 가 맞다.
 */
const LOGO_URL = `${SITE}/brand/logo-mark-1024.png`;

/**
 * 전역 TravelAgency(index.html)와 같은 값.
 * 🔴 index.html 은 정적 HTML 이라 이 상수를 import 할 수 없다 — **값이 두 벌로 존재한다.**
 *    한쪽만 고치면 홈과 글 페이지가 구글에 서로 다른 로고를 보낸다(이 레포의 "한쪽만 고침"
 *    사고 패턴). 두 벌이 같은지는 `tests/unit/org-logo-parity.test.ts` 가 잠근다.
 */
const PUBLISHER = {
  '@type': 'Organization',
  name: 'CocoTrip',
  url: SITE,
  logo: { '@type': 'ImageObject', url: LOGO_URL },
} as const;

const abs = (url: string): string =>
  url.startsWith('http') ? url : `${SITE}${url.startsWith('/') ? '' : '/'}${url}`;

/** 가이드 글 = Article. datePublished/dateModified 는 글 JSON 의 값에서 파생(추정 금지). */
export function buildArticleJsonLd(params: {
  path: string;
  title: string;
  description: string;
  published: string;
  updated?: string;
  image?: string;
}): Record<string, unknown> {
  const { path, title, description, published, updated, image } = params;
  const jsonLd: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: title,
    description,
    datePublished: published,
    dateModified: updated || published,
    author: PUBLISHER,
    publisher: PUBLISHER,
    mainEntityOfPage: { '@type': 'WebPage', '@id': abs(path) },
    inLanguage: 'en',
  };
  if (image) jsonLd.image = abs(image);
  return jsonLd;
}

/**
 * FAQ = FAQPage. `entries` 는 화면을 그리는 그 배열을 그대로 넘긴다.
 * 빈 배열이면 null — 항목 없는 FAQPage 를 내보내면 구글이 스팸 신호로 읽는다.
 */
export function buildFaqJsonLd(entries: ReadonlyArray<readonly [string, string]>): Record<string, unknown> | null {
  const valid = entries.filter(([q, a]) => q?.trim() && a?.trim());
  if (valid.length === 0) return null;
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: valid.map(([q, a]) => ({
      '@type': 'Question',
      name: q,
      acceptedAnswer: { '@type': 'Answer', text: a },
    })),
  };
}

/** 빵부스러기. `items` = [표시이름, 경로] 순서대로. 마지막 항목이 현재 페이지. */
export function buildBreadcrumbJsonLd(
  items: ReadonlyArray<readonly [string, string]>,
): Record<string, unknown> | null {
  if (items.length < 2) return null;
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map(([name, path], i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name,
      item: abs(path),
    })),
  };
}
