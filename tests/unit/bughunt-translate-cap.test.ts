/**
 * Bug #20 — translate-plan: 입력 크기 상한 회귀 테스트
 *
 * 수정 전: POST /api/translate-plan 는 body.plan 크기 검증 전무.
 *   임의 호출자가 days/stops 수천 개 plan 으로 최대 토큰 Gemini 호출 가능
 *   (per-IP 횟수 캡은 있지만 1회 호출당 비용 증폭은 막지 못함).
 *
 * 수정 후 (L57~L92): Gemini 호출 전 세 가지 상한 검사:
 *   MAX_PLAN_JSON_BYTES  = 500_000  (JSON 직렬화 바이트)
 *   MAX_PLAN_DAYS        = 30
 *   MAX_PLAN_STOPS       = 400      (days 전체 stops 합산)
 *   MAX_TRANSLATE_TEXTS  = 2000     (descTexts + transitTexts 합산, Gemini 호출 직전)
 *
 * 이 테스트는 소스 파일을 직접 파싱해 상수·조건을 검증하므로 Gemini/Firebase
 * 모킹이 불필요하고 vitest 단독 실행 가능.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const src = readFileSync(
  resolve(process.cwd(), 'api/translate-plan.js'),
  'utf8',
);

// ── 헬퍼: 소스에서 상수값 파싱 ──────────────────────────────────────────────
function extractConst(name: string): number {
  // e.g. "const MAX_PLAN_DAYS = 30;"  or  "const MAX_PLAN_JSON_BYTES = 500_000;"
  const m = src.match(new RegExp(`const\\s+${name}\\s*=\\s*([\\d_]+)`));
  if (!m) throw new Error(`[translate-cap] constant '${name}' not found in source`);
  return Number(m[1].replace(/_/g, ''));
}

// ── 정상 plan 팩토리 ─────────────────────────────────────────────────────────
function makeStop(overrides: Record<string, unknown> = {}) {
  return {
    name: '경복궁',
    display_name: 'Gyeongbokgung Palace',
    tip: 'Arrive early',
    entry_fee_note: 'KRW 3000',
    recommended_items: [
      { name: 'Hanbokgu', note: 'rent hanbok here' },
    ],
    ...overrides,
  };
}

function makeDay(stopCount: number) {
  return { theme: 'Culture Day', stops: Array.from({ length: stopCount }, () => makeStop()) };
}

/** 정상 6일 plan — days=7, stops≤56 */
function normalPlan() {
  return {
    tour_title: 'Seoul 6-Day Tour',
    days: Array.from({ length: 7 }, () => makeDay(5)),   // 7×5 = 35 stops
    departure_guide: {
      recommended_departure_time: '09:00',
      last_minute_shopping: 'Duty free',
    },
  };
}

// ── 1. 상수가 소스에 선언되어 있는지 ─────────────────────────────────────────
describe('Bug #20 — translate-plan 크기 상한 상수 선언 확인', () => {
  it('MAX_PLAN_JSON_BYTES 가 선언되고 500000 이상', () => {
    const v = extractConst('MAX_PLAN_JSON_BYTES');
    expect(v).toBeGreaterThanOrEqual(500_000);
  });

  it('MAX_PLAN_DAYS 가 선언되고 7 초과(여유 있는 상한)', () => {
    const v = extractConst('MAX_PLAN_DAYS');
    expect(v).toBeGreaterThan(7);  // 정상 최대 7일이 통과해야 함
    expect(v).toBeLessThanOrEqual(100); // 무한대는 아님
  });

  it('MAX_PLAN_STOPS 가 선언되고 56 초과(여유 있는 상한)', () => {
    const v = extractConst('MAX_PLAN_STOPS');
    expect(v).toBeGreaterThan(56); // 정상 ~56 stops 이 통과해야 함
    expect(v).toBeLessThanOrEqual(2000); // 합리적 상한
  });

  it('MAX_TRANSLATE_TEXTS 가 선언되고 340 초과(여유 있는 상한)', () => {
    const v = extractConst('MAX_TRANSLATE_TEXTS');
    expect(v).toBeGreaterThan(340); // 정상 ~340 texts 가 통과해야 함
    expect(v).toBeLessThanOrEqual(10_000);
  });
});

// ── 2. 정상 6일 plan 이 모든 상한을 통과하는지 ────────────────────────────────
describe('Bug #20 — 정상 6일 plan 상한 통과 검증', () => {
  const plan = normalPlan();

  it('JSON 바이트가 MAX_PLAN_JSON_BYTES 미만', () => {
    const bytes = Buffer.byteLength(JSON.stringify(plan), 'utf8');
    const cap = extractConst('MAX_PLAN_JSON_BYTES');
    expect(bytes).toBeLessThan(cap);
  });

  it('days.length 가 MAX_PLAN_DAYS 이하', () => {
    const cap = extractConst('MAX_PLAN_DAYS');
    expect(plan.days.length).toBeLessThanOrEqual(cap);
  });

  it('총 stops 수가 MAX_PLAN_STOPS 이하', () => {
    const totalStops = plan.days.reduce((s, d) => s + d.stops.length, 0);
    const cap = extractConst('MAX_PLAN_STOPS');
    expect(totalStops).toBeLessThanOrEqual(cap);
  });

  it('예상 descTexts 수가 MAX_TRANSLATE_TEXTS 미만', () => {
    // 각 stop: display_name + tip + entry_fee_note = 3
    // 각 item: name + note = 2
    // day.theme = 1
    // tour_title = 1 + departure 2 = 3 root texts
    const perStop = 3 + 1 * 2;  // stop 3필드 + item 2필드×1개
    const perDay = 1 + 5 * perStop; // theme + 5 stops
    const descEstimate = 3 + 7 * perDay; // root + 7일
    const cap = extractConst('MAX_TRANSLATE_TEXTS');
    expect(descEstimate).toBeLessThan(cap);
  });
});

// ── 3. 악의적 초대형 plan 이 상한에 걸리는지 소스 조건 확인 ───────────────────
describe('Bug #20 — 소스에 크기 검사 분기문 존재 확인', () => {
  it('planJsonBytes > MAX_PLAN_JSON_BYTES 조건이 소스에 존재', () => {
    expect(src).toMatch(/planJsonBytes\s*>\s*MAX_PLAN_JSON_BYTES/);
  });

  it('plan.days.length > MAX_PLAN_DAYS 조건이 소스에 존재', () => {
    expect(src).toMatch(/plan\.days\.length\s*>\s*MAX_PLAN_DAYS/);
  });

  it('totalStops > MAX_PLAN_STOPS 조건이 소스에 존재', () => {
    expect(src).toMatch(/totalStops\s*>\s*MAX_PLAN_STOPS/);
  });

  it('totalTexts > MAX_TRANSLATE_TEXTS 조건이 소스에 존재', () => {
    expect(src).toMatch(/totalTexts\s*>\s*MAX_TRANSLATE_TEXTS/);
  });

  it('초과 시 400 반환 코드가 소스에 존재', () => {
    // 400 + PLAN_TOO_LARGE 코드
    expect(src).toMatch(/res\.status\(400\)/);
    expect(src).toMatch(/PLAN_TOO_LARGE/);
  });
});

// ── 4. MAX_TRANSLATE_TEXTS 체크가 Gemini 호출(generateContent) 전에 위치하는지 ──
describe('Bug #20 — MAX_TRANSLATE_TEXTS 체크 순서 검증', () => {
  it('totalTexts 체크가 generateContent 호출보다 앞에 선언됨', () => {
    const textsCheckPos = src.indexOf('totalTexts > MAX_TRANSLATE_TEXTS');
    const geminiCallPos  = src.indexOf('generateContent');
    expect(textsCheckPos).toBeGreaterThan(-1); // 체크 존재
    expect(geminiCallPos).toBeGreaterThan(-1);  // Gemini 호출 존재
    expect(textsCheckPos).toBeLessThan(geminiCallPos); // 체크가 먼저
  });
});

// ── 5. 악의적 plan 크기 값이 실제 상한 초과인지 수치 검증 ─────────────────────
describe('Bug #20 — 초과 케이스 수치 검증 (상수 기반)', () => {
  it('days=31 이 MAX_PLAN_DAYS(30)를 초과', () => {
    const cap = extractConst('MAX_PLAN_DAYS');
    expect(31).toBeGreaterThan(cap);
  });

  it('stops=401 이 MAX_PLAN_STOPS(400)를 초과', () => {
    const cap = extractConst('MAX_PLAN_STOPS');
    expect(401).toBeGreaterThan(cap);
  });

  it('texts=2001 이 MAX_TRANSLATE_TEXTS(2000)를 초과', () => {
    const cap = extractConst('MAX_TRANSLATE_TEXTS');
    expect(2001).toBeGreaterThan(cap);
  });

  it('500001 바이트 payload 가 MAX_PLAN_JSON_BYTES(500000)를 초과', () => {
    const cap = extractConst('MAX_PLAN_JSON_BYTES');
    expect(500_001).toBeGreaterThan(cap);
  });
});

// ── 6. nullish 연산자 사용 금지 (프로젝트 규칙) ──────────────────────────────
describe('Bug #20 — 수정 코드 nullish 사용 금지 확인', () => {
  it('신규 추가된 크기 검사 블록에 nullish 가 없음', () => {
    // MAX_PLAN_DAYS 상수 선언~totalTexts 체크 사이의 신규 코드 구간
    const startMark = 'MAX_PLAN_DAYS        = 30';
    const endMark   = 'MAX_TRANSLATE_TEXTS 체크 없음 — Gemini 직전';
    const startIdx = src.indexOf(startMark);
    const endIdx   = src.indexOf('Single Gemini call with two arrays'); // 기존 주석
    expect(startIdx).toBeGreaterThan(-1);
    expect(endIdx).toBeGreaterThan(startIdx);
    const newCodeBlock = src.slice(startIdx, endIdx);
    // nullish-coalescing — pre-commit MOJIBAKE 시그니처라 금지
    expect(newCodeBlock).not.toMatch(/\?\?/);
  });
});
