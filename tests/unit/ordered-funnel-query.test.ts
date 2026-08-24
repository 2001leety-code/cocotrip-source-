/**
 * api/_shared/orderedFunnel.js — 순수 함수 단위 테스트 (2026-08-24).
 *
 * PostHog 를 전혀 부르지 않는다 — HogQL 문자열·정규화·불변식 검증만 확인한다.
 * 실제 fetch 배선 검증은 admin-posthog-funnel-api.test.ts 가 담당한다.
 */
import { describe, it, expect } from 'vitest';
import {
  SEMANTICS_VERSION,
  PLAN_TYPE,
  FUNNEL_STEP_DEFS,
  buildFunnelWindow,
  buildOrderedFunnelSQL,
  buildLatestEventSQL,
  normalizeFunnelCounts,
  normalizeLatestEventAt,
  validateOrderedFunnel,
} from '../../api/_shared/orderedFunnel.js';

describe('SEMANTICS_VERSION', () => {
  it('명시적 버전 문자열 — 응답 계약 변경 시 여기서 bump', () => {
    expect(SEMANTICS_VERSION).toBe('ordered-same-person-v1');
  });
});

describe('buildFunnelWindow', () => {
  const now = new Date('2026-08-24T12:00:00.000Z');

  it('days 를 그대로 반영한 [windowStart, windowEnd) 를 만든다', () => {
    const w = buildFunnelWindow(30, now);
    expect(w.days).toBe(30);
    expect(w.windowEnd).toBe('2026-08-24T12:00:00.000Z');
    expect(w.windowStart).toBe('2026-07-25T12:00:00.000Z');
  });

  it('범위를 벗어난 days 는 [1, 366] 로 clamp', () => {
    expect(buildFunnelWindow(0, now).days).toBe(1);
    expect(buildFunnelWindow(-5, now).days).toBe(1);
    expect(buildFunnelWindow(9999, now).days).toBe(366);
  });

  it('숫자가 아닌 days 는 기본 30', () => {
    expect(buildFunnelWindow('abc', now).days).toBe(30);
    expect(buildFunnelWindow(undefined, now).days).toBe(30);
    expect(buildFunnelWindow(null, now).days).toBe(30);
  });
});

describe('buildOrderedFunnelSQL', () => {
  const sql = buildOrderedFunnelSQL('2026-07-25T00:00:00.000Z', '2026-08-24T00:00:00.000Z', PLAN_TYPE);

  it('5개 이벤트만 포함하고 plan_generated 는 없다', () => {
    expect(sql).toMatch(/'wizard_seen'/);
    expect(sql).toMatch(/'preview_success'/);
    expect(sql).toMatch(/'payment_started'/);
    expect(sql).toMatch(/'payment_completed'/);
    expect(sql).toMatch(/'planner_complete'/);
    expect(sql).not.toMatch(/plan_generated/);
  });

  it('결제 두 단계에만 planType=ai-planner-full 필터를 건다 (투어/기타 구매 제외)', () => {
    const planTypeMatches = sql.match(/properties\.planType = 'ai-planner-full'/g) || [];
    expect(planTypeMatches).toHaveLength(2);
  });

  it('같은 person_id 열에서 5단계를 모두 집계한다 (동일인 보장 — join 아님)', () => {
    expect(sql).toMatch(/person_id/);
    expect((sql.match(/person_id/g) || []).length).toBeGreaterThanOrEqual(2);
  });

  it('시간순 체인 — 각 단계가 직전 단계 타임스탬프 이상이어야 한다', () => {
    expect(sql).toMatch(/t2 >= t1/);
    expect(sql).toMatch(/t3 >= t2/);
    expect(sql).toMatch(/t4 >= t3/);
    expect(sql).toMatch(/t5 >= t4/);
  });

  it('c1..c5 각 단계 조건이 이전 단계 조건을 그대로 포함한다 (구조적 nonincreasing 보장)', () => {
    // c3 조건 문자열이 c2 조건 전체를 부분 문자열로 포함해야 "AND 로만 좁아진다"가 성립.
    const c2Cond = 't1 IS NOT NULL AND t2 IS NOT NULL AND t2 >= t1';
    const c3Cond = `${c2Cond} AND t3 IS NOT NULL AND t3 >= t2`;
    const c4Cond = `${c3Cond} AND t4 IS NOT NULL AND t4 >= t3`;
    const c5Cond = `${c4Cond} AND t5 IS NOT NULL AND t5 >= t4`;
    expect(sql).toContain(`countIf(${c2Cond})`);
    expect(sql).toContain(`countIf(${c3Cond})`);
    expect(sql).toContain(`countIf(${c4Cond})`);
    expect(sql).toContain(`countIf(${c5Cond})`);
  });

  it('window 경계를 포함한다', () => {
    expect(sql).toMatch(/timestamp >= toDateTime\('2026-07-25T00:00:00\.000Z'\)/);
    expect(sql).toMatch(/timestamp < toDateTime\('2026-08-24T00:00:00\.000Z'\)/);
  });

  it("작은따옴표 포함 planType 도 안전하게 이스케이프한다 (HogQL injection 방지)", () => {
    const injected = buildOrderedFunnelSQL('2026-01-01T00:00:00.000Z', '2026-01-02T00:00:00.000Z', "x' OR '1'='1");
    expect(injected).toContain("x'' OR ''1''=''1");
    expect(injected).not.toMatch(/x' OR '1'='1/);
  });
});

describe('buildLatestEventSQL', () => {
  it('5개 이벤트 전부를 보되 결제 두 단계는 planType 로 좁힌다', () => {
    const sql = buildLatestEventSQL('2026-07-25T00:00:00.000Z', '2026-08-24T00:00:00.000Z', PLAN_TYPE);
    expect(sql).toMatch(/max\(timestamp\)/);
    expect(sql).toMatch(/'wizard_seen', 'preview_success', 'planner_complete'/);
    expect(sql).toMatch(/'payment_started', 'payment_completed'\) AND properties\.planType = 'ai-planner-full'/);
  });
});

describe('normalizeFunnelCounts', () => {
  it('5개 열을 id/label/count 로 변환한다', () => {
    const steps = normalizeFunnelCounts([[100, 80, 40, 35, 30]]);
    expect(steps).toHaveLength(5);
    expect(steps?.map((s) => s.id)).toEqual(FUNNEL_STEP_DEFS.map((d) => d.id));
    expect(steps?.map((s) => s.count)).toEqual([100, 80, 40, 35, 30]);
    expect(steps?.every((s) => typeof s.label === 'string' && s.label.length > 0)).toBe(true);
  });

  it('행이 없거나 짧으면 null (malformed)', () => {
    expect(normalizeFunnelCounts([])).toBeNull();
    expect(normalizeFunnelCounts(undefined)).toBeNull();
    expect(normalizeFunnelCounts([[1, 2, 3]])).toBeNull();
    expect(normalizeFunnelCounts([null])).toBeNull();
  });
});

describe('normalizeLatestEventAt', () => {
  it('유효 타임스탬프 → ISO 문자열', () => {
    expect(normalizeLatestEventAt([['2026-08-20T10:00:00Z']])).toBe('2026-08-20T10:00:00.000Z');
  });

  it('값 없음/null → null (기간 내 이벤트 없음)', () => {
    expect(normalizeLatestEventAt([[null]])).toBeNull();
    expect(normalizeLatestEventAt([])).toBeNull();
    expect(normalizeLatestEventAt(undefined)).toBeNull();
  });

  it('파싱 불가 값 → null (거짓 날짜를 만들어내지 않는다)', () => {
    expect(normalizeLatestEventAt([['not-a-date']])).toBeNull();
  });
});

describe('validateOrderedFunnel — 잘못된 결과는 거부한다', () => {
  function steps(counts: number[]) {
    return FUNNEL_STEP_DEFS.map((d, i) => ({ id: d.id, label: d.label, count: counts[i] }));
  }

  it('정상 nonincreasing 시퀀스 → 통과', () => {
    expect(validateOrderedFunnel(steps([100, 80, 40, 35, 30]))).toEqual({ ok: true, reason: null });
  });

  it('동률(변화 없음)도 nonincreasing 이라 통과', () => {
    expect(validateOrderedFunnel(steps([50, 50, 50, 50, 50]))).toEqual({ ok: true, reason: null });
  });

  it('다운스트림 > 업스트림 → NONMONOTONIC 거부', () => {
    const r = validateOrderedFunnel(steps([10, 20, 5, 4, 3]));
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('NONMONOTONIC');
  });

  it('단계 개수 불일치 → STEP_COUNT_MISMATCH', () => {
    expect(validateOrderedFunnel(steps([10, 9, 8, 7, 6]).slice(0, 4)).reason).toBe('STEP_COUNT_MISMATCH');
    expect(validateOrderedFunnel(null as unknown as never).reason).toBe('STEP_COUNT_MISMATCH');
  });

  it('단계 순서/id 불일치 → STEP_ORDER_MISMATCH', () => {
    const swapped = steps([10, 9, 8, 7, 6]);
    [swapped[0], swapped[1]] = [swapped[1], swapped[0]];
    expect(validateOrderedFunnel(swapped).reason).toBe('STEP_ORDER_MISMATCH');
  });

  it('음수/비정수 카운트 → INVALID_COUNT', () => {
    expect(validateOrderedFunnel(steps([10, -1, 8, 7, 6])).reason).toBe('INVALID_COUNT');
    expect(validateOrderedFunnel(steps([10, 9.5, 8, 7, 6])).reason).toBe('INVALID_COUNT');
    expect(validateOrderedFunnel(steps([10, NaN, 8, 7, 6])).reason).toBe('INVALID_COUNT');
  });

  it('중복 집계로 상단이 부풀려진 것처럼 보이는 경우도 NONMONOTONIC 으로 잡는다', () => {
    // 예: 같은 사람이 여러 번 잡혀 c2가 c1을 넘는 결과(쿼리 버그 시뮬레이션)
    expect(validateOrderedFunnel(steps([50, 60, 40, 30, 20])).reason).toBe('NONMONOTONIC');
  });
});
