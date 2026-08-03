/**
 * 회귀 잠금 (2026-08-03) — 도착일 시작 시각이 두 경로에서 서로 달랐던 것.
 *
 * block_mode 는 2026-06-05(#arrival-realtime)부터 현실 계산을 썼다:
 *   도착 + 입국수속·짐·세관(90분) + 공항→권역 이동(공항별)
 * 그런데 **buildPrompt 는 Gemini 에게 계속 '도착 + 60분' 을 가르치고 있었다.**
 * 한쪽만 고친 것이다. 같은 여행에 두 개의 현실이 있었다.
 *
 * 운영 실측(ICN 14:00 도착 → 실제 권역 도착 17:00):
 *   legacy(Gemini)  첫 활동 16:15~16:26  ← 손님이 아직 공항에 있는 시각
 *   block_mode      첫 활동 17:00       ← 맞음
 *
 * 여기서 잠그는 것: 계산이 한 곳(constants)에만 있고, 프롬프트가 옛 룰을 다시
 * 가르치지 않으며, 두 경로가 같은 값을 받는다.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
// @ts-expect-error — JS module
import {
  arrivalReadyMinutes, arrivalReadyHHMM, IMMIGRATION_BUFFER_MIN, estimateAirportTransitMin,
} from '../../api/_ai_core/constants.js';

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');

describe('도착 가능 시각 계산', () => {
  it('운영 재현: ICN 14:00 도착 → 17:00 (옛 룰 15:00 아님)', () => {
    expect(arrivalReadyHHMM('14:00', 'ICN_T1')).toBe('17:00');
    expect(arrivalReadyHHMM('14:00', 'ICN_T1')).not.toBe('15:00');
  });

  it('공항마다 다르다 — 이동 시간이 실제로 반영된다', () => {
    expect(arrivalReadyHHMM('14:00', 'CJU')).toBe('15:55');  // 90 + 25
    expect(arrivalReadyHHMM('14:00', 'GMP')).toBe('16:15');  // 90 + 45
    expect(arrivalReadyHHMM('14:00', 'PUS')).toBe('16:25');  // 90 + 55
  });

  it('입국수속 + 공항이동 = 정확히 그 합', () => {
    const base = 14 * 60;
    expect(arrivalReadyMinutes('14:00', 'ICN_T1'))
      .toBe(base + IMMIGRATION_BUFFER_MIN + estimateAirportTransitMin('ICN_T1'));
  });

  it('자정을 넘기면 다음 날 시각으로 표시된다', () => {
    // 23:05 도착 + 90 + 90 = 다음날 02:05
    expect(arrivalReadyHHMM('23:05', 'ICN_T1')).toBe('02:05');
    // 분 단위 값은 wrap 하지 않는다(계산용) — 1440 을 넘는다
    expect(arrivalReadyMinutes('23:05', 'ICN_T1')).toBeGreaterThan(24 * 60);
  });

  it('도착 시각이 없으면 null (프롬프트가 이 규칙을 건너뛴다)', () => {
    expect(arrivalReadyHHMM('', 'ICN_T1')).toBeNull();
    expect(arrivalReadyHHMM(undefined, 'ICN_T1')).toBeNull();
  });

  it('모르는 공항은 보수적 기본값(70분)으로 떨어진다', () => {
    expect(arrivalReadyHHMM('14:00', 'ZZZ')).toBe('16:40'); // 90 + 70
  });
});

describe('두 경로가 같은 계산을 쓴다 (단일 원천)', () => {
  it('blockMode 가 자체 정의를 갖지 않고 constants 에서 가져온다', () => {
    const code = read('api/_ai_core/blockMode.js');
    expect(code).toMatch(/arrivalReadyMinutes[\s\S]{0,400}from '\.\/constants\.js'/);
    // 로컬 재정의가 살아나면 두 경로가 다시 갈린다.
    expect(code).not.toMatch(/^function arrivalReadyMinutes\(/m);
    expect(code).not.toMatch(/^function estimateAirportTransitMin\(/m);
  });

  it('Gemini 경로(userMessageBuilder)가 같은 헬퍼로 값을 주입한다', () => {
    const code = read('api/_ai_core/userMessageBuilder.js');
    expect(code).toContain("from './constants.js'");
    expect(code).toContain('arrival_ready_time');
    expect(code).toContain('arrivalReadyHHMM(');
  });

  // 🔴 여기가 핵심 — 프롬프트만 고치면 legacy 는 그대로다.
  //   RouteAgent 가 Day 1 활동 시각의 **바닥**을, responseValidator 가 **거부 기준**을 정한다.
  //   셋 중 하나라도 옛 `arrival + 60` 을 쓰면 손님이 공항에 있는 시각의 일정이 통과한다.
  it('RouteAgent 의 Day 1 바닥이 arrival+60 이 아니라 현실 계산이다', () => {
    const code = read('api/_ai_core/agents/RouteAgent.js');
    expect(code).toContain('arrivalReadyMinutes');
    expect(code).not.toMatch(/const arrivalPlus60 = data\.arrival_time/);
  });

  it('responseValidator 의 거부 기준도 현실 계산이다', () => {
    const code = read('api/_ai_core/responseValidator.js');
    expect(code).toContain('arrivalReadyMinutes');
    expect(code).not.toMatch(/const arrivalPlus60 = arrivalMin \+ 60;/);
  });
});

describe('프롬프트가 옛 룰을 다시 가르치지 않는다', () => {
  const prompt = () => read('api/_ai_core/buildPrompt.js');

  it("도착일 규칙에서 'arrival_time + 60min' 이 사라졌다", () => {
    const code = prompt();
    // 규칙으로 지시하는 자리에 남아 있으면 안 된다.
    // ("옛 룰 ... 은 폐기" 라고 인용하는 한 줄만 허용)
    const teachingLines = code.split(/\r?\n/)
      .filter((l) => l.includes('arrival_time + 60min') && !l.includes('폐기'));
    expect(teachingLines, teachingLines.join(' | ')).toHaveLength(0);
    expect(code).not.toContain('arrival+60');
  });

  it('대신 arrival_ready_time 을 쓰라고 지시한다', () => {
    const code = prompt();
    expect(code).toContain('arrival_ready_time');
    // 모델이 직접 산수하면 틀린다 — 계산 금지를 명시해야 한다.
    expect(code).toContain('직접 계산하지 말고');
  });

  it('stops[0] 스켈레톤이 Day 1 에 09:00 을 박으라고 하지 않는다', () => {
    const code = prompt();
    // 옛 문장: `**stops[0]** = category="lodging", stay_min=0, start_time="09:00".`
    expect(code).not.toMatch(/\*\*stops\[0\]\*\* = category="lodging", stay_min=0, start_time="09:00"/);
    expect(code).toContain('Day 1 에 "09:00" 을 박지 말 것');
  });
});
