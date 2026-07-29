/**
 * 회귀 잠금 (2026-07-28) — 품질 점수가 오류율을 가리던 문제 + P2 표시 결함.
 *
 * 실측(최근 30일, 플랜 100건): 평균 88.7 인데 촉박 73.5% · 중복 25.4% ·
 * 필드누락 22.8% · 경로실패 13.0% · 미검증식당 9.4%.
 * 옛 가중치로 역산하면 정확히 89 대가 나온다 = 점수가 문제를 감추고 있었다.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  METRIC_WEIGHTS, CRITICAL_METRICS, hasCriticalIssue, computeWeightedScore,
} from '../../api/_ai_core/qualityMetrics.js';

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');

/** 실측 오류율로 metrics 형태를 만든다 (total=100 기준). */
function metricsFromRates(rates: Record<string, number>) {
  const keys = Object.keys(METRIC_WEIGHTS);
  const m: Record<string, { total: number; count: number }> = {};
  for (const k of keys) m[k] = { total: 100, count: Math.round((rates[k] || 0) * 100) };
  return m;
}

const OBSERVED = {
  tight_schedule: 0.735,
  duplicate_stops: 0.254,
  field_completeness: 0.228,
  route_failure: 0.130,
  unverified_restaurant: 0.094,
};

describe('품질 점수 — 실제 오류율이 점수에 드러난다', () => {
  it('가중치 합은 100 이다', () => {
    const sum = Object.values(METRIC_WEIGHTS).reduce((a: number, b: number) => a + b, 0);
    expect(sum).toBe(100);
  });

  it('실측 오류율에서 90점 근처가 나오지 않는다 (감춤 방지)', () => {
    const score = computeWeightedScore(metricsFromRates(OBSERVED) as never);
    // 옛 가중치에서는 89 였다. 손님 체감 항목을 올렸으므로 확실히 더 낮아야 한다.
    expect(score).toBeLessThan(85);
  });

  it('촉박한 일정이 경미 항목보다 무겁다', () => {
    expect(METRIC_WEIGHTS.tight_schedule).toBeGreaterThan(METRIC_WEIGHTS.bad_address_prefix);
    expect(METRIC_WEIGHTS.tight_schedule).toBeGreaterThan(METRIC_WEIGHTS.language_mismatch);
    expect(METRIC_WEIGHTS.tight_schedule).toBeGreaterThanOrEqual(10);
  });

  it('식이제한은 여전히 최상위 (안전 항목)', () => {
    const max = Math.max(...Object.values(METRIC_WEIGHTS) as number[]);
    expect(METRIC_WEIGHTS.dietary_violation).toBe(max);
  });
});

describe('치명 오류 지표', () => {
  it('촉박·경로실패·중복·식이제한이 치명 목록에 있다', () => {
    for (const k of ['dietary_violation', 'tight_schedule', 'route_failure', 'duplicate_stops']) {
      expect(CRITICAL_METRICS).toContain(k);
    }
  });

  it('하나라도 있으면 무사고가 아니다', () => {
    const clean = metricsFromRates({});
    expect(hasCriticalIssue(clean as never)).toBe(false);
    const dirty = metricsFromRates({ tight_schedule: 0.01 });
    expect(hasCriticalIssue(dirty as never)).toBe(true);
  });

  it('관리자 요약이 무사고 비율을 함께 낸다 (평균만 보지 않기)', () => {
    const code = read('api/admin-quality-summary.js');
    expect(code).toContain('cleanPlanRate');
    expect(code).toContain('hasCriticalIssue');
  });
});

describe('P2 — 날씨 아이콘·번역·제목·번들', () => {
  it('아이콘을 기온이 아니라 날씨 상태에서 정한다', () => {
    for (const f of ['src/pages/MyPage.tsx', 'src/sections/MobileHome.tsx']) {
      const code = read(f);
      expect(code, `${f}: 기온 기반 아이콘 잔존`).not.toMatch(/icon:\s*Number\(cur\.temp_C\)/);
      expect(code).toContain('pickWeatherIcon');
    }
  });

  it('마이페이지 영어 하드코딩이 번역 키로 이동했다', () => {
    const code = read('src/pages/MyPage.tsx');
    expect(code).not.toContain('>Point History<');
    expect(code).not.toContain('text="No reviews yet"');
    expect(code).toContain('pointHistoryTitle');
    for (const lang of ['ko', 'en', 'ja', 'zh']) {
      expect(read(`src/i18n/locales/${lang}.json`)).toContain('"pointHistoryTitle"');
    }
  });

  it('관리자 화면마다 브라우저 제목을 지정한다', () => {
    for (const f of [
      'src/pages/AdminReviews.tsx', 'src/pages/AdminIntentClassifier.tsx',
      'src/pages/AdminAllBookings.tsx', 'src/pages/AdminQualityDashboard.tsx',
      'src/pages/AdminSales.tsx',
    ]) {
      expect(read(f), `${f}: usePageMeta 없음`).toContain('usePageMeta(');
    }
  });

  it('PDF 라이브러리를 PWA 사전 저장에서 뺀다', () => {
    expect(read('vite.config.ts')).toContain("'**/html2pdf-*.js'");
  });
});
