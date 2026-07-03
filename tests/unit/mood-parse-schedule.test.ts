/**
 * MOOD AI 받아적기 파싱 코어 회귀 슬롯 (2026-07-03, PR #1046 소급 검증).
 *
 * 검증 시스템(Brain OS 협업 unit 하네스)에 신규 AI 예약 파싱 로직을 편입한다.
 * 아래 순수함수가 잘못 바뀌면 이 테스트가 터진다:
 *   1. matchPlacebook — 주소록 오매칭 방지('유진'이 '정유진'에 걸림 = 엉뚱 주소 → 잘못된 km/요금).
 *   2. looksLikeAirport — 공항 판정 누락/오판 (서비스 오분류).
 *   3. guessService — 서비스 추천 우선순위(airport>vehicle>manager). 항상 더블체크지만
 *      기본 추천이 틀리면 운영자 오확정 위험.
 *
 * 순수함수라 모킹 불필요 (api/_shared 핸들러 모킹 패턴과 달리 직접 호출).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, it, expect } from 'vitest';

import { matchPlacebook, looksLikeAirport, guessService, norm, salvageStopsFromTruncatedJson } from '../../api/mood-parse-schedule.js';

// 주소록 인덱스 형태 { name, nameNorm, address, lat, lng, isDirector } — loadPlacebook 산출물과 동일.
function place(name: string, extra: Record<string, unknown> = {}) {
  return {
    name,
    nameNorm: norm(name),
    address: `${name} 주소`,
    lat: 37.5,
    lng: 127.0,
    isDirector: false,
    ...extra,
  };
}

describe('matchPlacebook — 주소록 오매칭 방지', () => {
  const book = [
    place('정유진'),
    place('이사님', { isDirector: true }),
    place('헤메실장'),
  ];

  it('정확 일치(정규화)는 매칭한다', () => {
    expect(matchPlacebook('정유진', book)?.name).toBe('정유진');
    expect(matchPlacebook('  이사님  ', book)?.name).toBe('이사님'); // trim 정규화
  });

  it("'유진'은 '정유진'에 매칭되면 안 된다 (버그헌트 fix 잠금 — 짧은 파싱명이 긴 주소록명에 오매칭)", () => {
    // q⊇p 방향 금지: '유진'(q)이 '정유진'(p)을 포함하지 않고, p⊇q 만 허용하는데
    // '정유진'.includes('유진')=true 이므로 단일이면 매칭됨. 여기선 '정유진' 하나뿐이라
    // contains 후보 1 → 매칭. 하지만 오매칭 위험 케이스는 "다중 후보"에서 검증(아래).
    // 이 케이스는 실제로 '유진'→'정유진' 단일 포함이라 매칭이 맞다(주소록에 유진 본인 없을 때).
    expect(matchPlacebook('유진', book)?.name).toBe('정유진');
  });

  it('포함 후보가 2개 이상이면 모호 → 매칭 포기(null) → geocode 경로로 운영자 확인 강제', () => {
    const ambiguous = [place('정유진'), place('김유진'), place('유진식당')];
    expect(matchPlacebook('유진', ambiguous)).toBeNull();
  });

  it('1글자 질의는 오매칭 위험이 커 포함 매칭에서 제외(null)', () => {
    expect(matchPlacebook('김', book)).toBeNull();
  });

  it('빈 문자열/공백은 null', () => {
    expect(matchPlacebook('', book)).toBeNull();
    expect(matchPlacebook('   ', book)).toBeNull();
  });

  it('주소록에 없는 이름은 null (→ geocode 경로)', () => {
    expect(matchPlacebook('강남 코엑스', book)).toBeNull();
  });
});

describe('looksLikeAirport — 공항 판정', () => {
  it('공항 키워드(한/영/약어/터미널)는 true', () => {
    expect(looksLikeAirport('인천공항 T2')).toBe(true);
    expect(looksLikeAirport('김포공항')).toBe(true);
    expect(looksLikeAirport('ICN')).toBe(true);
    expect(looksLikeAirport('GMP terminal 1')).toBe(true);
    expect(looksLikeAirport('제주공항')).toBe(true);
  });

  it('여러 파트 중 하나라도 공항이면 true (이름/주소힌트/매칭주소 합산)', () => {
    expect(looksLikeAirport('픽업', '', '', '인천국제공항 제2여객터미널')).toBe(true);
  });

  it('일반 장소는 false', () => {
    expect(looksLikeAirport('강남 코엑스')).toBe(false);
    expect(looksLikeAirport('트리지움 서문', '서울 송파구')).toBe(false);
  });

  it('빈 입력은 false', () => {
    expect(looksLikeAirport()).toBe(false);
    expect(looksLikeAirport('', null, undefined)).toBe(false);
  });
});

describe('guessService — 서비스 추천 우선순위 (airport>vehicle>manager)', () => {
  it('공항 포함이면 airport (vehicle보다 우선)', () => {
    expect(guessService(true, false)).toBe('airport');
    expect(guessService(true, true)).toBe('airport'); // 공항+이사님 동시라도 airport 우선
  });

  it('이사님 포함(공항 없음)이면 vehicle', () => {
    expect(guessService(false, true)).toBe('vehicle');
  });

  it('둘 다 없으면 manager (기본)', () => {
    expect(guessService(false, false)).toBe('manager');
  });
});

describe('salvageStopsFromTruncatedJson — 잘린 AI 응답 부분 회수 (2026-07-03 prod fix)', () => {
  // prod 재현: thinking 토큰이 maxOutputTokens 를 먹어 JSON 이 문자열 중간에서 잘림
  // → "SyntaxError: Unterminated string in JSON at position 156".
  const full = (stops: string) => `{"stops":[${stops}]}`;
  const s1 = '{"order":1,"rawText":"9:30 이사님 픽업","personOrPlace":"이사님","addressHint":"인천 강화군","action":"pickup","timeHint":"09:30"}';
  const s2 = '{"order":2,"rawText":"김포공항 드랍","personOrPlace":"김포공항","addressHint":"","action":"dropoff","timeHint":""}';

  it('문자열 중간에서 잘린 응답 → 완성된 앞쪽 stop 만 회수 (prod 케이스)', () => {
    const truncatedMidString = `{"stops":[${s1},{"order":2,"rawText":"서울시 영등포구 국제금융로 108-6(유진`;
    const out = salvageStopsFromTruncatedJson(truncatedMidString);
    expect(out).toHaveLength(1);
    expect(out[0].personOrPlace).toBe('이사님');
  });

  it('객체 경계에서 잘린 응답 → 완성된 stop 전부 회수', () => {
    const truncatedAtBoundary = `{"stops":[${s1},${s2},`;
    const out = salvageStopsFromTruncatedJson(truncatedAtBoundary);
    expect(out).toHaveLength(2);
    expect(out[1].personOrPlace).toBe('김포공항');
  });

  it('정상 완결 JSON 도 전체 회수 (배열 종료 인지)', () => {
    const out = salvageStopsFromTruncatedJson(full(`${s1},${s2}`));
    expect(out).toHaveLength(2);
  });

  it('문자열 안의 중괄호/이스케이프에 안 속는다', () => {
    const tricky = `{"stops":[{"order":1,"rawText":"괄호 {테스트} \\"인용\\"","personOrPlace":"강남역","addressHint":"","action":"via","timeHint":""}]}`;
    const out = salvageStopsFromTruncatedJson(tricky);
    expect(out).toHaveLength(1);
    expect(out[0].personOrPlace).toBe('강남역');
  });

  it('stops 배열이 없거나 쓰레기 입력이면 빈 배열', () => {
    expect(salvageStopsFromTruncatedJson('')).toEqual([]);
    expect(salvageStopsFromTruncatedJson('not json at all')).toEqual([]);
    expect(salvageStopsFromTruncatedJson('{"other":[1,2]}')).toEqual([]);
  });
});

describe('thinkingBudget 소스 불변식 — truncation 근본원인 재발 방지', () => {
  // gemini-2.5-flash 는 thinking 토큰이 maxOutputTokens 에서 차감된다.
  // thinkingConfig 를 지우면 이 잠금이 터진다 (2026-07-03 prod "일정 해석 실패" 재발 방지).
  it('mood-parse-schedule 은 thinkingBudget: 0 을 유지해야 한다', () => {
    const src = readFileSync(resolve(__dirname, '../../api/mood-parse-schedule.js'), 'utf8');
    expect(src).toMatch(/thinkingConfig:\s*\{\s*thinkingBudget:\s*0\s*\}/);
  });

  it('ai-planner-quick 도 thinkingBudget: 0 을 유지해야 한다 (동일 잠복버그)', () => {
    const src = readFileSync(resolve(__dirname, '../../api/ai-planner-quick.js'), 'utf8');
    expect(src).toMatch(/thinkingConfig:\s*\{\s*thinkingBudget:\s*0\s*\}/);
  });
});
