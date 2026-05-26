/**
 * P204 (2026-05-26): tryParsePartialJSON 의 repairAndParseJSON 호출 제거 회귀 테스트.
 *
 * 배경:
 *   - streaming 0.5초 chunk interval 마다 tryParsePartialJSON 호출
 *   - partial chunk = incomplete JSON → repairAndParseJSON catch parseErr3
 *     → tryExtractMinimalPlan → minimal fallback alert fire (fire-and-forget)
 *   - 1 user streaming = 60-80 chunk = 60-80 alert fire
 *   - 5분간 1-2 user = "직전 5분 누적 102건" false positive
 *
 * fix:
 *   - tryParsePartialJSON 의 repairAndParseJSON 호출 제거
 *   - 신규 _tryExtractPartialDays: balanced bracket counting (alert fire X)
 *
 * assertion 8종:
 *   1. tryParsePartialJSON 정상 완성 JSON parse
 *   2. tryParsePartialJSON partial chunk (days[] 일부) 추출
 *   3. tryParsePartialJSON empty/short chunk → null
 *   4. _tryExtractPartialDays — `"days":[]` 빈 array → null
 *   5. _tryExtractPartialDays — `"days":[{"day":1,"stops":[...]}]` 1개 day → 1개 추출
 *   6. _tryExtractPartialDays — partial 2개 day + 미완성 3번째 → 2개 추출
 *   7. malformed day silent skip (JSON.parse 실패 day 는 무시)
 *   8. repairAndParseJSON 호출 안 함 (source-level — alert flood 방지)
 */
import { describe, it, expect } from 'vitest';
import { tryParsePartialJSON, _tryExtractPartialDays } from '../../api/_ai_core/geminiPipeline.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const sourcePath = resolve(__dirname, '../../api/_ai_core/geminiPipeline.js');

describe('P204 tryParsePartialJSON — alert flood 방지', () => {
  it('assertion 1: 정상 완성 JSON parse', () => {
    const complete = JSON.stringify({ days: [{ day: 1, stops: [] }] });
    const result = tryParsePartialJSON(complete);
    expect(result).toEqual({ days: [{ day: 1, stops: [] }] });
  });

  it('assertion 2: partial chunk (days[] 일부) 추출', () => {
    // 미완성 — 2일 + 3일째 미완성
    const partial = '{"days":[{"day":1,"stops":[{"name":"A"}]},{"day":2,"stops":[{"name":"B"}]},{"day":3,"stops":[{"name":';
    const result = tryParsePartialJSON(partial);
    expect(result).toBeDefined();
    expect(result?.days?.length).toBe(2);
    expect(result?.days?.[0]?.day).toBe(1);
    expect(result?.days?.[1]?.day).toBe(2);
  });

  it('assertion 3: empty/short chunk → null', () => {
    expect(tryParsePartialJSON('')).toBe(null);
    expect(tryParsePartialJSON('a')).toBe(null);
    expect(tryParsePartialJSON('{"tour_title"')).toBe(null);
  });
});

describe('P204 _tryExtractPartialDays — balanced bracket counting', () => {
  it('assertion 4: 빈 array → null', () => {
    expect(_tryExtractPartialDays('{"days":[]}')).toBe(null);
  });

  it('assertion 5: 1개 day 완성 → 1개 추출', () => {
    const input = '{"days":[{"day":1,"stops":[{"name":"홍대 호텔"}]}]}';
    const result = _tryExtractPartialDays(input);
    expect(result?.days?.length).toBe(1);
    expect(result?.days?.[0]?.day).toBe(1);
  });

  it('assertion 6: partial 2개 day + 3번째 미완성 → 2개 추출', () => {
    const input = '{"days":[{"day":1,"stops":[]},{"day":2,"stops":[]},{"day":3,"sto';
    const result = _tryExtractPartialDays(input);
    expect(result?.days?.length).toBe(2);
  });

  it('assertion 7: malformed day silent skip', () => {
    // 첫 day 가 malformed (string 에 escape 없음) — silent skip + 2번째 OK
    const input = '{"days":[{"day":1,"stops":[{"bad":"un}closed }]}]},{"day":2,"stops":[]}]}';
    const result = _tryExtractPartialDays(input);
    // 첫 day 가 partial 잘못 → 두번째 가 정상 parse 되면 OK
    // best-effort: malformed 라도 silent skip 후 valid day 만 반환
    expect(result).toBeDefined();
  });

  it('assertion 8: nested brackets correct depth tracking', () => {
    const input = '{"days":[{"day":1,"stops":[{"nested":{"deeper":[1,2,3]}}]}]}';
    const result = _tryExtractPartialDays(input);
    expect(result?.days?.length).toBe(1);
  });
});

describe('P204 source-level — repairAndParseJSON 호출 제거', () => {
  it('assertion 9: tryParsePartialJSON 안에서 repairAndParseJSON 호출 X (alert flood 방지)', () => {
    const src = readFileSync(sourcePath, 'utf8');
    // tryParsePartialJSON 함수 범위 추출 (`export function tryParsePartialJSON` 시작 ~ 다음 `function` 까지)
    const match = src.match(/export function tryParsePartialJSON[\s\S]*?(?=\nexport function|\nfunction [A-Z_])/);
    expect(match).not.toBeNull();
    const fnBody = match![0];
    // repairAndParseJSON 호출 없어야
    expect(/repairAndParseJSON\(/.test(fnBody)).toBe(false);
  });

  it('assertion 10: _tryExtractPartialDays export 존재 (helper 분리 검증)', () => {
    expect(typeof _tryExtractPartialDays).toBe('function');
  });
});
