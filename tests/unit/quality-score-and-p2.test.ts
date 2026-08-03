/**
 * 회귀 잠금 (2026-07-28) — 품질 점수가 오류율을 가리던 문제 + P2 표시 결함.
 *
 * 잠그는 성질: **오류율이 높으면 점수가 가중치만큼 실제로 깎인다.**
 *
 * ⚠️ 2026-08-03 정정 — 이 파일이 원래 근거로 쓰던 "실측 오류율"
 *   (촉박 73.5% · 중복 25.4% · 필드누락 22.8%)은 **오측정이었다.**
 *   촉박은 이동시간<30분(=잘 묶인 동선)을, 중복·필드누락은 숙소 앵커를 세고
 *   있었다. 상세 = api/_ai_core/qualityMetrics.js 헤더 +
 *   tests/unit/quality-metrics-structural-false-positives.test.ts.
 *   그래서 그 숫자를 테스트 기준으로 다시 쓰지 않는다. 대신 가중치가 실제로
 *   무는지를 합성 위반율로 직접 확인한다.
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

describe('품질 점수 — 실제 오류율이 점수에 드러난다', () => {
  it('가중치 합은 100 이다', () => {
    const sum = Object.values(METRIC_WEIGHTS).reduce((a: number, b: number) => a + b, 0);
    expect(sum).toBe(100);
  });

  it('한 지표가 전건 위반이면 딱 그 가중치만큼 깎인다 (감춤 방지)', () => {
    for (const [metric, weight] of Object.entries(METRIC_WEIGHTS)) {
      const score = computeWeightedScore(metricsFromRates({ [metric]: 1 }) as never);
      expect(score, `${metric}: 전건 위반인데 감점 ${100 - score}`).toBe(100 - (weight as number));
    }
  });

  it('손님 체감 항목이 여러 개 겹치면 80점 아래로 내려간다', () => {
    const score = computeWeightedScore(
      metricsFromRates({ tight_schedule: 1, route_failure: 1 }) as never,
    );
    expect(score).toBeLessThan(80);
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
