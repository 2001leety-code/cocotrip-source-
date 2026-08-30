/**
 * courseBuilderAnalytics — 값까지 검증하는 allowlist 잠금 (2026-08-24).
 *
 * lib/analyticsProps.ts 의 허용목록은 "이 키를 보내도 되는가"만 본다. 이 모듈은 그 앞단에서
 * "이 키에 담긴 값이 우리가 정의한 enum/범위인가"까지 막는다 — 호출부가 실수로 courseId 같은
 * 값을 source/reason 에 담아도 여기서 걸러진다. 이름/좌표/URL/에러메시지는애초에 타입에
 * 없는 필드라 통과할 수조차 없다는 것도 함께 잠근다(타입 우회 시도까지 방어).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const trackEventMock = vi.fn();
vi.mock('@/lib/analytics', () => ({ trackEvent: (...args: unknown[]) => trackEventMock(...args) }));

import { trackCourseBuilderEvent } from '../../src/pages/PlannerPage/components/courseBuilder/courseBuilderAnalytics';

beforeEach(() => { trackEventMock.mockReset(); });

describe('trackCourseBuilderEvent', () => {
  it('허용된 enum 값은 그대로 전달', () => {
    trackCourseBuilderEvent('course_builder_started', { source: 'manual', language: 'ko' });
    expect(trackEventMock).toHaveBeenCalledWith('course_builder_started', { source: 'manual', language: 'ko' });
  });

  it.each(['ai', 'catalog_fallback', 'catalog_unavailable'] as const)(
    '최적화 결과 출처 %s 는 개인정보 없는 허용 reason 으로 전달',
    (reason) => {
      trackCourseBuilderEvent('course_builder_optimize_result', { success: true, reason });
      expect(trackEventMock).toHaveBeenCalledWith('course_builder_optimize_result', { success: true, reason });
    },
  );

  it('알 수 없는 source 값은 드롭(속성 자체가 빠짐)', () => {
    trackCourseBuilderEvent('course_builder_started', { source: 'course-abc123' as never, language: 'en' });
    expect(trackEventMock).toHaveBeenCalledWith('course_builder_started', { language: 'en' });
  });

  it('알 수 없는 reason 값은 드롭', () => {
    trackCourseBuilderEvent('course_builder_saved', { success: false, reason: 'user typed a course title here' as never });
    expect(trackEventMock).toHaveBeenCalledWith('course_builder_saved', { success: false });
  });

  it('알 수 없는 language 값은 드롭', () => {
    trackCourseBuilderEvent('course_builder_opened', { language: 'fr' as never });
    expect(trackEventMock).toHaveBeenCalledWith('course_builder_opened', {});
  });

  it('durationMs 는 반올림된 유한수만, 음수/NaN 은 드롭', () => {
    trackCourseBuilderEvent('course_builder_route_result', { durationMs: 123.7 });
    expect(trackEventMock).toHaveBeenLastCalledWith('course_builder_route_result', { durationMs: 124 });
    trackCourseBuilderEvent('course_builder_route_result', { durationMs: -5 });
    expect(trackEventMock).toHaveBeenLastCalledWith('course_builder_route_result', {});
    trackCourseBuilderEvent('course_builder_route_result', { durationMs: NaN });
    expect(trackEventMock).toHaveBeenLastCalledWith('course_builder_route_result', {});
  });

  it('임의로 끼워넣은 비허용 키(이름/좌표/URL/ID)는 페이로드에 절대 나타나지 않는다', () => {
    trackCourseBuilderEvent('course_builder_saved', {
      success: true, reason: 'ok', language: 'ko', durationMs: 10,
      ...({ courseId: 'abc', title: '홍대 고깃집', lat: 37.5, lng: 127.0, shareUrl: 'https://x/y' } as never),
    });
    const payload = trackEventMock.mock.calls[0][1];
    expect(Object.keys(payload).sort()).toEqual(['durationMs', 'language', 'reason', 'success']);
    expect(payload).not.toHaveProperty('courseId');
    expect(payload).not.toHaveProperty('title');
    expect(payload).not.toHaveProperty('lat');
    expect(payload).not.toHaveProperty('shareUrl');
  });

  it('success 는 boolean 만 통과', () => {
    trackCourseBuilderEvent('course_builder_shared', { success: true });
    expect(trackEventMock).toHaveBeenLastCalledWith('course_builder_shared', { success: true });
  });
});
