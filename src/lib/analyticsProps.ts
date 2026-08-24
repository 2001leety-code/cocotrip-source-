/**
 * 분석 이벤트에 실려 나가는 값의 **단일 관문** (2026-07-30, P1-2).
 *
 * 🔴 고친 문제
 *   1) `trackPageView(location.pathname + location.search)` — 쿼리스트링을 그대로 GA4 로 보냈다.
 *      우리 URL 의 쿼리에는 `token`(공유 링크), `prefillHotel`·`prefillDiet`·`prefillDietaryRestrictions`(플래너
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
  // wizard_seen 판독용 (#1244 후속, 2026-08-07): 처음 보인 시점의 스크롤/뷰포트 픽셀.
  //   목록에 없어 조용히 버려졌고 wizard_seen 이 빈 객체로 도착했다 — "못 봤다 vs
  //   보고도 안 썼다" 를 가를 수 없었다. 숫자 픽셀값이라 개인정보 아님.
  'scroll_y', 'viewport_h',
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

/**
 * 현재 페이지의 안전한 경로 — 쿼리·해시 없음. 알 수 없으면 '/'.
 *
 * ⚠️ `window.location` 이 없는 환경(축소된 window 스텁·일부 임베드·SSR)에서도 **절대 throw 하지
 *   않는다.** 이 함수는 결제 성공 경로(`trackPaidConversion`)에서도 불린다 — 여기서 예외가 나면
 *   분석 실패가 결제 흐름을 삼킨다.
 */
export function safePagePath(pathname?: string | null): string {
  if (typeof pathname === 'string' && pathname) {
    return stripUrlToPath(pathname) || '/';
  }
  const loc = typeof window !== 'undefined' ? window.location : undefined;
  const p = loc && typeof loc.pathname === 'string' ? loc.pathname : '/';
  return stripUrlToPath(p) || '/';
}

/**
 * GA4 에 넘길 **전체 URL**(origin + 경로). 쿼리·해시 없음.
 *
 * 🔴 2026-08-01 Preview 실측에서 잡은 구멍: `page_path` 만 깨끗하게 보내도 gtag.js 는 `dl`
 *   (document location)을 **자신이 `window.location.href` 에서 채운다.** 그래서 이미 동의한
 *   재방문자가 `/s/xxx?token=…` 로 바로 들어오면 그 토큰이 `dl` 에 실려 나갔다.
 *   `page_location` 을 명시하면 gtag 가 그 값을 `dl` 로 쓴다 — 그래서 여기서 만들어 넘긴다.
 *   (`page_referrer` → `dr` 도 같은 이유로 함께 지정한다.)
 */
export function safePageLocation(pathname?: string | null): string {
  const loc = typeof window !== 'undefined' ? window.location : undefined;
  const origin = loc && typeof loc.origin === 'string' ? loc.origin : '';
  return `${origin}${safePagePath(pathname)}`;
}

/** GA4 `page_referrer` 로 넘길 값 — 레퍼러에서도 쿼리·해시를 뗀다. 없으면 undefined. */
export function safeReferrer(): string | undefined {
  if (typeof document === 'undefined' || !document) return undefined;
  const ref = typeof document.referrer === 'string' ? document.referrer : '';
  if (!ref) return undefined;
  const cleaned = stripUrlToPath(ref);
  return cleaned || undefined;
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

/**
 * SDK 가 스스로 붙이는 URL·레퍼러 계열 — 쿼리·해시가 그대로 들어오므로 통째로 버린다.
 *
 * 🔴 `$pathname` 은 여기 넣지 말 것 (2026-08-03). 우리가 `capturePageView` 에서
 *   `safePagePath()` 로 **이미 쿼리·해시를 뗀** 값을 직접 넣고, 관리자 화면 두 곳이
 *   정확히 이 속성을 조회한다:
 *     - api/admin-posthog-funnel.js — 전환 퍼널 1단계(`pathContains: '/planner'`)의 **분모**
 *     - api/_shared/posthog-host.js `buildTopPagesSQL` — 관리자 TOP 페이지
 *   버리면 두 화면이 영구히 빈다. (`ALLOWED_PROP_KEYS` 에도 `$pathname` 이 있어 두 목록이
 *   서로 모순이었다 — 이쪽에서 빼서 맞춘다.)
 */
const RESERVED_URL_PROPS = new Set([
  '$current_url', '$referrer', '$referring_domain',
  '$initial_current_url', '$initial_referrer', '$initial_referring_domain',
  '$initial_utm_source', '$initial_utm_medium', '$initial_utm_campaign',
  '$initial_utm_term', '$initial_utm_content',
]);

/**
 * 🔴 posthog-js 가 모든 이벤트에 직접 붙이는 **SDK 내부 속성**. `$` 로 시작하지 않아
 *   허용목록 필터에 걸려 지워지는데, 지우면 안 된다 (2026-08-03 실측).
 *
 *   - `token` — 프로젝트 API 키. posthog-js 1.409.5 의 `_runBeforeSend` 가 "훅이 이 속성을
 *     지웠는가" 를 검사해서, 지워졌으면 **이벤트를 통째로 버리고 null 을 반환한다**
 *     (`knownUnsafeEditableEventProperty = ['token']`). `capture()` 는 요청 큐에 넣기 전에
 *     빠져나가므로 **네트워크 POST 자체가 생성되지 않는다** — 실패 요청조차 안 남는다.
 *     그래서 2026-08-02~03 운영에서 PostHog 이벤트가 **전면 0건**이었다(자산은 200, POST 0).
 *   - `distinct_id` — 사람 식별자. 지워도 이벤트가 버려지진 않지만 익명 오귀속·중복 사용자가 된다.
 *
 *   둘 다 우리가 넣는 값이 아니라 SDK 가 넣는 값이라 개인정보 심사 대상이 아니다
 *   (`distinct_id` 는 Firebase uid 또는 SDK 가 만든 익명 id — 이메일이 아니다).
 */
const SDK_INTERNAL_PROPS = new Set(['token', 'distinct_id']);

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
    // SDK 내부 속성은 손대지 않고 그대로 통과 — 지우면 이벤트가 통째로 버려진다(위 주석).
    if (SDK_INTERNAL_PROPS.has(k)) {
      reserved[k] = v;
      continue;
    }
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
