import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { ESTIMATE_RECONCILE_TOLERANCE_PCT } from '../../src/lib/estimateConsent';

/**
 * llms.txt 가격 서술 잠금 (2026-08-01).
 *
 * 🔴 고친 문제: #1204 의 llms.txt 가 "the price shown before payment is the price
 *   charged" 를 전 상품에 단정했다. 그런데 맞춤 견적(charter_custom_estimate)은
 *   실거리·시간이 ±10% 넘게 다르면 운행 후 추가 청구/부분 환불로 정산한다
 *   (결제 화면 필수 동의 + 서버 ESTIMATE_CONSENT_* 강제). AI 비서가 이 파일을
 *   인용해 "추가 청구 없음" 을 단언하면 정산 분쟁의 근거가 된다 —
 *   7/31(#1196)에 없앤 거짓 단정의 부활이었다.
 *
 * 원칙: llms.txt 는 정적 파일이라 상수 파생이 불가능하므로, 테스트가 동기를 강제한다.
 *   허용 오차 숫자는 src/lib/estimateConsent.ts 가 정본 — 정책이 바뀌면 이 테스트가
 *   llms.txt 갱신을 요구한다.
 */

// 본문은 하드랩(줄바꿈이 문장 중간에 옴) — 공백 정규화 후 문구 단위로 검사한다.
const llms = readFileSync(join(__dirname, '../../public/llms.txt'), 'utf8').replace(/\s+/g, ' ');

describe('llms.txt 가격 서술', () => {
  it('무조건 단정문("price shown ... is the price charged"가 조건 없이)을 금지한다', () => {
    // 단정문은 fixed-price 조건절 안에서만 허용 — 옛 문장(", and the price shown")이
    // 되살아나면 잡는다.
    expect(llms).not.toMatch(/, and the price shown before payment is the price charged/);
  });

  it('확정가 상품에 한정된 서술이 있다', () => {
    expect(llms).toMatch(/fixed-price products[\s\S]{0,120}price shown before payment is the price charged/i);
  });

  it('추정가 정산 조건(±허용오차·추가청구/부분환불·결제 전 동의)을 서술한다', () => {
    expect(llms).toContain(`±${ESTIMATE_RECONCILE_TOLERANCE_PCT}%`);
    expect(llms).toMatch(/additional charge or a partial refund/i);
    expect(llms).toMatch(/agree to this on the payment screen/i);
  });
});
