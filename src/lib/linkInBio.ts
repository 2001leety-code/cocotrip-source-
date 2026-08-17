/**
 * 링크 인 바이오 허브의 목적지 주소 생성 (2026-08-17).
 *
 * Instagram·TikTok 은 프로필 링크를 API 로 못 바꾼다. 그래서 게시물마다 링크를
 * 갈아끼우는 추적은 불가능하고, 매일 손으로 바꾸는 것도 현실적이지 않다.
 *
 * 대신 바이오에는 `/links` 하나만 고정해 두고, 들어온 UTM 을 **그대로 물고**
 * 각 버튼에 `utm_content` 만 덧붙여 넘긴다. 그러면 폰을 안 만져도
 *   어느 채널에서 왔는지(utm_source) + 무엇을 눌렀는지(utm_content)
 * 가 둘 다 남는다.
 *
 * 들어온 값이 없으면 채널만 기본값으로 채운다. 링크를 직접 친 사람도 집계에서
 * 사라지지 않게 하기 위함이다.
 */

const TRACKING_KEYS = [
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_content',
  'utm_term',
] as const;

export const LINK_HUB_DEFAULTS = {
  utm_source: 'link_in_bio',
  utm_medium: 'bio',
} as const;

export const LINK_HUB_PATH = '/links';

/**
 * 허브에서는 전역 chrome(하단탭·프로모배너·쿠폰모달)을 렌더하지 않는다.
 *
 * 판정을 한 곳에 모아두는 이유: 숨길 자리가 App.tsx 안에서만 두 군데(GlobalWidgets,
 * NonMoodChrome)로 갈라져 있어, 한쪽만 고치면 반쪽짜리가 된다. 실제로 처음 배포된
 * 허브가 그랬다 — 페이지는 헤더·푸터를 안 그렸지만 하단탭과 프로모배너가 그대로 얹혔고,
 * 그 배너의 CTA 는 UTM 없이 /planner 로 보내 허브의 목적(유입 출처 집계)을 깼다.
 */
export function isLinkHubPath(pathname: string): boolean {
  return pathname === LINK_HUB_PATH;
}

/**
 * @param path      목적지 경로 (예: `/planner`)
 * @param incoming  현재 주소의 query string (예: `location.search`)
 * @param content   버튼 식별자. 기존 utm_content 가 있어도 이 값이 이긴다.
 */
export function buildLinkHubDestination(
  path: string,
  incoming: string,
  content: string,
): string {
  const params = new URLSearchParams();
  const source = new URLSearchParams(incoming || '');

  for (const key of TRACKING_KEYS) {
    const value = source.get(key);
    if (value && value.trim()) params.set(key, value.trim());
  }

  if (!params.get('utm_source')) params.set('utm_source', LINK_HUB_DEFAULTS.utm_source);
  if (!params.get('utm_medium')) params.set('utm_medium', LINK_HUB_DEFAULTS.utm_medium);

  // 어떤 버튼을 눌렀는지가 이 허브의 존재 이유다. 들어온 값보다 우선한다.
  params.set('utm_content', content);

  return `${path}?${params.toString()}`;
}
