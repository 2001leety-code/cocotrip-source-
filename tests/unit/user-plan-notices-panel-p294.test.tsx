/**
 * P294 (2026-05-29): UserPlanNoticesPanel 회귀 차단.
 *
 * 화이트리스트 (positive notices 만) + 4lang i18n + 디자인 SSOT 토큰.
 * 회귀 시: 사용자가 quality_warnings 못 보거나, blacklist kind (디버그) 가 노출됨.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('P294 UserPlanNoticesPanel', () => {
  const componentPath = resolve(
    __dirname,
    '../../src/pages/PlanDetailPage/components/UserPlanNoticesPanel.tsx',
  );
  const src = readFileSync(componentPath, 'utf8');

  // ── source pattern ────────────────────────────────────────────────────────

  it('source — USER_VISIBLE_KINDS 화이트리스트 export', () => {
    expect(src).toMatch(/export const USER_VISIBLE_KINDS/);
  });

  it('source — 7 화이트리스트 kind (positive notices)', () => {
    const expectedKinds = [
      'arrival_guide_self_healed',
      'lodging_bookend_self_healed',
      'cross_city_lodging_corrected',
      'arrival_airport_overridden',
      'departure_airport_overridden',
      'dietary_coverage_low',
      'daily_budget_self_healed',
    ];
    for (const kind of expectedKinds) {
      expect(src).toContain(kind);
    }
  });

  it("source — severity='critical' 제외 로직 (admin escalation 영역)", () => {
    expect(src).toMatch(/severity\s*===?\s*['"]critical['"]/);
  });

  it('source — 디자인 SSOT purple/pink gradient (admin amber 와 구분)', () => {
    expect(src).toMatch(/from-purple/);
    expect(src).toMatch(/to-pink/);
    expect(src).toMatch(/border-purple/);
  });

  it('source — useLanguage hook 사용 (i18n)', () => {
    expect(src).toMatch(/import\s*\{\s*useLanguage\s*\}\s*from\s*['"]@\/hooks\/useLanguage['"]/);
    expect(src).toMatch(/const\s*\{\s*t\s*\}\s*=\s*useLanguage\(\)/);
  });

  it('source — fallback chain (translations 미로드 시 한국어 default)', () => {
    // noticesT 가 nullable — fallback string 명시
    expect(src).toContain('플랜 자동 보정 안내');
    expect(src).toContain('AI');
  });

  // ── i18n 4lang 동시 추가 의무 (CLAUDE.md J 박제) ──────────────────────────

  const langs = ['ko', 'en', 'ja', 'zh'];
  for (const lang of langs) {
    it(`i18n — ${lang}.json planDetail.notices namespace 추가`, () => {
      const p = resolve(__dirname, `../../src/i18n/locales/${lang}.json`);
      const json = JSON.parse(readFileSync(p, 'utf8'));
      const notices = json.planDetail?.notices;
      expect(notices).toBeDefined();
      // 7 화이트리스트 kind 의 i18n key
      const expectedKeys = [
        'title',
        'subtitle',
        'countSuffix',
        'arrivalGuideSelfHealed',
        'lodgingBookendSelfHealed',
        'crossCityLodgingCorrected',
        'arrivalAirportOverridden',
        'departureAirportOverridden',
        'dietaryCoverageLow',
        'dailyBudgetSelfHealed',
      ];
      for (const k of expectedKeys) {
        expect(notices[k]).toBeTruthy();
        expect(typeof notices[k]).toBe('string');
        expect(notices[k].length).toBeGreaterThan(0);
      }
    });
  }

  // ── PlanDetailPage 통합 ───────────────────────────────────────────────────

  it('PlanDetailPage 통합 — UserPlanNoticesPanel import + 렌더', () => {
    const pagePath = resolve(
      __dirname,
      '../../src/pages/PlanDetailPage/index.tsx',
    );
    const pageSrc = readFileSync(pagePath, 'utf8');
    expect(pageSrc).toMatch(/import\s*\{\s*UserPlanNoticesPanel\s*\}/);
    expect(pageSrc).toMatch(/<UserPlanNoticesPanel\s/);
  });
});
