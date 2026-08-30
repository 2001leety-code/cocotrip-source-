/**
 * 색인 대상 경로의 **단일 원천** (2026-07-30).
 *
 * 이전에는 같은 목록이 세 곳에 따로 있었고 서로 어긋났다:
 *   - `vite.config.ts` PRERENDER_ROUTES  (무JS HTML 생성 대상)
 *   - `public/sitemap.xml`               (구글에 제출하는 목록)
 *   - `tests/unit/sitemap-canonical-consistency.test.ts` (`/charter` 는 로그인벽이라 제외라고 단정)
 *
 * 🔴 실제로 `/charter` 는 **공개 라우트**다(App.tsx 의 `/charter` 에 `<AuthRequired>` 없음 —
 *   로그인벽은 `/charter-legacy` 쪽이다). 그런데 위 세 곳이 "로그인벽" 이라는 낡은 전제를
 *   그대로 들고 있어서, 자체 마진이 가장 큰 상품(차터)이 검색에서 통째로 빠져 있었다.
 *   테스트까지 그 전제를 강제하고 있었으니 고치려면 테스트도 함께 고쳐야 했다.
 *
 * 규칙
 *   - 이 파일이 진실. prerender·sitemap·런타임 robots 메타가 모두 여기서 파생한다.
 *   - 목록에 **없는 경로는 noindex**(기본 거부). 404·개인화 화면·새로 생긴 라우트가
 *     실수로 색인되는 쪽보다, 새 공개 페이지를 여기 추가하는 걸 잊는 쪽이 덜 위험하다.
 *   - `lastmod` 는 두지 않는다. 빌드 시각을 전 URL 에 박으면 "매번 전부 수정됨" 이라는
 *     거짓 신호가 되고, 실제 수정일을 알 수 없으면 생략이 정답이다(sitemaps.org: 선택 필드).
 *   - 언어별 고유 URL 이 없으므로(같은 URL 에서 클라이언트가 언어 전환) hreflang 도 두지 않는다.
 */

// 여행 가이드 (2026-08-01, blogspot 이식) — 글 목록 JSON 에서 파생해 콘텐츠↔색인 드리프트 차단.
// 상대 경로 import 인 이유: 이 파일은 vite.config.ts(esbuild 번들, '@' alias 미적용)에서도 읽힌다.
import guidesIndex from '../content/guides/_index.json';

/** 공개 URL·canonical·sitemap 이 함께 쓰는 대표 도메인. */
export const SITE_ORIGIN = 'https://cocotripkr.com';

/** Blogger 는 수집 통로이고, 가이드 대표 원문은 이 경로다. */
export const GUIDE_CANONICAL_BASE = `${SITE_ORIGIN}/guide`;

export function guideCanonicalUrl(slug?: string): string {
  const clean = (slug || '').trim();
  return clean ? `${GUIDE_CANONICAL_BASE}/${clean}` : GUIDE_CANONICAL_BASE;
}

const GUIDE_ROUTES: readonly string[] = [
  '/guide',
  ...(guidesIndex as { slug: string }[]).map((g) => `/guide/${g.slug}`),
];

/** 검색엔진에 색인시킬 공개 경로. prerender 대상 = sitemap 목록 = 이 배열. */
export const INDEXABLE_ROUTES: readonly string[] = [
  ...GUIDE_ROUTES,
  '/',
  '/tours',
  '/planner',
  // 자체 마진 상품 — 공개 라우트다(로그인 없이 6단계 견적까지 진행 가능).
  '/charter',
  // 투어 상세 (src/data/tours.ts 의 slug — 잠금 테스트가 누락을 잡는다)
  '/tours/seoul-city-full-day',
  '/tours/seoul-night-tour',
  '/tours/danyang-day-tour',
  '/tours/incheon-ganghwa-tour',
  '/tours/dmz-paju-tour',
  '/tours/nami-island-chuncheon',
  '/tours/gyeongju-day-tour',
  '/tours/busan-day-tour',
  '/tours/korea-multicity-3d2n',
  // 지역 (src/sections/Regions.tsx 의 id)
  '/region/seoul',
  '/region/chuncheon',
  '/region/paju',
  '/region/ganghwa',
  '/region/busan',
  '/region/danyang',
  '/region/incheon',
  '/region/gyeongju',
  '/region/jeonju',
  // 정책·회사
  '/about',
  '/terms',
  '/privacy',
  '/travel-terms',
];

/**
 * 명시적으로 색인하지 않는 경로. 기본 거부 규칙이 이미 이들을 막지만, **의도**를 남기고
 * 테스트가 회귀를 잡을 수 있게 열거한다. 접두사 매칭(하위 경로 포함).
 *
 *   개인화·인증        /mypage · /my-plans · /mood · /admin
 *   도구성·얇은 화면    /map · /assistant · /s (공유 링크) · /cart
 *   중복·리다이렉트     /charter-new(→/charter) · /charter-legacy(로그인벽) · /booking(→/tours)
 *   내부 전용          /preview · /dev
 *   커뮤니티           /community — 공개·검수된 콘텐츠가 쌓일 때까지 색인 보류
 *                     (현재 공개 글 0건. 빈 목록을 색인시키면 저품질 신호만 남는다)
 *   SNS 바이오 허브     /links — 버튼 3개짜리 중계 화면. 목적지와 같은 질의로 경쟁시키면
 *                     얇은 페이지만 하나 더 느는 셈이다
 *   개인정보 요청       /account-deletion — Play 제출용 요청 흐름. 공개 접근은 허용하지만
 *                     검색 유입용 콘텐츠가 아니므로 색인하지 않는다
 *
 * ⚠️ 여기 넣는 것만으로는 **런타임 `<meta>` 만** 바뀐다. `vercel.json` 의 X-Robots-Tag
 *    source 에도 같이 넣어야 원문을 받는 크롤러에게 전달된다. 두 곳이 어긋나는 것을
 *    `tests/unit/origin-noindex-and-404.test.ts` 가 이 목록을 돌며 잡는다.
 */
export const NOINDEX_ROUTES: readonly string[] = [
  '/mypage',
  '/my-plans',
  '/mood',
  '/admin',
  '/map',
  '/assistant',
  '/s',
  '/cart',
  '/charter-new',
  '/charter-legacy',
  '/booking',
  '/preview',
  '/dev',
  '/community',
  '/links',
  '/account-deletion',
];

/** 끝 슬래시 차이로 판정이 갈리지 않게 정규화. 빈 값은 '/'. */
function normalize(pathname: string): string {
  if (!pathname) return '/';
  const clean = pathname.split('?')[0].split('#')[0];
  if (clean.length > 1 && clean.endsWith('/')) return clean.replace(/\/+$/, '') || '/';
  return clean;
}

/**
 * 이 경로에 `<meta name="robots" content="noindex">` 를 붙여야 하는가.
 * 색인 목록에 없으면 전부 true (기본 거부).
 */
export function isNoindexPath(pathname: string): boolean {
  const p = normalize(pathname);
  return !INDEXABLE_ROUTES.includes(p);
}

export function sitemapUrls(): string[] {
  return INDEXABLE_ROUTES.map((r) => (r === '/' ? `${SITE_ORIGIN}/` : `${SITE_ORIGIN}${r}`));
}
