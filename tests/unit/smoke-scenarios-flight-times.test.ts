/**
 * 2026-08-05: 자동 검증이 도착일·출국일 계열을 **한 번도 건드리지 못했다.**
 *
 * `validate-planner.cjs` 시나리오 5개에 arrival/departure 시각이 없어서
 * `applyDepartureDayFlightCap` 이 조기 반환했다 → #1225·#1227·#1228·#1229·#1231·
 * #1236·#1237·#1239 전부 손으로 운영 API 를 쳐서 찾았다.
 *
 * 이 테스트는 그 사각지대가 다시 생기지 않게 잠근다. 스크립트 자체는 운영 API +
 * Firebase 인증이 필요해 CI 에서 실행할 수 없다 — 그래서 **배선을 소스로 고정**한다.
 * (탐지기 자체의 동작은 departure-flight-overrun-detector.test.ts 13건이 잠근다.)
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';

const validatePlanner = readFileSync('scripts/validate-planner.cjs', 'utf8');
const healthCheck = readFileSync('scripts/daily-health-check.mjs', 'utf8');

/** 시나리오 배열만 잘라낸다 — 파일 전체를 정규식으로 훑으면 주석에 걸린다. */
const scenarioBlock = validatePlanner.slice(
  validatePlanner.indexOf('const scenarios = ['),
  validatePlanner.indexOf('function extractStops'),
);
const scenarioLine = (id: string) =>
  scenarioBlock.split('\n').find((l) => l.includes(`id: '${id}'`)) || '';

describe('스모크 시나리오 — 도착·출국 시각 (자동 검증 사각지대 차단)', () => {
  it('legacy 같은 권역: jeju-vegan 에 도착·출국 시각이 있다', () => {
    const line = scenarioLine('jeju-vegan');
    expect(line).toContain('arrivalTime');
    expect(line).toContain('departureTime');
  });

  it('legacy 권역 밖: busan-halal 이 인천공항을 쓴다 (거리 보정 #1228/#1236 이 여기서만 드러난다)', () => {
    const line = scenarioLine('busan-halal');
    expect(line).toContain('departureTime');
    // area 로 유추하면 PUS 가 되어 같은 권역이 된다 → 보정이 발동하지 않는다.
    expect(line).toContain("arrival_airport: 'ICN_T1'");
    expect(line).toContain("departure_airport: 'ICN_T1'");
  });

  it('block_mode 대조군: seoul-meat 에도 시각이 있다', () => {
    const line = scenarioLine('seoul-meat');
    expect(line).toContain('arrivalTime');
    expect(line).toContain('departureTime');
  });

  it('시나리오가 명시한 공항이 area 유추보다 우선한다', () => {
    // 이 순서가 뒤집히면 busan-halal 이 조용히 PUS 로 돌아가 커버리지가 사라진다.
    expect(validatePlanner).toMatch(/arrival_airport:\s*s\.arrival_airport\s*\|\|/);
    expect(validatePlanner).toMatch(/departure_airport:\s*s\.departure_airport\s*\|\|/);
  });

  it('다양성 비교쌍(rep1/rep2)은 조건이 같아야 한다', () => {
    // 한쪽에만 시각을 넣으면 중복률 비교가 무의미해진다.
    expect(scenarioLine('seoul-meat-rep1')).not.toContain('departureTime');
    expect(scenarioLine('seoul-meat-rep2')).not.toContain('departureTime');
  });
});

describe('스모크 게이트 — 출국일 마감 초과는 실패로 낸다', () => {
  it('validate-planner 가 탐지기를 부르고 리포트에 총계를 남긴다', () => {
    expect(validatePlanner).toContain('detectDepartureFlightOverrun');
    expect(validatePlanner).toMatch(/departure_overrun_total:\s*overrunTotal/);
  });

  it('validate-planner 는 exit code 로 실패시키지 않는다 (원인 오보 방지)', () => {
    // execSync 가 non-zero 를 throw 로 잡으면 "validate-planner 실행 실패" 라는
    // 엉뚱한 원인이 보고된다(#1230 과 같은 함정). 게이트는 health-check 가 건다.
    const tail = validatePlanner.slice(validatePlanner.indexOf('overrunTotal > 0'));
    expect(tail).not.toContain('process.exitCode = 1');
  });

  it('daily-health-check 가 총계를 읽어 exit 조건에 넣는다', () => {
    expect(healthCheck).toMatch(/departure_overrun_total:\s*report\.departure_overrun_total/);
    expect(healthCheck).toMatch(/no_departure_overrun:\s*\(validation\.departure_overrun_total\s*\|\|\s*0\)\s*===\s*0/);
    // 임계값 없음 — 1건이라도 실패.
    expect(healthCheck).toMatch(/\|\|\s*!record\.no_departure_overrun/);
  });
});
