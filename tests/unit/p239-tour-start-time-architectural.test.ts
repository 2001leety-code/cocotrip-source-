/**
 * P239 — Tour start time architectural fix (2026-05-27 운영자 의도)
 *
 * 운영자 의도: "새벽 도착해도 호텔까지 경로만 + 투어 시작시간 부터 stops 작성"
 *
 * Root cause level 해결:
 *   - P159 새벽 stops (00:00-04:59)
 *   - P136 RouteAgent 24h wrap
 *   - B-13 lodging cross-city false positive (부분)
 *
 * Architectural pieces:
 *   1. requestShaper.js — tourStartTime parse + default '09:00' fallback + HH:MM 검증
 *   2. handlerCore.js — shaped 구조분해 + tryRunBlockMode userInput.tour_start_time 전달
 *   3. userMessageBuilder.js — Gemini JSON 에 tour_start_time inject
 *   4. buildPrompt.js — ARRIVAL DAY HANDLING 섹션에 P239 룰 명시
 *   5. RouteAgent.js — Day1 stops[1+] start_time floor (tour_start_time 이전 차단)
 *   6. responseValidator.js — B-LATE-ARRIVAL P239 새 룰 (옛 9h sleep buffer 폐기)
 *   7. Frontend Wizard/PlanDetail/PDF — UI + i18n 4-lang
 */

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../../');

function readFile(rel: string): string {
  return readFileSync(resolve(ROOT, rel), 'utf-8');
}

// ────────────────────────────────────────────────────────────────────────────
// 1. requestShaper.js — tourStartTime parse + default + HH:MM 검증
// ────────────────────────────────────────────────────────────────────────────
describe('P239 architectural: requestShaper tourStartTime', () => {
  it('tourStartTime 변수가 정의되어 있어야 함 (default 09:00 fallback)', () => {
    const src = readFile('api/_ai_core/requestShaper.js');
    expect(/const\s+tourStartTime\s*=/.test(src), 'tourStartTime 변수 누락').toBe(true);
    expect(/['"]09:00['"]/.test(src), "default '09:00' 폴백 누락").toBe(true);
    expect(/\/\^\\d\{2\}:\\d\{2\}\$\//.test(src), 'HH:MM 정규식 검증 누락').toBe(true);
  });

  it('return 객체에 tourStartTime 포함 (handlerCore destructure)', () => {
    const src = readFile('api/_ai_core/requestShaper.js');
    // requestShaper.js 의 return 은 단 1개 (function shapeRequest 의 결과).
    // tourStartTime substring 이 src 어디든 있고 + return 키워드 이후 어딘가에 있어야 함.
    expect(/tourStartTime/.test(src), 'requestShaper.js 어디에도 tourStartTime 없음').toBe(true);
    const lastReturnIdx = src.lastIndexOf('return {');
    expect(lastReturnIdx >= 0, "'return {' 패턴 누락").toBe(true);
    const afterReturn = src.slice(lastReturnIdx);
    expect(/tourStartTime/.test(afterReturn), 'return 객체에 tourStartTime export 누락').toBe(true);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// 2. handlerCore.js — shaped 구조분해 + tryRunBlockMode userInput
// ────────────────────────────────────────────────────────────────────────────
describe('P239 architectural: handlerCore tourStartTime forwarding', () => {
  it('shaped 구조분해에 tourStartTime 포함', () => {
    const src = readFile('api/_ai_core/handlerCore.js');
    const destructureMatch = src.match(/const\s*\{([\s\S]+?)\}\s*=\s*shaped\s*;/);
    expect(destructureMatch, 'shaped 구조분해 패턴 누락').toBeTruthy();
    expect(/tourStartTime/.test(destructureMatch![1]), 'shaped 구조분해에 tourStartTime 누락').toBe(true);
  });

  it('tryRunBlockMode userInput 에 tour_start_time 전달', () => {
    const src = readFile('api/_ai_core/handlerCore.js');
    const blockModeCall = src.match(/tryRunBlockMode\([\s\S]*?\}\s*\)\s*\)/);
    expect(blockModeCall, 'tryRunBlockMode 호출 누락').toBeTruthy();
    expect(
      /tour_start_time\s*:\s*tourStartTime/.test(blockModeCall![0]),
      'tryRunBlockMode userInput 에 tour_start_time: tourStartTime 누락'
    ).toBe(true);
  });

  // SAFETY-CRITICAL: 트랙 B (P240) dietaryRestrictions 영역 건드리지 않았는지 확인
  it('P240 영역 (dietaryRestrictions→dietPrefs 합집합) 유지 — 트랙 B 보존', () => {
    const src = readFile('api/_ai_core/handlerCore.js');
    const blockModeCall = src.match(/tryRunBlockMode\([\s\S]*?\}\s*\)\s*\)/);
    expect(blockModeCall, 'tryRunBlockMode 호출 누락').toBeTruthy();
    expect(/dietPrefs:\s*dietaryAll/.test(blockModeCall![0]), 'P240 dietPrefs(dietaryAll 합집합) 누락 — track B 회귀').toBe(true);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// 3. userMessageBuilder.js — Gemini userMessage 에 tour_start_time inject
// ────────────────────────────────────────────────────────────────────────────
describe('P239 architectural: userMessageBuilder tour_start_time inject', () => {
  it('userMessage JSON 에 tour_start_time 필드 포함', () => {
    const src = readFile('api/_ai_core/userMessageBuilder.js');
    expect(/tour_start_time/.test(src), 'userMessageBuilder.js tour_start_time 누락').toBe(true);
    // tourStartTime destructure 도 확인
    expect(/tourStartTime/.test(src), 'tourStartTime destructure 누락').toBe(true);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// 4. buildPrompt.js — ARRIVAL DAY HANDLING P239 섹션
// ────────────────────────────────────────────────────────────────────────────
describe('P239 architectural: buildPrompt ARRIVAL DAY HANDLING', () => {
  it('P239 섹션 + tour_start_time 룰 명시', () => {
    const src = readFile('api/_ai_core/buildPrompt.js');
    expect(/P239/.test(src), 'P239 섹션 헤더 누락').toBe(true);
    expect(/tour_start_time/.test(src), 'tour_start_time 룰 누락').toBe(true);
    // "stops[1+]" 룰 명시 (Day 1 첫 활동 시각)
    expect(
      /stops\[1\+\][\s\S]{0,100}tour_start_time/.test(src),
      'stops[1+] >= tour_start_time 룰 누락'
    ).toBe(true);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// 5. RouteAgent.js — Day1 stops[1+] floor + _p239TourStartMin cache
// ────────────────────────────────────────────────────────────────────────────
describe('P239 architectural: RouteAgent Day1 tour_start_time floor', () => {
  it('Day 1 tour_start_time floor 로직 + dayPlan cache', () => {
    const src = readFile('api/_ai_core/agents/RouteAgent.js');
    expect(/P239/.test(src), 'RouteAgent P239 마커 누락').toBe(true);
    expect(/_p239TourStartMin/.test(src), '_p239TourStartMin dayPlan cache 누락').toBe(true);
    // i === 1 의 floor 적용 (lodging → 첫 활동)
    expect(
      /i\s*===\s*1[\s\S]{0,300}_p239TourStartMin/.test(src),
      'i === 1 에서 tour_start_time floor 적용 누락'
    ).toBe(true);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// 6. responseValidator.js — B-LATE-ARRIVAL P239 신 룰
// ────────────────────────────────────────────────────────────────────────────
describe('P239 architectural: responseValidator B-LATE-ARRIVAL P239', () => {
  it('tour_start_time 기준 validator 로 교체 (옛 9h sleep buffer 폐기)', () => {
    const src = readFile('api/_ai_core/responseValidator.js');
    expect(/P239/.test(src), 'responseValidator P239 섹션 누락').toBe(true);
    expect(/tour_start_time|tourStartTime/.test(src), 'tour_start_time 검증 누락').toBe(true);
    // B-LATE-ARRIVAL P239 (신 룰) 메시지 검증
    expect(
      /B-LATE-ARRIVAL P239/.test(src),
      'B-LATE-ARRIVAL P239 error 메시지 누락'
    ).toBe(true);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// 7. Frontend Wizard — tourStartTime state + prop forwarding
// ────────────────────────────────────────────────────────────────────────────
describe('P239 architectural: Frontend Wizard', () => {
  it('WizardForm/index.tsx — tourStartTime state + default 09:00', () => {
    const src = readFile('src/components/WizardForm/index.tsx');
    expect(/tourStartTime/.test(src), 'WizardForm/index.tsx tourStartTime 누락').toBe(true);
    expect(/useState\(['"]09:00['"]\)/.test(src), 'default 09:00 누락').toBe(true);
    expect(
      /tour_start_time\s*:\s*tourStartTime/.test(src),
      'handleGenerate body 에 tour_start_time forwarding 누락'
    ).toBe(true);
  });

  it('WizardStep2Details.tsx — tourStartTime prop + input', () => {
    const src = readFile('src/components/WizardForm/WizardStep2Details.tsx');
    expect(/tourStartTime/.test(src), 'WizardStep2Details.tsx tourStartTime prop 누락').toBe(true);
    expect(/tourStartTimeLabel|tourStartTimeHint/.test(src), 'i18n key 누락').toBe(true);
  });

  it('PlannerForm.tsx — PlannerFormValues 에 tour_start_time 추가', () => {
    const src = readFile('src/components/PlannerForm.tsx');
    expect(/tour_start_time/.test(src), 'PlannerFormValues 에 tour_start_time 누락').toBe(true);
  });

  it('usePlannerHandlers.ts — tour_start_time → tourStartTime 변환', () => {
    // planner-intent-v1 (2026-08-24): 이 변환은 usePlannerHandlers.ts 인라인에서
    // lib/plannerIntent.ts::buildPlannerIntentV1 로 이동했다 (SSOT 단일화 — 모든
    // submit 경로가 이 한 함수를 거친다). usePlannerHandlers 는 그 함수를 부른다.
    const handlersSrc = readFile('src/pages/PlannerPage/hooks/usePlannerHandlers.ts');
    expect(
      /buildFullPlannerIntentPayload/.test(handlersSrc),
      'usePlannerHandlers가 buildFullPlannerIntentPayload(SSOT)를 쓰지 않음'
    ).toBe(true);
    const intentSrc = readFile('src/pages/PlannerPage/lib/plannerIntent.ts');
    expect(
      /tourStartTime[\s\S]{0,80}tour_start_time/.test(intentSrc),
      'plannerIntent.ts tour_start_time → tourStartTime backend forwarding 누락'
    ).toBe(true);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// 8. i18n 4-lang (ko/en/ja/zh)
// ────────────────────────────────────────────────────────────────────────────
describe('P239 architectural: i18n 4-lang labels', () => {
  it.each(['en', 'ko', 'ja', 'zh'])('%s.json 에 tourStartTimeLabel + tourStartTimeHint 포함', (lang) => {
    const json = JSON.parse(readFile(`src/i18n/locales/${lang}.json`));
    const planner = json.planner;
    expect(planner?.tourStartTimeLabel, `${lang}.json planner.tourStartTimeLabel 누락`).toBeTruthy();
    expect(planner?.tourStartTimeHint, `${lang}.json planner.tourStartTimeHint 누락`).toBeTruthy();
  });
});

// ────────────────────────────────────────────────────────────────────────────
// 9. PDF generator — Day 1 lodging-only 안내 카드
// ────────────────────────────────────────────────────────────────────────────
describe('P239 architectural: PDF generator Day 1 hint', () => {
  it('pdfGenerator.ts — Day 1 lodging-only 안내 카드 (tour_start_time 표시)', () => {
    const src = readFile('src/pages/PlanDetailPage/pdfGenerator.ts');
    expect(/P239/.test(src), 'pdfGenerator.ts P239 마커 누락').toBe(true);
    expect(/tour_start_time|tourStartTime/.test(src), 'tour_start_time 읽기 누락').toBe(true);
  });

  it('DayTimeline.tsx — Day 1 lodging-only 안내 카드', () => {
    const src = readFile('src/pages/PlanDetailPage/components/DayTimeline.tsx');
    expect(/P239/.test(src), 'DayTimeline.tsx P239 마커 누락').toBe(true);
    expect(/day1ArrivalOnly/.test(src), 'day1ArrivalOnly i18n key 누락').toBe(true);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// 10. 옛 client 호환 (tourStartTime 미입력)
// ────────────────────────────────────────────────────────────────────────────
describe('P239 backward compat: 옛 client (tourStartTime 미입력)', () => {
  it('requestShaper 가 빈 body 에 09:00 default 적용', () => {
    const src = readFile('api/_ai_core/requestShaper.js');
    // body.tourStartTime === undefined 시 default '09:00' 적용 검증
    expect(
      /tourStartTime[\s\S]{0,200}['"]09:00['"]/.test(src),
      'default 09:00 폴백 로직 누락 (옛 client 호환)'
    ).toBe(true);
  });
});
