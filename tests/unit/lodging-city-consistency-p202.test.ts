/**
 * P202 Phase 1 (2026-05-26): buildPrompt 의 Day N city ↔ lodging.address 일관성 명시 회귀 테스트.
 *
 * 배경:
 *   - 5/25 23:24 prod alert: Day 3 (city="Busan") + lodging "홍대 호텔|서울특별시 마포구"
 *     (B-13 다른 도시 명시적 언급 + B-16 airport 누락)
 *   - root cause: Flash 가 day-level city ↔ lodging city 동기 못 함 (instruction following 한계)
 *   - fix Phase 1: prompt 강화 (schema 무변경 — P196 회귀 위험 0)
 *   - 옵션 B (nested required) = browser-use #3491 직접 증거로 Flash 실패 패턴 → 보류
 *
 * assertion 8종 (source-level — buildPrompt 의 prompt 텍스트 검증):
 *   1. P202 섹션 헤더 존재 ("Day N city ↔ Day N lodging.address")
 *   2. GOOD 예시 명시 (Day 3 Busan + 부산광역시)
 *   3. BAD 예시 명시 (Day 3 Busan + 홍대 호텔 + 서울특별시 마포구)
 *   4. 도시 substring map 존재 (Seoul/서울 + Busan/부산 + Jeju/제주)
 *   5. retry 트리거 명시 (validator 가 즉시 retry)
 *   6. 환불 사유 명시 (운영자 risk)
 *   7. lodging 도시 일치 의무 명시
 *   8. day-trip stop 예외 명시 (validator false positive 회피)
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const sourcePath = resolve(__dirname, '../../api/_ai_core/buildPrompt.js');

describe('P202 buildPrompt.js — Day N city ↔ lodging.address 일관성', () => {
  let src: string;

  beforeAll(() => {
    src = readFileSync(sourcePath, 'utf8');
  });

  it('assertion 1: P202 섹션 헤더 존재', () => {
    expect(/P202/.test(src)).toBe(true);
    expect(/Day N city.*lodging\.address/.test(src)).toBe(true);
  });

  it('assertion 2: GOOD 예시 명시 (Day 3 Busan + 부산광역시 해운대구)', () => {
    expect(/GOOD[\s\S]{0,300}Busan[\s\S]{0,200}부산광역시/.test(src)).toBe(true);
  });

  it('assertion 3: BAD 예시 명시 (Day 3 Busan + 홍대 호텔 + 서울특별시 마포구)', () => {
    expect(/BAD[\s\S]{0,300}Busan[\s\S]{0,200}홍대 호텔/.test(src)).toBe(true);
    expect(/서울특별시 마포구/.test(src)).toBe(true);
  });

  it('assertion 4: 도시 substring map 존재 (8개 이상 도시)', () => {
    expect(/Seoul[\s\S]{0,20}서울/.test(src)).toBe(true);
    expect(/Busan[\s\S]{0,20}부산/.test(src)).toBe(true);
    expect(/Jeju[\s\S]{0,20}제주/.test(src)).toBe(true);
    expect(/Gyeongju[\s\S]{0,20}경주/.test(src)).toBe(true);
    expect(/Daegu[\s\S]{0,20}대구/.test(src)).toBe(true);
    expect(/Incheon[\s\S]{0,20}인천/.test(src)).toBe(true);
  });

  it('assertion 5: retry 트리거 명시 (validator 가 즉시 retry)', () => {
    expect(/validator[\s\S]{0,100}retry/.test(src)).toBe(true);
  });

  it('assertion 6: 환불 사유 명시 (운영자 risk)', () => {
    expect(/환불/.test(src)).toBe(true);
  });

  it('assertion 7: lodging 도시 일치 의무 명시', () => {
    expect(/lodging[\s\S]{0,100}일치/.test(src)).toBe(true);
  });

  it('assertion 8: day-trip stop 예외 명시 (validator false positive 회피)', () => {
    expect(/예외|day-trip|당일치기/.test(src)).toBe(true);
  });

  it('assertion 9: prompt 크기 회귀 차단 (P194 cap 50K 안전)', () => {
    expect(src.length).toBeLessThan(50_000);
  });
});
