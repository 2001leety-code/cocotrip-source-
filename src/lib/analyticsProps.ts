/**
 * 분석 이벤트에 실려 나가는 값의 **단일 관문** (2026-07-30, P1-2).
 *
 * 🔴 고친 문제
 *   1) `trackPageView(location.pathname + location.search)` — 쿼리스트링을 그대로 GA4 로 보냈다.
 *      우리 URL 의 쿼리에는 `token`(공유 링크), `prefillHotel`·`prefillDiet`·`allergies`(플래너
 *      사전입력), `revisionNote`·`freeText`(자유 입력) 같은 **손님이 쓴 문장과 접근 토큰**이 들어간다.
 *   2) PostHog 자동 pageview/pageleave 가 `$current_url` 에 쿼리·해시를 통째로 실었다.
 *   3) URL 을 통째로 담는 속성(`target_url` 등)이 이벤트마다 흩어져 있었다.
 *
 * 설계: 이벤트마다 고쳐 다니면 **다음에 추가되는 이벤트가 또 샌다.** 그래서 보내는 지점 한 곳에서
 * 값 자체를 정리한다. GA4(`trackEvent`)와 PostHog(`before_send`)가 모두 이 함수를 통과한다.
 *
 * 정책은 **기본 거부(allowlist)** 다. 새 속성을 보내려면 `ALLOWED_PROP_KEYS` 에 이름을 추가해야
 * 한다 — 추가하는 순간 "이 값이 개인정보인가" 를 한 번 생각하게 되는 것이 이 목록의 목적이다.
 */

/**
 * 분석 이벤트에 실어도 되는 속성 키. (2026-07-30 기준 실제 사용 키 전수 + UTM 5종)
 * 여기 없는 키는 조용히 버린다.
 */
export const ALLOWED_PROP_KEYS: readonly string[] = [
  // 화면·위치
  'page_path', 'placement', 'step', 'format', 'source', 'area', 'pace', 'city',
  // 상품·거래 (금액은 숫자, 식별자는 우리 내부 상품 코드)
  'product', 'product_type', 'planType', 'item_id', 'item_name', 'items_id', 'items_name',
  'currency', 'value', 'amount', 'price', 'quantity', 'transaction_id', 'vehicle_type',
  'content_type', 'ad_type', 'link_key', 'link_text', 'target_url',
  // 플랜·위저드
  'plan_id', 'planId', 'duration_days', 'durationDays', 'pax', 'days', 'free_coupon',
  'issued_count', 'method', 'estMin',
  // 결과·성능
  'success', 'reason', 'elapsed_ms', 'durationMs', 'started_at',
  // 언어
  'language', 'from', 'to',
  // 유입 (동의 후에만 저장·전송된다 — lib/analytics.ts 참조)
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
  // PostHog 예약 속성 — 우리가 직접 채우는 것만 허용(자동 수집은 before_send 가 거른다).
  '$current_url', '$pathname',
];

const ALLOWED = new Set(ALLOWED_PROP_KEYS);

const MAX_STRING = 120;

/** 값이 URL·경로일 때 경로만 남기기 위한 판정. */
function looksLikeUrlOrPath(v: string): boolean {
  return v.includes('://') || v.startsWith('/') || /^www\./i.test(v);
}

/** 이 키를 분석 이벤트에 실어도 되는가. */
export function isAllowedAnalyticsKey(key: string): boolean {
  return ALLOWED.has(key);
}

/**
 * URL·경로에서 **쿼리·해시·자격증명을 제거**하고 경로만 돌려준다.
 * 절대 URL 은 `origin + pathname`, 상대 경로는 pathname 만. 판별 불가면 null(=속성 삭제).
 */
export function stripUrlToPath(value: string): string | null {
  const raw = value.trim();
  if (!raw) return null;
  const cut = raw.split('?')[0].split('#')[0];
  if (!cut) return null;
  if (cut.includes('://')) {
    try {
      const u = new URL(cut);
      // 사용자 정보(user:pass@host)가 들어 있으면 통째로 버린다.
      if (u.username || u.password) return null;
      return `${u.origin}${u.pathname}`.slice(0, MAX_STRING);
    } catch {
      return null;
    }
  }
  return cut.slice(0, MAX_STRING);
}

/** 현재 페이지의 안전한 경로 — 쿼리·해시 없음. 알 수 없으면 '/'. */
export function safePagePath(pathname?: string | null): string {
  const p = typeof pathname === 'string' && pathname
    ? pathname
    : (typeof window !== 'undefined' ? window.location.pathname : '/');
  const cleaned = stripUrlToPath(p);
  return cleaned || '/';
}

/**
 * 분석 속성 정리. 원본은 건드리지 않고 새 객체를 돌려준다.
 *   - 허용 목록에 없는 키 → 삭제
 *   - URL·경로 값 → 경로만
 *   - 문자열 → 길이 컷, 객체·배열 → 삭제(내용 보장 불가)
 */
export function stripUnsafeProps(
  props: Record<string, unknown> | undefined | null,
): Record<string, unknown> | undefined {
  if (!props) return undefined;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(props)) {
    if (v === undefined || v === null) continue;
    if (!ALLOWED.has(k)) continue;
    if (typeof v === 'string') {
      if (looksLikeUrlOrPath(v)) {
        const safe = stripUrlToPath(v);
        if (safe) out[k] = safe;
        continue;
      }
      out[k] = v.slice(0, MAX_STRING);
      continue;
    }
    if (typeof v === 'number' || typeof v === 'boolean') {
      out[k] = v;
      continue;
    }
    // 객체·배열은 내부에 무엇이 들었는지 보장할 수 없다 → 보내지 않는다.
  }
  return out;
}

/** SDK 가 스스로 붙이는 URL·레퍼러 계열 — 쿼리·해시가 그대로 들어오므로 통째로 버린다. */
const RESERVED_URL_PROPS = new Set([
  '$current_url', '$referrer', '$referring_domain', '$pathname',
  '$initial_current_url', '$initial_referrer', '$initial_referring_domain',
  '$initial_utm_source', '$initial_utm_medium', '$initial_utm_campaign',
  '$initial_utm_term', '$initial_utm_content',
]);

/**
 * PostHog `before_send` 전용 정리.
 *
 * ⚠️ `stripUnsafeProps` 를 그대로 쓰면 안 된다 — `$lib`·`$session_id`·`$insert_id` 같은 **SDK 내부
 * 속성까지 지워** 이벤트가 세션·중복제거 정보를 잃는다(측정이 조용히 망가진다).
 * 그래서 `$` 로 시작하는 예약 속성은 살리되, URL·레퍼러 계열만 버린다. 나머지(우리가 넣은 속성)는
 * 평소대로 허용 목록으로 거른다.
 */
export function sanitizeCaptureProperties(
  props: Record<string, unknown> | undefined | null,
): Record<string, unknown> {
  if (!props) return {};
  const reserved: Record<string, unknown> = {};
  const ours: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(props)) {
    if (k.startsWith('$')) {
      if (RESERVED_URL_PROPS.has(k)) continue;
      // 예약 속성이라도 URL 문자열이면 경로만 남긴다(새 SDK 버전이 URL 속성을 추가해도 안전).
      if (typeof v === 'string' && (v.includes('://') || v.startsWith('/'))) {
        const safe = stripUrlToPath(v);
        if (safe) reserved[k] = safe;
        continue;
      }
      reserved[k] = v;
      continue;
    }
    ours[k] = v;
  }
  return { ...reserved, ...(stripUnsafeProps(ours) || {}) };
}
