/**
 * PostHog HogQL 쿼리 빌더 회귀 가드 (2026-06-03).
 *
 * 배경: PostHog 신규 계정은 legacy insight endpoint("/insights/trend/") 차단
 *   ("Legacy insight endpoints are not available for this user") → 신 Query API(HogQL) 로 전환.
 *   admin-posthog-visitors / -funnel 가 buildVisitorSQL/buildTopPagesSQL + escapeHogQLString 사용.
 * 가드: SQL injection 방지(작은따옴표 escape), 익명 방문자 유지(coalesce), days clamp, 핵심 절 포함.
 */
import { describe, it, expect } from 'vitest';
import { escapeHogQLString, buildVisitorSQL, buildTopPagesSQL } from '../../api/_shared/posthog-host.js';

describe('escapeHogQLString — SQL injection 방지', () => {
  it("작은따옴표를 '' 로 escape", () => {
    expect(escapeHogQLString("a'b")).toBe("a''b");
    expect(escapeHogQLString("x'; DROP TABLE events;--")).toBe("x''; DROP TABLE events;--");
  });
  it('null/undefined → 빈 문자열', () => {
    expect(escapeHogQLString(null)).toBe('');
    expect(escapeHogQLString(undefined)).toBe('');
  });
});

describe('buildVisitorSQL', () => {
  it('핵심 절 포함 ($pageview, uniq person, INTERVAL N DAY)', () => {
    const sql = buildVisitorSQL(7, null);
    expect(sql).toContain('uniq(person_id)');
    expect(sql).toContain('count() AS pageviews');
    expect(sql).toContain("event = '$pageview'");
    expect(sql).toContain('INTERVAL 7 DAY');
    expect(sql).not.toContain('person.properties.email'); // excludeEmail 없으면 제외 절 없음
  });
  it('excludeEmail → 본인 제외 절 (coalesce 로 익명 방문자 유지)', () => {
    const sql = buildVisitorSQL(7, 'admin@x.com');
    expect(sql).toContain("coalesce(person.properties.email, '') != 'admin@x.com'");
  });
  it('excludeEmail 의 작은따옴표 escape (injection 방어)', () => {
    const sql = buildVisitorSQL(7, "a'b@x.com");
    expect(sql).toContain("!= 'a''b@x.com'");
  });
  it('days clamp 1~366', () => {
    expect(buildVisitorSQL(9999, null)).toContain('INTERVAL 366 DAY');
    expect(buildVisitorSQL(0, null)).toContain('INTERVAL 1 DAY');
    expect(buildVisitorSQL(NaN, null)).toContain('INTERVAL 1 DAY');
  });
});

describe('buildTopPagesSQL', () => {
  it('$pathname 그룹 + LIMIT 5', () => {
    const sql = buildTopPagesSQL(7, null);
    expect(sql).toContain('properties.$pathname AS path');
    expect(sql).toContain("event = '$pageview'");
    expect(sql).toContain('GROUP BY path');
    expect(sql).toContain('ORDER BY views DESC');
    expect(sql).toContain('LIMIT 5');
  });
  it('excludeEmail 반영 + escape', () => {
    expect(buildTopPagesSQL(7, "a'b@x.com")).toContain("!= 'a''b@x.com'");
  });
});
