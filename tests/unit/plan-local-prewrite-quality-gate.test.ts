/**
 * scripts/plan-local — 성공 아티팩트 쓰기 전 fail-closed 품질 게이트 (2026-08-24).
 *
 * _pipeline.mjs 의 5개 순수 체크 함수(day 수 / 빈 day / 비-lodging 중복 / 다도시 bookend /
 * 식이·식사커버리지)와 이를 묶는 runPreWriteQualityChecks 를 검증한다.
 * process.exit·파일쓰기는 run.mjs(CLI 진입점) 에만 있고 여기선 순수 함수만 테스트 —
 * 중복 체크는 qualityMetrics.findDuplicateStops, 식이 체크는 finalItineraryGate.runFinalItineraryValidation
 * 을 그대로 재사용(단일 분류 소스, 별도 로직 없음).
 *
 * "artifact IS written / NOT written + exit code" 는 g)/h) 에서 run.mjs 를 실제 child_process
 * 로 돌려 outputs/plan-<scenario>.json 존재 여부 + exit code 로 직접 확인한다(진짜 CLI 배선 검증).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, unlinkSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  checkExactDayCount,
  checkAllDaysNonEmpty,
  checkNoDuplicateStops,
  checkMultiCityBookends,
  checkDietaryCoverage,
  runPreWriteQualityChecks,
} from '../../scripts/plan-local/_pipeline.mjs';

const ROOT = resolve(process.cwd());
const FIXTURES_DIR = resolve(ROOT, 'scripts/plan-local/fixtures');
const OUTPUTS_DIR = resolve(ROOT, 'scripts/plan-local/outputs');
const RUN_MJS = resolve(ROOT, 'scripts/plan-local/run.mjs');

const okDay = (dayNum: number) => ({
  day: dayNum,
  stops: [
    { order: 1, category: 'lodging', name: '호텔' },
    { order: 2, category: 'culture', name: '경복궁', address: '서울특별시 종로구 1' },
    { order: 3, category: 'food', name: '비건 하우스', address: '서울특별시 종로구 12' },
    { order: 4, category: 'culture', name: '북촌', address: '서울특별시 종로구 3' },
    { order: 5, category: 'lodging', name: '호텔' },
  ],
});
// day 간 교차 중복 오탐 방지용 — findDuplicateStops 는 day 를 안 가리고 전체 stop 을
// flatten 하므로, "여러 day 에 걸쳐 호텔만 반복" 을 검증하려면 비-lodging stop 이름이
// day 마다 달라야 한다(같은 이름을 쓰면 cross-day 중복으로 잡혀 버림).
const okDay2 = (dayNum: number) => ({
  day: dayNum,
  stops: [
    { order: 1, category: 'lodging', name: '호텔' },
    { order: 2, category: 'culture', name: '남산타워', address: '서울특별시 용산구 1' },
    { order: 3, category: 'food', name: '한옥 비건 식당', address: '서울특별시 용산구 12' },
    { order: 4, category: 'culture', name: '이태원', address: '서울특별시 용산구 3' },
    { order: 5, category: 'lodging', name: '호텔' },
  ],
});
const dupDay = (dayNum: number) => ({
  day: dayNum,
  stops: [
    { order: 1, category: 'lodging', name: '호텔' },
    { order: 2, category: 'culture', name: '경복궁', address: '서울특별시 종로구 1' },
    { order: 3, category: 'culture', name: '경복궁', address: '서울특별시 종로구 1' }, // 진짜 중복
    { order: 4, category: 'lodging', name: '호텔' },
  ],
});

describe('checkExactDayCount — 요청 day 수 == 생성 day 수', () => {
  it('일치하면 통과', () => {
    const r = checkExactDayCount({ days: [okDay(1), okDay(2)] }, { durationDays: 2 });
    expect(r).toEqual({ ok: true, expected: 2, actual: 2 });
  });
  it('불일치면 fail (요청 5일인데 3일만 생성)', () => {
    const r = checkExactDayCount({ days: [okDay(1), okDay(2), okDay(3)] }, { durationDays: 5 });
    expect(r.ok).toBe(false);
    expect(r).toEqual({ ok: false, expected: 5, actual: 3 });
  });
});

describe('checkAllDaysNonEmpty — 모든 day 가 stop 1개 이상', () => {
  it('전 day nonempty 면 통과', () => {
    const r = checkAllDaysNonEmpty({ days: [okDay(1), okDay(2)] });
    expect(r).toEqual({ ok: true, emptyDays: [] });
  });
  it('빈 day 있으면 fail', () => {
    const r = checkAllDaysNonEmpty({ days: [okDay(1), { day: 2, stops: [] }] });
    expect(r).toEqual({ ok: false, emptyDays: [2] });
  });
});

describe('checkNoDuplicateStops — qualityMetrics.findDuplicateStops 재사용 (lodging 예외)', () => {
  it('중복 없으면 통과', () => {
    const r = checkNoDuplicateStops({ days: [okDay(1)] });
    expect(r).toEqual({ ok: true, duplicates: [] });
  });
  it('호텔 반복은 예외 — day 여러 개라도 통과', () => {
    const r = checkNoDuplicateStops({ days: [okDay(1), okDay2(2)] });
    expect(r.ok).toBe(true);
  });
  it('비-lodging 중복(경복궁 재등장)은 fail', () => {
    const r = checkNoDuplicateStops({ days: [dupDay(1)] });
    expect(r.ok).toBe(false);
    expect(r.duplicates).toEqual([{ name: '경복궁', count: 2 }]);
  });
});

describe('checkMultiCityBookends — 도시 변경 day 의 호텔↔역 leg', () => {
  it('단일도시(도시 변경 day 없음) 는 통과', () => {
    const r = checkMultiCityBookends({ days: [okDay(1), okDay(2)] });
    expect(r).toEqual({ ok: true, cityChangeDays: 0, missing: [] });
  });
  it('pre/post 둘 다 있으면 통과', () => {
    const day = {
      day: 2,
      stops: [okDay(2).stops[0]],
      intercity_transit: {
        mode: 'KTX', from_city: 'Seoul', to_city: 'Busan',
        lodging_to_station: { method: 'taxi', est_min: 10 },
        station_to_lodging: { method: 'taxi', est_min: 15 },
      },
    };
    const r = checkMultiCityBookends({ days: [day] });
    expect(r.ok).toBe(true);
  });
  it('leg 하나라도 누락되면 fail', () => {
    const day = {
      day: 2,
      stops: [okDay(2).stops[0]],
      intercity_transit: {
        mode: 'KTX', from_city: 'Seoul', to_city: 'Busan',
        lodging_to_station: { method: 'taxi', est_min: 10 },
        // station_to_lodging 누락
      },
    };
    const r = checkMultiCityBookends({ days: [day] });
    expect(r.ok).toBe(false);
    expect(r.missing).toEqual([{
      day: 2, fromTo: 'Seoul→Busan', mode: 'KTX', missingLegs: ['station_to_lodging(역→호텔)'],
    }]);
  });
});

describe('checkDietaryCoverage — 종단 식이/식사커버리지 (finalItineraryGate 재사용)', () => {
  it('dietPrefs 없으면 no-op(항상 ok)', () => {
    const r = checkDietaryCoverage({ days: [dupDay(1)] }, { dietPrefs: [] }, []);
    expect(r.ok).toBe(true);
  });
  it('vegan 요청인데 claim 없는 일반식당 → 위반 fail', () => {
    const itinerary = {
      days: [{
        day: 1,
        stops: [
          { order: 1, category: 'lodging', name: '호텔' },
          { order: 2, category: 'culture', name: '경복궁', address: '서울특별시 종로구 1' },
          { order: 3, category: 'food', name: '일반 식당', address: '서울특별시 종로구 12' }, // vegan claim 없음
          { order: 4, category: 'lodging', name: '호텔' },
        ],
      }],
    };
    const r = checkDietaryCoverage(itinerary, { dietPrefs: ['vegan'], language: 'en' }, []);
    expect(r.ok).toBe(false);
    expect(r.code).toBe('DIETARY_VIOLATION');
  });
  it('vegan 요청 + 관광 3곳인데 food stop 0개인 정상 day → 식사커버리지 fail', () => {
    const itinerary = {
      days: [{
        day: 1,
        stops: [
          { order: 1, category: 'lodging', name: '호텔' },
          { order: 2, category: 'culture', name: 'A' },
          { order: 3, category: 'culture', name: 'B' },
          { order: 4, category: 'culture', name: 'C' },
          { order: 5, category: 'lodging', name: '호텔' },
        ],
      }],
    };
    const r = checkDietaryCoverage(itinerary, { dietPrefs: ['vegan'], language: 'en' }, []);
    expect(r.ok).toBe(false);
    expect(r.code).toBe('DIETARY_MEAL_COVERAGE_FAILED');
  });
});

describe('runPreWriteQualityChecks — 종합 판정 (5개 체크 전부 통과해야 ok)', () => {
  it('전부 정상이면 ok:true, failures 빔', () => {
    const r = runPreWriteQualityChecks({
      itinerary: { days: [okDay(1), okDay2(2)] },
      userInput: { durationDays: 2, dietPrefs: [] },
      foodIndex: [],
    });
    expect(r).toEqual({ ok: true, failures: [] });
  });

  it('여러 체크가 동시에 깨지면 failures 에 전부 수집 (day 수 + 중복)', () => {
    const r = runPreWriteQualityChecks({
      itinerary: { days: [dupDay(1)] }, // 1 day 인데 요청은 2일, 비-lodging 중복도 있음
      userInput: { durationDays: 2, dietPrefs: [] },
      foodIndex: [],
    });
    expect(r.ok).toBe(false);
    const checks = r.failures.map((f: any) => f.check);
    expect(checks).toContain('day_count');
    expect(checks).toContain('duplicate_stops');
  });
});

// ── g)/h) run.mjs CLI 실제 배선 — "체크 실패 시 아티팩트 미기록 + nonzero exit" ──────
describe('run.mjs CLI — 성공 아티팩트는 게이트 통과 후에만 쓰인다', () => {
  const passScenario = 'sample';
  const passOutPath = resolve(OUTPUTS_DIR, `plan-${passScenario}.json`);

  const failScenario = '__test_daycount_mismatch__';
  const failBlocksPath = resolve(FIXTURES_DIR, `blocks-${failScenario}.json`);
  const failSelPath = resolve(FIXTURES_DIR, `selection-${failScenario}.json`);
  const failInputPath = resolve(FIXTURES_DIR, `userinput-${failScenario}.json`);
  const failOutPath = resolve(OUTPUTS_DIR, `plan-${failScenario}.json`);

  beforeAll(() => {
    // sample-*.json 을 그대로 재사용하되 durationDays 만 터무니없는 값(99)으로 틀어
    // day_count 체크만 확실히 깨뜨린다(다른 4체크는 sample 이 이미 통과하므로 그대로 통과).
    const blocks = readFileSync(resolve(FIXTURES_DIR, 'sample-blocks.json'), 'utf8');
    const selection = readFileSync(resolve(FIXTURES_DIR, 'sample-selection.json'), 'utf8');
    const input = JSON.parse(readFileSync(resolve(FIXTURES_DIR, 'sample-userinput.json'), 'utf8'));
    input.durationDays = 99;
    writeFileSync(failBlocksPath, blocks, 'utf8');
    writeFileSync(failSelPath, selection, 'utf8');
    writeFileSync(failInputPath, JSON.stringify(input, null, 2), 'utf8');
    if (existsSync(failOutPath)) unlinkSync(failOutPath);
  });

  afterAll(() => {
    for (const p of [failBlocksPath, failSelPath, failInputPath, failOutPath]) {
      if (existsSync(p)) unlinkSync(p);
    }
  });

  it('통과 케이스(sample) — exit 0 + 아티팩트 기록됨', () => {
    if (existsSync(passOutPath)) unlinkSync(passOutPath);
    execFileSync('node', [RUN_MJS, passScenario], { cwd: ROOT, stdio: 'pipe' });
    expect(existsSync(passOutPath)).toBe(true);
  });

  it('실패 케이스(day 수 불일치) — nonzero exit + 아티팩트 미기록', () => {
    let threw = false;
    try {
      execFileSync('node', [RUN_MJS, failScenario], { cwd: ROOT, stdio: 'pipe' });
    } catch (e: any) {
      threw = true;
      expect(e.status).not.toBe(0);
    }
    expect(threw).toBe(true);
    expect(existsSync(failOutPath)).toBe(false);
  });
});
