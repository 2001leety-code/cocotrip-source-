/**
 * courseBuilderAnalytics — Course Builder 전용 이벤트 6종의 유일한 발화 관문 (2026-08-24).
 *
 * lib/analytics.ts 의 trackEvent(GA4) 를 그대로 쓰되, 이 파일이 두 번째 허용목록 역할을 한다.
 * lib/analyticsProps.ts 의 ALLOWED_PROP_KEYS 는 사이트 전체 공용이라 값 자체(enum 후보)는
 * 검증하지 않는다 — 호출부가 실수로 courseId/좌표/이름을 `source`/`reason` 같은 허용된 **키**에
 * 잘못 담아도 그 필터는 못 막는다. 여기서 값까지 막는다: 화이트리스트에 없는 값은 통째로 드롭.
 *
 * 절대 포함 금지: 이름/주소/메모/좌표/URL/원본 에러 메시지/사용자·코스·공유·플랜 ID.
 */
import { trackEvent } from '@/lib/analytics';

export const COURSE_BUILDER_EVENT_NAMES = [
  'course_builder_opened',
  'course_builder_started',
  'course_builder_route_result',
  'course_builder_saved',
  'course_builder_shared',
  'course_builder_optimize_result',
] as const;
export type CourseBuilderEventName = typeof COURSE_BUILDER_EVENT_NAMES[number];

export type CourseBuilderSource = 'manual' | 'place_search' | 'recommendation' | 'verified_route' | 'ai_recommendation';
const SOURCES: ReadonlySet<string> = new Set<CourseBuilderSource>([
  'manual', 'place_search', 'recommendation', 'verified_route', 'ai_recommendation',
]);

export type CourseBuilderReason = 'ok' | 'network_error' | 'server_error' | 'locked' | 'too_few_stops' | 'no_route' | 'invalid' | 'empty' | 'ai' | 'catalog_fallback' | 'catalog_unavailable';
const REASONS: ReadonlySet<string> = new Set<CourseBuilderReason>([
  'ok', 'network_error', 'server_error', 'locked', 'too_few_stops', 'no_route', 'invalid', 'empty',
  'ai', 'catalog_fallback', 'catalog_unavailable',
]);

export interface CourseBuilderEventProps {
  source?: CourseBuilderSource;
  success?: boolean;
  reason?: CourseBuilderReason;
  language?: string;
  durationMs?: number;
}

/** 알려진 언어 코드만 — 자유 문자열(브라우저 커스텀 locale 등) 통과 방지. */
const LANGUAGES: ReadonlySet<string> = new Set(['ko', 'en', 'ja', 'zh']);

/**
 * Course Builder 이벤트 전송 — 값까지 검증하는 allowlist. 여기 없는 값·상위 5개 키 밖의
 * 속성은 조용히 버려진다(호출부 실수가 곧 정보 유출로 이어지지 않도록 fail-closed).
 */
export function trackCourseBuilderEvent(name: CourseBuilderEventName, props: CourseBuilderEventProps = {}): void {
  const safe: Record<string, string | number | boolean> = {};
  if (props.source !== undefined && SOURCES.has(props.source)) safe.source = props.source;
  if (typeof props.success === 'boolean') safe.success = props.success;
  if (props.reason !== undefined && REASONS.has(props.reason)) safe.reason = props.reason;
  if (props.language !== undefined && LANGUAGES.has(props.language)) safe.language = props.language;
  if (typeof props.durationMs === 'number' && Number.isFinite(props.durationMs) && props.durationMs >= 0) {
    safe.durationMs = Math.round(props.durationMs);
  }
  trackEvent(name, safe);
}
