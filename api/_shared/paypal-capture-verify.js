/**
 * paypal-capture-verify — PayPal capture 무결성 검증 SSOT (money-critical, 순수 함수).
 *
 * 왜: "PayPal 이 order amount 를 강제한다" 는 PayPal **내부** 일관성에만 참이다.
 *   merchant invariant — ①이 order 가 우리 서버 견적(snapshot)에서 났는가 ②capture currency 가
 *   서버 예상과 같은가 ③개별 capture 가 실제로 COMPLETED 인가 ④purchase unit/capture 가 1개인가 —
 *   는 PayPal 이 보장하지 않는다.
 *
 *   기존 상태: 단건(capturePaypalOrder)= amount 무검증 + currency 'USD' 하드코딩,
 *              cart(captureCartOrder)= 금액만 parseFloat 비교, currency 미검증.
 *   → 두 경로가 이 모듈 하나로 동일 불변식을 쓴다.
 *
 * ⚠️ 금액은 절대 부동소수점으로 비교하지 않는다 (0.1+0.2 문제 / 99.29*100=9928.999…).
 *    문자열 → 통화 최소단위(minor) 정수로 변환해 정수 비교.
 *
 * 이 모듈은 판정만 한다 — 캡처/환불/쓰기 같은 부수효과는 호출자 책임.
 */

/** 통화별 최소단위 지수. 여기 없는 통화 = 미지원(조용히 통과시키지 않고 실패). */
const CURRENCY_EXPONENT = {
  USD: 2, EUR: 2, GBP: 2, AUD: 2, CAD: 2, SGD: 2, HKD: 2,
  KRW: 0, JPY: 0, // zero-decimal
};

/**
 * PayPal amount.value(문자열) → 통화 최소단위 정수.
 * 엄격: 빈값·비숫자·음수·0·초과정밀도·지수표기는 전부 null(=검증 실패).
 *
 * @param {string|number|null|undefined} value
 * @param {string} [currency='USD']
 * @returns {number|null} 최소단위 정수(양수) 또는 null
 */
export function toMinorUnits(value, currency = 'USD') {
  const exp = CURRENCY_EXPONENT[String(currency || '').toUpperCase()];
  if (exp === undefined) return null; // 미지원 통화
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const s = String(value).trim();
  if (!s) return null;

  // 음수(-)·지수(e)·공백·통화기호는 이 정규식에서 전부 탈락.
  const re = exp === 0 ? /^\d+$/ : new RegExp(`^\\d+(?:\\.\\d{1,${exp}})?$`);
  if (!re.test(s)) return null;

  const [intPart, fracPart = ''] = s.split('.');
  const frac = exp === 0 ? '' : fracPart.padEnd(exp, '0');
  const minor = Number(intPart) * 10 ** exp + (exp === 0 ? 0 : Number(frac));
  if (!Number.isSafeInteger(minor) || minor <= 0) return null; // 0/음수/오버플로 거부
  return minor;
}

/**
 * capture 응답이 서버가 아는 주문(snapshot)과 일치하는지 검증.
 *
 * 검사 순서 = 값싼 구조 검사 → status → currency → amount.
 * (currency 를 amount 보다 먼저 봐야 잘못된 exponent 로 금액을 해석하지 않는다.)
 *
 * @param {object}  p
 * @param {object}  p.capture               PayPal capture 응답 원본
 * @param {number}  p.expectedAmountMinor   서버 snapshot 기준 기대 금액(최소단위 정수)
 * @param {string} [p.expectedCurrency='USD']
 * @returns {{ok:true, captureID:string, amountMinor:number, currency:string}
 *          |{ok:false, code:string, detail:string, captureID?:string, amountMinor?:number, expectedAmountMinor?:number, currency?:string}}
 */
export function verifyCaptureIntegrity({ capture, expectedAmountMinor, expectedCurrency = 'USD' } = {}) {
  const fail = (code, detail, extra = {}) => ({ ok: false, code, detail, ...extra });

  if (!capture || typeof capture !== 'object') {
    return fail('NO_CAPTURE_RESPONSE', 'capture 응답이 없거나 객체가 아님');
  }
  // expected 가 없으면 "검증 불가" — 통과가 아니라 실패다(provenance 불명).
  if (!Number.isSafeInteger(expectedAmountMinor) || expectedAmountMinor <= 0) {
    return fail('NO_EXPECTED', 'snapshot 기대금액 없음/유효하지 않음 — 주문 provenance 확인 불가');
  }
  if (capture.status !== 'COMPLETED') {
    return fail('ORDER_NOT_COMPLETED', `order status=${capture.status ?? 'unknown'}`);
  }

  const pus = Array.isArray(capture.purchase_units) ? capture.purchase_units : [];
  if (pus.length !== 1) {
    return fail('PU_CARDINALITY', `purchase_units=${pus.length} (1 이어야 함)`);
  }
  const list = Array.isArray(pus[0]?.payments?.captures) ? pus[0].payments.captures : [];
  if (list.length === 0) return fail('NO_CAPTURE_NODE', 'capture node 없음');
  if (list.length !== 1) return fail('CAPTURE_CARDINALITY', `captures=${list.length} (1 이어야 함)`);

  const node = list[0] || {};
  const captureID = node.id || '';
  if (!captureID) return fail('NO_CAPTURE_ID', 'capture id 없음');

  // ⚠️ 순서 주의: **금액·통화를 status 보다 먼저** 본다.
  //   PENDING(리스크 홀드/eCheck)은 "돈 무결성은 정상, 정산만 대기" 이므로 금액 검증을 통과해야
  //   pending 으로 분류할 수 있다. status 를 먼저 보면 정상 금액의 PENDING 이 불일치로 오분류된다.
  const rawCurrency = node.amount?.currency_code;
  if (!rawCurrency) return fail('NO_CURRENCY', 'capture currency_code 없음', { captureID });
  const currency = String(rawCurrency).toUpperCase();
  const wantCurrency = String(expectedCurrency || '').toUpperCase();
  if (currency !== wantCurrency) {
    return fail('CURRENCY_MISMATCH', `expected=${wantCurrency} actual=${currency}`, { captureID, currency });
  }

  const amountMinor = toMinorUnits(node.amount?.value, currency);
  if (amountMinor === null) {
    return fail('BAD_AMOUNT_FORMAT', `amount.value=${JSON.stringify(node.amount?.value ?? null)}`, { captureID, currency });
  }
  if (amountMinor !== expectedAmountMinor) {
    // underpayment/overpayment 둘 다 자동확정 금지 — 운영자 검토.
    return fail('AMOUNT_MISMATCH', `expected=${expectedAmountMinor} actual=${amountMinor} (${currency} minor)`,
      { captureID, currency, amountMinor, expectedAmountMinor });
  }

  // 금액·통화 정합. 이제 정산 상태만 본다.
  if (node.status === 'COMPLETED') return { ok: true, captureID, amountMinor, currency };

  if (node.status === 'PENDING') {
    // 🔴 PENDING = PayPal 리스크 홀드 / eCheck / 승인 후 자금대기 = **정상 결제 흐름**이다.
    //   금액·통화가 맞으므로 변조가 아니다 → 격리(quarantine) 대상이 아니다.
    //   이걸 격리하면 booking doc 이 안 생기고, 홀드 해제 시 오는 PAYMENT.CAPTURE.COMPLETED
    //   webhook 이 booking 을 못 찾아 'unmatched' 로 흘러 → 돈은 정산되고 예약은 영영 없음.
    //   호출자는 `pending:true` 를 보고 **기존대로 예약을 진행**하되 정산 대기임을 기록해야 한다.
    return {
      ok: false, pending: true, code: 'CAPTURE_PENDING',
      detail: `capture status=PENDING (${node.status_details?.reason ?? 'reason unknown'}) — 금액·통화는 정합`,
      captureID, amountMinor, currency,
    };
  }

  // DECLINED / FAILED 등 — 돈이 실제로 이동하지 않았을 수 있다(호출자가 paymentCaptured 를 실제 status 로 판단).
  return fail('CAPTURE_NOT_COMPLETED', `capture status=${node.status ?? 'unknown'}`, { captureID, amountMinor, currency });
}
