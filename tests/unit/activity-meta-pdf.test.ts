/**
 * buildActivityMetaHtml — PDF 트레킹/러닝 SAFETY 렌더 (2026-06-02). 오프라인 등산객이 PDF 에서도
 * 난이도·위험·부적합·컷오프를 봐야 함. 화면 ActivityMetaChips 와 동일 라벨(src/lib/activityMetaLabels SSOT).
 * SAFETY 불변식: unsuitable_for 절대 누락 금지 / 미등록 토큰 humanize 폴백(위험 숨김 금지) / 없으면 '' (additive).
 */
import { describe, it, expect } from 'vitest';
import { buildActivityMetaHtml } from '../../src/lib/activityMetaLabels';
import type { ActivityMeta } from '../../src/types/plan';

const base = (over: Partial<ActivityMeta> = {}): ActivityMeta => ({ activity_type: 'trekking', difficulty: 'expert', ...over });

describe('buildActivityMetaHtml — PDF 트레킹 SAFETY 렌더', () => {
  it('activity_meta 없음 / city_day → 빈 문자열 (additive, byte-identical)', () => {
    expect(buildActivityMetaHtml(null, 'en')).toBe('');
    expect(buildActivityMetaHtml(undefined, 'en')).toBe('');
    expect(buildActivityMetaHtml({ activity_type: 'city_day' } as never, 'en')).toBe('');
  });

  it('컷오프 토큰 → 전용 시간 배너 (12:30 PM + Jindallae, 깨진 영어 아님)', () => {
    const html = buildActivityMetaHtml(base({ hazards: ['12_30_pm_cutoff_at_jindallae'] }), 'en');
    expect(html).toContain('Time cutoff');
    expect(html).toContain('12:30 PM');
    expect(html).toContain('Jindallae');
  });

  it('부적합 4-lang (ko) — 휠체어 이용자 + 고산증 민감자 (절대 누락 금지)', () => {
    const html = buildActivityMetaHtml(base({ unsuitable_for: ['wheelchair_user', 'altitude_sensitive'] }), 'ko');
    expect(html).toContain('휠체어 이용자');
    expect(html).toContain('고산증 민감자');
  });

  it('위험 토큰 i18n (ko) + 미등록 humanize 폴백 (위험 숨김 금지)', () => {
    expect(buildActivityMetaHtml(base({ hazards: ['high_altitude_weather_change'] }), 'ko')).toContain('고산 날씨 급변');
    expect(buildActivityMetaHtml(base({ hazards: ['totally_new_token'] }), 'en')).toContain('Totally New Token');
  });

  it('난이도 라벨 4-lang (ja expert → 専門)', () => {
    expect(buildActivityMetaHtml(base({ difficulty: 'expert' }), 'ja')).toContain('専門');
  });

  it('동적 토큰 HTML escape (PDF 깨짐/주입 방어)', () => {
    const html = buildActivityMetaHtml(base({ hazards: ['a<b&c>d'] }), 'en');
    expect(html).toContain('&lt;');
    expect(html).toContain('&amp;');
  });

  it('컷오프는 일반 위험 칩과 분리 (Caution 줄에 컷오프 토큰 원문 미노출)', () => {
    const html = buildActivityMetaHtml(base({ hazards: ['12_30_pm_cutoff_at_jindallae', 'falling_rock'] }), 'en');
    expect(html).toContain('Falling rocks'); // 일반 위험은 Caution
    expect(html).toContain('Time cutoff');    // 컷오프는 전용 배너
  });
});
