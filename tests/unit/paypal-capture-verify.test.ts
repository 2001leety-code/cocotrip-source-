/**
 * paypal-capture-verify — PayPal capture 무결성 검증기 (money-critical, 순수 함수).
 *
 * 왜: "PayPal 이 order amount 를 강제한다" 는 PayPal 내부 일관성에만 참이고,
 *   merchant invariant(우리 견적에서 난 order 인가 / currency 가 예상과 같은가 /
 *   개별 capture 가 실제로 COMPLETED 인가)는 보장하지 않는다.
 *   기존: 단건 = amount 무검증, cart = 금액만 float 비교(currency 미검증).
 *   여기서 amount(정수 minor) + currency + capture status + cardinality 를 한곳에서 검증.
 *
 * 금액은 절대 부동소수점으로 비교하지 않는다 — 문자열 → minor unit 정수.
 */
import { describe, it, expect } from 'vitest';
// @ts-expect-error — ESM .js (backend SSOT)
import { toMinorUnits, verifyCaptureIntegrity } from '../../api/_shared/paypal-capture-verify.js';

/** 정상 capture 응답 골격 */
function makeCapture(over: Record<string, unknown> = {}) {
  const {
    orderStatus = 'COMPLETED',
    captureStatus = 'COMPLETED',
    value = '99.00',
    currency = 'USD',
    id = 'CAP-1',
    purchaseUnits,
    captures,
  } = over as Record<string, any>;
  const node = { id, status: captureStatus, amount: { value, currency_code: currency } };
  return {
    status: orderStatus,
    purchase_units: purchaseUnits ?? [{ payments: { captures: captures ?? [node] } }],
  };
}

describe('toMinorUnits — 문자열 금액 → 최소단위 정수 (부동소수점 금지)', () => {
  it('USD 2자리 → cents', () => {
    expect(toMinorUnits('99.00', 'USD')).toBe(9900);
    expect(toMinorUnits('9.90', 'USD')).toBe(990);
    expect(toMinorUnits('0.01', 'USD')).toBe(1);
  });

  it('부동소수점 오차가 나는 값도 정확 (99.29 * 100 = 9928.999... 함정)', () => {
    expect(toMinorUnits('99.29', 'USD')).toBe(9929);
    expect(toMinorUnits('1.10', 'USD')).toBe(110);
    expect(toMinorUnits('0.29', 'USD')).toBe(29);
  });

  it('소수점 생략/1자리 허용 → 정규화', () => {
    expect(toMinorUnits('99', 'USD')).toBe(9900);
    expect(toMinorUnits('99.5', 'USD')).toBe(9950);
  });

  it('zero-decimal 통화(KRW/JPY)는 정수만', () => {
    expect(toMinorUnits('14000', 'KRW')).toBe(14000);
    expect(toMinorUnits('14000.00', 'KRW')).toBe(null); // 소수 불가
  });

  it('잘못된 형식·빈값·음수·0·초과정밀도 = null (검증 실패)', () => {
    expect(toMinorUnits('', 'USD')).toBe(null);
    expect(toMinorUnits(null, 'USD')).toBe(null);
    expect(toMinorUnits(undefined, 'USD')).toBe(null);
    expect(toMinorUnits('abc', 'USD')).toBe(null);
    expect(toMinorUnits('-99.00', 'USD')).toBe(null);   // 음수
    expect(toMinorUnits('0.00', 'USD')).toBe(null);     // 0
    expect(toMinorUnits('99.001', 'USD')).toBe(null);   // 초과 정밀도
    expect(toMinorUnits('1e3', 'USD')).toBe(null);      // 지수 표기
    expect(toMinorUnits('99.00 ', 'USD')).toBe(9900);   // 양끝 공백은 trim 허용
    expect(toMinorUnits('9 9', 'USD')).toBe(null);
  });

  it('미지원 통화 = null (조용한 통과 금지)', () => {
    expect(toMinorUnits('99.00', 'XYZ')).toBe(null);
  });
});

describe('verifyCaptureIntegrity — 정상 경로', () => {
  it('금액·통화·status 일치 = ok', () => {
    const r = verifyCaptureIntegrity({
      capture: makeCapture(), expectedAmountMinor: 9900, expectedCurrency: 'USD',
    });
    expect(r.ok).toBe(true);
    expect(r.captureID).toBe('CAP-1');
    expect(r.amountMinor).toBe(9900);
    expect(r.currency).toBe('USD');
  });

  it('통화 대소문자 무관', () => {
    const r = verifyCaptureIntegrity({
      capture: makeCapture({ currency: 'usd' }), expectedAmountMinor: 9900, expectedCurrency: 'USD',
    });
    expect(r.ok).toBe(true);
  });
});

describe('verifyCaptureIntegrity — 금액 불일치', () => {
  it('1 cent 부족 = AMOUNT_MISMATCH', () => {
    const r = verifyCaptureIntegrity({
      capture: makeCapture({ value: '98.99' }), expectedAmountMinor: 9900, expectedCurrency: 'USD',
    });
    expect(r.ok).toBe(false);
    expect(r.code).toBe('AMOUNT_MISMATCH');
    expect(r.amountMinor).toBe(9899);
    expect(r.expectedAmountMinor).toBe(9900);
  });

  it('1 cent 초과 = AMOUNT_MISMATCH (overpayment 도 자동확정 금지)', () => {
    const r = verifyCaptureIntegrity({
      capture: makeCapture({ value: '99.01' }), expectedAmountMinor: 9900, expectedCurrency: 'USD',
    });
    expect(r.ok).toBe(false);
    expect(r.code).toBe('AMOUNT_MISMATCH');
  });

  it('크게 부족 = AMOUNT_MISMATCH', () => {
    const r = verifyCaptureIntegrity({
      capture: makeCapture({ value: '1.00' }), expectedAmountMinor: 9900, expectedCurrency: 'USD',
    });
    expect(r.ok).toBe(false);
    expect(r.code).toBe('AMOUNT_MISMATCH');
  });
});

describe('verifyCaptureIntegrity — 통화', () => {
  it('실제 통화가 USD 아님 = CURRENCY_MISMATCH', () => {
    const r = verifyCaptureIntegrity({
      capture: makeCapture({ currency: 'KRW', value: '99' }), expectedAmountMinor: 9900, expectedCurrency: 'USD',
    });
    expect(r.ok).toBe(false);
    expect(r.code).toBe('CURRENCY_MISMATCH');
  });

  it('통화 필드 없음 = NO_CURRENCY', () => {
    const cap = makeCapture();
    delete (cap.purchase_units[0].payments.captures[0] as any).amount.currency_code;
    const r = verifyCaptureIntegrity({ capture: cap, expectedAmountMinor: 9900, expectedCurrency: 'USD' });
    expect(r.ok).toBe(false);
    expect(r.code).toBe('NO_CURRENCY');
  });
});

describe('verifyCaptureIntegrity — status', () => {
  it('order status 가 COMPLETED 아님 = ORDER_NOT_COMPLETED', () => {
    const r = verifyCaptureIntegrity({
      capture: makeCapture({ orderStatus: 'PENDING' }), expectedAmountMinor: 9900, expectedCurrency: 'USD',
    });
    expect(r.ok).toBe(false);
    expect(r.code).toBe('ORDER_NOT_COMPLETED');
  });

  // 🔴 PENDING = PayPal 리스크 홀드/eCheck = **정상 결제 흐름**이지 변조가 아니다.
  //   이걸 격리하면 booking doc 이 안 생기고, 홀드 해제 webhook 이 예약을 못 찾아
  //   "돈은 정산되고 예약은 영영 없음" 이 된다 → 격리와 구분되는 pending 신호로 반환.
  it('order COMPLETED + 개별 capture PENDING = CAPTURE_PENDING (격리 아님, 금액은 검증 통과)', () => {
    const r = verifyCaptureIntegrity({
      capture: makeCapture({ captureStatus: 'PENDING' }), expectedAmountMinor: 9900, expectedCurrency: 'USD',
    });
    expect(r.ok).toBe(false);
    expect(r.pending).toBe(true);
    expect(r.code).toBe('CAPTURE_PENDING');
    expect(r.amountMinor).toBe(9900);
    expect(r.currency).toBe('USD');
  });

  it('PENDING 이어도 금액이 틀리면 AMOUNT_MISMATCH 가 우선 (돈 무결성을 정산상태보다 먼저 본다)', () => {
    const r = verifyCaptureIntegrity({
      capture: makeCapture({ captureStatus: 'PENDING', value: '1.00' }), expectedAmountMinor: 9900, expectedCurrency: 'USD',
    });
    expect(r.code).toBe('AMOUNT_MISMATCH');
    expect(r.pending).toBeUndefined();
  });

  it('PENDING 이어도 통화가 틀리면 CURRENCY_MISMATCH 가 우선', () => {
    const r = verifyCaptureIntegrity({
      capture: makeCapture({ captureStatus: 'PENDING', currency: 'KRW', value: '99' }), expectedAmountMinor: 9900, expectedCurrency: 'USD',
    });
    expect(r.code).toBe('CURRENCY_MISMATCH');
    expect(r.pending).toBeUndefined();
  });

  it('개별 capture 가 DECLINED = CAPTURE_NOT_COMPLETED', () => {
    const r = verifyCaptureIntegrity({
      capture: makeCapture({ captureStatus: 'DECLINED' }), expectedAmountMinor: 9900, expectedCurrency: 'USD',
    });
    expect(r.ok).toBe(false);
    expect(r.code).toBe('CAPTURE_NOT_COMPLETED');
  });
});

describe('verifyCaptureIntegrity — 구조/cardinality', () => {
  it('capture 응답 없음 = NO_CAPTURE_RESPONSE', () => {
    expect(verifyCaptureIntegrity({ capture: null, expectedAmountMinor: 9900 }).code).toBe('NO_CAPTURE_RESPONSE');
  });

  it('capture node 없음 = NO_CAPTURE_NODE', () => {
    const r = verifyCaptureIntegrity({
      capture: makeCapture({ captures: [] }), expectedAmountMinor: 9900, expectedCurrency: 'USD',
    });
    expect(r.ok).toBe(false);
    expect(r.code).toBe('NO_CAPTURE_NODE');
  });

  it('capture id 없음 = NO_CAPTURE_ID', () => {
    const r = verifyCaptureIntegrity({
      capture: makeCapture({ id: '' }), expectedAmountMinor: 9900, expectedCurrency: 'USD',
    });
    expect(r.ok).toBe(false);
    expect(r.code).toBe('NO_CAPTURE_ID');
  });

  it('purchase unit 2개 = PU_CARDINALITY (조용히 [0] 만 쓰지 않음)', () => {
    const node = { id: 'CAP-1', status: 'COMPLETED', amount: { value: '99.00', currency_code: 'USD' } };
    const r = verifyCaptureIntegrity({
      capture: makeCapture({ purchaseUnits: [{ payments: { captures: [node] } }, { payments: { captures: [node] } }] }),
      expectedAmountMinor: 9900, expectedCurrency: 'USD',
    });
    expect(r.ok).toBe(false);
    expect(r.code).toBe('PU_CARDINALITY');
  });

  it('capture 2개 = CAPTURE_CARDINALITY', () => {
    const node = { id: 'CAP-1', status: 'COMPLETED', amount: { value: '99.00', currency_code: 'USD' } };
    const r = verifyCaptureIntegrity({
      capture: makeCapture({ captures: [node, { ...node, id: 'CAP-2' }] }),
      expectedAmountMinor: 9900, expectedCurrency: 'USD',
    });
    expect(r.ok).toBe(false);
    expect(r.code).toBe('CAPTURE_CARDINALITY');
  });

  it('amount 형식 불량 = BAD_AMOUNT_FORMAT', () => {
    const r = verifyCaptureIntegrity({
      capture: makeCapture({ value: 'abc' }), expectedAmountMinor: 9900, expectedCurrency: 'USD',
    });
    expect(r.ok).toBe(false);
    expect(r.code).toBe('BAD_AMOUNT_FORMAT');
  });
});

describe('verifyCaptureIntegrity — expected 없음 (provenance 불명)', () => {
  it('expected 미지정 = NO_EXPECTED (조용한 통과 금지)', () => {
    expect(verifyCaptureIntegrity({ capture: makeCapture() }).code).toBe('NO_EXPECTED');
    expect(verifyCaptureIntegrity({ capture: makeCapture(), expectedAmountMinor: 0 }).code).toBe('NO_EXPECTED');
    expect(verifyCaptureIntegrity({ capture: makeCapture(), expectedAmountMinor: -1 }).code).toBe('NO_EXPECTED');
    expect(verifyCaptureIntegrity({ capture: makeCapture(), expectedAmountMinor: 1.5 }).code).toBe('NO_EXPECTED');
  });
});
